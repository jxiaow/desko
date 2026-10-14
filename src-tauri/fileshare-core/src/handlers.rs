//! 路由处理：/ 列表、/download、/upload、/save-text、/settings（仅 POST，首页弹窗提交）、/login。
//! 行为基准 ftp/server.py 的 FileTransferHandler，逐分支对照移植。

use std::io::{BufReader, Cursor, Read};
use std::path::PathBuf;
use std::sync::Arc;

use tiny_http::{Header, Request, Response, StatusCode};

use crate::auth::{sanitize_next, LAN_SCOPE, SESSION_COOKIE};
use crate::config::{ensure_dirs_exist, normalize_share_dirs, PublicPolicy, ShareConfig};
use crate::files::{
    claim_available_name, format_size, list_files, resolve_file_in_share, sanitize_upload_name, FileEntry,
};
use crate::guard::{FailGate, Rule, RULE_HOST, RULE_SOURCE};
use crate::http_util::{
    content_type_of, cookie_get, pair_get, parse_cookie, parse_pairs, percent_decode, split_lines, url_encode,
};
use crate::multipart;
use crate::pages::{self, HomePage, RowData};

const PAGE_SIZE: usize = 20;
const MAX_FORM_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LOGIN_BYTES: u64 = 8 * 1024;
/// 单次上传请求的合计字节上限：挡误操作与恶意灌盘，正常局域网传文件够用
const MAX_UPLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const SESSION_TTL_COOKIE_SECS: u64 = 7 * 24 * 3600;
/// 中文界面字体：与主窗口同一份 HarmonyOS Sans SC 子集，随页面内嵌供出
const APP_FONT: &[u8] = include_bytes!("../../../public/fonts/harmonyos-sans-sc.woff2");

/// 服务运行期共享状态：请求线程与 Tauri 命令共用一份。
pub struct RuntimeState {
    pub config: std::sync::RwLock<ShareConfig>,
    pub sessions: Arc<crate::auth::SessionStore>,
    /// 公网侧登录失败的计数：落文件，重启不清零
    pub gate: Arc<FailGate>,
    /// 网页端改共享目录后写回 meta（SQLite 只能在命令侧摸，这里注入回调）
    pub persist_dirs: Arc<dyn Fn(&[PathBuf]) -> Result<(), String> + Send + Sync>,
    pub bound_port: u16,
    pub lan_ip: String,
    /// 相对目录的落点（配置文件所在目录），由服务进程注入
    pub base_dir: std::path::PathBuf,
}

impl RuntimeState {
    pub fn snapshot(&self) -> ShareConfig {
        match self.config.read() {
            Ok(g) => g.clone(),
            Err(_) => ShareConfig::default(),
        }
    }
}

/// 这一请求从哪一面进来。局域网面一律按老行为走，公网面才受服务表那条策略管
struct Face {
    policy: Option<PublicPolicy>,
    /// 会话归属：局域网一个桶，公网按子域各一个桶
    scope: String,
    /// 失败计数用的来源标识
    src_ip: String,
}

impl Face {
    fn is_public(&self) -> bool {
        self.policy.is_some()
    }

    /// 两维同时计：换来源 IP 绕不开整域那一维
    fn gate_keys(&self) -> Vec<(String, Rule)> {
        vec![
            (format!("{}|{}", self.scope, self.src_ip), RULE_SOURCE),
            (format!("{}|*", self.scope), RULE_HOST),
        ]
    }
}

/// 每请求取一次配置快照，改目录/口令下一个请求即生效（"热加载"等价物）
pub fn handle(mut request: Request, state: Arc<RuntimeState>) {
    let cfg = state.snapshot();
    let url = request.url().to_string();
    let method = request.method().as_str().to_string();
    let content_type = header_of(&request, "content-type");
    let cookie_header = header_of(&request, "cookie");
    let (path, query_raw) = match url.split_once('?') {
        Some((p, q)) => (percent_decode(p), q.to_string()),
        None => (url.clone(), String::new()),
    };
    let query = parse_pairs(&query_raw);
    // 未通过鉴权的正文最多占用 30 秒；连接另有 15 秒无进展超时。
    request.set_body_timeout(std::time::Duration::from_secs(30));

    // 边界防串：Host 只认 IP/localhost（挡 DNS 重绑——rebind 后 Host 是攻击者域名），
    // 外加服务表里逐条登记过的公网子域；POST 再查 Origin 同源与 Sec-Fetch-Site
    let host = url_host(&header_of(&request, "host"));
    let lan_face = host_trusted(&host, &state.lan_ip);
    let policy = cfg.public_policy(&host).cloned();
    if !lan_face && policy.is_none() {
        if let Err(e) = fail(request, text_resp(StatusCode(403), "Forbidden host")) {
            eprintln!("desko fileshare: 回复失败: {}", e);
        }
        return;
    }
    if method == "POST" {
        let sfs = header_of(&request, "sec-fetch-site");
        let origin = url_host(&header_of(&request, "origin"));
        let cross = sfs.eq_ignore_ascii_case("cross-site")
            || (!origin.is_empty() && !origin.eq_ignore_ascii_case(&host));
        if cross {
            if let Err(e) = fail(request, text_resp(StatusCode(403), "Cross-site request rejected")) {
                eprintln!("desko fileshare: 回复失败: {}", e);
            }
            return;
        }
    }

    // 公网面的来源取边缘注的头：socket 对端永远是 127.0.0.1，拿它计数等于全机一个桶。
    // 局域网里的人可以连 Host 一起编来伪造这个值，代价是把自己锁进更严的那一维
    let socket_ip = request
        .remote_addr()
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let cf_ip = header_of(&request, "cf-connecting-ip");
    let src_ip = match &policy {
        // 边缘注入的头必须是合法 IP 才敢当来源：局域网里伪造一条就能把无辜来源
        // 定点锁进错误桶，非法值一律回落到 socket 对端
        Some(_) if cf_ip.parse::<std::net::IpAddr>().is_ok() => cf_ip,
        _ => socket_ip,
    };
    let scope = policy.as_ref().map(|p| p.hostname.to_ascii_lowercase()).unwrap_or_else(|| LAN_SCOPE.to_string());
    let face = Face { policy, scope, src_ip };

    // respond 失败基本都是客户端断连，request 已被消耗，没有补救动作，只留痕
    if let Err(e) = dispatch(request, &state, &cfg, &face, &method, &path, &query, &content_type, &cookie_header) {
        eprintln!("desko fileshare: 回复失败: {}", e);
    }
}

