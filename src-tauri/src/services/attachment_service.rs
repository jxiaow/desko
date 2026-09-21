use crate::db::{Attachment, Database};
use crate::error::AppError;
use std::fs;
use std::path::{Path, PathBuf};

/// 附件统一落在这个目录，asset: 协议的白名单也只看它（见 main.rs 的 allow_directory）
pub fn attachments_dir() -> PathBuf {
    let root = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&root).join("desko").join("attachments")
}

fn mime_of(extension: &str) -> &'static str {
    match extension.to_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
}

fn stored_file_name(id: &str, original: &str) -> String {
    // 原名直接进文件名，回读时不用查库就知道展示什么；非法字符换成下划线
    let safe: String = original
        .chars()
        .map(|c| match c {
            ':' | '*' | '?' | '"' | '<' | '>' | '|' | '/' | '\\' => '_',
            c => c,
        })
        .collect();
    format!("{}__{}", id, safe)
}

/// 把外部文件收进附件目录，返回一条还没入库的记录（note_id 为空）
pub fn store_file(source_path: &str) -> Result<Attachment, AppError> {
    let source = Path::new(source_path);
    let file_name = source
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Io("Invalid file name".to_string()))?
        .to_string();
    let mime_type = mime_of(
        &source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_string(),
    )
    .to_string();

    let dir = attachments_dir();
    fs::create_dir_all(&dir)
        .map_err(|e| AppError::Io(format!("Failed to create attachments dir: {}", e)))?;

    let id = uuid::Uuid::new_v4().to_string();
    let target_path = dir.join(stored_file_name(&id, &file_name));
    fs::copy(source, &target_path)
        .map_err(|e| AppError::Io(format!("Failed to copy file: {}", e)))?;
    let file_size = fs::metadata(&target_path)
        .map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))?
        .len() as i64;

    Ok(Attachment {
        id,
        note_id: String::new(),
        file_name,
        file_path: target_path.to_string_lossy().to_string(),
        file_size,
        mime_type,
        created_at: chrono::Utc::now().timestamp_millis(),
    })
}

pub fn create_attachment(db: &Database, note_id: &str, source_path: &str) -> Result<Attachment, AppError> {
    let mut attachment = store_file(source_path)?;
    attachment.note_id = note_id.to_string();
    db.create_attachment(&attachment)?;
    Ok(attachment)
}

/// 草稿里的图片先只落盘，发布拿到 note id 之后再补记录。
/// 只认附件目录里的路径，正文里塞别的绝对路径不会被记进库。
pub fn bind_paths(db: &Database, note_id: &str, paths: &[String]) -> Result<Vec<Attachment>, AppError> {
    let dir = attachments_dir();
    let existing = db.list_attachments(note_id)?;
    let mut bound = Vec::new();

    for raw in paths {
        let path = Path::new(raw);
        if path.parent() != Some(dir.as_path()) {
            continue;
        }
        if existing.iter().any(|a| &a.file_path == raw) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        // 名字形如 <uuid>__<原名>；老数据是 <uuid>.<ext>，取整段当 id、原名未知
        let (id, file_name) = match name.split_once("__") {
            Some((id, rest)) => (id.to_string(), rest.to_string()),
            None => (Path::new(&name).file_stem().unwrap_or_default().to_string_lossy().to_string(), name.clone()),
        };
        let file_size = fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
        let mime_type = mime_of(
            &path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string(),
        );
        let attachment = Attachment {
            id,
            note_id: note_id.to_string(),
            file_name,
            file_path: raw.clone(),
            file_size,
            mime_type: mime_type.to_string(),
            created_at: chrono::Utc::now().timestamp_millis(),
        };
        db.create_attachment(&attachment)?;
        bound.push(attachment);
    }
    Ok(bound)
}

