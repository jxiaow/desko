//! 局域网文件传输核心库：HTTP 服务的全部逻辑，供 `desko-fileshare` 服务进程使用。
//! 与 desko 主程序解耦：不依赖 tauri/SQLite，配置走 JSON 文件（config.rs）。

pub mod auth;
pub mod config;
pub mod files;
pub mod guard;
pub mod handlers;
pub mod http_util;
pub mod multipart;
pub mod net;
pub mod pages;
pub mod server;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use serde::Serialize;

use config::{ensure_dirs_exist, ShareConfig, PORT_PROBE_SPAN};
use guard::FailGate;
use handlers::RuntimeState;

pub struct Server {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub runtime: Arc<RuntimeState>,
}

impl Server {
    pub fn info(&self) -> ServerInfo {
        server_info(&self.runtime)
    }

    /// 停监听并等 accept 线程退出（200ms 轮询停止位，通常瞬间返回）
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// 服务运行信息：服务进程写进状态文件，desko 主程序读取展示
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub pid: u32,
    pub configured_port: u16,
    pub bound_port: u16,
    pub lan_ip: String,
    pub local_only: bool,
    pub share_count: usize,
}

pub fn server_info(runtime: &Arc<RuntimeState>) -> ServerInfo {
    let cfg = runtime.snapshot();
    ServerInfo {
        pid: std::process::id(),
        configured_port: cfg.effective_port(),
        bound_port: runtime.bound_port,
        lan_ip: runtime.lan_ip.clone(),
        local_only: cfg.local_only,
        share_count: cfg.share_dirs.len(),
    }
}

/// 启动监听：绑意向端口向后探测 PORT_PROBE_SPAN 个。
/// `gate` 由服务进程持有、跨重绑复用：重新绑定不该把已有的失败计数清零。
pub fn start(
    cfg: ShareConfig,
    base_dir: PathBuf,
    persist_dirs: Arc<dyn Fn(&[PathBuf]) -> Result<(), String> + Send + Sync>,
    gate: Arc<FailGate>,
) -> Result<Server, String> {
    if cfg.share_dirs.is_empty() {
        return Err("尚未配置共享目录".to_string());
    }
    ensure_dirs_exist(&cfg.share_dirs)?;

    let bind_ip: std::net::Ipv4Addr = if cfg.local_only {
        [127, 0, 0, 1].into()
    } else {
        [0, 0, 0, 0].into()
    };
    let base_port = cfg.effective_port();
    let mut last_err = String::from("无法监听");
    for offset in 0..=PORT_PROBE_SPAN {
        let port = match base_port.checked_add(offset) {
            Some(p) if p > 0 => p,
            _ => break,
        };
        match tiny_http::Server::http_with_timeout((bind_ip, port), std::time::Duration::from_secs(15)) {
            Ok(server) => {
                let lan_ip = if cfg.local_only {
                    "127.0.0.1".to_string()
                } else {
                    net::choose_lan_ip()
                };
                let runtime = Arc::new(RuntimeState {
                    config: std::sync::RwLock::new(cfg.clone()),
                    sessions: Arc::new(auth::SessionStore::new()),
                    gate,
                    persist_dirs,
                    bound_port: port,
                    lan_ip,
                    base_dir,
                });
                let stop = Arc::new(AtomicBool::new(false));
                let stop_thread = stop.clone();
                let runtime_thread = runtime.clone();
                let thread = std::thread::Builder::new()
                    .name("fileshare-accept".to_string())
                    .spawn(move || server::accept_loop(server, runtime_thread, stop_thread))
                    .map_err(|e| format!("启动服务线程失败: {}", e))?;
                return Ok(Server { stop, thread: Some(thread), runtime });
            }
            Err(e) => last_err = format!("{}（端口 {}）", e, port),
        }
    }
    Err(format!("端口 {} 起连续 {} 个都被占用：{}", base_port, PORT_PROBE_SPAN + 1, last_err))
}

/// 运行中更新内存配置（目录/口令），不重启监听。
pub fn apply_live_config(runtime: &Arc<RuntimeState>, new_cfg: ShareConfig) {
    if let Ok(mut cfg) = runtime.config.write() {
        *cfg = new_cfg;
    }
}

