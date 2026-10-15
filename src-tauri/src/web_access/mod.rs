//! Opt-in browser access. No native IPC forwarding: bridge.rs is the complete capability list.
mod bridge;
mod codex;
mod events;
mod network;
mod drafts;
mod vault;
#[cfg(test)]
mod tests;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Read,
    net::{IpAddr, Ipv4Addr},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response, Server};

// Lock order: SESSION_GATE -> master_key -> db / note keys. A Web command
// holds read until its own locks/work finish; desktop session mutations hold write.
pub(crate) static SESSION_GATE: std::sync::RwLock<()> = std::sync::RwLock::new(());

fn with_session_epoch<T>(
    expected: u64,
    epoch: impl FnOnce() -> Option<u64>,
    work: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _session = SESSION_GATE.read().map_err(|_| "Web 会话状态无法读取")?;
    if epoch() != Some(expected) {
        return Err("Web 会话已失效，请重新登录".into());
    }
    work()
}

const MAX_BODY: usize = 22 * 1024 * 1024;
const SESSION_IDLE: Duration = Duration::from_secs(30 * 60);
const SESSION_MAX: Duration = Duration::from_secs(12 * 60 * 60);
const COOKIE: &str = "desko_web";

pub(super) struct Resource {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub download: bool,
    pub file: Option<std::fs::File>,
}
pub(super) trait Backend: Send + Sync + 'static {
    fn epoch(&self) -> Option<u64>;
    fn verify_password(&self, password: &str) -> Result<(), String>;
    /// Stateful backends give each browser its own note keys and pending drafts.
    fn fork_session(&self) -> Result<Option<Arc<dyn Backend>>, String> { Ok(None) }
    fn invoke(&self, command: &str, args: Value, expected_epoch: u64) -> Result<Value, String>;
    fn asset(&self, path: &str) -> Option<Resource>;
    fn private_resource(&self, path: &str) -> Result<Resource, String>;
    fn import_shared_file(&self, _: &std::path::Path, _: &str, _: usize, _: u64) -> Result<Value, String> {
        Err("Web 端不支持上传共享文件".into())
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebStatus {
    running: bool,
    lan: bool,
    port: u16,
    urls: Vec<String>,
}
#[derive(Deserialize)]
pub struct StartInput {
    port: u16,
    lan: bool,
}
#[derive(Default)]
pub struct WebAccessState(Mutex<Option<Running>>);
struct Session {
    epoch: u64,
    backend: Arc<dyn Backend>,
    created: Instant,
    used: Instant,
}
struct Attempts {
    count: u32,
    since: Instant,
}
struct Security {
    sessions: HashMap<String, Session>,
    attempts: HashMap<IpAddr, Attempts>,
}
struct Context {
    backend: Arc<dyn Backend>,
    security: Mutex<Security>,
    stopped: AtomicBool,
    lan: bool,
    port: u16,
}
struct Running {
    server: Arc<Server>,
    context: Arc<Context>,
    workers: Vec<thread::JoinHandle<()>>,
    status: WebStatus,
}
impl Running {
    fn signal_stop(&self) {
        self.context.stopped.store(true, Ordering::SeqCst);
        self.context
            .security
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .sessions
            .clear();
    }
    fn stop_and_wait(mut self) {
        self.signal_stop();
        self.server.shutdown();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        self.signal_stop();
        // Workers have bounded receive and socket timeouts. Do not block Tauri's UI thread.
        let workers = std::mem::take(&mut self.workers);
        let server = self.server.clone();
        if !workers.is_empty() {
            thread::spawn(move || {
                server.shutdown();
                for worker in workers {
                    let _ = worker.join();
                }
            });
        }
    }
}
fn token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn header<'a>(req: &'a Request, name: &str) -> Option<&'a str> {
    req.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}
