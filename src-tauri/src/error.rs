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

    #[error("尝试次数过多，请 {0} 秒后重试")]
    UnlockRateLimited(u64),
    
    #[error("小记加密设置已在其他端更改，请重新解锁后重试")]
    NoteStateChanged,

    #[error("Entry not found")]
    EntryNotFound,
    
    #[error("IO error: {0}")]
    Io(String),

    #[error("Backup error: {0}")]
    Backup(String),

    #[error("FileShare error: {0}")]
    FileShare(String),

    #[error("Profile error: {0}")]
    Profile(String),

    #[error("Bypass error: {0}")]
    Bypass(String),

    #[error("Tunnel error: {0}")]
    Tunnel(String),
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
            AppError::UnlockRateLimited(seconds) => format!("尝试次数过多，请 {} 秒后重试", seconds),
            AppError::NoteStateChanged => "小记加密设置已在其他端更改，请重新解锁后重试".into(),
            AppError::EntryNotFound => "记录不存在".to_string(),
            AppError::Io(_) => "文件操作失败".to_string(),
            // 备份的错误信息本身就是给人看的（含校验失败原因），原样透出
            AppError::Backup(msg) => msg.clone(),
            // 局域网传输同理：端口占用、目录创建失败等原因要让用户看见
            AppError::FileShare(msg) => msg.clone(),
            // 档案校验/操作原因（重名、非法字符、删当前档…）直接透出
            AppError::Profile(msg) => msg.clone(),
            // 直连清单：解析失败、hosts 标记区损坏都要让用户看见到底哪一步不对
            AppError::Bypass(msg) => msg.clone(),
            // 内网穿透同理：拉取失败、校验不匹配、子进程起不来都要原样透出
            AppError::Tunnel(msg) => msg.clone(),
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
