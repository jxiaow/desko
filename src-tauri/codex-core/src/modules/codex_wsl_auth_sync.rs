// Explicit WSL account assignment. Discovery and previews are read-only;
// credentials enter the fixed WSL helper on stdin, never in argv or responses.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslTarget {
    pub distro: String,
    pub user: String,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslIdentity {
    pub account_id: Option<String>,
    pub email: String,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslCurrent {
    pub id: Option<String>,
    pub email: String,
}
#[derive(Debug, Clone, serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAssignment {
    pub targets: Vec<CodexWslTarget>,
    pub current: Option<CodexWslCurrent>,
    pub consistent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAssignmentPreview {
    pub targets: Vec<CodexWslTarget>,
    pub current: Option<CodexWslCurrent>,
    pub consistent: bool,
    pub daemon_count: usize,
    pub cli_count: usize,
    pub already_assigned: bool,
    pub can_apply: bool,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslFailure {
    pub distro: String,
    pub user: String,
    pub message: String,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslOutcome {
    pub status: String,
    pub targets: usize,
    pub written: usize,
    pub daemons_stopped: usize,
    pub clis_stopped: usize,
    pub failures: Vec<CodexWslFailure>,
}
#[derive(Clone)]
struct WslCodexHomeTarget {
    label: CodexWslTarget,
    linux_dir: String,
}
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WslProbe {
    identity: Option<CodexWslIdentity>,
    #[serde(default)]
    daemon_count: usize,
    #[serde(default)]
    cli_count: usize,
}
fn build_target_from_home(distro: &str, root: &Path, home: &Path) -> Option<WslCodexHomeTarget> {
    let relative = home.strip_prefix(root).ok()?;
    let parts = relative
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    let (user, linux_dir) = match parts.as_slice() {
        [root, codex] if root == "root" && codex == ".codex" => {
            ("root".into(), "/root/.codex".into())
        }
        [home, user, codex] if home == "home" && codex == ".codex" => {
            (user.clone(), format!("/home/{user}/.codex"))
        }
        _ => return None,
    };
    Some(WslCodexHomeTarget {
        label: CodexWslTarget {
            distro: distro.into(),
            user,
        },
        linux_dir,
    })
}
fn discover_wsl_codex_homes() -> Result<Vec<WslCodexHomeTarget>, String> {
    #[cfg(not(windows))]
    {
        Ok(vec![])
    }
    #[cfg(windows)]
    {
        let mut targets = vec![];
        for distro in crate::modules::codex_session_wsl::running_distributions()? {
            let root = PathBuf::from(format!(r"\\wsl.localhost\{distro}"));
            targets.extend(
                crate::modules::codex_session_wsl::codex_homes_in_root(&root)
                    .iter()
                    .filter_map(|home| build_target_from_home(&distro, &root, home)),
            );
        }
        Ok(targets)
    }
}
#[cfg(windows)]
fn run_wsl_assignment_action(
    target: &WslCodexHomeTarget,
    action: &str,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    use std::{
        io::Write,
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    if !matches!(action, "probe" | "stop" | "write-auth") {
        return Err("WSL 操作无效".into());
    }
    // Recheck running distros before each launch; a disappearing target must not
    // accidentally start a stopped distribution merely to copy credentials.
    if !crate::modules::codex_session_wsl::running_distributions()?.contains(&target.label.distro) {
        return Err("未检测到运行中的 WSL 目标".into());
    }
    let mut child = Command::new(crate::modules::codex_session_wsl::wsl_executable()?)
        .args([
            "-d",
            &target.label.distro,
            "-u",
            &target.label.user,
            "--exec",
            "python3",
            "-c",
            include_str!("../../resources/codex_wsl_daemon.py"),
            &target.linux_dir,
            action,
        ])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "无法启动 WSL Codex 操作，请确认已安装 Python 3")?;
    let input = child.stdin.take();
    let writer = std::thread::spawn(move || {
        if let (Some(mut input), Some(payload)) = (input, payload) {
            let _ = input.write_all(payload.to_string().as_bytes());
        }
    });
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|_| "无法读取 WSL 操作结果")?;
                let _ = writer.join();
                if !output.status.success() {
                    return Err("WSL 操作超时或失败，请手动退出 Codex 后重试".into());
                }
                let value: serde_json::Value =
                    serde_json::from_slice(&output.stdout).map_err(|_| "WSL 操作响应无效")?;
                if let Some(error) = value["error"].as_str() {
                    return Err(error.to_string());
                }
                return Ok(value);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                return Err("WSL 操作超时，请手动退出 Codex 后重试".into());
            }
        }
    }
}
#[cfg(not(windows))]
fn run_wsl_assignment_action(
    _: &WslCodexHomeTarget,
    _: &str,
    _: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err("仅 Windows 支持 WSL".into())
}
fn read_assignment_targets() -> Result<Vec<(WslCodexHomeTarget, WslProbe)>, String> {
    let targets = discover_wsl_codex_homes()?;
    let mut result = vec![];
    for chunk in targets.chunks(4) {
        let rows = std::thread::scope(|scope| {
            chunk
                .iter()
                .map(|target| {
                    scope.spawn(move || {
                        let value = run_wsl_assignment_action(target, "probe", None)?;
                        serde_json::from_value::<WslProbe>(value)
                            .map(|probe| (target.clone(), probe))
                            .map_err(|_| "WSL 预览响应无效".to_string())
                    })
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|thread| thread.join().map_err(|_| "WSL 预览失败".to_string())?)
                .collect::<Result<Vec<_>, String>>()
        })?;
        result.extend(rows);
    }
    Ok(result)
}
fn wsl_identities_match(left: &CodexWslIdentity, right: &CodexWslIdentity) -> bool {
    match (
        left.account_id.as_deref().filter(|s| !s.is_empty()),
        right.account_id.as_deref().filter(|s| !s.is_empty()),
    ) {
        (Some(a), Some(b)) => a == b,
        _ => !left.email.trim().is_empty() && left.email.eq_ignore_ascii_case(&right.email),
    }
}
fn account_wsl_identity(account: &CodexAccount) -> CodexWslIdentity {
    CodexWslIdentity {
        account_id: account.account_id.clone(),
        email: account.email.clone(),
    }
}
fn ordinary_oauth(account: &CodexAccount) -> bool {
    !account.is_api_key_auth()
        && !account.is_agent_identity_auth()
        && !account.is_web_session_auth()
}
fn consistent_wsl_identity(rows: &[(WslCodexHomeTarget, WslProbe)]) -> Option<CodexWslIdentity> {
    let identities = rows
        .iter()
        .map(|(_, probe)| probe.identity.as_ref())
        .collect::<Option<Vec<_>>>()?;
    let first = identities
        .iter()
        .find(|identity| {
            identity
                .account_id
                .as_deref()
                .is_some_and(|id| !id.is_empty())
        })
        .copied()
        .or_else(|| identities.first().copied())?;
    rows.iter()
        .all(|(_, probe)| {
            probe
                .identity
                .as_ref()
                .is_some_and(|identity| wsl_identities_match(first, identity))
        })
        .then(|| first.clone())
}
fn wsl_assignment_from_rows(rows: &[(WslCodexHomeTarget, WslProbe)]) -> CodexWslAssignment {
    let identity = consistent_wsl_identity(rows);
    let current = identity.as_ref().map(|identity| {
        let matched = list_accounts_checked().ok().and_then(|accounts| {
            accounts.into_iter().find(|account| {
                ordinary_oauth(account)
                    && wsl_identities_match(identity, &account_wsl_identity(account))
            })
        });
        CodexWslCurrent {
            id: matched.as_ref().map(|account| account.id.clone()),
            email: if identity.email.is_empty() {
                matched.map(|account| account.email).unwrap_or_default()
            } else {
                identity.email.clone()
            },
        }
    });
    CodexWslAssignment {
        targets: rows
            .iter()
            .map(|(target, _)| target.label.clone())
            .collect(),
        current,
        consistent: identity.is_some(),
        error: None,
    }
}
pub fn get_codex_wsl_assignment() -> CodexWslAssignment {
    match read_assignment_targets() {
        Ok(rows) => wsl_assignment_from_rows(&rows),
        Err(error) => CodexWslAssignment {
            error: Some(error),
            ..Default::default()
        },
    }
}
pub fn preview_codex_wsl_assignment(account_id: &str) -> Result<CodexWslAssignmentPreview, String> {
    let account = load_account(account_id).ok_or("账号不存在")?;
    let rows = read_assignment_targets()?;
    let assignment = wsl_assignment_from_rows(&rows);
    Ok(CodexWslAssignmentPreview {
        targets: assignment.targets,
        current: assignment.current,
        consistent: assignment.consistent,
        daemon_count: rows.iter().map(|(_, probe)| probe.daemon_count).sum(),
        cli_count: rows.iter().map(|(_, probe)| probe.cli_count).sum(),
        already_assigned: consistent_wsl_identity(&rows).is_some_and(|identity| {
            wsl_identities_match(&identity, &account_wsl_identity(&account))
        }),
        can_apply: ordinary_oauth(&account),
    })
}
fn write_wsl_targets_with(
    targets: &[WslCodexHomeTarget],
    payload: &serde_json::Value,
    expected: &CodexWslIdentity,
    mut action: impl FnMut(
        &WslCodexHomeTarget,
        &str,
        Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String>,
) -> CodexWslOutcome {
    let mut outcome = CodexWslOutcome {
        status: if targets.is_empty() {
            "skipped"
        } else {
            "done"
        }
        .into(),
        targets: targets.len(),
        written: 0,
        daemons_stopped: 0,
        clis_stopped: 0,
        failures: vec![],
    };
    for target in targets {
        match action(target, "stop", None) {
            Ok(value) => {
                outcome.daemons_stopped += value["daemonsStopped"].as_u64().unwrap_or(0) as usize;
                outcome.clis_stopped += value["clisStopped"].as_u64().unwrap_or(0) as usize;
            }
            Err(message) => {
                outcome.status = "aborted".into();
                outcome.failures.push(CodexWslFailure {
                    distro: target.label.distro.clone(),
                    user: target.label.user.clone(),
                    message,
                });
                return outcome;
            }
        }
    }
    for target in targets {
        let result = action(target, "write-auth", Some(payload.clone())).and_then(|value| {
            let actual: CodexWslIdentity = serde_json::from_value(value["identity"].clone())
                .map_err(|_| "WSL 写入后未读到账号身份")?;
            if !wsl_identities_match(expected, &actual) {
                return Err("WSL 写入后账号身份不一致，请重新执行「在 WSL 中使用」".into());
            }
            Ok(())
        });
        match result {
            Ok(()) => outcome.written += 1,
            Err(message) => outcome.failures.push(CodexWslFailure {
                distro: target.label.distro.clone(),
                user: target.label.user.clone(),
                message,
            }),
        }
    }
    if !outcome.failures.is_empty() {
        outcome.status = "partial".into();
    }
    outcome
}
fn apply_prepared_account_to_wsl(
    account: &CodexAccount,
    payload: serde_json::Value,
) -> CodexWslOutcome {
    let rows = match read_assignment_targets() {
        Ok(rows) => rows,
        Err(message) => {
            return CodexWslOutcome {
                status: "aborted".into(),
                targets: 0,
                written: 0,
                daemons_stopped: 0,
                clis_stopped: 0,
                failures: vec![CodexWslFailure {
                    distro: "WSL".into(),
                    user: String::new(),
                    message,
                }],
            }
        }
    };
    let expected = account_wsl_identity(account);
    if consistent_wsl_identity(&rows)
        .is_some_and(|identity| wsl_identities_match(&identity, &expected))
    {
        return CodexWslOutcome {
            status: "done".into(),
            targets: rows.len(),
            written: 0,
            daemons_stopped: 0,
            clis_stopped: 0,
            failures: vec![],
        };
    }
    let targets = rows
        .into_iter()
        .map(|(target, _)| target)
        .collect::<Vec<_>>();
    write_wsl_targets_with(&targets, &payload, &expected, run_wsl_assignment_action)
}
fn validate_wsl_auth_payload(
    account: &CodexAccount,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let auth: CodexAuthFile =
        serde_json::from_value(payload.clone()).map_err(|_| "OAuth 登录态无效")?;
    let tokens = auth.tokens.ok_or("此账号没有可写入 WSL 的 OAuth 登录态")?;
    if codex_oauth::is_token_expired(&tokens.access_token) {
        return Err("登录态已过期，请先切回或刷新账号；不会为 WSL 单独刷新当前账号令牌".into());
    }
    let id_info = extract_user_info(&tokens.id_token).ok();
    let (access_email, _, _, _, access_id, _) = extract_access_token_identity(&tokens.access_token);
    let source = CodexWslIdentity {
        account_id: normalize_optional_value(
            tokens
                .account_id
                .or(access_id)
                .or_else(|| id_info.as_ref().and_then(|info| info.4.clone())),
        ),
        email: id_info
            .map(|info| info.0)
            .or(access_email)
            .unwrap_or_default(),
    };
    if !wsl_identities_match(&account_wsl_identity(account), &source) {
        return Err("OAuth 登录态与所选账号不一致，请先切回该账号".into());
    }
    Ok(())
}
pub async fn assign_codex_account_to_wsl(account_id: &str) -> Result<CodexWslOutcome, String> {
    let _switch_guard = CODEX_ACCOUNT_SWITCH_LOCK
        .try_lock()
        .map_err(|_| "正在切换账号，请稍后重试")?;
    let account = load_account(account_id).ok_or("账号不存在")?;
    if !ordinary_oauth(&account) {
        return Err("仅普通 OAuth 账号可用于 WSL".into());
    }
    let token_lock = codex_token_lock_for(account_id);
    let _token_guard = token_lock.lock().await;
    let _file_guard = acquire_codex_token_refresh_file_lock(account_id, "wsl-assignment").await?;
    let (account, payload) =
        if load_account_index().current_account_id.as_deref() == Some(account_id) {
            let raw = fs::read_to_string(get_codex_home().join("auth.json"))
                .map_err(|_| "当前 Windows 官方登录态不可读，请先切回或刷新账号")?;
            let payload: serde_json::Value =
                serde_json::from_str(&raw).map_err(|_| "当前 Windows 官方登录态无效")?;
            validate_wsl_auth_payload(&account, &payload)?;
            (account, payload)
        } else {
            let prepared = prepare_account_switch_locked(account_id, true).await?;
            let PreparedCodexAccountSwitch::Account(account) = prepared else {
                return Err("仅普通 OAuth 账号可用于 WSL".into());
            };
            let payload = build_auth_file_value(&account)?;
            validate_wsl_auth_payload(&account, &payload)?;
            (account, payload)
        };
    let outcome =
        tokio::task::spawn_blocking(move || apply_prepared_account_to_wsl(&account, payload))
            .await
            .map_err(|_| "WSL 账号设置失败")?;
    if outcome.status == "skipped" {
        return Err("未检测到运行中的 WSL 目标，不会创建 .codex 目录".into());
    }
    Ok(outcome)
}

#[cfg(test)]
mod explicit_wsl_tests {
    use super::*;
    fn identity(id: Option<&str>, email: &str) -> CodexWslIdentity {
        CodexWslIdentity {
            account_id: id.map(str::to_string),
            email: email.into(),
        }
    }
    fn target(user: &str) -> WslCodexHomeTarget {
        WslCodexHomeTarget {
            label: CodexWslTarget {
                distro: "Fixture".into(),
                user: user.into(),
            },
            linux_dir: format!("/home/{user}/.codex"),
        }
    }
    #[test]
    fn workspace_identity_wins_over_same_email() {
        assert!(!wsl_identities_match(
            &identity(Some("one"), "same@fake"),
            &identity(Some("two"), "same@fake")
        ));
        assert!(wsl_identities_match(
            &identity(None, "SAME@fake"),
            &identity(Some("one"), "same@fake")
        ));
        assert!(!wsl_identities_match(
            &identity(None, ""),
            &identity(None, "")
        ));
    }
    #[test]
    fn all_targets_must_agree_even_when_first_has_no_strong_id() {
        let rows = vec![
            (
                target("legacy"),
                WslProbe {
                    identity: Some(identity(None, "same@fake")),
                    ..Default::default()
                },
            ),
            (
                target("one"),
                WslProbe {
                    identity: Some(identity(Some("one"), "same@fake")),
                    ..Default::default()
                },
            ),
            (
                target("two"),
                WslProbe {
                    identity: Some(identity(Some("two"), "same@fake")),
                    ..Default::default()
                },
            ),
        ];
        assert!(consistent_wsl_identity(&rows).is_none());
        assert!(consistent_wsl_identity(&[]).is_none());
        assert!(consistent_wsl_identity(&[(target("missing"), WslProbe::default())]).is_none());
    }
    #[test]
    fn every_target_stops_before_any_write_and_payload_is_reused() {
        let targets = [target("one"), target("two")];
        let payload = serde_json::json!({"tokens":{"access_token":"synthetic", "refresh_token":"same-prepared"}});
        let mut operations = vec![];
        let result = write_wsl_targets_with(
            &targets,
            &payload,
            &identity(Some("id"), "new@fake"),
            |target, action, input| {
                operations.push(format!("{action}:{}", target.label.user));
                if action == "stop" {
                    assert!(input.is_none());
                    Ok(serde_json::json!({"daemonsStopped":1,"clisStopped":2}))
                } else {
                    assert_eq!(input, Some(payload.clone()));
                    Ok(serde_json::json!({"identity":{"accountId":"id","email":"new@fake"}}))
                }
            },
        );
        assert_eq!(
            operations,
            ["stop:one", "stop:two", "write-auth:one", "write-auth:two"]
        );
        assert_eq!(
            (result.written, result.daemons_stopped, result.clis_stopped),
            (2, 2, 4)
        );
        assert_eq!(result.status, "done");
    }
    #[test]
    fn any_stop_failure_aborts_all_writes() {
        let mut operations = vec![];
        let result = write_wsl_targets_with(
            &[target("one"), target("two")],
            &serde_json::json!({}),
            &identity(Some("id"), "fake"),
            |target, action, _| {
                operations.push(action.to_string());
                if target.label.user == "two" {
                    Err("cannot stop".into())
                } else {
                    Ok(serde_json::json!({"clisStopped":1}))
                }
            },
        );
        assert_eq!(operations, ["stop", "stop"]);
        assert_eq!(result.status, "aborted");
        assert_eq!(result.written, 0);
        assert_eq!(result.clis_stopped, 1);
    }
    #[test]
    fn write_failure_keeps_success_and_readback_mismatch_fails_without_retry() {
        let mut writes = 0;
        let result = write_wsl_targets_with(
            &[target("one"), target("bad"), target("mismatch")],
            &serde_json::json!({}),
            &identity(Some("id"), "same@fake"),
            |target, action, _| {
                if action == "stop" {
                    return Ok(serde_json::json!({}));
                }
                writes += 1;
                match target.label.user.as_str() {
                    "bad" => Err("write failed".into()),
                    "mismatch" => Ok(
                        serde_json::json!({"identity":{"accountId":"other","email":"same@fake"}}),
                    ),
                    _ => Ok(serde_json::json!({"identity":{"accountId":"id","email":"same@fake"}})),
                }
            },
        );
        assert_eq!(writes, 3);
        assert_eq!(result.status, "partial");
        assert_eq!(result.written, 1);
        assert_eq!(result.failures.len(), 2);
    }
    #[test]
    fn no_targets_never_calls_helper() {
        let result = write_wsl_targets_with(
            &[],
            &serde_json::json!({}),
            &identity(None, "fake"),
            |_, _, _| panic!("must not execute"),
        );
        assert_eq!(result.status, "skipped");
    }
    #[test]
    fn discovery_accepts_only_default_existing_home_shapes() {
        let root = Path::new("fixture");
        assert_eq!(
            build_target_from_home("Ubuntu", root, &root.join("home/user/.codex"))
                .unwrap()
                .linux_dir,
            "/home/user/.codex"
        );
        assert_eq!(
            build_target_from_home("Ubuntu", root, &root.join("root/.codex"))
                .unwrap()
                .label
                .user,
            "root"
        );
        assert!(build_target_from_home("Ubuntu", root, &root.join("custom/.codex")).is_none());
        assert!(
            build_target_from_home("Ubuntu", root, &root.join("home/user/other/.codex")).is_none()
        );
    }
    #[test]
    fn current_windows_payload_is_validated_locally_without_refresh_or_projection() {
        use base64::Engine;
        let jwt = |value: serde_json::Value| {
            format!(
                "e30.{}.fixture",
                base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.to_string())
            )
        };
        let mut account = CodexAccount::new(
            "fixture".into(),
            "fake@example.invalid".into(),
            CodexTokens {
                id_token: String::new(),
                access_token: String::new(),
                refresh_token: None,
            },
        );
        account.account_id = Some("workspace".into());
        let payload = |expires: i64, workspace: &str| {
            serde_json::json!({"tokens":{
            "id_token":jwt(serde_json::json!({"email":"fake@example.invalid"})),
            "access_token":jwt(serde_json::json!({"exp":expires,"https://api.openai.com/auth":{"chatgpt_account_id":workspace}})),
            "refresh_token":"never-rotate-this", "account_id":workspace }})
        };
        let fresh = payload(chrono::Utc::now().timestamp() + 3600, "workspace");
        let before = fresh.clone();
        assert!(validate_wsl_auth_payload(&account, &fresh).is_ok());
        assert_eq!(fresh, before);
        assert!(validate_wsl_auth_payload(&account,&serde_json::json!({"tokens":{"access_token":"at-fixture","id_token":"", "account_id":"workspace"}})).is_ok());
        assert!(
            validate_wsl_auth_payload(&account, &payload(1, "workspace"))
                .unwrap_err()
                .contains("过期")
        );
        assert!(validate_wsl_auth_payload(
            &account,
            &payload(chrono::Utc::now().timestamp() + 3600, "other")
        )
        .unwrap_err()
        .contains("不一致"));
        assert!(validate_wsl_auth_payload(
            &account,
            &serde_json::json!({"auth_mode":"apikey","OPENAI_API_KEY":"synthetic"})
        )
        .is_err());
    }
}
