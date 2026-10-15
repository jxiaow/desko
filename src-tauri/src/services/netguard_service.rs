//! 提权落盘的调用侧：组任务书 → `ShellExecuteExW("runas")` 拉起 helper → 等回执 → 落状态。
//!
//! 探测与判定全程静默，只有这里改系统，且一批共用一次 UAC。helper 不继承 stdio，
//! 所以任务书与回执都走 profile 目录里的 JSON 文件。
//! 设计依据 docs/design/bypass/02-netguard-apply.md。

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use netguard_core::{in_fake_ip, net, usable_v4, Mode, ReceiptFile, TaskFile, TaskItem, APPLY_BUDGET_MS};

use crate::db::BypassTarget;
use crate::error::AppError;

/// 只绑定用户确认的实际写入；候选出口顺序、接口显示名、时间戳不影响确认。
pub fn plan_key(items: &[TaskItem]) -> Result<String, AppError> {
    use sha2::{Digest, Sha256};
    let canonical: std::collections::BTreeSet<String> = items.iter().map(|item| match item {
        TaskItem::Pin { id, host, address } => serde_json::json!(["pin", id, host.to_ascii_lowercase(), address]),
        TaskItem::Route { id, prefix, prefix_len, gateway, interface_index, .. } =>
            serde_json::json!(["route", id, prefix, prefix_len, gateway, interface_index]),
    }.to_string()).collect();
    let bytes = serde_json::to_vec(&canonical).map_err(|e| AppError::Bypass(format!("配置方案无法校验：{e}")))?;
    Ok(Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect())
}

fn require_confirmed_plan(items: &[TaskItem], expected_key: &str) -> Result<(), AppError> {
    if expected_key.is_empty() || plan_key(items)? != expected_key {
        return Err(AppError::Bypass("网络或清单已变化，尚未写入更改。请重新打开“配置直连”查看最新方案".into()));
    }
    Ok(())
}

/// 回滚点：一份 mode=revert 的任务书，撤销时原样再交给 helper
fn batch_dir() -> PathBuf {
    crate::paths::profile_root()
}

fn task_path(batch: &str) -> PathBuf {
    batch_dir().join(format!("netguard-task-{batch}.json"))
}

fn receipt_path(batch: &str) -> PathBuf {
    batch_dir().join(format!("netguard-receipt-{batch}.json"))
}

fn backup_path(batch: &str) -> PathBuf {
    batch_dir().join(format!("netguard-hosts-backup-{batch}"))
}

fn rollback_path(batch: &str) -> PathBuf {
    batch_dir().join(format!("netguard-rollback-{batch}.json"))
}

