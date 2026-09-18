#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod crypto;
mod error;
mod services;

use db::Database;
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
            
            let db = Database::new(db_path_str).expect("failed to init database");
            
            app.manage(AppState {
                db: Mutex::new(db),
                master_key: Mutex::new(None),
                unlock_attempts: Mutex::new(0),
            });

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
            commands::data::export_sql,
            commands::data::import_sql,
            commands::data::get_db_path,
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
            commands::notes::delete_attachment,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
