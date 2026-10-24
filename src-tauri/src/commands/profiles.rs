//! 多档案命令面（F2）。档案住 `%APPDATA%\com.desko.app\profiles\<id>`，注册表 `profiles.json`。
//!
//! 边界：`switch` 写 active 后调 `app.restart()`（D3）—— 换根靠重启，进程级 `OnceLock`
//! 不可热改，也回避了旧档案 asset 白名单收不回的隔离漏洞。切换后 IPC 连接随进程消失，
//! 前端 promise 不 resolve 属预期，UI 侧应自持「切换中」态。

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::services::profile_service;

/// 前端视图模型：camelCase 序列化，与 desko 其余 DTO 同档。
/// 与落盘的 `ProfileMeta`（snake_case）分列，避免改动已写好的 profiles.json。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub cloud_ns: String,
    pub cloud_base: String,
    pub is_active: bool,
    pub created_at: i64,
    pub last_used_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileListDto {
    pub active_id: String,
    pub profiles: Vec<ProfileDto>,
}

fn app_root(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Profile(e.to_string()))
}

fn to_dto(p: profile_service::ProfileMeta, active_id: &str) -> ProfileDto {
    let is_active = p.id == active_id;
    ProfileDto {
        id: p.id,
        cloud_ns: p.cloud_ns.clone(),
        cloud_base: profile_service::base_for(&p.cloud_ns),
        name: p.name,
        is_active,
        created_at: p.created_at,
        last_used_at: p.last_used_at,
    }
}

#[tauri::command]
pub fn profiles_list(app: AppHandle) -> Result<ProfileListDto, AppError> {
    let root = app_root(&app)?;
    let (profiles, active_id) = profile_service::list(&root).map_err(AppError::Profile)?;
    Ok(ProfileListDto {
        active_id: active_id.clone(),
        profiles: profiles
            .into_iter()
            .map(|p| to_dto(p, &active_id))
            .collect(),
    })
}

#[tauri::command]
pub fn profiles_active(app: AppHandle) -> Result<Option<ProfileDto>, AppError> {
    let root = app_root(&app)?;
    let meta = profile_service::active(&root).map_err(AppError::Profile)?;
    Ok(meta.map(|p| {
        let active_id = p.id.clone();
        to_dto(p, &active_id)
    }))
}

#[tauri::command]
pub fn profiles_create(
    app: AppHandle,
    name: String,
    cloud_ns: Option<String>,
) -> Result<ProfileDto, AppError> {
    let root = app_root(&app)?;
    let meta = profile_service::create(&root, &name, cloud_ns.as_deref())
        .map_err(AppError::Profile)?;
    // 新档不可能是 active（active 只有一个且新建不改它），用注册表当前 active 兜底判 is_active
    let (_, active_id) = profile_service::list(&root).map_err(AppError::Profile)?;
    Ok(to_dto(meta, &active_id))
}

#[tauri::command]
pub fn profiles_rename(app: AppHandle, id: String, name: String) -> Result<(), AppError> {
    let root = app_root(&app)?;
    profile_service::rename(&root, &id, &name).map_err(AppError::Profile)
}

#[tauri::command]
pub fn profiles_delete(app: AppHandle, id: String) -> Result<(), AppError> {
    let root = app_root(&app)?;
    profile_service::delete(&root, &id).map_err(AppError::Profile)
}

/// 写 active 后重启进程换根。restart() 语义是 spawn+exit，调用即分叉不再返回。
/// restart() 走 cleanup_before_exit 路径、不派发 RunEvent::Exit，退出钩子里的
/// sidecar 收尾不会执行 —— 必须在这里手动停，否则旧档案的 fileshare 会在
/// 新档案启动后继续对外服务数秒（看门狗周期），违背档案隔离。
#[tauri::command]
pub fn profiles_switch(app: AppHandle, id: String) -> Result<(), AppError> {
    let root = app_root(&app)?;
    profile_service::switch(&root, &id).map_err(AppError::Profile)?;
    super::fileshare::stop_for_exit(&app);
    super::tunnel::stop_for_exit(&app);
    crate::services::codex_bridge::stop(&app);
    app.restart()
}