/// 确认弹窗与批次要念的是同一份计划，两处不许各算各的
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRow {
    pub id: String,
    /// 目标：域名或网段
    pub label: String,
    /// 这条要往系统里写什么，人话
    pub action: String,
    /// 非空 = 这条无法自动判定，不进批次，界面就地说明原因
    pub blocked: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<PlanBlockReason>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub route_options: Vec<net::RoutePlan>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub enum PlanBlockReason {
    NoDirectRoute,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteOverride {
    pub id: String,
    pub interface_index: u32,
    pub gateway: String,
}

fn selected_route(automatic: Option<net::RoutePlan>, options: &[net::RoutePlan], choice: Option<&RouteOverride>) -> Option<net::RoutePlan> {
    match choice {
        Some(choice) => options.iter().find(|r| r.interface_index == choice.interface_index && r.gateway.to_string() == choice.gateway).cloned(),
        None => automatic,
    }
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyItem {
    pub id: String,
    pub op: String,
    pub ok: bool,
    pub changed: bool,
    pub error: String,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub batch_id: String,
    /// 用户在 UAC 上按了取消：不算失败，清单与批次都不动
    pub cancelled: bool,
    pub rolled_back: bool,
    pub items: Vec<ApplyItem>,
    /// helper 没跑起来 / 没留回执这类整批问题
    pub error: String,
}

fn helper_exe() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::Bypass(format!("无法定位自身路径：{e}")))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::Bypass("无法定位自身目录".to_string()))?;
    let candidate = dir.join(format!("desko-netguard{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(AppError::Bypass(
        "未找到直连写入程序，请重新安装后重试".to_string(),
    ))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// CDN 轮换的域名默认不进批次：钉死等于把访问锁在一个随时换节点的 IP 上，
/// 还不如让它走正常 DNS。只有用户在确认弹窗里显式坚持（把 id 交给 allow_cdn）才落盘。
pub fn cdn_gated(t: &BypassTarget, allow_cdn: &[String]) -> bool {
    t.cdn_like && !allow_cdn.iter().any(|id| *id == t.id)
}

/// 条目 → (前缀, 掩码长度)。域名取其真址 /32，网段保留原掩码。
fn route_prefix_of(t: &BypassTarget) -> Option<(String, u8)> {
    match t.kind.as_str() {
        "cidr" => {
            let (net, len) = t.host.split_once('/')?;
            let len: u8 = len.parse().ok()?;
            net.parse::<std::net::Ipv4Addr>().ok()?;
            Some((net.to_string(), len))
        }
        "ip" => Some((t.host.clone(), 32)),
        // 域名要路由的是它的真址，钉 hosts 只解决 DNS，不解决回程
        _ => t.address.parse::<std::net::Ipv4Addr>().ok().map(|_| (t.address.clone(), 32)),
    }
}

/// 接管方是哪块卡：目标当前走的路由若从 fake-IP 段出，那块卡就是要把流量抢走的一方
fn taker_interface(prefix: &str) -> Option<u32> {
    let ip: std::net::Ipv4Addr = prefix.parse().ok()?;
    let hit = net::best_route(ip)?;
    in_fake_ip(hit.source).then_some(hit.interface_index)
}

fn requires_route(verdict: &str, is_domain: bool, current_taker: Option<u32>) -> bool {
    verdict == "needRoute" || (is_domain && current_taker.is_some())
}

/// 把「待写入」条目摊成落盘计划。只读路由表，不提权。
pub fn plan(targets: &[BypassTarget], allow_cdn: &[String], route_overrides: &[RouteOverride]) -> (Vec<TaskItem>, Vec<PlannedRow>) {
    plan_with_egress(targets, allow_cdn, route_overrides, taker_interface)
}

fn plan_with_egress(
    targets: &[BypassTarget], allow_cdn: &[String], route_overrides: &[RouteOverride],
    current_taker: impl Fn(&str) -> Option<u32>,
) -> (Vec<TaskItem>, Vec<PlannedRow>) {
    let mut items = Vec::new();
    let mut rows = Vec::new();
    for t in targets {
        let needs_pin = t.verdict == "hostsOnly" || t.verdict == "needRoute";
        if !needs_pin {
            continue;
        }
        if cdn_gated(t, allow_cdn) {
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: t.host.clone(),
                action: String::new(),
                blocked: "地址可能随 CDN 节点变化，固定后可能需要更新 hosts".to_string(),
                blocked_reason: None,
                route_options: Vec::new(),
            });
            continue;
        }
        let is_domain = t.kind == "domain";
        if is_domain {
            if !t.address.parse().map(usable_v4).unwrap_or(false) {
                rows.push(PlannedRow {
                    id: t.id.clone(), label: t.host.clone(), action: String::new(),
                    blocked: "没有可固定的实际 IPv4 地址，请重新探测".to_string(),
                    blocked_reason: None,
                    route_options: Vec::new(),
                });
                continue;
            }
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: t.host.clone(),
                action: format!("hosts 固定 {} → {}", t.host, t.address),
                blocked: String::new(),
                blocked_reason: None,
                route_options: Vec::new(),
            });
            items.push(TaskItem::Pin { id: t.id.clone(), host: t.host.clone(), address: t.address.clone() });
        }
        let Some((prefix, len)) = route_prefix_of(t) else {
            if !is_domain {
                rows.push(PlannedRow {
                    id: t.id.clone(),
                    label: t.host.clone(),
                    action: String::new(),
                    blocked: "网段写法无法识别".to_string(),
                    blocked_reason: None,
                    route_options: Vec::new(),
                });
            }
            continue;
        };
        // 网络可能在探测后变化。hostsOnly 也要读取当前出口，不能沿用过期结论漏配路由。
        let taker = current_taker(&prefix);
        if !requires_route(t.verdict.as_str(), is_domain, taker) { continue; }
        let (automatic, route_options) = net::route_choices_for(
            prefix.parse().unwrap_or(std::net::Ipv4Addr::UNSPECIFIED), len, taker,
        );
        let selected = route_overrides.iter().find(|r| r.id == t.id);
        // 只能使用本次从系统读出的可用出口；前端传来的接口/网关不是信任边界。
        let plan = selected_route(automatic, &route_options, selected);
        let Some(plan) = plan else {
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: if is_domain { t.host.clone() } else { format!("{prefix}/{len}") },
                action: String::new(),
                blocked: if selected.is_some() { "所选出口已不可用，请重新选择".to_string() }
                    else if !route_options.is_empty() { format!("无法自动确定到 {prefix}/{len} 的出口，请选择可访问该地址的网络") }
                    else { format!("未找到通往 {prefix}/{len} 的可用直连出口，请检查网络连接") },
                blocked_reason: Some(PlanBlockReason::NoDirectRoute),
                route_options,
            });
            continue;
        };
        // 网关落段校验在这里就做一遍：helper 里那道闸是兜底，不是第一次机会
        if !net::route_binding_valid(prefix.parse().unwrap_or(std::net::Ipv4Addr::UNSPECIFIED), len, plan.gateway, plan.interface_index) {
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: if is_domain { t.host.clone() } else { format!("{prefix}/{len}") },
                action: String::new(),
                blocked: format!(
                    "网关 {} 不在接口 {} 的网段内，绑定后不会生效",
                    plan.gateway, plan.interface_alias
                ),
                blocked_reason: None,
                route_options: Vec::new(),
            });
            continue;
        }
        let label = if is_domain { t.host.clone() } else { format!("{prefix}/{len}") };
        rows.push(PlannedRow {
            id: t.id.clone(),
            action: format!(
                "持久路由 绑 {}（接口 {}）",
                if plan.gateway_is_on_link { "同网段直连（无网关）".to_string() } else { plan.gateway.to_string() },
                plan.interface_alias
            ),
            label,
            blocked: String::new(),
            blocked_reason: None,
            route_options,
        });
        items.push(TaskItem::Route {
            id: t.id.clone(),
            prefix,
            prefix_len: len,
            gateway: plan.gateway.to_string(),
            interface_index: plan.interface_index,
            interface_alias: plan.interface_alias,
        });
    }
    filter_blocked_items(&mut items, &rows);
    let blocked_ids: std::collections::HashSet<String> = rows.iter().filter(|r| !r.blocked.is_empty()).map(|r| r.id.clone()).collect();
    rows.retain(|r| r.action.is_empty() || !blocked_ids.contains(&r.id));
    (items, rows)
}

