// Codex 账号命令实现。
//
// 本片段由 `commands/codex.rs` 通过 `include!` 纳入 `commands::codex` 模块，负责账号读取、
// 切换、OAuth、导入导出、配额和唤醒命令。对外调用仍使用 `commands::codex::<command>`，
// 不会因为物理拆分改变 Tauri command 名称或 Rust 调用路径。

static CODEX_POST_REFRESH_CHECK_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
const CODEX_BATCH_DELETE_JOBS_DIR: &str = "codex_batch_delete_jobs";
const CODEX_MAIL_PREVIEW_MAX_BYTES: usize = 512 * 1024;
static CODEX_BATCH_DELETE_JOBS: LazyLock<Mutex<HashMap<String, CodexBatchDeleteJob>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static CODEX_SWITCH_CANCEL_REQUESTS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

fn request_codex_switch_cancel(account_id: &str) {
    CODEX_SWITCH_CANCEL_REQUESTS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .insert(account_id.to_string());
}

fn clear_codex_switch_cancel(account_id: &str) {
    CODEX_SWITCH_CANCEL_REQUESTS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .remove(account_id);
}

fn ensure_codex_switch_not_cancelled(account_id: &str) -> Result<(), String> {
    if CODEX_SWITCH_CANCEL_REQUESTS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .contains(account_id)
    {
        Err("CODEX_START_CANCELLED".to_string())
    } else {
        Ok(())
    }
}

struct CodexSwitchProgressGuard {
    app: AppHandle,
    account_id: String,
    completed: bool,
}

impl Drop for CodexSwitchProgressGuard {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        let _ = self.app.emit(
            "codex:switch-progress",
            serde_json::json!({
                "accountId": self.account_id,
                "type": "error",
            }),
        );
    }
}

fn emit_codex_switch_step(
    app: &AppHandle,
    account_id: &str,
    step: &str,
    status: &str,
    progress: u8,
    details: serde_json::Value,
) {
    let _ = app.emit(
        "codex:switch-progress",
        serde_json::json!({
            "accountId": account_id,
            "step": step,
            "stepStatus": status,
            "progress": progress,
            "details": details,
        }),
    );
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexBatchDeleteJobStatus {
    job_id: String,
    status: String,
    total: usize,
    completed: usize,
    failed: usize,
    errors: Vec<CodexBatchDeleteError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexBatchDeleteError {
    account_id: String,
    error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexBatchDeleteJob {
    status: String,
    total: usize,
    completed: usize,
    failed: usize,
    errors: Vec<CodexBatchDeleteError>,
    account_ids: Vec<String>,
    next_index: usize,
    #[serde(default)]
    api_service_cleaned: bool,
    created_at: i64,
    updated_at: i64,
}

fn now_unix_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}

fn get_codex_batch_delete_jobs_dir() -> PathBuf {
    let data_dir = account::get_data_dir()
        .or_else(|_| account::resolve_data_dir())
        .unwrap_or_else(|_| crate::modules::data_paths::fallback_data_dir());
    data_dir.join(CODEX_BATCH_DELETE_JOBS_DIR)
}

fn sanitize_codex_batch_delete_job_id(job_id: &str) -> Result<String, String> {
    let trimmed = job_id.trim();
    if trimmed.is_empty() {
        return Err("批量删除任务 ID 为空".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("批量删除任务 ID 不合法".to_string());
    }
    Ok(trimmed.to_string())
}

fn codex_batch_delete_job_snapshot_path(job_id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_codex_batch_delete_job_id(job_id)?;
    Ok(get_codex_batch_delete_jobs_dir().join(format!("{}.json", safe_id)))
}

fn ensure_codex_batch_delete_jobs_dir(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        return Ok(());
    }
    if path.exists() {
        return Err(format!(
            "创建 Codex 批量删除任务目录失败: path={} 不是目录",
            path.display()
        ));
    }
    fs::create_dir(path).map_err(|error| {
        format!(
            "创建 Codex 批量删除任务目录失败: path={}, error={}",
            path.display(),
            error
        )
    })
}

fn save_codex_batch_delete_job_snapshot(
    job_id: &str,
    job: &CodexBatchDeleteJob,
) -> Result<(), String> {
    let path = codex_batch_delete_job_snapshot_path(job_id)?;
    if let Some(parent) = path.parent() {
        ensure_codex_batch_delete_jobs_dir(parent)?;
    }
    let content = serde_json::to_string_pretty(job)
        .map_err(|error| format!("序列化 Codex 批量删除任务失败: {}", error))?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, content).map_err(|error| {
        format!(
            "写入 Codex 批量删除任务快照失败: path={}, error={}",
            tmp_path.display(),
            error
        )
    })?;
    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "更新 Codex 批量删除任务快照失败: path={}, error={}",
            path.display(),
            error
        )
    })
}

fn save_codex_batch_delete_job_snapshot_best_effort(job_id: &str, job: &CodexBatchDeleteJob) {
    if let Err(error) = save_codex_batch_delete_job_snapshot(job_id, job) {
        logger::log_warn(&format!(
            "[Codex Batch Delete] 保存任务快照失败: job_id={}, error={}",
            job_id, error
        ));
    }
}

fn load_codex_batch_delete_job_snapshot(
    job_id: &str,
) -> Result<Option<CodexBatchDeleteJob>, String> {
    let path = codex_batch_delete_job_snapshot_path(job_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取 Codex 批量删除任务快照失败: path={}, error={}",
            path.display(),
            error
        )
    })?;
    let mut job: CodexBatchDeleteJob = serde_json::from_str(&content).map_err(|error| {
        format!(
            "解析 Codex 批量删除任务快照失败: path={}, error={}",
            path.display(),
            error
        )
    })?;
    if job.status == "running" {
        job.status = "paused".to_string();
    }
    Ok(Some(job))
}

fn remove_codex_batch_delete_job_snapshot(job_id: &str) {
    if let Ok(path) = codex_batch_delete_job_snapshot_path(job_id) {
        let _ = fs::remove_file(path);
    }
}

fn ensure_codex_batch_delete_job_loaded(job_id: &str) -> Result<(), String> {
    {
        let jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        if jobs.contains_key(job_id) {
            return Ok(());
        }
    }
    let Some(job) = load_codex_batch_delete_job_snapshot(job_id)? else {
        return Err("批量删除任务不存在".to_string());
    };
    let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
    jobs.entry(job_id.to_string()).or_insert(job);
    Ok(())
}

fn codex_batch_delete_status(job_id: &str, job: &CodexBatchDeleteJob) -> CodexBatchDeleteJobStatus {
    CodexBatchDeleteJobStatus {
        job_id: job_id.to_string(),
        status: job.status.clone(),
        total: job.total,
        completed: job.completed,
        failed: job.failed,
        errors: job.errors.clone(),
    }
}

fn get_codex_batch_delete_job_status(job_id: &str) -> Result<CodexBatchDeleteJobStatus, String> {
    ensure_codex_batch_delete_job_loaded(job_id)?;
    let jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
    let job = jobs
        .get(job_id)
        .ok_or_else(|| "批量删除任务不存在".to_string())?;
    Ok(codex_batch_delete_status(job_id, job))
}

async fn run_account_pool_cleanup_best_effort<F>(
    scope: &str,
    account_count: usize,
    timeout: Duration,
    cleanup: F,
) where
    F: std::future::Future<Output = Result<(), String>>,
{
    if account_count == 0 {
        return;
    }
    match tokio::time::timeout(timeout, cleanup).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            logger::log_warn(&format!(
                "[Codex Delete] 删除前移除 API 服务账号池引用失败，继续删除本地账号: scope={}, account_count={}, error={}",
                scope,
                account_count,
                error
            ));
        }
        Err(_) => {
            logger::log_warn(&format!(
                "[Codex Delete] 删除前移除 API 服务账号池引用超时，继续删除本地账号: scope={}, account_count={}",
                scope,
                account_count
            ));
        }
    }
}

