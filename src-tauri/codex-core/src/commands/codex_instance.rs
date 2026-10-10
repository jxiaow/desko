// 裁剪占位：原 codex_instance 模块属于已移除能力（网关/代理/多开/他平台），
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

pub(crate) async fn codex_start_default_with_prepared_profile(
    app: AppHandle,
    emit_launch_progress: bool,
    launch_operation: Option<&str>,
    skip_failed_step: Option<&str>,
    expected_prepared_binding: Option<&str>,
) -> Result<CodexInstanceProfileView, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInstanceProfileView {
    pub id: String,
    pub name: String,
    pub user_data_dir: String,
    pub working_dir: Option<String>,
    pub extra_args: String,
    pub bind_account_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_routing: Option<CodexInstanceModelRouting>,
    pub launch_mode: InstanceLaunchMode,
    pub app_speed: CodexAppSpeed,
    pub created_at: i64,
    pub last_launched_at: Option<i64>,
    pub last_pid: Option<u32>,
    pub running: bool,
    pub initialized: bool,
    pub is_default: bool,
    pub follow_local_account: bool,
    pub auto_sync_threads: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codex_launch_credential_change: Option<CodexLaunchCredentialChange>,
}
impl CodexInstanceProfileView {
    fn from_profile(profile: InstanceProfile, running: bool, initialized: bool) -> Self {
    panic!("该能力已在裁剪版中移除")
}

}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLaunchCredentialChange {
    pub from: String,
    pub to: String,
}
pub(crate) use crate::commands::codex_instance_app_exit::{restore_mixed_model_profiles_for_app_exit};
pub(crate) use crate::commands::codex_instance_gateway_watchdog::{start_mixed_model_gateway_watchdog};
