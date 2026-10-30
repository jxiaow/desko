use crate::error::AppError;
use crate::AppState;
use tauri::{AppHandle, Emitter, State};

pub(crate) fn notify_module_change(app: &AppHandle, key: &str, value: &str) {
    if key == "codex_enabled" && value != "true" { crate::services::codex_bridge::stop(app); }
    if let Some(id) = key.strip_suffix("_enabled").filter(|id| matches!(*id, "notes" | "entries" | "files" | "mfa" | "codex" | "fileshare" | "tunnel" | "bypass")) {
        let _ = app.emit("desko:module-changed", serde_json::json!({"id":id,"enabled":value == "true"}));
    }
}

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<String, AppError> {
    if key == "codex_usage_auto_wsl" {
        return Ok(codex_core::modules::config::get_user_config().codex_usage_auto_wsl.to_string());
    }
    if key == "codex_switch_restart_codex" {
        return Ok(codex_core::modules::config::get_user_config()
            .codex_switch_restart_codex
            .to_string());
    }
    if key == "codex_usage_extra_dirs" {
        return serde_json::to_string(&codex_core::modules::config::get_user_config().codex_usage_extra_dirs)
            .map_err(|error| AppError::Setting(error.to_string()));
    }
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let value = db.get_meta(&key)?;
    Ok(value.unwrap_or_default())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, app: AppHandle, key: String, value: String) -> Result<(), AppError> {
    if key == "codex_usage_auto_wsl" {
        let enabled = value.parse::<bool>().map_err(|_| AppError::Setting("WSL 自动统计开关无效".into()))?;
        codex_core::modules::config::patch_user_config(move |config| {
            config.codex_usage_auto_wsl = enabled;
            Ok(())
        }).map_err(AppError::Setting)?;
        return Ok(());
    }
    if key == "codex_usage_extra_dirs" {
        let dirs: Vec<String> = serde_json::from_str(&value)
            .map_err(|_| AppError::Setting("额外统计目录格式无效".into()))?;
        let dirs = codex_core::modules::codex_session_manager::normalize_usage_extra_dirs(dirs)
            .map_err(AppError::Setting)?;
        codex_core::modules::config::patch_user_config(move |config| {
            config.codex_usage_extra_dirs = dirs;
            Ok(())
        }).map_err(AppError::Setting)?;
        return Ok(());
    }
    if key == "codex_switch_restart_codex" {
        let enabled = value.parse::<bool>().map_err(|_| AppError::Setting("切号重启 Codex 开关无效".into()))?;
        codex_core::modules::config::patch_user_config(move |config| {
            config.codex_switch_restart_codex = enabled;
            Ok(())
        }).map_err(AppError::Setting)?;
        return Ok(());
    }
    const ALLOWED_KEYS: &[&str] = &["auto_lock_timeout", "lock_on_close", "lock_on_system_lock", "theme", "accent", "background_atmosphere", "note_paste_cleanup", "sidebar_collapsed", "workspace_directory_open", "workspace_directory_pinned", "auto_backup_interval", "auto_backup_realtime", "keep_remote", "terminal", "notes_enabled", "entries_enabled", "files_enabled", "mfa_enabled", "fileshare_enabled", "tunnel_enabled", "codex_enabled", "bypass_enabled", "codex_quota_auto_refresh_minutes", "codex_quota_alert_threshold", "codex_hud_enabled", "codex_hud_skin", "codex_hud_ambient", "codex_hud_pinned"];
    if !ALLOWED_KEYS.contains(&key.as_str()) {
        return Err(AppError::Database(format!("setting key not allowed: {}", key)));
    }
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.set_meta(&key, &value)?;
    drop(db);
    notify_module_change(&app, &key, &value);
    Ok(())
}
