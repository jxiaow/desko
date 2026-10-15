use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::State;

use crate::db::BypassTarget;
use crate::error::AppError;
use crate::services::bypass_service::{self, ProbeReport};
use crate::services::bypass_probe_job;
use crate::services::netguard_service::{self, ApplyOutcome, PlannedRow, RouteOverride};
use crate::AppState;

static MUTATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

struct MutationGuard;
impl Drop for MutationGuard {
    fn drop(&mut self) { MUTATING.store(false, std::sync::atomic::Ordering::Release); }
}

/// The page can be closed during UAC. Serialize backend mutations independently
/// of component state; cloned worker owners also survive command cancellation.
fn mutation_guard() -> Result<std::sync::Arc<MutationGuard>, AppError> {
    MUTATING.compare_exchange(false, true, std::sync::atomic::Ordering::Acquire, std::sync::atomic::Ordering::Relaxed)
        .map_err(|_| AppError::Bypass("另一项网络直连操作正在进行，请等待完成后重试".into()))?;
    Ok(std::sync::Arc::new(MutationGuard))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 最近探过的结论缓存（原文 → 写库时刻 + 报告）。「开始探测」出结论后点「加入清单」
/// 直接落这份，不再跑第二遍网络；超过 TTL 后须显式重新探测，保存不发起网络请求。
const REPORT_TTL_MS: i64 = 10 * 60 * 1000;

fn probe_cache() -> &'static Mutex<HashMap<String, (i64, ProbeReport)>> {
    static LAST: OnceLock<Mutex<HashMap<String, (i64, ProbeReport)>>> = OnceLock::new();
    LAST.get_or_init(Default::default)
}

/// 探测报告 → 清单行。新建档默认未写入，更新时由调用方对账并保留撤销批次。
fn target_from(report: &ProbeReport, created_at: i64, applied: Option<(&str, &str)>) -> BypassTarget {
    BypassTarget {
        id: uuid::Uuid::new_v4().to_string(),
        host: report.target.host.clone(),
        input: report.input.clone(),
        kind: report.target.kind.to_string(),
        port: report.target.port as i64,
        path: report.target.path.clone(),
        scheme: report.target.scheme.to_string(),
        address: report.chosen.clone().unwrap_or_default(),
        interface_name: report
            .egress
            .as_ref()
            .map(|e| e.interface.clone())
            .unwrap_or_default(),
        next_hop: report
            .egress
            .as_ref()
            .map(|e| e.next_hop.clone())
            .unwrap_or_default(),
        verdict: report.verdict.as_str().to_string(),
        stale: report.stale,
        // CDN 轮换特征探针只在弹窗里露一次等于没探：钉死等于锁在一个会失效的节点上，
        // 这个判断必须常驻行上
        cdn_like: report.cdn_like,
        note: report.headline.clone(),
        apply_state: applied.map(|(s, _)| s.to_string()).unwrap_or_else(|| "none".to_string()),
        apply_batch: applied.map(|(_, b)| b.to_string()).unwrap_or_default(),
        created_at,
        updated_at: now_ms(),
        checked_at: now_ms(),
    }
}

async fn probe_offline(input: String, request_id: Option<String>) -> Result<ProbeReport, AppError> {
    let report = bypass_probe_job::run(request_id, bypass_service::probe(&input)).await?;
    if let Ok(mut cache) = probe_cache().lock() {
        cache.retain(|_, (at, _)| now_ms() - *at < REPORT_TTL_MS);
        cache.insert(report.input.clone(), (now_ms(), report.clone()));
    }
    Ok(report)
}

fn cached_report(key: &str) -> Option<ProbeReport> {
    let cache = probe_cache().lock().ok()?;
    let (at, report) = cache.get(key)?;
    (now_ms() - *at < REPORT_TTL_MS).then(|| report.clone())
}

fn report_for_save(key: &str) -> Result<ProbeReport, AppError> {
    cached_report(key)
        .ok_or_else(|| AppError::Bypass("探测结果已过期或不存在，请重新探测后再加入清单".to_string()))
}

/// 只探不写：给结论弹窗用
#[tauri::command]
pub async fn bypass_probe(input: String, request_id: Option<String>) -> Result<ProbeReport, AppError> {
    probe_offline(input.trim().to_string(), request_id).await
}

#[tauri::command]
pub fn bypass_cancel_probe(request_id: String) -> Result<(), AppError> {
    bypass_probe_job::cancel(&request_id)
}

