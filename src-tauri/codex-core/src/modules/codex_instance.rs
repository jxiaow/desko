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

pub const CODEX_API_SERVICE_BIND_ACCOUNT_ID: &str = "__api_service__";


pub(crate) const CODEX_DEFAULT_INSTANCE_ID: &str = "__default__";


pub(crate) fn bind_default_account_for_switch(account_id: &str) -> Result<(), String> {
    Ok(())
}


pub fn disable_model_routing(instance_id: &str) -> Result<bool, String> {
    Ok(false)
}


pub fn disable_model_routing_for_deleted_accounts(
    deleted_account_ids: &[String],
) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}


pub fn get_default_codex_home() -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn get_linux_app_user_data_dir(codex_home: &Path) -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn get_macos_app_user_data_dir(codex_home: &Path) -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn get_windows_app_user_data_dir(codex_home: &Path) -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn is_api_service_bind_account_id(account_id: &str) -> bool {
    false
}


pub fn load_default_settings() -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn load_instance_store() -> Result<InstanceStore, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn parse_provider_gateway_bind_account_id(account_id: &str) -> Option<String> {
    None
}


pub async fn preflight_egress_proxy_for_bind_account(bind_account_id: Option<&str>) -> Result<(), String> {
    Ok(())
}


pub fn profile_dir_for_instance(instance_id: &str) -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn provider_gateway_bind_account_id(account_id: &str) -> Option<String> {
    None
}


pub fn replace_bind_account_references(old_account_id: &str, new_account_id: &str) -> Result<(), String> {
    Ok(())
}


pub fn update_bound_instances_app_speed(
    account_id: &str,
    speed: CodexAppSpeed,
) -> Result<Vec<InstanceProfile>, String> {
    Ok(Vec::new())
}


pub fn update_default_app_speed(speed: CodexAppSpeed) -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn update_default_pid(pid: Option<u32>) -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}
