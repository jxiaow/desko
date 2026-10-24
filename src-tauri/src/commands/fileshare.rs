//! 局域网文件传输的命令层：只做进程管理、文件协议与桌面拖入落盘，HTTP 逻辑全在 desko-fileshare 子进程。
//! 主程序 ⇄ 服务进程通过两个 JSON 文件通信：
//!   fileshare.json        配置真相（本模块写；服务进程轮询热加载，/settings 也回写它）
//!   fileshare.status.json 运行状态（服务进程写；本模块读，pid 用于甄别陈旧状态件）
//! 进程失联兜底：子进程带 --parent/--parent-name 看门狗，主程序被强杀时自行退出。
//! 起停/保存这类要等子进程回话的命令一律 async：同步命令跑在主线程，
//! sleep 轮询会冻结窗口消息泵（Tauri v2 语义）。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Deserialize;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use fileshare_core::config::{self, PublicPolicy, ShareConfig};
use fileshare_core::files::{claim_available_name, sanitize_upload_name};

use crate::error::AppError;
use crate::AppState;

const CONFIG_FILE: &str = "fileshare.json";
const STATUS_FILE: &str = "fileshare.status.json";
const META_ENABLED: &str = "fileshare_enabled";
/// 桌面拖入的单文件上限，与网页端 `POST /upload` 的 4 GiB 同档
const MAX_IMPORT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
// 进程化之前的旧 meta 键，仅作一次性迁移读取
const META_LEGACY_PORT: &str = "fileshare_port";
const META_LEGACY_DIRS: &str = "fileshare_share_dirs";
const META_LEGACY_PASSWORD: &str = "fileshare_password";
const META_LEGACY_LOCAL: &str = "fileshare_local_only";

pub struct ProcState {
    pub child: Mutex<Option<Child>>,
}

impl Default for ProcState {
    fn default() -> Self {
        ProcState { child: Mutex::new(None) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    pub running: bool,
    pub configured_port: u16,
    pub bound_port: Option<u16>,
    pub local_url: String,
    pub lan_url: String,
    pub share_count: usize,
    pub local_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    pub port: u16,
    pub share_dirs: Vec<String>,
    pub local_only: bool,
    pub has_password: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFile {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub stored: Vec<StoredFile>,
    /// 每个未落盘的文件一条中文原因，前端逐条呈现，不静默丢
    pub failed: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusFile {
    pid: u32,
    configured_port: u16,
    bound_port: u16,
    lan_ip: String,
    local_only: bool,
    share_count: usize,
}

// ── 路径与进程 ───────────────────────────────────────────────

/// 配置/状态文件随当前档案根（多档案 D1）；`app` 形参保留仅为调用点不变。
/// fileshare.json 只落本机、不进备份包。老布局下指向 `%APPDATA%\desko\shared` 的默认目录
/// 由一次性迁移改写成相对锚点 "shared"（见 profile_service::rewrite_fileshare_share_dirs），
/// 之后按档案根解析，天然随档案切换走。
fn app_data_dir(_app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(crate::paths::profile_root())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_dir(app)?.join(CONFIG_FILE))
}

fn status_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app_data_dir(app)?.join(STATUS_FILE))
}

/// 服务二进制位置：与主程序同目录（打包后 externalBin 落在这里，dev 时同步脚本拷过来）
fn server_exe() -> Result<PathBuf, AppError> {
    let exe = std::env::current_exe()
        .map_err(|e| AppError::FileShare(format!("无法定位自身路径: {}", e)))?;
    let dir = exe.parent().ok_or_else(|| AppError::FileShare("无法定位自身目录".to_string()))?;
    let candidate = dir.join(format!("desko-fileshare{}", std::env::consts::EXE_SUFFIX));
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(AppError::FileShare(
        "未找到局域网传输服务程序，请重新安装后重试".to_string(),
    ))
}

fn child_running(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.fileshare.child.lock() else { return false };
    reap_if_dead(&mut guard)
}

/// 持锁判断子进程是否仍存活；已退出则回收并清空
fn reap_if_dead(guard: &mut Option<Child>) -> bool {
    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(None) => true,
            _ => {
                *guard = None;
                false
            }
        },
        None => false,
    }
}

fn spawn_service(app: &AppHandle) -> Result<u32, AppError> {
    let exe = server_exe()?;
    let cfg = config_path(app)?;
    let status = status_path(app)?;
    let parent_name = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let mut command = Command::new(&exe);
    command
        .arg("--config").arg(&cfg)
        .arg("--status").arg(&status)
        .arg("--parent").arg(std::process::id().to_string())
        .arg("--parent-name").arg(&parent_name)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command
        .spawn()
        .map_err(|e| AppError::FileShare(format!("启动服务进程失败: {}", e)))?;
    let pid = child.id();
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.fileshare.child.lock() {
        *guard = Some(child);
    }
    Ok(pid)
}