// 一条目标的 DNS 与路由必须一起就绪，不能把标为不写入的目标拆开写半条。
fn filter_blocked_items(items: &mut Vec<TaskItem>, rows: &[PlannedRow]) {
    items.retain(|item| !rows.iter().any(|r| r.id == item.id() && !r.blocked.is_empty()));
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::Bypass(format!("任务书序列化失败：{e}")))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| AppError::Bypass(format!("写入任务书失败：{e}")))?;
    std::fs::rename(&tmp, path).map_err(|e| AppError::Bypass(format!("替换任务书失败：{e}")))
}

fn read_receipt(path: &Path) -> Option<ReceiptFile> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// 提权跑一批。阻塞到 helper 退出或超预算，调用方必须在 spawn_blocking 里跑，
/// 且不得持着数据库锁——等 UAC 可以是分钟级。
fn run_batch(items: Vec<TaskItem>, mode: Mode, batch: &str) -> Result<ApplyOutcome, AppError> {
    let hosts = netguard_core::hosts_path();
    let task = TaskFile {
        batch_id: batch.to_string(),
        mode,
        created_at: now_ms(),
        hosts_path: hosts.to_string_lossy().into_owned(),
        receipt_path: receipt_path(batch).to_string_lossy().into_owned(),
        hosts_backup_path: backup_path(batch).to_string_lossy().into_owned(),
        items: items.clone(),
    };
    let task_file = task_path(batch);
    write_json(&task_file, &task)?;
    // 回滚点先落盘：哪怕 helper 被用户关掉，撤销仍有据可查
    if mode == Mode::Apply {
        let revert = TaskFile {
            mode: Mode::Revert,
            receipt_path: receipt_path(&format!("{batch}-revert")).to_string_lossy().into_owned(),
            items: items.iter().filter(|i| match i {
                TaskItem::Route { prefix, prefix_len, gateway, interface_index, .. } => {
                    let dest = prefix.parse().ok();
                    let via = gateway.parse().ok();
                    !matches!((dest, via), (Some(dest), Some(via)) if net::forward_exists(dest, *prefix_len, via, *interface_index))
                }
                _ => false,
            }).cloned().collect(),
            ..task.clone()
        };
        write_json(&rollback_path(batch), &revert)?;
    }
    let receipt = match launch_and_wait(&task_file, batch) {
        // UAC 上按取消是用户的选择，不是故障：清单与批次都不动
        Err(e) if is_cancelled(&e) => {
            let _ = std::fs::remove_file(rollback_path(batch));
            return Ok(ApplyOutcome {
                batch_id: batch.to_string(),
                cancelled: true,
                rolled_back: false,
                items: Vec::new(),
                error: String::new(),
            })
        }
        Err(e) => {
            let _ = std::fs::remove_file(rollback_path(batch));
            return Err(e);
        }
        Ok(r) => r,
    };
    let receipt = match receipt {
        Some(r) => r,
        None => {
            return Ok(ApplyOutcome {
                batch_id: batch.to_string(),
                cancelled: false,
                rolled_back: false,
                items: Vec::new(),
                error: "提权进程未回传结果，系统状态未知，请重新探测后再试".to_string(),
            })
        }
    };
    if !receipt.fatal.is_empty() {
        let _ = std::fs::remove_file(rollback_path(batch));
        return Ok(ApplyOutcome {
            batch_id: batch.to_string(),
            cancelled: false,
            rolled_back: false,
            items: Vec::new(),
            error: receipt.fatal.clone(),
        });
    }
    // 只留下真正改过的操作；撤销不能删除原本就存在的路由。
    if mode == Mode::Apply {
        if (receipt.rolled_back && receipt.rollback_error.is_empty())
            || (!receipt.hosts_written && !receipt.items.iter().any(|i| i.changed)) {
            let _ = std::fs::remove_file(rollback_path(batch));
        } else {
            write_json(&rollback_path(batch), &rollback_task(&task, &receipt))?;
        }
    }
    Ok(ApplyOutcome {
        batch_id: batch.to_string(),
        cancelled: false,
        rolled_back: receipt.rolled_back,
        items: receipt
            .items
            .iter()
            .map(|i| ApplyItem {
                id: i.id.clone(),
                op: i.op.clone(),
                ok: i.ok,
                changed: i.changed,
                error: i.error.clone(),
            })
            .collect(),
        error: receipt.rollback_error.clone(),
    })
}

