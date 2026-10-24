mod models;
mod schema;
pub mod entry_repo;
pub mod note_repo;
pub mod url_path_repo;
pub mod file_repo;
pub mod attachment_repo;
pub mod mfa_repo;
pub mod bypass_repo;
pub mod tunnel_repo;
pub mod codex_thread_repo;

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
        let db = Database { conn };
        db.normalize_attachment_paths()?;
        Ok(db)
    }

    /// 附件路径归一：库里曾经存的是绝对路径（用户名和 APPDATA 被一起写进了数据），
    /// 换台机器甚至换个 Windows 账号，图片就全显示不出来了。开库时洗成相对形态
    /// （登记表只留文件名、正文 src 变 `attachments/<文件名>`），幂等。
    /// 从旧版迁移包/旧备份恢复出来的库也走这条路，所以导入端不需要特殊处理。
    fn normalize_attachment_paths(&self) -> Result<(), AppError> {
        let mut changed = 0usize;

        let rows: Vec<(String, String)> = self.rows(
            "SELECT id, file_path FROM note_attachments
             WHERE file_path LIKE '%\\%' OR file_path LIKE '%/%' OR file_path LIKE '%:%'",
        )?;
        for (id, old) in rows {
            if let Some(name) = crate::services::attachment_service::name_of(&old) {
                if name != old {
                    self.conn.execute(
                        "UPDATE note_attachments SET file_path = ?1 WHERE id = ?2",
                        rusqlite::params![name, id],
                    )?;
                    changed += 1;
                }
            }
        }

        // 规范形态里没有 "://"，这一条 prefilter 就足够把老数据筛出来
        let notes: Vec<(String, String)> =
            self.rows("SELECT id, content_html FROM notes WHERE content_html LIKE '%://%'")?;
        for (id, html) in notes {
            let (next, n) = crate::services::attachment_service::canonicalize_html(&html);
            if n > 0 {
                self.conn.execute(
                    "UPDATE notes SET content_html = ?1 WHERE id = ?2",
                    rusqlite::params![next, id],
                )?;
                changed += n;
            }
        }

        if changed > 0 {
            eprintln!("desko: 已把 {changed} 处附件路径改写成相对形态");
        }
        Ok(())
    }

    /// 一次读干净再改：拿着 stmt 的同时 UPDATE 会把查询游标作废
    fn rows(&self, sql: &str) -> Result<Vec<(String, String)>, AppError> {
        let mut stmt = self.conn.prepare(sql)?;
        let mut it = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = Vec::new();
        while let Some(x) = it.next() {
            out.push(x?);
        }
        Ok(out)
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

    pub fn set_meta_batch(&self, values: &[(&str, &str)]) -> Result<(), AppError> {
        let tx = self.conn.unchecked_transaction()?;
        for (key, value) in values {
            tx.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)", rusqlite::params![key, value])?;
        }
        tx.commit()?;
        Ok(())
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
        self.swap_into_restored_with_accounts(app_data_dir, attachments_dir, staging, None)
    }

    pub fn swap_into_restored_with_accounts(
        &mut self, app_data_dir: &std::path::Path, attachments_dir: &std::path::Path,
        staging: &std::path::Path, accounts: Option<&[u8]>,
    ) -> Result<(), AppError> {
        // Reject incompatible snapshots while the live connection and files are
        // still intact. Migration/normalization errors must precede journal commit.
        let staged_db = staging.join("data.db");
        if !staged_db.is_file() {
            return Err(AppError::Backup("恢复暂存数据库不存在".into()));
        }
        let staged_path = staged_db.to_str().ok_or_else(|| AppError::Backup("恢复数据库路径无效".into()))?;
        drop(Database::new(staged_path)?);
        crate::backup::check_integrity(&staged_db)?;
        let old = std::mem::replace(&mut self.conn, Connection::open_in_memory()?);
        drop(old);
        let swapped = crate::backup::swap_live_files_with_accounts(app_data_dir, attachments_dir, staging, accounts);
        let db_file = app_data_dir.join("data.db");
        // 回滚失败时宁可停在错误态，也不能在旧文件之外悄悄新建一个空库。
        if !db_file.exists() {
            return Err(AppError::Backup("数据库文件尚未恢复，请重启后重试恢复".into()));
        }
        self.conn = Connection::open(&db_file)?;
        self.conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        schema::run_schema(&self.conn)?;
        // 旧版备份包里存的是那台机器的绝对路径，换机恢复后一律洗成本机相对形态
        self.normalize_attachment_paths()?;
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

    #[cfg(windows)]
    #[test]
    fn failed_attachment_move_reopens_original_database() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = std::env::temp_dir().join(format!("desko_swap_db_{}", uuid::Uuid::new_v4()));
        let attachments = root.join("attachments");
        let staging = root.join("staging");
        std::fs::create_dir_all(&attachments).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        let mut db = Database::new(root.join("data.db").to_str().unwrap()).unwrap();
        db.set_meta("initialized", "true").unwrap();
        db.set_meta("original", "retained").unwrap();
        drop(Database::new(staging.join("data.db").to_str().unwrap()).unwrap());
        std::fs::write(attachments.join("held.bin"), b"held").unwrap();
        let held = std::fs::OpenOptions::new().read(true).share_mode(0).open(attachments.join("held.bin")).unwrap();
        assert!(db.swap_into_restored(&root, &attachments, &staging).is_err());
        assert!(db.is_initialized().unwrap());
        assert_eq!(db.get_meta("original").unwrap().as_deref(), Some("retained"));
        drop(held);
        drop(db);
        crate::backup::recover_swap(&root, &attachments).unwrap();
        let db = Database::new(root.join("data.db").to_str().unwrap()).unwrap();
        assert!(db.is_initialized().unwrap());
        drop(db);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// 绝对路径进过库的代价：换机器/换账号之后图片全断。开库时洗成相对形态，
    /// 而且幂等 —— 第二次开库一个字节都不该再动。
    #[test]
    fn attachment_paths_are_normalized_on_open() {
        let (db, path) = setup_test_db();
        {
            let conn = &db.conn;
            conn.execute(
                "INSERT INTO notes (id, title, content_html, created_at, updated_at) VALUES ('n1','t',?1,1,1)",
                rusqlite::params![
                    r#"<p>图</p><img src="http://asset.localhost/C%3A%5CUsers%5Cjiang%5Cattachments%5Cu1__a.png">"#
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO note_attachments (id, note_id, file_name, file_path, file_size, mime_type, created_at) VALUES ('a1','n1','a.png',?1,1,'image/png',1)",
                rusqlite::params![r"C:\Users\jiang\AppData\Roaming\desko\attachments\u1__a.png"],
            )
            .unwrap();
        }
        drop(db);

        let db = Database::new(&path).unwrap();
        let stored: String = db
            .conn
            .query_row("SELECT file_path FROM note_attachments WHERE id='a1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, "u1__a.png", "登记表只该留文件名");
        let html: String = db
            .conn
            .query_row("SELECT content_html FROM notes WHERE id='n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(html, r#"<p>图</p><img src="attachments/u1__a.png">"#, "src 换成本机相对写法");
        drop(db);

        // 再开一次：没有东西可改，内容原样
        let db = Database::new(&path).unwrap();
        let html2: String = db
            .conn
            .query_row("SELECT content_html FROM notes WHERE id='n1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(html2, html, "幂等");
        drop(db);
        cleanup(&path);
    }

    /// 上一版建的库只有八列：重开库要把公网策略两列补上，老行读出来是默认值
    /// （只读默认开、口令默认没设）。这条路只在真机老库上走得到，所以单独测
    #[test]
    fn public_policy_columns_are_added_to_an_existing_table() {
        let (db, path) = setup_test_db();
        db.conn
            .execute_batch(
                "ALTER TABLE tunnel_services DROP COLUMN public_read_only;
                 ALTER TABLE tunnel_services DROP COLUMN public_password_sha256;",
            )
            .unwrap();
        db.conn
            .execute(
                "INSERT INTO tunnel_services (id, hostname, port, label, preset, routed, created_at, updated_at)
                 VALUES ('s1','files.example.com',8421,'局域网传输','fileshare',1,100,100)",
                [],
            )
            .unwrap();
        drop(db);

        let db = Database::new(&path).unwrap();
        let got = db.get_tunnel_service("s1").unwrap().unwrap();
        assert!(got.public_password_sha256.is_empty(), "老行没设过口令，读出来就该是空");
        assert!(got.public_read_only, "默认只读：补列不能顺手把写权限打开");
        assert_eq!(got.hostname, "files.example.com");
        drop(db);
        cleanup(&path);
    }

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
