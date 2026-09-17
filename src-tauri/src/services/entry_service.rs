use crate::crypto::{encrypt_password, decrypt_password, EncryptedData};
use crate::db::{self, Database, Entry, EntryResponse, CreateEntryInput, UpdateEntryInput};
use crate::error::AppError;

pub fn create_entry(db: &Database, key: &[u8], input: CreateEntryInput) -> Result<EntryResponse, AppError> {
    if input.name.trim().is_empty() || input.name.len() > 200 {
        return Err(AppError::Database("名称不能为空且不超过 200 字符".to_string()));
    }

    let encrypted = encrypt_password(&input.password, key)?;
    let encrypted_json = serde_json::to_string(&encrypted).map_err(|e| AppError::Crypto(e.to_string()))?;

    let now = chrono::Utc::now().timestamp_millis();
    let entry = Entry {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        url: input.url,
        username: input.username,
        encrypted_password: encrypted_json,
        notes: input.notes,
        category: input.category,
        created_at: now,
        updated_at: now,
    };

    db.create_entry(&entry)?;
    Ok(EntryResponse::from_entry(&entry))
}

pub fn update_entry(db: &Database, key: &[u8], id: &str, input: UpdateEntryInput) -> Result<EntryResponse, AppError> {
    if input.name.trim().is_empty() || input.name.len() > 200 {
        return Err(AppError::Database("名称不能为空且不超过 200 字符".to_string()));
    }

    let mut entry = db.get_entry(id)?.ok_or(AppError::EntryNotFound)?;

    entry.name = input.name;
    entry.url = input.url;
    entry.username = input.username;
    entry.notes = input.notes;
    entry.category = input.category;
    entry.updated_at = chrono::Utc::now().timestamp_millis();

    if let Some(password) = input.password {
        let encrypted = encrypt_password(&password, key)?;
        entry.encrypted_password = serde_json::to_string(&encrypted).map_err(|e| AppError::Crypto(e.to_string()))?;
    }

    db.update_entry(&entry)?;
    Ok(EntryResponse::from_entry(&entry))
}

pub fn get_password(db: &Database, key: &[u8], id: &str) -> Result<String, AppError> {
    let entry = db.get_entry(id)?.ok_or(AppError::EntryNotFound)?;
    let encrypted: EncryptedData = serde_json::from_str(&entry.encrypted_password)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    decrypt_password(&encrypted, key)
}

pub fn create_test_data(db: &Database, key: &[u8]) -> Result<(), AppError> {
    let _ = db.delete_test_entries();

    let test_entries = vec![
        ("GitHub", "https://github.com", "dev@example.com", "Gh!tHub2024", "代码托管平台", "开发"),
        ("Gmail", "https://mail.google.com", "user@gmail.com", "Gm@il#Secure", "个人邮箱", "邮箱"),
        ("钉钉", "https://www.dingtalk.com", "user@company.com", "Ding!Talk88", "企业办公", "办公"),
        ("阿里云", "https://www.aliyun.com", "admin", "Ali#Cloud2024", "云服务", "开发"),
        ("腾讯文档", "https://docs.qq.com", "user@company.com", "QQ@Docs66", "在线文档", "办公"),
        ("知乎", "https://www.zhihu.com", "zhangsan", "Zhihu!2024", "知识问答", "社交"),
        ("Outlook", "https://outlook.office.com", "user@company.com", "Out@look99", "企业邮箱", "办公"),
        ("Jira", "https://jira.company.com", "user", "J!ra#Board", "项目管理", "办公"),
        ("Stack Overflow", "https://stackoverflow.com", "dev_user", "St@ck#2024", "技术问答", "开发"),
        ("微信", "https://weixin.qq.com", "zhangsan", "Wx!Chat88", "社交聊天", "社交"),
        ("飞书", "https://www.feishu.cn", "user@company.com", "Fe!shu2024", "协作办公", "办公"),
        ("企业微信", "https://work.weixin.qq.com", "admin", "WeC!hat2024", "企业通讯", "办公"),
        ("Notion", "https://www.notion.so", "user@gmail.com", "Not!on2024", "知识管理", "办公"),
        ("Figma", "https://www.figma.com", "designer@company.com", "F!gma2024", "设计工具", "开发"),
        ("Slack", "https://slack.com", "user@company.com", "Sl@ck2024", "团队沟通", "办公"),
        ("Google Drive", "https://drive.google.com", "user@gmail.com", "GDr!ve2024", "云存储", "邮箱"),
        ("Dropbox", "https://www.dropbox.com", "user@gmail.com", "Dr!pbox2024", "文件同步", "开发"),
        ("Twitter", "https://twitter.com", "user123", "Tw!tter2024", "社交媒体", "社交"),
        ("LinkedIn", "https://www.linkedin.com", "user@company.com", "L!nkedIn2024", "职业社交", "社交"),
        ("YouTube", "https://www.youtube.com", "user@gmail.com", "Y!uTube2024", "视频平台", "社交"),
    ];

    let now = chrono::Utc::now().timestamp_millis();

    for (i, (name, url, username, password, notes, category)) in test_entries.iter().enumerate() {
        let encrypted = encrypt_password(password, key)?;
        let encrypted_json = serde_json::to_string(&encrypted)
            .map_err(|e| AppError::Crypto(e.to_string()))?;

        let entry = db::Entry {
            id: format!("test-{}", i + 1),
            name: name.to_string(),
            url: Some(url.to_string()),
            username: Some(username.to_string()),
            encrypted_password: encrypted_json,
            notes: Some(notes.to_string()),
            category: Some(category.to_string()),
            created_at: now - (i as i64 * 86400000),
            updated_at: now,
        };

        db.create_entry(&entry)?;
    }

    Ok(())
}
