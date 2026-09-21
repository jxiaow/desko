use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::crypto;
use crate::error::AppError;

pub const MAGIC: &[u8; 4] = b"DSBK";
/// v3 信封格式：数据用随机 DEK 加密，备份密码只负责把 DEK 包裹进定长头部。
/// 改密码 = 换包裹，不动密文；定长头部可原地改写。
pub const FORMAT_VERSION: u8 = 3;

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const DEK_LEN: usize = 32;
const TAG_LEN: usize = 16;
pub const WRAPPED_LEN: usize = DEK_LEN + TAG_LEN; // 48

const OFF_VER: usize = 4;
const OFF_SALT: usize = 5;
const OFF_KEK_NONCE: usize = OFF_SALT + SALT_LEN; // 21
const OFF_WRAPPED: usize = OFF_KEK_NONCE + NONCE_LEN; // 33
const OFF_DATA_NONCE: usize = OFF_WRAPPED + WRAPPED_LEN; // 81
const OFF_CT_LEN: usize = OFF_DATA_NONCE + NONCE_LEN; // 93
pub const HEADER_LEN: usize = OFF_CT_LEN + 8; // 101

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wrap {
    pub kdf_salt: [u8; SALT_LEN],
    pub kek_nonce: [u8; NONCE_LEN],
    pub wrapped: [u8; WRAPPED_LEN],
}

impl Wrap {
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut v = Vec::with_capacity(SALT_LEN + NONCE_LEN + WRAPPED_LEN);
        v.extend_from_slice(&self.kdf_salt);
        v.extend_from_slice(&self.kek_nonce);
        v.extend_from_slice(&self.wrapped);
        v
    }

    pub fn from_bytes(b: &[u8]) -> Result<Self, AppError> {
        if b.len() != SALT_LEN + NONCE_LEN + WRAPPED_LEN {
            return Err(AppError::Backup("密钥包裹数据长度不正确".to_string()));
        }
        let mut kdf_salt = [0u8; SALT_LEN];
        let mut kek_nonce = [0u8; NONCE_LEN];
        let mut wrapped = [0u8; WRAPPED_LEN];
        kdf_salt.copy_from_slice(&b[..SALT_LEN]);
        kek_nonce.copy_from_slice(&b[SALT_LEN..SALT_LEN + NONCE_LEN]);
        wrapped.copy_from_slice(&b[SALT_LEN + NONCE_LEN..]);
        Ok(Wrap { kdf_salt, kek_nonce, wrapped })
    }

    /// 用备份密码把 DEK 包起来。salt 进 AAD，防止有人偷换 salt 做弱口令爆破。
    pub fn seal(dek: &[u8], password: &str) -> Result<Wrap, AppError> {
        if dek.len() != DEK_LEN {
            return Err(AppError::Crypto(format!("Invalid DEK length: {}", dek.len())));
        }
        let kdf_salt: [u8; SALT_LEN] = crypto::random_bytes(SALT_LEN)
            .try_into()
            .map_err(|_| AppError::Crypto("salt".to_string()))?;
        let kek_nonce: [u8; NONCE_LEN] = crypto::random_bytes(NONCE_LEN)
            .try_into()
            .map_err(|_| AppError::Crypto("nonce".to_string()))?;
        let kek = crypto::derive_backup_key(password, &kdf_salt);
        let aad = wrap_aad(&kdf_salt);
        let ct = crypto::encrypt_blob_ad(dek, &kek, &kek_nonce, &aad)?;
        if ct.len() != WRAPPED_LEN {
            return Err(AppError::Crypto("包裹长度异常".to_string()));
        }
        let mut wrapped = [0u8; WRAPPED_LEN];
        wrapped.copy_from_slice(&ct);
        Ok(Wrap { kdf_salt, kek_nonce, wrapped })
    }

    /// 用备份密码取出 DEK
    pub fn open(&self, password: &str) -> Result<Vec<u8>, AppError> {
        let kek = crypto::derive_backup_key(password, &self.kdf_salt);
        let aad = wrap_aad(&self.kdf_salt);
        crypto::decrypt_blob_ad(&self.kek_nonce, &self.wrapped, &kek, &aad)
    }
}

fn wrap_aad(salt: &[u8; SALT_LEN]) -> Vec<u8> {
    let mut aad = MAGIC.to_vec();
    aad.push(FORMAT_VERSION);
    aad.extend_from_slice(salt);
    aad
}

