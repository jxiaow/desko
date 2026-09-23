use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crate::crypto::{decrypt_password, encrypt_password, generate_salt, compute_verify_hash, verify_master_password, derive_key, note_wrap_key, EncryptedData};
use crate::db::Database;
use crate::error::AppError;

pub fn setup_master_password(db: &Database, master_key: &mut Option<Vec<u8>>, password: &str) -> Result<(), AppError> {
    if db.is_initialized()? {
        return Err(AppError::AlreadyInitialized);
    }

    let salt = generate_salt();
    let key = derive_key(password, &salt);
    let verify_hash = compute_verify_hash(&key);

    db.set_meta("initialized", "true")?;
    db.set_meta("salt", &BASE64.encode(&salt))?;
    db.set_meta("verify_hash", &verify_hash)?;

    *master_key = Some(key);

    Ok(())
}

pub fn verify_password(db: &Database, password: &str) -> Result<Vec<u8>, AppError> {
    if !db.is_initialized()? {
        return Err(AppError::NotInitialized);
    }

    let salt_b64 = db.get_meta("salt")?.ok_or(AppError::NotInitialized)?;
    let salt = BASE64.decode(&salt_b64).map_err(|e| AppError::Crypto(e.to_string()))?;

    let verify_hash = db.get_meta("verify_hash")?.ok_or(AppError::NotInitialized)?;

    verify_master_password(password, &salt, &verify_hash)
}

pub fn change_master_password(db: &Database, old_key: &[u8], old_password: &str, new_password: &str) -> Result<Vec<u8>, AppError> {
    let salt_b64 = db.get_meta("salt")?.ok_or(AppError::NotInitialized)?;
    let old_salt = BASE64.decode(&salt_b64).map_err(|e| AppError::Crypto(e.to_string()))?;

    let verify_hash = db.get_meta("verify_hash")?.ok_or(AppError::NotInitialized)?;
    verify_master_password(old_password, &old_salt, &verify_hash)?;

    let new_salt = generate_salt();
    let new_key = derive_key(new_password, &new_salt);
    let new_verify_hash = compute_verify_hash(&new_key);

    let entries = db.list_all_entries()?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut updates: Vec<(String, String)> = Vec::with_capacity(entries.len());
    for entry in &entries {
        let encrypted: EncryptedData = serde_json::from_str(&entry.encrypted_password)
            .map_err(|e| AppError::Crypto(e.to_string()))?;

        let plaintext = decrypt_password(&encrypted, old_key)?;
        let new_encrypted = encrypt_password(&plaintext, &new_key)?;
        let new_encrypted_json = serde_json::to_string(&new_encrypted)
            .map_err(|e| AppError::Crypto(e.to_string()))?;

        updates.push((entry.id.clone(), new_encrypted_json));
    }
    let new_salt_b64 = BASE64.encode(&new_salt);
    // 备份密钥是用旧主密钥封存的，同一事务里换封
    let mut extra_meta: Vec<(&str, String)> = Vec::new();
    let backup_key_json = db.get_meta(crate::services::backup_service::META_KEY)?;
    let rewrapped;
    if let Some(json) = backup_key_json.as_deref() {
        let sealed: EncryptedData = serde_json::from_str(json).map_err(|e| AppError::Crypto(e.to_string()))?;
        let b64 = decrypt_password(&sealed, old_key)?;
        let sealed_new = encrypt_password(&b64, &new_key)?;
        rewrapped = serde_json::to_string(&sealed_new).map_err(|e| AppError::Crypto(e.to_string()))?;
        extra_meta.push((crate::services::backup_service::META_KEY, rewrapped));
    }
    let extra_refs: Vec<(&str, &str)> = extra_meta.iter().map(|(k, v)| (*k, v.as_str())).collect();
    // 加密小记的主密钥封条跟着换封；个别封条解不开（历史坏数据）就留旧的，不拦改密
    let mut note_wraps: Vec<(String, String)> = Vec::new();
    for (id, wrap) in db.list_note_wrap_masters()? {
        let rewrapped = (|| -> Result<String, crate::error::AppError> {
            let sealed: EncryptedData = serde_json::from_str(&wrap)
                .map_err(|e| crate::error::AppError::Crypto(e.to_string()))?;
            let dek_b64 = decrypt_password(&sealed, &note_wrap_key(old_key, &id))?;
            let resealed = encrypt_password(&dek_b64, &note_wrap_key(&new_key, &id))?;
            serde_json::to_string(&resealed).map_err(|e| crate::error::AppError::Crypto(e.to_string()))
        })();
        if let Ok(json) = rewrapped {
            note_wraps.push((id, json));
        }
    }
    db.finish_password_change(&updates, now, &new_salt_b64, &new_verify_hash, &extra_refs, &note_wraps)?;

    Ok(new_key)
}
