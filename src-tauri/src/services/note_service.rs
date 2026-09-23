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
        pinned: false,
        starred: false,
        encrypted: false,
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

pub fn toggle_pin_note(db: &Database, id: &str) -> Result<bool, AppError> {
    db.toggle_pin_note(id)
}

pub fn toggle_star_note(db: &Database, id: &str) -> Result<bool, AppError> {
    db.toggle_star_note(id)
}
