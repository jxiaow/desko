//! 内网穿透的命令层：二进制获取、授权与建隧道的幂等续做、cloudflared 子进程起停与运行态回填。
//!
//! 与局域网传输那条边车的差别全在「被监督的是外部二进制」这一件事上：它不写我们的状态文件，
//! 也没有 `--parent` 那种自杀看门狗。所以运行态只能从 `--pidfile` 推导（它首次成功连上边缘才写，
//! 不是启动就写），不留孤儿只能靠 Job Object —— desko 被强杀时句柄由系统关闭，组内进程跟着死。
//! 起停要等子进程回话，一律 async：同步命令跑在主线程，轮询 sleep 会冻结窗口消息泵。
//!
//! 授权与建隧道这一段的进度不从远端查（cloudflared 没有 dry-run，也没有"这条域名归不归我"的问法），
//! 而是由本机已有的特征推导：凭据文件在不在、隧道 ID 记没记、凭据有没有归位、子域登记成没成。
//! 中断后重进走的是同一套推导，因此续做的判据只有"文件与记录齐不齐"，没有"上次走到哪"这种会话态。

use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use fileshare_core::config::PublicPolicy;

use crate::db::TunnelService;
use crate::error::AppError;
use crate::services::tunnel_service::{
    self, BinaryDto, ProcessJob, ProvisionFacts, RunStatus, SplitReport, TunnelPlan, TunnelRow,
};
use crate::AppState;

