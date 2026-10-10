// 裁剪占位：原 codex_speed 模块属于已移除能力（网关/代理/多开/他平台），
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

pub fn get_api_service_app_speed_config() -> Result<CodexAppSpeedConfig, String> {
    Ok(CodexAppSpeedConfig { speed: CodexAppSpeed::default(), global_state_path: String::new() })
}


pub fn get_app_speed_config() -> Result<CodexAppSpeedConfig, String> {
    Ok(CodexAppSpeedConfig { speed: CodexAppSpeed::default(), global_state_path: String::new() })
}


pub fn save_api_service_app_speed(speed: CodexAppSpeed) -> Result<CodexAppSpeedConfig, String> {
    Ok(CodexAppSpeedConfig { speed, global_state_path: String::new() })
}


pub fn write_app_speed_for_dir(
    _base_dir: &Path,
    speed: CodexAppSpeed,
) -> Result<CodexAppSpeedConfig, String> {
    // desko 的切号投影只写 auth.json，不改官方 config.toml 的速度键（见设计文档 §6）。
    Ok(CodexAppSpeedConfig { speed, global_state_path: String::new() })
}


pub fn write_official_app_speed(speed: CodexAppSpeed) -> Result<CodexAppSpeedConfig, String> {
    Ok(CodexAppSpeedConfig { speed, global_state_path: String::new() })
}
