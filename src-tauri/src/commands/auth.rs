use crate::error::AppError;
use crate::services::auth_service;
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn is_initialized(state: State<AppState>) -> Result<bool, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.is_initialized()
}

#[tauri::command]
pub async fn setup_master_password(app: AppHandle, password: String) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || setup_master_password_with_state(&app.state::<AppState>(), password))
        .await.map_err(|_| AppError::Crypto("初始化口令任务失败".into()))?
}

fn setup_master_password_with_state(state: &AppState, password: String) -> Result<(), AppError> {
    let _web_session = crate::web_access::SESSION_GATE.write().map_err(|_| AppError::Database("Web 会话状态无法读取".into()))?;
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    auth_service::setup_master_password(&db, &mut master_key, &password)?;
    state.lock_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn unlock(app: AppHandle, password: String) -> Result<(), AppError> {
    let handle = app.clone();
    let warning = tauri::async_runtime::spawn_blocking(move || unlock_with_state(&handle.state::<AppState>(), password))
        .await.map_err(|_| AppError::Crypto("解锁任务失败".into()))??;
    if warning {
        // 明细可能包含坏数据的位置，不发到前端；仅告知保护升级没有完成。
        let _ = app.emit("auth-kdf-upgrade-warning", ());
    }
    Ok(())
}

/// 返回 true 表示认证成功，但旧格式的保护升级应在之后重试。
fn unlock_with_state(state: &AppState, password: String) -> Result<bool, AppError> {
    let _web_session = crate::web_access::SESSION_GATE.write().map_err(|_| AppError::Database("Web 会话状态无法读取".into()))?;
    let mut attempts = state.unlock_attempts.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attempts.check(std::time::Instant::now())?;
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let key = match auth_service::verify_password(&db, &password) {
        Ok(key) => key,
        Err(error) => {
            if matches!(error, AppError::WrongPassword) { attempts.failed(std::time::Instant::now()); }
            return Err(error);
        }
    };
    let mut warning = false;
    let next = if auth_service::kdf_iterations(&db, auth_service::META_KDF)? < crate::crypto::PASSWORD_ITERATIONS {
        let mut drafts = state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?;
        match auth_service::change_master_password_prepared(&db, &key, &password, &password,
            |new| drafts.rekeyed(&key, new)) {
            Ok((next, prepared)) => { *drafts = prepared; state.data_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst); next }
            Err(error) => {
                // 只有再次验证库仍使用旧密钥时才允许降级为这次旧格式会话。
                // 若提交已改变密钥，绝不能把旧钥匙安装进新格式库。
                if auth_service::verify_password(&db, &password)? != key { return Err(error); }
                warning = true;
                key
            }
        }
    } else { key };
    *master_key = Some(next);
    attempts.reset();
    state.lock_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(warning)
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), AppError> {
    clear_keys(&state)
}

pub(crate) fn clear_keys(state: &AppState) -> Result<(), AppError> {
    clear_keys_for_epoch(state, None).map(|_| ())
}

fn clear_keys_for_epoch(state: &AppState, expected: Option<u64>) -> Result<bool, AppError> {
    let _web_session = crate::web_access::SESSION_GATE.write().map_err(|_| AppError::Database("Web 会话状态无法读取".into()))?;
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
    let epoch = {
        let _web_session = crate::web_access::SESSION_GATE.write().unwrap_or_else(|error| error.into_inner());
        state.lock_epoch.fetch_add(1, Ordering::SeqCst) + 1
    };
    if app.emit("tray-lock", serde_json::json!({"forced": false})).is_err() {
        let _ = clear_keys(&state);
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let state = handle.state::<AppState>();
        if clear_keys_for_epoch(&state, Some(epoch)).unwrap_or(false) {
            let _ = handle.emit("tray-lock", serde_json::json!({"forced": true}));
        }
    });
}

#[tauri::command]
pub async fn change_master_password(app: AppHandle, old_password: String, new_password: String) -> Result<(), AppError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move ||
        change_master_password_with_state(&handle.state::<AppState>(), old_password, new_password))
        .await.map_err(|_| AppError::Crypto("修改口令任务失败".into()))??;
    crate::web_access::revoke(&app);
    Ok(())
}

