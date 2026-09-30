//! 本地起服务做真机截图验证：cargo run -p fileshare-core --example serve -- <config.json> <port>

use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let cfg_path = PathBuf::from(args.next().expect("usage: serve <config.json> <port>"));
    let port: u16 = args.next().and_then(|s| s.parse().ok()).expect("port required");

    let mut cfg = fileshare_core::config::load_file(&cfg_path)
        .expect("read config")
        .expect("config missing");
    cfg.port = port;
    let base_dir = cfg_path.parent().unwrap().to_path_buf();
    let persist = fileshare_core::file_persist(cfg_path.clone());

    let server = fileshare_core::start(cfg, base_dir, persist).expect("start");
    let info = server.info();
    println!(
        "serving http://127.0.0.1:{} (lan {}) dirs={}",
        info.bound_port, info.lan_ip, info.share_count
    );
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}
