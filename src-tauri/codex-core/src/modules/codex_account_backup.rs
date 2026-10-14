//! Portable account-only snapshots for desko's encrypted backup container.
//! No official CODEX_HOME, session, usage, keyring or global environment access.
//! Returned bytes contain credentials: callers must encrypt them in memory.

use super::{atomic_write, codex_account::CODEX_ACCOUNT_MUTATION_LOCK, secure_account_storage};
use crate::models::codex::{CodexAccount, CodexAccountIndex, CodexAccountSummary, CodexAuthMode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const SCHEMA: &str = "desko.codex-accounts";
const KEY_FILE: &str = "secure-account-storage.key";
const ACCOUNTS_DIR: &str = "codex_accounts";
const TOMBSTONES_DIR: &str = "codex_account_tombstones";
const INDEX_FILE: &str = "codex_accounts.json";
const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
const MAX_ACCOUNTS: usize = 10_000;
pub const ACCOUNT_STORAGE_COMPONENTS: [&str; 4] =
    [KEY_FILE, ACCOUNTS_DIR, INDEX_FILE, TOMBSTONES_DIR];

// A closed allowlist is intentional: future runtime fields added to CodexAccount
// must not silently become cloud backup data. Credentials keep canonical names
// so the existing account decoder remains the one source of field semantics.
const ACCOUNT_FIELDS: &[&str] = &[
    "id",
    "email",
    "auth_mode",
    "authorization_status",
    "tokens",
    "openai_api_key",
    "created_at",
    "account_id",
    "user_id",
    "organization_id",
    "account_name",
    "account_structure",
    "account_note",
    "account_password",
    "two_factor_secret",
    "phone_number",
    "mail_url",
    "tags",
    "plan_type",
    "subscription_active_until",
    "auth_file_plan_type",
    "api_base_url",
    "api_provider_mode",
    "api_provider_id",
    "api_provider_name",
    "api_model_catalog",
    "api_model_context_windows",
    "api_model_mappings",
    "api_sync_model_catalog_to_codex",
    "api_wire_api",
    "api_supports_websockets",
    "api_supports_vision",
    "api_model_vision_support",
    "api_vision_routing_model",
    "api_instance_access_mode",
    "api_startup_model",
    "bound_oauth_account_id",
    "app_speed",
];

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountSnapshot {
    schema: String,
    version: u32,
    accounts: Vec<Value>,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err("账号快照含无效账号 ID".into());
    }
    Ok(())
}

fn require_unlinked(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                meta.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let linked = meta.file_type().is_symlink();
            if linked {
                return Err("账号备份不接受符号链接或重解析点".into());
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("检查账号路径失败: {error}")),
    }
}

fn validate_store_paths(base_dir: &Path) -> Result<(), String> {
    require_unlinked(base_dir)?;
    for name in [ACCOUNTS_DIR, TOMBSTONES_DIR, INDEX_FILE, KEY_FILE] {
        require_unlinked(&base_dir.join(name))?;
    }
    Ok(())
}

fn tombstone_at(base_dir: &Path, id: &str) -> Result<Option<Value>, String> {
    let path = base_dir.join(TOMBSTONES_DIR).join(format!("{id}.json"));
    require_unlinked(&path)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "账号删除标记损坏，无法安全备份或恢复".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("读取账号删除标记失败: {error}")),
    }
}

