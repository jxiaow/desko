use chrono::{Duration, Local, TimeZone};
use codex_core::models::codex::{
    CodexAccount, CodexAuthMode, CodexQuota, CodexQuotaErrorInfo,
};
use codex_core::modules::{codex_account, codex_quota, codex_session_manager};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use crate::AppState;

const HUD_LABEL: &str = "codex-hud";
const MAIN_LABEL: &str = "main";
const HUD_URL: &str = "hud.html";
const HUD_WIDTH: f64 = 136.0;
const HUD_HEIGHT: f64 = 74.0;
const HUD_EXPANDED_HEIGHT: f64 = 144.0;
const HUD_MARGIN: i32 = 24;
const POSITION_KEY: &str = "codex_hud_position";
const MENU_SETTINGS: &str = "hud-settings";
const MENU_HIDE: &str = "hud-hide";

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
struct HudPosition {
    x: i32,
    y: i32,
}

fn read_saved_position(state: &AppState) -> Option<PhysicalPosition<i32>> {
    let db = state.db.lock().ok()?;
    let raw = db.get_meta(POSITION_KEY).ok().flatten()?;
    let position: HudPosition = serde_json::from_str(&raw).ok()?;
    Some(PhysicalPosition::new(position.x, position.y))
}

fn clamp_to_work_area(
    position: PhysicalPosition<i32>,
    app: &AppHandle<impl Runtime>,
    window: &WebviewWindow<impl Runtime>,
) -> Result<PhysicalPosition<i32>, String> {
    let Some(monitor) = app
        .monitor_from_point(position.x as f64, position.y as f64)
        .map_err(|err| err.to_string())?
    else {
        return Ok(position);
    };
    Ok(clamp_to_monitor(position, monitor.work_area(), window)?)
}

/// 展开态只向下长，角色位置必须一动不动：定位与钳制一律按展开高度预留底边空间。
fn reserve_height(window: &WebviewWindow<impl Runtime>) -> Result<i32, String> {
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let expanded = (HUD_EXPANDED_HEIGHT * scale).round() as i32;
    let current = i32::try_from(window.outer_size().map_err(|err| err.to_string())?.height)
        .map_err(|_| "挂件窗口高度超出范围".to_string())?;
    Ok(expanded.max(current))
}

fn clamp_to_monitor(
    position: PhysicalPosition<i32>,
    work_area: &tauri::PhysicalRect<i32, u32>,
    window: &WebviewWindow<impl Runtime>,
) -> Result<PhysicalPosition<i32>, String> {
    let size = window.outer_size().map_err(|err| err.to_string())?;
    let window_width = i32::try_from(size.width)
        .map_err(|_| "挂件窗口宽度超出范围".to_string())?;
    let window_height = reserve_height(window)?;
    let area_width = i32::try_from(work_area.size.width)
        .map_err(|_| "显示器宽度超出范围".to_string())?;
    let area_height = i32::try_from(work_area.size.height)
        .map_err(|_| "显示器高度超出范围".to_string())?;

    let min_x = work_area.position.x;
    let min_y = work_area.position.y;
    let max_x = min_x.saturating_add(area_width).saturating_sub(window_width).max(min_x);
    let max_y = min_y.saturating_add(area_height).saturating_sub(window_height).max(min_y);

    Ok(PhysicalPosition::new(
        position.x.clamp(min_x, max_x),
        position.y.clamp(min_y, max_y),
    ))
}

fn place_hud_window<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    saved: Option<PhysicalPosition<i32>>,
) -> Result<(), String> {
    if let Some(saved) = saved {
        let visible = app
            .monitor_from_point(saved.x as f64, saved.y as f64)
            .map_err(|err| err.to_string())?
            .is_some();
        if visible {
            return window
                .set_position(clamp_to_work_area(saved, app, window)?)
                .map_err(|err| err.to_string());
        }
    }

    let Some(monitor) = app.primary_monitor().map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let work_area = monitor.work_area();
    let size = window.outer_size().map_err(|err| err.to_string())?;
    let window_width = i32::try_from(size.width)
        .map_err(|_| "挂件窗口宽度超出范围".to_string())?;
    let window_height = reserve_height(window)?;
    let margin = (HUD_MARGIN as f64 * monitor.scale_factor()).round() as i32;
    let x = work_area.position.x
        + i32::try_from(work_area.size.width)
            .map_err(|_| "显示器宽度超出范围".to_string())?
        - window_width
        - margin;
    let y = work_area.position.y
        + i32::try_from(work_area.size.height)
            .map_err(|_| "显示器高度超出范围".to_string())?
        - window_height
        - margin;

    window
        .set_position(PhysicalPosition::new(
            x.max(work_area.position.x),
            y.max(work_area.position.y),
        ))
        .map_err(|err| err.to_string())
}

