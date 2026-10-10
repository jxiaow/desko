use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;

use crate::backup::{self, container::Wrap};
use crate::crypto::{self, EncryptedData};
use crate::db::Database;
use crate::error::AppError;

/// 密钥包裹块（kdf_salt + kek_nonce + wrapped_dek，76 字节，非机密）。
/// 校验备份密码靠"用它能不能取出 DEK"，不需要额外的校验位。
pub const META_WRAP: &str = "backup_wrap";
/// 数据密钥 DEK，用主密钥封存（退出自动备份要靠它，无需输密码）
pub const META_KEY: &str = "backup_key";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub has_password: bool,
    /// 定时备份间隔（分钟），0 = 关
    pub interval_min: i64,
    /// 实时备份：写入平息 8 秒后补一轮
    pub realtime: bool,
    /// 还没传上云的份数（包 + 附件密文）
    pub pending: usize,
    /// 最近一轮打包的时刻，0 = 还没有
    pub last_round_at: i64,
    /// 云端已配置 —— 标题栏备份徽标的显示前提
    pub cloud_configured: bool,
    /// 是否正有一轮备份在跑（手动或定时共用同一把闸）
    pub busy: bool,
}

fn read_wrap(db: &Database) -> Result<Option<Wrap>, AppError> {
    match db.get_meta(META_WRAP)? {
        Some(b64) if !b64.is_empty() => Ok(Some(Wrap::from_bytes(
            &BASE64.decode(&b64).map_err(|e| AppError::Crypto(e.to_string()))?,
        )?)),
        _ => Ok(None),
    }
}

/// 当前使用的密钥包裹块（备份时要抄进新包头部）
pub fn current_wrap(db: &Database) -> Result<Wrap, AppError> {
    read_wrap(db)?.ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))
}

pub fn wrap_backup_key(db: &Database, master_key: &[u8], dek: &[u8]) -> Result<(), AppError> {
    let sealed = crypto::encrypt_password(&BASE64.encode(dek), master_key)?;
    db.set_meta(META_KEY, &serde_json::to_string(&sealed).map_err(|e| AppError::Crypto(e.to_string()))?)
}

pub fn unwrap_backup_key(db: &Database, master_key: &[u8]) -> Result<Option<Vec<u8>>, AppError> {
    let Some(json) = db.get_meta(META_KEY)? else {
        return Ok(None);
    };
    if json.is_empty() {
        return Ok(None);
    }
    let sealed: EncryptedData = serde_json::from_str(&json).map_err(|e| AppError::Crypto(e.to_string()))?;
    let b64 = crypto::decrypt_password(&sealed, master_key)?;
    Ok(Some(BASE64.decode(&b64).map_err(|e| AppError::Crypto(e.to_string()))?))
}

/// 设置或修改备份密码。
/// 数据密钥 DEK 全程不变：改密码只是把它用新口令重新包一遍，已有备份照样能解。
/// 返回 (DEK, 新包裹块, 是否改了密码)。改了密码调用方必须把磁盘上的头部换一遍。
pub fn set_backup_password(
    db: &Database,
    master_key: &[u8],
    password: &str,
) -> Result<(Vec<u8>, Wrap, bool), AppError> {
    // 按字符数而非字节数：中文口令一个字符三个字节
    if password.chars().count() < 8 {
        return Err(AppError::Backup("备份密码至少 8 位".to_string()));
    }
    let existing = unwrap_backup_key(db, master_key)?;
    let changed = existing.is_some();
    let dek = match existing {
        Some(dek) => dek,
        None => crypto::random_bytes(crate::backup::container::DEK_LEN),
    };
    let wrap = Wrap::seal(&dek, password)?;
    db.set_meta(META_WRAP, &BASE64.encode(wrap.to_bytes()))?;
    wrap_backup_key(db, master_key, &dek)?;
    Ok((dek, wrap, changed))
}

