// desko 门面：仅保留 Codex 账号域引用到的定义（内容逐字节取自上游同名模块）。
#![allow(dead_code, unused_imports, unused_variables, clippy::all)]
use std::sync::{Mutex, OnceLock};

pub fn env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn fallback_data_dir() -> std::path::PathBuf {
    static ROOT: OnceLock<std::path::PathBuf> = OnceLock::new();
    ROOT.get_or_init(|| {
        std::env::temp_dir().join(format!(
            "cockpit-unit-test-data-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    })
    .clone()
}
