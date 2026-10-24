pub mod model;
pub mod environment;
mod rpc;
mod workspace;
mod history;

use model::{apply_event, approval_result, busy, replace_item, string, Thread, SUPPORTED_REQUESTS};
use rpc::Rpc;
use environment::Environment;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{atomic::Ordering, Arc, Mutex};
use tauri::{Emitter, Manager};
use crate::db::Database;

#[derive(Default)]
pub struct BridgeState {
    // Creation, workspace transfer, module disable and exit are serialized.
    runtime: Mutex<Option<Arc<Runtime>>>,
    events: Option<Arc<dyn Fn(Value) + Send + Sync>>,
}

#[derive(Default)]
struct Live {
    turns: Vec<Value>,
    turn_id: Option<String>,
    resumed: bool,
    starting: bool,
    uncertain: bool,
    operation: Arc<Mutex<()>>,
}

#[derive(Default)]
struct Data {
    seq: u64,
    ready: bool,
    error: Option<String>,
    history_error: Option<String>,
    models: Vec<Value>,
    account: Value,
    threads: BTreeMap<String, Thread>,
    live: HashMap<String, Live>,
    requests: Vec<Value>,
}

struct Runtime {
    rpc: Arc<Rpc>,
    app: tauri::AppHandle,
    db: Arc<Mutex<Database>>,
    data_epoch: Arc<std::sync::atomic::AtomicU64>,
    epoch: u64,
    cwd: String,
    environment: Environment,
    id: String,
    data: Mutex<Data>,
    history_sync: Mutex<()>,
    events: Option<Arc<dyn Fn(Value) + Send + Sync>>,
}

impl BridgeState {
    pub fn with_events(events: Arc<dyn Fn(Value) + Send + Sync>) -> Self { Self { runtime: Mutex::new(None), events: Some(events) } }
    pub fn dispatch(&self, app: &tauri::AppHandle, action: &str, params: &Value) -> Result<Value, String> {
        self.dispatch_with_state(app, &app.state::<crate::AppState>(), action, params)
    }
    pub fn dispatch_with_state(&self, app: &tauri::AppHandle, authenticated: &crate::AppState, action: &str, params: &Value) -> Result<Value, String> {
        if action == "environments" { return Ok(environment::environments()); }
        if action == "status" {
            let runtime = self.runtime.lock().unwrap();
            let state = app.state::<crate::AppState>();
            let mut directories = vec![];
            for thread in state.db.lock().unwrap().codex_dialog_threads()? {
                let directory = json!({"cwd":thread.cwd,"environment":thread.environment});
                if !directories.contains(&directory) { directories.push(directory); }
            }
            return Ok(json!({"cwd":runtime.as_ref().map(|r| &r.cwd), "environment":runtime.as_ref().map(|r| &r.environment), "directories":directories}));
        }
        if action == "connect" {
            let requested: Environment = serde_json::from_value(params.get("environment").cloned().unwrap_or(json!({"kind":"native"}))).map_err(|_| "无效的运行环境")?;
            let (environment, cwd) = requested.resolve(string(params, "cwd"))?;
            let mut runtime = self.runtime.lock().unwrap();
            if let Some(old) = runtime.as_ref() {
                if old.environment == environment && environment.same_path(&old.cwd, &cwd) && params["restart"] != true && !old.rpc.closed.load(Ordering::SeqCst) {
                    if let Err(error) = old.sync_history() { old.data.lock().unwrap().history_error = Some(format!("同步 Codex 历史失败：{error}")); }
                    return old.bootstrap();
                }
                if old.busy() && !old.rpc.closed.load(Ordering::SeqCst) { return Err("有任务正在执行，请先停止任务再切换工作目录".into()); }
            }
            if let Some(old) = runtime.take() { old.rpc.stop(); }
            // Recheck after waiting for another connection/disable operation.
            crate::authorize_codex(authenticated).map_err(str::to_owned)?;
            let next = Runtime::start(app.clone(), cwd, environment, self.events.clone())?;
            *runtime = Some(next.clone());
            return next.bootstrap();
        }
        if action == "disconnect" {
            let mut runtime = self.runtime.lock().unwrap();
            if runtime.as_ref().is_some_and(|r| r.busy()) { return Err("有任务正在执行，请先停止任务".into()); }
            if let Some(old) = runtime.take() { old.rpc.stop(); }
            return Ok(json!({}));
        }
        let runtime = self.runtime.lock().unwrap().clone().ok_or("请先选择工作目录并连接 Codex")?;
        if params["runtimeId"].as_str() != Some(&runtime.id) { return Err("工作目录连接已变化，请刷新后重试".into()); }
        if runtime.rpc.closed.load(Ordering::SeqCst) { return Err("Codex 已断开，请重新连接并核对任务状态".into()); }
        match action {
            "bootstrap" => runtime.bootstrap(),
            "createThread" => runtime.create(params),
            "selectThread" => runtime.snapshot(string(params, "threadId")),
            "send" => runtime.send(params),
            "interrupt" => runtime.interrupt(string(params, "threadId")),
            "respond" => runtime.respond(params),
            "importIndex" => runtime.import_index(string(params, "path")),
            "syncThreads" => { runtime.sync_history()?; Ok(json!({"threads":Runtime::threads(&runtime.data.lock().unwrap())})) },
            "workspace" => Ok(workspace::status(&runtime.environment, &runtime.cwd)),
            _ => Err("不支持的对话操作".into()),
        }
    }


