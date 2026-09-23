//! 流式 multipart 解析：数据边读边写盘，整包不进内存。
//! 每个文件先落 `.part` 临时名，收完整段后再经同名避让定名（半截上传不留脏文件）。

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use crate::files::{claim_available_name, sanitize_upload_name};
use crate::http_util::percent_decode_bytes;

const MAX_HEADER_BYTES: usize = 16 * 1024;

#[derive(Debug)]
#[allow(dead_code)] // name/size 留给上层做回执与日志
pub struct SavedFile {
    pub name: String,
    pub size: u64,
}

/// 写入字节预算包装：超预算以 InvalidInput 报错（上层映射 413），防单请求灌满磁盘
struct Capped<W: Write> {
    inner: W,
    left: u64,
}

impl<W: Write> Write for Capped<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "upload too large"));
        }
        let n = std::cmp::min(buf.len() as u64, self.left) as usize;
        let written = self.inner.write(&buf[..n])?;
        self.left -= written as u64;
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// 消费 reader 直到 needle 出现，其间数据写入 sink（None = 丢弃）。
/// 返回 true = 命中，false = 命中前 EOF。
/// 逐字节前缀匹配；处于"部分匹配"的字节扣在 pending 里，宣告失配才吐给 sink，
/// 所以跨 64KB 缓冲边界的边界串也不会漏判或错写。
fn scan_to<R: Read, W: Write>(
    br: &mut BufReader<R>,
    needle: &[u8],
    sink: Option<&mut W>,
) -> std::io::Result<bool> {
    let mut matched = 0usize;
    let mut pending: Vec<u8> = Vec::with_capacity(needle.len());
    let mut sink = sink;
    loop {
        let buf = br.fill_buf()?;
        if buf.is_empty() {
            return Ok(false);
        }
        let n = buf.len();
        for idx in 0..n {
            let b = buf[idx];
            if b == needle[matched] {
                matched += 1;
                pending.push(b);
                if matched == needle.len() {
                    br.consume(idx + 1);
                    return Ok(true);
                }
            } else {
                let flushed = std::mem::take(&mut pending);
                if let Some(w) = sink.as_mut() {
                    w.write_all(&flushed)?;
                }
                matched = 0;
                if b == needle[0] {
                    matched = 1;
                    pending.push(b);
                } else if let Some(w) = sink.as_mut() {
                    w.write_all(&[b])?;
                }
            }
        }
        br.consume(n);
    }
}

