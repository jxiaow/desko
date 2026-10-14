// Codex 会话列表、token 统计与回收站：desko 切片。
// 上游 codex_session_manager.rs(3834 行) 的读侧可达闭包逐条照搬，唯一改写点是 collect_instances()，
// 换成 desko 侧默认实例注入（不读 instance store）。写侧只落回收站一簇（trash/restore/delete/empty +
// 索引回写），并去掉官方 app-server 那一步——desko 的 codex_official_app_server 是裁剪桩。
// 导入导出簇（zip）不落地。详见 docs/design/codex/07-session-list-port.md §4 与 08 §7。
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};

use crate::modules;

const DEFAULT_INSTANCE_ID: &str = "__default__";

const DEFAULT_INSTANCE_NAME: &str = "默认实例";

const SESSION_INDEX_FILE: &str = "session_index.jsonl";

const SESSION_DIRS: [&str; 2] = ["sessions", "archived_sessions"];

// 留底目录住在 desko 自己的数据目录，不在 ~/.codex 里；名字带 desko 前缀，不与上游 cockpit-tools 的废纸篓混读。
const SESSION_TRASH_ROOT_DIR: &str = "desko-codex-session-trash";

const SESSION_INDEX_ACTIVITY_DRIFT_SECONDS: i64 = 3_600;

const TOKEN_STATS_READ_CHUNK_BYTES: usize = 64 * 1024;

const ROLLOUT_ACTIVITY_READ_CHUNK_BYTES: usize = 64 * 1024;

const ROLLOUT_ACTIVITY_MAX_SCAN_BYTES: u64 = 4 * 1024 * 1024;

const CONTENT_SEARCH_READ_CHUNK_BYTES: usize = 64 * 1024;

const CONTENT_SEARCH_CACHE_MAX_ENTRIES: usize = 512;

// 用量图要顺序读满整份 rollout（真机 73 份合计 965 MB），缓冲给到 256 KB 而不是别处的 64 KB。
const USAGE_READ_CHUNK_BYTES: usize = 256 * 1024;

/// `turn_context` 之前就来了一条快照时没有模型名；这一档不进模型表，只进总量。
const UNKNOWN_MODEL_INDEX: usize = usize::MAX;

const UNKNOWN_MODEL_LABEL: &str = "未标注模型";


static SESSION_TRASH_MUTATION_LOCK: Mutex<()> = Mutex::new(());

static TOKEN_STATS_CACHE: LazyLock<Mutex<HashMap<PathBuf, TokenStatsCacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static USAGE_SCAN_CACHE: LazyLock<Mutex<HashMap<PathBuf, UsageFileEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static CONTENT_SEARCH_CACHE: LazyLock<Mutex<HashMap<ContentSearchCacheKey, bool>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionLocation {
    pub instance_id: String,
    pub instance_name: String,
    pub running: bool,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionRecord {
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    /// 官方客户端项目名；前端分组标题优先使用它，缺失时回退到目录名。
    pub project_name: Option<String>,
    pub updated_at: Option<i64>,
    pub location_count: usize,
    pub locations: Vec<CodexSessionLocation>,
    /// conversation | external | subagent — vertical slice of #1510
    #[serde(default = "default_session_kind")]
    pub session_kind: String,
}


fn default_session_kind() -> String {
    "conversation".to_string()
}


/// Classify session for UI filters (conversation / external / subagent).
/// Empty title defaults to conversation so the default conversation filter
/// does not hide real chats that have not received a title yet.
pub fn classify_session_kind(title: &str, cwd: &str) -> String {
    let title_l = title.trim().to_ascii_lowercase();
    let cwd_l = cwd.trim().to_ascii_lowercase();
    if title_l.contains("subagent")
        || title_l.contains("sub-agent")
        || title_l.contains("agent run")
        || cwd_l.contains("/subagent")
        || cwd_l.contains("\\subagent")
        || cwd_l.contains("subagent/")
        || cwd_l.contains("subagent\\")
    {
        return "subagent".to_string();
    }
    if title_l.contains("external")
        || title_l.contains("imported")
        || title_l.contains("cli run")
        || cwd_l.contains("imported")
        || cwd_l.contains("/external")
        || cwd_l.contains("\\external")
    {
        return "external".to_string();
    }
    "conversation".to_string()
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionTokenStats {
    pub session_id: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    /// 官方把每轮重发的上下文全记进 input_tokens，缓存命中通常占九成以上；
    /// 不单独给这一位，界面读出来的数就对不上账单。
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub reasoning_output_tokens: u64,
}


/// rollout 里 `event_msg/token_count` 的 `info.total_token_usage` 原样六项
#[derive(Debug, Clone, Copy)]
pub struct RolloutTokenUsage {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
}


#[derive(Debug, Clone, Default)]
pub struct CodexSessionSearchFilter {
    pub title_query: Option<String>,
    pub content_query: Option<String>,
}


#[derive(Debug, Clone)]
struct CodexSyncInstance {
    id: String,
    name: String,
    data_dir: PathBuf,
    last_pid: Option<u32>,
}


#[derive(Debug, Clone)]
struct ThreadSnapshot {
    id: String,
    title: String,
    cwd: String,
    /// 官方客户端可重命名的项目名（工作目录所属项目），缺失时由前端回退到目录名。
    project_name: Option<String>,
    updated_at: Option<i64>,
    rollout_path: PathBuf,
    session_index_entry: JsonValue,
    source_root: PathBuf,
}


#[derive(Debug, Clone)]
struct TokenStatsCacheEntry {
    file_len: u64,
    modified_at: Option<SystemTime>,
    stats: Option<RolloutTokenUsage>,
}


#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ContentSearchCacheKey {
    rollout_path: PathBuf,
    query: String,
    file_len: u64,
    modified_at_nanos: Option<u128>,
}


/// 从 rollout JSONL 文件中读取 token 统计信息
fn read_token_stats_from_rollout(rollout_path: &Path) -> Option<RolloutTokenUsage> {
    let metadata = fs::metadata(rollout_path).ok()?;
    let cache_key = rollout_path.to_path_buf();
    let file_len = metadata.len();
    let modified_at = metadata.modified().ok();

    {
        let cache = TOKEN_STATS_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = cache.get(&cache_key) {
            if entry.file_len == file_len && entry.modified_at == modified_at {
                return entry.stats;
            }
        }
    }

    let stats = read_token_stats_from_rollout_uncached(rollout_path, file_len);
    let mut cache = TOKEN_STATS_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(
        cache_key,
        TokenStatsCacheEntry {
            file_len,
            modified_at,
            stats,
        },
    );
    stats
}


fn read_token_stats_from_rollout_uncached(
    rollout_path: &Path,
    file_len: u64,
) -> Option<RolloutTokenUsage> {
    let mut file = File::open(rollout_path).ok()?;
    let mut offset = file_len;
    let mut pending_prefix = Vec::new();

    while offset > 0 {
        let chunk_len = TOKEN_STATS_READ_CHUNK_BYTES.min(offset as usize);
        offset -= chunk_len as u64;

        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut chunk = vec![0u8; chunk_len];
        file.read_exact(&mut chunk).ok()?;

        let starts_on_line_boundary =
            offset == 0 || byte_before_is_newline(&mut file, offset).ok()?;
        chunk.extend_from_slice(&pending_prefix);

        let parse_from_index = if starts_on_line_boundary {
            pending_prefix.clear();
            0
        } else if let Some(newline_index) = chunk.iter().position(|byte| *byte == b'\n') {
            pending_prefix = chunk[..newline_index].to_vec();
            newline_index + 1
        } else {
            pending_prefix = chunk;
            continue;
        };

        if let Some(stats) = parse_token_stats_lines(&chunk[parse_from_index..]) {
            return Some(stats);
        }
    }

    if pending_prefix.is_empty() {
        None
    } else {
        parse_token_stats_lines(&pending_prefix)
    }
}


fn byte_before_is_newline(file: &mut File, offset: u64) -> std::io::Result<bool> {
    if offset == 0 {
        return Ok(true);
    }

    file.seek(SeekFrom::Start(offset - 1))?;
    let mut byte = [0u8; 1];
    file.read_exact(&mut byte)?;
    Ok(byte[0] == b'\n')
}


fn parse_token_stats_lines(content: &[u8]) -> Option<RolloutTokenUsage> {
    for line in content.split(|byte| *byte == b'\n').rev() {
        let raw = String::from_utf8_lossy(line);
        let trimmed = raw.trim();
        if trimmed.is_empty()
            || !trimmed.contains("\"token_count\"")
            || !trimmed.contains("\"total_token_usage\"")
        {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
            continue;
        };
        if parsed.get("type").and_then(|value| value.as_str()) != Some("event_msg") {
            continue;
        }
        let Some(payload) = parsed.get("payload") else {
            continue;
        };
        if payload.get("type").and_then(|value| value.as_str()) != Some("token_count") {
            continue;
        }
        let Some(usage) = payload
            .get("info")
            .and_then(|info| info.get("total_token_usage"))
        else {
            continue;
        };

        let input = usage
            .get("input_tokens")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let output = usage
            .get("output_tokens")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let total = usage
            .get("total_tokens")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        return Some(RolloutTokenUsage {
            input_tokens: input,
            cached_input_tokens: u64_at(usage, "cached_input_tokens"),
            cache_write_input_tokens: u64_at(usage, "cache_write_input_tokens"),
            output_tokens: output,
            reasoning_output_tokens: u64_at(usage, "reasoning_output_tokens"),
            total_tokens: total,
        });
    }

    None
}


fn u64_at(obj: &JsonValue, key: &str) -> u64 {
    obj.get(key).and_then(|value| value.as_u64()).unwrap_or(0)
}


pub fn list_sessions_across_instances(
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<CodexSessionRecord>, String> {
    let filter = CodexSessionSearchFilter {
        title_query: normalize_search_query(title_query),
        content_query: normalize_content_search_query(content_query),
    };
    let instances = collect_instances()?;
    let process_entries = modules::process::collect_codex_process_entries();
    let mut session_map = HashMap::<String, CodexSessionRecord>::new();
    let has_search_filter = filter.title_query.is_some() || filter.content_query.is_some();
    let mut matched_session_ids = HashSet::<String>::new();

    for instance in &instances {
        let running = is_instance_running(instance, &process_entries);
        for snapshot in load_thread_snapshots(instance)? {
            if !has_search_filter
                || matched_session_ids.contains(&snapshot.id)
                || matches_session_search_filter(&snapshot, &filter)?
            {
                matched_session_ids.insert(snapshot.id.clone());
            }

            let entry =
                session_map
                    .entry(snapshot.id.clone())
                    .or_insert_with(|| CodexSessionRecord {
                        session_id: snapshot.id.clone(),
                        title: snapshot.title.clone(),
                        cwd: snapshot.cwd.clone(),
                        project_name: snapshot.project_name.clone(),
                        updated_at: snapshot.updated_at,
                        location_count: 0,
                        locations: Vec::new(),
                        session_kind: classify_session_kind(&snapshot.title, &snapshot.cwd),
                    });

            if entry.updated_at.is_none() {
                entry.updated_at = snapshot.updated_at;
            }
            if entry.title.trim().is_empty() {
                entry.title = snapshot.title.clone();
            }
            if entry.cwd.trim().is_empty() {
                entry.cwd = snapshot.cwd.clone();
            }
            if entry.project_name.is_none() {
                entry.project_name = snapshot.project_name.clone();
            }

            entry.locations.push(CodexSessionLocation {
                instance_id: instance.id.clone(),
                instance_name: instance.name.clone(),
                running,
            });
            entry.location_count = entry.locations.len();
        }
    }

    let mut sessions = session_map
        .into_values()
        .filter(|session| !has_search_filter || matched_session_ids.contains(&session.session_id))
        .collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .updated_at
            .unwrap_or_default()
            .cmp(&left.updated_at.unwrap_or_default())
            .then_with(|| left.cwd.cmp(&right.cwd))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(sessions)
}


fn normalize_search_query(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_lowercase())
        .filter(|item| !item.is_empty())
}


fn normalize_content_search_query(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}


fn matches_session_search_filter(
    snapshot: &ThreadSnapshot,
    filter: &CodexSessionSearchFilter,
) -> Result<bool, String> {
    if let Some(query) = filter.title_query.as_deref() {
        if !text_contains_query(&snapshot.title, query) {
            return Ok(false);
        }
    }

    if let Some(query) = filter.content_query.as_deref() {
        if !rollout_conversation_contains_query(&snapshot.rollout_path, query)? {
            return Ok(false);
        }
    }

    Ok(true)
}


fn text_contains_query(value: &str, query: &str) -> bool {
    value.to_lowercase().contains(query)
}


fn rollout_conversation_contains_query(path: &Path, query: &str) -> Result<bool, String> {
    let cache_key = content_search_cache_key(path, query);
    if let Some(key) = cache_key.as_ref() {
        let cache = CONTENT_SEARCH_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.get(key) {
            return Ok(*cached);
        }
    }

    let matched = rollout_conversation_contains_query_uncached(path, query)?;
    if let Some(key) = cache_key {
        let mut cache = CONTENT_SEARCH_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if cache.len() >= CONTENT_SEARCH_CACHE_MAX_ENTRIES {
            cache.clear();
        }
        cache.insert(key, matched);
    }

    Ok(matched)
}


fn content_search_cache_key(path: &Path, query: &str) -> Option<ContentSearchCacheKey> {
    let metadata = fs::metadata(path).ok()?;
    let modified_at_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos());

    Some(ContentSearchCacheKey {
        rollout_path: path.to_path_buf(),
        query: query.to_string(),
        file_len: metadata.len(),
        modified_at_nanos,
    })
}


