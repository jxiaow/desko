use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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

/// 当前档案根即「应用数据目录」（多档案 D1）。备份/staging/换库都以它为基。
/// 保留 `app` 形参仅为调用点不变；实际路径来自 `paths` 全局。
fn app_data_dir(_app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(crate::paths::profile_root())
}

#[tauri::command]
pub fn backup_status(app: AppHandle, state: State<AppState>) -> Result<backup_service::BackupStatus, AppError> {
    let busy = state.backup_busy.load(std::sync::atomic::Ordering::SeqCst);
    let master = state.master_key.lock().map_err(|_| AppError::Database("lock error".into()))?;
    let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
    backup_service::status(&db, &app_data_dir(&app)?, busy, master.as_deref())
}

#[tauri::command]
pub async fn backup_set_password(app: AppHandle, state: State<'_, AppState>, password: String) -> Result<Vec<String>, AppError> {
    let _guard = auto_backup::BusyGuard::try_acquire(&state)
        .ok_or_else(|| AppError::Backup("已有备份或恢复任务在进行中，请稍后修改密码".into()))?;
    let (wrap, changed) = {
        let master_guard = state.master_key.lock().map_err(|_| AppError::Database("lock error".into()))?;
        let master = master_guard.as_ref().ok_or(AppError::NotUnlocked)?;
        let result = {
            let db = state.db.lock().map_err(|_| AppError::Database("lock error".into()))?;
            backup_service::set_backup_password(&db, master, &password)?
        };
        // Keep the master-key lifecycle guard through installing the cache.
        // A concurrent lock/password change cannot leave an old-key seal behind.
        let (dek, wrap, changed) = result;
        *state.backup_key.lock().map_err(|_| AppError::Database("lock error".into()))? = Some(dek);
        (wrap, changed)
    };
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

/// 手动一轮的回报。传失败时本地那份照样留着，下一轮补传 —— 所以不当错误抛
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub package: PackageInfo,
    pub uploaded: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn backup_run(app: AppHandle, state: State<'_, AppState>) -> Result<RunResult, AppError> {
    // 备份就是"打个包传上坚果云"，没连云这个动作没有意义：换机请走去「迁移」里导出单文件包
    {
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        if !services::cloud_service::configured(&db) {
            return Err(AppError::Backup("还没连接云端，备份无处可传".to_string()));
        }
    }
    // 已有任务在跑就直接回错，不排队：用户点第二下是想看进度，不是想要第二个包
    let _guard = auto_backup::BusyGuard::try_acquire(&state)
        .ok_or_else(|| AppError::Backup("已有备份任务在进行中".to_string()))?;
    let job = auto_backup::Job::prepare(&app, &state)?
        .ok_or_else(|| AppError::Backup("尚未设置备份密码".to_string()))?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // 和定时器跑的是同一轮：打包 → 上云 → 收拾本地。
        // op 分 pack/upload 两段，标题栏徽标靠它判定"这轮真结束了"（打包末尾也有一个 100）
        let pack = |text: &str, pct: u8| emit_progress(&handle, "pack", text, pct);
        let upload = |text: &str, pct: u8| emit_progress(&handle, "upload", text, pct);
        let package = job.package(&pack)?;
        let (uploaded, error) = match auto_backup::sync_and_settle(&handle, &job, &upload, true) {
            auto_backup::SyncOutcome::Done(_) => (true, None),
            auto_backup::SyncOutcome::Failed(e) => {
                // 和定时那一档同一入口：失败抛给标题栏徽标，本地那份下一轮还会补传
                let _ = handle.emit("auto-backup-note", e.clone());
                (false, Some(e))
            }
        };
        Ok::<RunResult, AppError>(RunResult { package, uploaded, error })
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
    let _guard = auto_backup::BusyGuard::try_acquire(&state)
        .ok_or_else(|| AppError::Backup("已有备份或恢复任务在进行中".into()))?;
    restore_package_while_busy(app, state.clone(), pkg, dek, wrap, &_guard, None).await
}

pub(crate) async fn restore_package_while_busy(
    app: AppHandle, state: State<'_, AppState>, pkg: std::path::PathBuf,
    dek: Vec<u8>, wrap: backup::container::Wrap, _guard: &auto_backup::BusyGuard<'_>,
    attachment_cache: Option<services::cloud_service::RestoreDownload>,
) -> Result<(), AppError> {
    let (db_path, safety_keys) = {
        let master = state.master_key.lock().map_err(|_| AppError::Database("lock error".into()))?;
        let db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        let safety_keys = if let Some(master) = master.as_ref() {
            match backup_service::unwrap_backup_key(&db, master)? {
                Some(key) => Some((key, backup_service::current_wrap(&db)?)),
                None => None,
            }
        } else { None };
        (db.get_db_path(), safety_keys)
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
    let attachment_cache_path = attachment_cache.as_ref()
        .map(|download| download.cache_root().to_path_buf()).unwrap_or_else(|| backups.clone());
    let (safety_dek, safety_wrap) = safety_keys.unwrap_or_else(|| (dek.clone(), wrap.clone()));
    let (staging_out, attachments_out, db_path_out, dek_out, pkg_out, backups_out) = {
        (staging.clone(), attachments.clone(), db_path, dek.clone(), pkg, backups.clone())
    };
    let accounts = tauri::async_runtime::spawn_blocking(move || {
        let _cache_owner = attachment_cache;
        let (_manifest, accounts) = backup::unpack_to_staging_with_accounts(
            &pkg_out,
            &dek_out,
            &staging_out,
            &attachment_cache_path,
            &|text, pct| emit_progress(&handle, "restore", text, pct),
        )?;
        emit_progress(&handle, "restore", "先备份当前数据", 70);
        std::fs::create_dir_all(&backups_out)?;
        let safety_path = backups_out.join(backup::unique_package_name(&backups_out, chrono::Utc::now().timestamp_millis())?);
        // Safety copies are self-contained: importing another DEK must never
        // pair today's database with sidecar attachments encrypted by an old key.
        backup::export_package(
            &db_path_out,
            &attachments_out,
            &safety_path,
            &safety_dek,
            &safety_wrap,
            env!("CARGO_PKG_VERSION"),
            &|_, _| {},
        )?;
        Ok::<_, AppError>(accounts)
    })
    .await
    .map_err(|e| AppError::Backup(format!("恢复任务失败: {}", e)))??;

    // 阶段二（持锁）：关连接 → 换文件 → 重开
    emit_progress(&app, "restore", "替换数据库", 92);
    {
        let mut master = state.master_key.lock().map_err(|_| AppError::Database("lock error".into()))?;
        let mut db = state.db.lock().map_err(|_| AppError::Database("lock error".to_string()))?;
        db.swap_into_restored_with_accounts(&data_dir, &attachments, &staging, accounts.as_deref())?;
        *master = None;
        state.lock_epoch.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        *state.backup_key.lock().map_err(|_| AppError::Database("lock error".into()))? = None;
        crate::commands::note_lock::close_domain(&state);
        state.note_drafts.lock().map_err(|_| AppError::Database("lock error".into()))?.clear();
    }
    // 库是备份当时的库：主密码若在那之后改过，内存里的主密钥就和库里封存的东西不再配对，
    // 备份密码校验位同理。清掉两把密钥强制重新解锁，别让半对半错的密钥留在内存里继续写数据。
    let _ = app.emit("tray-lock", serde_json::json!({"forced": true, "resetDrafts": true}));
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
    let dest = std::path::PathBuf::from(&path);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || backup::export_package(
        &job.db_path,
        &job.attachments,
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
