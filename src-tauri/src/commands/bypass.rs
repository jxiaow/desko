use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::State;

use crate::db::BypassTarget;
use crate::error::AppError;
use crate::services::bypass_service::{self, ProbeReport};
use crate::services::netguard_service::{self, ApplyOutcome, PlannedRow};
use crate::AppState;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 最近探过的结论缓存（原文 → 写库时刻 + 报告）。「开始探测」出结论后点「加入清单」
/// 直接落这份，不再跑第二遍网络；超过 TTL 的缓存视同没有，重探。
const REPORT_TTL_MS: i64 = 10 * 60 * 1000;

fn probe_cache() -> &'static Mutex<HashMap<String, (i64, ProbeReport)>> {
    static LAST: OnceLock<Mutex<HashMap<String, (i64, ProbeReport)>>> = OnceLock::new();
    LAST.get_or_init(Default::default)
}

/// 探测报告 → 清单行。落盘状态由调用方决定：新建档与改原文都要归回「未写入」，
/// 只有原地重探才把旧值带过来
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

async fn probe_offline(input: String) -> Result<ProbeReport, AppError> {
    let report = tauri::async_runtime::spawn_blocking(move || bypass_service::probe(&input))
        .await
        .map_err(|e| AppError::Bypass(format!("探测任务被中断：{e}")))?
        .map_err(AppError::Bypass)?;
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

/// 只探不写：给结论弹窗用
#[tauri::command]
pub async fn bypass_probe(input: String) -> Result<ProbeReport, AppError> {
    probe_offline(input.trim().to_string()).await
}

/// 把一条探过的目标加进清单（P1 只登记，写系统的是 P2）。
/// 回的是整份结论：前端刚探完就能看到判定，不用为写库再跑一次网络
#[tauri::command]
pub async fn bypass_save(state: State<'_, AppState>, input: String) -> Result<ProbeReport, AppError> {
    // 命中「开始探测」刚探过的那份就直接写库；没有或超时才补一探
    let input = input.trim().to_string();
    let report = match cached_report(&input) {
        Some(r) => r,
        None => probe_offline(input).await?,
    };
    let row = target_from(&report, now_ms(), None);
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.upsert_bypass_target(&row)?;
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
) -> Result<ProbeReport, AppError> {
    let found = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::Bypass("条目不存在，可能已被删除".to_string()))?
    };
    // 按原文重探：只有 host 会把带端口/路径/掩码的目标探成默认 443
    let key = if found.input.is_empty() { found.host.clone() } else { found.input.clone() };
    let report = probe_offline(key).await?;
    // 原地重探只改判定，不改「这批写过」：写过的条目重探若仍判要写，
    // 那个 failed 状态得留得住，否则用户看不到失败原因
    let next_state = reconcile_apply(&found.apply_state, report.verdict.as_str());
    let mut row = target_from(&report, found.created_at, Some((&next_state, &found.apply_batch)));
    row.id = found.id;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.upsert_bypass_target(&row)?;
    Ok(report)
}

/// 改这条的原文（写错的域名、要换端口的 URL），按新原文重探并覆盖回原行。
/// id 与建档时间不动。
#[tauri::command]
pub async fn bypass_edit(
    state: State<'_, AppState>,
    id: String,
    input: String,
) -> Result<ProbeReport, AppError> {
    let found = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
            .into_iter()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::Bypass("条目不存在，可能已被删除".to_string()))?
    };
    let report = probe_offline(input).await?;
    // 改成了另一个 host：旧行留着就是同一个人的两条重复。删掉，新目标按 host 归档
    let renamed = found.host != report.target.host;
    // 改了原文就是要写的东西变了，旧的落盘状态一律作废
    let mut row = target_from(&report, found.created_at, None);
    row.id = found.id.clone();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    if renamed {
        db.delete_bypass_target(&found.id)?;
    }
    db.upsert_bypass_target(&row)?;
    Ok(report)
}

