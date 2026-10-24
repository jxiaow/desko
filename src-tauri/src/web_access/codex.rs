//! Explicit browser adapters for existing Codex commands. Called under the Web session lease.
use super::bridge::arg;
use codex_core::commands::codex;
use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

fn value<T: Serialize>(result: Result<T, String>) -> Result<Value, String> {
    result.and_then(|v| serde_json::to_value(v).map_err(|_| "无法读取结果".into()))
}

pub(super) fn invoke(app: &AppHandle, command: &str, args: &Value) -> Result<Value, String> {
    match command {
        "list_codex_accounts" => value(tauri::async_runtime::block_on(Box::pin(
            codex::list_codex_accounts(),
        ))),
        "get_current_codex_account" => value(codex::get_current_codex_account()),
        "switch_codex_account" => value(tauri::async_runtime::block_on(Box::pin(
            codex::switch_codex_account(
                app.clone(),
                arg(args, "accountId")?,
                arg(args, "reauthTokenGeneration")?,
                Some(codex_core::modules::codex_account::CodexSwitchPolicy::default()),
            ),
        ))),
        "preview_codex_switch" => Ok(serde_json::json!({"windows":{"appCount":0,"cliCount":0},"wsl":null})),
        "refresh_codex_quota" => value(tauri::async_runtime::block_on(Box::pin(
            codex::refresh_codex_quota(app.clone(), arg(args, "accountId")?),
        ))),
        "refresh_codex_quotas_batch" => value(tauri::async_runtime::block_on(Box::pin(
            codex::refresh_codex_quotas_batch(
                app.clone(),
                arg(args, "accountIds")?,
                arg(args, "respectGroupQuotaRefresh")?,
                Some(false),
            ),
        ))),
        "refresh_codex_account_profile" => value(tauri::async_runtime::block_on(Box::pin(
            codex::refresh_codex_account_profile(arg(args, "accountId")?),
        ))),
        "refresh_codex_subscription_info" => value(tauri::async_runtime::block_on(Box::pin(
            codex::refresh_codex_subscription_info(app.clone(), arg(args, "accountId")?),
        ))),
        "force_refresh_codex_tokens" => value(tauri::async_runtime::block_on(Box::pin(
            codex::force_refresh_codex_tokens(arg(args, "accountId")?),
        ))),
        "get_codex_reset_credits" => value(tauri::async_runtime::block_on(Box::pin(
            codex::get_codex_reset_credits(arg(args, "accountId")?),
        ))),
        "consume_codex_reset_credit" => value(tauri::async_runtime::block_on(Box::pin(
            codex::consume_codex_reset_credit(arg(args, "accountId")?),
        ))),
        "delete_codex_account" => value(tauri::async_runtime::block_on(Box::pin(
            codex::delete_codex_account(arg(args, "accountId")?),
        ))),
        "start_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::start_codex_batch_delete(arg(args, "accountIds")?),
        ))),
        "get_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::get_codex_batch_delete(arg(args, "jobId")?),
        ))),
        "pause_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::pause_codex_batch_delete(arg(args, "jobId")?),
        ))),
        "resume_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::resume_codex_batch_delete(arg(args, "jobId")?),
        ))),
        "retry_failed_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::retry_failed_codex_batch_delete(arg(args, "jobId")?),
        ))),
        "clear_codex_batch_delete" => value(tauri::async_runtime::block_on(Box::pin(
            codex::clear_codex_batch_delete(arg(args, "jobId")?),
        ))),
        "list_codex_recycled_accounts" => value(tauri::async_runtime::block_on(Box::pin(
            codex::list_codex_recycled_accounts(),
        ))),
        "restore_codex_recycled_account" => value(tauri::async_runtime::block_on(Box::pin(
            codex::restore_codex_recycled_account(arg(args, "recycleId")?),
        ))),
        "delete_codex_recycled_account" => value(tauri::async_runtime::block_on(Box::pin(
            codex::delete_codex_recycled_account(arg(args, "recycleId")?),
        ))),
        "empty_codex_recycle_bin" => value(tauri::async_runtime::block_on(Box::pin(
            codex::empty_codex_recycle_bin(arg(args, "recycleIds")?),
        ))),
        "codex_oauth_login_start" => value(tauri::async_runtime::block_on(Box::pin(
            codex::codex_oauth_login_start(
                app.clone(),
                arg(args, "proxyUrl")?,
                arg(args, "reauthAccountId")?,
            ),
        ))),
        "codex_oauth_login_completed" => value(tauri::async_runtime::block_on(Box::pin(
            codex::codex_oauth_login_completed(
                arg(args, "loginId")?,
                arg(args, "reauthAccountId")?,
            ),
        ))),
        "codex_oauth_login_cancel" => value(codex::codex_oauth_login_cancel(
            app.clone(),
            arg(args, "loginId")?,
        )),
        "codex_oauth_submit_callback_url" => value(codex::codex_oauth_submit_callback_url(
            app.clone(),
            arg(args, "loginId")?,
            arg(args, "callbackUrl")?,
        )),
        "codex_oauth_device_auth_start" => value(tauri::async_runtime::block_on(Box::pin(
            codex::codex_oauth_device_auth_start(app.clone()),
        ))),
        "is_codex_oauth_port_in_use" => value(codex::is_codex_oauth_port_in_use()),
        "add_codex_account_with_api_key" => value(codex::add_codex_account_with_api_key(
            arg(args, "apiKey")?,
            arg(args, "apiBaseUrl")?,
            arg(args, "apiProviderMode")?,
            arg(args, "apiProviderId")?,
            arg(args, "apiProviderName")?,
            arg(args, "apiModelCatalog")?,
            arg(args, "apiSyncModelCatalogToCodex")?,
            arg(args, "apiWireApi")?,
            arg(args, "apiSupportsWebsockets")?,
            arg(args, "apiSupportsVision")?,
            arg(args, "apiModelVisionSupport")?,
            arg(args, "apiVisionRoutingModel")?,
            arg(args, "accountName")?,
            arg(args, "apiModelContextWindows")?,
        )),
        "import_codex_access_token_account" => value(tauri::async_runtime::block_on(Box::pin(
            codex::import_codex_access_token_account(
                app.clone(),
                arg(args, "name")?,
                arg(args, "accessToken")?,
            ),
        ))),
        "add_codex_account_with_token" => value(tauri::async_runtime::block_on(Box::pin(
            codex::add_codex_account_with_token(
                arg(args, "idToken")?,
                arg(args, "accessToken")?,
                arg(args, "refreshToken")?,
            ),
        ))),
        "update_codex_api_key_credentials" => value(tauri::async_runtime::block_on(Box::pin(
            codex::update_codex_api_key_credentials(
                arg(args, "accountId")?,
                arg(args, "apiKey")?,
                arg(args, "apiBaseUrl")?,
                arg(args, "apiProviderMode")?,
                arg(args, "apiProviderId")?,
                arg(args, "apiProviderName")?,
                arg(args, "apiModelCatalog")?,
                arg(args, "apiSyncModelCatalogToCodex")?,
                arg(args, "apiWireApi")?,
                arg(args, "apiSupportsWebsockets")?,
                arg(args, "apiSupportsVision")?,
                arg(args, "apiModelVisionSupport")?,
                arg(args, "apiVisionRoutingModel")?,
                arg(args, "accountName")?,
                arg(args, "apiModelContextWindows")?,
            ),
        ))),
        "import_codex_from_local" => value(tauri::async_runtime::block_on(Box::pin(
            codex::import_codex_from_local(app.clone(), arg(args, "instanceId")?),
        ))),
        "import_codex_from_json" => value(tauri::async_runtime::block_on(Box::pin(
            codex::import_codex_from_json(app.clone(), arg(args, "jsonContent")?),
        ))),
        "export_codex_accounts" => value(codex::export_codex_accounts(arg(args, "accountIds")?)),
        "get_codex_storage_paths" => value(tauri::async_runtime::block_on(Box::pin(
            codex::get_codex_storage_paths(),
        ))),
        "get_codex_history_visibility_provider" => {
            value(codex::get_codex_history_visibility_provider())
        }
        "codex_repair_session_visibility_for_launch_target" => {
            value(tauri::async_runtime::block_on(Box::pin(
                codex::codex_repair_session_visibility_for_launch_target(),
            )))
        }
        "codex_list_sessions_across_instances" => value(tauri::async_runtime::block_on(Box::pin(
            codex::codex_list_sessions_across_instances(
                arg(args, "titleQuery")?,
                arg(args, "contentQuery")?,
            ),
        ))),
        "codex_get_session_token_stats_across_instances" => {
            value(tauri::async_runtime::block_on(Box::pin(
                codex::codex_get_session_token_stats_across_instances(arg(args, "sessionIds")?),
            )))
        }
        "codex_query_session_usage" => value(tauri::async_runtime::block_on(Box::pin(
            codex::codex_query_session_usage(
                arg(args, "fromTimestamp")?,
                arg(args, "toTimestamp")?,
                arg(args, "windows")?,
            ),
        ))),
        "codex_move_sessions_to_trash_across_instances" => {
            value(tauri::async_runtime::block_on(Box::pin(
                codex::codex_move_sessions_to_trash_across_instances(arg(args, "sessionIds")?),
            )))
        }
        "codex_list_trashed_sessions_across_instances" => value(tauri::async_runtime::block_on(
            Box::pin(codex::codex_list_trashed_sessions_across_instances()),
        )),
        "codex_restore_sessions_from_trash_across_instances" => {
            value(tauri::async_runtime::block_on(Box::pin(
                codex::codex_restore_sessions_from_trash_across_instances(arg(args, "sessionIds")?),
            )))
        }
        "codex_delete_trashed_sessions_across_instances" => {
            value(tauri::async_runtime::block_on(Box::pin(
                codex::codex_delete_trashed_sessions_across_instances(arg(args, "sessionIds")?),
            )))
        }
        "codex_empty_session_trash_across_instances" => value(tauri::async_runtime::block_on(
            Box::pin(codex::codex_empty_session_trash_across_instances()),
        )),
        "update_codex_account_name" => value(codex::update_codex_account_name(
            arg(args, "accountId")?,
            arg(args, "name")?,
        )),
        "update_codex_account_tags" => value(tauri::async_runtime::block_on(Box::pin(
            codex::update_codex_account_tags(arg(args, "accountId")?, arg(args, "tags")?),
        ))),
        "update_codex_account_note" => value(tauri::async_runtime::block_on(Box::pin(
            codex::update_codex_account_note(
                arg(args, "accountId")?,
                arg(args, "note")?,
                arg(args, "twoFactorSecret")?,
                arg(args, "accountPassword")?,
                arg(args, "phoneNumber")?,
                arg(args, "mailUrl")?,
                arg(args, "chatgptAccountId")?,
            ),
        ))),
        _ => Err("Web 端不支持此 Codex 操作".into()),
    }
}
