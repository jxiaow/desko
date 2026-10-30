//! Public HTTP runs in a headless child. The desktop owns authenticated data
//! contexts and exposes only Backend operations over a private loopback channel.
use super::{Backend, Resource, ResourceStream, WebStatus};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex, Weak,
    },
    thread,
    time::{Duration, Instant},
};
use tiny_http::{Header, Request, Response, Server, StatusCode};

const WORKER_ARG: &str = "--desko-web-worker";

#[derive(Deserialize, Serialize)]
struct Bootstrap {
    address: String,
    secret: String,
    port: u16,
    lan: bool,
}

struct Gateway {
    root: Arc<dyn Backend>,
    sessions: Mutex<HashMap<String, Arc<dyn Backend>>>,
    secret: String,
    stopped: AtomicBool,
    active: AtomicUsize,
    child: Mutex<Option<Weak<Mutex<Child>>>>,
}
impl Gateway {
    fn backend(&self, id: &str) -> Result<Arc<dyn Backend>, String> {
        if id == "root" {
            return Ok(self.root.clone());
        }
        self.sessions
            .lock()
            .map_err(|_| "无法读取 Web 会话")?
            .get(id)
            .cloned()
            .ok_or_else(|| "Web 会话已结束".into())
    }
    fn dispatch(&self, body: &Value) -> Result<Value, String> {
        let id = body["session"].as_str().unwrap_or("root");
        if body["operation"] == "release" {
            self.sessions
                .lock()
                .map_err(|_| "无法读取 Web 会话")?
                .remove(id);
            return Ok(Value::Null);
        }
        let backend = self.backend(id)?;
        match body["operation"].as_str().unwrap_or("") {
            "epoch" => Ok(json!(backend.epoch())),
            "hosts" => Ok(json!(
                backend.public_hosts(super::bridge::arg(body, "port")?)
            )),
            "verify" => {
                backend.verify_password(body["password"].as_str().unwrap_or(""))?;
                Ok(Value::Null)
            }
            "fork" => {
                let backend = backend.fork_session()?.unwrap_or(backend);
                let mut sessions = self.sessions.lock().map_err(|_| "无法读取 Web 会话")?;
                // Public HTTP caps active browsers at 32. Leave room for
                // replacement logins and requests still releasing old sessions.
                if sessions.len() >= 64 {
                    return Err("已达到浏览器会话上限".into());
                }
                let id = super::token();
                sessions.insert(id.clone(), backend);
                Ok(json!(id))
            }
            "invoke" => backend.invoke(
                body["command"].as_str().ok_or("操作无效")?,
                body["args"].clone(),
                super::bridge::arg(body, "epoch")?,
            ),
            "upload" => backend.import_shared_file(
                std::path::Path::new(body["path"].as_str().ok_or("上传路径无效")?),
                body["name"].as_str().ok_or("文件名无效")?,
                super::bridge::arg(body, "index")?,
                super::bridge::arg(body, "epoch")?,
            ),
            _ => Err("内部 Web 操作无效".into()),
        }
    }
    fn handle(&self, mut request: Request) {
        if self.stopped.load(Ordering::SeqCst)
            || request.method() != &tiny_http::Method::Post
            || super::header(&request, "Authorization") != Some(self.secret.as_str())
        {
            let _ = request.respond(Response::empty(StatusCode(403)));
            return;
        }
        let body = match super::read_json(&mut request, super::MAX_BODY) {
            Ok(body) => body,
            Err(error) => {
                super::error(request, 400, &error);
                return;
            }
        };
        if self.stopped.load(Ordering::SeqCst) {
            let _ = request.respond(Response::empty(StatusCode(403)));
            return;
        }
        if request.url() == "/resource" {
            let resource = self
                .backend(body["session"].as_str().unwrap_or("root"))
                .and_then(|backend| {
                    let path = body["path"].as_str().ok_or("资源路径无效")?;
                    if body["public"] == true {
                        backend.asset(path).ok_or_else(|| "页面不存在".into())
                    } else {
                        backend.private_resource(path)
                    }
                });
            match resource {
                Ok(resource) => {
                    let (reader, length): (Box<dyn Read + Send>, usize) = match resource.file {
                        Some(stream) => (stream.reader, stream.length),
                        None => {
                            let len = resource.bytes.len();
                            (Box::new(std::io::Cursor::new(resource.bytes)), len)
                        }
                    };
                    let headers = vec![
                        Header::from_bytes("Content-Type", resource.mime).unwrap(),
                        Header::from_bytes(
                            "X-Desko-Download",
                            if resource.download { "1" } else { "0" },
                        )
                        .unwrap(),
                    ];
                    let _ = request.respond(
                        Response::new(StatusCode(200), headers, reader, Some(length), None)
                            .with_chunked_threshold(usize::MAX),
                    );
                }
                Err(error) => super::error(request, 400, &error),
            }
        } else if request.url() == "/rpc" {
            match self.dispatch(&body) {
                Ok(value) => super::json_response(request, 200, value),
                Err(error) => super::error(request, 400, &error),
            }
        } else {
            let _ = request.respond(Response::empty(StatusCode(404)));
        }
    }
}

