#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod command_state;
mod db;
mod crypto;
mod error;
mod paths;
mod services;
mod backup;
mod session_lock;
mod webdav;
mod web_access;

use db::Database;
use services::attachment_service;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn request_quit(app: &tauri::AppHandle) {
    // 窗口隐藏或最小化时也先恢复窗口，让应用内确认框可见。
    show_main_window(app);
    let _ = app.emit_to("main", "tray-quit", ());
}

#[tauri::command]
fn quit_app(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    if window.label() != "main" {
        return Err("请在桌面主窗口退出 Desko".into());
    }
    app.exit(0);
    Ok(())
}

pub struct AppState {
    pub db: std::sync::Arc<Mutex<Database>>,
    /// Shared data/key generation; desktop screen locks leave Web sessions intact.
    pub data_epoch: std::sync::Arc<std::sync::atomic::AtomicU64>,
    pub master_key: Mutex<Option<Vec<u8>>>,
    pub unlock_attempts: Mutex<services::auth_service::UnlockThrottle>,
    /// 锁定请求的代次：前端完成锁定或重新解锁后取消旧请求的超时兜底。
    pub lock_epoch: std::sync::atomic::AtomicU64,
    /// 备份密钥只在解锁后驻留内存，锁屏即清
    pub backup_key: Mutex<Option<Vec<u8>>>,
    /// 同一时刻只跑一个备份任务（手动、退出、定时共用一把闸）
    pub backup_busy: AtomicBool,
    /// 局域网文件传输服务子进程（默认关，开关在通用设置里）
    pub fileshare: commands::fileshare::ProcState,
    /// 内网穿透子进程（默认关，开关在通用设置里）
    pub tunnel: commands::tunnel::TunnelState,
    /// 单条加密小记解锁后的 DEK，只驻内存；应用锁定即清
    pub note_keys: Mutex<std::collections::HashMap<String, Vec<u8>>>,
    /// 小记域密钥：全库一把口令解出来的那份，只驻内存；应用锁定即清
    pub note_key: Mutex<Option<Vec<u8>>>,
    pub note_drafts: Mutex<services::note_draft_service::DraftCache>,
}

/// codex 命令判定：名字含 codex 一律算，再看裁剪边界名单（D10 的 keep_cmds.json，编译期内嵌）。
/// 名单不再是唯一防线：漏登记一个新命令曾会让它绕过闸门直改官方凭据文件，
/// 而名字启发式让"注册即纳管"，测试 `registered_codex_cmds_are_gated` 再把两边钉死对账。
fn is_codex_command(cmd: &str) -> bool {
    static CMDS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    // 当前 codex 命令命名约定为 verb_codex_noun；用段匹配而不是子串匹配，
    // 避免未来 desko 自有命令名里意外包含 "codex" 时被误伤。
    if cmd.contains("_codex_") || cmd.starts_with("codex_") {
        return true;
    }
    CMDS.get_or_init(|| {
        serde_json::from_str::<Vec<String>>(include_str!("../codex-core/keep_cmds.json"))
            .expect("keep_cmds.json 必须是命令名的 JSON 数组")
    })
    .iter()
    .any(|c| c == cmd)
}

/// 模块启用与应用解锁必须同时成立，上游命令本身不接收 Desko 会话状态。
fn authorize_codex(state: &AppState) -> Result<(), &'static str> {
    let key = state.master_key.lock().map_err(|_| "应用已锁定")?;
    if key.is_none() {
        return Err("应用已锁定");
    }
    let db = state.db.lock().map_err(|_| "读取模块设置失败")?;
    if db.get_meta("codex_enabled").ok().flatten().as_deref() != Some("true") {
        return Err("Codex 模块未启用，请在设置—模块里打开开关");
    }
    Ok(())
}

fn codex_authorization<R: tauri::Runtime>(message: &tauri::ipc::InvokeMessage<R>) -> Result<(), &'static str> {
    let webview = message.webview();
    let state = webview.try_state::<AppState>().ok_or("应用已锁定")?;
    authorize_codex(&state)
}