/// 从 Host/Origin 头取裸主机名：去 scheme、去端口、拆 IPv6 方括号
fn url_host(value: &str) -> String {
    let mut s = match value.split_once("://") {
        Some((_, rest)) => rest,
        None => value,
    };
    if let Some((before, _)) = s.split_once('/') {
        s = before;
    }
    if let Some(rest) = s.strip_prefix('[') {
        return rest.split_once(']').map(|(h, _)| h.to_string()).unwrap_or_default();
    }
    match s.rsplit_once(':') {
        Some((h, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => h.to_string(),
        _ => s.to_string(),
    }
}

fn host_trusted(host: &str, lan_ip: &str) -> bool {
    !host.is_empty()
        && (host.eq_ignore_ascii_case("localhost") || host == lan_ip || host.parse::<std::net::IpAddr>().is_ok())
}

type Handled = Result<(), std::io::Error>;

fn dispatch(
    request: Request,
    state: &Arc<RuntimeState>,
    cfg: &ShareConfig,
    face: &Face,
    method: &str,
    path: &str,
    query: &[(String, String)],
    content_type: &str,
    cookie_header: &str,
) -> Handled {
    // 公网面先按这条服务的策略收动作面：口令没配 = 直接不通，宁可打不开也不裸奔；
    // 改共享目录只许 desko 主程序那边动；只读的这条不给写
    if let Some(policy) = &face.policy {
        if policy.password_sha256.is_none() {
            return ok_respond(request, text_resp(StatusCode(403), "这条服务还没设公网口令，desko 不放它上公网"));
        }
        if method == "POST" && path == "/settings" {
            return ok_respond(request, text_resp(StatusCode(403), "公网侧不能改共享目录"));
        }
        if method == "POST" && policy.read_only && matches!(path, "/upload" | "/save-text") {
            return ok_respond(request, text_resp(StatusCode(403), "这条在公网侧是只读的"));
        }
    }

    // 口令门：/login 与字体静态资源之外一律先验会话
    let stored = match &face.policy {
        Some(p) => p.password_sha256.clone(),
        None => cfg.password_sha256.clone(),
    };
    if stored.is_some() && path != "/login" && !path.starts_with("/fonts/") {
        let cookies = parse_cookie(cookie_header);
        let authed = cookie_get(&cookies, SESSION_COOKIE)
            .map(|t| state.sessions.validate(t, &face.scope))
            .unwrap_or(false);
        if !authed {
            let next = original_target(method, path, query);
            return if method == "GET" {
                ok_respond(request, redirect_resp(&format!("/login?next={}", url_encode(&next)), None))
            } else {
                ok_respond(request, html_resp(StatusCode(401), &pages::login_page(Some("口令不正确"), &next), None))
            };
        }
    }

    match (method, path) {
        ("GET", "/") => handle_index(request, state, cfg, query),
        ("GET", "/download") => handle_download(request, state, cfg, query),
        ("POST", "/settings") => handle_settings_post(request, state),
        ("POST", "/upload") => handle_upload(request, state, cfg, query, content_type),
        ("POST", "/save-text") => handle_save_text(request, state, cfg, query),
        ("GET", "/login") => {
            let next = sanitize_next(pair_get(query, "next").unwrap_or(""));
            ok_respond(request, html_resp(StatusCode(200), &pages::login_page(None, &next), None))
        }
        ("GET", "/fonts/app.woff2") => ok_respond(request, font_resp()),
        ("POST", "/login") => handle_login(request, state, face),
        _ => ok_respond(request, text_resp(StatusCode(404), "Not Found")),
    }
}

fn original_target(method: &str, path: &str, query: &[(String, String)]) -> String {
    if method != "GET" {
        return "/".to_string();
    }
    if query.is_empty() {
        path.to_string()
    } else {
        let q = query
            .iter()
            .map(|(k, v)| format!("{}={}", url_encode(k), url_encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("{}?{}", path, q)
    }
}

// ── 首页 / 列表 ──────────────────────────────────────────────

fn handle_index(
    request: Request,
    state: &Arc<RuntimeState>,
    cfg: &ShareConfig,
    query: &[(String, String)],
) -> Handled {
    let message = pair_get(query, "message").unwrap_or("").to_string();
    let page: usize = pair_get(query, "page").and_then(|s| s.parse().ok()).unwrap_or(1);
    let search = pair_get(query, "q").unwrap_or("").to_string();
    let is_partial = pair_get(query, "partial") == Some("1");

    // 无筛选无排序开关：全目录合并，固定按修改时间倒序
    let (rows, count, shown, has_more) = page_entries(cfg, &search, page);
    let count_text = if has_more {
        format!("已显示 {} / {} 个文件", shown, count)
    } else {
        format!("{} 个文件", count)
    };
    let share_index = 0usize;
    let next_page = if has_more { shown / PAGE_SIZE + 1 } else { 0 };

    if is_partial {
        let body = pages::partial_response(
            &count_text,
            &pages::render_more_and(next_page, &search, &pages::render_rows(&rows)),
        );
        return ok_respond(request, html_resp(StatusCode(200), &body, None));
    }

    let dirs: Vec<String> = cfg.share_dirs.iter().map(|d| d.display().to_string()).collect();
    let upload_dir = dirs.first().map(String::as_str).unwrap_or("");
    let html = pages::home_page(&HomePage {
        lan_url: &format!("http://{}:{}", state.lan_ip, state.bound_port),
        toast: if message.is_empty() { None } else { Some(&message) },
        search_q: &search,
        count_text,
        rows_html: pages::render_more_and(next_page, &search, &pages::render_rows(&rows)),
        share_index,
        upload_dir,
        share_dirs: &dirs,
    });
    ok_respond(request, html_resp(StatusCode(200), &html, None))
}

fn page_entries(
    cfg: &ShareConfig,
    search: &str,
    page: usize,
) -> (Vec<RowData>, usize, usize, bool) {
    let mut all: Vec<(usize, FileEntry)> = Vec::new();
    for (i, dir) in cfg.share_dirs.iter().enumerate() {
        for entry in list_files(dir) {
            all.push((i, entry));
        }
    }
    if !search.is_empty() {
        let needle = search.to_lowercase();
        all.retain(|(_, e)| e.name.to_lowercase().contains(&needle));
    }
    // 新的在前；同秒按名升序保证分页稳定
    all.sort_by(|a, b| b.1.mtime.cmp(&a.1.mtime).then(a.1.name.cmp(&b.1.name)));
    let count = all.len();
    let total_pages = ((count + PAGE_SIZE - 1) / PAGE_SIZE).max(1);
    let current = page.clamp(1, total_pages);
    let start = (current - 1) * PAGE_SIZE;
    let end = (start + PAGE_SIZE).min(count);
    let rows = all[start..end]
        .iter()
        .map(|(i, e)| RowData {
            name: e.name.clone(),
            share_index: *i,
            size: format_size(e.size),
            modified: e.modified.clone(),
            share_dir: cfg.share_dirs[*i].display().to_string(),
        })
        .collect();
    (rows, count, end, current < total_pages)
}

// ── 下载 ────────────────────────────────────────────────────

fn handle_download(
    request: Request,
    _state: &Arc<RuntimeState>,
    cfg: &ShareConfig,
    query: &[(String, String)],
) -> Handled {
    let share: Option<usize> = pair_get(query, "share")
        .and_then(|s| s.parse().ok())
        .filter(|i| *i < cfg.share_dirs.len());
    let Some(share_index) = share else {
        return fail(request, text_resp(StatusCode(400), "Invalid share index"));
    };
    let Some(raw_name) = pair_get(query, "name") else {
        return fail(request, text_resp(StatusCode(400), "Invalid filename"));
    };
    let dir = cfg.share_dirs[share_index].clone();
    let Some(target) = resolve_file_in_share(&dir, raw_name) else {
        return fail(request, text_resp(StatusCode(400), "Invalid filename"));
    };
    let Ok(meta) = std::fs::metadata(&target) else {
        return fail(request, text_resp(StatusCode(404), "File not found"));
    };
    if !meta.is_file() {
        return fail(request, text_resp(StatusCode(404), "File not found"));
    }
    let Ok(file) = std::fs::File::open(&target) else {
        return fail(request, text_resp(StatusCode(404), "File not found"));
    };

    // data_length=None → tiny_http 走 chunked，大文件不进内存
    let response = Response::new(
        StatusCode(200),
        download_headers(&target),
        BufReader::new(file),
        None,
        None,
    );
    ok_respond(request, response)
}

/// 文件名纯 ASCII 可打印就直接放，否则 RFC 5987 filename*=UTF-8''（同 ftp 版策略）。
/// 不带 Content-Length——长度交给 chunked。
pub fn download_headers(path: &std::path::Path) -> Vec<Header> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let disposition = if !name.is_empty()
        && name.chars().all(|c| (c as u32) >= 0x20 && (c as u32) < 0x7f)
        && !name.contains('"')
    {
        format!("attachment; filename=\"{}\"", name)
    } else {
        format!("attachment; filename*=UTF-8''{}", url_encode(&name).replace('+', "%20"))
    };
    let mut headers = build_headers(vec![
        ("Content-Type", content_type_of(&name)),
        ("Cache-Control", "no-store"),
    ]);
    headers.extend(Header::from_bytes("Content-Disposition", disposition).ok());
    headers
}

// ── 上传 ────────────────────────────────────────────────────

fn handle_upload(
    mut request: Request,
    _state: &Arc<RuntimeState>,
    cfg: &ShareConfig,
    query: &[(String, String)],
    content_type: &str,
) -> Handled {
    let share: Option<usize> = pair_get(query, "share")
        .and_then(|s| s.parse().ok())
        .filter(|i| *i < cfg.share_dirs.len());
    let Some(share_index) = share else {
        drain_body(&mut request);
        return fail(request, text_resp(StatusCode(400), "Invalid share index"));
    };
    let Some(boundary) = multipart::boundary_from_content_type(content_type) else {
        drain_body(&mut request);
        return fail(request, text_resp(StatusCode(400), "Expected multipart form upload"));
    };
    let dir = cfg.share_dirs[share_index].clone();
    // 只有通过鉴权、动作权限与上传格式校验后才给大文件传输窗口。
    request.set_body_timeout(std::time::Duration::from_secs(4 * 3600));
    let saved_result = multipart::read_multipart(request.as_reader(), &boundary, &dir, MAX_UPLOAD_BYTES);
    let saved = match saved_result {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidInput => {
            return fail(request, text_resp(StatusCode(413), "Upload too large"))
        }
        Err(_) => return fail(request, text_resp(StatusCode(400), "Malformed upload")),
    };
    if saved.is_empty() {
        return fail(request, text_resp(StatusCode(400), "No files uploaded"));
    }
    let target = with_message("/".to_string(), "上传完成");
    ok_respond(request, redirect_resp(&target, None))
}

// ── 文本保存 ────────────────────────────────────────────────

fn handle_save_text(
    mut request: Request,
    _state: &Arc<RuntimeState>,
    cfg: &ShareConfig,
    query: &[(String, String)],
) -> Handled {
    let share: Option<usize> = pair_get(query, "share")
        .and_then(|s| s.parse().ok())
        .filter(|i| *i < cfg.share_dirs.len());
    let Some(share_index) = share else {
        drain_body(&mut request);
        return fail(request, text_resp(StatusCode(400), "Invalid share index"));
    };
    let body_result = multipart::read_limited(request.as_reader(), MAX_FORM_BYTES);
    let body = match body_result {
        Ok(b) => b,
        Err(_) => return fail(request, text_resp(StatusCode(413), "Body too large")),
    };
    let pairs = parse_pairs(&String::from_utf8_lossy(&body));
    let filename = pair_get(&pairs, "filename").unwrap_or("").trim().to_string();
    let content = pair_get(&pairs, "content").unwrap_or("").to_string();
    if filename.is_empty() || content.trim().is_empty() {
        return fail(request, text_resp(StatusCode(400), "Missing filename or content"));
    }
    let name = if filename.to_ascii_lowercase().ends_with(".txt") {
        filename
    } else {
        format!("{}.txt", filename)
    };
    let Some(name) = sanitize_upload_name(&name) else {
        return fail(request, text_resp(StatusCode(400), "Invalid filename"));
    };
    let dir = cfg.share_dirs[share_index].clone();
    let target = match claim_available_name(&dir, &name) {
        Ok(t) => t,
        Err(_) => return fail(request, text_resp(StatusCode(500), "Write failed")),
    };
    if std::fs::write(&target, content.as_bytes()).is_err() {
        let _ = std::fs::remove_file(&target);
        return fail(request, text_resp(StatusCode(500), "Write failed"));
    }
    let redirect = with_message("/".to_string(), "文本已保存");
    ok_respond(request, redirect_resp(&redirect, None))
}

// ── 共享目录设置（首页弹窗 → POST /settings）─────────────────

fn handle_settings_post(request: Request, state: &Arc<RuntimeState>) -> Handled {
    let (request, body) = match read_body(request, MAX_FORM_BYTES) {
        Ok(pair) => pair,
        Err((request, ())) => return fail(request, text_resp(StatusCode(413), "内容过长，请减少目录数量")),
    };
    let pairs = parse_pairs(&String::from_utf8_lossy(&body));
    let text = pair_get(&pairs, "share_dirs").unwrap_or("");
    let new_dirs = normalize_share_dirs(&split_lines(text), &state.base_dir);
    if new_dirs.is_empty() {
        return fail(request, text_resp(StatusCode(400), "请输入共享目录"));
    }
    if let Err(e) = ensure_dirs_exist(&new_dirs) {
        let msg = e.to_string();
        return fail(request, text_resp(StatusCode(400), &msg));
    }
    if let Err(msg) = (state.persist_dirs)(&new_dirs) {
        let toast = format!("保存失败：{}", msg);
        return fail(request, text_resp(StatusCode(500), &toast));
    }
    if let Ok(mut guard) = state.config.write() {
        guard.share_dirs = new_dirs;
    }
    ok_respond(request, redirect_resp(&with_message("/".to_string(), "设置已保存"), None))
}

// ── 登录 ────────────────────────────────────────────────────

fn handle_login(request: Request, state: &Arc<RuntimeState>, face: &Face) -> Handled {
    let (request, body) = match read_body(request, MAX_LOGIN_BYTES) {
        Ok(pair) => pair,
        Err((request, ())) => return fail(request, text_resp(StatusCode(400), "Body too large")),
    };
    let pairs = parse_pairs(&String::from_utf8_lossy(&body));
    let next = sanitize_next(pair_get(&pairs, "next").unwrap_or("/"));
    let password = pair_get(&pairs, "password").unwrap_or("").to_string();
    let public = face.is_public();
    let stored = match &face.policy {
        Some(p) => p.password_sha256.clone(),
        None => state.snapshot().password_sha256,
    };
    let Some(stored) = stored else {
        // 口令已被关掉：直接放行
        return ok_respond(request, redirect_resp(&next, None));
    };
    let keys = face.gate_keys();
    let now = crate::auth::now_secs();
    // 公网侧才限速：局域网那扇门的便利是它存在的理由，端出去就只剩爆破面
    if public {
        let wait = state.gate.wait_secs(&keys, now);
        if wait > 0 {
            return ok_respond(request, locked_resp(&next, wait));
        }
    }
    if !crate::auth::verify_password(&password, &stored) {
        if public {
            // 刚跨过阈值的那一次就按锁定回：401 不带 Retry-After 会把「已锁」
            // 藏到下一次请求才显形，客户端这段时间仍在新试
            let wait = state.gate.record_fail(&keys, now);
            if wait > 0 {
                return ok_respond(request, locked_resp(&next, wait));
            }
        }
        return ok_respond(request, html_resp(StatusCode(401), &pages::login_page(Some("口令不正确"), &next), None));
    }
    if public {
        state.gate.record_success(&keys);
    }
    let token = state.sessions.issue(&face.scope);
    let mut cookie = format!(
        "{}={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        SESSION_COOKIE, token, SESSION_TTL_COOKIE_SECS
    );
    // 公网侧走的是 https 到边缘，Secure 才挂得住；局域网是 http，加了会被浏览器丢掉
    if public {
        cookie.push_str("; Secure");
    }
    ok_respond(request, redirect_resp(&next, Some(cookie)))
}

/// 锁定期内：429 + Retry-After，页面上写还剩多久
fn locked_resp(next: &str, wait: u64) -> Response<Cursor<Vec<u8>>> {
    let body = pages::login_page(Some(&format!("试得太多次了，{} 秒后再试", wait)), next);
    let data = body.as_bytes().to_vec();
    let len = data.len();
    let headers = build_headers(vec![
        ("Content-Type", "text/html; charset=utf-8"),
        ("Retry-After", &wait.to_string()),
    ]);
    Response::new(StatusCode(429), headers, Cursor::new(data), Some(len), None)
}

// ── 响应小工具 ───────────────────────────────────────────────

fn with_message(base_url: String, message: &str) -> String {
    let sep = if base_url.contains('?') { "&" } else { "?" };
    format!("{}{}message={}", base_url, sep, url_encode(message))
}

fn header_of(request: &Request, name: &str) -> String {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.to_string())
        .unwrap_or_default()
}

/// 丢弃式读完 body，让连接能干净复用/关闭；设 64MB 上限防 pathological 输入撑爆内存
fn drain_body(request: &mut Request) {
    let mut buf = [0u8; 64 * 1024];
    let mut left: u64 = 64 * 1024 * 1024;
    loop {
        if left == 0 {
            return;
        }
        match request.as_reader().read(&mut buf) {
            Ok(0) => return,
            Ok(n) => left -= n as u64,
            Err(_) => return,
        }
    }
}

fn read_body(request: Request, limit: u64) -> Result<(Request, Vec<u8>), (Request, ())> {
    let mut request = request;
    let result = multipart::read_limited(request.as_reader(), limit);
    match result {
        Ok(body) => Ok((request, body)),
        Err(_) => Err((request, ())),
    }
}

/// respond 消耗 self；失败只可能是连接已断，无从补救，把错误交给上层留痕
fn ok_respond<R: Read + Send + 'static>(request: Request, response: Response<R>) -> Handled {
    request.respond(response)
}

fn fail<R: Read + Send + 'static>(request: Request, response: Response<R>) -> Handled {
    ok_respond(request, response)
}

