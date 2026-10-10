// 裁剪占位：原 trae_account 模块属于已移除能力（网关/代理/多开/他平台），
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraePlatformKind {
    Trae,
    TraeSolo,
    TraeCn,
    TraeSoloCn,
}
impl TraePlatformKind {
    pub fn parse(raw: Option<&str>) -> Result<Self, String> {
    Err(String::from("该能力已在裁剪版中移除"))
}


    pub fn provider_key(self) -> &'static str {
    ""
}


    pub fn display_name(self) -> &'static str {
    ""
}


    pub fn is_cn(self) -> bool {
    false
}


    pub fn is_solo(self) -> bool {
    false
}


    pub fn auth_client_id(self) -> &'static str {
    ""
}


    pub fn auth_domain(self) -> &'static str {
    ""
}


    pub fn default_login_host(self) -> String {
    String::new()
}


    pub fn app_support_dir_name(self) -> &'static str {
    ""
}


    #[cfg(target_os = "macos")]
    pub fn macos_app_name(self) -> &'static str {
    ""
}

}


pub fn get_default_trae_data_dir_for_platform(
    platform: TraePlatformKind,
) -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub(crate) fn windows_trae_install_base_paths(platform: TraePlatformKind) -> Vec<PathBuf> {
    Vec::new()
}
