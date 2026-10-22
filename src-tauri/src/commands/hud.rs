use serde::{Deserialize, Serialize};
use tauri::{
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
            let _ = window_for_close.hide();
            let _ = app_for_close.emit_to(MAIN_LABEL, "codex-hud:request-close", ());
        }
        WindowEvent::Moved(_) => {
            let _ = clamp_window_to_monitor(&window_for_close);
        }
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
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // 首帧回调可能在锁定后才落地：锁着就绝不把窗口再亮出来。
    let locked = state.master_key.lock().map_err(|_| "应用已锁定")?.is_none();
    if locked {
        return Err("应用已锁定".into());
    }
    let Some(window) = app.get_webview_window(HUD_LABEL) else {
        return Err("挂件窗口不存在".into());
    };
    window
        .set_size(tauri::LogicalSize::new(HUD_WIDTH, HUD_HEIGHT))
        .map_err(|err| err.to_string())?;
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
/// `codex_hud_enabled`，锁定隐藏不改它，所以不能拿窗口可见性当副本。
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
