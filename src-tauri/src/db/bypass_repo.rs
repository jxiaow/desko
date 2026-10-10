use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::BypassTarget;

const COLS: &str = "id, host, input, kind, port, path, scheme, address, interface_name, next_hop, \
     verdict, stale, note, created_at, updated_at, checked_at";

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
            note: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
            checked_at: row.get(15)?,
        })
    }

    pub fn list_bypass_targets(&self) -> Result<Vec<BypassTarget>, AppError> {
        let sql = format!("SELECT {COLS} FROM bypass_targets ORDER BY updated_at DESC");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::row_to_bypass_target)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// 同一 host 只留一条：重探覆盖判定与地址，建档时间不动
    pub fn upsert_bypass_target(&self, target: &BypassTarget) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO bypass_targets (id, host, input, kind, port, path, scheme, address, \
             interface_name, next_hop, verdict, stale, note, created_at, updated_at, checked_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16) \
             ON CONFLICT(host) DO UPDATE SET id=?1, input=?3, kind=?4, port=?5, path=?6, scheme=?7, address=?8, \
             interface_name=?9, next_hop=?10, verdict=?11, stale=?12, note=?13, updated_at=?15, checked_at=?16",
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
                target.note,
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
            note: String::new(),
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
}