fn rollout_conversation_contains_query_uncached(path: &Path, query: &str) -> Result<bool, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("打开 rollout 文件失败 ({}): {}", path.display(), error))?;
    let query_bytes = query.as_bytes();
    if query_bytes.is_empty() {
        return Ok(true);
    }

    let mut chunk = vec![0u8; CONTENT_SEARCH_READ_CHUNK_BYTES];
    let mut carry = Vec::<u8>::new();
    let keep_len = query_bytes.len().saturating_sub(1);

    loop {
        let bytes_read = file
            .read(&mut chunk)
            .map_err(|error| format!("读取 rollout 文件失败 ({}): {}", path.display(), error))?;
        if bytes_read == 0 {
            break;
        }

        let mut haystack = Vec::with_capacity(carry.len() + bytes_read);
        haystack.extend_from_slice(&carry);
        haystack.extend_from_slice(&chunk[..bytes_read]);
        if raw_bytes_contains_normalized_query(&haystack, query_bytes, query.is_ascii()) {
            return Ok(true);
        }

        if keep_len == 0 {
            carry.clear();
        } else {
            let next_carry_len = keep_len.min(haystack.len());
            carry.clear();
            carry.extend_from_slice(&haystack[haystack.len() - next_carry_len..]);
        }
    }

    Ok(false)
}


fn raw_bytes_contains_normalized_query(
    value: &[u8],
    query: &[u8],
    ascii_case_insensitive: bool,
) -> bool {
    if query.is_empty() {
        return true;
    }
    if ascii_case_insensitive {
        return ascii_case_insensitive_contains(value, query);
    }
    value.windows(query.len()).any(|window| window == query)
}


fn ascii_case_insensitive_contains(value: &[u8], query: &[u8]) -> bool {
    if query.is_empty() {
        return true;
    }
    if query.len() > value.len() {
        return false;
    }

    value.windows(query.len()).any(|window| {
        window
            .iter()
            .zip(query.iter())
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
    })
}


pub fn get_session_token_stats_across_instances(
    session_ids: Vec<String>,
) -> Result<Vec<CodexSessionTokenStats>, String> {
    let requested_ids = session_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>();
    if requested_ids.is_empty() {
        return Ok(Vec::new());
    }

    let instances = collect_instances()?;
    let mut pending_ids = requested_ids.clone();
    let mut stats_by_session_id = HashMap::<String, CodexSessionTokenStats>::new();

    for instance in &instances {
        if pending_ids.is_empty() {
            break;
        }

        for snapshot in load_thread_snapshots(instance)? {
            if !pending_ids.contains(&snapshot.id) {
                continue;
            }

            let Some(usage) = read_token_stats_from_rollout(&snapshot.rollout_path) else {
                continue;
            };

            stats_by_session_id.insert(
                snapshot.id.clone(),
                CodexSessionTokenStats {
                    session_id: snapshot.id.clone(),
                    input_tokens: usage.input_tokens,
                    output_tokens: usage.output_tokens,
                    total_tokens: usage.total_tokens,
                    cached_input_tokens: usage.cached_input_tokens,
                    cache_write_input_tokens: usage.cache_write_input_tokens,
                    reasoning_output_tokens: usage.reasoning_output_tokens,
                },
            );
            pending_ids.remove(&snapshot.id);
        }
    }

    let mut stats = stats_by_session_id.into_values().collect::<Vec<_>>();
    stats.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    Ok(stats)
}


/// 「用量」图的一桶：本地日、小时（key 为 Unix 秒）或模型。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageBucket {
    pub key: String,
    pub label: String,
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}


#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageTotals {
    pub input_tokens: u64,
    pub cached_input_tokens: u64,
    pub cache_write_input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_output_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
    pub session_count: u64,
    pub file_count: u64,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionUsageReport {
    pub totals: CodexUsageTotals,
    pub by_day: Vec<CodexUsageBucket>,
    pub by_hour: Vec<CodexUsageBucket>,
    pub by_model: Vec<CodexUsageBucket>,
    pub from_timestamp: Option<i64>,
    pub to_timestamp: Option<i64>,
    pub scan_millis: u64,
}


/// 一条 `token_count` 快照差出来的本轮用量；模型存下标，免得每份缓存都复制一遍字符串
#[derive(Debug, Clone, Copy)]
struct UsageEvent {
    timestamp: i64,
    usage: RolloutTokenUsage,
    model_index: usize,
}


#[derive(Debug, Clone)]
struct UsageFileEntry {
    file_len: u64,
    modified_at: Option<SystemTime>,
    models: Vec<String>,
    events: Vec<UsageEvent>,
}


/// 现扫现算，不落任何文件：与上游 `codex_session_usage.rs` 的差别只在这里
fn usage_rollout_files() -> Result<Vec<PathBuf>, String> {
    let data_dir = modules::codex_account::get_codex_home();
    let mut files = Vec::new();
    for dir_name in SESSION_DIRS {
        let root = data_dir.join(dir_name);
        if !root.exists() {
            continue;
        }
        files.extend(list_rollout_files(&root)?);
    }
    files.sort();
    Ok(files)
}


fn load_usage_events(rollout_path: &Path) -> Result<UsageFileEntry, String> {
    let metadata = fs::metadata(rollout_path)
        .map_err(|error| format!("读取会话文件信息失败 ({}): {}", rollout_path.display(), error))?;
    let file_len = metadata.len();
    let modified_at = metadata.modified().ok();
    let cache_key = rollout_path.to_path_buf();

    {
        let cache = USAGE_SCAN_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = cache.get(&cache_key) {
            if entry.file_len == file_len && entry.modified_at == modified_at {
                return Ok(entry.clone());
            }
        }
    }

    let entry = scan_usage_events(rollout_path, file_len, modified_at)?;
    let mut cache = USAGE_SCAN_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(cache_key, entry.clone());
    Ok(entry)
}


