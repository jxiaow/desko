//! 共享目录里的文件操作：安全定位、同名避让、列目录。行为基准 ftp/server.py。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{Local, TimeZone};

pub struct FileEntry {
    pub name: String,
    pub size: u64,
    pub modified: String,
    pub mtime: SystemTime,
}

/// 上传落盘时的 Windows 非法字符与控制字符直接剔除，而不是拒收整个文件。
/// 再取最后一段路径，防止恶意客户端在 filename 里携带 `C:\x\y` 或 `../z`。
pub fn sanitize_upload_name(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        .filter(|c| !c.is_control())
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return None;
    }
    Some(trimmed.to_string())
}

/// 下载定位：只允许裸文件名，任何路径成分都拒绝（同 ftp 版 resolve_file_in_share）。
/// 冒号一并拒绝：Windows 的 `file:stream` 是备用数据流，`file_name()` 不视为分隔符会漏过。
pub fn resolve_file_in_share(share_dir: &Path, filename: &str) -> Option<PathBuf> {
    let safe = Path::new(filename).file_name().and_then(|n| n.to_str())?;
    if safe.is_empty() || safe != filename || safe == "." || safe == ".." || safe.contains(':') {
        return None;
    }
    Some(share_dir.join(safe))
}

/// 同名避让 + 占位：photo.jpg → photo (1).jpg → …，返回前目标名已被 create_new 占住。
/// exists→rename 的旧写法在并发上传时会撞名互相覆盖（Windows rename 是替换语义），
/// 占位把"选名→落盘"之间的窗口关掉；上层随后 rename .part 覆盖这个 0 字节占位。
pub fn claim_available_name(base_dir: &Path, filename: &str) -> std::io::Result<PathBuf> {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let suffix = Path::new(filename)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    let mut index = 0usize;
    loop {
        let cand = if index == 0 {
            base_dir.join(filename)
        } else {
            base_dir.join(format!("{} ({}){}", stem, index, suffix))
        };
        match std::fs::OpenOptions::new().create_new(true).write(true).open(&cand) {
            Ok(_) => return Ok(cand),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                index += 1;
                if index > 10_000 {
                    return Err(e);
                }
            }
            Err(e) => return Err(e),
        }
    }
}

