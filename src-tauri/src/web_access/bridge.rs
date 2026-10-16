use super::{Backend, Resource};
use crate::{commands, error::AppError, AppState};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Manager};

const WEB_MODULE_KEYS: &[&str] = &["notes_enabled", "entries_enabled", "files_enabled", "mfa_enabled", "codex_enabled", "fileshare_enabled", "tunnel_enabled"];

fn require_module(state: &AppState, key: &str) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "无法读取模块设置")?;
    let stored = db.get_meta(key).map_err(|e| e.user_message())?;
    let enabled = if matches!(key, "notes_enabled" | "entries_enabled" | "files_enabled") {
        stored.as_deref() != Some("false")
    } else {
        stored.as_deref() == Some("true")
    };
    if enabled { Ok(()) } else { Err("模块未启用，请在设置的模块页打开开关".into()) }
}

#[cfg(test)]
mod module_tests {
    #[test]
    fn web_module_access_uses_desktop_defaults_and_live_switches() {
        let state = crate::test_state();
        for key in super::WEB_MODULE_KEYS {
            let default_on = matches!(*key, "notes_enabled" | "entries_enabled" | "files_enabled");
            assert_eq!(super::require_module(&state, key).is_ok(), default_on, "{key}");
            state.db.lock().unwrap().set_meta(key, "false").unwrap();
            assert!(super::require_module(&state, key).is_err(), "{key}");
            state.db.lock().unwrap().set_meta(key, "true").unwrap();
            assert!(super::require_module(&state, key).is_ok(), "{key}");
            state.db.lock().unwrap().set_meta(key, "false").unwrap();
            assert!(super::require_module(&state, key).is_err(), "{key}");
        }
    }
}

pub(super) struct AppBackend {
    app: AppHandle,
    vault: super::vault::WebVault,
    draft_key: Vec<u8>,
    events: Arc<super::events::WebEvents>,
}
impl AppBackend {
    pub(super) fn new(app: AppHandle) -> Result<Self, String> {
        let _lease = super::SESSION_GATE.read().map_err(|_| "Web 会话状态无法读取")?;
        let desktop = app.state::<AppState>();
        let vault = super::vault::WebVault::new(&desktop).map_err(|e| e.user_message())?;
        let events = super::events::WebEvents::new(app.clone());
        Ok(Self { app, vault, draft_key: crate::crypto::random_bytes(32), events })
    }
    fn state(&self) -> crate::command_state::CommandState<'_, AppState> {
        crate::command_state::CommandState::from_ref(&self.vault.state)
    }
}
pub(super) fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("参数 {key} 无效"))
}
pub(super) fn result<T: Serialize>(value: Result<T, AppError>) -> Result<Value, String> {
    value
        .map_err(|e| e.user_message())
        .and_then(|v| serde_json::to_value(v).map_err(|_| "无法读取结果".into()))
}
fn bytes(bytes: Vec<u8>, mime: &str) -> Resource {
    Resource {
        bytes,
        mime: mime.into(),
        download: false,
        file: None,
    }
}
fn image_mime(name: &str) -> Option<&'static str> {
    match name.rsplit('.').next()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}
