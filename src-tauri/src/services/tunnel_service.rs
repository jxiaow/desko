//! 内网穿透的二进制管理与子进程监督。
//!
//! 两件事各自独立：二进制管理负责"本机有没有一个校验过的 cloudflared"，
//! 监督负责"把它按配置拉起来，并知道它现在是不是真连上了边缘"。
//!
//! cloudflared 是外部二进制，不写我们的状态文件，也不带 `--parent` 那种自杀看门狗，
//! 所以运行状态由这一侧从 `--pidfile`（它只在首次成功连上边缘后才写）推导，
//! 不留孤儿则靠 Job Object：desko 被强杀、崩溃、断电时句柄由系统关闭，子进程跟着死。
//! 判活一律不经 DNS。

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::AppError;

/// 固定版本：升级只改这两个常量（sha256 取 Windows amd64 产物，本机 2026-10-09 实测）。
pub const PINNED_VERSION: &str = "2026.10.0";
pub const PINNED_SHA256: &str = "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c";

const BIN_FILE: &str = "cloudflared.exe";
/// `tunnel ready` / metrics 的固定监听口；写死才谈得上判活，随机口等于没有判据。
pub const METRICS_PORT: u16 = 20241;

/// connector 的固定标签。同一条隧道官方允许多副本，劈流时"哪个是本机 desko"只能靠它认。
pub const CONNECTOR_LABEL: &str = "desko-local";

pub fn tunnel_root(root: &Path) -> PathBuf {
    root.join("tunnel")
}

fn bin_dir(root: &Path, version: &str) -> PathBuf {
    tunnel_root(root).join("bin").join(version)
}

/// 凭据与生成物目录：cert.pem、隧道凭据 JSON、config.yml 都在这里。
/// 选址硬约束：必须落在 `backups/` 与 `attachments/` 之外 —— 备份包按显式白名单收文件
/// （`src/backup/container.rs` 只装 manifest/data.db/attachments），云同步只读 `backups/`，
/// 放这里就不会把账号凭据一起传上云；而云端密文永不删，一旦上去就是不可撤回的泄露。
pub fn secret_dir(root: &Path) -> PathBuf {
    tunnel_root(root).join("cf")
}

fn pidfile_path(root: &Path) -> PathBuf {
    tunnel_root(root).join("cloudflared.pid")
}

fn logfile_path(root: &Path) -> PathBuf {
    tunnel_root(root).join("cloudflared.log")
}

pub fn cert_path(root: &Path) -> PathBuf {
    secret_dir(root).join("cert.pem")
}

pub fn config_path(root: &Path, tunnel_id: &str) -> PathBuf {
    secret_dir(root).join(format!("{}.yml", tunnel_id))
}

/// `create` 写、`run` 读的隧道凭据。与 cert.pem 同目录，因此同样在备份白名单之外。
pub fn creds_path(root: &Path, tunnel_id: &str) -> PathBuf {
    secret_dir(root).join(format!("{}.json", tunnel_id))
}

/// 一条 ingress：公网子域 → 本机端口。
/// 子域与端口在这里重新判一次是有意为之 —— "只许指向 127.0.0.1"这条边界就落在这个生成处，
/// 命令层判过了也要在这儿再判，否则以后多一个写入口就多一条绕过路。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IngressRule {
    pub hostname: String,
    pub port: u16,
}

/// 能安全写进 YAML 单行的主机名：小写字母、数字、连字符、点，其余一律拒。
/// 换行或冒号进去就能改写这份配置，所以这不是格式洁癖。
fn plain_hostname(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with('.')
        && !host.ends_with('.')
        && !host.contains("..")
        && host.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
}

fn plain_tunnel_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// 生成 `run` 要读的那份配置。末尾的 catch-all 是 cloudflared 的硬性形状：
/// 最后一条规则不许带 hostname，否则它认为配置不完整、直接拒绝启动。
/// 有了它，没登记的子域拿到的是 404 而不是别的服务的内容。
pub fn build_ingress(tunnel_id: &str, creds: &Path, rules: &[IngressRule]) -> Result<String, AppError> {
    if !plain_tunnel_id(tunnel_id) {
        return Err(AppError::Tunnel(format!("隧道 ID 形态不对，无法写入配置：{}", short_id(tunnel_id))));
    }
    let mut out = String::new();
    out.push_str(&format!("tunnel: {}\n", tunnel_id));
    out.push_str(&format!("credentials-file: {}\n", creds.display()));
    out.push_str("\ningress:\n");
    for rule in rules {
        if !plain_hostname(&rule.hostname) {
            return Err(AppError::Tunnel(format!(
                "公网子域只能用字母、数字、连字符和点，无法写入配置：{}",
                short_id(&rule.hostname)
            )));
        }
        if rule.port == 0 {
            return Err(AppError::Tunnel(format!("{} 的本机端口没填对", rule.hostname)));
        }
        // 服务行只有这一种写法：目标永远是 127.0.0.1，没有拼自由 URL 的入口
        out.push_str(&format!("  - hostname: {}\n", rule.hostname));
        out.push_str(&format!("    service: http://127.0.0.1:{}\n", rule.port));
    }
    out.push_str("  - service: http_status:404\n");
    Ok(out)
}

fn short_id(value: &str) -> String {
    let v: String = value.chars().take(40).collect();
    if value.chars().count() > 40 { format!("{}…", v) } else { v }
}

/// 落盘走「写临时文件再改名」：半份 YAML 被下一次 `run` 读到，表现为隧道起不来，
/// 而现场只留下一个看起来完整的文件名。改名是目录内的原子操作，读到的要么是旧的要么是新的。
pub fn write_config(
    root: &Path,
    tunnel_id: &str,
    rules: &[IngressRule],
) -> Result<PathBuf, AppError> {
    let text = build_ingress(tunnel_id, &creds_path(root, tunnel_id), rules)?;
    let dir = secret_dir(root);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::Tunnel(format!("创建配置目录失败: {}", e)))?;
    let path = config_path(root, tunnel_id);
    let tmp = with_ext(&path, "tmp");
    std::fs::write(&tmp, text).map_err(|e| AppError::Tunnel(format!("写入配置失败: {}", e)))?;
    std::fs::rename(&tmp, &path).map_err(|e| AppError::Tunnel(format!("配置换名失败: {}", e)))?;
    Ok(path)
}

/// 本地管理的 cloudflared 不热读 YAML。配置改变时先撤下旧 connector，
/// 写完才允许重新启动；写入失败也不能让已删除的旧服务继续暴露。
pub fn apply_config_change(
    root: &Path, tunnel_id: &str, rules: &[IngressRule],
    stop: impl FnOnce(), restart: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let next = build_ingress(tunnel_id, &creds_path(root, tunnel_id), rules)?;
    if std::fs::read_to_string(config_path(root, tunnel_id)).ok().as_deref() == Some(next.as_str()) {
        return Ok(());
    }
    stop();
    write_config(root, tunnel_id, rules)?;
    restart()
}

fn with_ext(path: &Path, ext: &str) -> PathBuf {
    let mut name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    name.push('.');
    name.push_str(ext);
    path.with_file_name(name)
}

/// 下载失败的两类必须分开：网络失败可以重试，内容不符是可疑事件。
/// 把后者洗成一次普通重试，等于允许"中间层改写了产物"这件事无声过去。
#[derive(Debug)]
pub enum FetchError {
    Network(String),
    Content(String),
}

