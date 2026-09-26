use crate::error::AppError;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let value = db.get_meta(&key)?;
    Ok(value.unwrap_or_default())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), AppError> {
    const ALLOWED_KEYS: &[&str] = &["auto_lock_timeout", "lock_on_close", "lock_on_system_lock", "theme", "accent", "auto_backup_interval", "auto_backup_realtime", "keep_remote", "terminal", "mfa_enabled", "fileshare_enabled"];
    if !ALLOWED_KEYS.contains(&key.as_str()) {
        return Err(AppError::Database(format!("setting key not allowed: {}", key)));
    }
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.set_meta(&key, &value)
}