pub fn status(db: &Database, app_data_dir: &std::path::Path, busy: bool) -> Result<BackupStatus, AppError> {
    let backups = backup::backups_dir(app_data_dir);
    let packages = backup::list_packages(&backups);
    Ok(BackupStatus {
        has_password: read_wrap(db).ok().flatten().is_some(),
        interval_min: super::auto_backup::interval_min(db),
        realtime: super::auto_backup::realtime_on(db),
        pending: super::cloud_service::pending_count(&backups),
        // 包名自带时间戳、mtime 就是写完那一刻，最新那个包即最近一轮
        last_round_at: packages.first().map(|p| p.2).unwrap_or(0),
        cloud_configured: super::cloud_service::configured(db),
        busy,
    })
}

#[cfg(test)]
mod key_lifecycle_tests {
    use super::*;
    use crate::crypto::KEY_LENGTH;
    use crate::db::Database;
    use crate::services::auth_service;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("desko_key_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn fresh_db(path: &str) -> Database {
        Database::new(path).unwrap()
    }

    fn make_package(root: &std::path::Path, db_file: &str, dek: &[u8], wrap: &Wrap) -> String {
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        std::fs::write(att.join("u1__p.png"), b"img-bytes").unwrap();
        let backups = backup::backups_dir(root);
        backup::create_package(db_file, &att, &backups, dek, wrap, "t", &|_, _| {})
            .unwrap()
            .name
    }