async fn run_codex_batch_delete_job(job_id: String) {
    loop {
        let next_account_id = {
            let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
            let Some(job) = jobs.get_mut(&job_id) else {
                return;
            };
            if job.status == "paused" {
                job.updated_at = now_unix_seconds();
                let snapshot = job.clone();
                drop(jobs);
                save_codex_batch_delete_job_snapshot_best_effort(&job_id, &snapshot);
                return;
            }
            if job.next_index >= job.account_ids.len() {
                job.status = if job.failed > 0 {
                    "failed".to_string()
                } else {
                    "completed".to_string()
                };
                job.updated_at = now_unix_seconds();
                let snapshot = job.clone();
                drop(jobs);
                save_codex_batch_delete_job_snapshot_best_effort(&job_id, &snapshot);
                return;
            }
            job.status = "running".to_string();
            job.account_ids[job.next_index].clone()
        };

        let remove_account_id = next_account_id.clone();
        let remove_result = tauri::async_runtime::spawn_blocking(move || {
            codex_account::remove_account(&remove_account_id)
        })
        .await
        .map_err(|error| format!("批量删除后台任务失败: {}", error))
        .and_then(|result| result);

        let result = match remove_result {
            Ok(()) => Ok(()),
            Err(error) => Err(error),
        };

        if result.is_ok() {
            let account_id = next_account_id.clone();
            if let Err(error) =
                codex_wakeup::remove_deleted_accounts_from_tasks(&[account_id.clone()])
            {
                logger::log_warn(&format!(
                    "[Codex Batch Delete] 清理唤醒任务账号引用失败: job_id={}, account_id={}, error={}",
                    job_id, account_id, error
                ));
            }
        }

        let snapshot = {
            let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
            let Some(job) = jobs.get_mut(&job_id) else {
                return;
            };
            job.completed += 1;
            job.next_index += 1;
            if let Err(error) = result {
                job.failed += 1;
                job.errors.push(CodexBatchDeleteError {
                    account_id: next_account_id,
                    error,
                });
            }
            job.updated_at = now_unix_seconds();
            job.clone()
        };
        save_codex_batch_delete_job_snapshot_best_effort(&job_id, &snapshot);
    }
}

fn start_codex_batch_delete_job(
    account_ids: Vec<String>,
) -> Result<CodexBatchDeleteJobStatus, String> {
    let normalized_ids: Vec<String> = account_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    if normalized_ids.is_empty() {
        return Ok(CodexBatchDeleteJobStatus {
            job_id: String::new(),
            status: "completed".to_string(),
            total: 0,
            completed: 0,
            failed: 0,
            errors: Vec::new(),
        });
    }

    let job_id = format!("codex-delete-{}", uuid::Uuid::new_v4());
    let now = now_unix_seconds();
    let job = CodexBatchDeleteJob {
        status: "running".to_string(),
        total: normalized_ids.len(),
        completed: 0,
        failed: 0,
        errors: Vec::new(),
        account_ids: normalized_ids,
        next_index: 0,
        api_service_cleaned: false,
        created_at: now,
        updated_at: now,
    };
    // 任务快照用于崩溃恢复，但不能阻断实际删除。某些 Windows 数据目录位于
    // junction/reparse point 下时，创建新目录可能返回 ERROR_UNTRUSTED_MOUNT_POINT。
    save_codex_batch_delete_job_snapshot_best_effort(&job_id, &job);
    {
        let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        jobs.insert(job_id.clone(), job);
    }
    let task_job_id = job_id.clone();
    tauri::async_runtime::spawn(async move {
        run_codex_batch_delete_job(task_job_id).await;
    });

    get_codex_batch_delete_job_status(&job_id)
}

fn resume_codex_batch_delete_job(job_id: &str) -> Result<CodexBatchDeleteJobStatus, String> {
    ensure_codex_batch_delete_job_loaded(job_id)?;
    let should_spawn = {
        let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        let job = jobs
            .get_mut(job_id)
            .ok_or_else(|| "批量删除任务不存在".to_string())?;
        if matches!(job.status.as_str(), "completed" | "failed" | "running") {
            return Ok(codex_batch_delete_status(job_id, job));
        }
        job.status = "running".to_string();
        job.updated_at = now_unix_seconds();
        save_codex_batch_delete_job_snapshot_best_effort(job_id, job);
        true
    };
    if should_spawn {
        let task_job_id = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            run_codex_batch_delete_job(task_job_id).await;
        });
    }
    get_codex_batch_delete_job_status(job_id)
}

fn pause_codex_batch_delete_job(job_id: &str) -> Result<CodexBatchDeleteJobStatus, String> {
    ensure_codex_batch_delete_job_loaded(job_id)?;
    let snapshot = {
        let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        let job = jobs
            .get_mut(job_id)
            .ok_or_else(|| "批量删除任务不存在".to_string())?;
        if job.status == "running" {
            job.status = "paused".to_string();
            job.updated_at = now_unix_seconds();
        }
        job.clone()
    };
    save_codex_batch_delete_job_snapshot_best_effort(job_id, &snapshot);
    Ok(codex_batch_delete_status(job_id, &snapshot))
}

fn retry_failed_codex_batch_delete_job(job_id: &str) -> Result<CodexBatchDeleteJobStatus, String> {
    ensure_codex_batch_delete_job_loaded(job_id)?;
    let should_spawn = {
        let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        let job = jobs
            .get_mut(job_id)
            .ok_or_else(|| "批量删除任务不存在".to_string())?;
        if job.status == "running" || job.errors.is_empty() {
            return Ok(codex_batch_delete_status(job_id, job));
        }
        let mut retry_ids = Vec::new();
        for error in &job.errors {
            if !retry_ids.contains(&error.account_id) {
                retry_ids.push(error.account_id.clone());
            }
        }
        job.account_ids = retry_ids;
        job.total = job.account_ids.len();
        job.completed = 0;
        job.failed = 0;
        job.errors = Vec::new();
        job.next_index = 0;
        job.api_service_cleaned = false;
        job.status = "running".to_string();
        job.updated_at = now_unix_seconds();
        save_codex_batch_delete_job_snapshot_best_effort(job_id, job);
        !job.account_ids.is_empty()
    };
    if should_spawn {
        let task_job_id = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            run_codex_batch_delete_job(task_job_id).await;
        });
    }
    get_codex_batch_delete_job_status(job_id)
}

fn clear_codex_batch_delete_job(job_id: &str) {
    {
        let mut jobs = CODEX_BATCH_DELETE_JOBS.lock().unwrap();
        jobs.remove(job_id);
    }
    remove_codex_batch_delete_job_snapshot(job_id);
}

/// 列出所有 Codex 账号
#[tauri::command]
pub async fn list_codex_accounts() -> Result<Vec<CodexAccount>, String> {
    tauri::async_runtime::spawn_blocking(codex_account::list_accounts_checked)
        .await
        .map_err(|error| format!("读取 Codex 账号后台任务失败: {}", error))?
}

/// 获取当前激活的 Codex 账号
#[tauri::command]
pub fn get_current_codex_account() -> Result<Option<CodexAccount>, String> {
    Ok(codex_account::get_current_account())
}

#[tauri::command]
pub fn get_codex_config_toml_path() -> Result<String, String> {
    let path = codex_account::get_codex_home().join("config.toml");
    Ok(path.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexStoragePaths {
    provider_store_path: String,
    config_path: String,
    auth_path: String,
}

#[tauri::command]
pub async fn get_codex_storage_paths() -> Result<CodexStoragePaths, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let data_dir = account::get_data_dir()?;
        let codex_home = codex_account::get_codex_home();
        Ok(CodexStoragePaths {
            provider_store_path: data_dir
                .join("codex_model_providers.json")
                .to_string_lossy()
                .to_string(),
            config_path: codex_home.join("config.toml").to_string_lossy().to_string(),
            auth_path: codex_home.join("auth.json").to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|error| format!("读取 Codex 存储路径后台任务失败: {}", error))?
}

#[tauri::command]
pub async fn get_codex_wsl_auth_status() -> Result<codex_account::CodexWslAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(codex_account::get_codex_wsl_auth_status)
        .await
        .map_err(|error| format!("读取 WSL 登录态后台任务失败: {}", error))
}

#[tauri::command]
pub async fn sync_codex_auth_to_wsl() -> Result<Vec<codex_account::CodexWslAuthSyncResult>, String> {
    tauri::async_runtime::spawn_blocking(codex_account::sync_codex_auth_to_wsl)
        .await
        .map_err(|error| format!("同步 WSL 登录态后台任务失败: {}", error))?
}

#[tauri::command]
pub fn open_codex_config_toml(app: AppHandle) -> Result<(), String> {
    let path = codex_account::get_codex_home().join("config.toml");
    if !path.exists() {
        return Err(format!("未找到 Codex config.toml 文件: {}", path.display()));
    }

    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("打开 Codex config.toml 失败: {}", e))
}

