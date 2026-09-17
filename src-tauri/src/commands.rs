use crate::crypto::{decrypt_password, encrypt_password, generate_salt, compute_verify_hash, verify_master_password, derive_key, EncryptedData};
use crate::db::{CreateEntryInput, CreateFileShortcutInput, CreateNoteInput, EntryResponse, EntryWithPaths, FileShortcut, Note, UpdateEntryInput, UpdateNoteInput, UrlPath};
use crate::error::AppError;
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Helper: check if unlocked and return key clone
fn get_master_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    let master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    master_key.clone().ok_or(AppError::NotUnlocked)
}

#[tauri::command]
pub fn is_initialized(state: State<AppState>) -> Result<bool, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.is_initialized()
}

#[tauri::command]
pub fn setup_master_password(state: State<AppState>, password: String) -> Result<(), AppError> {
    // Lock order: master_key first, then db
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    
    if db.is_initialized()? {
        return Err(AppError::AlreadyInitialized);
    }
    
    let salt = generate_salt();
    let key = derive_key(&password, &salt);
    let verify_hash = compute_verify_hash(&key);
    
    db.set_meta("initialized", "true")?;
    db.set_meta("salt", &BASE64.encode(&salt))?;
    db.set_meta("verify_hash", &verify_hash)?;
    
    *master_key = Some(key);
    
    Ok(())
}

