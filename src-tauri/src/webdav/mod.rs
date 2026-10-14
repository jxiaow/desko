//! 极简 WebDAV 客户端（坚果云），只实现备份同步需要的五个动作。
//! 阻塞 IO，全部在 spawn_blocking 里调用。

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

use crate::error::AppError;

/// 官方 obsidian-nutstore-sync 的限流参数：maxConcurrent 1 + minTime 200ms。
/// 坚果云对高频请求会限流，这里在每个请求前强制最小间隔。
const MIN_REQUEST_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, serde::Serialize)]
pub struct DavEntry {
    pub name: String,
    pub size: i64,
}

pub struct Client {
    base: String, // 无结尾斜杠，如 https://dav.jianguoyun.com/dav
    auth: String, // 预制的 Basic 头
    last_request: Mutex<Option<Instant>>,
}

/// 路径段 percent-encode：坚果云路径里可能有中文附件名
pub fn encode_path(rel: &str) -> String {
    rel.split('/')
        .map(|seg| {
            let mut out = String::new();
            for b in seg.as_bytes() {
                match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                        out.push(*b as char)
                    }
                    _ => out.push_str(&format!("%{:02X}", b)),
                }
            }
            out
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 从 PROPFIND 响应的 href（URL 编码、从服务器根开始）取最后一段并解码
pub fn name_from_href(href: &str) -> String {
    let trimmed = href.trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or("");
    percent_decode(last)
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 解析 PROPFIND 207 多响应：抽出每个 <d:response> 的 href + getcontentlength，跳过目录项
pub fn parse_multistatus(xml: &str) -> Vec<DavEntry> {
    let mut entries = Vec::new();
    for block in xml.split("<d:response").skip(1).chain(xml.split("<response").skip(1)) {
        let block = block.split("</d:response>").next().unwrap_or(block);
        let block = block.split("</response>").next().unwrap_or(block);
        let Some(href) = tag_value(block, "href") else { continue };
        let is_dir = href.ends_with('/');
        let name = name_from_href(&href);
        if name.is_empty() || is_dir {
            continue;
        }
        let size = tag_value(block, "getcontentlength")
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        entries.push(DavEntry { name, size });
    }
    entries
}

fn tag_value(xml: &str, tag: &str) -> Option<String> {
    for open in [format!("<{}>", tag), format!("<d:{}>", tag)] {
        if let Some(start) = xml.find(&open) {
            let rest = &xml[start + open.len()..];
            let close_name = open.trim_start_matches('<').trim_end_matches('>');
            if let Some(end) = rest.find(&format!("</{}>", close_name)) {
                return Some(rest[..end].trim().to_string());
            }
        }
    }
    None
}

impl Client {
    pub fn new(base: &str, user: &str, pass: &str) -> Self {
        Client {
            base: base.trim_end_matches('/').to_string(),
            auth: format!("Basic {}", BASE64.encode(format!("{}:{}", user, pass))),
            last_request: Mutex::new(None),
        }
    }

    /// 每个请求前过一遍闸门：与上一请求至少间隔 MIN_REQUEST_INTERVAL
    fn gate(&self) {
        if let Ok(mut last) = self.last_request.lock() {
            if let Some(prev) = *last {
                let elapsed = prev.elapsed();
                if elapsed < MIN_REQUEST_INTERVAL {
                    std::thread::sleep(MIN_REQUEST_INTERVAL - elapsed);
                }
            }
            *last = Some(Instant::now());
        }
    }

    fn url(&self, rel: &str) -> String {
        format!("{}/{}", self.base, encode_path(rel))
    }

    fn agent() -> Result<ureq::Agent, AppError> {
        Ok(ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(60))
            .build())
    }

    fn friendly(&self, status: u16, rel: &str) -> AppError {
        match status {
            401 => AppError::Backup("坚果云认证失败：请检查账号与应用密码（不是登录密码）".to_string()),
            403 => AppError::Backup("坚果云拒绝访问：确认已在网页端开启 WebDAV 服务".to_string()),
            404 => AppError::Backup(format!("云端不存在: {}", rel)),
            // 坚果云对 WebDAV 有频率限制，备份调勤之后这条最容易撞上
            429 | 503 => AppError::Backup("坚果云请求过于频繁，等几分钟再同步（备份已在本地做好，不会丢）".to_string()),
            _ => AppError::Backup(format!("WebDAV 请求失败 ({}): {}", status, rel)),
        }
    }

    /// 逐段建目录，已存在（405）当成功
    pub fn ensure_dir(&self, rel: &str) -> Result<(), AppError> {
        let mut path = String::new();
        for seg in rel.split('/').filter(|s| !s.is_empty()) {
            if !path.is_empty() {
                path.push('/');
            }
            path.push_str(seg);
            self.gate();
            let resp = Self::agent()?
                .request("MKCOL", &self.url(&path))
                .set("Authorization", &self.auth)
                .call();
            match resp {
                Ok(_) | Err(ureq::Error::Status(405, _)) => {}
                Err(ureq::Error::Status(code, _)) => return Err(self.friendly(code, &path)),
                Err(e) => return Err(AppError::Backup(format!("网络请求失败: {}", e))),
            }
        }
        Ok(())
    }

    /// 带重试的 PUT：5xx/网络错指数退避 3 次，4xx 直接失败
    pub fn put(&self, rel: &str, bytes: &[u8]) -> Result<(), AppError> {
        let mut delay_ms = 400u64;
        for attempt in 0..3 {
            self.gate();
            let result = Self::agent()?
                .request("PUT", &self.url(rel))
                .set("Authorization", &self.auth)
                .send_bytes(bytes);
            match result {
                Ok(_) => return Ok(()),
                Err(ureq::Error::Status(409, _)) => {
                    // 父目录不存在：补建后立刻重试，不算退避
                    if let Some(pos) = self.url(rel).rfind('/') {
                        let dir = rel.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
                        let _ = self.ensure_dir(&dir);
                        let _ = pos;
                        continue;
                    }
                    return Err(self.friendly(409, rel));
                }
                Err(ureq::Error::Status(code, _)) if code < 500 => return Err(self.friendly(code, rel)),
                Err(e) if attempt < 2 => {
                    eprintln!("webdav put retry {} ({}): {}", attempt + 1, rel, e);
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    delay_ms *= 2;
                }
                Err(e) => return Err(AppError::Backup(format!("上传失败 {}: {}", rel, e))),
            }
        }
        Err(AppError::Backup(format!("上传失败（重试耗尽）: {}", rel)))
    }

    pub fn propfind(&self, rel: &str) -> Result<Vec<DavEntry>, AppError> {
        match self.propfind_raw(rel)? {
            Some(body) => Ok(parse_multistatus(&body)),
            None => Err(self.friendly(404, rel)),
        }
    }

    /// 目录不存在时返回 None 而不是报错：还没建 desko 目录是首次同步前的正常状态
    pub fn propfind_opt(&self, rel: &str) -> Result<Option<Vec<DavEntry>>, AppError> {
        Ok(self.propfind_raw(rel)?.map(|body| parse_multistatus(&body)))
    }

    fn propfind_raw(&self, rel: &str) -> Result<Option<String>, AppError> {
        self.gate();
        let resp = Self::agent()?
            .request("PROPFIND", &self.url(rel))
            .set("Authorization", &self.auth)
            .set("Depth", "1")
            .send_string(
                r#"<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>"#,
            );
        match resp {
            Ok(r) => r
                .into_string()
                .map(Some)
                .map_err(|e| AppError::Backup(format!("读取云端列表失败: {}", e))),
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(code, _)) => Err(self.friendly(code, rel)),
            Err(e) => Err(AppError::Backup(format!("网络请求失败: {}", e))),
        }
    }

    pub fn get(&self, rel: &str, dst: &Path) -> Result<(), AppError> {
        self.get_validated(rel, dst, |_| Ok(()))
    }

    /// 下载先落同目录独立临时件，长度/内容验证完成后才发布；旧缓存不被半截正文覆盖。
    pub fn get_validated(
        &self, rel: &str, dst: &Path,
        validate: impl FnOnce(&Path) -> Result<(), AppError>,
    ) -> Result<(), AppError> {
        self.gate();
        let response = Self::agent()?.request("GET", &self.url(rel))
            .set("Authorization", &self.auth).set("Accept-Encoding", "identity").call();
        let response = match response {
            Ok(response) => response,
            Err(ureq::Error::Status(code, _)) => return Err(self.friendly(code, rel)),
            Err(error) => return Err(AppError::Backup(format!("下载失败 {rel}: {error}"))),
        };
        let expected = response.header("Content-Length").map(|value| value.parse::<u64>())
            .transpose().map_err(|_| AppError::Backup("下载响应长度不合法".into()))?;
        if let Some(parent) = dst.parent() { std::fs::create_dir_all(parent)?; }
        let tmp = dst.with_extension(format!("download-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
            let written = std::io::copy(&mut response.into_reader(), &mut output)?;
            if expected.is_some_and(|expected| expected != written) {
                return Err(AppError::Backup("下载正文不完整，请重新下载".into()));
            }
            output.sync_all()?;
            drop(output);
            validate(&tmp)?;
            std::fs::rename(&tmp, dst)?;
            Ok(())
        })();
        if result.is_err() { let _ = std::fs::remove_file(tmp); }
        result
    }

    pub fn delete(&self, rel: &str) -> Result<(), AppError> {
        self.gate();
        let resp = Self::agent()?
            .request("DELETE", &self.url(rel))
            .set("Authorization", &self.auth)
            .call();
        match resp {
            Ok(_) | Err(ureq::Error::Status(404, _)) => Ok(()),
            Err(ureq::Error::Status(code, _)) => Err(self.friendly(code, rel)),
            Err(e) => Err(AppError::Backup(format!("删除失败 {}: {}", rel, e))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_non_ascii_segments() {
        assert_eq!(encode_path("a/b c.png"), "a/b%20c.png");
        assert_eq!(encode_path("小记.png"), "%E5%B0%8F%E8%AE%B0.png");
    }

    /// 备份调勤之后最容易撞上的就是限流，这两条提示必须能照着做，不能是兜底码
    #[test]
    fn friendly_errors_point_at_the_cause() {
        let c = Client::new("https://dav.example.com/dav", "me@example.com", "pw");
        for status in [429u16, 503] {
            let AppError::Backup(msg) = c.friendly(status, "desko/packages/x.dsbk") else {
                panic!("{status} 应当映射成 Backup 错误")
            };
            assert!(msg.contains("过于频繁"), "{status} 的文案不含原因：{msg}");
        }
        let AppError::Backup(msg) = c.friendly(401, "x") else { panic!() };
        assert!(msg.contains("应用密码"), "401 要点名应用密码：{msg}");
    }

    #[test]
    fn href_to_name() {
        assert_eq!(name_from_href("/dav/desko/packages/desko-20260920-1430.dsbk"), "desko-20260920-1430.dsbk");
        assert_eq!(name_from_href("/dav/%E5%B0%8F%E8%AE%B0.png.enc"), "小记.png.enc");
    }

    #[test]
    fn parses_multistatus_skipping_dirs_and_self() {
        let xml = r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/desko/packages/</d:href><propstat><prop><resourcetype><collection/></resourcetype></prop></propstat></d:response>
<d:response><d:href>/dav/desko/packages/desko-20260920-1430.dsbk</d:href><propstat><prop><getcontentlength>312</getcontentlength><getlastmodified>Sun, 20 Sep 2026 14:30:00 GMT</getlastmodified></prop></propstat></d:response>
<d:response><d:href>/dav/desko/packages/desko-20260919-0911.dsbk</d:href><propstat><prop><getcontentlength>298</getcontentlength></prop></propstat></d:response>
</d:multistatus>"#;
        let entries = parse_multistatus(xml);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "desko-20260920-1430.dsbk");
        assert_eq!(entries[0].size, 312);
        assert_eq!(entries[1].name, "desko-20260919-0911.dsbk");
    }
    #[test]
    fn incomplete_download_keeps_the_old_cache_and_can_be_retried() {
        use std::io::{Read, Write};
        let root = std::env::temp_dir().join(format!("desko-dav-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let dst = root.join("cache.enc");
        std::fs::write(&dst, b"old verified cache").unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for complete in [false, true] {
                let (mut socket, _) = listener.accept().unwrap();
                let mut request = [0; 8192]; socket.read(&mut request).unwrap();
                if complete {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ncomplete").unwrap();
                } else {
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\nshort").unwrap();
                }
            }
        });
        let client = Client::new(&format!("http://{address}"), "test", "test");
        assert!(client.get("cache.enc", &dst).is_err());
        assert_eq!(std::fs::read(&dst).unwrap(), b"old verified cache");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1, "失败临时件应清理");
        client.get_validated("cache.enc", &dst, |tmp| {
            assert_eq!(std::fs::read(tmp).unwrap(), b"complete"); Ok(())
        }).unwrap();
        assert_eq!(std::fs::read(&dst).unwrap(), b"complete");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        server.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

}
