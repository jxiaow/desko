use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub encrypted_password: String,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryResponse {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl EntryResponse {
    pub fn from_entry(entry: &Entry) -> Self {
        EntryResponse {
            id: entry.id.clone(),
            name: entry.name.clone(),
            url: entry.url.clone(),
            username: entry.username.clone(),
            notes: entry.notes.clone(),
            category: entry.category.clone(),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryWithPaths {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub notes: Option<String>,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub paths: Vec<UrlPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEntryInput {
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: String,
    pub notes: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateEntryInput {
    pub name: String,
    pub url: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub notes: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlPath {
    pub id: String,
    pub entry_id: String,
    pub path: String,
    pub label: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
    pub starred: bool,
    /// 单条加密：true 时 title/content_html 恒为空，正文在 cipher 里
    pub encrypted: bool,
    /// 归档：true 时不进「全部/置顶/收藏」，只在归档视图里出现
    pub archived: bool,
    pub archived_at: Option<i64>,
}

/// 加密小记的密文与两条 DEK 封条（口令封条 + 主密钥封条）
#[derive(Debug, Clone)]
pub struct NoteLockRow {
    pub cipher: String,
    pub cipher_iv: String,
    pub wrap_pass: String,
    pub pass_salt: String,
    pub wrap_master: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UpdateNoteInput {
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: String,
    pub note_id: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: i64,
    pub mime_type: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileShortcut {
    pub id: String,
    pub name: String,
    pub path: String,
    pub shortcut_type: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateFileShortcutInput {
    pub name: String,
    pub path: String,
    pub shortcut_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUrlPathInput {
    pub entry_id: String,
    pub path: String,
    pub label: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateUrlPathInput {
    pub path: String,
    pub label: Option<String>,
    pub notes: Option<String>,
}

/// 一条 MFA 账号的对外形态：密钥刻意不在其中，只出码不出密
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaTokenInfo {
    pub id: String,
    pub issuer: String,
    pub label: String,
    pub algorithm: String,
    pub digits: i64,
    pub period: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MfaCode {
    pub id: String,
    pub issuer: String,
    pub label: String,
    pub code: String,
    pub digits: i64,
    pub period: i64,
    /// 当前这步还剩几秒换码
    pub remaining: i64,
}

/// 直连清单里的一条被管目标：域名钉 hosts，IP/CIDR 只钉路由
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BypassTarget {
    pub id: String,
    pub host: String,
    /// 粘贴进来的原文，重探按它重新解析（host 列不含端口/路径/掩码）
    pub input: String,
    pub kind: String,
    pub port: i64,
    pub path: String,
    pub scheme: String,
    /// 最近一次探到并钉住的真址
    pub address: String,
    pub interface_name: String,
    pub next_hop: String,
    /// 最近一次的判定：directOk / hostsOnly / needRoute / unreachable / egressUnknown
    pub verdict: String,
    /// 钉住的真址已不在 DoH 当前答案里，且指定它探活也失败
    pub stale: bool,
    pub note: String,
    /// 真址带 CNAME 或多 A 轮换，钉死会锁在会失效的节点上
    pub cdn_like: bool,
    /// 最近一次落盘结果：none / applied / failed
    pub apply_state: String,
    /// 落盘批次 id，撤销靠它找回回滚点
    pub apply_batch: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub checked_at: i64,
}

/// 穿透服务表的一行：一个公网子域指向本机一个端口。
/// 口令只存 sha256 摘要，且只对 desko 自己起的服务（`preset = fileshare`）生效——
/// 第三方本机端口不在我们的请求链路上，能强制的策略一条也落不到它头上。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelService {
    pub id: String,
    pub hostname: String,
    pub port: i64,
    pub label: String,
    /// fileshare = desko 自己的局域网传输（唯一能强制公网策略的一种），空 = 用户登记的通用服务
    pub preset: String,
    /// 这条子域的 DNS 记录是否已经指到隧道
    pub routed: bool,
    /// 公网侧登录口令摘要；空 = 没设口令
    pub public_password_sha256: String,
    /// 公网侧只读：禁止上传与新建
    pub public_read_only: bool,
    pub created_at: i64,
    pub updated_at: i64,
}
