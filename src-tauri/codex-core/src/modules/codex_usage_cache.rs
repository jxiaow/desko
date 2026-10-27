//! 仅缓存 Token 统计事件，不保存聊天正文或金额；价格更新不需要重扫日志。
use super::UsageFileEntry;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn cache_path(source: &Path) -> Option<PathBuf> {
    let mut hash = Sha256::new();
    hash.update(b"usage-events-v3\0");
    hash.update(source.as_os_str().as_encoded_bytes());
    Some(crate::modules::config::get_data_dir().ok()?
        .join("codex-usage-cache").join(format!("{:x}.json", hash.finalize())))
}

pub(super) fn read(source: &Path, file_len: u64, modified_at: Option<SystemTime>) -> Option<UsageFileEntry> {
    modified_at?;
    let entry: UsageFileEntry = serde_json::from_slice(&fs::read(cache_path(source)?).ok()?).ok()?;
    (entry.file_len == file_len && entry.modified_at == modified_at).then_some(entry)
}

pub(super) fn write(source: &Path, entry: &UsageFileEntry) {
    if entry.modified_at.is_none() { return; }
    let Some(path) = cache_path(source) else { return; };
    let Ok(content) = serde_json::to_vec(entry) else { return; };
    // 缓存是可丢弃数据，写入失败不影响统计；沿用原子写以避免半份文件。
    let _ = crate::modules::atomic_write::write_bytes_atomic(&path, &content);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::codex_session_manager::scan_usage_events;

    #[test]
    fn disk_cache_round_trip_rejects_changed_metadata_and_corruption() {
        let dir = std::env::temp_dir().join(format!("usage-disk-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("rollout.jsonl");
        fs::write(&source, concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"cache-test\",\"model\":\"gpt-5.4\"}}\n",
            "{\"type\":\"event_msg\",\"timestamp\":\"2026-10-22T01:00:00Z\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":100,\"cached_input_tokens\":80,\"output_tokens\":10,\"total_tokens\":110}}}}\n"
        )).unwrap();
        let meta = fs::metadata(&source).unwrap();
        let entry = scan_usage_events(&source, meta.len(), meta.modified().ok()).unwrap();
        write(&source, &entry);
        let cached = read(&source, entry.file_len, entry.modified_at).unwrap();
        assert_eq!(cached.session_id.as_deref(), Some("cache-test"));
        assert_eq!(cached.models, entry.models);
        assert_eq!(cached.events.len(), 1);
        assert_eq!(cached.events[0].cumulative, entry.events[0].cumulative);
        assert_eq!(cached.events[0].usage, entry.events[0].usage);
        assert!(read(&source, entry.file_len + 1, entry.modified_at).is_none());
        assert!(read(&source, entry.file_len, None).is_none());
        assert!(read(&source, entry.file_len, Some(SystemTime::UNIX_EPOCH)).is_none());
        let path = cache_path(&source).unwrap();
        fs::write(&path, b"broken").unwrap();
        assert!(read(&source, entry.file_len, entry.modified_at).is_none());
        let _ = fs::remove_file(path);
        fs::remove_dir_all(dir).unwrap();
    }
}
