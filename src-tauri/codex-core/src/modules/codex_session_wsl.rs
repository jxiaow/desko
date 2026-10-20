//! Windows 上自动发现正在运行的 WSL 发行版中的 Codex 会话目录。
use std::fs;
use std::path::{Path, PathBuf};

pub fn discover_usage_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        match running_distributions() {
            Ok(distributions) => return distributions.into_iter()
                .flat_map(|name| codex_homes_in_root(&PathBuf::from(format!(r"\\wsl.localhost\{}", name))))
                .collect(),
            Err(error) => crate::modules::logger::log_warn(&format!("WSL 用量目录自动识别失败: {}", error)),
        }
    }
    Vec::new()
}

pub(crate) fn codex_homes_in_root(root: &Path) -> Vec<PathBuf> {
    let mut homes = vec![root.join("root/.codex")];
    if let Ok(users) = fs::read_dir(root.join("home")) {
        homes.extend(users.flatten().map(|user| user.path().join(".codex")));
    }
    homes.retain(|home| home.is_dir());
    homes.sort();
    homes
}

fn parse_distributions(bytes: &[u8]) -> Vec<String> {
    // wsl.exe 的重定向输出通常为 UTF-16LE，也兼容 UTF-8 输出。
    let text = if bytes.contains(&0) || bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16_lossy(&bytes.chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]])).collect::<Vec<_>>())
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.trim_start_matches('\u{feff}').lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.contains(['\\', '/', ':', '\0']) && !matches!(*name, "." | ".."))
        .map(str::to_owned)
        .collect()
}

#[cfg(windows)]
pub(crate) fn wsl_executable() -> Result<PathBuf, String> {
    let executable = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32/wsl.exe"))
        .ok_or("无法定位 wsl.exe")?;
    if !executable.is_file() {
        return Err("未找到 wsl.exe".to_string());
    }
    Ok(executable)
}

#[cfg(windows)]
pub(crate) fn running_distributions() -> Result<Vec<String>, String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let executable = match wsl_executable() {
        Ok(executable) => executable,
        Err(_) => return Ok(Vec::new()),
    };
    let mut child = Command::new(executable)
        .args(["--list", "--running", "--quiet"])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|error| error.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Err(format!("wsl.exe 退出: {}", status));
                }
                let output = child.wait_with_output().map_err(|error| error.to_string())?;
                return Ok(parse_distributions(&output.stdout));
            }
            Ok(None) if started.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(20));
            }
            status => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match status {
                    Err(error) => error.to_string(),
                    _ => "枚举 WSL 发行版超时".to_string(),
                });
            }
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn wsl_executable() -> Result<PathBuf, String> {
    Err("仅 Windows 支持 WSL".to_string())
}

#[cfg(not(windows))]
pub(crate) fn running_distributions() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

/// wsl$ 与 wsl.localhost 指向同一文件系统；保留 Linux 路径的大小写。
pub fn path_key(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(text) = path.to_str() {
            for prefix in [r"\\?\UNC\wsl$\", r"\\?\UNC\wsl.localhost\", r"\\wsl$\", r"\\wsl.localhost\"] {
                if text.get(..prefix.len()).is_some_and(|start| start.eq_ignore_ascii_case(prefix)) {
                    return PathBuf::from(format!(r"\\wsl.localhost\{}", &text[prefix.len()..]));
                }
            }
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distribution_output_supports_utf16_utf8_and_rejects_path_components() {
        let names = "\u{feff}Ubuntu-26.04\r\nDebian\r\n\r\n";
        let utf16 = names.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>();
        assert_eq!(parse_distributions(&utf16), vec!["Ubuntu-26.04", "Debian"]);
        assert_eq!(parse_distributions(names.as_bytes()), vec!["Ubuntu-26.04", "Debian"]);
        assert_eq!(parse_distributions(b"../host\n..\nC:\\host\nUbuntu\n"), vec!["Ubuntu"]);
    }

    #[test]
    fn discovery_finds_multiple_users_and_root_without_missing_homes() {
        let root = std::env::temp_dir().join(format!("desko-wsl-{}", uuid::Uuid::new_v4()));
        for path in ["home/alice/.codex", "home/bob/.codex", "root/.codex", "home/no-codex"] {
            fs::create_dir_all(root.join(path)).unwrap();
        }
        let homes = codex_homes_in_root(&root);
        assert_eq!(homes.len(), 3);
        for path in ["home/alice/.codex", "home/bob/.codex", "root/.codex"] {
            assert!(homes.contains(&root.join(path)));
        }
        assert!(codex_homes_in_root(&root.join("missing")).is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn wsl_aliases_share_a_key_but_linux_case_stays_distinct() {
        let path = Path::new(r"\\wsl.localhost\Ubuntu\home\user\.codex");
        assert_eq!(path_key(path), path_key(Path::new(r"\\?\UNC\wsl$\Ubuntu\home\user\.codex")));
        assert_ne!(path_key(path), path_key(Path::new(r"\\wsl$\Ubuntu\home\User\.codex")));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "需要本机存在正在运行的 WSL 发行版；只读真实目录"]
    fn live_wsl_discovery_finds_codex_home() {
        let homes = discover_usage_dirs();
        assert!(!homes.is_empty(), "未发现 WSL Codex 目录");
        for home in homes {
            assert!(home.is_dir());
            println!("WSL Codex: {}", home.display());
        }
    }
}
