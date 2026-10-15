//! HTTP LAN pages lack WebCrypto. Keep browser drafts encrypted with a separate
//! service-lifetime random key. Stop/restart discards unpublished browser drafts.
//! This endpoint can never decrypt account or backup ciphertext.
use crate::{
    crypto::{self, EncryptedData},
    error::AppError,
};

const MAX_DRAFT: usize = 16 * 1024 * 1024;
pub(super) fn seal(key: &[u8], plaintext: String) -> Result<EncryptedData, AppError> {
    if plaintext.len() > MAX_DRAFT {
        return Err(AppError::Crypto("草稿过大，请先保存".into()));
    }
    crypto::encrypt_password(&plaintext, key)
}
pub(super) fn open(key: &[u8], sealed: EncryptedData) -> Result<String, AppError> {
    if sealed.ciphertext.len() > (MAX_DRAFT + 16) * 4 / 3 + 8 {
        return Err(AppError::Crypto("草稿过大".into()));
    }
    crypto::decrypt_password(&sealed, key)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_drafts_roundtrip_but_cannot_open_vault_ciphertext_or_another_services_drafts() {
        let key = crypto::random_bytes(32);
        let sealed = seal(&key, "private browser draft".into()).unwrap();
        assert!(!sealed.ciphertext.contains("private"));
        assert_eq!(open(&key, sealed.clone()).unwrap(), "private browser draft");
        let master = crypto::random_bytes(32);
        let account = crypto::encrypt_password("account secret", &master).unwrap();
        assert!(open(&key, account).is_err());
        assert!(crypto::decrypt_password(&sealed, &master).is_err());
        assert!(open(&crypto::random_bytes(32), sealed).is_err());
    }
}
