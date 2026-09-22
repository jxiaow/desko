pub mod container;

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};
use rusqlite::Connection;
use serde::Serialize;

use crate::error::AppError;

pub use container::{Counts, Manifest};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PackageInfo {
    pub name: String,
    pub time: i64,
    pub size: i64,
    pub attachments: Option<i64>,
}

pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

pub fn staging_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("restore-staging")
}

/// 包名带秒级时间戳，同分钟两次备份也不会撞
pub fn package_name(ts_ms: i64) -> Result<String, AppError> {
    let dt = DateTime::<Local>::from(
        chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts_ms)
            .ok_or_else(|| AppError::Backup("无效时间戳".to_string()))?,
    );
    Ok(format!("desko-{}.dsbk", dt.format("%Y%m%d-%H%M%S")))
}

/// 时间戳只到秒。串行闸挡住了并发，但挡不住"上一秒刚打完、这一秒又点一次"：
/// 写包是原子改名，同名会把上一个包直接覆盖掉，等于悄悄少一份备份。撞名就往后挪一秒。
fn unique_package_name(backups: &Path, ts_ms: i64) -> Result<String, AppError> {
    let mut ts = ts_ms;
    for _ in 0..120 {
        let name = package_name(ts)?;
        if !backups.join(&name).exists() {
            return Ok(name);
        }
        ts += 1000;
    }
    Err(AppError::Backup("备份目录里同名的包太多，取不出新包名".to_string()))
}

