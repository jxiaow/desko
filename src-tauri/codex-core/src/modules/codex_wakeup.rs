// 裁剪占位：原 codex_wakeup 模块属于已移除能力（网关/代理/多开/他平台），
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
pub struct CodexCliStatus {
    pub available: bool,
    pub binary_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configured_codex_cli_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configured_node_path: Option<String>,
    pub version: Option<String>,
    pub source: Option<String>,
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_runtime_paths: Vec<String>,
    pub checked_at: i64,
    pub install_hints: Vec<CodexCliInstallHint>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupBatchResult {
    pub run_id: String,
    pub runtime: CodexCliStatus,
    pub records: Vec<CodexWakeupHistoryItem>,
    pub success_count: usize,
    pub failure_count: usize,
}


#[derive(Debug, Clone, Default)]
pub struct CodexWakeupExecutionConfig {
    pub model: Option<String>,
    pub model_display_name: Option<String>,
    pub model_reasoning_effort: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupHistoryItem {
    pub id: String,
    pub run_id: String,
    pub timestamp: i64,
    pub trigger_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_name: Option<String>,
    pub account_id: String,
    pub account_email: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_context_text: Option<String>,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_refresh_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cli_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_before: Option<CodexQuotaSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_after: Option<CodexQuotaSnapshot>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupModelPreset {
    pub id: String,
    pub name: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allowed_reasoning_efforts: Vec<String>,
    pub default_reasoning_effort: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupOverview {
    pub runtime: CodexCliStatus,
    pub state: CodexWakeupState,
    pub history: Vec<CodexWakeupHistoryItem>,
}


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupRuntimeConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_cli_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_path: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupState {
    pub enabled: bool,
    #[serde(default)]
    pub tasks: Vec<CodexWakeupTask>,
    #[serde(default = "default_model_presets")]
    pub model_presets: Vec<CodexWakeupModelPreset>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_preset_migrations: Vec<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupTask {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub account_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<String>,
    pub schedule: CodexWakeupSchedule,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_success_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_timeout_minutes: Option<i32>,
}


#[derive(Debug, Clone)]
pub struct TaskRunContext {
    pub trigger_type: String,
    pub task_id: Option<String>,
    pub task_name: Option<String>,
}


pub fn cancel_wakeup_scope(cancel_scope_id: &str) -> Result<(), String> {
    Ok(())
}


pub fn clear_history() -> Result<(), String> {
    Ok(())
}


pub(crate) fn is_codex_model_before_5_5(model: &str) -> bool {
    false
}


pub fn load_history() -> Result<Vec<CodexWakeupHistoryItem>, String> {
    Ok(Vec::new())
}


pub fn load_overview() -> Result<CodexWakeupOverview, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn load_state() -> Result<CodexWakeupState, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn release_wakeup_scope(cancel_scope_id: &str) -> Result<(), String> {
    Ok(())
}


pub fn remove_deleted_accounts_from_tasks(account_ids: &[String]) -> Result<(), String> {
    Ok(())
}


pub async fn run_batch(
    app: Option<&AppHandle>,
    account_ids: Vec<String>,
    prompt: Option<String>,
    execution_config: CodexWakeupExecutionConfig,
    context: TaskRunContext,
    run_id: Option<String>,
    cancel_scope_id: Option<&str>,
) -> Result<CodexWakeupBatchResult, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn save_runtime_config(
    next_config: &CodexWakeupRuntimeConfig,
) -> Result<CodexWakeupRuntimeConfig, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn save_state(next_state: &CodexWakeupState) -> Result<CodexWakeupState, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn wakeup_runtime_status() -> CodexCliStatus {
    panic!("该能力已在裁剪版中移除")
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliInstallHint {
    pub label: String,
    pub command: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQuotaSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hourly_percentage: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hourly_reset_time: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_percentage: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_reset_time: Option<i64>,
}


pub(crate) fn default_model_presets() -> Vec<CodexWakeupModelPreset> {
    Vec::new()
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWakeupSchedule {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_time: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weekly_days: Vec<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_time: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interval_hours: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quota_reset_window: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub startup_delay_minutes: Option<i32>,
}