/// 拉起提权进程并等它写完回执
fn launch_and_wait(task_file: &Path, batch: &str) -> Result<Option<ReceiptFile>, AppError> {
    let exe = helper_exe()?;
    let receipt = receipt_path(batch);
    let _ = std::fs::remove_file(&receipt);
    #[cfg(windows)]
    let started = launch_elevated(&exe, &task_file.to_string_lossy())?;
    #[cfg(not(windows))]
    let started = 0isize;

    if started == 0 {
        return Ok(None);
    }
    wait_and_collect(started, &receipt)
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}

#[cfg(windows)]
fn launch_elevated(exe: &Path, task_arg: &str) -> Result<isize, AppError> {
    use std::mem::size_of;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
    use windows::core::PCWSTR;

    let file = to_wide(&exe.to_string_lossy());
    // 参数只有任务书路径；引号包住，profile 目录带空格是常事
    let params = to_wide(&format!("\"{task_arg}\""));
    let verb = to_wide("runas");
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: HWND::default(),
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) => Ok(info.hProcess.0 as isize),
        Err(e) => {
            // 1223 = ERROR_CANCELLED：用户在 UAC 上按了取消，这不是故障
            let code = e.code().0 as u32 & 0xFFFF;
            if code == 1223 {
                return Err(AppError::Bypass("__cancelled__".to_string()));
            }
            Err(AppError::Bypass(format!("无法请求管理员权限：{e}")))
        }
    }
}