    /// 换备份密码：DEK 不变，旧包换头后照样能解，旧密码立刻失效
    #[test]
    fn changing_backup_password_keeps_packages_readable() {
        let root = tmp("rotate");
        let db_file = root.join("data.db");
        let path = db_file.to_str().unwrap().to_string();
        let db = fresh_db(&path);
        let master = vec![7u8; KEY_LENGTH];

        let (dek, wrap, changed) = set_backup_password(&db, &master, "first-backup-pw").unwrap();
        assert!(!changed);
        let name = make_package(&root, &path, &dek, &wrap);
        let backups = backup::backups_dir(&root);
        let pkg = backups.join(&name);
        let enc = backups.join("attachments").join("u1__p.png.enc");

        let (dek2, wrap2, changed) = set_backup_password(&db, &master, "second-backup-pw").unwrap();
        assert!(changed);
        assert_eq!(dek, dek2, "数据密钥不该跟着密码换");
        assert_eq!(backup::rewrap_all(&backups, &wrap2), (2, vec![]));

        assert!(container_unpack(&pkg, &dek2).is_ok(), "换密码后包必须还能解");
        assert!(container_unpack(&enc, &dek2).is_ok(), "附件密文同理");
        assert!(wrap2.open("first-backup-pw").is_err(), "旧密码必须失效");
        assert!(wrap2.open("second-backup-pw").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn container_unpack(p: &std::path::Path, dek: &[u8]) -> Result<Vec<u8>, AppError> {
        backup::container::unpack(p, dek)
    }

    /// 备份包是点名装箱：库快照 + 清单里那些附件，其余目录根本不进视野。
    /// 穿透凭据一旦进包 = 把公网入口的钥匙交给云端，而云端密文永不删 —— 这条边界得有测试守着。
    #[test]
    fn package_holds_nothing_beyond_the_db_and_listed_attachments() {
        let root = tmp("scope");
        let path = root.join("data.db");
        let db = fresh_db(path.to_str().unwrap());
        let master = vec![3u8; KEY_LENGTH];
        let (dek, wrap, _) = set_backup_password(&db, &master, "backup-pw").unwrap();

        // 与 tunnel_service 的目录树同形：凭据、配置、二进制都摆在档案根里
        let cf = root.join("tunnel").join("cf");
        std::fs::create_dir_all(&cf).unwrap();
        std::fs::write(cf.join("tun-1.json"), br#"{"AccountTag":"let-me-out"}"#).unwrap();
        std::fs::write(root.join("tunnel").join("config.yml"), b"ingress: local").unwrap();

        let name = make_package(&root, path.to_str().unwrap(), &dek, &wrap);
        let pkg = backup::backups_dir(&root).join(&name);
        let zip_bytes = backup::container::unpack(&pkg, &dek).unwrap();
        let reader = zip::ZipArchive::new(std::io::Cursor::new(&zip_bytes)).unwrap();
        let names: Vec<String> = reader.file_names().map(|s| s.to_string()).collect();
        assert_eq!(
            names,
            vec!["manifest.json".to_string(), "data.db".to_string()],
            "包里多了别的条目：档案根下的其它目录会被一起带走"
        );
        assert!(!String::from_utf8_lossy(&zip_bytes).contains("let-me-out"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 新机器/重装后：本地什么都没设，光凭包 + 备份密码就能取出数据密钥
    #[test]
    fn fresh_machine_can_restore_from_package_alone() {
        let root = tmp("fresh");
        let path = root.join("data.db");
        let db = fresh_db(path.to_str().unwrap());
        let master = vec![9u8; KEY_LENGTH];
        let (dek, wrap, _) = set_backup_password(&db, &master, "my-backup-pw").unwrap();
        let name = make_package(&root, path.to_str().unwrap(), &dek, &wrap);

        // 另一台机器：全新的库，什么 meta 都没有
        let other = tmp("other");
        let other_db = fresh_db(other.join("data.db").to_str().unwrap());
        assert!(current_wrap(&other_db).is_err(), "新机器本地没有包裹块");

        let pkg = backup::backups_dir(&root).join(&name);
        let recovered = backup::container::derive_dek(&pkg, "my-backup-pw").unwrap();
        assert_eq!(recovered, dek, "只靠包头部 + 密码就该还原出数据密钥");
        assert!(backup::container::unpack(&pkg, &recovered).is_ok());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&other);
    }

    /// 恢复旧库之后，内存里的主密钥与恢复出来的库不再配对 —— 必须清掉重来
    #[test]
    fn restore_after_master_password_change_breaks_key_chain() {
        let root = tmp("chain");
        let db_file = root.join("data.db");
        let path = db_file.to_str().unwrap().to_string();

        let mut mk: Option<Vec<u8>> = None;
        let db = fresh_db(&path);
        auth_service::setup_master_password(&db, &mut mk, "master-A").unwrap();
        let master_a = mk.clone().unwrap();

        let (dek, wrap, _) = set_backup_password(&db, &master_a, "backup-pw-123").unwrap();
        let name = make_package(&root, &path, &dek, &wrap);

        // 备份之后用户改了主密码 A -> B
        let master_b =
            auth_service::change_master_password(&db, &master_a, "master-A", "master-B").unwrap();
        assert_ne!(master_a, master_b);

        let pkg = backup::backups_dir(&root).join(&name);
        let zip_bytes = backup::container::unpack(&pkg, &dek).unwrap();
        let staging = backup::staging_dir(&root);
        backup::container::extract_to(&zip_bytes, &staging).unwrap();

        // 换库之后，进程仍持着 B 主密钥
        let restored = fresh_db(staging.join("data.db").to_str().unwrap());
        let with_b = unwrap_backup_key(&restored, &master_b);
        assert!(
            with_b.is_err(),
            "现状：恢复后封存密钥仍是备份当时的主密钥封的，当前主密钥解不开"
        );
        assert_eq!(
            unwrap_backup_key(&restored, &master_a).unwrap(),
            Some(dek),
            "换回备份当时的主密码才取得出 DEK"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 弱口令闸门
    #[test]
    fn short_backup_password_rejected() {
        let root = tmp("weak");
        let db = fresh_db(root.join("data.db").to_str().unwrap());
        let master = vec![1u8; KEY_LENGTH];
        assert!(set_backup_password(&db, &master, "1234567").is_err());
        assert!(set_backup_password(&db, &master, "一二三四五").is_err());
        assert!(set_backup_password(&db, &master, "一二三四五六七八").is_ok(), "中文按字符计长");
        let _ = std::fs::remove_dir_all(&root);
    }
}
