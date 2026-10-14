use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use crate::crypto::{decrypt_password, encrypt_password, generate_salt, compute_verify_hash, note_domain_key, EncryptedData};
use crate::db::Database;
use crate::error::AppError;

pub const META_KDF: &str = "master_kdf_iterations";
pub fn kdf_iterations(db: &Database, meta: &str) -> Result<u32, AppError> {
    match db.get_meta(meta)? {
        None => Ok(crate::crypto::LEGACY_ITERATIONS),
        Some(value) => value.parse::<u32>().ok()
            .filter(|n| matches!(*n, crate::crypto::LEGACY_ITERATIONS | crate::crypto::PASSWORD_ITERATIONS))
            .ok_or_else(|| AppError::Crypto("不支持的口令派生版本".into())),
    }
}

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
    let key = crate::crypto::derive_password_key(password, &salt, crate::crypto::PASSWORD_ITERATIONS);
    let verify_hash = compute_verify_hash(&key);

    db.set_meta_batch(&[("initialized", "true"), ("salt", &BASE64.encode(&salt)), ("verify_hash", &verify_hash),
        (META_KDF, &crate::crypto::PASSWORD_ITERATIONS.to_string())])?;

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

    let key = crate::crypto::derive_password_key(password, &salt, kdf_iterations(db, META_KDF)?);
    if compute_verify_hash(&key) == verify_hash { Ok(key) } else { Err(AppError::WrongPassword) }
}

pub fn change_master_password(db: &Database, old_key: &[u8], old_password: &str, new_password: &str) -> Result<Vec<u8>, AppError> {
    Ok(change_master_password_prepared(db, old_key, old_password, new_password, |_| Ok(()))?.0)
}

/// Prepare dependent in-memory ciphertext before the database commit. A failed
/// preparation must leave both the database and active key unchanged.
pub fn change_master_password_prepared<T>(
    db: &Database, old_key: &[u8], old_password: &str, new_password: &str,
    prepare: impl FnOnce(&[u8]) -> Result<T, AppError>,
) -> Result<(Vec<u8>, T), AppError> {
    if verify_password(db, old_password)? != old_key { return Err(AppError::WrongPassword); }

    let new_salt = generate_salt();
    let new_key = crate::crypto::derive_password_key(new_password, &new_salt, crate::crypto::PASSWORD_ITERATIONS);
    let new_verify_hash = compute_verify_hash(&new_key);
    let prepared = prepare(&new_key)?;

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
    let mut extra_meta: Vec<(&str, String)> = vec![(META_KDF, crate::crypto::PASSWORD_ITERATIONS.to_string())];
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
        extra_meta.push(("note_key_master_wrap", rewrapped?));
    }
    let mut legacy_note_updates = Vec::new();
    for (id, row) in db.list_note_locks()? {
        if row.wrap_master.is_empty() { continue; }
        let sealed: EncryptedData = serde_json::from_str(&row.wrap_master).map_err(|e| AppError::Crypto(e.to_string()))?;
        let plain = decrypt_password(&sealed, &crate::crypto::note_wrap_key(old_key, &id))?;
        let next = encrypt_password(&plain, &crate::crypto::note_wrap_key(&new_key, &id))?;
        legacy_note_updates.push((id, serde_json::to_string(&next).map_err(|e| AppError::Crypto(e.to_string()))?));
    }
    let extra_refs: Vec<(&str, &str)> = extra_meta.iter().map(|(k, v)| (*k, v.as_str())).collect();
    db.finish_password_change(&updates, &mfa_updates, now, &new_salt_b64, &new_verify_hash, &extra_refs, &legacy_note_updates)?;

    Ok((new_key, prepared))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::random_bytes;
    use crate::db::{cleanup, setup_test_db};

    #[test]
    fn setup_failure_rolls_back_initialized_and_all_password_metadata() {
        let (db, path) = setup_test_db();
        let fixture = rusqlite::Connection::open(&path).unwrap();
        fixture.execute_batch("CREATE TRIGGER fail_salt BEFORE INSERT ON meta WHEN NEW.key='salt' BEGIN SELECT RAISE(ABORT, 'disk write failed'); END;").unwrap();
        let mut key = None;
        assert!(setup_master_password(&db, &mut key, "password").is_err());
        assert!(!db.is_initialized().unwrap());
        assert!(key.is_none());
        assert!(db.get_meta("verify_hash").unwrap().is_none());
        fixture.execute_batch("DROP TRIGGER fail_salt;").unwrap();
        setup_master_password(&db, &mut key, "password").unwrap();
        assert_eq!(kdf_iterations(&db, META_KDF).unwrap(), crate::crypto::PASSWORD_ITERATIONS);
        drop(fixture); drop(db); cleanup(&path);
    }

    #[test]
    fn legacy_master_key_is_readable_and_migrates_without_losing_sealed_data() {
        let db = Database::new(":memory:").unwrap();
        let salt = generate_salt();
        let old = crate::crypto::derive_key("legacy-password", &salt);
        db.set_meta_batch(&[("initialized", "true"), ("salt", &BASE64.encode(&salt)), ("verify_hash", &compute_verify_hash(&old))]).unwrap();
        crate::services::mfa_service::add_manual(&db, &old, "fixture", None, "JBSWY33NAXE3PY3B").unwrap();
        assert_eq!(verify_password(&db, "legacy-password").unwrap(), old);
        let new = change_master_password(&db, &old, "legacy-password", "legacy-password").unwrap();
        assert_ne!(new, old);
        assert_eq!(kdf_iterations(&db, META_KDF).unwrap(), crate::crypto::PASSWORD_ITERATIONS);
        assert_eq!(verify_password(&db, "legacy-password").unwrap(), new);
        assert_eq!(crate::services::mfa_service::list_codes(&db, &new).unwrap().len(), 1);
        assert!(crate::services::mfa_service::list_codes(&db, &old).is_err());
    }

    #[test]
    fn failed_draft_rekey_cannot_commit_a_password_change() {
        let db = Database::new(":memory:").unwrap();
        let mut master = None;
        setup_master_password(&db, &mut master, "old-password").unwrap();
        let old = master.unwrap();
        let salt = db.get_meta("salt").unwrap();
        let result = change_master_password_prepared(&db, &old, "old-password", "new-password",
            |_| Err::<(), _>(AppError::Crypto("corrupted draft".into())));
        assert!(result.is_err());
        assert_eq!(db.get_meta("salt").unwrap(), salt);
        assert_eq!(verify_password(&db, "old-password").unwrap(), old);
        assert!(verify_password(&db, "new-password").is_err());
    }

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