/// 顺序读满整份 rollout：模型跟着 `session_meta`/`turn_context` 走，
/// `token_count` 的累计快照与上一条相减才是这一轮的用量。
fn scan_usage_events(
    rollout_path: &Path,
    file_len: u64,
    modified_at: Option<SystemTime>,
) -> Result<UsageFileEntry, String> {
    let file = File::open(rollout_path)
        .map_err(|error| format!("打开会话文件失败 ({}): {}", rollout_path.display(), error))?;
    let reader = BufReader::with_capacity(USAGE_READ_CHUNK_BYTES, file);

    let mut models: Vec<String> = Vec::new();
    let mut model_indexes = HashMap::<String, usize>::new();
    let mut current_model: Option<usize> = None;
    let mut previous: Option<RolloutTokenUsage> = None;
    let mut events: Vec<UsageEvent> = Vec::new();

    for (line_number, raw) in reader.lines().enumerate() {
        let line = raw.map_err(|error| {
            format!(
                "读取会话文件失败 ({} 第 {} 行): {}",
                rollout_path.display(),
                line_number + 1,
                error
            )
        })?;
        if line.is_empty() {
            continue;
        }
        // 一份 rollout 几百 MB，逐行都过 JSON 会白读三遍全文；先按子串筛掉九成行。
        if !line.contains("\"token_count\"")
            && !line.contains("\"session_meta\"")
            && !line.contains("\"turn_context\"")
        {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<JsonValue>(line.trim()) else {
            continue;
        };
        match parsed.get("type").and_then(JsonValue::as_str) {
            Some("session_meta") | Some("turn_context") => {
                if let Some(model) = parsed
                    .get("payload")
                    .and_then(|payload| payload.get("model"))
                    .and_then(JsonValue::as_str)
                {
                    current_model = Some(intern_model(model, &mut models, &mut model_indexes));
                }
            }
            Some("event_msg") => {
                let payload = parsed.get("payload");
                if payload.and_then(|value| value.get("type")).and_then(JsonValue::as_str)
                    != Some("token_count")
                {
                    continue;
                }
                // info 为 null 的快照只带额度，不带用量；跳过但保留 previous。
                let Some(usage) = payload
                    .and_then(|value| value.get("info"))
                    .and_then(|info| info.get("total_token_usage"))
                else {
                    continue;
                };
                let Some(timestamp) = parse_rollout_line_timestamp_seconds(&parsed) else {
                    continue;
                };
                let cumulative = parse_rollout_usage(usage);
                let delta = usage_delta(previous, cumulative);
                previous = Some(cumulative);
                if delta.total_tokens == 0 {
                    continue;
                }
                events.push(UsageEvent {
                    timestamp,
                    usage: delta,
                    model_index: current_model.unwrap_or(UNKNOWN_MODEL_INDEX),
                });
            }
            _ => {}
        }
    }

    Ok(UsageFileEntry {
        file_len,
        modified_at,
        models,
        events,
    })
}


fn intern_model(
    model: &str,
    models: &mut Vec<String>,
    model_indexes: &mut HashMap<String, usize>,
) -> usize {
    if let Some(index) = model_indexes.get(model) {
        return *index;
    }
    let index = models.len();
    models.push(model.to_string());
    model_indexes.insert(model.to_string(), index);
    index
}


fn parse_rollout_usage(usage: &JsonValue) -> RolloutTokenUsage {
    RolloutTokenUsage {
        input_tokens: u64_at(usage, "input_tokens"),
        cached_input_tokens: u64_at(usage, "cached_input_tokens"),
        cache_write_input_tokens: u64_at(usage, "cache_write_input_tokens"),
        output_tokens: u64_at(usage, "output_tokens"),
        reasoning_output_tokens: u64_at(usage, "reasoning_output_tokens"),
        total_tokens: u64_at(usage, "total_tokens"),
    }
}


/// 累计快照做差。真机 73 份文件里没有一次回落，回落分支（换 thread / 压缩后重开累计）按 0 记账，
/// 绝不产生负柱；这也保证「按天求和」与「会话」档那条会话合计同账。
fn usage_delta(
    previous: Option<RolloutTokenUsage>,
    current: RolloutTokenUsage,
) -> RolloutTokenUsage {
    let Some(previous) = previous else {
        return current;
    };
    RolloutTokenUsage {
        input_tokens: current.input_tokens.saturating_sub(previous.input_tokens),
        cached_input_tokens: current
            .cached_input_tokens
            .saturating_sub(previous.cached_input_tokens),
        cache_write_input_tokens: current
            .cache_write_input_tokens
            .saturating_sub(previous.cache_write_input_tokens),
        output_tokens: current.output_tokens.saturating_sub(previous.output_tokens),
        reasoning_output_tokens: current
            .reasoning_output_tokens
            .saturating_sub(previous.reasoning_output_tokens),
        total_tokens: current.total_tokens.saturating_sub(previous.total_tokens),
    }
}


fn local_usage_keys(timestamp: i64) -> Option<(String, i64, String)> {
    let local = Local.timestamp_opt(timestamp, 0).single()?;
    let midnight = local.date_naive().and_hms_opt(0, 0, 0)?;
    // 部分时区在零点跳时，从当天第一个有效本地时刻起算。
    let day_start = (0..1440).find_map(|minute| {
        Local.from_local_datetime(&(midnight + chrono::Duration::minutes(minute))).earliest()
    })?.timestamp();
    // 以实际经过的小时分桶：夏令时回拨的两个同名小时有各自的时间戳。
    let hour = day_start + (timestamp - day_start).div_euclid(3600) * 3600;
    let label = Local.timestamp_opt(hour, 0).single()?.format("%H:%M").to_string();
    Some((local.format("%Y-%m-%d").to_string(), hour, label))
}


pub fn query_session_usage(
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Result<CodexSessionUsageReport, String> {
    let started = Instant::now();
    let mut by_day = HashMap::<String, CodexUsageBucket>::new();
    let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
    let mut by_model = HashMap::<String, CodexUsageBucket>::new();
    let mut totals = CodexUsageTotals::default();
    let mut active_sessions = 0_u64;

    for path in usage_rollout_files()? {
        totals.file_count += 1;
        let entry = load_usage_events(&path)?;
        if accumulate_usage_entry(
            &entry,
            from_timestamp,
            to_timestamp,
            &mut by_day,
            &mut by_hour,
            &mut by_model,
            &mut totals,
        ) {
            active_sessions += 1;
        }
    }

    totals.session_count = active_sessions;

    let mut by_day = by_day.into_values().collect::<Vec<_>>();
    by_day.sort_by(|left, right| left.key.cmp(&right.key));
    let mut by_hour = by_hour.into_iter().collect::<Vec<_>>();
    by_hour.sort_by_key(|(timestamp, _)| *timestamp);
    let mut by_model = by_model.into_values().collect::<Vec<_>>();
    by_model.sort_by(|left, right| {
        right
            .total_tokens
            .cmp(&left.total_tokens)
            .then_with(|| left.key.cmp(&right.key))
    });

    Ok(CodexSessionUsageReport {
        totals,
        by_day,
        by_hour: by_hour.into_iter().map(|(_, bucket)| bucket).collect(),
        by_model,
        from_timestamp,
        to_timestamp,
        scan_millis: started.elapsed().as_millis() as u64,
    })
}


/// 一份 rollout 的事件灌进桶里；返回这条会话在窗口内是否真的有过用量。
/// 差分链在扫描阶段就已经算完，这里只按窗口挑事件——窗口从中间起，首桶拿到的仍是当天真实增量。
fn accumulate_usage_entry(
    entry: &UsageFileEntry,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    by_day: &mut HashMap<String, CodexUsageBucket>,
    by_hour: &mut HashMap<i64, CodexUsageBucket>,
    by_model: &mut HashMap<String, CodexUsageBucket>,
    totals: &mut CodexUsageTotals,
) -> bool {
    let mut counted = false;

    for event in &entry.events {
        if from_timestamp.is_some_and(|from| event.timestamp < from) {
            continue;
        }
        if to_timestamp.is_some_and(|to| event.timestamp >= to) {
            continue;
        }
        counted = true;
        totals.input_tokens += event.usage.input_tokens;
        totals.cached_input_tokens += event.usage.cached_input_tokens;
        totals.cache_write_input_tokens += event.usage.cache_write_input_tokens;
        totals.output_tokens += event.usage.output_tokens;
        totals.reasoning_output_tokens += event.usage.reasoning_output_tokens;
        totals.total_tokens += event.usage.total_tokens;
        totals.request_count += 1;

        let Some((day, hour, hour_label)) = local_usage_keys(event.timestamp) else {
            continue;
        };
        let model_label = model_label_of(entry, event.model_index);
        let model_key = if event.model_index == UNKNOWN_MODEL_INDEX {
            "unknown".to_string()
        } else {
            model_label.clone()
        };

        add_to_bucket(
            by_day
                .entry(day.clone())
                .or_insert_with(|| new_bucket(day.clone(), day)),
            event.usage,
        );
        add_to_bucket(
            by_hour
                .entry(hour)
                .or_insert_with(|| new_bucket(hour.to_string(), hour_label)),
            event.usage,
        );
        add_to_bucket(
            by_model
                .entry(model_key.clone())
                .or_insert_with(|| new_bucket(model_key, model_label)),
            event.usage,
        );
    }

    counted
}


fn new_bucket(key: String, label: String) -> CodexUsageBucket {
    CodexUsageBucket {
        key,
        label,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        request_count: 0,
    }
}


fn add_to_bucket(bucket: &mut CodexUsageBucket, usage: RolloutTokenUsage) {
    bucket.input_tokens += usage.input_tokens;
    bucket.cached_input_tokens += usage.cached_input_tokens;
    bucket.output_tokens += usage.output_tokens;
    bucket.total_tokens += usage.total_tokens;
    bucket.request_count += 1;
}


fn model_label_of(entry: &UsageFileEntry, model_index: usize) -> String {
    entry
        .models
        .get(model_index)
        .cloned()
        .unwrap_or_else(|| UNKNOWN_MODEL_LABEL.to_string())
}



// desko 侧唯一改写点：上游在这里枚举 instance store 里的多实例，desko 只有官方默认目录一份。
// 两个入口桩都不能用——`get_default_codex_home()` 返空路径、`load_instance_store()` 返 Err——
// 所以沿用 rev5 切号收尾的口径：直接取 `codex_account::get_codex_home()`（CODEX_HOME 或 ~/.codex）。
fn collect_instances() -> Result<Vec<CodexSyncInstance>, String> {
    Ok(vec![CodexSyncInstance {
        id: DEFAULT_INSTANCE_ID.to_string(),
        name: DEFAULT_INSTANCE_NAME.to_string(),
        data_dir: modules::codex_account::get_codex_home(),
        last_pid: None,
    }])
}


fn system_time_from_unix_seconds(value: Option<i64>) -> Option<SystemTime> {
    let seconds = value?;
    if seconds < 0 {
        return None;
    }
    UNIX_EPOCH.checked_add(Duration::from_secs(seconds as u64))
}


fn is_instance_running(
    instance: &CodexSyncInstance,
    process_entries: &[(u32, Option<String>)],
) -> bool {
    let codex_home = if instance.id == DEFAULT_INSTANCE_ID { None } else { instance.data_dir.to_str() };
    modules::process::resolve_codex_pid_from_entries(instance.last_pid, codex_home, process_entries)
        .is_some()
}


fn load_thread_snapshots(instance: &CodexSyncInstance) -> Result<Vec<ThreadSnapshot>, String> {
    let session_index_map = read_session_index_map(&instance.data_dir)?;
    let display_context = modules::codex_session_display::SessionDisplayContext::load(&instance.data_dir);
    let mut snapshots = Vec::new();
    for dir_name in SESSION_DIRS {
        let root_dir = instance.data_dir.join(dir_name);
        if !root_dir.exists() {
            continue;
        }
        for rollout_path in list_rollout_files(&root_dir)? {
            let Some(session_meta) = read_rollout_session_meta(&rollout_path)? else {
                continue;
            };
            let Some(id) = session_meta_id(&session_meta) else {
                continue;
            };
            let cwd = session_meta_cwd(&session_meta).unwrap_or_else(|| "未知工作目录".to_string());
            let index_title = session_index_map
                .get(&id)
                .and_then(session_index_title);
            let title = display_context
                .resolve_title(&id, index_title.as_deref())
                .unwrap_or_else(|| id.clone());
            let project_name = display_context.project_name_for_cwd(&cwd);
            let updated_at = resolve_thread_snapshot_updated_at_seconds(
                session_index_map.get(&id),
                &rollout_path,
            );
            let session_index_entry = session_index_map
                .get(&id)
                .cloned()
                .unwrap_or_else(|| json!({ "id": id, "thread_name": title }));

            snapshots.push(ThreadSnapshot {
                id,
                title,
                cwd,
                project_name,
                updated_at,
                rollout_path,
                session_index_entry,
                source_root: instance.data_dir.clone(),
            });
        }
    }

    Ok(snapshots)
}


fn list_rollout_files(root_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut result = Vec::new();
    let entries = fs::read_dir(root_dir)
        .map_err(|error| format!("读取目录失败 ({}): {}", root_dir.display(), error))?;

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("读取目录项失败 ({}): {}", root_dir.display(), error))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 ({}): {}", path.display(), error))?;
        if file_type.is_dir() {
            result.extend(list_rollout_files(&path)?);
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or_default();
        if file_name.starts_with("rollout-") && file_name.ends_with(".jsonl") {
            result.push(path);
        }
    }

    result.sort();
    Ok(result)
}


fn read_rollout_session_meta(path: &Path) -> Result<Option<JsonValue>, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("打开 rollout 文件失败 ({}): {}", path.display(), error))?;
    let reader = BufReader::new(file);
    for line in reader.lines() {
        let line =
            line.map_err(|error| format!("读取 rollout 文件失败 ({}): {}", path.display(), error))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
            return Ok(None);
        };
        if parsed.get("type").and_then(JsonValue::as_str) == Some("session_meta") {
            return Ok(Some(parsed));
        }
        return Ok(None);
    }
    Ok(None)
}