    pub fn stop(&self) {
        if let Some(runtime) = self.runtime.lock().unwrap().take() { runtime.rpc.stop(); }
    }

    pub fn stop_during<T>(&self, action: impl FnOnce() -> T) -> T {
        let mut runtime = self.runtime.lock().unwrap();
        if let Some(old) = runtime.take() { old.rpc.stop(); }
        action()
    }
}

pub fn stop(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BridgeState>() { state.stop(); }
}

impl Runtime {
    fn start(app: tauri::AppHandle, cwd: String, environment: Environment, events: Option<Arc<dyn Fn(Value) + Send + Sync>>) -> Result<Arc<Self>, String> {
        let db = app.state::<crate::AppState>().db.clone();
        let data_epoch = app.state::<crate::AppState>().data_epoch.clone();
        let epoch = data_epoch.load(Ordering::SeqCst);
        let threads = db.lock().unwrap().codex_dialog_threads()?.into_iter()
            .filter(|t| t.environment == environment && environment.same_path(&t.cwd, &cwd)).map(|t| (t.id.clone(), t)).collect();
        let (rpc, output) = Rpc::launch(Path::new(&cwd), &environment)?;
        let runtime = Arc::new(Self { rpc, app, db, data_epoch, epoch, cwd, environment, events, id: uuid::Uuid::new_v4().to_string(), data: Mutex::new(Data { threads, ..Default::default() }), history_sync: Mutex::new(()) });
        let weak = Arc::downgrade(&runtime);
        runtime.rpc.read(output, move |message| { if let Some(runtime) = weak.upgrade() { runtime.receive(message); } });
        let initialized = (|| -> Result<(), String> {
            runtime.rpc.request("initialize", json!({"clientInfo":{"name":"desko_codex_bridge","title":"Desko","version":env!("CARGO_PKG_VERSION")}}))?;
            runtime.rpc.write(json!({"method":"initialized","params":{}}))?;
            let account = runtime.rpc.request("account/read", json!({"refreshToken":false}))?;
            let models = runtime.rpc.request("model/list", json!({}))?;
            let mut data = runtime.data.lock().unwrap();
            data.account = if account["account"].is_null() { Value::Null } else { json!({"type":account["account"]["type"],"plan":account["account"]["planType"]}) };
            data.models = models["data"].as_array().cloned().ok_or("Codex 模型列表协议不兼容")?;
            data.ready = true;
            Ok(())
        })();
        if let Err(error) = initialized { runtime.rpc.stop(); return Err(error); }
        if let Err(error) = runtime.sync_history() { runtime.data.lock().unwrap().history_error = Some(format!("同步 Codex 历史失败：{error}")); }
        Ok(runtime)
    }