fn build_headers(pairs: Vec<(&str, &str)>) -> Vec<Header> {
    pairs
        .into_iter()
        .filter_map(|(k, v)| Header::from_bytes(k, v).ok())
        .collect()
}

fn redirect_resp(location: &str, set_cookie: Option<String>) -> Response<std::io::Empty> {
    let mut headers = build_headers(vec![("Location", location)]);
    if let Some(c) = set_cookie {
        headers.extend(Header::from_bytes("Set-Cookie", c).ok());
    }
    Response::new(StatusCode(302), headers, std::io::empty(), Some(0), None)
}

fn html_resp(status: StatusCode, body: &str, set_cookie: Option<String>) -> Response<Cursor<Vec<u8>>> {
    let data = body.as_bytes().to_vec();
    let len = data.len();
    let mut headers = build_headers(vec![("Content-Type", "text/html; charset=utf-8")]);
    if let Some(c) = set_cookie {
        headers.extend(Header::from_bytes("Set-Cookie", c).ok());
    }
    Response::new(status, headers, Cursor::new(data), Some(len), None)
}

fn text_resp(status: StatusCode, body: &str) -> Response<Cursor<Vec<u8>>> {
    let data = body.as_bytes().to_vec();
    let len = data.len();
    Response::new(
        status,
        build_headers(vec![("Content-Type", "text/plain; charset=utf-8")]),
        Cursor::new(data),
        Some(len),
        None,
    )
}

