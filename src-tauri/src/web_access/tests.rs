use super::*;
use std::sync::atomic::AtomicU64;
struct Fake {
    epoch: AtomicU64,
    invocations: AtomicU64,
    public_hosts: Mutex<Vec<String>>,
}
impl Backend for Fake {
    fn public_hosts(&self, _: u16) -> Vec<String> { self.public_hosts.lock().unwrap().clone() }
    fn verify_password(&self, password: &str) -> Result<(), String> {
        if password == "test-password" { Ok(()) } else { Err("密码错误".into()) }
    }
    fn epoch(&self) -> Option<u64> {
        let n = self.epoch.load(Ordering::SeqCst);
        (n != 0).then_some(n)
    }
    fn invoke(&self, command: &str, _: Value, _: u64) -> Result<Value, String> {
        self.invocations.fetch_add(1, Ordering::SeqCst);
        match command {
            "list_notes" => Ok(json!([{ "id":"test", "title":"private" }])),
            _ => Err("unsupported".into()),
        }
    }
    fn asset(&self, path: &str) -> Option<Resource> {
        (path == "index.html").then(|| Resource {
            bytes: b"<html><head></head><body>Desko</body></html>".to_vec(),
            mime: "text/html".into(),
            download: false,
            file: None,
        })
    }
    fn private_resource(&self, _: &str) -> Result<Resource, String> {
        Err("not found".into())
    }
}
fn service() -> (Running, Arc<Fake>, String) {
    let fake = Arc::new(Fake {
        epoch: AtomicU64::new(1),
        invocations: AtomicU64::new(0),
        public_hosts: Mutex::new(Vec::new()),
    });
    let service = start(fake.clone(), 0, false).unwrap();
    let url = service.status.urls[0].clone();
    (service, fake, url)
}
fn login(url: &str) -> String {
    ureq::post(&format!("{url}/api/login"))
        .set("Content-Type", "application/json")
        .send_string(r#"{"password":"test-password"}"#)
        .unwrap()
        .header("Set-Cookie")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .into()
}
fn status(result: Result<ureq::Response, ureq::Error>) -> u16 {
    match result {
        Ok(r) => r.status(),
        Err(ureq::Error::Status(code, _)) => code,
        Err(e) => panic!("{e}"),
    }
}
#[test]
fn http_requires_auth_and_revokes_sessions_when_data_generation_changes() {
    let (_service, fake, url) = service();
    assert_eq!(status(ureq::get(&format!("{url}/api/session")).call()), 401);
    let cookie = login(&url);
    let request = || {
        ureq::post(&format!("{url}/api/invoke"))
            .set("Cookie", &cookie)
            .set("Content-Type", "application/json")
            .send_string(r#"{"command":"list_notes"}"#)
    };
    assert_eq!(status(request()), 200);
    fake.epoch.store(0, Ordering::SeqCst);
    assert_eq!(status(request()), 401);
    fake.epoch.store(2, Ordering::SeqCst);
    assert_eq!(status(request()), 401);
    let new_cookie = login(&url);
    assert_eq!(
        status(
            ureq::get(&format!("{url}/api/session"))
                .set("Cookie", &new_cookie)
                .call()
        ),
        200
    );
    assert_eq!(
        status(
            ureq::post(&format!("{url}/api/logout"))
                .set("Cookie", &new_cookie)
                .send_string("")
        ),
        200
    );
    assert_eq!(
        status(
            ureq::get(&format!("{url}/api/session"))
                .set("Cookie", &new_cookie)
                .call()
        ),
        401
    );
}
#[test]
fn http_rejects_foreign_origin_rebinding_native_commands_and_invalid_json() {
    let (_service, _, url) = service();
    assert_eq!(
        status(ureq::get(&url).set("Origin", "http://evil.example").call()),
        403
    );
    assert_eq!(
        status(ureq::get(&url).set("Host", "evil.example:8420").call()),
        403
    );
    let cookie = login(&url);
    assert_eq!(
        status(
            ureq::post(&format!("{url}/api/invoke"))
                .set("Cookie", &cookie)
                .set("Content-Type", "application/json")
                .send_string(r#"{"command":"open_terminal","args":{"path":"C:/"}}"#)
        ),
        400
    );
    assert_eq!(
        status(
            ureq::post(&format!("{url}/api/invoke"))
                .set("Cookie", &cookie)
                .set("Content-Type", "text/plain")
                .send_string("{}")
        ),
        400
    );
    let html = ureq::get(&format!("{url}/notes"))
        .call()
        .unwrap()
        .into_string()
        .unwrap();
    assert!(html.contains("name=\"desko-runtime\" content=\"web\""));
}
#[test]
fn host_validation_is_explicit() {
    let lan = Some("172.33.122.31".parse().unwrap());
    assert!(valid_host("127.0.0.1:8420", 8420, false, None));
    assert!(!valid_host("172.33.122.31:8420", 8420, false, lan));
    assert!(valid_host("172.33.122.31:8420", 8420, true, lan));
    assert!(!valid_host("172.33.122.32:8420", 8420, true, lan));
    assert!(valid_host("192.168.1.2:8420", 8420, true, lan));
    assert!(valid_host("192.168.1.2:8420", 8420, true, None));
    assert!(!valid_host("evil.example:8420", 8420, true, lan));
    assert!(!valid_host("127.0.0.1:8421", 8420, true, lan));
}

#[test]
fn lan_service_accepts_login_and_rpc_at_every_advertised_address() {
    let fake = Arc::new(Fake {
        epoch: AtomicU64::new(1),
        invocations: AtomicU64::new(0),
        public_hosts: Mutex::new(Vec::new()),
    });
    let running = start(fake, 0, true).unwrap();
    if let Some(ip) = running.context.lan_ip {
        assert_eq!(running.status.urls.len(), 2);
        assert!(running.status.urls.contains(&format!("http://{ip}:{}", running.status.port)));
    }
    for url in &running.status.urls {
        let cookie = login(url);
        assert_eq!(status(ureq::post(&format!("{url}/api/invoke"))
            .set("Origin", url).set("Cookie", &cookie)
            .set("Content-Type", "application/json")
            .send_string(r#"{"command":"list_notes"}"#)), 200);
        println!("LAN HTTP login and RPC verified: {url}");
    }
    running.stop_and_wait();
}

#[test]
fn tunnel_host_supports_https_login_and_rpc_without_allowing_foreign_origins() {
    let (_service, fake, url) = service();
    let host = "desk.example.com";
    let get = || ureq::get(&format!("{url}/notes")).set("Host", host).call();
    assert_eq!(status(get()), 403);
    fake.public_hosts.lock().unwrap().push(host.into());
    assert_eq!(status(get()), 200);
    let login = |origin: &str| ureq::post(&format!("{url}/api/login"))
        .set("Host", host).set("Origin", origin).set("Sec-Fetch-Site", "same-origin")
        .set("Content-Type", "application/json")
        .send_string(r#"{"password":"test-password"}"#);
    assert_eq!(status(login("https://evil.example")), 403);
    let cookie = login("https://desk.example.com").unwrap().header("Set-Cookie").unwrap().to_string();
    assert_eq!(status(ureq::post(&format!("{url}/api/invoke"))
        .set("Host", host).set("Origin", "https://desk.example.com")
        .set("Sec-Fetch-Site", "same-origin").set("Cookie", &cookie)
        .set("Content-Type", "application/json").send_string(r#"{"command":"list_notes"}"#)), 200);
    assert_eq!(status(ureq::get(&url).set("Host", host).set("Sec-Fetch-Site", "cross-site").call()), 403);
    assert_eq!(status(ureq::get(&url).set("Host", "evil.example")
        .set("X-Forwarded-Host", host).set("X-Forwarded-Proto", "https").call()), 403);
    assert_eq!(status(ureq::get(&url).set("Host", "desk.example.com:8420").call()), 403);
    fake.public_hosts.lock().unwrap().clear();
    assert_eq!(status(get()), 403);
}

#[test]
fn slow_request_cannot_dispatch_after_data_generation_changes() {
    use std::io::{Read, Write};
    let (service, fake, url) = service();
    let cookie = login(&url);
    let token = cookie.split_once('=').unwrap().1.to_string();
    let before = service.context.security.lock().unwrap().sessions[&token].used;
    let mut socket = std::net::TcpStream::connect(("127.0.0.1", service.status.port)).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    // More than tiny_http's eager buffering threshold: authenticate runs before
    // the rest of the HTTP body arrives.
    let body = format!("{{\"command\":\"list_notes\"}}{}", " ".repeat(2048));
    write!(socket, "POST /api/invoke HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nCookie: {cookie}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", service.status.port, body.len(), &body[..1]).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while service.context.security.lock().unwrap().sessions[&token].used <= before {
        assert!(Instant::now() < deadline, "request was not authenticated");
        thread::sleep(Duration::from_millis(2));
    }
    fake.epoch.store(2, Ordering::SeqCst);
    socket.write_all(body[1..].as_bytes()).unwrap();
    let mut response = String::new();
    socket.read_to_string(&mut response).unwrap();
    assert!(response.starts_with("HTTP/1.1 401"), "{response}");
    assert_eq!(fake.invocations.load(Ordering::SeqCst), 0);
}

#[test]
fn logout_invalidates_a_pending_rpc_result_before_it_is_returned() {
    struct Blocking {
        started: Mutex<Option<std::sync::mpsc::Sender<()>>>,
        resume: Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl Backend for Blocking {
        fn verify_password(&self, password: &str) -> Result<(), String> {
            if password == "test-password" { Ok(()) } else { Err("密码错误".into()) }
        }
        fn epoch(&self) -> Option<u64> {
            Some(1)
        }
        fn invoke(&self, _: &str, _: Value, _: u64) -> Result<Value, String> {
            self.started
                .lock()
                .unwrap()
                .take()
                .unwrap()
                .send(())
                .unwrap();
            self.resume.lock().unwrap().recv().unwrap();
            Ok(json!({"secret":"must-not-be-returned"}))
        }
        fn asset(&self, _: &str) -> Option<Resource> {
            None
        }
        fn private_resource(&self, _: &str) -> Result<Resource, String> {
            Err("not found".into())
        }
    }
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel();
    let backend = Arc::new(Blocking {
        started: Mutex::new(Some(started_tx)),
        resume: Mutex::new(resume_rx),
    });
    let running = start(backend, 0, false).unwrap();
    let url = running.status.urls[0].clone();
    let cookie = login(&url);
    let request_url = url.clone();
    let request_cookie = cookie.clone();
    let request = thread::spawn(move || {
        ureq::post(&format!("{request_url}/api/invoke"))
            .set("Cookie", &request_cookie)
            .set("Content-Type", "application/json")
            .send_string(r#"{"command":"list_notes"}"#)
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        status(
            ureq::post(&format!("{url}/api/logout"))
                .set("Cookie", &cookie)
                .send_string("")
        ),
        200
    );
    resume_tx.send(()).unwrap();
    assert_eq!(status(request.join().unwrap()), 401);
}

#[test]
fn logout_stops_an_already_open_resource_reader() {
    let (running, _, url) = service();
    let cookie = login(&url);
    let auth = Authorization {
        epoch: 1,
        token: cookie.split_once('=').unwrap().1.into(),
        backend: running.context.backend.clone(),
    };
    let mut reader = GuardedReader {
        reader: Box::new(std::io::Cursor::new(b"private bytes")),
        context: running.context.clone(),
        authorization: auth.clone(),
    };
    let mut byte = [0; 1];
    assert_eq!(reader.read(&mut byte).unwrap(), 1);
    running
        .context
        .security
        .lock()
        .unwrap()
        .sessions
        .remove(&auth.token);
    assert_eq!(
        reader.read(&mut byte).unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
}

#[test]
fn browsers_get_independent_unlock_state_and_relogin_starts_locked() {
    struct Isolated { unlocked: AtomicBool }
    impl Backend for Isolated {
        fn verify_password(&self, password: &str) -> Result<(), String> {
            if password == "test-password" { Ok(()) } else { Err("密码错误".into()) }
        }
        fn epoch(&self) -> Option<u64> { Some(1) }
        fn fork_session(&self) -> Result<Option<Arc<dyn Backend>>, String> {
            Ok(Some(Arc::new(Self { unlocked: AtomicBool::new(false) })))
        }
        fn invoke(&self, command: &str, _: Value, _: u64) -> Result<Value, String> {
            if command == "unlock_fixture" { self.unlocked.store(true, Ordering::SeqCst); }
            Ok(json!(self.unlocked.load(Ordering::SeqCst)))
        }
        fn asset(&self, _: &str) -> Option<Resource> { None }
        fn private_resource(&self, _: &str) -> Result<Resource, String> { Err("not found".into()) }
    }
    let running = start(Arc::new(Isolated { unlocked: AtomicBool::new(false) }), 0, false).unwrap();
    let url = &running.status.urls[0];
    let first = login(url);
    let second = login(url);
    let invoke = |cookie: &str, command: &str| -> bool {
        let body = ureq::post(&format!("{url}/api/invoke"))
            .set("Cookie", cookie).set("Content-Type", "application/json")
            .send_string(&json!({"command":command}).to_string()).unwrap().into_string().unwrap();
        serde_json::from_str(&body).unwrap()
    };
    assert!(!invoke(&first, "status"));
    assert!(invoke(&first, "unlock_fixture"));
    assert!(!invoke(&second, "status"), "another browser must not inherit note keys");
    assert!(invoke(&first, "status"));
    ureq::post(&format!("{url}/api/logout")).set("Cookie", &first).send_string("").unwrap();
    let replacement = login(url);
    assert!(!invoke(&replacement, "status"), "a new login starts with locked notes");
}

#[test]
fn dispatch_epoch_is_checked_after_taking_the_read_lease() {
    let called = AtomicBool::new(false);
    let result = with_session_epoch(
        1,
        || Some(2),
        || {
            called.store(true, Ordering::SeqCst);
            Ok(())
        },
    );
    assert!(result.is_err());
    assert!(!called.load(Ordering::SeqCst));
    with_session_epoch(
        2,
        || Some(2),
        || {
            assert!(
                SESSION_GATE.try_write().is_err(),
                "command must retain the read lease"
            );
            Ok(())
        },
    )
    .unwrap();
}

#[test]
fn explicit_stop_releases_the_port_before_an_immediate_restart() {
    let (running, fake, _) = service();
    let port = running.status.port;
    running.stop_and_wait();
    let restarted = start(fake, port, false).unwrap();
    assert_eq!(restarted.status.port, port);
    restarted.stop_and_wait();
}

#[test]
fn relogin_replaces_this_browser_session_and_failed_password_keeps_it() {
    let (running, _, url) = service();
    let first = login(&url);
    let response = ureq::post(&format!("{url}/api/login"))
        .set("Cookie", &first)
        .set("Content-Type", "application/json")
        .send_string(r#"{"password":"test-password"}"#)
        .unwrap();
    let second = response
        .header("Set-Cookie")
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert_ne!(first, second);
    assert_eq!(running.context.security.lock().unwrap().sessions.len(), 1);
    assert_eq!(
        status(
            ureq::get(&format!("{url}/api/session"))
                .set("Cookie", &first)
                .call()
        ),
        401
    );
    assert_eq!(
        status(
            ureq::post(&format!("{url}/api/login"))
                .set("Cookie", &second)
                .set("Content-Type", "application/json")
                .send_string(r#"{"password":"wrong"}"#)
        ),
        401
    );
    assert_eq!(
        status(
            ureq::get(&format!("{url}/api/session"))
                .set("Cookie", &second)
                .call()
        ),
        200
    );
    assert_eq!(running.context.security.lock().unwrap().sessions.len(), 1);
}

#[test]
fn head_download_checks_session_and_length_without_transferring_file_bytes() {
    struct FileBackend(std::path::PathBuf);
    impl Backend for FileBackend {
        fn verify_password(&self, password: &str) -> Result<(), String> {
            if password == "test-password" { Ok(()) } else { Err("密码错误".into()) }
        }
        fn epoch(&self) -> Option<u64> {
            Some(1)
        }
        fn invoke(&self, _: &str, _: Value, _: u64) -> Result<Value, String> {
            Err("unsupported".into())
        }
        fn asset(&self, _: &str) -> Option<Resource> {
            None
        }
        fn private_resource(&self, _: &str) -> Result<Resource, String> {
            Ok(Resource {
                bytes: vec![],
                mime: "application/octet-stream".into(),
                download: true,
                file: Some(std::fs::File::open(&self.0).unwrap().into()),
            })
        }
    }
    let path = std::env::temp_dir().join(format!("desko-web-head-{}", uuid::Uuid::new_v4()));
    std::fs::write(&path, b"private file bytes").unwrap();
    let running = start(
        Arc::new(FileBackend(path.clone())),
        0,
        false,
    )
    .unwrap();
    let url = running.status.urls[0].clone();
    assert_eq!(
        status(ureq::request("HEAD", &format!("{url}/api/files/test")).call()),
        401
    );
    let cookie = login(&url);
    let response = ureq::request("HEAD", &format!("{url}/api/files/test"))
        .set("Cookie", &cookie)
        .call()
        .unwrap();
    assert_eq!(response.header("Content-Length"), Some("18"));
    assert_eq!(response.into_string().unwrap(), "");
    running.stop_and_wait();
    std::fs::remove_file(path).unwrap();
}