#[tauri::command]
pub fn bypass_delete(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
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
/// 写过却仍判要写 = 失败（保留原因给用户看），失败后不再要写 = 已了结。
fn reconcile_apply(prev_state: &str, verdict: &str) -> String {
    let needs = verdict == "hostsOnly" || verdict == "needRoute";
    match (prev_state, needs) {
        ("applied", true) => "failed".to_string(),
        ("failed", false) => "applied".to_string(),
        (other, _) => other.to_string(),
    }
}

/// 确认弹窗要念的账：每条将往系统里写什么，以及哪条自动判定不了
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPlan {
    pub rows: Vec<PlannedRow>,
    /// 可以进批次的条目数（按条目计，一条域名可能同时出 hosts 与路由两个动作）
    pub ready: usize,
    pub blocked: usize,
}

/// 落盘计划：确认弹窗与批次要念的是同一份账，两处不许各算各的。
/// allowCdn 是用户在弹窗里显式坚持要钉的 CDN 条目，回一次账就重算一次。
#[tauri::command]
pub fn bypass_plan(state: State<'_, AppState>, allow_cdn: Vec<String>) -> Result<ApplyPlan, AppError> {
    let targets = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.list_bypass_targets()?
    };
    let pending: Vec<BypassTarget> = targets.iter().filter(|t| needs_apply(t)).cloned().collect();
    let (_, rows) = netguard_service::plan(&pending, &allow_cdn);
    let blocked = rows.iter().filter(|r| !r.blocked.is_empty()).count();
    let ready = pending
        .iter()
        .filter(|t| in_apply_batch(t, &allow_cdn))
        .filter(|t| !rows.iter().any(|r| r.id == t.id && !r.blocked.is_empty()))
        .count();
    Ok(ApplyPlan { rows, ready, blocked })
}

/// 一批落盘：一次 UAC，把待写入的 hosts 固定与持久路由一起写完。
/// 阻塞在提权进程上，所以数据库锁只在前后各拿一次，等授权期间不占锁。
#[tauri::command]
pub async fn bypass_apply(state: State<'_, AppState>, allow_cdn: Vec<String>) -> Result<ApplyOutcome, AppError> {
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
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        netguard_service::apply(&pending, &allow_cdn, &batch)
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
    for item in &outcome.items {
        // 记「已写入」与留批次是同一条判据：批次留着就说明写进去的还在系统里，
        // 这时行上念「写入失败」会和结果弹窗自己打架
        let state_name = if item.ok && keep_batch { "applied" } else { "failed" };
        let batch = if keep_batch { outcome.batch_id.as_str() } else { "" };
        db.set_bypass_apply_state(&item.id, state_name, batch, now_ms())?;
    }
    Ok(outcome)
}

/// 按回滚点撤销一批：hosts 还原、本批加过的路由删掉
#[tauri::command]
pub async fn bypass_revert(
    state: State<'_, AppState>,
    batch: String,
) -> Result<ApplyOutcome, AppError> {
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
    let outcome = tauri::async_runtime::spawn_blocking(move || netguard_service::revert(&revert_batch))
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
    if !outcome.cancelled {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        for id in &ids {
            db.set_bypass_apply_state(id, "none", "", now_ms())?;
        }
    }
    Ok(outcome)
}

/// 有没有可撤销的批次：界面据此决定「撤销上次写入」在不在位
#[tauri::command]
pub fn bypass_rollback_exists(state: State<'_, AppState>) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let found = db
        .list_bypass_targets()?
        .into_iter()
        .find(|t| !t.apply_batch.is_empty() && netguard_service::rollback_exists(&t.apply_batch));
    Ok(found.map(|t| t.apply_batch).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(reconcile_apply("applied", "needRoute"), "failed");
        // 之前失败、现在不再要写 = 已了结
        assert_eq!(reconcile_apply("failed", "directOk"), "applied");
        // 从没写过的不凭空升格成「已写入」
        assert_eq!(reconcile_apply("none", "hostsOnly"), "none");
        assert_eq!(reconcile_apply("none", "directOk"), "none");
        assert_eq!(reconcile_apply("applied", "directOk"), "applied");
    }
}
