//! desko-netguard：一次性提权 helper。
//!
//! 主进程用 `ShellExecuteExW("runas")` 拉起它，参数只有任务书路径；提权进程不继承
//! 父进程 stdio，所以结果一律写回执文件，且先写 `.tmp` 再改名——主进程永远读不到半成品。
//! 设计依据：docs/design/bypass/02-netguard-apply.md。

use netguard_core::*;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::process::{exit, Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// helper 由 ShellExecuteExW 拉起，本身没有控制台；子进程再开窗口就是闪烁
#[cfg(windows)]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut Command) {}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or_default()
}

fn task_path_from_args() -> Option<PathBuf> {
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        if arg == "--task" {
            return iter.next().map(PathBuf::from);
        }
        if let Some(rest) = arg.strip_prefix("--task=") {
            return Some(PathBuf::from(rest));
        }
        if !arg.starts_with("--") {
            return Some(PathBuf::from(arg));
        }
    }
    None
}

/// 任务书没读出来时的兜底：同名换前缀，保证失败也有回执可查
fn receipt_beside(task_file: &Path) -> PathBuf {
    let name = task_file
        .file_name()
        .map(|n| n.to_string_lossy().replace("netguard-task-", "netguard-receipt-"))
        .unwrap_or_else(|| "netguard-receipt.json".to_string());
    match task_file.parent() {
        Some(dir) => dir.join(name),
        None => PathBuf::from(name),
    }
}

/// 原子写：同目录临时文件 + rename。读到的一定是完整文件。
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("写入 {} 失败：{e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换 {} 失败：{e}", path.display()))
}

fn system32() -> PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    Path::new(&root).join("System32")
}

/// 只认退出码。route.exe / ipconfig 的输出随系统代码页变（本机 936），解析它是坑。
fn run_hidden(exe: &Path, args: &[String]) -> Result<(), String> {
    let mut command = Command::new(exe);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("无法启动 {}：{e}", exe.display()))?;
    if status.success() {
        return Ok(());
    }
    let name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Err(format!("{name} 返回 {}", status.code().unwrap_or(-1)))
}

fn read_hosts(path: &Path) -> Result<Vec<u8>, String> {
    match std::fs::read(path) {
        // 托管区不存在≠文件不存在：hosts 缺失是异常状态，先按空文件走，写入时会新建块
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Ok(b) => Ok(b),
        Err(e) => Err(format!("hosts 文件读取失败：{e}")),
    }
}

fn main() {
    let Some(task_file) = task_path_from_args() else {
        eprintln!("用法: desko-netguard --task <任务书.json>");
        exit(2);
    };
    let (receipt, receipt_out) = match std::fs::read(&task_file)
        .map_err(|e| format!("任务书读取失败：{e}"))
        .and_then(|bytes| serde_json::from_slice::<TaskFile>(&bytes).map_err(|e| format!("任务书解析失败：{e}")))
    {
        Ok(task) => (apply(&task), PathBuf::from(&task.receipt_path)),
        Err(fatal) => (
            ReceiptFile { fatal, started_at: now_ms(), finished_at: now_ms(), ..Default::default() },
            receipt_beside(&task_file),
        ),
    };
    let bytes = serde_json::to_vec_pretty(&receipt).unwrap_or_default();
    if let Err(e) = write_atomic(&receipt_out, &bytes) {
        eprintln!("{e}");
        exit(1);
    }
    exit(0)
}

/// 落盘结果里逐条要回填的东西
struct Outcome {
    ok: bool,
    changed: bool,
    error: String,
}

/// 保留每条路由的写入与替换信息，失败时按原操作恢复。
struct RouteAttempt {
    item: TaskItem,
    outcome: Outcome,
}

fn apply(task: &TaskFile) -> ReceiptFile {
    match task.mode {
        Mode::Apply => write_batch(task),
        Mode::Revert => revert_batch(task),
        Mode::Cleanup => cleanup_batch(task),
    }
}

fn binding_exists(route: &RouteBinding) -> bool {
    match (route.prefix.parse(), route.gateway.parse()) {
        (Ok(prefix), Ok(gateway)) => net::forward_exists(prefix, route.prefix_len, gateway, route.interface_index),
        _ => false,
    }
}