#[cfg(windows)]
fn wait_and_collect(handle: isize, receipt: &Path) -> Result<Option<ReceiptFile>, AppError> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Threading::WaitForSingleObject;
    let handle = HANDLE(handle as *mut core::ffi::c_void);
    let deadline = Instant::now() + Duration::from_millis(APPLY_BUDGET_MS as u64);
    loop {
        // 1 秒一跳：既能让「等待授权」的界面有反馈，也不错过回执落盘
        let waited = unsafe { WaitForSingleObject(handle, 1000) };
        if std::fs::metadata(receipt).is_ok() {
            break;
        }
        if waited.0 == 0 {
            // 进程已退出：回执可能刚写完，给它一次读到的机会
            break;
        }
        if Instant::now() >= deadline {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Ok(None);
        }
    }
    unsafe {
        let _ = CloseHandle(handle);
    }
    Ok(read_receipt(receipt))
}

#[cfg(not(windows))]
fn wait_and_collect(_handle: isize, _receipt: &Path) -> Result<Option<ReceiptFile>, AppError> {
    Ok(None)
}

/// 写入一批：任务书 = hosts 固定 + 路由绑定，一次 UAC 落完
pub fn apply(targets: &[BypassTarget], allow_cdn: &[String], route_overrides: &[RouteOverride], batch: &str, expected_plan_key: &str) -> Result<ApplyOutcome, AppError> {
    let (items, _) = plan(targets, allow_cdn, route_overrides);
    require_confirmed_plan(&items, expected_plan_key)?;
    if items.is_empty() {
        return Ok(ApplyOutcome { batch_id: String::new(), cancelled: false, rolled_back: false, items: Vec::new(), error: String::new() });
    }
    run_batch(items, Mode::Apply, batch)
}

/// 撤销一批：读回滚点，按它原路退回去
pub fn revert(batch: &str) -> Result<ApplyOutcome, AppError> {
    if uuid::Uuid::parse_str(batch).is_err() {
        return Err(AppError::Bypass("撤销批次格式不合法".to_string()));
    }
    if latest_rollback() != batch {
        return Err(AppError::Bypass("请先撤销最新的写入批次，再撤销较早的批次".to_string()));
    }
    let path = rollback_path(batch);
    let bytes = std::fs::read(&path).map_err(|_| {
        AppError::Bypass("找不到该批次的回滚点，可能已被清理".to_string())
    })?;
    let task: TaskFile = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Bypass(format!("回滚点解析失败：{e}")))?;
    let checkpoint = task.clone();
    let revert_batch = format!("{batch}-revert");
    let hosts = netguard_core::hosts_path();
    let task = TaskFile {
        batch_id: revert_batch.clone(),
        mode: Mode::Revert,
        created_at: now_ms(),
        hosts_path: hosts.to_string_lossy().into_owned(),
        receipt_path: receipt_path(&revert_batch).to_string_lossy().into_owned(),
        hosts_backup_path: task.hosts_backup_path.clone(),
        items: task.items.clone(),
    };
    let task_file = task_path(&revert_batch);
    write_json(&task_file, &task)?;
    let receipt = launch_and_wait(&task_file, &revert_batch)?;
    if let Some(receipt) = &receipt {
        if !receipt.rollback_error.is_empty() || receipt.items.iter().any(|i| !i.ok) {
            write_json(&path, &pending_revert_task(&checkpoint, receipt))?;
        }
    }
    let outcome = match receipt {
        Some(r) => ApplyOutcome {
            batch_id: revert_batch,
            cancelled: false,
            rolled_back: true,
            items: r
                .items
                .iter()
                .map(|i| ApplyItem {
                    id: i.id.clone(),
                    op: i.op.clone(),
                    ok: i.ok,
                    changed: i.changed,
                    error: i.error.clone(),
                })
                .collect(),
            error: [r.fatal, r.rollback_error, r.items.iter().filter(|i| !i.ok).map(|i| i.error.clone()).collect::<Vec<_>>().join("；")]
                .into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("；"),
        },
        None => ApplyOutcome {
            batch_id: revert_batch,
            cancelled: false,
            rolled_back: false,
            items: Vec::new(),
            error: "撤销进程未回传结果".to_string(),
        },
    };
    if revert_succeeded(&outcome) {
        std::fs::remove_file(&path).map_err(|e| AppError::Bypass(format!("撤销已完成，但清理回滚点失败：{e}")))?;
    }
    Ok(outcome)
}

