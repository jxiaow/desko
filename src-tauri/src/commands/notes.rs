use crate::db::{Note, CreateNoteInput, UpdateNoteInput};
use crate::error::AppError;
use crate::services;
use crate::services::note_service;
use crate::services::attachment_service;
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

#[tauri::command]
pub fn toggle_pin_note(state: State<AppState>, id: String) -> Result<bool, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::toggle_pin_note(&db, &id)
}

#[tauri::command]
pub fn toggle_star_note(state: State<AppState>, id: String) -> Result<bool, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::toggle_star_note(&db, &id)
}

#[tauri::command]
pub fn list_attachments(state: State<AppState>, note_id: String) -> Result<Vec<crate::db::Attachment>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_attachments(&note_id)
}

#[tauri::command]
pub fn upload_attachment(
    state: State<AppState>,
    note_id: String,
    file_path: String,
) -> Result<crate::db::Attachment, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    
    // 获取应用数据目录
    let app_data_dir = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let app_data_dir = format!("{}/desko", app_data_dir);
    
    attachment_service::create_attachment(&db, &note_id, &file_path, &app_data_dir)
}

#[tauri::command]
pub fn delete_attachment(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attachment_service::delete_attachment(&db, &id)
}