fn cleanup_batch(task: &TaskFile) -> ReceiptFile {
    let receipt = cleanup_batch_with_routes(task, binding_exists, delete_binding, add_binding);
    if receipt.hosts_written {
        let _ = run_hidden(&system32().join("ipconfig.exe"), &["/flushdns".to_string()]);
    }
    receipt
}

/// 定向移除与普通批次撤销分开：只改任务书列出的资源，任一步失败恢复本次清理前的状态。
fn cleanup_batch_with_routes(
    task: &TaskFile,
    exists: impl Fn(&RouteBinding) -> bool,
    mut remove: impl FnMut(&RouteBinding) -> Result<(), String>,
    mut add: impl FnMut(&RouteBinding) -> Outcome,
) -> ReceiptFile {
    let mut receipt = ReceiptFile { batch_id: task.batch_id.clone(), started_at: now_ms(), ..Default::default() };
    let hosts_path = PathBuf::from(&task.hosts_path);
    let hosts: Vec<_> = task.items.iter().filter(|i| matches!(i, TaskItem::CleanupHost { .. })).collect();
    if !hosts.is_empty() {
        let result = read_hosts(&hosts_path).and_then(|before| {
            let after = cleanup_hosts_bytes(&before, &task.items)?;
            if before != after {
                write_atomic(Path::new(&task.hosts_backup_path), &before)?;
                write_atomic(&hosts_path, &after)?;
                receipt.hosts_written = true;
                if read_hosts(&hosts_path)? != after { return Err("清理后 hosts 校验失败".into()); }
            }
            Ok(())
        });
        for item in hosts {
            receipt.items.push(item_result(item, &Outcome { ok: result.is_ok(), changed: receipt.hosts_written, error: result.as_ref().err().cloned().unwrap_or_default() }));
        }
    }
    let mut removed = Vec::new();
    if receipt.items.iter().all(|i| i.ok) {
        for item in task.items.iter().filter(|i| matches!(i, TaskItem::Route { .. })) {
            let binding = route_binding(item);
            let changed = exists(&binding);
            if changed { removed.push(binding.clone()); }
            let result = if changed { remove(&binding) } else { Ok(()) };
            receipt.items.push(item_result(item, &Outcome { ok: result.is_ok(), changed, error: result.err().unwrap_or_default() }));
            if receipt.items.last().is_some_and(|i| !i.ok) { break; }
        }
    }
    if receipt.items.iter().any(|i| !i.ok) {
        let mut errors = Vec::new();
        for route in removed.iter().rev() {
            let result = add(route);
            if !result.ok { errors.push(result.error); }
        }
        if receipt.hosts_written {
            if let Err(error) = restore_cleanup_hosts(task, &hosts_path) { errors.push(error); }
            else { receipt.hosts_restored = true; }
        }
        receipt.rolled_back = true;
        receipt.rollback_error = errors.join("；");
    }
    receipt.finished_at = now_ms();
    receipt
}

/// 撤销：恢复 hosts 托管区，删除新增路由并恢复被替换的路由。
fn revert_batch(task: &TaskFile) -> ReceiptFile {
    let mut receipt = ReceiptFile {
        batch_id: task.batch_id.clone(),
        started_at: now_ms(),
        hosts_backup: task.hosts_backup_path.clone(),
        rolled_back: true,
        ..Default::default()
    };
    let hosts_path = PathBuf::from(&task.hosts_path);
    if !task.hosts_backup_path.is_empty() {
        let backup = PathBuf::from(&task.hosts_backup_path);
        if backup.exists() {
            match restore_hosts(task, &hosts_path) {
                Ok(()) => receipt.hosts_written = true,
                Err(e) => receipt.rollback_error = e,
            }
        } else {
            receipt.rollback_error = "hosts 备份不存在，无法还原，请保留回滚点后重试".to_string();
        }
    }
    for item in task.items.iter().filter(|i| i.op_name() == "route") {
        let outcome = match restore_route_item(item, add_binding, delete_binding) {
            Ok(()) => Outcome { ok: true, changed: true, error: String::new() },
            Err(e) => Outcome { ok: false, changed: false, error: format!("撤销路由失败：{e}") },
        };
        receipt.items.push(item_result(item, &outcome));
    }
    if receipt.hosts_written {
        let _ = run_hidden(&system32().join("ipconfig.exe"), &["/flushdns".to_string()]);
    }
    receipt.finished_at = now_ms();
    receipt
}

