use crate::error::AppError;
use crate::services;
use crate::services::data_service;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn export_sql(state: State<AppState>) -> Result<String, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.export_sql()
}

#[tauri::command]
pub fn import_sql(state: State<AppState>, sql: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let trimmed = sql.trim();
    if !trimmed.is_empty() {
        data_service::validate_import_sql(trimmed)?;
    }

    db.import_sql(&sql)
}

#[tauri::command]
pub fn get_db_path(state: State<AppState>) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db.get_db_path())
}
