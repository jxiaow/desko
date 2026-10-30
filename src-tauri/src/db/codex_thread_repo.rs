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
    fn reopening_the_database_clears_threads_and_same_id_can_exist_in_windows_and_wsl() {
        let db = Database::new(":memory:").unwrap();
        let thread = Thread { id: "same-id".into(), environment: Default::default(), session_id: "session".into(), cwd: "C:/repo".into(), title: "Windows 历史".into(), source: None, model: None, sandbox: "read-only".into(), created_at: 1, updated_at: 2 };
        db.save_codex_dialog_thread(&thread).unwrap();
        crate::db::schema::run_schema(&db.conn).unwrap();
        crate::db::schema::run_schema(&db.conn).unwrap();
        assert!(db.codex_dialog_threads().unwrap().is_empty());
        let mut wsl = thread.clone();
        wsl.environment = crate::services::codex_bridge::environment::Environment::Wsl { distro: "Ubuntu".into(), user: "alice".into() };
        wsl.cwd = "/mnt/c/repo".into(); wsl.title = "WSL 历史".into(); wsl.updated_at = 3;
        db.save_codex_dialog_thread(&thread).unwrap();
        db.save_codex_dialog_thread(&wsl).unwrap();
        let rows = db.codex_dialog_threads().unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|t| t.title == "Windows 历史"));
        assert!(rows.iter().any(|t| t.title == "WSL 历史"));
    }
}
