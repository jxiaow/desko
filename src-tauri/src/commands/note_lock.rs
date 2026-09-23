//! 小记加密：全库共用一把「小记口令」。
//! 口令派生出域密钥 NDK，NDK 存两条封条——口令封条（日常解锁）与主密钥封条
//! （忘密兜底：应用会话已解锁时免输入取回）。每条小记仍各有一把随机 DEK，
//! 正文由 DEK 封进 cipher 列，DEK 由 NDK 封进 wrap_pass。
//! NDK 与解锁出来的 DEK 都只驻内存，应用锁定、锁屏、关窗即清。

use crate::crypto::{self, EncryptedData};
use crate::db::NoteLockRow;
use crate::error::AppError;
use crate::services::{self, note_service};
use crate::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use tauri::State;

const META_SALT: &str = "note_salt";
const META_WRAP: &str = "note_key_wrap";
const META_MASTER_WRAP: &str = "note_key_master_wrap";

fn lock_err<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::Database("lock error".to_string())
}

/// 域密钥是否设过、本会话是否已解开
#[derive(Serialize)]
pub struct NoteKeyStatus {
    pub is_set: bool,
    pub is_open: bool,
}

/// 一次解锁带回全部明文：一条小记对应一项
#[derive(Serialize)]
pub struct NotePlain {
    pub id: String,
    pub html: String,
}

/// 会话内已解锁的 DEK；取不到就说明这条还锁着
pub fn get_dek(state: &AppState, id: &str) -> Result<Vec<u8>, AppError> {
    let keys = state.note_keys.lock().map_err(lock_err)?;
    keys.get(id).cloned().ok_or_else(|| AppError::Database("小记未解锁".to_string()))
}

fn put_dek(state: &AppState, id: &str, dek: Vec<u8>) -> Result<(), AppError> {
    state.note_keys.lock().map_err(lock_err)?.insert(id.to_string(), dek);
    Ok(())
}

pub fn drop_dek(state: &AppState, id: &str) {
    if let Ok(mut keys) = state.note_keys.lock() {
        keys.remove(id);
    }
}

/// 应用锁定 / 锁屏 / 关窗：域密钥连同全部 DEK 一并收回
pub fn close_domain(state: &AppState) {
    if let Ok(mut key) = state.note_key.lock() {
        *key = None;
    }
    if let Ok(mut keys) = state.note_keys.lock() {
        keys.clear();
    }
}

fn get_note_key(state: &AppState) -> Result<Vec<u8>, AppError> {
    let key = state.note_key.lock().map_err(lock_err)?;
    key.clone().ok_or_else(|| AppError::Database("请先输入小记口令".to_string()))
}

fn decode_wrap(b64_json: &str) -> Result<EncryptedData, AppError> {
    serde_json::from_str(b64_json).map_err(|e| AppError::Crypto(e.to_string()))
}

fn unwrap_dek(wrap: &EncryptedData, key: &[u8]) -> Result<Vec<u8>, AppError> {
    // GCM 校验失败即密码不对，不区分"数据坏了"，避免给探测者反馈
    let dek_b64 = crypto::decrypt_password(wrap, key).map_err(|_| AppError::WrongPassword)?;
    BASE64.decode(&dek_b64).map_err(|e| AppError::Crypto(e.to_string()))
}

/// 把一份密钥用 key 封成入库用的 JSON 字符串
fn seal(secret: &[u8], key: &[u8]) -> Result<String, AppError> {
    let wrapped = crypto::encrypt_password(&BASE64.encode(secret), key)?;
    serde_json::to_string(&wrapped).map_err(|e| AppError::Crypto(e.to_string()))
}

fn open_wrap(wrap: &str, key: &[u8]) -> Result<Vec<u8>, AppError> {
    unwrap_dek(&decode_wrap(wrap)?, key)
}

fn read_cipher(lock: &NoteLockRow, dek: &[u8]) -> Result<String, AppError> {
    crypto::decrypt_password(
        &EncryptedData { ciphertext: lock.cipher.clone(), iv: lock.cipher_iv.clone() },
        dek,
    )
}

