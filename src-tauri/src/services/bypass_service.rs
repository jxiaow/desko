//! 直连清单探测引擎：输入一个域名/URL/IP/CIDR，判出「直连可用 / 仅缺 DNS 固定 /
//! 缺路由 / 不可达」四态。全程只读——不写 hosts、不改路由、不提权，落盘在 P2 的
//! 提权 helper 里。设计依据见 docs/design/bypass/01-bypass-module.md。

use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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

async fn local_resolve(host: &str, port: u16) -> Vec<IpAddr> {
    tokio::net::lookup_host((host, port)).await
        .map(|iter| iter.map(|a| a.ip()).collect())
        .unwrap_or_default()
}

/// 强制只走 IPv4：解析到 AAAA 黑洞时请求会先卡死在 v6 上（旧脚本同款教训）
struct V4Resolver;

impl reqwest::dns::Resolve for V4Resolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?
                .filter(|address| address.is_ipv4()).collect();
            if addresses.is_empty() {
                return Err(std::io::Error::new(std::io::ErrorKind::AddrNotAvailable,
                    format!("没有可用的 IPv4 地址：{host}")).into());
            }
            Ok(Box::new(addresses.into_iter()) as reqwest::dns::Addrs)
        })
    }
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
async fn doh_lookup(host: &str) -> (Vec<IpAddr>, bool, Option<String>) {
    let agent = match reqwest::Client::builder().no_proxy()
        .connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(15))
        .dns_resolver(std::sync::Arc::new(V4Resolver)).build() {
        Ok(agent) => agent,
        Err(error) => return (Vec::new(), false, Some(format!("请求初始化失败：{error}"))),
    };
    let mut last_err = None;
    for endpoint in DOH_ENDPOINTS {
        let url = format!("{endpoint}?name={}&type=A", url_encode(host));
        let text = match async {
            let response = agent.get(&url).send().await?.error_for_status()?;
            response.text().await
        }.await {
            Ok(text) => text,
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
async fn probe_endpoint(target: &Target, ip: Ipv4Addr) -> Result<(u16, u64), String> {
    let addr = SocketAddr::from((ip, target.port));
    let agent = reqwest::Client::builder().no_proxy()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        // 重定向到别的域名不代表当前候选地址可达；3xx 本身已经是探活成功。
        .redirect(reqwest::redirect::Policy::none())
        .resolve(&target.host, addr)
        .pool_max_idle_per_host(0)
        .build().map_err(|error| error.to_string())?;
    let started = Instant::now();
    let outcome = match agent.get(target.url()).send().await {
        // 拿到 HTTP 状态码就说明 TCP+TLS+HTTP 全通了，4xx/5xx 也算可达
        Ok(resp) => Ok(resp.status().as_u16()),
        Err(e) => Err(format!("{e}")),
    };
    let ms = started.elapsed().as_millis() as u64;
    outcome.map(|code| (code, ms))
}

async fn probe_tcp(target: &Target, ip: Ipv4Addr) -> Result<(u16, u64), String> {
    let started = Instant::now();
    let addr = SocketAddr::from((ip, target.port));
    tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(addr)).await
        .map_err(|_| "TCP 连接超时".to_string())?
        .map_err(|e| format!("TCP 连接失败：{e}"))
        .map(|_| (0u16, started.elapsed().as_millis() as u64))
}

fn egress_from_hit(hit: netguard_core::net::RouteHit) -> Egress {
    Egress {
        if_index: hit.interface_index,
        interface: netguard_core::net::interface_alias(hit.interface_index),
        source: hit.source.to_string(), next_hop: hit.next_hop.to_string(),
        is_taker: in_fake_ip(hit.source),
    }
}

fn egress_of(ip: Ipv4Addr) -> Option<Egress> {
    netguard_core::net::best_route(ip).map(egress_from_hit)
}

fn subnet_egress(hits: &[netguard_core::net::RouteHit]) -> Option<Egress> {
    // Any captured segment means the subnet still needs a route. A single direct
    // address must not stand in for the remaining addresses in the subnet.
    hits.iter().find(|hit| in_fake_ip(hit.source)).or_else(|| hits.first()).copied().map(egress_from_hit)
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
    let entry = raw.trim();
    if entry.is_empty() {
        return Err("输入内容为空".to_string());
    }
    let lower = entry.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        let rest = entry.split_once("://").map(|(_, r)| r).unwrap_or("");
        return parse_url(&lower, rest);
    }
    if entry.contains("://") {
        return Err("仅支持 http 与 https 协议".to_string());
    }
    if entry.trim_matches(['[', ']']).parse::<std::net::Ipv6Addr>().is_ok() {
        return Err("暂不支持 IPv6，请使用 IPv4 地址或可解析到 IPv4 的主机名".into());
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
            host: format!("{}/{len}", Ipv4Addr::from(u32::from(pref) & u32::from(netguard_core::prefix_len_to_mask(len as u8)))),
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
    validate_domain(entry)?;
    Ok(Target {
        kind: "domain",
        host: entry.trim_end_matches('.').to_ascii_lowercase(),
        port: 443,
        path: String::new(),
        scheme: "https",
    })
}

fn parse_url(entry: &str, authority_and_path: &str) -> Result<Target, String> {
    let scheme = if entry.starts_with("https") { "https" } else { "http" };
    let without_fragment = authority_and_path.split('#').next().unwrap_or("");
    let at = without_fragment.find(['/', '?']).unwrap_or(without_fragment.len());
    let authority = &without_fragment[..at];
    let suffix = &without_fragment[at..];
    let path = if suffix.starts_with('/') { suffix.to_string() } else { format!("/{suffix}") };
    if authority.starts_with('[') {
        return Err("暂不支持 IPv6，请使用 IPv4 地址或可解析到 IPv4 的主机名".into());
    }
    if authority.contains('@') {
        return Err("URL 中不应包含用户名与密码".to_string());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !h.contains(']') => {
            let Ok(p) = p.parse::<u16>() else {
                return Err("端口应为数字".to_string());
            };
            if p == 0 {
                return Err("端口需在 1 到 65535 之间".to_string());
            }
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
        host: host.trim_end_matches('.').to_ascii_lowercase(),
        port,
        path: path.to_string(),
        scheme,
    })
}

fn validate_domain(host: &str) -> Result<(), String> {
    let name = host.trim_end_matches('.');
    if name.is_empty() || name.len() > 253 {
        return Err("主机名需在 1 到 253 个字符之间".to_string());
    }
    if name.bytes().all(|byte| byte.is_ascii_digit() || byte == b'.') {
        return Err("IPv4 地址格式不合法，请使用完整的点分四段地址".into());
    }
    for label in name.split('.') {
        if label.is_empty()
            || label.len() > 63
            || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            || label.starts_with('-')
            || label.ends_with('-')
        {
            return Err("域名格式不合法".to_string());
        }
    }
    Ok(())
}

/// 本机 DNS（含内网 / split DNS）也是实际地址来源；公共 DoH 不认识内网域名时不能丢掉它。
fn actual_addresses(local: &[IpAddr], remote: &[IpAddr]) -> Vec<IpAddr> {
    let mut addresses = Vec::new();
    for ip in local.iter().chain(remote) {
        if usable_v4(*ip) && !addresses.contains(ip) { addresses.push(*ip); }
    }
    addresses
}

fn dns_needs_pin(local: &[IpAddr], chosen: Option<Ipv4Addr>) -> bool {
    local.iter().any(|ip| matches!(ip, IpAddr::V4(v4) if in_fake_ip(*v4)))
        || chosen.is_some_and(|ip| !local.contains(&IpAddr::V4(ip)))
}

/// 四态判定（纯函数，供单测直灌）。要点：
/// - 本机解析包含可用的候选且未被 fake-IP 接管时无需钉 hosts；只有 DoH 候选能连接、
///   但本机无法解析到它时也需要固定解析，不能将“指定 IP 可连接”当作普通域名可用。
/// - CIDR 没有可钉的地址，判据只有出口。
/// - 探活了但出口路由查不到 ≠ 不可达，给独立态，不推荐落盘。
fn decide(
    chosen: Option<Ipv4Addr>,
    egress: Option<&Egress>,
    needs_pin: bool,
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
            if kind != "domain" || (!needs_pin && pinned.is_none()) || pinned_here {
                Verdict::DirectOk
            } else {
                Verdict::HostsOnly
            }
        }
        (Some(_), None) => Verdict::EgressUnknown,
    }
}