fn read_accounts_at(base_dir: &Path) -> Result<Vec<CodexAccount>, String> {
    validate_store_paths(base_dir)?;
    let entries = match fs::read_dir(base_dir.join(ACCOUNTS_DIR)) {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("读取账号目录失败: {error}")),
    };
    let mut accounts = Vec::new();
    for entry in entries.into_iter().flatten() {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.extension().and_then(|v| v.to_str()) != Some("json") {
            continue;
        }
        require_unlinked(&path)?;
        let id = path
            .file_stem()
            .and_then(|v| v.to_str())
            .ok_or("无效账号文件名")?;
        validate_id(id)?;
        let tombstone = tombstone_at(base_dir, id)?;
        if let Some(tombstone) = &tombstone {
            match tombstone.get("deleted").and_then(Value::as_bool) {
                Some(true) => continue,
                Some(false) => {}
                None => return Err("账号删除标记缺少状态".into()),
            }
        }
        let account: CodexAccount =
            secure_account_storage::read_account_file_readonly(&path, &base_dir.join(KEY_FILE))
                .map_err(|_| format!("无法读取账号 {id}，未生成不完整备份"))?;
        if account.id != id {
            return Err("账号文件与账号 ID 不一致".into());
        }
        if let Some(tombstone) = tombstone {
            let generation = tombstone
                .get("generation")
                .and_then(Value::as_u64)
                .ok_or("账号凭据版本标记损坏")?;
            let hash = tombstone
                .get("credential_hash")
                .and_then(Value::as_str)
                .unwrap_or("");
            if account.token_generation < generation
                || (account.token_generation == generation
                    && !hash.is_empty()
                    && super::codex_account::account_credential_hash(&account) != hash)
            {
                return Err("账号凭据已过期，未生成不完整备份".into());
            }
        }
        accounts.push(account);
        if accounts.len() > MAX_ACCOUNTS {
            return Err("账号数超出备份上限".into());
        }
    }
    // An index entry with no readable detail must not disappear from a backup.
    let account_ids: HashSet<_> = accounts.iter().map(|account| account.id.as_str()).collect();
    match fs::read(base_dir.join(INDEX_FILE)) {
        Ok(bytes) => {
            let index: CodexAccountIndex =
                serde_json::from_slice(&bytes).map_err(|_| "账号索引损坏，未生成不完整备份")?;
            for summary in index.accounts {
                validate_id(&summary.id)?;
                if !account_ids.contains(summary.id.as_str())
                    && !tombstone_at(base_dir, &summary.id)?
                        .is_some_and(|t| t.get("deleted") == Some(&Value::Bool(true)))
                {
                    return Err("账号索引引用缺失详情，未生成不完整备份".into());
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("读取账号索引失败: {error}")),
    }
    accounts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(accounts)
}

fn portable_account(account: &CodexAccount) -> Result<Value, String> {
    if account.agent_identity.is_some() {
        return Err("账号包含尚不支持备份的 Agent Identity 凭据".into());
    }
    let mut value = serde_json::to_value(account).map_err(|_| "序列化账号失败")?;
    value
        .as_object_mut()
        .ok_or("账号必须为对象")?
        .retain(|key, _| ACCOUNT_FIELDS.contains(&key.as_str()));
    // Validate before returning bytes; unsupported credentials must cause a
    // visible backup failure rather than a silently unusable account export.
    decode_portable_account(&value)?;
    Ok(value)
}

fn decode_portable_account(value: &Value) -> Result<CodexAccount, String> {
    let object = value.as_object().ok_or("账号快照条目必须为对象")?;
    if object
        .keys()
        .any(|key| !ACCOUNT_FIELDS.contains(&key.as_str()))
    {
        return Err("账号快照含非账号字段或不支持的字段".into());
    }
    let tokens = object
        .get("tokens")
        .and_then(Value::as_object)
        .ok_or("账号快照缺少凭据")?;
    if tokens
        .keys()
        .any(|key| !matches!(key.as_str(), "id_token" | "access_token" | "refresh_token"))
    {
        return Err("账号快照含不支持的凭据字段".into());
    }
    let mut canonical = object.clone();
    // Runtime state is initialized locally, never imported from the snapshot.
    canonical.insert("last_used".into(), Value::from(0));
    let mut account: CodexAccount = serde_json::from_value(Value::Object(canonical))
        .map_err(|_| "账号快照字段无效".to_string())?;
    validate_id(&account.id)?;
    let pending = match account.authorization_status.as_deref() {
        None => false,
        Some("pending") => true,
        Some(_) => return Err("账号快照含不支持的授权状态".into()),
    };
    if pending {
        // Pending is an account draft, not a way to bypass credential checks
        // for an authorized account or to import partial/stale credentials.
        if !matches!(account.auth_mode, CodexAuthMode::OAuth)
            || account.email.trim().is_empty()
            || !account.tokens.id_token.is_empty()
            || !account.tokens.access_token.is_empty()
            || account.tokens.refresh_token.as_deref().is_some_and(|v| !v.is_empty())
            || account.openai_api_key.as_deref().is_some_and(|v| !v.is_empty())
        {
            return Err("待授权账号必须为具备邮箱且凭据为空的 OAuth 账号".into());
        }
    } else {
        match account.auth_mode {
            CodexAuthMode::OAuth if !account.tokens.access_token.trim().is_empty() => {}
            CodexAuthMode::Apikey
                if account
                    .openai_api_key
                    .as_deref()
                    .is_some_and(|v| !v.trim().is_empty()) => {}
            _ => return Err("账号快照缺少支持的 OAuth / API Key 凭据".into()),
        }
    }
    account.token_generation = if pending { 0 } else { 1 };
    account.token_updated_at = None;
    Ok(account)
}

fn decode_snapshot(bytes: &[u8]) -> Result<Vec<CodexAccount>, String> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err("账号快照超过 32 MiB".into());
    }
    let snapshot: AccountSnapshot =
        serde_json::from_slice(bytes).map_err(|_| "账号快照格式无效")?;
    if snapshot.schema != SCHEMA || snapshot.version != 1 {
        return Err("不支持的账号快照版本".into());
    }
    if snapshot.accounts.len() > MAX_ACCOUNTS {
        return Err("账号数超出备份上限".into());
    }
    let mut ids = HashSet::new();
    snapshot
        .accounts
        .iter()
        .map(|value| {
            let account = decode_portable_account(value)?;
            if !ids.insert(account.id.clone()) {
                return Err("账号快照含重复 ID".into());
            }
            Ok(account)
        })
        .collect()
}