#[tauri::command]
pub async fn get_codex_quick_config() -> Result<CodexQuickConfig, String> {
    tauri::async_runtime::spawn_blocking(codex_account::load_current_quick_config)
        .await
        .map_err(|error| format!("读取 Codex 快捷配置后台任务失败: {}", error))?
}

#[tauri::command]
pub async fn save_codex_context_management(
    experimental_mode: bool,
) -> Result<CodexQuickConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_account::save_context_management_for_base_dir(
            &codex_account::get_codex_home(),
            experimental_mode,
        )
    })
    .await
    .map_err(|error| format!("保存 Codex 上下文管理开关后台任务失败: {}", error))?
}

#[tauri::command]
pub async fn save_codex_quick_config(
    model_context_window: Option<i64>,
    auto_compact_token_limit: Option<i64>,
    experimental_model_catalog_enabled: Option<bool>,
    experimental_model_catalog_models: Option<
        Vec<crate::models::codex::CodexExperimentalModelDefinition>,
    >,
    experimental_model_catalog_default_model_id: Option<String>,
) -> Result<CodexQuickConfig, String> {
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let saved = codex_account::save_current_quick_config(
            model_context_window,
            auto_compact_token_limit,
            experimental_model_catalog_enabled,
            experimental_model_catalog_models,
            experimental_model_catalog_default_model_id,
        )?;
        crate::modules::codex_local_access::refresh_api_service_experimental_model_ids();
        Ok::<CodexQuickConfig, String>(saved)
    })
    .await
    .map_err(|error| format!("保存 Codex 快捷配置后台任务失败: {}", error))??;
    crate::modules::codex_local_access::trigger_gateway_reload_in_background("实验模型目录已更新");
    Ok(saved)
}

#[tauri::command]
pub async fn save_codex_model_catalog(
    experimental_model_catalog_enabled: bool,
    experimental_model_catalog_models: Vec<crate::models::codex::CodexExperimentalModelDefinition>,
    experimental_model_catalog_default_model_id: Option<String>,
) -> Result<CodexQuickConfig, String> {
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let saved = codex_account::save_current_model_catalog_preserving_context(
            experimental_model_catalog_enabled,
            experimental_model_catalog_models,
            experimental_model_catalog_default_model_id,
        )?;
        crate::modules::codex_local_access::refresh_api_service_experimental_model_ids();
        Ok::<CodexQuickConfig, String>(saved)
    })
    .await
    .map_err(|error| format!("保存 Codex 可见模型后台任务失败: {}", error))??;
    crate::modules::codex_local_access::trigger_gateway_reload_in_background("实验模型目录已更新");
    Ok(saved)
}

#[tauri::command]
pub async fn get_codex_model_reasoning_efforts(
    models: Vec<crate::models::codex::CodexExperimentalModelDefinition>,
    instance_id: Option<String>,
) -> Result<HashMap<String, Vec<String>>, String> {
    if models.len() > 1000 { return Err("MODEL_CONFIG_TOO_MANY_ITEMS".to_string()); }
    tauri::async_runtime::spawn_blocking(move || {
        let dir = codex_account::model_config_profile_dir(instance_id.as_deref().unwrap_or("__default__"))?;
        Ok(codex_account::model_reasoning_efforts_for_profile(&dir, &models))
    }).await.map_err(|_| "MODEL_CONFIG_READ_FAILED".to_string())?
}

#[tauri::command]
pub async fn preview_codex_model_config_import(instance_id: String, json_content: String,
    conflict_strategy: Option<String>) -> Result<crate::models::codex::CodexModelConfigImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = codex_account::model_config_profile_dir(&instance_id)?;
        codex_account::preview_model_config_import(&dir, &json_content,
            conflict_strategy.as_deref().unwrap_or("keep_existing"))
    }).await.map_err(|_| "MODEL_CONFIG_READ_FAILED".to_string())?
}

#[tauri::command]
pub async fn import_codex_model_config(app: AppHandle, instance_id: String, json_content: String,
    conflict_strategy: Option<String>, expected_revision: String)
    -> Result<crate::models::codex::CodexModelConfigImportPreview, String> {
    let event_instance_id = instance_id.clone();
    let event_revision = expected_revision.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let dir = codex_account::model_config_profile_dir(&instance_id)?;
        let result = codex_account::import_model_config(&dir, &json_content,
            conflict_strategy.as_deref().unwrap_or("keep_existing"), &expected_revision)?;
        crate::modules::codex_local_access::refresh_api_service_experimental_model_ids();
        Ok::<_, String>(result)
    }).await.map_err(|_| "MODEL_CONFIG_WRITE_FAILED".to_string())?;
    let (preview, before, after) = match result {
        Ok(value) => value,
        Err(error) => {
            let _ = app.emit("codex:model-config-imported", serde_json::json!({
                "instanceId": event_instance_id, "status": "error", "errorCode": "MODEL_CONFIG_WRITE_FAILED"
            }));
            return Err(error);
        }
    };
    crate::modules::codex_local_access::publish_model_config_service_import(&app, before, after).await;
    if preview.committed > 0 {
        crate::modules::codex_local_access::reload_active_gateway_after_model_config_import(event_instance_id.clone(), event_revision);
        let _ = app.emit("codex:model-config-imported", serde_json::json!({
            "instanceId": event_instance_id, "status": "saved", "committed": preview.committed,
            "models": preview.models, "defaultModelId": preview.default_model_id,
        }));
    }
    Ok(preview)
}

#[tauri::command]
pub async fn export_codex_model_config(instance_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = codex_account::model_config_profile_dir(&instance_id)?;
        codex_account::export_model_config(&dir)
    }).await.map_err(|_| "MODEL_CONFIG_READ_FAILED".to_string())?
}

/// 刷新账号资料（团队名/结构）
#[tauri::command]
pub async fn refresh_codex_account_profile(account_id: String) -> Result<CodexAccount, String> {
    codex_account::refresh_account_profile(&account_id).await
}

/// 用户手动强制轮换 OAuth Token。
///
/// 即使当前 access_token 仍有效，也会使用 refresh_token 获取新的 token 链；
/// 失败时保留账号与当前弹框状态，由前端提示用户重新授权或重试。
#[tauri::command]
pub async fn force_refresh_codex_tokens(account_id: String) -> Result<CodexAccount, String> {
    let account = codex_account::load_account(&account_id)
        .ok_or_else(|| format!("账号不存在: {}", account_id))?;
    if account.is_api_key_auth() {
        return Err("API Key 账号没有可刷新的 OAuth Token".to_string());
    }
    if account.is_agent_identity_auth() {
        return Err("Agent Identity 账号没有可刷新的 OAuth Token".to_string());
    }
    if account.is_web_session_auth() {
        return Err("Web Session 账号没有可刷新的 OAuth Token".to_string());
    }
    if !codex_account::account_has_refresh_token(&account) {
        return Err("当前 OAuth 账号缺少 refresh_token，请重新授权".to_string());
    }

    codex_account::force_refresh_managed_account(&account_id, "用户手动强制刷新 Token").await
}

/// 切换 Codex 账号（包含 token 刷新检查）
/// 默认实例切换到非 OAuth 账号时，关闭它的混合模型路由并释放对应的实例网关。
///
/// 混合路由只在绑定「可直接登录的 OAuth 订阅账号」时有意义，切换账号不应该被它拦住。
async fn disable_default_model_routing_for_non_oauth_switch() {
    let routing_enabled = crate::modules::codex_instance::load_default_settings()
        .ok()
        .and_then(|settings| settings.model_routing)
        .is_some_and(|routing| routing.enabled);
    if !routing_enabled {
        return;
    }
    if let Err(error) = crate::modules::codex_instance::disable_model_routing(
        crate::modules::codex_instance::CODEX_DEFAULT_INSTANCE_ID,
    ) {
        logger::log_warn(&format!(
            "[Codex切号] 关闭默认实例混合模型路由失败: {}",
            error
        ));
        return;
    }
    if let Ok(default_dir) = crate::modules::codex_instance::get_default_codex_home() {
        if let Err(error) =
            crate::modules::codex_local_access::release_instance_gateway_for_profile(&default_dir)
                .await
        {
            logger::log_warn(&format!(
                "[Codex切号] 停止默认实例混合模型路由网关失败: {}",
                error
            ));
        }
    }
}

