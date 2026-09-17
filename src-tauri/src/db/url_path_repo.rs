use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::UrlPath;

impl Database {
    fn row_to_url_path(row: &rusqlite::Row) -> rusqlite::Result<UrlPath> {
        Ok(UrlPath {
            id: row.get(0)?,
            entry_id: row.get(1)?,
            path: row.get(2)?,
            label: row.get(3)?,
            notes: row.get(4)?,
            created_at: row.get(5)?,
        })
    }

    pub fn list_url_paths(&self, entry_id: &str) -> Result<Vec<UrlPath>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, entry_id, path, label, notes, created_at FROM url_paths WHERE entry_id = ?1 ORDER BY created_at ASC"
        )?;
        let rows = stmt.query_map(params![entry_id], Self::row_to_url_path)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_url_path(&self, url_path: &UrlPath) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO url_paths (id, entry_id, path, label, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![url_path.id, url_path.entry_id, url_path.path, url_path.label, url_path.notes, url_path.created_at],
        )?;
        Ok(())
    }

    pub fn update_url_path(&self, url_path: &UrlPath) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE url_paths SET path=?2, label=?3, notes=?4 WHERE id=?1",
            params![url_path.id, url_path.path, url_path.label, url_path.notes],
        )?;
        Ok(())
    }

    pub fn delete_url_path(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM url_paths WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_url_path(&self, id: &str) -> Result<Option<UrlPath>, AppError> {
        let result = self.conn.query_row(
            "SELECT id, entry_id, path, label, notes, created_at FROM url_paths WHERE id = ?1",
            params![id],
            Self::row_to_url_path,
        );
        match result {
            Ok(url_path) => Ok(Some(url_path)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn delete_url_paths_by_entry(&self, entry_id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM url_paths WHERE entry_id = ?1", params![entry_id])?;
        Ok(())
    }
}
