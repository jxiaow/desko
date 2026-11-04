use crate::{apply_pins, parse_managed, Pin, TaskItem, HOSTS_BEGIN, HOSTS_END};
use std::collections::BTreeMap;
use std::ops::Range;

// 标记与记录都是 ASCII；按原始字节定位，不能用 lossy 文本的偏移切 GBK 文件。
fn managed_span(bytes: &[u8]) -> Result<Option<Range<usize>>, String> {
    parse_managed(&String::from_utf8_lossy(bytes))?;
    let mut start = None;
    let mut offset = 0;
    for line in bytes.split_inclusive(|b| *b == b'\n') {
        let text = String::from_utf8_lossy(line);
        if text.trim() == HOSTS_BEGIN { start = Some(offset); }
        offset += line.len();
        if text.trim() == HOSTS_END {
            return Ok(start.map(|at| at..offset));
        }
    }
    Ok(None)
}

fn replace_block(bytes: &[u8], block: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    if let Some(span) = managed_span(bytes)? {
        out.extend_from_slice(&bytes[..span.start]);
        out.extend_from_slice(block);
        if !block.is_empty() && !block.ends_with(b"\n") && span.end < bytes.len() {
            out.extend_from_slice(b"\n");
        }
        out.extend_from_slice(&bytes[span.end..]);
    } else {
        out.extend_from_slice(bytes);
        if !block.is_empty() {
            let eol: &[u8] = if bytes.windows(2).any(|w| w == b"\r\n") { b"\r\n" } else { b"\n" };
            if !bytes.is_empty() {
                if !bytes.ends_with(b"\n") { out.extend_from_slice(eol); }
                out.extend_from_slice(eol);
            }
            out.extend_from_slice(block);
        }
    }
    Ok(out)
}

/// 只改托管区，块外编码、混合换行和空白字节都保持原样。
pub fn apply_pins_bytes(bytes: &[u8], pins: &[Pin]) -> Result<(Vec<u8>, usize), String> {
    let (rendered, changed) = apply_pins(&String::from_utf8_lossy(bytes), pins)?;
    if changed == 0 { return Ok((bytes.to_vec(), 0)); }
    let span = managed_span(rendered.as_bytes())?.ok_or("生成的 hosts 托管区缺失")?;
    Ok((replace_block(bytes, &rendered.as_bytes()[span])?, changed))
}

/// 撤销只还原托管区，保留备份后由用户或其他应用更改的普通 hosts 记录。
pub fn restore_managed_bytes(current: &[u8], backup: &[u8]) -> Result<Vec<u8>, String> {
    let span = managed_span(backup)?;
    let block = span.map(|span| &backup[span]).unwrap_or_default();
    replace_block(current, block)
}

/// 只更新指定的托管域名；清理历史备份时也使用同一套规则，避免日后撤销复活已移除目标。
pub fn replace_managed_hosts_bytes(bytes: &[u8], replacements: &BTreeMap<String, Option<String>>) -> Result<Vec<u8>, String> {
    let mut entries = parse_managed(&String::from_utf8_lossy(bytes))?;
    let before = entries.clone();
    for (host, address) in replacements {
        entries.remove(&host.to_lowercase());
        if let Some(address) = address {
            // 沿用写入校验，禁止原记录或任务书注入额外 hosts 行。
            apply_pins("", &[Pin { host: host.clone(), address: address.clone() }])?;
            entries.insert(host.to_lowercase(), address.clone());
        }
    }
    if entries == before { return Ok(bytes.to_vec()); }
    let eol = if bytes.windows(2).any(|w| w == b"\r\n") { "\r\n" } else { "\n" };
    let block = if entries.is_empty() { String::new() } else {
        format!("{HOSTS_BEGIN}{eol}{}{HOSTS_END}{eol}", entries.iter().map(|(host, ip)| format!("{ip} {host}{eol}")).collect::<String>())
    };
    replace_block(bytes, block.as_bytes())
}

