pub mod auth_service;
pub mod entry_service;
pub mod favicon_service;
pub mod note_service;
pub mod note_export;
pub mod note_pdf;
pub mod note_draft_service;
pub mod file_service;
pub mod attachment_service;
pub mod backup_service;
pub mod auto_backup;
pub mod cloud_service;
pub mod cloud_restore_cache;
pub mod mfa_service;
pub mod profile_service;
pub mod bypass_service;
pub mod bypass_probe_job;
pub mod netguard_service;
pub mod tunnel_service;
pub mod tunnel_domain_service;
pub mod codex_bridge;

use crate::error::AppError;
use crate::AppState;

pub fn get_master_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    let master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    master_key.clone().ok_or(AppError::NotUnlocked)
}
