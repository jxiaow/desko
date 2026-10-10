//! 档案根注册表：进程内唯一的「当前档案」路径入口（多档案方案 D2）。
//!
//! 过去路径解析一分为二 —— 库/备份/fileshare 走 Tauri `app_data_dir()`，附件/图标走硬编码
//! `%APPDATA%\desko`。档案隔离要求「一个目录＝一个档案」，所以先把所有路径收敛到这一个根后面。
//!
//! `PROFILE_ROOT` 用 `OnceLock`（write-once）：启动时由 `main.rs` 依 `profile_service::boot()`
//! 的返回值设一次，进程内永不改 —— 切换档案靠重启（D3），从类型上杜绝「运行时热改根」的诱惑，
//! 也就杜绝了旧档案 asset 白名单来不及收回的隔离漏洞。

use std::path::PathBuf;
use std::sync::OnceLock;

pub struct ProfilePaths {
    /// 当前档案目录：`%APPDATA%\com.desko.app\profiles\<id>`
    pub root: PathBuf,
    /// 云命名空间基名：default → `"desko"`，其余 → `"desko-<ns>"`（cloud_service 用它拼远端目录）
    pub cloud_base: String,
}

static CURRENT: OnceLock<ProfilePaths> = OnceLock::new();

/// 唯一写入点（由 `main.rs` 在 `profile_service::boot()` 之后调用）。先设先得；正常只有启动设这一次。
pub fn init(p: ProfilePaths) {
    if CURRENT.set(p).is_err() && !cfg!(debug_assertions) {
        // 发行版里二次设根 = 不变量被破：静默吞下会让两个档案的写各去一边
        panic!("PROFILE_ROOT 被设了两次：唯一写入点在 main.rs 的启动路径上");
    }
}

fn cur() -> &'static ProfilePaths {
    match CURRENT.get() {
        Some(p) => p,
        // 兜底只在开发/测试里存在；发行版宁可当场崩，也不把数据静默写进临时目录——
        // 那种崩法下次启动照旧开真档案，而临时目录里的写入看起来像"数据凭空没了"。
        #[cfg(not(debug_assertions))]
        None => panic!("PROFILE_ROOT 未初始化：boot 之前就碰了 paths::*，与其写进临时目录不如当场崩"),
        #[cfg(debug_assertions)]
        None => CURRENT.get_or_init(|| ProfilePaths {
            root: std::env::temp_dir().join("desko-uninit-profile"),
            cloud_base: "desko".to_string(),
        }),
    }
}

pub fn profile_root() -> PathBuf {
    cur().root.clone()
}

pub fn data_db_path() -> PathBuf {
    cur().root.join("data.db")
}

pub fn attachments_dir() -> PathBuf {
    cur().root.join("attachments")
}

pub fn favicons_dir() -> PathBuf {
    cur().root.join("favicons")
}

pub fn cloud_base() -> String {
    cur().cloud_base.clone()
}