fn session_meta_id(meta: &JsonValue) -> Option<String> {
    meta.get("payload")
        .and_then(|payload| payload.get("id").or_else(|| payload.get("session_id")))
        .and_then(JsonValue::as_str)
        .map(str::to_string)
        .or_else(|| {
            meta.get("id")
                .or_else(|| meta.get("session_id"))
                .and_then(JsonValue::as_str)
                .map(str::to_string)
        })
}


fn session_meta_cwd(meta: &JsonValue) -> Option<String> {
    meta.get("payload")
        .and_then(|payload| payload.get("cwd"))
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}


fn read_session_index_map(root_dir: &Path) -> Result<HashMap<String, JsonValue>, String> {
    let path = root_dir.join(SESSION_INDEX_FILE);
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 session_index.jsonl 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    let mut entries = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
            continue;
        };
        let Some(id) = parsed.get("id").and_then(JsonValue::as_str) else {
            continue;
        };
        entries.insert(id.to_string(), parsed);
    }

    Ok(entries)
}


fn session_index_title(entry: &JsonValue) -> Option<String> {
    ["thread_name", "threadName", "title", "name"]
        .iter()
        .filter_map(|key| entry.get(*key))
        .find_map(|value| value.as_str().map(str::trim))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}


fn parse_session_index_updated_at_seconds(entry: &JsonValue) -> Option<i64> {
    [
        "updated_at",
        "updatedAt",
        "last_updated_at",
        "lastUpdatedAt",
    ]
    .iter()
    .filter_map(|key| entry.get(*key))
    .find_map(parse_json_timestamp_seconds)
}


fn resolve_thread_snapshot_updated_at_seconds(
    session_index_entry: Option<&JsonValue>,
    rollout_path: &Path,
) -> Option<i64> {
    let indexed = session_index_entry.and_then(parse_session_index_updated_at_seconds);
    let activity = rollout_file_activity_seconds(rollout_path);
    let resolved = match (indexed, activity) {
        (Some(indexed), Some(activity))
            if indexed.abs_diff(activity) > SESSION_INDEX_ACTIVITY_DRIFT_SECONDS as u64 =>
        {
            Some(activity)
        }
        (Some(indexed), _) => Some(indexed),
        (None, Some(activity)) => Some(activity),
        (None, None) => None,
    };
    resolved.or_else(|| rollout_file_modified_seconds(rollout_path))
}


fn rollout_file_activity_seconds(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let file_len = metadata.len();
    let mut file = File::open(path).ok()?;
    let mut offset = file_len;
    let mut scanned_bytes = 0u64;
    let mut pending_prefix = Vec::new();

    while offset > 0 && scanned_bytes < ROLLOUT_ACTIVITY_MAX_SCAN_BYTES {
        let remaining_scan = ROLLOUT_ACTIVITY_MAX_SCAN_BYTES - scanned_bytes;
        let chunk_len = ROLLOUT_ACTIVITY_READ_CHUNK_BYTES
            .min(offset as usize)
            .min(remaining_scan as usize);
        if chunk_len == 0 {
            break;
        }
        offset -= chunk_len as u64;
        scanned_bytes += chunk_len as u64;

        file.seek(SeekFrom::Start(offset)).ok()?;
        let mut chunk = vec![0u8; chunk_len];
        file.read_exact(&mut chunk).ok()?;

        let starts_on_line_boundary =
            offset == 0 || byte_before_is_newline(&mut file, offset).ok()?;
        chunk.extend_from_slice(&pending_prefix);

        let parse_from_index = if starts_on_line_boundary {
            pending_prefix.clear();
            0
        } else if let Some(newline_index) = chunk.iter().position(|byte| *byte == b'\n') {
            pending_prefix = chunk[..newline_index].to_vec();
            newline_index + 1
        } else {
            pending_prefix = chunk;
            continue;
        };

        if let Some(timestamp) = parse_latest_rollout_activity_seconds(&chunk[parse_from_index..]) {
            return Some(timestamp);
        }
    }

    if offset == 0 && !pending_prefix.is_empty() {
        parse_latest_rollout_activity_seconds(&pending_prefix)
    } else {
        None
    }
}


fn parse_latest_rollout_activity_seconds(content: &[u8]) -> Option<i64> {
    for line in content.split(|byte| *byte == b'\n').rev() {
        let raw = String::from_utf8_lossy(line);
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(parsed) = serde_json::from_str::<JsonValue>(trimmed) else {
            continue;
        };
        if let Some(timestamp) = parse_rollout_line_timestamp_seconds(&parsed) {
            return Some(timestamp);
        }
    }

    None
}


fn parse_rollout_line_timestamp_seconds(value: &JsonValue) -> Option<i64> {
    value
        .get("timestamp")
        .or_else(|| value.get("time"))
        .or_else(|| value.get("created_at"))
        .or_else(|| value.get("createdAt"))
        .and_then(parse_json_timestamp_seconds)
        .or_else(|| {
            value
                .get("payload")
                .and_then(|payload| {
                    payload
                        .get("timestamp")
                        .or_else(|| payload.get("time"))
                        .or_else(|| payload.get("created_at"))
                        .or_else(|| payload.get("createdAt"))
                })
                .and_then(parse_json_timestamp_seconds)
        })
}


fn parse_json_timestamp_seconds(value: &JsonValue) -> Option<i64> {
    match value {
        JsonValue::Number(number) => number.as_i64().map(normalize_codex_timestamp_seconds),
        JsonValue::String(text) => DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|value| value.timestamp())
            .or_else(|| {
                text.parse::<i64>()
                    .ok()
                    .map(normalize_codex_timestamp_seconds)
            }),
        _ => None,
    }
}


fn normalize_codex_timestamp_seconds(timestamp: i64) -> i64 {
    if timestamp > 10_000_000_000_000 {
        timestamp / 1_000_000
    } else if timestamp > 10_000_000_000 {
        timestamp / 1_000
    } else {
        timestamp
    }
}


fn rollout_file_modified_seconds(path: &Path) -> Option<i64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|value| i64::try_from(value.as_secs()).ok())
}


// ==== S2 写侧切片：会话回收站与打开位置 ====
// 上游 trash 簇（codex_session_manager.rs:761-1075、2232-3190）搬入，唯一删改是去掉官方 app-server：
// desko 的 codex_official_app_server 是裁剪桩，所以「官方 thread/delete + 侧栏元数据重建」整步不成立，
// 删除只剩文件法（先留底 → 删原 rollout → 重写 session_index.jsonl），与上游官方删除失败时的兜底分支同路。
// 详见 docs/design/codex/08-token-stats-and-entry-audit.md §7。

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionTrashSummary {
    pub requested_session_count: usize,
    pub trashed_session_count: usize,
    pub trashed_instance_count: usize,
    pub trash_dirs: Vec<String>,
    pub message: String,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTrashedSessionLocation {
    pub instance_id: String,
    pub instance_name: String,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTrashedSessionRecord {
    pub session_id: String,
    pub title: String,
    pub cwd: String,
    pub deleted_at: Option<i64>,
    pub size_bytes: u64,
    pub location_count: usize,
    pub locations: Vec<CodexTrashedSessionLocation>,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionRestoreSummary {
    pub requested_session_count: usize,
    pub restored_session_count: usize,
    pub restored_instance_count: usize,
    pub message: String,
}


#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSessionTrashDeleteSummary {
    pub requested_session_count: usize,
    pub deleted_session_count: usize,
    pub deleted_entry_count: usize,
    pub freed_size_bytes: u64,
    pub message: String,
}


#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrashedSessionManifest {
    session_id: String,
    title: String,
    cwd: String,
    instance_id: String,
    instance_name: String,
    instance_root: PathBuf,
    original_rollout_path: PathBuf,
    relative_rollout_path: String,
    session_index_entry: JsonValue,
    deleted_at: Option<String>,
}


#[derive(Debug, Clone)]
struct TrashedSessionEntry {
    entry_dir: PathBuf,
    manifest: TrashedSessionManifest,
}


/// 原子移动选中会话到 desko 回收站，然后更新索引；不对活跃文件执行 copy/delete。
pub fn move_sessions_to_trash_across_instances(
    session_ids: Vec<String>,
) -> Result<CodexSessionTrashSummary, String> {
    let _guard = SESSION_TRASH_MUTATION_LOCK.lock()
        .map_err(|_| "会话回收站操作锁已损坏".to_string())?;
    let requested_ids = session_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>();
    if requested_ids.is_empty() {
        return Err(String::from("请至少选择一条会话"));
    }

    let instances = collect_instances()?;
    let trash_root = create_trash_root_dir()?;
    let mut trashed_session_ids = HashSet::new();
    let mut trashed_instance_count = 0usize;

    for instance in &instances {
        let snapshots = load_thread_snapshots(instance)?
            .into_iter()
            .filter(|snapshot| requested_ids.contains(&snapshot.id))
            .collect::<Vec<_>>();
        if snapshots.is_empty() {
            continue;
        }

        trash_snapshots_for_instance(instance, &trash_root, &snapshots)?;
        trashed_instance_count += 1;
        for snapshot in snapshots {
            trashed_session_ids.insert(snapshot.id);
        }
    }

    if trashed_instance_count == 0 {
        return Ok(CodexSessionTrashSummary {
            requested_session_count: requested_ids.len(),
            trashed_session_count: 0,
            trashed_instance_count: 0,
            trash_dirs: Vec::new(),
            message: String::from("所选会话在当前 Codex 目录中不存在，无需处理"),
        });
    }

    Ok(CodexSessionTrashSummary {
        requested_session_count: requested_ids.len(),
        trashed_session_count: trashed_session_ids.len(),
        trashed_instance_count,
        trash_dirs: vec![trash_root.to_string_lossy().to_string()],
        message: format!(
            "已将 {} 条会话移到回收站，并从官方会话目录移除；Codex 若在运行，需重启后其侧栏才同步",
            trashed_session_ids.len()
        ),
    })
}

pub fn list_trashed_sessions_across_instances() -> Result<Vec<CodexTrashedSessionRecord>, String> {
    let entries = load_trash_entries()?;
    let mut session_map = HashMap::<String, CodexTrashedSessionRecord>::new();

    for entry in entries {
        let deleted_at = parse_deleted_at(entry.manifest.deleted_at.as_deref());
        let record = session_map
            .entry(entry.manifest.session_id.clone())
            .or_insert_with(|| CodexTrashedSessionRecord {
                session_id: entry.manifest.session_id.clone(),
                title: entry.manifest.title.clone(),
                cwd: entry.manifest.cwd.clone(),
                deleted_at,
                size_bytes: 0,
                location_count: 0,
                locations: Vec::new(),
            });

        if deleted_at.unwrap_or_default() > record.deleted_at.unwrap_or_default() {
            record.deleted_at = deleted_at;
        }
        if record.title.trim().is_empty() {
            record.title = entry.manifest.title.clone();
        }
        if record.cwd.trim().is_empty() {
            record.cwd = entry.manifest.cwd.clone();
        }

        record.locations.push(CodexTrashedSessionLocation {
            instance_id: entry.manifest.instance_id.clone(),
            instance_name: entry.manifest.instance_name.clone(),
        });
        record.location_count = record.locations.len();
        record.size_bytes = record
            .size_bytes
            .saturating_add(calculate_path_size(&entry.entry_dir).unwrap_or(0));
    }

    let mut sessions = session_map.into_values().collect::<Vec<_>>();
    sessions.sort_by(|left, right| {
        right
            .deleted_at
            .unwrap_or_default()
            .cmp(&left.deleted_at.unwrap_or_default())
            .then_with(|| left.cwd.cmp(&right.cwd))
            .then_with(|| left.title.cmp(&right.title))
    });
    Ok(sessions)
}

pub fn delete_trashed_sessions_across_instances(
    session_ids: Vec<String>,
) -> Result<CodexSessionTrashDeleteSummary, String> {
    let _guard = SESSION_TRASH_MUTATION_LOCK.lock()
        .map_err(|_| "会话回收站操作锁已损坏".to_string())?;
    let requested_ids = session_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>();
    if requested_ids.is_empty() {
        return Err(String::from("请至少选择一条会话"));
    }

    let entries = load_trash_entries()?
        .into_iter()
        .filter(|entry| requested_ids.contains(&entry.manifest.session_id))
        .collect::<Vec<_>>();

    if entries.is_empty() {
        return Ok(CodexSessionTrashDeleteSummary {
            requested_session_count: requested_ids.len(),
            deleted_session_count: 0,
            deleted_entry_count: 0,
            freed_size_bytes: 0,
            message: String::from("所选会话在回收站中不存在，无需删除"),
        });
    }

    let (deleted_session_ids, deleted_entry_count, freed_size_bytes) =
        delete_trash_entries(&entries)?;
    Ok(CodexSessionTrashDeleteSummary {
        requested_session_count: requested_ids.len(),
        deleted_session_count: deleted_session_ids.len(),
        deleted_entry_count,
        freed_size_bytes,
        message: format!(
            "已永久删除 {} 条回收站会话，释放约 {}",
            deleted_session_ids.len(),
            format_bytes(freed_size_bytes)
        ),
    })
}

pub fn empty_session_trash_across_instances() -> Result<CodexSessionTrashDeleteSummary, String> {
    let _guard = SESSION_TRASH_MUTATION_LOCK.lock()
        .map_err(|_| "会话回收站操作锁已损坏".to_string())?;
    let entries = match load_trash_entries() {
        Ok(entries) => entries,
        Err(error) => {
            modules::logger::log_warn(&format!(
                "清空 Codex 会话回收站前读取清单失败，将直接清理回收站目录: {}",
                error
            ));
            Vec::new()
        }
    };
    let requested_session_ids = entries
        .iter()
        .map(|entry| entry.manifest.session_id.clone())
        .collect::<HashSet<_>>();

    let mut freed_size_bytes = 0u64;
    let mut removed_root_count = 0usize;
    for root in get_session_trash_roots_for_read()? {
        if !root.exists() {
            continue;
        }
        freed_size_bytes = freed_size_bytes.saturating_add(calculate_path_size(&root).unwrap_or(0));
        remove_path_recursively(&root)?;
        removed_root_count += 1;
    }

    Ok(CodexSessionTrashDeleteSummary {
        requested_session_count: requested_session_ids.len(),
        deleted_session_count: requested_session_ids.len(),
        deleted_entry_count: entries.len(),
        freed_size_bytes,
        message: if removed_root_count == 0 {
            String::from("回收站为空，无需清理")
        } else {
            format!(
                "已清空 Codex 会话回收站，永久删除 {} 条会话，释放约 {}",
                requested_session_ids.len(),
                format_bytes(freed_size_bytes)
            )
        },
    })
}

pub fn restore_sessions_from_trash_across_instances(
    session_ids: Vec<String>,
) -> Result<CodexSessionRestoreSummary, String> {
    let _guard = SESSION_TRASH_MUTATION_LOCK.lock()
        .map_err(|_| "会话回收站操作锁已损坏".to_string())?;
    let requested_ids = session_ids
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<HashSet<_>>();
    if requested_ids.is_empty() {
        return Err(String::from("请至少选择一条会话"));
    }

    let entries = load_trash_entries()?
        .into_iter()
        .filter(|entry| requested_ids.contains(&entry.manifest.session_id))
        .collect::<Vec<_>>();

    if entries.is_empty() {
        return Ok(CodexSessionRestoreSummary {
            requested_session_count: requested_ids.len(),
            restored_session_count: 0,
            restored_instance_count: 0,
            message: String::from("所选会话在回收站中不存在，无需恢复"),
        });
    }

    let mut restored_session_ids = HashSet::new();
    let mut restored_instance_ids = HashSet::new();

    for entry in &entries {
        restore_trashed_session_entry(entry)?;
        restored_session_ids.insert(entry.manifest.session_id.clone());
        restored_instance_ids.insert(entry.manifest.instance_id.clone());
    }

    Ok(CodexSessionRestoreSummary {
        requested_session_count: requested_ids.len(),
        restored_session_count: restored_session_ids.len(),
        restored_instance_count: restored_instance_ids.len(),
        message: format!(
            "已恢复 {} 条会话；Codex 若在运行，需重启后其侧栏才显示",
            restored_session_ids.len()
        ),
    })
}

/// 打开这条会话 rollout 文件所在的官方目录。
pub fn resolve_session_location_dir(session_id: String) -> Result<PathBuf, String> {
    let rollout_path = resolve_session_rollout_path(session_id)?;
    rollout_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("无法解析会话文件所在目录: {}", rollout_path.display()))
}

