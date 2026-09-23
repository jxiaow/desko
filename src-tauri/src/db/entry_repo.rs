use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::*;

impl Database {
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

    pub fn list_all_entries_with_paths(&self) -> Result<Vec<EntryWithPaths>, AppError> {
        let entries = self.list_all_entries()?;
        let mut result = Vec::with_capacity(entries.len());
        for entry in entries {
            let paths = self.list_url_paths(&entry.id)?;
            result.push(EntryWithPaths {
                id: entry.id,
                name: entry.name,
                url: entry.url,
                username: entry.username,
                notes: entry.notes,
                category: entry.category,
                created_at: entry.created_at,
                updated_at: entry.updated_at,
                paths,
            });
        }
        Ok(result)
    }

    pub fn create_entry(&self, entry: &Entry) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO entries (id, name, url, username, encrypted_password, notes, category, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entry.id, entry.name, entry.url, entry.username,
                entry.encrypted_password, entry.notes, entry.category,
                entry.created_at, entry.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn update_entry(&self, entry: &Entry) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE entries SET name=?2, url=?3, username=?4, encrypted_password=?5, notes=?6, category=?7, updated_at=?8
             WHERE id=?1",
            params![
                entry.id, entry.name, entry.url, entry.username,
                entry.encrypted_password, entry.notes, entry.category,
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

    pub fn finish_password_change(
        &self,
        updates: &[(String, String)],
        updated_at: i64,
        salt_b64: &str,
        verify_hash: &str,
        extra_meta: &[(&str, &str)],
        note_wraps: &[(String, String)],
    ) -> Result<(), AppError> {
        let tx = self.conn.unchecked_transaction()?;
        for (id, encrypted_password) in updates {
            tx.execute(
                "UPDATE entries SET encrypted_password=?2, updated_at=?3 WHERE id=?1",
                params![id, encrypted_password, updated_at],
            )?;
        }
        for (id, wrap_master) in note_wraps {
            tx.execute(
                "UPDATE notes SET wrap_master=?2 WHERE id=?1",
                params![id, wrap_master],
            )?;
        }
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('salt', ?1)", params![salt_b64])?;
        tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('verify_hash', ?1)", params![verify_hash])?;
        for (key, value) in extra_meta {
            tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", params![key, value])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_test_entries(&self) -> Result<usize, AppError> {
        Ok(self.conn.execute("DELETE FROM entries WHERE id LIKE 'test-%'", [])?)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{setup_test_db, cleanup};
    use super::super::models::Entry;

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

        assert!(db.get_entry("delete-test").unwrap().is_some());

        db.delete_entry("delete-test").unwrap();

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

        let response = super::super::EntryResponse::from_entry(&entry);

        let json = serde_json::to_string(&response).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains("encrypted_password"));
    }
}
