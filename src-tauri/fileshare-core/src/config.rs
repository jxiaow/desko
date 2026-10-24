//! 共享配置：以 JSON 文件为唯一真相（主程序写、服务进程读）。
//! 服务进程按 mtime+size 签名轮询热加载，改目录/口令不重启即生效——原 ftp 版
//! app_config.json 的语义在这里回归，只是写入方从"用户编辑"换成了 desko 主程序。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::theme_values;

pub const DEFAULT_PORT: u16 = 8000;
pub const PORT_PROBE_SPAN: u16 = 10;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShareConfig {
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub local_only: bool,
    #[serde(default)]
    pub share_dirs: Vec<PathBuf>,
    /// sha256(口令) 小写十六进制；None = 不启用访问口令。
    /// 注意：明文存在 app data 的 JSON 里（不进 SQLite 加密库），只挡君子——
    /// 局域网便利型门槛，能离线爆破弱口令，别拿它当强鉴权用。
    #[serde(default)]
    pub password_sha256: Option<String>,
    /// 公网侧逐条策略：desko 的穿透页写，本进程只读。
    /// 只有 Host 命中其中某个 hostname 的请求才受它管，局域网侧行为一律不变。
    #[serde(default)]
    pub public: Vec<PublicPolicy>,
    /// 主题戳：desko 主程序换外观时写，本进程只读，四值直接挂上网页的 `<html>`。
    /// 单独四个键而不是一个对象——落盘形态与其余字段平铺一致，读侧不用再多一层 Option。
    /// 值不在词表里就整戳作废，见 [`ThemeStamp::normalize`]。
    pub theme: String,
    pub base: String,
    pub accent: String,
    /// "on" / "off"，对应 data-atmosphere
    pub atmosphere: String,
}

/// 一条公网子域的策略。口令缺省即拒绝：宁可公网打不通，不可无凭据能读。
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PublicPolicy {
    pub hostname: String,
    #[serde(default)]
    pub password_sha256: Option<String>,
    /// true = 只给读：上传与写文本一律拒
    #[serde(default)]
    pub read_only: bool,
}

/// 网页 `<html>` 上那四个外观属性。词表来自生成的 theme_values（与 tokens.css 同源），
/// 也就是"被接受"严格等价于"复制过来的令牌里真有这一块"。
/// 四值是 desko 那张 `<html>` 的拓印：读侧只查词表，不替它重新推导极性。
/// 默认档纸·浅·群青·无氛围同时也是公网面的固定外观——本机换了什么颜色，
/// 不该顺着 Host 头泄给公网访客。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThemeStamp {
    pub theme: &'static str,
    pub base: &'static str,
    pub accent: &'static str,
    pub atmosphere: &'static str,
}

impl Default for ThemeStamp {
    fn default() -> Self {
        ThemeStamp { theme: "paper", base: "light", accent: "ink", atmosphere: "off" }
    }
}

