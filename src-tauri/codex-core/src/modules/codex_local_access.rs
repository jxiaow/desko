// 裁剪占位：原 codex_local_access 模块属于已移除能力（网关/代理/多开/他平台），
// 这里只保留被 Codex 账号核心引用到的签名，调用返回无副作用默认值。
#![allow(dead_code, unused_variables, unused_imports, unused_mut, clippy::all, unreachable_code)]
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow, Window};
use crate::models::account::*;
use crate::models::claude::*;
use crate::models::codebuddy::*;
use crate::models::codex::*;
use crate::models::codex_local_access::*;
use crate::models::cursor::*;
use crate::models::github_copilot::*;
use crate::models::grok::*;
use crate::models::instance::*;
use crate::models::kiro::*;
use crate::models::qoder::*;
use crate::models::quota::*;
use crate::models::ssh_server::*;
use crate::models::token::*;
use crate::models::trae::*;
use crate::models::windsurf::*;
use crate::models::workbuddy::*;
use crate::models::zcode::*;
use crate::models::zed::*;
pub(crate) use crate::models::codex_local_access::{CodexLocalAccessAccountModelRule, CodexLocalAccessCollection, CodexLocalAccessCustomRoutingRule, CodexLocalAccessModelAlias, CodexLocalAccessModelPricing, CodexLocalAccessRoutingStrategy};
use toml_edit::Document;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderGatewayModelSlot {
    pub(crate) client_model: String,
    pub(crate) upstream_model: String,
}


pub fn account_requires_bound_oauth_local_gateway(account: &CodexAccount) -> bool {
    false
}


pub fn account_requires_provider_gateway(account: &CodexAccount) -> bool {
    false
}


pub(crate) fn allocate_provider_model_slots(models: &[String]) -> Vec<ProviderGatewayModelSlot> {
    Vec::new()
}


pub(crate) fn apply_model_config_service_sections(
    collection: &mut CodexLocalAccessCollection,
    config: crate::models::codex::CodexModelConfigApiService,
) {
    ()
}


pub(crate) fn build_official_template_mapped_catalog_json(
    slots: &[ProviderGatewayModelSlot],
    official_catalog_json: &str,
) -> Result<String, String> {
    Ok(String::new())
}


pub(crate) fn build_provider_model_catalog_json(
    slots: &[ProviderGatewayModelSlot],
) -> Result<String, String> {
    Ok(String::new())
}


pub fn cleanup_provider_gateway_profile_model_overrides(profile_dir: &Path) -> Result<(), String> {
    Ok(())
}


pub fn collection_contains_account(account_id: &str) -> bool {
    false
}


pub(crate) fn decorate_account_catalog_context_windows(
    catalog_json: &str,
    slots: &[ProviderGatewayModelSlot],
    account: &CodexAccount,
    default_window: Option<i64>,
) -> Result<String, String> {
    Ok(String::new())
}


pub(crate) fn deepseek_official_shell_client_mappings() -> Vec<(String, String)> {
    Vec::new()
}


pub async fn ensure_bound_oauth_local_gateway_for_dir(
    profile_dir: &Path,
    account_id: &str,
) -> Result<(), String> {
    Ok(())
}


pub async fn ensure_provider_gateway_for_dir(
    profile_dir: &Path,
    account_id: &str,
) -> Result<(), String> {
    Ok(())
}


pub(crate) fn invalidate_codex_model_cache(profile_dir: &Path) -> Result<(), String> {
    Ok(())
}


pub(crate) fn is_codex_provider_shell_model_id(model: &str) -> bool {
    false
}


pub fn is_local_access_runtime_account_id(account_id: &str) -> bool {
    false
}


pub(crate) fn model_config_service_file_path() -> Result<PathBuf, String> {
    Ok(std::path::PathBuf::new())
}


pub(crate) fn model_config_service_sections(
    collection: &CodexLocalAccessCollection,
) -> crate::models::codex::CodexModelConfigApiService {
    Default::default()
}


pub(crate) fn normalize_model_config_service_sections(
    config: crate::models::codex::CodexModelConfigApiService,
    collection: &CodexLocalAccessCollection,
) -> crate::models::codex::CodexModelConfigApiService {
    Default::default()
}


pub fn notify_account_credentials_updated(account: &CodexAccount) {
    ()
}


pub(crate) fn overlay_rendered_pool_models_on_experimental_catalog(
    profile_dir: &Path,
    mut models: Vec<crate::models::codex::CodexExperimentalModelDefinition>,
) -> Vec<crate::models::codex::CodexExperimentalModelDefinition> {
    Vec::new()
}


pub(crate) fn provider_model_slots_for_account(
    account: &CodexAccount,
    models: &[String],
) -> Vec<ProviderGatewayModelSlot> {
    Vec::new()
}


pub(crate) async fn publish_model_config_service_import(
    app: &AppHandle,
    before: Option<crate::models::codex::CodexModelConfigApiService>,
    after: Option<CodexLocalAccessCollection>,
) {
    ()
}


pub(crate) fn read_file_model_context_window(path: &std::path::Path) -> Option<i64> {
    None
}


pub(crate) fn read_toml_model_context_window(doc: &Document) -> Option<i64> {
    None
}


pub async fn reevaluate_bound_oauth_quota_reserve_after_refresh(
    account_id: &str,
    refresh_succeeded: bool,
) {
    ()
}


pub(crate) fn refresh_api_service_experimental_model_ids() {
    ()
}


pub async fn release_instance_gateway_for_profile(profile_dir: &Path) -> Result<(), String> {
    Ok(())
}


pub(crate) fn reload_active_gateway_after_model_config_import(
    instance_id: String,
    revision: String,
) {
    ()
}


pub fn reload_provider_gateway_for_profile_in_background(
    profile_dir: PathBuf,
    account_id: String,
    reason: &'static str,
) {
    ()
}


pub async fn remove_deleted_accounts_from_local_access_pool(
    account_ids: &[String],
) -> Result<(), String> {
    Ok(())
}


pub fn replace_account_references_after_key_edit(old_id: &str, new_id: &str) -> Result<(), String> {
    Ok(())
}


pub async fn restore_instance_gateways_on_startup() {
    ()
}


pub async fn restore_local_access_gateway() {
    ()
}


pub async fn shutdown_local_access_gateway_for_app_exit() {
    ()
}


pub async fn stop_provider_gateways_for_profile(profile_dir: &Path) {
    ()
}


pub fn sync_sidecar_auth_file_for_account(account: &CodexAccount) -> Result<(), String> {
    Ok(())
}


pub fn trigger_gateway_reload_in_background(reason: &'static str) {
    ()
}
