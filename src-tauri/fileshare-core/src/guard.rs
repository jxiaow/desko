//! 登录失败限速与锁定：计数落文件，子进程重启不清零。
//!
//! 公网侧的口令是爆破面，而进程本身随时可能被重启——只在内存里计数的话，
//! 打断连接或等 desko 重启就能拿到全新的 5 次，等于没锁。所以每次失败即落盘。
//!
//! 两个维度同时计：`hostname × 来源 IP` 给正常用户误输几次留余地，
//! `hostname × *` 兜住"换来源 IP 接着试"——隧道那条链路上来源 IP 取自边缘注的头，
//! 本机网段里的人可以随手编一个，所以单靠第一维不成立。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 落盘用的暂存序号：每次写独占一个 tmp 名，互不踩踏
static FLUSH_SEQ: AtomicU32 = AtomicU32::new(0);

/// 一个计数槽：失败次数、最后一次失败时刻、锁到什么时候
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Slot {
    fails: u32,
    last_fail: u64,
    lock_until: u64,
}

/// 一档规则：连败几次起锁、首锁多久、封顶多久、多久内的失败才算一轮
#[derive(Clone, Copy)]
pub struct Rule {
    pub limit: u32,
    pub base_secs: u64,
    pub max_secs: u64,
    pub window_secs: u64,
}

/// 单来源：5 次起锁 30s，逐次翻倍，最长 1 小时
pub const RULE_SOURCE: Rule =
    Rule { limit: 5, base_secs: 30, max_secs: 3600, window_secs: 900 };
/// 整条子域：20 次起锁 2 分钟，逐次翻倍，最长 2 小时
pub const RULE_HOST: Rule =
    Rule { limit: 20, base_secs: 120, max_secs: 7200, window_secs: 900 };

pub struct FailGate {
    path: Option<PathBuf>,
    slots: Mutex<HashMap<String, Slot>>,
}

impl FailGate {
    /// `path = None` 只在测试里用：纯内存，不落盘
    pub fn new(path: Option<PathBuf>) -> Self {
        let slots = match &path {
            Some(p) => std::fs::read_to_string(p)
                .ok()
                .and_then(|text| serde_json::from_str::<HashMap<String, Slot>>(&text).ok())
                .unwrap_or_default(),
            None => HashMap::new(),
        };
        FailGate { path, slots: Mutex::new(slots) }
    }

    /// 还要等多久才让试；0 = 现在能试。两个维度取更长的那个
    pub fn wait_secs(&self, keys: &[(String, Rule)], now: u64) -> u64 {
        // 锁中毒宁可多等也不放行：这条路径是闸门，fail-open 等于没有闸门
        let Ok(map) = self.slots.lock() else { return RULE_HOST.max_secs };
        keys.iter()
            .map(|(key, rule)| map.get(key).map(|s| left(s, *rule, now)).unwrap_or(0))
            .max()
            .unwrap_or(0)
    }

    /// 记一次失败，返回这次之后还要等多久
    pub fn record_fail(&self, keys: &[(String, Rule)], now: u64) -> u64 {
        let wait = {
            // 同 wait_secs：锁中毒时这连失败都记不上，更要按最长锁期拒绝
            let Ok(mut map) = self.slots.lock() else { return RULE_HOST.max_secs };
            for (key, rule) in keys {
                let mut slot = map.get(key).copied().unwrap_or_default();
                // 出了窗口就当新一轮：很久以前输错不该一直记着
                slot.fails = if now.saturating_sub(slot.last_fail) > rule.window_secs {
                    1
                } else {
                    slot.fails.saturating_add(1)
                };
                slot.last_fail = now;
                if let Some(until) = lock_until(&slot, *rule, now) {
                    slot.lock_until = until;
                }
                map.insert(key.clone(), slot);
            }
            prune(&mut map, now);
            keys.iter()
                .map(|(key, rule)| map.get(key).map(|s| left(s, *rule, now)).unwrap_or(0))
                .max()
                .unwrap_or(0)
        };
        self.flush();
        wait
    }

    /// 登录成功：这一项的计数清掉，别的来源不受影响
    pub fn record_success(&self, keys: &[(String, Rule)]) {
        let changed = {
            let Ok(mut map) = self.slots.lock() else { return };
            let before = map.len();
            map.retain(|key, _| !keys.iter().any(|(k, _)| k == key));
            map.len() != before
        };
        if changed {
            self.flush();
        }
    }

