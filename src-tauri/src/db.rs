use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub encrypted_password: String, // JSON: {"ciphertext":"...","iv":"..."}
    pub notes: Option<String>,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Response struct that does NOT expose encrypted_password
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryResponse {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl EntryResponse {
    pub fn from_entry(entry: &Entry) -> Self {
        EntryResponse {
            id: entry.id.clone(),
            name: entry.name.clone(),
            url: entry.url.clone(),
            username: entry.username.clone(),
            notes: entry.notes.clone(),
            category: entry.category.clone(),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntryInput {
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: String, // plaintext, will be encrypted
    pub notes: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEntryInput {
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>, // if Some, will be re-encrypted
    pub notes: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlPath {
    pub id: String,
    pub entry_id: String,
    pub path: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateNoteInput {
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileShortcut {
    pub id: String,
    pub name: String,
    pub path: String,
    pub shortcut_type: String, // "file" or "folder"
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileShortcutInput {
    pub name: String,
    pub path: String,
    pub shortcut_type: String,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT,
                username TEXT,
                encrypted_password TEXT NOT NULL,
                notes TEXT,
                category TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            
            CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name);
            CREATE INDEX IF NOT EXISTS idx_entries_category ON entries(category);

            CREATE TABLE IF NOT EXISTS notes (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content_html TEXT NOT NULL DEFAULT '',
                category TEXT DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notes_title ON notes(title);
            CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);

            CREATE TABLE IF NOT EXISTS url_paths (
                id TEXT PRIMARY KEY,
                entry_id TEXT NOT NULL,
                path TEXT NOT NULL,
                label TEXT,
                notes TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_url_paths_entry_id ON url_paths(entry_id);

            CREATE TABLE IF NOT EXISTS file_shortcuts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                shortcut_type TEXT NOT NULL DEFAULT 'file',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_file_shortcuts_name ON file_shortcuts(name);
        ")?;
        
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
            params![key, value],
        )?;
        Ok(())
    }
    
    pub fn get_meta(&self, key: &str) -> Result<Option<String>, AppError> {
        let result = self.conn.query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        
        match result {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }
    
    fn row_to_entry(row: &rusqlite::Row) -> rusqlite::Result<Entry> {
        Ok(Entry {
            id: row.get(0)?,
            name: row.get(1)?,
            url: row.get(2)?,
            username: row.get(3)?,
            encrypted_password: row.get(4)?,
            notes: row.get(5)?,
            category: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }
    
    pub fn list_all_entries(&self) -> Result<Vec<Entry>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, url, username, encrypted_password, notes, category, created_at, updated_at 
             FROM entries ORDER BY created_at DESC"
        )?;
        let rows = stmt.query_map([], Self::row_to_entry)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
    
    pub fn create_entry(&self, entry: &Entry) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.id,
                entry.name,
                entry.url,
                entry.username,
                entry.encrypted_password,
                entry.notes,
                entry.category,
                entry.created_at,
                entry.updated_at,
            ],
        )?;
        Ok(())
    }
    
    pub fn update_entry(&self, entry: &Entry) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE entries SET name=?2, url=?3, username=?4, encrypted_password=?5, notes=?6, category=?7, updated_at=?8
             WHERE id=?1",
            params![
                entry.id,
                entry.name,
                entry.url,
                entry.username,
                entry.encrypted_password,
                entry.notes,
                entry.category,
                entry.updated_at,
            ],
        )?;
        Ok(())
    }
    
    pub fn delete_entry(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM entries WHERE id = ?1", params![id])?;
        Ok(())
    }
    
    pub fn get_entry(&self, id: &str) -> Result<Option<Entry>, AppError> {
        let result = self.conn.query_row(
            "SELECT id, name, url, username, encrypted_password, notes, category, created_at, updated_at 
             FROM entries WHERE id = ?1",
            params![id],
            Self::row_to_entry,
        );
        
        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }
    
    pub fn batch_delete(&self, ids: &[String]) -> Result<usize, AppError> {
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        for id in ids {
            count += tx.execute("DELETE FROM entries WHERE id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn batch_update_passwords(&self, updates: &[(String, String)], updated_at: i64) -> Result<usize, AppError> {
        let tx = self.conn.unchecked_transaction()?;
        let mut count = 0;
        for (id, encrypted_password) in updates {
            count += tx.execute(
                "UPDATE entries SET encrypted_password=?2, updated_at=?3 WHERE id=?1",
                params![id, encrypted_password, updated_at],
            )?;
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn finish_password_change(&self, updates: &[(String, String)], updated_at: i64, salt_b64: &str, verify_hash: &str) -> Result<(), AppError> {
        let tx = self.conn.unchecked_transaction()?;
        for (id, encrypted_password) in updates {
            tx.execute(
                "UPDATE entries SET encrypted_password=?2, updated_at=?3 WHERE id=?1",
                params![id, encrypted_password, updated_at],
            )?;
        }
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('salt', ?1)", params![salt_b64])?;
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('verify_hash', ?1)", params![verify_hash])?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_test_entries(&self) -> Result<usize, AppError> {
        Ok(self.conn.execute("DELETE FROM entries WHERE id LIKE 'test-%'", [])?)
    }

    pub fn get_db_path(&self) -> String {
        self.conn.path().unwrap_or("").to_string()
    }
    
    fn format_sql_value(&self, val: &Option<String>, default: &str) -> String {
        match val {
            Some(v) => format!("'{}'", v.replace('\'', "''")),
            None => default.to_string(),
        }
    }

    pub fn export_sql(&self) -> Result<String, AppError> {
        let mut sql = String::new();
        const SENSITIVE_KEYS: &[&str] = &["salt", "verify_hash"];

        sql.push_str("-- Meta data\n");
        let mut stmt = self.conn.prepare("SELECT key, value FROM meta")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (key, value) = row?;
            if SENSITIVE_KEYS.contains(&key.as_str()) {
                continue;
            }
            sql.push_str(&format!(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ({}, {});\n",
                self.format_sql_value(&Some(key), ""),
                self.format_sql_value(&Some(value), ""),
            ));
        }

        sql.push_str("\n-- Entries\n");
        let entries = self.list_all_entries()?;
        for e in entries {
            sql.push_str(&format!(
                "INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at) \
                 VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {});\n",
                self.format_sql_value(&Some(e.id), ""),
                self.format_sql_value(&Some(e.name), ""),
                self.format_sql_value(&e.url, "NULL"),
                self.format_sql_value(&e.username, "NULL"),
                self.format_sql_value(&Some(e.encrypted_password), ""),
                self.format_sql_value(&e.notes, "NULL"),
                self.format_sql_value(&e.category, "''"),
                e.created_at,
                e.updated_at,
            ));
        }

        sql.push_str("\n-- Notes\n");
        let notes = self.list_all_notes()?;
        for n in notes {
            sql.push_str(&format!(
                "INSERT INTO notes (id, title, content_html, category, created_at, updated_at) \
                 VALUES ({}, {}, {}, {}, {}, {});\n",
                self.format_sql_value(&Some(n.id), ""),
                self.format_sql_value(&Some(n.title), ""),
                self.format_sql_value(&Some(n.content_html), ""),
                self.format_sql_value(&n.category, "''"),
                n.created_at,
                n.updated_at,
            ));
        }

        sql.push_str("\n-- URL Paths\n");
        let entries = self.list_all_entries()?;
        for e in &entries {
            let paths = self.list_url_paths(&e.id)?;
            for p in paths {
                sql.push_str(&format!(
                    "INSERT INTO url_paths (id, entry_id, path, label, notes, created_at) \
                     VALUES ({}, {}, {}, {}, {}, {});\n",
                    self.format_sql_value(&Some(p.id), ""),
                    self.format_sql_value(&Some(p.entry_id), ""),
                    self.format_sql_value(&Some(p.path), ""),
                    self.format_sql_value(&p.label, "NULL"),
                    self.format_sql_value(&p.notes, "NULL"),
                    p.created_at,
                ));
            }
        }

        sql.push_str("\n-- File Shortcuts\n");
        let shortcuts = self.list_file_shortcuts()?;
        for s in shortcuts {
            sql.push_str(&format!(
                "INSERT INTO file_shortcuts (id, name, path, shortcut_type, created_at) \
                 VALUES ({}, {}, {}, {}, {});\n",
                self.format_sql_value(&Some(s.id), ""),
                self.format_sql_value(&Some(s.name), ""),
                self.format_sql_value(&Some(s.path), ""),
                self.format_sql_value(&Some(s.shortcut_type), ""),
                s.created_at,
            ));
        }

        Ok(sql)
    }

    pub fn import_sql(&self, sql: &str) -> Result<(), AppError> {
        // SQL validation is done in commands.rs before calling this
        self.conn.execute_batch(sql)?;
        Ok(())
    }

    // ─ Notes CRUD ──

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

    // ─ URL Paths CRUD ──

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

    // File Shortcuts
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::env;
    
    fn setup_test_db() -> (Database, String) {
        let temp_dir = env::temp_dir();
        let path = temp_dir.join(format!("desko_test_{}.db", uuid::Uuid::new_v4()));
        let path_str = path.to_str().unwrap().to_string();
        let db = Database::new(&path_str).unwrap();
        (db, path_str)
    }
    
    fn cleanup(path: &str) {
        let _ = fs::remove_file(path);
    }
    
    #[test]
    fn test_meta_operations() {
        let (db, path) = setup_test_db();
        
        // Initially not initialized
        assert!(!db.is_initialized().unwrap());
        
        // Set meta
        db.set_meta("initialized", "true").unwrap();
        db.set_meta("salt", "test_salt").unwrap();
        
        // Get meta
        assert_eq!(db.get_meta("salt").unwrap(), Some("test_salt".to_string()));
        assert_eq!(db.get_meta("nonexistent").unwrap(), None);
        
        // Now initialized
        assert!(db.is_initialized().unwrap());
        
        cleanup(&path);
    }
    
    #[test]
    fn test_create_and_get_entry() {
        let (db, path) = setup_test_db();
        
        let entry = Entry {
            id: "test-id-1".to_string(),
            name: "Test Entry".to_string(),
            url: Some("https://example.com".to_string()),
            username: Some("user".to_string()),
            encrypted_password: r#"{"ciphertext":"abc","iv":"def"}"#.to_string(),
            notes: Some("Test notes".to_string()),
            category: Some("test".to_string()),
            created_at: 1000,
            updated_at: 1000,
        };
        
        db.create_entry(&entry).unwrap();
        
        let retrieved = db.get_entry("test-id-1").unwrap().unwrap();
        assert_eq!(retrieved.name, "Test Entry");
        assert_eq!(retrieved.url, Some("https://example.com".to_string()));
        assert_eq!(retrieved.username, Some("user".to_string()));
        
        // Non-existent entry
        assert!(db.get_entry("nonexistent").unwrap().is_none());
        
        cleanup(&path);
    }
    
    #[test]
    fn test_list_all_entries() {
        let (db, path) = setup_test_db();

        for i in 0..3 {
            let entry = Entry {
                id: format!("id-{}", i),
                name: format!("Entry {}", i),
                url: Some(format!("https://example{}.com", i)),
                username: None,
                encrypted_password: "{}".to_string(),
                notes: None,
                category: Some(if i < 2 { "cat1" } else { "cat2" }.to_string()),
                created_at: 1000 + i,
                updated_at: 1000 + i,
            };
            db.create_entry(&entry).unwrap();
        }

        let all = db.list_all_entries().unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].name, "Entry 2");

        cleanup(&path);
    }
    
    #[test]
    fn test_update_entry() {
        let (db, path) = setup_test_db();
        
        let entry = Entry {
            id: "update-test".to_string(),
            name: "Original".to_string(),
            url: None,
            username: None,
            encrypted_password: "{}".to_string(),
            notes: None,
            category: None,
            created_at: 1000,
            updated_at: 1000,
        };
        db.create_entry(&entry).unwrap();
        
        // Update
        let mut updated = entry.clone();
        updated.name = "Updated".to_string();
        updated.url = Some("https://new.com".to_string());
        updated.updated_at = 2000;
        
        db.update_entry(&updated).unwrap();
        
        let retrieved = db.get_entry("update-test").unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated");
        assert_eq!(retrieved.url, Some("https://new.com".to_string()));
        assert_eq!(retrieved.updated_at, 2000);
        
        cleanup(&path);
    }
    
    #[test]
    fn test_delete_entry() {
        let (db, path) = setup_test_db();
        
        let entry = Entry {
            id: "delete-test".to_string(),
            name: "To Delete".to_string(),
            url: None,
            username: None,
            encrypted_password: "{}".to_string(),
            notes: None,
            category: None,
            created_at: 1000,
            updated_at: 1000,
        };
        db.create_entry(&entry).unwrap();
        
        // Verify exists
        assert!(db.get_entry("delete-test").unwrap().is_some());
        
        // Delete
        db.delete_entry("delete-test").unwrap();
        
        // Verify deleted
        assert!(db.get_entry("delete-test").unwrap().is_none());
        
        cleanup(&path);
    }
    
    #[test]
    fn test_entry_response_no_password() {
        let entry = Entry {
            id: "test".to_string(),
            name: "Test".to_string(),
            url: None,
            username: None,
            encrypted_password: r#"{"ciphertext":"secret","iv":"nonce"}"#.to_string(),
            notes: None,
            category: None,
            created_at: 1000,
            updated_at: 1000,
        };
        
        let response = EntryResponse::from_entry(&entry);
        
        // EntryResponse should NOT have encrypted_password field
        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("encrypted_password"));
    }
    
    #[test]
    fn test_export_sql() {
        let (db, path) = setup_test_db();
        
        db.set_meta("initialized", "true").unwrap();
        
        let entry = Entry {
            id: "export-test".to_string(),
            name: "Export Test".to_string(),
            url: Some("https://test.com".to_string()),
            username: None,
            encrypted_password: "{}".to_string(),
            notes: None,
            category: None,
            created_at: 1000,
            updated_at: 1000,
        };
        db.create_entry(&entry).unwrap();
        
        let sql = db.export_sql().unwrap();
        
        assert!(sql.contains("INSERT OR REPLACE INTO meta"));
        assert!(sql.contains("INSERT INTO entries"));
        assert!(sql.contains("export-test"));
        assert!(sql.contains("Export Test"));
        
        cleanup(&path);
    }
}