fn read_domain(db: &crate::db::Database) -> Result<(String, String, String), AppError> {
    let salt = db.get_meta(META_SALT)?.ok_or_else(|| AppError::Database("还没设过小记口令".to_string()))?;
    let wrap = db.get_meta(META_WRAP)?.ok_or_else(|| AppError::Database("还没设过小记口令".to_string()))?;
    let master_wrap = db.get_meta(META_MASTER_WRAP)?
        .ok_or_else(|| AppError::Database("小记口令的主密钥封条缺失".to_string()))?;
    Ok((salt, wrap, master_wrap))
}

/// 一次改封的全部产出：域封条要写的 meta、逐行新 DEK 封条、内存里的 DEK、带回前端的明文
pub(crate) struct DomainSetup {
    pub ndk: Vec<u8>,
    pub meta: Vec<(&'static str, String)>,
    pub resealed: Vec<(String, String)>,
    pub deks: Vec<(String, Vec<u8>)>,
    pub plains: Vec<NotePlain>,
}

/// NDK 在手：逐条解出 DEK 与明文。个别封条对不上（历史坏数据）就跳过，不连累其余小记
pub(crate) fn open_seals(
    rows: &[(String, NoteLockRow)],
    ndk: &[u8],
) -> (Vec<(String, Vec<u8>)>, Vec<NotePlain>) {
    let mut deks = Vec::with_capacity(rows.len());
    let mut plains = Vec::with_capacity(rows.len());
    for (id, lock) in rows {
        let Ok(dek) = open_wrap(&lock.wrap_pass, ndk) else { continue };
        let Ok(html) = read_cipher(lock, &dek) else { continue };
        deks.push((id.clone(), dek.clone()));
        plains.push(NotePlain { id: id.clone(), html });
    }
    (deks, plains)
}

/// 新口令 + 主密钥 → 域密钥与一整套待落库数据（域封条、逐条新封条、DEK、明文）。
/// 旧封条必须条条解得开才返回：改封半途失败会留下一堆谁也解不开的密文，所以先算完再写库
pub(crate) fn build_domain(
    rows: &[(String, NoteLockRow)],
    master_key: &[u8],
    passphrase: &str,
) -> Result<DomainSetup, AppError> {
    let ndk = crypto::random_bytes(crypto::KEY_LENGTH);
    let salt = crypto::generate_salt();
    let kpass = crypto::derive_key(passphrase, &salt);

    let mut resealed: Vec<(String, String)> = Vec::with_capacity(rows.len());
    let mut deks: Vec<(String, Vec<u8>)> = Vec::with_capacity(rows.len());
    let mut plains: Vec<NotePlain> = Vec::with_capacity(rows.len());
    for (id, lock) in rows {
        let dek = open_wrap(&lock.wrap_master, &crypto::note_wrap_key(master_key, id)).map_err(|_| {
            AppError::Database(format!("小记 {} 的旧封条解不开，先解除它的加密再设口令", id))
        })?;
        resealed.push((id.clone(), seal(&dek, &ndk)?));
        deks.push((id.clone(), dek.clone()));
        plains.push(NotePlain { id: id.clone(), html: read_cipher(lock, &dek)? });
    }

    let meta = vec![
        (META_SALT, BASE64.encode(&salt)),
        (META_WRAP, seal(&ndk, &kpass)?),
        (META_MASTER_WRAP, seal(&ndk, &crypto::note_domain_key(master_key))?),
    ];
    Ok(DomainSetup { ndk, meta, resealed, deks, plains })
}

#[tauri::command]
pub fn note_key_status(state: State<AppState>) -> Result<NoteKeyStatus, AppError> {
    let is_set = {
        let db = state.db.lock().map_err(lock_err)?;
        db.get_meta(META_WRAP)?.is_some()
    };
    let is_open = state.note_key.lock().map_err(lock_err)?.is_some();
    Ok(NoteKeyStatus { is_set, is_open })
}

/// 首次设口令：建 NDK、写下两条域封条，并把旧模型（每条一把口令）的封条一次改封
#[tauri::command]
pub fn note_key_setup(state: State<AppState>, passphrase: String) -> Result<Vec<NotePlain>, AppError> {
    if passphrase.is_empty() {
        return Err(AppError::Database("小记口令不能为空".to_string()));
    }
    let master_key = services::get_master_key(&state)?;

    let db = state.db.lock().map_err(lock_err)?;
    if db.get_meta(META_WRAP)?.is_some() {
        return Err(AppError::Database("小记口令已经设过".to_string()));
    }
    let rows = db.list_note_locks()?;
    let plan = build_domain(&rows, &master_key, &passphrase)?;
    let meta_refs: Vec<(&str, &str)> = plan.meta.iter().map(|(k, v)| (*k, v.as_str())).collect();
    db.apply_note_domain(&meta_refs, &plan.resealed)?;
    drop(db);

    for (id, dek) in plan.deks {
        put_dek(&state, &id, dek)?;
    }
    *state.note_key.lock().map_err(lock_err)? = Some(plan.ndk);
    Ok(plan.plains)
}

/// 日常解锁：口令换回 NDK，全库一次开
#[tauri::command]
pub fn note_key_unlock(state: State<AppState>, passphrase: String) -> Result<Vec<NotePlain>, AppError> {
    let (salt_b64, wrap, _) = {
        let db = state.db.lock().map_err(lock_err)?;
        read_domain(&db)?
    };
    let salt = BASE64.decode(&salt_b64).map_err(|e| AppError::Crypto(e.to_string()))?;
    let ndk = open_wrap(&wrap, &crypto::derive_key(&passphrase, &salt))?;
    open_into_state(&state, &ndk)
}

/// 兜底路径：会话已解锁就免输入，用主密钥封条取回 NDK
#[tauri::command]
pub fn note_key_recover(state: State<AppState>) -> Result<Vec<NotePlain>, AppError> {
    let master_key = services::get_master_key(&state)?;
    let (_, _, master_wrap) = {
        let db = state.db.lock().map_err(lock_err)?;
        read_domain(&db)?
    };
    let ndk = open_wrap(&master_wrap, &crypto::note_domain_key(&master_key))?;
    open_into_state(&state, &ndk)
}

/// NDK 到手：把全库 DEK 与明文收进内存，域状态标记为已开
fn open_into_state(state: &AppState, ndk: &[u8]) -> Result<Vec<NotePlain>, AppError> {
    let rows = {
        let db = state.db.lock().map_err(lock_err)?;
        db.list_note_locks()?
    };
    let (deks, plains) = open_seals(&rows, ndk);
    for (id, dek) in deks {
        put_dek(state, &id, dek)?;
    }
    *state.note_key.lock().map_err(lock_err)? = Some(ndk.to_vec());
    Ok(plains)
}

/// 锁回全库：内存里的 NDK 与 DEK 一律收回，库里的密文不动
#[tauri::command]
pub fn note_key_relock(state: State<AppState>) -> Result<(), AppError> {
    close_domain(&state);
    Ok(())
}

/// 改口令：只改 NDK 的口令封条，小记密文一条都不用动
#[tauri::command]
pub fn note_key_change(state: State<AppState>, passphrase: String) -> Result<(), AppError> {
    if passphrase.is_empty() {
        return Err(AppError::Database("小记口令不能为空".to_string()));
    }
    let ndk = get_note_key(&state)?;
    let salt = crypto::generate_salt();
    let kpass = crypto::derive_key(&passphrase, &salt);
    let db = state.db.lock().map_err(lock_err)?;
    if db.get_meta(META_WRAP)?.is_none() {
        return Err(AppError::Database("还没设过小记口令".to_string()));
    }
    db.set_meta(META_SALT, &BASE64.encode(&salt))?;
    db.set_meta(META_WRAP, &seal(&ndk, &kpass)?)?;
    Ok(())
}

/// 上锁：随机 DEK 封正文，DEK 再由 NDK 封一道
#[tauri::command]
pub fn lock_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    let ndk = get_note_key(&state)?;
    let db = state.db.lock().map_err(lock_err)?;
    let note = db.get_note(&id)?.ok_or(AppError::EntryNotFound)?;
    if note.encrypted {
        return Err(AppError::Database("这条小记已加密".to_string()));
    }
    if note.content_html.is_empty() {
        return Err(AppError::Database("空内容不用加密".to_string()));
    }