#[tauri::command]
pub async fn switch_codex_account(
    app: AppHandle,
    account_id: String,
    auto_repair_mode: Option<codex_session_visibility::CodexSessionVisibilityAutoRepairMode>,
    reauth_token_generation: Option<u64>,
    launch_after_switch: Option<bool>,
) -> Result<CodexAccount, String> {
    clear_codex_switch_cancel(&account_id);
    let _profile_lease = codex_account::try_acquire_profile_mutation_lease(
        &codex_account::get_codex_home(),
        "oauth-account-switch",
    )?;
    let mut progress_guard = CodexSwitchProgressGuard {
        app: app.clone(),
        account_id: account_id.clone(),
        completed: false,
    };
    emit_codex_switch_step(
        &app,
        &account_id,
        "credentials",
        "running",
        4,
        serde_json::json!({}),
    );
    let flow_started = Instant::now();
    logger::log_info(&format!(
        "[Codex Switch][Backend] switch_codex_account started: account_id={}",
        account_id
    ));
    let initial_account = codex_account::load_account(&account_id)
        .ok_or_else(|| format!("账号不存在: {}", account_id))?;
    ensure_codex_switch_not_cancelled(&account_id)?;
    let is_oauth_account = !initial_account.is_api_key_auth()
        && !initial_account.is_agent_identity_auth()
        && !initial_account.is_web_session_auth();
    if !is_oauth_account {
        // 默认实例切到普通 API Key / 其他非 OAuth 账号时，混合模型路由必须自动关闭：
        // 路由的底座账号已经不存在，继续保留会拦住启动，并让后台监控反复尝试恢复网关。
        disable_default_model_routing_for_non_oauth_switch().await;
    }
    let access_token_present = !initial_account.tokens.access_token.trim().is_empty();
    let refresh_token_present = codex_account::account_has_refresh_token(&initial_account);
    let access_token_expires_at =
        codex_oauth::jwt_token_expiration_timestamp(&initial_account.tokens.access_token);
    let access_token_refresh_due =
        is_oauth_account && codex_oauth::is_token_expired(&initial_account.tokens.access_token);
    let is_reauth_handoff = reauth_token_generation.is_some();
    let credentials_need_refresh =
        !is_reauth_handoff && is_oauth_account && access_token_refresh_due;
    let initial_token_generation = initial_account.token_generation;
    let user_config = config::get_user_config();
    let launch_after_switch = launch_after_switch.unwrap_or(user_config.codex_launch_on_switch);
    // client_auth_status 仅记录官方客户端运行后的观测结果，不参与切号或启动拦截。
    // 真实 Token Authority 失败仍由 prepare/switch 流程返回结构化授权错误。

    emit_codex_switch_step(
        &app,
        &account_id,
        "credentials",
        "completed",
        10,
        serde_json::json!({
            "accountKind": if is_oauth_account { "oauth" } else { "other" },
            "hasAccessToken": access_token_present,
            "hasRefreshToken": refresh_token_present,
        }),
    );
    emit_codex_switch_step(
        &app,
        &account_id,
        "accessToken",
        if !is_oauth_account {
            "skipped"
        } else if access_token_refresh_due {
            "warning"
        } else {
            "running"
        },
        16,
        serde_json::json!({
            "present": access_token_present,
            "expiresAt": access_token_expires_at,
            "refreshDue": access_token_refresh_due,
            "opaque": access_token_present && access_token_expires_at.is_none(),
        }),
    );

    logger::log_info(&format!(
        "[Codex Switch][Backend] previous credential resolved: account_id={}, elapsed_ms={}",
        account_id,
        flow_started.elapsed().as_millis()
    ));
    // 切换账号事务：先准备并验证目标凭据，通过后再按启动模式停止旧运行态并提交。
    // 桌面模式关闭官方客户端；CLI 模式保留终端进程，仅停止受管 profile 服务。
    let switch_started = Instant::now();
    let step_app = app.clone();
    let step_account_id = account_id.clone();
    if credentials_need_refresh {
        emit_codex_switch_step(
            &app,
            &account_id,
            "refreshTokens",
            "running",
            26,
            serde_json::json!({
                "required": true,
                "hasRefreshToken": refresh_token_present,
            }),
        );
    } else {
        emit_codex_switch_step(
            &app,
            &account_id,
            "refreshTokens",
            "skipped",
            30,
            serde_json::json!({ "required": false }),
        );
    }
    let before_commit = move || {
        let step_app = step_app.clone();
        let step_account_id = step_account_id.clone();
        async move {
            if credentials_need_refresh {
                let prepared_account = codex_account::load_account(&step_account_id);
                emit_codex_switch_step(
                    &step_app,
                    &step_account_id,
                    "refreshTokens",
                    "completed",
                    40,
                    serde_json::json!({
                        "required": true,
                        "tokenGenerationChanged": prepared_account.as_ref().is_some_and(|account| {
                            account.token_generation > initial_token_generation
                        }),
                    }),
                );
            }
            emit_codex_switch_step(
                &step_app,
                &step_account_id,
                "accessToken",
                if is_oauth_account {
                    "completed"
                } else {
                    "skipped"
                },
                42,
                serde_json::json!({
                    "present": access_token_present,
                    "expiresAt": codex_account::load_account(&step_account_id).as_ref().and_then(|account| {
                        codex_oauth::jwt_token_expiration_timestamp(&account.tokens.access_token)
                    }),
                    "refreshDue": false,
                    "opaque": access_token_present && access_token_expires_at.is_none(),
                }),
            );
            emit_codex_switch_step(
                &step_app,
                &step_account_id,
                "writeCredentials",
                "running",
                58,
                serde_json::json!({}),
            );
            Ok(())
        }
    };
    let switch_result = if let Some(expected_generation) = reauth_token_generation {
        codex_account::switch_account_managed_after_reauth_with_before_commit(
            &account_id,
            expected_generation,
            before_commit,
        )
        .await
    } else {
        codex_account::switch_account_managed_with_before_commit_and_revalidation_options(
            &account_id,
            before_commit,
        )
        .await
    };
    ensure_codex_switch_not_cancelled(&account_id)?;
    let account = match switch_result {
        Ok(account) => account,
        Err(error) => {
            let formatted_error = codex_account::format_account_switch_error(&account_id, error);
            let auth_failure = formatted_error.starts_with("CODEX_SWITCH_AUTH_REQUIRED:");
            let _ = app.emit(
                "codex:switch-progress",
                serde_json::json!({
                    "accountId": account_id,
                    "type": "error",
                    "error": formatted_error,
                    "canRetry": !auth_failure,
                }),
            );
            progress_guard.completed = true;
            return Err(formatted_error);
        }
    };
    if is_reauth_handoff {
        let quota_account_id = account.id.clone();
        tokio::spawn(async move {
            if let Err(error) = Box::pin(codex_quota::refresh_account_quota_background(
                &quota_account_id,
            ))
            .await
            {
                logger::log_warn(&format!(
                    "重新授权切号完成后刷新配额失败: account_id={}, error={}",
                    quota_account_id, error
                ));
            }
        });
    }
    logger::log_info(&format!(
        "[Codex Switch][Backend] switch_account_managed finished: account_id={}, elapsed_ms={}, total_ms={}",
        account_id,
        switch_started.elapsed().as_millis(),
        flow_started.elapsed().as_millis()
    ));
    emit_codex_switch_step(
        &app,
        &account_id,
        "writeCredentials",
        "completed",
        68,
        serde_json::json!({}),
    );
    let account_speed = account.app_speed.clone();
    let speed_started = Instant::now();
    codex_speed::write_official_app_speed(account_speed.clone())?;
    logger::log_info(&format!(
        "[Codex Switch][Backend] write official app speed finished: account_id={}, elapsed_ms={}, total_ms={}",
        account_id,
        speed_started.elapsed().as_millis(),
        flow_started.elapsed().as_millis()
    ));
    emit_codex_switch_step(
        &app,
        &account_id,
        "syncSettings",
        "running",
        72,
        serde_json::json!({}),
    );
    let repair_started = Instant::now();
    logger::log_info(&format!(
        "[Codex Switch][Backend] session visibility repair stage finished: account_id={}, elapsed_ms={}, total_ms={}",
        account_id,
        repair_started.elapsed().as_millis(),
        flow_started.elapsed().as_millis()
    ));

    // 同步更新 Codex 默认实例的绑定账号（不同步到 Antigravity，因为账号体系不同）
    let default_settings_started = Instant::now();
    let default_bind_account_id =
        if crate::modules::codex_local_access::account_requires_provider_gateway(&account) {
            crate::modules::codex_instance::provider_gateway_bind_account_id(&account.id)
                .unwrap_or_else(|| account.id.clone())
        } else {
            account.id.clone()
        };
    if let Err(error) = crate::modules::codex_instance::bind_default_account_for_switch(
        &default_bind_account_id,
    ) {
        let _ = app.emit("codex:switch-progress", serde_json::json!({
            "accountId": account_id, "type": "error", "error": error,
            "canRetry": true,
        }));
        progress_guard.completed = true;
        return Err(error);
    }
    logger::log_info(&format!(
        "已同步更新 Codex 默认实例绑定账号: {}", default_bind_account_id
    ));
    if let Err(e) = crate::modules::codex_instance::update_default_app_speed(account_speed) {
        logger::log_warn(&format!("更新 Codex 默认实例速度失败: {}", e));
    }
    logger::log_info(&format!(
        "[Codex Switch][Backend] default settings update finished: account_id={}, elapsed_ms={}, total_ms={}",
        account_id,
        default_settings_started.elapsed().as_millis(),
        flow_started.elapsed().as_millis()
    ));

    // Full #1404: optional auto SSH sync after switch (hash-verified remote projection + app-server reload).
    if let Some(ssh_sync) =
        crate::modules::ssh_server::sync_selected_server_after_codex_switch(&account).await
    {
        if ssh_sync.verified {
            logger::log_info(&format!(
                "[Codex SSH] 切号后同步成功: server_id={}, account={}, verified={}",
                ssh_sync.server_id, ssh_sync.account_email, ssh_sync.verified
            ));
        } else {
            logger::log_warn(&format!(
                "[Codex SSH] 切号后同步失败: server_id={}, error={}",
                ssh_sync.server_id,
                ssh_sync.error.clone().unwrap_or_default()
            ));
        }
        let _ = app.emit("codex:ssh-sync-result", &ssh_sync);
    }

    emit_codex_switch_step(
        &app,
        &account_id,
        "syncSettings",
        "completed",
        82,
        serde_json::json!({}),
    );

    let tray_started = Instant::now();
    let _ = crate::modules::tray::update_tray_menu(&app);
    logger::log_info(&format!(
        "[Codex Switch][Backend] switch_codex_account finished: account_id={}, tray_elapsed_ms={}, total_ms={}",
        account_id,
        tray_started.elapsed().as_millis(),
        flow_started.elapsed().as_millis()
    ));
    let _ = app.emit(
        "codex:switch-progress",
        serde_json::json!({
            "accountId": account_id,
            "type": "complete",
            "stage": "completed",
            "progress": 100,
        }),
    );
    progress_guard.completed = true;
    clear_codex_switch_cancel(&account_id);
    Ok(account)
}

