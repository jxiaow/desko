//! 局域网 IP 探测：默认路由接口优先，其次 UDP connect 本机地址。
//! 行为基准 ftp/server.py choose_lan_ip，过滤同样的病态网段。

use std::net::{IpAddr, UdpSocket};

fn octets(ip: &str) -> Option<[u8; 4]> {
    match ip.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => Some(v4.octets()),
        _ => None,
    }
}

/// 排除 loopback / link-local / 组播 / 未指定 / 基准测试段 198.18.0.0/15 /
/// 运营商共享段 100.64.0.0/10，只要私网地址
pub fn is_preferred_lan_octets(o: [u8; 4]) -> bool {
    let [a, b, ..] = o;
    if a == 127 || a == 0 {
        return false; // loopback / unspecified
    }
    if a == 169 && b == 254 {
        return false; // link-local
    }
    if a >= 224 {
        return false; // multicast & 以上
    }
    if a == 198 && (b == 18 || b == 19) {
        return false; // 198.18.0.0/15 benchmarking
    }
    if a == 100 && (b >= 64 && b <= 127) {
        return false; // 100.64.0.0/10 CGNAT
    }
    // 私网三段的等价判断（上面已排除所有非私网常见形态里的公网首段）
    a == 10 || a == 172 && (16..=31).contains(&b) || a == 192 && b == 168
}

/// 放宽一档的候选判断：非 loopback/link-local/组播/基准段即可（原版第二梯队）
pub fn is_acceptable_lan_octets(o: [u8; 4]) -> bool {
    let [a, b, ..] = o;
    !(a == 127 || a == 0 || (a == 169 && b == 254) || a >= 224 || (a == 198 && (b == 18 || b == 19)))
}

fn from_ip(ip: IpAddr) -> Option<[u8; 4]> {
    match ip {
        IpAddr::V4(v4) => Some(v4.octets()),
        IpAddr::V6(_) => None,
    }
}

/// Windows：`route print -4` 里默认路由（0.0.0.0/0）接口的本机地址最可信，
/// 多网卡机器上 UDP 兜底可能选到虚拟网卡
#[cfg(windows)]
fn default_route_addresses() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let Ok(output) = std::process::Command::new("route")
        .args(["print", "-4"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    parse_route_print(&text)
}

#[cfg(not(windows))]
fn default_route_addresses() -> Vec<String> {
    Vec::new()
}

/// 解析 route print 输出：路由表 0.0.0.0/0 行的 Interface 列就是本机地址（同 ftp 原版）。
/// 列序在中英文版都固定为 目的/掩码/网关/接口/跃点数，不做接口号查表（跃点列会被误当接口号）。
pub fn parse_route_print(text: &str) -> Vec<String> {
    let mut addresses = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.trim().split_whitespace().collect();
        if parts.len() >= 5 && parts[0] == "0.0.0.0" && parts[1] == "0.0.0.0" {
            let address = parts[3].to_string();
            if octets(&address).is_some() && !addresses.contains(&address) {
                addresses.push(address);
            }
        }
    }
    addresses
}

fn udp_local_address() -> Option<String> {
    // 不会真的发包，只是让内核选出默认出口网卡的本地地址
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect(("10.255.255.255", 1)).ok()?;
    sock.local_addr().ok().map(|a| a.ip().to_string())
}

pub fn choose_lan_ip() -> String {
    let defaults = default_route_addresses();
    for address in &defaults {
        if let Some(o) = octets(address) {
            if is_preferred_lan_octets(o) {
                return address.clone();
            }
        }
    }
    for address in &defaults {
        if let Some(o) = octets(address) {
            if is_acceptable_lan_octets(o) {
                return address.clone();
            }
        }
    }
    if let Some(address) = udp_local_address() {
        if let Some(o) = from_ip(address.parse().unwrap_or(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))) {
            if is_preferred_lan_octets(o) {
                return address;
            }
        }
    }
    "127.0.0.1".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preferred_filters() {
        assert!(is_preferred_lan_octets([192, 168, 1, 10]));
        assert!(is_preferred_lan_octets([10, 0, 0, 1]));
        assert!(is_preferred_lan_octets([172, 16, 0, 1]));
        assert!(!is_preferred_lan_octets([172, 32, 0, 1])); // 172/12 之外不算私网
        assert!(!is_preferred_lan_octets([127, 0, 0, 1]));
        assert!(!is_preferred_lan_octets([169, 254, 5, 5]));
        assert!(!is_preferred_lan_octets([224, 0, 0, 1]));
        assert!(!is_preferred_lan_octets([198, 18, 0, 1]));
        assert!(!is_preferred_lan_octets([198, 19, 255, 0]));
        assert!(!is_preferred_lan_octets([100, 64, 0, 1]));
        assert!(!is_preferred_lan_octets([100, 127, 9, 9]));
        assert!(!is_preferred_lan_octets([8, 8, 8, 8])); // 公网也不显示成"局域网地址"
    }

    #[test]
    fn acceptable_is_looser_than_preferred() {
        assert!(is_acceptable_lan_octets([100, 64, 0, 1])); // CGNAT 在第二梯队可接受
        assert!(!is_acceptable_lan_octets([127, 1, 2, 3]));
        assert!(!is_acceptable_lan_octets([198, 18, 1, 1]));
    }

    #[test]
    fn route_parse_finds_default_route() {
        let sample = "
===========================================================================
Interface List
 12...00 11 22 33 44 55 ......Intel(R) Ethernet Connection
   192.168.1.23
 25...aa bb cc dd ee ff ......TAP-Windows Adapter V9
   10.8.0.6
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.23     25
          0.0.0.0          0.0.0.0       10.8.0.1         10.8.0.6     30
";
        let addrs = parse_route_print(sample);
        assert!(addrs.contains(&"192.168.1.23".to_string()), "got {:?}", addrs);
        assert!(addrs.contains(&"10.8.0.6".to_string()), "got {:?}", addrs);
    }

    #[test]
    fn route_parse_tolerates_garbage() {
        assert!(parse_route_print("not a route table").is_empty());
        assert!(parse_route_print("").is_empty());
    }
}
