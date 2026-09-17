use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::Note;

impl Database {
    fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content_html: row.get(2)?,
            category: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    }

    pub fn list_all_notes(&self) -> Result<Vec<Note>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, content_html, category, created_at, updated_at FROM notes ORDER BY updated_at DESC"
        )?;
        let rows = stmt.query_map([], Self::row_to_note)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_note(&self, note: &Note) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO notes (id, title, content_html, category, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![note.id, note.title, note.content_html, note.category, note.created_at, note.updated_at],
        )?;
        Ok(())
    }

    pub fn update_note(&self, note: &Note) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET title=?2, content_html=?3, category=?4, updated_at=?5 WHERE id=?1",
            params![note.id, note.title, note.content_html, note.category, note.updated_at],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_note(&self, id: &str) -> Result<Option<Note>, AppError> {
        let result = self.conn.query_row(
            "SELECT id, title, content_html, category, created_at, updated_at FROM notes WHERE id = ?1",
            params![id],
            Self::row_to_note,
        );
        match result {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn batch_delete_notes(&self, ids: &[String]) -> Result<usize, AppError> {
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        for id in ids {
            count += tx.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(count)
    }
}