fn main() {
    if web_access::run_worker() { return; }
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 先定当前档案根：解析 profiles.json、必要时把老布局一次性搬进 default 档案，
            // 再设 paths 全局根。之后所有路径（库/附件/图标/备份/fileshare）都走这个根。
            let app_root = app.path().app_data_dir().expect("failed to get app data dir");
            let env_root = services::profile_service::legacy_desko_root();
            let booted = services::profile_service::boot(&app_root, &env_root)
                .unwrap_or_else(|e| panic!("档案启动失败：{e}"));
            paths::init(paths::ProfilePaths {
                root: booted.root,
                cloud_base: booted.cloud_base,
            });

            // Codex 账号域（codex-core）：账号索引与导出落在 desko 档案目录的 codex 子目录，
            // 上游读的是 COCKPIT_TOOLS_DATA_DIR，这里指过来即可，不改移植过来的路径解析代码。
            // 上游另有两个测试变量优先级更高、且变量缺失/为空时会静默落回 ~/.cockpit_tools，
            // 凭据就会写到档案之外去——先清掉测试变量，再设值回读断言，配不上就当场炸，
            // 不带病启动。
            std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR");
            std::env::remove_var("COCKPIT_TEST_DATA_DIR");
            let codex_dir = paths::profile_root().join("codex");
            std::fs::create_dir_all(&codex_dir).expect("failed to create codex data dir");
            std::env::set_var("COCKPIT_TOOLS_DATA_DIR", &codex_dir);
            assert_eq!(
                std::env::var_os("COCKPIT_TOOLS_DATA_DIR").as_deref(),
                Some(codex_dir.as_os_str()),
                "COCKPIT_TOOLS_DATA_DIR 没配上，codex 凭据会落进上游默认目录"
            );
            codex_core::set_app_handle(app.handle().clone());
            codex_core::modules::codex_clients::set_terminal_spawner(commands::file_shortcuts::spawn_wt_command);

            let db_path = paths::data_db_path();
            let db_path_str = db_path.to_str().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid database path encoding")
            }).expect("failed to convert database path");

            // 上次恢复中途断电留下的 .swap，先收拾干净再开库
            backup::recover_swap(&paths::profile_root(), &paths::attachments_dir()).expect("failed to recover interrupted restore");

            let db = Database::new(db_path_str).expect("failed to init database");
            
            app.manage(web_access::WebAccessState::default());
            app.manage(services::codex_bridge::BridgeState::default());
            app.manage(AppState {
                db: std::sync::Arc::new(Mutex::new(db)),
                data_epoch: Default::default(),
                master_key: Mutex::new(None),
                unlock_attempts: Mutex::new(services::auth_service::UnlockThrottle::default()),
                lock_epoch: std::sync::atomic::AtomicU64::new(0),
                backup_key: Mutex::new(None),
                backup_busy: AtomicBool::new(false),
                fileshare: commands::fileshare::ProcState::default(),
                tunnel: commands::tunnel::TunnelState::default(),
                note_keys: Mutex::new(std::collections::HashMap::new()),
                note_key: Mutex::new(None),
                note_drafts: Mutex::new(Default::default()),
            });

            // 正文里的图片走 asset: 协议读附件目录，只放行那一个目录
            if let Some(window) = app.get_webview_window("main") {
                let dir = attachment_service::attachments_dir();
                if std::fs::create_dir_all(&dir).is_ok() {
                    let _ = window.asset_protocol_scope().allow_directory(&dir, true);
                }
                // favicon 缓存目录：扁平一档图标，不放行子目录
                let fav_dir = services::favicon_service::favicons_dir();
                if std::fs::create_dir_all(&fav_dir).is_ok() {
                    let _ = window.asset_protocol_scope().allow_directory(&fav_dir, false);
                }
                // WebView2 的浏览器加速键整档默认开着：F1/F3/F5/F12 被 webview 吃掉、
                // 交不回系统，而 desko 一条功能键都没绑（全局只有 Ctrl+B 与 Ctrl+K）。
                #[cfg(windows)]
                let _ = window.with_webview(|platform| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows_webview::core::Interface;
                    if let Ok(core) = platform.controller().CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
                                let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
                            }
                        }
                    }
                });
            }

            // Setup tray menu
            let show_item = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let lock_item = MenuItem::with_id(app, "lock", "锁定", true, None::<&str>)?;
            // 首帧与前端一致：Codex 已添加且没有主动隐藏时默认显示挂件。
            let hud_wanted = {
                let state = app.state::<AppState>();
                state
                    .db
                    .lock()
                    .ok()
                    .map(|db| {
                        db.get_meta("codex_enabled").ok().flatten().as_deref() == Some("true")
                            && db.get_meta("codex_hud_enabled").ok().flatten().as_deref() != Some("false")
                    })
                    .unwrap_or(false)
            };
            let hud_item = CheckMenuItem::with_id(
                app,
                "hud",
                "桌面额度挂件",
                true,
                hud_wanted,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &lock_item, &hud_item, &quit_item])?;
            // 勾选态是设置里那颗开关的副本，由前端 `desko_hud_set_tray` 回写
            app.manage(commands::hud::HudTrayItem(hud_item.clone()));

            let icon = app.default_window_icon().unwrap().clone();

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "lock" => commands::auth::request_lock(app),
                        // 翻转与落盘都交给主窗口的挂件桥，锁定后也保持监听。
                        "hud" => {
                            let _ = app.emit_to("main", "tray-hud-toggle", ());
                        }
                        "quit" => request_quit(app),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // 自动备份线程：定时/实时两档，都在后台判变更指纹，锁屏或没设备份密码就空转
            services::auto_backup::spawn(app.handle().clone());

            // 系统锁屏联动：收到会话锁屏广播时按设置把应用一并锁定
            session_lock::spawn(app.handle().clone());

            // 局域网文件传输：开机不自启服务，起听只从模块页按钮来

            // Handle window close - minimize to tray instead
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        
                        // Check if lock-on-close is enabled
                        let app_state = app_handle.state::<AppState>();
                        let should_lock = app_state.db.lock()
                            .map(|db| db.get_meta("lock_on_close").ok().flatten().map(|v| v == "true").unwrap_or(false))
                            .unwrap_or(false);
                        
                        if should_lock {
                            commands::auth::request_lock(&app_handle);
                        }
                        
                        let _ = window_clone.hide();
                    }
                });
            }
            
            Ok(())
        })
        .invoke_handler({
            // 宏展开是不捕获的闭包，标注成 fn 指针供外层闸门闭包捕获
            let base_invoke: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool =
                tauri::generate_handler![
            quit_app,
            web_access::web_access_status,
            web_access::web_access_start,
            web_access::web_access_stop,
            commands::auth::is_initialized,
            commands::auth::setup_master_password,
            commands::auth::unlock,
            commands::auth::lock,
            commands::auth::change_master_password,
            commands::entries::list_entries,
            commands::entries::list_entries_with_paths,
            commands::entries::create_entry,
            commands::entries::update_entry,
            commands::entries::delete_entry,
            commands::entries::batch_delete_entries,
            commands::entries::get_password,
            commands::favicons::favicon_get,
            commands::data::get_db_path,
            commands::data::get_attachment_dir,
            commands::backup::backup_status,
            commands::backup::backup_set_password,
            commands::backup::backup_run,
            commands::backup::backup_restore_file,
            commands::backup::backup_export,
            commands::cloud::cloud_status,
            commands::cloud::cloud_test_config,
            commands::cloud::cloud_save_config,
            commands::cloud::cloud_disconnect,
            commands::cloud::cloud_list,
            commands::cloud::cloud_restore,
            commands::entries::create_test_data,
            commands::notes::list_notes,
            commands::note_export::note_export_images,
            commands::note_export::note_export_write,
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::stage_note_drafts,
            commands::notes::recover_note_drafts,
            commands::notes::delete_note,
            commands::notes::batch_delete_notes,
            commands::notes::toggle_pin_note,
            commands::notes::toggle_star_note,
            commands::notes::set_note_archived,
            commands::notes::batch_set_archived,
            commands::notes::list_attachments,
            commands::note_lock::note_key_status,
            commands::note_lock::note_key_setup,
            commands::note_lock::note_key_unlock,
            commands::note_lock::note_key_recover,
            commands::note_lock::note_key_relock,
            commands::note_lock::note_key_change,
            commands::note_lock::lock_note,
            commands::note_lock::unlock_note,
            commands::note_lock::relock_note,
            commands::note_lock::remove_note_lock,
            commands::note_lock::reveal_note,
            commands::notes::upload_attachment,
            commands::notes::stage_attachment,
            commands::notes::save_attachment_bytes,
            commands::notes::bind_attachments,
            commands::notes::delete_attachment,
            commands::notes::attachment_orphans,
            commands::notes::attachment_cleanup,
            commands::mfa::mfa_add_uri,
            commands::mfa::mfa_add_manual,
            commands::mfa::mfa_codes,
            commands::mfa::mfa_remove,
            commands::mfa::mfa_read_image,
            commands::fileshare::fileshare_status,
            commands::fileshare::fileshare_start,
            commands::fileshare::fileshare_stop,
            commands::fileshare::fileshare_get_config,
            commands::fileshare::fileshare_save_config,
            commands::fileshare::fileshare_set_password,
            commands::fileshare::fileshare_set_theme,
            commands::fileshare::fileshare_import_files,
            // ── 内网穿透 ──
            commands::tunnel::tunnel_binary_status,
            commands::tunnel::tunnel_fetch_binary,
            commands::tunnel::tunnel_provision_status,
            commands::tunnel::tunnel_login_start,
            commands::tunnel::tunnel_login_status,
            commands::tunnel::tunnel_authorized_domain,
            commands::tunnel::tunnel_login_cancel,
            commands::tunnel::tunnel_ensure_tunnel,
            commands::tunnel::tunnel_apply,
            commands::tunnel::tunnel_probe_connectors,
            commands::tunnel::tunnel_list_services,
            commands::tunnel::tunnel_add_service,
            commands::tunnel::tunnel_update_service,
            commands::tunnel::tunnel_remove_service,
            commands::tunnel::tunnel_set_service_policy,
            commands::tunnel::tunnel_status,
            commands::tunnel::tunnel_start,
            commands::tunnel::tunnel_stop,
            commands::tunnel::tunnel_revoke,
            // ── 直连清单（P1：只探测判定，不写系统）──
            commands::bypass::bypass_probe,
            commands::bypass::bypass_cancel_probe,
            commands::bypass::bypass_save,
            commands::bypass::bypass_list,
            commands::bypass::bypass_recheck,
            commands::bypass::bypass_edit,
            commands::bypass::bypass_delete,
            commands::bypass::bypass_status,
            commands::bypass::bypass_plan,
            commands::bypass::bypass_apply,
            commands::bypass::bypass_revert,
            commands::bypass::bypass_rollback_exists,
            // ── 多档案（F2）──
            commands::profiles::profiles_list,
            commands::profiles::profiles_active,
            commands::profiles::profiles_create,
            commands::profiles::profiles_rename,
            commands::profiles::profiles_delete,
            commands::profiles::profiles_switch,
            commands::settings::get_setting,
            commands::settings::set_setting,
            // ── 桌面额度挂件（窗口控制，不受 codex 授权闸门约束）──
            commands::hud::desko_hud_show,
            commands::hud::desko_hud_reveal,
            commands::hud::desko_hud_hide,
            commands::hud::desko_hud_destroy,
            commands::hud::desko_hud_set_tray,
            commands::hud::desko_hud_open_codex,
            commands::hud::desko_hud_set_expanded,
            commands::hud::desko_hud_save_position,
            commands::hud::desko_hud_context_menu,
            commands::url_paths::list_url_paths,
            commands::url_paths::create_url_path,
            commands::url_paths::update_url_path,
            commands::url_paths::delete_url_path,
            commands::file_shortcuts::list_file_shortcuts,
            commands::file_shortcuts::create_file_shortcut,
            commands::file_shortcuts::update_file_shortcut,
            commands::file_shortcuts::delete_file_shortcut,
            commands::file_shortcuts::open_file,
            commands::file_shortcuts::open_terminal,
            // ── Codex 账号管理与切换（命令路径 = 上游 hub，片段经 include! 归入 codex）──
            commands::codex_bridge::codex_dialog_action,
            codex_core::commands::codex::list_codex_accounts,
            codex_core::commands::codex::get_current_codex_account,
            codex_core::commands::codex::get_codex_config_toml_path,
            codex_core::commands::codex::get_codex_storage_paths,
            codex_core::commands::codex::get_codex_wsl_assignment,
            codex_core::commands::codex::preview_codex_switch,
            codex_core::commands::codex::preview_codex_wsl_assignment,
            codex_core::commands::codex::assign_codex_account_to_wsl,
            codex_core::commands::codex::relaunch_codex_clients,
            codex_core::commands::codex::open_codex_config_toml,
            codex_core::commands::codex::get_codex_quick_config,
            codex_core::commands::codex::save_codex_context_management,
            codex_core::commands::codex::save_codex_quick_config,
            codex_core::commands::codex::save_codex_model_catalog,
            codex_core::commands::codex::get_codex_model_reasoning_efforts,
            codex_core::commands::codex::preview_codex_model_config_import,
            codex_core::commands::codex::import_codex_model_config,
            codex_core::commands::codex::export_codex_model_config,
            codex_core::commands::codex::refresh_codex_account_profile,
            codex_core::commands::codex::force_refresh_codex_tokens,
            codex_core::commands::codex::switch_codex_account,
            codex_core::commands::codex::delete_codex_account,
            codex_core::commands::codex::start_codex_batch_delete,
            codex_core::commands::codex::get_codex_batch_delete,
            codex_core::commands::codex::resume_codex_batch_delete,
            codex_core::commands::codex::pause_codex_batch_delete,
            codex_core::commands::codex::retry_failed_codex_batch_delete,
            codex_core::commands::codex::clear_codex_batch_delete,
            codex_core::commands::codex::import_codex_access_token_account,
            codex_core::commands::codex::import_codex_from_local,
            codex_core::commands::codex::import_codex_from_json,
            codex_core::commands::codex::export_codex_accounts,
            codex_core::commands::codex::import_codex_from_files,
            codex_core::commands::codex::refresh_codex_quota,
            codex_core::commands::codex::get_codex_reset_credits,
            codex_core::commands::codex::consume_codex_reset_credit,
            codex_core::commands::codex::refresh_codex_subscription_info,
            codex_core::commands::codex::refresh_codex_quotas_batch,
            codex_core::commands::codex::codex_oauth_login_start,
            codex_core::commands::codex::codex_oauth_device_auth_start,
            codex_core::commands::codex::codex_oauth_login_completed,
            codex_core::commands::codex::codex_oauth_login_cancel,
            codex_core::commands::codex::codex_oauth_submit_callback_url,
            codex_core::commands::codex::add_codex_account_with_token,
            codex_core::commands::codex::add_codex_account_with_api_key,
            codex_core::commands::codex::update_codex_account_name,
            codex_core::commands::codex::update_codex_api_key_credentials,
            codex_core::commands::codex::update_codex_account_tags,
            codex_core::commands::codex::update_codex_account_note,
            codex_core::commands::codex::is_codex_oauth_port_in_use,
            codex_core::commands::codex::get_codex_history_visibility_provider,
            codex_core::commands::codex::codex_repair_session_visibility_for_launch_target,
            codex_core::commands::codex::codex_list_sessions_across_instances,
            codex_core::commands::codex::codex_get_session_token_stats_across_instances,
            codex_core::commands::codex::codex_query_session_usage,
            codex_core::commands::codex::codex_move_sessions_to_trash_across_instances,
            codex_core::commands::codex::codex_list_trashed_sessions_across_instances,
            codex_core::commands::codex::codex_restore_sessions_from_trash_across_instances,
            codex_core::commands::codex::codex_delete_trashed_sessions_across_instances,
            codex_core::commands::codex::codex_empty_session_trash_across_instances,
            codex_core::commands::codex::codex_open_session_location,
            codex_core::commands::codex::codex_open_session_rollout,
            codex_core::commands::codex::list_codex_recycled_accounts,
            codex_core::commands::codex::restore_codex_recycled_account,
            codex_core::commands::codex::delete_codex_recycled_account,
            codex_core::commands::codex::empty_codex_recycle_bin,
            ];
            // D11 闸门补到后端：模块开关关着时，全部 codex 命令一律拒绝——
            // 否则「已关闭」的模块仍留着直敲 invoke 改写官方凭据文件的后门。
            move |invoke| {
                if is_codex_command(invoke.message.command()) {
                    if let Err(error) = codex_authorization(&invoke.message) {
                        invoke.resolver.reject(error.to_string());
                        return true;
                    }
                }
                base_invoke(invoke)
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出不做事：这是个托盘常驻应用，真「退出」几周才一回，而崩溃、断电、
            // 强杀都不走这个钩子，护不住东西却每次关闭都堵一次磁盘和网络 IO。
            // 及时备份交给 auto_backup 的定时/停笔即备两档。
            // 例外：局域网传输在收上传请求，拔监听要快过任何落盘动作。
            if let tauri::RunEvent::Exit { .. } = event {
                web_access::revoke(app_handle);
                services::codex_bridge::stop(app_handle);
                commands::fileshare::stop_for_exit(app_handle);
                commands::tunnel::stop_for_exit(app_handle);
            }
        });
}