/// 隧道 ID：由授权与建隧道流程写入
const META_TUNNEL_ID: &str = "tunnel_id";
const META_TUNNEL_NAME: &str = "tunnel_name";
/// 唯一一种 desko 自己在请求链路上的服务：只有它挂出去时能强制公网策略
const PRESET_FILESHARE: &str = "fileshare";
/// 公网口令的长度档。下限不是审美：这条门直接对着公网，短一位就少十分之一的爆破代价
const PUBLIC_PW_MIN: usize = 8;
const PUBLIC_PW_MAX: usize = 64;
/// 一张小到不值得维护的常见弱口令表：只收"整串就是它"的形态，不做子串匹配
const WEAK_PUBLIC_PASSWORDS: [&str; 12] = [
    "password", "password1", "passw0rd", "abc123456", "iloveyou", "admin123", "qwertyui",
    "letmein1", "monkey123", "12345678", "11111111", "00000000",
];
/// 从起到认作「注册成功」的等待上限。注册要走外网 TLS，给足，但按钮不能转到天荒地老。
const START_TIMEOUT_MS: u64 = 20_000;
/// 进程死掉时附带的日志尾巴长度：cloudflared 自己的原因比我们的猜测有用
const LOG_TAIL_BYTES: usize = 600;
/// 授权等人去浏览器里点，给足五分钟；到点杀掉进程，别留一个挂着等回调的 cloudflared。
const LOGIN_TIMEOUT_MS: u64 = 300_000;
/// 一次性 CLI（列表/建隧道/指路由）的兜底超时
const CLI_TIMEOUT_MS: u64 = 60_000;
/// `create` 时隧道 ID 还不存在，凭据先落这个名，拿到 ID 后归位成 `<id>.json`
const STAGED_CREDS: &str = "staged.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusDto {
    /// 本机有没有可启动的隧道。没有，页面的启动钮就该说清为什么是灰的
    pub bound: bool,
    #[serde(flatten)]
    pub run: RunStatus,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoginDto {
    /// idle | waiting | authorized | timeout
    pub state: &'static str,
    pub url: Option<String>,
    pub seconds_left: u64,
    /// 授权子进程最后说了什么。早退又没落凭据时，这句就是唯一的原因；
    /// 它自己解释得清（标签页被关、zone 选不了、token 创建被拒），我们替它猜只会猜错。
    pub note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionDto {
    /// no-binary | not-authorized | no-tunnel | missing-credentials | no-services | not-routed | ready
    pub step: &'static str,
    pub message: String,
    pub tunnel_name: Option<String>,
    pub tunnel_id: Option<String>,
    /// 服务表规模。`unroutedCount > 0` 时界面给的出口就是「应用」，不是重新建隧道
    pub service_count: usize,
    pub unrouted_count: usize,
    /// 凭据文件在不在。进度文案会从最早的空缺说起，界面上那一行却要说自己这一格的状态
    pub authorized: bool,
    /// 刚才按名查到的那条隧道不在本机记录里。界面据此才给出「接管」，
    /// 别的失败（网络、解析）不许借用这一格，否则用户会把重复建隧道点成认别人。
    pub name_taken: bool,
}

/// 活着的那条隧道进程和它的作业对象，同生共死：`take()` 出来杀完进程，
/// 作业句柄随 `_job` 一起 Drop，漏网的重启子进程也一并了结。
struct LiveProc {
    child: Child,
    _job: ProcessJob,
}

/// 在途的授权子进程。`url` 与 `tail` 由一条读线程填，界面轮询取。
struct LoginProc {
    child: Child,
    url: Arc<Mutex<Option<String>>>,
    tail: Arc<Mutex<String>>,
    started: std::time::Instant,
    _job: ProcessJob,
}

pub struct TunnelState {
    live: Mutex<Option<LiveProc>>,
    login: Mutex<Option<LoginProc>>,
    /// 启动串行闸：并发 `tunnel_start` 若都先过判活再各自 spawn，会出现两条 connector
    /// 同写 pidfile、抢 metrics 端口，后登记的那条靠 Drop 才杀掉前一条。
    starting: Mutex<()>,
}

impl Default for TunnelState {
    fn default() -> Self {
        TunnelState {
            live: Mutex::new(None),
            login: Mutex::new(None),
            starting: Mutex::new(()),
        }
    }
}

fn root() -> PathBuf {
    crate::paths::profile_root()
}

// ── 进程判活 ─────────────────────────────────────────────────

/// 取走活进程（若有）。已退出的先回收，顺带关掉作业句柄。
fn take_dead_child(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.tunnel.live.lock() else { return };
    let alive = match guard.as_mut() {
        Some(live) => matches!(live.child.try_wait(), Ok(None)),
        None => false,
    };
    if !alive {
        guard.take();
    }
}

fn child_alive(app: &AppHandle) -> bool {
    take_dead_child(app);
    let state = app.state::<AppState>();
    let Ok(guard) = state.tunnel.live.lock() else { return false };
    guard.is_some()
}

fn kill_process(app: &AppHandle) {
    let state = app.state::<AppState>();
    let live = match state.tunnel.live.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    if let Some(live) = live {
        tunnel_service::kill_child(live.child);
        // live._job 在这里 Drop：关掉作业句柄，组内残留进程由系统终止
    }
}

// ── 起停 ─────────────────────────────────────────────────────

fn tunnel_id(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let raw = match state.db.lock() {
        Ok(db) => db.get_meta(META_TUNNEL_ID).ok().flatten().unwrap_or_default(),
        Err(_) => return None,
    };
    let id = raw.trim().to_string();
    (!id.is_empty()).then_some(id)
}

/// 起进程的三个前提各有专属错文：把「没授权」报成「启动失败」会让人去查网络。
fn require_credentials(app: &AppHandle, root: &Path, tunnel_id: &str) -> Result<(), AppError> {
    if !tunnel_service::cert_path(root).exists() {
        return Err(AppError::Tunnel("本机还没有 Cloudflare 授权凭据，无法启动隧道".to_string()));
    }
    // 服务表空 = 一条 ingress 都没有；配置文件哪怕在，也是上一轮删服务后留下的空壳
    if service_counts(app)?.0 == 0 {
        return Err(AppError::Tunnel(
            "这条隧道还没有挂任何本地服务：先登记一项，再启动".to_string(),
        ));
    }
    if !tunnel_service::config_path(root, tunnel_id).exists() {
        return Err(AppError::Tunnel(
            "这条隧道的配置文件不在，点「应用」重写一份再启动".to_string(),
        ));
    }
    Ok(())
}

fn start_inner(app: &AppHandle) -> Result<StatusDto, AppError> {
    // 判活与登记之间隔着下载/起进程，全程占住启动闸；并发的第二路 start
    // 等闸放行后看到的已是活进程，直接回状态。
    let state = app.state::<AppState>();
    let _start_guard = state
        .tunnel
        .starting
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if child_alive(app) {
        return Ok(status_inner(app));
    }
    let root = root();
    let tunnel_id = tunnel_id(app)
        .ok_or_else(|| AppError::Tunnel("还没有可启动的隧道：需要先完成授权与创建".to_string()))?;
    require_credentials(app, &root, &tunnel_id)?;
    // 开门之前先把公网面的门槛重新说一遍：隧道停过、配置件被别的路径重建过，
    // 都不该出现"隧道在跑、公网门槛却还是上一次的"这种两套话
    sync_public(app)?;

    let program = tunnel_service::ensure_binary(&root)?;
    std::fs::create_dir_all(tunnel_service::tunnel_root(&root))
        .map_err(|e| AppError::Tunnel(format!("创建运行目录失败: {}", e)))?;
    // 上一会话的 pidfile 存在过不代表这一次连上了
    tunnel_service::clear_runtime_files(&root);

    let args = tunnel_service::build_run_args(&root, &tunnel_id, tunnel_service::CONNECTOR_LABEL);
    let job = ProcessJob::new()?;
    let child = tunnel_service::spawn_runner(&program, &args, &job)?;
    {
        let state = app.state::<AppState>();
        let Ok(mut guard) = state.tunnel.live.lock() else {
            tunnel_service::kill_child(child);
            return Err(AppError::Database("lock error".to_string()));
        };
        *guard = Some(LiveProc { child, _job: job });
    }

    // 只等两件事：pidfile 出现 = 注册成功；进程退出 = 别再假装在启动
    let step = 200;
    let mut waited = 0;
    while waited < START_TIMEOUT_MS {
        let state = app.state::<AppState>();
        let died = match state.tunnel.live.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(live) => !matches!(live.child.try_wait(), Ok(None)),
                None => true,
            },
            Err(_) => false,
        };
        if died {
            kill_process(app);
            tunnel_service::clear_runtime_files(&root);
            let tail = tunnel_service::tail_log(&root, LOG_TAIL_BYTES).unwrap_or_default();
            return Err(AppError::Tunnel(if tail.is_empty() {
                "隧道进程启动后立即退出，请检查网络出站是否被拦截".to_string()
            } else {
                format!("隧道进程已退出：{}", tail)
            }));
        }
        if tunnel_service::is_registered(&root) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(step));
        waited += step;
    }
    Ok(status_inner(app))
}

fn status_inner(app: &AppHandle) -> StatusDto {
    StatusDto {
        bound: tunnel_id(app).is_some(),
        run: tunnel_service::read_status(&root(), child_alive(app)),
    }
}

// ── 授权与建隧道（P2）───────────────────────────────────────

fn meta_get(app: &AppHandle, key: &str) -> Option<String> {
    let state = app.state::<AppState>();
    let db = state.db.lock().ok()?;
    let raw = db.get_meta(key).ok().flatten().unwrap_or_default();
    let value = raw.trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn meta_set(app: &AppHandle, key: &str, value: &str) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.set_meta(key, value)
}

