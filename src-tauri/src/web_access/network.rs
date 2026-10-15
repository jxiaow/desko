//! Browser management uses the same service lifecycle and configuration as the desktop.
use super::bridge::{arg, result};
use crate::commands::{fileshare, tunnel};
use serde_json::{json, Value};
use tauri::AppHandle;

pub(super) fn invoke(app: &AppHandle, command: &str, args: &Value) -> Result<Value, String> {
    macro_rules! tunnel_call { ($name:ident $(, $key:literal)* ) => { result(tauri::async_runtime::block_on(tunnel::$name($(arg(args, $key)?,)* app.clone()))) }; }
    match command {
        "fileshare_status" => Ok(json!(fileshare::fileshare_status(app.clone()))),
        "fileshare_start" => result(tauri::async_runtime::block_on(fileshare::fileshare_start(
            app.clone(),
        ))),
        "fileshare_stop" => {
            fileshare::fileshare_stop(app.clone());
            Ok(Value::Null)
        }
        "fileshare_get_config" => result(fileshare::fileshare_get_config(app.clone())),
        "fileshare_save_config" => result(tauri::async_runtime::block_on(
            fileshare::fileshare_save_config(
                app.clone(),
                arg(args, "port")?,
                arg(args, "shareDirs")?,
                arg(args, "localOnly")?,
            ),
        )),
        "fileshare_set_password" => result(fileshare::fileshare_set_password(
            app.clone(),
            arg(args, "password")?,
        )),
        "tunnel_binary_status" => result(tauri::async_runtime::block_on(
            tunnel::tunnel_binary_status(),
        )),
        "tunnel_fetch_binary" => {
            result(tauri::async_runtime::block_on(tunnel::tunnel_fetch_binary()))
        }
        "tunnel_provision_status" => tunnel_call!(tunnel_provision_status),
        "tunnel_login_start" => tunnel_call!(tunnel_login_start),
        "tunnel_login_status" => tunnel_call!(tunnel_login_status),
        "tunnel_login_cancel" => tunnel_call!(tunnel_login_cancel),
        "tunnel_authorized_domain" => tunnel_call!(tunnel_authorized_domain),
        "tunnel_ensure_tunnel" => tunnel_call!(tunnel_ensure_tunnel, "name", "adopt"),
        "tunnel_apply" => tunnel_call!(tunnel_apply),
        "tunnel_probe_connectors" => tunnel_call!(tunnel_probe_connectors),
        "tunnel_status" => tunnel_call!(tunnel_status),
        "tunnel_start" => tunnel_call!(tunnel_start),
        "tunnel_stop" => tunnel_call!(tunnel_stop),
        "tunnel_revoke" => tunnel_call!(tunnel_revoke),
        "tunnel_list_services" => tunnel_call!(tunnel_list_services),
        "tunnel_add_service" => {
            tunnel_call!(tunnel_add_service, "hostname", "port", "label", "preset")
        }
        "tunnel_update_service" => {
            tunnel_call!(tunnel_update_service, "id", "hostname", "port", "label")
        }
        "tunnel_remove_service" => tunnel_call!(tunnel_remove_service, "id"),
        "tunnel_set_service_policy" => {
            tunnel_call!(tunnel_set_service_policy, "id", "password", "readOnly")
        }
        _ => Err("Web 端不支持此服务操作".into()),
    }
}

pub(super) fn import_file(
    app: &AppHandle,
    source: &std::path::Path,
    name: &str,
    index: usize,
) -> Result<Value, String> {
    use fileshare_core::files::{claim_available_name, sanitize_upload_name};
    if !fileshare::fileshare_status(app.clone()).running {
        return Err("请先启动局域网传输服务".into());
    }
    let config = fileshare::fileshare_get_config(app.clone()).map_err(|e| e.user_message())?;
    let root = config
        .share_dirs
        .get(index)
        .ok_or("共享目录已不在列表里，请重新选择")?;
    let root = std::fs::canonicalize(root).map_err(|_| "共享目录不可访问")?;
    let name = sanitize_upload_name(name).ok_or("文件名无效")?;
    let target = claim_available_name(&root, &name).map_err(|_| "无法在共享目录创建文件")?;
    if std::fs::copy(source, &target).is_err() {
        let _ = std::fs::remove_file(target);
        return Err("无法保存到共享目录".into());
    }
    Ok(json!({"name":target.file_name().unwrap().to_string_lossy()}))
}