impl FetchError {
    fn to_app(&self) -> AppError {
        match self {
            FetchError::Network(m) => AppError::Tunnel(format!("下载失败（网络）：{}", m)),
            FetchError::Content(m) => AppError::Tunnel(format!("产物校验不符（可疑，已丢弃）：{}", m)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryDto {
    pub expected_version: String,
    pub installed: bool,
    pub path: Option<String>,
    /// 留痕在 = 已通过校验；不在 = 未校验（不会原样执行，执行路径会重算哈希）。
    pub verified: bool,
    /// 已落盘产物的哈希短前缀。留痕在时等于期望值的短前缀；未校验时回 null。
    pub actual_sha256: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunStatus {
    /// 进程活着 **且** pidfile 在位。只看前者会把"起来了但没连上边缘"报成成功
    pub running: bool,
    /// 子进程句柄还在不在 —— 与 `registered` 分开，页面才分得清"启动中"和"已停止"
    pub alive: bool,
    pub pid: Option<u32>,
    pub registered: bool,
    pub note: Option<String>,
}

pub fn download_url(version: &str) -> String {
    format!(
        "https://github.com/cloudflare/cloudflared/releases/download/{}/cloudflared-windows-amd64.exe",
        version
    )
}

fn sha256_of(path: &Path) -> Result<String, std::io::Error> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        let read = file.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn short(hash: &str) -> &str {
    &hash[..hash.len().min(12)]
}

/// 已落盘的同一版本只有两种下场：哈希对得上就复用，对不上就删。
/// 不做"留着再用用看"——那等于允许一个未通过校验的二进制进入执行路径。
fn verified_existing(root: &Path) -> Result<Option<PathBuf>, FetchError> {
    let path = bin_dir(root, PINNED_VERSION).join(BIN_FILE);
    if !path.exists() {
        return Ok(None);
    }
    match sha256_of(&path) {
        Ok(actual) if actual == PINNED_SHA256 => {
            mark_verified(root);
            Ok(Some(path))
        }
        Ok(actual) => {
            let _ = std::fs::remove_file(&path);
            let _ = std::fs::remove_file(marker_path(root));
            Err(FetchError::Content(format!("期望 {}，实际 {}", short(PINNED_SHA256), short(&actual))))
        }
        Err(e) => Err(FetchError::Network(format!("读已有产物失败: {}", e))),
    }
}

/// 校验留痕：只给 3 秒级轮询的状态查询当免哈希的通行证。
/// 执行路径（ensure_binary → verified_existing）每次全量哈希，不吃这张条子。
fn marker_path(root: &Path) -> PathBuf {
    bin_dir(root, PINNED_VERSION).join(format!(".{BIN_FILE}.verified"))
}

fn mark_verified(root: &Path) {
    let _ = std::fs::write(marker_path(root), PINNED_SHA256);
}

/// 同一版本的下载/校验全进程串行：两个调用方同时向同一个 .part 截断写，
/// 哈希必然互踩，还会把对方刚下好的产物误报成「可疑内容」。
static DOWNLOAD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 拉取固定版本；已缓存且校验通过则不发网络请求。升级只改 `PINNED_VERSION`，
/// 旧版本目录留着不执行，回滚时哈希仍在。
pub fn ensure_binary(root: &Path) -> Result<PathBuf, AppError> {
    let _download_guard = DOWNLOAD_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match verified_existing(root) {
        // 排队等锁的这一头，同伴可能刚下完——落锁后先复检再动手
        Ok(Some(path)) => return Ok(path),
        Ok(None) => {}
        Err(e) => return Err(e.to_app()),
    }
    let dir = bin_dir(root, PINNED_VERSION);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Tunnel(format!("创建目录失败: {}", e)))?;

    // 先落 .part 再原子改名：半截文件永远不可能通过校验，也就永远不会被执行。
    // .part 名带进程号：上一会话被强杀留下的孤儿残片不会卡死这一次的落位。
    let tmp = dir.join(format!("{BIN_FILE}.{}.part", std::process::id()));
    let actual = {
        let resp = ureq::get(&download_url(PINNED_VERSION))
            .call()
            .map_err(|e| FetchError::Network(e.to_string()))
            .map_err(|e| e.to_app())?;
        let mut reader = resp.into_reader();
        let mut file =
            std::fs::File::create(&tmp).map_err(|e| AppError::Tunnel(format!("写入临时文件失败: {}", e)))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 128 * 1024];
        loop {
            let read = reader
                .read(&mut buf)
                .map_err(|e| FetchError::Network(format!("下载中断: {}", e)))
                .map_err(|e| e.to_app())?;
            if read == 0 {
                break;
            }
            hasher.update(&buf[..read]);
            file.write_all(&buf[..read])
                .map_err(|e| AppError::Tunnel(format!("写盘失败: {}", e)))?;
        }
        file.flush().map_err(|e| AppError::Tunnel(format!("写盘失败: {}", e)))?;
        hex(&hasher.finalize())
    };

    if actual != PINNED_SHA256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(FetchError::Content(format!("期望 {}，实际 {}", short(PINNED_SHA256), short(&actual))).to_app());
    }
    let path = dir.join(BIN_FILE);
    std::fs::rename(&tmp, &path).map_err(|e| AppError::Tunnel(format!("落位失败: {}", e)))?;
    mark_verified(root);
    Ok(path)
}

pub fn binary_status(root: &Path) -> BinaryDto {
    let path = bin_dir(root, PINNED_VERSION).join(BIN_FILE);
    let installed = path.exists();
    // 状态读路径不再全量哈希：55MB 二进制经不起 3 秒一洗。
    // 执行路径（ensure_binary）每次都会哈希并删除不符产物，所以这里只读留痕即可。
    let verified = installed && marker_path(root).exists();
    let actual_sha256 = verified.then(|| short(PINNED_SHA256).to_string());
    BinaryDto {
        expected_version: PINNED_VERSION.to_string(),
        installed,
        path: installed.then(|| path.display().to_string()),
        verified,
        actual_sha256,
    }
}

// ── 子进程监督 ───────────────────────────────────────────────

/// 起一条隧道的命令行。要点都在参数里，不看注释用不出来：
/// - `--no-autoupdate`：**必带**。默认 cloudflared 会周期性自替换二进制并重启，
///   那直接废掉"版本常量 + sha256 白名单"这套校验，且替换发生在 desko 毫不知情时。
/// - `--origincert` / `--config`：一律显式绝对路径，不依赖它的默认搜索顺序（`~/.cloudflared` 等），
///   否则凭据会与外部链路互踩、也无法随模块清理。
/// - `--pidfile`：首次成功连上边缘后才写，是"真连上了"的硬信号。
/// - `--output json` + `--logfile`：状态读结构化输出与人读文本都不吃亏，失败原因也从这里取。
/// - `--label`：同一条隧道可能有多个 connector（官方支持，按地理就近分发），
///   固定标签是排查"哪个是我"的唯一抓手。
pub fn build_run_args(root: &Path, tunnel_id: &str, label: &str) -> Vec<String> {
    vec![
        "--output".into(),
        "json".into(),
        "tunnel".into(),
        "--no-autoupdate".into(),
        "--origincert".into(),
        cert_path(root).display().to_string(),
        "--config".into(),
        config_path(root, tunnel_id).display().to_string(),
        "--metrics".into(),
        format!("localhost:{}", METRICS_PORT),
        "--pidfile".into(),
        pidfile_path(root).display().to_string(),
        "--logfile".into(),
        logfile_path(root).display().to_string(),
        "--label".into(),
        label.into(),
        "run".into(),
        tunnel_id.into(),
    ]
}

/// 清掉上一会话的 pidfile：它存在过不代表这一次连上了。
pub fn clear_runtime_files(root: &Path) {
    let _ = std::fs::remove_file(pidfile_path(root));
}

/// 日志尾巴：失败时把 cloudflared 自己的原因带给用户，别只报"启动失败"。
pub fn tail_log(root: &Path, max_bytes: usize) -> Option<String> {
    let text = std::fs::read_to_string(logfile_path(root)).ok()?;
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return None;
    }
    // 从尾部取，且必须落在字符边界上：日志里有中文，按字节切会 panic
    let start = trimmed
        .char_indices()
        .rev()
        .map(|(i, _)| i)
        .find(|i| trimmed.len() - i <= max_bytes)
        .unwrap_or(0);
    Some(trimmed[start..].to_string())
}

/// 注册信号：pidfile 里有可读的 PID 就说明这条 connector 真连上了边缘。
pub fn is_registered(root: &Path) -> bool {
    std::fs::read_to_string(pidfile_path(root))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok())
        .is_some()
}