/// 一次性 CLI 也要给 `TUNNEL_ORIGIN_CERT`：与 `--origincert` 双保险，
/// 因为 `login` 那一侧只有环境变量这条通道可试。
fn run_cli(root: &Path, args: &[String]) -> Result<String, AppError> {
    let program = tunnel_service::ensure_binary(root)?;
    let cert = tunnel_service::cert_path(root).display().to_string();
    tunnel_service::run_cli(
        &program,
        args,
        &[("TUNNEL_ORIGIN_CERT", cert.as_str())],
        std::time::Duration::from_millis(CLI_TIMEOUT_MS),
    )
}

fn require_authorized(root: &Path) -> Result<(), AppError> {
    if tunnel_service::cert_path(root).exists() {
        return Ok(());
    }
    Err(AppError::Tunnel(
        "还没有完成 Cloudflare 授权：本机没有可用的账号凭据".to_string(),
    ))
}

/// 隧道名会进命令行与远端记录，先在本机挡掉明显不合法的输入，
/// 而不是把 cloudflared 的英文原文糊给用户。
fn valid_tunnel_name(name: &str) -> Result<String, AppError> {
    let n = name.trim();
    if n.is_empty() || n.len() > 64 {
        return Err(AppError::Tunnel("隧道名不能为空，且不超过 64 个字符".to_string()));
    }
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Tunnel("隧道名只能用字母、数字、连字符和下划线".to_string()));
    }
    // 名字在 create / list --name 里坐在参数末位，`-x` 开头会被 Go 的 flag 解析吃掉
    if n.starts_with('-') {
        return Err(AppError::Tunnel("隧道名不能以连字符开头，否则会被当成命令行开关".to_string()));
    }
    Ok(n.to_string())
}

/// 子域会直接写进 DNS 与配置文件：只收完整主机名，协议、端口、路径一律拒。
fn valid_hostname(host: &str) -> Result<String, AppError> {
    let h = host.trim().to_ascii_lowercase();
    let ok = !h.is_empty()
        && h.len() <= 253
        && h.contains('.')
        && !h.starts_with('.')
        && !h.ends_with('.')
        && h.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    if !ok {
        return Err(AppError::Tunnel(
            "公网子域要写成完整主机名（例如 tunnel.example.com），不要带协议和路径".to_string(),
        ));
    }
    Ok(h)
}

fn provision_inner(app: &AppHandle) -> ProvisionDto {
    let root = root();
    let id = tunnel_id(app);
    let (service_count, unrouted_count) = match service_counts(app) {
        Ok(pair) => pair,
        Err(_) => (0, 0),
    };
    let facts = ProvisionFacts {
        binary: tunnel_service::binary_status(&root).installed,
        authorized: tunnel_service::cert_path(&root).exists(),
        has_tunnel_id: id.is_some(),
        credentials: id
            .as_ref()
            .map(|i| tunnel_service::creds_path(&root, i).exists())
            .unwrap_or(false),
        has_services: service_count > 0,
        all_routed: service_count > 0 && unrouted_count == 0,
    };
    let (step, message) = tunnel_service::provision_step(&facts);

    ProvisionDto {
        step,
        message,
        tunnel_name: meta_get(app, META_TUNNEL_NAME),
        tunnel_id: id,
        service_count,
        unrouted_count,
        authorized: facts.authorized,
        name_taken: false,
    }
}

fn service_counts(app: &AppHandle) -> Result<(usize, usize), AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let list = db.list_tunnel_services()?;
    let unrouted = list.iter().filter(|s| !s.routed).count();
    Ok((list.len(), unrouted))
}

fn take_login(app: &AppHandle) -> Option<LoginProc> {
    let state = app.state::<AppState>();
    let taken = match state.tunnel.login.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };
    taken
}

fn login_snapshot(app: &AppHandle) -> Option<LoginDto> {
    let state = app.state::<AppState>();
    let guard = state.tunnel.login.lock().ok()?;
    let proc = guard.as_ref()?;
    let url = proc.url.lock().ok().and_then(|g| g.clone());
    let elapsed = proc.started.elapsed().as_millis() as u64;
    Some(LoginDto {
        state: "waiting",
        url,
        seconds_left: LOGIN_TIMEOUT_MS.saturating_sub(elapsed) / 1000,
        note: None,
    })
}

