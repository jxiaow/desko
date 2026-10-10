use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

/// favicon 缓存目录：扁平一档文件，asset: 协议白名单只看它（见 main.rs 的 allow_directory）。
/// 位置由当前档案根决定（多档案 D1/D2），见 `crate::paths`。
pub fn favicons_dir() -> PathBuf {
    crate::paths::favicons_dir()
}

const EXTS: [&str; 5] = ["ico", "png", "gif", "webp", "svg"];
const MAX_BYTES: u64 = 256 * 1024;
/// 抓不到的站记 .miss，七天内不再重试，免得每次开列表都吃一遍超时
const MISS_TTL_SECS: u64 = 7 * 24 * 3600;

/// url → (scheme, "host:port")。只认 http/https；authority 统一小写做缓存键。
pub fn split_url(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return None;
    }
    Some((scheme, authority.to_lowercase()))
}

fn key_hex(authority: &str) -> String {
    Sha256::digest(authority.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn cached_path(authority: &str) -> Option<PathBuf> {
    let dir = favicons_dir();
    let hex = key_hex(authority);
    EXTS.iter().find_map(|e| {
        let p = dir.join(format!("{hex}.{e}"));
        p.is_file().then_some(p)
    })
}

fn in_miss_cooldown(authority: &str) -> bool {
    let p = favicons_dir().join(format!("{}.miss", key_hex(authority)));
    p.metadata()
        .and_then(|m| m.modified())
        .map(|t| {
            t.elapsed()
                .map(|d| d.as_secs() < MISS_TTL_SECS)
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

/// 只认字节特征，不信 content-type：不少站把 favicon 标成 octet-stream，
/// 反过来也有 200 页面包——text/html 一律拒。
fn sniff_ext(bytes: &[u8], content_type: &str) -> Option<&'static str> {
    if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some("ico");
    }
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(256)]).trim_start().to_string();
    if head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg")) {
        return Some("svg");
    }
    match content_type {
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/x-icon" | "image/vnd.microsoft.icon" | "image/icon" => Some("ico"),
        "image/svg+xml" => Some("svg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn fetch_icon(agent: &ureq::Agent, url: &str) -> Option<(Vec<u8>, &'static str)> {
    let resp = agent.get(url).call().ok()?;
    if resp.status() != 200 {
        return None;
    }
    let content_type = resp.header("content-type").unwrap_or("").to_lowercase();
    if content_type.contains("text/html") {
        return None;
    }
    let mut buf = Vec::new();
    resp.into_reader()
        .take(MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .ok()?;
    if buf.is_empty() || buf.len() as u64 > MAX_BYTES {
        return None;
    }
    let ext = sniff_ext(&buf, content_type.as_str())?;
    Some((buf, ext))
}

/// 收藏页行首档面的唯一入口：命中缓存直接给路径，未命中现抓一次。
/// 返回绝对路径字符串；抓不到/在冷却期给 None，前端落字母块兜底。
pub fn resolve(url: &str) -> Option<String> {
    let (scheme, authority) = split_url(url)?;
    if let Some(p) = cached_path(&authority) {
        return Some(p.to_string_lossy().into_owned());
    }
    if in_miss_cooldown(&authority) {
        return None;
    }

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .build();
    let mut candidates: Vec<String> = Vec::new();
    for s in [scheme.as_str(), "https", "http"] {
        let c = format!("{s}://{authority}/favicon.ico");
        if !candidates.contains(&c) {
            candidates.push(c);
        }
    }
    let hit = candidates.iter().find_map(|c| fetch_icon(&agent, c));

    let dir = favicons_dir();
    let hex = key_hex(&authority);
    match hit {
        Some((bytes, ext)) => {
            std::fs::create_dir_all(&dir).ok()?;
            let path = dir.join(format!("{hex}.{ext}"));
            std::fs::write(&path, &bytes).ok()?;
            let _ = std::fs::remove_file(dir.join(format!("{hex}.miss")));
            Some(path.to_string_lossy().into_owned())
        }
        None => {
            if std::fs::create_dir_all(&dir).is_ok() {
                let _ = std::fs::write(dir.join(format!("{hex}.miss")), b"");
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_url_takes_authority_and_lowercases() {
        assert_eq!(
            split_url("HTTP://Example.COM:8080/view/job/x?a=1"),
            Some(("http".into(), "example.com:8080".into()))
        );
        assert_eq!(
            split_url("https://github.com/repo").map(|(_, a)| a),
            Some("github.com".into())
        );
    }

    #[test]
    fn split_url_rejects_non_http_and_bare_forms() {
        assert_eq!(split_url("ftp://host/favicon.ico"), None);
        assert_eq!(split_url("not a url"), None);
        assert_eq!(split_url("https:///nohost"), None);
        assert_eq!(split_url("file:///C:/x"), None);
    }

    #[test]
    fn sniff_recovers_extension_from_magic_bytes() {
        assert_eq!(sniff_ext(&[0x00, 0x00, 0x01, 0x00, 1, 2], ""), Some("ico"));
        assert_eq!(sniff_ext(&[0x89, b'P', b'N', b'G', 13, 10], "application/octet-stream"), Some("png"));
        assert_eq!(sniff_ext(b"GIF89a....", ""), Some("gif"));
        let mut webp = b"RIFF\x00\x00\x00\x00WEBPVP8 ".to_vec();
        webp[4..8].copy_from_slice(&[9, 0, 0, 0]);
        assert_eq!(sniff_ext(&webp, ""), Some("webp"));
        assert_eq!(sniff_ext(b"  <svg xmlns='...'>", ""), Some("svg"));
    }

    #[test]
    fn sniff_rejects_html_and_junk() {
        assert_eq!(sniff_ext(b"<!DOCTYPE html>", "text/html; charset=utf-8"), None);
        assert_eq!(sniff_ext(b"random", "application/octet-stream"), None);
    }

    /// 真网络抓取只在手动执行时跑：cargo test -- --ignored
    #[test]
    #[ignore]
    fn resolve_fetches_real_site() {
        let path = resolve("https://github.com").expect("github favicon 应抓到");
        let p = std::path::Path::new(&path);
        assert!(p.is_file());
        assert_eq!(p.parent().unwrap(), favicons_dir().as_path());
        let second = resolve("https://github.com/desko/desko");
        assert_eq!(
            second.as_deref(),
            Some(path.as_str()),
            "同 authority 不同路径应命中同一缓存"
        );
    }
}