/// 运行态：`child_alive` 由命令层从子进程句柄判，`registered` 由 pidfile 判。
pub fn read_status(root: &Path, child_alive: bool) -> RunStatus {
    let pid = std::fs::read_to_string(pidfile_path(root))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());
    let registered = pid.is_some();
    RunStatus {
        running: child_alive && registered,
        alive: child_alive,
        pid,
        registered,
        note: match (child_alive, registered) {
            (true, false) => Some("进程在跑，尚未连上 Cloudflare 边缘".to_string()),
            (false, true) => Some("残留的运行痕迹来自已退出的进程".to_string()),
            _ => None,
        },
    }
}

// ── 不留孤儿：Job Object ─────────────────────────────────────

/// Windows 的进程组句柄。desko 无论怎么死（正常退出、强杀、崩溃），句柄由系统关闭，
/// 组内进程随之终止。这是 cloudflared 没有 `--parent` 看门狗时唯一的可靠兜底 ——
/// 一个 desko 已经不在了却还亮着的隧道，正是最糟的那种残留。
pub struct ProcessJob {
    #[cfg(windows)]
    raw: isize,
}

impl ProcessJob {
    pub fn new() -> Result<Self, AppError> {
        #[cfg(windows)]
        {
            use windows::Win32::System::JobObjects::CreateJobObjectW;
            let handle = unsafe { CreateJobObjectW(None, None) }
                .map_err(|e| AppError::Tunnel(format!("创建进程作业对象失败: {}", e)))?;
            Ok(ProcessJob { raw: handle.0 as isize })
        }
        #[cfg(not(windows))]
        {
            Ok(ProcessJob { })
        }
    }

    #[cfg(windows)]
    fn handle(&self) -> windows::Win32::Foundation::HANDLE {
        windows::Win32::Foundation::HANDLE(self.raw as *mut std::ffi::c_void)
    }

    /// 把子进程放进作业对象并打开 KILL_ON_JOB_CLOSE。此后即使 desko 被强杀，隧道也活不过句柄。
    pub fn assign(&self, child: &Child) -> Result<(), AppError> {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows::Win32::System::JobObjects::{
                AssignProcessToJobObject, JobObjectExtendedLimitInformation, SetInformationJobObject,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            let info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                BasicLimitInformation: windows::Win32::System::JobObjects::JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    ..Default::default()
                },
                ..Default::default()
            };
            unsafe {
                AssignProcessToJobObject(self.handle(), windows::Win32::Foundation::HANDLE(child.as_raw_handle()))
                    .map_err(|e| AppError::Tunnel(format!("隧道进程纳入作业对象失败: {}", e)))?;
                SetInformationJobObject(
                    self.handle(),
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
                .map_err(|e| AppError::Tunnel(format!("设置作业对象策略失败: {}", e)))?;
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(())
        }
    }
}

impl Drop for ProcessJob {
    fn drop(&mut self) {
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::CloseHandle;
            unsafe {
                let _ = CloseHandle(self.handle());
            }
        }
    }
}

/// 起进程并纳入作业对象。`job` 由调用方（AppState）持有，活得比子进程久。
pub fn spawn_runner(program: &Path, args: &[String], job: &ProcessJob) -> Result<Child, AppError> {
    let mut command = Command::new(program);
    command
        .args(args)
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
        .map_err(|e| AppError::Tunnel(format!("启动穿透进程失败: {}", e)))?;
    job.assign(&child)?;
    Ok(child)
}

pub fn kill_child(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// 起 `login`：它会自己拉浏览器并阻塞到回调完成，所以标准输出必须接出来读授权 URL。
/// 与 `spawn_runner` 同样纳入作业对象 —— 授权中途退出 desko，不该留一个挂着等回调的进程。
pub fn spawn_login(
    program: &Path,
    args: &[String],
    envs: &[(&str, &str)],
    job: &ProcessJob,
) -> Result<(Child, std::process::ChildStdout), AppError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .envs(envs.iter().map(|(k, v)| (*k, *v)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Tunnel(format!("启动授权进程失败: {}", e)))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Tunnel("授权进程没有回吐输出".to_string()))?;
    job.assign(&child)?;
    Ok((child, stdout))
}

/// 授权 URL 从它自己的输出里取，不猜固定域名前缀之外的形状。
pub fn auth_url_from_line(line: &str) -> Option<String> {
    let idx = line.find("https://")?;
    let url = line[idx..].trim().split_whitespace().next()?.to_string();
    (!url.is_empty()).then_some(url)
}

/// 授权子进程的输出尾巴留几行、每行截到 120 字。
/// 界面上这一格是给失败的授权说个原因，不是把整篇日志搬进弹窗。
pub fn push_tail(prev: &str, line: &str) -> String {
    const KEEP_LINES: usize = 4;
    let clipped: String = line.chars().take(120).collect();
    let trimmed = clipped.trim();
    if trimmed.is_empty() {
        return prev.to_string();
    }
    let mut kept: Vec<&str> = prev.split('\n').filter(|l| !l.trim().is_empty()).collect();
    kept.push(trimmed);
    while kept.len() > KEEP_LINES {
        kept.remove(0);
    }
    kept.join("\n")
}

// ── 一次性 CLI：授权与建隧道 ─────────────────────────────────

/// 参数分三层，位置错了只会得到一句 `flag provided but not defined`，而它**退 0**：
/// 全局（`--output`）在 `tunnel` 之前，tunnel 命令级（`--origincert` 等）在其后、子命令之前，
/// 子命令级（`-o`、`--credentials-file`、`-f`）在最后。所以成败只能看 stdout 有没有可解析的结果。
fn cli_preargs(root: &Path) -> Vec<String> {
    vec![
        "--output".into(),
        "json".into(),
        "tunnel".into(),
        "--no-autoupdate".into(),
        "--origincert".into(),
        cert_path(root).display().to_string(),
    ]
}

