// 局部拷贝：原 db 模块承载 Antigravity/AntiGravity Token 注入等能力（属已移除域），
// 这里只保留被会话可见性修复引用到的判定函数，逐字节取自上游同名模块。
use rusqlite::{Error as SqliteError, ErrorCode};

pub fn is_unusable_sqlite_database_error(error: &SqliteError) -> bool {
    matches!(
        error.sqlite_error_code(),
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt)
    ) || is_unusable_sqlite_database_message(&error.to_string())
}

pub fn is_unusable_sqlite_database_message(message: &str) -> bool {
    let lowered = message.to_ascii_lowercase();
    lowered.contains("file is not a database")
        || lowered.contains("not a database")
        || lowered.contains("database disk image is malformed")
}
