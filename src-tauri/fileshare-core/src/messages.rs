//! 消息流：一段文字和一个文件是同一层的东西——都带方向、时间、来源，
//! 都排在一条时间线上。旧版的 `texts.json` 只装文字，让文件留在另一套列表里，
//! 用户得先判断"这是哪一类"再决定点哪儿；这里把两类合成一种消息。
//!
//! 落盘形态是档案根下的一份 `messages.json`（不进共享目录，用户翻文件夹不会被它污染）。
//! 两个写入方——desko 命令层与网页端（`POST /text`、`POST /upload`）——各在一个进程里，
//! 所以读-改-写整段共用一把 `.lock` 文件锁，与 config.rs 同一套做法：
//! 锁挂在独立文件上，不随被 rename 替换的正式文件一起换 inode。
//!
//! **文件消息不是文件本体**：它只是"谁在什么时候发过一个叫什么的文件、多大、在哪个共享目录"
//! 这份快照。文件本身仍落在共享目录里，用户去文件夹能找得到；反过来，用户在文件夹里
//! 手动丢进来的文件不会出现在流里（磁盘是外部可变状态，消息是不可变事件）。

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

pub const MESSAGE_FILE: &str = "messages.json";
/// 旧版只装文字的那份，迁移后改名留档
const LEGACY_TEXT_FILE: &str = "texts.json";
/// 单条文字上限：够一段命令、一条链接、半屏日志，再长请走文件
pub const MAX_TEXT_BYTES: usize = 64 * 1024;
/// 保留条数：页面只读最近这一屏，旧的自动掉出。文件消息很轻（只有快照），给两倍余量
pub const MAX_MESSAGES: usize = 200;

/// 方向：谁发的。两端各自把"对面发的"渲染在左侧
pub const DIR_APP: &str = "app";
pub const DIR_WEB: &str = "web";

pub const KIND_TEXT: &str = "text";
pub const KIND_FILE: &str = "file";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Message {
    pub id: String,
    /// `app` = 这台电脑发出；`web` = 网页（任意设备上的浏览器）发来
    pub dir: String,
    /// `text` | `file`
    pub kind: String,
    /// kind=text 时的正文；kind=file 时留空
    pub text: String,
    /// kind=file：落盘后的名字（可能被避让改过名，以实际落盘名为准）
    pub name: String,
    /// kind=file：字节数，纯展示
    pub size: u64,
    /// kind=file：落在第几个共享目录。目录可能被用户改配置，所以连名字一起存
    pub share: usize,
    /// kind=file：落盘时那个目录的显示路径，目录改配置后仍能说清"当时存哪了"
    pub dir_hint: String,
    /// epoch 毫秒：两端各自按本地时区渲染，落盘不存人类可读串
    pub created_ms: i64,
}

impl Default for Message {
    fn default() -> Self {
        Message {
            id: String::new(),
            dir: DIR_APP.to_string(),
            kind: KIND_TEXT.to_string(),
            text: String::new(),
            name: String::new(),
            size: 0,
            share: 0,
            dir_hint: String::new(),
            created_ms: 0,
        }
    }
}

impl Message {
    pub fn is_file(&self) -> bool {
        self.kind == KIND_FILE
    }

    pub fn share_index(&self, dirs: &[PathBuf]) -> Option<usize> {
        if self.dir_hint.is_empty() {
            return dirs.get(self.share).map(|_| self.share);
        }
        dirs.iter().position(|dir| dir == Path::new(&self.dir_hint))
    }

    /// 时间和方向都要给页面用；拼一次省得两端各写一套
    pub fn time(&self) -> String {
        short_time(self.created_ms)
    }
}

#[derive(Default, Serialize, Deserialize)]
struct MessageFile {
    #[serde(default)]
    items: Vec<Message>,
}

pub fn message_path(base_dir: &Path) -> PathBuf {
    base_dir.join(MESSAGE_FILE)
}

