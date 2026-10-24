use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    #[serde(default)]
    pub environment: super::environment::Environment,
    #[serde(default)]
    pub session_id: String,
    pub cwd: String,
    pub title: String,
    pub model: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub sandbox: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn busy(status: &str) -> bool { matches!(status, "inProgress" | "waitingOnApproval") }
pub fn string<'a>(value: &'a Value, key: &str) -> &'a str { value[key].as_str().unwrap_or("") }
/// Only send reasoning levels advertised by the selected model's live catalog.
pub fn turn_input(params: &Value, models: &[Value], thread_model: Option<&str>, cwd: &str) -> Result<Value, String> {
    let requested = params["model"].as_str().filter(|s| !s.is_empty());
    let selected = requested.or(thread_model);
    let mut input = json!({"threadId":params["threadId"],"cwd":cwd,"input":[{"type":"text","text":string(params, "text").trim()}]});
    let catalog = selected.and_then(|id| models.iter().find(|m| m["id"] == id || m["model"] == id));
    if params["model"].as_str().is_some_and(|s| !s.is_empty()) && catalog.is_none() { return Err("请选择当前账号可用的模型".into()); }
    if let Some(model) = requested { input["model"] = json!(model); }
    if let Some(effort) = params["effort"].as_str().filter(|s| !s.is_empty()) {
        if !catalog.and_then(|m| m["supportedReasoningEfforts"].as_array()).is_some_and(|levels| levels.iter().any(|level| level["reasoningEffort"] == effort)) {
            return Err("所选模型不支持此思考度，请重新选择".into());
        }
        input["effort"] = json!(effort);
    }
    Ok(input)
}
pub fn replace_item(items: &mut Vec<Value>, item: Value) {
    if let Some(index) = items.iter().position(|old| old["id"] == item["id"]) { items[index] = item; }
    else { items.push(item); }
}

/// 与源工作台相同，保留最近 200 轮，命令输出只缓存末尾 200000 字符。
pub fn apply_event(turns: &mut Vec<Value>, method: &str, params: &Value) {
    let id = params["turnId"].as_str().or_else(|| params["turn"]["id"].as_str()).unwrap_or("");
    if id.is_empty() || !(method.starts_with("item/") || method == "turn/started" || method == "turn/completed") { return; }
    let index = turns.iter().position(|t| t["id"] == id).unwrap_or_else(|| {
        turns.push(json!({"id":id,"status":"inProgress","items":[]})); turns.len()-1
    });
    let turn = &mut turns[index];
    match method {
        "turn/started" => turn["status"] = json!("inProgress"),
        "item/started" | "item/completed" => replace_item(turn["items"].as_array_mut().unwrap(), params["item"].clone()),
        "item/agentMessage/delta" | "item/commandExecution/outputDelta" => {
            let agent = method == "item/agentMessage/delta";
            let field = if agent { "text" } else { "aggregatedOutput" };
            let items = turn["items"].as_array_mut().unwrap();
            let mut item = items.iter().find(|item| item["id"] == params["itemId"]).cloned()
                .unwrap_or_else(|| json!({"id":params["itemId"],"type":if agent {"agentMessage"} else {"commandExecution"}}));
            let mut text = format!("{}{}", string(&item, field), string(params, "delta"));
            if !agent && text.chars().count() > 200000 {
                let start = text.char_indices().rev().nth(199999).map(|(i, _)| i).unwrap_or(0);
                text = text[start..].to_owned();
            }
            item[field] = json!(text);
            replace_item(items, item);
        }
        "turn/completed" => {
            if let Some(items) = params["turn"]["items"].as_array() {
                for item in items { replace_item(turn["items"].as_array_mut().unwrap(), item.clone()); }
            }
            turn["status"] = params["turn"]["status"].clone();
            turn["error"] = params["turn"]["error"].clone();
        }
        _ => {}
    }
    if turns.len() > 200 { turns.drain(..turns.len()-200); }
}

pub const SUPPORTED_REQUESTS: &[&str] = &[
    "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
    "item/permissions/requestApproval", "item/tool/requestUserInput",
];