/// 只列文件不列目录，按名升序（忽略大小写），同 ftp 版 list_files
pub fn list_files(base_dir: &Path) -> Vec<FileEntry> {
    let Ok(read_dir) = fs::read_dir(base_dir) else {
        return Vec::new();
    };
    let mut entries = Vec::new();
    for item in read_dir.flatten() {
        let Ok(file_type) = item.file_type() else { continue };
        if !file_type.is_file() {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push(FileEntry {
            modified: format_mtime(mtime),
            size: meta.len(),
            name,
            mtime,
        });
    }
    entries.sort_by_key(|e| e.name.to_lowercase());
    entries
}

fn format_mtime(mtime: SystemTime) -> String {
    let secs = mtime
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Local
        .timestamp_opt(secs, 0)
        .single()
        .map(|t| t.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_else(|| "—".to_string())
}

pub fn format_size(size: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut value = size as f64;
    for unit in UNITS {
        if value < 1024.0 || unit == "PB" {
            return if unit == "B" {
                format!("{} {}", value as u64, unit)
            } else {
                format!("{:.1} {}", value, unit)
            };
        }
        value /= 1024.0;
    }
    unreachable!()
}

pub fn file_type_icon(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "doc" | "docx" | "pdf" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "md" | "rtf" => "doc",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "svg" | "bmp" | "ico" => "img",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" => "zip",
        "mp4" | "avi" | "mkv" | "mov" | "wmv" | "flv" | "webm" => "vid",
        "py" | "js" | "ts" | "json" | "xml" | "yaml" | "yml" | "html" | "css" | "java" | "go"
        | "rs" | "c" | "cpp" | "h" => "code",
        _ => "default",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn sanitize_strips_paths_and_illegal_chars() {
        assert_eq!(sanitize_upload_name("..\\evil.exe").as_deref(), Some("evil.exe"));
        assert_eq!(
            sanitize_upload_name(r"C:\Users\x\docs\report.pdf").as_deref(),
            Some("report.pdf")
        );
        assert_eq!(sanitize_upload_name("a<b>c:d.exe").as_deref(), Some("abcd.exe"));
        assert_eq!(sanitize_upload_name("../../..").as_deref(), None);
        assert_eq!(sanitize_upload_name("..."), None);
        assert_eq!(sanitize_upload_name("   "), None);
        assert_eq!(sanitize_upload_name("photo\r\n.jpg").as_deref(), Some("photo.jpg"));
    }

    #[test]
    fn resolve_rejects_any_path_component() {
        let dir = Path::new("/share");
        assert_eq!(resolve_file_in_share(dir, "a.txt"), Some(PathBuf::from("/share/a.txt")));
        assert_eq!(resolve_file_in_share(dir, "a"), Some(PathBuf::from("/share/a")));
        assert!(resolve_file_in_share(dir, "../a").is_none());
        assert!(resolve_file_in_share(dir, "sub/a").is_none());
        assert!(resolve_file_in_share(dir, "sub\\a").is_none());
        assert!(resolve_file_in_share(dir, "..").is_none());
        // 点开头文件与原版一致：允许
        assert!(resolve_file_in_share(dir, ".hidden").is_some());
        assert!(resolve_file_in_share(dir, "").is_none());
        // file_name() 等价的边界：绝对路径会被拒
        assert!(resolve_file_in_share(dir, "/etc/passwd").is_none());
        // Windows ADS：file_name() 不挡冒号，这里补刀
        assert!(resolve_file_in_share(dir, "notes.txt:hidden").is_none());
        assert!(resolve_file_in_share(dir, "a:b").is_none());
    }

    #[test]
    fn claim_available_name_increments_and_reserves() {
        let tmp = tempfile_dir("claim");
        let first = claim_available_name(&tmp, "photo.jpg").unwrap();
        assert_eq!(first, tmp.join("photo.jpg"));
        assert!(first.exists()); // 占位即建，并发选不到同一个坑
        File::create(tmp.join("photo (1).jpg")).unwrap();
        let third = claim_available_name(&tmp, "photo.jpg").unwrap();
        assert_eq!(third, tmp.join("photo (2).jpg"));
        // 无扩展名
        File::create(tmp.join("LICENSE")).unwrap();
        assert_eq!(claim_available_name(&tmp, "LICENSE").unwrap(), tmp.join("LICENSE (1)"));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn list_files_skips_dirs_and_sorts_case_insensitive() {
        let tmp = tempfile_dir("list");
        File::create(tmp.join("B.txt")).unwrap();
        File::create(tmp.join("a.txt")).unwrap();
        fs::create_dir(tmp.join("zdir")).unwrap();
        let names: Vec<_> = list_files(&tmp).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["a.txt", "B.txt"]);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn format_size_units() {
        assert_eq!(format_size(0), "0 B");
        assert_eq!(format_size(999), "999 B");
        assert_eq!(format_size(1024), "1.0 KB");
        assert_eq!(format_size(1536), "1.5 KB");
        assert_eq!(format_size(5 * 1024 * 1024 * 1024), "5.0 GB");
    }

    #[test]
    fn icon_buckets() {
        assert_eq!(file_type_icon("x.PDF"), "doc");
        assert_eq!(file_type_icon("x.jpeg"), "img");
        assert_eq!(file_type_icon("x.7z"), "zip");
        assert_eq!(file_type_icon("x.mkv"), "vid");
        assert_eq!(file_type_icon("x.rs"), "code");
        assert_eq!(file_type_icon("x.bin"), "default");
        assert_eq!(file_type_icon("noext"), "default");
    }

    fn tempfile_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desko-fs-{}-{}", tag, uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
}
