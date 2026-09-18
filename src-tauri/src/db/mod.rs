mod models;
mod schema;
pub mod entry_repo;
pub mod note_repo;
pub mod url_path_repo;
pub mod file_repo;
pub mod attachment_repo;
mod export;

pub use models::*;

use rusqlite::Connection;
use crate::error::AppError;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
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