    let dek = crypto::random_bytes(crypto::KEY_LENGTH);
    let enc = crypto::encrypt_password(&note.content_html, &dek)?;
    let now = chrono::Utc::now().timestamp_millis();
    db.set_note_lock(&id, &enc.ciphertext, &enc.iv, &seal(&dek, &ndk)?, now)?;
    drop(db);
    put_dek(&state, &id, dek)?; // 刚锁完让人继续看，重锁走 relock_note
    Ok(())
}

/// 单条再开：域已开就免口令（口令只需输一次）
#[tauri::command]
pub fn unlock_note(state: State<AppState>, id: String) -> Result<String, AppError> {
    let lock = {
        let db = state.db.lock().map_err(lock_err)?;
        db.get_note_lock(&id)?.ok_or_else(|| AppError::Database("这条小记没有加密".to_string()))?
    };
    if let Ok(dek) = get_dek(&state, &id) {
        return read_cipher(&lock, &dek);
    }
    let ndk = get_note_key(&state)?;
    let dek = open_wrap(&lock.wrap_pass, &ndk)?;
    put_dek(&state, &id, dek.clone())?;
    read_cipher(&lock, &dek)
}

#[tauri::command]
pub fn relock_note(state: State<AppState>, id: String) -> Result<(), AppError> {
    drop_dek(&state, &id);
    Ok(())
}

