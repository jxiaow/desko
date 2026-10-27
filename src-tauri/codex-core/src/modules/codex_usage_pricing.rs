//! 可独立更新的标准 USD / 百万 Token 价格；网络只在后台读取公共价格数据。
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) type Prices = BTreeMap<String, [f64; 3]>;
const SOURCE: &str = "https://models.dev/api.json";
const CACHE_FILE: &str = "codex-usage-pricing.json";
const REFRESH_SECS: u64 = 6 * 60 * 60;
const RETRY_DELAY: Duration = Duration::from_secs(5 * 60);
const MAX_BODY_BYTES: u64 = 32 * 1024 * 1024;

pub(super) static BUILTIN: LazyLock<Arc<Prices>> = LazyLock::new(|| {
    Arc::new(serde_json::from_str(include_str!("../../resources/codex_session_pricing.json"))
        .expect("内置 Codex 会话价格表格式正确"))
});

#[derive(Serialize, Deserialize)]
struct CachedPrices {
    source: String,
    fetched_at: u64,
    prices: Prices,
}

struct PricingState {
    directory: PathBuf,
    prices: Arc<Prices>,
    fetched_at: u64,
    last_attempt: Option<Instant>,
    in_flight: bool,
}

fn valid_rates(rates: &[f64; 3]) -> bool {
    rates.iter().all(|rate| rate.is_finite() && *rate >= 0.0)
        && rates[0] > 0.0 && rates[2] > 0.0
}

impl PricingState {
    fn load(directory: PathBuf) -> Self {
        let cached = fs::read(directory.join(CACHE_FILE)).ok()
            .and_then(|raw| serde_json::from_slice::<CachedPrices>(&raw).ok())
            .filter(|cached| cached.source == SOURCE && !cached.prices.is_empty()
                && cached.prices.iter().all(|(model, rates)| !model.is_empty() && valid_rates(rates)));
        let mut prices = (**BUILTIN).clone();
        let fetched_at = cached.as_ref().map_or(0, |cached| cached.fetched_at);
        if let Some(cached) = cached { prices.extend(cached.prices); }
        Self { directory, prices: Arc::new(prices), fetched_at, last_attempt: None, in_flight: false }
    }

    fn begin_refresh(&mut self, now: u64, tick: Instant, missing_model: bool) -> bool {
        if self.in_flight || self.last_attempt.is_some_and(|last| tick.duration_since(last) < RETRY_DELAY) {
            return false;
        }
        let fresh = now.checked_sub(self.fetched_at).is_some_and(|age| age < REFRESH_SECS);
        if fresh && !missing_model { return false; }
        self.last_attempt = Some(tick);
        self.in_flight = true;
        true
    }

    fn install(&mut self, prices: Prices, fetched_at: u64) {
        let mut merged = (*self.prices).clone();
        merged.extend(prices);
        let cached = CachedPrices { source: SOURCE.into(), fetched_at, prices: merged };
        // 落盘失败仍可在本进程使用新价格，已有缓存也不被破坏。
        if let Ok(raw) = serde_json::to_vec(&cached) {
            let _ = crate::modules::atomic_write::write_bytes_atomic(&self.directory.join(CACHE_FILE), &raw);
        }
        self.prices = Arc::new(cached.prices);
        self.fetched_at = fetched_at;
    }
}

static STATE: LazyLock<Mutex<Option<PricingState>>> = LazyLock::new(|| Mutex::new(None));

fn now_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// 每次统计固定使用同一份价格快照；刷新完成后的下一轮统计自动使用新价格。
pub(super) fn snapshot() -> Arc<Prices> {
    let Ok(directory) = crate::modules::config::get_data_dir() else { return Arc::clone(&BUILTIN); };
    let prices = {
        let mut state = STATE.lock().unwrap_or_else(|error| error.into_inner());
        if state.as_ref().is_none_or(|state| state.directory != directory) {
            *state = Some(PricingState::load(directory));
        }
        Arc::clone(&state.as_ref().unwrap().prices)
    };
    request_refresh(false);
    prices
}

pub(super) fn request_refresh(missing_model: bool) {
    // 单元测试使用确定的本地数据；网络测试通过显式端点单独运行。
    if cfg!(test) || !crate::modules::config::get_user_config().external_network_enabled { return; }
    let directory = {
        let mut guard = STATE.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = guard.as_mut() else { return; };
        if !state.begin_refresh(now_seconds(), Instant::now(), missing_model) { return; }
        state.directory.clone()
    };
    let worker_directory = directory.clone();
    let spawned = std::thread::Builder::new().name("codex-pricing".into()).spawn(move || {
        let result = fetch_prices(SOURCE);
        let mut guard = STATE.lock().unwrap_or_else(|error| error.into_inner());
        let Some(state) = guard.as_mut().filter(|state| state.directory == worker_directory) else { return; };
        state.in_flight = false;
        match result {
            Ok(prices) => state.install(prices, now_seconds()),
            Err(error) => crate::modules::logger::log_warn(&format!("Codex 价格表更新失败，保留本地价格：{error}")),
        }
    });
    if spawned.is_err() {
        if let Some(state) = STATE.lock().unwrap_or_else(|error| error.into_inner()).as_mut()
            .filter(|state| state.directory == directory) { state.in_flight = false; }
    }
}