    fn sync_history(&self) -> Result<(), String> {
        let _sync = self.history_sync.lock().unwrap();
        let mut cursor = Value::Null;
        let mut seen = std::collections::HashSet::new();
        let mut found = Vec::new();
        loop {
            // Filter paths locally: Windows histories can differ in slash style and casing.
            let mut params = json!({"limit":100,"modelProviders":[],"sourceKinds":["cli","vscode","exec","appServer","unknown"],"sortKey":"updated_at","sortDirection":"desc"});
            if matches!(&self.environment, Environment::Wsl { .. }) { params["cwd"] = json!(self.cwd); }
            if !cursor.is_null() { params["cursor"] = cursor.clone(); }
            let page = self.rpc.request("thread/list", params)?;
            found.extend(page["data"].as_array().cloned().ok_or("Codex 会话列表协议不兼容")?);
            cursor = page["nextCursor"].clone();
            if cursor.is_null() { break; }
            if !seen.insert(cursor.to_string()) { return Err("Codex 会话列表分页重复，请重试".into()); }
        }
        let mut data = self.data.lock().unwrap();
        for value in found {
            if let Some(thread) = history::thread(&value, &self.environment, &self.cwd, data.threads.get(string(&value, "id"))) {
                self.save(&thread)?;
                data.threads.insert(thread.id.clone(), thread);
            }
        }
        data.history_error = None;
        self.send_threads(&mut data);
        Ok(())
    }

    fn broadcast(&self, data: &mut Data, mut message: Value) {
        data.seq += 1;
        message["seq"] = json!(data.seq);
        message["runtimeId"] = json!(self.id);
        if let Some(events) = &self.events { events(message); }
        else { let _ = self.app.emit_to("main", "codex:dialog", message); }
    }

    fn threads(data: &Data) -> Vec<Value> {
        let mut threads: Vec<_> = data.threads.values().map(|t| {
            let mut value = serde_json::to_value(t).unwrap();
            let live = data.live.get(&t.id);
            value["status"] = json!(if live.is_some_and(|l| l.starting || l.uncertain) { "inProgress" }
                else if data.requests.iter().any(|r| r["params"]["threadId"] == t.id && r["params"]["isBlocking"] != false) { "waitingOnApproval" }
                else if live.is_some_and(|l| l.turn_id.is_some()) { "inProgress" }
                else { live.and_then(|l| l.turns.last()).and_then(|t| t["status"].as_str()).unwrap_or("idle") });
            value
        }).collect();
        threads.sort_by_key(|t| std::cmp::Reverse(t["updatedAt"].as_i64().unwrap_or(0)));
        threads
    }

    fn send_threads(&self, data: &mut Data) { self.broadcast(data, json!({"type":"threads","threads":Self::threads(data)})); }
    fn save(&self, thread: &Thread) -> Result<(), String> {
        save_thread(&self.db, &self.data_epoch, self.epoch, &self.rpc, thread)
    }
    fn busy(&self) -> bool { Self::threads(&self.data.lock().unwrap()).iter().any(|t| busy(string(t, "status"))) }

    fn bootstrap(&self) -> Result<Value, String> {
        let workspace = workspace::status(&self.environment, &self.cwd);
        let data = self.data.lock().unwrap();
        Ok(json!({"runtimeId":self.id,"environment":self.environment,"status":if data.ready {"ready"} else {"disconnected"},"error":data.error,"historyError":data.history_error,"models":data.models,"account":data.account,"threads":Self::threads(&data),"workspace":workspace}))
    }

    fn require_thread(data: &mut Data, id: &str) -> Result<Arc<Mutex<()>>, String> {
        if !data.threads.contains_key(id) { return Err("此会话不属于当前 Desko 工作区".into()); }
        Ok(data.live.entry(id.to_owned()).or_default().operation.clone())
    }

