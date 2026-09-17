use crate::db::{FileShortcut, CreateFileShortcutInput};
use crate::error::AppError;
use crate::services;
use crate::services::file_service;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_file_shortcuts(state: State<AppState>) -> Result<Vec<FileShortcut>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_file_shortcuts()
}

#[tauri::command]
pub fn create_file_shortcut(state: State<AppState>, input: CreateFileShortcutInput) -> Result<FileShortcut, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    file_service::create_file_shortcut(&db, input)
}

#[tauri::command]
pub fn delete_file_shortcut(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_file_shortcut(&id)
}

#[tauri::command]
pub fn update_file_shortcut(state: State<AppState>, id: String, name: Option<String>, path: Option<String>, shortcut_type: Option<String>) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.update_file_shortcut(&id, name.as_deref(), path.as_deref(), shortcut_type.as_deref())
}

#[tauri::command]
pub fn open_file(path: String) -> Result<(), AppError> {
    open::that(&path).map_err(|e| AppError::Io(format!("无法打开: {}", e)))?;
    Ok(())
}
