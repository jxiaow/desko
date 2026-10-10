use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::TunnelService;

const COLS: &str = "id, hostname, port, label, preset, routed, public_password_sha256, public_read_only, created_at, updated_at";

impl Database {
    fn row_to_tunnel_service(row: &rusqlite::Row) -> rusqlite::Result<TunnelService> {
        Ok(TunnelService {
            id: row.get(0)?,
            hostname: row.get(1)?,
            port: row.get(2)?,
            label: row.get(3)?,
            preset: row.get(4)?,
            routed: row.get::<_, i64>(5)? != 0,
            public_password_sha256: row.get(6)?,
            public_read_only: row.get::<_, i64>(7)? != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }

    /// 登记顺序 = ingress 规则顺序：生成的 config.yml 逐条比对应保持稳定，
    /// 否则一次无关的改动会让整份配置在外观上重写一遍
    pub fn list_tunnel_services(&self) -> Result<Vec<TunnelService>, AppError> {
        let sql = format!("SELECT {COLS} FROM tunnel_services ORDER BY created_at ASC, hostname ASC");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], Self::row_to_tunnel_service)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_tunnel_service(&self, id: &str) -> Result<Option<TunnelService>, AppError> {
        let sql = format!("SELECT {COLS} FROM tunnel_services WHERE id = ?1");
        match self.conn.query_row(&sql, params![id], Self::row_to_tunnel_service) {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn get_tunnel_service_by_hostname(&self, hostname: &str) -> Result<Option<TunnelService>, AppError> {
        let sql = format!("SELECT {COLS} FROM tunnel_services WHERE hostname = ?1");
        match self.conn.query_row(&sql, params![hostname], Self::row_to_tunnel_service) {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create_tunnel_service(&self, s: &TunnelService) -> Result<(), AppError> {
        self.conn.execute(
            &format!("INSERT INTO tunnel_services ({COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)"),
            params![
                s.id,
                s.hostname,
                s.port,
                s.label,
                s.preset,
                s.routed as i64,
                s.public_password_sha256,
                s.public_read_only as i64,
                s.created_at,
                s.updated_at
            ],
        )?;
        Ok(())
    }

    /// 整条覆盖（子域、端口、名字都可改），建档时间不动。
    /// 公网策略不走这条路——改个子域不该把口令顺带清了
    pub fn update_tunnel_service(&self, s: &TunnelService) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE tunnel_services SET hostname=?2, port=?3, label=?4, preset=?5, updated_at=?6 WHERE id=?1",
            params![s.id, s.hostname, s.port, s.label, s.preset, s.updated_at],
        )?;
        Ok(())
    }

    /// 只改公网策略（口令摘要 + 只读位）。空摘要 = 不设公网口令。
    /// 单独一条语句，不并进整条覆盖：改子域/端口不该把口令顺带清了。
    /// 和 routed 同属状态位，不动 updated_at
    pub fn set_tunnel_service_policy(
        &self,
        id: &str,
        password_sha256: &str,
        read_only: bool,
    ) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE tunnel_services SET public_password_sha256=?2, public_read_only=?3 WHERE id=?1",
            params![id, password_sha256, read_only as i64],
        )?;
        Ok(())
    }

    /// 只是状态位（DNS 指没指过来），不算一次编辑，所以不动 updated_at
    pub fn set_tunnel_service_routed(&self, id: &str, routed: bool) -> Result<(), AppError> {
        self.conn.execute(
            "UPDATE tunnel_services SET routed=?2 WHERE id=?1",
            params![id, routed as i64],
        )?;
        Ok(())
    }

    pub fn delete_tunnel_service(&self, id: &str) -> Result<(), AppError> {
        self.conn.execute("DELETE FROM tunnel_services WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{cleanup, setup_test_db};

    fn service(id: &str, hostname: &str, port: i64) -> TunnelService {
        TunnelService {
            id: id.to_string(),
            hostname: hostname.to_string(),
            port,
            label: hostname.to_string(),
            preset: String::new(),
            routed: false,
            public_password_sha256: String::new(),
            public_read_only: true,
            created_at: 100,
            updated_at: 100,
        }
    }

    #[test]
    fn services_keep_registration_order() {
        let (db, path) = setup_test_db();
        // 建档时间决定 ingress 顺序，晚登记的子域字母序在前也不能插队
        for (i, (id, host, port)) in [
            ("s1", "z.example.com", 3003),
            ("s2", "a.example.com", 3001),
            ("s3", "m.example.com", 3002),
        ]
        .iter()
        .enumerate()
        {
            let mut s = service(id, host, *port);
            s.created_at = 100 + i as i64;
            db.create_tunnel_service(&s).unwrap();
        }

        let list = db.list_tunnel_services().unwrap();
        assert_eq!(
            list.iter().map(|s| s.hostname.as_str()).collect::<Vec<_>>(),
            vec!["z.example.com", "a.example.com", "m.example.com"]
        );
        cleanup(&path);
    }

    #[test]
    fn hostname_is_unique() {
        let (db, path) = setup_test_db();
        db.create_tunnel_service(&service("s1", "files.example.com", 8421)).unwrap();
        let dup = db.create_tunnel_service(&service("s2", "files.example.com", 9000));
        assert!(dup.is_err(), "一个子域只能指一个端口，否则 ingress 自己就冲突了");

        // 换个端口不冲突
        db.create_tunnel_service(&service("s3", "dbg.example.com", 9229)).unwrap();
        assert_eq!(db.list_tunnel_services().unwrap().len(), 2);
        cleanup(&path);
    }

    #[test]
    fn routed_flag_survives_the_round_trip() {
        let (db, path) = setup_test_db();
        db.create_tunnel_service(&service("s1", "files.example.com", 8421)).unwrap();
        assert!(!db.get_tunnel_service("s1").unwrap().unwrap().routed);

        db.set_tunnel_service_routed("s1", true).unwrap();
        assert!(db.get_tunnel_service_by_hostname("files.example.com").unwrap().unwrap().routed);

        db.set_tunnel_service_routed("s1", false).unwrap();
        assert!(!db.get_tunnel_service("s1").unwrap().unwrap().routed);
        cleanup(&path);
    }

    #[test]
    fn update_can_move_a_service_to_another_port() {
        let (db, path) = setup_test_db();
        db.create_tunnel_service(&service("s1", "files.example.com", 8421)).unwrap();
        let mut s = db.get_tunnel_service("s1").unwrap().unwrap();
        s.port = 8500;
        s.hostname = "share.example.com".to_string();
        s.label = "传输改端口".to_string();
        db.update_tunnel_service(&s).unwrap();

        let got = db.get_tunnel_service("s1").unwrap().unwrap();
        assert_eq!((got.hostname.as_str(), got.port), ("share.example.com", 8500));
        assert_eq!(got.created_at, 100, "改端口不该动建档时间");
        // 旧子域腾空，可以再登记
        assert!(db.get_tunnel_service_by_hostname("files.example.com").unwrap().is_none());
        cleanup(&path);
    }

    #[test]
    fn editing_host_or_port_keeps_the_public_policy() {
        let (db, path) = setup_test_db();
        db.create_tunnel_service(&service("s1", "files.example.com", 8421)).unwrap();
        db.set_tunnel_service_policy("s1", "deadbeef", false).unwrap();

        let mut s = db.get_tunnel_service("s1").unwrap().unwrap();
        assert_eq!((s.public_password_sha256.as_str(), s.public_read_only), ("deadbeef", false));
        s.hostname = "share.example.com".to_string();
        s.port = 8500;
        db.update_tunnel_service(&s).unwrap();

        let got = db.get_tunnel_service("s1").unwrap().unwrap();
        assert_eq!(got.public_password_sha256, "deadbeef", "改子域不该把公网口令顺带清了");
        assert!(!got.public_read_only);

        // 空摘要 = 不设口令，能正常落回去
        db.set_tunnel_service_policy("s1", "", true).unwrap();
        let cleared = db.get_tunnel_service("s1").unwrap().unwrap();
        assert!(cleared.public_password_sha256.is_empty());
        assert!(cleared.public_read_only);
        cleanup(&path);
    }

    #[test]
    fn delete_removes_only_that_row() {
        let (db, path) = setup_test_db();
        db.create_tunnel_service(&service("s1", "a.example.com", 3001)).unwrap();
        db.create_tunnel_service(&service("s2", "b.example.com", 3002)).unwrap();
        db.delete_tunnel_service("s1").unwrap();

        let list = db.list_tunnel_services().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].hostname, "b.example.com");
        cleanup(&path);
    }
}