/// 授权子进程此刻的输出尾巴（取走进程之前读，杀完就没得读了）
fn login_tail(app: &AppHandle) -> Option<String> {
    let state = app.state::<AppState>();
    let guard = state.tunnel.login.lock().ok()?;
    let text = guard.as_ref()?.tail.lock().ok()?.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// 授权进程自己退了（用户没点开、被系统拦了都算），凭据又没落位——
/// 不能继续报 waiting 到 5 分钟，把「去授权」按钮白白藏掉。
fn login_child_exited(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.tunnel.login.lock() else { return false };
    match guard.as_mut() {
        Some(proc) => !matches!(proc.child.try_wait(), Ok(None)),
        None => false,
    }
}

/// 授权完成的判据是凭据文件出现，不是命令退出码 —— 它退出时可能什么都没写到。
/// 真 `login` 没有指定 cert 落点的 flag，所以两处都查：我们的目录，以及它默认会写的 `~/.cloudflared`。
fn cert_arrived() -> bool {
    let root = root();
    if tunnel_service::cert_path(&root).exists() {
        return true;
    }
    tunnel_service::fallback_cert_path()
        .map(|stray| tunnel_service::adopt_stray_cert(&root, &stray))
        .unwrap_or(false)
}

fn login_status_inner(app: &AppHandle) -> LoginDto {
    if cert_arrived() {
        // 凭据到手，授权进程自己就会退；仍活着就收掉，不留挂着等回调的进程
        if let Some(proc) = take_login(app) {
            tunnel_service::kill_child(proc.child);
        }
        return LoginDto { state: "authorized", url: None, seconds_left: 0, note: None };
    }
    let tail = login_tail(app);
    match login_snapshot(app) {
        Some(dto) => {
            if dto.seconds_left == 0 {
                if let Some(proc) = take_login(app) {
                    tunnel_service::kill_child(proc.child);
                }
                return LoginDto { state: "timeout", url: dto.url, seconds_left: 0, note: tail };
            }
            if login_child_exited(app) {
                // 早退且没写出凭据：当场收尸，把它最后那句一起带回，用户可以立刻重来一轮
                if let Some(proc) = take_login(app) {
                    tunnel_service::kill_child(proc.child);
                }
                let note = tail.or_else(|| Some("授权进程没等到回调就退了，本机没有落凭据".to_string()));
                return LoginDto { state: "timeout", url: dto.url, seconds_left: 0, note };
            }
            dto
        }
        None => LoginDto { state: "idle", url: None, seconds_left: 0, note: None },
    }
}

fn login_start_inner(app: &AppHandle) -> Result<LoginDto, AppError> {
    if let Some(dto) = login_snapshot(app) {
        return Ok(dto);
    }
    let root = root();
    std::fs::create_dir_all(tunnel_service::secret_dir(&root))
        .map_err(|e| AppError::Tunnel(format!("创建凭据目录失败: {}", e)))?;
    let program = tunnel_service::ensure_binary(&root)?;
    let cert = tunnel_service::cert_path(&root).display().to_string();
    let args = tunnel_service::build_login_args(&root);
    let job = ProcessJob::new()?;
    let (child, stdout) =
        tunnel_service::spawn_login(&program, &args, &[("TUNNEL_ORIGIN_CERT", cert.as_str())], &job)?;

    let url: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let tail: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    {
        let sink = Arc::clone(&url);
        let tail_sink = Arc::clone(&tail);
        std::thread::spawn(move || {
            use std::io::BufRead;
            // 一路读到 EOF：抓到 URL 就丢下管道，等于把子进程后面说的话全扔了，
            // 而它失败那一次说的正是界面上唯一有用的原因。
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(found) = tunnel_service::auth_url_from_line(&line) {
                    if let Ok(mut slot) = sink.lock() {
                        if slot.is_none() {
                            *slot = Some(found);
                        }
                    }
                }
                if let Ok(mut buf) = tail_sink.lock() {
                    *buf = tunnel_service::push_tail(&buf, &line);
                }
            }
        });
    }
    // stdout 已被读线程接管；这里只留进程句柄与输出槽
    let state = app.state::<AppState>();
    let Ok(mut guard) = state.tunnel.login.lock() else {
        tunnel_service::kill_child(child);
        return Err(AppError::Database("lock error".to_string()));
    };
    *guard = Some(LoginProc {
        child,
        url,
        tail,
        started: std::time::Instant::now(),
        _job: job,
    });
    Ok(login_status_inner(app))
}

/// 凭据丢了不必重建隧道：`tunnel token` 能把同一隧道 ID 的凭据再吐一份。
/// 走暂存名再归位，与 `create` 同一条路径，避免两处各写一遍 `<id>.json` 的命名规则。
fn fetch_credentials(id: &str) -> Result<(), AppError> {
    let root = root();
    if tunnel_service::creds_path(&root, id).exists() {
        return Ok(());
    }
    let staged = tunnel_service::secret_dir(&root).join(STAGED_CREDS);
    // create 半途而废时凭据就在暂存名上，先认它，白跑一次远端取凭据是最差的续做
    if staged.exists() {
        return tunnel_service::place_credentials(&root, &staged, id).map(|_| ());
    }
    run_cli(&root, &tunnel_service::build_token_args(&root, id, &staged))?;
    tunnel_service::place_credentials(&root, &staged, id)?;
    Ok(())
}

/// 凭据动作（create / token 补取）共用同一个暂存名 staged.json，
/// 并发交错会把彼此的暂存文件互踩——整体串行。
/// fetch_credentials 只在 ensure_tunnel_inner 里被调，闸只上在这一头。
static PROVISION_LOCK: Mutex<()> = Mutex::new(());

/// 建隧道，或把本机记录里那条续上。
///
/// 有本地记录就只补本机缺的那一格，不再按名问远端 —— 同名重建与误认他处的隧道都出自这一次多余的回答。
/// 没有记录时按名查：查不到才新建；查得到但本机没记录，默认拒绝，`adopt` 才认下（用户明确知道那条就是本机的）。
fn ensure_tunnel_inner(app: &AppHandle, raw_name: &str, adopt: bool) -> Result<ProvisionDto, AppError> {
    let _provision_guard = PROVISION_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let name = valid_tunnel_name(raw_name)?;
    let root = root();
    require_authorized(&root)?;

    if let Some(id) = tunnel_id(app) {
        fetch_credentials(&id)?;
        return Ok(provision_inner(app));
    }

    let listed = run_cli(&root, &tunnel_service::build_list_args(&root, Some(&name)))?;
    let rows: Vec<TunnelRow> = tunnel_service::parse_tunnel_list(&listed)?;
    match tunnel_service::plan_named_tunnel(&rows, adopt) {
        TunnelPlan::Adopt(id) => {
            meta_set(app, META_TUNNEL_ID, &id)?;
            meta_set(app, META_TUNNEL_NAME, &name)?;
            fetch_credentials(&id)?;
            return Ok(provision_inner(app));
        }
        TunnelPlan::NameTaken(id) => {
            return Ok(ProvisionDto {
                name_taken: true,
                message: tunnel_service::name_taken_message(&id),
                ..provision_inner(app)
            });
        }
        TunnelPlan::Create => {}
    }

    let staged = tunnel_service::secret_dir(&root).join(STAGED_CREDS);
    let created = run_cli(&root, &tunnel_service::build_create_args(&root, &name, &staged))?;
    let row = tunnel_service::parse_created(&created)?;
    // 远端已经有了这条隧道，先把 ID 落下：凭据归位万一失败，下次进来读到的就是
    // "凭据缺失"而不是"没建过"，续做才不会走向第二次 create。
    meta_set(app, META_TUNNEL_ID, &row.id)?;
    meta_set(app, META_TUNNEL_NAME, &row.name)?;
    tunnel_service::place_credentials(&root, &staged, &row.id)?;
    Ok(provision_inner(app))
}

