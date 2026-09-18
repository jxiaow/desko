use crate::db::{Database, Attachment};
use crate::error::AppError;
use std::fs;
use std::path::Path;

pub fn create_attachment(
    db: &Database,
    note_id: &str,
    source_path: &str,
    app_data_dir: &str,
) -> Result<Attachment, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    
    // 获取源文件名
    let source_path_obj = Path::new(source_path);
    let file_name = source_path_obj
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Io("Invalid file name".to_string()))?
        .to_string();
    
    // 获取文件扩展名
    let extension = source_path_obj
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    
    // 创建附件存储目录
    let attachments_dir = Path::new(app_data_dir).join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|e| AppError::Io(format!("Failed to create attachments dir: {}", e)))?;
    
    // 生成目标文件名（使用 UUID 避免冲突）
    let target_file_name = format!("{}.{}", id, extension);
    let target_path = attachments_dir.join(&target_file_name);
    
    // 复制文件
    fs::copy(source_path, &target_path)
        .map_err(|e| AppError::Io(format!("Failed to copy file: {}", e)))?;
    
    // 获取文件大小
    let file_size = fs::metadata(&target_path)
        .map_err(|e| AppError::Io(format!("Failed to get file metadata: {}", e)))?
        .len() as i64;
    
    // 确定 MIME 类型
    let mime_type = match extension.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    };
    
    let attachment = Attachment {
        id: id.clone(),
        note_id: note_id.to_string(),
        file_name,
        file_path: target_path.to_string_lossy().to_string(),
        file_size,
        mime_type: mime_type.to_string(),
        created_at: now,
    };
    
    db.create_attachment(&attachment)?;
    Ok(attachment)
}

pub fn delete_attachment(db: &Database, id: &str) -> Result<(), AppError> {
    if let Some(file_path) = db.delete_attachment(id)? {
        // 删除物理文件
        if let Err(e) = fs::remove_file(&file_path) {
            eprintln!("Warning: Failed to delete attachment file {}: {}", file_path, e);
        }
    }
    Ok(())
}