impl ThemeStamp {
    /// 底色、极性、强调色三者任一不在词表里就整戳回落；只信一半会画出 App 里不存在的组合。
    pub fn normalize(theme: &str, base: &str, accent: &str, atmosphere: &str) -> Self {
        fn exact(list: &[&'static str], value: &str) -> Option<&'static str> {
            list.iter().copied().find(|v| *v == value)
        }
        match (
            exact(theme_values::WORKSPACE_THEMES, theme),
            exact(theme_values::WORKSPACE_BASES, base),
            exact(theme_values::WORKSPACE_ACCENTS, accent),
        ) {
            (Some(t), Some(b), Some(a)) => ThemeStamp {
                theme: t,
                base: b,
                accent: a,
                atmosphere: if atmosphere == "on" { "on" } else { "off" },
            },
            _ => Self::default(),
        }
    }
}

impl ShareConfig {
    /// 空端口字段按 0 处理，读侧统一走这个
    pub fn effective_port(&self) -> u16 {
        if self.port == 0 {
            DEFAULT_PORT
        } else {
            self.port
        }
    }

    /// Host 头命中的公网策略；DNS 标签大小写不敏感
    pub fn public_policy(&self, host: &str) -> Option<&PublicPolicy> {
        if host.is_empty() {
            return None;
        }
        self.public
            .iter()
            .find(|p| p.hostname.eq_ignore_ascii_case(host))
    }

    /// 局域网面读这份戳。公网面不走这里，由 handlers 直接给 ThemeStamp::default()
    pub fn theme_stamp(&self) -> ThemeStamp {
        ThemeStamp::normalize(&self.theme, &self.base, &self.accent, &self.atmosphere)
    }
}

/// 展开 `~`、去空、去重（Windows 大小写不敏感）、相对路径钉到 base_dir。
/// 对齐 ftp 版 normalize_share_dirs + expanduser + resolve。
pub fn normalize_share_dirs(raw: &[String], base_dir: &Path) -> Vec<PathBuf> {
    let mut seen = Vec::<String>::new();
    let mut out = Vec::new();
    for item in raw {
        let text = item.trim();
        if text.is_empty() {
            continue;
        }
        let expanded = expand_tilde(text);
        let path = PathBuf::from(&expanded);
        let abs = if path.is_absolute() {
            path
        } else {
            base_dir.join(path)
        };
        let key = strip_verbatim(&abs).to_lowercase();
        if !seen.contains(&key) {
            seen.push(key);
            out.push(abs);
        }
    }
    out
}

/// \\?\ 前缀（canonicalize 产物）不参与去重键
fn strip_verbatim(p: &Path) -> String {
    let s = p.to_string_lossy().into_owned();
    s.trim_start_matches(r"\\?\").to_string()
}

fn expand_tilde(text: &str) -> String {
    if text == "~" || text.starts_with("~/") || text.starts_with("~\\") {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            return format!("{}{}", home, &text[1..]);
        }
    }
    text.to_string()
}

pub fn ensure_dirs_exist(dirs: &[PathBuf]) -> Result<(), String> {
    for dir in dirs {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("无法创建共享目录 {}: {}", dir.display(), e))?;
    }
    Ok(())
}

/// 读取配置文件；不存在返回默认值。损坏时抛错，由调用方决定"沿用上一次成功配置"。
pub fn load_file(path: &Path) -> Result<Option<ShareConfig>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("读取配置失败: {}", e))?;
    let mut cfg: ShareConfig =
        serde_json::from_str(&text).map_err(|e| format!("配置 JSON 损坏: {}", e))?;
    let base = base_from_config_path(path);
    cfg.share_dirs = normalize_share_strings(&cfg.share_dirs, &base);
    Ok(Some(cfg))
}

fn normalize_share_strings(raw: &[PathBuf], base: &Path) -> Vec<PathBuf> {
    let owned: Vec<String> = raw.iter().map(|p| p.to_string_lossy().into_owned()).collect();
    normalize_share_dirs(&owned, base)
}

/// 相对目录的落点：配置文件的父目录（即 app data）
fn base_from_config_path(path: &Path) -> PathBuf {
    path.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// 原子写：临时文件 + rename
pub fn save_file(path: &Path, cfg: &ShareConfig) -> Result<(), String> {
    let _lock = config_lock(path)?;
    save_file_locked(path, cfg)
}

// 锁独立于被 rename 替换的配置 inode，两个进程也始终锁同一个文件。
// 不删除锁文件：删除后新旧写者可能锁住两个不同 inode。File drop 释放系统锁。
fn config_lock(path: &Path) -> Result<std::fs::File, String> {
    let lock = std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true)
        .open(path.with_extension("json.lock"))
        .map_err(|e| format!("打开配置锁失败: {e}"))?;
    lock.lock().map_err(|e| format!("获取配置锁失败: {e}"))?;
    Ok(lock)
}