#[cfg(test)]
pub(crate) fn test_state() -> AppState {
    AppState {
        db: std::sync::Arc::new(Mutex::new(Database::new(":memory:").unwrap())),
        data_epoch: Default::default(),
        master_key: Mutex::new(None),
        unlock_attempts: Mutex::new(services::auth_service::UnlockThrottle::default()),
        lock_epoch: std::sync::atomic::AtomicU64::new(0),
        backup_key: Mutex::new(None),
        backup_busy: AtomicBool::new(false),
        fileshare: commands::fileshare::ProcState::default(),
        tunnel: commands::tunnel::TunnelState::default(),
        note_keys: Mutex::new(std::collections::HashMap::new()),
        note_key: Mutex::new(None),
        note_drafts: Mutex::new(Default::default()),
    }
}

#[cfg(test)]
mod gate_tests {
    use super::is_codex_command;

    #[test]
    fn codex_requires_both_enabled_module_and_unlocked_session() {
        let state = super::test_state();
        state.db.lock().unwrap().set_meta("codex_enabled", "true").unwrap();
        assert_eq!(super::authorize_codex(&state), Err("应用已锁定"));
        *state.master_key.lock().unwrap() = Some(vec![1; 32]);
        assert!(super::authorize_codex(&state).is_ok());
        state.db.lock().unwrap().set_meta("codex_enabled", "false").unwrap();
        assert!(super::authorize_codex(&state).is_err());
    }

