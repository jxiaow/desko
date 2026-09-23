//! tiny_http accept 循环：recv_timeout 轮询停止位，每请求一线程，限并发防上传洪水。

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tiny_http::Server;

use crate::handlers::{handle, RuntimeState};

const MAX_INFLIGHT: usize = 8;
const RECV_POLL: Duration = Duration::from_millis(200);

pub fn accept_loop(server: Server, state: Arc<RuntimeState>, stop: Arc<AtomicBool>) {
    let inflight = Arc::new(AtomicUsize::new(0));
    while !stop.load(Ordering::Relaxed) {
        match server.recv_timeout(RECV_POLL) {
            Ok(Some(request)) => {
                if inflight.load(Ordering::Relaxed) >= MAX_INFLIGHT {
                    let _ = request.respond(tiny_http::Response::from_string("Too Many Requests").with_status_code(503));
                    continue;
                }
                inflight.fetch_add(1, Ordering::Relaxed);
                let state = state.clone();
                let counter = inflight.clone();
                let spawned = thread::Builder::new()
                    .name("fileshare-req".to_string())
                    .spawn(move || {
                        handle(request, state);
                        counter.fetch_sub(1, Ordering::Relaxed);
                    });
                if spawned.is_err() {
                    inflight.fetch_sub(1, Ordering::Relaxed);
                }
            }
            Ok(None) => continue,
            // recv_timeout 报错 ≈ socket 故障或被 unblock，循环靠 stop 位收尾
            Err(_) => break,
        }
    }
    server.unblock();
}
