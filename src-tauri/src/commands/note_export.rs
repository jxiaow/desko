use std::{collections::HashMap, path::PathBuf, sync::atomic::Ordering};
use base64::{engine::general_purpose::STANDARD, Engine};
use crate::{AppState, command_state::CommandState as State, services::{attachment_service, note_export::{self, ExportFile, ExportFormat}, note_pdf}};

fn desktop(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("请在桌面版导出小记".into()) }
}

fn check_notes(state: &AppState, ids: &[String]) -> Result<Vec<String>, String> {
    if ids.is_empty() || ids.len() > 10_000 { return Err("导出条数无效".into()); }
    let db = state.db.lock().map_err(|_| "无法读取小记")?;
    let mut encrypted = Vec::new();
    for id in ids {
        let note = db.get_note(id).map_err(|e| e.user_message())?.ok_or("小记已不存在，请刷新后重试")?;
        if note.encrypted {
            let lock = db.get_note_lock(id).map_err(|e| e.user_message())?.ok_or("加密小记状态已变更")?;
            crate::commands::note_lock::validated_dek(state, id, &lock).map_err(|_| "加密小记已锁回，请解锁后重试")?;
            encrypted.push(id.clone());
        }
    }
    Ok(encrypted)
}

#[tauri::command]
pub fn note_export_images(window: tauri::WebviewWindow, state: State<AppState>, names: Vec<String>) -> Result<HashMap<String, String>, String> {
    desktop(&window)?;
    let master = state.master_key.lock().map_err(|_| "无法读取应用状态")?;
    master.as_ref().ok_or("应用已锁定")?;
    if names.len() > 10_000 { return Err("图片数量过多，请分批导出".into()); }
    let root = attachment_service::attachments_dir();
    let Ok(root) = root.canonicalize() else { return Ok(HashMap::new()); };
    let mut images = HashMap::new();
    let mut total = 0;
    for name in names {
        if attachment_service::name_of(&name).as_deref() != Some(name.as_str()) { continue; }
        let Ok(path) = root.join(&name).canonicalize() else { continue; };
        if !path.starts_with(&root) || !path.is_file() { continue; }
        let mime = match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
            "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", _ => continue,
        };
        let length = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        total += length;
        if total > 48 * 1024 * 1024 { return Err("图片总量超过 48 MB，请分批导出".into()); }
        if let Ok(bytes) = std::fs::read(path) { images.insert(name, format!("data:{mime};base64,{}", STANDARD.encode(bytes))); }
    }
    Ok(images)
}

#[tauri::command]
pub async fn note_export_write(window: tauri::WebviewWindow, app: tauri::AppHandle, state: State<'_, AppState>, path: String, format: ExportFormat, files: Vec<ExportFile>, note_ids: Vec<String>) -> Result<(), String> {
    desktop(&window)?;
    note_export::validate_files(format, &files)?;
    if format != ExportFormat::Pdf && files.len() != note_ids.len() { return Err("导出文件与小记条数不一致".into()); }
    if note_ids.iter().collect::<std::collections::HashSet<_>>().len() != note_ids.len() { return Err("导出小记重复".into()); }
    let epoch = (state.lock_epoch.load(Ordering::SeqCst), state.data_epoch.load(Ordering::SeqCst));
    let encrypted = {
        let master = state.master_key.lock().map_err(|_| "无法读取应用状态")?;
        master.as_ref().ok_or("应用已锁定")?;
        check_notes(&state, &note_ids)?
    };
    let destination = PathBuf::from(path);
    if !destination.is_absolute() || destination.file_name().is_none() { return Err("请选择有效的保存路径".into()); }
    let (pending, file) = note_export::PendingExport::create(&destination)?;
    if format == ExportFormat::Pdf {
        drop(file);
        let print = note_pdf::print_html(&app, &files[0].content, &pending.0);
        tokio::pin!(print);
        loop {
            tokio::select! {
                result = &mut print => { result?; break; }
                _ = tokio::time::sleep(std::time::Duration::from_millis(200)) => {
                    if epoch != (state.lock_epoch.load(Ordering::SeqCst), state.data_epoch.load(Ordering::SeqCst)) {
                        return Err("应用状态已变化，导出已取消".into());
                    }
                    let keys = state.note_keys.lock().map_err(|_| "无法读取加密状态")?;
                    if encrypted.iter().any(|id| !keys.contains_key(id)) { return Err("加密小记已锁回，导出已取消".into()); }
                }
            }
        }
    } else {
        tauri::async_runtime::spawn_blocking(move || note_export::write_documents(file, &files)).await.map_err(|e| format!("导出任务中断：{e}"))??;
    }
    // 锁定、换库或加密条目被收回时，不把旧会话的明文提交到目标路径。
    let master = state.master_key.lock().map_err(|_| "无法读取应用状态")?;
    master.as_ref().ok_or("应用已锁定，导出已取消")?;
    if epoch != (state.lock_epoch.load(Ordering::SeqCst), state.data_epoch.load(Ordering::SeqCst)) { return Err("应用状态已变化，导出已取消".into()); }
    check_notes(&state, &note_ids)?;
    pending.commit(&destination)
}
