// desko 新增：Codex 会话清单、token 统计与回收站。
// 上游这些命令挂在多实例域（commands/codex_instance.rs），该域已随迁移裁剪；这里保留同名命令，
// 由 modules::codex_session_manager 的切片把「多实例」收敛成官方默认目录一份。
// 详见 docs/design/codex/07-session-list-port.md §3、§4 与 08 §7。

/// 列出官方 CODEX_HOME 下的会话，支持本地标题与正文搜索。
#[tauri::command]
pub async fn codex_list_sessions_across_instances(
    title_query: Option<String>,
    content_query: Option<String>,
) -> Result<Vec<codex_session_manager::CodexSessionRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::list_sessions_across_instances(title_query, content_query)
    })
    .await
    .map_err(|error| format!("读取 Codex 会话列表后台任务失败: {}", error))?
}

/// 取指定会话的 token 累计值；进「会话」档时按全量 id 预取一次。
#[tauri::command]
pub async fn codex_get_session_token_stats_across_instances(
    session_ids: Vec<String>,
) -> Result<Vec<codex_session_manager::CodexSessionTokenStats>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::get_session_token_stats_across_instances(session_ids)
    })
    .await
    .map_err(|error| format!("读取 Codex 会话 token 后台任务失败: {}", error))?
}

/// 用量图：把官方 rollout 里每条会话的累计 token 快照做差，按本地日与模型聚合。
/// 上游同名命令走 sqlite 三表（session_usage_events），desko 现扫现算、不落盘。
#[tauri::command]
pub async fn codex_query_session_usage(
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    windows: Option<std::collections::HashMap<String, Option<i64>>>,
) -> Result<codex_session_manager::CodexSessionUsageReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::query_session_usage_windows(
            from_timestamp,
            to_timestamp,
            windows.unwrap_or_default(),
        )
    })
    .await
    .map_err(|error| format!("统计 Codex 会话用量后台任务失败: {}", error))?
}

/// 把会话移进 desko 回收站：先留底，再从官方会话目录删文件并重写 session_index.jsonl。
#[tauri::command]
pub async fn codex_move_sessions_to_trash_across_instances(
    session_ids: Vec<String>,
) -> Result<codex_session_manager::CodexSessionTrashSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::move_sessions_to_trash_across_instances(session_ids)
    })
    .await
    .map_err(|error| format!("移除 Codex 会话后台任务失败: {}", error))?
}

/// 列出 desko 回收站里的会话（按删除时间倒序）。
#[tauri::command]
pub async fn codex_list_trashed_sessions_across_instances(
) -> Result<Vec<codex_session_manager::CodexTrashedSessionRecord>, String> {
    tauri::async_runtime::spawn_blocking(codex_session_manager::list_trashed_sessions_across_instances)
        .await
        .map_err(|error| format!("读取 Codex 会话回收站后台任务失败: {}", error))?
}

/// 从回收站把会话写回官方目录与索引。
#[tauri::command]
pub async fn codex_restore_sessions_from_trash_across_instances(
    session_ids: Vec<String>,
) -> Result<codex_session_manager::CodexSessionRestoreSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::restore_sessions_from_trash_across_instances(session_ids)
    })
    .await
    .map_err(|error| format!("恢复 Codex 会话后台任务失败: {}", error))?
}

/// 永久删除回收站里的选中条目（官方目录不受影响，只清留底）。
#[tauri::command]
pub async fn codex_delete_trashed_sessions_across_instances(
    session_ids: Vec<String>,
) -> Result<codex_session_manager::CodexSessionTrashDeleteSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::delete_trashed_sessions_across_instances(session_ids)
    })
    .await
    .map_err(|error| format!("删除回收站会话后台任务失败: {}", error))?
}

/// 清空 desko 回收站。
#[tauri::command]
pub async fn codex_empty_session_trash_across_instances(
) -> Result<codex_session_manager::CodexSessionTrashDeleteSummary, String> {
    tauri::async_runtime::spawn_blocking(codex_session_manager::empty_session_trash_across_instances)
        .await
        .map_err(|error| format!("清空 Codex 会话回收站后台任务失败: {}", error))?
}

/// 在系统文件管理器里打开这条会话 rollout 所在目录。
#[tauri::command]
pub async fn codex_open_session_location(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let dir = tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::resolve_session_location_dir(session_id)
    })
    .await
    .map_err(|error| format!("打开 Codex 会话位置失败: {}", error))??;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| format!("打开 Codex 会话位置失败: {}", error))
}

/// 用系统默认程序打开这条会话的 rollout JSONL。
#[tauri::command]
pub async fn codex_open_session_rollout(
    app: AppHandle,
    session_id: String,
) -> Result<(), String> {
    let path = tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::resolve_session_rollout_path(session_id)
    })
    .await
    .map_err(|error| format!("打开 Codex 会话文件失败: {}", error))??;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(|error| format!("打开 Codex 会话文件失败: {}", error))
}