fn write_batch(task: &TaskFile) -> ReceiptFile {
    let mut receipt = ReceiptFile {
        batch_id: task.batch_id.clone(),
        started_at: now_ms(),
        ..Default::default()
    };
    let hosts_path = PathBuf::from(&task.hosts_path);

    // 1) hosts：一次替换写完整块，绝不逐条 open-append
    let pins: Vec<&TaskItem> = task
        .items
        .iter()
        .filter(|i| matches!(i, TaskItem::Pin { .. }))
        .collect();
    if !pins.is_empty() {
        let outcomes = apply_host_pins(task, &hosts_path, &pins, &mut receipt);
        for (item, out) in pins.iter().zip(outcomes) {
            receipt.items.push(item_result(item, &out));
        }
    }

    // 2) 路由：逐条加，加完立刻查表
    let mut attempts: Vec<RouteAttempt> = Vec::new();
    for item in task.items.iter().filter(|i| i.op_name() == "route") {
        let outcome = apply_route_item(item, add_binding, delete_binding);
        receipt.items.push(item_result(item, &outcome));
        attempts.push(RouteAttempt {
            item: item.clone(),
            outcome,
        });
    }

    // 3) 刷 DNS：只有真改过 hosts 才值得刷
    if receipt.hosts_written {
        let _ = run_hidden(&system32().join("ipconfig.exe"), &["/flushdns".to_string()]);
    }

    // 4) 半批最难向用户解释：任一条没成，整批回滚
    if receipt.items.iter().any(|i| !i.ok) {
        let mut errs = Vec::new();
        if receipt.hosts_written {
            if let Err(e) = restore_hosts(task, &hosts_path) {
                errs.push(e);
            } else {
                receipt.hosts_restored = true;
            }
        }
        for attempt in attempts.iter().filter(|a| a.outcome.changed) {
            if let Err(e) = restore_route_item(&attempt.item, add_binding, delete_binding) {
                errs.push(format!("撤销路由 {} 失败：{e}", attempt.item.id()));
            } else {
                receipt.reverted_routes.push(attempt.item.id().to_string());
            }
        }
        receipt.rolled_back = true;
        receipt.rollback_error = errs.join("；");
        if receipt.hosts_written {
            let _ = run_hidden(&system32().join("ipconfig.exe"), &["/flushdns".to_string()]);
        }
    }
    receipt.finished_at = now_ms();
    receipt
}

fn item_result(item: &TaskItem, out: &Outcome) -> ItemResult {
    ItemResult {
        id: item.id().to_string(),
        op: item.op_name().to_string(),
        ok: out.ok,
        changed: out.changed,
        error: out.error.clone(),
    }
}

fn all_failed(pins: &[&TaskItem], error: String) -> Vec<Outcome> {
    pins.iter().map(|_| Outcome { ok: false, changed: false, error: error.clone() }).collect()
}

