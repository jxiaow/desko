use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::error::AppError;

pub const LEGACY_ITERATIONS: u32 = 10_000;
pub const PASSWORD_ITERATIONS: u32 = 600_000;
// 备份口令长期躺在云上，离线爆破窗口以年计，迭代次数单独拉高
pub const BACKUP_ITERATIONS: u32 = 600_000;
const SALT_LENGTH: usize = 16;
const IV_LENGTH: usize = 12;
pub const KEY_LENGTH: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedData {
    pub ciphertext: String,
    pub iv: String,
}

pub fn generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; SALT_LENGTH];
    rand::thread_rng().fill(&mut salt[..]);
    salt
}

pub fn generate_iv() -> Vec<u8> {
    let mut iv = vec![0u8; IV_LENGTH];
    rand::thread_rng().fill(&mut iv[..]);
    iv
}

pub fn derive_key(password: &str, salt: &[u8]) -> Vec<u8> {
    derive_password_key(password, salt, LEGACY_ITERATIONS)
}

pub fn derive_password_key(password: &str, salt: &[u8], iterations: u32) -> Vec<u8> {
    let mut key = vec![0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

pub fn derive_backup_key(password: &str, salt: &[u8]) -> Vec<u8> {
    let mut key = vec![0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, BACKUP_ITERATIONS, &mut key);
    key
}

pub fn compute_verify_hash(key: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key);
    let hash = hasher.finalize();
    BASE64.encode(hash)
}

pub fn verify_master_password(password: &str, salt: &[u8], stored_hash: &str) -> Result<Vec<u8>, AppError> {
    let key = derive_key(password, salt);
    let hash = compute_verify_hash(&key);
    
    if hash == stored_hash {
        Ok(key)
    } else {
        Err(AppError::WrongPassword)
    }
}

pub fn encrypt_password(plaintext: &str, key: &[u8]) -> Result<EncryptedData, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    
    let iv_bytes = generate_iv();
    let nonce = Nonce::from_slice(&iv_bytes);
    
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    
    Ok(EncryptedData {
        ciphertext: BASE64.encode(ciphertext),
        iv: BASE64.encode(iv_bytes),
    })
}

pub fn decrypt_password(encrypted: &EncryptedData, key: &[u8]) -> Result<String, AppError> {
    if key.len() != 32 {
        return Err(AppError::Crypto(format!("Invalid key length: {}", key.len())));
    }
    
    let cipher = match Aes256Gcm::new_from_slice(key) {
        Ok(c) => c,
        Err(e) => return Err(AppError::Crypto(format!("Cipher init failed: {}", e))),
    };
    
    let ciphertext = match BASE64.decode(&encrypted.ciphertext) {
        Ok(c) => c,
        Err(e) => return Err(AppError::Crypto(format!("Base64 decode ciphertext failed: {}", e))),
    };
    let iv = match BASE64.decode(&encrypted.iv) {
        Ok(v) => v,
        Err(e) => return Err(AppError::Crypto(format!("Base64 decode iv failed: {}", e))),
    };
    
    if iv.len() != 12 {
        return Err(AppError::Crypto(format!("Invalid IV length: {}", iv.len())));
    }
    
    let nonce = Nonce::from_slice(&iv);
    
    match cipher.decrypt(nonce, ciphertext.as_ref()) {
        Ok(plaintext) => String::from_utf8(plaintext)
            .map_err(|e| AppError::Crypto(format!("UTF8 decode failed: {}", e))),
        Err(e) => Err(AppError::Crypto(format!("Decryption failed (wrong key or corrupted data): {}", e))),
    }
}

/// 带附加认证数据（AAD）的加解密：头部字段被绑进标签，改一个字都解不开
pub fn encrypt_blob_ad(plaintext: &[u8], key: &[u8], nonce: &[u8], aad: &[u8]) -> Result<Vec<u8>, AppError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    cipher
        .encrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload { msg: plaintext, aad },
        )
        .map_err(|e| AppError::Crypto(e.to_string()))
}

pub fn decrypt_blob_ad(nonce: &[u8], ciphertext: &[u8], key: &[u8], aad: &[u8]) -> Result<Vec<u8>, AppError> {
    if key.len() != KEY_LENGTH {
        return Err(AppError::Crypto(format!("Invalid key length: {}", key.len())));
    }
    if nonce.len() != IV_LENGTH {
        return Err(AppError::Crypto(format!("Invalid nonce length: {}", nonce.len())));
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            aes_gcm::aead::Payload { msg: ciphertext, aad },
        )
        .map_err(|e| AppError::Crypto(format!("Decryption failed (wrong key or corrupted data): {}", e)))
}

/// 生成定长随机密钥（备份数据密钥 DEK 用）
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut v = vec![0u8; len];
    rand::thread_rng().fill(&mut v[..]);
    v
}

/// 小记主密钥封条的域分隔派生：绑死 note id，换条小记、换把主密钥都得重封
pub fn note_wrap_key(master_key: &[u8], note_id: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    hasher.update(b"desko-note-lock");
    hasher.update(note_id.as_bytes());
    hasher.finalize().to_vec()
}

