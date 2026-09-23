//! 小记单条加密：每条一把随机 DEK，正文用 DEK 封进 cipher 列；
//! DEK 本身存两条封条——口令封条（日常解锁）与主密钥封条（忘密兜底）。
//! 解锁后的 DEK 只驻内存（AppState.note_keys），应用锁定即清。

use crate::crypto::{self, EncryptedData};
use crate::error::AppError;
use crate::services::{self, auth_service, note_service};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tauri::State;

fn lock_err<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::Database("lock error".to_string())
}

/// 会话内已解锁的 DEK；取不到就说明这条还锁着
pub fn get_dek(state: &AppState, id: &str) -> Result<Vec<u8>, AppError> {
    let keys = state.note_keys.lock().map_err(lock_err)?;
    keys.get(id).cloned().ok_or_else(|| AppError::Database("小记未解锁".to_string()))
}

fn put_dek(state: &AppState, id: &str, dek: Vec<u8>) -> Result<(), AppError> {
    state.note_keys.lock().map_err(lock_err)?.insert(id.to_string(), dek);
    Ok(())
}

pub fn drop_dek(state: &AppState, id: &str) {
    if let Ok(mut keys) = state.note_keys.lock() {
        keys.remove(id);
    }
}

fn decode_wrap(b64_json: &str) -> Result<EncryptedData, AppError> {
    serde_json::from_str(b64_json).map_err(|e| AppError::Crypto(e.to_string()))
}

fn unwrap_dek(wrap: &EncryptedData, key: &[u8]) -> Result<Vec<u8>, AppError> {
    // GCM 校验失败即密码不对，不区分"数据坏了"，避免给探测者反馈
    let dek_b64 = crypto::decrypt_password(wrap, key).map_err(|_| AppError::WrongPassword)?;
    Ok(BASE64.decode(&dek_b64).map_err(|e| AppError::Crypto(e.to_string()))?)
}

fn read_cipher(lock: &crate::db::NoteLockRow, dek: &[u8]) -> Result<String, AppError> {
    crypto::decrypt_password(
        &EncryptedData { ciphertext: lock.cipher.clone(), iv: lock.cipher_iv.clone() },
        dek,
    )
}

#[tauri::command]
pub fn lock_note(state: State<AppState>, id: String, passphrase: String) -> Result<(), AppError> {
    let master_key = services::get_master_key(&state)?;
    if passphrase.is_empty() {
        return Err(AppError::Database("加密口令不能为空".to_string()));
    }
    let db = state.db.lock().map_err(lock_err)?;
    let note = db.get_note(&id)?.ok_or(AppError::EntryNotFound)?;
    if note.encrypted {
        return Err(AppError::Database("这条小记已加密".to_string()));
    }
    if note.content_html.is_empty() {
        return Err(AppError::Database("空内容不用加密".to_string()));
    }

    let dek = crypto::random_bytes(crypto::KEY_LENGTH);
    let enc = crypto::encrypt_password(&note.content_html, &dek)?;
    let dek_b64 = BASE64.encode(&dek);

    let salt = crypto::generate_salt();
    let kpass = crypto::derive_key(&passphrase, &salt);
    let wrap_pass = serde_json::to_string(&crypto::encrypt_password(&dek_b64, &kpass)?)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let wrap_master = serde_json::to_string(&crypto::encrypt_password(&dek_b64, &crypto::note_wrap_key(&master_key, &id))?)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let now = chrono::Utc::now().timestamp_millis();
    db.set_note_lock(&id, &enc.ciphertext, &enc.iv, &wrap_pass, &BASE64.encode(&salt), &wrap_master, now)?;
    drop(db);
    put_dek(&state, &id, dek)?; // 刚锁完让人继续看，重锁走 relock_note
    Ok(())
}

#[tauri::command]
pub fn unlock_note(state: State<AppState>, id: String, passphrase: String) -> Result<String, AppError> {
    let db = state.db.lock().map_err(lock_err)?;
    let lock = db.get_note_lock(&id)?.ok_or_else(|| AppError::Database("这条小记没有加密".to_string()))?;
    let salt = BASE64.decode(&lock.pass_salt).map_err(|e| AppError::Crypto(e.to_string()))?;
    let kpass = crypto::derive_key(&passphrase, &salt);
    let dek = unwrap_dek(&decode_wrap(&lock.wrap_pass)?, &kpass)?;
    let html = read_cipher(&lock, &dek)?;
    drop(db);
    put_dek(&state, &id, dek)?;
    Ok(html)
}

/// 兜底路径：用主密码解封（要求重新输入主密码，光有解锁会话不够）
#[tauri::command]
pub fn unlock_note_by_master(
    state: State<AppState>,
    id: String,
    master_password: String,
) -> Result<String, AppError> {
    let db = state.db.lock().map_err(lock_err)?;
    let master_key = auth_service::verify_password(&db, &master_password)?;
    let lock = db.get_note_lock(&id)?.ok_or_else(|| AppError::Database("这条小记没有加密".to_string()))?;
    let dek = unwrap_dek(&decode_wrap(&lock.wrap_master)?, &crypto::note_wrap_key(&master_key, &id))?;
    let html = read_cipher(&lock, &dek)?;
    drop(db);
    put_dek(&state, &id, dek)?;
    Ok(html)
}

#[tauri::command]
pub fn relock_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    drop_dek(&state, &id);
    Ok(())
}

/// 解除加密：要求已解锁（拿得到 DEK），明文随 input 写回普通列
#[tauri::command]
pub fn remove_note_lock(
    state: State<AppState>,
    id: String,
    input: crate::db::UpdateNoteInput,
) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let dek = get_dek(&state, &id)?;
    // 先验一把：DEK 必须真能解开当前密文，防止半路改坏
    {
        let db = state.db.lock().map_err(lock_err)?;
        if let Some(lock) = db.get_note_lock(&id)? {
            read_cipher(&lock, &dek)?;
        }
        db.clear_note_lock(&id)?;
        note_service::update_note(&db, &id, input)?;
    }
    drop_dek(&state, &id);
    Ok(())
}

/// 刷新后找回会话内已解锁的正文
#[tauri::command]
pub fn reveal_note(state: State<AppState>, id: String) -> Result<String, AppError> {
    let dek = get_dek(&state, &id)?;
    let db = state.db.lock().map_err(lock_err)?;
    let lock = db.get_note_lock(&id)?.ok_or_else(|| AppError::Database("这条小记没有加密".to_string()))?;
    read_cipher(&lock, &dek)
}