/// 解除加密：要求已解锁（拿得到 DEK），明文随 input 写回普通列
#[tauri::command]
pub fn remove_note_lock(
    state: State<AppState>,
    id: String,
    input: crate::db::UpdateNoteInput,
) -> Result<(), AppError> {
    let _key = services::get_master_key(&state)?;
    let dek = get_dek(&state, &id)?;
    // 先验一把：DEK 必须真能解开当前密文，防止半路改坏
    {
        let db = state.db.lock().map_err(lock_err)?;
        if let Some(lock) = db.get_note_lock(&id)? {
            read_cipher(&lock, &dek)?;
        }
        db.clear_note_lock(&id)?;
        note_service::update_note(&db, &id, input)?;
    }
    drop_dek(&state, &id);
    Ok(())
}

/// 刷新后找回会话内已解锁的正文
#[tauri::command]
pub fn reveal_note(state: State<AppState>, id: String) -> Result<String, AppError> {
    let dek = get_dek(&state, &id)?;
    let db = state.db.lock().map_err(lock_err)?;
    let lock = db.get_note_lock(&id)?.ok_or_else(|| AppError::Database("这条小记没有加密".to_string()))?;
    read_cipher(&lock, &dek)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 旧逐条模型的一条加密小记：正文用 DEK 封进 cipher，DEK 由主密钥 + note id 封进 wrap_master
    fn legacy_row(id: &str, master_key: &[u8], html: &str) -> (String, NoteLockRow) {
        let dek = crypto::random_bytes(crypto::KEY_LENGTH);
        let enc = crypto::encrypt_password(html, &dek).unwrap();
        let wrap_master = serde_json::to_string(
            &crypto::encrypt_password(&BASE64.encode(&dek), &crypto::note_wrap_key(master_key, id)).unwrap(),
        )
        .unwrap();
        (
            id.to_string(),
            NoteLockRow {
                cipher: enc.ciphertext,
                cipher_iv: enc.iv,
                wrap_pass: String::new(),
                pass_salt: "old-salt".to_string(),
                wrap_master,
            },
        )
    }

    /// 改封落库后的行：域封条在 wrap_pass，遗留列清空（对齐 apply_note_domain 的写法）
    fn resealed_row(row: &(String, NoteLockRow), plan: &DomainSetup) -> (String, NoteLockRow) {
        let (id, base) = row;
        let (_, wrap_pass) = plan.resealed.iter().find(|(rid, _)| rid == id).unwrap();
        (
            id.clone(),
            NoteLockRow {
                cipher: base.cipher.clone(),
                cipher_iv: base.cipher_iv.clone(),
                wrap_pass: wrap_pass.clone(),
                pass_salt: String::new(),
                wrap_master: String::new(),
            },
        )
    }

    fn meta_of(plan: &DomainSetup, key: &str) -> String {
        plan.meta.iter().find(|(k, _)| *k == key).unwrap().1.clone()
    }

    #[test]
    fn domain_migration_unlocks_every_legacy_note() {
        let mk = crypto::random_bytes(crypto::KEY_LENGTH);
        let rows = vec![
            legacy_row("n1", &mk, "<p>第一条</p>"),
            legacy_row("n2", &mk, "<p>第二条</p>"),
        ];
        let plan = build_domain(&rows, &mk, "note-pw-1234").unwrap();
        assert_eq!(plan.plains.len(), 2);
        assert_eq!(plan.plains[0].html, "<p>第一条</p>");
        assert!(!meta_of(&plan, META_SALT).is_empty());

        // 日常解锁：口令 → NDK → 全库明文
        let salt = BASE64.decode(meta_of(&plan, META_SALT)).unwrap();
        let ndk = open_wrap(&meta_of(&plan, META_WRAP), &crypto::derive_key("note-pw-1234", &salt)).unwrap();
        assert_eq!(ndk, plan.ndk);
        let resealed: Vec<_> = rows.iter().map(|r| resealed_row(r, &plan)).collect();
        let (deks, plains) = open_seals(&resealed, &ndk);
        assert_eq!(deks.len(), 2);
        assert_eq!(
            plains.iter().map(|p| p.html.clone()).collect::<Vec<_>>(),
            vec!["<p>第一条</p>", "<p>第二条</p>"]
        );

        // 兜底解锁：主密钥封条取回同一把 NDK
        let ndk2 = open_wrap(&meta_of(&plan, META_MASTER_WRAP), &crypto::note_domain_key(&mk)).unwrap();
        assert_eq!(ndk2, plan.ndk);
    }

    #[test]
    fn wrong_passphrase_and_foreign_master_key_both_fail() {
        let mk = crypto::random_bytes(crypto::KEY_LENGTH);
        let rows = vec![legacy_row("n1", &mk, "<p>正文</p>")];
        let plan = build_domain(&rows, &mk, "note-pw-1234").unwrap();
        let salt = BASE64.decode(meta_of(&plan, META_SALT)).unwrap();
        assert!(matches!(
            open_wrap(&meta_of(&plan, META_WRAP), &crypto::derive_key("猜的口令", &salt)),
            Err(AppError::WrongPassword)
        ));
        // 换一把主密钥（改过主密码却没换封条）就兜不回来
        let other = crypto::random_bytes(crypto::KEY_LENGTH);
        assert!(open_wrap(&meta_of(&plan, META_MASTER_WRAP), &crypto::note_domain_key(&other)).is_err());
    }

    #[test]
    fn build_domain_refuses_when_a_legacy_seal_cannot_open() {
        let mk = crypto::random_bytes(crypto::KEY_LENGTH);
        let other = crypto::random_bytes(crypto::KEY_LENGTH);
        let rows = vec![legacy_row("n1", &mk, "<p>好数据</p>"), legacy_row("n2", &other, "<p>坏封条</p>")];
        // 一条解不开就整体报错：调用方还没写库，库里因此不会留下半迁移状态
        assert!(matches!(build_domain(&rows, &mk, "note-pw-1234"), Err(AppError::Database(_))));
    }

    #[test]
    fn open_seals_skips_a_broken_row_without_losing_the_rest() {
        let mk = crypto::random_bytes(crypto::KEY_LENGTH);
        let rows = vec![legacy_row("n1", &mk, "<p>甲</p>"), legacy_row("n2", &mk, "<p>乙</p>")];
        let plan = build_domain(&rows, &mk, "note-pw-1234").unwrap();
        let mut resealed: Vec<_> = rows.iter().map(|r| resealed_row(r, &plan)).collect();
        resealed[1].1.wrap_pass = "不是合法封条".to_string();
        let (deks, plains) = open_seals(&resealed, &plan.ndk);
        assert_eq!(deks.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(), vec!["n1"]);
        assert_eq!(plains.len(), 1);
        assert_eq!(plains[0].html, "<p>甲</p>");
    }

    #[test]
    fn changing_the_passphrase_reseals_only_the_domain_wrap() {
        let mk = crypto::random_bytes(crypto::KEY_LENGTH);
        let rows = vec![legacy_row("n1", &mk, "<p>正文</p>")];
        let plan = build_domain(&rows, &mk, "旧口令-12345678").unwrap();
        let resealed = resealed_row(&rows[0], &plan);

        // note_key_change 的全部动作：换新 salt + 用新口令重封同一把 NDK
        let salt2 = crypto::generate_salt();
        let wrap2 = seal(&plan.ndk, &crypto::derive_key("新口令-abcdefgh", &salt2)).unwrap();
        let ndk2 = open_wrap(&wrap2, &crypto::derive_key("新口令-abcdefgh", &salt2)).unwrap();
        assert_eq!(ndk2, plan.ndk, "小记密文与逐条封条一个字节都不用动");
        let (_, plains) = open_seals(&[resealed], &ndk2);
        assert_eq!(plains[0].html, "<p>正文</p>");
    }
}
