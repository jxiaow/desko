use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::State;

use crate::db::BypassTarget;
use crate::error::AppError;
use crate::services::bypass_service::{self, ProbeReport};
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

/// 探测报告 → 清单行
fn target_from(report: &ProbeReport, created_at: i64) -> BypassTarget {
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
        note: report.headline.clone(),
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
    let row = target_from(&report, now_ms());
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
    let mut row = target_from(&report, found.created_at);
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
    let mut row = target_from(&report, found.created_at);
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
    /// 判定要写系统的条数（固定 hosts 或加路由）——写入那一步没做之前它们只在清单里
    pub pending: usize,
    pub stale: usize,
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
        pending: targets
            .iter()
            .filter(|t| t.verdict == "hostsOnly" || t.verdict == "needRoute")
            .count(),
        stale: targets.iter().filter(|t| t.stale).count(),
    })
}
