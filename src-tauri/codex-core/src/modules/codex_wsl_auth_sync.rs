// Windows 官方 Codex 登录凭据到运行中 WSL 发行版的单向同步。
// 只写目标目录的 auth.json，不碰 config.toml，也不代用户刷新 Token。

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAuthSource {
    pub available: bool,
    pub path: String,
    pub auth_mode: Option<String>,
    pub email: Option<String>,
    pub plan: Option<String>,
    pub access_expires_at: Option<i64>,
    pub expired: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAuthTarget {
    pub distro: String,
    pub user: String,
    pub home_path: String,
    pub state: String,
    pub email: Option<String>,
    pub access_expires_at: Option<i64>,
    pub expired: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAuthStatus {
    pub auto_sync: bool,
    pub source: CodexWslAuthSource,
    pub targets: Vec<CodexWslAuthTarget>,
    pub target_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexWslAuthSyncResult {
    pub distro: String,
    pub user: String,
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct WslAuthSourceMeta {
    identity: Option<CodexOfficialOAuthIdentity>,
    access_expires_at: Option<i64>,
}

#[derive(Debug, Clone)]
struct WslAuthSourceRead {
    source: CodexWslAuthSource,
    meta: Option<WslAuthSourceMeta>,
    payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
struct WslCodexHomeTarget {
    distro: String,
    user: String,
    linux_dir: String,
    dir: std::path::PathBuf,
}

#[derive(Debug, Clone)]
enum WslTargetAuthSnapshot {
    Missing,
    Unreadable,
    NonOAuth,
    OAuth {
        identity: Option<CodexOfficialOAuthIdentity>,
        access_expires_at: Option<i64>,
        expired: bool,
    },
}

impl WslTargetAuthSnapshot {
    fn email(&self) -> Option<String> {
        match self {
            Self::OAuth { identity, .. } => identity.as_ref().map(|identity| identity.email.clone()),
            _ => None,
        }
    }

    fn access_expires_at(&self) -> Option<i64> {
        match self {
            Self::OAuth {
                access_expires_at, ..
            } => *access_expires_at,
            _ => None,
        }
    }

    fn expired(&self) -> bool {
        match self {
            Self::OAuth { expired, .. } => *expired,
            _ => false,
        }
    }
}

fn blank_source(path: String) -> CodexWslAuthSource {
    CodexWslAuthSource {
        available: false,
        path,
        auth_mode: None,
        email: None,
        plan: None,
        access_expires_at: None,
        expired: false,
        error: None,
    }
}

fn unavailable_source(
    path: String,
    auth_mode: Option<String>,
    error: String,
) -> WslAuthSourceRead {
    let mut source = blank_source(path);
    source.auth_mode = auth_mode;
    source.error = Some(error);
    WslAuthSourceRead {
        source,
        meta: None,
        payload: None,
    }
}

fn oauth_identity_from_tokens(tokens: &CodexAuthTokens) -> Option<CodexOfficialOAuthIdentity> {
    // 与官方认证权威源复用同一套字段优先级，不能用邮箱代替工作区身份。
    build_local_oauth_snapshot(tokens.clone())
        .filter(|snapshot| !snapshot.email.trim().is_empty())
        .map(|snapshot| CodexOfficialOAuthIdentity {
            email: snapshot.email.trim().to_string(),
            user_id: snapshot.user_id,
            account_id: snapshot.account_id,
            organization_id: snapshot.organization_id,
        })
}

fn read_wsl_auth_source() -> WslAuthSourceRead {
    let path = get_auth_json_path();
    let path_text = path.to_string_lossy().to_string();
    let value = match read_configured_codex_auth_value(&get_codex_home()) {
        Ok(Some(value)) => value,
        Ok(None) => {
            return unavailable_source(
                path_text,
                None,
                "未找到 Windows 侧 Codex 登录凭据，请先在 Codex 中登录".to_string(),
            )
        }
        Err(error) => {
            return unavailable_source(
                path_text,
                None,
                format!("读取 Windows 侧 Codex 登录凭据失败: {}", error),
            )
        }
    };

    let auth_file = match serde_json::from_value::<crate::models::codex::CodexAuthFile>(value.clone())
    {
        Ok(auth_file) => auth_file,
        Err(_) => {
            return unavailable_source(
                path_text,
                None,
                "Windows 侧登录凭据格式无法识别".to_string(),
            )
        }
    };
    let auth_mode = auth_file
        .auth_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if auth_mode
        .as_deref()
        .is_some_and(|mode| !mode.eq_ignore_ascii_case("chatgpt"))
    {
        return unavailable_source(
            path_text,
            auth_mode,
            "当前 Windows 侧登录形态暂不支持同步".to_string(),
        );
    }
    let Some(tokens) = auth_file.tokens else {
        return unavailable_source(
            path_text,
            auth_mode,
            "当前 Windows 侧登录形态暂不支持同步".to_string(),
        );
    };
    if tokens.access_token.trim().is_empty() {
        return unavailable_source(
            path_text,
            auth_mode,
            "Windows 侧登录凭据缺少 access_token".to_string(),
        );
    }

    let identity = oauth_identity_from_tokens(&tokens);
    let email = identity.as_ref().map(|identity| identity.email.clone());
    let plan = normalize_optional_value(
        extract_user_info(&tokens.id_token)
            .ok()
            .and_then(|info| info.2)
            .or_else(|| extract_access_token_identity(&tokens.access_token).2),
    );
    let access_expires_at = codex_oauth::jwt_token_expiration_timestamp(&tokens.access_token);
    let expired = codex_oauth::is_token_expired(&tokens.access_token);
    let meta = WslAuthSourceMeta {
        identity,
        access_expires_at,
    };
    WslAuthSourceRead {
        source: CodexWslAuthSource {
            available: true,
            path: path_text,
            auth_mode,
            email,
            plan,
            access_expires_at,
            expired,
            error: None,
        },
        meta: Some(meta),
        payload: Some(value),
    }
}

fn build_target_from_home(
    distro: &str,
    root: &std::path::Path,
    home: &std::path::Path,
) -> Option<WslCodexHomeTarget> {
    let relative = home.strip_prefix(root).ok()?;
    let parts = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => {
                Some(value.to_string_lossy().into_owned())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    let (user, linux_dir) = match parts.as_slice() {
        [root_dir, codex_dir] if root_dir == "root" && codex_dir == ".codex" => {
            ("root".to_string(), "/root/.codex".to_string())
        }
        [home_dir, user, codex_dir] if home_dir == "home" && codex_dir == ".codex" => {
            (user.clone(), format!("/home/{}/.codex", user))
        }
        _ => return None,
    };
    Some(WslCodexHomeTarget {
        distro: distro.to_string(),
        user,
        linux_dir,
        dir: home.to_path_buf(),
    })
}

fn discover_wsl_codex_homes() -> Result<Vec<WslCodexHomeTarget>, String> {
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }

    #[cfg(windows)]
    {
        let distributions = crate::modules::codex_session_wsl::running_distributions()?;
        let mut targets = Vec::new();
        for distro in distributions {
            let root = std::path::PathBuf::from(format!(r"\\wsl.localhost\{}", distro));
            for home in crate::modules::codex_session_wsl::codex_homes_in_root(&root) {
                if let Some(target) = build_target_from_home(&distro, &root, &home) {
                    targets.push(target);
                }
            }
        }
        Ok(targets)
    }
}

fn read_target_snapshot(dir: &std::path::Path) -> WslTargetAuthSnapshot {
    let path = dir.join("auth.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return WslTargetAuthSnapshot::Missing
        }
        Err(_) => return WslTargetAuthSnapshot::Unreadable,
    };
    let Ok(auth_file) = serde_json::from_str::<crate::models::codex::CodexAuthFile>(&raw) else {
        return WslTargetAuthSnapshot::Unreadable;
    };
    let Some(tokens) = auth_file.tokens else {
        return WslTargetAuthSnapshot::NonOAuth;
    };
    if tokens.access_token.trim().is_empty() {
        return WslTargetAuthSnapshot::Unreadable;
    }
    WslTargetAuthSnapshot::OAuth {
        identity: oauth_identity_from_tokens(&tokens),
        access_expires_at: codex_oauth::jwt_token_expiration_timestamp(&tokens.access_token),
        expired: codex_oauth::is_token_expired(&tokens.access_token),
    }
}

fn classify_target(
    source: Option<&WslAuthSourceMeta>,
    snapshot: &WslTargetAuthSnapshot,
) -> &'static str {
    match snapshot {
        WslTargetAuthSnapshot::Missing => "empty",
        WslTargetAuthSnapshot::Unreadable => "unreadable",
        WslTargetAuthSnapshot::NonOAuth => "different-account",
        WslTargetAuthSnapshot::OAuth {
            identity,
            access_expires_at,
            ..
        } => {
            let Some(source) = source else {
                return "unknown";
            };
            let (Some(source_identity), Some(target_identity)) =
                (source.identity.as_ref(), identity.as_ref())
            else {
                return "unknown";
            };
            match compare_official_oauth_identity(target_identity, source_identity) {
                CodexOfficialOAuthIdentityMatch::Mismatched => return "different-account",
                CodexOfficialOAuthIdentityMatch::Unknown => return "unknown",
                CodexOfficialOAuthIdentityMatch::Matched => {}
            }
            match (source.access_expires_at, *access_expires_at) {
                (Some(source_exp), Some(target_exp)) if target_exp > source_exp => "newer",
                (Some(source_exp), Some(target_exp)) if target_exp == source_exp => "same",
                (Some(_), Some(_)) => "outdated",
                _ => "unknown",
            }
        }
    }
}

fn status_for_target(
    source: Option<&WslAuthSourceMeta>,
    target: &WslCodexHomeTarget,
) -> CodexWslAuthTarget {
    let snapshot = read_target_snapshot(&target.dir);
    CodexWslAuthTarget {
        distro: target.distro.clone(),
        user: target.user.clone(),
        home_path: target.dir.to_string_lossy().to_string(),
        state: classify_target(source, &snapshot).to_string(),
        email: snapshot.email(),
        access_expires_at: snapshot.access_expires_at(),
        expired: snapshot.expired(),
    }
}

fn configured_auto_sync() -> bool {
    crate::modules::config::get_user_config().codex_wsl_auth_auto_sync
}

pub fn get_codex_wsl_auth_status() -> CodexWslAuthStatus {
    let source = read_wsl_auth_source();
    let (targets, target_error) = match discover_wsl_codex_homes() {
        Ok(targets) => (
            targets
                .iter()
                .map(|target| status_for_target(source.meta.as_ref(), target))
                .collect(),
            None,
        ),
        Err(error) => (Vec::new(), Some(error)),
    };
    CodexWslAuthStatus {
        auto_sync: configured_auto_sync(),
        source: source.source,
        targets,
        target_error,
    }
}

fn validate_source_for_sync(source: &CodexWslAuthSource) -> Result<(), String> {
    if !source.available {
        return Err(source
            .error
            .clone()
            .unwrap_or_else(|| "Windows 侧 Codex 登录凭据不可用".to_string()));
    }
    if source.expired {
        return Err(
            "Windows 侧 Codex 登录凭据已过期，请先在 Codex 中刷新或重新登录".to_string(),
        );
    }
    Ok(())
}

fn write_auth_payload_to_dir(
    dir: &std::path::Path,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("序列化 Codex 登录凭据失败: {}", error))?;
    crate::modules::atomic_write::write_secret_string_atomic(
        &dir.join("auth.json"),
        &format!("{}\n", content),
    )
}

#[cfg(windows)]
fn restrict_wsl_auth_permissions(distro: &str, linux_dir: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let executable = crate::modules::codex_session_wsl::wsl_executable()?;
    let linux_path = format!("{}/auth.json", linux_dir);
    let mut child = Command::new(executable)
        .args(["-d", distro, "--", "chmod", "600", linux_path.as_str()])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 wsl.exe 失败: {}", error))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    return Ok(());
                }
                let output = child
                    .wait_with_output()
                    .map_err(|error| format!("读取 wsl.exe 输出失败: {}", error))?;
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(if stderr.trim().is_empty() {
                    format!("wsl.exe 退出: {}", status)
                } else {
                    stderr.trim().to_string()
                });
            }
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50));
            }
            status => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match status {
                    Err(error) => error.to_string(),
                    _ => "设置 WSL auth.json 权限超时".to_string(),
                });
            }
        }
    }
}