fn apply_host_pins(
    task: &TaskFile,
    hosts_path: &Path,
    pins: &[&TaskItem],
    receipt: &mut ReceiptFile,
) -> Vec<Outcome> {
    let wanted: Vec<Pin> = pins
        .iter()
        .map(|item| match item {
            TaskItem::Pin { host, address, .. } => Pin { host: host.clone(), address: address.clone() },
            _ => unreachable!(),
        })
        .collect();
    let original = match read_hosts(hosts_path) {
        Ok(b) => b,
        Err(e) => return all_failed(pins, e),
    };
    let text = String::from_utf8_lossy(&original).to_string();
    let before = match parse_managed(&text) {
        Ok(map) => map,
        Err(e) => return all_failed(pins, e),
    };
    let (rendered, changed) = match apply_pins_bytes(&original, &wanted) {
        Ok(v) => v,
        Err(e) => return all_failed(pins, e),
    };
    if changed > 0 {
        let backup = PathBuf::from(&task.hosts_backup_path);
        if let Err(e) = write_atomic(&backup, &original) {
            return all_failed(pins, e);
        }
        receipt.hosts_backup = backup.to_string_lossy().into_owned();
        if let Err(e) = write_atomic(hosts_path, &rendered) {
            return all_failed(pins, e);
        }
        receipt.hosts_written = true;
    }
    // 即时校验只回答"写进去没有"：重读文件、重解托管区，网络级通不通归主进程复验
    let after = match read_hosts(hosts_path) {
        Ok(b) => b,
        Err(e) => return all_failed(pins, e),
    };
    let after = match parse_managed(&String::from_utf8_lossy(&after)) {
        Ok(map) => map,
        Err(e) => return all_failed(pins, e),
    };
    wanted
        .iter()
        .map(|pin| {
            let key = pin.host.to_lowercase();
            let landed = after.get(&key).map(|v| v.as_str()) == Some(pin.address.as_str());
            let was_there = before.get(&key).map(|v| v.as_str()) == Some(pin.address.as_str());
            Outcome {
                ok: landed,
                changed: !was_there,
                error: if landed {
                    String::new()
                } else {
                    format!("写入后 hosts 托管区仍未包含 {} → {}", pin.host, pin.address)
                },
            }
        })
        .collect()
}

fn restore_hosts(task: &TaskFile, hosts_path: &Path) -> Result<(), String> {
    let backup = PathBuf::from(&task.hosts_backup_path);
    let bytes = std::fs::read(&backup).map_err(|e| format!("读取 hosts 备份失败：{e}"))?;
    let current = read_hosts(hosts_path)?;
    let restored = restore_managed_bytes(&current, &bytes)?;
    write_atomic(hosts_path, &restored)
}

fn restore_cleanup_hosts(task: &TaskFile, hosts_path: &Path) -> Result<(), String> {
    let before = std::fs::read(&task.hosts_backup_path).map_err(|e| format!("读取 hosts 备份失败：{e}"))?;
    let current = read_hosts(hosts_path)?;
    let restored = if current == cleanup_hosts_bytes(&before, &task.items)? {
        before // 清理期间没有外部修改时，连同托管区原位置和换行一起原样恢复。
    } else {
        let original = parse_managed(&String::from_utf8_lossy(&before))?;
        let replacements = task.items.iter().filter_map(|item| match item {
            TaskItem::CleanupHost { host, .. } => Some((host.to_lowercase(), original.get(&host.to_lowercase()).cloned())),
            _ => None,
        }).collect();
        replace_managed_hosts_bytes(&current, &replacements)?
    };
    write_atomic(hosts_path, &restored)
}

fn apply_route(prefix: &str, prefix_len: u8, gateway: &str, interface_index: u32) -> Outcome {
    let bad = |error: String| Outcome { ok: false, changed: false, error };
    let Ok(prefix_ip) = prefix.parse::<Ipv4Addr>() else {
        return bad(format!("网段地址无法识别：{prefix}"));
    };
    let Ok(gateway_ip) = gateway.parse::<Ipv4Addr>() else {
        return bad(format!("网关无法识别：{gateway}"));
    };
    if net::forward_exists(prefix_ip, prefix_len, gateway_ip, interface_index) {
        return Outcome { ok: true, changed: false, error: String::new() };
    }
    // 最后一道闸：网关不落在候选接口网段内，加进去也是静默回落默认路由
    if !net::route_binding_valid(prefix_ip, prefix_len, gateway_ip, interface_index) {
        return bad(format!("目标前缀或网关不属于接口 #{interface_index}，添加后不会生效"));
    }
    let route_exe = system32().join("route.exe");
    if let Err(e) = run_hidden(&route_exe, &route_add_args(prefix, prefix_len, gateway, interface_index)) {
        return bad(format!("添加路由失败：{e}"));
    }
    let landed = net::forward_exists(prefix_ip, prefix_len, gateway_ip, interface_index);
    Outcome {
        ok: landed,
        changed: true,
        error: if landed { String::new() } else { "路由添加命令已执行，但路由表里查不到该条".to_string() },
    }
}