pub fn revert_succeeded(outcome: &ApplyOutcome) -> bool {
    !outcome.cancelled && outcome.rolled_back && outcome.error.is_empty() && outcome.items.iter().all(|i| i.ok)
}

fn rollback_task(task: &TaskFile, receipt: &ReceiptFile) -> TaskFile {
    TaskFile {
        mode: Mode::Revert,
        hosts_backup_path: if receipt.hosts_written && !receipt.hosts_restored { task.hosts_backup_path.clone() } else { String::new() },
        items: task.items.iter().filter(|item| matches!(item, TaskItem::Route { .. })
            && !receipt.reverted_routes.iter().any(|id| id == item.id())
            && receipt.items.iter().any(|r| r.id == item.id() && r.op == item.op_name() && r.changed)).cloned().collect(),
        ..task.clone()
    }
}

fn pending_revert_task(task: &TaskFile, receipt: &ReceiptFile) -> TaskFile {
    TaskFile {
        hosts_backup_path: if receipt.hosts_written { String::new() } else { task.hosts_backup_path.clone() },
        items: task.items.iter().filter(|item| !receipt.items.iter().any(|r| r.id == item.id() && r.op == item.op_name() && r.ok)).cloned().collect(),
        ..task.clone()
    }
}

/// 回滚入口来自文件，移除清单记录或重新探测都不能丢掉它。按写入时间撤销最新批次。
pub fn latest_rollback() -> String {
    latest_rollback_in(&batch_dir())
}

fn latest_rollback_in(dir: &Path) -> String {
    std::fs::read_dir(dir).ok().into_iter().flatten().filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("netguard-rollback-"))
        .filter_map(|entry| serde_json::from_slice::<TaskFile>(&std::fs::read(entry.path()).ok()?).ok())
        .filter(|task| task.mode == Mode::Revert && uuid::Uuid::parse_str(&task.batch_id).is_ok())
        .max_by_key(|task| task.created_at).map(|task| task.batch_id).unwrap_or_default()
}

/// 有没有可撤销的批次：界面据此决定「撤销上次写入」在不在位
pub fn rollback_exists(batch: &str) -> bool {
    !batch.is_empty() && rollback_path(batch).exists()
}

/// UAC 取消的哨兵值：命令层把它翻译成「已取消」而不是错误
pub const CANCELLED: &str = "__cancelled__";