    fn create(&self, params: &Value) -> Result<Value, String> {
        let sandbox = params["sandbox"].as_str().unwrap_or("workspace-write");
        if !["read-only", "workspace-write"].contains(&sandbox) { return Err("无效的权限模式".into()); }
        let model = string(params, "model");
        if !model.is_empty() && !self.data.lock().unwrap().models.iter().any(|m| m["id"] == model || m["model"] == model) { return Err("请选择当前账号可用的模型".into()); }
        let mut input = json!({"cwd":self.cwd,"sandbox":sandbox,"approvalPolicy":"on-request","approvalsReviewer":"user","serviceName":"desko_codex_bridge"});
        if !model.is_empty() { input["model"] = json!(model); }
        let response = self.rpc.request("thread/start", input)?;
        let id = response["thread"]["id"].as_str().ok_or("Codex 未返回会话标识")?.to_owned();
        let now = chrono::Utc::now().timestamp_millis();
        let thread = Thread { id: id.clone(), environment: self.environment.clone(), session_id: response["thread"]["sessionId"].as_str().unwrap_or(&id).into(), cwd: self.cwd.clone(),
            title: "新对话".into(), source: None, model: response["model"].as_str().map(str::to_owned), sandbox: sandbox.into(), created_at: now, updated_at: now };
        self.save(&thread)?;
        let mut data = self.data.lock().unwrap();
        data.threads.insert(id.clone(), thread.clone());
        data.live.insert(id, Live { resumed: true, ..Default::default() });
        self.send_threads(&mut data);
        Ok(json!({"thread":thread,"turns":[],"activeTurn":null,"requests":[],"eventSeq":data.seq}))
    }

    fn import_index(&self, path: &str) -> Result<Value, String> {
        use std::io::Read;
        let file = std::fs::File::open(path).map_err(|e| format!("无法读取会话索引：{e}"))?;
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 { return Err("会话索引超过 2 MiB".into()); }
        #[derive(serde::Deserialize)]
        struct Index { threads: Vec<Thread> }
        let index: Index = serde_json::from_slice(&bytes).map_err(|_| "请选择 codex-web-ui 的 .local/threads.json")?;
        let mut imported = 0;
        let mut data = self.data.lock().unwrap();
        for mut thread in index.threads {
            if !self.environment.same_path(&thread.cwd, &self.cwd) || data.threads.contains_key(&thread.id) { continue; }
            if thread.id.is_empty() || thread.id.len() > 128 || !["read-only", "workspace-write"].contains(&thread.sandbox.as_str()) {
                return Err("会话索引包含无效的会话标识或权限模式".into());
            }
            thread.cwd = self.cwd.clone();
            thread.environment = self.environment.clone();
            if thread.session_id.is_empty() { thread.session_id = thread.id.clone(); }
            self.save(&thread)?;
            data.threads.insert(thread.id.clone(), thread);
            imported += 1;
        }
        self.send_threads(&mut data);
        Ok(json!({"imported":imported}))
    }

    // Callers hold this thread's operation mutex; concurrent resumes share one result.
    fn resume(&self, id: &str) -> Result<(), String> {
        let thread = {
            let data = self.data.lock().unwrap();
            if data.live[id].resumed { return Ok(()); }
            data.threads[id].clone()
        };
        self.rpc.request("thread/resume", json!({"threadId":id,"cwd":self.cwd,"sandbox":thread.sandbox,"approvalPolicy":"on-request","approvalsReviewer":"user","excludeTurns":true}))?;
        self.data.lock().unwrap().live.get_mut(id).unwrap().resumed = true;
        Ok(())
    }

    fn snapshot(&self, id: &str) -> Result<Value, String> {
        let operation = Self::require_thread(&mut self.data.lock().unwrap(), id)?;
        let _operation = operation.lock().unwrap();
        // Reading an existing CLI/client conversation must not resume or change its settings.
        let mut turns: Vec<Value> = vec![];
        let mut cursor = Value::Null;
        let mut seen = std::collections::HashSet::new();
        loop {
            let mut params = json!({"threadId":id,"limit":50,"itemsView":"full","sortDirection":"desc"});
            if !cursor.is_null() { params["cursor"] = cursor.clone(); }
            let page = self.rpc.request("thread/turns/list", params)?;
            turns.extend(page["data"].as_array().cloned().ok_or("Codex 会话历史协议不兼容")?);
            cursor = page["nextCursor"].clone();
            if cursor.is_null() || turns.len() >= 200 || !seen.insert(cursor.to_string()) { break; }
        }
        turns.truncate(200);
        turns.reverse();
        let mut data = self.data.lock().unwrap();
        let live = data.live.get_mut(id).unwrap();
        for cached in &live.turns {
            if let Some(old) = turns.iter_mut().find(|t| t["id"] == cached["id"]) {
                let mut items = old["items"].as_array().cloned().unwrap_or_default();
                for item in cached["items"].as_array().into_iter().flatten() { replace_item(&mut items, item.clone()); }
                *old = cached.clone(); old["items"] = json!(items);
            } else { turns.push(cached.clone()); }
        }
        if turns.len() > 200 { turns.drain(..turns.len()-200); }
        live.uncertain = false;
        live.turn_id = turns.iter().rev().find(|t| busy(string(t,"status"))).and_then(|t| t["id"].as_str()).map(str::to_owned);
        let active = live.turn_id.as_ref().and_then(|tid| turns.iter().find(|t| t["id"] == *tid)).cloned();
        Ok(json!({"thread":data.threads[id],"turns":turns,"activeTurn":active,"requests":data.requests.iter().filter(|r| r["params"]["threadId"] == id).collect::<Vec<_>>(),"eventSeq":data.seq}))
    }

