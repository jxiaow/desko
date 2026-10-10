// 裁剪占位：原 codex_proxy_desktop_router 模块属于已移除能力（网关/代理/多开/他平台），
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
pub(crate) use self::Status as EntryStatus;

pub async fn restore_account_entry(account_id: &str) -> Result<(), String> {
    Ok(())
}


pub async fn restore_on_startup() {
    ()
}


#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: &'static str,
    pub port: Option<u16>,
    pub request_count: u64,
    pub last_request_state: &'static str,
    pub last_error: Option<&'static str>,
}
impl Status {
    fn new(state: &'static str, port: Option<u16>) -> Self {
    panic!("该能力已在裁剪版中移除")
}

}
