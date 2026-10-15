//! Only UI progress notifications cross this boundary; native events are never forwarded wholesale.
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, EventId, Listener};

const EVENTS: &[&str] = &[
    "desko:module-changed",
    "codex:switch-progress",
    "codex-oauth-login-completed",
    "codex-oauth-login-timeout",
    "codex-device-auth-error",
];

pub(super) struct WebEvents {
    app: AppHandle,
    listeners: Mutex<Vec<EventId>>,
    queue: Mutex<(u64, VecDeque<Value>)>,
}
impl WebEvents {
    pub(super) fn new(app: AppHandle) -> Arc<Self> {
        let events = Arc::new(Self {
            app,
            listeners: Mutex::new(Vec::new()),
            queue: Mutex::new((0, VecDeque::new())),
        });
        for name in EVENTS {
            let weak = Arc::downgrade(&events);
            let id = events.app.listen(*name, move |event| {
                let Some(events) = weak.upgrade() else { return };
                let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
                    return;
                };
                let mut queue = events.queue.lock().unwrap_or_else(|e| e.into_inner());
                queue.0 += 1;
                let id = queue.0;
                queue
                    .1
                    .push_back(json!({"id":id,"event":name,"payload":payload}));
                while queue.1.len() > 256 {
                    queue.1.pop_front();
                }
            });
            events.listeners.lock().unwrap().push(id);
        }
        events
    }
    pub(super) fn since(&self, after: Option<u64>) -> Value {
        let queue = self.queue.lock().unwrap_or_else(|e| e.into_inner());
        let events: Vec<_> = queue
            .1
            .iter()
            .filter(|event| after.is_some_and(|id| event["id"].as_u64().unwrap_or(0) > id))
            .cloned()
            .collect();
        json!({"cursor":queue.0,"events":events})
    }
}
impl Drop for WebEvents {
    fn drop(&mut self) {
        for id in self
            .listeners
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            self.app.unlisten(id);
        }
    }
}