#[cfg(not(windows))]
fn restrict_wsl_auth_permissions(_distro: &str, _linux_dir: &str) -> Result<(), String> {
    Err("仅 Windows 支持 WSL".to_string())
}

fn sync_target(
    target: &WslCodexHomeTarget,
    meta: &WslAuthSourceMeta,
    payload: &serde_json::Value,
) -> CodexWslAuthSyncResult {
    let snapshot = read_target_snapshot(&target.dir);
    let state = classify_target(Some(meta), &snapshot);
    if matches!(state, "same" | "newer") {
        return CodexWslAuthSyncResult {
            distro: target.distro.clone(),
            user: target.user.clone(),
            status: "skipped".to_string(),
            message: Some(if state == "same" {
                "已是最新".to_string()
            } else {
                "WSL 侧凭据更新，已跳过".to_string()
            }),
        };
    }

    match write_auth_payload_to_dir(&target.dir, payload) {
        Ok(()) => {
            let mut notes = Vec::new();
            if state == "unreadable" {
                notes.push("原文件不可读，已替换".to_string());
            }
            if let Err(error) = restrict_wsl_auth_permissions(&target.distro, &target.linux_dir) {
                notes.push(format!("已写入，但 600 权限设置失败: {}", error));
            }
            crate::modules::logger::log_info(&format!(
                "[Codex WSL] 已同步登录凭据: distro={}, user={}, state={}",
                target.distro, target.user, state
            ));
            CodexWslAuthSyncResult {
                distro: target.distro.clone(),
                user: target.user.clone(),
                status: "synced".to_string(),
                message: if notes.is_empty() {
                    None
                } else {
                    Some(notes.join("；"))
                },
            }
        }
        Err(error) => {
            crate::modules::logger::log_warn(&format!(
                "[Codex WSL] 同步登录凭据失败: distro={}, user={}, error={}",
                target.distro, target.user, error
            ));
            CodexWslAuthSyncResult {
                distro: target.distro.clone(),
                user: target.user.clone(),
                status: "failed".to_string(),
                message: Some(error),
            }
        }
    }
}