    fn send(&self, params: &Value) -> Result<Value, String> {
        let id = string(params, "threadId");
        let text = string(params, "text").trim();
        if text.is_empty() || text.chars().count() > 32000 { return Err("请输入 1–32000 字符的消息".into()); }
        let operation = Self::require_thread(&mut self.data.lock().unwrap(), id)?;
        let _operation = operation.try_lock().map_err(|_| "会话正在恢复或发送，请稍候")?;
        let input = {
            let data = self.data.lock().unwrap();
            model::turn_input(params, &data.models, data.threads[id].model.as_deref(), &self.cwd)?
        };
        {
            let mut data = self.data.lock().unwrap();
            let live = data.live.get_mut(id).unwrap();
            if live.starting || live.uncertain || live.turn_id.is_some() { return Err("当前对话正在执行或结果待确认，请刷新会话或先停止".into()); }
            live.starting = true;
        }
        let result = (|| {
            self.resume(id)?;
            let mut thread = self.data.lock().unwrap().threads[id].clone();
            thread.updated_at = chrono::Utc::now().timestamp_millis();
            if thread.title == "新对话" { thread.title = text.chars().take(42).collect(); }
            self.save(&thread)?;
            self.data.lock().unwrap().threads.insert(id.into(), thread);
            let result = self.rpc.request("turn/start", input);
            let mut data = self.data.lock().unwrap();
            if result.as_ref().is_err_and(|e| e.contains("超时")) { data.live.get_mut(id).unwrap().uncertain = true; }
            if let Ok(response) = &result {
                let live = data.live.get_mut(id).unwrap();
                // The completion notification may precede the RPC response.
                if !live.turns.iter().any(|t| t["id"] == response["turn"]["id"]) {
                    live.turn_id = response["turn"]["id"].as_str().map(str::to_owned);
                    live.turns.push(response["turn"].clone());
                }
            }
            result
        })();
        let mut data = self.data.lock().unwrap();
        data.live.get_mut(id).unwrap().starting = false;
        self.send_threads(&mut data);
        result
    }

    fn interrupt(&self, id: &str) -> Result<Value, String> {
        let turn = {
            let mut data = self.data.lock().unwrap();
            Self::require_thread(&mut data, id)?;
            data.live[id].turn_id.clone()
        };
        match turn { Some(turn) => self.rpc.request("turn/interrupt", json!({"threadId":id,"turnId":turn})), None => Ok(json!({})) }
    }

    fn respond(&self, params: &Value) -> Result<Value, String> {
        let id = string(params, "threadId");
        let mut data = self.data.lock().unwrap();
        Self::require_thread(&mut data, id)?;
        let index = data.requests.iter().position(|r| r["id"] == params["requestId"] && r["params"]["threadId"] == id).ok_or("此请求已经结束，请刷新会话状态")?;
        let result = approval_result(&data.requests[index], params)?;
        self.rpc.write(json!({"id":params["requestId"],"result":result}))?;
        data.requests.remove(index);
        self.broadcast(&mut data, json!({"type":"approvalResolved","requestId":params["requestId"],"threadId":id}));
        self.send_threads(&mut data);
        Ok(json!({}))
    }

