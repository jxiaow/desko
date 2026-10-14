use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::BypassTarget;

const COLS: &str = "id, host, input, kind, port, path, scheme, address, interface_name, next_hop, \
     verdict, stale, cdn_like, note, apply_state, apply_batch, created_at, updated_at, checked_at";

impl Database {
    fn row_to_bypass_target(row: &rusqlite::Row) -> rusqlite::Result<BypassTarget> {
        Ok(BypassTarget {
            id: row.get(0)?,
            host: row.get(1)?,
            input: row.get(2)?,
            kind: row.get(3)?,
            port: row.get(4)?,
            path: row.get(5)?,
            scheme: row.get(6)?,
            address: row.get(7)?,
            interface_name: row.get(8)?,
            next_hop: row.get(9)?,
            verdict: row.get(10)?,
            stale: row.get::<_, i64>(11)? != 0,
            cdn_like: row.get::<_, i64>(12)? != 0,
            note: row.get(13)?,
            apply_state: row.get(14)?,
            apply_batch: row.get(15)?,
            created_at: row.get(16)?,
            updated_at: row.get(17)?,
            checked_at: row.get(18)?,
        })
    }

    pub fn list_bypass_targets(&self) -> Result<Vec<BypassTarget>, AppError> {
        let sql = format!("SELECT {COLS} FROM bypass_targets ORDER BY updated_at DESC");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::row_to_bypass_target)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn bypass_target_by_id(&self, id: &str) -> Result<Option<BypassTarget>, AppError> {
        let sql = format!("SELECT {COLS} FROM bypass_targets WHERE id = ?1");
        let mut stmt = self.conn.prepare(&sql)?;
        let found = stmt
            .query_map(params![id], Self::row_to_bypass_target)?
            .filter_map(|r| r.ok())
            .next();
        Ok(found)
    }