fn route_dns_pending(app: &AppHandle) -> Result<Vec<TunnelService>, AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db.list_tunnel_services()?.into_iter().filter(|s| !s.routed).collect())
}

fn ingress_rules(app: &AppHandle) -> Result<Vec<tunnel_service::IngressRule>, AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let mut rules = Vec::new();
    for s in db.list_tunnel_services()? {
        let port = u16::try_from(s.port)
            .map_err(|_| AppError::Tunnel(format!("{} 的端口不在可写的范围", s.hostname)))?;
        rules.push(tunnel_service::IngressRule { hostname: s.hostname, port });
    }
    Ok(rules)
}

/// 服务表 → 磁盘上那份配置。增删改之后一律重算，配置因此只是表的一个投影：
/// 不存在"界面上删掉了、隧道还在往那个端口转"这种第二真相。
fn sync_config(app: &AppHandle) -> Result<(), AppError> {
    let Some(id) = tunnel_id(app) else { return Ok(()) };
    let rules = ingress_rules(app)?;
    tunnel_service::write_config(&root(), &id, &rules)?;
    Ok(())
}

/// 把服务表落到公网：先重写配置，再逐条把子域指过来。
///
/// 逐条而非一次：`route dns` 的失败原因（这个 zone 不在这个账号、记录被别人占着）只有子域能对上号，
/// 而且前面几条已经成功了 —— 整批回滚反而会把好的那几条也说不清。停在哪条就报哪条，
/// 已指的保持 `routed`，再点一次只补剩下的。
fn apply_inner(app: &AppHandle) -> Result<ProvisionDto, AppError> {
    let root = root();
    require_authorized(&root)?;
    let id = tunnel_id(app)
        .ok_or_else(|| AppError::Tunnel("还没有隧道：先建一条，再挂服务".to_string()))?;
    let total = service_counts(app)?.0;
    if total == 0 {
        return Err(AppError::Tunnel(
            "还没有登记要挂出去的本地服务：先添加一项".to_string(),
        ));
    }
    let naked = own_hostnames_without_password(app)?;
    if !naked.is_empty() {
        return Err(AppError::Tunnel(format!(
            "先给「{}」设公网口令——Desko 不把没设口令的服务挂上公网",
            naked.join("」「")
        )));
    }
    sync_config(app)?;
    // 策略先于路由：域名一指过来就可能有人敲门，那扇门得已经带上门槛
    sync_public(app)?;
    for svc in route_dns_pending(app)? {
        run_cli(&root, &tunnel_service::build_route_args(&root, &id, &svc.hostname))
            .map_err(|e| AppError::Tunnel(format!("{} 没能指到这条隧道：{}", svc.hostname, e)))?;
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.set_tunnel_service_routed(&svc.id, true)?;
    }
    Ok(provision_inner(app))
}

/// 劈流探测：这条隧道现在有几处在服役。读的是边缘侧的活 connector 列表 ——
/// 本机 DNS 返 fake-IP，进程表也看不见别处的副本，只有这个说真话。
fn probe_inner(app: &AppHandle) -> Result<SplitReport, AppError> {
    let root = root();
    require_authorized(&root)?;
    let id = tunnel_id(app).ok_or_else(|| AppError::Tunnel("还没有隧道可查".to_string()))?;
    let out = run_cli(&root, &tunnel_service::build_info_args(&root, &id))?;
    let live = tunnel_service::live_connectors(&tunnel_service::parse_connectors(&out)?);
    let ours = tunnel_service::read_status(&root, child_alive(app)).registered;
    Ok(tunnel_service::split_report(ours, live.len()))
}

// ── 服务表（一条隧道挂 N 条「公网子域 → 本机端口」）────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDto {
    pub id: String,
    pub hostname: String,
    pub port: i64,
    pub label: String,
    /// fileshare 时界面才给「口令/只读」那套开关，其余条目 desko 不在请求链路上
    pub preset: String,
    pub routed: bool,
    /// 这一刻本机端口在不在听。列表如实标，不假装"登记了就一定通"
    pub listening: bool,
    /// 公网侧有没有设口令。摘要本身不出后端，界面只需要知道"设过没有"
    pub has_public_password: bool,
    pub public_read_only: bool,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 探活只敲 127.0.0.1 字面量：这台机器的系统解析器对 localhost 返 fake-IP，
/// 用它探活等于每次都被自己骗。
fn port_listening(port: i64) -> bool {
    let Ok(port) = u16::try_from(port) else { return false };
    let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port));
    std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(250)).is_ok()
}

fn valid_port(port: i64) -> Result<u16, AppError> {
    if !(1..=65535).contains(&port) {
        return Err(AppError::Tunnel("本机端口要写 1 到 65535 之间的数字".to_string()));
    }
    Ok(port as u16)
}

fn service_dto(s: TunnelService) -> ServiceDto {
    let listening = port_listening(s.port);
    let has_public_password = !s.public_password_sha256.is_empty();
    ServiceDto {
        id: s.id,
        hostname: s.hostname,
        port: s.port,
        label: s.label,
        preset: s.preset,
        routed: s.routed,
        listening,
        has_public_password,
        public_read_only: s.public_read_only,
    }
}

fn list_services_inner(app: &AppHandle) -> Result<Vec<ServiceDto>, AppError> {
    let state = app.state::<AppState>();
    let rows = state
        .db
        .lock()
        .map_err(|_| AppError::Database("lock error".to_string()))?
        .list_tunnel_services()?;
    // TCP 探测可能达 250ms/行，放锁后再做，别让主线程在等锁时冻住窗口
    Ok(rows.into_iter().map(service_dto).collect())
}

