pub mod auth_service;
pub mod entry_service;
pub mod note_service;
pub mod file_service;
pub mod data_service;

use crate::error::AppError;
use crate::AppState;

pub fn get_master_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    let master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    master_key.clone().ok_or(AppError::NotUnlocked)
}
