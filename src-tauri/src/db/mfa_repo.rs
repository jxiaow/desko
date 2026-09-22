use rusqlite::params;
use crate::error::AppError;
use super::Database;
use super::models::MfaTokenInfo;

/// 一行 MFA 记录 = 对外信息 + 主密码密封后的 base32 密钥（密封 JSON 原样存列）
pub struct MfaRow {
    pub info: MfaTokenInfo,
    pub secret_enc: String,
}

impl Database {
    pub fn insert_mfa(&self, row: &MfaRow) -> Result<(), AppError> {
        self.conn.execute(
            "INSERT INTO mfa_tokens (id, issuer, label, secret_enc, algorithm, digits, period, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                row.info.id,
                row.info.issuer,
                row.info.label,
                row.secret_enc,
                row.info.algorithm,
                row.info.digits,
                row.info.period,
                row.info.created_at,
            ],
        )?;
        Ok(())
    }

    /// 新加的排前面：正在录入的账号紧接着就要用
    pub fn list_mfa_rows(&self) -> Result<Vec<MfaRow>, AppError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, issuer, label, secret_enc, algorithm, digits, period, created_at
             FROM mfa_tokens ORDER BY created_at DESC, rowid DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(MfaRow {
                info: MfaTokenInfo {
                    id: r.get(0)?,
                    issuer: r.get(1)?,
                    label: r.get(2)?,
                    algorithm: r.get(4)?,
                    digits: r.get(5)?,
                    period: r.get(6)?,
                    created_at: r.get(7)?,
                },
                secret_enc: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn delete_mfa(&self, id: &str) -> Result<bool, AppError> {
        Ok(self.conn.execute("DELETE FROM mfa_tokens WHERE id = ?1", params![id])? > 0)
    }
}