    /// 落盘结果单独回写：不动判定、不动探测时间，只记"这批写过了"
    pub fn set_bypass_apply_state(
        &self,
        id: &str,
        state: &str,
        batch: &str,
        now_ms: i64,
    ) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE bypass_targets SET apply_state=?2, apply_batch=?3, updated_at=?4 WHERE id=?1",
            params![id, state, batch, now_ms],
        )?;
        Ok(())
    }

    /// 同一 host 只留一条：重探覆盖判定与地址，建档时间不动
    pub fn upsert_bypass_target(&self, target: &BypassTarget) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO bypass_targets (id, host, input, kind, port, path, scheme, address, \
             interface_name, next_hop, verdict, stale, cdn_like, note, apply_state, apply_batch, \
             created_at, updated_at, checked_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19) \
             ON CONFLICT(host) DO UPDATE SET id=?1, input=?3, kind=?4, port=?5, path=?6, scheme=?7, address=?8, \
             interface_name=?9, next_hop=?10, verdict=?11, stale=?12, cdn_like=?13, note=?14, \
             apply_state=?15, apply_batch=?16, updated_at=?18, checked_at=?19",
            params![
                target.id,
                target.host,
                target.input,
                target.kind,
                target.port,
                target.path,
                target.scheme,
                target.address,
                target.interface_name,
                target.next_hop,
                target.verdict,
                target.stale as i64,
                target.cdn_like as i64,
                target.note,
                target.apply_state,
                target.apply_batch,
                target.created_at,
                target.updated_at,
                target.checked_at
            ],
        )?;
        Ok(())
    }

    pub fn delete_bypass_target(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM bypass_targets WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// 原地更新，不通过 upsert 重建已经被删除的条目。
    pub fn update_bypass_target(&self, t: &BypassTarget) -> Result<(), AppError> {
        let changed = self.conn.execute(
            "UPDATE bypass_targets SET host=?2, input=?3, kind=?4, port=?5, path=?6, scheme=?7, \
             address=?8, interface_name=?9, next_hop=?10, verdict=?11, stale=?12, cdn_like=?13, \
             note=?14, apply_state=?15, apply_batch=?16, updated_at=?17, checked_at=?18 WHERE id=?1",
            params![t.id, t.host, t.input, t.kind, t.port, t.path, t.scheme, t.address,
                t.interface_name, t.next_hop, t.verdict, t.stale as i64, t.cdn_like as i64,
                t.note, t.apply_state, t.apply_batch, t.updated_at, t.checked_at],
        )?;
        if changed == 0 {
            return Err(AppError::Bypass("条目不存在，可能已被删除".to_string()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{cleanup, setup_test_db};

    fn target(id: &str, host: &str, input: &str, address: &str, verdict: &str) -> BypassTarget {
        BypassTarget {
            id: id.to_string(),
            host: host.to_string(),
            input: input.to_string(),
            kind: "domain".to_string(),
            port: 443,
            path: String::new(),
            scheme: "https".to_string(),
            address: address.to_string(),
            interface_name: String::new(),
            next_hop: String::new(),
            verdict: verdict.to_string(),
            stale: false,
            cdn_like: false,
            note: String::new(),
            apply_state: "none".to_string(),
            apply_batch: String::new(),
            created_at: 100,
            updated_at: 200,
            checked_at: 200,
        }
    }

    #[test]
    fn upsert_keeps_one_row_per_host() {
        let (db, path) = setup_test_db();
        db.upsert_bypass_target(&target("a", "example.com", "example.com", "1.1.1.1", "directOk"))
            .unwrap();
        db.upsert_bypass_target(&target("b", "example.com", "example.com", "2.2.2.2", "directOk"))
            .unwrap();

        let list = db.list_bypass_targets().unwrap();
        assert_eq!(list.len(), 1, "同一 host 只能留一行");
        assert_eq!(list[0].id, "b", "后一次 upsert 的 id 应覆盖旧行");
        assert_eq!(list[0].address, "2.2.2.2");
        cleanup(&path);
    }

    #[test]
    fn upsert_preserves_created_at() {
        let (db, path) = setup_test_db();
        db.upsert_bypass_target(&target("a", "example.com", "example.com", "1.1.1.1", "directOk"))
            .unwrap();
        let mut later = target("a", "example.com", "example.com", "2.2.2.2", "directOk");
        later.created_at = 999;
        later.updated_at = 300;
        db.upsert_bypass_target(&later).unwrap();

        let got = db.list_bypass_targets().unwrap().pop().unwrap();
        assert_eq!(got.created_at, 100, "upsert 不改建档时间");
        assert_eq!(got.updated_at, 300);
        cleanup(&path);
    }

    #[test]
    fn editing_updates_in_place_and_a_collision_keeps_both_rows() {
        let (db, path) = setup_test_db();
        let mut a = target("a", "first.example.com", "first.example.com", "10.0.0.1", "hostsOnly");
        db.upsert_bypass_target(&a).unwrap();
        db.upsert_bypass_target(&target("b", "second.example.com", "second.example.com", "10.0.0.2", "directOk")).unwrap();
        a.host = "renamed.example.com".into();
        a.input = "HTTP://renamed.example.com:8080/Path?Key=AbC".into();
        a.apply_batch = "batch1".into();
        db.update_bypass_target(&a).unwrap();
        let saved = db.bypass_target_by_id("a").unwrap().unwrap();
        assert_eq!(saved.host, "renamed.example.com");
        assert_eq!(saved.apply_batch, "batch1");
        assert_eq!(saved.created_at, 100);
        a.host = "second.example.com".into();
        assert!(db.update_bypass_target(&a).is_err());
        assert_eq!(db.list_bypass_targets().unwrap().len(), 2);
        assert_eq!(db.bypass_target_by_id("a").unwrap().unwrap().host, "renamed.example.com");
        db.delete_bypass_target("a").unwrap();
        a.host = "renamed.example.com".into();
        assert!(db.update_bypass_target(&a).is_err());
        assert!(db.bypass_target_by_id("a").unwrap().is_none());
        cleanup(&path);
    }
}
