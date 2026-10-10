// 裁剪占位：原 websocket 模块属于已移除能力（网关/代理/多开/他平台），
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

pub fn broadcast_account_switched(account_id: &str, email: &str) {
    ()
}


pub fn broadcast_data_changed(source: &str) {
    ()
}


pub async fn request_plugin_switch_account(
    target_email: &str,
    switch_mode: &str,
    trigger_type: &str,
    trigger_source: &str,
    reason: &str,
    timeout_ms: u64,
) -> Result<PluginSwitchAccountResponsePayload, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub async fn start_server() {
    ()
}


pub async fn wait_for_connected_clients(timeout_ms: u64) -> Result<usize, String> {
    Ok(0)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSwitchAccountResponsePayload {
    pub execution_id: String,
    pub request_id: Option<String>,
    pub success: bool,
    pub effective_mode: String,
    pub from_email: Option<String>,
    pub to_email: String,
    pub duration_ms: u64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub finished_at: String,
}