/// 定位这条会话的 rollout JSONL。
pub fn resolve_session_rollout_path(session_id: String) -> Result<PathBuf, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(String::from("请选择一条会话"));
    }
    let mut best_snapshot: Option<ThreadSnapshot> = None;
    for instance in &collect_instances()? {
        for snapshot in load_thread_snapshots(instance)? {
            if snapshot.id != session_id {
                continue;
            }
            let should_replace = best_snapshot
                .as_ref()
                .map(|current| {
                    snapshot.updated_at.unwrap_or_default() > current.updated_at.unwrap_or_default()
                })
                .unwrap_or(true);
            if should_replace {
                best_snapshot = Some(snapshot);
            }
        }
    }
    let Some(snapshot) = best_snapshot else {
        return Err(String::from("未找到该会话文件"));
    };
    Ok(snapshot.rollout_path)
}

fn trash_snapshots_for_instance(
    instance: &CodexSyncInstance,
    trash_root: &Path,
    snapshots: &[ThreadSnapshot],
) -> Result<(), String> {
    // Move the file identity, not a copied snapshot: an active append handle must
    // continue writing to the retained file. Cross-volume moves fail safely.
    for snapshot in snapshots {
        move_snapshot_rollout_to_trash(instance, trash_root, snapshot)?;
    }
    rewrite_session_index_without_ids(&instance.data_dir, snapshots)
}

fn create_trash_root_dir() -> Result<PathBuf, String> {
    let root = get_session_trash_base_dir()?.join(format!("{}-{}", Utc::now().format("%Y%m%d-%H%M%S"), uuid::Uuid::new_v4()));
    fs::create_dir_all(&root)
        .map_err(|error| format!("创建会话回收站目录失败 ({}): {}", root.display(), error))?;
    Ok(root)
}

fn get_session_trash_base_dir() -> Result<PathBuf, String> {
    Ok(modules::account::get_data_dir()?.join(SESSION_TRASH_ROOT_DIR))
}

fn get_session_trash_roots_for_read() -> Result<Vec<PathBuf>, String> {
    Ok(vec![get_session_trash_base_dir()?])
}

/// Atomically move a rollout into its own recovery entry. Never copy + unlink:
/// that loses messages appended between the two operations.
fn move_snapshot_rollout_to_trash(
    instance: &CodexSyncInstance,
    trash_root: &Path,
    snapshot: &ThreadSnapshot,
) -> Result<(), String> {
    if !snapshot.rollout_path.exists() {
        return Ok(());
    }

    let relative_path = snapshot
        .rollout_path
        .strip_prefix(&snapshot.source_root)
        .map_err(|_| "会话文件不在实例目录内，已保留原文件".to_string())?;
    if relative_path.components().any(|component| !matches!(component, std::path::Component::Normal(_))) {
        return Err("会话相对路径无效，已保留原文件".into());
    }
    let entry_dir = trash_root.join(format!(
        "{}--{}--{}",
        sanitize_for_file_name(&instance.id),
        sanitize_for_file_name(&snapshot.id),
        uuid::Uuid::new_v4()
    ));
    let file_target = entry_dir.join("files").join(relative_path);
    if let Some(parent) = file_target.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("创建回收站会话目录失败 ({}): {}", parent.display(), error)
        })?;
    }

    let manifest = json!({
        "sessionId": snapshot.id,
        "title": snapshot.title,
        "cwd": snapshot.cwd,
        "instanceId": instance.id,
        "instanceName": instance.name,
        "instanceRoot": instance.data_dir,
        "originalRolloutPath": snapshot.rollout_path,
        "relativeRolloutPath": relative_path.to_string_lossy(),
        "sessionIndexEntry": snapshot.session_index_entry,
        "deletedAt": Utc::now().to_rfc3339(),
    });

    fs::create_dir_all(&entry_dir)
        .map_err(|error| format!("创建回收站条目失败 ({}): {}", entry_dir.display(), error))?;
    let manifest_path = entry_dir.join("manifest.json");
    let manifest_content = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("序列化会话回收站清单失败: {}", error))?
    );
    modules::atomic_write::write_string_atomic(&manifest_path, &manifest_content).map_err(
        |error| {
            format!(
                "写入会话回收站清单失败 ({}): {}",
                entry_dir.display(),
                error
            )
        },
    )?;
    move_rollout_without_replacing(&snapshot.rollout_path, &file_target).map_err(|error| {
        // Only this newly allocated manifest/empty directory may be removed on
        // failure. The source file is deliberately left intact, including when
        // the directories are on different volumes or a writer denies sharing.
        let _ = fs::remove_dir_all(&entry_dir);
        format!("无法安全移动会话到回收站，原文件已保留（请关闭占用程序，并确保回收站与会话位于同一磁盘）: {}", error)
    })
}

/// Preserve the open file identity, and atomically refuse an existing target.
/// A normal std::fs::rename may replace a file created after an exists check.
fn move_rollout_without_replacing(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVE_FILE_FLAGS};
        // canonicalize the parent to obtain Windows' extended-length prefix;
        // recovery paths include UUIDs and can exceed the legacy MAX_PATH.
        let wide_path = |path: &Path| -> std::io::Result<Vec<u16>> {
            let name = path.file_name().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "rollout path has no file name"))?;
            let parent = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "rollout path has no parent"))?;
            Ok(fs::canonicalize(parent)?.join(name).as_os_str().encode_wide().chain(Some(0)).collect())
        };
        let source = wide_path(source)?;
        let target = wide_path(target)?;
        // Neither REPLACE_EXISTING nor COPY_ALLOWED: same-volume move or refusal.
        unsafe { MoveFileExW(PCWSTR(source.as_ptr()), PCWSTR(target.as_ptr()), MOVE_FILE_FLAGS(0)) }
            .map_err(|_| std::io::Error::last_os_error())
    }
    #[cfg(not(windows))]
    {
        // hard_link atomically claims an absent destination on the same volume.
        // Both names point to the same inode, so active appends cannot be lost.
        fs::hard_link(source, target)?;
        if let Err(error) = fs::remove_file(source) {
            let _ = fs::remove_file(target);
            return Err(error);
        }
        Ok(())
    }
}