pub fn is_cancelled(err: &AppError) -> bool {
    matches!(err, AppError::Bypass(m) if m == CANCELLED)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(id: &str) -> TaskItem {
        TaskItem::Pin { id: id.into(), host: format!("{id}.example.com"), address: "10.0.0.1".into() }
    }

    fn route(id: &str) -> TaskItem {
        TaskItem::Route { id: id.into(), prefix: "10.0.0.1".into(), prefix_len: 32,
            gateway: "192.168.1.1".into(), interface_index: 1, interface_alias: "以太网".into() }
    }

    fn task() -> TaskFile {
        TaskFile { batch_id: uuid::Uuid::new_v4().to_string(), mode: Mode::Apply, created_at: 10,
            hosts_path: "hosts".into(), receipt_path: "receipt".into(), hosts_backup_path: "backup".into(),
            items: vec![pin("domain"), route("existing"), route("new"), route("unverified")] }
    }

    #[test]
    fn dns_only_probe_is_not_trusted_after_the_network_switches_to_a_proxy() {
        assert!(!requires_route("hostsOnly", true, None));
        assert!(requires_route("hostsOnly", true, Some(7)));
        assert!(requires_route("needRoute", true, None));
    }

    #[test]
    fn confirmed_plan_survives_order_and_display_changes_but_rejects_changed_writes() {
        let items = vec![pin("domain"), route("route")];
        let key = plan_key(&items).unwrap();
        let mut reordered = items.clone();
        reordered.reverse();
        if let TaskItem::Route { interface_alias, .. } = &mut reordered[0] { *interface_alias = "renamed adapter".into(); }
        require_confirmed_plan(&reordered, &key).unwrap();
        for change in 0..5 {
            let mut changed = items.clone();
            match change {
                0 => if let TaskItem::Pin { address, .. } = &mut changed[0] { *address = "10.0.0.2".into(); },
                1 => if let TaskItem::Route { interface_index, .. } = &mut changed[1] { *interface_index = 2; },
                2 => if let TaskItem::Route { gateway, .. } = &mut changed[1] { *gateway = "192.168.2.1".into(); },
                3 => { changed.pop(); },
                _ => { changed.push(pin("new-target")); },
            }
            assert!(require_confirmed_plan(&changed, &key).is_err(), "change {change}");
        }
        assert!(require_confirmed_plan(&items, "").is_err());
    }

    #[test]
    fn blocked_domain_does_not_write_its_hosts_half() {
        let mut items = vec![pin("blocked"), route("blocked"), pin("ready")];
        let rows = vec![PlannedRow { id: "blocked".into(), label: "blocked.example.com".into(), action: String::new(), blocked: "出口未确定".into(), blocked_reason: Some(PlanBlockReason::NoDirectRoute), route_options: Vec::new() }];
        filter_blocked_items(&mut items, &rows);
        assert_eq!(items, vec![pin("ready")]);
    }

    #[test]
    fn manual_route_must_match_a_current_option_and_never_falls_back_silently() {
        let route = net::RoutePlan { interface_index: 16, interface_alias: "VPN".into(), gateway: "26.0.48.1".parse().unwrap(), gateway_is_on_link: false };
        let choice = RouteOverride { id: "target".into(), interface_index: 16, gateway: "26.0.48.1".into() };
        assert_eq!(selected_route(None, &[route.clone()], Some(&choice)), Some(route.clone()));
        assert!(selected_route(Some(route.clone()), &[], Some(&choice)).is_none());
        assert!(selected_route(Some(route.clone()), &[route.clone()], Some(&RouteOverride { interface_index: 7, ..choice.clone() })).is_none());
        assert!(selected_route(Some(route.clone()), &[route.clone()], Some(&RouteOverride { gateway: "198.18.0.2".into(), ..choice })).is_none());
        assert_eq!(selected_route(Some(route.clone()), &[route.clone()], None), Some(route));
    }

    #[test]
    fn missing_and_fake_ip_addresses_are_blocked_before_elevation() {
        let t = BypassTarget {
            id: "x".into(), host: "a.example.com".into(), input: "a.example.com".into(), kind: "domain".into(),
            port: 443, path: String::new(), scheme: "https".into(), address: String::new(),
            interface_name: String::new(), next_hop: String::new(), verdict: "hostsOnly".into(), stale: false,
            cdn_like: false, note: String::new(), apply_state: "none".into(), apply_batch: String::new(),
            created_at: 0, updated_at: 0, checked_at: 0,
        };
        for address in ["", "198.18.0.2", "127.0.0.1", "not-an-ip"] {
            let (items, rows) = plan_with_egress(&[BypassTarget { address: address.into(), ..t.clone() }], &[], &[], |_| None);
            assert!(items.is_empty());
            assert_eq!(rows.len(), 1);
            assert!(!rows[0].blocked.is_empty());
        }
        let ready = BypassTarget { address: "10.0.0.1".into(), ..t };
        let (items, rows) = plan_with_egress(&[ready], &[], &[], |_| None);
        assert_eq!(items.len(), 1);
        assert!(rows[0].blocked.is_empty());
    }

    #[test]
    fn rollback_only_deletes_changed_routes_including_failed_verification() {
        let task = task();
        let receipt = ReceiptFile { hosts_written: false, items: vec![
            netguard_core::ItemResult { id: "existing".into(), op: "route".into(), ok: true, changed: false, error: String::new() },
            netguard_core::ItemResult { id: "new".into(), op: "route".into(), ok: true, changed: true, error: String::new() },
            netguard_core::ItemResult { id: "unverified".into(), op: "route".into(), ok: false, changed: true, error: "查表失败".into() },
        ], ..Default::default() };
        let rollback = rollback_task(&task, &receipt);
        assert_eq!(rollback.items, vec![route("new"), route("unverified")]);
        assert!(rollback.hosts_backup_path.is_empty());
        let with_hosts = rollback_task(&task, &ReceiptFile { hosts_written: true, ..receipt });
        assert_eq!(with_hosts.hosts_backup_path, "backup");
    }

    #[test]
    fn retrying_partial_rollback_only_retries_the_remaining_changes() {
        let task = task();
        let receipt = ReceiptFile { hosts_written: true, hosts_restored: true, rolled_back: true,
            reverted_routes: vec!["new".into()], items: vec![
                netguard_core::ItemResult { id: "new".into(), op: "route".into(), ok: true, changed: true, error: String::new() },
                netguard_core::ItemResult { id: "unverified".into(), op: "route".into(), ok: false, changed: true, error: "校验失败".into() },
            ], ..Default::default() };
        let rollback = rollback_task(&task, &receipt);
        assert!(rollback.hosts_backup_path.is_empty());
        assert_eq!(rollback.items, vec![route("unverified")]);
        let manual = ReceiptFile { hosts_written: true, items: vec![
            netguard_core::ItemResult { id: "new".into(), op: "route".into(), ok: true, changed: true, error: String::new() },
            netguard_core::ItemResult { id: "unverified".into(), op: "route".into(), ok: false, changed: false, error: "删除失败".into() },
        ], ..Default::default() };
        let checkpoint = pending_revert_task(&TaskFile { items: vec![route("new"), route("unverified")], mode: Mode::Revert, ..task }, &manual);
        assert_eq!(checkpoint.items, vec![route("unverified")]);
        assert!(checkpoint.hosts_backup_path.is_empty());
        assert_eq!(checkpoint.created_at, 10);
    }

    #[test]
    fn revoke_is_not_successful_with_errors_cancellation_or_missing_receipt() {
        let mut outcome = ApplyOutcome { batch_id: "b1".into(), cancelled: false, rolled_back: true, error: String::new(), items: Vec::new() };
        assert!(revert_succeeded(&outcome));
        outcome.items.push(ApplyItem { id: "x".into(), op: "route".into(), ok: false, changed: false, error: "删除失败".into() });
        assert!(!revert_succeeded(&outcome));
        outcome.items.clear();
        outcome.error = "缺少备份".into();
        assert!(!revert_succeeded(&outcome));
        outcome.error.clear();
        outcome.cancelled = true;
        assert!(!revert_succeeded(&outcome));
        outcome.cancelled = false;
        outcome.rolled_back = false;
        assert!(!revert_succeeded(&outcome));
    }

    #[test]
    fn rollback_discovery_uses_batch_time_and_survives_removed_catalog_rows() {
        let dir = std::env::temp_dir().join(format!("desko-bypass-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut old = task(); old.mode = Mode::Revert;
        let mut new = task(); new.mode = Mode::Revert; new.created_at = 20;
        write_json(&dir.join(format!("netguard-rollback-{}.json", new.batch_id)), &new).unwrap();
        write_json(&dir.join(format!("netguard-rollback-{}.json", old.batch_id)), &old).unwrap();
        std::fs::write(dir.join("netguard-rollback-broken.json"), b"broken").unwrap();
        assert_eq!(latest_rollback_in(&dir), new.batch_id);
        std::fs::remove_file(dir.join(format!("netguard-rollback-{}.json", new.batch_id))).unwrap();
        assert_eq!(latest_rollback_in(&dir), old.batch_id);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