fn kill_service(app: &AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut guard) = state.fileshare.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(path) = status_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn read_status_file(app: &AppHandle) -> Option<StatusFile> {
    let path = status_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// 只认本次子进程 pid 写的状态件：上一会话残留的文件不能算启动成功
fn wait_for_status(app: &AppHandle, expect_pid: u32, timeout_ms: u64) -> Option<StatusFile> {
    let step = 150;
    let mut waited = 0;
    while waited < timeout_ms {
        if let Some(s) = read_status_file(app) {
            if s.pid == expect_pid {
                return Some(s);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(step));
        waited += step;
    }
    None
}

// ── 配置读写与旧数据迁移 ────────────────────────────────────

fn set_enabled(app: &AppHandle, on: bool) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.set_meta(META_ENABLED, if on { "true" } else { "false" })
}

/// 读配置；文件缺失时从旧 meta 键迁移（进程化之前的存量用户），再兜底默认目录。
/// 文件损坏时改名留档后重建，页面不至于永久卡死。
fn ensure_config(app: &AppHandle) -> Result<ShareConfig, AppError> {
    let path = config_path(app)?;
    let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();
    match config::load_file(&path) {
        Ok(Some(cfg)) => return Ok(cfg),
        Ok(None) => {}
        Err(e) => {
            let stamp = std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .map(|d| d.as_millis())
                .unwrap_or(0);
            let backup = path.with_extension(format!("json.bad-{}", stamp));
            eprintln!("[fileshare] 配置损坏，留档到 {} 后重建: {}", backup.display(), e);
            let _ = std::fs::rename(&path, &backup);
        }
    }
    let mut cfg = ShareConfig::default();
    {
        let state = app.state::<AppState>();
        let db_lock = state.db.lock();
        match db_lock {
            Ok(db) => {
            if let Some(v) = db.get_meta(META_LEGACY_PORT).ok().flatten().filter(|v| !v.is_empty()) {
                cfg.port = v.parse().unwrap_or(config::DEFAULT_PORT);
            }
            if let Some(v) = db.get_meta(META_LEGACY_DIRS).ok().flatten().filter(|v| !v.is_empty()) {
                if let Ok(list) = serde_json::from_str::<Vec<String>>(&v) {
                    cfg.share_dirs = config::normalize_share_dirs(&list, &dir);
                }
            }
            if let Some(v) = db.get_meta(META_LEGACY_PASSWORD).ok().flatten().filter(|v| !v.is_empty()) {
                cfg.password_sha256 = Some(v);
            }
            if db.get_meta(META_LEGACY_LOCAL).ok().flatten().as_deref() == Some("true") {
                cfg.local_only = true;
            }
            }
            Err(_) => {}
        }
    }
    if cfg.share_dirs.is_empty() {
        cfg.share_dirs = vec![dir.join("shared")];
    }
    // 文件刚诞生就带上当前公网投影：否则"先挂穿透、后启传输"这个次序会让服务进程
    // 读到一份空 public，界面上说好的口令与只读一条也没生效
    cfg.public = crate::commands::tunnel::public_projection(app);
    config::ensure_dirs_exist(&cfg.share_dirs).map_err(AppError::FileShare)?;
    config::save_file(&path, &cfg).map_err(AppError::FileShare)?;
    Ok(cfg)
}

/// 公网策略下发：只动 `public` 这一片，共享目录与局域网口令由各自的路径负责，这里不吞。
/// 服务进程 400ms 轮询配置，改完不用重启。
///
/// 配置文件还没落地时直接跳过：凭空建一份 `shareDirs` 为空的配置会让服务进程拒绝启动
/// （"尚未配置共享目录"），而穿透页不该有这种副作用。局域网传输第一次真正确起来时
/// `start_inner` 会补投影，两边读到的是同一张服务表。
pub fn write_public_policies(app: &AppHandle, policies: Vec<PublicPolicy>) -> Result<(), AppError> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(());
    }
    config::update_file(&path, &ShareConfig::default(), |c| c.public = policies)
        .map_err(AppError::FileShare)?;
    Ok(())
}

fn build_status(running: bool, cfg: &ShareConfig, sf: Option<&StatusFile>) -> StatusDto {
    let (bound, lan_ip, local_only, share_count, configured) = match sf {
        Some(s) => (
            Some(s.bound_port),
            s.lan_ip.clone(),
            s.local_only,
            s.share_count,
            s.configured_port,
        ),
        None => (
            None,
            if cfg.local_only { "127.0.0.1".to_string() } else { "—".to_string() },
            cfg.local_only,
            cfg.share_dirs.len(),
            cfg.effective_port(),
        ),
    };
    let shown_port = bound.unwrap_or(configured);
    StatusDto {
        running,
        configured_port: configured,
        bound_port: bound,
        local_url: format!("http://127.0.0.1:{}", shown_port),
        lan_url: format!("http://{}:{}", lan_ip, shown_port),
        share_count,
        local_only,
    }
}