fn font_resp() -> Response<Cursor<&'static [u8]>> {
    Response::new(
        StatusCode(200),
        build_headers(vec![
            ("Content-Type", "font/woff2"),
            ("Cache-Control", "public, max-age=31536000, immutable"),
        ]),
        Cursor::new(APP_FONT),
        Some(APP_FONT.len()),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn home_url_message_append() {
        assert_eq!(
            with_message("/".to_string(), "上传完成"),
            "/?message=%E4%B8%8A%E4%BC%A0%E5%AE%8C%E6%88%90"
        );
        assert_eq!(with_message("/?share=1".to_string(), "x"), "/?share=1&message=x");
    }

    #[test]
    fn original_target_roundtrip() {
        let q = parse_pairs("share=1&q=a%20b");
        assert_eq!(original_target("GET", "/", &q), "/?share=1&q=a+b");
        assert_eq!(original_target("POST", "/upload", &q), "/");
        assert_eq!(original_target("GET", "/settings", &[]), "/settings");
    }

    #[test]
    fn url_host_extraction() {
        assert_eq!(url_host("127.0.0.1:8000"), "127.0.0.1");
        assert_eq!(url_host("http://192.168.1.5:8000/settings"), "192.168.1.5");
        assert_eq!(url_host("[::1]:8000"), "::1");
        assert_eq!(url_host("http://[::1]:8000/"), "::1");
        assert_eq!(url_host("localhost"), "localhost");
        assert_eq!(url_host("attacker.example"), "attacker.example");
        assert_eq!(url_host(""), "");
    }

    #[test]
    fn host_trusted_only_ips_and_lan() {
        assert!(host_trusted("127.0.0.1", "172.33.0.7"));
        assert!(host_trusted("172.33.0.7", "172.33.0.7"));
        assert!(host_trusted("Localhost", "172.33.0.7"));
        assert!(host_trusted("192.168.1.9", "172.33.0.7")); // 任意 IP 字面量放行（多网卡）
        assert!(!host_trusted("attacker.example", "172.33.0.7")); // DNS 重绑的 Host 是域名
        assert!(!host_trusted("", "172.33.0.7"));
    }

    #[test]
    fn content_disposition_ascii_vs_rfc5987() {
        let h = download_headers(std::path::Path::new(r"C:\s\report.pdf"));
        let disp = h.iter().find(|x| x.field.equiv("Content-Disposition")).unwrap();
        assert!(disp.value.as_str().contains("filename=\"report.pdf\""));
        assert!(!h.iter().any(|x| x.field.equiv("Content-Length")));

        let h = download_headers(std::path::Path::new(r"C:\s\中文.txt"));
        let disp = h.iter().find(|x| x.field.equiv("Content-Disposition")).unwrap();
        assert!(disp.value.as_str().contains("filename*=UTF-8''%E4%B8%AD%E6%96%87.txt"));

        let h = download_headers(std::path::Path::new(r#"C:\s\a\"b.txt"#));
        let disp = h.iter().find(|x| x.field.equiv("Content-Disposition")).unwrap();
        assert!(disp.value.as_str().contains("filename*=UTF-8''"));
    }

    #[test]
    fn page_windowing_clamps_and_slices() {
        let cfg = ShareConfig::default(); // 无目录
        let (rows, count, shown, has_more) = page_entries(&cfg, "", 999);
        assert_eq!((rows.len(), count, shown, has_more), (0, 0, 0, false));
    }

    fn test_state(dirs: Vec<PathBuf>) -> Arc<RuntimeState> {
        test_state_with(dirs, Vec::new())
    }

    fn test_state_with(dirs: Vec<PathBuf>, public: Vec<PublicPolicy>) -> Arc<RuntimeState> {
        Arc::new(RuntimeState {
            config: std::sync::RwLock::new(ShareConfig {
                port: 8000,
                local_only: true,
                share_dirs: dirs,
                password_sha256: None,
                public,
            }),
            sessions: Arc::new(crate::auth::SessionStore::new()),
            gate: Arc::new(FailGate::new(None)),
            persist_dirs: Arc::new(|_| Ok(())),
            bound_port: 8000,
            lan_ip: "127.0.0.1".to_string(),
            base_dir: std::env::temp_dir(),
        })
    }

    /// 起一个真监听，返回 base 端口与停止位
    fn serve(state: Arc<RuntimeState>) -> (u16, Arc<std::sync::atomic::AtomicBool>) {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        std::thread::spawn(move || crate::server::accept_loop(server, state, stop2));
        (port, stop)
    }

    fn no_redirect_agent() -> ureq::Agent {
        ureq::AgentBuilder::new().redirects(0).build()
    }

    /// 手工发一条请求：公网面靠 Host 头认身份，测试必须能指定任意 Host。
    /// 读带超时，服务没回话也只是空响应，不会把测试挂在那里等。
    fn exchange<S: AsRef<str>>(port: u16, headers: &[S], body: &str) -> String {
        use std::io::{Read, Write};
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        let mut req = headers
            .iter()
            .map(|h| h.as_ref().to_string())
            .collect::<Vec<_>>()
            .join("\r\n");
        req.push_str("\r\n\r\n");
        req.push_str(body);
        if stream.write_all(req.as_bytes()).is_err() {
            return String::new();
        }
        let mut buf = Vec::new();
        loop {
            let mut chunk = [0u8; 4096];
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    fn status_of(resp: &str) -> u16 {
        resp.split_whitespace().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0)
    }

    fn header_value(resp: &str, name: &str) -> String {
        resp.lines()
            .find(|line| {
                line.split_once(':')
                    .map(|(k, _)| k.eq_ignore_ascii_case(name))
                    .unwrap_or(false)
            })
            .and_then(|line| line.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
            .unwrap_or_default()
    }

    // 端到端冒烟：真实 socket 走一遍 index/download/upload/save-text
    #[test]
    fn http_roundtrip_smoke() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("desko-http-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("小文件.txt"), "hello 世界".as_bytes()).unwrap();

        let state = test_state(vec![dir.clone()]);
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let st = state.clone();
        std::thread::spawn(move || {
            crate::server::accept_loop(server, st, stop2);
        });
        let base = format!("http://127.0.0.1:{}", port);

        // 首页
        let resp = ureq::get(&format!("{}/", base)).call().unwrap();
        let body = resp.into_string().unwrap();
        assert!(body.contains("小文件.txt") || body.contains("&#23567;"));
        assert!(body.contains("1 个文件"));

        // partial
        let resp = ureq::get(&format!("{}/?partial=1", base)).call().unwrap();
        let body = resp.into_string().unwrap();
        assert!(body.starts_with("1 个文件\n---PARTIAL---\n"));

        // 字体静态资源
        let resp = ureq::get(&format!("{}/fonts/app.woff2", base)).call().unwrap();
        assert_eq!(resp.status(), 200);
        assert_eq!(resp.header("Content-Type").unwrap_or(""), "font/woff2");

        // 搜索未命中
        let resp = ureq::get(&format!("{}/?q=zzzz", base)).call().unwrap();
        let body = resp.into_string().unwrap();
        assert!(body.contains("0 个文件"));

        // 下载：中文名走 RFC5987
        let resp = ureq::get(&format!("{}/download?share=0&name={}", base, url_encode("小文件.txt")))
            .call()
            .unwrap();
        assert_eq!(resp.status(), 200);
        let disp = resp.header("Content-Disposition").unwrap_or("");
        assert!(disp.contains("filename*=UTF-8''"), "disp={}", disp);
        let bytes: Vec<u8> = Vec::new();
        let mut buf = bytes;
        use std::io::Read as _;
        resp.into_reader().take(1024).read_to_end(&mut buf).unwrap();
        assert_eq!(buf, "hello 世界".as_bytes());

        // 路径穿越拒绝
        let err = ureq::get(&format!("{}/download?share=0&name=..%2Fetc%2Fpasswd", base)).call().unwrap_err();
        assert!(matches!(err, ureq::Error::Status(400, _)), "err={:?}", err);

        // 越界 share
        let err = ureq::get(&format!("{}/download?share=99&name=a", base)).call().unwrap_err();
        assert!(matches!(err, ureq::Error::Status(400, _)), "err={:?}", err);

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn upload_and_save_text_roundtrip() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("desko-up-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let state = test_state(vec![dir.clone()]);
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let st = state.clone();
        std::thread::spawn(move || crate::server::accept_loop(server, st, stop2));
        let base = format!("http://127.0.0.1:{}", port);

        // multipart 上传（手工拼 body）
        let boundary = "DESKOTEST";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"上 传.txt\"\r\nContent-Type: text/plain\r\n\r\n", boundary).as_bytes());
        body.extend_from_slice(b"payload-data");
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{}--\r\n", boundary).as_bytes());
        let agent = no_redirect_agent();
        let resp = agent
            .post(&format!("{}/upload?share=0", base))
            .set("Content-Type", &format!("multipart/form-data; boundary={}", boundary))
            .send_bytes(&body)
            .unwrap();
        // 302 → 不自动跟随
        assert_eq!(resp.status() as u16, 302);
        assert!(resp.header("Location").unwrap_or("").contains("message="));
        assert_eq!(fs::read(dir.join("上 传.txt")).unwrap(), b"payload-data");

        // 同名再传 → (1)
        let agent = no_redirect_agent();
        let resp = agent
            .post(&format!("{}/upload?share=0", base))
            .set("Content-Type", &format!("multipart/form-data; boundary={}", boundary))
            .send_bytes(&body)
            .unwrap();
        assert_eq!(resp.status() as u16, 302);
        assert!(dir.join("上 传 (1).txt").exists());

        // save-text
        let form = format!("filename=笔记&content={}", url_encode("line1\nline2"));
        let resp = agent
            .post(&format!("{}/save-text?share=0", base))
            .set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            .send_string(&form)
            .unwrap();
        assert_eq!(resp.status() as u16, 302);
        assert!(dir.join("笔记.txt").exists());
        assert_eq!(fs::read_to_string(dir.join("笔记.txt")).unwrap(), "line1\nline2");

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn settings_post_saves_and_get_is_gone() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("desko-set-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let state = test_state(vec![dir.clone()]);
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let st = state.clone();
        std::thread::spawn(move || crate::server::accept_loop(server, st, stop2));
        let base = format!("http://127.0.0.1:{}", port);
        let agent = no_redirect_agent();

        // 首页带出设置弹窗（目录进 textarea，按钮不再跳独立页）
        let body = ureq::get(&format!("{}/", base)).call().unwrap().into_string().unwrap();
        assert!(body.contains("id=\"set-form\""));
        assert!(body.contains(&crate::http_util::html_escape(&dir.display().to_string())));

        // GET 独立页已移除
        let err = agent.get(&format!("{}/settings", base)).call().unwrap_err();
        assert!(matches!(err, ureq::Error::Status(404, _)), "err={:?}", err);

        // 空目录 → 400 中文提示
        let err = agent
            .post(&format!("{}/settings", base))
            .set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            .send_string("share_dirs=")
            .unwrap_err();
        assert!(matches!(err, ureq::Error::Status(400, _)), "err={:?}", err);

        // 合法目录 → 302 回首页带 message，配置热更新
        let form = format!("share_dirs={}", url_encode(&dir.display().to_string()));
        let resp = agent
            .post(&format!("{}/settings", base))
            .set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            .send_string(&form)
            .unwrap();
        assert_eq!(resp.status() as u16, 302);
        let loc = resp.header("Location").unwrap_or("").to_string();
        assert!(loc.starts_with("/?message="), "loc={}", loc);
        assert_eq!(state.snapshot().share_dirs, vec![dir.clone()]);

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn password_gate_blocks_and_login_clears() {
        use std::fs;
        let dir = std::env::temp_dir().join(format!("desko-gate-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let state = test_state(vec![dir.clone()]);
        {
            let mut cfg = state.config.write().unwrap();
            cfg.password_sha256 = Some(crate::auth::sha256_hex("sesame"));
        }
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let st = state.clone();
        std::thread::spawn(move || crate::server::accept_loop(server, st, stop2));
        let base = format!("http://127.0.0.1:{}", port);
        let agent = no_redirect_agent();

        // 未登录 GET / → 302 到 /login
        let resp = agent.get(&format!("{}/", base)).call().unwrap();
        assert_eq!(resp.status() as u16, 302);
        assert!(resp.header("Location").unwrap_or("").starts_with("/login?next="));

        // 错误口令 → 401
        let err = agent
            .post(&format!("{}/login", base))
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_string("next=%2F&password=wrong")
            .unwrap_err();
        let resp = match err {
            ureq::Error::Status(_code, resp) => resp,
            other => panic!("not a status error: {:?}", other),
        };
        assert_eq!(resp.status() as u16, 401);

        // 正确口令 → 302 + Set-Cookie
        let resp = agent
            .post(&format!("{}/login", base))
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_string("next=%2F&password=sesame")
            .unwrap();
        assert_eq!(resp.status() as u16, 302);
        let cookie = resp.header("Set-Cookie").unwrap_or("");
        assert!(cookie.starts_with("fsid=") && cookie.contains("HttpOnly"), "cookie={}", cookie);
        let token = cookie.split(';').next().unwrap();

        // 带 cookie 可看首页
        let resp = agent.get(&format!("{}/", base)).set("Cookie", token).call().unwrap();
        assert_eq!(resp.status() as u16, 200);

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    // ── 公网面 ──────────────────────────────────────────────

    fn public(host: &str, password: Option<&str>, read_only: bool) -> PublicPolicy {
        PublicPolicy {
            hostname: host.to_string(),
            password_sha256: password.map(crate::auth::sha256_hex),
            read_only,
        }
    }

    /// 公网面要指定任意 Host，只能手工拼请求；长度一律现算，写死一字节差就把服务端吊住
    fn request(method: &str, target: &str, host: &str) -> Vec<String> {
        vec![
            format!("{method} {target} HTTP/1.1"),
            format!("Host: {host}"),
            "Connection: close".to_string(),
        ]
    }

    fn form(body: &str) -> Vec<String> {
        vec![
            "Content-Type: application/x-www-form-urlencoded".to_string(),
            format!("Content-Length: {}", body.len()),
        ]
    }

    fn log_in(port: u16, host: &str, password: &str) -> String {
        let body = format!("next=%2F&password={password}");
        let mut lines = request("POST", "/login", host);
        lines.extend(form(&body));
        let resp = exchange(port, &lines, &body);
        header_value(&resp, "Set-Cookie").split(';').next().unwrap_or("").to_string()
    }

    fn get_as(port: u16, host: &str, target: &str, token: &str) -> String {
        let mut lines = request("GET", target, host);
        if !token.is_empty() {
            lines.push(format!("Cookie: {token}"));
        }
        exchange(port, &lines, "")
    }

    #[test]
    fn unregistered_domain_host_is_rejected() {
        let dir = temp_dir();
        let state = test_state_with(vec![dir.clone()], vec![public("files.example.com", Some("sesame"), false)]);
        let (port, stop) = serve(state);
        let resp = get_as(port, "attacker.example", "/", "");
        assert_eq!(status_of(&resp), 403, "没登记过的域名不该被认成公网面");
        // 局域网面照旧
        assert_eq!(status_of(&get_as(port, "127.0.0.1", "/", "")), 200);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn public_entry_without_password_refuses_everything() {
        let dir = temp_dir();
        // desko 侧本不该把无口令的条目下发，这里验的是 sidecar 自己的兜底
        let state = test_state_with(vec![dir.clone()], vec![public("naked.example.com", None, false)]);
        let (port, stop) = serve(state);
        let resp = get_as(port, "naked.example.com", "/", "");
        assert_eq!(status_of(&resp), 403);
        assert!(resp.contains("还没设公网口令"), "resp={resp}");
        // 连登录页也不给开：没有口令就没有可登的门
        assert_eq!(status_of(&get_as(port, "naked.example.com", "/login", "")), 403);
        // 同一进程上局域网面不受牵连
        assert_eq!(status_of(&get_as(port, "127.0.0.1", "/", "")), 200);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn public_login_sets_secure_cookie_and_stays_on_its_host() {
        let dir = temp_dir();
        let state = test_state_with(
            vec![dir.clone()],
            vec![
                public("files.example.com", Some("sesame"), false),
                public("docs.example.com", Some("other"), false),
            ],
        );
        let (port, stop) = serve(state);
        let body = "next=%2F&password=sesame";
        let mut lines = request("POST", "/login", "files.example.com");
        lines.extend(form(body));
        let resp = exchange(port, &lines, body);
        assert_eq!(status_of(&resp), 302, "resp={resp}");
        let cookie = header_value(&resp, "Set-Cookie");
        assert!(cookie.contains("Secure"), "公网会话必须只走 https：{cookie}");
        let token = cookie.split(';').next().unwrap().to_string();

        assert_eq!(status_of(&get_as(port, "files.example.com", "/", &token)), 200);
        // 拿到隔壁子域去用：另一条有另一条的口令，会话不通用
        let cross = get_as(port, "docs.example.com", "/", &token);
        assert_eq!(status_of(&cross), 302);
        assert!(cross.contains("/login?next="), "resp={cross}");
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_only_public_entry_blocks_writes() {
        let dir = temp_dir();
        let state = test_state_with(vec![dir.clone()], vec![public("ro.example.com", Some("sesame"), true)]);
        let (port, stop) = serve(state);
        let token = log_in(port, "ro.example.com", "sesame");
        assert!(!token.is_empty(), "登录没拿到会话");

        let boundary = "DESKOPUB";
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"x.txt\"\r\nContent-Type: text/plain\r\n\r\ndata\r\n--{boundary}--\r\n"
        );
        let mut lines = request("POST", "/upload?share=0", "ro.example.com");
        lines.push(format!("Cookie: {token}"));
        lines.push(format!("Content-Type: multipart/form-data; boundary={boundary}"));
        lines.push(format!("Content-Length: {}", body.len()));
        let upload = exchange(port, &lines, &body);
        assert_eq!(status_of(&upload), 403);
        assert!(upload.contains("只读"), "resp={upload}");
        assert!(!dir.join("x.txt").exists(), "被拒的上传不能落盘");

        let save_body = "filename=y&content=hello";
        let mut lines = request("POST", "/save-text?share=0", "ro.example.com");
        lines.push(format!("Cookie: {token}"));
        lines.extend(form(save_body));
        assert_eq!(status_of(&exchange(port, &lines, save_body)), 403);
        assert!(!dir.join("y.txt").exists(), "被拒的写文本不能落盘");

        // 读的一面照常
        assert_eq!(status_of(&get_as(port, "ro.example.com", "/", &token)), 200);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn public_face_cannot_change_share_dirs() {
        let dir = temp_dir();
        let state = test_state_with(vec![dir.clone()], vec![public("files.example.com", Some("sesame"), false)]);
        let (port, stop) = serve(state);
        let body = format!("share_dirs={}", url_encode(&dir.display().to_string()));
        let mut lines = request("POST", "/settings", "files.example.com");
        lines.extend(form(&body));
        let resp = exchange(port, &lines, &body);
        assert_eq!(status_of(&resp), 403);
        assert!(resp.contains("不能改共享目录"), "resp={resp}");

        // 同一份表单从局域网面提交仍然有效——收窄只作用于公网面
        let mut lan = request("POST", "/settings", "127.0.0.1");
        lan.extend(form(&body));
        assert_eq!(status_of(&exchange(port, &lan, &body)), 302);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn public_login_locks_out_after_repeated_failures() {
        let dir = temp_dir();
        let state = test_state_with(
            vec![dir.clone()],
            vec![public("files.example.com", Some("sesame"), false)],
        );
        let (port, stop) = serve(state);
        let attempt = |password: &str| {
            let body = format!("next=%2F&password={password}");
            let mut lines = request("POST", "/login", "files.example.com");
            lines.extend(form(&body));
            exchange(port, &lines, &body)
        };
        for i in 0..crate::guard::RULE_SOURCE.limit {
            assert_eq!(status_of(&attempt("wrong")), 401, "第 {} 次不该锁", i + 1);
        }
        // 越过上限的这次当场给 429：锁既然生效了，就不该再装成"口令不对"让人白试
        let locking = attempt("wrong");
        assert_eq!(status_of(&locking), 429, "resp={locking}");
        assert!(locking.contains("Retry-After"), "resp={locking}");
        // 锁定期内：连正确口令也先被挡
        let locked = attempt("sesame");
        assert_eq!(status_of(&locked), 429, "resp={locked}");
        assert!(locked.contains("秒后再试"));

        // 局域网面不受这条子域的锁定影响——便利是它存在的理由
        let mut lan = request("POST", "/login", "127.0.0.1");
        let lan_body = "next=%2F&password=sesame";
        lan.extend(form(lan_body));
        assert_eq!(status_of(&exchange(port, &lan, lan_body)), 302);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        fs::remove_dir_all(&dir).ok();
    }

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("desko-h-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    #[test]
    fn stalled_login_bodies_release_request_slots_without_a_password() {
        use std::{io::Write, time::{Duration, Instant}};
        let dir = temp_dir();
        let state = test_state_with(vec![dir.clone()], vec![public("files.example.com", Some("sesame"), true)]);
        let server = tiny_http::Server::http_with_timeout("127.0.0.1:0", Duration::from_secs(1)).unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let worker = std::thread::spawn(move || crate::server::accept_loop(server, state, flag));
        let mut held = Vec::new();
        for _ in 0..8 {
            let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            stream.write_all(b"POST /login HTTP/1.1\r\nHost: files.example.com\r\nContent-Length: 2048\r\nConnection: close\r\n\r\np").unwrap();
            held.push(stream);
        }
        // 让八个 handler 进入读正文，再证明它们会自行回收，客户端连接仍保持打开。
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(status_of(&get_as(port, "files.example.com", "/login", "")), 503);
        let deadline = Instant::now() + Duration::from_secs(4);
        let mut available = false;
        while Instant::now() < deadline {
            if status_of(&get_as(port, "files.example.com", "/login", "")) == 200 {
                available = true; break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(available, "匿名慢正文不能永久占住所有请求槽");
        drop(held);
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        worker.join().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

}
