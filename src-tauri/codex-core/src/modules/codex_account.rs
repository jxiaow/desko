// Codex 账号模块统一入口。
// 各业务分片只在完整顶层 item 之间切开，并通过 include! 保持同一模块作用域，
// 因此调用方无需改变，启动、切号、刷新、重新授权和导入行为保持一致。
include!("codex_account_provider.rs");
include!("codex_account_model_vision.rs");
include!("codex_account_check.rs");
include!("codex_account_model_catalog.rs");
include!("codex_account_context_management.rs");
include!("codex_account_storage_locks.rs");
include!("codex_account_token_refresh.rs");
include!("codex_account_revoked_access.rs");
include!("codex_account_index.rs");
include!("codex_account_lifecycle.rs");
include!("codex_account_recycle_bin.rs");
include!("codex_account_authority_sync.rs");
include!("codex_wsl_auth_sync.rs");
include!("codex_account_windows_auth_store.rs");
include!("codex_account_projection.rs");
include!("codex_account_runtime_switch.rs");
include!("codex_account_import.rs");

#[cfg(test)]
#[path = "codex_account_index_tests.rs"]
mod index_concurrency_tests;

#[cfg(test)]
mod tests {
    #[test]
    fn missing_account_details_preserve_the_index_and_do_not_create_a_directory() {
        let _env = crate::modules::test_support::env_lock().lock().unwrap_or_else(|e| e.into_inner());
        let root = std::env::temp_dir().join(format!("desko-missing-details-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        struct Cleanup(std::path::PathBuf, Option<std::ffi::OsString>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                match &self.1 {
                    Some(value) => std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", value),
                    None => std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR"),
                }
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(root.clone(), std::env::var_os("COCKPIT_TOOLS_TEST_DATA_DIR"));
        std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", &root);
        let content = serde_json::json!({
            "version":"1.0", "detail_schema_version":2, "current_account_id":"retained",
            "accounts":[{"id":"retained","email":"synthetic@example.invalid","created_at":0,"last_used":0}]
        }).to_string();
        std::fs::write(root.join("codex_accounts.json"), &content).unwrap();
        assert!(super::list_accounts_checked().is_err());
        assert_eq!(std::fs::read_to_string(root.join("codex_accounts.json")).unwrap(), content);
        assert!(!root.join("codex_accounts").exists());
    }

    #[test]
    fn model_catalog_save_keeps_models_without_the_removed_gateway() {
        let root = std::env::temp_dir().join(format!("desko-model-catalog-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let model = crate::models::codex::CodexExperimentalModelDefinition {
            model_id: "review-model".into(), display_name: "Review model".into(),
            reasoning_efforts: None, default_reasoning_effort: None,
            context_window: None, auto_compact_token_limit: None,
        };
        let config = super::save_model_catalog_for_base_dir_preserving_context(
            &root, true, vec![model], Some("review-model".into()),
        ).unwrap();
        assert!(config.experimental_model_catalog_models.iter().any(|model| model.model_id == "review-model"));
        assert!(!config.experimental_model_catalog_reset_models.is_empty());
        let reloaded = super::read_quick_config_from_config_toml(&root).unwrap();
        assert_eq!(reloaded.experimental_model_catalog_models, config.experimental_model_catalog_models);
        std::fs::remove_dir_all(root).unwrap();
    }
}

include!("codex_account_mutations_quota.rs");

include!("codex_account_grok_provider.rs");
