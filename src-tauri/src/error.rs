use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),
    
    #[error("Crypto error: {0}")]
    Crypto(String),
    
    #[error("Not initialized")]
    NotInitialized,
    
    #[error("Already initialized")]
    AlreadyInitialized,
    
    #[error("Wrong password")]
    WrongPassword,
    
    #[error("Not unlocked")]
    NotUnlocked,
    
    #[error("Entry not found")]
    EntryNotFound,
    
    #[error("IO error: {0}")]
    Io(String),

    #[error("Backup error: {0}")]
    Backup(String),
}

impl AppError {
    pub fn user_message(&self) -> String {
        match self {
            AppError::Database(_) => "操作失败".to_string(),
            AppError::Crypto(_) => "加密操作失败".to_string(),
            AppError::NotInitialized => "应用未初始化".to_string(),
            AppError::AlreadyInitialized => "应用已初始化".to_string(),
            AppError::WrongPassword => "密码错误".to_string(),
            AppError::NotUnlocked => "应用已锁定".to_string(),
            AppError::EntryNotFound => "记录不存在".to_string(),
            AppError::Io(_) => "文件操作失败".to_string(),
            // 备份的错误信息本身就是给人看的（含校验失败原因），原样透出
            AppError::Backup(msg) => msg.clone(),
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.user_message())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(err: rusqlite::Error) -> Self {
        AppError::Database(err.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::Io(err.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(err: zip::result::ZipError) -> Self {
        AppError::Backup(format!("备份包读写失败: {}", err))
    }
}
