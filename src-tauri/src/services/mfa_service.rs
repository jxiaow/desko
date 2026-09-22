//! MFA / TOTP 管理：otpauth 解析、密钥密封存储、RFC 6226/6238 动态码。
//! 密钥只在后端解密计算，前端永远只见码不见密。

use chrono::Utc;
use hmac::{Hmac, Mac};
use uuid::Uuid;

use crate::crypto;
use crate::db::mfa_repo::MfaRow;
use crate::db::{Database, MfaCode, MfaTokenInfo};
use crate::error::AppError;

#[derive(Debug)]
pub struct ParsedTotp {
    pub issuer: String,
    pub label: String,
    pub secret: String,
    pub algorithm: String,
    pub digits: i64,
    pub period: i64,
}

/// 各站点导出的密钥常见带空格/连字符/小写，统一成无填充大写
pub fn normalize_base32(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .collect::<String>()
        .to_uppercase()
}

fn decode_base32(secret: &str) -> Result<Vec<u8>, AppError> {
    if secret.is_empty() {
        return Err(AppError::Backup("密钥不能为空".to_string()));
    }
    data_encoding::BASE32_NOPAD
        .decode(secret.as_bytes())
        .map_err(|_| AppError::Backup("密钥不是有效的 Base32 字符串".to_string()))
}

fn check_digits(v: &str) -> Result<i64, AppError> {
    match v {
        "6" | "7" | "8" => Ok(v.parse().unwrap()),
        _ => Err(AppError::Backup("digits 只支持 6/7/8".to_string())),
    }
}

fn check_algorithm(v: &str) -> Result<String, AppError> {
    let up = v.to_uppercase();
    match up.as_str() {
        "SHA1" | "SHA256" | "SHA512" => Ok(up),
        _ => Err(AppError::Backup("algorithm 只支持 SHA1/SHA256/SHA512".to_string())),
    }
}

/// otpauth://totp/Issuer:user?secret=..&issuer=..&digits=..&period=..&algorithm=..
pub fn parse_otpauth(uri: &str) -> Result<ParsedTotp, AppError> {
    let tail = uri
        .trim()
        .strip_prefix("otpauth://totp/")
        .ok_or_else(|| AppError::Backup("只支持 TOTP 链接（otpauth://totp/…）".to_string()))?;
    let (label_part, query) = match tail.split_once('?') {
        Some((a, b)) => (a, b),
        None => (tail, ""),
    };

    let mut params = std::collections::HashMap::new();
    for pair in query.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        params.insert(k.to_ascii_lowercase(), crate::webdav::percent_decode(v));
    }

    // 路径段本身也可能 "Issuer:account" 且整体被 URL 编码过
    let decoded_label = crate::webdav::percent_decode(label_part);
    let (mut issuer, mut label) = match decoded_label.rsplit_once(':') {
        Some((iss, lab)) => (iss.trim().to_string(), lab.trim().to_string()),
        None => (String::new(), decoded_label.trim().to_string()),
    };
    if let Some(iss) = params.get("issuer") {
        if !iss.trim().is_empty() {
            issuer = iss.trim().to_string();
        }
    }
    if label.is_empty() {
        label = issuer.clone();
    }
    if label.is_empty() {
        return Err(AppError::Backup("链接里既没有账号名也没有站点名".to_string()));
    }

    let secret = normalize_base32(params.get("secret").map(String::as_str).unwrap_or(""));
    decode_base32(&secret)?;
    let digits = match params.get("digits") {
        Some(v) => check_digits(v)?,
        None => 6,
    };
    let period = match params.get("period") {
        Some(v) => {
            let p: i64 = v
                .parse()
                .map_err(|_| AppError::Backup("period 必须是正整数秒".to_string()))?;
            if !(1..=300).contains(&p) {
                return Err(AppError::Backup("period 超出合理范围（1~300 秒）".to_string()));
            }
            p
        }
        None => 30,
    };
    let algorithm = match params.get("algorithm") {
        Some(v) => check_algorithm(v)?,
        None => "SHA1".to_string(),
    };

    Ok(ParsedTotp {
        issuer,
        label,
        secret,
        algorithm,
        digits,
        period,
    })
}

