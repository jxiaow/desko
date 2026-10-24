use serde_json::Value;
use tauri::{AppHandle, Manager, WebviewWindow};

#[tauri::command]
pub async fn codex_dialog_action(window: WebviewWindow, app: AppHandle, action: String, params: Option<Value>) -> Result<Value, String> {
    if window.label() != "main" { return Err("请在 Desko 桌面主窗口使用对话工作台".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        crate::authorize_codex(&app.state::<crate::AppState>()).map_err(str::to_owned)?;
        app.state::<crate::services::codex_bridge::BridgeState>().dispatch(&app, &action, &params.unwrap_or_else(|| serde_json::json!({})))
    }).await.map_err(|e| e.to_string())?
}
