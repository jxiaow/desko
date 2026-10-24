// Explicit account-switch policy. Both entry points hold the existing switch
// lock through preparation, client shutdown, commit and optional WSL writes.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSwitchPolicy {
    pub restart_windows: bool,
    pub apply_to_wsl: bool,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSwitchPreview {
    pub windows: crate::modules::codex_clients::ClientCounts,
    pub wsl: Option<CodexWslAssignmentPreview>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub windows_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wsl_error: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSwitchOutcome {
    pub account: CodexAccount,
    pub windows: crate::modules::codex_clients::ClientOutcome,
    pub wsl: Option<CodexWslOutcome>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}
pub async fn preview_codex_switch(account_id: String) -> Result<CodexSwitchPreview, String> {
    let restart = crate::modules::config::get_user_config().codex_switch_restart_codex;
    let (windows, wsl) = tokio::join!(
        tokio::task::spawn_blocking(move || if restart {
            crate::modules::codex_clients::preview()
        } else {
            Ok(Default::default())
        }),
        tokio::task::spawn_blocking(move || preview_codex_wsl_assignment(&account_id)),
    );
    let windows = windows
        .map_err(|_| "Windows 预览失败".to_string())
        .and_then(|v| v);
    let wsl = wsl.map_err(|_| "WSL 预览失败".to_string()).and_then(|v| v);
    Ok(CodexSwitchPreview {
        windows: windows.clone().unwrap_or_default(),
        windows_error: windows.err(),
        wsl: wsl.clone().ok().filter(|w| !w.targets.is_empty()),
        wsl_error: wsl.err(),
    })
}
pub async fn switch_account_with_client_policy(
    account_id: &str,
    policy: CodexSwitchPolicy,
    reauth: Option<u64>,
    progress: impl Fn(&str) + Send + Sync,
) -> Result<CodexSwitchOutcome, String> {
    let _switch_guard = CODEX_ACCOUNT_SWITCH_LOCK
        .try_lock()
        .map_err(|_| "正在切换账号，请稍后重试")?;
    let initial = load_account_after_index_repair(account_id).ok_or("账号不存在")?;
    if policy.apply_to_wsl && !ordinary_oauth(&initial) {
        return Err("仅普通 OAuth 账号可用于 WSL".into());
    }
    sync_active_official_account_before_switch().await?;
    let token_id = if initial.is_api_key_auth() {
        initial
            .bound_oauth_account_id
            .as_deref()
            .unwrap_or(account_id)
    } else {
        account_id
    };
    let token_lock = codex_token_lock_for(token_id);
    let _token_guard = token_lock.lock().await;
    let _file_guard = acquire_codex_token_refresh_file_lock(token_id, "switch").await?;
    progress("credentials");
    let prepared = if let Some(generation) = reauth {
        prepare_freshly_reauthorized_account_switch_locked(account_id, generation).await?
    } else {
        prepare_account_switch_locked(account_id, true).await?
    };
    // Capture the exact prepared OAuth payload. Never refresh it a second time
    // after Windows has committed or after any WSL client has been stopped.
    let wsl_payload = if policy.apply_to_wsl {
        let PreparedCodexAccountSwitch::Account(account) = &prepared else {
            return Err("仅普通 OAuth 账号可用于 WSL".into());
        };
        let payload = build_auth_file_value(account)?;
        validate_wsl_auth_payload(account, &payload)?;
        Some((account.clone(), payload))
    } else {
        None
    };
    let closed = if policy.restart_windows {
        progress("closeWindows");
        Some(
            tokio::task::spawn_blocking(crate::modules::codex_clients::close_running)
                .await
                .map_err(|_| "关闭 Windows Codex 失败")??,
        )
    } else {
        None
    };
    progress("writeCredentials");
    let account = match commit_account_switch_credentials_locked(account_id, prepared) {
        Ok(account) => account,
        Err(error) => {
            if let Some(closed) = closed {
                let _ = tokio::task::spawn_blocking(move || {
                    crate::modules::codex_clients::reopen(closed)
                })
                .await;
            }
            return Err(error);
        }
    };
    let mut warnings = vec![];
    if let Err(error) =
        activate_provider_gateway_after_switch_if_needed(&get_codex_home(), &account).await
    {
        warnings.push(format!("账号已切换，但本地模型网关启动失败：{error}"));
    }
    let windows = if let Some(closed) = closed {
        progress("reopenWindows");
        let counts = closed.counts();
        tokio::task::spawn_blocking(move || crate::modules::codex_clients::reopen(closed))
            .await
            .unwrap_or_else(|_| crate::modules::codex_clients::ClientOutcome {
                closed_app: counts.app_count,
                closed_cli: counts.cli_count,
                reopen_failures: counts.app_count + counts.cli_count,
                ..Default::default()
            })
    } else {
        Default::default()
    };
    let wsl = if let Some((prepared_account, payload)) = wsl_payload {
        progress("applyWsl");
        Some(
            tokio::task::spawn_blocking(move || {
                apply_prepared_account_to_wsl(&prepared_account, payload)
            })
            .await
            .unwrap_or_else(|_| CodexWslOutcome {
                status: "aborted".into(),
                targets: 0,
                written: 0,
                daemons_stopped: 0,
                clis_stopped: 0,
                failures: vec![CodexWslFailure {
                    distro: "WSL".into(),
                    user: String::new(),
                    message: "账号已切换；WSL 未跟随，请重新执行「在 WSL 中使用」".into(),
                }],
            }),
        )
    } else {
        None
    };
    Ok(CodexSwitchOutcome {
        account,
        windows,
        wsl,
        warnings,
    })
}

pub async fn relaunch_codex_clients(
    plan_id: String,
) -> Result<crate::modules::codex_clients::ClientOutcome, String> {
    let _guard = CODEX_ACCOUNT_SWITCH_LOCK
        .try_lock()
        .map_err(|_| "正在切换账号，请稍后重试")?;
    tokio::task::spawn_blocking(move || crate::modules::codex_clients::relaunch(&plan_id))
        .await
        .map_err(|_| "重新打开 Codex 失败")?
}

#[cfg(test)]
mod explicit_switch_tests {
    use super::*;
    #[tokio::test]
    async fn manual_operations_share_one_nonqueueing_lock_before_any_account_io() {
        let _guard = CODEX_ACCOUNT_SWITCH_LOCK.lock().await;
        let error = switch_account_with_client_policy(
            "does-not-exist",
            CodexSwitchPolicy::default(),
            None,
            |_| panic!("must not prepare"),
        )
        .await
        .unwrap_err();
        assert!(error.contains("正在切换"));
        assert!(assign_codex_account_to_wsl("does-not-exist")
            .await
            .unwrap_err()
            .contains("正在切换"));
        assert!(relaunch_codex_clients("does-not-exist".into())
            .await
            .unwrap_err()
            .contains("正在切换"));
    }
}