fn seal_secret(secret: &str, master: &[u8]) -> Result<String, AppError> {
    let sealed = crypto::encrypt_password(secret, master)?;
    serde_json::to_string(&sealed).map_err(|e| AppError::Crypto(e.to_string()))
}

fn make_row(parsed: &ParsedTotp, master: &[u8]) -> Result<MfaRow, AppError> {
    Ok(MfaRow {
        info: MfaTokenInfo {
            id: Uuid::new_v4().to_string(),
            issuer: parsed.issuer.clone(),
            label: parsed.label.clone(),
            algorithm: parsed.algorithm.clone(),
            digits: parsed.digits,
            period: parsed.period,
            created_at: Utc::now().timestamp_millis(),
        },
        secret_enc: seal_secret(&parsed.secret, master)?,
    })
}

pub fn add_from_uri(db: &Database, master: &[u8], uri: &str) -> Result<MfaTokenInfo, AppError> {
    let parsed = parse_otpauth(uri)?;
    let row = make_row(&parsed, master)?;
    db.insert_mfa(&row)?;
    Ok(row.info)
}

pub fn add_manual(
    db: &Database,
    master: &[u8],
    label: &str,
    issuer: Option<String>,
    secret_raw: &str,
) -> Result<MfaTokenInfo, AppError> {
    let secret = normalize_base32(secret_raw);
    decode_base32(&secret)?;
    let parsed = ParsedTotp {
        issuer: issuer.unwrap_or_default().trim().to_string(),
        label: label.trim().to_string(),
        secret,
        algorithm: "SHA1".to_string(),
        digits: 6,
        period: 30,
    };
    if parsed.label.is_empty() {
        return Err(AppError::Backup("账号名不能为空".to_string()));
    }
    let row = make_row(&parsed, master)?;
    db.insert_mfa(&row)?;
    Ok(row.info)
}

fn hotp(secret: &[u8], counter: u64, algorithm: &str, digits: i64) -> String {
    let msg = counter.to_be_bytes();
    // RFC 4226 动态截取：低 4 位当偏移，取 4 字节去掉最高位
    let hash: Vec<u8> = match algorithm {
        "SHA256" => {
            let mut m = Hmac::<sha2::Sha256>::new_from_slice(secret).expect("hmac accepts any key");
            m.update(&msg);
            m.finalize().into_bytes().to_vec()
        }
        "SHA512" => {
            let mut m = Hmac::<sha2::Sha512>::new_from_slice(secret).expect("hmac accepts any key");
            m.update(&msg);
            m.finalize().into_bytes().to_vec()
        }
        _ => {
            let mut m = Hmac::<sha1::Sha1>::new_from_slice(secret).expect("hmac accepts any key");
            m.update(&msg);
            m.finalize().into_bytes().to_vec()
        }
    };
    let off = (hash[hash.len() - 1] & 0x0f) as usize;
    let bits = ((hash[off] & 0x7f) as u32) << 24
        | (hash[off + 1] as u32) << 16
        | (hash[off + 2] as u32) << 8
        | hash[off + 3] as u32;
    let modulus = 10u32.pow(digits as u32);
    format!("{:0width$}", bits % modulus, width = digits as usize)
}

pub fn list_codes(db: &Database, master: &[u8]) -> Result<Vec<MfaCode>, AppError> {
    let now = Utc::now().timestamp();
    let mut out = Vec::new();
    for row in db.list_mfa_rows()? {
        let sealed: crypto::EncryptedData =
            serde_json::from_str(&row.secret_enc).map_err(|e| AppError::Crypto(e.to_string()))?;
        let secret_b32 = crypto::decrypt_password(&sealed, master)?;
        let secret = decode_base32(&secret_b32)?;
        let period = row.info.period.max(1);
        let code = hotp(&secret, (now / period) as u64, &row.info.algorithm, row.info.digits);
        out.push(MfaCode {
            id: row.info.id,
            issuer: row.info.issuer,
            label: row.info.label,
            code,
            digits: row.info.digits,
            period,
            remaining: period - now.rem_euclid(period),
        });
    }
    Ok(out)
}