/// 子域撞车要说清撞的是哪一条：同一份子域名下有两行 ingress，指到哪个端口由 cloudflared 的排序决定
fn require_hostname_free(db: &crate::db::Database, host: &str, except_id: &str) -> Result<(), AppError> {
    if let Some(hit) = db.get_tunnel_service_by_hostname(host)? {
        if hit.id != except_id {
            return Err(AppError::Tunnel(format!(
                "{} 已经挂在「{}」上了，一个子域只能指一个端口",
                host, hit.label
            )));
        }
    }
    Ok(())
}

fn add_service_inner(
    app: &AppHandle,
    raw_host: &str,
    port: i64,
    raw_label: &str,
    preset: &str,
) -> Result<Vec<ServiceDto>, AppError> {
    let host = valid_hostname(raw_host)?;
    let port = valid_port(port)?;
    let label = {
        let l = raw_label.trim();
        if l.is_empty() { host.clone() } else { l.to_string() }
    };
    let now = now_ms();
    let row = TunnelService {
        id: uuid::Uuid::new_v4().to_string(),
        hostname: host,
        port: port as i64,
        label,
        preset: preset.trim().to_ascii_lowercase(),
        routed: false,
        // 新建即"无口令 + 只读"：口令得显式设，写的一次性放开
        public_password_sha256: String::new(),
        public_read_only: true,
        created_at: now,
        updated_at: now,
    };
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        require_hostname_free(&db, &row.hostname, "")?;
        db.create_tunnel_service(&row)?;
    }
    sync_config(app)?;
    sync_public(app)?;
    list_services_inner(app)
}

fn update_service_inner(
    app: &AppHandle,
    id: &str,
    raw_host: &str,
    port: i64,
    raw_label: &str,
) -> Result<Vec<ServiceDto>, AppError> {
    let host = valid_hostname(raw_host)?;
    let port = valid_port(port)?;
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        let mut row = db
            .get_tunnel_service(id)?
            .ok_or_else(|| AppError::Tunnel("这条服务已经不在了".to_string()))?;
        require_hostname_free(&db, &host, id)?;
        // 换子域或换端口都得重新指路由，旧的 routed 记录不能留着骗界面
        if row.hostname != host || row.port != port as i64 {
            row.routed = false;
        }
        row.hostname = host;
        row.port = port as i64;
        let label = raw_label.trim();
        if !label.is_empty() {
            row.label = label.to_string();
        }
        row.updated_at = now_ms();
        db.update_tunnel_service(&row)?;
    }
    sync_config(app)?;
    sync_public(app)?;
    list_services_inner(app)
}

fn remove_service_inner(app: &AppHandle, id: &str) -> Result<Vec<ServiceDto>, AppError> {
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.delete_tunnel_service(id)?;
    }
    sync_config(app)?;
    // 删一条要把传输进程的域名白名单一起收窄，否则那个子域虽然不再有人指过来，
    // 进程却还留着"认它"的规矩——第二真相就是这么长出来的
    sync_public(app)?;
    list_services_inner(app)
}

// ── 公网策略（服务表 → 传输进程的 public 投影）──────────────

/// 服务表 → 传输进程读的那份 `public`。只有 desko 自己起的服务进得来：第三方本机端口
/// 不在我们的请求链路上，把它的子域塞给传输进程等于让它去认领一个不归它的面。
/// 摘要为空下发成 `None`，传输进程对那条整站拒 —— 宁可拒客，也不把裸门端出去。
///
/// 读不到表就当作"没有公网面"：这个投影是局域网传输启动路径顺带要用的，
/// 公网那一侧算不出来不该让本机的服务起不来。
pub fn public_projection(app: &AppHandle) -> Vec<PublicPolicy> {
    let state = app.state::<AppState>();
    let Ok(db) = state.db.lock() else { return Vec::new() };
    let Ok(rows) = db.list_tunnel_services() else { return Vec::new() };
    project_policies(rows)
}

fn project_policies(rows: impl IntoIterator<Item = TunnelService>) -> Vec<PublicPolicy> {
    rows.into_iter()
        .filter(|s| s.preset == PRESET_FILESHARE)
        .map(|s| PublicPolicy {
            hostname: s.hostname,
            password_sha256: (!s.public_password_sha256.is_empty()).then_some(s.public_password_sha256),
            read_only: s.public_read_only,
        })
        .collect()
}

/// 把投影下发给传输进程。跟着 `sync_config` 走：ingress 和 `public` 说的是同一批子域，
/// 两边都落完才算一次变更写完
fn sync_public(app: &AppHandle) -> Result<(), AppError> {
    crate::commands::fileshare::write_public_policies(app, public_projection(app))
}

/// 公网口令下限拦一道：长度、字符多样性、整串命中常见弱口令表、单调 ±1 序列。
/// 只做"整串"判断，不做子串匹配——那会把正常口令连带判死，给用户添堵而不是添锁
fn valid_public_password(pw: &str) -> Result<(), AppError> {
    let chars: Vec<char> = pw.chars().collect();
    let len = chars.len();
    if len < PUBLIC_PW_MIN || len > PUBLIC_PW_MAX {
        return Err(AppError::Tunnel(format!(
            "公网口令要 {} 到 {} 个字符，当前 {} 个",
            PUBLIC_PW_MIN, PUBLIC_PW_MAX, len
        )));
    }
    if WEAK_PUBLIC_PASSWORDS.contains(&pw.to_ascii_lowercase().as_str()) {
        return Err(AppError::Tunnel("这个口令太常见，公网侧挡不住脚本".to_string()));
    }
    if chars.iter().collect::<std::collections::HashSet<_>>().len() < 4 {
        return Err(AppError::Tunnel("公网口令至少要有 4 种不同的字符".to_string()));
    }
    let stepped = chars.windows(2).all(|w| {
        let d = w[1] as i32 - w[0] as i32;
        d == 1 || d == -1
    });
    if stepped {
        return Err(AppError::Tunnel("连续或重复的数字（如 12345678）在公网侧形同未设置".to_string()));
    }
    Ok(())
}

