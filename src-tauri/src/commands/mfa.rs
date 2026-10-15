use crate::command_state::CommandState as State;

use crate::db::{MfaCode, MfaTokenInfo};
use crate::error::AppError;
use crate::services;
use crate::services::mfa_service;
use crate::AppState;

#[tauri::command]
pub fn mfa_add_uri(
    state: State<AppState>,
    uri: String,
) -> Result<MfaTokenInfo, AppError> {
    let master = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    mfa_service::add_from_uri(&db, &master, &uri)
}

#[tauri::command]
pub fn mfa_add_manual(
    state: State<AppState>,
    label: String,
    issuer: Option<String>,
    secret: String,
) -> Result<MfaTokenInfo, AppError> {
    let master = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    mfa_service::add_manual(&db, &master, &label, issuer, &secret)
}

#[tauri::command]
pub fn mfa_codes(state: State<AppState>) -> Result<Vec<MfaCode>, AppError> {
    let master = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    mfa_service::list_codes(&db, &master)
}

#[tauri::command]
pub fn mfa_remove(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _master = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    mfa_service::remove(&db, &id)
}

/// 二维码截图交前端解码（WebView 里读用户选的文件要经这条路，不必扩 fs 权限面）
#[tauri::command]
pub fn mfa_read_image(path: String) -> Result<String, AppError> {
    const MAX_BYTES: u64 = 15 * 1024 * 1024;
    let ext = std::path::Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp") {
        return Err(AppError::Backup("只支持 png / jpg / webp / bmp 图片".to_string()));
    }
    let meta = std::fs::metadata(&path)?;
    if meta.len() > MAX_BYTES {
        return Err(AppError::Backup("图片超过 15 MB，请改用较小的截图".to_string()));
    }
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path)?))
}
