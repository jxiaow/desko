use crate::error::AppError;
use crate::services::auth_service;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn is_initialized(state: State<AppState>) -> Result<bool, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.is_initialized()
}

#[tauri::command]
pub fn setup_master_password(state: State<AppState>, password: String) -> Result<(), AppError> {
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    auth_service::setup_master_password(&db, &mut master_key, &password)
}

#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Result<(), AppError> {
    {
        let attempts = state.unlock_attempts.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        if *attempts >= 5 {
            let delay_secs = (*attempts - 4) * 5;
            return Err(AppError::Database(format!("尝试次数过多，请 {} 秒后重试", delay_secs)));
        }
    }

    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    match auth_service::verify_password(&db, &password) {
        Ok(key) => {
            *master_key = Some(key);
            if let Ok(mut attempts) = state.unlock_attempts.lock() {
                *attempts = 0;
            }
            Ok(())
        }
        Err(e) => {
            if let Ok(mut attempts) = state.unlock_attempts.lock() {
                *attempts += 1;
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), AppError> {
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    *master_key = None;
    if let Ok(mut backup_key) = state.backup_key.lock() {
        *backup_key = None;
    }
    if let Ok(mut attempts) = state.unlock_attempts.lock() {
        *attempts = 0;
    }
    // 解锁会话到头：小记域密钥连同全部 DEK 一并收回，加密小记重新锁上
    crate::commands::note_lock::close_domain(&state);
    Ok(())
}

#[tauri::command]
pub fn change_master_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), AppError> {
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let old_key = master_key.as_ref().ok_or(AppError::NotUnlocked)?;
    let new_key = auth_service::change_master_password(&db, old_key, &old_password, &new_password)?;
    *master_key = Some(new_key);

    Ok(())
}