// ── 命令（invoke 参数与前端约定不变）───────────────────────

fn status_inner(app: &AppHandle) -> StatusDto {
    let cfg = read_config_or_default(app);
    let running = child_running(app);
    let sf = if running { read_status_file(app) } else { None };
    build_status(running, &cfg, sf.as_ref())
}

fn read_config_or_default(app: &AppHandle) -> ShareConfig {
    match config_path(app).ok().as_ref().and_then(|p| config::load_file(p).ok().flatten()) {
        Some(c) => c,
        None => ShareConfig::default(),
    }
}

fn start_inner(app: &AppHandle) -> Result<StatusDto, AppError> {
    let _cfg = ensure_config(app)?;
    if child_running(app) {
        return Ok(status_inner(app));
    }
    // 先清残留状态件（上次会话崩溃留下的），再按 pid 认件，双保险
    if let Ok(path) = status_path(app) {
        let _ = std::fs::remove_file(path);
    }
    let pid = spawn_service(app)?;
    // 等服务进程写状态文件（bind 成功才写）；bind 失败时子进程自行退出
    match wait_for_status(app, pid, 5000) {
        Some(_) => {
            let died = {
                let state = app.state::<AppState>();
                let Ok(mut guard) = state.fileshare.child.lock() else {
                    return Err(AppError::Database("lock error".to_string()));
                };
                !reap_if_dead(&mut guard)
            };
            if died {
                return Err(AppError::FileShare(
                    "服务进程启动后立即退出，端口可能被其他程序占用".to_string(),
                ));
            }
            set_enabled(app, true)?;
            Ok(status_inner(app))
        }
        None => {
            kill_service(app);
            Err(AppError::FileShare(
                "服务未能监听：端口全部被占用或目录不可访问".to_string(),
            ))
        }
    }
}

fn save_config_inner(
    app: &AppHandle,
    port: u16,
    share_dirs: Vec<String>,
    local_only: bool,
) -> Result<StatusDto, AppError> {
    let path = config_path(app)?;
    let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();
    let _ = ensure_config(app)?; // 保证文件在位/完成迁移，字段合并交给 update_file
    let normalized = config::normalize_share_dirs(&share_dirs, &dir);
    if normalized.is_empty() {
        return Err(AppError::FileShare("请至少添加一个共享目录".to_string()));
    }
    config::ensure_dirs_exist(&normalized).map_err(AppError::FileShare)?;
    let cfg = config::update_file(&path, &ShareConfig::default(), |c| {
        c.port = port;
        c.share_dirs = normalized.clone();
        c.local_only = local_only;
    })
    .map_err(AppError::FileShare)?;
    if child_running(app) {
        // 服务进程 400ms 轮询一次配置；等它把新端口写回状态文件
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2500);
        loop {
            if let Some(sf) = read_status_file(app) {
                if sf.configured_port == port {
                    break;
                }
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(120));
        }
    }
    Ok(build_status(child_running(app), &cfg, read_status_file(app).as_ref()))
}

#[tauri::command]
pub fn fileshare_status(app: AppHandle) -> StatusDto {
    status_inner(&app)
}

#[tauri::command]
pub async fn fileshare_start(app: AppHandle) -> Result<StatusDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || start_inner(&app))
        .await
        .map_err(|e| AppError::FileShare(format!("启动任务失败: {}", e)))?
}

/// 页面上的临时暂停：不动 fileshare_enabled（开关管入口与开机自启，这里只停当前会话）
#[tauri::command]
pub fn fileshare_stop(app: AppHandle) {
    kill_service(&app);
}

#[tauri::command]
pub fn fileshare_get_config(app: AppHandle) -> Result<ConfigDto, AppError> {
    let cfg = ensure_config(&app)?;
    Ok(to_dto(&cfg))
}

#[tauri::command]
pub async fn fileshare_save_config(
    app: AppHandle,
    port: u16,
    share_dirs: Vec<String>,
    local_only: bool,
) -> Result<StatusDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || save_config_inner(&app, port, share_dirs, local_only))
        .await
        .map_err(|e| AppError::FileShare(format!("保存任务失败: {}", e)))?
}

/// 空串 = 清除口令；生效延迟一个轮询周期（<400ms）。只动 password 字段，别的字段不吞
#[tauri::command]
pub fn fileshare_set_password(app: AppHandle, password: String) -> Result<(), AppError> {
    let path = config_path(&app)?;
    let _ = ensure_config(&app)?;
    config::update_file(&path, &ShareConfig::default(), |c| {
        c.password_sha256 = if password.is_empty() {
            None
        } else {
            Some(fileshare_core::auth::sha256_hex(&password))
        };
    })
    .map_err(AppError::FileShare)?;
    Ok(())
}

