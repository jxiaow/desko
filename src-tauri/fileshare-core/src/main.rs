//! desko-fileshare：局域网文件传输服务进程。
//! 由 desko 主程序 spawn/kill，不参与窗口生命周期以外的任何事。
//! 协议：
//!   --config <file.json>  配置真相（主程序写，本进程 mtime 轮询热加载）
//!   --status <file.json>  运行状态（本进程写，主程序读）
//!   --parent <pid>        父进程看门狗：父亡自尽，防强杀主程序后成孤儿

use std::path::PathBuf;

use fileshare_core::config::{self};
use fileshare_core::{apply_live_config, rotate_sessions, Server};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let get = |flag: &str| -> Option<PathBuf> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .map(PathBuf::from)
    };
    let config_path = match get("--config") {
        Some(p) => p,
        None => {
            eprintln!("missing --config");
            std::process::exit(2);
        }
    };
    let status_path = get("--status");
    let parent_pid = args
        .iter()
        .position(|a| a == "--parent")
        .and_then(|i| args.get(i + 1))
        .and_then(|s| s.parse::<u32>().ok());
    let parent_name = args
        .iter()
        .position(|a| a == "--parent-name")
        .and_then(|i| args.get(i + 1))
        .cloned()
        .unwrap_or_default();

    let cfg = match config::load_file(&config_path) {
        Ok(Some(c)) => c,
        Ok(None) => {
            eprintln!("config file not found: {}", config_path.display());
            std::process::exit(2);
        }
        Err(e) => {
            eprintln!("config invalid: {}", e);
            std::process::exit(2);
        }
    };
    let base_dir = config_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    let persist = fileshare_core::file_persist(config_path.clone());

    let mut desired = cfg.clone();
    let mut server: Option<Server> = match fileshare_core::start(desired.clone(), base_dir.clone(), persist.clone()) {
        Ok(s) => {
            write_status(&status_path, &s.info());
            Some(s)
        }
        Err(e) => {
            eprintln!("bind failed: {}", e);
            std::process::exit(3);
        }
    };

    if let Some(pid) = parent_pid {
        spawn_parent_watchdog(pid, parent_name);
    }

    // 配置轮询：签名变了才读；主程序原子 rename，读到的永远是完整文件
    let mut last_sig = config::file_signature(&config_path);
    loop {
        std::thread::sleep(std::time::Duration::from_millis(400));
        let sig = config::file_signature(&config_path);
        if sig == last_sig {
            // 端口漂移重试：起不来时（server None）继续尝试 desired
            if server.is_none() {
                if let Ok(s) = fileshare_core::start(desired.clone(), base_dir.clone(), persist.clone()) {
                    write_status(&status_path, &s.info());
                    server = Some(s);
                }
            }
            continue;
        }
        last_sig = sig;
        let next = match config::load_file(&config_path) {
            Ok(Some(c)) => c,
            // 写坏了：保持上一次成功配置继续服务（原 ftp 版语义）
            Ok(None) => continue,
            Err(e) => {
                eprintln!("config reload failed, keep running: {}", e);
                continue;
            }
        };
        let port_changed = next.effective_port() != desired.effective_port();
        let bind_changed = next.local_only != desired.local_only;
        let password_changed = next.password_sha256 != desired.password_sha256;
        desired = next.clone();
        if port_changed || bind_changed {
            if let Some(old) = server.take() {
                old.stop();
            }
            match fileshare_core::start(desired.clone(), base_dir.clone(), persist.clone()) {
                Ok(s) => {
                    write_status(&status_path, &s.info());
                    server = Some(s);
                }
                Err(e) => {
                    eprintln!("rebind failed: {}（将在下轮重试）", e);
                    clear_status(&status_path);
                }
            }
        } else if let Some(s) = &server {
            apply_live_config(&s.runtime, next);
            if password_changed {
                rotate_sessions(&s.runtime);
            }
            write_status(&status_path, &s.info());
        }
    }
}

fn write_status(path: &Option<PathBuf>, info: &fileshare_core::ServerInfo) {
    if let Some(p) = path {
        let _ = server_info_to_file(p, info);
    }
}

fn clear_status(path: &Option<PathBuf>) {
    if let Some(p) = path {
        let _ = std::fs::remove_file(p);
    }
}

fn server_info_to_file(path: &std::path::Path, info: &fileshare_core::ServerInfo) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(info).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn spawn_parent_watchdog(parent_pid: u32, parent_name: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(3));
        if !parent_alive(parent_pid, &parent_name) {
            // 主程序被强杀/崩溃：自我退出，不留孤儿服务占端口
            std::process::exit(0);
        }
    });
}

/// tasklist CSV 精确比对 PID 列与镜像名：子串匹配会把 PID 复用误判成父进程还活着
fn parent_alive(parent_pid: u32, parent_name: &str) -> bool {
    let Ok(out) = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", parent_pid), "/NH", "/FO", "CSV"])
        .output()
    else {
        return true; // 探测失败不误杀
    };
    let pid_col = parent_pid.to_string();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut cols = line.split("\",\"").map(|c| c.trim_matches('"'));
        let (Some(image), Some(pid)) = (cols.next(), cols.next()) else {
            continue;
        };
        if pid != pid_col {
            continue;
        }
        return parent_name.is_empty() || image.eq_ignore_ascii_case(parent_name);
    }
    false
}