fn parse_prices(raw: &[u8]) -> Result<Prices, String> {
    let root: Value = serde_json::from_slice(raw).map_err(|error| error.to_string())?;
    let models = root.pointer("/openai/models").and_then(Value::as_object)
        .ok_or("价格数据缺少 OpenAI 模型")?;
    let mut prices = Prices::new();
    for (id, model) in models {
        let Some(cost) = model.get("cost") else { continue; };
        let (Some(input), Some(output)) = (cost["input"].as_f64(), cost["output"].as_f64()) else { continue; };
        let cached = match cost.get("cache_read") {
            Some(value) => match value.as_f64() { Some(rate) => rate, None => continue },
            None => input,
        };
        let rates = [input, cached, output];
        if !valid_rates(&rates) { continue; }
        let key = super::normalize_usage_model(id);
        if key.is_empty() { continue; }
        // 明确的基础型号优先，日期版本只补缺，避免不同版本的遍历顺序改变单价。
        if key == id.trim().to_ascii_lowercase() { prices.insert(key, rates); }
        else { prices.entry(key).or_insert(rates); }
    }
    if prices.is_empty() { return Err("价格数据没有有效的 OpenAI 文本单价".into()); }
    Ok(prices)
}

fn fetch_prices(url: &str) -> Result<Prices, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(20))
        .build().map_err(|error| error.to_string())?;
    let response = client.get(url).send().and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    let mut raw = Vec::new();
    response.take(MAX_BODY_BYTES + 1).read_to_end(&mut raw).map_err(|error| error.to_string())?;
    if raw.len() as u64 > MAX_BODY_BYTES { return Err("价格数据超出大小上限".into()); }
    parse_prices(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> Vec<u8> {
        serde_json::to_vec(&json!({"openai":{"models":{
            "gpt-6.1-terra":{"cost":{"input":1,"cache_read":0.05,"output":5,"tiers":[{"input":2,"output":7.5}]}},
            "gpt-future":{"cost":{"input":3,"cache_read":0.3,"output":15}},
            "gpt-future-20261027":{"cost":{"input":99,"output":99}},
            "legacy":{"cost":{"input":2,"output":10}},
            "invalid":{"cost":{"input":-1,"output":10}},
            "incomplete":{"cost":{"input":1}},
            "unpriced":{"cost":{"input":0,"output":0}}
        }},"other":{"models":{"gpt-future":{"cost":{"input":99,"output":99}}}}})).unwrap()
    }

    #[test]
    fn parses_only_valid_openai_standard_prices_and_base_model_wins() {
        let prices = parse_prices(&catalog()).unwrap();
        assert_eq!(prices["gpt-6.1-terra"], [1.0, 0.05, 5.0]);
        assert_eq!(prices["gpt-future"], [3.0, 0.3, 15.0]);
        assert_eq!(prices["legacy"], [2.0, 2.0, 10.0]);
        assert_eq!(prices.len(), 3);
        for invalid in [b"broken".as_slice(), b"{}", br#"{"openai":{"models":{}}}"#] {
            assert!(parse_prices(invalid).is_err());
        }
    }

    #[test]
    fn downloaded_prices_survive_restart_and_builtin_models_remain_available() {
        let dir = std::env::temp_dir().join(format!("codex-pricing-{}", uuid::Uuid::new_v4()));
        let mut state = PricingState::load(dir.clone());
        assert!(!state.prices.contains_key("gpt-future"));
        let old = Arc::clone(&state.prices);
        state.install(parse_prices(&catalog()).unwrap(), 100);
        assert!(!old.contains_key("gpt-future"));
        state.install(Prices::from([("gpt-6.1-terra".into(), [2.0, 0.1, 10.0])]), 101);
        let restored = PricingState::load(dir.clone());
        assert_eq!(restored.prices["gpt-future"], [3.0, 0.3, 15.0]);
        assert_eq!(restored.prices["gpt-6.1-terra"], [2.0, 0.1, 10.0]);
        assert!(restored.prices.contains_key("gpt-5.3-codex"));
        assert_eq!(restored.fetched_at, 101);
        fs::write(dir.join(CACHE_FILE), "broken").unwrap();
        assert_eq!(PricingState::load(dir.clone()).prices, *BUILTIN);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refreshes_periodically_and_on_missing_models_without_duplicate_requests() {
        let mut state = PricingState::load(std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()));
        let tick = Instant::now();
        assert!(state.begin_refresh(100, tick, true));
        assert!(!state.begin_refresh(100, tick, true));
        state.in_flight = false;
        state.fetched_at = 100;
        assert!(!state.begin_refresh(101, tick + Duration::from_secs(1), true));
        assert!(!state.begin_refresh(400, tick + RETRY_DELAY, false));
        assert!(state.begin_refresh(400, tick + RETRY_DELAY, true));
        state.in_flight = false;
        assert!(state.begin_refresh(100 + REFRESH_SECS, tick + Duration::from_secs(REFRESH_SECS), false));
    }

    #[test]
    fn http_download_rejects_errors_and_malformed_catalogs() {
        for (status, body, ok) in [(200, catalog(), true), (200, b"{}".to_vec(), false), (503, catalog(), false)] {
            let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
            let url = format!("http://{}", server.server_addr());
            let worker = std::thread::spawn(move || {
                let request = server.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
                request.respond(tiny_http::Response::from_data(body).with_status_code(status)).unwrap();
            });
            assert_eq!(fetch_prices(&url).is_ok(), ok);
            worker.join().unwrap();
        }
    }

    #[test]
    #[ignore = "联网核对公开 Models.dev 价格结构，仅输出模型数量"]
    fn live_pricing_catalog() {
        let prices = fetch_prices(SOURCE).unwrap();
        assert!(prices.contains_key("gpt-6.1-terra"));
        println!("OpenAI pricing models: {}", prices.len());
    }
}