fn add_binding(route: &RouteBinding) -> Outcome {
    apply_route(&route.prefix, route.prefix_len, &route.gateway, route.interface_index)
}

/// 撤销重试可以遇到已经删除的路由；只删除精确匹配的绑定。
fn delete_binding(route: &RouteBinding) -> Result<(), String> {
    let prefix = route.prefix.parse().map_err(|_| "网段地址无法识别".to_string())?;
    let gateway = route.gateway.parse().map_err(|_| "网关无法识别".to_string())?;
    if !net::forward_exists(prefix, route.prefix_len, gateway, route.interface_index) { return Ok(()); }
    run_hidden(&system32().join("route.exe"), &route_delete_args(&route.prefix, route.prefix_len, &route.gateway, route.interface_index))?;
    if net::forward_exists(prefix, route.prefix_len, gateway, route.interface_index) {
        return Err("删除命令已执行，但原路由仍存在".into());
    }
    Ok(())
}

fn route_binding(item: &TaskItem) -> RouteBinding {
    let TaskItem::Route { prefix, prefix_len, gateway, interface_index, .. } = item else { unreachable!() };
    RouteBinding { prefix: prefix.clone(), prefix_len: *prefix_len, gateway: gateway.clone(), interface_index: *interface_index }
}

fn apply_route_item(
    item: &TaskItem,
    mut add: impl FnMut(&RouteBinding) -> Outcome,
    mut remove: impl FnMut(&RouteBinding) -> Result<(), String>,
) -> Outcome {
    let TaskItem::SwapRoute { desired, previous, .. } = item else { return add(&route_binding(item)); };
    let mut outcome = add(desired);
    if !outcome.ok { return outcome; }
    for route in previous {
        // 删除失败也可能已有系统改动，保留整条回滚信息供恢复和重试。
        outcome.changed = true;
        if let Err(error) = remove(route) {
            outcome.ok = false;
            outcome.error = format!("替换原出口失败：{error}");
            break;
        }
    }
    outcome
}

