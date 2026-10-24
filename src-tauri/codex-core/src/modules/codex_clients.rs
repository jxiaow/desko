//! Windows Codex clients. PID, executable and argv stay in backend memory;
//! IPC receives only counts and an expiring, profile-scoped retry id.
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCounts {
    pub app_count: usize,
    pub cli_count: usize,
}
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientOutcome {
    pub closed_app: usize,
    pub closed_cli: usize,
    pub reopened_app: usize,
    pub reopened_cli: usize,
    pub reopen_failures: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopen_plan_id: Option<String>,
}
#[derive(Clone)]
struct ProcessInfo {
    pid: u32,
    parent: Option<u32>,
    started: u64,
    name: String,
    exe: Option<PathBuf>,
    cwd: Option<PathBuf>,
    args: Vec<OsString>,
}
#[derive(Clone)]
struct Package {
    location: PathBuf,
    aumid: String,
}
#[derive(Clone)]
enum Client {
    App {
        root: ProcessInfo,
        tree: Vec<ProcessInfo>,
        aumid: String,
    },
    Cli(ProcessInfo),
}
pub struct ClosedClients {
    entries: Vec<Client>,
    counts: ClientCounts,
}
impl ClosedClients {
    pub fn counts(&self) -> ClientCounts {
        self.counts.clone()
    }
}
struct RelaunchPlan {
    entries: Vec<Client>,
    scope: (PathBuf, PathBuf),
    expires: Instant,
}
static PLANS: LazyLock<Mutex<HashMap<String, RelaunchPlan>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
type TerminalSpawner = fn(&Path, &Path, &[OsString]) -> Result<(), String>;
static TERMINAL: OnceLock<TerminalSpawner> = OnceLock::new();
pub fn set_terminal_spawner(spawn: TerminalSpawner) {
    let _ = TERMINAL.set(spawn);
}
fn scope() -> Result<(PathBuf, PathBuf), String> {
    Ok((
        crate::modules::account::get_data_dir()?,
        crate::modules::codex_account::get_codex_home(),
    ))
}
fn has_ancestor(pid: u32, roots: &HashSet<u32>, processes: &[ProcessInfo]) -> bool {
    let mut seen = HashSet::new();
    let mut pid = Some(pid);
    while let Some(current) = pid {
        if roots.contains(&current) {
            return true;
        }
        if !seen.insert(current) {
            break;
        }
        pid = processes
            .iter()
            .find(|p| p.pid == current)
            .and_then(|p| p.parent);
    }
    false
}
fn interactive(args: &[OsString]) -> bool {
    const EXCLUDED: &[&str] = &[
        "app-server",
        "exec-server",
        "exec",
        "e",
        "review",
        "login",
        "logout",
        "mcp",
        "mcp-server",
        "completion",
        "completions",
        "debug",
        "sandbox",
        "apply",
        "a",
        "cloud",
        "features",
        "help",
        "pid-update-loop",
    ];
    !args
        .iter()
        .skip(1)
        .any(|arg| EXCLUDED.contains(&arg.to_string_lossy().as_ref()))
}
fn package_contains(path: &Path, location: &Path) -> bool {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_lowercase()
        .starts_with(&format!(
            "{}/",
            location
                .to_string_lossy()
                .replace('\\', "/")
                .trim_end_matches('/')
                .to_lowercase()
        ))
}
fn classify(
    processes: &[ProcessInfo],
    packages: &[Package],
    self_pid: u32,
) -> Result<Vec<Client>, String> {
    let mut clients = vec![];
    let mut app_roots = HashSet::new();
    let excluded = processes
        .iter()
        .filter(|p| p.pid == self_pid || p.name.eq_ignore_ascii_case("desko.exe"))
        .map(|p| p.pid)
        .collect::<HashSet<_>>();
    let app_pids = processes
        .iter()
        .filter(|p| {
            p.name.eq_ignore_ascii_case("chatgpt.exe")
                && p.exe.as_ref().is_some_and(|path| {
                    packages
                        .iter()
                        .any(|package| package_contains(path, &package.location))
                })
        })
        .map(|p| p.pid)
        .collect::<HashSet<_>>();
    for process in processes {
        if has_ancestor(process.pid, &excluded, processes)
            || process
                .parent
                .is_some_and(|parent| has_ancestor(parent, &app_pids, processes))
        {
            continue;
        }
        if !process.name.eq_ignore_ascii_case("chatgpt.exe") {
            continue;
        }
        let Some(path) = &process.exe else {
            return Err("无法检查 Codex 应用，请以相同权限运行 Desko 或手动退出后重试".into());
        };
        if let Some(package) = packages
            .iter()
            .find(|package| package_contains(path, &package.location))
        {
            if process.started == 0 {
                return Err("无法核验 Codex 应用进程身份，请手动退出后重试".into());
            }
            app_roots.insert(process.pid);
            let mut tree: Vec<ProcessInfo> = processes
                .iter()
                .filter(|p| has_ancestor(p.pid, &HashSet::from([process.pid]), processes))
                .cloned()
                .collect();
            tree.sort_by_key(|p| if p.pid == process.pid { 0 } else { 1 });
            clients.push(Client::App {
                root: process.clone(),
                tree,
                aumid: package.aumid.clone(),
            });
        } else if path
            .to_string_lossy()
            .to_lowercase()
            .contains("openai.codex_")
        {
            return Err("无法解析 Codex 应用标识，请手动退出后重试".into());
        }
    }
    for process in processes {
        if !process.name.eq_ignore_ascii_case("codex.exe")
            || has_ancestor(process.pid, &app_roots, processes)
            || has_ancestor(process.pid, &excluded, processes)
        {
            continue;
        }
        if process.started == 0 || process.exe.is_none() {
            return Err("无法检查 Codex CLI，请以相同权限运行 Desko 或手动退出后重试".into());
        }
        if process.args.is_empty() {
            let terminals = processes
                .iter()
                .filter(|p| {
                    [
                        "windowsterminal.exe",
                        "openconsole.exe",
                        "conhost.exe",
                        "cmd.exe",
                        "powershell.exe",
                        "pwsh.exe",
                        "bash.exe",
                    ]
                    .iter()
                    .any(|name| p.name.eq_ignore_ascii_case(name))
                })
                .map(|p| p.pid)
                .collect::<HashSet<_>>();
            if !has_ancestor(process.pid, &terminals, processes) {
                return Err("无法确定 Codex 是否为交互式 CLI，请手动退出后重试".into());
            }
        }
        if !interactive(&process.args) {
            continue;
        }
        if process.cwd.is_none() {
            return Err("无法读取 Codex CLI 的工作目录，请手动退出后重试".into());
        }
        clients.push(Client::Cli(process.clone()));
    }
    Ok(clients)
}
fn counts(clients: &[Client]) -> ClientCounts {
    ClientCounts {
        app_count: clients
            .iter()
            .filter(|c| matches!(c, Client::App { .. }))
            .count(),
        cli_count: clients
            .iter()
            .filter(|c| matches!(c, Client::Cli(_)))
            .count(),
    }
}
#[cfg(windows)]
fn enumerate() -> Result<Vec<Client>, String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    let processes = system
        .processes()
        .iter()
        .map(|(pid, p)| ProcessInfo {
            pid: pid.as_u32(),
            parent: p.parent().map(|p| p.as_u32()),
            started: if p.name().eq_ignore_ascii_case("codex.exe")
                || p.name().eq_ignore_ascii_case("chatgpt.exe")
            {
                process_identity(pid.as_u32()).ok().flatten().unwrap_or(0)
            } else {
                0
            },
            name: p.name().to_string_lossy().into_owned(),
            exe: p.exe().map(Path::to_path_buf),
            cwd: p.cwd().map(Path::to_path_buf),
            args: p.cmd().to_vec(),
        })
        .collect::<Vec<_>>();
    if processes.is_empty() {
        return Err("Windows 进程预览失败，请重试".into());
    }
    // No package lookup is needed on machines without a running desktop client.
    let packages = if processes
        .iter()
        .any(|p| p.name.eq_ignore_ascii_case("chatgpt.exe"))
    {
        packages()?
    } else {
        vec![]
    };
    classify(&processes, &packages, std::process::id())
}
#[cfg(not(windows))]
fn enumerate() -> Result<Vec<Client>, String> {
    Ok(vec![])
}
#[cfg(windows)]
fn packages() -> Result<Vec<Package>, String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    let script = r#"$ErrorActionPreference='Stop'; $items=@(Get-AppxPackage -Name OpenAI.Codex | Where-Object { $_.PackageFamilyName -eq 'OpenAI.Codex_2p2nqsd0c76g0' } | ForEach-Object { $p=$_; $m=Get-AppxPackageManifest -Package $p; $a=@($m.Package.Applications.Application | Where-Object { $_.Executable -like '*ChatGPT.exe' } | Select-Object -First 1); if($a.Count -eq 1){ @{location=$p.InstallLocation; aumid=($p.PackageFamilyName+'!'+$a[0].Id)} } }); ConvertTo-Json -InputObject $items -Compress"#;
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法读取 Codex 应用信息")?;
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|_| "无法读取 Codex 应用信息")?;
                if !output.status.success() {
                    return Err("无法读取 Codex 应用包，请手动退出 Codex 或重试".into());
                }
                let values: Vec<serde_json::Value> =
                    serde_json::from_slice(&output.stdout).map_err(|_| "Codex 应用包响应无效")?;
                return values
                    .iter()
                    .map(|value| {
                        Ok(Package {
                            location: PathBuf::from(
                                value["location"].as_str().ok_or("Codex 应用路径无效")?,
                            ),
                            aumid: value["aumid"].as_str().ok_or("Codex 应用标识无效")?.into(),
                        })
                    })
                    .collect();
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Codex 应用预览超时，请重试".into());
            }
        }
    }
}
pub fn preview() -> Result<ClientCounts, String> {
    enumerate().map(|clients| counts(&clients))
}
#[cfg(windows)]
struct ProcessHandle(windows::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
fn open_process(pid: u32, terminate: bool) -> Result<Option<ProcessHandle>, String> {
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };
    let access = if terminate {
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE
    } else {
        PROCESS_QUERY_LIMITED_INFORMATION
    };
    match unsafe { OpenProcess(access, false, pid) } {
        Ok(handle) => Ok(Some(ProcessHandle(handle))),
        Err(error) if error.code().0 as u32 == 0x80070057 => Ok(None), // PID no longer exists.
        Err(_) => Err("无法访问 Codex 进程，请以相同权限运行 Desko，或手动退出后重试".into()),
    }
}
#[cfg(windows)]
fn handle_identity(handle: &ProcessHandle) -> Result<Option<u64>, String> {
    use windows::Win32::{
        Foundation::FILETIME,
        System::Threading::{GetExitCodeProcess, GetProcessTimes},
    };
    let mut code = 0;
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe {
        GetExitCodeProcess(handle.0, &mut code).map_err(|_| "无法核验 Codex 进程状态")?;
        if code != 259 {
            return Ok(None);
        }
        GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user)
            .map_err(|_| "无法核验 Codex 进程身份")?;
    }
    Ok(Some(
        ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64,
    ))
}
#[cfg(windows)]
fn process_identity(pid: u32) -> Result<Option<u64>, String> {
    match open_process(pid, false)? {
        Some(handle) => handle_identity(&handle),
        None => Ok(None),
    }
}
#[cfg(windows)]
fn is_running(process: &ProcessInfo) -> Result<bool, String> {
    Ok(process_identity(process.pid)? == Some(process.started))
}
#[cfg(windows)]
fn terminate(process: &ProcessInfo) -> Result<(), String> {
    // Creation FILETIME and termination use the same kernel handle. A reused
    // PID must never turn into permission to stop an unrelated process.
    if let Some(handle) = open_process(process.pid, true)? {
        if handle_identity(&handle)? == Some(process.started) {
            unsafe {
                windows::Win32::System::Threading::TerminateProcess(handle.0, 1)
                    .map_err(|_| "无法关闭 Codex，请手动退出后重试")?;
            }
        }
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    while is_running(process)? && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(30));
    }
    if is_running(process)? {
        return Err("Codex 尚未退出，请手动关闭后重试".into());
    }
    Ok(())
}
#[cfg(windows)]
fn close_client(client: &Client) -> Result<(), String> {
    match client {
        Client::Cli(process) => terminate(process),
        Client::App { root, tree, .. } => {
            use windows::Win32::{
                Foundation::{BOOL, HWND, LPARAM},
                UI::WindowsAndMessaging::{
                    EnumWindows, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
                },
            };
            unsafe extern "system" fn close_window(window: HWND, data: LPARAM) -> BOOL {
                let mut pid = 0;
                GetWindowThreadProcessId(window, Some(&mut pid));
                if pid == data.0 as u32 {
                    let _ = PostMessageW(window, WM_CLOSE, None, None);
                }
                BOOL(1)
            }
            if is_running(root)? {
                unsafe {
                    let _ = EnumWindows(Some(close_window), LPARAM(root.pid as isize));
                }
            }
            let deadline = Instant::now() + Duration::from_secs(3);
            while is_running(root)? && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(30));
            }
            for process in tree.iter().rev() {
                terminate(process)?;
            }
            Ok(())
        }
    }
}
#[cfg(not(windows))]
fn close_client(_: &Client) -> Result<(), String> {
    Err("仅 Windows 支持重启 Codex 客户端".into())
}
fn root_running(client: &Client) -> bool {
    #[cfg(windows)]
    {
        is_running(match client {
            Client::Cli(p) => p,
            Client::App { root, .. } => root,
        })
        .unwrap_or(true)
    }
    #[cfg(not(windows))]
    {
        let _ = client;
        false
    }
}
fn close_with(
    clients: Vec<Client>,
    mut close: impl FnMut(&Client) -> Result<(), String>,
    running: impl Fn(&Client) -> bool,
    verify: impl FnOnce() -> Result<(), String>,
    mut rollback: impl FnMut(ClosedClients) -> ClientOutcome,
) -> Result<ClosedClients, String> {
    let mut closed = Vec::new();
    for client in clients {
        if let Err(error) = close(&client) {
            if !running(&client) {
                closed.push(client);
            }
            let restored = rollback(ClosedClients {
                counts: counts(&closed),
                entries: closed,
            });
            return Err(if restored.reopen_failures > 0 {
                format!("{error}；部分客户端未能恢复，请手动打开 Codex")
            } else {
                error
            });
        }
        closed.push(client);
    }
    if let Err(error) = verify() {
        let restored = rollback(ClosedClients {
            counts: counts(&closed),
            entries: closed,
        });
        return Err(if restored.reopen_failures > 0 {
            format!("{error}；部分客户端未能恢复，请手动打开 Codex")
        } else {
            error
        });
    }
    Ok(ClosedClients {
        counts: counts(&closed),
        entries: closed,
    })
}
pub fn close_running() -> Result<ClosedClients, String> {
    close_with(
        enumerate()?,
        close_client,
        root_running,
        || {
            if enumerate()?.is_empty() {
                Ok(())
            } else {
                Err("检测到仍在运行或新启动的 Codex，请手动退出后重试；尚未写入凭据".into())
            }
        },
        reopen,
    )
}
#[cfg(windows)]
fn launch(client: &Client) -> Result<(), String> {
    match client {
        Client::App { aumid, .. } => {
            use windows::{
                core::PCWSTR,
                Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
            };
            let target = format!("shell:AppsFolder\\{aumid}")
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>();
            let result = unsafe {
                ShellExecuteW(
                    None,
                    windows::core::w!("open"),
                    PCWSTR(target.as_ptr()),
                    None,
                    None,
                    SW_SHOWNORMAL,
                )
            };
            if result.0 as isize <= 32 {
                return Err("无法重新打开 Codex 应用".into());
            }
            Ok(())
        }
        Client::Cli(process) => {
            let dir = process.cwd.as_deref().ok_or("原工作目录不可用")?;
            let exe = process.exe.as_deref().ok_or("Codex CLI 路径不可用")?;
            let args = process.args.get(1..).unwrap_or_default();
            if let Some(spawn) = TERMINAL.get() {
                return spawn(dir, exe, args);
            }
            spawn_new_console(dir, exe, args)
        }
    }
}
#[cfg(not(windows))]
fn launch(_: &Client) -> Result<(), String> {
    Err("请手动打开 Codex".into())
}
pub fn spawn_new_console(dir: &Path, exe: &Path, args: &[OsString]) -> Result<(), String> {
    let mut command = std::process::Command::new(exe);
    command.current_dir(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000010);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|_| "无法在原工作目录重新打开 Codex CLI".into())
}
fn reopen_with(
    plan: &mut RelaunchPlan,
    mut spawn: impl FnMut(&Client) -> Result<(), String>,
) -> ClientOutcome {
    let mut outcome = ClientOutcome::default();
    plan.entries.retain(|client| match spawn(client) {
        Ok(()) => {
            match client {
                Client::App { .. } => outcome.reopened_app += 1,
                Client::Cli(_) => outcome.reopened_cli += 1,
            };
            false
        }
        Err(_) => {
            outcome.reopen_failures += 1;
            true
        }
    });
    outcome
}
pub fn reopen(closed: ClosedClients) -> ClientOutcome {
    let Ok(scope) = scope() else {
        return ClientOutcome {
            closed_app: closed.counts.app_count,
            closed_cli: closed.counts.cli_count,
            reopen_failures: closed.entries.len(),
            ..Default::default()
        };
    };
    let mut plan = RelaunchPlan {
        entries: closed.entries,
        scope,
        expires: Instant::now() + Duration::from_secs(600),
    };
    let mut outcome = reopen_with(&mut plan, launch);
    outcome.closed_app = closed.counts.app_count;
    outcome.closed_cli = closed.counts.cli_count;
    if !plan.entries.is_empty() {
        let id = uuid::Uuid::new_v4().to_string();
        let mut plans = PLANS.lock().unwrap_or_else(|e| e.into_inner());
        plans.retain(|_, p| p.expires > Instant::now());
        plans.insert(id.clone(), plan);
        outcome.reopen_plan_id = Some(id);
    }
    outcome
}
fn validate_plan(
    plan: &RelaunchPlan,
    current: &(PathBuf, PathBuf),
    now: Instant,
) -> Result<(), String> {
    if plan.expires <= now {
        return Err("重开计划已过期，请手动打开 Codex".into());
    }
    if &plan.scope != current {
        return Err("重开计划不属于当前档案，请手动打开 Codex".into());
    }
    Ok(())
}
pub fn relaunch(plan_id: &str) -> Result<ClientOutcome, String> {
    let current = scope()?;
    let mut plan = {
        let mut plans = PLANS.lock().map_err(|_| "无法读取重开计划")?;
        plans.retain(|_, plan| plan.expires > Instant::now());
        let plan = plans
            .get(plan_id)
            .ok_or("重开计划已过期，请手动打开 Codex")?;
        validate_plan(plan, &current, Instant::now())?;
        plans.remove(plan_id).unwrap()
    };
    let mut outcome = reopen_with(&mut plan, launch);
    if !plan.entries.is_empty() {
        outcome.reopen_plan_id = Some(plan_id.into());
        PLANS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(plan_id.into(), plan);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn process(pid: u32, parent: Option<u32>, name: &str, args: &[&str]) -> ProcessInfo {
        ProcessInfo {
            pid,
            parent,
            started: 1,
            name: name.into(),
            exe: Some(PathBuf::from(format!("C:/Codex/{name}"))),
            cwd: Some(PathBuf::from("C:/fixture")),
            args: args.iter().map(OsString::from).collect(),
        }
    }
    #[test]
    fn excludes_exec_ide_and_desko_descendants() {
        let processes = vec![
            process(1, None, "desko.exe", &[]),
            process(2, Some(1), "codex.exe", &["codex"]),
            process(3, None, "codex.exe", &["codex", "app-server"]),
            process(4, None, "codex.exe", &["codex", "exec", "fake"]),
            process(5, None, "codex.exe", &["codex", "resume"]),
            process(6, None, "codex.exe", &["codex"]),
            process(7, None, "not-codex.exe", &[]),
        ];
        let result = classify(&processes, &[], 1).unwrap();
        assert_eq!(counts(&result).cli_count, 2);
    }
    #[test]
    fn app_tree_is_one_app_and_excludes_children_from_cli() {
        let processes = vec![
            process(1, None, "ChatGPT.exe", &[]),
            process(2, Some(1), "ChatGPT.exe", &[]),
            process(3, Some(2), "codex.exe", &["codex"]),
            process(4, None, "codex.exe", &["codex"]),
        ];
        let packages = [Package {
            location: PathBuf::from("c:/CODEX"),
            aumid: "Fixture!App".into(),
        }];
        let result = classify(&processes, &packages, 99).unwrap();
        assert_eq!(counts(&result).app_count, 1);
        assert_eq!(counts(&result).cli_count, 1);
    }
    #[test]
    fn missing_executable_or_cwd_fails_closed_but_missing_argv_reopens_bare() {
        let mut p = process(2, Some(1), "codex.exe", &[]);
        assert_eq!(
            counts(&classify(&[process(1, None, "pwsh.exe", &[]), p.clone()], &[], 99).unwrap())
                .cli_count,
            1
        );
        let mut unknown = p.clone();
        unknown.parent = None;
        assert!(classify(&[unknown], &[], 99).is_err());
        p.cwd = None;
        assert!(classify(&[process(1, None, "pwsh.exe", &[]), p.clone()], &[], 99).is_err());
        p.cwd = Some("C:/fixture".into());
        p.exe = None;
        assert!(classify(&[p], &[], 99).is_err());
    }
    #[test]
    fn package_match_respects_directory_boundary() {
        assert!(package_contains(
            Path::new("C:/Codex/ChatGPT.exe"),
            Path::new("c:/codex")
        ));
        assert!(!package_contains(
            Path::new("C:/Codex-other/ChatGPT.exe"),
            Path::new("C:/Codex")
        ));
    }
    #[test]
    fn retry_only_retains_failed_entries_without_relaunching_successes() {
        let entries = vec![
            Client::Cli(process(1, None, "codex.exe", &["codex"])),
            Client::Cli(process(2, None, "codex.exe", &["codex"])),
        ];
        let mut plan = RelaunchPlan {
            entries,
            scope: ("fixture-data".into(), "fixture-home".into()),
            expires: Instant::now() + Duration::from_secs(600),
        };
        let first = reopen_with(&mut plan, |client| match client {
            Client::Cli(p) if p.pid == 1 => Ok(()),
            _ => Err("fixture failure".into()),
        });
        assert_eq!(
            (
                first.reopened_cli,
                first.reopen_failures,
                plan.entries.len()
            ),
            (1, 1, 1)
        );
        let mut retried = vec![];
        let second = reopen_with(&mut plan, |client| {
            if let Client::Cli(p) = client {
                retried.push(p.pid);
            }
            Ok(())
        });
        assert_eq!(retried, [2]);
        assert_eq!(second.reopened_cli, 1);
        assert!(plan.entries.is_empty());
    }
    #[test]
    fn public_outcomes_never_expose_process_paths_args_or_pids() {
        let value = serde_json::to_string(&ClientOutcome {
            reopen_plan_id: Some("random-plan".into()),
            ..Default::default()
        })
        .unwrap();
        for secret in ["pid", "argv", "cwd", "exe", "aumid"] {
            assert!(!value.contains(secret));
        }
    }
    #[test]
    fn close_failure_restores_closed_clients_and_does_not_claim_success() {
        let clients = (1..=3)
            .map(|pid| Client::Cli(process(pid, None, "codex.exe", &[])))
            .collect();
        let mut attempted = vec![];
        let mut restored = vec![];
        let result = close_with(
            clients,
            |client| {
                let Client::Cli(p) = client else {
                    unreachable!()
                };
                attempted.push(p.pid);
                if p.pid == 2 {
                    Err("access denied".into())
                } else {
                    Ok(())
                }
            },
            |_| true,
            || panic!("cannot verify success after failure"),
            |closed| {
                for entry in closed.entries {
                    if let Client::Cli(p) = entry {
                        restored.push(p.pid);
                    }
                }
                ClientOutcome::default()
            },
        );
        assert!(result.is_err());
        assert_eq!(attempted, [1, 2]);
        assert_eq!(restored, [1]);
    }
    #[test]
    fn a_root_that_exited_before_child_failure_is_also_restored() {
        let mut restored = 0;
        let result = close_with(
            vec![Client::Cli(process(1, None, "codex.exe", &[]))],
            |_| Err("child failed".into()),
            |_| false,
            || unreachable!(),
            |closed| {
                restored = closed.entries.len();
                ClientOutcome::default()
            },
        );
        assert!(result.is_err());
        assert_eq!(restored, 1);
    }
    #[test]
    fn new_clients_before_commit_abort_and_restore_previous_clients() {
        let mut restored = 0;
        let result = close_with(
            vec![Client::Cli(process(1, None, "codex.exe", &[]))],
            |_| Ok(()),
            |_| false,
            || Err("new process".into()),
            |closed| {
                restored = closed.entries.len();
                ClientOutcome::default()
            },
        );
        assert!(result.is_err());
        assert_eq!(restored, 1);
    }

    #[test]
    fn relaunch_plan_is_expiring_and_bound_to_both_profile_paths() {
        let current = (PathBuf::from("data-a"), PathBuf::from("home-a"));
        let now = Instant::now();
        let plan = RelaunchPlan {
            entries: vec![],
            scope: current.clone(),
            expires: now + Duration::from_secs(600),
        };
        assert!(validate_plan(&plan, &current, now).is_ok());
        assert!(validate_plan(&plan, &current, now + Duration::from_secs(600)).is_err());
        assert!(validate_plan(&plan, &("data-b".into(), "home-a".into()), now).is_err());
        assert!(validate_plan(&plan, &("data-a".into(), "home-b".into()), now).is_err());
    }
}