/// 小记域密钥（全库一把口令）的主密钥封条派生：不绑 note id，与旧的逐条封条域分隔
pub fn note_domain_key(master_key: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    hasher.update(b"desko-note-domain");
    hasher.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_generate_salt_length() {
        let salt = generate_salt();
        assert_eq!(salt.len(), SALT_LENGTH);
    }
    
    #[test]
    fn test_generate_iv_length() {
        let iv = generate_iv();
        assert_eq!(iv.len(), IV_LENGTH);
    }
    
    #[test]
    fn test_generate_salt_random() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();
        assert_ne!(salt1, salt2);
    }
    
    #[test]
    fn test_derive_key_length() {
        let salt = generate_salt();
        let key = derive_key("password", &salt);
        assert_eq!(key.len(), KEY_LENGTH);
    }
    
    #[test]
    fn test_note_wrap_domains_are_isolated() {
        let mk = random_bytes(KEY_LENGTH);
        let domain = note_domain_key(&mk);
        let per_note = note_wrap_key(&mk, "n1");
        assert_ne!(domain, per_note, "新旧封条同域就会一把钥匙开两代数据");
        assert_ne!(domain, mk, "派生不能是恒等");
        assert_ne!(per_note, note_wrap_key(&mk, "n2"));

        // 域密钥封的 DEK，逐条密钥开不了；反过来也一样
        let dek = random_bytes(KEY_LENGTH);
        let sealed = encrypt_password(&BASE64.encode(&dek), &domain).unwrap();
        assert!(decrypt_password(&sealed, &per_note).is_err());
        let legacy = encrypt_password(&BASE64.encode(&dek), &per_note).unwrap();
        assert!(decrypt_password(&legacy, &domain).is_err());
    }

    #[test]
    fn test_derive_key_deterministic() {
        let salt = b"fixed_salt_for_test";
        let key1 = derive_key("password", salt);
        let key2 = derive_key("password", salt);
        assert_eq!(key1, key2);
    }
    
    #[test]
    fn test_derive_key_different_passwords() {
        let salt = generate_salt();
        let key1 = derive_key("password1", &salt);
        let key2 = derive_key("password2", &salt);
        assert_ne!(key1, key2);
    }
    
    #[test]
    fn test_derive_key_different_salts() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();
        let key1 = derive_key("password", &salt1);
        let key2 = derive_key("password", &salt2);
        assert_ne!(key1, key2);
    }
    
    #[test]
    fn test_compute_verify_hash() {
        let key = derive_key("password", &generate_salt());
        let hash = compute_verify_hash(&key);
        
        // Should be base64 encoded SHA-256 (32 bytes -> 44 chars with padding)
        assert_eq!(hash.len(), 44);
        
        // Same key should produce same hash
        let hash2 = compute_verify_hash(&key);
        assert_eq!(hash, hash2);
    }
    
    #[test]
    fn test_verify_master_password_correct() {
        let password = "my_secret_password";
        let salt = generate_salt();
        let key = derive_key(password, &salt);
        let hash = compute_verify_hash(&key);
        
        let result = verify_master_password(password, &salt, &hash);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), key);
    }
    
    #[test]
    fn test_verify_master_password_wrong() {
        let password = "my_secret_password";
        let salt = generate_salt();
        let key = derive_key(password, &salt);
        let hash = compute_verify_hash(&key);
        
        let result = verify_master_password("wrong_password", &salt, &hash);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_encrypt_decrypt_password() {
        let key = derive_key("password", &generate_salt());
        let plaintext = "my_secret_password_123!@#";
        
        let encrypted = encrypt_password(plaintext, &key).unwrap();
        
        // Encrypted data should have ciphertext and iv
        assert!(!encrypted.ciphertext.is_empty());
        assert!(!encrypted.iv.is_empty());
        
        // Decrypt should return original
        let decrypted = decrypt_password(&encrypted, &key).unwrap();
        assert_eq!(decrypted, plaintext);
    }
    
    #[test]
    fn test_encrypt_different_ivs() {
        let key = derive_key("password", &generate_salt());
        let plaintext = "same_password";
        
        let enc1 = encrypt_password(plaintext, &key).unwrap();
        let enc2 = encrypt_password(plaintext, &key).unwrap();
        
        // Same plaintext should produce different ciphertexts (different IVs)
        assert_ne!(enc1.ciphertext, enc2.ciphertext);
        assert_ne!(enc1.iv, enc2.iv);
        
        // But both should decrypt to same value
        assert_eq!(decrypt_password(&enc1, &key).unwrap(), plaintext);
        assert_eq!(decrypt_password(&enc2, &key).unwrap(), plaintext);
    }
    
    #[test]
    fn test_decrypt_wrong_key() {
        let key1 = derive_key("password1", &generate_salt());
        let key2 = derive_key("password2", &generate_salt());
        
        let encrypted = encrypt_password("secret", &key1).unwrap();
        
        // Decrypting with wrong key should fail
        let result = decrypt_password(&encrypted, &key2);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_decrypt_tampered_ciphertext() {
        let key = derive_key("password", &generate_salt());
        
        let mut encrypted = encrypt_password("secret", &key).unwrap();
        
        // Tamper with ciphertext
        let mut ciphertext_bytes = BASE64.decode(&encrypted.ciphertext).unwrap();
        if !ciphertext_bytes.is_empty() {
            ciphertext_bytes[0] ^= 0xFF;
        }
        encrypted.ciphertext = BASE64.encode(&ciphertext_bytes);
        
        // GCM should detect tampering and fail
        let result = decrypt_password(&encrypted, &key);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_encrypt_empty_string() {
        let key = derive_key("password", &generate_salt());
        
        let encrypted = encrypt_password("", &key).unwrap();
        let decrypted = decrypt_password(&encrypted, &key).unwrap();
        
        assert_eq!(decrypted, "");
    }
    
    #[test]
    fn test_encrypt_unicode() {
        let key = derive_key("password", &generate_salt());
        let plaintext = "密码测试 🎉 日本語テスト";
        
        let encrypted = encrypt_password(plaintext, &key).unwrap();
        let decrypted = decrypt_password(&encrypted, &key).unwrap();
        
        assert_eq!(decrypted, plaintext);
    }
}
