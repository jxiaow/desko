use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, mpsc, Arc, Mutex};
use std::time::Duration;
use super::super::tunnel_service::ProcessJob;
use super::environment::Environment;

pub const TASK_ENV: &[&str] = &[
    "CODEX_APP_TOOLS_PIPE_PATH", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "CODEX_SESSION_ID",
    "CODEX_THREAD_ID", "CODEX_TOOL_CALL_ID", "CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY",
    "CODEX_MCP_NODE_PATH",
];

pub fn executable() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_BIN") {
        let path = PathBuf::from(path);
        return path.is_file().then_some(path).ok_or_else(|| "CODEX_BIN 指向的可执行文件不存在".into());
    }
    #[cfg(windows)]
    {
        let (arch, target) = if cfg!(target_arch = "aarch64") { ("arm64", "aarch64") } else { ("x64", "x86_64") };
        if let Some(base) = std::env::var_os("APPDATA") {
            let path = PathBuf::from(base).join(format!("npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-{arch}/vendor/{target}-pc-windows-msvc/bin/codex.exe"));
            if path.is_file() { return Ok(path); }
        }
    }
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let path = dir.join(name);
        if path.is_file() { return Ok(path); }
    }
    Err("未找到 Codex CLI，请安装并登录 Codex，或用 CODEX_BIN 指定可执行文件".into())
}

pub fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

type Reply = Result<Value, String>;
type WriteRequest = (Vec<u8>, mpsc::Sender<Result<(), String>>);
pub struct Rpc {
    input: Mutex<Option<mpsc::Sender<WriteRequest>>>,
    child: Mutex<Option<Child>>,
    job: Mutex<Option<ProcessJob>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Reply>>>,
    sequence: AtomicU64,
    pub closed: AtomicBool,
}

impl Rpc {
    pub fn launch(cwd: &Path, environment: &Environment) -> Result<(Arc<Self>, ChildStdout), String> {
        if *environment != Environment::Native {
            return Self::spawn(environment.wsl_command("run", cwd.to_str().ok_or("工作目录编码无效")?)?);
        }
        let mut cmd = command(&executable()?);
        cmd.args(["app-server", "--listen", "stdio://"]);
        #[cfg(windows)]
        {
            let sandbox = std::env::var("CODEX_WINDOWS_SANDBOX").unwrap_or_else(|_| "mxc".into());
            if !["mxc", "elevated", "inherit"].contains(&sandbox.as_str()) {
                return Err("CODEX_WINDOWS_SANDBOX 只接受 mxc、elevated 或 inherit".into());
            }
            if sandbox != "inherit" { cmd.args(["-c", &format!("windows.sandbox=\"{sandbox}\"")]); }
        }
        cmd.current_dir(cwd).env("NO_COLOR", "1").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        for key in TASK_ENV { cmd.env_remove(key); }
        Self::spawn(cmd)
    }

    fn spawn(mut cmd: Command) -> Result<(Arc<Self>, ChildStdout), String> {
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let job = ProcessJob::new().map_err(|e| e.to_string())?;
        let mut child = cmd.spawn().map_err(|e| format!("无法启动 Codex：{e}"))?;
        if let Err(error) = job.assign(&child) {
            let _ = child.kill(); let _ = child.wait();
            return Err(error.to_string());
        }
        let mut stdin = child.stdin.take().unwrap();
        let (input, writes) = mpsc::channel::<WriteRequest>();
        std::thread::spawn(move || {
            for (bytes, reply) in writes {
                let result = stdin.write_all(&bytes).and_then(|_| stdin.flush()).map_err(|e| format!("Codex 管道写入失败：{e}"));
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed { break; }
            }
        });
        let output = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        // 排空诊断流，不把凭据和配置细节转发到界面或日志。
        std::thread::spawn(move || { let mut buf = [0; 8192]; while matches!(stderr.read(&mut buf), Ok(n) if n > 0) {} });
        Ok((Arc::new(Self { input: Mutex::new(Some(input)), child: Mutex::new(Some(child)), job: Mutex::new(Some(job)),
            pending: Mutex::new(HashMap::new()), sequence: AtomicU64::new(0), closed: AtomicBool::new(false) }), output))
    }

