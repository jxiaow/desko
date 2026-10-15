use crate::db::{EntryResponse, EntryWithPaths};
use crate::error::AppError;
use crate::services;
use crate::services::entry_service;
use crate::db::{CreateEntryInput, UpdateEntryInput};
use crate::AppState;
use crate::command_state::CommandState as State;

#[tauri::command]
pub fn list_entries(state: State<AppState>) -> Result<Vec<EntryResponse>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let entries = db.list_all_entries()?;
    Ok(entries.iter().map(EntryResponse::from_entry).collect())
}

#[tauri::command]
pub fn list_entries_with_paths(state: State<AppState>) -> Result<Vec<EntryWithPaths>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_all_entries_with_paths()
}

#[tauri::command]
pub fn create_entry(state: State<AppState>, input: CreateEntryInput) -> Result<EntryResponse, AppError> {
    let key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    entry_service::create_entry(&db, &key, input)
}

#[tauri::command]
pub fn update_entry(state: State<AppState>, id: String, input: UpdateEntryInput) -> Result<EntryResponse, AppError> {
    let key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    entry_service::update_entry(&db, &key, &id, input)
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_url_paths_by_entry(&id)?;
    db.delete_entry(&id)
}

#[tauri::command]
pub fn batch_delete_entries(state: State<AppState>, ids: Vec<String>) -> Result<usize, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    for id in &ids {
        db.delete_url_paths_by_entry(id)?;
    }
    db.batch_delete(&ids)
}

#[tauri::command]
pub fn get_password(state: State<AppState>, id: String) -> Result<String, AppError> {
    let key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    entry_service::get_password(&db, &key, &id)
}

#[tauri::command]
pub fn create_test_data(state: State<AppState>) -> Result<(), AppError> {
    let key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    entry_service::create_test_data(&db, &key)
}
