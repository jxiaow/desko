//! 直连清单探测引擎：输入一个域名/URL/IP/CIDR，判出「直连可用 / 仅缺 DNS 固定 /
//! 缺路由 / 不可达」四态。全程只读——不写 hosts、不改路由、不提权，落盘在 P2 的
//! 提权 helper 里。设计依据见 docs/design/bypass/01-bypass-module.md。

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

// 托管区的解析规则与 netguard helper 共用一份：两边对块的认知必须逐字一致
pub use netguard_core::{in_fake_ip, read_pinned, usable_v4};

const DOH_ENDPOINTS: [&str; 2] = ["https://dns.alidns.com/resolve", "https://dns.google/resolve"];
/// 一轮探测的总预算：DoH 两腿最坏 30s，剩下的全给候选探活与 stale 复核；
/// 超预算就带着已有结论收口，不把 busy 锁在分钟级。
const PROBE_BUDGET: Duration = Duration::from_secs(75);

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    /// 真址已经从不带 fake-IP 的接口出得去，不需要接管
    DirectOk,
    /// 路由是通的，只缺把域名钉进 hosts
    HostsOnly,
    /// 流量仍从接管方网卡出，得加持久路由
    NeedRoute,
    /// 候选真址全都连不上，不该往系统里写东西
    Unreachable,
    /// 探活了但出口路由查不到，四态都判不出，不推荐落盘
    EgressUnknown,
}

