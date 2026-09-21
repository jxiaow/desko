use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::backup::{self, PackageInfo};
use crate::error::AppError;
use crate::services::{self, attachment_service, auto_backup, backup_service};
use crate::AppState;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupProgress {
    op: String,
    text: String,
    pct: u8,
}

pub(crate) fn emit_progress(app: &AppHandle, op: &str, text: &str, pct: u8) {
    let _ = app.emit(
        "backup-progress",
        BackupProgress { op: op.to_string(), text: text.to_string(), pct },
    );
}

/// 取数据密钥 DEK：优先内存缓存，锁屏后重新解锁时再用主密钥从库里解出来
fn get_dek(state: &AppState) -> Result<Vec<u8>, AppError> {
    let mut cached = state
        .backup_key
        .lock()
        .map_err(|_| AppError::Database("lock error".to_string()))?;
    if let Some(key) = cached.as_ref() {
        return Ok(key.clone());
    }
    let master = services::get_master_key(state)?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let key = backup_service::unwrap_backup_key(&db, &master)?
        .ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))?;
    *cached = Some(key.clone());
    Ok(key)
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Io(e.to_string()))
}

#[tauri::command]
pub fn backup_dir(app: AppHandle) -> Result<String, AppError> {
    let dir = backup::backups_dir(&app_data_dir(&app)?);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn backup_status(app: AppHandle, state: State<AppState>) -> Result<backup_service::BackupStatus, AppError> {
    // 先取密钥再锁库：get_dek 内部会锁 db，std Mutex 不可重入，反过来写会死锁
    let key = get_dek(&state).ok();
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    let data_dir = app_data_dir(&app)?;
    backup_service::status(&db, key.as_deref(), &data_dir)
}

#[tauri::command]
pub async fn backup_set_password(app: AppHandle, state: State<'_, AppState>, password: String) -> Result<Vec<String>, AppError> {
    let master = services::get_master_key(&state)?;
    let (dek, wrap, changed) = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        backup_service::set_backup_password(&db, &master, &password)?
    };
    {
        let mut cached = state
            .backup_key
            .lock()
            .map_err(|_| AppError::Database("lock error".to_string()))?;
        *cached = Some(dek);
    }
    if !changed {
        return Ok(vec![]);
    }
    // 换密码 = 换包裹。磁盘上的包要原地换头，云端那份是旧头，得重传一遍
    let backups = backup::backups_dir(&app_data_dir(&app)?);
    let for_rewrap = backups.clone();
    let (_done, skipped) = tauri::async_runtime::spawn_blocking(move || backup::rewrap_all(&for_rewrap, &wrap))
        .await
        .map_err(|e| AppError::Backup(format!("换写备份头失败: {}", e)))?;
    services::cloud_service::clear_state(&backups)?;
    Ok(skipped)
}

#[tauri::command]
pub async fn backup_run(app: AppHandle, state: State<'_, AppState>) -> Result<PackageInfo, AppError> {
    // 已有任务在跑就直接回错，不排队：用户点第二下是想看进度，不是想要第二个包
    let _guard = auto_backup::BusyGuard::try_acquire(&state)
        .ok_or_else(|| AppError::Backup("已有备份任务在进行中".to_string()))?;
    let job = auto_backup::Job::prepare(&app, &state)?
        .ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        job.package(&|text, pct| emit_progress(&handle, "backup", text, pct))
    })
    .await
    .map_err(|e| AppError::Backup(format!("备份任务失败: {}", e)))?
}

#[cfg(test)]
mod name_tests {
    use super::check_package_name;

    #[test]
    fn real_package_names_are_accepted() {
        // 正常包名自带一个点，校验不能把它当路径穿越
        assert!(check_package_name("desko-20260920-202132.dsbk").is_ok());
    }

    #[test]
    fn traversal_and_bogus_names_are_rejected() {
        for bad in [
            "../../data.db",
            "desko-..dsbk",
            "desko-20260920-202132.txt",
            "other.dsbk",
            "desko-a/b.dsbk",
            "desko-a\\b.dsbk",
            "",
        ] {
            assert!(check_package_name(bad).is_err(), "{} 应当被拒绝", bad);
        }
    }
}

#[tauri::command]
pub fn backup_delete(app: AppHandle, name: String) -> Result<(), AppError> {
    check_package_name(&name)?;
    let path = app_data_dir(&app)?.join("backups").join(&name);
    std::fs::remove_file(&path).map_err(|e| AppError::Io(e.to_string()))
}

#[tauri::command]
pub fn check_package_name(name: &str) -> Result<(), AppError> {
    if !backup::is_package(name) {
        return Err(AppError::Backup("非法的备份文件名".to_string()));
    }
    Ok(())
}

