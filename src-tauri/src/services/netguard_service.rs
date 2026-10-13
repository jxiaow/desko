//! 提权落盘的调用侧：组任务书 → `ShellExecuteExW("runas")` 拉起 helper → 等回执 → 落状态。
//!
//! 探测与判定全程静默，只有这里改系统，且一批共用一次 UAC。helper 不继承 stdio，
//! 所以任务书与回执都走 profile 目录里的 JSON 文件。
//! 设计依据 docs/design/bypass/02-netguard-apply.md。

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use netguard_core::{in_fake_ip, net, Mode, ReceiptFile, TaskFile, TaskItem, APPLY_BUDGET_MS};

use crate::db::BypassTarget;
use crate::error::AppError;

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

/// 把「待写入」条目摊成落盘计划。只读路由表，不提权。
pub fn plan(targets: &[BypassTarget], allow_cdn: &[String]) -> (Vec<TaskItem>, Vec<PlannedRow>) {
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
                blocked: "带 CDN 轮换特征，固定后会随节点变化失效；确需固定请勾选本条".to_string(),
            });
            continue;
        }
        let is_domain = t.kind == "domain";
        if is_domain {
            let action = if t.address.trim().is_empty() {
                String::new()
            } else {
                format!("hosts 固定 {} → {}", t.host, t.address)
            };
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: t.host.clone(),
                action,
                blocked: String::new(),
            });
        }
        let Some((prefix, len)) = route_prefix_of(t) else {
            if !is_domain {
                rows.push(PlannedRow {
                    id: t.id.clone(),
                    label: t.host.clone(),
                    action: String::new(),
                    blocked: "网段写法无法识别".to_string(),
                });
            }
            continue;
        };
        // hostsOnly 的域名只缺 DNS 固定，路由本来就通，不该顺手改系统路由
        if t.verdict != "needRoute" {
            continue;
        }
        let plan = net::route_plan_for(
            prefix.parse().unwrap_or(std::net::Ipv4Addr::UNSPECIFIED),
            len,
            taker_interface(&prefix),
        );
        let Some(plan) = plan else {
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: if is_domain { t.host.clone() } else { format!("{prefix}/{len}") },
                action: String::new(),
                blocked: "路由表里没有可绑定的非接管接口，需人工确认出口".to_string(),
            });
            continue;
        };
        // 网关落段校验在这里就做一遍：helper 里那道闸是兜底，不是第一次机会
        if !plan.gateway_is_on_link
            && !net::gateway_on_link(plan.interface_index, plan.gateway)
        {
            rows.push(PlannedRow {
                id: t.id.clone(),
                label: if is_domain { t.host.clone() } else { format!("{prefix}/{len}") },
                action: String::new(),
                blocked: format!(
                    "网关 {} 不在接口 {} 的网段内，绑定后不会生效",
                    plan.gateway, plan.interface_alias
                ),
            });
            continue;
        }
        let label = if is_domain { t.host.clone() } else { format!("{prefix}/{len}") };
        rows.push(PlannedRow {
            id: t.id.clone(),
            action: format!(
                "持久路由 绑 {}（接口 {}）",
                if plan.gateway_is_on_link { "链路本地".to_string() } else { plan.gateway.to_string() },
                plan.interface_alias
            ),
            label,
            blocked: String::new(),
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
    (items, rows)
}

/// 域名条目要钉 hosts 的那部分：与路由计划分开列，一条 needRoute 的域名两样都要
pub fn pins_for(targets: &[BypassTarget], allow_cdn: &[String]) -> Vec<TaskItem> {
    targets
        .iter()
        .filter(|t| t.verdict == "hostsOnly" || t.verdict == "needRoute")
        .filter(|t| !cdn_gated(t, allow_cdn))
        .filter(|t| t.kind == "domain")
        .filter(|t| !t.address.trim().is_empty())
        .map(|t| TaskItem::Pin { id: t.id.clone(), host: t.host.clone(), address: t.address.clone() })
        .collect()
}

fn write_json(path: &Path, value: &impl serde::Serialize) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::Bypass(format!("任务书序列化失败：{e}")))?;
    std::fs::write(path, bytes).map_err(|e| AppError::Bypass(format!("写入任务书失败：{e}")))
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
            items: items.iter().filter(|i| matches!(i, TaskItem::Route { .. })).cloned().collect(),
            ..task.clone()
        };
        write_json(&rollback_path(batch), &revert)?;
    }
    let receipt = match launch_and_wait(&task_file, batch) {
        // UAC 上按取消是用户的选择，不是故障：清单与批次都不动
        Err(e) if is_cancelled(&e) => {
            return Ok(ApplyOutcome {
                batch_id: batch.to_string(),
                cancelled: true,
                rolled_back: false,
                items: Vec::new(),
                error: String::new(),
            })
        }
        Err(e) => return Err(e),
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
        return Ok(ApplyOutcome {
            batch_id: batch.to_string(),
            cancelled: false,
            rolled_back: false,
            items: Vec::new(),
            error: receipt.fatal.clone(),
        });
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
pub fn apply(targets: &[BypassTarget], allow_cdn: &[String], batch: &str) -> Result<ApplyOutcome, AppError> {
    let (mut items, _) = plan(targets, allow_cdn);
    let mut pins = pins_for(targets, allow_cdn);
    pins.extend(items.drain(..));
    run_batch(pins, Mode::Apply, batch)
}

/// 撤销一批：读回滚点，按它原路退回去
pub fn revert(batch: &str) -> Result<ApplyOutcome, AppError> {
    let path = rollback_path(batch);
    let bytes = std::fs::read(&path).map_err(|_| {
        AppError::Bypass("找不到该批次的回滚点，可能已被清理".to_string())
    })?;
    let task: TaskFile = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Bypass(format!("回滚点解析失败：{e}")))?;
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
    Ok(match receipt {
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
            error: if r.rollback_error.is_empty() { r.fatal } else { r.rollback_error },
        },
        None => ApplyOutcome {
            batch_id: revert_batch,
            cancelled: false,
            rolled_back: false,
            items: Vec::new(),
            error: "撤销进程未回传结果".to_string(),
        },
    })
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
