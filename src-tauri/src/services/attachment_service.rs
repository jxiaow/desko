use crate::db::{Attachment, Database};
use crate::error::AppError;
use std::fs;
use std::path::{Path, PathBuf};

/// 附件统一落在这个目录，asset: 协议的白名单也只看它（见 main.rs 的 allow_directory）。
/// 具体位置由当前档案根决定（多档案 D1/D2），见 `crate::paths`。
pub fn attachments_dir() -> PathBuf {
    crate::paths::attachments_dir()
}

/// 正文里附件 src 的前缀。库里存 `attachments/<文件名>`，显示时再由前端拼本机目录 ——
/// 绝对路径带着用户名和 APPDATA，换台机器（甚至换个 Windows 账号）就全对不上，
/// 迁移包过去之后图片一张都显示不出来。
pub const SRC_DIR: &str = "attachments";

/// 任何来路的写法 → 附件目录下的文件名。
///
/// 认这些形态：裸文件名、`attachments/<名>`、本机或外机的绝对路径、
/// `asset://…`/`http://asset.localhost/…`（老数据把整条绝对路径 encode 成 URL 最后一段）。
/// 非法名（空、`.`、`..`、还带盘符）返回 None，不放它拼进路径。
pub fn name_of(raw: &str) -> Option<String> {
    let tail = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let decoded = if tail.contains('%') {
        crate::webdav::percent_decode(tail)
    } else {
        tail.to_string()
    };
    let name = decoded.rsplit(['/', '\\']).next().unwrap_or(&decoded);
    if name.is_empty() || name == "." || name == ".." || name.contains(':') {
        return None;
    }
    Some(name.to_string())
}

/// 库里存的值 → 本机绝对路径。只在真要碰文件系统时经过这里。
pub fn abs_of(stored: &str) -> Option<PathBuf> {
    Some(attachments_dir().join(name_of(stored)?))
}

/// 正文的一个 `src` 值 → 附件文件名；不是我们自己的附件（外链、data:、blob:）返回 None
pub fn name_from_src(src: &str) -> Option<String> {
    let ours = src.starts_with("asset://")
        || src.contains("asset.localhost")
        || src.starts_with(&format!("{SRC_DIR}/"))
        || src.starts_with("desko-asset://");
    if !ours {
        return None;
    }
    name_of(src)
}

/// src 写回库里的规范形态
pub fn src_of(name: &str) -> String {
    format!("{SRC_DIR}/{name}")
}