/// Read only managed account files at `base_dir` (the profile's `codex` child).
/// No missing key is created; no legacy migration or token refresh is started.
pub fn export_account_backup_at(base_dir: &Path) -> Result<Vec<u8>, String> {
    let _guard = CODEX_ACCOUNT_MUTATION_LOCK
        .lock()
        .map_err(|_| "账号写入锁已损坏")?;
    let accounts = read_accounts_at(base_dir)?
        .iter()
        .map(portable_account)
        .collect::<Result<Vec<_>, _>>()?;
    let bytes = serde_json::to_vec(&AccountSnapshot {
        schema: SCHEMA.into(),
        version: 1,
        accounts,
    })
    .map_err(|_| "序列化账号快照失败")?;
    validate_account_backup(&bytes)?;
    Ok(bytes)
}

/// Validate an account-only snapshot without reading or writing any local paths.
pub fn validate_account_backup(bytes: &[u8]) -> Result<usize, String> {
    Ok(decode_snapshot(bytes)?.len())
}

fn summary(account: &CodexAccount) -> CodexAccountSummary {
    CodexAccountSummary {
        id: account.id.clone(),
        email: account.email.clone(),
        plan_type: account.plan_type.clone(),
        subscription_active_until: account.subscription_active_until.clone(),
        created_at: account.created_at,
        last_used: account.last_used,
    }
}

/// Restore to an explicitly selected staging/profile directory using its own key.
/// Merge is additive: existing credentials and deletion decisions always win.
/// Publish only account components from staging; never replace the profile root.
pub fn restore_account_backup_at(base_dir: &Path, bytes: &[u8]) -> Result<usize, String> {
    let _guard = CODEX_ACCOUNT_MUTATION_LOCK
        .lock()
        .map_err(|_| "账号写入锁已损坏")?;
    restore_account_backup_unlocked_at(base_dir, bytes)
}