fn restore_route_item(
    item: &TaskItem,
    mut add: impl FnMut(&RouteBinding) -> Outcome,
    mut remove: impl FnMut(&RouteBinding) -> Result<(), String>,
) -> Result<(), String> {
    let TaskItem::SwapRoute { desired, previous, desired_existed, .. } = item else { return remove(&route_binding(item)); };
    for route in previous {
        let outcome = add(route);
        if !outcome.ok { return Err(format!("恢复原出口失败：{}", outcome.error)); }
    }
    if !desired_existed { remove(desired)?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(index: u32) -> RouteBinding {
        RouteBinding { prefix: "10.0.0.243".into(), prefix_len: 32, gateway: format!("192.168.{index}.1"), interface_index: index }
    }

    #[test]
    fn cleanup_route_failure_restores_hosts_and_routes_then_allows_a_successful_retry() {
        let dir = std::env::temp_dir().join(format!("desko-cleanup-helper-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        let hosts = dir.join("hosts");
        let original = format!("# original\n{HOSTS_BEGIN}\n10.0.0.2 a.example.com\n{HOSTS_END}\n");
        std::fs::write(&hosts, &original).unwrap();
        let route = binding(1);
        let routes = std::cell::RefCell::new(std::collections::BTreeSet::from([route.clone()]));
        let task = TaskFile {
            batch_id: "cleanup-test".into(), mode: Mode::Cleanup, created_at: 1,
            hosts_path: hosts.to_string_lossy().into_owned(), receipt_path: String::new(),
            hosts_backup_path: dir.join("backup").to_string_lossy().into_owned(),
            items: vec![TaskItem::CleanupHost { id: "a".into(), host: "a.example.com".into(), address: "10.0.0.2".into(), original: None },
                TaskItem::Route { id: "a".into(), prefix: route.prefix.clone(), prefix_len: 32, gateway: route.gateway.clone(), interface_index: 1, interface_alias: String::new() }],
        };
        let failed = cleanup_batch_with_routes(&task, |r| routes.borrow().contains(r), |r| {
            routes.borrow_mut().remove(r);
            Err("failed after route deletion".into())
        }, |r| added(&routes, r));
        assert!(failed.rolled_back && failed.hosts_restored && failed.rollback_error.is_empty());
        assert_eq!(std::fs::read_to_string(&hosts).unwrap(), original);
        assert!(routes.borrow().contains(&route));
        let success = cleanup_batch_with_routes(&task, |r| routes.borrow().contains(r), |r| { routes.borrow_mut().remove(r); Ok(()) }, |r| added(&routes, r));
        assert!(!success.rolled_back && success.items.iter().all(|i| i.ok));
        assert!(parse_managed(&std::fs::read_to_string(&hosts).unwrap()).unwrap().is_empty());
        assert!(routes.borrow().is_empty());
        let retry = cleanup_batch_with_routes(&task, |r| routes.borrow().contains(r), |_| panic!("route already removed"), |_| panic!("nothing to restore"));
        assert!(retry.items.iter().all(|i| i.ok && !i.changed));
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn swap(desired_existed: bool) -> TaskItem {
        TaskItem::SwapRoute { id: "new-catalog-id".into(), desired: binding(2), previous: vec![binding(1)], desired_existed }
    }

    fn added(routes: &std::cell::RefCell<std::collections::BTreeSet<RouteBinding>>, route: &RouteBinding) -> Outcome {
        Outcome { ok: true, changed: routes.borrow_mut().insert(route.clone()), error: String::new() }
    }

    #[test]
    fn switching_removes_the_old_binding_and_revert_restores_it() {
        let routes = std::cell::RefCell::new(std::collections::BTreeSet::from([binding(1)]));
        let item = swap(false);
        let outcome = apply_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) });
        assert!(outcome.ok && outcome.changed);
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(2)]));
        restore_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).unwrap();
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(1)]));
    }

    #[test]
    fn failed_replacement_keeps_rollback_information_and_restores_the_original_route() {
        let routes = std::cell::RefCell::new(std::collections::BTreeSet::from([binding(1)]));
        let item = swap(false);
        let outcome = apply_route_item(&item, |r| added(&routes, r), |r| {
            routes.borrow_mut().remove(r);
            Err("delete verification failed".into())
        });
        assert!(!outcome.ok && outcome.changed);
        restore_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).unwrap();
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(1)]));
    }

    #[test]
    fn reverting_a_swap_preserves_a_desired_route_that_already_existed() {
        let routes = std::cell::RefCell::new(std::collections::BTreeSet::from([binding(1), binding(2)]));
        let item = swap(true);
        assert!(apply_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).ok);
        restore_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).unwrap();
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(1), binding(2)]));
    }

    #[test]
    fn failed_restore_retains_the_new_route_until_retry_succeeds() {
        let routes = std::cell::RefCell::new(std::collections::BTreeSet::from([binding(2)]));
        let item = swap(false);
        let result = restore_route_item(&item, |_| Outcome { ok: false, changed: false, error: "adapter offline".into() }, |_| panic!("must keep the new route"));
        assert!(result.is_err());
        restore_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).unwrap();
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(1)]));
        // 重试整个撤销依然幂等。
        restore_route_item(&item, |r| added(&routes, r), |r| { routes.borrow_mut().remove(r); Ok(()) }).unwrap();
        assert_eq!(*routes.borrow(), std::collections::BTreeSet::from([binding(1)]));
    }

    #[test]
    fn missing_hosts_backup_is_a_revert_failure() {
        let task = TaskFile { batch_id: "missing-backup".into(), mode: Mode::Revert, created_at: 0,
            hosts_path: String::new(), receipt_path: String::new(),
            hosts_backup_path: std::env::temp_dir().join(format!("desko-missing-backup-{}", now_ms())).to_string_lossy().into_owned(),
            items: Vec::new() };
        let result = revert_batch(&task);
        assert!(!result.rollback_error.is_empty());
        assert!(!result.hosts_written);
    }
}
