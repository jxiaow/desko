use super::Database;
use crate::services::codex_bridge::model::Thread;

impl Database {
    pub fn codex_dialog_threads(&self) -> Result<Vec<Thread>, String> {
        let mut statement = self.conn.prepare("SELECT metadata FROM codex_dialog_threads ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
        rows.map(|row| serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| format!("会话索引无效：{e}"))).collect()
    }
    pub fn save_codex_dialog_thread(&self, thread: &Thread) -> Result<(), String> {
        let metadata = serde_json::to_string(thread).map_err(|e| e.to_string())?;
        self.conn.execute("INSERT INTO codex_dialog_threads (environment, id, metadata, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(environment, id) DO UPDATE SET metadata=excluded.metadata, updated_at=excluded.updated_at WHERE excluded.updated_at >= codex_dialog_threads.updated_at",
            rusqlite::params![thread.environment.key(), thread.id, metadata, thread.updated_at]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_round_trip_does_not_allow_stale_completion_to_overwrite_new_title() {
        let db = Database::new(":memory:").unwrap();
        let mut thread = Thread { id: "thread".into(), environment: Default::default(), session_id: "session".into(), cwd: "C:/repo".into(), title: "旧标题".into(), source: None, model: Some("model".into()), sandbox: "read-only".into(), created_at: 1, updated_at: 2 };
        let old = thread.clone();
        thread.title = "新标题".into(); thread.updated_at = 3;
        db.save_codex_dialog_thread(&thread).unwrap();
        db.save_codex_dialog_thread(&old).unwrap();
        let rows = db.codex_dialog_threads().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].title, "新标题");
        assert_eq!(rows[0].session_id, "session");
    }

    #[test]
    fn legacy_index_migrates_and_same_thread_id_can_exist_in_windows_and_wsl() {
        let db = Database::new(":memory:").unwrap();
        db.conn.execute_batch("DROP TABLE codex_dialog_threads;
            CREATE TABLE codex_dialog_threads (id TEXT PRIMARY KEY, metadata TEXT NOT NULL, updated_at INTEGER NOT NULL);").unwrap();
        let old = serde_json::json!({"id":"same-id","cwd":"C:/repo","title":"Windows 历史","model":null,"sandbox":"read-only","createdAt":1,"updatedAt":2});
        db.conn.execute("INSERT INTO codex_dialog_threads VALUES (?1, ?2, ?3)", rusqlite::params!["same-id",old.to_string(),2]).unwrap();
        crate::db::schema::run_schema(&db.conn).unwrap();
        crate::db::schema::run_schema(&db.conn).unwrap();
        let mut thread = db.codex_dialog_threads().unwrap().remove(0);
        assert_eq!(thread.environment, crate::services::codex_bridge::environment::Environment::Native);
        thread.environment = crate::services::codex_bridge::environment::Environment::Wsl { distro: "Ubuntu".into(), user: "alice".into() };
        thread.cwd = "/mnt/c/repo".into(); thread.title = "WSL 历史".into();
        db.save_codex_dialog_thread(&thread).unwrap();
        let rows = db.codex_dialog_threads().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|t| t.title == "Windows 历史"));
        assert!(rows.iter().any(|t| t.title == "WSL 历史"));
    }
}
