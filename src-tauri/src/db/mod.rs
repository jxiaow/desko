mod models;
mod schema;
pub mod entry_repo;
pub mod note_repo;
pub mod url_path_repo;
pub mod file_repo;
pub mod attachment_repo;
pub mod mfa_repo;

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
