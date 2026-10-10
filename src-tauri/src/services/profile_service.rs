//! 档案注册表与启动解析（多档案方案 D4/D7/D8）。
//!
//! 职责：定位「当前该开哪个档案」。F1 只做地基 —— 把老布局一次性搬进 `default` 档案、
//! 建注册表 `profiles.json`、返回当前档案根。建档/改名/删档/切换留到 F2。
//!
//! `boot()` 是纯逻辑：不碰 `paths` 全局（进程级副作用留给 `main.rs` 接线），
//! 以便用临时目录跑真迁移而不污染并行单测。
//!
//! 迁移是「搬家」不是「兼容 shim」：全程同目录 `rename`（同卷原子），无数据变换，
//! 搬完只存在档案布局一种形态。断电可幂等重跑；想降级照 `migration-manifest.json` 逆向 rename 复原。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};

/// 注册表读-改-写的互斥锁：Tauri 命令跑在不同线程，create/rename/delete/switch 的
/// load→改→write 必须整体串行，否则丢写会留下脱管目录或错置的 active。
/// 锁内没有跨调用可脏的状态，中毒后照常续用。
fn registry_lock() -> MutexGuard<'static, ()> {
    static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    GUARD
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub id: String,
    pub name: String,
    #[serde(alias = "cloud_ns")]
    pub cloud_ns: String,
    #[serde(alias = "created_at")]
    pub created_at: i64,
    #[serde(alias = "last_used_at")]
    pub last_used_at: i64,
}

#[derive(Serialize, Deserialize)]
pub struct Registry {
    pub active: String,
    pub profiles: Vec<ProfileMeta>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Move {
    pub from: String,
    pub to: String,
}

/// 迁移留痕，仅供降级逆向（纯 rename 可复原，不复制皇冠数据）。
/// `rebuilt_dirs`：迁移中删掉的父目录，逆向 rename 前先重建，否则搬回附件会撞缺父目录。
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub moves: Vec<Move>,
    #[serde(default, alias = "rebuilt_dirs")]
    pub rebuilt_dirs: Vec<String>,
}

pub struct Booted {
    pub root: PathBuf,
    pub cloud_base: String,
}

const DEFAULT_ID: &str = "default";
const DEFAULT_NAME: &str = "默认";

fn profiles_base(app_root: &Path) -> PathBuf {
    app_root.join("profiles")
}

pub fn profile_dir(app_root: &Path, id: &str) -> PathBuf {
    profiles_base(app_root).join(id)
}

fn registry_path(app_root: &Path) -> PathBuf {
    app_root.join("profiles.json")
}

fn manifest_path(app_root: &Path) -> PathBuf {
    app_root.join("migration-manifest.json")
}

/// 云命名空间基名：default（ns 空）→ `desko`（既有云目录原地可续），其余 → `desko-<ns>`。
pub fn base_for(ns: &str) -> String {
    if ns.is_empty() {
        "desko".to_string()
    } else {
        format!("desko-{}", ns)
    }
}

/// 校验显示名：去空白后非空、≤ 32 字符（按字素粗略按 char 计，够挡超长粘贴）。
fn valid_name(name: &str) -> Result<(), String> {
    let t = name.trim();
    if t.is_empty() {
        return Err("档案名不能为空".to_string());
    }
    if t.chars().count() > 32 {
        return Err("档案名最多 32 个字符".to_string());
    }
    Ok(())
}

/// 校验云命名空间：字符集 `[a-z0-9-]`、1–32 长。default 的空 ns 不在此校验（建档走 auto）。
fn valid_ns(ns: &str) -> Result<(), String> {
    if ns.is_empty() || ns.len() > 32 {
        return Err("云命名空间需为 1–32 个字符".to_string());
    }
    if !ns.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err("云命名空间只能用小写字母、数字和连字符".to_string());
    }
    Ok(())
}

/// 生成档案 id：`p-` + uuid 前 8 位十六进制，天然是 `[a-z0-9-]`，可直接当目录名。
fn gen_id() -> String {
    let u = uuid::Uuid::new_v4().simple().to_string();
    format!("p-{}", &u[..8])
}

fn write_registry(app_root: &Path, reg: &Registry) -> Result<(), String> {
    write_json(&registry_path(app_root), reg)
}