pub fn remove(db: &Database, id: &str) -> Result<(), AppError> {
    if !db.delete_mfa(id)? {
        return Err(AppError::Backup("账号已不存在".to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 附录 B 的 ASCII 密钥 "12345678901234567890"
    fn ascii_secret() -> Vec<u8> {
        b"12345678901234567890".to_vec()
    }

    #[test]
    fn hotp_matches_rfc4226() {
        let want = ["755224", "287082", "359152", "969429", "338314"];
        for (c, w) in want.iter().enumerate() {
            assert_eq!(hotp(&ascii_secret(), c as u64, "SHA1", 6), *w);
        }
    }

    #[test]
    fn totp_matches_rfc6238_sha1() {
        assert_eq!(hotp(&ascii_secret(), 59 / 30, "SHA1", 8), "94287082");
        assert_eq!(hotp(&ascii_secret(), 1111111104 / 30, "SHA1", 8), "07081804");
        assert_eq!(hotp(&ascii_secret(), 1111111111 / 30, "SHA1", 8), "14050471");
        // 6 位码 = 8 位码截取低位，同一测试向量可推导
        assert_eq!(hotp(&ascii_secret(), 1, "SHA1", 6), "287082");
    }

    #[test]
    fn parses_full_otpauth_uri() {
        let p = parse_otpauth(
            "otpauth://totp/GitHub%3Aalice%40example.com?secret=jbsw-y33n-axe3-py3b-arpq&issuer=GitHub&digits=6&period=30&algorithm=SHA1",
        )
        .unwrap();
        assert_eq!(p.issuer, "GitHub");
        assert_eq!(p.label, "alice@example.com");
        assert_eq!(p.secret, "JBSWY33NAXE3PY3BARPQ");
        assert_eq!(p.digits, 6);
    }

    #[test]
    fn defaults_when_params_missing() {
        let p = parse_otpauth("otpauth://totp/alice@corp?secret=JBSWY33NAXE3PY3BARPQ").unwrap();
        assert_eq!(p.label, "alice@corp");
        assert_eq!((p.algorithm.as_str(), p.digits, p.period), ("SHA1", 6, 30));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse_otpauth("otpauth://hotp/x?secret=AAAA").unwrap_err().to_string().contains("TOTP"));
        assert!(parse_otpauth("https://example.com").is_err());
        assert!(parse_otpauth("otpauth://totp/x?secret=!!!").is_err());
        assert!(parse_otpauth("otpauth://totp/x?secret=AAAA&digits=5").is_err());
        assert!(parse_otpauth("otpauth://totp/x?secret=AAAA&period=0").is_err());
    }

    #[test]
    fn add_list_remove_roundtrip() {
        let (db, path) = crate::db::setup_test_db();
        let master = vec![7u8; 32];
        let info = add_from_uri(
            &db,
            &master,
            "otpauth://totp/Alice?secret=JBSWY33NAXE3PY3BARPQ&issuer=GitLab",
        )
        .unwrap();
        assert_eq!(info.issuer, "GitLab");

        let codes = list_codes(&db, &master).unwrap();
        assert_eq!(codes.len(), 1);
        assert_eq!(codes[0].code.len(), 6);
        assert!(codes[0].remaining >= 1 && codes[0].remaining <= 30);

        // 密钥不出后端：列表结构里没有任何字段能携带 base32
        let json = serde_json::to_string(&codes[0]).unwrap();
        assert!(!json.contains("JBSWY33N"));

        remove(&db, &info.id).unwrap();
        assert!(list_codes(&db, &master).unwrap().is_empty());
        crate::db::cleanup(&path);
    }
}
