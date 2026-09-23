use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::{Note, NoteLockRow};

const NOTE_SELECT: &str = "id, title, content_html, category, created_at, updated_at, pinned, starred, enc";

impl Database {
    fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<Note> {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content_html: row.get(2)?,
            category: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            pinned: row.get::<_, i32>(6)? != 0,
            starred: row.get::<_, i32>(7)? != 0,
            encrypted: row.get::<_, i32>(8)? != 0,
        })
    }

    pub fn list_all_notes(&self) -> Result<Vec<Note>, AppError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {} FROM notes ORDER BY pinned DESC, created_at DESC", NOTE_SELECT
        ))?;
        let rows = stmt.query_map([], Self::row_to_note)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn create_note(&self, note: &Note) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO notes (id, title, content_html, category, created_at, updated_at, pinned, starred) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                note.id,
                note.title,
                note.content_html,
                note.category,
                note.created_at,
                note.updated_at,
                note.pinned as i32,
                note.starred as i32,
            ],
        )?;
        Ok(())
    }

    pub fn update_note(&self, note: &Note) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET title=?2, content_html=?3, category=?4, updated_at=?5, pinned=?6, starred=?7 WHERE id=?1",
            params![
                note.id,
                note.title,
                note.content_html,
                note.category,
                note.updated_at,
                note.pinned as i32,
                note.starred as i32,
            ],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 全部小记正文，扫未引用附件用（正文里出现的 asset 地址就是文件的存活证明）
    pub fn all_note_html(&self) -> Result<Vec<String>, AppError> {
        let mut stmt = self.conn.prepare("SELECT content_html FROM notes")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.flatten().collect())
    }

    pub fn get_note(&self, id: &str) -> Result<Option<Note>, AppError> {
        let result = self.conn.query_row(
            &format!("SELECT {} FROM notes WHERE id = ?1", NOTE_SELECT),
            params![id],
            Self::row_to_note,
        );
        match result {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 加密行才返回；未加密小记返回 None
    pub fn get_note_lock(&self, id: &str) -> Result<Option<NoteLockRow>, AppError> {
        let result = self.conn.query_row(
            "SELECT cipher, cipher_iv, wrap_pass, pass_salt, wrap_master FROM notes WHERE id = ?1 AND enc = 1",
            params![id],
            |row| Ok(NoteLockRow {
                cipher: row.get(0)?,
                cipher_iv: row.get(1)?,
                wrap_pass: row.get(2)?,
                pass_salt: row.get(3)?,
                wrap_master: row.get(4)?,
            }),
        );
        match result {
            Ok(lock) => Ok(Some(lock)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    /// 上锁：密文入库，正文与分类清空；title 由调用方给出「可露出的标题」，
    /// 没有真标题时传空串。wrap_pass 存的是域密钥封好的 DEK；
    /// pass_salt / wrap_master 是旧逐条模型的遗留列，置空
    pub fn set_note_lock(
        &self,
        id: &str,
        cipher: &str,
        cipher_iv: &str,
        wrap_pass: &str,
        title: &str,
        updated_at: i64,
    ) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET enc = 1, cipher = ?2, cipher_iv = ?3, wrap_pass = ?4, pass_salt = '', wrap_master = '', title = ?6, content_html = '', category = '', updated_at = ?5 WHERE id = ?1",
            params![id, cipher, cipher_iv, wrap_pass, updated_at, title],
        )?;
        Ok(())
    }

    /// 编辑已加密小记：只换密文和露出的标题，正文与分类保持清空
    pub fn update_note_cipher(&self, id: &str, cipher: &str, cipher_iv: &str, title: &str, updated_at: i64) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET cipher = ?2, cipher_iv = ?3, title = ?5, updated_at = ?4 WHERE id = ?1 AND enc = 1",
            params![id, cipher, cipher_iv, updated_at, title],
        )?;
        Ok(())
    }

    /// 解除加密：密文与封条全部抹掉
    pub fn clear_note_lock(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET enc = 0, cipher = '', cipher_iv = '', wrap_pass = '', pass_salt = '', wrap_master = '' WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// 设口令时一次性改封用：所有加密行的完整封条
    pub fn list_note_locks(&self) -> Result<Vec<(String, NoteLockRow)>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, cipher, cipher_iv, wrap_pass, pass_salt, wrap_master FROM notes WHERE enc = 1",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                NoteLockRow {
                    cipher: r.get(1)?,
                    cipher_iv: r.get(2)?,
                    wrap_pass: r.get(3)?,
                    pass_salt: r.get(4)?,
                    wrap_master: r.get(5)?,
                },
            ))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// 域密钥落库：三条 meta 加逐行改封（连带补露出的标题），一个事务里走完，不留半迁移状态
    pub fn apply_note_domain(
        &self,
        meta: &[(&str, &str)],
        resealed: &[(String, String, String)],
    ) -> Result<(), AppError> {
        let tx = self.conn.unchecked_transaction()?;
        for (id, wrap_pass, title) in resealed {
            tx.execute(
                "UPDATE notes SET wrap_pass=?2, pass_salt='', wrap_master='', title=?3 WHERE id=?1 AND enc=1",
                params![id, wrap_pass, title],
            )?;
        }
        for (key, value) in meta {
            tx.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?1, ?2)",
                params![key, value],
            )?;
        }
        tx.commit()?;
        Ok(())
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

    pub fn toggle_pin_note(&self, id: &str) -> Result<bool, AppError> {
        let note = self.get_note(id)?.ok_or(AppError::Database("note not found".to_string()))?;
        let new_pinned = !note.pinned;
        self.conn.execute(
            "UPDATE notes SET pinned = ?1 WHERE id = ?2",
            params![new_pinned as i32, id],
        )?;
        Ok(new_pinned)
    }

    pub fn toggle_star_note(&self, id: &str) -> Result<bool, AppError> {
        let note = self.get_note(id)?.ok_or(AppError::Database("note not found".to_string()))?;
        let new_starred = !note.starred;
        self.conn.execute(
            "UPDATE notes SET starred = ?1 WHERE id = ?2",
            params![new_starred as i32, id],
        )?;
        Ok(new_starred)
    }
}