/// 口令变了要作废哪些归属：改一条只踢那一条，别把在传的大文件打断。
/// 只认口令摘要的变化——`readOnly` 收紧不需要旧会话重来，放宽才由 desko 侧把关。
pub fn revoked_scopes(old: &ShareConfig, new: &ShareConfig) -> Vec<String> {
    let mut scopes: Vec<String> = Vec::new();
    if old.password_sha256 != new.password_sha256 {
        scopes.push(auth::LAN_SCOPE.to_string());
    }
    let mut hosts: Vec<String> = Vec::new();
    for p in old.public.iter().chain(new.public.iter()) {
        let host = p.hostname.to_ascii_lowercase();
        if !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    for host in hosts {
        let before = old.public_policy(&host).and_then(|p| p.password_sha256.clone());
        let after = new.public_policy(&host).and_then(|p| p.password_sha256.clone());
        if before != after {
            scopes.push(host);
        }
    }
    scopes
}

/// 作废指定归属的旧会话
pub fn revoke_sessions(runtime: &Arc<RuntimeState>, scopes: &[String]) {
    for scope in scopes {
        runtime.sessions.revoke(scope);
    }
}

/// 组装一个把配置写回 JSON 文件的 persist 回调
pub fn file_persist(path: PathBuf) -> Arc<dyn Fn(&[PathBuf]) -> Result<(), String> + Send + Sync> {
    Arc::new(move |dirs| {
        // 写前重读、只动 shareDirs：与主程序各自整写同一文件时不吞对方字段
        config::update_file(&path, &config::ShareConfig::default(), |cfg| {
            cfg.share_dirs = dirs.to_vec();
        })?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use config::PublicPolicy;

    /// 测试专用随机高端口：port=0 会回落到默认 8000，和真实服务/并发测试撞端口
    /// （tiny_http 开 SO_REUSEADDR，Windows 下双绑不报错、请求随机投递，测试会永久挂起）
    pub(crate) fn ephemeral_port() -> u16 {
        20000 + (rand::random::<u16>() % 40000)
    }

    fn temp_dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("desko-fs-mod-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn persist_none() -> Arc<dyn Fn(&[PathBuf]) -> Result<(), String> + Send + Sync> {
        Arc::new(|_| Ok(()))
    }

    fn gate_none() -> Arc<FailGate> {
        Arc::new(FailGate::new(None))
    }

    fn cfg_with_port(port: u16) -> ShareConfig {
        ShareConfig { port, local_only: true, share_dirs: vec![temp_dir()], ..Default::default() }
    }

    #[test]
    fn start_serves_and_rebind_after_stop() {
        let dir = temp_dir();
        let cfg = ShareConfig {
            port: ephemeral_port(),
            local_only: true,
            share_dirs: vec![dir.clone()],
            ..Default::default()
        };
        let server = start(cfg.clone(), dir.clone(), persist_none(), gate_none()).unwrap();
        let info = server.info();
        let resp = ureq::get(&format!("http://127.0.0.1:{}/", info.bound_port)).call();
        assert!(resp.is_ok(), "服务未响应: {:?}", resp.err());
        // 同端口双绑在 SO_REUSEADDR 下不报错（Windows 特性），所以端口漂移路径由
        // port_drifts_when_busy 专门验证；这里只验证 stop 后能完整重开并服务
        let again = start(cfg, dir.clone(), persist_none(), gate_none());
        if let Ok(dup) = again { dup.stop(); }
        server.stop();
        let rebound = start(cfg_with_port(info.bound_port), dir.clone(), persist_none(), gate_none());
        assert!(rebound.is_ok(), "stop 后端口未释放: {:?}", rebound.err());
        let rebound = rebound.unwrap();
        let resp = ureq::get(&format!("http://127.0.0.1:{}/", rebound.info().bound_port)).call();
        assert!(resp.is_ok(), "重绑后未服务: {:?}", resp.err());
        rebound.stop();
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn port_drifts_when_busy() {
        let taken = tiny_http::Server::http(("127.0.0.1", ephemeral_port())).unwrap();
        let taken_port = taken.server_addr().to_ip().unwrap().port();
        let dir = temp_dir();
        let cfg = ShareConfig {
            port: taken_port,
            local_only: true,
            share_dirs: vec![dir.clone()],
            ..Default::default()
        };
        let server = start(cfg, dir.clone(), persist_none(), gate_none()).unwrap();
        let info = server.info();
        server.stop();
        assert_eq!(info.bound_port, taken_port + 1);
        assert_eq!(info.configured_port, taken_port);
        drop(taken);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn live_config_update_visible_without_restart() {
        let dir_a = temp_dir();
        let dir_b = temp_dir();
        std::fs::File::create(dir_b.join("只在B.txt")).unwrap();
        let cfg = ShareConfig {
            port: ephemeral_port(),
            local_only: true,
            share_dirs: vec![dir_a.clone()],
            ..Default::default()
        };
        let server = start(cfg.clone(), dir_a.clone(), persist_none(), gate_none()).unwrap();
        let port = server.info().bound_port;
        apply_live_config(
            &server.runtime,
            ShareConfig { share_dirs: vec![dir_a.clone(), dir_b.clone()], ..cfg },
        );
        let body = ureq::get(&format!("http://127.0.0.1:{}/?partial=1", port))
            .call()
            .unwrap()
            .into_string()
            .unwrap();
        assert!(body.starts_with("1 个文件"), "新目录未生效: {}", &body[..20.min(body.len())]);
        server.stop();
        std::fs::remove_dir_all(&dir_a).ok();
        std::fs::remove_dir_all(&dir_b).ok();
    }

    #[test]
    fn file_persist_updates_only_share_dirs() {
        let path = std::env::temp_dir().join(format!("desko-persist-{}.json", uuid::Uuid::new_v4()));
        let cfg = ShareConfig {
            port: 8123,
            local_only: true,
            share_dirs: vec![PathBuf::from("a")],
            password_sha256: Some("hash".to_string()),
            ..Default::default()
        };
        config::save_file(&path, &cfg).unwrap();
        let persist = file_persist(path.clone());
        persist(&[PathBuf::from("x"), PathBuf::from("y")]).unwrap();
        let after = config::load_file(&path).unwrap().unwrap();
        assert_eq!(after.share_dirs.len(), 2);
        assert_eq!(after.port, 8123);
        assert_eq!(after.password_sha256.as_deref(), Some("hash"));
        std::fs::remove_file(&path).ok();
    }

    fn policy(host: &str, pw: Option<&str>) -> PublicPolicy {
        PublicPolicy {
            hostname: host.to_string(),
            password_sha256: pw.map(str::to_string),
            read_only: false,
        }
    }

    #[test]
    fn only_the_changed_scope_is_revoked() {
        let old = ShareConfig {
            password_sha256: Some("lan".to_string()),
            public: vec![policy("a.example", Some("pa")), policy("b.example", Some("pb"))],
            ..Default::default()
        };
        let new = ShareConfig {
            password_sha256: Some("lan".to_string()),
            public: vec![policy("a.example", Some("changed")), policy("b.example", Some("pb"))],
            ..Default::default()
        };
        assert_eq!(revoked_scopes(&old, &new), vec!["a.example".to_string()]);

        // 局域网口令变了只动局域网那一桶
        let lan_turned_off = ShareConfig { password_sha256: None, ..new.clone() };
        assert_eq!(
            revoked_scopes(&new, &lan_turned_off),
            vec![auth::LAN_SCOPE.to_string()]
        );
    }

    #[test]
    fn adding_or_dropping_a_public_entry_revokes_its_scope() {
        let with_a = ShareConfig {
            public: vec![policy("a.example", Some("pa"))],
            ..Default::default()
        };
        let empty = ShareConfig::default();
        assert_eq!(revoked_scopes(&with_a, &empty), vec!["a.example".to_string()]);
        assert_eq!(revoked_scopes(&empty, &with_a), vec!["a.example".to_string()]);
    }

    #[test]
    fn read_only_flip_does_not_touch_sessions() {
        let rw = ShareConfig { public: vec![policy("a.example", Some("pa"))], ..Default::default() };
        let mut ro = rw.clone();
        ro.public[0].read_only = true;
        assert!(revoked_scopes(&rw, &ro).is_empty(), "收紧写权限不该把人踢下线");
    }
}