/// 载入注册表；不存在或损坏时早返 Err（调用方应先 boot 过，注册表必在）。
pub fn load_registry_checked(app_root: &Path) -> Result<Registry, String> {
    let text = fs::read_to_string(registry_path(app_root))
        .map_err(|e| format!("读取档案注册表失败: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("档案注册表损坏: {e}"))
}

/// 新建档案：校验名字/ns → 生成唯一 id → 建目录 → 追加注册表。ns 省略时取 id（保证同机唯一）。
pub fn create(app_root: &Path, name: &str, cloud_ns: Option<&str>) -> Result<ProfileMeta, String> {
    let _lock = registry_lock();
    valid_name(name)?;
    let mut reg = load_registry_checked(app_root)?;

    let id = loop {
        let candidate = gen_id();
        if !reg.profiles.iter().any(|p| p.id == candidate) {
            break candidate;
        }
    };

    // ns：调用方没给就用 id 兜底（id 唯一且字符集合法）；给了则校验+同机查重。
    let ns = match cloud_ns.map(str::trim).filter(|s| !s.is_empty()) {
        Some(explicit) => {
            valid_ns(explicit)?;
            if reg.profiles.iter().any(|p| p.cloud_ns == explicit) {
                return Err(format!("云命名空间「{explicit}」已被其他档案占用"));
            }
            explicit.to_string()
        }
        None => id.clone(),
    };

    let dir = profile_dir(app_root, &id);
    fs::create_dir_all(&dir).map_err(|e| format!("建档案目录失败: {e}"))?;

    let ts = now_ms();
    let meta = ProfileMeta {
        id: id.clone(),
        name: name.trim().to_string(),
        cloud_ns: ns,
        created_at: ts,
        last_used_at: ts,
    };
    reg.profiles.push(meta.clone());
    write_registry(app_root, &reg)?;
    Ok(meta)
}

/// 改名：只动显示名，不碰 id/目录。active 档案同样可改，纯元数据。
pub fn rename(app_root: &Path, id: &str, new_name: &str) -> Result<(), String> {
    let _lock = registry_lock();
    valid_name(new_name)?;
    let mut reg = load_registry_checked(app_root)?;
    let target = reg
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "档案不存在".to_string())?;
    target.name = new_name.trim().to_string();
    write_registry(app_root, &reg)
}

/// 删档：拒唯一档案、拒 active；通过后删目录再删注册表项。
/// 目录删除有护栏 —— 必须落在 profiles 基目录下且不等于基目录本身。
pub fn delete(app_root: &Path, id: &str) -> Result<(), String> {
    let _lock = registry_lock();
    valid_id(id)?;
    let mut reg = load_registry_checked(app_root)?;
    if reg.profiles.len() <= 1 {
        return Err("至少保留一个档案，无法删除最后一个".to_string());
    }
    if reg.active == id {
        return Err("不能删除当前使用的档案，请先切换到其他档案".to_string());
    }
    let idx = reg
        .profiles
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "档案不存在".to_string())?;

    let dir = profile_dir(app_root, id);
    let base = profiles_base(app_root);
    if dir == base {
        return Err("非法档案目录".to_string());
    }
    let under_base = dir.starts_with(&base) && dir != base;
    if !under_base {
        return Err("非法档案目录".to_string());
    }
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("删除档案目录失败: {e}"))?;
    }

    reg.profiles.remove(idx);
    write_registry(app_root, &reg)
}

/// 切换：写 active + 刷新 last_used_at。真正的根切换靠调用方随后 `app.restart()`（D3）。
/// 未知 id 报错；切到当前 active 视为 no-op 但仍返回 Ok（前端可据此统一重启）。
pub fn switch(app_root: &Path, id: &str) -> Result<(), String> {
    let _lock = registry_lock();
    valid_id(id)?;
    let mut reg = load_registry_checked(app_root)?;
    let target = reg
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| "档案不存在".to_string())?;
    target.last_used_at = now_ms();
    reg.active = id.to_string();
    write_registry(app_root, &reg)
}

/// 列出所有档案（按 id 原序）+ 当前 active id，供前端渲染。
pub fn list(app_root: &Path) -> Result<(Vec<ProfileMeta>, String), String> {
    let reg = load_registry_checked(app_root)?;
    Ok((reg.profiles, reg.active))
}

/// 取当前 active 档案元数据。
pub fn active(app_root: &Path) -> Result<Option<ProfileMeta>, String> {
    let reg = load_registry_checked(app_root)?;
    Ok(pick_active(&reg).cloned())
}