#[cfg(test)]
mod tests {
    use super::super::{cleanup, setup_test_db};
    use super::Note;

    fn note(id: &str) -> Note {
        Note {
            id: id.to_string(),
            title: "t".to_string(),
            content_html: "<p>正文</p>".to_string(),
            category: None,
            created_at: 1,
            updated_at: 1,
            pinned: false,
            starred: false,
            encrypted: false,
        }
    }

    /// 旧逐条模型留下的行：wrap_master/pass_salt 有值，域化改封后必须清空
    fn legacy_locked(db: &super::super::Database, id: &str) {
        db.create_note(&note(id)).unwrap();
        db.set_note_lock(id, "ct", "iv", "wrap-old", "", 2).unwrap();
        db.conn
            .execute(
                "UPDATE notes SET pass_salt='salt-old', wrap_master='wrap-m' WHERE id=?1",
                rusqlite::params![id],
            )
            .unwrap();
    }

    #[test]
    fn apply_note_domain_reseals_and_clears_legacy_columns() {
        let (db, path) = setup_test_db();
        legacy_locked(&db, "n1");
        legacy_locked(&db, "n2");
        db.create_note(&note("plain")).unwrap();

        db.apply_note_domain(
            &[("note_salt", "s"), ("note_key_wrap", "w")],
            &[
                ("n1".to_string(), "wrap-new".to_string(), "标题甲".to_string()),
                ("plain".to_string(), "wrap-x".to_string(), String::new()),
            ],
        )
        .unwrap();

        let locks = db.list_note_locks().unwrap();
        assert_eq!(locks.len(), 2, "只列加密行");
        let wrap_of = |want: &str| {
            locks.iter().find(|(id, _)| id == want).map(|(_, l)| l.clone())
        };
        let l1 = wrap_of("n1").unwrap();
        assert_eq!(l1.wrap_pass, "wrap-new");
        assert!(l1.pass_salt.is_empty() && l1.wrap_master.is_empty(), "旧封条列要抹干净");
        // 未加密的行不在 UPDATE 的 AND enc=1 里，一条都不会被改封
        assert!(wrap_of("plain").is_none());
        assert_eq!(wrap_of("n2").unwrap().wrap_pass, "wrap-old", "不在 resealed 里就该原样");
        assert_eq!(db.get_note("n1").unwrap().unwrap().title, "标题甲", "改封时补上露出的标题");
        assert!(db.get_note("n2").unwrap().unwrap().title.is_empty(), "没算出标题就还是空");
        assert!(!db.get_note("plain").unwrap().unwrap().encrypted);
        assert_eq!(db.get_meta("note_key_wrap").unwrap().unwrap(), "w");
        cleanup(&path);
    }

    #[test]
    fn set_note_lock_writes_domain_shape() {
        let (db, path) = setup_test_db();
        db.create_note(&note("n1")).unwrap();
        db.set_note_lock("n1", "ct", "iv", "wrap-new", "标题行", 9).unwrap();

        let row = db.get_note_lock("n1").unwrap().unwrap();
        assert_eq!((row.cipher.as_str(), row.cipher_iv.as_str()), ("ct", "iv"));
        assert_eq!(row.wrap_pass, "wrap-new");
        assert!(row.pass_salt.is_empty() && row.wrap_master.is_empty());
        let n = db.get_note("n1").unwrap().unwrap();
        assert!(n.encrypted && n.content_html.is_empty(), "正文当场清掉");
        assert_eq!(n.title, "标题行", "锁着也能认出是哪条");
        cleanup(&path);
    }

    #[test]
    fn update_note_cipher_refreshes_title_only_for_locked_rows() {
        let (db, path) = setup_test_db();
        db.create_note(&note("n1")).unwrap();
        db.set_note_lock("n1", "ct", "iv", "wrap-new", "旧标题", 9).unwrap();
        db.create_note(&note("plain")).unwrap();

        db.update_note_cipher("n1", "ct2", "iv2", "新标题", 12).unwrap();
        let n = db.get_note("n1").unwrap().unwrap();
        assert_eq!((n.title.as_str(), n.content_html.as_str()), ("新标题", ""));
        // 未加密的行不在这条 UPDATE 的 AND enc=1 里
        assert_eq!(db.get_note("plain").unwrap().unwrap().title, "t");
        cleanup(&path);
    }
}