    pub fn read(self: &Arc<Self>, output: impl Read + Send + 'static, handler: impl Fn(Value) + Send + 'static) {
        let rpc = self.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if message.get("id").is_some() && message.get("method").is_none() {
                    if let Some(id) = message["id"].as_str() {
                        if let Some(reply) = rpc.pending.lock().unwrap().remove(id) {
                            let result = if message.get("error").is_some() {
                                Err(message["error"]["message"].as_str().unwrap_or("Codex 请求失败").to_string())
                            } else { Ok(message["result"].clone()) };
                            let _ = reply.send(result);
                        }
                    }
                } else { handler(message); }
            }
            rpc.stop();
            handler(json!({"method":"desko/disconnected"}));
        });
    }

    pub fn write(&self, message: Value) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) { return Err("Codex 连接已关闭".into()); }
        let input = self.input.lock().unwrap().clone().ok_or("Codex 连接已关闭")?;
        let mut bytes = serde_json::to_vec(&message).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        let (reply, written) = mpsc::channel();
        input.send((bytes, reply)).map_err(|_| "Codex 连接已关闭")?;
        match written.recv_timeout(Duration::from_secs(5)) {
            Ok(result) => result,
            Err(_) => { self.stop(); Err("Codex 管道写入超时，连接已关闭；请核对任务状态".into()) }
        }
    }

    pub fn request(&self, method: &str, params: Value) -> Reply {
        self.request_timeout(method, params, Duration::from_secs(30))
    }

    fn request_timeout(&self, method: &str, params: Value, timeout: Duration) -> Reply {
        let id = format!("desko:{}", self.sequence.fetch_add(1, Ordering::SeqCst));
        let (send, receive) = mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if self.closed.load(Ordering::SeqCst) { return Err("Codex 连接已关闭".into()); }
            if pending.len() >= 12 { return Err("请求过多，请稍后再试".into()); }
            pending.insert(id.clone(), send);
        }
        let result = self.write(json!({"id":id,"method":method,"params":params})).and_then(|_| {
            receive.recv_timeout(timeout).map_err(|_| format!("{method} 请求超时；请刷新会话核对结果，避免重复发送"))?
        });
        self.pending.lock().unwrap().remove(&id);
        result
    }

    pub fn fail(&self, reason: &str) {
        self.closed.store(true, Ordering::SeqCst);
        for (_, reply) in self.pending.lock().unwrap().drain() { let _ = reply.send(Err(reason.into())); }
    }

    pub fn stop(&self) {
        self.fail("Codex 服务已停止");
        self.job.lock().unwrap().take();
        if let Some(mut child) = self.child.lock().unwrap().take() { let _ = child.kill(); let _ = child.wait(); }
        self.input.lock().unwrap().take();
    }
}

