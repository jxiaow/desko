use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::FileShortcut;

impl Database {
    fn row_to_file_shortcut(row: &rusqlite::Row) -> rusqlite::Result<FileShortcut> {
        Ok(FileShortcut {
            id: row.get(0)?,
            name: row.get(1)?,
            path: row.get(2)?,
            shortcut_type: row.get(3)?,
            created_at: row.get(4)?,
        })
    }

    pub fn list_file_shortcuts(&self) -> Result<Vec<FileShortcut>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, path, shortcut_type, created_at FROM file_shortcuts ORDER BY created_at DESC"
        )?;
        let shortcuts = stmt.query_map([], Self::row_to_file_shortcut)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(shortcuts)
    }

    pub fn create_file_shortcut(&self, shortcut: &FileShortcut) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO file_shortcuts (id, name, path, shortcut_type, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![shortcut.id, shortcut.name, shortcut.path, shortcut.shortcut_type, shortcut.created_at],
        )?;
        Ok(())
    }

    pub fn delete_file_shortcut(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM file_shortcuts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_file_shortcut(&self, id: &str, name: Option<&str>, path: Option<&str>, shortcut_type: Option<&str>) -> Result<(), AppError> {
        let mut updates = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(n) = name {
            updates.push("name = ?");
            params_vec.push(Box::new(n.to_string()));
        }
        if let Some(p) = path {
            updates.push("path = ?");
            params_vec.push(Box::new(p.to_string()));
        }
        if let Some(t) = shortcut_type {
            updates.push("shortcut_type = ?");
            params_vec.push(Box::new(t.to_string()));
        }

        if updates.is_empty() {
            return Ok(());
        }

        let sql = format!("UPDATE file_shortcuts SET {} WHERE id = ?", updates.join(", "));
        params_vec.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        self.conn.execute(&sql, params_ref.as_slice())?;
        Ok(())
    }
}