/// 从 Content-Disposition 提取文件名：RFC2231 `filename*=` 优先。
/// 裸 `filename=` 按浏览器实发原样取（不做 percent 解码），只解 `filename*`。
pub fn parse_multipart_filename(header_text: &str) -> Option<String> {
    let disposition = header_text
        .lines()
        .find(|l| l.to_ascii_lowercase().contains("content-disposition"))?;
    if let Some(raw) = extract_param(disposition, "filename*") {
        let value = raw.trim_matches('"');
        // 形如 UTF-8''%E4%B8%AD%E6%96%87.txt；没有 lang 前缀的整串当编码值
        let encoded = value.rsplit('\'').next().unwrap_or(value);
        let name = String::from_utf8_lossy(&percent_decode_bytes(encoded)).into_owned();
        let name = name.rsplit(['/', '\\']).next().unwrap_or(&name).to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    let raw = extract_param(disposition, "filename")?;
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

/// 在 `a; b="x"; c=y` 里取参数值（带引号或裸词）；key 精确匹配，
/// 查 `filename` 时不会误吃 `filename*`
fn extract_param(line: &str, key: &str) -> Option<String> {
    for seg in line.split(';') {
        let seg = seg.trim();
        let Some(rest) = seg.strip_prefix(key) else { continue };
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim();
        if let Some(rest) = rest.strip_prefix('"') {
            return Some(rest.split('"').next().unwrap_or("").to_string());
        }
        return Some(rest.to_string());
    }
    None
}

/// 解析整个 multipart 正文并落盘，返回保存的文件。boundary 来自 Content-Type 头。
/// max_total 为本次请求所有文件合计的字节上限，超出即失败并清理临时件。
pub fn read_multipart<R: Read>(
    body: R,
    boundary: &str,
    dir: &Path,
    max_total: u64,
) -> std::io::Result<Vec<SavedFile>> {
    let mut br = BufReader::new(body);
    let dash_boundary = format!("--{}", boundary);
    let needle = format!("\r\n--{}", boundary).into_bytes();
    let mut saved = Vec::new();
    let mut budget = max_total;

    // 起始行必须是 --boundary\r\n（浏览器不会带前置导言）
    consume_crlf_line(&mut br, |line| Ok(line == dash_boundary.as_bytes()))?
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "bad multipart preamble"))?;

    loop {
        let header_text = match read_part_headers(&mut br)? {
            Some(t) => t,
            None => break, // 正文意外结束
        };
        let is_files = header_text.to_ascii_lowercase().contains("name=\"files\"");
        let filename = parse_multipart_filename(&header_text).and_then(|raw| sanitize_upload_name(&raw));
        let want_file = is_files && filename.is_some();

        let mut tmp_path: Option<PathBuf> = None;
        let scan = if want_file {
            let name = filename.clone().unwrap();
            let tmp = dir.join(format!(".{}.{}.part", name, uuid::Uuid::new_v4()));
            // BufWriter 兜住 scan_to 的逐字节写：否则大文件每个字节一次 WriteFile
            let file = std::io::BufWriter::with_capacity(
                256 * 1024,
                std::fs::File::create(&tmp)?,
            );
            tmp_path = Some(tmp);
            let mut capped = Capped { inner: file, left: budget };
            let hit = scan_to(&mut br, &needle, Some(&mut capped));
            let flushed = capped.flush();
            let Capped { inner: _file, left } = capped;
            budget = left;
            match hit {
                Ok(true) => flushed.map(|()| true),
                other => other,
            }
        } else {
            scan_to(&mut br, &needle, None::<&mut std::io::Sink>)
        };
        let hit = match scan {
            Ok(true) => true,
            Ok(false) => false,
            Err(e) => {
                if let Some(tmp) = tmp_path {
                    let _ = std::fs::remove_file(tmp);
                }
                return Err(e);
            }
        };
        if !hit {
            if let Some(tmp) = tmp_path {
                let _ = std::fs::remove_file(tmp);
            }
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "multipart truncated"));
        }
        if let Some(tmp) = tmp_path {
            let target = match claim_available_name(dir, &filename.unwrap()) {
                Ok(t) => t,
                Err(e) => {
                    let _ = std::fs::remove_file(&tmp);
                    return Err(e);
                }
            };
            if let Err(e) = std::fs::rename(&tmp, &target) {
                let _ = std::fs::remove_file(&tmp);
                let _ = std::fs::remove_file(&target);
                return Err(e);
            }
            saved.push(SavedFile {
                name: target
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                size: std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
            });
        }
        // 边界之后：CRLF → 下一段；"--" → 结束
        let mut tail = [0u8; 2];
        let n = read_up_to_two(&mut br, &mut tail)?;
        match &tail[..n] {
            [b'\r', b'\n'] => continue,
            [b'-', b'-'] => break,
            [] => break, // 干净收尾
            _ => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "bad boundary tail")),
        }
    }
    Ok(saved)
}

fn read_up_to_two<R: Read>(br: &mut BufReader<R>, out: &mut [u8; 2]) -> std::io::Result<usize> {
    let mut got = 0usize;
    while got < 2 {
        match br.read(&mut out[got..])? {
            0 => break,
            k => got += k,
        }
    }
    Ok(got)
}

/// 校验并吃掉一整行（含结尾 CRLF）；pred 返回 Err 直接上抛
fn consume_crlf_line<R: Read>(
    br: &mut BufReader<R>,
    pred: impl Fn(&[u8]) -> std::io::Result<bool>,
) -> std::io::Result<Option<bool>> {
    match read_crlf_line(br)? {
        Some(line) => pred(&line).map(Some),
        None => Ok(None),
    }
}

/// 读一段 part 头部（连续行直到空行）。返回不含结尾空行的头部文本；
/// 段首即 EOF 返回 None。
fn read_part_headers<R: Read>(br: &mut BufReader<R>) -> std::io::Result<Option<String>> {
    let mut out = String::new();
    let mut total = 0usize;
    let mut any = false;
    loop {
        let Some(line) = read_crlf_line(br)? else {
            return Ok(if any { Some(out) } else { None });
        };
        any = true;
        total += line.len() + 2;
        if total > MAX_HEADER_BYTES {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "headers too large"));
        }
        if line.is_empty() {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&String::from_utf8_lossy(&line));
    }
    Ok(Some(out))
}