pub async fn probe(raw: &str) -> Result<ProbeReport, String> {
    tokio::time::timeout(PROBE_BUDGET, probe_report(raw)).await
        .map_err(|_| "探测时间已用尽，请稍后重新探测".to_string())?
}

fn direct_domain_detail(host: &str, pinned: Option<&str>, egress: &str) -> String {
    match pinned {
        Some(address) => format!("{host} 的 hosts 记录指向 {address}，出口为 {egress}，当前无需更改。"),
        None => format!("{host} 的实际地址可通过 {egress} 直连，当前无需新增 hosts 或路由配置。"),
    }
}

async fn probe_report(raw: &str) -> Result<ProbeReport, String> {
    let started = Instant::now();
    let target = parse_target(raw)?;
    let pinned_map = read_pinned()?;
    let pinned = pinned_map.get(&target.host).cloned();

    let local: Vec<IpAddr> = if target.kind == "ip" {
        target.host.parse::<Ipv4Addr>().map(|v| vec![IpAddr::V4(v)]).unwrap_or_default()
    } else if target.kind == "cidr" {
        Vec::new()
    } else {
        local_resolve(&target.host, target.port).await
    };
    let hijacked = local.iter().any(|ip| match ip {
        IpAddr::V4(v4) => in_fake_ip(*v4),
        _ => false,
    });

    let (doh_ips, cdn_like, doh_err) = match target.kind {
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
        // 单标签和 mDNS 主机名只属于当前局域网，公共解析器没有对应命名空间。
        _ if !target.host.contains('.') || target.host.ends_with(".local") => (Vec::new(), false,
            (!local.iter().any(|ip| usable_v4(*ip))).then(|| "本机未解析到可用 IPv4 地址，请连接局域网或内网 VPN，并检查主机名与 DNS 设置".into())),
        _ => doh_lookup(&target.host).await,
    };

    let real_ips = actual_addresses(&local, &doh_ips);
    // 已固定且仍可达的节点优先续用，避免 CDN 换答案后把可用固定地址误判成待重写。
    let mut candidates = real_ips.clone();
    if let Some(ip) = pinned.as_ref().and_then(|p| p.parse::<IpAddr>().ok()).filter(|ip| usable_v4(*ip)) {
        candidates.retain(|candidate| *candidate != ip);
        candidates.insert(0, ip);
    }
    let mut chosen: Option<Ipv4Addr> = None;
    let mut status = None;
    let mut ms = None;
    let mut probe_err = String::new();
    for ip in &candidates {
        let IpAddr::V4(v4) = ip else { continue };
        if started.elapsed() > PROBE_BUDGET {
            probe_err = "探测时间已用尽，剩余候选地址未试".to_string();
            break;
        }
        // ip 目标走裸 TCP：没有域名可校验 TLS，也无需 HTTP 语义
        let attempt = if target.kind == "ip" {
            probe_tcp(&target, *v4).await
        } else {
            probe_endpoint(&target, *v4).await
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
    let egress = if target.kind == "cidr" {
        let len = target.host.split_once('/').and_then(|(_, len)| len.parse::<u8>().ok());
        egress_ip.zip(len).and_then(|(prefix, len)| netguard_core::net::prefix_routes(prefix, len))
            .and_then(|hits| subnet_egress(&hits))
    } else { egress_ip.and_then(egress_of) };

    let verdict = decide(chosen, egress.as_ref(), dns_needs_pin(&local, chosen), target.kind, pinned.as_deref());

    let recommend =
        !cdn_like && matches!(verdict, Verdict::HostsOnly | Verdict::NeedRoute);
    // stale 两条腿（规格 §4）：钉的 IP 不在 DoH 答案里，且指定它探活也失败。
    // 只看第一条腿会在 DoH 整体失败时把全部已钉条目误判成过期。
    let stale = match (target.kind, pinned.as_ref()) {
        ("domain", Some(p)) => {
            let in_answers = doh_ips.iter().any(|ip| ip.to_string() == *p);
            if in_answers || doh_ips.is_empty() || chosen.map(|ip| ip.to_string()).as_ref() == Some(p) {
                false
            } else if started.elapsed() > PROBE_BUDGET {
                // 预算内没机会复核第二腿，宁可不下「过期」结论
                false
            } else {
                match p.parse::<Ipv4Addr>() {
                    Ok(v4) => probe_endpoint(&target, v4).await.is_err(),
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
            direct_domain_detail(&target.host, pinned.as_deref(), &egress_name),
        ),
        Verdict::DirectOk => (
            "出口可直连".to_string(),
            if target.kind == "cidr" { "已按当前路由表复查网段内的各段出口，均未检测到代理接口。未逐一检查网段内的具体服务。".into() }
            else { format!("{} 的出口为 {}，无需处理。", target.host, egress_name) },
        ),
        Verdict::HostsOnly => (
            "需配置 hosts".to_string(),
            format!(
                "实际地址 {} 可通过 {} 直连。需要添加 hosts 记录，让该域名解析到此地址。",
                chosen.map(|c| c.to_string()).unwrap_or_default(),
                egress_name
            ),
        ),
        Verdict::NeedRoute => (
            "需配置路由".to_string(),
            format!(
                "实际地址 {} 当前通过代理接口 {} 发出（源地址 {}）。需要添加持久路由，改用非代理接口。",
                chosen.map(|c| c.to_string()).unwrap_or_else(|| target.host.clone()),
                taker_name,
                egress.as_ref().map(|e| e.source.clone()).unwrap_or_default()
            ),
        ),
        Verdict::Unreachable => (
            "目标不可达，暂不添加".to_string(),
            if real_ips.is_empty() && doh_err.is_some() {
                format!("无法获取实际地址：{}", doh_err.as_deref().unwrap_or_default())
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
                "未查询到 {} 的出口路由，暂时无法确定直连配置。请稍后重新探测。",
                target.host
            ),
        ),
    };

    let mut pending = Vec::new();
    if recommend {
        pending.push(
            "配置后，如使用代理客户端，还需将该目标加入其直连规则。".to_string(),
        );
    }
    if cdn_like {
        // 不挂在 recommend 分支里：CDN 域名 recommend 恒 false，这条警示恰恰要说给它们听
        pending.push("该域名的地址可能随 CDN 节点变化。不建议固定；确需固定时，请定期重新探测并更新配置。".to_string());
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
    fn subnet_report_cannot_hide_a_captured_segment_behind_its_first_direct_address() {
        let hit = |source: &str, index| netguard_core::net::RouteHit {
            source: source.parse().unwrap(), next_hop: Ipv4Addr::UNSPECIFIED, interface_index: index,
        };
        let hits = [hit("192.168.1.5", 1), hit("198.18.0.1", 7)];
        let egress = subnet_egress(&hits).unwrap();
        assert_eq!(egress.if_index, 7);
        assert_eq!(decide(None, Some(&egress), false, "cidr", None), Verdict::NeedRoute);
        assert!(subnet_egress(&[]).is_none());
    }

    #[test]
    fn split_dns_keeps_local_ipv4_even_when_public_dns_has_no_answer() {
        let local = vec!["10.20.0.2".parse().unwrap(), "198.18.0.2".parse().unwrap(), "::1".parse().unwrap()];
        let remote = vec!["203.0.113.5".parse().unwrap(), "10.20.0.2".parse().unwrap()];
        assert_eq!(actual_addresses(&local, &[]), vec![local[0]]);
        assert_eq!(actual_addresses(&local, &remote), vec![local[0], remote[0]]);
        let usable_local = vec![local[0]];
        assert_eq!(decide(Some("10.20.0.2".parse().unwrap()), Some(&eg(false)),
            dns_needs_pin(&usable_local, Some("10.20.0.2".parse().unwrap())), "domain", None), Verdict::DirectOk);
    }

    #[test]
    fn working_doh_address_still_needs_hosts_when_system_dns_cannot_use_it() {
        let ip = Some("10.20.0.2".parse().unwrap());
        for local in [vec![], vec!["10.20.0.3".parse().unwrap()], vec!["198.18.0.2".parse().unwrap()]] {
            assert_eq!(decide(ip, Some(&eg(false)), dns_needs_pin(&local, ip), "domain", None), Verdict::HostsOnly);
        }
    }

    #[test]
    fn direct_report_distinguishes_existing_hosts_from_unpinned_access() {
        let unpinned = direct_domain_detail("public.test", None, "Ethernet");
        assert!(unpinned.contains("无需新增"));
        assert!(!unpinned.contains("hosts 记录指向"));
        assert!(!unpinned.contains("已固定"));
        let pinned = direct_domain_detail("internal.test", Some("10.0.0.2"), "VPN");
        assert!(pinned.contains("hosts 记录指向 10.0.0.2"));
        assert!(pinned.contains("VPN"));
    }

    #[test]
    fn parses_single_label_lan_hosts_and_explicitly_rejects_ipv6() {
        for input in ["NAS", "nas.", "a", "printer-01"] {
            let target = parse_target(input).unwrap();
            assert_eq!(target.kind, "domain");
            assert_eq!(target.host, input.trim_end_matches('.').to_ascii_lowercase());
        }
        let target = parse_target("http://NAS:8080/Status?Q=AbC").unwrap();
        assert_eq!((target.host.as_str(), target.port, target.path.as_str()), ("nas", 8080, "/Status?Q=AbC"));
        for input in ["::1", "[::1]", "http://[2001:db8::1]:8080/"] {
            assert!(parse_target(input).err().unwrap().contains("暂不支持 IPv6"));
        }
        for input in ["123", "1.2.3", "999.1.1.1", "bad_name", "-nas", "nas-"] {
            assert!(parse_target(input).is_err(), "{input}");
        }
    }

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
    fn url_preserves_case_query_and_removes_fragment() {
        let t = parse_target("HTTPS://Example.COM.:8443/Api/Token?Key=AbC#section").unwrap();
        assert_eq!(t.host, "example.com");
        assert_eq!(t.path, "/Api/Token?Key=AbC");
        assert_eq!(t.port, 8443);
        assert_eq!(parse_target("https://example.com?Key=AbC").unwrap().path, "/?Key=AbC");
        assert!(parse_target("http://example.com:0/").is_err());
    }

    #[test]
    fn cidr_is_normalized_to_network_address() {
        assert_eq!(parse_target("10.20.3.7/16").unwrap().host, "10.20.0.0/16");
        assert!(parse_target(&format!("{}.com", "a".repeat(64))).is_err());
    }

    #[test]
    fn a_different_managed_pin_still_needs_repair_without_fake_ip() {
        let ip = "10.20.0.2".parse().ok();
        assert_eq!(decide(ip, Some(&eg(false)), false, "domain", Some("10.20.0.1")), Verdict::HostsOnly);
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

    #[tokio::test]
    async fn async_probe_preserves_url_and_accepts_redirect_without_following() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let len = stream.read(&mut request).await.unwrap();
            stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://unreachable.example.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
            String::from_utf8_lossy(&request[..len]).to_string()
        });
        let target = parse_target(&format!("HTTP://Example.COM:{port}/Api?Key=AbC")).unwrap();
        let (status, _) = probe_endpoint(&target, Ipv4Addr::LOCALHOST).await.unwrap();
        assert_eq!(status, 302);
        let request = server.await.unwrap();
        assert!(request.starts_with("GET /Api?Key=AbC HTTP/1.1"));
        assert!(request.to_lowercase().contains(&format!("host: example.com:{port}")));
    }

    #[tokio::test]
    async fn cancelling_closes_an_inflight_http_probe_connection() {
        use tokio::io::AsyncReadExt;
        use tokio::sync::oneshot;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (started, ready) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            stream.read(&mut request).await.unwrap();
            started.send(()).unwrap();
            let mut byte = [0; 1];
            tokio::time::timeout(Duration::from_secs(2), stream.read(&mut byte)).await.unwrap().unwrap()
        });
        let id = uuid::Uuid::new_v4().to_string();
        let job_id = id.clone();
        let target = parse_target(&format!("http://example.com:{port}/")).unwrap();
        let probe = tokio::spawn(async move {
            crate::services::bypass_probe_job::run(Some(job_id), probe_endpoint(&target, Ipv4Addr::LOCALHOST)).await
        });
        ready.await.unwrap();
        crate::services::bypass_probe_job::cancel(&id).unwrap();
        assert!(probe.await.unwrap().is_err());
        assert_eq!(server.await.unwrap(), 0, "取消后 TCP 连接必须关闭，不能继续等待 HTTP 超时");
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