/// `login` 会自己拉浏览器并阻塞到回调完成。它没有指定 cert 落点的 flag，
/// 于是 `--origincert`（读）与 `TUNNEL_ORIGIN_CERT`（写）两道一起给，落点仍靠事后核验。
pub fn build_login_args(root: &Path) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("login".into());
    args
}

pub fn build_list_args(root: &Path, name: Option<&str>) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("list".into());
    args.push("-o".into());
    args.push("json".into());
    // 按名精确过滤：幂等探测只要问"我这条建过没有"，不拉全量再自己筛
    if let Some(n) = name {
        args.push("--name".into());
        args.push(n.to_string());
    }
    args
}

pub fn build_create_args(root: &Path, name: &str, creds: &Path) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("create".into());
    args.push("--credentials-file".into());
    args.push(creds.display().to_string());
    args.push("-o".into());
    args.push("json".into());
    args.push(name.to_string());
    args
}

/// 凭据找回：隧道在边缘已建、本机 JSON 却没了时用它补一份，绝不该走到"再建一条"
pub fn build_token_args(root: &Path, tunnel_id: &str, creds: &Path) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("token".into());
    args.push("--cred-file".into());
    args.push(creds.display().to_string());
    args.push(tunnel_id.to_string());
    args
}

pub fn build_route_args(root: &Path, tunnel_id: &str, hostname: &str) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("route".into());
    args.push("dns".into());
    // 记录已存在时覆盖而非报错：这一因此天然可重入，中断后重跑不会卡在"已存在"
    args.push("--overwrite-dns".into());
    args.push(tunnel_id.to_string());
    args.push(hostname.to_string());
    args
}

pub fn build_info_args(root: &Path, tunnel_id: &str) -> Vec<String> {
    let mut args = cli_preargs(root);
    args.push("info".into());
    args.push("-o".into());
    args.push("json".into());
    args.push(tunnel_id.to_string());
    args
}

/// 登录子进程专用的 home：cloudflared 的默认写入路径也留在当前档案内。
/// 不借用用户真实 ~/.cloudflared，那里可能属于其他账号和外部 CLI。
pub fn login_home(root: &Path) -> PathBuf {
    tunnel_root(root).join("login-home")
}

pub fn fallback_cert_path(root: &Path) -> PathBuf {
    login_home(root).join(".cloudflared").join("cert.pem")
}

pub fn build_login_envs(root: &Path) -> Vec<(String, String)> {
    let home = login_home(root).display().to_string();
    vec![
        ("TUNNEL_ORIGIN_CERT".into(), cert_path(root).display().to_string()),
        ("HOME".into(), home.clone()), ("USERPROFILE".into(), home),
    ]
}

/// `login` 没有指定 cert 落点的 flag，写侧行为只能事后核验：我们的目录里没有、默认目录里有时搬进来。
/// 留在 `~/.cloudflared` 就是与外部链路互踩，且无法随模块清理。
pub fn adopt_stray_cert(root: &Path, stray: &Path) -> bool {
    let target = cert_path(root);
    if target.exists() || !stray.exists() {
        return false;
    }
    if let Some(dir) = target.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // 先复制再删源：跨卷 rename 会失败，而凭据只有一份，不能赌
    if std::fs::copy(stray, &target).is_err() {
        return false;
    }
    let _ = std::fs::remove_file(stray);
    true
}

/// 起一次性 CLI 并等它结束。`login` 不走这里（它会阻塞到浏览器回调，是长命子进程）。
///
/// 两路输出各交给一条线程抽干：在主线程上顺序 read 到 EOF，进程一旦挂住就无限期堵死，
/// 而只轮询 `try_wait` 又不收管道，缓冲区写满后反过来把子进程卡住。
pub fn run_cli(
    program: &Path,
    args: &[String],
    envs: &[(&str, &str)],
    timeout: std::time::Duration,
) -> Result<String, AppError> {
    let mut command = Command::new(program);
    command
        .args(args)
        .envs(envs.iter().map(|(k, v)| (*k, *v)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let job = ProcessJob::new()?;
    let mut child = command
        .spawn()
        .map_err(|e| AppError::Tunnel(format!("调用穿透程序失败: {}", e)))?;
    // 一次性 CLI 也进作业对象：desko 被强杀时，卡在代理网络里的 CLI 不留孤儿
    job.assign(&child)?;

    let out = child.stdout.take();
    let err = child.stderr.take();
    let out_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut h) = out {
            let _ = h.read_to_string(&mut buf);
        }
        buf
    });
    let err_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(mut h) = err {
            let _ = h.read_to_string(&mut buf);
        }
        buf
    });

    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            _ => {
                // 到点就杀：授权接口在代理环境下可能一声不响地挂着，不能把按钮留在转圈
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err(AppError::Tunnel(format!(
                    "穿透程序 {} 秒没有回话，已终止本次操作",
                    timeout.as_secs()
                )));
            }
        }
    };
    let stdout = out_thread
        .join()
        .map_err(|_| AppError::Tunnel("读取穿透程序输出失败".to_string()))?;
    let stderr = err_thread
        .join()
        .map_err(|_| AppError::Tunnel("读取穿透程序输出失败".to_string()))?;

    if !status.success() {
        return Err(cli_error(&stdout, &stderr));
    }
    Ok(stdout)
}

/// 错文优先取 cloudflared 自己的话：它对"没授权""域名不在此账号下"各有明确表述，
/// 糊成一句"操作失败"就把唯一有用的信息丢了。
fn cli_error(stdout: &str, stderr: &str) -> AppError {
    let text = if stderr.trim().is_empty() { stdout } else { stderr };
    let line = text
        .lines()
        .rev()
        .map(|l| l.trim())
        .find(|l| !l.is_empty() && !l.starts_with('{'))
        .unwrap_or("穿透程序未返回可用结果");
    AppError::Tunnel(line.to_string())
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct TunnelRow {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// 边缘侧已建立的连接数：本机没在跑它却非零，说明别处也在跑这条隧道
    #[serde(default)]
    pub connections: u32,
}

/// 结果 JSON 与 JSON 日志行会混在同一条 stdout 上，所以逐行试解析。
/// `None` = 这行不是结果（日志行、人读文本）；`Some(rows)` = 这就是列表结果，**空数组也算**——
/// "远端一条也没有"是幂等判据里最有价值的一格，不能和"没读懂"混成一谈。
/// 认作结果的行必须带非空 `id`：全字段带 default 的结构体能把任何一行日志都"解析成功"。
fn rows_from_line(line: &str) -> Option<Vec<TunnelRow>> {
    let trimmed = line.trim();
    if trimmed.starts_with('[') {
        let rows = serde_json::from_str::<Vec<TunnelRow>>(trimmed).ok()?;
        return Some(rows.into_iter().filter(|r| !r.id.is_empty()).collect());
    }
    if trimmed.starts_with('{') {
        let row = serde_json::from_str::<TunnelRow>(trimmed).ok()?;
        return (!row.id.is_empty()).then_some(vec![row]);
    }
    None
}

/// 解析不出就必须报错，不能返回空列表：空列表的含义是"远端没有这条隧道"，
/// 下一步就是建一条新的 —— 而它要的恰恰是"不产生重复隧道"。
pub fn parse_tunnel_list(stdout: &str) -> Result<Vec<TunnelRow>, AppError> {
    let mut seen: Vec<TunnelRow> = vec![];
    let mut matched = false;
    for line in stdout.lines() {
        if let Some(rows) = rows_from_line(line) {
            matched = true;
            for row in rows {
                if !seen.iter().any(|s| s.id == row.id) {
                    seen.push(row);
                }
            }
        }
    }
    if matched {
        Ok(seen)
    } else {
        Err(AppError::Tunnel(
            "穿透程序返回的隧道列表格式不认识，已停止以免重复建隧道".to_string(),
        ))
    }
}

/// `create -o json` 的返回：新隧道的 ID 与名字
pub fn parse_created(stdout: &str) -> Result<TunnelRow, AppError> {
    parse_tunnel_list(stdout)?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Tunnel("穿透程序没有回吐新隧道的编号".to_string()))
}