    fn flush(&self) {
        let Some(path) = &self.path else { return };
        // 锁不撒手直到 rename 完成：中途放锁，别人更新的计数会被这份旧快照 rename 盖掉
        let Ok(map) = self.slots.lock() else { return };
        let Ok(text) = serde_json::to_string(&*map) else { return };
        // 原子写：这个文件只在失败时写，写坏了宁可丢计数也不能留半截。
        // tmp 名带 pid+序号：固定名会让并发写者（或残留半截 tmp）互相踩、把好数据换出去
        let base = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let tmp = path.with_file_name(format!(
            "{}.{}.{}.tmp",
            base,
            std::process::id(),
            FLUSH_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }
}

/// 锁到什么时候：没到上限不锁；到了按超出次数翻倍
fn lock_until(slot: &Slot, rule: Rule, now: u64) -> Option<u64> {
    if slot.fails <= rule.limit {
        return None;
    }
    let over = slot.fails - rule.limit - 1;
    let span = rule.base_secs.saturating_mul(1u64.checked_shl(over.min(20))?).min(rule.max_secs);
    Some(now + span)
}

/// 还在锁期内就报剩余秒数
fn left(slot: &Slot, _rule: Rule, now: u64) -> u64 {
    slot.lock_until.saturating_sub(now)
}

/// 清掉既没在锁期、失败又久出窗口的槽，防文件只增
fn prune(map: &mut HashMap<String, Slot>, now: u64) {
    map.retain(|_, s| s.lock_until > now || now.saturating_sub(s.last_fail) <= RULE_HOST.window_secs);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(host: &str, ip: &str) -> Vec<(String, Rule)> {
        vec![(format!("{host}|{ip}"), RULE_SOURCE), (format!("{host}|*"), RULE_HOST)]
    }

    fn tmp_path() -> PathBuf {
        std::env::temp_dir().join(format!("desko-gate-{}.json", uuid::Uuid::new_v4()))
    }

    #[test]
    fn locks_only_after_the_source_limit() {
        let gate = FailGate::new(None);
        let k = keys("files.example", "1.2.3.4");
        for i in 1..=RULE_SOURCE.limit {
            assert_eq!(gate.record_fail(&k, 1000 + i as u64), 0, "第 {i} 次不该锁");
        }
        assert!(gate.record_fail(&k, 1006) > 0, "超上限该锁");
        assert!(gate.wait_secs(&k, 1006) > 0);
    }

    #[test]
    fn backoff_doubles_and_caps() {
        let gate = FailGate::new(None);
        let k = vec![("h|1".to_string(), RULE_SOURCE)];
        let mut waits = Vec::new();
        for i in 0..RULE_SOURCE.limit + 12 {
            gate.record_fail(&k, 1000 + i as u64);
            waits.push(gate.wait_secs(&k, 1000 + i as u64));
        }
        let first = waits.iter().find(|w| **w > 0).copied().unwrap();
        assert_eq!(first, RULE_SOURCE.base_secs);
        assert_eq!(waits.last().copied().unwrap(), RULE_SOURCE.max_secs, "封顶后要一直停在封顶值");
    }

    #[test]
    fn stale_failures_start_a_new_round() {
        let gate = FailGate::new(None);
        let k = vec![("h|1".to_string(), RULE_SOURCE)];
        for i in 0..RULE_SOURCE.limit {
            gate.record_fail(&k, 1000 + i as u64);
        }
        // 窗口之外再输一次：算新一轮的第一次，不该直接锁
        assert_eq!(gate.record_fail(&k, 1000 + RULE_SOURCE.window_secs + 500), 0);
    }

    #[test]
    fn other_sources_keep_their_own_count() {
        let gate = FailGate::new(None);
        let a = vec![("h|1.1.1.1".to_string(), RULE_SOURCE)];
        let b = vec![("h|2.2.2.2".to_string(), RULE_SOURCE)];
        for i in 0..RULE_SOURCE.limit {
            gate.record_fail(&a, 1000 + i as u64);
        }
        assert_eq!(gate.wait_secs(&b, 1004), 0, "换个来源 IP 不该继承别人的计数");
    }

    #[test]
    fn rotating_the_source_ip_still_hits_the_host_ceiling() {
        // 来源 IP 取自边缘注的头，本机网段里能随手编：整域那一维必须兜住
        let gate = FailGate::new(None);
        for i in 0..RULE_HOST.limit {
            let k = keys("h", &format!("10.0.0.{}", i));
            assert_eq!(gate.record_fail(&k, 1000 + i as u64), 0);
        }
        let fresh = keys("h", "10.9.9.9");
        assert!(gate.record_fail(&fresh, 1030) > 0, "换到没试过的 IP 也该被整域那一维锁住");
    }

    #[test]
    fn lock_survives_a_restart() {
        let path = tmp_path();
        {
            let gate = FailGate::new(Some(path.clone()));
            let k = keys("h", "1.2.3.4");
            for i in 0..=RULE_SOURCE.limit {
                gate.record_fail(&k, 1000 + i as u64);
            }
            assert!(gate.wait_secs(&k, 1006) > 0);
        }
        let reopened = FailGate::new(Some(path.clone()));
        assert!(
            reopened.wait_secs(&keys("h", "1.2.3.4"), 1006) > 0,
            "重启即清零 = 打断连接就能绕过锁定"
        );
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn success_clears_only_its_own_source() {
        let path = tmp_path();
        let gate = FailGate::new(Some(path.clone()));
        let a = keys("h", "1.1.1.1");
        let b = keys("h", "2.2.2.2");
        for i in 0..RULE_SOURCE.limit {
            gate.record_fail(&a, 1000 + i as u64);
            gate.record_fail(&b, 1000 + i as u64);
        }
        gate.record_success(&a);
        assert_eq!(gate.wait_secs(&a, 1010), 0);
        assert_eq!(gate.wait_secs(&b, 1010), 0, "另一维还没到上限");
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn corrupt_file_is_tolerated() {
        let path = tmp_path();
        std::fs::write(&path, "{ not json").unwrap();
        let gate = FailGate::new(Some(path.clone()));
        assert_eq!(gate.wait_secs(&keys("h", "1"), 1000), 0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn slots_expire_out_of_the_window() {
        let gate = FailGate::new(None);
        gate.record_fail(&vec![("h|1".to_string(), RULE_SOURCE)], 1000);
        prune(&mut gate.slots.lock().unwrap(), 1000 + RULE_HOST.window_secs + 1);
        assert!(gate.slots.lock().unwrap().is_empty());
    }
}