fn rewrite_session_index_without_ids(
    root_dir: &Path,
    snapshots: &[ThreadSnapshot],
) -> Result<(), String> {
    let path = root_dir.join(SESSION_INDEX_FILE);
    if !path.exists() {
        return Ok(());
    }

    let removed_ids = snapshots
        .iter()
        .map(|snapshot| snapshot.id.as_str())
        .collect::<HashSet<_>>();
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 session_index.jsonl 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    let retained = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return false;
            }
            match serde_json::from_str::<JsonValue>(trimmed) {
                Ok(value) => value
                    .get("id")
                    .and_then(JsonValue::as_str)
                    .map(|id| !removed_ids.contains(id))
                    .unwrap_or(true),
                Err(_) => true,
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    let final_content = if retained.is_empty() {
        String::new()
    } else {
        format!("{}\n", retained)
    };
    modules::atomic_write::write_string_atomic(&path, &final_content).map_err(|error| {
        format!(
            "重写 session_index.jsonl 失败 ({}): {}",
            path.display(),
            error
        )
    })?;
    Ok(())
}

fn parse_deleted_at(value: Option<&str>) -> Option<i64> {
    let parsed = value.and_then(|raw| DateTime::parse_from_rfc3339(raw).ok())?;
    Some(parsed.timestamp())
}

fn load_trash_entries() -> Result<Vec<TrashedSessionEntry>, String> {
    let mut entries = Vec::new();
    for root in get_session_trash_roots_for_read()? {
        entries.append(&mut load_trash_entries_from_root(&root)?);
    }

    entries.sort_by(|left, right| {
        parse_deleted_at(right.manifest.deleted_at.as_deref())
            .unwrap_or_default()
            .cmp(&parse_deleted_at(left.manifest.deleted_at.as_deref()).unwrap_or_default())
            .then_with(|| left.manifest.session_id.cmp(&right.manifest.session_id))
            .then_with(|| left.manifest.instance_id.cmp(&right.manifest.instance_id))
    });
    Ok(entries)
}

fn load_trash_entries_from_root(root: &Path) -> Result<Vec<TrashedSessionEntry>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    if session_restore_link(&fs::symlink_metadata(root).map_err(|error| error.to_string())?) {
        return Err("会话回收站根目录不能是链接".into());
    }

    let mut entries = Vec::new();
    let batch_dirs = fs::read_dir(root)
        .map_err(|error| format!("读取会话回收站目录失败 ({}): {}", root.display(), error))?;
    for batch_dir in batch_dirs {
        let batch_dir = batch_dir.map_err(|error| {
            format!("读取会话回收站目录项失败 ({}): {}", root.display(), error)
        })?;
        let batch_path = batch_dir.path();
        let metadata = fs::symlink_metadata(&batch_path).map_err(|error| error.to_string())?;
        if !metadata.is_dir() || session_restore_link(&metadata) {
            continue;
        }

        let entry_dirs = fs::read_dir(&batch_path).map_err(|error| {
            format!(
                "读取会话回收站批次目录失败 ({}): {}",
                batch_path.display(),
                error
            )
        })?;
        for entry in entry_dirs {
            let entry = entry.map_err(|error| {
                format!(
                    "读取会话回收站条目失败 ({}): {}",
                    batch_path.display(),
                    error
                )
            })?;
            let entry_path = entry.path();
            let metadata = fs::symlink_metadata(&entry_path).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || session_restore_link(&metadata) {
                continue;
            }

            let manifest_path = entry_path.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            if session_restore_link(&fs::symlink_metadata(&manifest_path).map_err(|error| error.to_string())?) {
                continue;
            }
            let files_root = entry_path.join("files");
            let metadata = match fs::symlink_metadata(&files_root) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            if !metadata.is_dir() || session_restore_link(&metadata) { continue; }
            let manifest_content = fs::read_to_string(&manifest_path).map_err(|error| {
                format!(
                    "读取会话回收站清单失败 ({}): {}",
                    manifest_path.display(),
                    error
                )
            })?;
            let manifest = serde_json::from_str::<TrashedSessionManifest>(&manifest_content)
                .map_err(|error| {
                    format!(
                        "解析会话回收站清单失败 ({}): {}",
                        manifest_path.display(),
                        error
                    )
                })?;
            let relative = Path::new(&manifest.relative_rollout_path);
            if relative.as_os_str().is_empty()
                || relative.components().any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                continue;
            }
            let trashed_rollout_path = entry_path
                .join("files")
                .join(PathBuf::from(&manifest.relative_rollout_path));
            if !trashed_rollout_path.exists()
                && list_trash_restore_files(&entry_path.join("files"))?.is_empty()
            {
                continue;
            }
            entries.push(TrashedSessionEntry {
                entry_dir: entry_path,
                manifest,
            });
        }
    }

    Ok(entries)
}

include!("codex_session_trash_restore.rs");

fn rollout_session_id(path: &Path) -> Result<Option<String>, String> {
    Ok(read_rollout_session_meta(path)?.and_then(|meta| session_meta_id(&meta)))
}

fn format_session_index_updated_at(seconds: i64) -> String {
    Utc.timestamp_opt(seconds, 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

fn build_restored_session_index_entry(
    entry: &TrashedSessionEntry,
    rollout_path: &Path,
) -> JsonValue {
    let mut restored = entry.manifest.session_index_entry.clone();
    if !restored.is_object() {
        restored = json!({});
    }
    let Some(object) = restored.as_object_mut() else {
        return json!({
            "id": entry.manifest.session_id.clone(),
            "thread_name": entry.manifest.title.clone(),
        });
    };
    object.insert(
        "id".to_string(),
        JsonValue::String(entry.manifest.session_id.clone()),
    );
    if !entry.manifest.title.trim().is_empty() {
        object
            .entry("thread_name".to_string())
            .or_insert_with(|| JsonValue::String(entry.manifest.title.clone()));
    }
    if let Some(updated_at) = rollout_file_activity_seconds(rollout_path)
        .or_else(|| rollout_file_modified_seconds(rollout_path))
    {
        object.insert(
            "updated_at".to_string(),
            JsonValue::String(format_session_index_updated_at(updated_at)),
        );
    }
    restored
}

fn delete_trash_entries(
    entries: &[TrashedSessionEntry],
) -> Result<(HashSet<String>, usize, u64), String> {
    let mut deleted_session_ids = HashSet::new();
    let mut deleted_entry_count = 0usize;
    let mut freed_size_bytes = 0u64;

    for entry in entries {
        freed_size_bytes =
            freed_size_bytes.saturating_add(calculate_path_size(&entry.entry_dir).unwrap_or(0));
        remove_path_recursively(&entry.entry_dir)?;
        cleanup_empty_trash_ancestors(&entry.entry_dir);
        deleted_session_ids.insert(entry.manifest.session_id.clone());
        deleted_entry_count += 1;
    }

    Ok((deleted_session_ids, deleted_entry_count, freed_size_bytes))
}

fn calculate_path_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("读取路径大小失败 ({}): {}", path.display(), error))?;
    let file_type = metadata.file_type();
    if file_type.is_file() || file_type.is_symlink() || !file_type.is_dir() {
        return Ok(metadata.len());
    }

    let mut total = metadata.len();
    for entry in
        fs::read_dir(path).map_err(|error| format!("读取目录大小失败 ({}): {}", path.display(), error))?
    {
        let entry = entry
            .map_err(|error| format!("读取目录项大小失败 ({}): {}", path.display(), error))?;
        total = total.saturating_add(calculate_path_size(&entry.path())?);
    }
    Ok(total)
}

fn remove_path_recursively(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "读取待删除路径失败 ({}): {}",
                path.display(),
                error
            ))
        }
    };
    let file_type = metadata.file_type();
    if file_type.is_dir() && !file_type.is_symlink() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("删除目录失败 ({}): {}", path.display(), error))
    } else {
        fs::remove_file(path).map_err(|error| format!("删除文件失败 ({}): {}", path.display(), error))
    }
}

fn format_bytes(value: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = 1024.0 * KB;
    const GB: f64 = 1024.0 * MB;
    let value = value as f64;
    if value >= GB {
        format!("{:.1} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.1} KB", value / KB)
    } else {
        format!("{} B", value as u64)
    }
}

fn cleanup_empty_trash_ancestors(entry_dir: &Path) {
    let mut current = entry_dir.parent();
    while let Some(dir) = current {
        if dir
            .file_name()
            .and_then(|value| value.to_str())
            == Some(SESSION_TRASH_ROOT_DIR)
        {
            break;
        }
        let is_empty = fs::read_dir(dir)
            .ok()
            .and_then(|mut iterator| iterator.next().transpose().ok())
            .flatten()
            .is_none();
        if !is_empty {
            break;
        }
        if fs::remove_dir(dir).is_err() {
            break;
        }
        current = dir.parent();
    }
}

fn sanitize_for_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
}


#[cfg(test)]
mod tests {

    #[test]
    fn classify_session_kind_detects_subagent_and_external() {
        assert_eq!(
            super::classify_session_kind("subagent run", "/tmp"),
            "subagent"
        );
        assert_eq!(
            super::classify_session_kind("imported external", "/x"),
            "external"
        );
        assert_eq!(
            super::classify_session_kind("My chat", "/proj"),
            "conversation"
        );
        // Untitled chats must remain visible under the default conversation filter.
        assert_eq!(
            super::classify_session_kind("", "/Users/me/project"),
            "conversation"
        );
        assert_eq!(super::classify_session_kind("   ", "/tmp"), "conversation");
        assert_eq!(
            super::classify_session_kind("task", "/Users/me/.codex/subagent/work"),
            "subagent"
        );
    }

