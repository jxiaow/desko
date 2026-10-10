// 裁剪占位：原 codex_proxy_engine 模块属于已移除能力（网关/代理/多开/他平台），
// 这里只保留被 Codex 账号核心引用到的签名，调用返回无副作用默认值。
#![allow(dead_code, unused_variables, unused_imports, unused_mut, clippy::all, unreachable_code)]
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, Window};
use crate::models::account::*;
use crate::models::claude::*;
use crate::models::codebuddy::*;
use crate::models::codex::*;
use crate::models::codex_local_access::*;
use crate::models::cursor::*;
use crate::models::github_copilot::*;
use crate::models::grok::*;
use crate::models::instance::*;
use crate::models::kiro::*;
use crate::models::qoder::*;
use crate::models::quota::*;
use crate::models::ssh_server::*;
use crate::models::token::*;
use crate::models::trae::*;
use crate::models::windsurf::*;
use crate::models::workbuddy::*;
use crate::models::zcode::*;
use crate::models::zed::*;
use std::process::Child;

pub struct NodeTunnel {
    error: Arc<AtomicU8>,
    error_readers: Vec<tokio::task::JoinHandle<()>>,
    child: Arc<Mutex<Child>>,
    id: uuid::Uuid,
    proxy_url: String,
    controller: EngineController,
    selection: Option<SelectionReader>,
    // Shared release lease prevents cleanup while the tunnel uses this engine.
    _engine_lease: Option<std::fs::File>,
    _runtime_dir: RuntimeDirectory,
}
impl NodeTunnel {
    pub fn failure(&self, fallback: String) -> String {
    String::new()
}


    pub fn is_running(&self) -> bool {
    false
}

    /// Reclamation must preserve a child whose state cannot be read immediately.
    pub(crate) fn try_is_running(&self) -> Option<bool> {
    None
}


    pub fn proxy_url(&self) -> &str {
    panic!("该能力已在裁剪版中移除")
}


    pub fn selection_reader(&self) -> Option<SelectionReader> {
    None
}

    pub(crate) fn diagnostic_id(&self) -> uuid::Uuid { self.id }

    pub fn controller(&self) -> EngineController {
    panic!("该能力已在裁剪版中移除")
}


    pub(crate) fn request_route_observer(&self) -> RequestRouteObserver {
    panic!("该能力已在裁剪版中移除")
}

    pub async fn selected_node(&self) -> Result<Option<String>, String> {
    Ok(None)
}


    pub async fn stop(self) -> Result<(), String> {
    Ok(())
}

}
impl Drop for NodeTunnel {
    fn drop(&mut self) {
    ()
}

}


#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySelection {
    pub name: String,
    pub delay_ms: Option<u64>,
    pub checked_at: Option<i64>,
}


pub fn shutdown_all() {
    ()
}


pub async fn start_desktop(input: &str) -> Result<NodeTunnel, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


#[derive(Default)]
pub(crate) struct RuntimeDirectory(PathBuf);
impl RuntimeDirectory {
    async fn create() -> Result<Self, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}

}
impl Drop for RuntimeDirectory {
    fn drop(&mut self) {
    ()
}

}


#[derive(Clone)]
pub struct EngineController {
    pub(crate) endpoint: String,
    pub(crate) secret: String,
    pub(crate) tunnel_id: uuid::Uuid,
}
impl EngineController {
    pub(crate) async fn measure_delay(&self, test_url: &str) -> Result<u64, String> {
    Ok(0)
}


    pub(crate) async fn measure_leaf_delay(
        &self,
        tag: &str,
        test_url: &str,
    ) -> Result<u64, String> {
    Ok(0)
}

}


#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestRouteObserver {
    pub proxy_url: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub mapping_url: String,
    pub controller_url: String,
    pub controller_secret: String,
    pub node_names: BTreeMap<String, String>,
    pub proxy_name: String,
}


#[derive(Clone)]
pub struct SelectionReader {
    endpoint: String,
    secret: String,
    names: BTreeMap<String, String>,
    groups: BTreeMap<String, Vec<String>>,
    measured: Arc<Mutex<HashMap<(String, String), ProxySelection>>>,
}
impl SelectionReader {
    pub(crate) async fn latency_target(&self) -> Result<Option<(String, String)>, String> {
    Ok(None)
}


    pub(crate) async fn measure_current_delay(&self, controller: &EngineController)
        -> Result<((String, String), Result<u64, String>), String> {
    Ok(((String::new(), String::new()), Ok(0)))
}


    pub(crate) fn record_latency(&self, target: (String, String), delay_ms: Option<u64>) {
    ()
}


    fn latest_latency(&self, target: &(String, String), history: ProxySelection) -> ProxySelection {
    panic!("该能力已在裁剪版中移除")
}


    pub async fn selected_node(&self) -> Result<Option<String>, String> {
    Ok(None)
}


    /// Read the running engine's last health check for the selected leaf. Never
    /// substitute a group delay or an unrelated UI probe for this node's history.
    pub async fn selected_info(&self) -> Result<Option<ProxySelection>, String> {
    Ok(None)
}


    async fn selected_tag(&self) -> Result<Option<(String, Option<String>)>, String> {
    Ok(None)
}

}
