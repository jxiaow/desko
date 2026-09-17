use crate::db::{Note, CreateNoteInput, UpdateNoteInput};
use crate::error::AppError;
use crate::services;
use crate::services::note_service;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Result<Vec<Note>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_all_notes()
}

#[tauri::command]
pub fn create_note(state: State<AppState>, input: CreateNoteInput) -> Result<Note, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::create_note(&db, input)
}

#[tauri::command]
pub fn update_note(state: State<AppState>, id: String, input: UpdateNoteInput) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::update_note(&db, &id, input)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_note(&id)
}

#[tauri::command]
pub fn batch_delete_notes(state: State<AppState>, ids: Vec<String>) -> Result<usize, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.batch_delete_notes(&ids)
}