    #[test]
    fn parse_token_stats_lines_reads_all_six_usage_fields() {
        // 真机形状：一条会话净输入 8 万、缓存命中 176 万，少一位就把用量读成天文数字
        let older = r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":80,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":105}}}}"#;
        let noise = r#"{"type":"response_item","payload":{"type":"message"}}"#;
        let newest = r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1843378,"cached_input_tokens":1761280,"cache_write_input_tokens":4096,"output_tokens":11784,"reasoning_output_tokens":1617,"total_tokens":1855162}}}}"#;
        let text = format!("{}\n{}\n{}\n", older, noise, newest);
        let usage = super::parse_token_stats_lines(text.as_bytes()).expect("尾扫要命中最后一条 token_count");
        assert_eq!(usage.input_tokens, 1_843_378);
        assert_eq!(usage.cached_input_tokens, 1_761_280);
        assert_eq!(usage.cache_write_input_tokens, 4_096);
        assert_eq!(usage.output_tokens, 11_784);
        assert_eq!(usage.reasoning_output_tokens, 1_617);
        assert_eq!(usage.total_tokens, 1_855_162);

        // 早期 rollout 没写这几个位：按 0 记账，不能整条判成「没数」
        let thin = r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}}"#;
        let legacy = super::parse_token_stats_lines(thin.as_bytes()).unwrap();
        assert_eq!(legacy.cached_input_tokens, 0);
        assert_eq!(legacy.reasoning_output_tokens, 0);
        assert_eq!(legacy.output_tokens, 2);
    }
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let unique = uuid::Uuid::new_v4();
        let base_dir =
            std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), unique));
        if base_dir.exists() {
            fs::remove_dir_all(&base_dir).expect("cleanup old temp dir");
        }
        fs::create_dir_all(&base_dir).expect("create temp dir");
        base_dir
    }

    fn write_rollout(path: &Path, session_id: &str, marker: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create rollout parent");
        }
        fs::write(
            path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{}\",\"cwd\":\"/tmp/project\",\"model_provider\":\"relay\"}}}}\n{{\"type\":\"event\",\"timestamp\":\"2026-06-02T01:02:03Z\",\"payload\":{{\"marker\":\"{}\"}}}}\n",
                session_id, marker
            ),
        )
        .expect("write rollout");
    }

    #[test]
    fn resolve_thread_snapshot_updated_at_prefers_rollout_activity_when_index_is_stale() {
        let base_dir = make_temp_dir("codex-session-updated-at-drift-test");
        let rollout_path = base_dir.join("rollout-session-1.jsonl");
        write_rollout(&rollout_path, "session-1", "activity");
        let stale_index = json!({
            "id": "session-1",
            "thread_name": "Old index",
            "updated_at": "2024-01-01T00:00:00.000000Z",
        });

        assert_eq!(
            resolve_thread_snapshot_updated_at_seconds(Some(&stale_index), &rollout_path),
            Some(1_780_362_123)
        );

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    #[test]
    fn resolve_thread_snapshot_updated_at_keeps_index_when_close_to_rollout_activity() {
        let base_dir = make_temp_dir("codex-session-updated-at-index-test");
        let rollout_path = base_dir.join("rollout-session-1.jsonl");
        write_rollout(&rollout_path, "session-1", "activity");
        let current_index = json!({
            "id": "session-1",
            "thread_name": "Current index",
            "updated_at": "2026-06-02T01:30:00.000000Z",
        });

        assert_eq!(
            resolve_thread_snapshot_updated_at_seconds(Some(&current_index), &rollout_path),
            Some(1_780_363_800)
        );

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    #[test]
    fn conversation_search_matches_raw_keyword_anywhere_in_rollout() {
        let base_dir = make_temp_dir("codex-session-keyword-search-test");
        let rollout_path = base_dir.join("rollout-keyword.jsonl");
        fs::write(
            &rollout_path,
            concat!(
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"function_call_output\",\"output\":\"needle only appears in command output\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"中文关键字\"}}\n",
            ),
        )
        .expect("write rollout");

        assert!(
            rollout_conversation_contains_query_uncached(&rollout_path, "NEEDLE ONLY")
                .expect("search ascii keyword")
        );
        assert!(
            rollout_conversation_contains_query_uncached(&rollout_path, "中文关键字")
                .expect("search unicode keyword")
        );
        assert!(
            !rollout_conversation_contains_query_uncached(&rollout_path, "missing")
                .expect("search missing keyword")
        );

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    #[test]
    fn conversation_search_matches_keyword_across_read_chunks() {
        let base_dir = make_temp_dir("codex-session-keyword-chunk-test");
        let rollout_path = base_dir.join("rollout-keyword.jsonl");
        let mut content = vec![b'a'; CONTENT_SEARCH_READ_CHUNK_BYTES - 3];
        content.extend_from_slice(b"Sea");
        content.extend_from_slice(b"rchable");
        fs::write(&rollout_path, content).expect("write rollout");

        assert!(
            rollout_conversation_contains_query_uncached(&rollout_path, "searchable")
                .expect("search chunked keyword")
        );

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    #[test]
    fn trash_round_trip_keeps_a_copy_then_restores_file_and_index() {
        let base_dir = make_temp_dir("codex-session-trash-test");
        let instance_dir = base_dir.join("codex");
        let source_root = instance_dir.join("sessions").join("2026").join("10");
        let rollout_path = source_root.join("rollout-session-1.jsonl");
        let sibling_path = source_root.join("rollout-session-2.jsonl");
        write_rollout(&rollout_path, "session-1", "keep me");
        write_rollout(&sibling_path, "session-2", "leave me");
        let index_path = instance_dir.join(SESSION_INDEX_FILE);
        fs::write(
            &index_path,
            format!(
                "{}\n{}\n",
                json!({ "id": "session-1", "thread_name": "第一条" }),
                json!({ "id": "session-2", "thread_name": "第二条" })
            ),
        )
        .expect("write session index");

        let instance = CodexSyncInstance {
            id: DEFAULT_INSTANCE_ID.to_string(),
            name: DEFAULT_INSTANCE_NAME.to_string(),
            data_dir: instance_dir.clone(),
            last_pid: None,
        };
        let snapshot = ThreadSnapshot {
            id: "session-1".to_string(),
            title: "第一条".to_string(),
            cwd: "/tmp/project".to_string(),
            project_name: None,
            updated_at: None,
            rollout_path: rollout_path.clone(),
            session_index_entry: json!({ "id": "session-1", "thread_name": "第一条" }),
            source_root: source_root.clone(),
        };
        let trash_base_dir = base_dir.join(SESSION_TRASH_ROOT_DIR);
        let trash_batch_dir = trash_base_dir.join("20261012-000000");
        fs::create_dir_all(&trash_batch_dir).expect("create trash batch dir");

        trash_snapshots_for_instance(&instance, &trash_batch_dir, std::slice::from_ref(&snapshot))
            .expect("move session to trash");

        // 官方目录里这条已经没了，索引也只留兄弟那条
        assert!(!rollout_path.exists(), "原始 rollout 应已移除");
        assert!(sibling_path.exists(), "不该动到没选中的会话");
        let index_after_trash = fs::read_to_string(&index_path).expect("read index after trash");
        assert!(!index_after_trash.contains("session-1"));
        assert!(index_after_trash.contains("session-2"));

        let entries = load_trash_entries_from_root(&trash_base_dir).expect("load trash entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].manifest.session_id, "session-1");
        assert_eq!(
            entries[0].manifest.relative_rollout_path,
            "rollout-session-1.jsonl"
        );
        assert!(primary_trash_rollout_path(&entries[0]).exists(), "留底文件必须还在");

        restore_trashed_session_entry(&entries[0]).expect("restore session");
        assert!(rollout_path.exists(), "会话文件应回到原位置");
        let index_after_restore = fs::read_to_string(&index_path).expect("read index after restore");
        assert!(index_after_restore.contains("session-1"));
        assert!(index_after_restore.contains("session-2"));
        assert!(
            load_trash_entries_from_root(&trash_base_dir)
                .expect("reload trash entries")
                .is_empty(),
            "恢复后回收站条目应清掉"
        );

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    #[test]
    fn rewrite_session_index_keeps_unparsable_lines_and_the_rest() {
        let base_dir = make_temp_dir("codex-session-index-rewrite-test");
        let index_path = base_dir.join(SESSION_INDEX_FILE);
        fs::write(
            &index_path,
            format!(
                "{}\nnot json at all\n{}\n",
                json!({ "id": "gone" }),
                json!({ "id": "kept" })
            ),
        )
        .expect("write index");
        let snapshots = vec![ThreadSnapshot {
            id: "gone".to_string(),
            title: String::new(),
            cwd: String::new(),
            project_name: None,
            updated_at: None,
            rollout_path: base_dir.join("missing.jsonl"),
            session_index_entry: JsonValue::Null,
            source_root: base_dir.clone(),
        }];

        rewrite_session_index_without_ids(&base_dir, &snapshots).expect("rewrite index");

        let retained = fs::read_to_string(&index_path).expect("read index");
        assert!(!retained.contains("\"gone\""));
        assert!(retained.contains("\"kept\""));
        // 读不懂的行原样留着：不能因为一行坏掉就把整份索引重写空
        assert!(retained.contains("not json at all"));

        fs::remove_dir_all(&base_dir).expect("cleanup temp dir");
    }

    fn usage_snapshot_line(timestamp: &str, input: u64, cached: u64, output: u64) -> String {
        json!({
            "timestamp": timestamp,
            "type": "event_msg",
            "payload": {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": input,
                        "cached_input_tokens": cached,
                        "cache_write_input_tokens": 0,
                        "output_tokens": output,
                        "reasoning_output_tokens": 0,
                        "total_tokens": input + output
                    }
                }
            }
        })
        .to_string()
    }

    fn usage_model_line(kind: &str, model: &str) -> String {
        json!({ "type": kind, "payload": { "model": model } }).to_string()
    }

    fn scan_usage_lines(dir: &Path, lines: &[String]) -> UsageFileEntry {
        let path = dir.join("rollout-usage-1.jsonl");
        fs::write(&path, format!("{}\n", lines.join("\n"))).expect("写入用量 rollout");
        let metadata = fs::metadata(&path).expect("读 rollout 信息");
        let entry = super::scan_usage_events(&path, metadata.len(), metadata.modified().ok())
            .expect("扫用量");
        fs::remove_file(&path).expect("清理 rollout");
        entry
    }

    #[test]
    fn usage_day_buckets_sum_back_to_final_cumulative() {
        let dir = make_temp_dir("codex-usage-sum");
        let entry = scan_usage_lines(
            &dir,
            &[
                usage_model_line("session_meta", "gpt-test"),
                usage_snapshot_line("2026-10-11T02:00:00.000Z", 100, 80, 5),
                // info 为 null 的快照只带额度，跳过但不能断掉差分链
                r#"{"timestamp":"2026-10-11T02:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":null}}"#.to_string(),
                usage_snapshot_line("2026-10-11T03:00:00.000Z", 150, 120, 9),
                r#"{"type":"response_item","payload":{"type":"message"}}"#.to_string(),
                // 与上一条完全相同：本轮没有用量，不该进轮次计数
                usage_snapshot_line("2026-10-11T03:10:00.000Z", 150, 120, 9),
            ],
        );

        let mut by_day = HashMap::<String, CodexUsageBucket>::new();
        let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
        let mut by_model = HashMap::<String, CodexUsageBucket>::new();
        let mut totals = CodexUsageTotals::default();
        assert!(accumulate_usage_entry(&entry, None, None, &mut by_day, &mut by_hour, &mut by_model, &mut totals));

        // 图的账必须等于「会话」档那条累计值，否则同屏两个数互相打脸
        assert_eq!(totals.input_tokens, 150);
        assert_eq!(totals.cached_input_tokens, 120);
        assert_eq!(totals.output_tokens, 9);
        assert_eq!(totals.total_tokens, 159);
        assert_eq!(totals.request_count, 2);
        let day_total = by_day
            .values()
            .map(|bucket| bucket.total_tokens)
            .sum::<u64>();
        assert_eq!(day_total, 159);
        assert_eq!(
            by_day
                .values()
                .map(|bucket| bucket.request_count)
                .sum::<u64>(),
            2
        );
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn usage_model_follows_turn_context_and_splits_buckets() {
        let dir = make_temp_dir("codex-usage-model");
        let entry = scan_usage_lines(
            &dir,
            &[
                usage_model_line("session_meta", "gpt-sol"),
                usage_snapshot_line("2026-10-11T02:00:00.000Z", 100, 80, 5),
                usage_snapshot_line("2026-10-11T02:05:00.000Z", 130, 110, 7),
                usage_model_line("turn_context", "gpt-luna"),
                usage_snapshot_line("2026-10-11T02:10:00.000Z", 180, 160, 12),
            ],
        );

        let mut by_day = HashMap::<String, CodexUsageBucket>::new();
        let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
        let mut by_model = HashMap::<String, CodexUsageBucket>::new();
        let mut totals = CodexUsageTotals::default();
        accumulate_usage_entry(&entry, None, None, &mut by_day, &mut by_hour, &mut by_model, &mut totals);

        assert_eq!(by_model.len(), 2);
        // 头两条快照都还是 gpt-sol：累计起算那一条整笔归它
        assert_eq!(by_model["gpt-sol"].total_tokens, 137);
        assert_eq!(by_model["gpt-sol"].input_tokens, 130);
        assert_eq!(by_model["gpt-sol"].request_count, 2);
        assert_eq!(by_model["gpt-luna"].total_tokens, 55);
        assert_eq!(by_model["gpt-luna"].cached_input_tokens, 50);
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn usage_cumulative_drop_clamps_to_zero() {
        let dir = make_temp_dir("codex-usage-drop");
        let entry = scan_usage_lines(
            &dir,
            &[
                usage_model_line("session_meta", "gpt-sol"),
                usage_snapshot_line("2026-10-11T02:00:00.000Z", 100, 80, 5),
                // 换 thread 后累计重开：回落那一条只能记 0，绝不能出负数
                usage_snapshot_line("2026-10-11T03:00:00.000Z", 40, 30, 2),
                usage_snapshot_line("2026-10-11T04:00:00.000Z", 60, 50, 4),
            ],
        );

        let mut by_day = HashMap::<String, CodexUsageBucket>::new();
        let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
        let mut by_model = HashMap::<String, CodexUsageBucket>::new();
        let mut totals = CodexUsageTotals::default();
        accumulate_usage_entry(&entry, None, None, &mut by_day, &mut by_hour, &mut by_model, &mut totals);

        assert_eq!(totals.input_tokens, 120);
        assert_eq!(totals.output_tokens, 7);
        assert_eq!(totals.request_count, 2);
        assert_eq!(by_model.values().map(|b| b.total_tokens).sum::<u64>(), 127);
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn usage_window_filters_events_not_the_delta_chain() {
        let dir = make_temp_dir("codex-usage-window");
        let yesterday = "2026-10-10T23:00:00.000Z";
        let today = "2026-10-11T01:00:00.000Z";
        let entry = scan_usage_lines(
            &dir,
            &[
                usage_model_line("session_meta", "gpt-sol"),
                usage_snapshot_line(yesterday, 1_000, 900, 20),
                usage_snapshot_line(today, 1_500, 1_300, 35),
            ],
        );

        let from = super::parse_json_timestamp_seconds(
            &serde_json::json!("2026-10-11T00:00:00.000Z"),
        )
        .expect("窗口起点");
        let mut by_day = HashMap::<String, CodexUsageBucket>::new();
        let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
        let mut by_model = HashMap::<String, CodexUsageBucket>::new();
        let mut totals = CodexUsageTotals::default();
        assert!(accumulate_usage_entry(
            &entry,
            Some(from),
            None,
            &mut by_day,
            &mut by_hour,
            &mut by_model,
            &mut totals
        ));

        // 差分是整条链算完再按窗口挑事件，所以窗口内首桶拿到的是当天真实增量 515，不是 1535
        assert_eq!(by_day.len(), 1);
        assert_eq!(
            by_day
                .values()
                .next()
                .expect("窗口内那一天")
                .total_tokens,
            515
        );
        assert_eq!(totals.input_tokens, 500);
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    #[test]
    fn usage_hour_buckets_use_event_time_and_preserve_totals() {
        let dir = make_temp_dir("codex-usage-hours");
        let at = |hour, minute| Local.with_ymd_and_hms(2026, 10, 13, hour, minute, 0)
            .earliest().expect("有效的本地时间");
        let entry = scan_usage_lines(&dir, &[
            usage_snapshot_line(&at(8, 15).to_rfc3339(), 100, 80, 5),
            usage_snapshot_line(&at(8, 45).to_rfc3339(), 130, 110, 7),
            usage_snapshot_line(&at(9, 15).to_rfc3339(), 180, 160, 12),
            usage_snapshot_line(&at(10, 0).to_rfc3339(), 240, 180, 20),
        ]);
        let mut by_day = HashMap::<String, CodexUsageBucket>::new();
        let mut by_hour = HashMap::<i64, CodexUsageBucket>::new();
        let mut by_model = HashMap::<String, CodexUsageBucket>::new();
        let mut totals = CodexUsageTotals::default();
        accumulate_usage_entry(&entry, Some(at(8, 0).timestamp()), Some(at(10, 0).timestamp()),
            &mut by_day, &mut by_hour, &mut by_model, &mut totals);
        assert_eq!(by_hour.len(), 2);
        assert_eq!(by_hour[&at(8, 0).timestamp()].total_tokens, 137);
        assert_eq!(by_hour[&at(8, 0).timestamp()].request_count, 2);
        assert_eq!(by_hour[&at(9, 0).timestamp()].total_tokens, 55);
        assert_eq!(by_hour.values().map(|bucket| bucket.total_tokens).sum::<u64>(), totals.total_tokens);
        assert_eq!(by_hour.values().map(|bucket| bucket.input_tokens).sum::<u64>(), totals.input_tokens);
        assert_eq!(by_hour.values().map(|bucket| bucket.cached_input_tokens).sum::<u64>(), totals.cached_input_tokens);
        assert_eq!(totals.request_count, 3);
        fs::remove_dir_all(&dir).expect("cleanup temp dir");
    }

    fn trash_fixture(label: &str) -> (PathBuf, CodexSyncInstance, PathBuf) {
        let root = make_temp_dir(label);
        let home = root.join("codex");
        fs::create_dir_all(&home).unwrap();
        let trash = root.join(SESSION_TRASH_ROOT_DIR);
        let batch = trash.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&batch).unwrap();
        (root, CodexSyncInstance {
            id: DEFAULT_INSTANCE_ID.into(), name: DEFAULT_INSTANCE_NAME.into(),
            data_dir: home, last_pid: None,
        }, batch)
    }

    #[test]
    fn move_never_replaces_an_existing_rollout() {
        let root = make_temp_dir("codex-no-replace");
        let source = root.join("source.jsonl");
        let target = root.join("target.jsonl");
        fs::write(&source, "source-version").unwrap();
        fs::write(&target, "target-version").unwrap();
        assert!(super::move_rollout_without_replacing(&source, &target).is_err());
        assert_eq!(fs::read_to_string(source).unwrap(), "source-version");
        assert_eq!(fs::read_to_string(target).unwrap(), "target-version");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_rejects_a_rollout_outside_its_source_root() {
        let (root, instance, batch) = trash_fixture("codex-outside-source");
        let path = instance.data_dir.join("sessions/rollout-live.jsonl");
        write_rollout(&path, "live", "retained");
        let mut snapshots = load_thread_snapshots(&instance).unwrap();
        snapshots[0].source_root = root.join("different-root");
        assert!(trash_snapshots_for_instance(&instance, &batch, &snapshots).is_err());
        assert!(fs::read_to_string(path).unwrap().contains("retained"));
        assert!(fs::read_dir(batch).unwrap().next().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trash_preserves_messages_from_an_open_writer_after_the_move() {
        let (root, instance, batch) = trash_fixture("codex-live-writer");
        let path = instance.data_dir.join("sessions/rollout-live.jsonl");
        write_rollout(&path, "live", "before");
        let mut writer = fs::OpenOptions::new().append(true).open(&path).unwrap();
        let snapshots = load_thread_snapshots(&instance).unwrap();
        trash_snapshots_for_instance(&instance, &batch, &snapshots).unwrap();
        writer.write_all(b"{\"type\":\"event_msg\",\"payload\":\"MESSAGE_AFTER_MOVE\"}\n").unwrap();
        writer.sync_all().unwrap();
        drop(writer);
        assert!(!path.exists());
        let entries = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(fs::read_to_string(&primary_trash_rollout_path(&entries[0])).unwrap().contains("MESSAGE_AFTER_MOVE"));
        restore_trashed_session_entry(&entries[0]).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("MESSAGE_AFTER_MOVE"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn same_session_id_in_multiple_rollouts_keeps_every_version() {
        let (root, instance, batch) = trash_fixture("codex-multiple-rollouts");
        let first = instance.data_dir.join("sessions/rollout-a.jsonl");
        let second = instance.data_dir.join("archived_sessions/rollout-b.jsonl");
        write_rollout(&first, "same-id", "FIRST_VERSION");
        write_rollout(&second, "same-id", "SECOND_VERSION");
        let snapshots = load_thread_snapshots(&instance).unwrap();
        trash_snapshots_for_instance(&instance, &batch, &snapshots).unwrap();
        let entries = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap();
        assert_eq!(entries.len(), 2);
        assert_ne!(entries[0].entry_dir, entries[1].entry_dir);
        for entry in &entries { restore_trashed_session_entry(entry).unwrap(); }
        assert!(fs::read_to_string(first).unwrap().contains("FIRST_VERSION"));
        assert!(fs::read_to_string(second).unwrap().contains("SECOND_VERSION"));
        assert!(load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restore_never_discards_a_different_version_with_the_same_id() {
        let (root, instance, batch) = trash_fixture("codex-restore-conflict");
        let path = instance.data_dir.join("sessions/rollout-a.jsonl");
        write_rollout(&path, "same-id", "BACKUP_VERSION");
        trash_snapshots_for_instance(&instance, &batch, &load_thread_snapshots(&instance).unwrap()).unwrap();
        let entries = load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap();
        write_rollout(&path, "same-id", "LIVE_VERSION");
        assert!(restore_trashed_session_entry(&entries[0]).is_err());
        assert!(fs::read_to_string(&path).unwrap().contains("LIVE_VERSION"));
        assert!(fs::read_to_string(&primary_trash_rollout_path(&entries[0])).unwrap().contains("BACKUP_VERSION"));
        // Legacy entries may already contain more than one rollout behind one
        // manifest. Never recursively delete those remaining recovery copies.
        let legacy_extra = entries[0].entry_dir.join("files/sessions/rollout-extra.jsonl");
        write_rollout(&legacy_extra, "same-id", "LEGACY_EXTRA");
        fs::remove_file(&path).unwrap();
        restore_trashed_session_entry(&entries[0]).unwrap();
        assert!(!legacy_extra.exists());
        assert!(fs::read_to_string(&path).unwrap().contains("BACKUP_VERSION"));
        assert!(fs::read_to_string(instance.data_dir.join("sessions/rollout-extra.jsonl")).unwrap().contains("LEGACY_EXTRA"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn incompatible_writer_leaves_the_original_session_intact() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, instance, batch) = trash_fixture("codex-exclusive-writer");
        let path = instance.data_dir.join("sessions/rollout-a.jsonl");
        write_rollout(&path, "locked", "UNCHANGED");
        let snapshots = load_thread_snapshots(&instance).unwrap();
        let writer = fs::OpenOptions::new().append(true).share_mode(1).open(&path).unwrap();
        assert!(trash_snapshots_for_instance(&instance, &batch, &snapshots).is_err());
        drop(writer);
        assert!(fs::read_to_string(path).unwrap().contains("UNCHANGED"));
        assert!(load_trash_entries_from_root(&root.join(SESSION_TRASH_ROOT_DIR)).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    include!("codex_session_trash_restore_tests.rs");
}