#[tauri::command]
pub fn unlock(state: State<AppState>, password: String) -> Result<(), AppError> {
    // Rate limiting check
    {
        let attempts = state.unlock_attempts.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        if *attempts >= 5 {
            let delay_secs = (*attempts - 4) * 5;
            return Err(AppError::Database(format!("尝试次数过多，请 {} 秒后重试", delay_secs)));
        }
    }

    // Lock order: master_key first, then db
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    if !db.is_initialized()? {
        return Err(AppError::NotInitialized);
    }

    let salt_b64 = db.get_meta("salt")?.ok_or(AppError::NotInitialized)?;
    let salt = BASE64.decode(&salt_b64).map_err(|e| AppError::Crypto(e.to_string()))?;

    let verify_hash = db.get_meta("verify_hash")?.ok_or(AppError::NotInitialized)?;

    match verify_master_password(&password, &salt, &verify_hash) {
        Ok(key) => {
            *master_key = Some(key);
            // Reset attempts on success
            if let Ok(mut attempts) = state.unlock_attempts.lock() {
                *attempts = 0;
            }
            Ok(())
        }
        Err(e) => {
            // Increment attempts on failure
            if let Ok(mut attempts) = state.unlock_attempts.lock() {
                *attempts += 1;
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub fn lock(state: State<AppState>) -> Result<(), AppError> {
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    *master_key = None;
    if let Ok(mut attempts) = state.unlock_attempts.lock() {
        *attempts = 0;
    }
    Ok(())
}

#[tauri::command]
pub fn change_master_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
) -> Result<(), AppError> {
    // Lock order: master_key first, then db
    let mut master_key = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    
    // Verify old password
    let old_key = master_key.as_ref().ok_or(AppError::NotUnlocked)?;
    
    let salt_b64 = db.get_meta("salt")?.ok_or(AppError::NotInitialized)?;
    let old_salt = BASE64.decode(&salt_b64).map_err(|e| AppError::Crypto(e.to_string()))?;
    
    let verify_hash = db.get_meta("verify_hash")?.ok_or(AppError::NotInitialized)?;
    verify_master_password(&old_password, &old_salt, &verify_hash)?;
    
    // Generate new salt and key
    let new_salt = generate_salt();
    let new_key = derive_key(&new_password, &new_salt);
    let new_verify_hash = compute_verify_hash(&new_key);
    
    // Re-encrypt all entries with new key and update meta atomically
    let entries = db.list_all_entries()?;
    let now = chrono::Utc::now().timestamp_millis();
    let mut updates: Vec<(String, String)> = Vec::with_capacity(entries.len());
    for entry in &entries {
        let encrypted: EncryptedData = serde_json::from_str(&entry.encrypted_password)
            .map_err(|e| AppError::Crypto(e.to_string()))?;

        let plaintext = decrypt_password(&encrypted, old_key)?;
        let new_encrypted = encrypt_password(&plaintext, &new_key)?;
        let new_encrypted_json = serde_json::to_string(&new_encrypted)
            .map_err(|e| AppError::Crypto(e.to_string()))?;

        updates.push((entry.id.clone(), new_encrypted_json));
    }
    let new_salt_b64 = BASE64.encode(&new_salt);
    db.finish_password_change(&updates, now, &new_salt_b64, &new_verify_hash)?;
    
    // Update master key in memory
    *master_key = Some(new_key);
    
    Ok(())
}

#[tauri::command]
pub fn list_entries(state: State<AppState>) -> Result<Vec<EntryResponse>, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let entries = db.list_all_entries()?;
    Ok(entries.iter().map(EntryResponse::from_entry).collect())
}

#[tauri::command]
pub fn list_entries_with_paths(state: State<AppState>) -> Result<Vec<EntryWithPaths>, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_all_entries_with_paths()
}

#[tauri::command]
pub fn create_entry(state: State<AppState>, input: CreateEntryInput) -> Result<EntryResponse, AppError> {
    if input.name.trim().is_empty() || input.name.len() > 200 {
        return Err(AppError::Database("名称不能为空且不超过 200 字符".to_string()));
    }
    let key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let encrypted = encrypt_password(&input.password, &key)?;
    let encrypted_json = serde_json::to_string(&encrypted).map_err(|e| AppError::Crypto(e.to_string()))?;
    
    let now = chrono::Utc::now().timestamp_millis();
    let entry = crate::db::Entry {
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

#[tauri::command]
pub fn update_entry(state: State<AppState>, id: String, input: UpdateEntryInput) -> Result<EntryResponse, AppError> {
    if input.name.trim().is_empty() || input.name.len() > 200 {
        return Err(AppError::Database("名称不能为空且不超过 200 字符".to_string()));
    }
    let key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let mut entry = db.get_entry(&id)?.ok_or(AppError::EntryNotFound)?;
    
    entry.name = input.name;
    entry.url = input.url;
    entry.username = input.username;
    entry.notes = input.notes;
    entry.category = input.category;
    entry.updated_at = chrono::Utc::now().timestamp_millis();
    
    if let Some(password) = input.password {
        let encrypted = encrypt_password(&password, &key)?;
        entry.encrypted_password = serde_json::to_string(&encrypted).map_err(|e| AppError::Crypto(e.to_string()))?;
    }
    
    db.update_entry(&entry)?;
    Ok(EntryResponse::from_entry(&entry))
}

#[tauri::command]
pub fn delete_entry(state: State<AppState>, id: String) -> Result<(), AppError> {
    // Check unlock status
    let _key = get_master_key(&state)?;
    
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    // Delete url_paths first (foreign key constraint)
    db.delete_url_paths_by_entry(&id)?;
    db.delete_entry(&id)
}

#[tauri::command]
pub fn get_password(state: State<AppState>, id: String) -> Result<String, AppError> {
    let key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    
    let entry = db.get_entry(&id)?.ok_or(AppError::EntryNotFound)?;
    let encrypted: EncryptedData = serde_json::from_str(&entry.encrypted_password)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    
    decrypt_password(&encrypted, &key)
}

#[tauri::command]
pub fn export_sql(state: State<AppState>) -> Result<String, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.export_sql()
}

#[tauri::command]
pub fn import_sql(state: State<AppState>, sql: String) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let trimmed = sql.trim();
    if !trimmed.is_empty() {
        validate_import_sql(trimmed)?;
    }

    db.import_sql(&sql)
}

fn validate_import_sql(sql: &str) -> Result<(), AppError> {
    let mut chars = sql.chars().peekable();

    loop {
        skip_sql_whitespace(&mut chars);

        match chars.peek() {
            None => break,
            Some('-') => {
                let mut next = chars.clone();
                next.next();
                if next.peek() == Some(&'-') {
                    skip_sql_line_comment(&mut chars);
                    continue;
                }
                break;
            }
            Some('/') => {
                let mut next = chars.clone();
                next.next();
                if next.peek() == Some(&'*') {
                    skip_sql_block_comment(&mut chars)?;
                    continue;
                }
                break;
            }
            _ => break,
        }
    }

    loop {
        skip_sql_whitespace(&mut chars);
        if chars.peek().is_none() {
            break;
        }

        while matches!(chars.peek(), Some('-') | Some('/')) {
            let mut probe = chars.clone();
            let c1 = probe.next().unwrap();
            match (c1, probe.peek()) {
                ('-', Some(&'-')) => {
                    chars.next();
                    skip_sql_line_comment(&mut chars);
                }
                ('/', Some(&'*')) => {
                    chars.next();
                    skip_sql_block_comment(&mut chars)?;
                }
                _ => break,
            }
            skip_sql_whitespace(&mut chars);
        }

        let mut stmt_chars: Vec<char> = Vec::new();
        let mut in_string = false;

        loop {
            match chars.peek() {
                None => break,
                Some(&'\'') if in_string => {
                    stmt_chars.push('\'');
                    chars.next();
                    if chars.peek() == Some(&'\'') {
                        stmt_chars.push('\'');
                        chars.next();
                    } else {
                        in_string = false;
                    }
                }
                Some(&'\'') => {
                    in_string = true;
                    stmt_chars.push('\'');
                    chars.next();
                }
                Some(&';') if !in_string => {
                    chars.next();
                    break;
                }
                Some(&c) => {
                    stmt_chars.push(c);
                    chars.next();
                }
            }
        }

        let stmt: String = stmt_chars.iter().collect();
        let trimmed = stmt.trim();
        if trimmed.is_empty() {
            continue;
        }

        let upper = trimmed.to_uppercase();
        if upper.starts_with("INSERT") {
            // INSERT statements are allowed
        } else if upper.starts_with("CREATE TABLE") || upper.starts_with("CREATE INDEX") {
            // CREATE TABLE and CREATE INDEX are allowed
        } else if upper.starts_with("CREATE") {
            let preview = if trimmed.len() > 50 { &trimmed[..50] } else { trimmed };
            return Err(AppError::Database(format!(
                "Invalid SQL statement: CREATE TRIGGER/VIEW is not allowed. Got: {}",
                preview
            )));
        } else {
            let preview = if trimmed.len() > 50 { &trimmed[..50] } else { trimmed };
            return Err(AppError::Database(format!(
                "Invalid SQL statement: only INSERT and CREATE TABLE/INDEX are allowed. Got: {}",
                preview
            )));
        }
    }

    Ok(())
}

fn skip_sql_whitespace<I: Iterator<Item = char>>(chars: &mut std::iter::Peekable<I>) {
    while matches!(chars.peek(), Some(c) if c.is_whitespace()) {
        chars.next();
    }
}

fn skip_sql_line_comment<I: Iterator<Item = char>>(chars: &mut std::iter::Peekable<I>) {
    while let Some(&c) = chars.peek() {
        chars.next();
        if c == '\n' {
            break;
        }
    }
}

fn skip_sql_block_comment<I: Iterator<Item = char>>(
    chars: &mut std::iter::Peekable<I>,
) -> Result<(), AppError> {
    let mut prev = ' ';
    loop {
        match chars.next() {
            None => return Err(AppError::Database("Unterminated block comment in SQL".into())),
            Some(c) if c == '/' && prev == '*' => return Ok(()),
            Some(c) => prev = c,
        }
    }
}

#[tauri::command]
pub fn get_db_path(state: State<AppState>) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(db.get_db_path())
}