pub fn delete_attachment(db: &Database, id: &str) -> Result<(), AppError> {
    if let Some(file_path) = db.delete_attachment(id)? {
        // 删除物理文件
        if let Err(e) = fs::remove_file(&file_path) {
            eprintln!("Warning: Failed to delete attachment file {}: {}", file_path, e);
        }
    }
    Ok(())
}

/// 删小记时连带清文件。行已经删了，路径必须提前取出来。
/// 单个文件删不掉（被占用等）只记警告，不能让删小记本身失败。
pub fn delete_files(paths: &[String]) {
    for p in paths {
        if let Err(e) = fs::remove_file(p) {
            if std::path::Path::new(p).exists() {
                eprintln!("Warning: 附件文件未删除 {}: {}", p, e);
            }
        }
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OrphanFile {
    pub name: String,
    pub size: i64,
}

/// 刚落盘的文件可能正躺在未发布的草稿里，还没进库，不能算垃圾
const GRACE: std::time::Duration = std::time::Duration::from_secs(600);

/// 从正文里抠出被引用的附件绝对路径。
/// 前端用 convertFileSrc 把整条路径 percent-encode 成最后一个 URL 段，这里反解回来。
fn referenced_paths(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("src=\"") {
        rest = &rest[i + 5..];
        let end = rest.find('"').unwrap_or(rest.len());
        let src = &rest[..end];
        if src.starts_with("asset://") || src.contains("asset.localhost") {
            if let Some(slash) = src.rfind('/') {
                let path = crate::webdav::percent_decode(&src[slash + 1..]);
                if !path.is_empty() {
                    out.push(path);
                }
            }
        }
    }
    out
}

/// 这份库认领的附件文件绝对路径：存活登记表里的 + 正文 <img src> 引用的。
/// 判"未引用"和算"导出要带哪些"用的是同一份证据，两处必须同进同退。
pub fn claimed_paths(db: &Database) -> Result<std::collections::HashSet<String>, AppError> {
    let mut live: std::collections::HashSet<String> = std::collections::HashSet::new();
    for a in db.list_live_attachments()? {
        live.insert(a.file_path);
    }
    for html in db.all_note_html()? {
        for p in referenced_paths(&html) {
            live.insert(p);
        }
    }
    Ok(live)
}

/// 库里真认领、且确实躺在 dir 里的文件名（已排序去重）。导出迁移包按这份清单装附件本体，
/// 不装整个目录 —— 目录里可能堆着几十 MB 没人引用的历史文件。
pub fn claimed_names(db: &Database, dir: &Path) -> Result<Vec<String>, AppError> {
    let live = claimed_paths(db)?;
    let mut names: Vec<String> = Vec::new();
    for raw in live {
        let path = Path::new(&raw);
        if path.parent() != Some(dir) {
            continue; // 只认这个目录里的文件，正文塞别的绝对路径也不会被打包
        }
        if path.is_file() {
            names.push(path.file_name().unwrap_or_default().to_string_lossy().to_string());
        }
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// 扫附件目录，找出"没有任何存活登记、也不被任何小记正文引用"的文件
pub fn scan_orphans(db: &Database) -> Result<Vec<OrphanFile>, AppError> {
    scan_in(db, &attachments_dir(), GRACE)
}

/// 目录与宽限期可注入，便于测试；grace 内的新文件一律不算垃圾
pub fn scan_in(db: &Database, dir: &Path, grace: std::time::Duration) -> Result<Vec<OrphanFile>, AppError> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    let live = claimed_paths(db)?;

    let now = std::time::SystemTime::now();
    let mut out: Vec<OrphanFile> = Vec::new();
    for e in fs::read_dir(dir)? {
        let path = match e {
            Ok(e) => e.path(),
            Err(_) => continue,
        };
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if live.contains(&path.to_string_lossy().to_string()) {
            continue;
        }
        let meta = match path.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let fresh = meta
            .modified()
            .ok()
            .and_then(|t| now.duration_since(t).ok())
            .map(|d| d < grace)
            .unwrap_or(false);
        if fresh {
            continue;
        }
        out.push(OrphanFile { name, size: meta.len() as i64 });
    }
    out.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(out)
}

/// 清理勾选的未引用附件。删前重扫一遍取交集：
/// 扫描到点确认之间用户可能刚把草稿发布，那时文件已经不算垃圾了。
pub fn cleanup_orphans(db: &Database, names: &[String]) -> Result<usize, AppError> {
    cleanup_in(db, &attachments_dir(), names)
}

pub fn cleanup_in(db: &Database, dir: &Path, names: &[String]) -> Result<usize, AppError> {
    let want: std::collections::HashSet<&String> = names.iter().collect();
    // 重扫只查"是否已被引用"，不再套宽限期：名单本身就是宽限期筛过的，
    // 而名字是 uuid 前缀，中间不可能撞上一个刚暂存的新文件
    let still_orphan: Vec<String> = scan_in(db, dir, std::time::Duration::ZERO)?
        .into_iter()
        .filter(|f| want.contains(&f.name))
        .map(|f| f.name)
        .collect();
    if still_orphan.is_empty() {
        return Ok(0);
    }
    let paths: Vec<String> = still_orphan
        .iter()
        .map(|n| dir.join(n).to_string_lossy().to_string())
        .collect();
    db.delete_attachments_by_paths(&paths)?;
    delete_files(&paths);
    Ok(paths.len())
}

#[cfg(test)]
mod orphan_tests {
    use super::*;
    use crate::db::{Attachment, Note};
    use std::time::Duration;

    /// convertFileSrc 的形态：整条路径 percent-encode 后挂在 asset.localhost 后面
    fn enc(p: &str) -> String {
        p.replace('%', "%25")
            .replace(':', "%3A")
            .replace('/', "%2F")
            .replace('\\', "%5C")
    }

    fn note(id: &str, html: &str) -> Note {
        Note {
            id: id.to_string(),
            title: "t".to_string(),
            content_html: html.to_string(),
            category: None,
            created_at: 1,
            updated_at: 1,
            pinned: false,
            starred: false,
        }
    }

    fn att(id: &str, note_id: &str, path: &str) -> Attachment {
        Attachment {
            id: id.to_string(),
            note_id: note_id.to_string(),
            file_name: path.split(['/', '\\']).next_back().unwrap_or(path).to_string(),
            file_path: path.to_string(),
            file_size: 10,
            mime_type: "image/png".to_string(),
            created_at: 1,
        }
    }

    fn touch(dir: &Path, name: &str) -> String {
        fs::write(&dir.join(name), b"bytes-bytes").unwrap();
        dir.join(name).to_string_lossy().to_string()
    }

    fn setup() -> (Database, String, PathBuf) {
        let dir = std::env::temp_dir().join(format!("desko_orph_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let (db, path) = crate::db::setup_test_db();
        (db, path, dir)
    }

    /// 悬空行在开了外键的连接上插不进去，历史数据只能按老办法造（显式关掉）
    fn insert_legacy_dead_row(db_path: &str, id: &str, note_id: &str, path: &str) {
        let conn = rusqlite::Connection::open(db_path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        conn.execute(
            "INSERT INTO note_attachments (id, note_id, file_name, file_path, file_size, mime_type, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![id, note_id, "x.png", path, 10, "image/png", 1],
        )
        .unwrap();
    }

    /// 实测：这套 bundled SQLite 默认就开着外键，
    /// 所以"删小记留孤儿行"从来不是原因，真正没人管的只有磁盘文件
    #[test]
    fn foreign_keys_are_on_by_default() {
        let (db, path, dir) = setup();
        drop(db);
        let conn = rusqlite::Connection::open(&path).unwrap();
        let on: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(on, 1, "默认值变了的话，删小记的级联行为要重新审");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 有登记的、正文引用的都算活；只有两者皆无的才是垃圾
    #[test]
    fn scan_keeps_registered_and_body_referenced() {
        let (db, dbpath, dir) = setup();
        let registered = touch(&dir, "u1__reg.png");
        let in_body = touch(&dir, "u2__body.png");
        let garbage = touch(&dir, "u3__junk.png");
        let dead_row = touch(&dir, "u4__deadrow.png");

        db.create_note(&note("n1", &format!("<img src=\"http://asset.localhost/{}\">", enc(&in_body))))
            .unwrap();
        db.create_attachment(&att("a1", "n1", &registered)).unwrap();
        // 挂在已不存在的小记上的死行，不该替文件说话
        insert_legacy_dead_row(&dbpath, "a2", "gone", &dead_row);

        let mut names: Vec<String> = scan_in(&db, &dir, Duration::ZERO)
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        names.sort();
        // 垃圾 = 正文不引用 且 没有存活登记；挂在已删小记上的死行不算存活
        assert_eq!(
            names,
            vec!["u3__junk.png".to_string(), "u4__deadrow.png".to_string()],
            "只剩真垃圾: {:?}",
            names
        );
        assert!(Path::new(&garbage).exists(), "扫描本身不删文件");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 宽限期内的新文件不报（草稿正在贴的图就是这个状态）
    #[test]
    fn grace_window_spares_fresh_files() {
        let (db, _dbpath, dir) = setup();
        touch(&dir, "fresh.png");
        assert_eq!(scan_in(&db, &dir, Duration::ZERO).unwrap().len(), 1);
        assert!(
            scan_in(&db, &dir, Duration::from_secs(3600)).unwrap().is_empty(),
            "刚落的盘不能算垃圾"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    /// 清理：删文件 + 删死行；确认时已不孤儿的自动跳过
    #[test]
    fn cleanup_deletes_only_still_orphaned() {
        let (db, dbpath, dir) = setup();
        let junk = touch(&dir, "j1__junk.png");
        let dead = touch(&dir, "j2__dead.png");
        db.create_note(&note("n9", "")).unwrap();
        insert_legacy_dead_row(&dbpath, "a9", "gone", &dead);

        let asked = vec![
            "j1__junk.png".to_string(),
            "j2__dead.png".to_string(),
            "never-existed.png".to_string(),
        ];
        assert_eq!(cleanup_in(&db, &dir, &asked).unwrap(), 2);
        assert!(!Path::new(&junk).exists() && !Path::new(&dead).exists());
        assert!(db.list_live_attachments().unwrap().is_empty(), "死行也要跟着清掉");
        assert_eq!(cleanup_in(&db, &dir, &asked).unwrap(), 0, "重复点不会炸");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 删小记前要能取到路径（行删了就查不到了）
    #[test]
    fn paths_are_collectable_before_note_removal() {
        let (db, _dbpath, dir) = setup();
        let p1 = touch(&dir, "p1.png");
        let p2 = touch(&dir, "p2.png");
        db.create_note(&note("nx", "")).unwrap();
        db.create_attachment(&att("x1", "nx", &p1)).unwrap();
        db.create_attachment(&att("x2", "nx", &p2)).unwrap();
        assert_eq!(db.attachment_paths_for_notes(&["nx".to_string()]).unwrap().len(), 2);
        assert!(db.attachment_paths_for_notes(&["nope".to_string()]).unwrap().is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    /// foreign_keys 打开后，删小记会级联带走附件行
    #[test]
    fn deleting_note_cascades_attachment_rows() {
        let (db, _dbpath, dir) = setup();
        let p = touch(&dir, "c1.png");
        db.create_note(&note("nc", "")).unwrap();
        db.create_attachment(&att("cc", "nc", &p)).unwrap();
        db.delete_note("nc").unwrap();
        assert!(
            db.list_live_attachments().unwrap().is_empty(),
            "CASCADE 没生效说明 foreign_keys 没开"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