/// 挂了 desko 自己的服务却没设公网口令的那些子域。apply 用它拒绝一次半吊子的暴露
fn own_hostnames_without_password(app: &AppHandle) -> Result<Vec<String>, AppError> {
    let state = app.state::<AppState>();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db
        .list_tunnel_services()?
        .into_iter()
        .filter(|s| s.preset == PRESET_FILESHARE && s.public_password_sha256.is_empty())
        .map(|s| s.hostname)
        .collect())
}

/// 一条服务一份公网设置。口令留空 = 不改口令、只动只读位——摘要不回前端，
/// 界面上没有"当前口令"可供原样提交，这是同一个原因
fn set_service_policy_inner(
    app: &AppHandle,
    id: &str,
    raw_password: &str,
    read_only: bool,
) -> Result<Vec<ServiceDto>, AppError> {
    let pw = raw_password.trim();
    if !pw.is_empty() {
        valid_public_password(pw)?;
    }
    let replacement = (!pw.is_empty()).then(|| fileshare_core::auth::sha256_hex(pw));
    {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        let row = db
            .get_tunnel_service(id)?
            .ok_or_else(|| AppError::Tunnel("这条服务已经不在了".to_string()))?;
        if row.preset != PRESET_FILESHARE {
            return Err(AppError::Tunnel(format!(
                "「{}」是本机别的服务，Desko 不在它的请求链路上，设不了公网策略",
                row.label
            )));
        }
        let digest = replacement.unwrap_or_else(|| row.public_password_sha256.clone());
        if digest.is_empty() {
            return Err(AppError::Tunnel(
                "公网侧必须有口令：这条门直接对着外面".to_string(),
            ));
        }
        db.set_tunnel_service_policy(id, &digest, read_only)?;
    }
    sync_public(app)?;
    list_services_inner(app)
}

/// 撤销本机授权：停进程、收在途授权子进程、删掉本地凭据材料。
/// 保留 META 隧道记录与服务表——同一账号重新授权后可走 `fetch_credentials` 恢复。
fn revoke_inner(app: &AppHandle) -> Result<ProvisionDto, AppError> {
    // 先收在途授权：避免删完凭据后浏览器回调又写回一份
    if let Some(proc) = take_login(app) {
        tunnel_service::kill_child(proc.child);
    }
    // 停隧道并清运行时痕迹；不停就删凭据是最坏的那种"已撤销却还在公网面亮着"
    kill_process(app);
    let root = root();
    tunnel_service::clear_runtime_files(&root);

    let secret = tunnel_service::secret_dir(&root);
    let _ = std::fs::remove_file(tunnel_service::cert_path(&root));
    let _ = std::fs::remove_file(secret.join(STAGED_CREDS));
    if let Some(id) = tunnel_id(app) {
        let _ = std::fs::remove_file(tunnel_service::creds_path(&root, &id));
    }
    Ok(provision_inner(app))
}

// ── 命令 ─────────────────────────────────────────────────────

/// 现在处到哪一步。只由本机凭据、隧道 ID、凭据文件与子域记录推导，不碰远端。
#[tauri::command]
pub async fn tunnel_provision_status(app: AppHandle) -> Result<ProvisionDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || provision_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("读取进度失败: {}", e)))
}

/// 起授权。它会自己拉浏览器并阻塞等回调，所以这里的返回不代表授权已完成 ——
/// 完成与否只看 `tunnel_login_status` / `tunnel_provision_status`。
#[tauri::command]
pub async fn tunnel_login_start(app: AppHandle) -> Result<LoginDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || login_start_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("授权任务失败: {}", e)))?
}

#[tauri::command]
pub async fn tunnel_login_status(app: AppHandle) -> Result<LoginDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || login_status_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("读取授权状态失败: {}", e)))
}

#[tauri::command]
pub async fn tunnel_login_cancel(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(proc) = take_login(&app) {
            tunnel_service::kill_child(proc.child);
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Tunnel(format!("取消授权失败: {}", e)))?
}

/// 按名建隧道；本机已有记录时只补本机缺的那一格。
/// `adopt = true` 只来自界面上那句"确认那条就是本机"的显式选择。
#[tauri::command]
pub async fn tunnel_ensure_tunnel(
    name: String,
    adopt: bool,
    app: AppHandle,
) -> Result<ProvisionDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || ensure_tunnel_inner(&app, &name, adopt))
        .await
        .map_err(|e| AppError::Tunnel(format!("建隧道任务失败: {}", e)))?
}

/// 把服务表推到公网：重写配置 + 逐条登记子域。带覆盖语义，重复点不会产生第二份记录。
#[tauri::command]
pub async fn tunnel_apply(app: AppHandle) -> Result<ProvisionDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || apply_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("应用服务失败: {}", e)))?
}

/// 劈流探测：这条隧道现在有几处在服役。
#[tauri::command]
pub async fn tunnel_probe_connectors(app: AppHandle) -> Result<SplitReport, AppError> {
    tauri::async_runtime::spawn_blocking(move || probe_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("探测任务失败: {}", e)))?
}

#[tauri::command]
pub async fn tunnel_binary_status() -> Result<BinaryDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || tunnel_service::binary_status(&root()))
        .await
        .map_err(|e| AppError::Tunnel(format!("读取程序状态失败: {}", e)))
}

