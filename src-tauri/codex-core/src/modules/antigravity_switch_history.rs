// 裁剪占位：原 antigravity_switch_history 模块属于已移除能力（网关/代理/多开/他平台），
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityAutoSwitchHitGroup {
    pub group_id: String,
    pub group_name: String,
    pub percentage: i32,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravityAutoSwitchReason {
    pub rule: String,
    pub threshold: i32,
    pub scope_mode: String,
    #[serde(default)]
    pub credits_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_threshold: Option<i32>,
    #[serde(default)]
    pub credits_triggered: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_credits_remaining: Option<f64>,
    #[serde(default)]
    pub selected_group_ids: Vec<String>,
    #[serde(default)]
    pub selected_group_names: Vec<String>,
    #[serde(default)]
    pub hit_groups: Vec<AntigravityAutoSwitchHitGroup>,
    pub candidate_count: usize,
    pub selected_policy: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AntigravitySwitchHistoryItem {
    pub id: String,
    pub timestamp: i64,
    pub account_id: String,
    pub target_email: String,
    #[serde(default = "default_trigger_type")]
    pub trigger_type: String,
    #[serde(default = "default_trigger_source")]
    pub trigger_source: String,
    pub local_ok: bool,
    pub seamless_ok: bool,
    pub success: bool,
    pub local_duration_ms: u64,
    pub seamless_duration_ms: Option<u64>,
    pub total_duration_ms: u64,
    pub error_stage: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub seamless_effective_mode: Option<String>,
    pub seamless_from_email: Option<String>,
    pub seamless_to_email: Option<String>,
    pub seamless_execution_id: Option<String>,
    pub seamless_finished_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_switch_reason: Option<AntigravityAutoSwitchReason>,
}


pub fn add_history_item(item: AntigravitySwitchHistoryItem) -> Result<(), String> {
    Ok(())
}


pub(crate) fn default_trigger_type() -> String {
    String::new()
}


pub(crate) fn default_trigger_source() -> String {
    String::new()
}
