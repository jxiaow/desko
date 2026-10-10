// desko 门面：仅保留 Codex 账号域引用到的定义（内容逐字节取自上游同名模块）。
#![allow(dead_code, unused_imports, unused_variables, clippy::all)]
use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;
use crate::models::{Account, AccountIndex, AccountSummary, QuotaData, QuotaErrorInfo, TokenData};
use crate::modules;

const ACCOUNTS_DIR: &str = "accounts";

/// 获取数据目录路径
pub fn is_dev_profile() -> bool {
    modules::data_paths::is_dev_profile()
}

pub fn resolve_data_dir() -> Result<PathBuf, String> {
    modules::data_paths::resolve_data_dir()
}

pub fn get_data_dir() -> Result<PathBuf, String> {
    // #816: tests can isolate storage via env without touching real user data.
    // Prefer COCKPIT_TOOLS_TEST_DATA_DIR (community PR name); keep COCKPIT_TEST_DATA_DIR alias.
    for key in [
        "COCKPIT_TOOLS_TEST_DATA_DIR",
        "COCKPIT_TEST_DATA_DIR",
        "COCKPIT_TOOLS_DATA_DIR",
    ] {
        if let Ok(override_dir) = std::env::var(key) {
            let override_dir = override_dir.trim();
            if !override_dir.is_empty() {
                let data_dir = PathBuf::from(override_dir);
                if !data_dir.exists() {
                    fs::create_dir_all(&data_dir)
                        .map_err(|e| format!("创建测试数据目录失败: {}", e))?;
                }
                return Ok(data_dir);
            }
        }
    }

    #[cfg(test)]
    let data_dir = crate::modules::test_support::fallback_data_dir();
    #[cfg(not(test))]
    let data_dir = resolve_data_dir()?;

    if !data_dir.exists() {
        fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    }

    Ok(data_dir)
}

#[derive(Debug, Clone, Serialize)]
pub struct QuotaAlertPayload {
    pub platform: String,
    pub current_account_id: String,
    pub current_email: String,
    pub threshold: i32,
    pub threshold_display: Option<String>,
    pub lowest_percentage: i32,
    pub low_models: Vec<String>,
    pub recommended_account_id: Option<String>,
    pub recommended_email: Option<String>,
    pub triggered_at: i64,
}

fn build_quota_alert_notification_text(payload: &QuotaAlertPayload) -> (String, String) {
    let locale = crate::modules::config::get_user_config().language;
    let threshold_text = payload.threshold.to_string();
    let lowest_text = payload.lowest_percentage.to_string();
    let model_text = if payload.low_models.is_empty() {
        modules::i18n::translate(&locale, "quotaAlert.modal.unknownModel", &[])
    } else {
        payload.low_models.join(", ")
    };

    let platform_label = match payload.platform.as_str() {
        "codex" => "Codex",
        "github_copilot" => "GitHub Copilot",
        "windsurf" => "Windsurf",
        "kiro" => "Kiro",
        "cursor" => "Cursor",
        "grok" => "Grok CLI",
        "codebuddy" => "CodeBuddy",
        "zed" => "Zed",
        _ => "Antigravity IDE",
    };
    let title = format!(
        "{} {}",
        platform_label,
        modules::i18n::translate(&locale, "quotaAlert.modal.title", &[])
    );
    let mut body = modules::i18n::translate(
        &locale,
        "quotaAlert.bannerText",
        &[
            ("email", payload.current_email.as_str()),
            ("threshold", threshold_text.as_str()),
            ("lowest", lowest_text.as_str()),
            ("models", model_text.as_str()),
        ],
    );
    if let Some(email) = payload.recommended_email.as_ref() {
        let recommended_label =
            modules::i18n::translate(&locale, "quotaAlert.modal.recommended", &[]);
        body.push_str(" · ");
        body.push_str(&format!("{}: {}", recommended_label, email));
    }
    (title, body)
}

pub fn emit_quota_alert(app_handle: &tauri::AppHandle, payload: &QuotaAlertPayload) {
    use tauri::Emitter;
    let _ = app_handle.emit("quota:alert", payload);
}

#[cfg(not(target_os = "macos"))]
pub fn send_quota_alert_native_notification(payload: &QuotaAlertPayload) {
    let Some(app_handle) = crate::get_app_handle() else {
        return;
    };

    use tauri_plugin_notification::NotificationExt;

    let (title, body) = build_quota_alert_notification_text(payload);

    if let Err(e) = app_handle
        .notification()
        .builder()
        .title(&title)
        .body(body)
        .show()
    {
        modules::logger::log_warn(&format!("[QuotaAlert] 原生通知发送失败: {}", e));
    }
}

#[cfg(target_os = "macos")]
pub fn send_quota_alert_native_notification(payload: &QuotaAlertPayload) {
    let Some(app_handle) = crate::get_app_handle() else {
        return;
    };
    let bundle_identifier = app_handle.config().identifier.to_string();
    let (title, body) = build_quota_alert_notification_text(payload);

    std::thread::spawn(move || {
        let mut notification = mac_notification_sys::Notification::new();
        // Fire-and-forget on macOS. Waiting for clicks keeps a dedicated run loop alive
        // inside mac-notification-sys, which can cause persistent background energy usage.
        notification
            .title(title.as_str())
            .message(body.as_str())
            .wait_for_click(false)
            .asynchronous(true);

        if let Err(e) = mac_notification_sys::set_application(&bundle_identifier) {
            modules::logger::log_warn(&format!("[QuotaAlert] 设置通知应用标识失败: {}", e));
        }

        if let Err(e) = notification.send() {
            modules::logger::log_warn(&format!("[QuotaAlert] 原生通知发送失败: {}", e));
        }
    });
}

pub fn dispatch_quota_alert(payload: &QuotaAlertPayload) {
    modules::logger::log_warn(&format!(
        "[QuotaAlert] 触发配额预警: platform={}, current_id={}, threshold={}%, lowest={}%",
        payload.platform, payload.current_account_id, payload.threshold, payload.lowest_percentage
    ));

    if let Some(app_handle) = crate::get_app_handle() {
        emit_quota_alert(app_handle, payload);
    }
    send_quota_alert_native_notification(payload);
}
