mod models;
mod schema;
pub mod entry_repo;
pub mod note_repo;
pub mod url_path_repo;
pub mod file_repo;
pub mod attachment_repo;

pub use models::*;

use rusqlite::Connection;
use crate::error::AppError;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        // 这套 bundled SQLite 实测默认就开着外键（见 attachment_service 的回归测试），
        // 但 ON DELETE CASCADE 是删数据路径的正确性依赖，不靠默认值兜
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        schema::run_schema(&conn)?;
        Ok(Database { conn })
    }

    pub fn is_initialized(&self) -> Result<bool, AppError> {
        let result: bool = self.conn.query_row(
            "SELECT value FROM meta WHERE key = 'initialized'",
            [],
            |row| {
                let val: String = row.get(0)?;
                Ok(val == "true")
            }
        ).unwrap_or(false);

        Ok(result)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, AppError> {
        let result = self.conn.query_row(
            "SELECT value FROM meta WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        );

        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn get_db_path(&self) -> String {
        self.conn.path().unwrap_or("").to_string()
    }

    /// 恢复用的整机换库：先释放文件句柄（Windows 下不关连接 rename 会失败），
    /// 换完文件再重开。swap_live_files 自带失败回滚，这里只负责兜底重开旧路径。
    pub fn swap_into_restored(
        &mut self,
        app_data_dir: &std::path::Path,
        attachments_dir: &std::path::Path,
        staging: &std::path::Path,
    ) -> Result<(), AppError> {
        let old = std::mem::replace(&mut self.conn, Connection::open_in_memory()?);
        drop(old);
        let swapped = crate::backup::swap_live_files(app_data_dir, attachments_dir, staging);
        let db_file = app_data_dir.join("data.db");
        self.conn = Connection::open(&db_file)?;
        schema::run_schema(&self.conn)?;
        swapped
    }
}

#[cfg(test)]
pub(crate) fn setup_test_db() -> (Database, String) {
    let temp_dir = std::env::temp_dir();
    let path = temp_dir.join(format!("desko_test_{}.db", uuid::Uuid::new_v4()));
    let path_str = path.to_str().unwrap().to_string();
    let db = Database::new(&path_str).unwrap();
    (db, path_str)
}

#[cfg(test)]
pub(crate) fn cleanup(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_meta_operations() {
        let (db, path) = setup_test_db();

        assert!(!db.is_initialized().unwrap());

        db.set_meta("initialized", "true").unwrap();
        db.set_meta("salt", "test_salt").unwrap();

        assert_eq!(db.get_meta("salt").unwrap(), Some("test_salt".to_string()));
        assert_eq!(db.get_meta("nonexistent").unwrap(), None);

        assert!(db.is_initialized().unwrap());

        cleanup(&path);
    }
}
