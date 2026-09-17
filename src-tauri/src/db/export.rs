use crate::error::AppError;
use super::Database;

impl Database {
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
        self.conn.execute_batch(sql)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::{setup_test_db, cleanup};
    use super::super::models::Entry;

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