/// 把一条探过的目标加进清单（P1 只登记，写系统的是 P2）。
/// 回的是整份结论：前端刚探完就能看到判定，不用为写库再跑一次网络
#[tauri::command]
pub async fn bypass_save(state: State<'_, AppState>, input: String) -> Result<ProbeReport, AppError> {
    let _operation = mutation_guard()?;
    // 保存只使用已探测的结果；过期后回到可取消的显式探测流程。
    let input = input.trim().to_string();
    let report = report_for_save(&input)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    if report.verdict == bypass_service::Verdict::Unreachable {
        return Err(AppError::Bypass("目标不可达，请修正目标后重新探测".to_string()));
    }
    let found = db.list_bypass_targets()?.into_iter().find(|t| t.host == report.target.host);
    let mut row = target_from(&report, found.as_ref().map_or_else(now_ms, |t| t.created_at), None);
    if let Some(found) = found {
        row.id = found.id;
        row.apply_state = reconcile_apply(&found.apply_state, &found.apply_batch, report.verdict.as_str());
        row.apply_batch = found.apply_batch;
        db.update_bypass_target(&row)?;
    } else {
        db.upsert_bypass_target(&row)?;
    }
    Ok(report)
}

#[tauri::command]
pub fn bypass_list(state: State<'_, AppState>) -> Result<Vec<BypassTarget>, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_bypass_targets()
}

/// 重探一条已登记的条目，按 host 覆盖回原行（建档时间不动）
#[tauri::command]
pub async fn bypass_recheck(
    state: State<'_, AppState>,
    id: String,
    request_id: Option<String>,
) -> Result<ProbeReport, AppError> {
    let _operation = mutation_guard()?;
    let found = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::Bypass("条目不存在，可能已被删除".to_string()))?
    };
    // 按原文重探：只有 host 会把带端口/路径/掩码的目标探成默认 443
    let key = if found.input.is_empty() { found.host.clone() } else { found.input.clone() };
    let report = probe_offline(key, request_id).await?;
    // 原地重探对账配置状态并保留批次；失败或出口未知不能变成「已写入」。
    let next_state = reconcile_apply(&found.apply_state, &found.apply_batch, report.verdict.as_str());
    let mut row = target_from(&report, found.created_at, Some((&next_state, &found.apply_batch)));
    row.id = found.id;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    ensure_unchanged(&db, &row.id, &found.input)?;
    db.update_bypass_target(&row)?;
    Ok(report)
}

/// 改这条的原文（写错的域名、要换端口的 URL），按新原文重探并覆盖回原行。
/// id 与建档时间不动。
#[tauri::command]
pub async fn bypass_edit(
    state: State<'_, AppState>,
    id: String,
    input: String,
    request_id: Option<String>,
) -> Result<ProbeReport, AppError> {
    let _operation = mutation_guard()?;
    let found = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::Bypass("条目不存在，可能已被删除".to_string()))?
    };
    let report = probe_offline(input, request_id).await?;
    // 已有目标不能被重命名覆盖；更新同一 id 保证失败时原行还在。
    let renamed = found.host != report.target.host;
    // 更换目标时重新配置，同目标修改端口或路径则对账当前状态。
    let mut row = target_from(&report, found.created_at, None);
    row.id = found.id.clone();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    ensure_unchanged(&db, &found.id, &found.input)?;
    if renamed && db.list_bypass_targets()?.iter().any(|t| t.host == row.host && t.id != row.id) {
        return Err(AppError::Bypass("该目标已在清单中，请编辑已有条目".to_string()));
    }
    if !renamed {
        row.apply_state = reconcile_apply(&found.apply_state, &found.apply_batch, report.verdict.as_str());
    }
    row.apply_batch = found.apply_batch;
    db.update_bypass_target(&row)?;
    Ok(report)
}

#[tauri::command]
pub fn bypass_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    let _operation = mutation_guard()?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_bypass_target(&id)
}

/// 页面顶部的小账：hosts 托管区有几条、清单几条、其中几条等写入、几条已失效
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BypassStatus {
    /// hosts 托管区里的域名条数；托管区解析不出来时为 0，原因看 hostsError
    pub managed_hosts: usize,
    pub hosts_error: String,
    pub total: usize,
    /// 还等着写系统的条数：判定指向写 hosts/路由，且没写过或上次写失败
    pub pending: usize,
    pub stale: usize,
}