/// 本机没有记录、远端却回了一条同名隧道时该怎么办。两者在远端看起来一模一样，
/// 只有"本机有没有这条 ID 的记录"能把它们分开。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TunnelPlan {
    Create,
    /// 用户明确认下账号里那条同名的就是本机
    Adopt(String),
    /// 同名存在但本机没记录：默认不认，认了就变成静默劈流
    NameTaken(String),
}

pub fn plan_named_tunnel(rows: &[TunnelRow], adopt: bool) -> TunnelPlan {
    match rows.first() {
        None => TunnelPlan::Create,
        Some(row) if adopt => TunnelPlan::Adopt(row.id.clone()),
        Some(row) => TunnelPlan::NameTaken(row.id.clone()),
    }
}

/// 拒认同名隧道时的说法：要把两条路都摆在眼前，只说"名字占了"会让人去猜下一步。
pub fn name_taken_message(id: &str) -> String {
    format!(
        "账号里已有一条同名隧道（{}），本机没有它的记录。不复用别处建的隧道：换个名字新建；确认那条就是本机时，选接管。",
        id
    )
}

/// `create` 时隧道 ID 还不存在，凭据只能先落在一个暂存名上；拿到回吐的 ID 后归位成 `<id>.json`，
/// 因为 `run` 要读的、`require_credentials` 要查的都是那个名字。
pub fn place_credentials(root: &Path, staged: &Path, tunnel_id: &str) -> Result<PathBuf, AppError> {
    let target = creds_path(root, tunnel_id);
    if staged == &target {
        return Ok(target);
    }
    std::fs::rename(staged, &target)
        .map_err(|e| AppError::Tunnel(format!("隧道凭据归位失败: {}", e)))?;
    Ok(target)
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ConnectorRow {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub num_connections: u32,
}

#[derive(Deserialize, Clone, Debug)]
struct InfoDoc {
    #[serde(default)]
    id: String,
    #[serde(default)]
    connectors: Vec<ConnectorRow>,
}

/// 劈流探测的判据：边缘侧列出的活 connector。本机 DNS 返 fake-IP，进程表也看不见别处，
/// 只有这个读的是真话。
pub fn parse_connectors(stdout: &str) -> Result<Vec<ConnectorRow>, AppError> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        if let Ok(doc) = serde_json::from_str::<InfoDoc>(trimmed) {
            // 日志行同样是对象：只认带 tunnel 编号的那一行
            if !doc.id.is_empty() {
                return Ok(doc.connectors);
            }
        }
    }
    Err(AppError::Tunnel("穿透程序返回的 connector 信息格式不认识".to_string()))
}

/// 活 connector 数：`num_connections` 是每条 connector 到边缘的连接数，非零才算真在服役
pub fn live_connectors(rows: &[ConnectorRow]) -> Vec<ConnectorRow> {
    rows.iter()
        .filter(|c| c.num_connections > 0)
        .cloned()
        .collect()
}

// ── 授权与建隧道的进度 ───────────────────────────────────────

/// 进度的全部判据：都是本机看得见的特征，没有一项要问远端（远端没有 dry-run，
/// 也没有"这条域名归不归我"的问法）。中断后重进靠同一套推导续做，因此不需要"上次走到哪"的会话态。
#[derive(Clone, Copy, Debug)]
pub struct ProvisionFacts {
    pub binary: bool,
    pub authorized: bool,
    pub has_tunnel_id: bool,
    pub credentials: bool,
    /// 服务表里有没有条目。空表 = 这条隧道什么都没指向，起来也不暴露任何东西
    pub has_services: bool,
    /// 每一条的 DNS 是否都指过来了（有一条没成就得再点一次「应用」）
    pub all_routed: bool,
}

/// 下一步该做什么，以及怎么向用户解释当前卡点。
pub fn provision_step(f: &ProvisionFacts) -> (&'static str, String) {
    match f {
        ProvisionFacts { binary: false, .. } => (
            "no-binary",
            "还没有取到穿透程序：先点「获取程序」。".to_string(),
        ),
        ProvisionFacts { authorized: false, .. } => (
            "not-authorized",
            "还没授权：授权会在浏览器里完成 Cloudflare 登录，选好要用的域名即算通过。".to_string(),
        ),
        ProvisionFacts { has_tunnel_id: false, .. } => (
            "no-tunnel",
            "已授权，还没有本机自己的隧道：建一条，不复用任何现存隧道。".to_string(),
        ),
        ProvisionFacts { credentials: false, .. } => (
            "missing-credentials",
            "隧道在，本机凭据却不在：找回凭据即可，不要重建隧道。".to_string(),
        ),
        ProvisionFacts { has_services: false, .. } => (
            "no-services",
            "凭据已就位，还没有登记要挂出去的本地服务。".to_string(),
        ),
        ProvisionFacts { all_routed: false, .. } => (
            "not-routed",
            "服务已登记，但有的子域本机记录显示没指过来：再点一次「应用」。".to_string(),
        ),
        _ => (
            "ready",
            "已就绪：启动后每一条登记过的服务都会从公网可达。".to_string(),
        ),
    }
}

/// 劈流探测的结论。同一隧道多处并存不会报错，只会按地理就近静默分流量，
/// 所以判据是边缘侧报的活 connector 处数，而不是"有没有冲突响应"。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SplitReport {
    pub live_count: u32,
    /// 扣掉本机那一条之后仍在服役的处数
    pub external_count: u32,
    pub conflict: bool,
    pub message: String,
}