/// 拖动期间也要给面板留出下探空间：越界的窗口就地夹回，角色不会跳到屏幕外。
fn clamp_window_to_monitor(window: &WebviewWindow<impl Runtime>) -> Result<(), String> {
    let position = window.outer_position().map_err(|err| err.to_string())?;
    let Some(monitor) = window.current_monitor().map_err(|err| err.to_string())? else {
        return Ok(());
    };
    let clamped = clamp_to_monitor(position, monitor.work_area(), window)?;
    if clamped.x == position.x && clamped.y == position.y {
        return Ok(());
    }
    window.set_position(clamped).map_err(|err| err.to_string())
}

/// 隐藏挂件的唯一收口：先藏窗口，再由主窗口把 `codex_hud_enabled` 落回 false 并销毁。
/// Alt+F4 与设置里的显示开关保持一致。
fn dismiss_hud<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(HUD_LABEL) {
        let _ = window.hide();
    }
    let _ = app.emit_to(MAIN_LABEL, "codex-hud:request-close", ());
}

/// 挂件只该有自己的右键菜单，WebView2 那份（刷新/另存为/检查）得关掉。
#[cfg(windows)]
fn suppress_default_context_menu<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.with_webview(|platform| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows_webview::core::Interface;
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
                if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
                    let _ = settings.SetAreDefaultContextMenusEnabled(false);
                }
            }
        }
    });
}

fn create_hud_window<R: Runtime>(
    app: &AppHandle<R>,
    saved: Option<PhysicalPosition<i32>>,
) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(app, HUD_LABEL, WebviewUrl::App(HUD_URL.into()))
        .title("Codex 额度")
        .inner_size(HUD_WIDTH, HUD_HEIGHT)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(false);
    #[cfg(windows)]
    let builder = builder.no_redirection_bitmap(true);

    let window = builder
        .build()
        .map_err(|err| format!("无法创建挂件窗口：{err}"))?;

    let app_for_close = app.clone();
    let window_for_close = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            dismiss_hud(&app_for_close);
        }
        WindowEvent::Moved(_) => {
            let _ = clamp_window_to_monitor(&window_for_close);
        }
        _ => {}
    });

    let app_for_menu = app.clone();
    window.on_menu_event(move |_window, event| match event.id().as_ref() {
        MENU_SETTINGS => {
            if let Some(main) = app_for_menu.get_webview_window(MAIN_LABEL) {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            let _ = app_for_menu.emit_to(MAIN_LABEL, "codex-hud:open-settings", ());
        }
        MENU_HIDE => dismiss_hud(&app_for_menu),
        _ => {}
    });

    if let Err(err) = place_hud_window(app, &window, saved) {
        let _ = window.destroy();
        return Err(err);
    }
    Ok(())
}

#[tauri::command]
pub async fn desko_hud_show(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    if app.get_webview_window(HUD_LABEL).is_some() {
        return Ok(false);
    }

    let saved = read_saved_position(&state);
    let app_for_main = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(create_hud_window(&app_for_main, saved));
    })
    .map_err(|err| err.to_string())?;

    rx.await
        .map_err(|_| "挂件窗口创建线程已退出".to_string())?
        .map(|_| true)
}

