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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateNoteInput {
    pub title: String,
    pub content_html: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
