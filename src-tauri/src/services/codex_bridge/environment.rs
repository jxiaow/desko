use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use super::{rpc, workspace};
use crate::services::tunnel_service::ProcessJob;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Environment {
    #[default]
    Native,
    Wsl { distro: String, #[serde(default)] user: String },
}

impl Environment {
    pub fn key(&self) -> String {
        if *self == Self::Native { "native".into() } else { serde_json::to_string(self).unwrap() }
    }

    pub fn same_path(&self, a: &str, b: &str) -> bool {
        if *self == Self::Native { return workspace::same_path(a, b); }
        // WSL preserves Windows drive-letter paths with the casing used by each client.
        // Linux home directories remain case sensitive.
        let windows_mount = |path: &str| path.strip_prefix("/mnt/").is_some_and(|rest| {
            let bytes = rest.as_bytes();
            bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b'/'
        });
        if windows_mount(a) && windows_mount(b) { a.trim_end_matches('/').eq_ignore_ascii_case(b.trim_end_matches('/')) }
        else { a == b }
    }

    pub fn resolve(self, path: &str) -> Result<(Self, String), String> {
        let detected = wsl_distribution(path);
        let environment = match self {
            Self::Native => match detected {
                Some(distro) => Self::Wsl { distro, user: String::new() },
                None => return Ok((Self::Native, workspace::directory(path)?)),
            },
            Self::Wsl { distro, user } if distro.is_empty() => Self::Wsl { distro: detected.unwrap_or_default(), user },
            environment => environment,
        };
        let (output, success) = capture(environment.wsl_command("resolve", path)?, Duration::from_secs(20))?;
        let value: Value = serde_json::from_slice(&output).map_err(|_| "WSL 启动失败，请确认发行版可用，且已安装 bash、python3 和 Linux Codex CLI")?;
        if !success { return Err(value["error"].as_str().unwrap_or("无法读取 WSL 工作目录").into()); }
        let cwd = value["cwd"].as_str().ok_or("WSL 未返回工作目录")?.to_owned();
        let user = value["user"].as_str().ok_or("WSL 未返回用户")?.to_owned();
        let distro = value["distro"].as_str().filter(|distro| !distro.is_empty()).ok_or("WSL 未返回发行版")?.to_owned();
        Ok((Self::Wsl { distro, user }, cwd))
    }

    pub fn wsl_command(&self, mode: &str, path: &str) -> Result<Command, String> {
        let Self::Wsl { distro, user } = self else { return Err("当前环境不是 WSL".into()); };
        if !cfg!(windows) { return Err("请在 Windows 版 Desko 中选择 WSL；Linux 版直接使用本机环境".into()); }
        if distro.starts_with('-') || distro.len() > 256 || distro.contains(['\0', '\n', '\r'])
            || user.starts_with('-') || user.len() > 256 || user.contains(['\0', '\n', '\r']) {
            return Err("无效的 WSL 发行版或用户".into());
        }
        let mut cmd = rpc::command(Path::new("wsl.exe"));
        if !distro.is_empty() { cmd.args(["--distribution", distro]); }
        if !user.is_empty() { cmd.args(["--user", user]); }
        cmd.args(["--cd", "~", "--exec", "bash", "-lc", "exec python3 -u -c \"$1\" \"${@:2}\"", "desko",
            include_str!("wsl_runner.py"), mode, path]);
        // Windows CLI overrides and credentials paths must not leak into Linux.
        for key in rpc::TASK_ENV.iter().copied().chain(["CODEX_BIN", "CODEX_HOME", "CODEX_WINDOWS_SANDBOX"]) { cmd.env_remove(key); }
        Ok(cmd)
    }

    pub fn git(&self, cwd: &str, args: &[&str]) -> Result<Command, String> {
        let mut cmd = if *self == Self::Native {
            let mut cmd = rpc::command(Path::new("git"));
            cmd.arg("-C").arg(cwd);
            cmd
        } else { self.wsl_command("git", cwd)? };
        cmd.args(args).env("GIT_OPTIONAL_LOCKS", "0");
        Ok(cmd)
    }
}

fn wsl_distribution(path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    if !normalized.to_ascii_lowercase().starts_with("//wsl.localhost/") && !normalized.to_ascii_lowercase().starts_with("//wsl$/") { return None; }
    normalized.split('/').nth(3).filter(|distro| !distro.is_empty()).map(str::to_owned)
}

// Bounded reads shared by WSL discovery/path resolution and Git status.
pub fn capture(mut command: Command, timeout: Duration) -> Result<(Vec<u8>, bool), String> {
    let job = ProcessJob::new().map_err(|e| e.to_string())?;
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("无法启动环境命令：{e}"))?;
    if let Err(e) = job.assign(&child) { let _ = child.kill(); let _ = child.wait(); return Err(e.to_string()); }
    let mut stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        let mut overflow = false;
        while let Ok(n) = stdout.read(&mut buffer) {
            if n == 0 { break; }
            if bytes.len() + n > 2 * 1024 * 1024 { overflow = true; } else { bytes.extend_from_slice(&buffer[..n]); }
        }
        if overflow { Err("命令输出超过 2 MiB，请在终端查看".to_owned()) } else { Ok(bytes) }
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(e) => break Err(e.to_string()),
            _ if start.elapsed() > timeout => break Err("环境命令超时，请检查 WSL 或 Git 状态".into()),
            _ => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    drop(job);
    if status.is_err() { let _ = child.kill(); let _ = child.wait(); }
    let bytes = reader.join().map_err(|_| "命令输出读取失败")??;
    Ok((bytes, status?.success()))
}

