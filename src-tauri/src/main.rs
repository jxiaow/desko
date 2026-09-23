#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod crypto;
mod error;
mod services;
mod backup;
mod webdav;

use db::Database;
use services::attachment_service;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter,
    Manager,
};

pub struct AppState {
    pub db: Mutex<Database>,
    pub master_key: Mutex<Option<Vec<u8>>>,
    pub unlock_attempts: Mutex<u32>,
    /// 备份密钥只在解锁后驻留内存，锁屏即清
    pub backup_key: Mutex<Option<Vec<u8>>>,
    /// 同一时刻只跑一个备份任务（手动、退出、定时共用一把闸）
    pub backup_busy: AtomicBool,
    /// 局域网文件传输服务子进程（默认关，开关在通用设置里）
    pub fileshare: commands::fileshare::ProcState,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // When a second instance is launched, focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");
            
            let db_path = app_data_dir.join("data.db");
            let db_path_str = db_path.to_str().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid database path encoding")
            }).expect("failed to convert database path");

            // 上次恢复中途断电留下的 .swap，先收拾干净再开库
            backup::recover_swap(&app_data_dir, &attachment_service::attachments_dir());

            let db = Database::new(db_path_str).expect("failed to init database");
            
            app.manage(AppState {
                db: Mutex::new(db),
                master_key: Mutex::new(None),
                unlock_attempts: Mutex::new(0),
                backup_key: Mutex::new(None),
                backup_busy: AtomicBool::new(false),
                fileshare: commands::fileshare::ProcState::default(),
            });

            // 正文里的图片走 asset: 协议读附件目录，只放行那一个目录
            if let Some(window) = app.get_webview_window("main") {
                let dir = attachment_service::attachments_dir();
                if std::fs::create_dir_all(&dir).is_ok() {
                    let _ = window.asset_protocol_scope().allow_directory(&dir, true);
                }
            }

            // Setup tray menu
            let show_item = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let lock_item = MenuItem::with_id(app, "lock", "锁定", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &lock_item, &quit_item])?;

            let icon = app.default_window_icon().unwrap().clone();

            TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "lock" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let state = app.state::<AppState>();
                                if let Ok(mut key) = state.backup_key.lock() {
                                    *key = None;
                                }
                                let _ = window.emit("tray-lock", ());
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
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
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 自动备份线程：定时/实时两档，都在后台判变更指纹，锁屏或没设备份密码就空转
            services::auto_backup::spawn(app.handle().clone());

            // 局域网文件传输：开关开着就恢复监听（默认关时无感）
            commands::fileshare::restore_on_startup(app.handle());

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
                            // Clear master key and emit lock event
                            let app_state = app_handle.state::<AppState>();
                            if let Ok(mut master_key) = app_state.master_key.lock() {
                                *master_key = None;
                            }
                            if let Ok(mut backup_key) = app_state.backup_key.lock() {
                                *backup_key = None;
                            }
                            if let Ok(mut attempts) = app_state.unlock_attempts.lock() {
                                *attempts = 0;
                            }
                            let _ = window_clone.emit("tray-lock", ());
                        }
                        
                        let _ = window_clone.hide();
                    }
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            commands::notes::create_note,
            commands::notes::update_note,
            commands::notes::delete_note,
            commands::notes::batch_delete_notes,
            commands::notes::toggle_pin_note,
            commands::notes::toggle_star_note,
            commands::notes::list_attachments,
            commands::notes::upload_attachment,
            commands::notes::stage_attachment,
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
            commands::settings::get_setting,
            commands::settings::set_setting,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 退出不做事：这是个托盘常驻应用，真「退出」几周才一回，而崩溃、断电、
            // 强杀都不走这个钩子，护不住东西却每次关闭都堵一次磁盘和网络 IO。
            // 及时备份交给 auto_backup 的定时/停笔即备两档。
            // 例外：局域网传输在收上传请求，拔监听要快过任何落盘动作。
            if let tauri::RunEvent::Exit { .. } = event {
                commands::fileshare::stop_for_exit(app_handle);
            }
        });
}