/// 跨进程锁：锁文件与正文分家，正文靠 rename 替换，锁始终指向同一个 inode
fn stream_lock(path: &Path) -> Result<std::fs::File, String> {
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path.with_extension("json.lock"))
        .map_err(|e| format!("打开消息锁失败: {e}"))?;
    lock.lock().map_err(|e| format!("获取消息锁失败: {e}"))?;
    Ok(lock)
}

/// 读失败一律当"还没有"：一个坏掉的 messages.json 不该让网页整页打不开
fn read_items(path: &Path) -> Vec<Message> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    match serde_json::from_str::<MessageFile>(&text) {
        Ok(file) => file.items,
        Err(_) => Vec::new(),
    }
}

fn write_items(path: &Path, items: &[Message]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let body =
        serde_json::to_vec_pretty(&MessageFile { items: items.to_vec() }).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("写消息失败: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换消息文件失败: {e}"))
}

/// 按写入顺序返回传输记录，最新的在前。
pub fn list(path: &Path) -> Vec<Message> {
    read_items(path)
}

fn insert(path: &Path, entry: Message) -> Result<Message, String> {
    let _lock = stream_lock(path)?;
    let mut items = read_items(path);
    items.insert(0, entry.clone());
    items.truncate(MAX_MESSAGES);
    write_items(path, &items)?;
    Ok(entry)
}

/// 记一条文字。空内容与超限都拒，由调用方报给用户。
pub fn push_text(path: &Path, content: &str, dir: &str) -> Result<Message, String> {
    if content.trim().is_empty() {
        return Err("还没有内容".to_string());
    }
    if content.len() > MAX_TEXT_BYTES {
        return Err(format!("单条文字最多 {} KB，更长的内容请走文件", MAX_TEXT_BYTES >> 10));
    }
    insert(
        path,
        Message {
            id: next_id(),
            dir: dir.to_string(),
            kind: KIND_TEXT.to_string(),
            text: content.to_string(),
            created_ms: now_ms(),
            ..Default::default()
        },
    )
}

/// 记一条文件。**不碰文件本体**：调用方已经落完盘，这里只留一条可读的快照。
pub fn push_file(
    path: &Path,
    name: &str,
    size: u64,
    share: usize,
    dir_hint: &str,
    dir: &str,
) -> Result<Message, String> {
    if name.trim().is_empty() {
        return Err("文件名为空".to_string());
    }
    insert(
        path,
        Message {
            id: next_id(),
            dir: dir.to_string(),
            kind: KIND_FILE.to_string(),
            name: name.to_string(),
            size,
            share,
            dir_hint: dir_hint.to_string(),
            created_ms: now_ms(),
            ..Default::default()
        },
    )
}

/// 删一条消息；返回是否真删掉了（页面上的按钮可能比库里的数据旧）。
/// **只删消息，不删文件**：磁盘上那份是用户的，删消息不该连坐。
pub fn remove(path: &Path, id: &str) -> Result<bool, String> {
    let _lock = stream_lock(path)?;
    let items = read_items(path);
    let before = items.len();
    let kept: Vec<Message> = items.into_iter().filter(|e| e.id != id).collect();
    if kept.len() == before {
        return Ok(false);
    }
    write_items(path, &kept)?;
    Ok(true)
}

/// 清空消息；返回删掉的条数。同样不碰共享目录里的文件。
pub fn clear(path: &Path) -> Result<usize, String> {
    let _lock = stream_lock(path)?;
    let items = read_items(path);
    if items.is_empty() {
        return Ok(0);
    }
    write_items(path, &[])?;
    Ok(items.len())
}

