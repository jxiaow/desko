//! 可选访问口令：sha256 存储、恒定时间比较、内存会话表（重启需重登）。

use rand::Rng;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const SESSION_COOKIE: &str = "fsid";
const SESSION_TTL_SECS: u64 = 7 * 24 * 3600;

pub fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 长度不同也走满全程，不提前返回
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let len = a.len().max(b.len());
    let mut diff = a.len() ^ b.len();
    for i in 0..len {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as usize;
    }
    diff == 0
}

pub fn verify_password(input: &str, stored_sha256_hex: &str) -> bool {
    let actual = sha256_hex(input);
    constant_time_eq(actual.as_bytes(), stored_sha256_hex.to_ascii_lowercase().as_bytes())
}

pub fn new_session_token() -> String {
    let bytes: [u8; 16] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 会话归属：局域网一条空串，公网按子域各算各的。
/// 一条子域登上的会话不能拿去读另一条——它们可以有不同的口令与动作面。
pub const LAN_SCOPE: &str = "lan";

pub struct SessionStore {
    // token → (归属, 过期时刻 unix 秒)
    inner: Mutex<HashMap<String, (String, u64)>>,
}

impl SessionStore {
    pub fn new() -> Self {
        SessionStore { inner: Mutex::new(HashMap::new()) }
    }

    pub fn issue(&self, scope: &str) -> String {
        let token = new_session_token();
        if let Ok(mut map) = self.inner.lock() {
            let now = now_secs();
            map.retain(|_, (_, expires)| *expires > now);
            map.insert(token.clone(), (scope.to_string(), now + SESSION_TTL_SECS));
        }
        token
    }

    pub fn validate(&self, token: &str, scope: &str) -> bool {
        let Ok(mut map) = self.inner.lock() else { return false };
        let now = now_secs();
        match map.get_mut(token) {
            Some((own, expires)) if *expires > now && own == scope => {
                *expires = now + SESSION_TTL_SECS; // 滑动作废，长传不断线
                true
            }
            // 过期才回收：拿别的子域的会话来撞，不该把正主的会话一起清掉
            Some((_, expires)) if *expires <= now => {
                map.remove(token);
                false
            }
            _ => false,
        }
    }

    /// 某一归属的会话全部作废（口令换了）；别的归属不受影响
    pub fn revoke(&self, scope: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.retain(|_, (own, _)| own != scope);
        }
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 登录后的回跳地址：只收站内相对路径，挡开放重定向
pub fn sanitize_next(raw: &str) -> String {
    // 反斜杠一个都不留：`/\evil.com` 会被浏览器按 `//evil.com` 解析成外部域
    if raw.starts_with('/') && !raw.starts_with("//") && !raw.contains('\\') {
        raw.to_string()
    } else {
        "/".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_known_vectors() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(sha256_hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn password_verification() {
        let stored = sha256_hex("correct horse");
        assert!(verify_password("correct horse", &stored));
        assert!(!verify_password("Correct horse", &stored));
        assert!(!verify_password("correct hors", &stored));
        assert!(!verify_password("", &stored));
        // 存储侧大写十六进制也要能比中
        assert!(verify_password("correct horse", &stored.to_uppercase()));
    }

    #[test]
    fn constant_time_eq_behaves() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
        assert!(!constant_time_eq(b"", b"a"));
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn tokens_unique_and_long_enough() {
        let a = new_session_token();
        let b = new_session_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn session_issue_validate_revoke() {
        let store = SessionStore::new();
        let token = store.issue(LAN_SCOPE);
        assert!(store.validate(&token, LAN_SCOPE));
        assert!(!store.validate("deadbeef", LAN_SCOPE));
        store.revoke(LAN_SCOPE);
        assert!(!store.validate(&token, LAN_SCOPE));
    }

    #[test]
    fn revoking_one_scope_keeps_the_others() {
        let store = SessionStore::new();
        let lan = store.issue(LAN_SCOPE);
        let files = store.issue("files.example.com");
        store.revoke("files.example.com");
        assert!(!store.validate(&files, "files.example.com"), "改口令那条要重新登");
        assert!(store.validate(&lan, LAN_SCOPE), "局域网正在传的不该被踢下线");
    }

    #[test]
    fn session_does_not_cross_hostname() {
        let store = SessionStore::new();
        let a = store.issue("files.example.com");
        assert!(!store.validate(&a, "docs.example.com"), "一条子域的会话读不了另一条");
        assert!(store.validate(&a, "files.example.com"), "撞别的域不该把正主的会话弄没");
        assert!(!store.validate(&store.issue(LAN_SCOPE), "files.example.com"));
    }

    #[test]
    fn sanitize_next_blocks_external() {
        assert_eq!(sanitize_next("/settings"), "/settings");
        assert_eq!(sanitize_next("/?q=a"), "/?q=a");
        assert_eq!(sanitize_next("//evil.com"), "/");
        assert_eq!(sanitize_next("/\\evil.com"), "/"); // 浏览器把 /\host 归一为 //host
        assert_eq!(sanitize_next("/a\\b"), "/");
        assert_eq!(sanitize_next("http://evil.com"), "/");
        assert_eq!(sanitize_next("javascript:alert(1)"), "/");
        assert_eq!(sanitize_next(""), "/");
    }
}