/// 请求停止账号切换及其后续启动事务；不会修改账号凭据或授权状态。
#[tauri::command]
pub async fn codex_cancel_account_switch(app: AppHandle, account_id: String) -> Result<(), String> {
    request_codex_switch_cancel(&account_id);
    let _ = app.emit(
        "codex:switch-progress",
        serde_json::json!({
            "accountId": account_id,
            "type": "cancelled",
            "error": "CODEX_START_CANCELLED",
            "cancelled": true,
        }),
    );
    Ok(())
}

async fn run_codex_post_refresh_checks(app: &AppHandle) {
    if CODEX_POST_REFRESH_CHECK_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        logger::log_info("[AutoSwitch][Codex] 后置检查进行中，跳过本次执行");
        return;
    }

    let mut switched = false;

    match codex_account::pick_auto_switch_target_if_needed() {
        Ok(Some(target)) => {
            let target_id = target.id.clone();
            // Keep the large switch state machine out of the post-refresh Future.
            match Box::pin(switch_codex_account(
                app.clone(),
                target_id.clone(),
                None,
                None,
                None,
            ))
            .await
            {
                Ok(switched_account) => {
                    logger::log_info(&format!(
                        "[AutoSwitch][Codex] 自动切号完成: target_id={}, email={}",
                        switched_account.id, switched_account.email
                    ));
                    switched = true;
                }
                Err(e) => {
                    logger::log_warn(&format!(
                        "[AutoSwitch][Codex] 自动切号失败: target_id={}, error={}",
                        target_id, e
                    ));
                }
            }
        }
        Ok(None) => {}
        Err(e) => {
            logger::log_warn(&format!("[AutoSwitch][Codex] 自动切号检查失败: {}", e));
        }
    }

    if !switched {
        if let Err(e) = codex_account::run_quota_alert_if_needed() {
            logger::log_warn(&format!("[QuotaAlert][Codex] 预警检查失败: {}", e));
        }
    }

    CODEX_POST_REFRESH_CHECK_IN_PROGRESS.store(false, Ordering::SeqCst);
}

/// 删除 Codex 账号
#[tauri::command]
pub async fn delete_codex_account(account_id: String) -> Result<(), String> {
    let delete_id = account_id.clone();
    tauri::async_runtime::spawn_blocking(move || codex_account::remove_account(&delete_id))
        .await.map_err(|error| error.to_string())??;
    if let Err(error) = codex_wakeup::remove_deleted_accounts_from_tasks(&[account_id.clone()]) {
        logger::log_warn(&format!(
            "[Codex] 清理唤醒任务账号引用失败: account_id={}, error={}",
            account_id, error
        ));
    }
    // 本地删除成功后立即返回；API 服务账号池持久化与网关重载在后台完成，
    // 避免外部进程延迟让用户误以为账号没有删除。
    Ok(())
}