struct GatewayServer {
    state: Arc<Gateway>,
    server: Arc<Server>,
    thread: Option<thread::JoinHandle<()>>,
    address: String,
}
impl GatewayServer {
    fn start(backend: Arc<dyn Backend>) -> Result<Self, String> {
        let server = Arc::new(
            Server::http_with_timeout_and_limit(("127.0.0.1", 0), Duration::from_secs(10), 32)
                .map_err(|_| "无法创建内部 Web 通道")?,
        );
        let address = format!(
            "http://{}",
            server
                .server_addr()
                .to_ip()
                .ok_or("无法读取内部 Web 地址")?
        );
        let state = Arc::new(Gateway {
            root: backend,
            sessions: Mutex::new(HashMap::new()),
            secret: super::token(),
            stopped: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            child: Mutex::new(None),
        });
        let context = state.clone();
        let listener = server.clone();
        let thread = thread::spawn(move || {
            while !context.stopped.load(Ordering::SeqCst) {
                let child_exited = context
                    .child
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                    .is_some_and(|child| {
                        child.upgrade().is_none_or(|child| {
                            !matches!(
                                child.lock().unwrap_or_else(|e| e.into_inner()).try_wait(),
                                Ok(None)
                            )
                        })
                    });
                if child_exited || context.root.epoch().is_none() {
                    context.stopped.store(true, Ordering::SeqCst);
                    listener.shutdown();
                    context.root.stop();
                    break;
                }
                let request = match listener.recv_timeout(Duration::from_millis(200)) {
                    Ok(Some(request)) => request,
                    Ok(None) => continue,
                    Err(_) => break,
                };
                if context.active.fetch_add(1, Ordering::SeqCst) >= 16 {
                    context.active.fetch_sub(1, Ordering::SeqCst);
                    let _ = request.respond(Response::empty(StatusCode(429)));
                    continue;
                }
                // Downloads cannot occupy the control channel used to recheck
                // authorization for each chunk of the same download.
                let context = context.clone();
                thread::spawn(move || {
                    context.handle(request);
                    context.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        Ok(Self {
            state,
            server,
            thread: Some(thread),
            address,
        })
    }
}
impl Drop for GatewayServer {
    fn drop(&mut self) {
        self.state.stopped.store(true, Ordering::SeqCst);
        self.state.root.stop();
        self.server.shutdown();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.state
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

pub(super) struct WebProcess {
    child: Arc<Mutex<Child>>,
    input: Option<ChildStdin>,
    gateway: GatewayServer,
    _job: crate::services::tunnel_service::ProcessJob,
    pub status: WebStatus,
}
impl WebProcess {
    pub fn launch(backend: Arc<dyn Backend>, port: u16, lan: bool) -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|_| "无法定位 Web 服务程序")?;
        Self::launch_program(backend, port, lan, &exe)
    }
    fn launch_program(
        backend: Arc<dyn Backend>,
        port: u16,
        lan: bool,
        exe: &std::path::Path,
    ) -> Result<Self, String> {
        let gateway = GatewayServer::start(backend.clone())?;
        let bootstrap = Bootstrap {
            address: gateway.address.clone(),
            secret: gateway.state.secret.clone(),
            port,
            lan,
        };
        let mut command = Command::new(exe);
        command
            .arg(WORKER_ARG)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let job = crate::services::tunnel_service::ProcessJob::new().map_err(|e| e.to_string())?;
        let mut child = command.spawn().map_err(|_| "无法启动独立 Web 服务")?;
        if let Err(error) = job.assign(&child) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.to_string());
        }
        let (Some(mut input), Some(output)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("无法创建 Web 服务控制通道".into());
        };
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(output)
                .take(65536)
                .read_line(&mut line)
                .map_err(|_| "无法读取 Web 服务启动结果".to_string())
                .and_then(|_| {
                    serde_json::from_str::<Value>(&line).map_err(|_| "Web 服务未能启动".into())
                });
            let _ = sender.send(result);
        });
        let startup = (|| {
            serde_json::to_writer(&mut input, &bootstrap).map_err(|_| "无法初始化 Web 服务")?;
            input.write_all(b"\n").map_err(|_| "无法初始化 Web 服务")?;
            input.flush().map_err(|_| "无法初始化 Web 服务")?;
            let value = receiver
                .recv_timeout(Duration::from_secs(15))
                .map_err(|_| "Web 服务启动超时")??;
            if let Some(error) = value["error"].as_str() {
                return Err(error.to_string());
            }
            let mut status: WebStatus =
                serde_json::from_value(value).map_err(|_| "Web 服务状态无效")?;
            status.pid = Some(child.id());
            Ok(status)
        })();
        match startup {
            Ok(status) => {
                let child = Arc::new(Mutex::new(child));
                *gateway
                    .state
                    .child
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(Arc::downgrade(&child));
                Ok(Self {
                    child,
                    input: Some(input),
                    gateway,
                    _job: job,
                    status,
                })
            }
            Err(error) => {
                drop(input);
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }
    pub fn alive(&mut self) -> bool {
        !self.gateway.state.stopped.load(Ordering::SeqCst)
            && self.gateway.state.root.epoch().is_some()
            && matches!(
                self.child
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .try_wait(),
                Ok(None)
            )
    }
    pub fn current_status(&self) -> WebStatus {
        let mut status = self.status.clone();
        status.urls.extend(
            self.gateway
                .state
                .root
                .public_hosts(status.port)
                .into_iter()
                .map(|host| format!("https://{host}")),
        );
        status
    }
}
impl Drop for WebProcess {
    fn drop(&mut self) {
        self.input.take();
        self.gateway.state.stopped.store(true, Ordering::SeqCst);
        self.gateway.state.root.stop();
        let mut child = self.child.lock().unwrap_or_else(|e| e.into_inner());
        let deadline = Instant::now() + Duration::from_secs(3);
        while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        if matches!(child.try_wait(), Ok(None)) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}

struct RemoteBackend {
    address: String,
    secret: String,
    session: String,
    agent: ureq::Agent,
}
impl RemoteBackend {
    fn request(&self, endpoint: &str, mut input: Value) -> Result<ureq::Response, String> {
        input["session"] = json!(self.session);
        let result = self
            .agent
            .post(&format!("{}{endpoint}", self.address))
            .set("Authorization", &self.secret)
            .set("Content-Type", "application/json")
            .send_string(&input.to_string());
        match result {
            Ok(response) => Ok(response),
            Err(ureq::Error::Status(_, response)) => {
                Err(serde_json::from_reader::<_, Value>(response.into_reader())
                    .ok()
                    .and_then(|v| v["error"].as_str().map(str::to_string))
                    .unwrap_or_else(|| "内部 Web 请求失败".into()))
            }
            Err(_) => Err("Desko 数据服务已断开".into()),
        }
    }
    fn rpc(&self, input: Value) -> Result<Value, String> {
        serde_json::from_reader(self.request("/rpc", input)?.into_reader())
            .map_err(|_| "内部 Web 响应无效".into())
    }
    fn resource(&self, path: &str, public: bool) -> Result<Resource, String> {
        let response = self.request("/resource", json!({"path":path,"public":public}))?;
        let mime = response
            .header("Content-Type")
            .unwrap_or("application/octet-stream")
            .to_string();
        let download = response.header("X-Desko-Download") == Some("1");
        let length = response
            .header("Content-Length")
            .and_then(|v| v.parse().ok())
            .ok_or("内部资源长度无效")?;
        let mut reader = response.into_reader();
        if public {
            if length > 32 * 1024 * 1024 {
                return Err("页面资源过大".into());
            }
            let mut bytes = Vec::with_capacity(length);
            reader
                .read_to_end(&mut bytes)
                .map_err(|_| "无法读取页面资源")?;
            Ok(Resource {
                bytes,
                mime,
                download,
                file: None,
            })
        } else {
            Ok(Resource {
                bytes: Vec::new(),
                mime,
                download,
                file: Some(ResourceStream { reader, length }),
            })
        }
    }
}
impl Backend for RemoteBackend {
    fn public_hosts(&self, port: u16) -> Vec<String> {
        self.rpc(json!({"operation":"hosts","port":port}))
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }
    fn epoch(&self) -> Option<u64> {
        self.rpc(json!({"operation":"epoch"})).ok()?.as_u64()
    }
    fn verify_password(&self, password: &str) -> Result<(), String> {
        self.rpc(json!({"operation":"verify","password":password}))
            .map(|_| ())
    }
    fn fork_session(&self) -> Result<Option<Arc<dyn Backend>>, String> {
        let session = self
            .rpc(json!({"operation":"fork"}))?
            .as_str()
            .ok_or("Web 会话无效")?
            .to_string();
        Ok(Some(Arc::new(Self {
            address: self.address.clone(),
            secret: self.secret.clone(),
            session,
            agent: self.agent.clone(),
        })))
    }
    fn invoke(&self, command: &str, args: Value, epoch: u64) -> Result<Value, String> {
        self.rpc(json!({"operation":"invoke","command":command,"args":args,"epoch":epoch}))
    }
    fn asset(&self, path: &str) -> Option<Resource> {
        self.resource(path, true).ok()
    }
    fn private_resource(&self, path: &str) -> Result<Resource, String> {
        self.resource(path, false)
    }
    fn import_shared_file(
        &self,
        path: &std::path::Path,
        name: &str,
        index: usize,
        epoch: u64,
    ) -> Result<Value, String> {
        self.rpc(json!({"operation":"upload","path":path,"name":name,"index":index,"epoch":epoch}))
    }
}
impl Drop for RemoteBackend {
    fn drop(&mut self) {
        if self.session != "root" {
            let _ = self
                .agent
                .post(&format!("{}/rpc", self.address))
                .timeout(Duration::from_secs(1))
                .set("Authorization", &self.secret)
                .set("Content-Type", "application/json")
                .send_string(&json!({"operation":"release","session":self.session}).to_string());
        }
    }
}

pub(super) fn run_worker() -> bool {
    if std::env::args().nth(1).as_deref() != Some(WORKER_ARG) {
        return false;
    }
    worker();
    true
}

fn worker() {
    let mut stdin = BufReader::new(std::io::stdin());
    let mut line = String::new();
    let outcome = (|| -> Result<super::Running, String> {
        stdin
            .by_ref()
            .take(65536)
            .read_line(&mut line)
            .map_err(|_| "无法读取 Web 服务配置")?;
        let input: Bootstrap = serde_json::from_str(&line).map_err(|_| "Web 服务配置无效")?;
        let url = reqwest::Url::parse(&input.address).map_err(|_| "内部 Web 地址无效")?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || input.secret.len() != 64
        {
            return Err("内部 Web 通道无效".into());
        }
        let backend = Arc::new(RemoteBackend {
            address: input.address,
            secret: input.secret,
            session: "root".into(),
            agent: ureq::AgentBuilder::new()
                .timeout_connect(Duration::from_secs(3))
                .timeout(Duration::from_secs(120))
                .build(),
        });
        super::start(backend, input.port, input.lan)
    })();
    let reply = match &outcome {
        Ok(running) => json!(running.status),
        Err(error) => json!({"error":error}),
    };
    let mut stdout = std::io::stdout();
    let _ = writeln!(stdout, "{reply}");
    let _ = stdout.flush();
    if let Ok(running) = outcome {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        thread::spawn(move || {
            let _ = std::io::copy(&mut stdin, &mut std::io::sink());
            let _ = sender.send(());
        });
        while receiver.recv_timeout(Duration::from_secs(1))
            == Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        {
            if running.context.backend.epoch().is_none() {
                break;
            }
        }
        running.stop_and_wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    struct DataBackend(Arc<AtomicU64>);
    impl Backend for DataBackend {
        fn epoch(&self) -> Option<u64> {
            Some(self.0.load(Ordering::SeqCst)).filter(|e| *e != 0)
        }
        fn verify_password(&self, password: &str) -> Result<(), String> {
            if password == "correct" {
                Ok(())
            } else {
                Err("密码错误".into())
            }
        }
        fn fork_session(&self) -> Result<Option<Arc<dyn Backend>>, String> {
            Ok(Some(Arc::new(Self(self.0.clone()))))
        }
        fn invoke(&self, command: &str, args: Value, epoch: u64) -> Result<Value, String> {
            Ok(json!({"command": command, "args": args, "epoch": epoch}))
        }
        fn asset(&self, _: &str) -> Option<Resource> {
            Some(Resource {
                bytes: b"<html><head></head></html>".to_vec(),
                mime: "text/html".into(),
                download: false,
                file: None,
            })
        }
        fn private_resource(&self, _: &str) -> Result<Resource, String> {
            Ok(Resource {
                bytes: vec![],
                mime: "application/octet-stream".into(),
                download: true,
                file: Some(ResourceStream {
                    reader: Box::new(std::io::Cursor::new(vec![42; 128 * 1024])),
                    length: 128 * 1024,
                }),
            })
        }
    }
    fn remote(gateway: &GatewayServer) -> Arc<RemoteBackend> {
        Arc::new(RemoteBackend {
            address: gateway.address.clone(),
            secret: gateway.state.secret.clone(),
            session: "root".into(),
            agent: ureq::AgentBuilder::new()
                .timeout(Duration::from_secs(3))
                .build(),
        })
    }

    #[test]
    fn private_channel_authenticates_forks_releases_and_streams() {
        let epoch = Arc::new(AtomicU64::new(5));
        let gateway = GatewayServer::start(Arc::new(DataBackend(epoch.clone()))).unwrap();
        assert!(ureq::post(&format!("{}/rpc", gateway.address))
            .set("Content-Type", "application/json")
            .send_string("{}")
            .is_err());
        let remote = remote(&gateway);
        assert_eq!(remote.epoch(), Some(5));
        assert_eq!(remote.verify_password("incorrect").unwrap_err(), "密码错误");
        remote.verify_password("correct").unwrap();
        let session = remote.fork_session().unwrap().unwrap();
        assert_eq!(gateway.state.sessions.lock().unwrap().len(), 1);
        assert_eq!(
            session.invoke("echo", json!({"name":"手机"}), 5).unwrap()["args"]["name"],
            "手机"
        );
        let mut resource = session.private_resource("/api/files/test").unwrap();
        assert!(resource.download);
        let stream = resource.file.as_mut().unwrap();
        assert_eq!(stream.length, 128 * 1024);
        let mut bytes = vec![];
        stream.reader.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes, vec![42; 128 * 1024]);
        drop(session);
        assert!(gateway.state.sessions.lock().unwrap().is_empty());
        epoch.store(0, Ordering::SeqCst);
        assert_eq!(remote.epoch(), None);
    }

    #[test]
    fn web_service_uses_the_web_cookie_and_html_identity() {
        let gateway =
            GatewayServer::start(Arc::new(DataBackend(Arc::new(AtomicU64::new(1))))).unwrap();
        let running = super::super::start(remote(&gateway), 0, false).unwrap();
        let url = &running.status.urls[0];
        let cookie = ureq::post(&format!("{url}/api/login"))
            .set("Content-Type", "application/json")
            .send_string(r#"{"password":"correct"}"#)
            .unwrap()
            .header("Set-Cookie")
            .unwrap()
            .to_string();
        assert!(cookie.starts_with("desko_web="));
        let pair = cookie.split(';').next().unwrap().to_string();
        assert!(ureq::get(&format!("{url}/api/session"))
            .set("Cookie", &pair)
            .call()
            .is_ok());
        let html = ureq::get(&format!("{url}/codex"))
            .call()
            .unwrap()
            .into_string()
            .unwrap();
        assert!(html.contains("name=\"desko-runtime\" content=\"web\""));
        assert!(!html.contains("desko-service"));
        running.stop_and_wait();
    }

    #[test]
    fn replacing_login_at_browser_limit_does_not_exhaust_internal_sessions() {
        let gateway =
            GatewayServer::start(Arc::new(DataBackend(Arc::new(AtomicU64::new(1))))).unwrap();
        let running = super::super::start(remote(&gateway), 0, false).unwrap();
        let url = &running.status.urls[0];
        let login = |cookie: &str| {
            ureq::post(&format!("{url}/api/login"))
                .set("Content-Type", "application/json")
                .set("Cookie", cookie)
                .send_string(r#"{"password":"correct"}"#)
        };
        let mut cookie = String::new();
        for _ in 0..32 {
            cookie = login("").unwrap().header("Set-Cookie").unwrap().to_string();
        }
        assert!(matches!(login(""), Err(ureq::Error::Status(429, _))));
        let replacement = login(&cookie)
            .unwrap()
            .header("Set-Cookie")
            .unwrap()
            .to_string();
        assert!(ureq::get(&format!("{url}/api/session"))
            .set("Cookie", &cookie)
            .call()
            .is_err());
        assert!(ureq::get(&format!("{url}/api/session"))
            .set("Cookie", &replacement)
            .call()
            .is_ok());
        assert_eq!(gateway.state.sessions.lock().unwrap().len(), 32);
        running.stop_and_wait();
    }

    #[test]
    #[ignore = "requires cargo build -p desko first; starts headless fixture workers only"]
    fn separate_worker_processes_are_supervised_and_restart_independently() {
        let executable = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(format!("desko{}", std::env::consts::EXE_SUFFIX));
        assert!(executable.is_file(), "先运行 cargo build -p desko");
        let first = Arc::new(DataBackend(Arc::new(AtomicU64::new(1))));
        let second = Arc::new(DataBackend(Arc::new(AtomicU64::new(1))));
        let mut app = WebProcess::launch_program(first.clone(), 0, false, &executable).unwrap();
        let mut other = WebProcess::launch_program(second, 0, false, &executable).unwrap();
        assert_ne!(app.status.pid, other.status.pid);
        assert_ne!(app.status.pid, Some(std::process::id()));
        let port = app.status.port;
        let login = |service: &WebProcess| {
            ureq::post(&format!("{}/api/login", service.status.urls[0]))
                .set("Content-Type", "application/json")
                .send_string(r#"{"password":"correct"}"#)
                .unwrap()
                .header("Set-Cookie")
                .unwrap()
                .to_string()
        };
        let cookie = login(&app);
        let response = ureq::get(&format!("{}/api/files/test", app.status.urls[0]))
            .set("Cookie", &cookie)
            .call()
            .unwrap();
        let mut bytes = Vec::new();
        response.into_reader().read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 128 * 1024);
        app.child.lock().unwrap().kill().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while !app.gateway.state.stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(app.gateway.state.stopped.load(Ordering::SeqCst));
        assert!(!app.alive());
        assert!(other.alive());
        drop(app);
        let mut restarted =
            WebProcess::launch_program(first.clone(), port, false, &executable).unwrap();
        assert_eq!(restarted.status.port, port);
        assert!(
            ureq::get(&format!("{}/api/session", restarted.status.urls[0]))
                .set("Cookie", &cookie)
                .call()
                .is_err()
        );
        first.0.store(0, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(4);
        while matches!(restarted.child.lock().unwrap().try_wait(), Ok(None))
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!matches!(
            restarted.child.lock().unwrap().try_wait(),
            Ok(None)
        ));
        assert!(!restarted.alive());
        assert!(other.alive());
        drop(restarted);
        drop(other);
    }
}