/// 这条还需不需要往系统里写。写过的必须从这里摘出去，否则「待写入」永远降不下来，
/// 那个数字就废了
pub fn needs_apply(t: &BypassTarget) -> bool {
    (t.verdict == "hostsOnly" || t.verdict == "needRoute") && t.apply_state != "applied"
}

/// 这条会不会真的进落盘批次。CDN 轮换的域名默认不钉（01 §4：钉死等于锁在会失效的节点上），
/// 除非用户在确认弹窗里显式坚持；判不出出口的那条由 netguard_service 标 blocked，同一处闸。
/// 「待写入」仍按 needs_apply 计——不落盘不等于不用管。
pub fn in_apply_batch(t: &BypassTarget, allow_cdn: &[String]) -> bool {
    needs_apply(t) && !netguard_service::cdn_gated(t, allow_cdn)
}

#[tauri::command]
pub fn bypass_status(state: State<'_, AppState>) -> Result<BypassStatus, AppError> {
    let (managed_hosts, hosts_error) = match bypass_service::read_pinned() {
        Ok(pinned) => (pinned.len(), String::new()),
        Err(msg) => (0, msg),
    };
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let targets = db.list_bypass_targets()?;
    Ok(BypassStatus {
        managed_hosts,
        hosts_error,
        total: targets.len(),
        pending: targets.iter().filter(|t| needs_apply(t)).count(),
        stale: targets.iter().filter(|t| t.stale).count(),
    })
}

/// 落盘状态与判定怎么对上。只有"写过"的条目才参与对账：
/// 只有直连可用才算复验成功；回滚干净的批次不凭空恢复为「已写入」。
fn reconcile_apply(prev_state: &str, batch: &str, verdict: &str) -> String {
    match (prev_state, verdict == "directOk") {
        ("applied", false) => "failed".to_string(),
        ("failed", true) => if batch.is_empty() { "none" } else { "applied" }.to_string(),
        (other, _) => other.to_string(),
    }
}

fn ensure_unchanged(db: &crate::db::Database, id: &str, input: &str) -> Result<(), AppError> {
    match db.bypass_target_by_id(id)? {
        Some(t) if t.input == input => Ok(()),
        _ => Err(AppError::Bypass("条目已被修改或删除，请刷新后重试".to_string())),
    }
}

/// 确认弹窗要念的账：每条将往系统里写什么，以及哪条自动判定不了
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlan {
    pub plan_key: String,
    pub rows: Vec<PlannedRow>,
    /// 可以进批次的条目数（按条目计，一条域名可能同时出 hosts 与路由两个动作）
    pub ready: usize,
    pub blocked: usize,
}

/// 落盘计划：确认弹窗与批次要念的是同一份账，两处不许各算各的。
/// allowCdn 是用户在弹窗里显式坚持要钉的 CDN 条目，回一次账就重算一次。
#[tauri::command]
pub fn bypass_plan(state: State<'_, AppState>, allow_cdn: Vec<String>, route_overrides: Option<Vec<RouteOverride>>) -> Result<ApplyPlan, AppError> {
    let targets = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
    };
    let pending: Vec<BypassTarget> = targets.iter().filter(|t| needs_apply(t)).cloned().collect();
    let (items, rows) = netguard_service::plan(&pending, &allow_cdn, &route_overrides.unwrap_or_default());
    let blocked = rows.iter().filter(|r| !r.blocked.is_empty()).map(|r| &r.id).collect::<std::collections::HashSet<_>>().len();
    let ready = items.iter().map(|i| i.id()).collect::<std::collections::HashSet<_>>().len();
    Ok(ApplyPlan { plan_key: netguard_service::plan_key(&items)?, rows, ready, blocked })
}