fn read_crlf_line<R: Read>(br: &mut BufReader<R>) -> std::io::Result<Option<Vec<u8>>> {
    let mut out = Vec::new();
    let mut prev_cr = false;
    loop {
        let b = match br.fill_buf()? {
            [] => return Ok(None),
            [b, ..] => *b,
        };
        br.consume(1);
        if prev_cr {
            if b == b'\n' {
                return Ok(Some(out));
            }
            out.push(b'\r');
            prev_cr = false;
        }
        if b == b'\r' {
            prev_cr = true;
        } else {
            out.push(b);
        }
    }
}

/// 简易文本体读取（save-text / settings 表单用），带字节上限
pub fn read_limited<R: Read>(mut reader: R, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut buf = Vec::new();
    let mut capped = (&mut reader).take(limit + 1);
    capped.read_to_end(&mut buf)?;
    if buf.len() as u64 > limit {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "body too large"));
    }
    Ok(buf)
}

pub fn boundary_from_content_type(content_type: &str) -> Option<String> {
    if !content_type.to_ascii_lowercase().contains("multipart/form-data") {
        return None;
    }
    for param in content_type.split(';') {
        let param = param.trim();
        let lower = param.to_ascii_lowercase();
        let Some(rest) = lower.strip_prefix("boundary=") else { continue };
        let _ = rest;
        let b = param[9..].trim().trim_matches('"').to_string();
        // RFC 2046：boundary ≤ 70 字符，全部可打印 ASCII
        if !b.is_empty() && b.len() <= 70 && b.bytes().all(|c| c.is_ascii_graphic() || c == b' ') {
            return Some(b);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("desko-mp-{}-{}", tag, uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn part(name: &str, filename: Option<&str>, data: &[u8], boundary: &str) -> Vec<u8> {
        let mut out = format!("--{}\r\n", boundary).into_bytes();
        let disp = match filename {
            Some(fn_) => format!(
                "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
                name, fn_
            ),
            None => format!("Content-Disposition: form-data; name=\"{}\"\r\n", name),
        };
        out.extend_from_slice(disp.as_bytes());
        out.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
        out.extend_from_slice(data);
        out.extend_from_slice(b"\r\n");
        out
    }

    fn finish(boundary: &str) -> Vec<u8> {
        format!("--{}--\r\n", boundary).into_bytes()
    }

    fn join(parts: Vec<Vec<u8>>) -> Vec<u8> {
        parts.into_iter().flatten().collect()
    }

    #[test]
    fn saves_single_file() {
        let dir = tmpdir("single");
        let raw = join(vec![part("files", Some("hello.txt"), b"line1\nline2", "X"), finish("X")]);
        let saved = read_multipart(raw.as_slice(), "X", &dir, u64::MAX).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].name, "hello.txt");
        assert_eq!(fs::read(dir.join("hello.txt")).unwrap(), b"line1\nline2");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn binary_data_with_partial_boundary_bytes() {
        let dir = tmpdir("binary");
        // 数据里含边界前缀诱饵 "\r\n--BOUND"（差一字节不是真边界）与 NUL/FF 字节
        let data: Vec<u8> = b"a\r\n--BOUNDnot\r\n\x00\xffend".to_vec();
        let raw = join(vec![part("files", Some("d.bin"), &data, "BOUNDX"), finish("BOUNDX")]);
        let saved = read_multipart(raw.as_slice(), "BOUNDX", &dir, u64::MAX).unwrap();
        assert_eq!(saved[0].size, data.len() as u64);
        assert_eq!(fs::read(dir.join("d.bin")).unwrap(), data);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn boundary_split_across_tiny_reads() {
        // 用 ChunkedReader 每次只给 1 字节，压测 scan_to 的跨缓冲 pending 逻辑
        struct OneByte<'a>(&'a [u8], usize);
        impl Read for OneByte<'_> {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.1 >= self.0.len() || buf.is_empty() {
                    return Ok(0);
                }
                buf[0] = self.0[self.1];
                self.1 += 1;
                Ok(1)
            }
        }
        let dir = tmpdir("chunk");
        // 70KB 循环字节（跨满 BufReader 缓冲）+ 前缀诱饵，但不含完整 "\r\n--K9"
        let mut data: Vec<u8> = (0u8..=255).cycle().take(70000).collect();
        data.extend_from_slice(b"\r\n--K8 decoy \r\n--K");
        let raw = join(vec![part("files", Some("c.bin"), &data, "K9"), finish("K9")]);
        let saved = read_multipart(OneByte(&raw, 0), "K9", &dir, u64::MAX).unwrap();
        assert_eq!(fs::read(dir.join("c.bin")).unwrap(), data);
        assert_eq!(saved[0].size, data.len() as u64);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn multiple_files_and_ignored_fields() {
        let dir = tmpdir("multi");
        let raw = join(vec![
            part("note", None, b"ignored", "M"),
            part("files", Some("a.txt"), b"AAA", "M"),
            part("files", Some("b.bin"), b"BBB", "M"),
            finish("M"),
        ]);
        let saved = read_multipart(raw.as_slice(), "M", &dir, u64::MAX).unwrap();
        let names: Vec<_> = saved.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "b.bin"]);
        assert_eq!(fs::read(dir.join("a.txt")).unwrap(), b"AAA");
        assert_eq!(fs::read(dir.join("b.bin")).unwrap(), b"BBB");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn empty_file_part_saved_as_empty() {
        let dir = tmpdir("empty");
        let raw = join(vec![part("files", Some("zero.dat"), b"", "E"), finish("E")]);
        let saved = read_multipart(raw.as_slice(), "E", &dir, u64::MAX).unwrap();
        assert_eq!(saved[0].size, 0);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn same_name_twice_gets_increments() {
        let dir = tmpdir("dup");
        let raw = join(vec![
            part("files", Some("p.txt"), b"1", "D"),
            part("files", Some("p.txt"), b"2", "D"),
            finish("D"),
        ]);
        let saved = read_multipart(raw.as_slice(), "D", &dir, u64::MAX).unwrap();
        assert_eq!(saved[0].name, "p.txt");
        assert_eq!(saved[1].name, "p (1).txt");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn path_in_filename_is_sanitized_not_traversed() {
        let dir = tmpdir("trav");
        let raw = join(vec![part("files", Some(r"..\evil.exe"), b"nope", "T"), finish("T")]);
        let saved = read_multipart(raw.as_slice(), "T", &dir, u64::MAX).unwrap();
        assert_eq!(saved[0].name, "evil.exe");
        assert!(dir.join("evil.exe").exists());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn truncated_body_removes_part_file() {
        let dir = tmpdir("trunc");
        let mut raw = format!(
            "--TR\r\nContent-Disposition: form-data; name=\"files\"; filename=\"x.bin\"\r\nContent-Type: application/octet-stream\r\n\r\nDATA-NO-END"
        )
        .into_bytes();
        raw.truncate(raw.len() - 4); // 断在半截边界
        assert!(read_multipart(raw.as_slice(), "TR", &dir, u64::MAX).is_err());
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "半截残file未清理: {:?}", leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn upload_over_budget_fails_and_cleans() {
        let dir = tmpdir("cap");
        let raw = join(vec![part("files", Some("big.bin"), b"0123456789", "C"), finish("C")]);
        let err = read_multipart(raw.as_slice(), "C", &dir, 4).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert!(leftovers.is_empty(), "超限后临时件未清理");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn bad_preamble_rejected() {
        let dir = tmpdir("badpre");
        assert!(read_multipart(b"not multipart at all".as_slice(), "Z", &dir, u64::MAX).is_err());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn filename_star_rfc2231() {
        let h = "Content-Disposition: form-data; name=\"files\"; filename*=UTF-8''%E4%B8%AD%E6%96%87.txt";
        assert_eq!(parse_multipart_filename(h).as_deref(), Some("中文.txt"));
        let h2 = "Content-Disposition: form-data; name=\"files\"; filename=\"fallback.bin\"; filename*=UTF-8''%E6%96%B0.bin";
        assert_eq!(parse_multipart_filename(h2).as_deref(), Some("新.bin"));
        let h3 = "Content-Disposition: form-data; name=\"note\"";
        assert_eq!(parse_multipart_filename(h3), None);
        // 裸 filename 原样保留（浏览器不做 percent 编码）
        let h4 = "Content-Disposition: form-data; name=\"files\"; filename=\"a b%20c.txt\"";
        assert_eq!(parse_multipart_filename(h4).as_deref(), Some("a b%20c.txt"));
    }

    #[test]
    fn boundary_from_content_type_parsing() {
        assert_eq!(boundary_from_content_type("multipart/form-data; boundary=ABC").as_deref(), Some("ABC"));
        assert_eq!(boundary_from_content_type("multipart/form-data; Boundary=\"Q\"").as_deref(), Some("Q"));
        assert_eq!(boundary_from_content_type("multipart/form-data").as_deref(), None);
        assert_eq!(boundary_from_content_type("application/json"), None);
        assert_eq!(boundary_from_content_type("multipart/form-data; boundary=").as_deref(), None);
    }
}
