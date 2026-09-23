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

    /// 上锁：密文入库，明文列（title/content_html/category）当场清空
    pub fn set_note_lock(
        &self,
        id: &str,
        cipher: &str,
        cipher_iv: &str,
        wrap_pass: &str,
        pass_salt: &str,
        wrap_master: &str,
        updated_at: i64,
    ) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET enc = 1, cipher = ?2, cipher_iv = ?3, wrap_pass = ?4, pass_salt = ?5, wrap_master = ?6, title = '', content_html = '', category = '', updated_at = ?7 WHERE id = ?1",
            params![id, cipher, cipher_iv, wrap_pass, pass_salt, wrap_master, updated_at],
        )?;
        Ok(())
    }

    /// 编辑已加密小记：只换密文，明文列保持清空
    pub fn update_note_cipher(&self, id: &str, cipher: &str, cipher_iv: &str, updated_at: i64) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE notes SET cipher = ?2, cipher_iv = ?3, updated_at = ?4 WHERE id = ?1 AND enc = 1",
            params![id, cipher, cipher_iv, updated_at],
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

    /// 改主密码时重封 DEK 用：所有加密行的 (id, wrap_master)
    pub fn list_note_wrap_masters(&self) -> Result<Vec<(String, String)>, AppError> {
        let mut stmt = self.conn.prepare("SELECT id, wrap_master FROM notes WHERE enc = 1")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