/// 数据段的 AAD 只覆盖"改写后仍要保持一致"的字段：
/// 版本 + 数据 nonce + 密文长度。salt/包裹区不在内，改密码才能原地换头。
fn data_aad(data_nonce: &[u8; NONCE_LEN], ct_len: u64) -> Vec<u8> {
    let mut aad = MAGIC.to_vec();
    aad.push(FORMAT_VERSION);
    aad.extend_from_slice(data_nonce);
    aad.extend_from_slice(&ct_len.to_le_bytes());
    aad
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Counts {
    pub notes: i64,
    pub entries: i64,
    pub attachments: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub size: i64,
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Manifest {
    pub app: String,
    pub format: u8,
    pub created_at: i64,
    pub app_version: String,
    pub counts: Counts,
    #[serde(default)]
    pub files: Vec<FileEntry>,
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// 库快照 + manifest 打成 zip（v3：附件不进包，单独 .enc 存放）
/// 组 zip：manifest + 库快照。
/// `inline_dir` 给定时，按清单把附件本体一起装进包里（迁移导出用，一个文件走天下）；
/// 平时的定时备份不装，附件走旁边的 .enc 增量，省流量也省时间。
pub fn build_zip(
    db_file: &Path,
    manifest: &Manifest,
    inline_dir: Option<&Path>,
    progress: &dyn Fn(&str, u8),
) -> Result<Vec<u8>, AppError> {
    let mut zw = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    zw.start_file("manifest.json", opts)?;
    zw.write_all(&serde_json::to_vec(manifest).map_err(|e| AppError::Backup(e.to_string()))?)?;

    progress("写入库快照", 40);
    zw.start_file("data.db", opts)?;
    let mut db = std::fs::File::open(db_file)?;
    std::io::copy(&mut db, &mut zw)?;

    if let Some(dir) = inline_dir {
        let total = manifest.files.len().max(1);
        for (i, f) in manifest.files.iter().enumerate() {
            progress(
                &format!("装入附件 {}/{}", i + 1, total),
                40 + (((i + 1) as f64 / total as f64) * 38.0) as u8,
            );
            zw.start_file(format!("attachments/{}", f.name), opts)?;
            let mut src = std::fs::File::open(dir.join(&f.name))?;
            std::io::copy(&mut src, &mut zw)?;
        }
    }

    let cursor = zw.finish()?;
    Ok(cursor.into_inner())
}

/// 明文 → 定长头部 + AES-256-GCM 密文，落盘（先写 .tmp 再原子改名）
pub fn pack(bytes: &[u8], out: &Path, dek: &[u8], wrap: &Wrap) -> Result<(), AppError> {
    let data_nonce: [u8; NONCE_LEN] = crypto::random_bytes(NONCE_LEN)
        .try_into()
        .map_err(|_| AppError::Crypto("nonce".to_string()))?;
    // GCM 密文 = 明文 + 16 字节标签，长度先算出来才能进 AAD
    let ct_len = (bytes.len() + TAG_LEN) as u64;
    let aad = data_aad(&data_nonce, ct_len);
    let ct = crypto::encrypt_blob_ad(bytes, dek, &data_nonce, &aad)?;
    if ct.len() as u64 != ct_len {
        return Err(AppError::Crypto("密文长度异常".to_string()));
    }

    let mut buf: Vec<u8> = Vec::with_capacity(HEADER_LEN + ct.len());
    buf.extend_from_slice(MAGIC);
    buf.push(FORMAT_VERSION);
    buf.extend_from_slice(wrap.to_bytes().as_slice());
    buf.extend_from_slice(&data_nonce);
    buf.extend_from_slice(&ct_len.to_le_bytes());
    buf.extend_from_slice(&ct);

    write_atomic(out, &buf)
}

fn write_atomic(out: &Path, buf: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = tmp_path(out);
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(buf)?;
        f.flush()?;
    }
    match std::fs::rename(&tmp, out) {
        Ok(_) => Ok(()),
        // 目标已存在时 Windows 下 rename 会失败，先删再挪
        Err(_) => {
            let _ = std::fs::remove_file(out);
            std::fs::rename(&tmp, out).map_err(|e| AppError::Io(e.to_string()))
        }
    }
}

fn tmp_path(out: &Path) -> PathBuf {
    let mut s = out.as_os_str().to_os_string();
    s.push(".tmp");
    PathBuf::from(s)
}

/// 只解析头部字段，不校验文件长度（供只读了头部的调用方使用）
fn parse_header(raw: &[u8]) -> Result<(Wrap, [u8; NONCE_LEN], u64), AppError> {
    if raw.len() < HEADER_LEN || &raw[..4] != MAGIC {
        return Err(AppError::Backup("备份包格式不正确".to_string()));
    }
    if raw[OFF_VER] != FORMAT_VERSION {
        return Err(AppError::Backup(format!(
            "不支持的备份格式版本 {}（当前 {}）",
            raw[OFF_VER], FORMAT_VERSION
        )));
    }
    let wrap = Wrap::from_bytes(&raw[OFF_SALT..OFF_WRAPPED + WRAPPED_LEN])?;
    let mut data_nonce = [0u8; NONCE_LEN];
    data_nonce.copy_from_slice(&raw[OFF_DATA_NONCE..OFF_CT_LEN]);
    let ct_len = u64::from_le_bytes(raw[OFF_CT_LEN..HEADER_LEN].try_into().unwrap());
    Ok((wrap, data_nonce, ct_len))
}

/// 读头部 + 校验文件确实带全了密文
fn read_header(raw: &[u8]) -> Result<(Wrap, [u8; NONCE_LEN], u64), AppError> {
    let h = parse_header(raw)?;
    if (raw.len() - HEADER_LEN) as u64 != h.2 {
        return Err(AppError::Backup("备份包不完整（可能被截断）".to_string()));
    }
    Ok(h)
}

/// .dsbk/.enc → 明文（DEK 已在手）
pub fn unpack(pkg_path: &Path, dek: &[u8]) -> Result<Vec<u8>, AppError> {
    let raw = std::fs::read(pkg_path)?;
    let (_wrap, data_nonce, ct_len) = read_header(&raw)?;
    let aad = data_aad(&data_nonce, ct_len);
    crypto::decrypt_blob_ad(&data_nonce, &raw[HEADER_LEN..], dek, &aad)
}

/// 只给备份密码就拿到 (DEK, 包裹块)：恢复入口用，本地/云端/新机器同一套路
pub fn open_package(pkg_path: &Path, password: &str) -> Result<(Vec<u8>, Wrap), AppError> {    let mut f = std::fs::File::open(pkg_path)?;
    let mut head = vec![0u8; HEADER_LEN];
    f.read_exact(&mut head)
        .map_err(|_| AppError::Backup("备份包不完整（可能被截断）".to_string()))?;
    let (wrap, _, _) = parse_header(&head)?;
    let dek = wrap.open(password)?;
    Ok((dek, wrap))
}

/// 测试便捷：只要 DEK
#[cfg(test)]
pub fn derive_dek(pkg_path: &Path, password: &str) -> Result<Vec<u8>, AppError> {
    Ok(open_package(pkg_path, password)?.0)
}

/// 测试便捷：密码一步解到明文
#[cfg(test)]
pub fn unpack_with_password(pkg_path: &Path, password: &str) -> Result<Vec<u8>, AppError> {
    let (dek, _) = open_package(pkg_path, password)?;
    unpack(pkg_path, &dek)
}

/// 换备份密码时原地改写头部包裹区（76 字节），密文一个字节都不动
pub fn rewrap(path: &Path, wrap: &Wrap) -> Result<(), AppError> {
    let mut raw = std::fs::read(path)?;
    let (_, _, _) = read_header(&raw)?;
    if raw.len() < HEADER_LEN {
        return Err(AppError::Backup("备份包不完整".to_string()));
    }
    raw[OFF_SALT..OFF_WRAPPED + WRAPPED_LEN].copy_from_slice(&wrap.to_bytes());
    write_atomic(path, &raw)
}

/// 单个附件文件 → 密文 .enc（附件天然不可变，存在即跳过）
pub fn encrypt_file_to(src: &Path, out: &Path, dek: &[u8], wrap: &Wrap) -> Result<(), AppError> {
    let bytes = std::fs::read(src)?;
    pack(&bytes, out, dek, wrap)
}

/// .enc → 明文落盘并校验 sha256
pub fn decrypt_file_to(enc: &Path, dst: &Path, expect_sha: &str, dek: &[u8]) -> Result<(), AppError> {
    let bytes = unpack(enc, dek)?;
    if !expect_sha.is_empty() && sha256_hex(&bytes) != expect_sha {
        return Err(AppError::Backup(format!(
            "附件校验失败: {}",
            dst.file_name().unwrap_or_default().to_string_lossy()
        )));
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dst, bytes)?;
    Ok(())
}

/// zip 字节解到 staging 目录，返回 manifest
pub fn extract_to(zip_bytes: &[u8], staging: &Path) -> Result<Manifest, AppError> {
    let _ = std::fs::remove_dir_all(staging);
    std::fs::create_dir_all(staging)?;

    let mut za = zip::ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|e| AppError::Backup(format!("备份包损坏: {}", e)))?;
    za.extract(staging)
        .map_err(|e| AppError::Backup(format!("解包失败: {}", e)))?;

    if !staging.join("data.db").exists() {
        return Err(AppError::Backup("备份包缺少数据库".to_string()));
    }
    let manifest_raw = std::fs::read(staging.join("manifest.json"))?;
    serde_json::from_slice(&manifest_raw).map_err(|e| AppError::Backup(format!("manifest 无效: {}", e)))
}

/// 只读回 manifest（列表展示用），不落盘
pub fn read_manifest(pkg_path: &Path, dek: &[u8]) -> Result<Manifest, AppError> {
    let zip_bytes = unpack(pkg_path, dek)?;
    let mut za = zip::ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|e| AppError::Backup(format!("备份包损坏: {}", e)))?;
    let mut buf = Vec::new();
    za.by_name("manifest.json")
        .map_err(|e| AppError::Backup(format!("备份包缺少 manifest: {}", e)))?
        .read_to_end(&mut buf)?;
    serde_json::from_slice(&buf).map_err(|e| AppError::Backup(format!("manifest 无效: {}", e)))
}

