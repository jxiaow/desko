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
    let mut attempts = state.unlock_attempts.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attempts.check(std::time::Instant::now())?;

    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    match auth_service::verify_password(&db, &password) {
        Ok(key) => {
            *master_key = Some(key);
            attempts.reset();
            state.lock_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
        Err(e) => {
            if matches!(e, AppError::WrongPassword) {
                attempts.failed(std::time::Instant::now());
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), AppError> {
    clear_keys(&state)
}

pub(crate) fn clear_keys(state: &AppState) -> Result<(), AppError> {
    clear_keys_for_epoch(state, None).map(|_| ())
}

fn clear_keys_for_epoch(state: &AppState, expected: Option<u64>) -> Result<bool, AppError> {
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    if expected.is_some_and(|epoch| state.lock_epoch.load(std::sync::atomic::Ordering::SeqCst) != epoch) {
        return Ok(false);
    }
    *master_key = None;
    state.lock_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Ok(mut backup_key) = state.backup_key.lock() {
        *backup_key = None;
    }
    // 锁定本身不重置失败计数，否则在冷却期调用 lock 就能绕过限流。
    crate::commands::note_lock::close_domain(state);
    Ok(true)
}

/// 给前端完成待保存小记的机会；WebView 无响应时两秒后仍由后端收回密钥。
pub(crate) fn request_lock(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    let epoch = state.lock_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    if app.emit("tray-lock", ()).is_err() {
        let _ = clear_keys(&state);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let state = handle.state::<AppState>();
        if clear_keys_for_epoch(&state, Some(epoch)).unwrap_or(false) {
            let _ = handle.emit("tray-lock", ());
        }
    });
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_lock_request_cannot_clear_a_new_unlock_session() {
        let state = crate::test_state();
        *state.master_key.lock().unwrap() = Some(vec![1; 32]);
        state.lock_epoch.store(2, std::sync::atomic::Ordering::SeqCst);
        assert!(!clear_keys_for_epoch(&state, Some(1)).unwrap());
        assert!(state.master_key.lock().unwrap().is_some());
        assert!(clear_keys_for_epoch(&state, Some(2)).unwrap());
        assert!(state.master_key.lock().unwrap().is_none());
    }

    #[test]
    fn locking_does_not_bypass_unlock_cooldown() {
        let state = crate::test_state();
        let now = std::time::Instant::now();
        for _ in 0..5 { state.unlock_attempts.lock().unwrap().failed(now); }
        clear_keys(&state).unwrap();
        assert!(state.unlock_attempts.lock().unwrap().check(now).is_err());
    }
}
