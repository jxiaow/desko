use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::Attachment;

impl Database {
    fn row_to_attachment(row: &rusqlite::Row) -> rusqlite::Result<Attachment> {
        Ok(Attachment {
            id: row.get(0)?,
            note_id: row.get(1)?,
            file_name: row.get(2)?,
            file_path: row.get(3)?,
            file_size: row.get(4)?,
            mime_type: row.get(5)?,
            created_at: row.get(6)?,
        })
    }

    pub fn list_attachments(&self, note_id: &str) -> Result<Vec<Attachment>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, note_id, file_name, file_path, file_size, mime_type, created_at 
             FROM note_attachments 
             WHERE note_id = ?1 
             ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map(params![note_id], Self::row_to_attachment)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_attachment(&self, attachment: &Attachment) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO note_attachments (id, note_id, file_name, file_path, file_size, mime_type, created_at) 
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                attachment.id,
                attachment.note_id,
                attachment.file_name,
                attachment.file_path,
                attachment.file_size,
                attachment.mime_type,
                attachment.created_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_attachment(&self, id: &str) -> Result<Option<String>, AppError> {
        // 先获取文件路径用于删除文件
        let file_path = self.conn.query_row(
            "SELECT file_path FROM note_attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        ).ok();

        self.conn.execute("DELETE FROM note_attachments WHERE id = ?1", params![id])?;
        Ok(file_path)
    }

    pub fn get_attachment(&self, id: &str) -> Result<Option<Attachment>, AppError> {
        let result = self.conn.query_row(
            "SELECT id, note_id, file_name, file_path, file_size, mime_type, created_at 
             FROM note_attachments WHERE id = ?1",
            params![id],
            Self::row_to_attachment,
        );
        match result {
            Ok(attachment) => Ok(Some(attachment)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }
}
