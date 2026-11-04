//! 移除清单目标：定向清理自建配置，并修剪历史回滚点，防止撤销其他批次时恢复已删除的目标。
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use netguard_core::{net, parse_managed, replace_managed_hosts_bytes, Mode, RouteBinding, TaskFile, TaskItem};
use crate::{db::BypassTarget, error::AppError};
use super::netguard_service::{batch_dir, route_exists, route_prefix_of, run_batch, write_json, ApplyOutcome};

#[derive(serde::Serialize, serde::Deserialize)]
struct PendingCleanup {
    target_id: String,
    items: Vec<TaskItem>,
    hosts: BTreeMap<String, Option<String>>,
    routes: BTreeSet<RouteBinding>,
    cleaned: bool,
}

struct Checkpoint {
    path: PathBuf,
    task: TaskFile,
    applied: Option<TaskFile>,
    backup: Option<Vec<u8>>,
    original_backup: Option<Vec<u8>>,
}

fn failure(error: impl std::fmt::Display) -> AppError {
    AppError::Bypass(format!("移除未完成，清单记录已保留：{error}"))
}

fn pending_path(dir: &Path) -> PathBuf { dir.join("netguard-pending-cleanup.json") }

pub fn ensure_no_pending_cleanup() -> Result<(), AppError> {
    if pending_path(&batch_dir()).exists() {
        return Err(AppError::Bypass("上次移除尚未完成，请先重试移除该目标".into()));
    }
    Ok(())
}

fn checkpoints(dir: &Path) -> Result<Vec<Checkpoint>, AppError> {
    let mut records = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(failure)? {
        let entry = entry.map_err(failure)?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("netguard-rollback-") || !name.ends_with(".json") { continue; }
        let task: TaskFile = serde_json::from_slice(&std::fs::read(entry.path()).map_err(failure)?).map_err(failure)?;
        let applied = std::fs::read(dir.join(format!("netguard-task-{}.json", task.batch_id))).ok()
            .and_then(|bytes| serde_json::from_slice::<TaskFile>(&bytes).ok());
        let original_backup = applied.as_ref().and_then(|a| std::fs::read(&a.hosts_backup_path).ok());
        let backup = if task.hosts_backup_path.is_empty() { None }
            else { std::fs::read(&task.hosts_backup_path).ok() };
        records.push(Checkpoint { path: entry.path(), task, applied, backup, original_backup });
    }
    records.sort_by_key(|r| r.task.created_at);
    Ok(records)
}

fn binding(item: &TaskItem) -> Option<RouteBinding> {
    match item {
        TaskItem::Route { prefix, prefix_len, gateway, interface_index, .. } => Some(RouteBinding {
            prefix: prefix.clone(), prefix_len: *prefix_len, gateway: gateway.clone(), interface_index: *interface_index,
        }),
        _ => None,
    }
}

fn overlaps(route: &RouteBinding, target: &BypassTarget) -> bool {
    let Some((prefix, len)) = route_prefix_of(target) else { return false; };
    match (route.prefix.parse(), prefix.parse()) {
        (Ok(route_ip), Ok(target_ip)) => net::covers_prefix(route_ip, route.prefix_len.min(len), target_ip),
        _ => false,
    }
}

