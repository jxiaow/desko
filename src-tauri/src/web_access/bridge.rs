use super::{Backend, Resource};
use crate::{commands, error::AppError, AppState};
use base64::Engine;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub(super) struct AppBackend {
    app: AppHandle,
    vault: super::vault::WebVault,
    draft_key: Vec<u8>,
}
impl AppBackend {
    pub(super) fn new(app: AppHandle) -> Result<Self, String> {
        let _lease = super::SESSION_GATE.read().map_err(|_| "Web 会话状态无法读取")?;
        let desktop = app.state::<AppState>();
        let vault = super::vault::WebVault::new(&desktop).map_err(|e| e.user_message())?;
        Ok(Self { app, vault, draft_key: crate::crypto::random_bytes(32) })
    }
    fn state(&self) -> crate::command_state::CommandState<'_, AppState> {
        crate::command_state::CommandState::from_ref(&self.vault.state)
    }
}
fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("参数 {key} 无效"))
}
fn result<T: Serialize>(value: Result<T, AppError>) -> Result<Value, String> {
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
    fn epoch(&self) -> Option<u64> {
        self.vault.epoch()
    }
    fn invoke(&self, command: &str, args: Value, expected_epoch: u64) -> Result<Value, String> {
        macro_rules! call { ($module:ident::$name:ident $(, $key:literal)* ) => { result(commands::$module::$name(self.state() $(, arg(&args, $key)?)*)) }; }
        // A favicon fetch can wait on a remote server. It neither mutates local
        // credentials nor returns secrets; the HTTP layer rechecks its session.
        if command == "favicon_get" {
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
                // Deliberately exclude native paths, process launch, Codex, network changes, backups and profiles.
                match command {
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
                    "note_key_relock" => call!(note_lock::note_key_relock),
                    "note_key_setup" => result(commands::note_lock::note_key_setup_with_state(&self.vault.state, arg(&args, "passphrase")?)),
                    "note_key_unlock" => result(commands::note_lock::note_key_unlock_with_state(&self.vault.state, arg(&args, "passphrase")?)),
                    "note_key_change" => result(commands::note_lock::note_key_change_with_state(&self.vault.state, arg(&args, "passphrase")?)),
                    "lock_note" => call!(note_lock::lock_note, "id"),
                    "unlock_note" => call!(note_lock::unlock_note, "id"),
                    "relock_note" => call!(note_lock::relock_note, "id"),
                    "remove_note_lock" => call!(note_lock::remove_note_lock, "id", "input"),
                    "reveal_note" => call!(note_lock::reveal_note, "id"),
                    "list_attachments" => call!(notes::list_attachments, "noteId"),
                    "bind_attachments" => call!(notes::bind_attachments, "noteId", "paths"),
                    "delete_attachment" => call!(notes::delete_attachment, "id"),
                    "web_upload_attachment" => self.upload(&args),
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
                    "list_file_shortcuts" => result(
                        commands::file_shortcuts::list_file_shortcuts(self.state()).map(
                            |mut shortcuts| {
                                for shortcut in &mut shortcuts {
                                    shortcut.path.clear();
                                }
                                shortcuts
                            },
                        ),
                    ),
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
            return self.image(
                &crate::paths::attachments_dir(),
                &crate::webdav::percent_decode(name),
                false,
            );
        }
        if let Some(name) = url.path().strip_prefix("/api/favicons/") {
            return self.image(
                &crate::services::favicon_service::favicons_dir(),
                &crate::webdav::percent_decode(name),
                true,
            );
        }
        let id = url.path().strip_prefix("/api/files/").ok_or("资源不存在")?;
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
    fn upload(&self, args: &Value) -> Result<Value, String> {
        let name: String = arg(args, "name")?;
        let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        if !matches!(
            ext.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
        ) {
            return Err("只支持 png / jpg / gif / webp / bmp 图片".into());
        }
        let data: String = arg(args, "data")?;
        let data = base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|_| "图片内容无效")?;
        if data.is_empty() || data.len() > 15 * 1024 * 1024 {
            return Err("图片应小于 15 MB".into());
        }
        let temp = std::env::temp_dir().join(format!("desko-web-{}.{}", uuid::Uuid::new_v4(), ext));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|_| "无法暂存图片")?;
        use std::io::Write;
        let outcome = file
            .write_all(&data)
            .map_err(|_| "无法暂存图片".to_string())
            .and_then(|_| {
                let path = temp.to_string_lossy().into_owned();
                if let Some(id) = args.get("noteId").and_then(Value::as_str) {
                    result(commands::notes::upload_attachment(
                        self.state(),
                        id.into(),
                        path,
                    ))
                } else {
                    result(commands::notes::stage_attachment(self.state(), path))
                }
            });
        drop(file);
        let _ = std::fs::remove_file(temp);
        outcome
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