fn valid_host(host: &str, port: u16, lan: bool) -> bool {
    let Some((name, number)) = host.rsplit_once(':') else {
        return false;
    };
    if number.parse::<u16>().ok() != Some(port) {
        return false;
    }
    if name == "localhost" {
        return true;
    }
    name.parse::<Ipv4Addr>()
        .map(|ip| ip.is_loopback() || (lan && (ip.is_private() || ip.is_link_local())))
        .unwrap_or(false)
}
fn same_origin(req: &Request, context: &Context) -> bool {
    let Some(host) = header(req, "Host") else {
        return false;
    };
    if !valid_host(host, context.port, context.lan) {
        return false;
    }
    if let Some(origin) = header(req, "Origin") {
        if origin != format!("http://{host}") {
            return false;
        }
    }
    !matches!(header(req, "Sec-Fetch-Site"), Some("cross-site"))
}
fn cookie_token(req: &Request) -> Option<String> {
    header(req, "Cookie")?.split(';').find_map(|part| {
        let (key, value) = part.trim().split_once('=')?;
        (key == COOKIE && value.len() == 64).then(|| value.to_string())
    })
}
#[derive(Clone)]
struct Authorization {
    epoch: u64,
    token: String,
    backend: Arc<dyn Backend>,
}

fn authorized(ctx: &Context, auth: &Authorization) -> bool {
    if ctx.stopped.load(Ordering::SeqCst) || ctx.backend.epoch() != Some(auth.epoch)
        || auth.backend.epoch() != Some(auth.epoch) {
        return false;
    }
    ctx.security
        .lock()
        .ok()
        .and_then(|security| {
            security.sessions.get(&auth.token).map(|session| {
                session.epoch == auth.epoch
                    && session.used.elapsed() < SESSION_IDLE
                    && session.created.elapsed() < SESSION_MAX
            })
        })
        .unwrap_or(false)
}

fn authenticate(req: &Request, ctx: &Context) -> Option<Authorization> {
    if ctx.stopped.load(Ordering::SeqCst) {
        return None;
    }
    let epoch = ctx.backend.epoch()?;
    let key = cookie_token(req)?;
    let mut security = ctx.security.lock().ok()?;
    security.sessions.retain(|_, session| {
        session.epoch == epoch
            && session.used.elapsed() < SESSION_IDLE
            && session.created.elapsed() < SESSION_MAX
    });
    let session = security.sessions.get_mut(&key)?;
    if req.url() != "/api/session" {
        session.used = Instant::now();
    }
    Some(Authorization { epoch, token: key, backend: session.backend.clone() })
}
fn read_json(req: &mut Request, max: usize) -> Result<Value, String> {
    if !header(req, "Content-Type")
        .unwrap_or("")
        .starts_with("application/json")
    {
        return Err("请求格式应为 JSON".into());
    }
    let len = req.body_length().ok_or("请求缺少内容长度")?;
    if len > max {
        return Err("请求内容过大".into());
    }
    let mut bytes = Vec::with_capacity(len);
    req.as_reader()
        .take((max + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取请求失败")?;
    if bytes.len() > max {
        return Err("请求内容过大".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "请求内容无效".into())
}
fn respond(req: Request, code: u16, resource: Resource, cookie: Option<String>) {
    respond_guarded(req, code, resource, cookie, None);
}
struct GuardedReader {
    reader: Box<dyn Read + Send>,
    context: Arc<Context>,
    authorization: Authorization,
}
impl Read for GuardedReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        if !authorized(&self.context, &self.authorization) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "Web session revoked",
            ));
        }
        self.reader.read(buffer)
    }
}
fn respond_guarded(
    req: Request,
    code: u16,
    resource: Resource,
    cookie: Option<String>,
    guard: Option<(Arc<Context>, Authorization)>,
) {
    let (reader, length): (Box<dyn Read + Send>, usize) = if let Some(file) = resource.file {
        let length = file.metadata().map(|m| m.len() as usize).unwrap_or(0);
        (Box::new(file), length)
    } else {
        let length = resource.bytes.len();
        (Box::new(std::io::Cursor::new(resource.bytes)), length)
    };
    let reader: Box<dyn Read + Send> = if let Some((context, authorization)) = guard {
        Box::new(GuardedReader {
            reader,
            context,
            authorization,
        })
    } else {
        reader
    };
    let mut response = Response::new(
        tiny_http::StatusCode(code),
        Vec::new(),
        reader,
        Some(length),
        None,
    );
    for (name, value) in [
        ("Content-Type", resource.mime.as_str()), ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"), ("X-Frame-Options", "DENY"),
        ("Referrer-Policy", "no-referrer"),
        ("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"),
    ] { response.add_header(Header::from_bytes(name, value).unwrap()); }
    if resource.download {
        response.add_header(Header::from_bytes("Content-Disposition", "attachment").unwrap());
    }
    if let Some(cookie) = cookie {
        response.add_header(Header::from_bytes("Set-Cookie", cookie).unwrap());
    }
    let _ = req.respond(response);
}
fn json_response(req: Request, code: u16, value: Value) {
    respond(
        req,
        code,
        Resource {
            bytes: value.to_string().into_bytes(),
            mime: "application/json; charset=utf-8".into(),
            download: false,
            file: None,
        },
        None,
    );
}
fn authenticated_json(
    req: Request,
    value: Value,
    ctx: &Arc<Context>,
    authorization: Authorization,
) {
    respond_guarded(
        req,
        200,
        Resource {
            bytes: value.to_string().into_bytes(),
            mime: "application/json; charset=utf-8".into(),
            download: false,
            file: None,
        },
        None,
        Some((ctx.clone(), authorization)),
    );
}