fn cleanup_plan(target: &BypassTarget, targets: &[BypassTarget], history: &[Checkpoint], pinned: &BTreeMap<String, String>) -> Result<PendingCleanup, AppError> {
    let mut ids = BTreeSet::from([target.id.clone()]);
    let mut names = BTreeSet::new();
    if target.kind == "domain" { names.insert(target.host.to_lowercase()); }
    for record in history {
        if let Some(applied) = &record.applied {
            for item in &applied.items {
                if let TaskItem::Pin { id, host, .. } = item {
                    if id == &target.id || names.contains(&host.to_lowercase()) { ids.insert(id.clone()); }
                }
            }
        }
    }
    let others: Vec<_> = targets.iter().filter(|t| t.id != target.id).collect();
    let mut hosts: BTreeMap<String, (Option<String>, String)> = BTreeMap::new();
    let mut routes = BTreeSet::new();
    for record in history {
        if let Some(applied) = &record.applied {
            for item in &applied.items {
                if let TaskItem::Pin { id, host, address } = item {
                    if !ids.contains(id) || others.iter().any(|t| t.host.eq_ignore_ascii_case(host)) { continue; }
                    let host = host.to_lowercase();
                    if record.task.hosts_backup_path.is_empty() { continue; }
                    let backup = record.original_backup.as_ref().ok_or_else(|| failure("找不到 hosts 备份，无法确认配置归属"))?;
                    let before = parse_managed(&String::from_utf8_lossy(backup)).map_err(failure)?;
                    if before.get(&host) != Some(address) {
                        let original = before.get(&host).cloned();
                        hosts.entry(host).and_modify(|entry| entry.1 = address.clone())
                            .or_insert((original, address.clone()));
                    }
                }
            }
        }
        for item in &record.task.items {
            let owned: Vec<_> = match item {
                TaskItem::SwapRoute { desired, desired_existed, previous, .. } => {
                    let mut owned = previous.clone();
                    if !desired_existed { owned.push(desired.clone()); }
                    owned
                }
                _ => binding(item).into_iter().collect(),
            };
            for route in owned {
                let same_prefix = route_prefix_of(target).is_some_and(|(prefix, len)| prefix == route.prefix && len == route.prefix_len);
                if (ids.contains(item.id()) || same_prefix)
                    && !others.iter().any(|t| t.id == item.id() || overlaps(&route, t)) {
                    routes.insert(route);
                }
            }
        }
    }
    let mut items = Vec::new();
    let mut replacements = BTreeMap::new();
    for (host, (original, address)) in hosts {
        let current = pinned.get(&host);
        if current == Some(&address) {
            items.push(TaskItem::CleanupHost { id: target.id.clone(), host: host.clone(), address, original: original.clone() });
            replacements.insert(host, original);
        } else {
            // 配置之后用户又改过该域名，保留当前值；旧快照也不能覆盖它。
            replacements.insert(host, current.cloned());
        }
    }
    for route in &routes {
        items.push(TaskItem::Route { id: target.id.clone(), prefix: route.prefix.clone(), prefix_len: route.prefix_len,
            gateway: route.gateway.clone(), interface_index: route.interface_index, interface_alias: String::new() });
    }
    Ok(PendingCleanup { target_id: target.id.clone(), items, hosts: replacements, routes, cleaned: false })
}

fn prune_history(history: &[Checkpoint], plan: &PendingCleanup, targets: &[BypassTarget]) -> Result<(), AppError> {
    for record in history {
        let mut task = record.task.clone();
        task.items.retain_mut(|item| {
            if let TaskItem::SwapRoute { desired, desired_existed, previous, .. } = item {
                previous.retain(|r| !plan.routes.contains(r));
                if plan.routes.contains(desired) { *desired_existed = true; }
                return !previous.is_empty() || !*desired_existed;
            }
            !binding(item).is_some_and(|r| plan.routes.contains(&r))
        });
        if !task.hosts_backup_path.is_empty() && !plan.hosts.is_empty() {
            let backup = record.backup.as_ref().ok_or_else(|| failure("找不到 hosts 备份，无法清理撤销记录"))?;
            let revised = replace_managed_hosts_bytes(backup, &plan.hosts).map_err(failure)?;
            // 单独写一份修剪后的快照，原始写入凭据继续用于追踪其他清单项的配置归属。
            let path = record.path.with_extension("hosts");
            let temp = path.with_extension("tmp");
            std::fs::write(&temp, revised).map_err(failure)?;
            std::fs::rename(&temp, &path).map_err(failure)?;
            task.hosts_backup_path = path.to_string_lossy().into_owned();
            let other_pins = record.applied.as_ref().is_none_or(|a| a.items.iter().any(|item|
                matches!(item, TaskItem::Pin { id, host, .. } if targets.iter().any(|t|
                    t.id != plan.target_id && (t.id == *id || t.host.eq_ignore_ascii_case(host))))));
            if !other_pins { task.hosts_backup_path.clear(); }
        }
        if task.items.is_empty() && task.hosts_backup_path.is_empty() {
            std::fs::remove_file(&record.path).map_err(failure)?;
        } else { write_json(&record.path, &task)?; }
    }
    Ok(())
}