#[tauri::command]
pub fn batch_delete_entries(state: State<AppState>, ids: Vec<String>) -> Result<usize, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    // Delete url_paths for each entry first
    for id in &ids {
        db.delete_url_paths_by_entry(id)?;
    }
    db.batch_delete(&ids)
}

#[tauri::command]
pub fn create_test_data(state: State<AppState>) -> Result<(), AppError> {
    let key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    
    let _ = db.delete_test_entries();
    
    let test_entries = vec![
        ("GitHub", "https://github.com", "dev@example.com", "Gh!tHub2024", "代码托管平台", "开发"),
        ("Gmail", "https://mail.google.com", "user@gmail.com", "Gm@il#Secure", "个人邮箱", "邮箱"),
        ("钉钉", "https://www.dingtalk.com", "user@company.com", "Ding!Talk88", "企业办公", "办公"),
        ("阿里云", "https://www.aliyun.com", "admin", "Ali#Cloud2024", "云服务", "开发"),
        ("腾讯文档", "https://docs.qq.com", "user@company.com", "QQ@Docs66", "在线文档", "办公"),
        ("知乎", "https://www.zhihu.com", "zhangsan", "Zhihu!2024", "知识问答", "社交"),
        ("Outlook", "https://outlook.office.com", "user@company.com", "Out@look99", "企业邮箱", "邮箱"),
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
        let encrypted = encrypt_password(password, &key)?;
        let encrypted_json = serde_json::to_string(&encrypted)
            .map_err(|e| AppError::Crypto(e.to_string()))?;
        
        let entry = crate::db::Entry {
            id: format!("test-{}", i + 1),
            name: name.to_string(),
            url: Some(url.to_string()),
            username: Some(username.to_string()),
            encrypted_password: encrypted_json,
            notes: Some(notes.to_string()),
            category: Some(category.to_string()),
            created_at: now - (i as i64 * 86400000), // 每天一个
            updated_at: now,
        };
        
        db.create_entry(&entry)?;
    }
    
    Ok(())
}

