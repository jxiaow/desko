//! 网页端用到的零依赖小工具：HTML 转义、百分号编解码、query/cookie 解析、MIME 猜测。

pub fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

fn unreserved(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
}

/// 与 Python quote_plus 对齐（空格转 +，其余非保留字符 %XX）
pub fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        if *b == b' ' {
            out.push('+');
        } else if unreserved(*b) {
            out.push(*b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn percent_decode_bytes(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                match (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    (Some(h), Some(l)) => {
                        out.push(h * 16 + l);
                        i += 3;
                    }
                    _ => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    out
}

pub fn percent_decode(s: &str) -> String {
    String::from_utf8_lossy(&percent_decode_bytes(s)).into_owned()
}

/// 解析 query / urlencoded 表单串，同 key 取第一个值（对齐 parse_qs + [0] 的用法）
pub fn parse_pairs(raw: &str) -> Vec<(String, String)> {
    raw.split('&')
        .filter(|p| !p.is_empty())
        .map(|p| match p.split_once('=') {
            Some((k, v)) => (percent_decode(k), percent_decode(v)),
            None => (percent_decode(p), String::new()),
        })
        .collect()
}

pub fn pair_get<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// 多行文本域按行切分（textarea 提交可能带 \r\n）
pub fn split_lines(text: &str) -> Vec<String> {
    text.lines().map(|l| l.to_string()).collect()
}

pub fn parse_cookie(header: &str) -> Vec<(String, String)> {
    header
        .split(';')
        .filter_map(|part| {
            let part = part.trim();
            let (k, v) = part.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}

pub fn cookie_get<'a>(cookies: &'a [(String, String)], key: &str) -> Option<&'a str> {
    cookies
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
}

/// 扩展名 → Content-Type，覆盖局域网传输常见场景，兜底 octet-stream
pub fn content_type_of(name: &str) -> &'static str {
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "txt" | "md" | "log" => "text/plain; charset=utf-8",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "jsonc" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "apk" => "application/vnd.android.package-archive",
        "exe" => "application/octet-stream",
        "wasm" => "application/wasm",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escape_covers_all_entities() {
        assert_eq!(
            html_escape("<a href='x'>&\"y\"</a>"),
            "&lt;a href=&#39;x&#39;&gt;&amp;&quot;y&quot;&lt;/a&gt;"
        );
    }

    #[test]
    fn url_encode_matches_quote_plus() {
        assert_eq!(url_encode("photo 1.jpg"), "photo+1.jpg");
        assert_eq!(url_encode("中文.txt"), "%E4%B8%AD%E6%96%87.txt");
    }

    #[test]
    fn percent_decode_roundtrip_and_lossy() {
        assert_eq!(percent_decode("%E4%B8%AD%E6%96%87"), "中文");
        assert_eq!(percent_decode("a+b%20c"), "a b c");
        // 非法转义原样保留，不 panic
        assert_eq!(percent_decode("100%zz"), "100%zz");
        assert_eq!(percent_decode("\u{FFFD}"), "\u{FFFD}");
    }

    #[test]
    fn parse_pairs_takes_first_value_and_handles_no_equals() {
        let pairs = parse_pairs("share=0&q=a&q=b&flag");
        assert_eq!(pair_get(&pairs, "share"), Some("0"));
        assert_eq!(pair_get(&pairs, "q"), Some("a"));
        assert_eq!(pair_get(&pairs, "flag"), Some(""));
        assert_eq!(pair_get(&pairs, "missing"), None);
    }

    #[test]
    fn split_lines_handles_crlf() {
        assert_eq!(split_lines("a\r\nb\nc"), vec!["a", "b", "c"]);
    }

    #[test]
    fn cookie_parsing() {
        let c = parse_cookie("fsid=abc; theme=x;  spaced = y ");
        assert_eq!(cookie_get(&c, "fsid"), Some("abc"));
        assert_eq!(cookie_get(&c, "spaced"), Some("y"));
        assert_eq!(cookie_get(&c, "nope"), None);
    }

    #[test]
    fn content_type_guess() {
        assert_eq!(content_type_of("a.PNG"), "image/png");
        assert_eq!(content_type_of("noext"), "application/octet-stream");
        assert_eq!(content_type_of(".zip"), "application/zip");
    }
}