/// 主题戳：desko 换外观时把四值抄给网页端。走 update_file 只动这四键，
/// 端口/目录/口令/公网策略一概不吞（那两个字段各有自己的写方）。
///
/// 配置文件还没落地就跳过：换主题不该顺手创建一份局域网传输配置，
/// 而 `shareDirs` 为空的配置会让服务进程拒绝启动（同 `write_public_policies` 的理由）。
/// 值没变也跳过：戳是装饰性契约，不该为它多 bump 一次 mtime、多起一轮热加载。
#[tauri::command]
pub fn fileshare_set_theme(
    app: AppHandle,
    theme: String,
    base: String,
    accent: String,
    atmosphere: String,
) -> Result<(), AppError> {
    let path = config_path(&app)?;
    let Ok(Some(cfg)) = config::load_file(&path) else { return Ok(()) };
    if cfg.theme == theme && cfg.base == base && cfg.accent == accent && cfg.atmosphere == atmosphere {
        return Ok(());
    }
    config::update_file(&path, &cfg, |c| {
        c.theme = theme;
        c.base = base;
        c.accent = accent;
        c.atmosphere = atmosphere;
    })
    .map_err(AppError::FileShare)?;
    Ok(())
}

fn to_dto(cfg: &ShareConfig) -> ConfigDto {
    ConfigDto {
        port: cfg.effective_port(),
        share_dirs: cfg.share_dirs.iter().map(|d| d.display().to_string()).collect(),
        local_only: cfg.local_only,
        has_password: cfg.password_sha256.is_some(),
    }
}

// ── 桌面拖入落盘 ────────────────────────────────────────────

fn base_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.display().to_string())
}

fn import_one(dir_canon: &Path, raw: &str) -> Result<StoredFile, String> {
    let src = Path::new(raw);
    let shown = base_name(src);
    let meta = std::fs::symlink_metadata(src).map_err(|_| format!("{}：读不到文件", shown))?;
    if !meta.is_file() {
        return Err(format!("{}：仅接收文件，文件夹请先压缩", shown));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(format!("{}：超过单文件 {} GiB 上限", shown, MAX_IMPORT_BYTES >> 30));
    }
    let Some(name) = sanitize_upload_name(&shown) else {
        return Err(format!("{}：文件名不合法", shown));
    };
    if src.parent().and_then(|p| p.canonicalize().ok()).as_deref() == Some(dir_canon) {
        return Err(format!("{}：已经在这个共享目录里", name));
    }
    // 占位选名与网页端同一件：photo.jpg → photo (1).jpg，返回前目标名已被 create_new 占住
    let target = claim_available_name(dir_canon, &name)
        .map_err(|e| format!("{}：落盘失败 {}", name, e))?;
    match std::fs::copy(src, &target) {
        Ok(_) => Ok(StoredFile { name: base_name(&target) }),
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            Err(format!("{}：落盘失败 {}", name, e))
        }
    }
}

fn import_inner(app: &AppHandle, share_index: usize, paths: Vec<String>) -> Result<ImportOutcome, AppError> {
    let cfg = ensure_config(app)?;
    let dir = cfg
        .share_dirs
        .get(share_index)
        .ok_or_else(|| AppError::FileShare("共享目录已不在列表里，请重新选择".to_string()))?;
    let dir_canon = dir
        .canonicalize()
        .map_err(|_| AppError::FileShare(format!("共享目录不可访问：{}", dir.display())))?;
    let mut stored = Vec::new();
    let mut failed = Vec::new();
    for raw in &paths {
        match import_one(&dir_canon, raw) {
            Ok(file) => stored.push(file),
            Err(msg) => failed.push(msg),
        }
    }
    Ok(ImportOutcome { stored, failed })
}

/// 桌面拖入的落盘通道。网页端 `POST /upload` 有 Origin/CSRF 门（handlers.rs 拒绝跨站 POST），
/// WebView 发不过去也不该绕；本地投递直接走命令层，复用同一套清洗与重名避让件。
#[tauri::command]
pub async fn fileshare_import_files(
    app: AppHandle,
    share_index: usize,
    paths: Vec<String>,
) -> Result<ImportOutcome, AppError> {
    tauri::async_runtime::spawn_blocking(move || import_inner(&app, share_index, paths))
        .await
        .map_err(|e| AppError::FileShare(format!("投递任务失败: {}", e)))?
}

// ── 生命周期钩子（main.rs 调用）─────────────────────────────

/// 退出收尾：杀子进程、删状态文件。子进程另有 --parent 看门狗兜底强杀场景。
/// 开机不再自动恢复监听：服务只由模块页的启动按钮拉起。
pub fn stop_for_exit(app: &AppHandle) {
    kill_service(app);
}