/// 老的硬编码旁根 `%APPDATA%\desko`（附件/图标/共享所在）。
pub fn legacy_desko_root() -> PathBuf {
    let root = std::env::var("APPDATA")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    Path::new(&root).join("desko")
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 解析并搬迁出当前档案根，返回 `Booted`（纯逻辑，不写 `paths` 全局）。
/// `main.rs` 拿返回值去 `paths::init`，再进 `Database::new`。
/// `env_root` = 老的 `%APPDATA%\desko` 旁根，抽成参数以便单测用临时目录跑真迁移。
pub fn boot(app_root: &Path, env_root: &Path) -> Result<Booted, String> {
    fs::create_dir_all(app_root).map_err(|e| format!("建应用根失败: {e}"))?;
    fs::create_dir_all(profiles_base(app_root)).map_err(|e| format!("建 profiles 目录失败: {e}"))?;

    // 已有注册表 → 直接用（幂等，跳过迁移）；不存在才走迁移建 default
    let _lock = registry_lock();
    if registry_path(app_root).exists() {
        let reg = load_registry_checked(app_root)?;
        let active = pick_active(&reg)
            .ok_or_else(|| "档案注册表里没有任何档案（profiles.json 可能被意外清空），为避免覆盖既有档案目录，请手工修复后再启动".to_string())?;
        valid_id(&active.id)?;
        return Ok(Booted {
            root: profile_dir(app_root, &active.id),
            cloud_base: base_for(&active.cloud_ns),
        });
    }

    // 否则：迁移老布局（若有）或全新安装 → 建 default
    let default = profile_dir(app_root, DEFAULT_ID);
    fs::create_dir_all(&default).map_err(|e| format!("建 default 档案失败: {e}"))?;

    let moves = migrate_legacy(app_root, &default, env_root)?;
    // 搬空后尝试删除老旁根；非空（有未知残留）则留着不动。删除动作也记进 manifest，
    // 逆向时先重建父目录再 rename 搬回。
    let mut rebuilt_dirs = Vec::new();
    if env_root.exists() && fs::remove_dir(env_root).is_ok() {
        rebuilt_dirs.push(env_root.to_string_lossy().into_owned());
    }
    write_manifest(app_root, &moves, &rebuilt_dirs)?;
    write_default_registry(app_root)?;

    Ok(Booted {
        root: default,
        cloud_base: base_for(""),
    })
}

/// 档案 id 格式闸：`default` 或 `p-` + 8 位小写十六进制。
/// boot/switch 拿到的是文件里的 id，拼目录前必须过这道，拒绝手改文件塞 `../` 越界。
fn valid_id(id: &str) -> Result<(), String> {
    if id == DEFAULT_ID {
        return Ok(());
    }
    let hex = id
        .strip_prefix("p-")
        .ok_or_else(|| format!("非法档案 id：{id}"))?;
    if hex.len() == 8 && hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        Ok(())
    } else {
        Err(format!("非法档案 id：{id}"))
    }
}

fn pick_active(reg: &Registry) -> Option<&ProfileMeta> {
    reg.profiles
        .iter()
        .find(|p| p.id == reg.active)
        .or_else(|| reg.profiles.first())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value).map_err(|e| format!("序列化失败: {e}"))?;
    // 原子写：先 .tmp 再 rename，避免写一半掉电留下坏注册表
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("写 {path:?} 失败: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("落位 {path:?} 失败: {e}"))
}

fn write_default_registry(app_root: &Path) -> Result<(), String> {
    let ts = now_ms();
    let reg = Registry {
        active: DEFAULT_ID.to_string(),
        profiles: vec![ProfileMeta {
            id: DEFAULT_ID.to_string(),
            name: DEFAULT_NAME.to_string(),
            cloud_ns: String::new(),
            created_at: ts,
            last_used_at: ts,
        }],
    };
    write_json(&registry_path(app_root), &reg)
}

/// 写迁移留痕。已有 manifest 时按 to 去重合并而非覆盖 —— 上次搬家中途断电、
/// 留痕没写成，这次重跑要把两截账拼齐，否则降级逆向会丢一半。
fn write_manifest(app_root: &Path, moves: &[Move], rebuilt_dirs: &[String]) -> Result<(), String> {
    let mut merged = Manifest { moves: Vec::new(), rebuilt_dirs: Vec::new() };
    if let Ok(text) = fs::read_to_string(manifest_path(app_root)) {
        if let Ok(old) = serde_json::from_str::<Manifest>(&text) {
            merged = old;
        }
    }
    for m in moves {
        if !merged.moves.iter().any(|e| e.to == m.to) {
            merged.moves.push(m.clone());
        }
    }
    for d in rebuilt_dirs {
        if !merged.rebuilt_dirs.iter().any(|e| e == d) {
            merged.rebuilt_dirs.push(d.clone());
        }
    }
    write_json(&manifest_path(app_root), &merged)
}

