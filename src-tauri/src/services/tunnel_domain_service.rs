//! 从本机 cloudflared 授权凭据读取已选 zone，再查询它的主域名。
//! 凭据只在后端使用；前端只接收域名和启用状态。

use std::path::Path;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use super::tunnel_service;

const API_BASE: &str = "https://api.cloudflare.com/client/v4";
const TOKEN_BEGIN: &str = "-----BEGIN ARGO TUNNEL TOKEN-----";
const TOKEN_END: &str = "-----END ARGO TUNNEL TOKEN-----";

#[derive(Deserialize)]
struct OriginCert {
    #[serde(rename = "zoneID")]
    zone_id: String,
    #[serde(rename = "apiToken")]
    api_token: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct DomainDto {
    pub name: String,
    pub status: String,
}

fn decode_cert(pem: &str) -> Result<OriginCert, AppError> {
    let invalid = || AppError::Tunnel("授权凭据缺少有效的域名信息，请重新授权".into());
    if pem.matches(TOKEN_BEGIN).count() != 1 { return Err(invalid()); }
    let body = pem.split_once(TOKEN_BEGIN).ok_or_else(invalid)?.1
        .split_once(TOKEN_END).ok_or_else(invalid)?.0;
    let bytes = STANDARD.decode(body.split_whitespace().collect::<String>()).map_err(|_| invalid())?;
    let cert: OriginCert = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    if cert.zone_id.len() != 32 || !cert.zone_id.bytes().all(|b| b.is_ascii_hexdigit())
        || cert.api_token.is_empty() || cert.api_token.chars().any(char::is_whitespace) {
        return Err(invalid());
    }
    Ok(cert)
}

fn domain_from_response(body: &str, zone_id: &str) -> Result<DomainDto, AppError> {
    #[derive(Deserialize)]
    struct Zone {
        id: String,
        name: String,
        status: String,
    }
    #[derive(Deserialize)]
    struct Response {
        success: bool,
        result: Option<Zone>,
    }
    let invalid = || AppError::Tunnel("Cloudflare 没有返回有效的主域名，请重试".into());
    let response: Response = serde_json::from_str(body).map_err(|_| invalid())?;
    let zone = response.result.filter(|_| response.success).ok_or_else(invalid)?;
    let name = zone.name.to_ascii_lowercase();
    if !zone.id.eq_ignore_ascii_case(zone_id) || name.len() > 253 || !name.contains('.')
        || !name.split('.').all(|label| !label.is_empty() && label.len() <= 63
            && !label.starts_with('-') && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')) {
        return Err(invalid());
    }
    Ok(DomainDto { name, status: zone.status })
}

fn fetch_domain(cert: &OriginCert, api_base: &str) -> Result<DomainDto, AppError> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).redirects(0).build();
    let response = agent.get(&format!("{api_base}/zones/{}", cert.zone_id))
        .set("Authorization", &format!("Bearer {}", cert.api_token))
        .set("Accept", "application/json")
        .call().map_err(|error| match error {
            ureq::Error::Status(401 | 403, _) => AppError::Tunnel("授权已失效或没有读取域名的权限，请重新授权".into()),
            ureq::Error::Status(404, _) => AppError::Tunnel("授权对应的主域名已不存在，请在 Cloudflare 确认后重新授权".into()),
            ureq::Error::Status(status, _) => AppError::Tunnel(format!("读取主域名失败（Cloudflare HTTP {status}），请重试")),
            ureq::Error::Transport(_) => AppError::Tunnel("无法连接 Cloudflare 读取主域名，请检查网络后重试".into()),
        })?;
    let body = response.into_string().map_err(|_| AppError::Tunnel("读取主域名响应失败，请重试".into()))?;
    domain_from_response(&body, &cert.zone_id)
}

pub fn authorized_domain(root: &Path) -> Result<DomainDto, AppError> {
    let pem = std::fs::read_to_string(tunnel_service::cert_path(root))
        .map_err(|_| AppError::Tunnel("本机没有可读取的授权凭据，请先完成浏览器授权".into()))?;
    fetch_domain(&decode_cert(&pem)?, API_BASE)
}

#[cfg(test)]
mod tests {
    use super::*;
    const ZONE: &str = "0123456789abcdef0123456789abcdef";

    fn pem(json: &str) -> String {
        format!("{TOKEN_BEGIN}\r\n{}\r\n{TOKEN_END}\r\n", STANDARD.encode(json))
    }

    #[test]
    fn tunnel_domain_decodes_token_among_legacy_pem_blocks() {
        let token = pem(&format!(r#"{{"zoneID":"{ZONE}","accountID":"account","apiToken":"test-secret"}}"#));
        let cert = decode_cert(&format!("-----BEGIN CERTIFICATE-----\nlegacy\n-----END CERTIFICATE-----\n{token}")).unwrap();
        assert_eq!(cert.zone_id, ZONE);
        assert_eq!(cert.api_token, "test-secret");
        for invalid in [String::new(), format!("{token}{token}"), pem(r#"{"zoneID":"../../other","apiToken":"test-secret"}"#), pem("not json")] {
            let error = decode_cert(&invalid).err().unwrap().to_string();
            assert!(!error.contains("test-secret"));
        }
    }

    #[test]
    fn tunnel_domain_rejects_failed_or_unrelated_zone_responses() {
        let response = |success, id: &str, name: &str| format!(r#"{{"success":{success},"result":{{"id":"{id}","name":"{name}","status":"active"}}}}"#);
        assert_eq!(domain_from_response(&response(true, ZONE, "Example.com"), ZONE).unwrap().name, "example.com");
        assert!(domain_from_response(&response(false, ZONE, "example.com"), ZONE).is_err());
        assert!(domain_from_response(&response(true, "other", "example.com"), ZONE).is_err());
        assert!(domain_from_response(&response(true, ZONE, "https://example.com"), ZONE).is_err());
    }

    #[test]
    fn tunnel_domain_queries_the_authorized_zone_with_backend_credentials() {
        use std::io::{BufRead, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                request.push_str(&line);
            }
            assert!(request.starts_with(&format!("GET /zones/{ZONE} ")));
            assert!(request.to_ascii_lowercase().contains("authorization: bearer test-secret\r\n"));
            let body = format!(r#"{{"success":true,"result":{{"id":"{ZONE}","name":"example.com","status":"active"}}}}"#);
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let domain = fetch_domain(&OriginCert { zone_id: ZONE.into(), api_token: "test-secret".into() }, &base).unwrap();
        let frontend = serde_json::to_string(&domain).unwrap();
        assert!(!frontend.contains("test-secret") && !frontend.contains(ZONE));
        worker.join().unwrap();
    }

    #[test]
    fn tunnel_domain_permission_errors_do_not_return_response_secrets() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = server.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let _ = stream.read(&mut [0; 2048]).unwrap();
            let body = "test-secret";
            write!(stream, "HTTP/1.1 403 Forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let error = fetch_domain(&OriginCert { zone_id: ZONE.into(), api_token: "test-secret".into() }, &base).err().unwrap().to_string();
        assert!(error.contains("权限"));
        assert!(!error.contains("test-secret"));
        worker.join().unwrap();
    }
}
