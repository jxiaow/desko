// desko 新增：切号收尾的会话可见性修复。
// 上游对应能力挂在多实例域（codex_instance.rs），已随该域裁剪；这里只暴露单目标（默认 profile）入口，
// 修复语义与上游 quick 模式一致。详见 docs/design/codex/02-session-visibility-repair.md。

/// 读取官方 CODEX_HOME 的 config.toml 里生效的 model_provider（缺省 "openai"）。
/// 官方客户端侧边栏按这个键过滤 threads，切号（OAuth ↔ API Key）会改到它。
#[tauri::command]
pub fn get_codex_history_visibility_provider() -> Result<String, String> {
    codex_session_visibility::read_history_visibility_provider_for_dir(
        &codex_account::get_codex_home(),
    )
}

/// 对默认 profile 做一次 quick 会话可见性修复：改前自动备份，只改 model_provider 等展示字段。
#[tauri::command]
pub async fn codex_repair_session_visibility_for_launch_target(
) -> Result<codex_session_visibility::CodexSessionVisibilityRepairSummary, String> {
    let codex_home = codex_account::get_codex_home();
    tauri::async_runtime::spawn_blocking(move || {
        codex_session_visibility::repair_session_visibility_quick_for_instance(
            "__default__",
            "默认实例",
            &codex_home,
        )
    })
    .await
    .map_err(|error| format!("会话可见性修复后台任务失败: {}", error))?
}