pub fn sync_codex_auth_to_wsl() -> Result<Vec<CodexWslAuthSyncResult>, String> {
    let source = read_wsl_auth_source();
    validate_source_for_sync(&source.source)?;
    let (meta, payload) = match (source.meta.as_ref(), source.payload.as_ref()) {
        (Some(meta), Some(payload)) => (meta, payload),
        _ => return Err("Windows 侧 Codex 登录凭据不可用".to_string()),
    };
    let targets = discover_wsl_codex_homes()?;
    Ok(targets
        .iter()
        .map(|target| sync_target(target, meta, payload))
        .collect())
}

#[cfg(test)]
mod wsl_auth_sync_tests {
    use super::*;

    fn identity(email: &str) -> CodexOfficialOAuthIdentity {
        CodexOfficialOAuthIdentity {
            email: email.to_string(),
            user_id: None,
            account_id: None,
            organization_id: None,
        }
    }

    fn source_meta(email: &str, exp: i64) -> WslAuthSourceMeta {
        WslAuthSourceMeta {
            identity: Some(identity(email)),
            access_expires_at: Some(exp),
        }
    }

    fn oauth_snapshot(email: &str, exp: i64) -> WslTargetAuthSnapshot {
        WslTargetAuthSnapshot::OAuth {
            identity: Some(identity(email)),
            access_expires_at: Some(exp),
            expired: false,
        }
    }

