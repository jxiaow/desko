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

/// Windows Terminal 的候选落点：便携版、商店版（App Execution Alias 目录）、裸名走 PATH。
/// 便携版 `wt.exe` 常常不在 PATH 里，只 `Command::new("wt.exe")` 会漏掉它，从而一路回退到 cmd。
fn wt_candidates() -> Vec<String> {
    let mut v = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        v.push(format!(r"{local}\Programs\WindowsTerminal\wt.exe"));
        v.push(format!(r"{local}\Microsoft\WindowsApps\wt.exe"));
    }
    v.push("wt.exe".to_string());
    v
}

/// 依次尝试拉起 Windows Terminal，成功返回 true。带路径的候选先确认真的在，
/// 免得 CreateProcess 报错；裸名交给 PATH 解析。
fn try_spawn_wt(dir: &std::path::Path) -> bool {
    for cand in wt_candidates() {
        if cand != "wt.exe" && !std::path::Path::new(&cand).is_file() {
            continue;
        }
        if std::process::Command::new(&cand).arg("-d").arg(dir).spawn().is_ok() {
            return true;
        }
    }
    false
}

fn spawn_cmd(dir: &std::path::Path) -> std::io::Result<std::process::Child> {
    let mut cmd = std::process::Command::new("cmd.exe");
    cmd.current_dir(dir);
    // 强制新控制台窗口：GUI 宿主（尤其 tauri dev 从控制台起）会把自己的控制台
    // 继承给 cmd，导致"点了没反应"。CREATE_NEW_CONSOLE 保证一定弹出可见窗口。
    #[cfg(windows)]
    {
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        std::os::windows::process::CommandExt::creation_flags(&mut cmd, CREATE_NEW_CONSOLE);
    }
    cmd.spawn()
}

#[tauri::command]
pub fn open_terminal(state: State<AppState>, path: String) -> Result<(), AppError> {
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

    let pref = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.get_meta("terminal").ok().flatten().unwrap_or_default()
    };

    // cmd：只拉经典控制台。wt：只认 Windows Terminal，找不到就明确报错，不再偷偷弹 cmd。
    // auto（默认）：优先 wt，起不来回退 cmd，保证任何机器都能打开终端。
    if pref != "cmd" {
        if try_spawn_wt(&dir) {
            return Ok(());
        }
        if pref == "wt" {
            return Err(AppError::Io(
                "未找到 Windows Terminal（便携版或商店版都没探测到），可在「设置 · 通用」改用命令提示符".to_string(),
            ));
        }
    }

    spawn_cmd(&dir).map_err(|e| AppError::Io(format!("无法打开终端: {}", e)))?;
    Ok(())
}