pub fn approval_result(request: &Value, params: &Value) -> Result<Value, String> {
    let decision = string(params, "decision");
    match string(request, "method") {
        "item/tool/requestUserInput" => {
            let mut answers = serde_json::Map::new();
            for question in request["params"]["questions"].as_array().ok_or("问题格式无效")? {
                let id = string(question, "id");
                let values = params["answers"][id].as_array().ok_or("请回答每一个问题")?;
                if values.is_empty() || values.iter().any(|v| v.as_str().is_none_or(|s| s.trim().is_empty() || s.chars().count() > 4000)) {
                    return Err("请回答每一个问题，每项不超过 4000 字符".into());
                }
                answers.insert(id.into(), json!({"answers":values}));
            }
            Ok(json!({"answers":answers}))
        }
        "item/permissions/requestApproval" => {
            if !["accept", "decline"].contains(&decision) { return Err("无效的审批决定".into()); }
            Ok(json!({"permissions": if decision == "accept" { request["params"]["permissions"].clone() } else { json!({}) }, "scope":"turn"}))
        }
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            if !["accept", "decline", "cancel"].contains(&decision) { return Err("无效的审批决定".into()); }
            if let Some(available) = request["params"]["availableDecisions"].as_array() {
                if !available.iter().any(|v| v.as_str() == Some(decision)) { return Err("此请求不支持该审批决定".into()); }
            }
            Ok(json!({"decision":decision}))
        }
        _ => Err("此客户端不支持该交互请求".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn per_turn_model_and_reasoning_are_validated_against_live_catalog() {
        let models = vec![json!({"id":"a","model":"a","supportedReasoningEfforts":[{"reasoningEffort":"medium"}]}), json!({"id":"b","model":"b","supportedReasoningEfforts":[{"reasoningEffort":"ultra"}]})];
        let input = turn_input(&json!({"threadId":"t","text":" next ","model":"b","effort":"ultra"}), &models, Some("a"), "/repo").unwrap();
        assert_eq!(input["model"], "b");
        assert_eq!(input["effort"], "ultra");
        assert_eq!(input["input"][0]["text"], "next");
        assert_eq!(input["threadId"], "t");
        assert!(turn_input(&json!({"model":"unknown"}), &models, Some("a"), "/repo").is_err());
        assert!(turn_input(&json!({"model":"a","effort":"ultra"}), &models, Some("a"), "/repo").is_err());
        let legacy = turn_input(&json!({"threadId":"t","text":"hello"}), &[], Some("legacy"), "/repo").unwrap();
        assert!(legacy.get("model").is_none());
        assert!(legacy.get("effort").is_none());
    }
    #[test]
    fn completed_turn_preserves_streamed_items_and_failure() {
        let mut turns = vec![];
        apply_event(&mut turns, "item/agentMessage/delta", &json!({"turnId":"t","itemId":"a","delta":"你好"}));
        apply_event(&mut turns, "turn/completed", &json!({"turn":{"id":"t","status":"failed","items":[],"error":{"message":"失败"}}}));
        assert_eq!(turns[0]["items"][0]["text"], "你好");
        assert_eq!(turns[0]["status"], "failed");
        assert_eq!(turns[0]["error"]["message"], "失败");
    }
    #[test]
    fn permissions_cannot_be_expanded_by_frontend_and_decisions_are_validated() {
        let request = json!({"method":"item/permissions/requestApproval","params":{"permissions":{"network":{"enabled":true}}}});
        assert_eq!(approval_result(&request, &json!({"decision":"accept","permissions":{"filesystem":"all"}})).unwrap(), json!({"permissions":{"network":{"enabled":true}},"scope":"turn"}));
        assert!(approval_result(&request, &json!({"decision":"acceptForSession"})).is_err());
        let command = json!({"method":"item/commandExecution/requestApproval","params":{"availableDecisions":["decline"]}});
        assert!(approval_result(&command, &json!({"decision":"accept"})).is_err());
    }
    #[test]
    fn structured_answers_require_every_question() {
        let request = json!({"method":"item/tool/requestUserInput","params":{"questions":[{"id":"q"}]}});
        assert!(approval_result(&request, &json!({"answers":{}})).is_err());
        assert_eq!(approval_result(&request, &json!({"answers":{"q":["A"]}})).unwrap(), json!({"answers":{"q":{"answers":["A"]}}}));
    }
    #[test]
    fn unicode_command_tail_is_bounded() {
        let mut turns = vec![];
        apply_event(&mut turns, "item/commandExecution/outputDelta", &json!({"turnId":"t","itemId":"c","delta":"中".repeat(200005)}));
        assert_eq!(turns[0]["items"][0]["aggregatedOutput"].as_str().unwrap().chars().count(), 200000);
    }
}