    #[test]
    fn target_home_parsing_covers_root_and_regular_users() {
        let root = std::path::Path::new(r"\\wsl.localhost\Ubuntu-26.04");
        let user = build_target_from_home(
            "Ubuntu-26.04",
            root,
            &root.join("home").join("jxiaow").join(".codex"),
        )
        .expect("user target");
        assert_eq!(user.user, "jxiaow");
        assert_eq!(user.linux_dir, "/home/jxiaow/.codex");
        let root_target =
            build_target_from_home("Ubuntu-26.04", root, &root.join("root").join(".codex"))
                .expect("root target");
        assert_eq!(root_target.user, "root");
        assert_eq!(root_target.linux_dir, "/root/.codex");
        assert!(build_target_from_home("Ubuntu", root, &root.join("srv").join(".codex")).is_none());
    }

    #[test]
    fn target_state_matrix_prefers_skip_unless_source_is_newer() {
        let source = source_meta("a@example.invalid", 200);
        assert_eq!(
            classify_target(Some(&source), &WslTargetAuthSnapshot::Missing),
            "empty"
        );
        assert_eq!(
            classify_target(Some(&source), &WslTargetAuthSnapshot::Unreadable),
            "unreadable"
        );
        assert_eq!(
            classify_target(Some(&source), &WslTargetAuthSnapshot::NonOAuth),
            "different-account"
        );
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("b@example.invalid", 100)),
            "different-account"
        );
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("A@example.invalid", 200)),
            "same"
        );
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("a@example.invalid", 300)),
            "newer"
        );
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("a@example.invalid", 100)),
            "outdated"
        );
        assert_eq!(
            classify_target(None, &oauth_snapshot("a@example.invalid", 100)),
            "unknown"
        );
    }

    #[test]
    fn newer_tokens_for_different_strong_identities_are_not_skipped() {
        let mut source = source_meta("a@example.invalid", 200);
        source.identity.as_mut().unwrap().account_id = Some("personal".into());
        source.identity.as_mut().unwrap().user_id = Some("user".into());
        source.identity.as_mut().unwrap().organization_id = Some("org".into());

        for field in ["account_id", "user_id", "organization_id"] {
            let mut target_identity = source.identity.clone().unwrap();
            match field {
                "account_id" => target_identity.account_id = Some("team".into()),
                "user_id" => target_identity.user_id = Some("other-user".into()),
                "organization_id" => target_identity.organization_id = Some("other-org".into()),
                _ => unreachable!(),
            }
            let target = WslTargetAuthSnapshot::OAuth {
                identity: Some(target_identity),
                access_expires_at: Some(300),
                expired: false,
            };
            assert_eq!(classify_target(Some(&source), &target), "different-account", "{field}");
        }
    }

    #[test]
    fn incomplete_identity_is_unknown_instead_of_already_latest() {
        let mut source = source_meta("a@example.invalid", 200);
        let anonymous = WslTargetAuthSnapshot::OAuth {
            identity: None,
            access_expires_at: Some(300),
            expired: false,
        };
        assert_eq!(classify_target(Some(&source), &anonymous), "unknown");
        source.identity.as_mut().unwrap().account_id = Some("personal".into());
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("a@example.invalid", 300)),
            "unknown"
        );
        source.identity = None;
        assert_eq!(
            classify_target(Some(&source), &oauth_snapshot("a@example.invalid", 300)),
            "unknown"
        );
    }

    #[test]
    fn token_identity_uses_official_account_and_organization_precedence() {
        let jwt = |payload: serde_json::Value| {
            format!("e30.{}.synthetic", URL_SAFE_NO_PAD.encode(payload.to_string()))
        };
        let mut tokens = CodexAuthTokens {
            id_token: jwt(serde_json::json!({
                "email": "a@example.invalid",
                "https://api.openai.com/auth": {
                    "chatgpt_user_id": "user", "account_id": "id-account", "organization_id": "id-org"
                }
            })),
            access_token: jwt(serde_json::json!({
                "email": "a@example.invalid", "exp": 300,
                "https://api.openai.com/auth": {
                    "chatgpt_account_id": "access-account", "organization_id": "access-org"
                }
            })),
            refresh_token: None,
            account_id: Some("stored-account".into()),
        };
        let stored = oauth_identity_from_tokens(&tokens).unwrap();
        assert_eq!(stored.account_id.as_deref(), Some("stored-account"));
        assert_eq!(stored.organization_id.as_deref(), Some("access-org"));
        assert_eq!(stored.user_id.as_deref(), Some("user"));
        tokens.account_id = None;
        assert_eq!(
            oauth_identity_from_tokens(&tokens).unwrap().account_id.as_deref(),
            Some("access-account")
        );
        tokens.access_token = jwt(serde_json::json!({"exp": 300}));
        assert_eq!(
            oauth_identity_from_tokens(&tokens).unwrap().account_id.as_deref(),
            Some("id-account")
        );
        tokens.id_token = jwt(serde_json::json!({"email": "  "}));
        assert!(oauth_identity_from_tokens(&tokens).is_none());
    }

    #[test]
    fn matching_strong_identity_keeps_newer_wsl_credentials() {
        let mut source = source_meta("a@example.invalid", 200);
        source.identity.as_mut().unwrap().account_id = Some("account".into());
        let target = WslTargetAuthSnapshot::OAuth {
            identity: source.identity.clone(),
            access_expires_at: Some(300),
            expired: false,
        };
        assert_eq!(classify_target(Some(&source), &target), "newer");
    }

    #[test]
    fn expired_source_is_rejected_before_any_write() {
        let read = unavailable_source(
            "C:\\fake\\auth.json".to_string(),
            Some("chatgpt".to_string()),
            "missing".to_string(),
        );
        assert!(validate_source_for_sync(&read.source).is_err());

        let mut source = read.source;
        source.available = true;
        source.error = None;
        source.expired = true;
        let error = validate_source_for_sync(&source).expect_err("expired source must fail");
        assert!(error.contains("已过期"));
    }

    #[test]
    fn payload_write_replaces_auth_json_without_plaintext_backup() {
        let dir =
            std::env::temp_dir().join(format!("desko-wsl-auth-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("auth.json"), "{\"tokens\":\"old\"}").unwrap();
        let payload = serde_json::json!({
            "auth_mode": "chatgpt",
            "tokens": {"id_token": "id", "access_token": "access", "refresh_token": "refresh"}
        });
        write_auth_payload_to_dir(&dir, &payload).expect("write payload");
        let written = std::fs::read_to_string(dir.join("auth.json")).unwrap();
        assert!(written.contains("\"access_token\": \"access\""));
        assert!(!dir.join("auth.json.bak").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