/// 批量删除 Codex 账号
#[tauri::command]
pub async fn delete_codex_accounts(account_ids: Vec<String>) -> Result<(), String> {
    let mut deleted_ids = Vec::new();
    let mut result = Ok(());
    // Keep encryption and disk I/O off the runtime, releasing the account
    // mutation lock between records so large batches cannot monopolize it.
    for account_id in account_ids {
        let delete_id = account_id.clone();
        let deleted = tauri::async_runtime::spawn_blocking(move || {
            codex_account::remove_account(&delete_id)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|result| result);
        if let Err(error) = deleted {
            result = Err(error);
            break;
        }
        deleted_ids.push(account_id);
        tokio::task::yield_now().await;
    }
    if !deleted_ids.is_empty() {
        if let Err(error) = codex_wakeup::remove_deleted_accounts_from_tasks(&deleted_ids) {
            logger::log_warn(&format!(
                "[Codex] 批量清理唤醒任务账号引用失败: count={}, error={}",
                deleted_ids.len(),
                error
            ));
        }
        // Also clean up successful records when a later record failed.
    }
    result
}

#[tauri::command]
pub async fn start_codex_batch_delete(
    account_ids: Vec<String>,
) -> Result<CodexBatchDeleteJobStatus, String> {
    start_codex_batch_delete_job(account_ids)
}

#[tauri::command]
pub async fn get_codex_batch_delete(job_id: String) -> Result<CodexBatchDeleteJobStatus, String> {
    get_codex_batch_delete_job_status(&job_id)
}

#[tauri::command]
pub async fn resume_codex_batch_delete(
    job_id: String,
) -> Result<CodexBatchDeleteJobStatus, String> {
    resume_codex_batch_delete_job(&job_id)
}

#[tauri::command]
pub async fn pause_codex_batch_delete(job_id: String) -> Result<CodexBatchDeleteJobStatus, String> {
    pause_codex_batch_delete_job(&job_id)
}

#[tauri::command]
pub async fn retry_failed_codex_batch_delete(
    job_id: String,
) -> Result<CodexBatchDeleteJobStatus, String> {
    retry_failed_codex_batch_delete_job(&job_id)
}

#[tauri::command]
pub async fn clear_codex_batch_delete(job_id: String) -> Result<(), String> {
    clear_codex_batch_delete_job(&job_id);
    Ok(())
}

/// Re-activate current account after import when needed, then project auth side effects.
pub(crate) async fn reactivate_imported_current_if_needed(imported: &[CodexAccount]) {
    if let Some(account) = codex_account::reactivate_if_imported_matches_current(imported).await {
        let user_config = config::get_user_config();
        if let Err(e) = codex_speed::write_official_app_speed(account.app_speed.clone()) {
            logger::log_warn(&format!("[Codex导入] 重新激活后写入 app speed 失败: {}", e));
        }
    }
}

pub(crate) async fn refresh_imported_codex_accounts(
    app: &AppHandle,
    accounts: Vec<CodexAccount>,
) -> Vec<CodexAccount> {
    let mut result = Vec::with_capacity(accounts.len());
    let mut success_count = 0;
    let mut attempted = false;

    for account in accounts {
        if account.is_api_key_auth() {
            result.push(account);
            continue;
        }

        attempted = true;
        match Box::pin(codex_quota::refresh_account_quota(&account.id)).await {
            Ok(_) => {
                success_count += 1;
            }
            Err(error) => {
                logger::log_warn(&format!(
                    "Codex 导入后刷新配额失败: account_id={}, email={}, error={}",
                    account.id, account.email, error
                ));
            }
        }

        result.push(codex_account::load_account(&account.id).unwrap_or(account));
    }

    if success_count > 0 {
        Box::pin(run_codex_post_refresh_checks(app)).await;
    }
    if attempted || !result.is_empty() {
        let _ = crate::modules::tray::update_tray_menu(app);
    }

    result
}

/// 导入 named Codex access token 账号（`at-*` / personal access token）。
#[tauri::command]
pub async fn import_codex_access_token_account(
    app: AppHandle,
    name: String,
    access_token: String,
) -> Result<CodexAccount, String> {
    let account = codex_account::import_access_token_account(name, access_token)?;
    let account_id = account.id.clone();
    if let Err(error) = codex_account::refresh_account_profile(&account_id).await {
        logger::log_warn(&format!(
            "Codex access token account profile refresh failed after import: account_id={}, error={}",
            account_id, error
        ));
    }
    let refreshed = codex_account::load_account(&account_id).unwrap_or(account);
    reactivate_imported_current_if_needed(std::slice::from_ref(&refreshed)).await;
    let mut accounts = refresh_imported_codex_accounts(&app, vec![refreshed]).await;
    accounts
        .pop()
        .ok_or_else(|| "Account could not be loaded after import".to_string())
}

/// 解析「获取本地账号」要读取的 profile 目录。
///
/// 未指定实例（默认实例）时读取默认 `CODEX_HOME`；指定多开实例时读取该实例自己的
/// profile 目录，避免多开场景下只能拿到默认实例的本地账号。
fn resolve_codex_local_import_dir(instance_id: Option<&str>) -> Result<PathBuf, String> {
    match instance_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(instance_id) => {
            crate::modules::codex_instance::profile_dir_for_instance(instance_id)
        }
        None => Ok(crate::modules::codex_account::get_codex_home()),
    }
}

/// 从官方 Codex 本机凭据存储导入账号（auth.json / macOS Keychain）
///
/// `instance_id` 为空表示默认实例；传入多开实例 ID 时读取该实例 profile 目录下的凭据。
#[tauri::command]
pub async fn import_codex_from_local(
    app: AppHandle,
    instance_id: Option<String>,
) -> Result<CodexAccount, String> {
    let base_dir = resolve_codex_local_import_dir(instance_id.as_deref())?;
    logger::log_info(&format!(
        "Codex 获取本地账号: instance_id={}, profile_dir={}",
        instance_id.as_deref().unwrap_or("<default>"),
        base_dir.display()
    ));
    let account = codex_account::import_from_local_at(&base_dir)?;
    reactivate_imported_current_if_needed(std::slice::from_ref(&account)).await;
    let mut accounts = refresh_imported_codex_accounts(&app, vec![account]).await;
    accounts
        .pop()
        .ok_or_else(|| "账号导入后无法读取".to_string())
}

/// 从 JSON 字符串导入账号
#[tauri::command]
pub async fn import_codex_from_json(
    app: AppHandle,
    json_content: String,
) -> Result<Vec<CodexAccount>, String> {
    let accounts = codex_account::import_from_json(&json_content).await?;
    reactivate_imported_current_if_needed(&accounts).await;
    Ok(refresh_imported_codex_accounts(&app, accounts).await)
}

/// 导出 Codex 账号
#[tauri::command]
pub fn export_codex_accounts(account_ids: Vec<String>) -> Result<String, String> {
    codex_account::export_accounts(&account_ids)
}

/// 从本地文件导入 Codex 账号。
///
/// 直导路径：只落盘账号，不做导入前/导入后额度检测，避免单账号也因网络刷新变慢。
#[tauri::command]
pub async fn import_codex_from_files(
    app: AppHandle,
    file_paths: Vec<String>,
) -> Result<codex_account::CodexFileImportResult, String> {
    let result = codex_account::import_from_files(file_paths).await?;
    reactivate_imported_current_if_needed(&result.imported).await;
    if !result.imported.is_empty() {
        let _ = crate::modules::tray::update_tray_menu(&app);
    }
    Ok(result)
}

#[tauri::command]
pub fn start_codex_batch_import_from_files(
    app: AppHandle,
    file_paths: Vec<String>,
    check_quota: bool,
) -> Result<codex_account::CodexBatchImportStartResult, String> {
    codex_account::start_codex_batch_import_from_files(app, file_paths, check_quota)
}

#[tauri::command]
pub fn cancel_codex_batch_import(session_id: String) -> Result<(), String> {
    codex_account::cancel_codex_batch_import(&session_id)
}

#[tauri::command]
pub fn resume_codex_batch_import(app: AppHandle, session_id: String) -> Result<(), String> {
    codex_account::resume_codex_batch_import(app, &session_id)
}

#[tauri::command]
pub fn get_codex_batch_import_preview(
    session_id: String,
) -> Result<codex_account::CodexBatchImportPreview, String> {
    codex_account::get_codex_batch_import_preview(&session_id)
}

#[tauri::command]
pub async fn confirm_codex_batch_import(
    app: AppHandle,
    session_id: String,
    item_ids: Vec<String>,
) -> Result<codex_account::CodexBatchImportConfirmResult, String> {
    let result = codex_account::confirm_codex_batch_import(&app, &session_id, &item_ids)?;
    reactivate_imported_current_if_needed(&result.imported).await;
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(result)
}

/// 刷新单个账号配额
#[tauri::command]
pub async fn refresh_codex_quota(app: AppHandle, account_id: String) -> Result<CodexQuota, String> {
    // Box child Futures before awaiting them: boxing only the outer spawned IPC
    // task still constructs/moves its large inline state machine on the stack.
    // Keep the async command signature so Tauri uses its existing async wrapper.
    let result = Box::pin(codex_quota::refresh_account_quota(&account_id)).await;
    if result.is_ok() {
        Box::pin(run_codex_post_refresh_checks(&app)).await;
        let _ = crate::modules::tray::update_tray_menu(&app);
    }
    result
}

#[tauri::command]
pub async fn get_codex_reset_credits(
    account_id: String,
) -> Result<codex_quota::CodexResetCreditsSnapshot, String> {
    codex_quota::fetch_account_reset_credits(&account_id).await
}

#[tauri::command]
pub async fn consume_codex_reset_credit(account_id: String) -> Result<(), String> {
    codex_quota::consume_reset_credit(&account_id).await
}

#[tauri::command]
pub async fn refresh_codex_subscription_info(
    app: AppHandle,
    account_id: String,
) -> Result<CodexAccount, String> {
    let result = codex_quota::refresh_account_subscription_info(&account_id, true).await;
    if result.is_ok() {
        let _ = crate::modules::tray::update_tray_menu(&app);
    }
    result
}

#[tauri::command]
pub async fn refresh_current_codex_quota(app: AppHandle) -> Result<(), String> {
    let Some(account) = codex_account::get_current_account() else {
        return Err("未找到当前 Codex 账号".to_string());
    };
    if account.is_api_key_auth() {
        return Ok(());
    }
    // 分组策略「不刷新」：自动当前号刷新静默跳过
    if !codex_account::is_quota_refresh_enabled_for_account(&account.id) {
        logger::log_info(&format!(
            "[Codex Quota] 当前账号所属分组已关闭额度刷新，跳过: account_id={}",
            account.id
        ));
        return Ok(());
    }

    let result = Box::pin(codex_quota::refresh_account_quota(&account.id)).await;
    if result.is_ok() {
        Box::pin(run_codex_post_refresh_checks(&app)).await;
        let _ = crate::modules::tray::update_tray_menu(&app);
        Ok(())
    } else {
        Err(result
            .err()
            .unwrap_or_else(|| "刷新 Codex 配额失败".to_string()))
    }
}

