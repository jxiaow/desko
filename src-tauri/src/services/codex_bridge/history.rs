use super::{environment::Environment, model::{string, Thread}};
use serde_json::Value;

/// Import interactive Codex sessions without exposing worker threads or other repositories.
pub fn thread(value: &Value, environment: &Environment, cwd: &str, previous: Option<&Thread>) -> Option<Thread> {
    let id = string(value, "id");
    let source = if value["source"]["custom"].is_string() { "unknown" } else { string(value, "source") };
    if id.is_empty() || id.len() > 128 || !environment.same_path(string(value, "cwd"), cwd)
        || !["cli", "vscode", "exec", "appServer", "unknown"].contains(&source) { return None; }
    let updated = value["updatedAt"].as_i64()?.saturating_mul(1000);
    if let Some(old) = previous {
        // Desko owns its titles and permissions; history refresh must not reset them.
        if old.source.is_none() || old.updated_at > updated { return Some(old.clone()); }
    }
    let title = [string(value, "name"), string(value, "preview")].into_iter()
        .find(|text| !text.trim().is_empty()).unwrap_or("未命名对话")
        .split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();
    Some(Thread {
        id: id.into(), environment: environment.clone(),
        session_id: value["sessionId"].as_str().unwrap_or(id).into(), cwd: cwd.into(), title,
        source: Some(source.into()), model: value["model"].as_str().map(str::to_owned).or_else(|| previous.and_then(|t| t.model.clone())),
        sandbox: previous.map(|t| t.sandbox.clone()).unwrap_or_else(|| "workspace-write".into()),
        created_at: value["createdAt"].as_i64().unwrap_or(updated / 1000).saturating_mul(1000), updated_at: updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn imports_cli_and_client_history_only_in_current_repository() {
        let env = Environment::Native;
        let mut value = json!({"id":"existing", "source":"cli", "cwd":"C:/Code/Project", "name":"", "preview":"Inspect\n repository", "createdAt":10,"updatedAt":20});
        let imported = thread(&value, &env, "c:\\code\\project", None).unwrap();
        assert_eq!(imported.title, "Inspect repository");
        assert_eq!(imported.updated_at, 20000);
        value["source"] = json!("vscode");
        assert!(thread(&value, &env, "C:/Code/Project", None).is_some());
        value["source"] = json!({"custom":"desktop"});
        assert!(thread(&value, &env, "C:/Code/Project", None).is_some());
        value["source"] = json!({"subAgent":{"thread_spawn":{}}});
        assert!(thread(&value, &env, "C:/Code/Project", None).is_none());
        value["source"] = json!("cli");
        assert!(thread(&value, &env, "C:/other", None).is_none());
        let mut owned = imported.clone(); owned.source = None; owned.title = "自己的标题".into(); owned.sandbox = "read-only".into();
        let refreshed = thread(&value, &env, "C:/Code/Project", Some(&owned)).unwrap();
        assert_eq!(refreshed.title, "自己的标题"); assert_eq!(refreshed.sandbox, "read-only");
    }

    #[test]
    fn imports_wsl_histories_with_windows_drive_casing_without_merging_linux_directories() {
        let env = Environment::Wsl { distro: "Ubuntu".into(), user: "alice".into() };
        let mut value = json!({"id":"wsl", "source":"vscode", "cwd":"/mnt/c/Code/Codespace/desko", "updatedAt":20});
        assert!(thread(&value, &env, "/mnt/c/code/codespace/desko", None).is_some());
        value["cwd"] = json!("/home/alice/Project");
        assert!(thread(&value, &env, "/home/alice/project", None).is_none());
    }
}