/// 旧版 `texts.json` 迁进消息流。只做一次：
/// 成功后把旧文件改名成 `.migrated`，用户删了消息也不会被旧文件复活。
pub fn migrate_legacy_texts(base_dir: &Path) {
    let target = message_path(base_dir);
    let legacy = base_dir.join(LEGACY_TEXT_FILE);
    if target.exists() || !legacy.exists() {
        return;
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    struct OldEntry {
        id: String,
        source: String,
        created_ms: i64,
        content: String,
    }
    #[derive(Default, Deserialize)]
    struct OldFile {
        #[serde(default)]
        items: Vec<OldEntry>,
    }
    impl Default for OldEntry {
        fn default() -> Self {
            OldEntry {
                id: String::new(),
                source: DIR_APP.to_string(),
                created_ms: 0,
                content: String::new(),
            }
        }
    }
    let Ok(raw) = std::fs::read_to_string(&legacy) else { return };
    let Ok(old) = serde_json::from_str::<OldFile>(&raw) else { return };
    if old.items.is_empty() {
        let _ = std::fs::rename(&legacy, legacy.with_extension("json.migrated"));
        return;
    }
    let items: Vec<Message> = old
        .items
        .into_iter()
        .filter(|e| !e.content.trim().is_empty())
        .map(|e| Message {
            id: if e.id.is_empty() { next_id() } else { e.id },
            dir: e.source,
            kind: KIND_TEXT.to_string(),
            text: e.content,
            created_ms: e.created_ms,
            ..Default::default()
        })
        .collect();
    if write_items(&target, &items).is_ok() {
        let _ = std::fs::rename(&legacy, legacy.with_extension("json.migrated"));
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 同一毫秒内连发两条也不会撞 id：毫秒 + 进程号 + 进程内自增
fn next_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(
        "{:x}-{:x}-{:x}",
        now_ms(),
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// 给页面与 App 的短时间戳：今天只报时分，跨天补日期
pub fn short_time(created_ms: i64) -> String {
    use chrono::{Datelike, Local, TimeZone};
    let Some(t) = Local.timestamp_millis_opt(created_ms).single() else {
        return "—".to_string();
    };
    let now = Local::now();
    if t.date_naive() == now.date_naive() {
        t.format("%H:%M").to_string()
    } else if t.year() == now.year() {
        t.format("%m-%d %H:%M").to_string()
    } else {
        t.format("%Y-%m-%d %H:%M").to_string()
    }
}

/// 文件大小：与 files.rs 的 format_size 同口径，但那是给列表行用的，
/// 这里要短一点（气泡里一行放不下"1.2 MB (1,258,291 字节)"）
pub fn short_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let n = bytes as f64;
    if n < KB {
        format!("{bytes} B")
    } else if n < MB {
        format!("{:.0} KB", n / KB)
    } else if n < GB {
        format!("{:.1} MB", n / MB)
    } else {
        format!("{:.1} GB", n / GB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path() -> PathBuf {
        std::env::temp_dir()
            .join(format!("desko-msg-{}", uuid::Uuid::new_v4()))
            .join(MESSAGE_FILE)
    }

    fn setup() -> PathBuf {
        let path = tmp_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        path
    }

    fn cleanup(path: &Path) {
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn push_keeps_newest_first() {
        let path = setup();
        push_text(&path, "第一条", DIR_APP).unwrap();
        push_text(&path, "第二条", DIR_WEB).unwrap();
        let items = list(&path);
        assert_eq!(
            items.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(),
            vec!["第二条", "第一条"]
        );
        assert_eq!(items[0].dir, DIR_WEB);
        assert!(items[0].created_ms > 0);
        assert_ne!(items[0].id, items[1].id);
        cleanup(&path);
    }

    #[test]
    fn empty_and_oversized_are_rejected() {
        let path = setup();
        assert!(push_text(&path, "", DIR_APP).is_err());
        assert!(push_text(&path, "   \n\t ", DIR_APP).is_err());
        let huge = "x".repeat(MAX_TEXT_BYTES + 1);
        assert!(push_text(&path, &huge, DIR_APP).is_err());
        assert!(list(&path).is_empty(), "被拒的内容不能落盘");
        cleanup(&path);
    }

    #[test]
    fn file_message_keeps_snapshot_not_content() {
        let path = setup();
        let m = push_file(&path, "报告.pdf", 2488320, 1, "D:\\共享", DIR_WEB).unwrap();
        assert!(m.is_file());
        assert_eq!(m.name, "报告.pdf");
        assert_eq!(m.size, 2488320);
        assert_eq!(m.share, 1);
        assert_eq!(m.dir_hint, "D:\\共享");
        assert!(m.text.is_empty(), "文件消息不带正文");
        // 落盘再读一遍：字段名是对外的 camelCase，不能写成 snake_case
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"createdMs\""), "{raw}");
        assert!(raw.contains("\"dirHint\""), "{raw}");
        assert!(!raw.contains("\"created_ms\""));
        cleanup(&path);
    }

    #[test]
    fn keeps_only_the_newest_batch() {
        let path = setup();
        for i in 0..(MAX_MESSAGES + 5) {
            push_text(&path, &format!("第 {i} 条"), DIR_APP).unwrap();
        }
        let items = list(&path);
        assert_eq!(items.len(), MAX_MESSAGES);
        assert_eq!(items[0].text, format!("第 {} 条", MAX_MESSAGES + 4));
        cleanup(&path);
    }

    #[test]
    fn remove_and_clear_report_what_they_did() {
        let path = setup();
        let a = push_text(&path, "留下", DIR_APP).unwrap();
        let b = push_file(&path, "删掉.txt", 12, 0, "C:\\s", DIR_WEB).unwrap();
        assert!(remove(&path, &b.id).unwrap());
        assert!(!remove(&path, &b.id).unwrap(), "删过的再删一次要如实回 false");
        assert_eq!(list(&path).len(), 1);
        assert_eq!(list(&path)[0].id, a.id);
        assert_eq!(clear(&path).unwrap(), 1);
        assert!(list(&path).is_empty());
        assert_eq!(clear(&path).unwrap(), 0);
        cleanup(&path);
    }

    #[test]
    fn corrupt_file_reads_as_empty_and_does_not_block_writes() {
        let path = setup();
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(list(&path).is_empty());
        push_text(&path, "重来一条", DIR_APP).unwrap();
        assert_eq!(list(&path).len(), 1);
        cleanup(&path);
    }

    #[test]
    fn missing_file_is_just_empty() {
        assert!(list(&tmp_path()).is_empty());
    }

    #[test]
    fn legacy_texts_become_messages_once() {
        let base = std::env::temp_dir().join(format!("desko-mig-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let legacy = base.join(LEGACY_TEXT_FILE);
        std::fs::write(
            &legacy,
            r#"{"items":[{"id":"old1","source":"web","createdMs":1700000000000,"content":"旧的一条"}]}"#,
        )
        .unwrap();

        migrate_legacy_texts(&base);
        let items = list(&message_path(&base));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "旧的一条");
        assert_eq!(items[0].dir, DIR_WEB, "旧 source 要原样接成方向");
        assert_eq!(items[0].created_ms, 1_700_000_000_000);
        assert!(!legacy.exists(), "迁完要改名，否则删掉消息会被旧文件复活");
        assert!(base.join("texts.json.migrated").exists());

        // 再跑一次不该把内容搬回来（messages.json 已存在）
        migrate_legacy_texts(&base);
        assert_eq!(list(&message_path(&base)).len(), 1);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn empty_legacy_file_is_retired_without_writing_stream() {
        let base = std::env::temp_dir().join(format!("desko-mig0-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join(LEGACY_TEXT_FILE), r#"{"items":[]}"#).unwrap();
        migrate_legacy_texts(&base);
        assert!(!message_path(&base).exists(), "没有内容就别留一个空消息文件");
        assert!(!base.join(LEGACY_TEXT_FILE).exists());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn short_time_falls_back_for_bad_values() {
        // 超出 chrono 能表达的范围才算坏值；负毫秒仍是合法时间，照常渲染
        assert_eq!(short_time(i64::MAX), "—");
        // 今天只报时分，长度 5；跨年才带上年份
        let now = now_ms();
        assert_eq!(short_time(now).len(), 5, "{}", short_time(now));
        assert!(short_time(0).len() >= 5);
    }

    #[test]
    fn short_size_stays_tight() {
        assert_eq!(short_size(820), "820 B");
        assert_eq!(short_size(2488320), "2.4 MB");
        assert_eq!(short_size(1536), "2 KB");
        assert_eq!(short_size(5 * 1024 * 1024 * 1024), "5.0 GB");
    }
}
