// 裁剪占位：原 instance 模块属于已移除能力（网关/代理/多开/他平台），
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

pub fn get_all_antigravity_user_data_dirs() -> Vec<PathBuf> {
    Vec::new()
}


pub fn get_default_user_data_dir() -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub fn inject_account_to_profile_with_account(
    profile_dir: &Path,
    account: &Account,
) -> Result<(), String> {
    Ok(())
}


pub fn load_default_settings() -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn load_instance_store() -> Result<InstanceStore, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn update_default_pid(pid: Option<u32>) -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


pub fn update_default_settings(
    bind_account_id: Option<Option<String>>,
    extra_args: Option<String>,
    follow_local_account: Option<bool>,
) -> Result<DefaultInstanceSettings, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}