impl Verdict {
    /// 落库用的稳定短名，与前端 `Verdict` 取值一致
    pub fn as_str(&self) -> &'static str {
        match self {
            Verdict::DirectOk => "directOk",
            Verdict::HostsOnly => "hostsOnly",
            Verdict::NeedRoute => "needRoute",
            Verdict::Unreachable => "unreachable",
            Verdict::EgressUnknown => "egressUnknown",
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Egress {
    pub if_index: u32,
    pub interface: String,
    pub source: String,
    pub next_hop: String,
    /// 出口源地址落在 fake-IP 段＝这块卡就是当前的接管方
    pub is_taker: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub kind: &'static str,
    pub host: String,
    pub port: u16,
    pub path: String,
    pub scheme: &'static str,
}

impl Target {
    fn url(&self) -> String {
        let path = if self.path.starts_with('/') {
            self.path.clone()
        } else {
            format!("/{}", self.path)
        };
        format!("{}://{}:{}{}", self.scheme, self.host, self.port, path)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub input: String,
    pub target: Target,
    /// hosts 管理区里已经钉住的地址（本模块或旧脚本写的都算）
    pub pinned: Option<String>,
    pub local_answers: Vec<String>,
    pub hijacked: bool,
    pub real_ips: Vec<String>,
    /// DoH 答案带 CNAME 或多 A 记录——CDN 轮换特征，钉死会锁在一个会失效的节点上
    pub cdn_like: bool,
    pub chosen: Option<String>,
    pub http_status: Option<u16>,
    pub probe_ms: Option<u64>,
    pub egress: Option<Egress>,
    pub verdict: Verdict,
    pub recommend: bool,
    pub stale: bool,
    pub headline: String,
    pub detail: String,
    pub pending: Vec<String>,
}

fn local_resolve(host: &str, port: u16) -> Vec<IpAddr> {
    let netloc = format!("{host}:{port}");
    netloc
        .to_socket_addrs()
        .map(|iter| iter.map(|a| a.ip()).collect())
        .unwrap_or_default()
}

/// 强制只走 IPv4：解析到 AAAA 黑洞时请求会先卡死在 v6 上（旧脚本同款教训）
fn v4_agent(connect: Duration, total: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(connect)
        .timeout(total)
        .resolver(move |netloc: &str| {
            let addrs: Vec<SocketAddr> = netloc
                .to_socket_addrs()
                .map(|iter| iter.filter(|a| a.is_ipv4()).collect())
                .unwrap_or_default();
            if addrs.is_empty() {
                Err(std::io::Error::new(
                    std::io::ErrorKind::AddrNotAvailable,
                    format!("没有可用的 IPv4 地址：{netloc}"),
                ))
            } else {
                Ok(addrs)
            }
        })
        .build()
}

#[derive(Deserialize)]
struct DohAnswer {
    #[serde(rename = "type")]
    kind: u16,
    data: String,
}

#[derive(Deserialize)]
struct DohResponse {
    #[serde(rename = "Status")]
    status: u16,
    #[serde(rename = "Answer", default)]
    answers: Vec<DohAnswer>,
}

/// DoH 取真实地址。端点域名本身也可能被接管，但请求照样经代理送到真解析器，
/// 所以要信的是答案而不是通道；答案里落 fake-IP 的一律丢弃。
fn doh_lookup(host: &str) -> (Vec<IpAddr>, bool, Option<String>) {
    let agent = v4_agent(Duration::from_secs(3), Duration::from_secs(15));
    let mut last_err = None;
    for endpoint in DOH_ENDPOINTS {
        let url = format!("{endpoint}?name={}&type=A", url_encode(host));
        let text = match agent.get(&url).call() {
            Ok(resp) => resp.into_string().unwrap_or_default(),
            Err(e) => {
                last_err = Some(format!("请求失败：{e}"));
                continue;
            }
        };
        let parsed: DohResponse = match serde_json::from_str(&text) {
            Ok(p) => p,
            Err(e) => {
                last_err = Some(format!("应答解析失败：{e}"));
                continue;
            }
        };
        if parsed.status != 0 {
            last_err = Some(format!("解析器返回状态 {}，域名可能不存在", parsed.status));
            continue;
        }
        let cname = parsed.answers.iter().any(|a| a.kind == 5);
        let ips: Vec<IpAddr> = parsed
            .answers
            .iter()
            .filter(|a| a.kind == 1)
            .filter_map(|a| a.data.parse::<IpAddr>().ok())
            .filter(|ip| usable_v4(*ip))
            .collect();
        let uniq: Vec<IpAddr> = {
            let mut seen = Vec::new();
            for ip in ips {
                if !seen.contains(&ip) {
                    seen.push(ip);
                }
            }
            seen
        };
        if uniq.is_empty() {
            return (Vec::new(), cname, Some("没有可用的 IPv4 实际地址".to_string()));
        }
        let cdn_like = cname || uniq.len() > 1;
        return (uniq, cdn_like, None);
    }
    (Vec::new(), false, last_err)
}

fn url_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// 指定真址探活＝`curl --resolve` 的等价物：把 host 强制解析到候选 IP，
/// TLS 的 SNI 与证书校验仍按原域名走。
fn probe_endpoint(target: &Target, ip: Ipv4Addr) -> Result<(u16, u64), String> {
    let netloc = format!("{}:{}", target.host, target.port);
    let addr = SocketAddr::from((ip, target.port));
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .resolver(move |req: &str| {
            if req == netloc {
                Ok(vec![addr])
            } else {
                req.to_socket_addrs().map(|i| i.collect())
            }
        })
        .build();
    let started = Instant::now();
    let outcome = match agent.get(&target.url()).call() {
        // 拿到 HTTP 状态码就说明 TCP+TLS+HTTP 全通了，4xx/5xx 也算可达
        Ok(resp) => Ok(resp.status()),
        Err(ureq::Error::Status(code, _)) => Ok(code),
        Err(e) => Err(format!("{e}")),
    };
    let ms = started.elapsed().as_millis() as u64;
    outcome.map(|code| (code, ms))
}

fn probe_tcp(target: &Target, ip: Ipv4Addr) -> Result<(u16, u64), String> {
    let started = Instant::now();
    let addr = SocketAddr::from((ip, target.port));
    TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| format!("TCP 连接失败：{e}"))
        .map(|_| (0u16, started.elapsed().as_millis() as u64))
}

/// UTF-16 定长数组读到第一个 NUL
fn from_utf16(buf: &[u16]) -> String {
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

#[cfg(windows)]
fn egress_of(ip: Ipv4Addr) -> Option<Egress> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetBestRoute2, GetIfEntry2, MIB_IF_ROW2, MIB_IPFORWARD_ROW2,
    };
    use windows::Win32::Networking::WinSock::{AF_INET, IN_ADDR, IN_ADDR_0, SOCKADDR_IN, SOCKADDR_INET};

    let dest = SOCKADDR_INET {
        Ipv4: SOCKADDR_IN {
            sin_family: AF_INET,
            sin_addr: IN_ADDR {
                S_un: IN_ADDR_0 {
                    S_addr: u32::from_ne_bytes(ip.octets()),
                },
            },
            ..Default::default()
        },
    };
    let mut row = MIB_IPFORWARD_ROW2::default();
    let mut src = SOCKADDR_INET::default();
    if unsafe { GetBestRoute2(None, 0, None, &dest, 0, &mut row, &mut src) }.0 != 0 {
        return None;
    }
    // S_addr 就是按地址顺序摊在内存里的四个字节，ne_bytes 直接还原点分四段
    let (source, next_hop) = unsafe {
        (
            Ipv4Addr::from(src.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()),
            Ipv4Addr::from(row.NextHop.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()),
        )
    };
    let if_index = row.InterfaceIndex;

    let mut if_row = MIB_IF_ROW2 {
        InterfaceIndex: if_index,
        ..Default::default()
    };
    let interface = if unsafe { GetIfEntry2(&mut if_row) }.0 == 0 {
        let name = from_utf16(&if_row.Alias);
        if name.trim().is_empty() {
            format!("接口 #{if_index}")
        } else {
            name
        }
    } else {
        format!("接口 #{if_index}")
    };

    Some(Egress {
        if_index,
        interface,
        source: source.to_string(),
        next_hop: next_hop.to_string(),
        is_taker: in_fake_ip(source),
    })
}

#[cfg(not(windows))]
fn egress_of(_ip: Ipv4Addr) -> Option<Egress> {
    None
}

/// IP/CIDR 目标的地址合法性闸：fake-IP 接管段、回环、链路本地、组播、0/8 都不许进——
/// 经 TUN 对这些地址 TCP 照样连得通，不拦就会把接管段地址推荐去 `route add`。
fn reject_reserved_v4(v4: Ipv4Addr) -> Result<(), String> {
    if usable_v4(IpAddr::V4(v4)) {
        Ok(())
    } else if in_fake_ip(v4) {
        Err("该地址落在接管段（198.18.0.0/15），固定它等于固定代理返回的伪地址".to_string())
    } else {
        Err("该地址属于保留段（回环、链路本地、组播等），不适用于直连".to_string())
    }
}

pub fn parse_target(raw: &str) -> Result<Target, String> {
    let entry = raw.trim().to_lowercase();
    if entry.is_empty() {
        return Err("输入内容为空".to_string());
    }
    if entry.starts_with("http://") || entry.starts_with("https://") {
        let rest = entry.split_once("://").map(|(_, r)| r).unwrap_or("");
        return parse_url(&entry, rest);
    }
    if entry.contains("://") {
        return Err("仅支持 http 与 https 协议".to_string());
    }
    if let Some((prefix, bits)) = entry.split_once('/') {
        let Ok(pref) = prefix.parse::<Ipv4Addr>() else {
            return Err("网段仅支持 IPv4 前缀".to_string());
        };
        reject_reserved_v4(pref)?;
        let Ok(len) = bits.parse::<u32>() else {
            return Err("前缀长度应为数字".to_string());
        };
        if len > 32 {
            return Err("前缀长度需在 0 到 32 之间".to_string());
        }
        return Ok(Target {
            kind: "cidr",
            // 掩码必须留在 host 里：去掉它，/16 和 /24 会在 UNIQUE(host) 上互相覆盖，
            // 行上也就会把一段网显示成一台单机
            host: format!("{pref}/{len}"),
            port: 0,
            path: String::new(),
            scheme: "http",
        });
    }
    if let Ok(addr) = entry.parse::<Ipv4Addr>() {
        reject_reserved_v4(addr)?;
        return Ok(Target {
            kind: "ip",
            host: addr.to_string(),
            port: 443,
            path: String::new(),
            scheme: "https",
        });
    }
    validate_domain(&entry)?;
    Ok(Target {
        kind: "domain",
        host: entry.trim_end_matches('.').to_string(),
        port: 443,
        path: String::new(),
        scheme: "https",
    })
}

fn parse_url(entry: &str, authority_and_path: &str) -> Result<Target, String> {
    let scheme = if entry.starts_with("https") { "https" } else { "http" };
    let (authority, path) = match authority_and_path.find('/') {
        Some(i) => (&authority_and_path[..i], &authority_and_path[i..]),
        None => (authority_and_path, "/"),
    };
    if authority.contains('@') {
        return Err("URL 中不应包含用户名与密码".to_string());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !h.contains(']') => {
            let Ok(p) = p.parse::<u16>() else {
                return Err("端口应为数字".to_string());
            };
            (h, p)
        }
        _ => (
            authority,
            if scheme == "https" { 443 } else { 80 },
        ),
    };
    if let Ok(v4) = host.parse::<Ipv4Addr>() {
        reject_reserved_v4(v4)?;
        return Ok(Target {
            kind: "ip",
            host: v4.to_string(),
            port,
            path: path.to_string(),
            scheme,
        });
    }
    validate_domain(host)?;
    Ok(Target {
        kind: "domain",
        host: host.to_string(),
        port,
        path: path.to_string(),
        scheme,
    })
}

fn validate_domain(host: &str) -> Result<(), String> {
    let name = host.trim_end_matches('.');
    if name.len() < 3 || !name.contains('.') {
        return Err("域名至少需要 3 个字符并包含一个点".to_string());
    }
    for label in name.split('.') {
        if label.is_empty()
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            || label.starts_with('-')
            || label.ends_with('-')
        {
            return Err("域名格式不合法".to_string());
        }
    }
    Ok(())
}

/// 四态判定（纯函数，供单测直灌）。要点：
/// - 域名只有「本机解析被接管成 fake-IP」时才需要钉 hosts；没被接管、出口又不是接管方，
///   就是直连可用——哪怕 hosts 里没钉过，也不能推荐去钉公网站。
/// - CIDR 没有可钉的地址，判据只有出口。
/// - 探活了但出口路由查不到 ≠ 不可达，给独立态，不推荐落盘。
fn decide(
    chosen: Option<Ipv4Addr>,
    egress: Option<&Egress>,
    hijacked: bool,
    kind: &str,
    pinned: Option<&str>,
) -> Verdict {
    match (chosen, egress) {
        // 路由型条目（裸 IP / 网段）：内网机器多半不在 443 上监听，探活失败不等于
        // 不可达。这一段流量从哪块卡出才是它唯一要回答的问题，判据只看出口。
        _ if kind == "ip" || kind == "cidr" => match egress {
            Some(e) if e.is_taker => Verdict::NeedRoute,
            Some(_) => Verdict::DirectOk,
            None => Verdict::EgressUnknown,
        },
        (None, _) => Verdict::Unreachable,
        (Some(_), Some(e)) if e.is_taker => Verdict::NeedRoute,
        (Some(ip), Some(_)) => {
            let pinned_here = pinned == Some(ip.to_string().as_str());
            if kind != "domain" || !hijacked || pinned_here {
                Verdict::DirectOk
            } else {
                Verdict::HostsOnly
            }
        }
        (Some(_), None) => Verdict::EgressUnknown,
    }
}

pub fn probe(raw: &str) -> Result<ProbeReport, String> {
    let started = Instant::now();
    let target = parse_target(raw)?;
    let pinned_map = read_pinned()?;
    let pinned = pinned_map.get(&target.host).cloned();

    let local: Vec<IpAddr> = if target.kind == "ip" {
        target.host.parse::<Ipv4Addr>().map(|v| vec![IpAddr::V4(v)]).unwrap_or_default()
    } else if target.kind == "cidr" {
        Vec::new()
    } else {
        local_resolve(&target.host, target.port)
    };
    let hijacked = local.iter().any(|ip| match ip {
        IpAddr::V4(v4) => in_fake_ip(*v4),
        _ => false,
    });

    let (real_ips, cdn_like, doh_err) = match target.kind {
        "ip" => (
            target
                .host
                .parse::<IpAddr>()
                .into_iter()
                .collect::<Vec<_>>(),
            false,
            None,
        ),
        "cidr" => (Vec::new(), false, None),
        _ => doh_lookup(&target.host),
    };

    let mut chosen: Option<Ipv4Addr> = None;
    let mut status = None;
    let mut ms = None;
    let mut probe_err = String::new();
    for ip in &real_ips {
        let IpAddr::V4(v4) = ip else { continue };
        if started.elapsed() > PROBE_BUDGET {
            probe_err = "探测时间已用尽，剩余候选地址未试".to_string();
            break;
        }
        // ip 目标走裸 TCP：没有域名可校验 TLS，也无需 HTTP 语义
        let attempt = if target.kind == "ip" {
            probe_tcp(&target, *v4)
        } else {
            probe_endpoint(&target, *v4)
        };
        match attempt {
            Ok((code, took)) => {
                chosen = Some(*v4);
                status = Some(code);
                ms = Some(took);
                break;
            }
            Err(e) => probe_err = e,
        }
    }

    // 路由型条目查的是「这个目的地从哪块卡出」，与探活成不成无关：
    // 直接拿目标地址问路由表，探不通的机器照样能判出它被谁接管。
    let egress_ip: Option<Ipv4Addr> = match target.kind {
        "cidr" => target
            .host
            .split('/')
            .next()
            .and_then(|p| p.parse::<Ipv4Addr>().ok()),
        "ip" => target.host.parse::<Ipv4Addr>().ok(),
        _ => chosen,
    };
    let egress = egress_ip.and_then(egress_of);

    let verdict = decide(chosen, egress.as_ref(), hijacked, target.kind, pinned.as_deref());

    let recommend =
        !cdn_like && matches!(verdict, Verdict::HostsOnly | Verdict::NeedRoute);
    // stale 两条腿（规格 §4）：钉的 IP 不在 DoH 答案里，且指定它探活也失败。
    // 只看第一条腿会在 DoH 整体失败时把全部已钉条目误判成过期。
    let stale = match (target.kind, pinned.as_ref()) {
        ("domain", Some(p)) => {
            let in_answers = real_ips.iter().any(|ip| ip.to_string() == *p);
            if in_answers {
                false
            } else if started.elapsed() > PROBE_BUDGET {
                // 预算内没机会复核第二腿，宁可不下「过期」结论
                false
            } else {
                match p.parse::<Ipv4Addr>() {
                    Ok(v4) => probe_endpoint(&target, v4).is_err(),
                    Err(_) => true,
                }
            }
        }
        _ => false,
    };

    let taker_name = egress
        .as_ref()
        .filter(|e| e.is_taker)
        .map(|e| e.interface.clone())
        .unwrap_or_default();
    let egress_name = egress.as_ref().map(|e| e.interface.clone()).unwrap_or_default();

    let (headline, detail) = match verdict {
        Verdict::DirectOk if target.kind == "domain" => (
            "直连已可用".to_string(),
            format!(
                "{} 已固定到 {}，出口为 {}，本模块无需处理。",
                target.host,
                pinned.clone().unwrap_or_else(|| "本机 DNS 解析结果".to_string()),
                egress_name
            ),
        ),
        Verdict::DirectOk => (
            "路由已通，无需处理".to_string(),
            format!("{} 的出口为 {}，无需处理。", target.host, egress_name),
        ),
        Verdict::HostsOnly => (
            "仅缺 DNS 固定".to_string(),
            format!(
                "实际地址 {} 可由 {} 直达，路由不缺，只需将域名固定到 hosts。",
                chosen.map(|c| c.to_string()).unwrap_or_default(),
                egress_name
            ),
        ),
        Verdict::NeedRoute => (
            "缺少绑定的路由".to_string(),
            format!(
                "实际地址 {} 仍从接管方网卡 {} 发出（源地址 {}）。仅固定 hosts 不足，需添加绑定该接口的持久路由。",
                chosen.map(|c| c.to_string()).unwrap_or_else(|| target.host.clone()),
                taker_name,
                egress.as_ref().map(|e| e.source.clone()).unwrap_or_default()
            ),
        ),
        Verdict::Unreachable => (
            "目标不可达，暂不添加".to_string(),
            if let Some(err) = doh_err {
                format!("无法获取实际地址：{err}")
            } else if !probe_err.is_empty() {
                format!(
                    "候选地址 {} 均连接失败：{}。若服务不在默认端口，请以 URL 形式写明端口，例如 http://{}:8080/",
                    real_ips
                        .iter()
                        .map(|i| i.to_string())
                        .collect::<Vec<_>>()
                        .join(" / "),
                    probe_err,
                    target.host
                )
            } else {
                "没有可用的候选地址".to_string()
            },
        ),
        Verdict::EgressUnknown => (
            "出口路由无法判定".to_string(),
            format!(
                "{} 连通性正常，但出口路由查询无结果（系统瞬时故障或探测接口不可用）。本轮不给出写入建议，请稍后重新探测。",
                target.host
            ),
        ),
    };

    let mut pending = Vec::new();
    if recommend {
        pending.push(
            "写入后仍需将该域名加入代理客户端的直连名单，本模块不修改代理配置。".to_string(),
        );
    }
    if cdn_like {
        // 不挂在 recommend 分支里：CDN 域名 recommend 恒 false，这条警示恰恰要说给它们听
        pending.push("该域名带 CDN 轮换特征，固定后会锁定在会失效的节点上，不建议写入。".to_string());
    }

    Ok(ProbeReport {
        input: raw.trim().to_string(),
        target,
        pinned,
        local_answers: local.iter().map(|i| i.to_string()).collect(),
        hijacked,
        real_ips: real_ips.iter().map(|i| i.to_string()).collect(),
        cdn_like,
        chosen: chosen.map(|c| c.to_string()),
        http_status: status,
        probe_ms: ms,
        egress,
        verdict,
        recommend,
        stale,
        headline,
        detail,
        pending,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cidr_host_keeps_its_mask() {
        let c = parse_target("172.36.0.0/16").unwrap();
        assert_eq!(c.kind, "cidr");
        assert_eq!(c.host, "172.36.0.0/16");
    }

    #[test]
    fn route_entries_are_judged_by_egress_not_by_liveness() {
        let ip: Option<Ipv4Addr> = None;
        let eg = |taker: bool| Egress {
            if_index: 1,
            interface: "vEthernet (TUN)".to_string(),
            source: "198.18.0.55".to_string(),
            next_hop: "169.254.99.99".to_string(),
            is_taker: taker,
        };
        // 内网机器不在 443 上监听是常态：探不通也不许判不可达，出口说了算
        assert_eq!(decide(ip, Some(&eg(true)), false, "ip", None), Verdict::NeedRoute);
        assert_eq!(decide(ip, Some(&eg(false)), false, "ip", None), Verdict::DirectOk);
        assert_eq!(decide(ip, None, false, "ip", None), Verdict::EgressUnknown);
    }

    #[test]
    fn fake_ip_range_covers_benchmarking_block() {
        assert!(in_fake_ip("198.18.0.1".parse().unwrap()));
        assert!(in_fake_ip("198.19.255.254".parse().unwrap()));
        assert!(!in_fake_ip("198.17.0.1".parse().unwrap()));
        assert!(!usable_v4("198.18.0.80".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn parses_domain_url_ip_and_cidr() {
        let d = parse_target("Xtbg.Xylink.com.").unwrap();
        assert_eq!(d.kind, "domain");
        assert_eq!(d.host, "xtbg.xylink.com");
        assert_eq!(d.port, 443);

        let u = parse_target("http://qa525ob.xiaoyuonline.com:9090/a").unwrap();
        assert_eq!(u.port, 9090);
        assert_eq!(u.path, "/a");

        let i = parse_target("172.30.2.109").unwrap();
        assert_eq!(i.kind, "ip");

        let c = parse_target("172.30.2.0/24").unwrap();
        assert_eq!(c.kind, "cidr");

        assert!(parse_target("ftp://a.com").is_err());
        assert!(parse_target("http://user:pw@a.com").is_err());
        assert!(parse_target("172.30.2.0/33").is_err());
        assert!(parse_target("not a domain").is_err());
    }

    #[test]
    fn rejects_reserved_and_fake_ip_targets() {
        assert!(parse_target("198.18.0.5").is_err());
        assert!(parse_target("127.0.0.1").is_err());
        assert!(parse_target("169.254.1.1").is_err());
        assert!(parse_target("224.0.0.1").is_err());
        assert!(parse_target("198.18.0.0/16").is_err());
        assert!(parse_target("http://198.19.0.7:8080/").is_err());
        assert!(parse_target("172.30.2.109").is_ok());
    }

    fn eg(taker: bool) -> Egress {
        Egress {
            if_index: 1,
            interface: "x".into(),
            source: "1.1.1.1".into(),
            next_hop: "1.1.1.254".into(),
            is_taker: taker,
        }
    }

    #[test]
    fn verdict_matrix() {
        let ip: Option<Ipv4Addr> = "172.30.2.109".parse().ok();
        // 公网站没被接管、没钉过 → 直连可用，不得推荐去钉 hosts（规格明令）
        assert_eq!(
            decide(ip, Some(&eg(false)), false, "domain", None),
            Verdict::DirectOk
        );
        // 被接管、没钉 → 只缺 hosts 固定
        assert_eq!(
            decide(ip, Some(&eg(false)), true, "domain", None),
            Verdict::HostsOnly
        );
        // 钉的正是探活成功的真址 → 原地可续
        assert_eq!(
            decide(ip, Some(&eg(false)), true, "domain", Some("172.30.2.109")),
            Verdict::DirectOk
        );
        // 钉错了址但被接管 → 仍需重写 hosts
        assert_eq!(
            decide(ip, Some(&eg(false)), true, "domain", Some("10.0.0.1")),
            Verdict::HostsOnly
        );
        // 出口是接管方 → 缺路由
        assert_eq!(
            decide(ip, Some(&eg(true)), true, "domain", None),
            Verdict::NeedRoute
        );
        // 探活成功但出口查不到 ≠ 不可达
        assert_eq!(decide(ip, None, false, "domain", None), Verdict::EgressUnknown);
        // 候选全连不上
        let none: Option<Ipv4Addr> = None;
        assert_eq!(decide(none, Some(&eg(false)), false, "domain", None), Verdict::Unreachable);
        // CIDR 只看出口
        assert_eq!(decide(none, Some(&eg(false)), false, "cidr", None), Verdict::DirectOk);
        assert_eq!(decide(none, Some(&eg(true)), false, "cidr", None), Verdict::NeedRoute);
        assert_eq!(decide(none, None, false, "cidr", None), Verdict::EgressUnknown);
    }
}