fn change_master_password_with_state(state: &AppState, old_password: String, new_password: String) -> Result<(), AppError> {
    let _web_session = crate::web_access::SESSION_GATE.write().map_err(|_| AppError::Database("Web 会话状态无法读取".into()))?;
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let old_key = master_key.as_ref().ok_or(AppError::NotUnlocked)?;
    let mut drafts = state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?;
    let (new_key, next_drafts) = auth_service::change_master_password_prepared(&db, old_key, &old_password, &new_password,
        |new| drafts.rekeyed(old_key, new))?;
    *drafts = next_drafts;
    *master_key = Some(new_key);
    state.data_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_lock_waits_for_the_web_command_read_lease() {
        let state = std::sync::Arc::new(crate::test_state());
        *state.master_key.lock().unwrap() = Some(vec![1; 32]);
        let read = crate::web_access::SESSION_GATE.read().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker_state = state.clone();
        let worker = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            done_tx.send(clear_keys(&worker_state)).unwrap();
        });
        started_rx.recv().unwrap();
        assert!(matches!(done_rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty)));
        assert!(state.master_key.lock().unwrap().is_some());
        drop(read);
        done_rx.recv_timeout(std::time::Duration::from_secs(15)).unwrap().unwrap();
        worker.join().unwrap();
        assert!(state.master_key.lock().unwrap().is_none());
    }

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
    #[test]
    fn legacy_unlock_with_a_broken_seal_keeps_the_old_session_and_reports_upgrade_warning() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let state = crate::test_state();
        let password = "legacy-password";
        let salt = crate::crypto::generate_salt();
        let old = crate::crypto::derive_key(password, &salt);
        {
            let db = state.db.lock().unwrap();
            db.set_meta_batch(&[("initialized", "true"), ("salt", &BASE64.encode(&salt)),
                ("verify_hash", &crate::crypto::compute_verify_hash(&old))]).unwrap();
            db.set_meta(crate::services::cloud_service::META_CFG, "broken seal").unwrap();
        }
        assert!(unlock_with_state(&state, password.into()).unwrap());
        assert_eq!(state.master_key.lock().unwrap().as_ref().unwrap(), &old);
        let db = state.db.lock().unwrap();
        assert_eq!(auth_service::kdf_iterations(&db, auth_service::META_KDF).unwrap(), crate::crypto::LEGACY_ITERATIONS);
        assert_eq!(auth_service::verify_password(&db, password).unwrap(), old);
    }

    #[test]
    fn changing_master_password_requires_an_active_session() {
        let state = crate::test_state();
        assert!(matches!(change_master_password_with_state(&state, "old".into(), "new".into()), Err(AppError::NotUnlocked)));
    }

    #[test]
    fn successful_legacy_unlock_upgrades_the_key_and_preserves_staged_edits() {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let state = crate::test_state();
        let password = "legacy-password";
        let salt = crate::crypto::generate_salt();
        let old = crate::crypto::derive_key(password, &salt);
        let note = {
            let db = state.db.lock().unwrap();
            db.set_meta_batch(&[("initialized", "true"), ("salt", &BASE64.encode(&salt)),
                ("verify_hash", &crate::crypto::compute_verify_hash(&old))]).unwrap();
            crate::services::note_service::create_note(&db, crate::db::CreateNoteInput {
                title: "fixture".into(), content_html: "saved".into(), category: None,
            }).unwrap()
        };
        *state.master_key.lock().unwrap() = Some(old.clone());
        let input = crate::db::UpdateNoteInput { title: "fixture".into(), content_html: "staged edit".into(), category: None };
        crate::services::note_draft_service::stage(&state, vec![crate::services::note_draft_service::NoteDraft {
            id: note.id, input: input.clone(),
        }]).unwrap();
        clear_keys(&state).unwrap();
        assert!(!unlock_with_state(&state, password.into()).unwrap());
        let key = state.master_key.lock().unwrap().clone().unwrap();
        assert_ne!(key, old);
        assert_eq!(auth_service::kdf_iterations(&state.db.lock().unwrap(), auth_service::META_KDF).unwrap(), crate::crypto::PASSWORD_ITERATIONS);
        assert_eq!(crate::services::note_draft_service::recover(&state).unwrap()[0].input, input);
    }

    #[test]
    fn an_earlier_lock_request_cannot_clear_a_newly_initialized_session() {
        let state = crate::test_state();
        state.lock_epoch.store(1, std::sync::atomic::Ordering::SeqCst);
        setup_master_password_with_state(&state, "new-password".into()).unwrap();
        assert!(!clear_keys_for_epoch(&state, Some(1)).unwrap());
        assert!(state.master_key.lock().unwrap().is_some());
    }

}