#[tauri::command]
pub fn desko_hud_reveal(
    app: AppHandle,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Err("挂件窗口不存在".into());
    };
    window
        .set_size(tauri::LogicalSize::new(HUD_WIDTH, HUD_HEIGHT))
        .map_err(|err| err.to_string())?;
    // 建窗那一刻 webview 还没就绪，亮相时才有 controller 可改
    #[cfg(windows)]
    suppress_default_context_menu(&window);
    window.show().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desko_hud_hide(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Ok(());
    };
    window.hide().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desko_hud_destroy(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Ok(());
    };
    window.destroy().map_err(|err| err.to_string())
}

/// 托盘菜单里那颗「桌面额度挂件」勾选项。勾选态只由前端回写：真正的开关是
/// `codex_hud_enabled` 与模块状态，所以不能拿窗口可见性当副本。
#[derive(Clone)]
pub struct HudTrayItem(pub tauri::menu::CheckMenuItem<tauri::Wry>);

#[tauri::command]
pub fn desko_hud_set_tray(app: AppHandle, checked: bool) -> Result<(), String> {
    let Some(item) = app.try_state::<HudTrayItem>() else {
        return Ok(());
    };
    item.0.set_checked(checked).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desko_hud_open_codex(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_LABEL) else {
        return Err("主窗口不可用".into());
    };
    window.show().map_err(|err| err.to_string())?;
    window.unminimize().map_err(|err| err.to_string())?;
    window.set_focus().map_err(|err| err.to_string())?;
    app.emit_to(MAIN_LABEL, "codex-hud:open", ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desko_hud_set_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Ok(());
    };
    let height = if expanded { HUD_EXPANDED_HEIGHT } else { HUD_HEIGHT };
    window
        .set_size(tauri::LogicalSize::new(HUD_WIDTH, height))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn desko_hud_save_position(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    x: i32,
    y: i32,
) -> Result<(), String> {
    if app
        .monitor_from_point(x as f64, y as f64)
        .map_err(|err| err.to_string())?
        .is_none()
    {
        return Ok(());
    }
    let raw = serde_json::to_string(&HudPosition { x, y })
        .map_err(|err| err.to_string())?;
    let db = state.db.lock().map_err(|_| "读取挂件位置失败".to_string())?;
    db.set_meta(POSITION_KEY, &raw).map_err(|err| err.to_string())
}

/// 在光标处弹出挂件自己的右键菜单。
/// 必须是 async：`Menu::new`/`popup_menu` 内部要回主线程并等回执，同步命令会自锁。
#[tauri::command]
pub async fn desko_hud_context_menu(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Err("挂件窗口不存在".into());
    };
    let settings = MenuItem::with_id(&window, MENU_SETTINGS, "挂件设置…", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let hide = MenuItem::with_id(&window, MENU_HIDE, "隐藏挂件", true, None::<&str>)
        .map_err(|err| err.to_string())?;
    let menu = Menu::with_items(&window, &[&settings, &hide]).map_err(|err| err.to_string())?;
    window.popup_menu(&menu).map_err(|err| err.to_string())
}

/// 锁屏时挂件仍要更新，但主窗口拿不到 master key。这里只放行渲染需要的聚合值：
/// 账号详情本来就由机器本地密钥加密，后端不需要口令也能读。
fn authorize_locked_hud<R: Runtime>(app: &AppHandle<R>, state: &AppState) -> Result<(), String> {
    if app.get_webview_window(HUD_LABEL).is_none() {
        return Err("挂件窗口不存在".into());
    }
    let db = state.db.lock().map_err(|_| "读取挂件设置失败".to_string())?;
    if db.get_meta("codex_enabled").ok().flatten().as_deref() != Some("true") {
        return Err("Codex 模块未启用".into());
    }
    if db.get_meta("codex_hud_enabled").ok().flatten().as_deref() == Some("false") {
        return Err("桌面挂件已关闭".into());
    }
    Ok(())
}

/// 本地零点。部分时区零点跳时，从当天第一个有效分钟起算，和用量扫描的口径一致。
fn local_day_start(now: chrono::DateTime<Local>) -> Option<i64> {
    let midnight = now.date_naive().and_hms_opt(0, 0, 0)?;
    (0..1440)
        .find_map(|minute| {
            Local
                .from_local_datetime(&(midnight + Duration::minutes(minute)))
                .earliest()
        })
        .map(|value| value.timestamp())
}

fn locked_today(report: codex_session_manager::CodexSessionUsageReport) -> HudLockedToday {
    HudLockedToday {
        tokens: report.totals.total_tokens,
        cost_usd: report.totals.estimated_cost_usd,
    }
}

/// 只留挂件渲染要用的字段；token、邮箱、API Key 在这个结构里不存在。
fn sanitize_locked_account(account: &CodexAccount) -> HudLockedAccount {
    HudLockedAccount {
        auth_mode: account.auth_mode.clone(),
        authorization_status: account.authorization_status.clone(),
        quota: account.quota.clone(),
        quota_error: account.quota_error.clone(),
        usage_updated_at: account.usage_updated_at,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudLockedPayload {
    account: Option<HudLockedAccount>,
    today: Option<HudLockedToday>,
}

#[derive(Debug, Serialize)]
pub struct HudLockedAccount {
    auth_mode: CodexAuthMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    authorization_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota: Option<CodexQuota>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_error: Option<CodexQuotaErrorInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage_updated_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudLockedToday {
    tokens: u64,
    cost_usd: Option<f64>,
}

/// 锁屏挂件的一轮刷新：当前账号额度 + 本机今日用量。
/// 不跑自动切号、不更新托盘、不发预警；锁屏只负责把数摆出来。
#[tauri::command]
pub async fn desko_hud_refresh_locked(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<HudLockedPayload, String> {
    authorize_locked_hud(&app, state.inner())?;

    let now = Local::now();
    let day_start = local_day_start(now).unwrap_or_else(|| now.timestamp().saturating_sub(86_400));
    let day_end = now.timestamp().saturating_add(1);
    let usage = tauri::async_runtime::spawn_blocking(move || {
        codex_session_manager::query_session_usage(Some(day_start), Some(day_end))
    });

    let Some(account) = codex_account::get_current_account() else {
        let today = usage.await.ok().and_then(|result| result.ok()).map(locked_today);
        return Ok(HudLockedPayload { account: None, today });
    };
    let account_id = account.id.clone();
    codex_quota::refresh_quotas_for_account_ids_in_background(
        std::slice::from_ref(&account_id),
        true,
    )
    .await?;
    let latest = codex_account::load_account(&account_id).unwrap_or(account);
    let today = usage.await.ok().and_then(|result| result.ok()).map(locked_today);

    Ok(HudLockedPayload {
        account: Some(sanitize_locked_account(&latest)),
        today,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locked_payload_only_exposes_render_fields() {
        let payload = HudLockedPayload {
            account: Some(HudLockedAccount {
                auth_mode: CodexAuthMode::OAuth,
                authorization_status: Some("ok".into()),
                quota: None,
                quota_error: None,
                usage_updated_at: Some(1_700_000_000),
            }),
            today: Some(HudLockedToday {
                tokens: 1234,
                cost_usd: Some(0.25),
            }),
        };
        let json = serde_json::to_value(payload).expect("serialize hud payload");
        let account = json["account"].as_object().expect("account object");
        for key in account.keys() {
            assert!(
                matches!(
                    key.as_str(),
                    "auth_mode"
                        | "authorization_status"
                        | "quota"
                        | "quota_error"
                        | "usage_updated_at"
                ),
                "unexpected account field: {key}"
            );
        }
        assert!(!account.contains_key("id"));
        assert!(!account.contains_key("email"));
        assert!(!account.contains_key("tokens"));
        assert!(!account.contains_key("openai_api_key"));
        assert_eq!(account["auth_mode"], "oauth");
        assert_eq!(json["today"]["tokens"], 1234);
        assert_eq!(json["today"]["costUsd"], 0.25);
    }

    #[test]
    fn local_day_start_is_today_midnight() {
        let now = Local
            .with_ymd_and_hms(2026, 10, 26, 15, 30, 0)
            .single()
            .expect("local datetime");
        let start = local_day_start(now).expect("day start");
        assert!(start <= now.timestamp());
        assert!(now.timestamp() - start < 24 * 60 * 60 + 1);
    }
}