/// 返回 false 表示取消授权；有错误或缺少回执时保留清单和清理任务供重试。
pub fn remove_target(target: &BypassTarget, targets: &[BypassTarget]) -> Result<bool, AppError> {
    remove_target_in(&batch_dir(), target, targets, route_exists, |items| {
        run_batch(items, Mode::Cleanup, &uuid::Uuid::new_v4().to_string())
    }, netguard_core::read_pinned)
}

fn remove_target_in(
    dir: &Path, target: &BypassTarget, targets: &[BypassTarget],
    exists: impl Fn(&RouteBinding) -> bool,
    mut execute: impl FnMut(Vec<TaskItem>) -> Result<ApplyOutcome, AppError>,
    pinned: impl FnOnce() -> Result<BTreeMap<String, String>, String>,
) -> Result<bool, AppError> {
    let path = pending_path(dir);
    let resumed = path.exists();
    let history = checkpoints(dir)?;
    let mut plan: PendingCleanup = if path.exists() {
        serde_json::from_slice(&std::fs::read(&path).map_err(failure)?).map_err(failure)?
    } else {
        let plan = cleanup_plan(target, targets, &history, &BTreeMap::new())?;
        if plan.hosts.is_empty() { plan }
        else { cleanup_plan(target, targets, &history, &pinned().map_err(failure)?)? }
    };
    if plan.target_id != target.id { return Err(failure("请先重试移除上一个目标")); }
    write_json(&path, &plan)?;
    if !plan.cleaned {
        let needs_system_cleanup = plan.items.iter().any(|item| match item {
            TaskItem::CleanupHost { .. } => true,
            _ => binding(item).is_some_and(|r| exists(&r)),
        });
        if needs_system_cleanup {
            let result = execute(plan.items.clone())?;
            if result.cancelled {
                if !resumed { std::fs::remove_file(&path).map_err(failure)?; }
                return Ok(false);
            }
            if result.rolled_back || !result.error.is_empty() || result.items.len() != plan.items.len() || result.items.iter().any(|i| !i.ok) {
                return Err(failure(result.items.iter().find(|i| !i.ok).map(|i| i.error.as_str()).filter(|s| !s.is_empty())
                    .unwrap_or(if result.error.is_empty() { "系统清理尚未完成，请重试移除" } else { &result.error })));
            }
        }
        plan.cleaned = true;
        write_json(&path, &plan)?;
    }
    prune_history(&history, &plan, targets)?;
    std::fs::remove_file(&path).map_err(failure)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str, address: &str) -> BypassTarget {
        BypassTarget { id: id.into(), host: format!("{id}.example.com"), input: format!("{id}.example.com"), kind: "domain".into(),
            port: 443, path: "/".into(), scheme: "https".into(), address: address.into(), interface_name: String::new(), next_hop: String::new(),
            verdict: "directOk".into(), stale: false, cdn_like: false, note: String::new(), apply_state: "applied".into(), apply_batch: String::new(),
            created_at: 1, updated_at: 1, checked_at: 1 }
    }

    fn route(target: &BypassTarget) -> TaskItem {
        TaskItem::Route { id: target.id.clone(), prefix: target.address.clone(), prefix_len: 32, gateway: "192.168.1.1".into(), interface_index: 1, interface_alias: String::new() }
    }

    fn history(dir: &Path, target: &BypassTarget, before: &[u8], time: i64) {
        let batch = uuid::Uuid::new_v4().to_string();
        let backup = dir.join(format!("backup-{batch}"));
        std::fs::write(&backup, before).unwrap();
        let task = TaskFile { batch_id: batch.clone(), mode: Mode::Apply, created_at: time, hosts_path: String::new(), receipt_path: String::new(),
            hosts_backup_path: backup.to_string_lossy().into_owned(), items: vec![TaskItem::Pin { id: target.id.clone(), host: target.host.clone(), address: target.address.clone() }, route(target)] };
        write_json(&dir.join(format!("netguard-task-{batch}.json")), &task).unwrap();
        write_json(&dir.join(format!("netguard-rollback-{batch}.json")), &TaskFile { mode: Mode::Revert, items: vec![route(target)], ..task }).unwrap();
    }

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desko-cleanup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn deleting_a_target_prunes_later_snapshots_so_reverting_another_batch_cannot_restore_it() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        let b = target("b", "10.0.0.2");
        history(&dir, &a, b"# original\n", 1);
        let with_a = format!("{}\n{} {}\n{}\n", netguard_core::HOSTS_BEGIN, a.address, a.host, netguard_core::HOSTS_END);
        history(&dir, &b, with_a.as_bytes(), 2);
        let pinned = BTreeMap::from([(a.host.clone(), a.address.clone()), (b.host.clone(), b.address.clone())]);
        let targets = vec![a.clone(), b.clone()];
        let records = checkpoints(&dir).unwrap();
        let plan = cleanup_plan(&a, &targets, &records, &pinned).unwrap();
        assert_eq!(plan.routes.len(), 1);
        assert_eq!(plan.hosts.get(&a.host), Some(&None));
        prune_history(&records, &plan, &targets).unwrap();
        let records = checkpoints(&dir).unwrap();
        assert_eq!(records.len(), 1);
        assert!(!parse_managed(&String::from_utf8_lossy(records[0].backup.as_ref().unwrap())).unwrap().contains_key(&a.host));
        assert_eq!(records[0].task.items[0].id(), "b");
        let plan_b = cleanup_plan(&b, &[b.clone()], &records, &pinned).unwrap();
        assert_eq!(plan_b.routes.len(), 1);
        assert!(plan_b.hosts.contains_key(&b.host), "pruned snapshots must retain the original ownership evidence");
        prune_history(&records, &plan_b, &[b]).unwrap();
        assert!(checkpoints(&dir).unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn shared_route_is_kept_until_the_last_reference_is_removed_even_when_the_owner_id_changed() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        let b = target("b", "10.0.0.1");
        history(&dir, &a, b"", 1);
        let targets = vec![a.clone(), b.clone()];
        let records = checkpoints(&dir).unwrap();
        let plan = cleanup_plan(&a, &targets, &records, &BTreeMap::from([(a.host.clone(), a.address.clone())])).unwrap();
        assert!(plan.routes.is_empty());
        prune_history(&records, &plan, &targets).unwrap();
        let records = checkpoints(&dir).unwrap();
        let last = cleanup_plan(&b, &[b.clone()], &records, &BTreeMap::new()).unwrap();
        assert_eq!(last.routes.len(), 1);
        prune_history(&records, &last, &[b]).unwrap();
        assert!(checkpoints(&dir).unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn original_hosts_and_external_edits_are_preserved_and_unknown_routes_are_never_planned() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        let before = format!("{}\n10.9.0.1 {}\n{}\n", netguard_core::HOSTS_BEGIN, a.host, netguard_core::HOSTS_END);
        history(&dir, &a, before.as_bytes(), 1);
        let records = checkpoints(&dir).unwrap();
        let plan = cleanup_plan(&a, &[a.clone()], &records, &BTreeMap::from([(a.host.clone(), a.address.clone())])).unwrap();
        assert!(plan.items.iter().any(|i| matches!(i, TaskItem::CleanupHost { original: Some(ip), .. } if ip == "10.9.0.1")));
        let modified = cleanup_plan(&a, &[a.clone()], &records, &BTreeMap::from([(a.host.clone(), "10.9.0.99".into())])).unwrap();
        assert_eq!(modified.hosts[&a.host].as_deref(), Some("10.9.0.99"));
        assert!(modified.items.iter().all(|i| !matches!(i, TaskItem::CleanupHost { .. })));
        let empty = cleanup_plan(&a, &[a.clone()], &[], &BTreeMap::from([(a.host.clone(), a.address.clone())])).unwrap();
        assert!(empty.items.is_empty());
        let mut records = records;
        records[0].original_backup = None;
        assert!(cleanup_plan(&a, &[a.clone()], &records, &BTreeMap::new()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_shared_subnet_route_is_not_removed_when_another_target_is_inside_it() {
        let a = target("a", "10.0.0.1");
        let mut network = a.clone();
        network.kind = "cidr".into();
        network.host = "10.0.0.0/24".into();
        let route = RouteBinding { prefix: "10.0.0.0".into(), prefix_len: 24, gateway: "192.168.1.1".into(), interface_index: 1 };
        assert!(overlaps(&route, &a));
        assert!(overlaps(&RouteBinding { prefix_len: 32, prefix: a.address.clone(), ..route.clone() }, &network));
        assert!(!overlaps(&route, &target("outside", "10.0.1.1")));
    }

    #[test]
    fn cleanup_after_a_swap_never_claims_a_preexisting_destination_route() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        history(&dir, &a, b"", 1);
        let mut records = checkpoints(&dir).unwrap();
        let previous = binding(&route(&a)).unwrap();
        let external = RouteBinding { interface_index: 2, gateway: "192.168.2.1".into(), ..previous.clone() };
        records[0].task.items = vec![TaskItem::SwapRoute { id: a.id.clone(), desired: external.clone(), desired_existed: true, previous: vec![previous.clone()] }];
        let plan = cleanup_plan(&a, &[a.clone()], &records, &BTreeMap::new()).unwrap();
        assert!(plan.routes.contains(&previous));
        assert!(!plan.routes.contains(&external));
        let mut owner = target("a", "");
        owner.host = "renamed.example.com".into();
        let mut readded = a.clone();
        readded.id = "new-id".into();
        let protected = cleanup_plan(&readded, &[readded.clone(), owner], &records, &BTreeMap::new()).unwrap();
        assert!(protected.routes.is_empty(), "an existing catalog owner must be protected even if its latest address is unknown");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn cancellation_keeps_history_and_failed_cleanup_can_resume_without_losing_ownership() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        history(&dir, &a, b"", 1);
        let current = || Ok(BTreeMap::from([(a.host.clone(), a.address.clone())]));
        let cancelled = remove_target_in(&dir, &a, &[a.clone()], |_| true, |_| Ok(ApplyOutcome {
            batch_id: "cancelled".into(), cancelled: true, rolled_back: false, items: vec![], error: String::new(),
        }), current).unwrap();
        assert!(!cancelled);
        assert!(!pending_path(&dir).exists());
        assert_eq!(checkpoints(&dir).unwrap().len(), 1);
        let failed = remove_target_in(&dir, &a, &[a.clone()], |_| true, |_| Err(failure("helper failed")), current);
        assert!(failed.is_err());
        assert!(pending_path(&dir).exists());
        let success = remove_target_in(&dir, &a, &[a.clone()], |_| true, |items| Ok(ApplyOutcome {
            batch_id: "retried".into(), cancelled: false, rolled_back: false, error: String::new(),
            items: items.iter().map(|i| super::super::netguard_service::ApplyItem { id: i.id().into(), op: i.op_name().into(), ok: true, changed: true, error: String::new() }).collect(),
        }), || panic!("must reuse the saved cleanup plan")).unwrap();
        assert!(success);
        assert!(!pending_path(&dir).exists());
        assert!(checkpoints(&dir).unwrap().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unconfigured_targets_need_no_hosts_read_or_elevation() {
        let dir = temp_dir();
        let a = target("a", "10.0.0.1");
        assert!(remove_target_in(&dir, &a, &[a.clone()], |_| panic!("no owned route"), |_| panic!("no system cleanup"), || panic!("no owned hosts entry")).unwrap());
        assert!(!pending_path(&dir).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