    fn receive(&self, message: Value) {
        let method = string(&message, "method");
        let params = &message["params"];
        let mut data = self.data.lock().unwrap();
        if method == "desko/disconnected" {
            data.ready = false;
            data.error = Some("Codex 进程已退出，请重新连接并核对任务状态".into());
            data.requests.clear();
            self.broadcast(&mut data, json!({"type":"runtime","status":"disconnected","error":"Codex 进程已退出，请重新连接并核对任务状态"}));
            return;
        }
        let id = params["threadId"].as_str().or_else(|| params["thread"]["id"].as_str()).unwrap_or("");
        if message.get("id").is_some() {
            if !data.threads.contains_key(id) || !SUPPORTED_REQUESTS.contains(&method) {
                let _ = self.rpc.write(json!({"id":message["id"],"error":{"code":-32601,"message":"此客户端不支持该交互请求"}}));
                return;
            }
            data.requests.retain(|r| r["id"] != message["id"]);
            data.requests.push(message.clone());
            self.broadcast(&mut data, json!({"type":"approval","request":message}));
            self.send_threads(&mut data);
            return;
        }
        if !data.threads.contains_key(id) || method.starts_with("item/reasoning/") { return; }
        let live = data.live.entry(id.into()).or_default();
        apply_event(&mut live.turns, method, params);
        if method == "turn/started" { live.turn_id = params["turn"]["id"].as_str().map(str::to_owned); }
        if method == "turn/completed" {
            if live.turn_id.as_deref() == params["turn"]["id"].as_str() { live.turn_id = None; }
            live.uncertain = false;
            data.requests.retain(|r| r["params"]["threadId"] != id);
            let thread = data.threads.get_mut(id).unwrap();
            thread.updated_at = chrono::Utc::now().timestamp_millis();
            // Keep disk writes outside this mutex and the protocol reader (below).
            let thread = thread.clone();
            let db = self.db.clone();
            let app = self.app.clone();
            let data_epoch = self.data_epoch.clone();
            let epoch = self.epoch;
            let rpc = self.rpc.clone();
            let runtime_id = self.id.clone();
            std::thread::spawn(move || {
                if let Err(error) = save_thread(&db, &data_epoch, epoch, &rpc, &thread) {
                    let _ = app.emit_to("main", "codex:dialog", json!({"type":"warning","runtimeId":runtime_id,"error":error}));
                }
            });
        }
        if method == "serverRequest/resolved" { data.requests.retain(|r| r["id"] != params["requestId"]); }
        self.broadcast(&mut data, json!({"type":"event","method":method,"params":params}));
        if matches!(method, "turn/started" | "turn/completed" | "serverRequest/resolved") { self.send_threads(&mut data); }
    }
}

impl Drop for Runtime { fn drop(&mut self) { self.rpc.stop(); } }

fn save_thread(db: &Mutex<Database>, generation: &std::sync::atomic::AtomicU64, epoch: u64, rpc: &Rpc, thread: &Thread) -> Result<(), String> {
    let db = db.lock().unwrap();
    if rpc.closed.load(Ordering::SeqCst) || generation.load(Ordering::SeqCst) != epoch { return Err("会话连接已失效".into()); }
    db.save_codex_dialog_thread(thread)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resumed_active_turn_keeps_workspace_busy_before_notifications_arrive() {
        let mut data = Data::default();
        let thread = Thread {
            id: "thread".into(), environment: Environment::Native, session_id: "thread".into(), cwd: "workspace".into(),
            title: "恢复的对话".into(), source: None, model: None, sandbox: "read-only".into(),
            created_at: 0, updated_at: 0,
        };
        data.threads.insert(thread.id.clone(), thread);
        data.live.insert("thread".into(), Live {
            resumed: true, turn_id: Some("active-turn".into()), ..Default::default()
        });
        assert!(busy(string(&Runtime::threads(&data)[0], "status")));
        data.requests.push(json!({"params":{"threadId":"thread"}}));
        assert_eq!(Runtime::threads(&data)[0]["status"], "waitingOnApproval");
        data.requests.clear();
        data.live.get_mut("thread").unwrap().turn_id = None;
        assert!(!busy(string(&Runtime::threads(&data)[0], "status")));
    }
}