/// 刷新所有账号配额
#[tauri::command]
pub async fn refresh_all_codex_quotas(app: AppHandle) -> Result<i32, String> {
    let results = Box::pin(codex_quota::refresh_all_quotas()).await?;
    let success_count = results.iter().filter(|(_, r)| r.is_ok()).count();
    if success_count > 0 {
        Box::pin(run_codex_post_refresh_checks(&app)).await;
    }
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(success_count as i32)
}

/// 按账号 ID 列表限流并发刷新配额（分组刷新 / 本地访问批量等）
/// 只在全部任务结束后做一次 tray / post-check，避免 N 次并发互踩。
///
/// `respect_group_quota_refresh` 缺省 true：跳过分组「不刷新」账号。
/// 显式「刷新分组」应传 false。
#[tauri::command]
pub async fn refresh_codex_quotas_batch(
    app: AppHandle,
    account_ids: Vec<String>,
    respect_group_quota_refresh: Option<bool>,
    background: Option<bool>,
) -> Result<i32, String> {
    let respect = respect_group_quota_refresh.unwrap_or(true);
    let results = if background.unwrap_or(false) {
        Box::pin(codex_quota::refresh_quotas_for_account_ids_in_background(
            &account_ids,
            respect,
        ))
        .await?
    } else {
        Box::pin(codex_quota::refresh_quotas_for_account_ids_with_options(
            &account_ids,
            respect,
        ))
        .await?
    };
    let success_count = results.iter().filter(|(_, r)| r.is_ok()).count();
    if success_count > 0 {
        Box::pin(run_codex_post_refresh_checks(&app)).await;
    }
    let _ = crate::modules::tray::update_tray_menu(&app);
    Ok(success_count as i32)
}

async fn save_codex_oauth_tokens(
    tokens: CodexTokens,
    reauth_account_id: Option<&str>,
    proxy_url: Option<String>,
) -> Result<CodexAccount, String> {
    let reauth_target = reauth_account_id.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    // 重新授权时账号已经存在：本次登录的出口可能是账号自身绑定或统一代理，
    // 两种都按原配置继续生效，授权流程不会借一次登录改写账号已有的代理绑定。
    let persisted_proxy = if reauth_target.is_some() {
        None
    } else {
        proxy_url
    };
    let selected_proxy = persisted_proxy.is_some();
    let account = if let Some(account_id) = reauth_target {
        codex_account::upsert_account_for_reauth(tokens, account_id)?
    } else if let Some(proxy_url) = persisted_proxy {
        codex_account::upsert_account_with_proxy(tokens, proxy_url)?
    } else {
        codex_account::upsert_account(tokens)?
    };

    // 旧官方客户端可能仍持有同一账号的旧 auth.json。普通新增授权使用刚落库的
    // 凭据直接查询配额，避免 live authority 把新 Token 覆盖回旧 Token；重新授权
    // 则等自动切号提交完成后再按正常流程刷新。
    if reauth_target.is_none() {
        if let Err(e) = codex_quota::refresh_freshly_authorized_account_quota(
            &account.id,
            account.token_generation,
        )
        .await
        {
            logger::log_error(&format!("刷新配额失败: {}", e));
        }
    }

    let loaded =
        codex_account::load_account(&account.id).ok_or_else(|| "账号保存后无法读取".to_string())?;
    if selected_proxy {
        let for_sidecar = loaded.clone();
        tauri::async_runtime::spawn_blocking(move || {
            if codex_local_access::sync_sidecar_auth_file_for_account(&for_sidecar).is_err() {
                logger::log_warn(&format!(
                    "OAuth 账号代理同步到 API Service sidecar 失败: account_id={}",
                    for_sidecar.id
                ));
            }
            if codex_local_access::collection_contains_account(&for_sidecar.id) {
                codex_local_access::trigger_gateway_reload_in_background("OAuth 账号代理已更新");
            }
        });
    }
    if reauth_target.is_some() {
        if let Err(error) = codex_account::sync_bound_oauth_consumers_after_reauth(&loaded.id).await
        {
            logger::log_warn(&format!(
                "OAuth 重新授权后同步绑定消费者失败，保留已保存授权: account_id={}, error={}",
                loaded.id, error
            ));
        }
    }
    logger::log_info(&format!(
        "Codex OAuth 账号已保存: account_id={}, email={}",
        loaded.id, loaded.email
    ));
    Ok(loaded)
}

/// OAuth：开始登录（返回 loginId + authUrl）
///
/// `reauth_account_id` 只在未显式提供 `proxy_url` 时用于解析该账号的生效出口
/// （账号独立绑定 > 统一代理）；首次添加账号不传该参数。
#[tauri::command]
pub async fn codex_oauth_login_start(
    app_handle: AppHandle,
    proxy_url: Option<String>,
    reauth_account_id: Option<String>,
) -> Result<codex_oauth::CodexOAuthLoginStartResponse, String> {
    logger::log_info("Codex OAuth start 命令触发");
    let response =
        codex_oauth::start_oauth_login(app_handle, proxy_url, reauth_account_id).await?;
    logger::log_info(&format!(
        "Codex OAuth start 命令成功: login_id={}",
        response.login_id
    ));
    Ok(response)
}

/// OAuth：使用官方设备授权流程（无本地回调端口）
#[tauri::command]
pub async fn codex_oauth_device_auth_start(
    app_handle: AppHandle,
) -> Result<codex_oauth::CodexDeviceAuthStartResponse, String> {
    logger::log_info("Codex OAuth device-auth 命令触发");
    codex_oauth::start_device_auth(app_handle).await
}

/// OAuth：浏览器授权完成后按 loginId 完成登录
#[tauri::command]
pub async fn codex_oauth_login_completed(
    login_id: String,
    reauth_account_id: Option<String>,
) -> Result<CodexAccount, String> {
    let started_at_ms = chrono::Utc::now().timestamp_millis();
    logger::log_info(&format!(
        "Codex OAuth completed 命令开始: login_id={}, started_at_ms={}",
        login_id, started_at_ms
    ));
    let completion = match codex_oauth::complete_oauth_login(&login_id).await {
        Ok(completion) => completion,
        Err(e) => {
            logger::log_error(&format!(
                "Codex OAuth completed 命令失败: login_id={}, duration_ms={}, error={}",
                login_id,
                chrono::Utc::now().timestamp_millis() - started_at_ms,
                e
            ));
            return Err(e);
        }
    };
    let account = save_codex_oauth_tokens(completion.tokens, reauth_account_id.as_deref(), completion.proxy_url).await?;
    logger::log_info(&format!(
        "Codex OAuth completed 命令成功: login_id={}, duration_ms={}, account_id={}, account_email={}",
        login_id,
        chrono::Utc::now().timestamp_millis() - started_at_ms,
        account.id,
        account.email
    ));
    Ok(account)
}

/// OAuth：按 loginId 取消登录（login_id 为空时取消当前流程）
#[tauri::command]
pub fn codex_oauth_login_cancel(
    app_handle: AppHandle,
    login_id: Option<String>,
) -> Result<(), String> {
    logger::log_info(&format!(
        "Codex OAuth cancel 命令触发: login_id={}",
        login_id.as_deref().unwrap_or("<none>")
    ));
    let result = codex_oauth::cancel_oauth_flow_for(login_id.as_deref());
    logger::log_info(&format!(
        "Codex OAuth cancel 命令返回: {:?}",
        result.as_ref().map(|_| "ok").map_err(|e| e)
    ));
    result?;
    codex_oauth::close_oauth_window(&app_handle)
}

/// OAuth：手动提交回调链接（用于本地端口不可达时）
#[tauri::command]
pub fn codex_oauth_submit_callback_url(
    app_handle: AppHandle,
    login_id: String,
    callback_url: String,
) -> Result<(), String> {
    codex_oauth::submit_callback_url(login_id.as_str(), callback_url.as_str())?;
    let payload = serde_json::json!({ "loginId": login_id });
    let _ = app_handle.emit("codex-oauth-login-completed", payload.clone());
    let _ = app_handle.emit("ghcp-oauth-login-completed", payload);
    codex_oauth::close_oauth_window(&app_handle)?;
    Ok(())
}

