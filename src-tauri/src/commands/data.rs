use crate::error::AppError;
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn get_db_path(state: State<AppState>) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db.get_db_path())
}

/// 附件目录的本机绝对路径。库里只存相对文件名，前端渲染图片时要靠它把
/// `attachments/<名>` 拼成 asset URL —— 这条路径绝不写进库，否则换机器就废。
#[tauri::command]
pub fn get_attachment_dir() -> String {
    crate::services::attachment_service::attachments_dir().to_string_lossy().to_string()
}
