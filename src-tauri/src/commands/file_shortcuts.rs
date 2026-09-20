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

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), AppError> {
    let target = std::path::PathBuf::from(&path);
    // 目录快捷方式进自己，文件快捷方式进它所在的目录
    let dir = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .ok_or_else(|| AppError::Io("路径里没有可进入的目录".to_string()))?
            .to_path_buf()
    };

    // Windows Terminal 优先（Win11 自带），没装则退回经典控制台
    std::process::Command::new("wt.exe")
        .arg("-d")
        .arg(&dir)
        .spawn()
        .or_else(|_| std::process::Command::new("cmd.exe").current_dir(&dir).spawn())
        .map_err(|e| AppError::Io(format!("无法打开终端: {}", e)))?;
    Ok(())
}
