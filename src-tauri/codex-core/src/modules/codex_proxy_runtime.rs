// 裁剪占位：原 codex_proxy_runtime 模块属于已移除能力（网关/代理/多开/他平台），
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub shared_entry: bool,
    pub account: &'static str,
    pub desktop: &'static str,
    pub sidecar: &'static str,
    pub account_port: Option<u16>,
    pub desktop_port: Option<u16>,
    pub sidecar_port: Option<u16>,
    pub account_node: Option<String>,
    pub desktop_node: Option<String>,
    pub sidecar_node: Option<String>,
    pub account_selection: Option<crate::modules::codex_proxy_engine::ProxySelection>,
    pub desktop_selection: Option<crate::modules::codex_proxy_engine::ProxySelection>,
    pub sidecar_selection: Option<crate::modules::codex_proxy_engine::ProxySelection>,
    pub desktop_entry: Option<super::codex_proxy_desktop_router::EntryStatus>,
    pub proxy_source: &'static str,
    #[serde(serialize_with = "crate::modules::codex_account_proxy::serialize_summary")]
    pub effective_proxy: Option<String>,
}


pub async fn client_builder(
    _account: &CodexAccount,
    builder: reqwest::ClientBuilder,
) -> Result<reqwest::ClientBuilder, String> {
    Ok(builder)
}


pub(crate) async fn ensure_account_proxy_state(account: &CodexAccount) -> Result<(), String> {
    Ok(())
}


pub(crate) async fn load(account_id: &str) -> Result<CodexAccount, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub async fn measure_current_latency(account_id: &str) -> Result<RuntimeStatus, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn normalize_binding(value: &str) -> Result<String, String> {
    Ok(String::new())
}


pub fn release_deleted_account(account_id: &str) {
    ()
}


pub async fn save_binding(
    account_id: String,
    input: Option<String>,
) -> Result<CodexAccount, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub async fn save_binding_with_mode(
    account_id: String,
    input: Option<String>,
    disabled: bool,
) -> Result<CodexAccount, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub async fn status(account_id: &str) -> Result<RuntimeStatus, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}
pub(crate) use crate::modules::codex_proxy_desktop_router::{EntryStatus};
pub(crate) use crate::modules::codex_proxy_engine::{ProxySelection};