impl Drop for Rpc { fn drop(&mut self) { self.stop(); } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "opt-in: reads installed Windows and WSL CLI account/model metadata, never starts a task"]
    fn installed_windows_and_wsl_handshake_without_tasks() {
        let distro = std::env::var("DESKO_TEST_WSL_DISTRO").expect("Set DESKO_TEST_WSL_DISTRO");
        let cwd = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_string_lossy().into_owned();
        for target in [Environment::Native, Environment::Wsl { distro, user: String::new() }] {
            let (environment, path) = target.resolve(&cwd).unwrap();
            println!("Checking {:?} at {}", environment, path);
            let (rpc, output) = Rpc::launch(Path::new(&path), &environment).unwrap();
            rpc.read(output, |_| {});
            rpc.request("initialize", json!({"clientInfo":{"name":"desko_codex_bridge","title":"Desko","version":"1.0.0"}})).unwrap();
            rpc.write(json!({"method":"initialized","params":{}})).unwrap();
            let account = rpc.request("account/read", json!({"refreshToken":false})).unwrap();
            let models = rpc.request("model/list", json!({})).unwrap();
            assert!(!models["data"].as_array().unwrap().is_empty());
            let history = rpc.request("thread/list", json!({"limit":100,"cwd":path,"modelProviders":[],"sourceKinds":["cli","vscode","exec","appServer","unknown"],"sortKey":"updated_at"})).unwrap();
            let threads = history["data"].as_array().expect("Codex must return its existing histories");
            if let Some(thread) = threads.last() {
                assert!(super::super::history::thread(thread, &environment, &path, None).is_some());
                let turns = rpc.request("thread/turns/list", json!({"threadId":thread["id"],"limit":2,"itemsView":"full","sortDirection":"desc"})).unwrap();
                assert!(turns["data"].is_array(), "Existing messages must be readable without resuming the session");
            }
            let git = super::super::workspace::status(&environment, &path);
            assert!(git.get("error").is_none(), "Git must run in the selected environment");
            println!("{:?}: handshake OK, account type={}, models={}, repository histories={}, history read OK, Git OK; no tasks started", environment, account["account"]["type"], models["data"].as_array().unwrap().len(), threads.len());
            rpc.stop();
        }
    }

    #[test]
    #[ignore = "child process fixture, invoked only by transport tests"]
    fn stdio_fixture() {
        if std::env::var("DESKO_CODEX_RPC_FIXTURE").as_deref() != Ok("1") { return; }
        for line in std::io::stdin().lock().lines() {
            let message: Value = serde_json::from_str(&line.unwrap()).unwrap();
            match message["method"].as_str().unwrap_or("") {
                "timeout" => continue,
                "stall" => { std::thread::sleep(Duration::from_secs(90)); break; }
                "initialize" => println!("{}", json!({"id":message["id"],"result":{"ready":true}})),
                "unicode" => {
                    let text = format!("{}\n", json!({"method":"item/agentMessage/delta","params":{"delta":"中文"}}));
                    let split = text.find('中').unwrap() + 1;
                    let mut out = std::io::stdout().lock();
                    out.write_all(&text.as_bytes()[..split]).unwrap(); out.flush().unwrap();
                    std::thread::sleep(Duration::from_millis(5));
                    out.write_all(&text.as_bytes()[split..]).unwrap(); out.flush().unwrap();
                    writeln!(out, "{}", json!({"id":message["id"],"result":{}})).unwrap();
                }
                _ => println!("{}", json!({"id":message["id"],"error":{"message":"expected failure"}})),
            }
        }
    }
    fn fixture() -> (Arc<Rpc>, mpsc::Receiver<Value>) {
        let mut cmd = command(&std::env::current_exe().unwrap());
        cmd.args(["--exact", "services::codex_bridge::rpc::tests::stdio_fixture", "--ignored", "--nocapture"]).env("DESKO_CODEX_RPC_FIXTURE", "1");
        let (rpc, output) = Rpc::spawn(cmd).unwrap();
        let (tx, rx) = mpsc::channel();
        rpc.read(output, move |message| { let _ = tx.send(message); });
        assert_eq!(rpc.request("initialize", json!({})).unwrap()["ready"], true);
        (rpc, rx)
    }
    #[test]
    fn subprocess_correlates_responses_split_unicode_errors_and_timeouts() {
        let (rpc, events) = fixture();
        rpc.request("unicode", json!({})).unwrap();
        assert_eq!(events.recv_timeout(Duration::from_secs(2)).unwrap()["params"]["delta"], "中文");
        assert_eq!(rpc.request("failure", json!({})).unwrap_err(), "expected failure");
        assert!(rpc.request_timeout("timeout", json!({}), Duration::from_millis(30)).unwrap_err().contains("超时"));
        assert!(rpc.pending.lock().unwrap().is_empty());
        let copy = rpc.clone();
        let request = std::thread::spawn(move || copy.request("timeout", json!({})));
        std::thread::sleep(Duration::from_millis(30));
        rpc.stop();
        assert!(request.join().unwrap().is_err());
        assert!(rpc.pending.lock().unwrap().is_empty());
    }
    #[test]
    fn shutdown_unblocks_a_child_that_stops_consuming_stdin() {
        let (rpc, _) = fixture();
        rpc.write(json!({"method":"stall"})).unwrap();
        let copy = rpc.clone();
        let write = std::thread::spawn(move || copy.write(json!({"method":"large","text":"x".repeat(1024 * 1024)})));
        std::thread::sleep(Duration::from_millis(100));
        let start = std::time::Instant::now();
        rpc.stop();
        assert!(start.elapsed() < Duration::from_secs(3));
        assert!(write.join().unwrap().is_err());
    }
    #[test]
    fn closed_transport_rejects_without_leaking_pending_requests() {
        let rpc = Rpc { input: Mutex::new(None), child: Mutex::new(None), job: Mutex::new(None), pending: Mutex::new(HashMap::new()), sequence: AtomicU64::new(0), closed: AtomicBool::new(false) };
        assert!(rpc.request_timeout("test", json!({}), Duration::from_millis(5)).is_err());
        assert!(rpc.pending.lock().unwrap().is_empty());
        rpc.fail("exit");
        assert!(rpc.request("test", json!({})).is_err());
    }
}