pub fn cleanup_hosts_bytes(bytes: &[u8], items: &[TaskItem]) -> Result<Vec<u8>, String> {
    let entries = parse_managed(&String::from_utf8_lossy(bytes))?;
    let mut replacements = BTreeMap::new();
    for item in items {
        if let TaskItem::CleanupHost { host, address, original, .. } = item {
            let current = entries.get(&host.to_lowercase());
            if current == original.as_ref() { continue; } // 已完成的清理可安全重试。
            if current != Some(address) { return Err(format!("{host} 的 hosts 配置已变化，尚未移除，请重新检查")); }
            replacements.insert(host.to_lowercase(), original.clone());
        }
    }
    replace_managed_hosts_bytes(bytes, &replacements)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin() -> Pin { Pin { host: "a.example.com".into(), address: "10.0.0.2".into() } }

    #[test]
    fn cleanup_removes_only_the_selected_managed_host_and_preserves_raw_bytes() {
        let bytes = [b"# header: \xff\r\n127.0.0.1 localhost\n".as_slice(), format!("{HOSTS_BEGIN}\r\n10.0.0.2 a.example.com\r\n10.0.0.3 b.example.com\r\n{HOSTS_END}\r\n").as_bytes(), b"10.0.0.9 outside.example.com\n"].concat();
        let item = TaskItem::CleanupHost { id: "a".into(), host: "a.example.com".into(), address: "10.0.0.2".into(), original: None };
        let result = cleanup_hosts_bytes(&bytes, &[item.clone()]).unwrap();
        assert!(result.starts_with(b"# header: \xff\r\n127.0.0.1 localhost\n"));
        assert!(result.ends_with(b"10.0.0.9 outside.example.com\n"));
        let entries = parse_managed(&String::from_utf8_lossy(&result)).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries.get("b.example.com").unwrap(), "10.0.0.3");
        assert_eq!(cleanup_hosts_bytes(&result, &[item]).unwrap(), result);
    }

    #[test]
    fn cleanup_restores_the_original_pin_and_refuses_to_overwrite_external_changes() {
        let bytes = format!("{HOSTS_BEGIN}\n10.0.0.2 a.example.com\n{HOSTS_END}\n");
        let item = TaskItem::CleanupHost { id: "a".into(), host: "a.example.com".into(), address: "10.0.0.2".into(), original: Some("10.0.0.1".into()) };
        let result = cleanup_hosts_bytes(bytes.as_bytes(), &[item.clone()]).unwrap();
        assert_eq!(parse_managed(&String::from_utf8_lossy(&result)).unwrap()["a.example.com"], "10.0.0.1");
        assert_eq!(cleanup_hosts_bytes(&result, &[item.clone()]).unwrap(), result);
        let changed = bytes.replace("10.0.0.2", "10.0.0.99");
        assert!(cleanup_hosts_bytes(changed.as_bytes(), &[item]).is_err());
        let result = replace_managed_hosts_bytes(bytes.as_bytes(), &BTreeMap::from([("a.example.com".into(), None)])).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn writing_preserves_non_utf8_comments_and_mixed_line_endings() {
        let prefix = b"# GBK: \xd6\xd0\xce\xc4\r\n127.0.0.1 localhost\n\n";
        let suffix = b"\n# tail: \xff\r\n10.0.0.9 other.example.com";
        let bytes = [prefix.as_slice(), format!("{HOSTS_BEGIN}\r\n10.0.0.1 a.example.com\r\n{HOSTS_END}\r\n").as_bytes(), suffix.as_slice()].concat();
        let (written, changed) = apply_pins_bytes(&bytes, &[pin()]).unwrap();
        assert_eq!(changed, 1);
        assert!(written.starts_with(prefix));
        assert!(written.ends_with(suffix));
        let (again, changed) = apply_pins_bytes(&written, &[pin()]).unwrap();
        assert_eq!(again, written);
        assert_eq!(changed, 0);
    }

    #[test]
    fn creating_a_block_keeps_the_original_file_as_a_prefix() {
        let original = b"# comment: \xff\r\n127.0.0.1 localhost\r\n\r\n";
        let (written, _) = apply_pins_bytes(original, &[pin()]).unwrap();
        assert!(written.starts_with(original));
    }

    #[test]
    fn reverting_keeps_new_unmanaged_entries_and_restores_only_the_block() {
        let original_block = format!("{HOSTS_BEGIN}\n10.0.0.1 a.example.com\n{HOSTS_END}\n");
        let backup = [b"# old header\n".as_slice(), original_block.as_bytes()].concat();
        let current = [b"# changed header: \xff\n".as_slice(), format!("{HOSTS_BEGIN}\n10.0.0.2 a.example.com\n{HOSTS_END}\n").as_bytes(), b"10.0.0.9 newly-added.example.com\n"].concat();
        let restored = restore_managed_bytes(&current, &backup).unwrap();
        assert!(restored.starts_with(b"# changed header: \xff\n"));
        assert!(restored.ends_with(b"10.0.0.9 newly-added.example.com\n"));
        assert_eq!(parse_managed(&String::from_utf8_lossy(&restored)).unwrap().get("a.example.com").unwrap(), "10.0.0.1");
        let without_block = restore_managed_bytes(&current, b"# no previous managed block\n").unwrap();
        assert_eq!(without_block, b"# changed header: \xff\n10.0.0.9 newly-added.example.com\n");
    }

    #[test]
    fn malformed_markers_cannot_be_overwritten_during_revert() {
        let broken = format!("{HOSTS_BEGIN}\n10.0.0.1 a.example.com\n");
        assert!(restore_managed_bytes(broken.as_bytes(), b"").is_err());
        assert!(restore_managed_bytes(b"", broken.as_bytes()).is_err());
    }

    #[test]
    fn invalid_host_cannot_inject_an_extra_hosts_record() {
        for host in ["a.example.com\n10.0.0.9 injected.example.com", "a b.example.com", "-a.example.com"] {
            assert!(apply_pins_bytes(b"# unchanged\n", &[Pin { host: host.into(), ..pin() }]).is_err());
        }
    }
}
