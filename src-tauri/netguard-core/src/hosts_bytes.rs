use crate::{apply_pins, parse_managed, Pin, HOSTS_BEGIN, HOSTS_END};
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

#[cfg(test)]
mod tests {
    use super::*;

    fn pin() -> Pin { Pin { host: "a.example.com".into(), address: "10.0.0.2".into() } }

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
