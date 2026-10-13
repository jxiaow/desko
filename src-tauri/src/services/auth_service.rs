use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crate::crypto::{decrypt_password, encrypt_password, generate_salt, compute_verify_hash, verify_master_password, derive_key, note_domain_key, EncryptedData};
use crate::db::Database;
use crate::error::AppError;

/// 解锁失败后的冷却使用单调时钟，系统时间调整不会提前解除限制。
#[derive(Default)]
pub struct UnlockThrottle {
    failures: u32,
    retry_after: Option<std::time::Instant>,
}

impl UnlockThrottle {
    pub fn check(&self, now: std::time::Instant) -> Result<(), AppError> {
        if let Some(until) = self.retry_after {
            if let Some(left) = until.checked_duration_since(now).filter(|d| !d.is_zero()) {
                return Err(AppError::UnlockRateLimited(left.as_secs() + u64::from(left.subsec_nanos() > 0)));
            }
        }
        Ok(())
    }

    pub fn failed(&mut self, now: std::time::Instant) {
        self.failures = self.failures.saturating_add(1);
        if self.failures >= 5 {
            let seconds = self.failures.saturating_sub(4).saturating_mul(5).min(60);
            self.retry_after = Some(now + std::time::Duration::from_secs(seconds as u64));
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

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
    // 验证码密钥与云端凭据同样由主密钥保护，必须随主密码一起换封。
    let mut mfa_updates = Vec::new();
    for row in db.list_mfa_rows()? {
        let sealed: EncryptedData = serde_json::from_str(&row.secret_enc)
            .map_err(|e| AppError::Crypto(e.to_string()))?;
        let plain = decrypt_password(&sealed, old_key)?;
        let next = encrypt_password(&plain, &new_key)?;
        mfa_updates.push((row.info.id, serde_json::to_string(&next)
            .map_err(|e| AppError::Crypto(e.to_string()))?));
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
    if let Some(json) = db.get_meta(crate::services::cloud_service::META_CFG)?.filter(|s| !s.is_empty()) {
        let sealed: EncryptedData = serde_json::from_str(&json)
            .map_err(|e| AppError::Crypto(e.to_string()))?;
        let plain = decrypt_password(&sealed, old_key)?;
        let next = encrypt_password(&plain, &new_key)?;
        extra_meta.push((crate::services::cloud_service::META_CFG,
            serde_json::to_string(&next).map_err(|e| AppError::Crypto(e.to_string()))?));
    }
    // 小记域密钥的主密钥封条跟着换封；解不开（历史坏数据）就留旧的，不拦改密
    if let Some(json) = db.get_meta("note_key_master_wrap")? {
        let rewrapped = (|| -> Result<String, crate::error::AppError> {
            let sealed: EncryptedData = serde_json::from_str(&json)
                .map_err(|e| crate::error::AppError::Crypto(e.to_string()))?;
            let ndk_b64 = decrypt_password(&sealed, &note_domain_key(old_key))?;
            let resealed = encrypt_password(&ndk_b64, &note_domain_key(&new_key))?;
            serde_json::to_string(&resealed).map_err(|e| crate::error::AppError::Crypto(e.to_string()))
        })();
        if let Ok(value) = rewrapped {
            extra_meta.push(("note_key_master_wrap", value));
        }
    }
    let extra_refs: Vec<(&str, &str)> = extra_meta.iter().map(|(k, v)| (*k, v.as_str())).collect();
    db.finish_password_change(&updates, &mfa_updates, now, &new_salt_b64, &new_verify_hash, &extra_refs)?;

    Ok(new_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random_bytes;
    use crate::db::{cleanup, setup_test_db};

    #[test]
    fn unlock_throttle_expires_and_success_resets_it() {
        let mut throttle = UnlockThrottle::default();
        let now = std::time::Instant::now();
        for _ in 0..4 { throttle.failed(now); }
        assert!(throttle.check(now).is_ok());
        throttle.failed(now);
        assert_eq!(throttle.check(now).unwrap_err().user_message(), "尝试次数过多，请 5 秒后重试");
        assert!(throttle.check(now + std::time::Duration::from_secs(4)).is_err());
        assert!(throttle.check(now + std::time::Duration::from_secs(5)).is_ok());
        throttle.failed(now + std::time::Duration::from_secs(5));
        assert!(throttle.check(now + std::time::Duration::from_secs(14)).is_err());
        assert!(throttle.check(now + std::time::Duration::from_secs(15)).is_ok());
        throttle.reset();
        assert!(throttle.check(now).is_ok());
    }

    #[test]
    fn master_password_change_preserves_mfa_and_cloud_credentials() {
        use crate::services::{mfa_service, cloud_service};
        let db = Database::new(":memory:").unwrap();
        let mut key = None;
        setup_master_password(&db, &mut key, "old-master").unwrap();
        let old = key.unwrap();
        mfa_service::add_manual(&db, &old, "test", None, "JBSWY33NAXE3PY3B").unwrap();
        cloud_service::save_cfg(&db, &old, &cloud_service::CloudCreds {
            server: "https://example.invalid/".into(), account: "test".into(), app_password: "app-secret".into(),
        }).unwrap();
        let new = change_master_password(&db, &old, "old-master", "new-master").unwrap();
        assert_eq!(mfa_service::list_codes(&db, &new).unwrap().len(), 1);
        assert_eq!(cloud_service::load_cfg(&db, &new).unwrap().unwrap().app_password, "app-secret");
        assert!(mfa_service::list_codes(&db, &old).is_err());
        assert!(cloud_service::load_cfg(&db, &old).is_err());
        assert_eq!(verify_password(&db, "new-master").unwrap(), new);
        assert!(verify_password(&db, "old-master").is_err());
    }

    #[test]
    fn broken_cloud_seal_aborts_password_change_without_partial_writes() {
        use crate::services::{mfa_service, cloud_service};
        let db = Database::new(":memory:").unwrap();
        let mut key = None;
        setup_master_password(&db, &mut key, "old-master").unwrap();
        let old = key.unwrap();
        mfa_service::add_manual(&db, &old, "test", None, "JBSWY33NAXE3PY3B").unwrap();
        db.set_meta(cloud_service::META_CFG, "broken seal").unwrap();
        let salt = db.get_meta("salt").unwrap();
        let secret = db.list_mfa_rows().unwrap().remove(0).secret_enc;
        assert!(change_master_password(&db, &old, "old-master", "new-master").is_err());
        assert_eq!(db.get_meta("salt").unwrap(), salt);
        assert_eq!(db.list_mfa_rows().unwrap().remove(0).secret_enc, secret);
        assert_eq!(verify_password(&db, "old-master").unwrap(), old);
        assert!(mfa_service::list_codes(&db, &old).is_ok());
    }

    fn seal_ndk(ndk: &[u8], key: &[u8]) -> String {
        let wrapped = encrypt_password(&BASE64.encode(ndk), key).unwrap();
        serde_json::to_string(&wrapped).unwrap()
    }

    fn open_ndk(json: &str, key: &[u8]) -> Vec<u8> {
        let sealed: EncryptedData = serde_json::from_str(json).unwrap();
        BASE64.decode(decrypt_password(&sealed, key).unwrap()).unwrap()
    }

    /// 换主密码必须跟着换小记域密钥的主密钥封条，否则之后的「忘口令兜底」再也解不开
    #[test]
    fn note_domain_master_wrap_survives_master_password_change() {
        let (db, path) = setup_test_db();
        let mut mk = None;
        setup_master_password(&db, &mut mk, "old-master-1").unwrap();
        let old_key = mk.unwrap();
        let ndk = random_bytes(crate::crypto::KEY_LENGTH);
        db.set_meta("note_key_master_wrap", &seal_ndk(&ndk, &note_domain_key(&old_key))).unwrap();

        let new_key = change_master_password(&db, &old_key, "old-master-1", "new-master-2").unwrap();

        let stored = db.get_meta("note_key_master_wrap").unwrap().unwrap();
        assert_eq!(open_ndk(&stored, &note_domain_key(&new_key)), ndk, "新主密钥该照样兜得回来");
        assert!(decrypt_password(&serde_json::from_str(&stored).unwrap(), &note_domain_key(&old_key)).is_err(), "旧主密钥从此解不开");
        cleanup(&path);
    }
}
