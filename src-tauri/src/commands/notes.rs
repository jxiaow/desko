use crate::db::{Note, CreateNoteInput, UpdateNoteInput};
use crate::error::AppError;
use crate::services;
use crate::services::note_service;
use crate::services::attachment_service;
use crate::AppState;
use crate::command_state::CommandState as State;

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
    let master = state.master_key.lock().map_err(|_| AppError::NotUnlocked)?;
    let key = master.as_ref().ok_or(AppError::NotUnlocked)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    if let Some(lock) = db.get_note_lock(&id)? {
        // 加密行：明文只进密文，正文与分类一个字节都不落；标题按新正文重新算
        let dek = crate::commands::note_lock::validated_dek(&state, &id, &lock)?;
        let enc = crate::crypto::encrypt_password(&input.content_html, &dek)?;
        let title = note_service::heading_title(&input.content_html);
        let now = chrono::Utc::now().timestamp_millis();
        db.update_note_cipher(&id, &enc.ciphertext, &enc.iv, &title, now)?;
    } else {
        note_service::update_note(&db, &id, input.clone())?;
    }
    state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.saved(&id, &input, key)?;
    Ok(())
}

#[tauri::command]
pub fn stage_note_drafts(state: State<AppState>, drafts: Vec<services::note_draft_service::NoteDraft>) -> Result<(), AppError> {
    services::note_draft_service::stage(&state, drafts)
}

#[tauri::command]
pub fn recover_note_drafts(state: State<AppState>) -> Result<Vec<services::note_draft_service::NoteDraft>, AppError> {
    services::note_draft_service::recover(&state)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let paths = db.attachment_paths_for_notes(std::slice::from_ref(&id))?;
    db.delete_note(&id)?;
    attachment_service::delete_unreferenced_files(&db, &paths)?;
    state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.remove(&id);
    crate::commands::note_lock::drop_dek(&state, &id);
    Ok(())
}

#[tauri::command]
pub fn batch_delete_notes(state: State<AppState>, ids: Vec<String>) -> Result<usize, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let paths = db.attachment_paths_for_notes(&ids)?;
    let n = db.batch_delete_notes(&ids)?;
    attachment_service::delete_unreferenced_files(&db, &paths)?;
    for id in &ids {
        crate::commands::note_lock::drop_dek(&state, id);
        state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.remove(id);
    }
    Ok(n)
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
pub fn set_note_archived(state: State<AppState>, id: String, archived: bool) -> Result<bool, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::set_note_archived(&db, &id, archived)
}

#[tauri::command]
pub fn batch_set_archived(state: State<AppState>, ids: Vec<String>, archived: bool) -> Result<usize, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    note_service::batch_set_archived(&db, &ids, archived)
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
    attachment_service::create_attachment(&db, &note_id, &file_path)
}

/// 草稿还没 note id，先把文件收进附件目录，正文里放它的 asset: 地址
#[tauri::command]
pub fn stage_attachment(
    state: State<AppState>,
    file_path: String,
) -> Result<crate::db::Attachment, AppError> {
    let _key = services::get_master_key(&state)?;
    attachment_service::store_file(&file_path)
}

/// 发布后按正文里的图片路径补附件记录，删小记时才能连带清掉文件
#[tauri::command]
pub fn bind_attachments(
    state: State<AppState>,
    note_id: String,
    paths: Vec<String>,
) -> Result<Vec<crate::db::Attachment>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attachment_service::bind_paths(&db, &note_id, &paths)
}

#[tauri::command]
pub fn delete_attachment(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attachment_service::delete_attachment(&db, &id)
}

/// 未引用附件清单（设置页"清理"用）
#[tauri::command]
pub fn attachment_orphans(state: State<AppState>) -> Result<Vec<attachment_service::OrphanFile>, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attachment_service::scan_orphans(&db)
}

#[tauri::command]
pub fn attachment_cleanup(
    state: State<AppState>,
    names: Vec<String>,
) -> Result<usize, AppError> {
    let _key = services::get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    attachment_service::cleanup_orphans(&db, &names)
}