/// 一批落盘：一次 UAC，把待写入的 hosts 固定与持久路由一起写完。
/// 阻塞在提权进程上，所以数据库锁只在前后各拿一次，等授权期间不占锁。
#[tauri::command]
pub async fn bypass_apply(state: State<'_, AppState>, allow_cdn: Vec<String>, route_overrides: Option<Vec<RouteOverride>>, expected_plan_key: String) -> Result<ApplyOutcome, AppError> {
    let operation = mutation_guard()?;
    let pending: Vec<BypassTarget> = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .filter(|t| in_apply_batch(t, &allow_cdn))
            .collect()
    };
    if pending.is_empty() {
        return Ok(ApplyOutcome {
            batch_id: String::new(),
            cancelled: false,
            rolled_back: false,
            items: Vec::new(),
            error: String::new(),
        });
    }
    let batch = uuid::Uuid::new_v4().to_string();
    let pending_ids: Vec<String> = pending.iter().map(|t| t.id.clone()).collect();
    let worker_operation = operation.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _operation = worker_operation;
        netguard_service::apply(&pending, &allow_cdn, &route_overrides.unwrap_or_default(), &batch, &expected_plan_key)
    })
    .await
    .map_err(|e| AppError::Bypass(format!("写入任务被中断：{e}")))??;
    if outcome.cancelled {
        return Ok(outcome);
    }
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    // helper 半批必回滚：回滚干净了系统就是没写过的样子，既不留「已写入」也不留撤销的余地；
    // 只有回滚自己失败（outcome.error 非空）才把批次留着，界面才给「撤销本批」
    let keep_batch = !outcome.rolled_back || !outcome.error.is_empty();
    for id in pending_ids {
        let items: Vec<_> = outcome.items.iter().filter(|i| i.id == id).collect();
        if items.is_empty() && outcome.error.is_empty() { continue; }
        let state_name = state_after_apply(&outcome, &id);
        let batch = if keep_batch && netguard_service::rollback_exists(&outcome.batch_id) { outcome.batch_id.as_str() } else { "" };
        db.set_bypass_apply_state(&id, state_name, batch, now_ms())?;
    }
    Ok(outcome)
}

/// 按回滚点撤销一批：hosts 还原、本批加过的路由删掉
#[tauri::command]
pub async fn bypass_revert(
    state: State<'_, AppState>,
    batch: String,
) -> Result<ApplyOutcome, AppError> {
    let operation = mutation_guard()?;
    let batch = batch.trim().to_string();
    if batch.is_empty() {
        return Err(AppError::Bypass("没有可撤销的批次".to_string()));
    }
    let ids: Vec<String> = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .filter(|t| t.apply_batch == batch)
            .map(|t| t.id)
            .collect()
    };
    let revert_batch = batch.clone();
    let worker_operation = operation.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let _operation = worker_operation;
        netguard_service::revert(&revert_batch)
    })
        .await
        .map_err(|e| AppError::Bypass(format!("撤销任务被中断：{e}")))?;
    let outcome = match outcome {
        Ok(v) => v,
        Err(e) if netguard_service::is_cancelled(&e) => {
            return Ok(ApplyOutcome {
                batch_id: batch,
                cancelled: true,
                rolled_back: false,
                items: Vec::new(),
                error: String::new(),
            })
        }
        Err(e) => return Err(e),
    };
    if netguard_service::revert_succeeded(&outcome) {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        for id in &ids {
            db.set_bypass_apply_state(id, "none", "", now_ms())?;
        }
    }
    Ok(outcome)
}

/// 有没有可撤销的批次：界面据此决定「撤销上次写入」在不在位
#[tauri::command]
pub fn bypass_rollback_exists() -> Result<String, AppError> {
    Ok(netguard_service::latest_rollback())
}