#[cfg(test)]
mod audit_tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("desko_audit_{}_{}", tag, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn manifest() -> Manifest {
        Manifest {
            app: "desko".to_string(),
            format: FORMAT_VERSION,
            created_at: 0,
            app_version: "t".to_string(),
            counts: Counts { notes: 0, entries: 0, attachments: 0 },
            files: vec![],
        }
    }

    fn make_pkg(dir: &Path, dek: &[u8], wrap: &Wrap, content: &[u8]) -> PathBuf {
        let dbf = dir.join("in.db");
        std::fs::write(&dbf, content).unwrap();
        let zip = build_zip(&dbf, &manifest(), None, &|_, _| {}).unwrap();
        let pkg = dir.join("x.dsbk");
        pack(&zip, &pkg, dek, wrap).unwrap();
        pkg
    }

    /// 密文被逐字节篡改、截断、只留头部，都必须拒绝（GCM 标签 + 长度自校验）
    #[test]
    fn tamper_truncate_and_short_header_all_rejected() {
        let dir = tmp("tamper");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw-audit").unwrap();
        let pkg = make_pkg(&dir, &dek, &wrap, b"top-secret-content-0123456789");
        let good = std::fs::read(&pkg).unwrap();

        for (label, bytes) in [
            ("末字节翻转", {
                let mut b = good.clone();
                let n = b.len() - 1;
                b[n] ^= 0x01;
                b
            }),
            ("首个密文字节翻转", {
                let mut b = good.clone();
                b[HEADER_LEN] ^= 0x01;
                b
            }),
            ("中段密文翻转", {
                let mut b = good.clone();
                let n = good.len() / 2;
                b[n] ^= 0x80;
                b
            }),
            ("data_nonce 被改", {
                let mut b = good.clone();
                b[OFF_DATA_NONCE] ^= 0xFF;
                b
            }),
            ("ct_len 谎报", {
                let mut b = good.clone();
                b[OFF_CT_LEN] = b[OFF_CT_LEN].wrapping_add(1);
                b
            }),
            ("尾部截断 3 字节", good[..good.len() - 3].to_vec()),
            ("只留头部", good[..HEADER_LEN].to_vec()),
            ("头部不完整", good[..40].to_vec()),
        ] {
            std::fs::write(&pkg, &bytes).unwrap();
            assert!(unpack(&pkg, &dek).is_err(), "{} 应当被拒绝", label);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 版本字节进了 AAD：改成 v2 后既过不了版本闸，也过不了标签校验
    #[test]
    fn version_byte_is_authenticated() {
        let dir = tmp("ver");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw-audit").unwrap();
        let pkg = make_pkg(&dir, &dek, &wrap, b"content");
        let good = std::fs::read(&pkg).unwrap();

        for v in [1u8, 2, 4, 255] {
            let mut b = good.clone();
            b[OFF_VER] = v;
            std::fs::write(&pkg, &b).unwrap();
            assert!(unpack(&pkg, &dek).is_err(), "版本 {} 不该被接受", v);
        }
        std::fs::write(&pkg, &good).unwrap();
        assert!(unpack(&pkg, &dek).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 换密码 = 只换头部 76 字节，密文原封不动，旧密码立刻失效、新密码可解
    #[test]
    fn rewrap_swaps_password_without_touching_ciphertext() {
        let dir = tmp("rewrap");
        let dek = crypto::random_bytes(DEK_LEN);
        let w1 = Wrap::seal(&dek, "old-backup-pw").unwrap();
        let pkg = make_pkg(&dir, &dek, &w1, b"payload-payload-payload");
        let before = std::fs::read(&pkg).unwrap();

        let w2 = Wrap::seal(&dek, "new-backup-pw").unwrap();
        rewrap(&pkg, &w2).unwrap();
        let after = std::fs::read(&pkg).unwrap();

        assert_eq!(before.len(), after.len(), "定长头部，文件不该变长");
        assert_eq!(
            &before[HEADER_LEN..],
            &after[HEADER_LEN..],
            "密文一个字节都不该动"
        );
        assert_ne!(&before[..HEADER_LEN], &after[..HEADER_LEN], "头部必须换掉");

        assert!(unpack_with_password(&pkg, "old-backup-pw").is_err(), "旧密码该失效");
        assert_eq!(unpack_with_password(&pkg, "new-backup-pw").unwrap(), unpack(&pkg, &dek).unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 把 A 包的头部嫁接给 B 包：解出的是 A 的密钥，B 的密文校验必炸
    #[test]
    fn header_swap_across_packages_fails() {
        let dir = tmp("swap");
        let dek_a = crypto::random_bytes(DEK_LEN);
        let dek_b = crypto::random_bytes(DEK_LEN);
        let wa = Wrap::seal(&dek_a, "pw-a").unwrap();
        let wb = Wrap::seal(&dek_b, "pw-b").unwrap();
        let a = make_pkg(&dir, &dek_a, &wa, b"aaa");
        let b = {
            let dbf = dir.join("in2.db");
            std::fs::write(&dbf, b"bbb").unwrap();
            let z = build_zip(&dbf, &manifest(), None, &|_, _| {}).unwrap();
            let p = dir.join("y.dsbk");
            pack(&z, &p, &dek_b, &wb).unwrap();
            p
        };

        let mut ra = std::fs::read(&a).unwrap();
        let rb = std::fs::read(&b).unwrap();
        ra[..HEADER_LEN].copy_from_slice(&rb[..HEADER_LEN]);
        let grafted = dir.join("grafted.dsbk");
        std::fs::write(&grafted, &ra).unwrap();

        assert!(unpack(&grafted, &dek_a).is_err(), "嫁接后原密钥解不开");
        assert!(unpack_with_password(&grafted, "pw-a").is_err(), "A 的密码也解不开");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 同一 DEK 连包多个文件：nonce 必须各不相同
    #[test]
    fn random_nonce_per_file_no_reuse() {
        let dir = tmp("nonce");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw-audit").unwrap();
        let a = make_pkg(&dir, &dek, &wrap, b"same-bytes-same-bytes");
        let src = dir.join("att.bin");
        std::fs::write(&src, b"same-bytes-same-bytes").unwrap();
        let b = dir.join("att.bin.enc");
        encrypt_file_to(&src, &b, &dek, &wrap).unwrap();

        let ra = std::fs::read(&a).unwrap();
        let rb = std::fs::read(&b).unwrap();
        assert_ne!(&ra[OFF_DATA_NONCE..OFF_CT_LEN], &rb[OFF_DATA_NONCE..OFF_CT_LEN]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 备份密码差一个字都取不出 DEK
    #[test]
    fn near_miss_password_fails() {
        let dir = tmp("pw");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "correct-horse-battery").unwrap();
        let pkg = make_pkg(&dir, &dek, &wrap, b"hush");
        for pw in ["correct-horse-batterx", "Correct-horse-battery", "correct-horse-batter", ""] {
            assert!(derive_dek(&pkg, pw).is_err(), "{} 不该取出密钥", pw);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 附件密文：篡改、张冠李戴都要挡住
    #[test]
    fn attachment_tamper_and_mismatch_detected() {
        let dir = tmp("att");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw-audit").unwrap();
        let src = dir.join("uuid9__a.png");
        std::fs::write(&src, b"original-image-bytes").unwrap();
        let enc = dir.join("uuid9__a.png.enc");
        encrypt_file_to(&src, &enc, &dek, &wrap).unwrap();
        let sha_ok = sha256_hex(b"original-image-bytes");

        let dst = dir.join("out/a.png");
        decrypt_file_to(&enc, &dst, &sha_ok, &dek).unwrap();
        assert_eq!(std::fs::read(&dst).unwrap(), b"original-image-bytes");

        let raw = std::fs::read(&enc).unwrap();
        let mut bad = raw.clone();
        let n = bad.len() - 1;
        bad[n] ^= 0x01;
        std::fs::write(&enc, &bad).unwrap();
        assert!(decrypt_file_to(&enc, &dst, &sha_ok, &dek).is_err(), "密文篡改必须失败");
        std::fs::write(&enc, &raw).unwrap();
        assert!(decrypt_file_to(&enc, &dst, &sha256_hex(b"other-file"), &dek).is_err(), "sha 不符必须失败");

        // 明文里不该留原图字节
        assert!(!raw.windows(6).any(|w| *w == b"origin"[..]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 实测：列目录要为每个包整体解密，量一下大包的开销
    #[test]
    #[ignore = "性能量测，手动跑：cargo test -- --ignored read_manifest_cost"]
    fn read_manifest_cost_on_big_package() {
        let dir = tmp("perf");
        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw-audit");
        let mut blob = Vec::with_capacity(25 * 1024 * 1024);
        while blob.len() < 25 * 1024 * 1024 {
            blob.extend_from_slice(&[7u8; 4096]);
        }
        let pkg = make_pkg(&dir, &dek, &wrap.unwrap(), &blob);
        let t = std::time::Instant::now();
        let n = 10;
        for _ in 0..n {
            read_manifest(&pkg, &dek).unwrap();
        }
        let ms = t.elapsed().as_millis() as f64 / n as f64;
        println!("read_manifest 单次（{} MB 包）: {:.1} ms", blob.len() / 1024 / 1024, ms);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_manifest() -> Manifest {
        Manifest {
            app: "desko".to_string(),
            format: FORMAT_VERSION,
            created_at: 1_700_000_000_000,
            app_version: "test".to_string(),
            counts: Counts { notes: 2, entries: 1, attachments: 1 },
            files: vec![FileEntry {
                name: "uuid1__pic.png".to_string(),
                size: 8,
                sha256: sha256_hex(b"png-bytes"),
            }],
        }
    }

    #[test]
    fn pack_roundtrip_and_wrong_key() {
        let dir = std::env::temp_dir().join(format!("desko_dsbk_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_file = dir.join("data.db");
        std::fs::write(&db_file, b"fake db bytes").unwrap();

        let dek = crypto::random_bytes(DEK_LEN);
        let wrap = Wrap::seal(&dek, "pw").unwrap();
        let zip_bytes = build_zip(&db_file, &sample_manifest(), None, &|_, _| {}).unwrap();
        let pkg = dir.join("out.dsbk");
        pack(&zip_bytes, &pkg, &dek, &wrap).unwrap();

        // 密文里不该出现任何明文痕迹
        let raw = std::fs::read(&pkg).unwrap();
        assert_eq!(&raw[..4], MAGIC);
        assert_eq!(raw[OFF_VER], FORMAT_VERSION);
        assert!(!raw.windows(9).any(|w| *w == b"fake db b"[..]));

        let staging = dir.join("staging");
        let back = unpack(&pkg, &dek).unwrap();
        let m = extract_to(&back, &staging).unwrap();
        assert_eq!(m.counts.notes, 2);
        assert_eq!(m.files.len(), 1);
        assert_eq!(std::fs::read(staging.join("data.db")).unwrap(), b"fake db bytes");

        let wrong = crypto::random_bytes(DEK_LEN);
        assert!(unpack(&pkg, &wrong).is_err());
        assert!(unpack_with_password(&pkg, "not-my-password").is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn wrap_roundtrips_through_meta_bytes() {
        let dek = crypto::random_bytes(DEK_LEN);
        let w = Wrap::seal(&dek, "pw").unwrap();
        let back = Wrap::from_bytes(&w.to_bytes()).unwrap();
        assert_eq!(w, back);
        assert_eq!(back.open("pw").unwrap(), dek);
    }
}