fn distro_names(bytes: &[u8]) -> Vec<String> {
    let output = if bytes.contains(&0) || bytes.starts_with(&[0xff, 0xfe]) {
        String::from_utf16_lossy(&bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect::<Vec<_>>())
    } else { String::from_utf8_lossy(bytes).into_owned() };
    output.trim_start_matches('\u{feff}').lines().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned).collect()
}

pub fn environments() -> Value {
    let mut result = json!({"nativeLabel":if cfg!(windows) { "Windows" } else { "本机" },"distros":[]});
    if cfg!(windows) {
        let mut cmd = rpc::command(Path::new("wsl.exe"));
        cmd.args(["--list", "--quiet"]);
        match capture(cmd, Duration::from_secs(10)) {
            Ok((output, true)) => result["distros"] = json!(distro_names(&output)),
            _ => result["wslError"] = json!("未能读取 WSL 发行版；安装或启动 WSL 后可刷新环境列表"),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wsl_paths_and_identity_remain_case_sensitive_and_user_scoped() {
        let env = Environment::Wsl { distro: "Ubuntu".into(), user: "alice".into() };
        assert!(!env.same_path("/home/alice/Repo", "/home/alice/repo"));
        assert_ne!(env.key(), Environment::Wsl { distro: "Ubuntu".into(), user: "root".into() }.key());
        assert_ne!(env.key(), Environment::Native.key());
    }

    #[test]
    fn distro_list_decodes_utf16_without_corrupting_unicode() {
        let bytes: Vec<u8> = "\u{feff}Ubuntu\r\n开发环境\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(distro_names(&bytes), vec!["Ubuntu", "开发环境"]);
    }

    #[test]
    fn wsl_distribution_is_detected_only_from_wsl_unc_paths() {
        assert_eq!(wsl_distribution(r"\\wsl.localhost\Ubuntu-26.04\home\alice\项目"), Some("Ubuntu-26.04".into()));
        assert_eq!(wsl_distribution(r"\\WSL$\开发环境\"), Some("开发环境".into()));
        assert_eq!(wsl_distribution("//wsl.localhost/Debian/home/alice"), Some("Debian".into()));
        assert_eq!(wsl_distribution(r"C:\Code\项目"), None);
        assert_eq!(wsl_distribution(r"\\server\share\项目"), None);
        assert_eq!(wsl_distribution("//wsl.localhost/"), None);
    }

    #[cfg(windows)]
    #[test]
    fn automatic_wsl_uses_default_distribution_and_user() {
        let automatic = Environment::Wsl { distro: String::new(), user: String::new() };
        let command = automatic.wsl_command("resolve", "~/项目").unwrap();
        let args: Vec<_> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(!args.iter().any(|arg| arg == "--distribution" || arg == "--user"));
        assert!(args.iter().any(|arg| arg == "~/项目"));
        let explicit = Environment::Wsl { distro: "Ubuntu".into(), user: "alice".into() };
        let command = explicit.wsl_command("resolve", "/home/alice/项目").unwrap();
        let args: Vec<_> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[..4], ["--distribution", "Ubuntu", "--user", "alice"]);
    }
}
