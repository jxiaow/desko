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

    /// 还挂在现存小记上的附件登记（孤儿行不算，那些文件该被清理）
    pub fn list_live_attachments(&self) -> Result<Vec<Attachment>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.note_id, a.file_name, a.file_path, a.file_size, a.mime_type, a.created_at
             FROM note_attachments a
             JOIN notes n ON n.id = a.note_id"
        )?;
        let rows = stmt.query_map([], Self::row_to_attachment)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// 指定小记名下的附件文件路径（删小记前要先把它们取出来，行删了就查不到了）
    pub fn attachment_paths_for_notes(&self, note_ids: &[String]) -> Result<Vec<String>, AppError> {
        let mut out = Vec::new();
        for id in note_ids {
            let mut stmt = self.conn.prepare("SELECT file_path FROM note_attachments WHERE note_id = ?1")?;
            let rows = stmt.query_map(params![id], |r| r.get::<_, String>(0))?;
            for p in rows.flatten() {
                out.push(p);
            }
        }
        Ok(out)
    }

    /// 按文件路径删登记（清理未引用附件时用，路径可能对应多行）
    pub fn delete_attachments_by_paths(&self, paths: &[String]) -> Result<usize, AppError> {
        let tx = self.conn.unchecked_transaction()?;
        let mut n = 0;
        for p in paths {
            n += tx.execute("DELETE FROM note_attachments WHERE file_path = ?1", params![p])?;
        }
        tx.commit()?;
        Ok(n)
    }
}