/// 恢复管线：解包校验 → 现场先做个新备份 → 换库换附件。
/// 本地包、云端拉下来的包、迁移导出的包共用这一条，区别只在 pkg 指向哪儿。
/// 附件要么在包里（迁移导出），要么已经补齐在 backups/attachments 下。
pub(crate) async fn restore_package(
    app: AppHandle,
    state: State<'_, AppState>,
    pkg: std::path::PathBuf,
    dek: Vec<u8>,
    wrap: backup::container::Wrap,
) -> Result<(), AppError> {
    let db_path = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.get_db_path()
    };
    let data_dir = app_data_dir(&app)?;
    let attachments = attachment_service::attachments_dir();
    if !pkg.exists() {
        return Err(AppError::Backup("备份文件不存在".to_string()));
    }

    // 阶段一（后台线程）：解包校验 + 恢复前先给现场做一个备份
    let handle = app.clone();
    let staging = backup::staging_dir(&data_dir);
    let backups = backup::backups_dir(&data_dir);
    let (staging_out, attachments_out, db_path_out, dek_out, wrap_out, pkg_out, backups_out) = {
        (staging.clone(), attachments.clone(), db_path, dek.clone(), wrap.clone(), pkg, backups.clone())
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _manifest = backup::unpack_to_staging(
            &pkg_out,
            &dek_out,
            &staging_out,
            &backups_out,
            &|text, pct| emit_progress(&handle, "restore", text, pct),
        )?;
        emit_progress(&handle, "restore", "先备份当前数据", 70);
        backup::create_package(
            &db_path_out,
            &attachments_out,
            &backups_out,
            &dek_out,
            &wrap_out,
            env!("CARGO_PKG_VERSION"),
            &|_, _| {},
        )?;
        Ok::<(), AppError>(())
    })
    .await
    .map_err(|e| AppError::Backup(format!("恢复任务失败: {}", e)))??;

    // 阶段二（持锁）：关连接 → 换文件 → 重开
    emit_progress(&app, "restore", "替换数据库", 92);
    {
        let mut db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.swap_into_restored(&data_dir, &attachments, &staging)?;
    }
    // 库是备份当时的库：主密码若在那之后改过，内存里的主密钥就和库里封存的东西不再配对，
    // 备份密码校验位同理。清掉两把密钥强制重新解锁，别让半对半错的密钥留在内存里继续写数据。
    if let Ok(mut k) = state.backup_key.lock() {
        *k = None;
    }
    if let Ok(mut k) = state.master_key.lock() {
        *k = None;
    }
    let _ = app.emit("tray-lock", ());
    emit_progress(&app, "restore", "完成", 100);
    Ok(())
}

/// 密钥从包自己的头部推，不依赖本机 meta —— 换机/重装后同样能恢复
async fn restore_from(
    app: AppHandle,
    state: State<'_, AppState>,
    pkg: std::path::PathBuf,
    password: String,
) -> Result<(), AppError> {
    let (dek, wrap) = {
        let p = pkg.clone();
        tauri::async_runtime::spawn_blocking(move || backup::container::open_package(&p, &password))
            .await
            .map_err(|e| AppError::Backup(format!("任务失败: {}", e)))??
    };
    restore_package(app, state, pkg, dek, wrap).await
}

/// 从 backups 目录里按包名恢复
#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    password: String,
) -> Result<(), AppError> {
    check_package_name(&name)?;
    let pkg = app_data_dir(&app)?.join("backups").join(&name);
    restore_from(app, state, pkg, password).await
}

/// 把当前数据打成一个自足的迁移包写到指定路径：附件本体在包里，拷这一个文件就能换机恢复
#[tauri::command]
pub async fn backup_export(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<PackageInfo, AppError> {
    let _guard = auto_backup::BusyGuard::try_acquire(&state)
        .ok_or_else(|| AppError::Backup("已有备份任务在进行中".to_string()))?;
    let job = auto_backup::Job::prepare(&app, &state)?
        .ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))?;
    // 只装这份库真认领的附件，不连附件目录里堆的无引用历史文件一起带走
    let names = {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        attachment_service::claimed_names(&db, &job.attachments)?
    };
    let dest = std::path::PathBuf::from(&path);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::export_package(
        &job.db_path,
        &job.attachments,
        &names,
        &dest,
        &job.dek,
        &job.wrap,
        env!("CARGO_PKG_VERSION"),
        &|text, pct| emit_progress(&handle, "export", text, pct),
    ))
    .await
    .map_err(|e| AppError::Backup(format!("导出任务失败: {}", e)))?
}

/// 从任意路径恢复（迁移包扔在桌面或 U 盘里也能直接选）
#[tauri::command]
pub async fn backup_restore_file(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> Result<(), AppError> {
    let ok = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.ends_with(".dsbk"))
        .unwrap_or(false);
    if !ok {
        return Err(AppError::Backup("只能恢复 .dsbk 备份文件".to_string()));
    }
    restore_from(app, state, std::path::PathBuf::from(path), password).await
}