/// 包名只允许 `desko-<时间>.dsbk`，不含任何路径成分（点本身是合法的，别误判）
pub fn is_package(name: &str) -> bool {
    name.starts_with("desko-")
        && name.ends_with(".dsbk")
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

/// 按时间倒序列出备份包（文件名即时间，字典序=时间序）
pub fn list_packages(dir: &Path) -> Vec<(String, PathBuf, i64, i64)> {
    let mut out: Vec<(String, PathBuf, i64, i64)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !is_package(&name) {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let time = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push((name, entry.path(), time, meta.len() as i64));
        }
    }
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

/// 本地只是"还没传上云的中转区"，传成功的包当轮就删，只留最近这么几份兜底
/// （云端那份被误删、账号没了，还能往回退几步）
pub const LOCAL_FLOOR: usize = 3;

/// 收拾本地备份包。`uploaded` = 同步记录里确认已在云端的那些包名。
///
/// 不在记录里的一份都不动 —— 那是唯一副本，删了就真没了。超出兜底份数、
/// 又已经躺在云端的，才是可以删的。
pub fn prune(dir: &Path, uploaded: &[String]) {
    for (i, (name, path, _, _)) in list_packages(dir).iter().enumerate() {
        if i < LOCAL_FLOOR {
            continue;
        }
        if uploaded.iter().any(|n| n == name) {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// 回收没人要的附件密文：明文已经被清理掉、又没有任何留在本地的包引用它，
/// 那这几十 MB 就是纯死重量。
///
/// `uploaded` = 同步记录里已上传的附件名。还没传上去的不能删 —— 云端那份包
/// 恢复时要按清单来取密文，删了就缺一块。返回删掉的个数。
pub fn reclaim_enc(backups: &Path, attachments_dir: &Path, dek: &[u8], uploaded: &[String]) -> usize {
    let enc_dir = backups.join("attachments");
    // 还留在本地的包引用了哪些附件。包只有几 KB，逐个解头部读清单很便宜
    let mut referenced: Vec<String> = Vec::new();
    for (_, path, _, _) in list_packages(backups) {
        if let Ok(m) = container::read_manifest(&path, dek) {
            referenced.extend(m.files.into_iter().map(|f| f.name));
        }
    }
    let mut removed = 0;
    if let Ok(rd) = std::fs::read_dir(&enc_dir) {
        for e in rd.flatten() {
            let path = e.path();
            let file = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            // 目录里还住着 .hash-cache.json 之类的 sidecar，只认 .enc
            let Some(name) = file.strip_suffix(".enc") else { continue };
            if attachments_dir.join(name).exists() {
                continue; // 明文还在，下一轮备份还要用它
            }
            if referenced.iter().any(|n| n == name) {
                continue;
            }
            if !uploaded.iter().any(|n| n == name) {
                continue;
            }
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

/// 换备份密码后，把磁盘上所有包和附件密文的头部换成新包裹。
/// 定长头部、原地改写，密文不动，所以几百个文件也只是几百次小写。
/// 解不开的（旧格式、损坏）跳过并计数：一颗坏文件不该让整批换头中断，
/// 否则排在它后面的附件密文会全部留在旧包裹下，换完密码就再也解不开。
pub fn rewrap_all(backups: &Path, wrap: &container::Wrap) -> (usize, Vec<String>) {
    let mut paths: Vec<PathBuf> = list_packages(backups).into_iter().map(|(_, p, _, _)| p).collect();
    if let Ok(rd) = std::fs::read_dir(backups.join("attachments")) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() && p.extension().map(|x| x == "enc").unwrap_or(false) {
                paths.push(p);
            }
        }
    }
    let mut done = 0;
    let mut skipped = Vec::new();
    for p in paths {
        match container::rewrap(&p, wrap) {
            Ok(_) => done += 1,
            Err(e) => {
                eprintln!("换写备份头已跳过 {}: {}", p.display(), e);
                skipped.push(p.file_name().unwrap_or_default().to_string_lossy().to_string());
            }
        }
    }
    (done, skipped)
}

/// 用 SQLite 官方备份接口导出一致性快照（WAL 下直接拷文件会拿到半截库）
fn snapshot_db(db_path: &str, tmp_file: &Path) -> Result<Counts, AppError> {
    let _ = std::fs::remove_file(tmp_file);
    let src = Connection::open(db_path)?;
    let counts = Counts {
        notes: src.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))?,
        entries: src.query_row("SELECT COUNT(*) FROM entries", [], |r| r.get(0))?,
        attachments: src.query_row("SELECT COUNT(*) FROM note_attachments", [], |r| r.get(0))?,
    };
    src.backup(rusqlite::DatabaseName::Main, tmp_file, None)?;
    drop(src);
    Ok(counts)
}

/// 附件 sha 缓存：文件名 → (大小, 修改时间, sha256)。
/// 放 sidecar 而不是库里，因为备份时写库会改动 data.db 的 mtime，
/// 让"数据有没有变"的判定永远为真，变成自己勾引自己的死循环。
#[derive(Serialize, serde::Deserialize, Default)]
pub struct HashCache(
    std::collections::BTreeMap<String, (i64, i64, String)>,
);

const HASH_CACHE_FILE: &str = ".hash-cache.json";

/// 数据变更指纹：库（含 -wal）与附件目录的 mtime/大小，只 stat 不读内容。
/// 同样只存在后台线程的局部变量里，不写库、不写文件：写库会改动 data.db，
/// 让"数据有没有变"永远判定为真，变成自己勾引自己的死循环。
pub fn fingerprint(db_path: &str, attachments_dir: &Path) -> String {
    fn stat_of(p: &Path) -> String {
        match std::fs::metadata(p) {
            Ok(m) => format!(
                "{}:{}",
                m.len(),
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            ),
            Err(_) => "-".to_string(),
        }
    }
    let db = Path::new(db_path);
    let mut s = format!(
        "db={}|wal={}",
        stat_of(db),
        stat_of(&db.with_extension("db-wal"))
    );
    if let Ok(rd) = std::fs::read_dir(attachments_dir) {
        let mut items: Vec<String> = Vec::new();
        for e in rd.flatten() {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    items.push(format!("{}:{}", e.file_name().to_string_lossy(), m.len()));
                }
            }
        }
        items.sort();
        s.push_str("|att=");
        s.push_str(&items.join(","));
    }
    s
}

fn load_hash_cache(path: &Path) -> HashCache {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_hash_cache(path: &Path, cache: &HashCache) {
    if let Ok(json) = serde_json::to_vec(cache) {
        let _ = std::fs::write(path, json);
    }
}

/// 列出附件并算 sha，命中缓存的不读文件
fn inventory_attachments(
    dir: &Path,
    cache_path: &Path,
) -> Result<Vec<container::FileEntry>, AppError> {
    let mut cache = load_hash_cache(cache_path);
    let mut files: Vec<container::FileEntry> = Vec::new();
    if dir.exists() {
        let mut paths: Vec<_> = std::fs::read_dir(dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        paths.sort();
        let mut seen: Vec<String> = Vec::with_capacity(paths.len());
        for p in paths {
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            let meta = p.metadata()?;
            let size = meta.len() as i64;
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let hit = cache.0.get(&name).filter(|(s, m, _)| *s == size && *m == mtime);
            let sha = match hit {
                Some((_, _, sha)) => sha.clone(),
                None => {
                    let bytes = std::fs::read(&p)?;
                    let sha = container::sha256_hex(&bytes);
                    cache.0.insert(name.clone(), (size, mtime, sha.clone()));
                    sha
                }
            };
            seen.push(name.clone());
            files.push(container::FileEntry { name, size, sha256: sha });
        }
        // 文件已经不在了就把缓存条目清掉，别让表无限长
        cache.0.retain(|k, _| seen.iter().any(|n| n == k));
    }
    save_hash_cache(cache_path, &cache);
    Ok(files)
}

#[allow(clippy::too_many_arguments)]
pub fn create_package(
    db_path: &str,
    attachments_dir: &Path,
    backups: &Path,
    dek: &[u8],
    wrap: &container::Wrap,
    app_version: &str,
    progress: &dyn Fn(&str, u8),
) -> Result<PackageInfo, AppError> {
    std::fs::create_dir_all(backups)?;
    let tmp = backups.join("snapshot.tmp.db");
    let _ = std::fs::remove_file(&tmp);
    progress("导出库快照", 8);
    let counts = snapshot_db(db_path, &tmp)?;

    // 附件清单：名字/大小/sha256（v2 包里不再装附件本体）
    let enc_dir = backups.join("attachments");
    std::fs::create_dir_all(&enc_dir)?;
    let files = inventory_attachments(attachments_dir, &enc_dir.join(HASH_CACHE_FILE))?;

    let manifest = Manifest {
        app: "desko".to_string(),
        format: container::FORMAT_VERSION,
        created_at: chrono::Utc::now().timestamp_millis(),
        app_version: app_version.to_string(),
        counts,
        files,
    };

    let zip_bytes = container::build_zip(&tmp, &manifest, None, progress)?;
    let _ = std::fs::remove_file(&tmp);

    progress("打包并加密（AES-256-GCM）", 82);
    let ts = chrono::Utc::now().timestamp_millis();
    let name = unique_package_name(backups, ts)?;
    let out = backups.join(&name);
    container::pack(&zip_bytes, &out, dek, wrap)?;

    // 附件逐个加密到 backups/attachments/，已存在的跳过（内容不可变）
    let total = manifest.files.len().max(1);
    for (i, f) in manifest.files.iter().enumerate() {
        let enc = enc_dir.join(format!("{}.enc", f.name));
        if !enc.exists() {
            container::encrypt_file_to(&attachments_dir.join(&f.name), &enc, dek, wrap)?;
        }
        progress(
            &format!("加密附件 {}/{}", i + 1, total),
            82 + (((i + 1) as f64 / total as f64) * 16.0) as u8,
        );
    }

    let size = std::fs::metadata(&out)?.len() as i64;
    progress("完成", 100);
    Ok(PackageInfo {
        name,
        time: ts,
        size,
        attachments: Some(manifest.counts.attachments),
    })
}

/// 导出一个**自足的迁移包**：库快照 + 清单里那些附件的本体，一起装进包再整体加密。
/// 和定时备份的切分相反 —— 备份省流量所以把附件拆到旁边增量传，迁移要的是"拷一个文件
/// 就能在别的电脑恢复"。附件只装这份库真认领的（`names` 由调用方从库里算出来），
/// 不然目录里堆的无引用历史文件会被一起打包带走。
#[allow(clippy::too_many_arguments)]
pub fn export_package(
    db_path: &str,
    attachments_dir: &Path,
    names: &[String],
    dest: &Path,
    dek: &[u8],
    wrap: &container::Wrap,
    app_version: &str,
    progress: &dyn Fn(&str, u8),
) -> Result<PackageInfo, AppError> {
    let file_name = dest
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| n.ends_with(".dsbk"))
        .ok_or_else(|| AppError::Backup("导出文件名要以 .dsbk 结尾".to_string()))?
        .to_string();
    if !dest.parent().map(|p| p.is_dir()).unwrap_or(false) {
        return Err(AppError::Backup("导出位置不存在，请重新选一个".to_string()));
    }

    let tmp = std::env::temp_dir().join(format!("desko-export-{}.db", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_file(&tmp);
    progress("导出库快照", 6);
    let counts = snapshot_db(db_path, &tmp)?;

    let mut files: Vec<container::FileEntry> = Vec::with_capacity(names.len());
    for name in names {
        let bytes = std::fs::read(attachments_dir.join(name))?;
        files.push(container::FileEntry {
            name: name.clone(),
            size: bytes.len() as i64,
            sha256: container::sha256_hex(&bytes),
        });
    }

    let manifest = Manifest {
        app: "desko".to_string(),
        format: container::FORMAT_VERSION,
        created_at: chrono::Utc::now().timestamp_millis(),
        app_version: app_version.to_string(),
        counts,
        files,
    };

    let zip_bytes = container::build_zip(&tmp, &manifest, Some(attachments_dir), progress)?;
    let _ = std::fs::remove_file(&tmp);

    progress("加密（AES-256-GCM）", 88);
    let ts = chrono::Utc::now().timestamp_millis();
    container::pack(&zip_bytes, dest, dek, wrap)?;
    let size = std::fs::metadata(dest)?.len() as i64;
    progress("完成", 100);
    Ok(PackageInfo {
        name: file_name,
        time: ts,
        size,
        // 报真数：库里登记的行数不等于真装进包的文件数（有人手动删过文件）
        attachments: Some(manifest.files.len() as i64),
    })
}

/// 解密解包到 staging 并做完整性校验，返回 manifest。
/// 附件有两种来路：迁移导出的包自带 attachments/（解压就有了，直接用）；
/// 定时备份的包不带，按清单从 backups/attachments/*.enc 解出来（云端恢复前先补到该目录）。
pub fn unpack_to_staging(
    pkg_path: &Path,
    dek: &[u8],
    staging: &Path,
    backups: &Path,
    progress: &dyn Fn(&str, u8),
) -> Result<Manifest, AppError> {
    progress("解密备份包", 20);
    let zip_bytes = container::unpack(pkg_path, dek)?;
    progress("还原文件", 40);
    let manifest = container::extract_to(&zip_bytes, staging)?;

    // v2：附件不在 zip 里，按清单从本地 enc 目录解密
    let staged_att = staging.join("attachments");
    if !staged_att.exists() && !manifest.files.is_empty() {
        let enc_dir = backups.join("attachments");
        let total = manifest.files.len();
        for (i, f) in manifest.files.iter().enumerate() {
            let enc = enc_dir.join(format!("{}.enc", f.name));
            if !enc.exists() {
                return Err(AppError::Backup(format!("缺少附件密文: {}", f.name)));
            }
            container::decrypt_file_to(&enc, &staged_att.join(&f.name), &f.sha256, dek)?;
            progress(
                &format!("还原附件 {}/{}", i + 1, total),
                40 + (((i + 1) as f64 / total as f64) * 18.0) as u8,
            );
        }
    }

    progress("校验数据库完整性", 60);
    check_integrity(&staging.join("data.db"))?;
    Ok(manifest)
}

pub fn check_integrity(db_file: &Path) -> Result<(), AppError> {
    let conn = Connection::open(db_file)?;
    let verdict: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if verdict == "ok" {
        Ok(())
    } else {
        Err(AppError::Backup(format!("数据库完整性校验失败: {}", verdict)))
    }
}

/// 整机替换：库文件 + 附件目录。调用方必须已经关掉旧连接（Windows 下句柄占用会挡住 rename）。
/// 顺序：rename 现场 → 就位 → 校验；任何一步失败都把 rename 倒放回去。
pub fn swap_live_files(
    app_data_dir: &Path,
    attachments_dir: &Path,
    staging: &Path,
) -> Result<(), AppError> {
    let db_live = app_data_dir.join("data.db");
    let db_swap = app_data_dir.join("data.db.swap");
    let wal_live = app_data_dir.join("data.db-wal");
    let shm_live = app_data_dir.join("data.db-shm");
    let att_swap = app_data_dir.join("attachments.swap");

    let _ = std::fs::remove_file(&db_swap);
    let _ = std::fs::remove_dir_all(&att_swap);

    // 1) 现场挪开
    if db_live.exists() {
        std::fs::rename(&db_live, &db_swap)?;
    }
    let _ = std::fs::remove_file(&wal_live);
    let _ = std::fs::remove_file(&shm_live);
    if attachments_dir.exists() {
        std::fs::rename(attachments_dir, &att_swap)?;
    }

    // 2) 新数据就位
    let stage_db = staging.join("data.db");
    let stage_att = staging.join("attachments");
    let mut placed_db = false;
    let mut placed_att = false;
    if std::fs::rename(&stage_db, &db_live).is_ok() {
        placed_db = true;
    }
    if stage_att.exists() {
        if std::fs::rename(&stage_att, attachments_dir).is_ok() {
            placed_att = true;
        }
    } else {
        placed_att = true; // 包里没附件，空目录即可
        let _ = std::fs::create_dir_all(attachments_dir);
    }

    // 3) 校验，失败回滚
    let ok = placed_db && container_ok(&db_live);
    if !ok {
        let _ = std::fs::remove_file(&db_live);
        let _ = std::fs::remove_dir_all(attachments_dir);
        if db_swap.exists() {
            let _ = std::fs::rename(&db_swap, &db_live);
        }
        if att_swap.exists() {
            let _ = std::fs::rename(&att_swap, attachments_dir);
        }
        return Err(AppError::Backup("恢复失败，已回滚到原数据".to_string()));
    }
    let _ = placed_att;

    // 4) 落定后清场
    let _ = std::fs::remove_file(&db_swap);
    let _ = std::fs::remove_dir_all(&att_swap);
    let _ = std::fs::remove_dir_all(staging);
    Ok(())
}

fn container_ok(db_file: &Path) -> bool {
    check_integrity(db_file).is_ok()
}

/// 启动时清理上次替换中途断电留下的 .swap（在打开数据库之前调用）
pub fn recover_swap(app_data_dir: &Path, attachments_dir: &Path) {
    let db_live = app_data_dir.join("data.db");
    let db_swap = app_data_dir.join("data.db.swap");
    if db_swap.exists() {
        if !db_live.exists() {
            let _ = std::fs::rename(&db_swap, &db_live);
        } else {
            let _ = std::fs::remove_file(&db_swap);
        }
    }
    let att_swap = app_data_dir.join("attachments.swap");
    if att_swap.exists() {
        let att_empty = !attachments_dir.exists()
            || std::fs::read_dir(attachments_dir)
                .map(|mut d| d.next().is_none())
                .unwrap_or(true);
        if att_empty {
            let _ = std::fs::remove_dir_all(attachments_dir);
            let _ = std::fs::rename(&att_swap, attachments_dir);
        } else {
            let _ = std::fs::remove_dir_all(&att_swap);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 迁移导出的包必须自足：附件本体在包里，换到一台没有 .enc 旁路的机器也解得开；
    /// 而且只装被引用的那些，目录里堆着的历史垃圾文件不能跟着搬家。
    #[test]
    fn export_package_is_self_contained() {
        let root = std::env::temp_dir().join(format!("desko_exp_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("data.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes(id TEXT PRIMARY KEY, content_html TEXT);
                 CREATE TABLE entries(id TEXT);
                 CREATE TABLE note_attachments(id TEXT);
                 INSERT INTO notes VALUES('n1','<p><img src=\"asset://localhost/u9__a.png\"></p>'),
                                        ('n2','<p>纯文字</p>');",
            )
            .unwrap();
        }
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        std::fs::write(att.join("u9__a.png"), b"png-bytes").unwrap();
        std::fs::write(att.join("junk__b.png"), b"never-referenced").unwrap();
        let dek = crate::crypto::random_bytes(container::DEK_LEN);
        let wrap = container::Wrap::seal(&dek, "pw").unwrap();
        let out = root.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let dest = out.join("desko-migrate.dsbk");

        let info = export_package(
            db_path.to_str().unwrap(),
            &att,
            &["u9__a.png".to_string()],
            &dest,
            &dek,
            &wrap,
            "t",
            &|_, _| {},
        )
        .unwrap();
        assert_eq!(info.name, "desko-migrate.dsbk");

        // 换机现场：全新的空目录，没有 backups/attachments，也不经过任何云端
        let other = std::env::temp_dir().join(format!("desko_exp_new_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&other).unwrap();
        let staging = staging_dir(&other);
        let manifest =
            unpack_to_staging(&dest, &dek, &staging, &backups_dir(&other), &|_, _| {}).unwrap();
        assert_eq!(manifest.files.len(), 1, "包里只该装被引用的那一个附件");
        assert_eq!(
            std::fs::read(staging.join("attachments").join("u9__a.png")).unwrap(),
            b"png-bytes"
        );
        assert!(!staging.join("attachments").join("junk__b.png").exists());
        let conn = Connection::open(staging.join("data.db")).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2, "库快照也得是完整的");
        drop(conn);

        // 后缀不对直接拒：恢复侧只认 .dsbk，导出去一个 txt 就是给自己挖坑
        assert!(export_package(
            db_path.to_str().unwrap(),
            &att,
            &[],
            &out.join("wrong.txt"),
            &dek,
            &wrap,
            "t",
            &|_, _| {},
        )
        .is_err());

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&other);
    }


    #[test]
    fn snapshot_create_list_restore_flow_on_temp_dirs() {
        let root = std::env::temp_dir().join(format!("desko_bk_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("data.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes(id TEXT); INSERT INTO notes VALUES('a'),('b');
                 CREATE TABLE entries(id TEXT); CREATE TABLE note_attachments(id TEXT);",
            )
            .unwrap();
        }
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        std::fs::write(att.join("u1__x.png"), b"img").unwrap();

        let dek = crate::crypto::random_bytes(container::DEK_LEN);
        let wrap = container::Wrap::seal(&dek, "pw").unwrap();
        let backups = backups_dir(&root);

        // 备份 → 列表 → 轮转
        let info = create_package(
            db_path.to_str().unwrap(),
            &att,
            &backups,
            &dek,
            &wrap,
            "test",
            &|_, _| {},
        )
        .unwrap();
        assert!(info.name.ends_with(".dsbk"));
        assert_eq!(list_packages(&backups).len(), 1);

        // 恢复到 staging → 换入现场
        let staging = staging_dir(&root);
        let pkg = backups.join(&info.name);
        std::fs::write(att.join("u2__gone.png"), b"stale").unwrap(); // 现场多一个附件，恢复后应消失
        unpack_to_staging(&pkg, &dek, &staging, &backups, &|_, _| {}).unwrap();
        swap_live_files(&root, &att, &staging).unwrap();
        assert!(!att.join("u2__gone.png").exists());
        assert!(att.join("u1__x.png").exists());
        assert!(!root.join("data.db.swap").exists());
        assert!(!staging.exists());
        let conn = Connection::open(&db_path).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
        drop(conn);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 同一秒内连打两个包：包名只到秒，撞名会把前一个原地覆盖掉（写包是原子改名），
    /// 所以第二个必须往后挪一秒，两包都要在盘上。
    #[test]
    fn two_packages_in_the_same_second_do_not_overwrite_each_other() {
        let root = std::env::temp_dir().join(format!("desko_dup_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("data.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes(id TEXT); CREATE TABLE entries(id TEXT); CREATE TABLE note_attachments(id TEXT);",
            )
            .unwrap();
        }
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        let dek = crate::crypto::random_bytes(container::DEK_LEN);
        let wrap = container::Wrap::seal(&dek, "pw").unwrap();
        let backups = backups_dir(&root);

        let a = create_package(db_path.to_str().unwrap(), &att, &backups, &dek, &wrap, "t", &|_, _| {})
            .unwrap();
        let b = create_package(db_path.to_str().unwrap(), &att, &backups, &dek, &wrap, "t", &|_, _| {})
            .unwrap();
        assert_ne!(a.name, b.name, "同秒两次备份不该拿到同一个包名：{}", a.name);
        assert!(backups.join(&a.name).exists(), "前一个包被覆盖了");
        assert!(backups.join(&b.name).exists());
        assert_eq!(list_packages(&backups).len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 换密码后重包头部：包和附件密文都还能解，旧密码取不出密钥
    #[test]
    fn rewrap_all_rewrites_every_sealed_header() {
        let root = std::env::temp_dir().join(format!("desko_rw_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("data.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes(id TEXT); CREATE TABLE entries(id TEXT); CREATE TABLE note_attachments(id TEXT);",
            )
            .unwrap();
        }
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        std::fs::write(att.join("u1__x.png"), b"img-bytes").unwrap();

        let dek = crate::crypto::random_bytes(container::DEK_LEN);
        let w1 = container::Wrap::seal(&dek, "old-pw").unwrap();
        let backups = backups_dir(&root);
        let info =
            create_package(db_path.to_str().unwrap(), &att, &backups, &dek, &w1, "test", &|_, _| {})
                .unwrap();

        let w2 = container::Wrap::seal(&dek, "new-pw").unwrap();
        // 掺一个旧格式包：换头应当跳过它并上报，而不是让整批中断
        std::fs::write(backups.join("desko-20200101-000000.dsbk"), b"DSBK\x01junk").unwrap();
        let (done, skipped) = rewrap_all(&backups, &w2);
        assert_eq!(done, 2, "一个包 + 一个附件密文");
        assert_eq!(skipped, vec!["desko-20200101-000000.dsbk".to_string()]);

        let pkg = backups.join(&info.name);
        let enc = backups.join("attachments").join("u1__x.png.enc");
        assert!(container::unpack(&pkg, &dek).is_ok());
        assert!(container::unpack(&enc, &dek).is_ok(), "附件必须被换到新包裹下");
        assert!(container::derive_dek(&pkg, "new-pw").is_ok());
        assert!(container::derive_dek(&enc, "new-pw").is_ok(), "附件换头后新密码要能取出 DEK");
        assert!(container::derive_dek(&enc, "old-pw").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 建一个最小现场：库 + 附件目录。返回 (根目录, 库路径, 附件目录, DEK, 包裹块)
    fn site(tag: &str, files: &[(&str, &[u8])]) -> (PathBuf, PathBuf, PathBuf, Vec<u8>, container::Wrap) {
        let root = std::env::temp_dir().join(format!("desko_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("data.db");
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE notes(id TEXT); CREATE TABLE entries(id TEXT); CREATE TABLE note_attachments(id TEXT);",
            )
            .unwrap();
        }
        let att = root.join("attachments");
        std::fs::create_dir_all(&att).unwrap();
        for (name, bytes) in files {
            std::fs::write(att.join(name), bytes).unwrap();
        }
        let dek = crate::crypto::random_bytes(container::DEK_LEN);
        let wrap = container::Wrap::seal(&dek, "pw").unwrap();
        (root, db_path, att, dek, wrap)
    }

    fn pack_n(db_path: &str, att: &Path, backups: &Path, dek: &[u8], wrap: &container::Wrap, n: usize) -> Vec<String> {
        (0..n)
            .map(|_| create_package(db_path, att, backups, dek, wrap, "t", &|_, _| {}).unwrap().name)
            .collect() // 旧→新
    }

    /// 本地只是中转区：上了云的当轮就删，只留最近几份兜底；没上云的一份都不许动
    #[test]
    fn prune_only_deletes_what_the_cloud_already_has() {
        let (root, db_path, att, dek, wrap) = site("prune", &[]);
        let backups = backups_dir(&root);
        let made = pack_n(db_path.to_str().unwrap(), &att, &backups, &dek, &wrap, 5);

        // 全都没传上去：一个都不能删，哪怕超出兜底份数
        prune(&backups, &[]);
        assert_eq!(list_packages(&backups).len(), 5);

        // 只有最新两份上了云：它们在兜底份数之内，超出的那几份没确认，还是不动
        prune(&backups, &made[3..]);
        assert_eq!(list_packages(&backups).len(), 5);

        // 全都上了云：超出兜底的删掉，留最近 3 份
        prune(&backups, &made);
        let left: Vec<String> = list_packages(&backups).into_iter().map(|(n, _, _, _)| n).collect();
        assert_eq!(left, vec![made[4].clone(), made[3].clone(), made[2].clone()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 附件密文回收：明文没了、也没人引用才删；还没传上云的坚决不删
    #[test]
    fn reclaim_enc_only_drops_ciphertext_nobody_can_use() {
        let (root, db_path, att, dek, wrap) = site(
            "reclaim",
            &[("u1__keep.png", b"one"), ("u2__gone.png", b"two")],
        );
        let backups = backups_dir(&root);
        let enc = backups.join("attachments");
        let p1 = pack_n(db_path.to_str().unwrap(), &att, &backups, &dek, &wrap, 1).remove(0);
        assert!(enc.join("u2__gone.png.enc").exists());

        // 明文都还在：下一轮备份还要用
        assert_eq!(reclaim_enc(&backups, &att, &dek, &[]), 0);

        // 明文被清理了，但本地还有包指着它 —— 删了那个包就恢复不出附件
        std::fs::remove_file(att.join("u2__gone.png")).unwrap();
        let u2 = vec!["u2__gone.png".to_string()];
        assert_eq!(reclaim_enc(&backups, &att, &dek, &u2), 0);
        assert!(enc.join("u2__gone.png.enc").exists());

        // 包也传上云被清掉了：这才是死重量
        std::fs::remove_file(backups.join(&p1)).unwrap();
        assert_eq!(reclaim_enc(&backups, &att, &dek, &u2), 1);
        assert!(!enc.join("u2__gone.png.enc").exists());
        assert!(enc.join("u1__keep.png.enc").exists(), "明文还在的不许动");
        assert!(enc.join(".hash-cache.json").exists(), "sidecar 不是密文");

        // 还没上云的密文不能删：云端那份包恢复时要按清单来取
        std::fs::write(att.join("u3__pending.png"), b"three").unwrap();
        let p2 = pack_n(db_path.to_str().unwrap(), &att, &backups, &dek, &wrap, 1).remove(0);
        std::fs::remove_file(att.join("u3__pending.png")).unwrap();
        std::fs::remove_file(backups.join(&p2)).unwrap();
        assert_eq!(reclaim_enc(&backups, &att, &dek, &[]), 0);
        let u3 = vec!["u3__pending.png".to_string()];
        assert_eq!(reclaim_enc(&backups, &att, &dek, &u3), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
