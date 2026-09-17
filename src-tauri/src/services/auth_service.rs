use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crate::crypto::{decrypt_password, encrypt_password, generate_salt, compute_verify_hash, verify_master_password, derive_key, EncryptedData};
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
    db.finish_password_change(&updates, now, &new_salt_b64, &new_verify_hash)?;

    Ok(new_key)
}