/// Canonicalize both ends: `..`, absolute paths, junctions and symlinks cannot escape a saved root.
fn within(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path
        .components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
        || relative.contains('\\')
        || relative.contains(':')
    {
        return Err("路径超出收藏目录".into());
    }
    let root = root
        .canonicalize()
        .map_err(|_| "收藏路径不存在或不可访问")?;
    let target = root
        .join(path)
        .canonicalize()
        .map_err(|_| "文件不存在或不可访问")?;
    if !target.starts_with(&root) {
        return Err("路径超出收藏目录".into());
    }
    Ok(target)
}
impl Backend for AppBackend {
    fn public_hosts(&self, port: u16) -> Vec<String> {
        let state = self.app.state::<AppState>();
        let Ok(db) = state.db.lock() else { return Vec::new(); };
        if db.get_meta("tunnel_enabled").ok().flatten().as_deref() != Some("true") {
            return Vec::new();
        }
        db.list_tunnel_services().unwrap_or_default().into_iter()
            .filter(|service| service.routed && service.port == i64::from(port))
            .map(|service| service.hostname).collect()
    }
    fn epoch(&self) -> Option<u64> {
        self.vault.epoch()
    }
    fn verify_password(&self, password: &str) -> Result<(), String> {
        let epoch = self.epoch().ok_or("Web 服务已失效，请在桌面端重新启动服务")?;
        super::with_session_epoch(epoch, || self.epoch(), || {
            self.vault.verify_password(password).map_err(|e| e.user_message())
        })
    }
    fn fork_session(&self) -> Result<Option<Arc<dyn Backend>>, String> {
        let _lease = super::SESSION_GATE.read().map_err(|_| "Web 会话状态无法读取")?;
        if self.epoch().is_none() { return Err("Web 服务已失效，请在桌面端重新启动服务".into()); }
        let vault = super::vault::WebVault::new(&self.vault.state).map_err(|e| e.user_message())?;
        Ok(Some(Arc::new(Self { app: self.app.clone(), vault, draft_key: self.draft_key.clone(), events: self.events.clone() })))
    }
    fn invoke(&self, command: &str, args: Value, expected_epoch: u64) -> Result<Value, String> {
        macro_rules! call { ($module:ident::$name:ident $(, $key:literal)* ) => {{
            // Pending drafts and key revocation must still finish after a module closes.
            if !matches!(stringify!($name), "stage_note_drafts" | "note_key_relock") {
                self.require_module(match stringify!($module) {
                    "notes" | "note_lock" => "notes_enabled",
                    "entries" | "url_paths" => "entries_enabled",
                    "mfa" => "mfa_enabled",
                    _ => return Err("Web 端不支持此操作".into()),
                })?;
            }
            result(commands::$module::$name(self.state() $(, arg(&args, $key)?)*))
        }}; }
        // A favicon fetch can wait on a remote server. It neither mutates local
        // credentials nor returns secrets; the HTTP layer rechecks its session.
        if command == "favicon_get" {
            self.require_module("entries_enabled")?;
            return Ok(json!(tauri::async_runtime::block_on(
                commands::favicons::favicon_get(arg(&args, "url")?)
            )
            .and_then(|p| Path::new(&p)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned()))));
        }
        super::with_session_epoch(
            expected_epoch,
            || self.epoch(),
            || {
                if crate::is_codex_command(command) {
                    crate::authorize_codex(&self.vault.state).map_err(str::to_string)?;
                    if command == "web_codex_read_session" {
                        let path = codex_core::modules::codex_session_manager::resolve_session_rollout_path(arg(&args, "sessionId")?)?;
                        let file = std::fs::File::open(path).map_err(|_| "无法读取会话文件")?;
                        use std::io::Read;
                        let mut content = String::new();
                        file.take(16 * 1024 * 1024 + 1).read_to_string(&mut content).map_err(|_| "无法读取会话文件")?;
                        if content.len() > 16 * 1024 * 1024 { return Err("会话文件超过 16 MiB，请在桌面端打开".into()); }
                        return Ok(json!(content));
                    }
                    return super::codex::invoke(&self.app, command, &args);
                }
                if command.starts_with("fileshare_") || command.starts_with("tunnel_") {
                    let key = if command.starts_with("fileshare_") { "fileshare_enabled" } else { "tunnel_enabled" };
                    if !matches!(command, "fileshare_stop" | "tunnel_stop") { self.require_module(key)?; }
                    return super::network::invoke(&self.app, command, &args);
                }
                // Native paths, arbitrary process launch, backups and profiles stay outside this list.
                match command {
                    "web_poll_events" => Ok(self.events.since(arg(&args, "after")?)),
                    "get_setting" | "set_setting" => {
                        let key: String = arg(&args, "key")?;
                        if !WEB_MODULE_KEYS.contains(&key.as_str()) {
                            return Err("请在桌面端修改此设置".into());
                        }
                        let db = self.vault.state.db.lock().map_err(|_| "无法读取模块设置")?;
                        if command == "get_setting" { return result(db.get_meta(&key).map(|v| v.unwrap_or_default())); }
                        let value: String = arg(&args, "value")?;
                        if !matches!(value.as_str(), "true" | "false") { return Err("模块开关无效".into()); }
                        db.set_meta(&key, &value).map_err(|e| e.user_message())?;
                        drop(db);
                        commands::settings::notify_module_change(&self.app, &key, &value);
                        Ok(Value::Null)
                    }
                    "list_notes" => call!(notes::list_notes),
                    "create_note" => call!(notes::create_note, "input"),
                    "update_note" => call!(notes::update_note, "id", "input"),
                    "delete_note" => call!(notes::delete_note, "id"),
                    "batch_delete_notes" => call!(notes::batch_delete_notes, "ids"),
                    "toggle_pin_note" => call!(notes::toggle_pin_note, "id"),
                    "toggle_star_note" => call!(notes::toggle_star_note, "id"),
                    "set_note_archived" => call!(notes::set_note_archived, "id", "archived"),
                    "batch_set_archived" => call!(notes::batch_set_archived, "ids", "archived"),
                    "stage_note_drafts" => call!(notes::stage_note_drafts, "drafts"),
                    "recover_note_drafts" => call!(notes::recover_note_drafts),
                    "note_key_status" => call!(note_lock::note_key_status),
                    "note_key_recover" => call!(note_lock::note_key_recover),
                    "note_key_setup" => { self.require_module("notes_enabled")?; result(commands::note_lock::note_key_setup_with_state(&self.vault.state, arg(&args, "passphrase")?)) },
                    "note_key_change" => { self.require_module("notes_enabled")?; result(commands::note_lock::note_key_change_with_state(&self.vault.state, arg(&args, "passphrase")?)) },
                    "note_key_relock" => call!(note_lock::note_key_relock),
                    "note_key_unlock" => { self.require_module("notes_enabled")?; result(commands::note_lock::note_key_unlock_with_state(&self.vault.state, arg(&args, "passphrase")?)) },
                    "lock_note" => call!(note_lock::lock_note, "id"),
                    "unlock_note" => call!(note_lock::unlock_note, "id"),
                    "relock_note" => call!(note_lock::relock_note, "id"),
                    "remove_note_lock" => call!(note_lock::remove_note_lock, "id", "input"),
                    "reveal_note" => call!(note_lock::reveal_note, "id"),
                    "list_attachments" => {
                        self.require_module("notes_enabled")?;
                        let id: String = arg(&args, "noteId")?;
                        self.vault.require_note_access(&id).map_err(|e| e.user_message())?;
                        result(commands::notes::list_attachments(self.state(), id))
                    }
                    "bind_attachments" => {
                        self.require_module("notes_enabled")?;
                        let id: String = arg(&args, "noteId")?;
                        let paths: Vec<String> = arg(&args, "paths")?;
                        self.vault.require_note_access(&id).map_err(|e| e.user_message())?;
                        for path in &paths {
                            let name = crate::services::attachment_service::name_of(path).ok_or("图片路径无效")?;
                            self.vault.require_attachment_access(&name).map_err(|e| e.user_message())?;
                        }
                        result(commands::notes::bind_attachments(self.state(), id, paths))
                    }
                    "delete_attachment" => {
                        self.require_module("notes_enabled")?;
                        let id: String = arg(&args, "id")?;
                        let attachment = self.vault.state.db.lock().map_err(|_| "无法读取附件")?.get_attachment(&id).map_err(|e| e.user_message())?;
                        if let Some(attachment) = attachment {
                            self.vault.require_note_access(&attachment.note_id).map_err(|e| e.user_message())?;
                        }
                        result(commands::notes::delete_attachment(self.state(), id))
                    }
                    "save_attachment_bytes" => self.upload(&args),
                    "web_seal_draft" => result(super::drafts::seal(
                        &self.draft_key,
                        arg(&args, "plaintext")?,
                    )),
                    "web_open_draft" => {
                        result(super::drafts::open(&self.draft_key, arg(&args, "sealed")?))
                    }
                    "list_entries" => call!(entries::list_entries),
                    "list_entries_with_paths" => call!(entries::list_entries_with_paths),
                    "create_entry" => call!(entries::create_entry, "input"),
                    "update_entry" => call!(entries::update_entry, "id", "input"),
                    "delete_entry" => call!(entries::delete_entry, "id"),
                    "batch_delete_entries" => call!(entries::batch_delete_entries, "ids"),
                    "get_password" => call!(entries::get_password, "id"),
                    "list_url_paths" => call!(url_paths::list_url_paths, "entryId"),
                    "create_url_path" => call!(url_paths::create_url_path, "input"),
                    "update_url_path" => call!(url_paths::update_url_path, "id", "input"),
                    "delete_url_path" => call!(url_paths::delete_url_path, "id"),
                    "list_file_shortcuts" => { self.require_module("files_enabled")?; result(
                        commands::file_shortcuts::list_file_shortcuts(self.state()).map(
                            |mut shortcuts| {
                                for shortcut in &mut shortcuts {
                                    shortcut.path.clear();
                                }
                                shortcuts
                            },
                        ),
                    ) },
                    "mfa_add_uri" => call!(mfa::mfa_add_uri, "uri"),
                    "mfa_add_manual" => call!(mfa::mfa_add_manual, "label", "issuer", "secret"),
                    "mfa_codes" => call!(mfa::mfa_codes),
                    "mfa_remove" => call!(mfa::mfa_remove, "id"),
                    _ => Err("Web 端不支持此操作，请在桌面端处理".into()),
                }
            },
        )
    }
    fn asset(&self, path: &str) -> Option<Resource> {
        let asset = self.app.asset_resolver().get(path.to_string())?;
        Some(bytes(asset.bytes, &asset.mime_type))
    }
    fn private_resource(&self, path: &str) -> Result<Resource, String> {
        let url =
            reqwest::Url::parse(&format!("http://localhost{path}")).map_err(|_| "路径无效")?;
        if let Some(name) = url.path().strip_prefix("/api/attachments/") {
            self.require_module("notes_enabled")?;
            let name = crate::webdav::percent_decode(name);
            self.vault.require_attachment_access(&name).map_err(|e| e.user_message())?;
            return self.image(
                &crate::paths::attachments_dir(),
                &name,
                false,
            );
        }
        if let Some(name) = url.path().strip_prefix("/api/favicons/") {
            self.require_module("entries_enabled")?;
            return self.image(
                &crate::services::favicon_service::favicons_dir(),
                &crate::webdav::percent_decode(name),
                true,
            );
        }
        let id = url.path().strip_prefix("/api/files/").ok_or("资源不存在")?;
        self.require_module("files_enabled")?;
        let shortcuts = commands::file_shortcuts::list_file_shortcuts(self.state())
            .map_err(|e| e.user_message())?;
        let shortcut = shortcuts
            .iter()
            .find(|s| s.id == id)
            .ok_or("文件收藏不存在")?;
        let relative = url
            .query_pairs()
            .find(|(k, _)| k == "path")
            .map(|(_, v)| v.into_owned())
            .unwrap_or_default();
        let root = Path::new(&shortcut.path);
        let target = if shortcut.shortcut_type == "folder" {
            within(root, &relative)?
        } else {
            if !relative.is_empty() {
                return Err("文件收藏不包含子目录".into());
            }
            root.canonicalize().map_err(|_| "文件不存在或不可访问")?
        };
        if target.is_dir() {
            let mut entries = Vec::new();
            for entry in std::fs::read_dir(&target)
                .map_err(|_| "无法读取目录")?
                .take(10_001)
            {
                if entries.len() >= 10_000 {
                    return Err("目录包含超过一万项，请在桌面端打开".into());
                }
                let Ok(entry) = entry else { continue };
                let Ok(canonical) = entry.path().canonicalize() else {
                    continue;
                };
                let Ok(canonical_root) = root.canonicalize() else {
                    continue;
                };
                if !canonical.starts_with(canonical_root) {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_dir() && !meta.is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                let child = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{relative}/{name}")
                };
                entries.push(
                    json!({"name":name,"path":child,"directory":meta.is_dir(),"size":meta.len()}),
                );
            }
            entries.sort_by(|a, b| {
                b["directory"]
                    .as_bool()
                    .cmp(&a["directory"].as_bool())
                    .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
            });
            return Ok(bytes(
                json!({"name":shortcut.name,"path":relative,"entries":entries})
                    .to_string()
                    .into_bytes(),
                "application/json",
            ));
        }
        if !target.is_file() {
            return Err("仅支持普通文件".into());
        }
        Ok(Resource {
            bytes: Vec::new(),
            mime: "application/octet-stream".into(),
            download: true,
            file: Some(std::fs::File::open(target).map_err(|_| "无法读取文件")?),
        })
    }
    fn import_shared_file(&self, path: &Path, name: &str, index: usize, epoch: u64) -> Result<Value, String> {
        super::with_session_epoch(epoch, || self.epoch(), || {
            self.require_module("fileshare_enabled")?;
            super::network::import_file(&self.app, path, name, index)
        })
    }
}
fn image_path(dir: &Path, name: &str, allow_svg: bool) -> Result<(PathBuf, &'static str), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains('%')
        || name.starts_with('.')
        || name.contains(':')
    {
        return Err("图片路径无效".into());
    }
    let mime = image_mime(name).ok_or("不支持此图片类型")?;
    if !allow_svg && mime == "image/svg+xml" {
        return Err("不支持此图片类型".into());
    }
    Ok((within(dir, name)?, mime))
}
impl AppBackend {
    fn require_module(&self, key: &str) -> Result<(), String> {
        require_module(&self.vault.state, key)
    }
    fn image(&self, dir: &Path, name: &str, allow_svg: bool) -> Result<Resource, String> {
        let (path, mime) = image_path(dir, name, allow_svg)?;
        let metadata = path.metadata().map_err(|_| "图片不存在")?;
        if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
            return Err("图片过大".into());
        }
        Ok(bytes(
            std::fs::read(path).map_err(|_| "无法读取图片")?,
            mime,
        ))
    }
    /// 手机端选或粘来的图只有字节、没有本机路径：解码之后交给桌面端同一颗服务函数，
    /// 这一侧只留模块开关与逐条小记的访问闸门
    fn upload(&self, args: &Value) -> Result<Value, String> {
        self.require_module("notes_enabled")?;
        let note_id: Option<String> =
            args.get("noteId").and_then(Value::as_str).map(str::to_string);
        if let Some(id) = &note_id {
            self.vault.require_note_access(id).map_err(|e| e.user_message())?;
        }
        let name: String = arg(args, "name")?;
        let data: String = arg(args, "data")?;
        let db = self.vault.state.db.lock().map_err(|_| "无法读取附件")?;
        result(crate::services::attachment_service::save_image_base64(
            &db,
            &name,
            &data,
            note_id.as_deref(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoded_local_images_decode_once_without_reopening_path_traversal() {
        let root = std::env::temp_dir().join(format!("desko-web-images-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let name = "fixture__内网 image.png";
        std::fs::write(root.join(name), b"fixture").unwrap();
        let encoded = crate::webdav::encode_path(name);
        let decoded = crate::webdav::percent_decode(&encoded);
        assert_eq!(
            image_path(&root, &decoded, false).unwrap().0,
            root.join(name).canonicalize().unwrap()
        );
        for encoded in [
            "..%2fsecret.png",
            "%5csecret.png",
            "%252e%252e%252fsecret.png",
            "C%3aimage.png",
        ] {
            assert!(image_path(&root, &crate::webdav::percent_decode(encoded), false).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_access_cannot_escape_saved_root() {
        let root = std::env::temp_dir().join(format!("desko-web-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("file.txt"), b"ok").unwrap();
        assert!(within(&root, "file.txt")
            .unwrap()
            .starts_with(root.canonicalize().unwrap()));
        for path in [
            "../secret",
            "C:/Windows",
            "/etc/passwd",
            "..\\secret",
            "file.txt:stream",
        ] {
            assert!(within(&root, path).is_err(), "{path}");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
