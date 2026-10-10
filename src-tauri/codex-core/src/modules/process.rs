// desko 侧的进程判定：只保留账号读写路径用到的能力，内容逐字节取自上游。
#![allow(dead_code, unused_imports, unused_variables, clippy::all)]
use std::collections::HashSet;
use std::process::Command;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        // On macOS, use ps to avoid sysinfo TCC dialogs.
        // Treat zombie/defunct process as not running.
        let output = Command::new("ps")
            .args(["-p", &pid.to_string(), "-o", "stat="])
            .output();
        let output = match output {
            Ok(value) if value.status.success() => value,
            _ => return false,
        };

        let stat = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stat.is_empty() {
            return false;
        }
        let first = stat.chars().next().unwrap_or_default();
        if first == 'Z' || first == 'z' {
            return false;
        }
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut system = System::new();
        system.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_exe(UpdateKind::OnlyIfNotSet)
                .with_cmd(UpdateKind::OnlyIfNotSet),
        );
        system.process(Pid::from(pid as usize)).is_some()
    }
}

pub fn find_pids_by_port(port: u16) -> Result<Vec<u32>, String> {
    let current_pid = std::process::id();
    let mut pids = HashSet::new();

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("lsof")
            .args(["-nP", &format!("-iTCP:{}", port), "-sTCP:LISTEN", "-t"])
            .output()
            .map_err(|e| format!("执行 lsof 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if let Ok(pid) = line.trim().parse::<u32>() {
                if pid != current_pid {
                    pids.insert(pid);
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let output = Command::new("netstat")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["-ano", "-p", "tcp"])
            .output()
            .map_err(|e| format!("执行 netstat 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let port_suffix = format!(":{}", port);
        for line in stdout.lines() {
            let line = line.trim();
            if !line.starts_with("TCP") {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            let local = parts[1];
            let state = parts[3];
            let pid_str = parts[4];
            if !state.eq_ignore_ascii_case("LISTENING") {
                continue;
            }
            if !local.ends_with(&port_suffix) {
                continue;
            }
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != current_pid {
                    pids.insert(pid);
                }
            }
        }
    }

    let mut pids = pids.into_iter().collect::<Vec<_>>();
    pids.sort_unstable();
    Ok(pids)
}

pub fn is_port_in_use(port: u16) -> Result<bool, String> {
    Ok(!find_pids_by_port(port)?.is_empty())
}

/// 上游按已配置的官方客户端启动路径匹配进程；desko 不启动 Codex，该路径恒未配置，
/// 上游在此状态下同样返回空列表。
pub fn collect_codex_process_entries() -> Vec<(u32, Option<String>)> {
    Vec::new()
}

pub fn resolve_codex_pid(_last_pid: Option<u32>, _codex_home: Option<&str>) -> Option<u32> {
    resolve_codex_pid_from_entries(_last_pid, _codex_home, &collect_codex_process_entries())
}

pub fn resolve_codex_pid_from_entries(
    _last_pid: Option<u32>,
    _codex_home: Option<&str>,
    _entries: &[(u32, Option<String>)],
) -> Option<u32> {
    None
}
