use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::crypto::{self, EncryptedData};
use crate::db::Database;
use crate::error::AppError;
use crate::webdav::Client;

pub const META_CFG: &str = "cloud_cfg";
pub const META_KEEP_REMOTE: &str = "keep_remote";

/// 同步记录写在备份目录的 sidecar 里，不进库。
/// 进库就等于"同步成功会改动 data.db"，而定时器判变更看的正是 data.db ——
/// 于是每同步一次就自我判定成一轮新备份，转圈往外推包。
pub const STATE_FILE: &str = ".sync-state.json";

pub const PKG_DIR: &str = "desko/packages";
pub const ATT_DIR: &str = "desko/attachments";

#[derive(Serialize, Deserialize, Clone)]
pub struct CloudCreds {
    pub server: String,
    pub account: String,
    pub app_password: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct SyncState {
    #[serde(default)]
    pub packages: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<String>,
    /// 上次成功同步的时刻，跟着记录一起放 sidecar（放库里就等于同步在改库）
    #[serde(default)]
    pub last_sync_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub configured: bool,
    pub server: String,
    pub account: String,
    pub keep_remote: i64,
    pub last_sync_at: i64,
    pub synced_packages: usize,
    pub synced_attachments: usize,
}

/* ---------- meta 读写（只在主线程持锁时调用） ---------- */

pub(crate) fn save_cfg(db: &Database, master_key: &[u8], cfg: &CloudCreds) -> Result<(), AppError> {
    let json = serde_json::to_string(cfg).map_err(|e| AppError::Crypto(e.to_string()))?;
    let sealed = crypto::encrypt_password(&json, master_key)?;
    db.set_meta(META_CFG, &serde_json::to_string(&sealed).map_err(|e| AppError::Crypto(e.to_string()))?)
}

pub fn load_cfg(db: &Database, master_key: &[u8]) -> Result<Option<CloudCreds>, AppError> {
    let Some(json) = db.get_meta(META_CFG)? else {
        return Ok(None);
    };
    if json.is_empty() {
        return Ok(None);
    }
    let sealed: EncryptedData = serde_json::from_str(&json).map_err(|e| AppError::Crypto(e.to_string()))?;
    let plain = crypto::decrypt_password(&sealed, master_key)?;
    Ok(Some(serde_json::from_str(&plain).map_err(|e| AppError::Crypto(e.to_string()))?))
}

/// 同步记录：`backups/.sync-state.json`。读写都在后台线程里做，不碰库。
pub fn state_path(backups: &Path) -> PathBuf {
    backups.join(STATE_FILE)
}

pub fn load_state(backups: &Path) -> SyncState {
    std::fs::read(state_path(backups))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn write_state(backups: &Path, state: &SyncState) -> Result<(), AppError> {
    let path = state_path(backups);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec(state).map_err(|e| AppError::Backup(e.to_string()))?;
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// 清空同步记录：本地包被换过头部（改备份密码）后，下次同步全部重传
pub fn clear_state(backups: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(state_path(backups)) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub(crate) fn keep_remote(db: &Database) -> i64 {
    db.get_meta(META_KEEP_REMOTE)
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .filter(|v| (1..=100).contains(v))
        .unwrap_or(20)
}

pub fn status(db: &Database, master_key: &[u8], backups: &Path) -> Result<CloudStatus, AppError> {
    let cfg = load_cfg(db, master_key)?;
    let state = load_state(backups);
    Ok(CloudStatus {
        configured: cfg.is_some(),
        server: cfg.as_ref().map(|c| c.server.clone()).unwrap_or_default(),
        account: cfg.as_ref().map(|c| c.account.clone()).unwrap_or_default(),
        keep_remote: keep_remote(db),
        last_sync_at: state.last_sync_at,
        synced_packages: state.packages.len(),
        synced_attachments: state.attachments.len(),
    })
}

/// 断开 = 抹掉凭据与同步记录。自动那一档不用另写开关：`auto_on` 要求 configured，
/// 凭据没了轮次自然就停。
pub fn disconnect(db: &Database, backups: &Path) -> Result<(), AppError> {
    db.set_meta(META_CFG, "")?;
    clear_state(backups)
}

/* ---------- 网络部分（后台线程，不碰数据库） ---------- */

fn client_for(cfg: &CloudCreds) -> Client {
    Client::new(&cfg.server, &cfg.account, &cfg.app_password)
}

/// 对齐官方插件 normalizeNutstoreBaseUrl：trim、补协议、去 query/hash/结尾斜杠。
/// 比官方更严一档：只收 https（隐私红线，凭据不允许裸传）。
pub fn normalize_server(value: &str) -> Result<String, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return Err(AppError::Backup("服务器地址格式不正确".to_string()));
    }
    let mut candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    if let Some(pos) = candidate.find(['?', '#']) {
        candidate.truncate(pos);
    }
    let normalized = candidate.trim_end_matches('/').to_string();
    if !normalized.starts_with("https://") {
        return Err(AppError::Backup("服务器地址需为 https（坚果云 WebDAV 仅支持 https）".to_string()));
    }
    Ok(normalized)
}

pub fn test_connection(cfg: &CloudCreds) -> Result<(), AppError> {
    let server = normalize_server(&cfg.server)?;
    if server.starts_with("http://") {
        return Err(AppError::Backup("服务器地址需为 https 开头".to_string()));
    }
    if cfg.account.is_empty() || cfg.app_password.is_empty() {
        return Err(AppError::Backup("账号与应用密码不能为空".to_string()));
    }
    // 只看根目录通不通：desko/ 是首次同步时才建的，拿它探活必然 404
    match Client::new(&server, &cfg.account, &cfg.app_password).propfind_opt("")? {
        Some(_) => Ok(()),
        None => Err(AppError::Backup(
            "连上了但根目录找不到，地址可能不对（个人版是 https://dav.jianguoyun.com/dav）".to_string(),
        )),
    }
}

fn local_inventory(backups: &Path) -> (Vec<String>, Vec<String>) {
    let packages: Vec<String> = crate::backup::list_packages(backups)
        .into_iter()
        .map(|(name, _, _, _)| name)
        .collect();
    let mut atts: Vec<String> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(backups.join("attachments")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(base) = name.strip_suffix(".enc") {
                atts.push(base.to_string());
            }
        }
    }
    atts.sort();
    (packages, atts)
}

/// 本地还欠云端多少东西（没传的包 + 没传的附件密文）。纯本地比对，不发请求。
pub fn pending_count(backups: &Path) -> usize {
    let record = load_state(backups);
    let (packages, attachments) = local_inventory(backups);
    packages.iter().filter(|n| !record.packages.contains(n)).count()
        + attachments.iter().filter(|n| !record.attachments.contains(n)).count()
}

/// 本地和云端还没对齐 —— 定时器用它决定"这轮要不要跑"，所以同步失败不会一直躺着没人管。
/// 两种情况都算：有还没传上去的；或者全传完了、本地却还堆着超出兜底份数的旧包等着清理。
pub fn has_backlog(backups: &Path) -> bool {
    if pending_count(backups) > 0 {
        return true;
    }
    crate::backup::list_packages(backups).len() > crate::backup::LOCAL_FLOOR
}

/// 云端凭据在不在。手动「立即备份」看这条：配了云就该传，跟自动开关无关
pub fn configured(db: &Database) -> bool {
    db.get_meta(META_CFG).ok().flatten().map(|v| !v.is_empty()).unwrap_or(false)
}

/// 自动那一档到底开没开：配了云端，并且至少有一种触发方式（定时或停笔即备）。
///
/// 判据只有一条，界面上也只留一个控件：以前"自动同步"和"定时备份"是两把闸，
/// 那是本地备份与云备份分家时的遗留 —— 现在本地那份只是等上传的中转，两把闸就是一个东西。
/// 只看 meta，不解密凭据，所以持锁时也能调。
pub fn auto_on(db: &Database) -> bool {
    configured(db)
        && (crate::services::auto_backup::interval_min(db) > 0
            || crate::services::auto_backup::realtime_on(db))
}

/// 云端轮转后收敛同步记录：只留下本地还认得的名字。
///
/// 被云端轮转删掉的那些**仍然要算"已经传过"**：云端保留份数配得比本地兜底份数还少时，
/// 它们在本地还留着，要是从记录里抹掉，下一轮 `has_backlog` 就把它们当新东西再传一遍，
/// 传完又被轮转删掉 —— 每轮往坚果云推同一批旧包，正好违背做增量的初衷。
fn pruned(uploaded: &[String], known: &[String]) -> Vec<String> {
    uploaded
        .iter()
        .filter(|n| known.iter().any(|k| k == *n))
        .cloned()
        .collect()
}

/// 仅发送同步：附件增量 → 包增量 → 云端轮转。返回更新后的同步记录，由调用方落盘。
/// 中途失败直接返回 Err，下次从记录续传（远端同名覆盖，幂等）。
///
/// 待传清单为空时一个请求都不发：坚果云按请求数计流量（每个请求还强制隔 200ms），
/// 而远端对象只可能因为我们上传而变多，没东西可传就不用列目录、也不用轮转。
pub fn sync_core(
    cfg: &CloudCreds,
    record: &SyncState,
    keep: i64,
    backups: &Path,
    progress: &dyn Fn(&str, u8),
) -> Result<SyncState, AppError> {
    let (packages, attachments) = local_inventory(backups);

    let att_todo: Vec<&String> = attachments.iter().filter(|n| !record.attachments.contains(n)).collect();
    let pkg_todo: Vec<&String> = packages
        .iter()
        .rev() // list_packages 是新→旧，反转为旧→新上传
        .filter(|n| !record.packages.contains(n))
        .collect();

    if att_todo.is_empty() && pkg_todo.is_empty() {
        return Ok(record.clone());
    }

    let client = client_for(cfg);
    client.ensure_dir(PKG_DIR)?;
    client.ensure_dir(ATT_DIR)?;

    let total = att_todo.len().max(1);
    let mut uploaded_atts = record.attachments.clone();
    for (i, name) in att_todo.iter().enumerate() {
        progress(
            &format!("上传附件 {}/{}", i + 1, total),
            (i as f64 / total as f64 * 70.0) as u8,
        );
        let bytes = std::fs::read(backups.join("attachments").join(format!("{}.enc", name)))?;
        client.put(&format!("{}/{}.enc", ATT_DIR, name), &bytes)?;
        uploaded_atts.push((**name).clone());
    }

    let total_p = pkg_todo.len().max(1);
    let mut uploaded_pkgs = record.packages.clone();
    for (i, name) in pkg_todo.iter().enumerate() {
        progress(
            &format!("上传备份包 {}/{}", i + 1, total_p),
            70 + (i as f64 / total_p as f64 * 20.0) as u8,
        );
        let bytes = std::fs::read(backups.join(name))?;
        client.put(&format!("{}/{}", PKG_DIR, name), &bytes)?;
        uploaded_pkgs.push((**name).clone());
    }

    progress("云端轮转", 92);
    let mut remote: Vec<String> = client
        .propfind(PKG_DIR)?
        .into_iter()
        .map(|e| e.name)
        .filter(|n| n.starts_with("desko-") && n.ends_with(".dsbk"))
        .collect();
    remote.sort();
    remote.reverse();
    for old in remote.iter().skip(keep.max(1) as usize) {
        client.delete(&format!("{}/{}", PKG_DIR, old))?;
    }

    progress("完成", 100);
    Ok(SyncState {
        packages: pruned(&uploaded_pkgs, &packages),
        attachments: pruned(&uploaded_atts, &attachments),
        last_sync_at: chrono::Utc::now().timestamp_millis(),
    })
}

pub fn list_remote(cfg: &CloudCreds) -> Result<Vec<crate::webdav::DavEntry>, AppError> {
    // 还没同步过时目录不存在，那是空列表不是错误
    let mut entries: Vec<_> = client_for(cfg)
        .propfind_opt(PKG_DIR)?
        .unwrap_or_default()
        .into_iter()
        .filter(|e| e.name.starts_with("desko-") && e.name.ends_with(".dsbk"))
        .collect();
    entries.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(entries)
}

/// 把云端的一个包拉到本地 backups 目录。这一步不需要任何密钥。
pub fn download_package(cfg: &CloudCreds, backups: &Path, name: &str) -> Result<PathBuf, AppError> {
    if !crate::backup::is_package(name) {
        return Err(AppError::Backup("非法的备份文件名".to_string()));
    }
    let local_pkg = backups.join(name);
    if local_pkg.exists() {
        return Ok(local_pkg);
    }
    client_for(cfg).get(&format!("{}/{}", PKG_DIR, name), &local_pkg)?;
    Ok(local_pkg)
}

/// 按 manifest 把缺的附件密文补到本地（清单已在本地，包已解过）
pub fn fetch_attachments(
    cfg: &CloudCreds,
    backups: &Path,
    manifest: &crate::backup::Manifest,
    progress: &dyn Fn(&str, u8),
) -> Result<(), AppError> {
    let att_dir = backups.join("attachments");
    std::fs::create_dir_all(&att_dir)?;
    let client = client_for(cfg);
    let missing: Vec<_> = manifest
        .files
        .iter()
        .filter(|f| !att_dir.join(format!("{}.enc", f.name)).exists())
        .collect();
    let total = missing.len().max(1);
    for (i, f) in missing.iter().enumerate() {
        progress(
            &format!("下载附件 {}/{}", i + 1, total),
            (i as f64 / total as f64 * 60.0) as u8,
        );
        client.get(
            &format!("{}/{}.enc", ATT_DIR, f.name),
            &att_dir.join(format!("{}.enc", f.name)),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_like_official_plugin() {
        assert_eq!(normalize_server("https://dav.jianguoyun.com/dav/").unwrap(), "https://dav.jianguoyun.com/dav");
        assert_eq!(normalize_server("  dav.jianguoyun.com/dav  ").unwrap(), "https://dav.jianguoyun.com/dav");
        assert_eq!(normalize_server("https://a.com/dav?x=1").unwrap(), "https://a.com/dav");
        assert_eq!(normalize_server("https://a.com/dav#f").unwrap(), "https://a.com/dav");
        assert!(normalize_server("http://a.com/dav").is_err()); // 只收 https
        assert!(normalize_server("a b").is_err()); // 域名里带空格
        assert!(normalize_server("").is_err());
    }

    /// 造一个只有 packages/attachments 的假备份目录
    fn fake_backups(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("desko_cloud_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("attachments")).unwrap();
        std::fs::write(root.join("desko-20260921-120000.dsbk"), b"pkg").unwrap();
        std::fs::write(root.join("attachments").join("a__x.png.enc"), b"enc").unwrap();
        std::fs::write(root.join("attachments").join(".hash-cache.json"), b"{}").unwrap();
        root
    }

    fn full_record() -> SyncState {
        SyncState {
            packages: vec!["desko-20260921-120000.dsbk".to_string()],
            attachments: vec!["a__x.png".to_string()],
            last_sync_at: 777,
        }
    }

    /// 同步记录活在 sidecar 里：读写清各一次；库不参与，所以同步成功不会伪装成"数据有变更"
    #[test]
    fn sync_state_lives_in_the_sidecar() {
        let root = fake_backups("state");
        assert_eq!(load_state(&root).last_sync_at, 0, "没写过就是空记录");
        write_state(&root, &full_record()).unwrap();
        let back = load_state(&root);
        assert_eq!(
            (back.packages.len(), back.attachments.len(), back.last_sync_at),
            (1, 1, 777)
        );
        assert_eq!(back.packages[0], "desko-20260921-120000.dsbk");
        clear_state(&root).unwrap();
        assert_eq!(load_state(&root).packages.len(), 0);
        clear_state(&root).unwrap(); // 文件已经没了也不能报错
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 欠账判定纯本地：旁路文件（.hash-cache.json）不能当待传附件
    #[test]
    fn pending_upload_is_compared_locally() {
        let root = fake_backups("inv");
        assert_eq!(pending_count(&root), 2, "一个包 + 一个附件密文都没传");
        assert!(has_backlog(&root), "一条记录都没有，当然有欠账");
        write_state(&root, &full_record()).unwrap();
        assert_eq!(pending_count(&root), 0);
        assert!(!has_backlog(&root), "全传过了、也没超出兜底份数，就不该再有欠账");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 全传上云了、本地却还堆着超出兜底份数的旧包：也算欠账，好让下一轮去清理。
    /// 不然"数据没变就什么都不做"会让中转区永远排不空。
    #[test]
    fn a_full_local_spool_counts_as_backlog() {
        let root = fake_backups("spool");
        let names: Vec<String> = (0..crate::backup::LOCAL_FLOOR + 2)
            .map(|i| format!("desko-20260921-12000{}.dsbk", i))
            .collect();
        for n in &names {
            std::fs::write(root.join(n), b"pkg").unwrap();
        }
        std::fs::remove_file(root.join("desko-20260921-120000.dsbk")).unwrap();
        let mut all = names.clone();
        all.remove(0);
        write_state(
            &root,
            &SyncState {
                packages: all.clone(),
                attachments: vec!["a__x.png".to_string()],
                last_sync_at: 1,
            },
        )
        .unwrap();
        assert_eq!(pending_count(&root), 0, "都在记录里");
        assert!(has_backlog(&root), "本地还堆着 {} 份，等着清理", all.len());
        crate::backup::prune(&root, &all);
        assert!(!has_backlog(&root), "清完就该安静下来");
        assert_eq!(crate::backup::list_packages(&root).len(), crate::backup::LOCAL_FLOOR);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 没东西可传 → 一个请求都不发。探针地址必然连不上：真去拨号就会 Err，
    /// 原样返回记录即证明短路生效，也没把上次同步时间刷掉。
    #[test]
    fn nothing_to_upload_means_no_requests() {
        let root = fake_backups("skip");
        let record = full_record();
        let cfg = CloudCreds {
            server: "https://127.0.0.1:9/dav".to_string(),
            account: "nobody".to_string(),
            app_password: "nope".to_string(),
        };
        let out = sync_core(&cfg, &record, 20, &root, &|_, _| {}).unwrap();
        assert_eq!(out.last_sync_at, 777, "空轮不该刷新上次同步时间");
        assert_eq!(out.packages, record.packages);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cloud_rotation_does_not_queue_the_same_packages_again() {
        let local = vec!["p-c.dsbk".to_string(), "p-b.dsbk".to_string(), "p-a.dsbk".to_string()];
        // 云端只留最新 1 份：p-b/p-a 被删，但本地还在，记录不能把它们抹掉
        let uploaded = vec!["p-c.dsbk".to_string(), "p-b.dsbk".to_string(), "p-a.dsbk".to_string()];
        let kept = pruned(&uploaded, &local);
        assert_eq!(kept.len(), 3, "本地还在的包必须留着，否则下轮又传一遍");
        // 本地轮转删掉的名字才该从记录里掉出去
        let local_after_rotate = vec!["p-c.dsbk".to_string()];
        assert_eq!(pruned(&uploaded, &local_after_rotate), vec!["p-c.dsbk".to_string()]);
        // 记录里不能留下本地根本没有的东西
        assert!(pruned(&vec!["ghost.dsbk".to_string()], &local).is_empty());
    }
}
