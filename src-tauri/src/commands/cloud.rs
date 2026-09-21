use tauri::{AppHandle, Manager, State};

use crate::error::AppError;
use crate::services::cloud_service;
use crate::webdav::DavEntry;
use crate::AppState;

use super::backup::{check_package_name, emit_progress, restore_package};

fn master_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    crate::services::get_master_key(state)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Io(e.to_string()))
}

#[tauri::command]
pub fn cloud_status(state: State<AppState>, app: AppHandle) -> Result<cloud_service::CloudStatus, AppError> {
    let master = master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let backups = crate::backup::backups_dir(&app_data_dir(&app)?);
    cloud_service::status(&db, &master, &backups)
}

#[tauri::command]
pub async fn cloud_test_config(
    server: String,
    account: String,
    app_password: String,
) -> Result<(), AppError> {
    let creds = cloud_service::CloudCreds { server, account, app_password };
    tauri::async_runtime::spawn_blocking(move || cloud_service::test_connection(&creds))
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))?
}

#[tauri::command]
pub async fn cloud_save_config(
    state: State<'_, AppState>,
    server: String,
    account: String,
    app_password: String,
) -> Result<(), AppError> {
    let master = master_key(&state)?;
    // 已配置时允许留空应用密码 = 保持旧值不变（密码不回显）
    let old = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        cloud_service::load_cfg(&db, &master)?
    };
    let app_password = if app_password.is_empty() {
        old.map(|o| o.app_password).unwrap_or_default()
    } else {
        app_password
    };
    let creds = cloud_service::CloudCreds {
        server: cloud_service::normalize_server(&server)?,
        account,
        app_password,
    };
    let checked = creds.clone();
    tauri::async_runtime::spawn_blocking(move || cloud_service::test_connection(&checked))
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))??;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    cloud_service::save_cfg(&db, &master, &creds)
}

#[tauri::command]
pub fn cloud_disconnect(state: State<AppState>, app: AppHandle) -> Result<(), AppError> {
    let backups = crate::backup::backups_dir(&app_data_dir(&app)?);
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    cloud_service::disconnect(&db, &backups)
}

#[tauri::command]
pub async fn cloud_list(state: State<'_, AppState>) -> Result<Vec<DavEntry>, AppError> {
    let master = master_key(&state)?;
    let creds = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        cloud_service::load_cfg(&db, &master)?
            .ok_or_else(|| AppError::Backup("尚未配置坚果云".to_string()))?
    };
    tauri::async_runtime::spawn_blocking(move || cloud_service::list_remote(&creds))
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))?
}

#[tauri::command]
pub async fn cloud_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: String,
) -> Result<(), AppError> {
    check_package_name(&name)?;
    let master = master_key(&state)?;
    let creds = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        cloud_service::load_cfg(&db, &master)?
            .ok_or_else(|| AppError::Backup("尚未配置坚果云".to_string()))?
    };
    let backups = crate::backup::backups_dir(&app_data_dir(&app)?);

    // 1) 先把包拉下来（不需要密钥）
    let name_for_dl = name.clone();
    let backups_for_dl = backups.clone();
    let creds_for_dl = creds.clone();
    let pkg = tauri::async_runtime::spawn_blocking(move || {
        cloud_service::download_package(&creds_for_dl, &backups_for_dl, &name_for_dl)
    })
    .await
    .map_err(|e| AppError::Backup(format!("下载任务失败: {}", e)))??;

    // 2) 用包自带的包裹块 + 备份密码取出数据密钥（新机器上也能成）
    emit_progress(&app, "restore", "校验备份密码", 10);
    let (dek, wrap) = {
        let p = pkg.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::backup::container::open_package(&p, &password)
        })
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))??
    };

    // 3) 按清单补齐缺失的附件密文
    let manifest = crate::backup::container::read_manifest(&pkg, &dek)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cloud_service::fetch_attachments(&creds, &backups, &manifest, &|text, pct| {
            emit_progress(&handle, "restore", text, pct)
        })
    })
    .await
    .map_err(|e| AppError::Backup(format!("下载任务失败: {}", e)))??;

    restore_package(app, state, pkg, dek, wrap).await
}
