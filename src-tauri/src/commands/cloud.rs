use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::services::{cloud_service, auto_backup::BusyGuard};
use crate::webdav::DavEntry;
use crate::AppState;

use super::backup::{check_package_name, emit_progress, restore_package_while_busy};

fn master_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    crate::services::get_master_key(state)
}

/// 备份目录随当前档案根（多档案 D1）；`app` 形参保留仅为调用点不变。
fn app_data_dir(_app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(crate::paths::profile_root())
}

#[tauri::command]
pub fn cloud_status(state: State<AppState>, app: AppHandle) -> Result<cloud_service::CloudStatus, AppError> {
    let master = master_key(&state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let backups = crate::backup::backups_dir(&app_data_dir(&app)?);
    cloud_service::status(&db, &master, &backups)
}

/// 密码不回显，弹窗里留空 = 保持库里旧值；测试和保存必须走同一套解释，
/// 否则已配置（含迁移导入）后点「测试连接」必误报密码为空。
fn resolve_app_password(state: &AppState, input: String) -> Result<String, AppError> {
    if !input.is_empty() {
        return Ok(input);
    }
    let master = master_key(state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    Ok(cloud_service::load_cfg(&db, &master)?
        .map(|o| o.app_password)
        .unwrap_or_default())
}

#[tauri::command]
pub async fn cloud_test_config(
    state: State<'_, AppState>,
    server: String,
    account: String,
    app_password: String,
) -> Result<(), AppError> {
    let app_password = resolve_app_password(&state, app_password)?;
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
    let _guard = BusyGuard::try_acquire(state.inner())
        .ok_or_else(|| AppError::Backup("备份或同步正在进行，请稍后修改云配置".into()))?;
    let app_password = resolve_app_password(&state, app_password)?;
    let creds = cloud_service::CloudCreds {
        server: cloud_service::normalize_server(&server)?,
        account,
        app_password,
    };
    let checked = creds.clone();
    tauri::async_runtime::spawn_blocking(move || cloud_service::test_connection(&checked))
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))??;
    // 连接测试期间可能改过主密码或锁屏，提交时重新取得当前密钥并持到落库结束。
    let master = state.master_key.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let master = master.as_ref().ok_or(AppError::NotUnlocked)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let changed = cloud_service::load_cfg(&db, master)?.as_ref()
        .map(cloud_service::target_id).transpose()? != Some(cloud_service::target_id(&creds)?);
    // 先清本地证据再提交新凭据；清理失败时仍保留旧配置，远端对象一律不动。
    if changed {
        let backups = crate::backup::backups_dir(&crate::paths::profile_root());
        cloud_service::clear_sync_baseline(&backups)?;
    }
    cloud_service::save_cfg(&db, master, &creds)
}

#[tauri::command]
pub fn cloud_disconnect(state: State<AppState>, app: AppHandle) -> Result<(), AppError> {
    let _guard = BusyGuard::try_acquire(state.inner())
        .ok_or_else(|| AppError::Backup("备份或同步正在进行，请稍后断开云服务".into()))?;
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
    let _guard = BusyGuard::try_acquire(state.inner())
        .ok_or_else(|| AppError::Backup("备份或同步正在进行，请稍后恢复".into()))?;
    check_package_name(&name)?;
    let master = master_key(&state)?;
    let creds = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        cloud_service::load_cfg(&db, &master)?
            .ok_or_else(|| AppError::Backup("尚未配置坚果云".to_string()))?
    };
    let backups = crate::backup::backups_dir(&app_data_dir(&app)?);

    // 1) 下载当前远端对象到 target 隔离目录，并验证完整包
    let name_for_dl = name.clone();
    let backups_for_dl = backups.clone();
    let creds_for_dl = creds.clone();
    let password_for_dl = password.clone();
    let downloaded = tauri::async_runtime::spawn_blocking(move || {
        cloud_service::download_package(&creds_for_dl, &backups_for_dl, &name_for_dl, &password_for_dl)
    })
    .await
    .map_err(|e| AppError::Backup(format!("下载任务失败: {}", e)))??;

    let pkg = downloaded.package.clone();
    // 2) 用包自带的包裹块 + 备份密码取出数据密钥（新机器上也能成）
    emit_progress(&app, "restore", "校验备份密码", 10);
    let (dek, wrap, manifest) = {
        let cache_owner = downloaded.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let (dek, wrap) = crate::backup::container::open_package(&cache_owner.package, &password)?;
            let manifest = crate::backup::container::read_external_attachments_manifest(&cache_owner.package, &dek)?;
            Ok::<_, AppError>((dek, wrap, manifest))
        })
        .await
        .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))??
    };

    // 3) 按清单补齐缺失的附件密文
    let handle = app.clone();
    let attachment_dek = dek.clone();
    let attachment_cache = downloaded.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cloud_service::fetch_attachments(&creds, attachment_cache.cache_root(), &manifest, &attachment_dek, &|text, pct| {
            emit_progress(&handle, "restore", text, pct)
        })
    })
    .await
    .map_err(|e| AppError::Backup(format!("下载任务失败: {}", e)))??;

    let result = restore_package_while_busy(app, state, pkg, dek, wrap, &_guard, Some(downloaded.clone())).await;
    drop(downloaded); // Release after unpack/publication; errors also remove this job's download files.
    result
}