// ─── Note Commands ───

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Result<Vec<Note>, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_all_notes()
}

#[tauri::command]
pub fn create_note(state: State<AppState>, input: CreateNoteInput) -> Result<Note, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let note = Note {
        id,
        title: input.title,
        content_html: input.content_html,
        category: input.category,
        created_at: now,
        updated_at: now,
    };

    db.create_note(&note)?;
    Ok(note)
}

#[tauri::command]
pub fn update_note(state: State<AppState>, id: String, input: UpdateNoteInput) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let mut note = db.get_note(&id)?.ok_or(AppError::Database("note not found".to_string()))?;
    note.title = input.title;
    note.content_html = input.content_html;
    note.category = input.category;
    note.updated_at = chrono::Utc::now().timestamp_millis();

    db.update_note(&note)?;
    Ok(())
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_note(&id)?;
    Ok(())
}

#[tauri::command]
pub fn batch_delete_notes(state: State<AppState>, ids: Vec<String>) -> Result<usize, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.batch_delete_notes(&ids)
}

// ─── Settings Commands ───

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<String, AppError> {
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let value = db.get_meta(&key)?;
    Ok(value.unwrap_or_default())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), AppError> {
    const ALLOWED_KEYS: &[&str] = &["auto_lock_timeout", "lock_on_close"];
    if !ALLOWED_KEYS.contains(&key.as_str()) {
        return Err(AppError::Database(format!("setting key not allowed: {}", key)));
    }
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.set_meta(&key, &value)?;
    Ok(())
}

// ─── URL Path Commands ───

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

#[tauri::command]
pub fn list_url_paths(state: State<AppState>, entry_id: String) -> Result<Vec<UrlPath>, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_url_paths(&entry_id)
}

#[tauri::command]
pub fn create_url_path(state: State<AppState>, input: CreateUrlPathInput) -> Result<UrlPath, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    let url_path = UrlPath {
        id,
        entry_id: input.entry_id,
        path: input.path,
        label: input.label,
        notes: input.notes,
        created_at: now,
    };

    db.create_url_path(&url_path)?;
    Ok(url_path)
}

#[tauri::command]
pub fn update_url_path(state: State<AppState>, id: String, input: UpdateUrlPathInput) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let mut url_path = db.get_url_path(&id)?.ok_or(AppError::Database("url path not found".to_string()))?;
    url_path.path = input.path;
    url_path.label = input.label;
    url_path.notes = input.notes;

    db.update_url_path(&url_path)?;
    Ok(())
}

#[tauri::command]
pub fn delete_url_path(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_url_path(&id)?;
    Ok(())
}

// ─── File Shortcut Commands ───

#[tauri::command]
pub fn list_file_shortcuts(state: State<AppState>) -> Result<Vec<FileShortcut>, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.list_file_shortcuts()
}

#[tauri::command]
pub fn create_file_shortcut(state: State<AppState>, input: CreateFileShortcutInput) -> Result<FileShortcut, AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;

    let now = chrono::Utc::now().timestamp_millis();
    let shortcut = FileShortcut {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name,
        path: input.path,
        shortcut_type: input.shortcut_type,
        created_at: now,
    };

    db.create_file_shortcut(&shortcut)?;
    Ok(shortcut)
}

#[tauri::command]
pub fn delete_file_shortcut(state: State<AppState>, id: String) -> Result<(), AppError> {
    let _key = get_master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    db.delete_file_shortcut(&id)?;
    Ok(())
}
