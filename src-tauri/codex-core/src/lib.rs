// Derived from jlcodes99/cockpit-tools (licensed CC-BY-NC-SA-4.0)
// https://github.com/jlcodes99/cockpit-tools
// Modified for desko: 只保留 Codex 账号管理与切换域，删除代理引擎、本地 API 网关、
// 桌面 App 注入、多实例/Agent Identity、唤醒调度与其他平台账号模块；keeper 文件与上游逐字节一致。
#![allow(dead_code, unused_variables, unused_imports, unused_mut, clippy::all)]

pub mod commands;
pub mod error;
pub mod models;
pub mod modules;
pub mod utils;

use std::sync::OnceLock;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

/// desko 在 setup 阶段注入，供配额预警等事件使用（与上游 lib.rs 同名同义）。
pub fn set_app_handle(handle: tauri::AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// 获取全局 AppHandle，与上游 crate::get_app_handle() 同名同语义。
pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}
