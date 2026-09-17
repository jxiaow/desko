use crate::db::{UrlPath, CreateUrlPathInput, UpdateUrlPathInput};
use crate::error::AppError;
use crate::services;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_url_paths(state: State<AppState>, entry_id: String) -> Result<Vec<UrlPath>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_url_paths(&entry_id)
}

#[tauri::command]
pub fn create_url_path(state: State<AppState>, input: CreateUrlPathInput) -> Result<UrlPath, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let url_path = UrlPath {
        id,
        entry_id: input.entry_id,
        path: input.path,
        label: input.label,
        notes: input.notes,
        created_at: now,
    };

    db.create_url_path(&url_path)?;
    Ok(url_path)
}

#[tauri::command]
pub fn update_url_path(state: State<AppState>, id: String, input: UpdateUrlPathInput) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let mut url_path = db.get_url_path(&id)?.ok_or(AppError::Database("url path not found".to_string()))?;
    url_path.path = input.path;
    url_path.label = input.label;
    url_path.notes = input.notes;

    db.update_url_path(&url_path)?;
    Ok(())
}

#[tauri::command]
pub fn delete_url_path(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_url_path(&id)
}
