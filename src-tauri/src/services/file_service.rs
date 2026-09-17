use crate::db::{Database, FileShortcut, CreateFileShortcutInput};
use crate::error::AppError;

pub fn create_file_shortcut(db: &Database, input: CreateFileShortcutInput) -> Result<FileShortcut, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let shortcut = FileShortcut {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        path: input.path,
        shortcut_type: input.shortcut_type,
        created_at: now,
    };

    db.create_file_shortcut(&shortcut)?;
    Ok(shortcut)
}