#[tauri::command]
pub async fn tunnel_fetch_binary() -> Result<BinaryDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root();
        tunnel_service::ensure_binary(&root)?;
        Ok(tunnel_service::binary_status(&root))
    })
    .await
    .map_err(|e| AppError::Tunnel(format!("获取任务失败: {}", e)))?
}

#[tauri::command]
pub async fn tunnel_status(app: AppHandle) -> Result<StatusDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || status_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("读取运行状态失败: {}", e)))
}

#[tauri::command]
pub async fn tunnel_start(app: AppHandle) -> Result<StatusDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || start_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("启动任务失败: {}", e)))?
}

/// 停当前会话的隧道。设置总开关（入口显隐）不在这里动，与局域网传输同一套语义
#[tauri::command]
pub async fn tunnel_stop(app: AppHandle) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        kill_process(&app);
        tunnel_service::clear_runtime_files(&root());
        Ok(())
    })
    .await
    .map_err(|e| AppError::Tunnel(format!("停止隧道失败: {}", e)))?
}

/// 撤销本机授权。只删本地凭据材料，远端隧道与 DNS 记录不动（见文档"不做：远端资源回收"）。
#[tauri::command]
pub async fn tunnel_revoke(app: AppHandle) -> Result<ProvisionDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || revoke_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("撤销授权失败: {}", e)))?
}

/// 服务列表：每条附带"本机这个端口此刻在不在听"。探测要连 TCP，放 async 别冻窗口。
#[tauri::command]
pub async fn tunnel_list_services(app: AppHandle) -> Result<Vec<ServiceDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || list_services_inner(&app))
        .await
        .map_err(|e| AppError::Tunnel(format!("读取服务列表失败: {}", e)))?
}

#[tauri::command]
pub async fn tunnel_add_service(
    hostname: String,
    port: i64,
    label: String,
    preset: String,
    app: AppHandle,
) -> Result<Vec<ServiceDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || add_service_inner(&app, &hostname, port, &label, &preset))
        .await
        .map_err(|e| AppError::Tunnel(format!("登记服务失败: {}", e)))?
}

#[tauri::command]
pub async fn tunnel_update_service(
    id: String,
    hostname: String,
    port: i64,
    label: String,
    app: AppHandle,
) -> Result<Vec<ServiceDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || update_service_inner(&app, &id, &hostname, port, &label))
        .await
        .map_err(|e| AppError::Tunnel(format!("修改服务失败: {}", e)))?
}

/// 删掉一条服务只是本机的事：远端的 DNS 记录和隧道本身都不动（见文档"不做：远端资源回收"）。
#[tauri::command]
pub async fn tunnel_remove_service(id: String, app: AppHandle) -> Result<Vec<ServiceDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || remove_service_inner(&app, &id))
        .await
        .map_err(|e| AppError::Tunnel(format!("移除服务失败: {}", e)))?
}

/// 设一条服务的公网策略（口令 + 只读）。口令留空表示不改口令、只动只读位；
/// 这条服务还没设过口令时留空会被拒。改完即下发，服务进程一个轮询周期内生效。
#[tauri::command]
pub async fn tunnel_set_service_policy(
    id: String,
    password: String,
    read_only: bool,
    app: AppHandle,
) -> Result<Vec<ServiceDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || set_service_policy_inner(&app, &id, &password, read_only))
        .await
        .map_err(|e| AppError::Tunnel(format!("保存公网设置失败: {}", e)))?
}

// ── 生命周期钩子（main.rs 调用）─────────────────────────────

/// 退出收尾。常态下 desko 一死作业句柄就关，隧道进程本活不过去；这里显式杀一遍，
/// 让正常退出不依赖句柄回收的时机。授权进程也一样：不该留一个挂着等浏览器回调的子进程。
pub fn stop_for_exit(app: &AppHandle) {
    kill_process(app);
    if let Some(proc) = take_login(app) {
        tunnel_service::kill_child(proc.child);
    }
    tunnel_service::clear_runtime_files(&root());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(preset: &str, host: &str, digest: &str, read_only: bool) -> TunnelService {
        TunnelService {
            id: host.to_string(),
            hostname: host.to_string(),
            port: 8421,
            label: host.to_string(),
            preset: preset.to_string(),
            routed: true,
            public_password_sha256: digest.to_string(),
            public_read_only: read_only,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn third_party_rows_never_reach_the_sidecar() {
        // 传输进程只该认领自己那条面：把别家子域下发过去，等于让它去答一个不归它的 Host
        let got = project_policies(vec![
            row(PRESET_FILESHARE, "files.example.com", "abcd", true),
            row("", "dbg.example.com", "abcd", false),
        ]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].hostname, "files.example.com");
        assert_eq!(got[0].password_sha256.as_deref(), Some("abcd"));
        assert!(got[0].read_only);
    }

    #[test]
    fn a_row_without_a_password_is_still_sent_but_as_none() {
        // 这条不送也会被当成陌生域名拒掉，但那样来客读到的是"这个域名不归我"；
        // 如实送一条 None 过去，拒的才是那句说得清的话：这条还没设公网口令
        let got = project_policies(vec![row(PRESET_FILESHARE, "naked.example.com", "", false)]);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].password_sha256, None);
    }

    #[test]
    fn weak_public_passwords_are_refused() {
        for bad in [
            "sesame", // 太短
            "Password", // 常见表
            "aaaaaaaa", // 一种字符
            "12345678", // 顺子，也在常见表里
            "abcdefgh", // 顺子
            "87654321", // 倒子
        ] {
            assert!(valid_public_password(bad).is_err(), "{bad} 不该过");
        }
        assert!(valid_public_password("tr0ubador-9").is_ok());
        assert!(valid_public_password(&"k".repeat(65)).is_err(), "上限也要拦");
    }
}