/// 把正文里的附件 src 洗成规范形态 `attachments/<文件名>`：绝对路径、老 `asset://` URL
/// 都收进来；外链、data:、blob: 原样留着。返回 (新 html, 改了几处)。
pub fn canonicalize_html(html: &str) -> (String, usize) {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    let mut changed = 0;
    while let Some(i) = rest.find("src=\"") {
        out.push_str(&rest[..i + 5]);
        rest = &rest[i + 5..];
        let end = match rest.find('"') {
            Some(e) => e,
            None => {
                out.push_str(rest);
                rest = "";
                break;
            }
        };
        let src = &rest[..end];
        match name_from_src(src).map(|n| src_of(&n)) {
            Some(want) if want != src => {
                out.push_str(&want);
                changed += 1;
            }
            _ => out.push_str(src),
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    (out, changed)
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
    let name = stored_file_name(&id, &file_name);
    let target_path = dir.join(&name);
    fs::copy(source, &target_path)
        .map_err(|e| AppError::Io(format!("Failed to copy file: {}", e)))?;
    let file_size = fs::metadata(&target_path)
        .map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))?
        .len() as i64;

    Ok(Attachment {
        id,
        note_id: String::new(),
        file_name,
        // 只存文件名：绝对路径进库就等于把这台机器写进了数据里
        file_path: name,
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
/// 只认附件目录里那个文件，正文塞外链或别处的绝对路径都不会被记进库。
pub fn bind_paths(db: &Database, note_id: &str, paths: &[String]) -> Result<Vec<Attachment>, AppError> {
    let dir = attachments_dir();
    let existing = db.list_attachments(note_id)?;
    let mut bound = Vec::new();

    for raw in paths {
        let Some(name) = name_of(raw) else { continue };
        let path = dir.join(&name);
        if !path.is_file() {
            continue;
        }
        if existing
            .iter()
            .any(|a| name_of(&a.file_path).as_deref() == Some(name.as_str()))
        {
            continue;
        }
        // 名字形如 <uuid>__<原名>；老数据是 <uuid>.<ext>，取整段当 id、原名未知
        let (id, file_name) = match name.split_once("__") {
            Some((id, rest)) => (id.to_string(), rest.to_string()),
            None => (
                Path::new(&name).file_stem().unwrap_or_default().to_string_lossy().to_string(),
                name.clone(),
            ),
        };
        let file_size = fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
        let mime_type = mime_of(
            &path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string(),
        );
        let attachment = Attachment {
            id,
            note_id: note_id.to_string(),
            file_name,
            file_path: name,
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
    if let Some(stored) = db.delete_attachment(id)? {
        // 删除物理文件
        match abs_of(&stored) {
            Some(p) => {
                if let Err(e) = fs::remove_file(&p) {
                    eprintln!("Warning: Failed to delete attachment file {}: {}", stored, e);
                }
            }
            None => eprintln!("Warning: 附件路径认不出来，文件留着: {stored}"),
        }
    }
    Ok(())
}

/// 删小记时连带清文件。行已经删了，路径必须提前取出来。
/// 单个文件删不掉（被占用等）只记警告，不能让删小记本身失败。
pub fn delete_files(stored: &[String]) {
    delete_files_in(&attachments_dir(), stored)
}

/// 目录可注入版，测试和清理路径都走这里
pub fn delete_files_in(dir: &Path, stored: &[String]) {
    for s in stored {
        let Some(name) = name_of(s) else { continue };
        let p = dir.join(name);
        if let Err(e) = fs::remove_file(&p) {
            if p.exists() {
                eprintln!("Warning: 附件文件未删除 {}: {}", s, e);
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

/// 从正文里抠出被引用的附件文件名。规范形态是 `src="attachments/<名>"`；
/// 历史数据里那批 `asset://…` / `http://asset.localhost/<整条绝对路径 encode>` 也照旧认，
/// 直到启动归一（见 db 的 normalize_attachment_paths）把它们洗完为止。
fn referenced_names(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("src=\"") {
        rest = &rest[i + 5..];
        let end = rest.find('"').unwrap_or(rest.len());
        let src = &rest[..end];
        if let Some(n) = name_from_src(src) {
            out.push(n);
        }
        rest = &rest[end..];
    }
    out
}

/// 这份库认领的附件文件名：存活登记表里的 + 正文 <img src> 引用的。
/// 判"未引用"和算"导出要带哪些"用的是同一份证据，两处必须同进同退。
pub fn claimed_names(db: &Database) -> Result<std::collections::HashSet<String>, AppError> {
    let mut live: std::collections::HashSet<String> = std::collections::HashSet::new();
    for a in db.list_live_attachments()? {
        if let Some(n) = name_of(&a.file_path) {
            live.insert(n);
        }
    }
    for html in db.all_note_html()? {
        for n in referenced_names(&html) {
            live.insert(n);
        }
    }
    Ok(live)
}

/// 库里真认领、且确实躺在 dir 里的文件名（已排序去重）。导出迁移包按这份清单装附件本体，
/// 不装整个目录 —— 目录里可能堆着几十 MB 没人引用的历史文件。
pub fn export_names(db: &Database, dir: &Path) -> Result<Vec<String>, AppError> {
    let mut names: Vec<String> = claimed_names(db)?
        .into_iter()
        .filter(|n| dir.join(n).is_file())
        .collect();
    names.sort();
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
    let live = claimed_names(db)?;

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
        if live.contains(&name) {
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
    // 库里存的就是文件名，两边直接对得上
    db.delete_attachments_by_paths(&still_orphan)?;
    delete_files_in(dir, &still_orphan);
    Ok(still_orphan.len())
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
            encrypted: false,
        }
    }

    /// 库里存的 file_path 就是附件目录下的文件名（不是绝对路径）
    fn att(id: &str, note_id: &str, name: &str) -> Attachment {
        Attachment {
            id: id.to_string(),
            note_id: note_id.to_string(),
            file_name: name.to_string(),
            file_path: name.to_string(),
            file_size: 10,
            mime_type: "image/png".to_string(),
            created_at: 1,
        }
    }

    /// 造一个附件文件，返回它的文件名（库里存的那个值）
    fn touch(dir: &Path, name: &str) -> String {
        fs::write(&dir.join(name), b"bytes-bytes").unwrap();
        name.to_string()
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

    /// 库里不管存过哪种写法，最后都要归成附件目录下的那个文件名
    #[test]
    fn name_of_accepts_every_stored_form() {
        assert_eq!(name_of("u1__a.png").as_deref(), Some("u1__a.png"));
        assert_eq!(name_of("attachments/u1__a.png").as_deref(), Some("u1__a.png"));
        assert_eq!(
            name_of(r"C:\Users\jiang\AppData\Roaming\desko\attachments\u1__a.png").as_deref(),
            Some("u1__a.png"),
            "老的绝对路径要能认"
        );
        let legacy = format!("http://asset.localhost/{}", enc(r"C:\x\attachments\u1__a.png"));
        assert_eq!(name_from_src(&legacy).as_deref(), Some("u1__a.png"));
        assert_eq!(name_from_src("asset://localhost/u1__a.png").as_deref(), Some("u1__a.png"));
        assert_eq!(name_from_src("https://example.com/a.png"), None, "外链不算我们的附件");
        assert_eq!(name_from_src("data:image/png;base64,AAAA"), None);
        // 只取最后一段，所以路径穿越天然出局：名字再花也逃不出附件目录
        assert_eq!(name_of("../../etc/passwd").as_deref(), Some("passwd"));
        assert_eq!(name_of(r"..\\..\windows\notepad.exe").as_deref(), Some("notepad.exe"));
        assert_eq!(abs_of("../../../evil.png").unwrap(), attachments_dir().join("evil.png"));
        assert_eq!(name_of("attachments/"), None, "空名要拒");
        assert_eq!(name_of(""), None);
    }

    /// 归一：老正文里的 asset URL 换成 attachments/<名>，外链一字不动，且再跑一遍不变
    #[test]
    fn canonicalize_html_rewrites_only_our_assets() {
        let abs = r"C:\Users\other\AppData\Roaming\desko\attachments\u9__b.png";
        let html = format!(
            "<p>看</p><img src=\"http://asset.localhost/{}\"><img src=\"asset://localhost/{}\">\
             <img src=\"https://e.com/x.png\"><img src=\"attachments/keep__k.png\">",
            enc(abs),
            enc("u9__b.png"),
        );
        let (out, n) = canonicalize_html(&html);
        assert_eq!(n, 2, "两条绝对路径的写法都要改，外链和已经规范的不动");
        assert_eq!(
            out,
            "<p>看</p><img src=\"attachments/u9__b.png\"><img src=\"attachments/u9__b.png\">\
             <img src=\"https://e.com/x.png\"><img src=\"attachments/keep__k.png\">"
        );
        assert_eq!(canonicalize_html(&out).1, 0, "幂等：洗过的不用再洗");
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

        db.create_note(&note("n1", &format!("<img src=\"{}\">", src_of(&in_body))))
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
        assert!(dir.join(&garbage).exists(), "扫描本身不删文件");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 正文引用一律按文件名认领：就算库里那行还没补上（草稿刚发布），图也不该被当垃圾
    #[test]
    fn relative_src_claims_the_file() {
        let (db, _dbpath, dir) = setup();
        touch(&dir, "u5__only-in-body.png");
        assert_eq!(scan_in(&db, &dir, Duration::ZERO).unwrap().len(), 1, "没人引用");
        db.create_note(&note("n5", "<img src=\"attachments/u5__only-in-body.png\">"))
            .unwrap();
        assert!(scan_in(&db, &dir, Duration::ZERO).unwrap().is_empty(), "换相对写法就该认出来");
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
        assert!(!dir.join(&junk).exists() && !dir.join(&dead).exists());
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