    /// 从本文件源码里抠出注册进 invoke_handler 的命令名：
    /// 形如 `commands::notes::list_notes,` / `codex_core::commands::codex::xxx,` 的独占一行。
    /// 逐行匹配，别处不会出现这种「全路径 + 逗号结尾」的行。
    fn registered(prefix: &str) -> Vec<String> {
        let src = include_str!("main.rs");
        src.lines()
            .filter_map(|l| {
                let t = l.trim();
                if !t.starts_with(prefix) || !t.ends_with(',') || t.contains('(') {
                    return None;
                }
                t.trim_end_matches(',').rsplit("::").next().map(|s| s.to_string())
            })
            .collect()
    }

    #[test]
    fn registered_codex_cmds_are_gated() {
        let codex = registered("codex_core::");
        assert!(!codex.is_empty(), "没解析到 codex 命令，八成是注册行格式变了");
        for name in &codex {
            assert!(is_codex_command(name), "{name} 注册自 codex-core 却过不了闸门");
        }
        // 裁剪名单必须仍是注册面的一部分：名单里的每一条都真有人注册
        let keep: Vec<String> = serde_json::from_str(include_str!("../codex-core/keep_cmds.json"))
            .expect("keep_cmds.json 必须可解析");
        let reg: std::collections::HashSet<&str> = codex.iter().map(String::as_str).collect();
        for name in &keep {
            assert!(reg.contains(name.as_str()), "{name} 在裁剪名单里但没被注册");
        }
    }

    #[test]
    fn desko_codex_dialog_is_gated_and_other_own_commands_are_not() {
        for name in registered("commands::") {
            assert_eq!(is_codex_command(&name), name == "codex_dialog_action", "desko 自有命令 {name} 的授权闸门不正确");
        }
    }
}
