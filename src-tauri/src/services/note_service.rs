use crate::db::{Database, Note, CreateNoteInput, UpdateNoteInput};
use crate::error::AppError;

pub fn create_note(db: &Database, input: CreateNoteInput) -> Result<Note, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let note = Note {
        id,
        title: input.title,
        content_html: input.content_html,
        category: input.category,
        created_at: now,
        updated_at: now,
    };

    db.create_note(&note)?;
    Ok(note)
}

pub fn update_note(db: &Database, id: &str, input: UpdateNoteInput) -> Result<(), AppError> {
    let mut note = db.get_note(id)?.ok_or(AppError::Database("note not found".to_string()))?;
    note.title = input.title;
    note.content_html = input.content_html;
    note.category = input.category;
    note.updated_at = chrono::Utc::now().timestamp_millis();

    db.update_note(&note)?;
    Ok(())
}
