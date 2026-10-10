// 裁剪占位：原 codex_account_proxy 模块属于已移除能力（网关/代理/多开/他平台），
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
use serde::Serializer;

pub fn configured_url(account: &CodexAccount) -> Result<Option<Cow<'_, str>>, String> {
    Ok(None)
}


pub fn eligible(account: &CodexAccount) -> bool {
    false
}


pub fn has_effective_proxy(account: &CodexAccount, unified_active: bool) -> bool {
    false
}


pub(crate) fn resolve_effective<'a>(
    account: &'a CodexAccount,
    unified: Option<String>,
) -> Option<Cow<'a, str>> {
    None
}


pub fn serialize_summary<S: Serializer>(
    value: &Option<String>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str("")
}


pub fn storage_value(account: &CodexAccount) -> Result<serde_json::Value, String> {
    // 落盘链路的四个写点（保存/迁移重写/回收站）都吃这个返回值，桩 Null 会把凭据加密成空
    serde_json::to_value(account).map_err(|e| format!("序列化账号详情失败: {}", e))
}