fn save_file_locked(path: &Path, cfg: &ShareConfig) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, text).map_err(|e| format!("写配置失败: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("替换配置失败: {}", e))?;
    Ok(())
}

/// 跨进程串行读-改-写：锁住完整事务，mutate 只动自己负责的字段。
/// 主程序与网页 /settings 都会写这份文件，整对象盲写会互相吞字段。
/// 文件不存在时用 fallback 兜底。返回落盘后的最终配置。
pub fn update_file<F>(path: &Path, fallback: &ShareConfig, mutate: F) -> Result<ShareConfig, String>
where
    F: FnOnce(&mut ShareConfig),
{
    let _lock = config_lock(path)?;
    let mut cfg = match load_file(path)? {
        Some(c) => c,
        None => fallback.clone(),
    };
    mutate(&mut cfg);
    save_file_locked(path, &cfg)?;
    Ok(cfg)
}

/// 配置签名：mtime+size，与原 ftp 版热加载判据一致
pub fn file_signature(path: &Path) -> Option<(i64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)?;
    Some((mtime, meta.len()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_config(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("desko-cfg-{}-{}.json", tag, uuid::Uuid::new_v4()))
    }

    #[test]
    fn normalize_trims_dedups_and_expands() {
        let base = PathBuf::from("/base");
        let raw = vec![
            "  /srv/a  ".to_string(),
            "".to_string(),
            "   ".to_string(),
            "/srv/a".to_string(),
            "rel".to_string(),
        ];
        let out = normalize_share_dirs(&raw, &base);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0], PathBuf::from("/srv/a"));
        assert_eq!(out[1], PathBuf::from("/base/rel"));
    }

    #[test]
    fn normalize_dedups_case_insensitive() {
        let base = PathBuf::from("/base");
        let raw = vec!["C:\\Share".to_string(), "c:\\share".to_string()];
        assert_eq!(normalize_share_dirs(&raw, &base).len(), 1);
    }

    #[test]
    fn effective_port_falls_back_to_default() {
        assert_eq!(ShareConfig::default().effective_port(), DEFAULT_PORT);
        assert_eq!(ShareConfig { port: 9000, ..Default::default() }.effective_port(), 9000);
    }

    #[test]
    fn theme_stamp_requires_every_value_known() {
        let teal = ThemeStamp { theme: "ink", base: "dark", accent: "teal", atmosphere: "on" };
        assert_eq!(ThemeStamp::normalize("ink", "dark", "teal", "on"), teal);
        // 词表外的强调色 / 旧六套底色：整戳作废，不留半套
        assert_eq!(ThemeStamp::normalize("ink", "dark", "sky", "on"), ThemeStamp::default());
        assert_eq!(ThemeStamp::normalize("snow", "light", "ink", "off"), ThemeStamp::default());
        assert_eq!(ThemeStamp::normalize("ink", "", "teal", "on"), ThemeStamp::default());
        // 氛围是布尔：脏值只把自己按关算，不牵动另外三值
        assert_eq!(
            ThemeStamp::normalize("ink", "dark", "teal", "banana"),
            ThemeStamp { theme: "ink", base: "dark", accent: "teal", atmosphere: "off" }
        );
        // 改版之前的配置文件根本没有这四键
        let legacy: ShareConfig = serde_json::from_str(r#"{"port":8123,"shareDirs":[]}"#).unwrap();
        assert_eq!(legacy.theme_stamp(), ThemeStamp::default());
    }

    #[test]
    fn expand_tilde_passthrough() {
        assert_eq!(expand_tilde("/plain/path"), "/plain/path");
        assert_eq!(expand_tilde(""), "");
        let out = expand_tilde("~/docs");
        assert!(!out.starts_with('~') || std::env::var("USERPROFILE").is_err());
    }

    #[test]
    fn file_roundtrip_with_relative_resolution() {
        let p = tmp_config("round");
        let mut cfg = ShareConfig {
            port: 8123,
            local_only: true,
            share_dirs: vec![PathBuf::from("sub")],
            password_sha256: Some("deadbeef".to_string()),
            public: vec![PublicPolicy {
                hostname: "files.example.com".to_string(),
                password_sha256: Some("pubhash".to_string()),
                read_only: true,
            }],
            theme: "ink".to_string(),
            base: "dark".to_string(),
            accent: "teal".to_string(),
            atmosphere: "on".to_string(),
        };
        save_file(&p, &cfg).unwrap();
        let loaded = load_file(&p).unwrap().unwrap();
        assert_eq!(loaded.port, 8123);
        assert!(loaded.local_only);
        assert_eq!(loaded.password_sha256.as_deref(), Some("deadbeef"));
        // 公网策略原样过盘：desko 写的就是这边读的
        assert_eq!(loaded.public, cfg.public);
        // 键名是跨进程的契约，驼峰。类型两边共用所以改名会同时炸两边——
        // 但落盘形态先钉住，别等真机上"desko 说下发成功了"才发现读不回来
        let text = std::fs::read_to_string(&p).unwrap();
        assert!(text.contains("\"passwordSha256\": \"pubhash\""), "{text}");
        assert!(text.contains("\"readOnly\": true"), "{text}");
        // 主题戳四键平铺、名字照写不动——desko 侧拼错一个字母这边就当没这键，静默回纸色
        assert!(text.contains("\"theme\": \"ink\""), "{text}");
        assert!(text.contains("\"atmosphere\": \"on\""), "{text}");
        assert_eq!(
            loaded.theme_stamp(),
            ThemeStamp { theme: "ink", base: "dark", accent: "teal", atmosphere: "on" }
        );
        assert_eq!(loaded.public_policy("FILES.EXAMPLE.COM").unwrap().password_sha256.as_deref(), Some("pubhash"));
        assert!(loaded.public_policy("other.example.com").is_none());
        assert!(loaded.public_policy("").is_none());
        assert!(loaded.share_dirs[0].is_absolute());
        assert_eq!(
            loaded.share_dirs[0],
            p.parent().unwrap().join("sub")
        );
        std::fs::remove_file(&p).ok();
        cfg.port = 1;
        save_file(&p, &cfg).unwrap();
        assert!(file_signature(&p).is_some());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn corrupt_json_is_reported() {
        let p = tmp_config("corrupt");
        std::fs::write(&p, "{ not json").unwrap();
        assert!(load_file(&p).is_err());
        std::fs::remove_file(&p).ok();
    }

    #[test]
    fn missing_file_is_none() {
        let p = tmp_config("absent");
        assert!(load_file(&p).unwrap().is_none());
    }
    #[test]
    fn locked_update_worker() {
        let Some(path) = std::env::var_os("DESKO_CONFIG_LOCK_TEST_PATH") else { return };
        let host = std::env::var("DESKO_CONFIG_LOCK_TEST_HOST").unwrap();
        update_file(Path::new(&path), &ShareConfig::default(), |cfg| {
            // 放大旧快照覆盖窗口；无跨进程锁时会丢失其他 worker 的修改。
            std::thread::sleep(std::time::Duration::from_millis(50));
            cfg.public.push(PublicPolicy { hostname: host, ..Default::default() });
        }).unwrap();
    }

    #[test]
    fn updates_from_separate_processes_keep_every_field_change() {
        let path = tmp_config("process-lock");
        save_file(&path, &ShareConfig::default()).unwrap();
        let children: Vec<_> = (0..4).map(|i| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "config::tests::locked_update_worker"])
                .env("DESKO_CONFIG_LOCK_TEST_PATH", &path)
                .env("DESKO_CONFIG_LOCK_TEST_HOST", format!("worker-{i}.example.com"))
                .stdout(std::process::Stdio::null()).spawn().unwrap()
        }).collect();
        for mut child in children { assert!(child.wait().unwrap().success()); }
        let cfg = load_file(&path).unwrap().unwrap();
        assert_eq!(cfg.public.len(), 4);
        for i in 0..4 { assert!(cfg.public_policy(&format!("worker-{i}.example.com")).is_some()); }
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(path.with_extension("json.lock")).unwrap();
    }

}