/// `ours` 取本机是否已在边缘注册：注册了就有自己这一条，多出来的才是别处。
pub fn split_report(ours: bool, live: usize) -> SplitReport {
    let expected = if ours { 1 } else { 0 };
    let external = live.saturating_sub(expected);
    let message = if external > 0 {
        format!(
            "另有 {} 处也在跑这条隧道，同一个公网地址会被分到不同出口；这条隧道要只用这一台。",
            external
        )
    } else if ours {
        "只有本机这一条链路在服役。".to_string()
    } else {
        "当前没有链路在服役：本机启动后即成为唯一的出口。".to_string()
    };
    SplitReport {
        live_count: live as u32,
        external_count: external as u32,
        conflict: external > 0,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 每个用例一个临时根：测试之间只共用进程号，不共用文件
    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desko-tunnel-{}-{}", tag, std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn push_tail_keeps_the_last_lines_and_clips_each_one() {
        let long = "x".repeat(300);
        let one = push_tail("", &long);
        assert_eq!(one.chars().count(), 120, "单行截到 120 字：界面那一格不是日志查看器");
        let mut buf = String::new();
        for i in 0..9 {
            buf = push_tail(&buf, &format!("line {i}"));
        }
        assert_eq!(buf, "line 5\nline 6\nline 7\nline 8", "只留最后四行");
        assert_eq!(push_tail(&buf, "   "), buf, "空行不占位");
    }

    #[test]
    fn run_args_carry_every_safety_critical_flag() {
        let root = temp_root("args");
        let args = build_run_args(&root, "tun-1", CONNECTOR_LABEL);
        let joined = args.join(" ");
        // 漏了它 = 它每天自查更新并自替换二进制，版本常量与 sha256 白名单当场作废
        assert!(joined.contains("--no-autoupdate"), "{joined}");
        assert!(joined.contains(&cert_path(&root).display().to_string()));
        assert!(joined.contains(&config_path(&root, "tun-1").display().to_string()));
        assert!(joined.contains(&format!("localhost:{}", METRICS_PORT)));
        assert!(joined.contains(CONNECTOR_LABEL));
        // 隧道 ID 必须紧跟 run：写成路径形式会被当成本地配置解析
        let run = args.iter().position(|a| a == "run").expect("run 子命令");
        assert_eq!(args[run + 1], "tun-1");
        assert_eq!(args.len(), run + 2);
    }

    #[test]
    fn alive_and_registered_are_separate_signals() {
        let root = temp_root("status");
        let _ = std::fs::create_dir_all(tunnel_root(&root));
        clear_runtime_files(&root);

        let s = read_status(&root, true);
        assert!(s.alive && !s.registered && !s.running, "起来了却没连上，不能报 running");
        assert!(s.note.unwrap().contains("尚未连上"));

        std::fs::write(pidfile_path(&root), format!("{}", std::process::id())).unwrap();
        let s = read_status(&root, true);
        assert!(s.running && s.registered && s.note.is_none());

        // 进程早没了，pidfile 还留着：只能算残留痕迹
        let s = read_status(&root, false);
        assert!(!s.running && s.registered);
        assert!(s.note.unwrap().contains("残留"));

        clear_runtime_files(&root);
        assert!(!is_registered(&root));
    }

    #[test]
    fn tail_log_stays_on_char_boundary() {
        let root = temp_root("tail");
        let _ = std::fs::create_dir_all(tunnel_root(&root));
        // 全中文日志：按字节切尾巴会 panic，这里断言的是「不 panic 且取到尾部」
        let text = "注册失败：无法解析 api.cloudflare.com 的名称，请检查网络。".repeat(20);
        std::fs::write(logfile_path(&root), &text).unwrap();
        let tail = tail_log(&root, 120).expect("有日志");
        assert!(!tail.is_empty() && text.ends_with(&tail));
        assert!(tail.chars().count() < text.chars().count());
        std::fs::remove_file(logfile_path(&root)).unwrap();
        assert_eq!(tail_log(&root, 120), None);
    }

    #[test]
    fn unverified_cached_binary_is_dropped_not_reused() {
        let root = temp_root("verify");
        assert!(verified_existing(&root).unwrap().is_none(), "空目录不该认作已就位");

        let path = bin_dir(&root, PINNED_VERSION).join(BIN_FILE);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"not the pinned build").unwrap();
        let err = verified_existing(&root).unwrap_err();
        match err {
            // 「内容不符」必须与「网络失败」分开：前者是可疑事件，不能被洗成一次普通重试
            FetchError::Content(m) => assert!(m.contains("期望") && m.contains("实际"), "{m}"),
            other => panic!("应报内容不符，实际 {other:?}"),
        }
        assert!(!path.exists(), "未通过校验的产物必须删掉，不留执行路径");
    }

    // ── 授权与建隧道：全部走 scripts/mock-cloudflared.mjs，不碰真账号 ──

    fn mock_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desko-mock-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(dir.join("cf"));
        dir.join("tunnel")
    }

    fn mock_envs(state: &Path, extra: &[(&str, &str)]) -> Vec<(String, String)> {
        let mut v = vec![
            ("DESKO_MOCK_STATE".to_string(), state.display().to_string()),
        ];
        v.extend(extra.iter().map(|(k, val)| (k.to_string(), val.to_string())));
        v
    }

    /// 存根按 node 脚本形态起：`node mock-cloudflared.mjs <与真二进制相同的参数>`
    fn run_mock(args: &[String], envs: &[(String, String)], timeout: std::time::Duration) -> Result<String, AppError> {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/mock-cloudflared.mjs");
        assert!(script.exists(), "存根脚本必须存在: {}", script.display());
        let owned: Vec<(&str, &str)> = envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        run_cli(
            &PathBuf::from("node"),
            &{
                let mut a = vec![script.display().to_string()];
                a.extend(args.iter().cloned());
                a
            },
            &owned,
            timeout,
        )
    }

    fn login(root: &Path, mode: &str, state: &Path) -> Result<String, AppError> {
        run_mock(
            &build_login_args(root),
            &mock_envs(state, &[("DESKO_MOCK_LOGIN", mode), ("DESKO_MOCK_DELAY", "50")]),
            std::time::Duration::from_secs(20),
        )
    }

    #[test]
    fn login_lands_the_cert_in_our_own_dir() {
        let root = mock_root("login");
        login(&root, "write-origincert", &root).expect("授权成功");
        assert!(cert_path(&root).exists(), "cert.pem 必须落在 desko 自己的目录，不进 ~/.cloudflared");
    }

    #[test]
    fn login_that_never_comes_back_times_out_instead_of_hanging() {
        let root = mock_root("login-timeout");
        let err = login(&root, "never", &root).unwrap_err().to_string();
        assert!(err.contains("没有回话"), "{err}");
        assert!(!cert_path(&root).exists());
    }

    #[test]
    fn cert_left_in_the_default_home_is_moved_in() {
        let root = mock_root("login-home");
        let fake_home = std::env::temp_dir().join(format!("desko-mock-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&fake_home);
        let home_str = fake_home.display().to_string();
        run_mock(
            &build_login_args(&root),
            &mock_envs(&root, &[
                ("DESKO_MOCK_LOGIN", "write-home"),
                ("DESKO_MOCK_DELAY", "50"),
                ("DESKO_MOCK_HOME", home_str.as_str()),
            ]),
            std::time::Duration::from_secs(20),
        )
        .expect("授权成功");
        // 真 `login` 没有指定 cert 落点的 flag，写侧行为只能事后核验：这一步就是那条兜底
        let stray = fake_home.join("cert.pem");
        assert!(stray.exists(), "存根按剧本把凭据留在了默认目录");
        assert!(adopt_stray_cert(&root, &stray));
        assert!(cert_path(&root).exists() && !stray.exists());
    }

    #[test]
    fn create_then_list_is_idempotent_and_never_double_creates() {
        let root = mock_root("create");
        login(&root, "write-origincert", &root).unwrap();
        let name = "desko-test";

        let empty = run_cli_mock(&root, &build_list_args(&root, Some(name))).unwrap();
        assert!(parse_tunnel_list(&empty).unwrap().is_empty(), "授权后本机名下不该有隧道");

        let created = run_cli_mock(&root, &build_create_args(&root, name, &creds_path(&root, "pending"))).unwrap();
        let row = parse_created(&created).unwrap();
        assert_eq!(row.name, name);
        assert!(!row.id.is_empty());

        let again = run_cli_mock(&root, &build_create_args(&root, name, &creds_path(&root, "pending")));
        let err = again.unwrap_err().to_string();
        assert!(err.contains("already exists"), "重复建必须被拒而不是静默成功: {err}");

        // 幂等续做的正解：先按名查到那条已存在的，直接拿它的 ID 往下走
        let listed = parse_tunnel_list(&run_cli_mock(&root, &build_list_args(&root, Some(name))).unwrap()).unwrap();
        assert_eq!(listed.len(), 1, "重名被拒后远端仍只该有一条: {listed:?}");
        assert_eq!(listed[0].id, row.id);
    }

    #[test]
    fn token_recovers_a_lost_credentials_file_without_recreating() {
        let root = mock_root("token");
        login(&root, "write-origincert", &root).unwrap();
        // create 时还不知道 ID，先落暂存名，拿到回吐的 ID 再归位 —— 这就是生产路径的形状
        let staged = secret_dir(&root).join("staged.json");
        let created = run_cli_mock(&root, &build_create_args(&root, "desko-rec", &staged)).unwrap();
        let id = parse_created(&created).unwrap().id;
        let creds = place_credentials(&root, &staged, &id).unwrap();
        assert_eq!(creds, creds_path(&root, &id));
        assert!(creds.exists() && !staged.exists());

        std::fs::remove_file(&creds).unwrap();
        run_cli_mock(&root, &build_token_args(&root, &id, &creds)).unwrap();
        assert!(creds.exists(), "凭据找回必须把 JSON 重新落到原位，而不是再建一条隧道");
    }

    #[test]
    fn route_dns_reports_the_zone_failure_in_its_own_words() {
        let root = mock_root("route");
        login(&root, "write-origincert", &root).unwrap();
        let created = run_cli_mock(&root, &build_create_args(&root, "desko-route", &creds_path(&root, "r"))).unwrap();
        let id = parse_created(&created).unwrap().id;

        let err = run_cli_mock(&root, &build_route_args(&root, &id, "tunnel.not-my-zone.org"))
            .unwrap_err()
            .to_string();
        // 跨 zone 的真相只有远端知道（route dns 没有 dry-run），所以错文必须原样透出
        assert!(err.contains("zone"), "{err}");
        run_cli_mock(&root, &build_route_args(&root, &id, "tunnel.example.com")).unwrap();
    }

    #[test]
    fn conflict_is_read_from_edge_connectors_not_from_dns() {
        let root = mock_root("info");
        login(&root, "write-origincert", &root).unwrap();
        let created = run_cli_mock(&root, &build_create_args(&root, "desko-info", &creds_path(&root, "i"))).unwrap();
        let id = parse_created(&created).unwrap().id;

        let quiet = parse_connectors(&run_cli_mock(&root, &build_info_args(&root, &id)).unwrap()).unwrap();
        assert!(live_connectors(&quiet).is_empty(), "刚建好不该有活 connector");

        let mut envs = mock_envs(&root, &[]);
        envs.push((
            "DESKO_MOCK_CONNECTORS".to_string(),
            r#"[{"id":"a","version":"2026.10.0","num_connections":4},{"id":"b","version":"2026.10.0","num_connections":0}]"#.to_string(),
        ));
        let out = run_mock(&build_info_args(&root, &id), &envs, std::time::Duration::from_secs(20)).unwrap();
        let rows = parse_connectors(&out).unwrap();
        let live = live_connectors(&rows);
        assert_eq!(live.len(), 1, "num_connections=0 的那条早已断开，不算在服役");
        assert_eq!(live[0].id, "a");
    }

    #[test]
    fn a_zero_exit_with_unparseable_output_is_not_success() {
        // 真二进制拼错 flag 时只打一句 Incorrect Usage 却退 0：拿退出码当成功判据，
        // 这一格会被读成"远端一条隧道也没有"，下一步就是重复建隧道。
        let root = mock_root("exit0");
        login(&root, "write-origincert", &root).unwrap();
        let args = {
            let mut a = cli_preargs(&root);
            a.push("--bogus-flag".into());
            a.push("list".to_string());
            a
        };
        let out = run_cli_mock(&root, &args).expect("退出码确实是 0");
        assert!(out.trim().is_empty() || !out.trim().starts_with('['));
        assert!(parse_tunnel_list(&out).is_err(), "解析不出列表就必须报错，不能当成空列表");
    }

    #[test]
    fn named_tunnel_plan_refuses_a_stranger_with_the_same_name() {
        let row = TunnelRow { id: "other".into(), name: "desko".into(), connections: 0 };
        assert_eq!(plan_named_tunnel(&[], false), TunnelPlan::Create);
        assert_eq!(plan_named_tunnel(&[], true), TunnelPlan::Create);
        // 本机没记录 + 远端有同名 = 默认不认：认了就落进静默劈流
        assert_eq!(plan_named_tunnel(&[row.clone()], false), TunnelPlan::NameTaken("other".into()));
        assert_eq!(plan_named_tunnel(&[row], true), TunnelPlan::Adopt("other".into()));
    }

    #[test]
    fn provision_step_stops_at_the_first_missing_piece() {
        let ready = ProvisionFacts {
            binary: true,
            authorized: true,
            has_tunnel_id: true,
            credentials: true,
            has_services: true,
            all_routed: true,
        };
        assert_eq!(provision_step(&ready).0, "ready");

        // 回退哪一格就报哪一格，且靠前的缺口必须盖住靠后的：续做时只指一个方向
        let cases = [
            ("no-binary", ProvisionFacts { binary: false, ..ready }),
            ("not-authorized", ProvisionFacts { authorized: false, ..ready }),
            ("no-tunnel", ProvisionFacts { has_tunnel_id: false, ..ready }),
            ("missing-credentials", ProvisionFacts { credentials: false, ..ready }),
            ("no-services", ProvisionFacts { has_services: false, ..ready }),
            ("not-routed", ProvisionFacts { all_routed: false, ..ready }),
        ];
        let mut seen: Vec<String> = Vec::new();
        for (step, facts) in cases {
            let (got, message) = provision_step(&facts);
            assert_eq!(got, step);
            assert!(!message.is_empty(), "{step} 必须有文案");
            seen.push(message);
        }
        // 每格各有各的说法：把「没授权」和「没子域」报成同一句话，用户就不知道该点哪个钮
        for i in 0..seen.len() {
            for j in i + 1..seen.len() {
                assert_ne!(seen[i], seen[j], "第 {} 与第 {} 格文案重复", i, j);
            }
        }
    }

    #[test]
    fn ingress_keeps_registration_order_and_ends_with_catch_all() {
        let rules = vec![
            IngressRule { hostname: "z.example.com".into(), port: 3003 },
            IngressRule { hostname: "a.example.com".into(), port: 8421 },
        ];
        let text = build_ingress("tun-1", &Path::new("C:/cf/tun-1.json"), &rules).unwrap();
        assert!(text.starts_with("tunnel: tun-1\n"), "{}", text);
        assert!(text.contains("credentials-file: C:/cf/tun-1.json"));
        // 顺序变了就等于换了份配置：判活时看到的应当是同一份文件
        let z = text.find("z.example.com").unwrap();
        let a = text.find("a.example.com").unwrap();
        assert!(z < a, "登记顺序即 ingress 顺序");
        // 目标行只有 127.0.0.1 这一种，没有拼自由 URL 的入口
        assert!(text.contains("service: http://127.0.0.1:3003"));
        assert!(text.contains("service: http://127.0.0.1:8421"));
        assert!(text.trim_end().ends_with("- service: http_status:404"), "缺 catch-all 它就拒绝启动");
        assert!(!text.contains("http_status:404\n  - hostname"), "catch-all 必须在最后");
    }

    #[test]
    fn empty_service_table_still_makes_a_bootable_config_that_exposes_nothing() {
        let text = build_ingress("tun-1", &Path::new("c.json"), &[]).unwrap();
        assert!(!text.contains("hostname:"), "没登记就不该有任何子域");
        assert!(text.contains("http_status:404"), "整份配置只剩兜底行");
    }

    #[test]
    fn ingress_refuses_anything_that_could_rewrite_the_config() {
        // 子域带换行就能往这份 YAML 里塞第二条 service 行，把 127.0.0.1 的约束绕过去
        let sneaky = IngressRule { hostname: "a.example.com\n  - service: http://10.0.0.9:22".into(), port: 80 };
        let err = build_ingress("tun-1", &Path::new("c.json"), &[sneaky]).unwrap_err();
        assert!(err.to_string().contains("只能用字母"), "{err}");

        let remote = IngressRule { hostname: "a.example.com".into(), port: 0 };
        assert!(build_ingress("tun-1", &Path::new("c.json"), &[remote]).is_err(), "端口没填不能写盘");
        // 隧道 ID 同样来自外部（远端返回），也不能原样拼进 YAML
        assert!(build_ingress("bad id\nx", &Path::new("c.json"), &[]).is_err());
    }

    #[test]
    fn config_lands_at_the_path_run_reads_and_leaves_no_tempfile() {
        let root = temp_root("ingress-write");
        let _ = std::fs::remove_dir_all(secret_dir(&root));
        let rules = vec![IngressRule { hostname: "files.example.com".into(), port: 8421 }];
        let written = write_config(&root, "tun-9", &rules).unwrap();
        assert_eq!(written, config_path(&root, "tun-9"), "必须落在 build_run_args 指的那个文件上");
        let text = std::fs::read_to_string(&written).unwrap();
        assert!(text.contains("http://127.0.0.1:8421"));
        assert!(text.contains(&creds_path(&root, "tun-9").display().to_string()), "凭据路径要写绝对形态");
        assert!(!with_ext(&written, "tmp").exists(), "换名后不留临时文件");

        // 再写一次：整份覆盖，不追加
        write_config(&root, "tun-9", &[]).unwrap();
        let again = std::fs::read_to_string(&written).unwrap();
        assert!(!again.contains("files.example.com"), "{again}");
        let _ = std::fs::remove_dir_all(&secret_dir(&root));
    }

    #[test]
    fn split_report_only_blames_the_other_side() {
        assert!(!split_report(false, 0).conflict, "谁都没跑不算冲突");
        assert!(!split_report(true, 1).conflict, "本机自己那一条不算别处");

        let ours_absent = split_report(false, 1);
        assert!(ours_absent.conflict, "本机没跑却已有一处在服役，正是劈流的前兆");
        assert_eq!(ours_absent.external_count, 1);

        let two = split_report(true, 2);
        assert!(two.conflict);
        assert_eq!((two.live_count, two.external_count), (2, 1));
        assert!(two.message.contains("1 处"), "文案要说清别处有几台：{}", two.message);
    }

    fn run_cli_mock(root: &Path, args: &[String]) -> Result<String, AppError> {
        run_mock(args, &mock_envs(root, &[]), std::time::Duration::from_secs(20))
    }

    #[cfg(windows)]
    #[test]
    fn closing_the_job_handle_kills_the_runner() {
        let root = temp_root("job");
        let _ = std::fs::create_dir_all(tunnel_root(&root));
        clear_runtime_files(&root);

        // 用本机 shell 当假 cloudflared：把自身 PID 写进 pidfile 再挂住不退，
        // 正好落进「进程活着 + 已注册」那一格，且不吃任何外部依赖。
        let script = format!(
            "$PID | Out-File -Encoding ascii '{}'; Start-Sleep -Seconds 120",
            pidfile_path(&root).display()
        );
        let mut args = vec![
            "-NoProfile".to_string(),
            "-NonInteractive".to_string(),
            "-Command".to_string(),
            script,
        ];
        // 生产参数原样附在后面：这条断言顺带证明那串参数不会让进程起不来
        args.extend(build_run_args(&root, "tun-1", CONNECTOR_LABEL));

        let job = ProcessJob::new().unwrap();
        let mut child = spawn_runner(&PathBuf::from("powershell.exe"), &args, &job).unwrap();

        let deadline = Instant::now() + Duration::from_secs(30);
        while !is_registered(&root) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(is_registered(&root), "假 cloudflared 没写出 pidfile");

        // 只关作业句柄，不显式 kill：desko 被强杀时就是这个情形
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                _ if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                _ => panic!("关掉作业句柄后隧道进程还活着：KILL_ON_JOB_CLOSE 没生效"),
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    #[test]
    fn changed_ingress_is_replaced_before_the_connector_restarts() {
        let root = mock_root("reload-config");
        let old = [IngressRule { hostname: "old.example.com".into(), port: 8000 }];
        write_config(&root, "tun-1", &old).unwrap();
        let stopped = std::cell::Cell::new(false);
        let restarted = std::cell::Cell::new(false);
        let next = [IngressRule { hostname: "new.example.com".into(), port: 9000 }];
        apply_config_change(&root, "tun-1", &next, || stopped.set(true), || {
            assert!(stopped.get(), "旧 connector 必须先停止");
            let current = std::fs::read_to_string(config_path(&root, "tun-1")).unwrap();
            assert!(current.contains("new.example.com") && current.contains(":9000"));
            assert!(!current.contains("old.example.com") && !current.contains(":8000"));
            restarted.set(true);
            Ok(())
        }).unwrap();
        assert!(restarted.get());
        apply_config_change(&root, "tun-1", &next,
            || panic!("同一配置不应打断现有连接"), || panic!("同一配置不重启")).unwrap();
        apply_config_change(&root, "tun-1", &[], || {}, || {
            let current = std::fs::read_to_string(config_path(&root, "tun-1")).unwrap();
            assert!(!current.contains("hostname:"));
            Ok(())
        }).unwrap();
    }

    #[test]
    fn login_fallback_stays_in_its_own_home_and_preserves_external_credentials() {
        let root = mock_root("isolated-login");
        let external = root.join("external-home/.cloudflared/cert.pem");
        std::fs::create_dir_all(external.parent().unwrap()).unwrap();
        std::fs::write(&external, b"existing external account").unwrap();
        let mut envs = build_login_envs(&root);
        envs.extend(mock_envs(&root, &[("DESKO_MOCK_LOGIN", "write-home"), ("DESKO_MOCK_DELAY", "10")]));
        run_mock(&build_login_args(&root), &envs, std::time::Duration::from_secs(20)).unwrap();
        let fallback = fallback_cert_path(&root);
        assert!(fallback.starts_with(&root) && fallback.exists());
        assert!(adopt_stray_cert(&root, &fallback));
        assert_eq!(std::fs::read(&external).unwrap(), b"existing external account");
        assert!(cert_path(&root).exists());
    }

}