/// 通过 Token 添加账号
#[tauri::command]
pub async fn add_codex_account_with_token(
    id_token: String,
    access_token: String,
    refresh_token: Option<String>,
) -> Result<CodexAccount, String> {
    let tokens = CodexTokens {
        id_token,
        access_token,
        refresh_token,
    };

    let account = codex_account::upsert_account(tokens)?;

    // 刷新配额
    if let Err(e) = codex_quota::refresh_account_quota(&account.id).await {
        logger::log_error(&format!("刷新配额失败: {}", e));
    }

    codex_account::load_account(&account.id).ok_or_else(|| "账号保存后无法读取".to_string())
}

/// 通过 API Key 添加账号
#[tauri::command]
pub fn add_codex_account_with_api_key(
    api_key: String,
    api_base_url: Option<String>,
    api_provider_mode: Option<CodexApiProviderMode>,
    api_provider_id: Option<String>,
    api_provider_name: Option<String>,
    api_model_catalog: Option<Vec<String>>,
    api_sync_model_catalog_to_codex: Option<bool>,
    api_wire_api: Option<String>,
    api_supports_websockets: Option<bool>,
    api_supports_vision: Option<bool>,
    api_model_vision_support: Option<std::collections::HashMap<String, bool>>,
    api_vision_routing_model: Option<String>,
    account_name: Option<String>,
    api_model_context_windows: Option<std::collections::HashMap<String, i64>>,
) -> Result<CodexAccount, String> {
    let account = codex_account::upsert_api_key_account(
        api_key,
        api_base_url,
        api_provider_mode,
        api_provider_id,
        api_provider_name,
        api_model_catalog.unwrap_or_default(),
        api_sync_model_catalog_to_codex,
        api_wire_api,
        api_supports_websockets.unwrap_or(false),
        api_supports_vision.unwrap_or(false),
        api_model_vision_support.unwrap_or_default(),
        api_vision_routing_model,
        account_name,
        api_model_context_windows,
    )?;
    codex_account::load_account(&account.id).ok_or_else(|| "账号保存后无法读取".to_string())
}

#[tauri::command]
pub fn update_codex_account_name(account_id: String, name: String) -> Result<CodexAccount, String> {
    codex_account::update_account_name(&account_id, name)
}

#[tauri::command]
pub async fn update_codex_api_key_credentials(
    account_id: String,
    api_key: String,
    api_base_url: Option<String>,
    api_provider_mode: Option<CodexApiProviderMode>,
    api_provider_id: Option<String>,
    api_provider_name: Option<String>,
    api_model_catalog: Option<Vec<String>>,
    api_sync_model_catalog_to_codex: Option<bool>,
    api_wire_api: Option<String>,
    api_supports_websockets: Option<bool>,
    api_supports_vision: Option<bool>,
    api_model_vision_support: Option<std::collections::HashMap<String, bool>>,
    api_vision_routing_model: Option<String>,
    account_name: Option<String>,
    api_model_context_windows: Option<std::collections::HashMap<String, i64>>,
) -> Result<CodexAccount, String> {
    tauri::async_runtime::spawn_blocking(move || codex_account::update_api_key_credentials(
        &account_id,
        api_key,
        api_base_url,
        api_provider_mode,
        api_provider_id,
        api_provider_name,
        api_model_catalog.unwrap_or_default(),
        api_sync_model_catalog_to_codex,
        api_wire_api,
        api_supports_websockets.unwrap_or(false),
        api_supports_vision.unwrap_or(false),
        api_model_vision_support.unwrap_or_default(),
        api_vision_routing_model,
        account_name,
        api_model_context_windows,
    ))
    .await.map_err(|error| format!("更新 API Key 任务失败: {}", error))?
}

#[tauri::command]
pub async fn sync_codex_api_key_provider_accounts(
    account_ids: Vec<String>,
    api_base_url: Option<String>,
    api_provider_mode: Option<CodexApiProviderMode>,
    api_provider_id: Option<String>,
    api_provider_name: Option<String>,
    api_model_catalog: Option<Vec<String>>,
    api_wire_api: Option<String>,
    api_supports_websockets: Option<bool>,
    api_supports_vision: Option<bool>,
    api_model_vision_support: Option<std::collections::HashMap<String, bool>>,
    api_vision_routing_model: Option<String>,
    api_model_context_windows: Option<std::collections::HashMap<String, i64>>,
) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_account::sync_api_key_provider_accounts(
            account_ids,
            api_base_url,
            api_provider_mode,
            api_provider_id,
            api_provider_name,
            api_model_catalog.unwrap_or_default(),
            api_wire_api,
            api_supports_websockets.unwrap_or(false),
            api_supports_vision.unwrap_or(false),
            api_model_vision_support.unwrap_or_default(),
            api_vision_routing_model,
            api_model_context_windows,
        )
    })
    .await
    .map_err(|error| format!("同步 Codex 供应商账号快照任务失败: {}", error))?
}

#[tauri::command]
pub async fn update_codex_api_key_bound_oauth_account(
    account_id: String,
    bound_oauth_account_id: Option<String>,
) -> Result<CodexAccount, String> {
    codex_account::update_api_key_bound_oauth_account(&account_id, bound_oauth_account_id).await
}

#[tauri::command]
pub async fn update_codex_account_tags(
    account_id: String,
    tags: Vec<String>,
) -> Result<CodexAccount, String> {
    codex_account::update_account_tags(&account_id, tags)
}

#[tauri::command]
pub async fn update_codex_account_api_model_mappings(
    account_id: String,
    mappings: Vec<CodexApiModelMapping>,
    api_model_context_windows: Option<std::collections::HashMap<String, i64>>,
) -> Result<CodexAccount, String> {
    let account = tauri::async_runtime::spawn_blocking(move || {
        codex_account::update_account_api_model_mappings(
            &account_id,
            mappings,
            api_model_context_windows,
        )
    })
    .await
    .map_err(|error| format!("保存模型映射失败: {}", error))??;
    if codex_local_access::collection_contains_account(&account.id) {
        codex_local_access::trigger_gateway_reload_in_background("保存账号模型映射");
    }
    Ok(account)
}

#[tauri::command]
pub async fn update_codex_account_note(
    account_id: String,
    note: Option<String>,
    two_factor_secret: Option<String>,
    account_password: Option<String>,
    phone_number: Option<String>,
    mail_url: Option<String>,
    chatgpt_account_id: Option<String>,
) -> Result<CodexAccount, String> {
    codex_account::update_account_note(
        &account_id,
        codex_account::CodexAccountNoteUpdate {
            note,
            two_factor_secret,
            account_password,
            phone_number,
            mail_url,
        },
        chatgpt_account_id,
    )
}

#[tauri::command]
pub async fn create_pending_codex_oauth_account(
    email: String,
    note: Option<String>,
    two_factor_secret: Option<String>,
    account_password: Option<String>,
    phone_number: Option<String>,
    mail_url: Option<String>,
) -> Result<CodexAccount, String> {
    codex_account::create_pending_oauth_account(
        email,
        codex_account::CodexAccountNoteUpdate {
            note,
            two_factor_secret,
            account_password,
            phone_number,
            mail_url,
        },
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMailPreviewFetchResult {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
    pub truncated: bool,
}

/// 检查 Codex OAuth 端口是否被占用
#[tauri::command]
pub fn is_codex_oauth_port_in_use() -> Result<bool, String> {
    let port = codex_oauth::get_callback_port();
    process::is_port_in_use(port)
}

/// 启动时根据配置自动恢复可见模型目录与代理接管状态
#[tauri::command]
pub async fn restore_codex_active_takeover_if_enabled(app: AppHandle) -> Result<bool, String> {
    let cfg = config::get_user_config();
    if !cfg.codex_auto_restore_takeover_on_launch {
        return Ok(false);
    }
    let base_dir = codex_account::get_codex_home();
    let reapply_catalog_result =
        codex_account::reapply_experimental_model_policy_if_enabled(&base_dir)?;
    logger::log_info(&format!(
        "[Codex Auto-Restore] restore_codex_active_takeover_if_enabled executed: reapply_catalog={}",
        reapply_catalog_result
    ));
    Ok(reapply_catalog_result)
}

// ─── Codex 账号分组持久化 ────────────────────────────────────────────






