/// 把老布局的各项同卷 rename 进 default 档案。目标已存在视为已搬（幂等），跳过。
/// 返回搬动清单供降级逆向。全程失败即早返 Err —— 注册表尚未落位，下次启动重跑。
fn migrate_legacy(app_root: &Path, default: &Path, env_root: &Path) -> Result<Vec<Move>, String> {
    let mut moves: Vec<Move> = Vec::new();

    // app 根直属项（Tauri app_data_dir 那一支）。.swap 是恢复中途断电的残留：
    // 漏搬会把真数据孤儿在应用根、新档案开出空库。
    for name in [
        "data.db",
        "data.db-wal",
        "data.db-shm",
        "data.db.swap",
        "attachments.swap",
        "backups",
        "restore-staging",
        "fileshare.json",
        "fileshare.status.json",
    ] {
        move_into(app_root.join(name), default.join(name), &mut moves)?;
    }
    // 硬编码旁根 `%APPDATA%\desko` 那一支
    for name in ["attachments", "favicons", "shared"] {
        move_into(env_root.join(name), default.join(name), &mut moves)?;
    }

    rewrite_fileshare_share_dirs(&default.join("fileshare.json"), env_root)?;
    Ok(moves)
}

fn move_into(from: PathBuf, to: PathBuf, moves: &mut Vec<Move>) -> Result<(), String> {
    if to.exists() {
        // 目标已存在：源没了＝上次已搬走，把这笔账补记进 manifest（上次没留成痕）；
        // 源也在＝目标处本就有同名项，源留在原地不动、不记。
        if !from.exists() {
            moves.push(Move {
                from: from.to_string_lossy().into_owned(),
                to: to.to_string_lossy().into_owned(),
            });
        }
        return Ok(());
    }
    if !from.exists() {
        return Ok(());
    }
    fs::rename(&from, &to).map_err(|e| format!("迁移 {:?} → {:?} 失败: {e}", from, to))?;
    moves.push(Move {
        from: from.to_string_lossy().into_owned(),
        to: to.to_string_lossy().into_owned(),
    });
    Ok(())
}