fn restore_account_backup_unlocked_at(base_dir: &Path, bytes: &[u8]) -> Result<usize, String> {
    let incoming = decode_snapshot(bytes)?; // Reject the entire payload before any writes.
    let existing = read_accounts_at(base_dir)?;
    let existing_ids: HashSet<_> = existing.iter().map(|a| a.id.as_str()).collect();
    let mut additions = Vec::new();
    for account in incoming {
        if existing_ids.contains(account.id.as_str())
            || tombstone_at(base_dir, &account.id)?.is_some()
        {
            continue;
        }
        additions.push(account);
    }
    if additions.is_empty() {
        return Ok(0);
    }
    let index_path = base_dir.join(INDEX_FILE);
    let mut index = match fs::read(&index_path) {
        Ok(bytes) => {
            serde_json::from_slice::<CodexAccountIndex>(&bytes).map_err(|_| "目标账号索引损坏")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CodexAccountIndex::new(),
        Err(error) => return Err(format!("读取目标账号索引失败: {error}")),
    };
    index.accounts = existing.iter().chain(&additions).map(summary).collect();
    // Preserve local selection only; a restored account is never activated.
    if index
        .current_account_id
        .as_deref()
        .is_some_and(|id| !existing_ids.contains(id))
    {
        index.current_account_id = None;
    }
    fs::create_dir_all(base_dir.join(ACCOUNTS_DIR)).map_err(|error| error.to_string())?;
    let key_path = base_dir.join(KEY_FILE);
    let encrypted = additions
        .iter()
        .map(|account| {
            secure_account_storage::serialize_account_file_at("codex", account, &key_path).map(
                |content| {
                    (
                        base_dir
                            .join(ACCOUNTS_DIR)
                            .join(format!("{}.json", account.id)),
                        content,
                    )
                },
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut created: Vec<PathBuf> = Vec::new();
    let result = (|| {
        for (path, content) in &encrypted {
            require_unlinked(path)?;
            if path.exists() {
                return Err("恢复时目标账号发生变化，请重试".into());
            }
            atomic_write::write_secret_string_atomic(path, content)?;
            created.push(path.clone());
        }
        let index_content =
            serde_json::to_string_pretty(&index).map_err(|_| "序列化账号索引失败")?;
        atomic_write::write_string_atomic(&index_path, &index_content)
    })();
    if let Err(error) = result {
        for path in created {
            let _ = atomic_write::remove_file_locked(&path);
        }
        return Err(error);
    }
    Ok(additions.len())
}

/// Stage a merge using the live profile's own key and managed account components.
/// The caller publishes only the returned component names in its restore journal.
/// Staging must be empty. Neither this helper nor merge modifies `live`.
pub fn prepare_account_restore_at(
    live: &Path,
    staging: &Path,
    bytes: &[u8],
) -> Result<Vec<String>, String> {
    prepare_and_publish_account_restore_at(live, staging, bytes, |components| {
        Ok(components.to_vec())
    })
}

/// Hold the same account mutation lock across staging and the caller's journal
/// commit, so token refresh/deletion cannot be overwritten by an older clone.
/// The synchronous callback must not call other account mutation APIs.
pub fn prepare_and_publish_account_restore_at<T>(
    live: &Path,
    staging: &Path,
    bytes: &[u8],
    publish: impl FnOnce(&[String]) -> Result<T, String>,
) -> Result<T, String> {
    prepare_and_publish_account_restore_with_preflight_at(live, staging, bytes, || Ok(()), publish)
}

/// Recover an interrupted publication under the account lock before cloning
/// local credentials, then retain that lock through the next publication.
pub fn prepare_and_publish_account_restore_with_preflight_at<T>(
    live: &Path,
    staging: &Path,
    bytes: &[u8],
    before_prepare: impl FnOnce() -> Result<(), String>,
    publish: impl FnOnce(&[String]) -> Result<T, String>,
) -> Result<T, String> {
    validate_account_backup(bytes)?;
    with_account_restore_lock(|| {
        before_prepare()?;
        let components = prepare_account_restore_unlocked_at(live, staging, bytes)?;
        publish(&components)
    })
}

/// Serialize restore journal recovery even for old backups without accounts.
/// Callbacks must not recursively call account mutation APIs.
pub fn with_account_restore_lock<T>(action: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = CODEX_ACCOUNT_MUTATION_LOCK
        .lock()
        .map_err(|_| "账号写入锁已损坏")?;
    action()
}

fn prepare_account_restore_unlocked_at(
    live: &Path,
    staging: &Path,
    bytes: &[u8],
) -> Result<Vec<String>, String> {
    validate_store_paths(live)?;
    require_unlinked(staging)?;
    if live == staging
        || (live.exists()
            && staging.exists()
            && fs::canonicalize(live).ok() == fs::canonicalize(staging).ok())
    {
        return Err("账号恢复 staging 不能是当前账号目录".into());
    }
    if staging.exists()
        && fs::read_dir(staging)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err("账号恢复 staging 必须为空".into());
    }
    // Validate the entire copy plan before copying any local key or ciphertext.
    let mut files = Vec::new();
    let mut directories = Vec::new();
    for name in ACCOUNT_STORAGE_COMPONENTS {
        let source = live.join(name);
        if !source.exists() {
            continue;
        }
        if matches!(name, ACCOUNTS_DIR | TOMBSTONES_DIR) {
            directories.push(staging.join(name));
            for entry in fs::read_dir(&source).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                require_unlinked(&entry.path())?;
                if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                    return Err("账号存储中存在非普通文件，拒绝复制".into());
                }
                files.push((entry.path(), staging.join(name).join(entry.file_name())));
            }
        } else {
            if !source.is_file() {
                return Err("账号组件必须为普通文件".into());
            }
            files.push((source, staging.join(name)));
        }
    }
    fs::create_dir_all(staging).map_err(|e| e.to_string())?;
    for directory in directories {
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    }
    for (source, target) in files {
        if source.file_name().and_then(|v| v.to_str()) == Some(KEY_FILE) {
            let key = fs::read_to_string(source).map_err(|e| e.to_string())?;
            atomic_write::write_secret_string_atomic(&target, &key)?;
        } else {
            fs::copy(source, target).map_err(|e| e.to_string())?;
        }
    }
    restore_account_backup_unlocked_at(staging, bytes)?;
    let preserve_live_key = live.join(KEY_FILE).exists();
    if preserve_live_key && fs::read(live.join(KEY_FILE)).map_err(|e| e.to_string())?
        != fs::read(staging.join(KEY_FILE)).map_err(|e| e.to_string())?
    {
        return Err("恢复账号密钥与本机密钥不一致，拒绝发布".into());
    }
    Ok(ACCOUNT_STORAGE_COMPONENTS
        .into_iter()
        .filter(|name| staging.join(name).exists() && !(preserve_live_key && *name == KEY_FILE))
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::codex::CodexTokens;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("desko-account-backup-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn dir(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn account(id: &str, credential: &str) -> CodexAccount {
        CodexAccount::new(
            id.into(),
            format!("{id}@example.invalid"),
            CodexTokens {
                id_token: "synthetic-id-token".into(),
                access_token: credential.into(),
                refresh_token: Some("synthetic-refresh-token".into()),
            },
        )
    }

    fn save(base: &Path, accounts: &[CodexAccount]) {
        fs::create_dir_all(base.join(ACCOUNTS_DIR)).unwrap();
        for account in accounts {
            let content = secure_account_storage::serialize_account_file_at(
                "codex",
                account,
                &base.join(KEY_FILE),
            )
            .unwrap();
            atomic_write::write_secret_string_atomic(
                &base.join(ACCOUNTS_DIR).join(format!("{}.json", account.id)),
                &content,
            )
            .unwrap();
        }
        let mut index = CodexAccountIndex::new();
        index.accounts = accounts.iter().map(summary).collect();
        index.current_account_id = accounts.first().map(|a| a.id.clone());
        fs::write(base.join(INDEX_FILE), serde_json::to_vec(&index).unwrap()).unwrap();
    }

    #[test]
    fn snapshot_roundtrip_contains_only_accounts_and_generates_a_destination_key() {
        let fixture = Fixture::new();
        let source = fixture.dir("source");
        let target = fixture.dir("target");
        let mut original = account("one", "synthetic-account-secret");
        original.account_note = Some("portable note".into());
        original.usage_updated_at = Some(123456);
        original.last_used = 123456;
        original.last_client_auth_instance_id = Some("must-not-export-client-state".into());
        save(&source, &[original]);
        for name in [
            "sessions",
            "archived_sessions",
            "usage",
            "session_index",
            "logs",
            "auth.json",
        ] {
            fs::write(source.join(name), "must-not-export-files").unwrap();
        }
        let bytes = export_account_backup_at(&source).unwrap();
        let snapshot: Value = serde_json::from_slice(&bytes).unwrap();
        let object = snapshot["accounts"][0].as_object().unwrap();
        assert!(object
            .keys()
            .all(|key| ACCOUNT_FIELDS.contains(&key.as_str())));
        assert!(!String::from_utf8_lossy(&bytes).contains("must-not-export"));
        assert_eq!(validate_account_backup(&bytes).unwrap(), 1);
        assert_eq!(restore_account_backup_at(&target, &bytes).unwrap(), 1);
        let restored = read_accounts_at(&target).unwrap().remove(0);
        assert_eq!(restored.tokens.access_token, "synthetic-account-secret");
        assert_eq!(restored.account_note.as_deref(), Some("portable note"));
        assert_eq!(restored.usage_updated_at, None);
        assert_eq!(restored.last_client_auth_instance_id, None);
        assert_eq!(restored.last_used, 0);
        assert_ne!(
            fs::read(source.join(KEY_FILE)).unwrap(),
            fs::read(target.join(KEY_FILE)).unwrap()
        );
        let disk = fs::read_to_string(target.join(ACCOUNTS_DIR).join("one.json")).unwrap();
        assert!(!disk.contains("synthetic-account-secret"));
        let index: CodexAccountIndex =
            serde_json::from_slice(&fs::read(target.join(INDEX_FILE)).unwrap()).unwrap();
        assert_eq!(index.current_account_id, None);
        assert!(fs::read_dir(target).unwrap().all(|entry| {
            let name = entry.unwrap().file_name();
            let name = name.to_str().unwrap();
            ACCOUNT_STORAGE_COMPONENTS.contains(&name) || name == "secure-account-storage.key.lock"
        }));
    }

    #[test]
    fn pending_oauth_account_roundtrip_preserves_draft_without_runtime_state() {
        let fixture = Fixture::new();
        let source = fixture.dir("source");
        let target = fixture.dir("target");
        let mut draft = account("pending", "");
        draft.tokens.id_token.clear();
        draft.tokens.refresh_token = None;
        draft.authorization_status = Some("pending".into());
        draft.token_generation = 0;
        draft.account_note = Some("awaiting authorization".into());
        draft.usage_updated_at = Some(123);
        draft.last_client_auth_instance_id = Some("excluded-client".into());
        save(&source, &[draft]);

        let bytes = export_account_backup_at(&source).unwrap();
        let snapshot: Value = serde_json::from_slice(&bytes).unwrap();
        let portable = &snapshot["accounts"][0];
        assert_eq!(portable["authorization_status"], "pending");
        for field in ["usage_updated_at", "quota", "quota_error", "last_client_auth_instance_id"] {
            assert!(portable.get(field).is_none());
        }
        assert_eq!(validate_account_backup(&bytes).unwrap(), 1);
        assert_eq!(restore_account_backup_at(&target, &bytes).unwrap(), 1);
        let restored = read_accounts_at(&target).unwrap().remove(0);
        assert_eq!(restored.authorization_status.as_deref(), Some("pending"));
        assert!(restored.tokens.id_token.is_empty());
        assert!(restored.tokens.access_token.is_empty());
        assert_eq!(restored.tokens.refresh_token, None);
        assert_eq!(restored.token_generation, 0);
        assert_eq!(restored.account_note.as_deref(), Some("awaiting authorization"));
        assert_eq!(restored.usage_updated_at, None);
        assert_eq!(restored.last_client_auth_instance_id, None);
        assert_eq!(restored.last_used, 0);
        assert_eq!(export_account_backup_at(&target).unwrap(), bytes);
    }

    #[test]
    fn pending_status_cannot_mask_credentials_or_invalid_account_state() {
        let fixture = Fixture::new();
        let mut draft = account("pending", "");
        draft.tokens.id_token.clear();
        draft.tokens.refresh_token = None;
        draft.authorization_status = Some("pending".into());
        let valid = portable_account(&draft).unwrap();
        for mutation in 0..11 {
            let mut invalid = valid.clone();
            match mutation {
                0 => invalid["tokens"]["access_token"] = Value::from("credential"),
                1 => invalid["tokens"]["id_token"] = Value::from("credential"),
                2 => invalid["tokens"]["refresh_token"] = Value::from("credential"),
                3 => invalid["openai_api_key"] = Value::from("credential"),
                4 => invalid["auth_mode"] = Value::from("apikey"),
                5 => invalid["email"] = Value::from("  "),
                6 => { invalid.as_object_mut().unwrap().remove("authorization_status"); }
                7 => invalid["authorization_status"] = Value::from("authorized"),
                8 => invalid["authorization_status"] = Value::from(""),
                9 => invalid["authorization_status"] = Value::from(" pending "),
                _ => invalid["tokens"]["access_token"] = Value::from(" "),
            }
            let snapshot = serde_json::to_vec(&AccountSnapshot {
                schema: SCHEMA.into(), version: 1, accounts: vec![invalid.clone()],
            }).unwrap();
            let target = fixture.dir(&format!("invalid-{mutation}"));
            assert!(validate_account_backup(&snapshot).is_err(), "mutation {mutation}");
            assert!(restore_account_backup_at(&target, &snapshot).is_err(), "mutation {mutation}");
            assert!(!target.exists());
            // Export enforces the same contract as restore, including drafts
            // whose credentials or status were corrupted on disk.
            invalid["last_used"] = Value::from(0);
            let account: CodexAccount = serde_json::from_value(invalid).unwrap();
            assert!(portable_account(&account).is_err(), "mutation {mutation}");
        }
    }

    #[test]
    fn staged_merge_keeps_local_credentials_key_and_deletions_without_session_data() {
        let fixture = Fixture::new();
        let live = fixture.dir("live");
        let remote = fixture.dir("remote");
        let staging = fixture.dir("staging");
        save(&live, &[account("shared", "local-secret")]);
        fs::create_dir_all(live.join(TOMBSTONES_DIR)).unwrap();
        fs::write(
            live.join(TOMBSTONES_DIR).join("deleted.json"),
            r#"{"deleted":true,"generation":2}"#,
        )
        .unwrap();
        fs::create_dir_all(live.join("session_trash")).unwrap();
        fs::write(live.join("session_trash/keep"), "local-session").unwrap();
        fs::write(live.join("auth.json"), "official-cache").unwrap();
        save(
            &remote,
            &[
                account("shared", "remote-old-secret"),
                account("new", "new-secret"),
                account("deleted", "deleted-secret"),
            ],
        );
        let bytes = export_account_backup_at(&remote).unwrap();
        let components = prepare_account_restore_at(&live, &staging, &bytes).unwrap();
        assert_eq!(components, [ACCOUNTS_DIR, INDEX_FILE, TOMBSTONES_DIR].map(str::to_string));
        assert_eq!(
            fs::read(live.join(KEY_FILE)).unwrap(),
            fs::read(staging.join(KEY_FILE)).unwrap()
        );
        assert_eq!(read_accounts_at(&live).unwrap().len(), 1);
        let merged = read_accounts_at(&staging).unwrap();
        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged
                .iter()
                .find(|a| a.id == "shared")
                .unwrap()
                .tokens
                .access_token,
            "local-secret"
        );
        assert!(!staging.join("session_trash").exists());
        assert!(!staging.join("auth.json").exists());
        assert_eq!(
            fs::read_to_string(live.join("session_trash/keep")).unwrap(),
            "local-session"
        );
        assert!(prepare_account_restore_at(&live, &staging, &bytes).is_err());
    }

    #[test]
    fn invalid_snapshots_are_rejected_before_any_destination_write() {
        let fixture = Fixture::new();
        let source = fixture.dir("source");
        save(&source, &[account("one", "secret")]);
        let valid: Value =
            serde_json::from_slice(&export_account_backup_at(&source).unwrap()).unwrap();
        for mutation in 0..5 {
            let mut invalid = valid.clone();
            match mutation {
                0 => invalid["sessions"] = serde_json::json!([]),
                1 => invalid["accounts"][0]["usage_updated_at"] = Value::from(5),
                2 => invalid["accounts"][0]["id"] = Value::from("../escape"),
                3 => invalid["accounts"]
                    .as_array_mut()
                    .unwrap()
                    .push(valid["accounts"][0].clone()),
                _ => invalid["accounts"][0]["tokens"]["path"] = Value::from("auth.json"),
            }
            let target = fixture.dir(&format!("invalid-{mutation}"));
            let bytes = serde_json::to_vec(&invalid).unwrap();
            assert!(restore_account_backup_at(&target, &bytes).is_err());
            assert!(!target.exists());
        }
    }

    #[test]
    fn export_fails_closed_when_key_or_indexed_details_are_missing() {
        let fixture = Fixture::new();
        let source = fixture.dir("source");
        save(&source, &[account("one", "secret")]);
        fs::remove_file(source.join(KEY_FILE)).unwrap();
        assert!(export_account_backup_at(&source).is_err());
        assert!(!source.join(KEY_FILE).exists());
        fs::remove_file(source.join(ACCOUNTS_DIR).join("one.json")).unwrap();
        assert!(export_account_backup_at(&source).is_err());
    }

    #[test]
    fn export_rejects_stale_credentials_and_never_migrates_external_accounts() {
        let fixture = Fixture::new();
        let source = fixture.dir("custom-profile");
        let external = fixture.dir("com.antigravity.cockpit-tools");
        save(&external, &[account("external", "external-secret")]);
        let external_key = fs::read(external.join(KEY_FILE)).unwrap();
        let bytes = export_account_backup_at(&source).unwrap();
        assert_eq!(validate_account_backup(&bytes).unwrap(), 0);
        assert!(!source.exists());
        assert_eq!(fs::read(external.join(KEY_FILE)).unwrap(), external_key);
        assert!(external.join(ACCOUNTS_DIR).join("external.json").exists());
        save(&source, &[account("one", "stale-secret")]);
        fs::create_dir_all(source.join(TOMBSTONES_DIR)).unwrap();
        fs::write(
            source.join(TOMBSTONES_DIR).join("one.json"),
            r#"{"deleted":false,"generation":99}"#,
        )
        .unwrap();
        assert!(export_account_backup_at(&source).is_err());
    }

    #[test]
    fn staging_rejects_linked_account_components() {
        let fixture = Fixture::new();
        let source = fixture.dir("source");
        let external = fixture.dir("external");
        let target = fixture.dir("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("keep"), "external-data").unwrap();
        #[cfg(windows)]
        junction::create(&external, source.join(ACCOUNTS_DIR)).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&external, source.join(ACCOUNTS_DIR)).unwrap();
        let bytes = br#"{"schema":"desko.codex-accounts","version":1,"accounts":[]}"#;
        assert!(export_account_backup_at(&source).is_err());
        assert!(prepare_account_restore_at(&source, &target, bytes).is_err());
        assert!(!target.exists());
        assert_eq!(
            fs::read_to_string(external.join("keep")).unwrap(),
            "external-data"
        );
        #[cfg(windows)]
        junction::delete(source.join(ACCOUNTS_DIR)).unwrap();
    }

    #[test]
    fn preflight_recovers_credentials_before_clone_under_the_same_lock() {
        let fixture = Fixture::new();
        let live = fixture.dir("live");
        let remote = fixture.dir("remote");
        let stage = fixture.dir("stage");
        save(&live, &[account("shared", "interrupted-restore")]);
        save(&remote, &[account("shared", "remote-older")]);
        let bytes = export_account_backup_at(&remote).unwrap();
        prepare_and_publish_account_restore_with_preflight_at(&live, &stage, &bytes, || {
            assert!(CODEX_ACCOUNT_MUTATION_LOCK.try_lock().is_err());
            save(&live, &[account("shared", "recovered-local")]);
            Ok(())
        }, |_| {
            assert!(CODEX_ACCOUNT_MUTATION_LOCK.try_lock().is_err());
            assert_eq!(read_accounts_at(&stage).unwrap()[0].tokens.access_token, "recovered-local");
            Ok(())
        }).unwrap();
        let rejected = fixture.dir("rejected-stage");
        let result = prepare_and_publish_account_restore_with_preflight_at(&live, &rejected, &bytes,
            || Err("recovery incomplete".into()), |_| -> Result<(), String> { panic!("must not publish") });
        assert_eq!(result.unwrap_err(), "recovery incomplete");
        assert!(!rejected.exists());
    }

    #[test]
    fn account_lock_is_held_until_the_publish_callback_finishes() {
        let fixture = Fixture::new();
        let bytes = br#"{"schema":"desko.codex-accounts","version":1,"accounts":[]}"#;
        let result = prepare_and_publish_account_restore_at(
            &fixture.dir("live"),
            &fixture.dir("stage"),
            bytes,
            |components| {
                assert!(CODEX_ACCOUNT_MUTATION_LOCK.try_lock().is_err());
                assert!(components.is_empty());
                Err::<(), _>("simulated journal rejection".into())
            },
        );
        assert_eq!(result.unwrap_err(), "simulated journal rejection");
        // Successful re-entry also verifies that a callback error releases the lock.
        assert_eq!(
            restore_account_backup_at(&fixture.dir("other"), bytes).unwrap(),
            0
        );
    }
}