fn error(req: Request, code: u16, message: &str) {
    json_response(req, code, json!({"error": message}));
}
fn handle(mut req: Request, ctx: &Arc<Context>) {
    if !same_origin(&req, ctx) {
        return error(req, 403, "仅允许通过本机或局域网地址同源访问");
    }
    let path = req.url().to_string();
    let method = req.method().clone();
    if path == "/api/login" && method == Method::Post {
        let ip = req
            .remote_addr()
            .map(|a| a.ip())
            .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
        // A global cap bounds both memory and PBKDF work, including distributed guessing.
        {
            let mut security = ctx.security.lock().unwrap();
            security
                .attempts
                .retain(|_, a| a.since.elapsed() < Duration::from_secs(60));
            if security.attempts.values().map(|a| a.count).sum::<u32>() >= 20
                || security.attempts.get(&ip).is_some_and(|a| a.count >= 5)
            {
                return error(req, 429, "尝试过于频繁，请一分钟后重试");
            }
            let a = security.attempts.entry(ip).or_insert(Attempts {
                count: 0,
                since: Instant::now(),
            });
            a.count += 1;
        }
        let body = match read_json(&mut req, 2048) {
            Ok(v) => v,
            Err(e) => return error(req, 400, &e),
        };
        let password = body.get("password").and_then(Value::as_str).unwrap_or("");
        if let Err(message) = ctx.backend.verify_password(password) {
            return error(req, 401, &message);
        }
        let Some(epoch) = ctx.backend.epoch() else {
            return error(req, 423, "Web 服务已失效，请在桌面端重新启动服务");
        };
        let backend = match ctx.backend.fork_session() {
            Ok(backend) => backend.unwrap_or_else(|| ctx.backend.clone()),
            Err(message) => return error(req, 423, &message),
        };
        if backend.epoch() != Some(epoch) {
            return error(req, 423, "Web 服务已失效，请在桌面端重新启动服务");
        }
        let now = Instant::now();
        let key = token();
        {
            let mut security = ctx.security.lock().unwrap();
            security.sessions.retain(|_, s| {
                s.epoch == epoch
                    && s.used.elapsed() < SESSION_IDLE
                    && s.created.elapsed() < SESSION_MAX
            });
            // Refreshing this browser replaces its old credential only after
            // successful authentication; failed logins cannot evict a valid session.
            if let Some(previous) = cookie_token(&req) {
                security.sessions.remove(&previous);
            }
            if security.sessions.len() >= 32 {
                return error(
                    req,
                    429,
                    "已达到浏览器会话上限，请退出其他设备或重启 Web 服务",
                );
            }
            security.sessions.insert(
                key.clone(),
                Session {
                    epoch,
                    backend,
                    created: now,
                    used: now,
                },
            );
            security.attempts.remove(&ip);
        }
        return respond(
            req,
            200,
            Resource {
                bytes: b"null".to_vec(),
                mime: "application/json".into(),
                download: false,
                file: None,
            },
            Some(format!(
                "{COOKIE}={key}; Path=/api; HttpOnly; SameSite=Strict"
            )),
        );
    }
    if path.starts_with("/api/") {
        if path == "/api/logout" && method == Method::Post {
            if let Some(key) = cookie_token(&req) {
                ctx.security.lock().unwrap().sessions.remove(&key);
            }
            return respond(
                req,
                200,
                Resource {
                    bytes: b"null".to_vec(),
                    mime: "application/json".into(),
                    download: false,
                    file: None,
                },
                Some(format!(
                    "{COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict"
                )),
            );
        }
        let Some(authorization) = authenticate(&req, ctx) else {
            return error(req, 401, "Web 会话已失效，请使用桌面主密码重新登录");
        };
        if path == "/api/session" && method == Method::Get {
            return authenticated_json(req, json!({"unlocked":true}), ctx, authorization);
        }
        if path.starts_with("/api/share-upload?") && method == Method::Post {
            let result = receive_shared_file(&mut req, ctx, &authorization);
            if !authorized(ctx, &authorization) {
                return error(req, 401, "Web 会话已失效，请重新登录");
            }
            return match result {
                Ok(value) => authenticated_json(req, value, ctx, authorization),
                Err(message) => error(req, 400, &message),
            };
        }
        if path == "/api/invoke" && method == Method::Post {
            let body = match read_json(&mut req, MAX_BODY) {
                Ok(v) => v,
                Err(e) => return error(req, 400, &e),
            };
            // Reading an upload can outlive desktop lock/unlock or browser logout.
            // Never dispatch a previously authenticated request into a new session.
            if !authorized(ctx, &authorization) {
                return error(req, 401, "Web 会话已失效，请重新登录");
            }
            let command = body.get("command").and_then(Value::as_str).unwrap_or("");
            let result = authorization.backend.invoke(
                command,
                body.get("args").cloned().unwrap_or(json!({})),
                authorization.epoch,
            );
            if !authorized(ctx, &authorization) {
                return error(req, 401, "Web 会话已结束，请重新登录");
            }
            return match result {
                Ok(value) => authenticated_json(req, value, ctx, authorization),
                Err(e) => error(req, 400, &e),
            };
        }
        if method == Method::Get || method == Method::Head {
            let result = authorization.backend.private_resource(&path);
            if !authorized(ctx, &authorization) {
                return error(req, 401, "Web 会话已结束，请重新登录");
            }
            return match result {
                Ok(resource) => {
                    respond_guarded(req, 200, resource, None, Some((ctx.clone(), authorization)))
                }
                Err(e) => error(req, 404, &e),
            };
        }
        return error(req, 404, "不支持此操作");
    }
    if method != Method::Get {
        return error(req, 405, "不支持此方法");
    }
    let pathname = path.split('?').next().unwrap_or("");
    if pathname.contains("..") || pathname.contains('\\') || pathname.contains('%') {
        return error(req, 404, "页面不存在");
    }
    let asset_path = match pathname {
        "/" | "/notes" | "/entries" | "/files" | "/mfa" => "index.html",
        _ => pathname.trim_start_matches('/'),
    };
    match ctx.backend.asset(asset_path) {
        Some(mut resource) => {
            if resource.mime.starts_with("text/html") {
                let html = String::from_utf8_lossy(&resource.bytes).replace(
                    "<head>",
                    "<head><meta name=\"desko-runtime\" content=\"web\">",
                );
                resource.bytes = html.into_bytes();
            }
            respond(req, 200, resource, None);
        }
        None => error(req, 404, "页面不存在"),
    }
}
fn receive_shared_file(req: &mut Request, ctx: &Arc<Context>, auth: &Authorization) -> Result<Value, String> {
    use std::io::Write;
    const MAX_UPLOAD: u64 = 4 * 1024 * 1024 * 1024;
    if req.body_length().is_some_and(|len| len as u64 > MAX_UPLOAD) {
        return Err("超过单文件 4 GiB 上限".into());
    }
    let url = reqwest::Url::parse(&format!("http://localhost{}", req.url())).map_err(|_| "上传地址无效")?;
    let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
    let index = params.get("share").and_then(|s| s.parse::<usize>().ok()).ok_or("请选择共享目录")?;
    let name = params.get("name").and_then(|s| fileshare_core::files::sanitize_upload_name(s)).ok_or("文件名无效")?;
    let temp = std::env::temp_dir().join(format!("desko-web-upload-{}", uuid::Uuid::new_v4()));
    let outcome = (|| {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|_| "无法暂存上传文件")?;
        let mut total = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            if !authorized(ctx, auth) { return Err("Web 会话已结束".into()); }
            let len = req.as_reader().read(&mut buffer).map_err(|_| "读取上传文件失败")?;
            if len == 0 { break; }
            total += len as u64;
            if total > MAX_UPLOAD { return Err("超过单文件 4 GiB 上限".into()); }
            file.write_all(&buffer[..len]).map_err(|_| "暂存上传文件失败")?;
        }
        drop(file);
        if !authorized(ctx, auth) { return Err("Web 会话已结束".into()); }
        auth.backend.import_shared_file(&temp, &name, index, auth.epoch)
    })();
    let _ = std::fs::remove_file(temp);
    outcome
}
fn start(
    backend: Arc<dyn Backend>,
    port: u16,
    lan: bool,
) -> Result<Running, String> {
    if backend.epoch().is_none() {
        return Err("请先解锁 Desko".into());
    }
    let server = Arc::new(
        Server::http_with_timeout_and_limit(
            (if lan { "0.0.0.0" } else { "127.0.0.1" }, port),
            Duration::from_secs(10),
            128,
        )
        .map_err(|_| "无法启动，请检查端口是否被占用")?,
    );
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("无法读取监听端口")?
        .port();
    let ctx = Arc::new(Context {
        backend,
        security: Mutex::new(Security {
            sessions: HashMap::new(),
            attempts: HashMap::new(),
        }),
        stopped: AtomicBool::new(false),
        lan,
        port,
    });
    let mut workers = Vec::new();
    for _ in 0..4 {
        let server = server.clone();
        let ctx = ctx.clone();
        workers.push(thread::spawn(move || {
            while !ctx.stopped.load(Ordering::SeqCst) {
                match server.recv_timeout(Duration::from_millis(200)) {
                    Ok(Some(req)) => handle(req, &ctx),
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        }));
    }
    let mut urls = vec![format!("http://127.0.0.1:{port}")];
    if lan {
        let ip = fileshare_core::net::choose_lan_ip();
        let host = format!("{ip}:{port}");
        if valid_host(&host, port, true) && ip.parse::<Ipv4Addr>().is_ok_and(|ip| !ip.is_loopback())
        {
            urls.push(format!("http://{host}"));
        }
    }
    Ok(Running {
        server,
        context: ctx,
        workers,
        status: WebStatus {
            running: true,
            lan,
            port,
            urls,
        },
    })
}
#[tauri::command]
pub fn web_access_status(state: tauri::State<WebAccessState>) -> Result<WebStatus, String> {
    let mut running = state.0.lock().map_err(|_| "无法读取服务状态")?;
    if running.as_ref().is_some_and(|service| service.context.backend.epoch().is_none()) { running.take(); }
    Ok(running.as_ref().map(|service| service.status.clone()).unwrap_or_default())
}
#[tauri::command]
pub async fn web_access_start(app: AppHandle, input: StartInput) -> Result<WebStatus, String> {
    if input.port < 1024 {
        return Err("端口应为 1024～65535".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WebAccessState>();
        let mut running = state.0.lock().map_err(|_| "无法读取服务状态")?;
        if running.is_some() {
            return Err("服务已启动，请先停止再修改配置".into());
        }
        let service = start(
            Arc::new(bridge::AppBackend::new(app.clone())?),
            input.port,
            input.lan,
        )?;
        let status = service.status.clone();
        *running = Some(service);
        Ok(status)
    })
    .await
    .map_err(|_| "服务启动失败")?
}
#[tauri::command]
pub async fn web_access_stop(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WebAccessState>();
        let mut running = state.0.lock().map_err(|_| "无法停止服务")?;
        if let Some(service) = running.take() {
            service.stop_and_wait();
        }
        Ok(())
    })
    .await
    .map_err(|_| "停止服务失败")?
}
pub fn revoke(app: &AppHandle) {
    if let Some(state) = app.try_state::<WebAccessState>() {
        if let Ok(mut service) = state.0.lock() {
            service.take();
        }
    }
}