/// R5：`fileshare.json` 里的默认共享目录曾存成老旁根 `shared` 的绝对路径。
/// 档案化后 fileshare 配置以档案根为 base（`ShareConfig` 用 camelCase，键名是 `shareDirs`；
/// 相对项由 `normalize_share_dirs` 钉到配置父目录=档案根），
/// 所以把指向老旁根 `shared` 的条目改成相对锚点 `"shared"`，之后天然随档案走。
/// 解析失败或无该项则原样不动。Windows 路径大小写不敏感，比较前统一转小写。
fn rewrite_fileshare_share_dirs(cfg_path: &Path, env_root: &Path) -> Result<(), String> {
    let text = match fs::read_to_string(cfg_path) {
        Ok(t) => t,
        Err(_) => return Ok(()), // 没配过局域网传输，跳过
    };
    let mut val: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let old_shared = env_root.join("shared").to_string_lossy().replace('\\', "/").to_lowercase();
    let mut changed = false;
    if let Some(arr) = val.get_mut("shareDirs").and_then(|d| d.as_array_mut()) {
        for item in arr.iter_mut() {
            if let Some(s) = item.as_str() {
                let norm = s.replace('\\', "/").to_lowercase();
                if norm == old_shared || norm.starts_with(&format!("{old_shared}/")) {
                    *item = serde_json::Value::String("shared".to_string());
                    changed = true;
                }
            }
        }
    }
    if changed {
        write_json(cfg_path, &val)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("desko_prof_{}_{}", tag, uuid::Uuid::new_v4()))
    }

    fn touch(path: &Path, content: &str) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    /// 全新安装：没有老布局也没注册表 → 建 default + 注册表，cloud_base 为 desko
    #[test]
    fn fresh_install_creates_empty_default() {
        let app_root = tmp("fresh");
        let env_root = tmp("fresh_env"); // 不存在
        let b = boot(&app_root, &env_root).unwrap();

        assert_eq!(b.root, profile_dir(&app_root, DEFAULT_ID));
        assert_eq!(b.cloud_base, "desko");
        assert!(profile_dir(&app_root, DEFAULT_ID).is_dir());
        assert!(!env_root.exists()); // 从没建过，删除静默

        let reg = load_registry_checked(&app_root).expect("注册表应落位");
        assert_eq!(reg.active, DEFAULT_ID);
        assert_eq!(reg.profiles.len(), 1);
        assert_eq!(reg.profiles[0].cloud_ns, "");

        fs::remove_dir_all(&app_root).ok();
    }

    /// 老布局搬家：app 根直属项 + 旁根 attachments/favicons/shared 全进 default，manifest 留痕
    #[test]
    fn migrates_legacy_into_default() {
        let app_root = tmp("migr");
        let env_root = tmp("migr_env");
        fs::create_dir_all(&app_root).unwrap();
        touch(&app_root.join("data.db"), "db");
        touch(&app_root.join("backups/pkg.zip"), "zip");
        touch(&env_root.join("attachments/a.bin"), "att");
        touch(&env_root.join("favicons/f.ico"), "ico");
        touch(&env_root.join("shared/s.txt"), "share");

        let b = boot(&app_root, &env_root).unwrap();
        let default = &b.root;

        assert_eq!(fs::read_to_string(default.join("data.db")).unwrap(), "db");
        assert!(default.join("backups/pkg.zip").is_file());
        assert_eq!(fs::read_to_string(default.join("attachments/a.bin")).unwrap(), "att");
        assert!(default.join("favicons/f.ico").is_file());
        assert!(default.join("shared/s.txt").is_file());

        // 源已搬空：旁根只剩空壳，理应被删（本用例没未知残留）
        assert!(!env_root.exists());

        let mf: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path(&app_root)).unwrap()).unwrap();
        assert!(mf.moves.iter().any(|m| m.to.ends_with("data.db")));

        fs::remove_dir_all(&app_root).ok();
    }

    /// 幂等：搬完再启动一次不应报错，也不应把已搬数据弄丢或重复搬
    #[test]
    fn boot_is_idempotent() {
        let app_root = tmp("idem");
        let env_root = tmp("idem_env");
        fs::create_dir_all(&app_root).unwrap();
        touch(&app_root.join("data.db"), "db");
        touch(&env_root.join("attachments/a.bin"), "att");

        let first = boot(&app_root, &env_root).unwrap();
        let data = first.root.join("data.db");
        assert!(data.is_file());

        // 第二次：注册表已在 → 直接命中 active，走不到迁移分支
        let second = boot(&app_root, &env_root).unwrap();
        assert_eq!(second.root, first.root);
        assert!(second.root.join("data.db").is_file());
        assert!(second.root.join("attachments/a.bin").is_file());

        fs::remove_dir_all(&app_root).ok();
    }

    /// R5：老旁根 shared 的绝对路径条目（键名 shareDirs）应改写成相对锚点 "shared"，
    /// 且大小写不敏感、只认 shared 本身或其子路径，别的绝对目录不动。
    #[test]
    fn fileshare_absolute_shared_rewritten_to_relative() {
        let app_root = tmp("fs");
        let env_root = tmp("fs_env");
        fs::create_dir_all(&app_root).unwrap();
        fs::create_dir_all(&env_root).unwrap();
        touch(&env_root.join("shared/keep.txt"), "k");
        let old_shared = env_root.join("shared").to_string_lossy().replace('\\', "/");
        // 首条精确、次条子路径、第三条大小写不同、第四条无关目录
        let cfg = format!(
            "{{\"port\":8899,\"shareDirs\":[\"{old_shared}\",\"{old_shared}/deep\",\"C:/other\",\"C:/Users/Someone/Downloads\"]}}"
        );
        touch(&app_root.join("fileshare.json"), &cfg);

        let b = boot(&app_root, &env_root).unwrap();
        let moved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(b.root.join("fileshare.json")).unwrap()).unwrap();
        let dirs: Vec<&str> = moved["shareDirs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(
            dirs,
            vec!["shared", "shared", "C:/other", "C:/Users/Someone/Downloads"]
        );

        fs::remove_dir_all(&app_root).ok();
    }

    /// 真实 ShareConfig 的旧默认（键名不是 share_dirs）—— 确保不再拿错键名当空跳过
    #[test]
    fn fileshare_snake_case_key_is_ignored() {
        let app_root = tmp("fs_snake");
        let env_root = tmp("fs_snake_env");
        fs::create_dir_all(&app_root).unwrap();
        fs::create_dir_all(&env_root).unwrap();
        touch(&env_root.join("shared/x"), "x");
        let old_shared = env_root.join("shared").to_string_lossy().replace('\\', "/");
        touch(
            &app_root.join("fileshare.json"),
            &format!("{{\"port\":8000,\"share_dirs\":[\"{old_shared}\"]}}"),
        );

        let b = boot(&app_root, &env_root).unwrap();
        let raw = fs::read_to_string(b.root.join("fileshare.json")).unwrap();
        assert!(raw.contains(&old_shared), "snake_case 键不该被动到：{raw}");

        fs::remove_dir_all(&app_root).ok();
    }

    /// 降级逆向：照 manifest 把 default 里的东西 rename 回原位
    #[test]
    fn downgrade_reverse_restores_legacy() {
        let app_root = tmp("rev");
        let env_root = tmp("rev_env");
        fs::create_dir_all(&app_root).unwrap();
        touch(&app_root.join("data.db"), "db");
        touch(&env_root.join("attachments/a.bin"), "att");

        let b = boot(&app_root, &env_root).unwrap();
        let mf: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path(&app_root)).unwrap()).unwrap();

        // 降级配方：先照留痕重建被迁移删掉的父目录，再逐笔逆向 rename
        for d in &mf.rebuilt_dirs {
            fs::create_dir_all(d).unwrap();
        }
        assert!(mf
            .rebuilt_dirs
            .iter()
            .any(|d| d == &env_root.to_string_lossy().into_owned()));
        for m in &mf.moves {
            fs::rename(&m.to, &m.from).unwrap();
        }

        assert_eq!(fs::read_to_string(app_root.join("data.db")).unwrap(), "db");
        assert_eq!(fs::read_to_string(env_root.join("attachments/a.bin")).unwrap(), "att");
        assert!(!b.root.join("data.db").exists());

        fs::remove_dir_all(&app_root).ok();
        fs::remove_dir_all(&env_root).ok();
    }

    /// 断电重跑：搬家搬了一半没来得及留痕（manifest/注册表都没落位），
    /// 重跑必须把已搬项补记全，否则降级逆向丢一半。
    #[test]
    fn crash_rerun_backfills_manifest() {
        let app_root = tmp("crash");
        let env_root = tmp("crash_env");
        fs::create_dir_all(&app_root).unwrap();
        fs::create_dir_all(&env_root).unwrap();
        touch(&app_root.join("data.db"), "db");
        touch(&env_root.join("attachments/a.bin"), "att");

        let b = boot(&app_root, &env_root).unwrap();
        // 模拟断电：抹掉留痕与注册表，源目录已空、目标已就位
        fs::remove_file(manifest_path(&app_root)).unwrap();
        fs::remove_file(registry_path(&app_root)).unwrap();

        let again = boot(&app_root, &env_root).unwrap(); // env_root 已不存在，走补记分支
        let mf: Manifest =
            serde_json::from_str(&fs::read_to_string(manifest_path(&app_root)).unwrap()).unwrap();
        // 补记按搬家单位记：直属项记文件、旁根那支记目录
        assert!(mf.moves.iter().any(|m| m.to.ends_with("data.db")));
        assert!(mf
            .moves
            .iter()
            .any(|m| m.to.replace('\\', "/").ends_with("/default/attachments")));
        assert_eq!(again.root, b.root);
        assert!(again.root.join("data.db").is_file());
        assert!(again.root.join("attachments").is_dir());

        fs::remove_dir_all(&app_root).ok();
    }

    #[test]
    fn base_for_maps_ns() {
        assert_eq!(base_for(""), "desko");
        assert_eq!(base_for("work"), "desko-work");
    }

    /// 起一个只有 default 的档案根，供 F2 增删改切用例复用
    fn booted(tag: &str) -> PathBuf {
        let app_root = tmp(tag);
        let env_root = tmp(&format!("{tag}_env"));
        fs::create_dir_all(&app_root).unwrap();
        boot(&app_root, &env_root).unwrap();
        app_root
    }

    /// 建档：省略 ns 时自动取 id（同机唯一）、建目录、追加注册表
    #[test]
    fn create_auto_ns_and_dir() {
        let root = booted("f2_create");
        let meta = create(&root, "工作", None).unwrap();

        assert_eq!(meta.name, "工作");
        assert_eq!(meta.cloud_ns, meta.id); // 自动 ns = id
        assert!(meta.id.starts_with("p-"));
        assert!(profile_dir(&root, &meta.id).is_dir());

        let reg = load_registry_checked(&root).unwrap();
        assert_eq!(reg.profiles.len(), 2);
        assert_eq!(reg.active, DEFAULT_ID); // 建档不改 active

        fs::remove_dir_all(&root).ok();
    }

    /// 建档：显式合法 ns 采纳；撞名拒绝；非法字符/空名拒绝
    #[test]
    fn create_ns_validation() {
        let root = booted("f2_ns");
        create(&root, "A", Some("work")).unwrap();

        // 撞名
        assert!(create(&root, "B", Some("work")).is_err(), "同机 ns 必须唯一");
        // 非法字符（大写/空格/下划线）
        assert!(create(&root, "B", Some("Work")).is_err());
        assert!(create(&root, "B", Some("wo rk")).is_err());
        assert!(create(&root, "B", Some("wo_rx")).is_err());
        // 空名
        assert!(create(&root, "   ", None).is_err());

        // 只有 A 那一次成功 → default + A = 2
        assert_eq!(load_registry_checked(&root).unwrap().profiles.len(), 2);
        fs::remove_dir_all(&root).ok();
    }

    /// 改名：active 档案只改显示名，id/目录/ns 全部不动
    #[test]
    fn rename_active_only_changes_display_name() {
        let root = booted("f2_rename");
        rename(&root, DEFAULT_ID, "我的默认档").unwrap();

        let reg = load_registry_checked(&root).unwrap();
        let d = reg.profiles.iter().find(|p| p.id == DEFAULT_ID).unwrap();
        assert_eq!(d.name, "我的默认档");
        assert_eq!(d.cloud_ns, ""); // ns 未动
        assert_eq!(reg.active, DEFAULT_ID);
        // 目录名仍是 default，未因改名搬家
        assert!(profile_dir(&root, DEFAULT_ID).is_dir());

        // 未知 id / 空名都拒绝
        assert!(rename(&root, "nope", "X").is_err());
        assert!(rename(&root, DEFAULT_ID, "  ").is_err());

        fs::remove_dir_all(&root).ok();
    }

    /// 删档：拒 active、拒唯一、拒未知；正常删非 active 连带删目录
    #[test]
    fn delete_guards_and_happy_path() {
        let root = booted("f2_delete");
        // 唯一档案（default 且 active）不可删
        assert!(delete(&root, DEFAULT_ID).is_err(), "最后一个档案不可删");

        let second = create(&root, "副", Some("side")).unwrap();
        // active 不可删
        assert!(delete(&root, DEFAULT_ID).is_err(), "当前使用档案不可删");
        // 未知不可删
        assert!(delete(&root, "nope").is_err());

        // 正常删非 active
        delete(&root, &second.id).unwrap();
        assert!(!profile_dir(&root, &second.id).exists(), "目录应随删档移除");
        let reg = load_registry_checked(&root).unwrap();
        assert_eq!(reg.profiles.len(), 1);
        assert_eq!(reg.active, DEFAULT_ID);

        fs::remove_dir_all(&root).ok();
    }

    /// 切换：写 active + 刷新 last_used_at；未知 id 拒绝且不改 active
    #[test]
    fn switch_updates_active_and_rejects_unknown() {
        let root = booted("f2_switch");
        let second = create(&root, "副", Some("side")).unwrap();

        assert!(switch(&root, "nope").is_err());
        assert_eq!(load_registry_checked(&root).unwrap().active, DEFAULT_ID);

        switch(&root, &second.id).unwrap();
        let reg = load_registry_checked(&root).unwrap();
        assert_eq!(reg.active, second.id);
        let target = reg.profiles.iter().find(|p| p.id == second.id).unwrap();
        assert!(target.last_used_at >= second.created_at);

        // 切回 default（重启后 base_for 应回到 desko）
        switch(&root, DEFAULT_ID).unwrap();
        assert_eq!(load_registry_checked(&root).unwrap().active, DEFAULT_ID);

        fs::remove_dir_all(&root).ok();
    }
}