fn state_after_apply(outcome: &ApplyOutcome, id: &str) -> &'static str {
    let items: Vec<_> = outcome.items.iter().filter(|i| i.id == id).collect();
    if !items.is_empty() && items.iter().all(|i| i.ok) && !outcome.rolled_back && outcome.error.is_empty() {
        "applied"
    } else {
        "failed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutation_lease_survives_navigation_and_a_cancelled_command_until_worker_finishes() {
        let command = mutation_guard().unwrap();
        assert!(mutation_guard().is_err());
        let worker = command.clone();
        drop(command);
        assert!(mutation_guard().is_err(), "dropping the command must not unlock a running helper");
        drop(worker);
        let next = mutation_guard().unwrap();
        drop(next);
        assert!(mutation_guard().is_ok());
    }

    #[test]
    fn saving_requires_a_fresh_report_and_never_starts_a_hidden_probe() {
        let key = format!("save-cache-{}.test", uuid::Uuid::new_v4());
        let report = ProbeReport {
            input: key.clone(),
            target: bypass_service::Target { kind: "domain", host: key.clone(), port: 443, path: "/".into(), scheme: "https" },
            pinned: None, local_answers: vec![], hijacked: false, real_ips: vec![], cdn_like: false,
            chosen: Some("10.0.0.2".into()), http_status: Some(200), probe_ms: Some(10), egress: None,
            verdict: bypass_service::Verdict::DirectOk, recommend: false, stale: false,
            headline: "直连已可用".into(), detail: String::new(), pending: vec![],
        };
        assert!(report_for_save(&key).is_err());
        probe_cache().lock().unwrap().insert(key.clone(), (now_ms(), report));
        assert_eq!(report_for_save(&key).unwrap().chosen.as_deref(), Some("10.0.0.2"));
        probe_cache().lock().unwrap().get_mut(&key).unwrap().0 = now_ms() - REPORT_TTL_MS;
        let error = report_for_save(&key).err().unwrap().to_string();
        assert!(error.contains("请重新探测"));
        probe_cache().lock().unwrap().remove(&key);
    }

    fn row(verdict: &str, apply_state: &str) -> BypassTarget {
        BypassTarget {
            id: "x".into(),
            host: "a.test".into(),
            input: "a.test".into(),
            kind: "domain".into(),
            port: 443,
            path: String::new(),
            scheme: "https".into(),
            address: "10.0.0.2".into(),
            interface_name: String::new(),
            next_hop: String::new(),
            verdict: verdict.into(),
            stale: false,
            cdn_like: false,
            note: String::new(),
            apply_state: apply_state.into(),
            apply_batch: String::new(),
            created_at: 0,
            updated_at: 0,
            checked_at: 0,
        }
    }

    #[test]
    fn written_rows_leave_the_pending_count() {
        assert!(needs_apply(&row("hostsOnly", "none")));
        assert!(needs_apply(&row("needRoute", "failed")));
        // 写过的必须从「待写入」里摘出去，否则那个数字永远降不下来
        assert!(!needs_apply(&row("hostsOnly", "applied")));
        assert!(!needs_apply(&row("directOk", "none")));
        assert!(!needs_apply(&row("unreachable", "none")));
    }

    #[test]
    fn cdn_rows_wait_for_explicit_consent() {
        let mut r = row("hostsOnly", "none");
        r.cdn_like = true;
        // 待写入照计，但不默认进批次——钉死一个会换节点的 IP 是负收益
        assert!(needs_apply(&r));
        assert!(!in_apply_batch(&r, &[]));
        assert!(in_apply_batch(&r, &["x".into()]));
        // 坚持也只坚持这一条，别把整份清单的 CDN 条目一起放行
        assert!(!in_apply_batch(&r, &["other".into()]));
    }

    #[test]
    fn recheck_reconciles_written_state() {
        // 写过但仍判要写 = 失败，原因要留给用户看
        assert_eq!(reconcile_apply("applied", "b1", "needRoute"), "failed");
        // 之前失败、现在不再要写 = 已了结
        assert_eq!(reconcile_apply("failed", "b1", "directOk"), "applied");
        // 从没写过的不凭空升格成「已写入」
        assert_eq!(reconcile_apply("none", "b1", "hostsOnly"), "none");
        assert_eq!(reconcile_apply("none", "b1", "directOk"), "none");
        assert_eq!(reconcile_apply("applied", "b1", "directOk"), "applied");
    }

    #[test]
    fn failed_or_unknown_probe_does_not_promote_a_failed_write() {
        assert_eq!(reconcile_apply("failed", "b1", "unreachable"), "failed");
        assert_eq!(reconcile_apply("failed", "b1", "egressUnknown"), "failed");
        assert_eq!(reconcile_apply("applied", "b1", "unreachable"), "failed");
        assert_eq!(reconcile_apply("applied", "b1", "egressUnknown"), "failed");
        assert_eq!(reconcile_apply("failed", "", "directOk"), "none");
    }

    #[test]
    fn a_target_is_successful_only_when_all_its_actions_succeed() {
        let mut outcome = ApplyOutcome {
            batch_id: "b1".into(), cancelled: false, rolled_back: false, error: String::new(),
            items: vec![
                netguard_service::ApplyItem { id: "x".into(), op: "pin".into(), ok: false, changed: false, error: "failed".into() },
                netguard_service::ApplyItem { id: "x".into(), op: "route".into(), ok: true, changed: true, error: String::new() },
            ],
        };
        assert_eq!(state_after_apply(&outcome, "x"), "failed");
        outcome.items.reverse();
        assert_eq!(state_after_apply(&outcome, "x"), "failed");
        outcome.items.iter_mut().for_each(|i| i.ok = true);
        assert_eq!(state_after_apply(&outcome, "x"), "applied");
        outcome.rolled_back = true;
        outcome.error = "rollback failed".into();
        assert_eq!(state_after_apply(&outcome, "x"), "failed");
        assert_eq!(state_after_apply(&outcome, "missing"), "failed");
    }
}
