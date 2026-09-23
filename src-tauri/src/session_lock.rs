//! 系统锁屏联动：收到 Windows 会话锁屏事件（WM_WTSSESSION_CHANGE / WTS_SESSION_LOCK）时，
//! 按设置项 lock_on_system_lock 决定是否把应用一并锁定。
//!
//! WTSRegisterSessionNotification 要求一个窗口来收广播，所以这里养一个
//! message-only 窗口（不进任务栏、不可见），只跑消息循环，与主窗口无耦合。

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassExW,
        TranslateMessage, MSG, WNDCLASSEXW, HWND_MESSAGE,
    };

    const WM_WTSSESSION_CHANGE: u32 = 0x02E1;
    const WTS_SESSION_LOCK: usize = 0x07;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// 密钥清理与 tray-lock 广播对齐「关闭窗口时锁定」那条路径
    fn lock_if_enabled(app: &AppHandle) {
        let state = app.state::<crate::AppState>();
        // 开机后系统先锁屏、应用还没解锁：master_key 为空就不必再锁一次
        let unlocked = state.master_key.lock().map(|k| k.is_some()).unwrap_or(false);
        if !unlocked {
            return;
        }
        let enabled = state
            .db
            .lock()
            .map(|db| {
                db.get_meta("lock_on_system_lock")
                    .ok()
                    .flatten()
                    .map(|v| v == "true")
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if !enabled {
            return;
        }
        if let Ok(mut key) = state.master_key.lock() {
            *key = None;
        }
        if let Ok(mut key) = state.backup_key.lock() {
            *key = None;
        }
        if let Ok(mut attempts) = state.unlock_attempts.lock() {
            *attempts = 0;
        }
        drop(state);
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.emit("tray-lock", ());
        }
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_WTSSESSION_CHANGE && wparam.0 == WTS_SESSION_LOCK {
            if let Some(app) = APP.get() {
                lock_if_enabled(app);
            }
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub fn spawn(app: AppHandle) {
        if APP.set(app).is_err() {
            return; // 只允许一个监听线程
        }
        std::thread::spawn(|| unsafe {
            let class_name: Vec<u16> = "DeskoSessionLock"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            let hinstance = HINSTANCE(GetModuleHandleW(None).unwrap_or_default().0);
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(wndproc),
                hInstance: hinstance,
                lpszClassName: PCWSTR(class_name.as_ptr()),
                ..Default::default()
            };
            if RegisterClassExW(&wc) == 0 {
                return;
            }
            let Ok(hwnd) = CreateWindowExW(
                Default::default(),
                PCWSTR(class_name.as_ptr()),
                PCWSTR(class_name.as_ptr()),
                Default::default(),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(hinstance),
                None,
            ) else {
                return;
            };
            let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        });
    }
}

#[cfg(not(windows))]
pub fn spawn(_app: tauri::AppHandle) {}

#[cfg(windows)]
pub use imp::spawn;
