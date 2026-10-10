// desko 门面：只内置 Codex 账号域用到的 zh-cn 文案，未命中的 key 回退为 key 本身（与上游一致）。
#![allow(dead_code, unused_imports, unused_variables, clippy::all)]
use std::cmp::Reverse;
use std::collections::HashMap;
use serde_json::Value;

const ZH_CN: &str = r#"{
  "quotaAlert": {
    "bannerText": "账号 {{email}} 触发配额预警（阈值 {{threshold}}%，最低 {{lowest}}%，模型：{{models}}）",
    "modal": { "title": "配额预警", "unknownModel": "未知模型", "recommended": "建议切换" }
  },
  "codex": { "authError": { "refreshTokenInvalidated": "Codex 登录授权已被服务端撤销，无法自动刷新。请重新登录 Codex 账号。" } },
  "common": { "quotaRefreshScheduler": {
    "busy": "刷新队列繁忙，请稍后重试。",
    "timeout": "额度刷新等待或执行超时，请重试。",
    "interrupted": "额度刷新意外结束，请重试。",
    "deferred": "本轮未开始的后台刷新已让位给手动刷新。",
    "invalidAccountId": "账号 ID 不能为空。"
  } }
}"#;

static LOCALES: std::sync::LazyLock<HashMap<&'static str, Value>> =
    std::sync::LazyLock::new(|| {
        let mut map = HashMap::new();
        if let Ok(value) = serde_json::from_str::<Value>(ZH_CN) {
            map.insert("zh-cn", value);
        }
        map
    });

fn normalize_locale(locale: &str) -> String {
    locale.trim().replace('_', "-").to_lowercase()
}

fn locale_candidates(locale: &str) -> Vec<String> {
    let normalized = normalize_locale(locale);
    if normalized.is_empty() {
        return vec!["en-us".to_string(), "en".to_string()];
    }

    let mut candidates = vec![normalized.clone()];

    let mut prefix_matches: Vec<&str> = LOCALES
        .keys()
        .copied()
        .filter(|known| normalized.starts_with(&format!("{}-", known)))
        .collect();
    prefix_matches.sort_by_key(|known| Reverse(known.len()));

    for known in prefix_matches {
        if normalized.starts_with(&format!("{}-", known))
            && !candidates.iter().any(|item| item == known)
        {
            candidates.push(known.to_string());
        }
    }

    if normalized == "zh" || normalized.starts_with("zh-cn-") || normalized.starts_with("zh-sg-") {
        candidates.push("zh-cn".to_string());
    }

    if normalized.starts_with("zh-tw-")
        || normalized.starts_with("zh-hk")
        || normalized.starts_with("zh-mo")
    {
        candidates.push("zh-tw".to_string());
    }

    if normalized == "pt" {
        candidates.push("pt-br".to_string());
    }

    if !candidates.iter().any(|item| item == "en-us") {
        candidates.push("en-us".to_string());
    }
    if !candidates.iter().any(|item| item == "en") {
        candidates.push("en".to_string());
    }

    candidates
}

fn lookup_key<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    let mut current = value;
    for segment in key.split('.') {
        current = current.get(segment)?;
    }
    current.as_str()
}

pub fn translate(locale: &str, key: &str, replacements: &[(&str, &str)]) -> String {
    let template = locale_candidates(locale)
        .into_iter()
        .find_map(|candidate| {
            LOCALES
                .get(candidate.as_str())
                .and_then(|value| lookup_key(value, key))
        })
        .unwrap_or(key);

    let mut output = template.to_string();
    for (name, value) in replacements {
        output = output.replace(&format!("{{{{{}}}}}", name), value);
    }
    output
}
