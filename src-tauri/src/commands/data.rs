use crate::error::AppError;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_db_path(state: State<AppState>) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db.get_db_path())
}
