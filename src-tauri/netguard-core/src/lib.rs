//! desko-netguard 的共享核心：hosts 托管区读写规则、任务书/回执协议、路由表核验。
//!
//! 主进程与提权 helper 都从这里取同一份规则——两边对托管区块的认知必须逐字一致，
//! 各写一份迟早会出现「一边认的块另一边不认」。设计依据：
//! docs/design/bypass/02-netguard-apply.md。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr};

mod hosts_bytes;
mod route_selection;
pub use hosts_bytes::{apply_pins_bytes, restore_managed_bytes};

pub const HOSTS_BEGIN: &str = "# BEGIN TUN-BYPASS-MANAGED";
pub const HOSTS_END: &str = "# END TUN-BYPASS-MANAGED";

/// 一轮落盘的预算。UAC 那一下由系统自己等人，这里只兜 helper 卡住不回的场面。
pub const APPLY_BUDGET_MS: u32 = 90_000;

/// 托管区之外的字节一律不动，所以写入只替换块内。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum TaskItem {
    #[serde(rename_all = "camelCase")]
    Pin {
        id: String,
        host: String,
        address: String,
    },
    #[serde(rename_all = "camelCase")]
    Route {
        id: String,
        prefix: String,
        prefix_len: u8,
        gateway: String,
        interface_index: u32,
        interface_alias: String,
    },
}

impl TaskItem {
    pub fn id(&self) -> &str {
        match self {
            TaskItem::Pin { id, .. } | TaskItem::Route { id, .. } => id,
        }
    }
    /// 回执里带出去的短名，与 serde tag 同名
    pub fn op_name(&self) -> &'static str {
        match self {
            TaskItem::Pin { .. } => "pin",
            TaskItem::Route { .. } => "route",
        }
    }
}

/// 任务书要做的事：写入，或按回滚点撤销上一次写入
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    #[default]
    Apply,
    Revert,
}

/// 任务书：主进程写、helper 读。路径全部由主进程给，helper 不猜任何策略。
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskFile {
    pub batch_id: String,
    pub mode: Mode,
    pub created_at: i64,
    pub hosts_path: String,
    pub receipt_path: String,
    /// Apply：写完前的 hosts 原文备份落在哪；Revert：从这里读回原文
    pub hosts_backup_path: String,
    pub items: Vec<TaskItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
    pub id: String,
    /// "pin" / "route"，与 TaskItem 的 tag 同名单独给一份，前端不必再 match
    pub op: String,
    pub ok: bool,
    /// false = 系统里本来就是对的，什么都没动
    pub changed: bool,
    pub error: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptFile {
    pub batch_id: String,
    pub started_at: i64,
    pub finished_at: i64,
    pub hosts_backup: String,
    /// hosts 是否被本批改写过；撤销要靠它决定还还原
    pub hosts_written: bool,
    pub items: Vec<ItemResult>,
    pub rolled_back: bool,
    pub rollback_error: String,
    /// 自动回滚已经恢复的部分，重试时不能再删除一遍已恢复的路由。
    #[serde(default)]
    pub reverted_routes: Vec<String>,
    #[serde(default)]
    pub hosts_restored: bool,
    /// helper 自己炸了（读不到任务书等），items 此时可能为空
    pub fatal: String,
}

impl ReceiptFile {
    pub fn ok_count(&self) -> usize {
        self.items.iter().filter(|i| i.ok && i.changed).count()
    }
    pub fn skipped_count(&self) -> usize {
        self.items.iter().filter(|i| i.ok && !i.changed).count()
    }
    pub fn failed_items(&self) -> Vec<&ItemResult> {
        self.items.iter().filter(|i| !i.ok).collect()
    }
}

/// RFC 2544 基准段，各家 TUN 代理做 fake-IP 的共同选择——接管方靠它探，不点名软件
pub fn in_fake_ip(v4: Ipv4Addr) -> bool {
    let [a, b, ..] = v4.octets();
    a == 198 && (b == 18 || b == 19)
}

/// 能当 hosts 固定值用的地址：排除 0/回环/组播/链路本地/fake-IP
pub fn usable_v4(ip: IpAddr) -> bool {
    let IpAddr::V4(v4) = ip else { return false };
    let [a, b, ..] = v4.octets();
    if a == 0 || a == 127 || a >= 224 {
        return false;
    }
    if a == 169 && b == 254 {
        return false;
    }
    !in_fake_ip(v4)
}

pub fn hosts_path() -> std::path::PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
    std::path::Path::new(&root)
        .join("System32")
        .join("drivers")
        .join("etc")
        .join("hosts")
}

/// 读 hosts 管理区。必须在 DNS 解析之前读：`getaddrinfo` 会读到我们自己钉的值，
/// 不先分开就会把「已接管」误判成「直连可用」。
/// 文件读不了≠没钉过：只有「文件本就不存在」才回空表，I/O 错误必须报错，
/// 否则会拿着「未钉」的假设去判一个其实被接管的目标。
pub fn read_pinned() -> Result<BTreeMap<String, String>, String> {
    let bytes = match std::fs::read(hosts_path()) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(format!("hosts 文件读取失败：{e}")),
    };
    // 一行 GBK 注释不该废掉整轮探测：按 lossy 解，管理区标记都是 ASCII，不受编码影响
    parse_managed(&String::from_utf8_lossy(&bytes))
}

/// 管理区标记块解析（纯函数，供单测直灌文本）。嵌套、两个块、不配对一律报错，不猜。
pub fn parse_managed(text: &str) -> Result<BTreeMap<String, String>, String> {
    let mut pinned = BTreeMap::new();
    let mut inside = false;
    let mut opened = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == HOSTS_BEGIN {
            // 第二次 BEGIN：要么是第二个块，要么是嵌套，两种都不该出现
            if opened {
                return Err("hosts 中的直连管理区标记出现多次".to_string());
            }
            inside = true;
            opened = true;
            continue;
        }
        if trimmed == HOSTS_END {
            if !inside {
                return Err("hosts 中的直连管理区缺少起始标记".to_string());
            }
            inside = false;
            continue;
        }
        if !inside {
            continue;
        }
        let content = trimmed.split('#').next().unwrap_or("").trim();
        if content.is_empty() {
            continue;
        }
        let mut parts = content.split_whitespace();
        let Some(ip) = parts.next() else { continue };
        let names: Vec<&str> = parts.collect();
        if names.is_empty() {
            continue;
        }
        if ip.parse::<IpAddr>().map(|v| !usable_v4(v)).unwrap_or(true) {
            continue;
        }
        for name in names {
            pinned.insert(name.to_lowercase(), ip.to_string());
        }
    }
    if inside {
        return Err("hosts 中的直连管理区标记不完整".to_string());
    }
    Ok(pinned)
}

/// 一条要钉进托管区的记录
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub host: String,
    pub address: String,
}

/// 把若干 pin 落进托管区文本：块外字节原样保留，块内按 host 覆盖或追加。
/// 返回（新文本, 实际改变的条数）。标记不配对时直接报错，绝不"顺手补一个块"。
pub fn apply_pins(text: &str, pins: &[Pin]) -> Result<(String, usize), String> {
    let mut current = parse_managed(text)?;
    let mut changed = 0usize;
    for pin in pins {
        let host = pin.host.to_lowercase();
        if host.trim().is_empty() || pin.address.trim().is_empty() {
            return Err(format!("待固定条目不完整：{pin:?}"));
        }
        if host.len() > 253 || host.split('.').any(|label| label.is_empty() || label.len() > 63
            || label.starts_with('-') || label.ends_with('-')
            || !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) {
            return Err(format!("待固定域名格式不合法：{host}"));
        }
        if !pin.address.parse::<IpAddr>().map(usable_v4).unwrap_or(false) {
            return Err(format!("待固定地址不可用：{host} → {}", pin.address));
        }
        match current.get(&host) {
            Some(old) if old == &pin.address => {}
            _ => changed += 1,
        }
        current.insert(host, pin.address.clone());
    }
    if changed == 0 {
        return Ok((text.to_string(), 0));
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let block: Vec<String> = std::iter::once(HOSTS_BEGIN.to_string())
        .chain(current.iter().map(|(host, ip)| format!("{ip} {host}")))
        .chain(std::iter::once(HOSTS_END.to_string()))
        .collect();

    let lines: Vec<&str> = text.lines().collect();
    let begin = lines.iter().position(|l| l.trim() == HOSTS_BEGIN);
    let tail = match begin {
        Some(at) => {
            let end = lines
                .iter()
                .rposition(|l| l.trim() == HOSTS_END)
                .ok_or_else(|| "hosts 中的直连管理区标记不完整".to_string())?;
            if end < at {
                return Err("hosts 中的直连管理区标记顺序异常".to_string());
            }
            let mut out: Vec<String> = lines[..at].iter().map(|l| l.to_string()).collect();
            out.extend(block);
            out.extend(lines[end + 1..].iter().map(|l| l.to_string()));
            out
        }
        None => {
            // 从来没有过托管区：接在文件末尾，前面留一行空行隔开
            let mut out: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            while out.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
                out.pop();
            }
            out.push(String::new());
            out.extend(block);
            out
        }
    };
    let mut rendered = tail.join(eol);
    if text.ends_with('\n') {
        rendered.push_str(eol);
    }
    Ok((rendered, changed))
}

/// `route.exe` 的加参：只认退出码，不解析它那口本地化输出（本机代码页 936）。
/// `-p` 才进注册表 PersistentRoutes，重启后还在。
pub fn route_add_args(
    prefix: &str,
    prefix_len: u8,
    gateway: &str,
    interface_index: u32,
) -> Vec<String> {
    vec![
        "-p".into(),
        "add".into(),
        prefix.into(),
        "mask".into(),
        prefix_len_to_mask(prefix_len).to_string(),
        gateway.into(),
        "if".into(),
        interface_index.to_string(),
    ]
}

pub fn route_delete_args(prefix: &str, prefix_len: u8, gateway: &str, interface_index: u32) -> Vec<String> {
    vec![
        "-p".into(),
        "delete".into(),
        prefix.into(),
        "mask".into(),
        prefix_len_to_mask(prefix_len).to_string(),
        gateway.into(),
        "if".into(),
        interface_index.to_string(),
    ]
}

pub fn prefix_len_to_mask(len: u8) -> Ipv4Addr {
    if len > 32 {
        return Ipv4Addr::UNSPECIFIED;
    }
    let bits = if len == 0 { 0u32 } else { u32::MAX << (32 - len) };
    Ipv4Addr::from(bits)
}

pub fn mask_to_prefix_len(mask: Ipv4Addr) -> Option<u8> {
    let bits = u32::from(mask);
    let ones = bits.count_ones() as u8;
    // 非连续掩码（中间有洞）一律不收：路由表里不会有，出现即说明上游算错了
    if bits == 0 {
        return Some(0);
    }
    let expected = u32::MAX << (32 - ones);
    if bits == expected {
        Some(ones)
    } else {
        None
    }
}

/// 路由表与最优路由查询。主进程用它做网关落段校验，helper 用它做落盘后即时校验。
pub mod net {
    use super::*;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct RouteHit {
        pub interface_index: u32,
        pub next_hop: Ipv4Addr,
        pub source: Ipv4Addr,
    }

    #[cfg(windows)]
    fn v4_sock(ip: Ipv4Addr) -> windows::Win32::Networking::WinSock::SOCKADDR_INET {
        use windows::Win32::Networking::WinSock::{
            AF_INET, IN_ADDR, IN_ADDR_0, SOCKADDR_IN, SOCKADDR_INET,
        };
        SOCKADDR_INET {
            Ipv4: SOCKADDR_IN {
                sin_family: AF_INET,
                sin_addr: IN_ADDR {
                    S_un: IN_ADDR_0 {
                        S_addr: u32::from_ne_bytes(ip.octets()),
                    },
                },
                ..Default::default()
            },
        }
    }

    #[cfg(windows)]
    fn sock_v4(sock: &windows::Win32::Networking::WinSock::SOCKADDR_INET) -> Ipv4Addr {
        // S_addr 就是按地址顺序摊在内存里的四个字节，ne_bytes 直接还原点分四段
        unsafe { Ipv4Addr::from(sock.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()) }
    }

    /// 目标当前走哪块卡、下一跳是谁
    #[cfg(windows)]
    fn best_route_on_interface(dest: Ipv4Addr, interface_index: u32) -> Option<RouteHit> {
        use windows::Win32::NetworkManagement::IpHelper::{GetBestRoute2, MIB_IPFORWARD_ROW2};
        let dest = v4_sock(dest);
        let mut row = MIB_IPFORWARD_ROW2::default();
        let mut src = Default::default();
        if unsafe { GetBestRoute2(None, interface_index, None, &dest, 0, &mut row, &mut src) }.0 != 0 {
            return None;
        }
        Some(RouteHit {
            interface_index: row.InterfaceIndex,
            next_hop: sock_v4(&row.NextHop),
            source: sock_v4(&src),
        })
    }

    #[cfg(windows)]
    pub fn best_route(dest: Ipv4Addr) -> Option<RouteHit> {
        best_route_on_interface(dest, 0)
    }

    #[cfg(not(windows))]
    fn best_route_on_interface(_dest: Ipv4Addr, _index: u32) -> Option<RouteHit> { None }

    #[cfg(not(windows))]
    pub fn best_route(_dest: Ipv4Addr) -> Option<RouteHit> {
        None
    }

    /// A route can change only at a route prefix's start/end. Probe those boundaries
    /// rather than one representative host or every address in a large subnet.
    fn prefix_probe_points(prefix: Ipv4Addr, prefix_len: u8, rows: &[(Ipv4Addr, u8, Ipv4Addr, u32, u32)]) -> Vec<Ipv4Addr> {
        if prefix_len > 32 { return Vec::new(); }
        let start = u32::from(prefix) & u32::from(prefix_len_to_mask(prefix_len));
        let end = start as u64 + (1u64 << (32 - prefix_len)) - 1;
        let mut points = std::collections::BTreeSet::from([start]);
        for (net, len, ..) in rows {
            if *len > 32 { continue; }
            let first = (u32::from(*net) & u32::from(prefix_len_to_mask(*len))) as u64;
            let after = first + (1u64 << (32 - *len));
            for point in [first, after] {
                if point >= start as u64 && point <= end { points.insert(point as u32); }
            }
        }
        points.into_iter().map(Ipv4Addr::from).collect()
    }

    /// Every distinct route segment within a subnet, using the same Windows route decision as single IPs.
    #[cfg(windows)]
    pub fn prefix_routes(prefix: Ipv4Addr, prefix_len: u8) -> Option<Vec<RouteHit>> {
        let rows = forward_rows()?;
        let points = prefix_probe_points(prefix, prefix_len, &rows);
        if points.is_empty() { return None; }
        let mut hits = Vec::new();
        for point in points {
            let hit = best_route(point)?;
            if !hits.contains(&hit) { hits.push(hit); }
        }
        Some(hits)
    }

    #[cfg(not(windows))]
    pub fn prefix_routes(_prefix: Ipv4Addr, _prefix_len: u8) -> Option<Vec<RouteHit>> { None }

    /// 网关必须落在候选接口自己的网段内，否则 Windows 判路由不可用、静默回落默认
    /// 路由，流量重新被接管方拿走——症状是"路由在，却不通"。判据：路由到该网关时
    /// 选中的就是这块卡，且下一跳为空（命中 on-link 前缀路由）。
    pub fn gateway_on_link(interface_index: u32, gateway: Ipv4Addr) -> bool {
        match best_route_on_interface(gateway, interface_index) {
            Some(hit) => hit.interface_index == interface_index && hit.next_hop == Ipv4Addr::UNSPECIFIED
                && usable_v4(IpAddr::V4(hit.source)),
            None => false,
        }
    }

    fn on_link_prefix_covers(
        row_prefix: Ipv4Addr, row_len: u8, hop: Ipv4Addr,
        prefix: Ipv4Addr, prefix_len: u8,
    ) -> bool {
        hop == Ipv4Addr::UNSPECIFIED && row_len > 0 && row_len <= 32
            && row_len <= prefix_len && prefix_len <= 32 && covers_prefix(row_prefix, row_len, prefix)
    }

    /// 计划与 helper 共用的最后一道闸。0.0.0.0 表示 on-link，没有下一跳可查；
    /// 核验目标前缀确实落在指定接口上，而非查询 0.0.0.0 的默认出口。
    pub fn route_binding_valid(prefix: Ipv4Addr, prefix_len: u8, gateway: Ipv4Addr, interface_index: u32) -> bool {
        if prefix_len > 32 || interface_index == 0 { return false; }
        if gateway != Ipv4Addr::UNSPECIFIED && !usable_v4(IpAddr::V4(gateway)) { return false; }
        if gateway != Ipv4Addr::UNSPECIFIED { return gateway_on_link(interface_index, gateway); }
        #[cfg(windows)]
        { best_route_on_interface(prefix, interface_index).filter(|hit| usable_v4(IpAddr::V4(hit.source))).is_some()
            && forward_rows().map(|rows| rows.iter().any(|(net, len, hop, idx, _)|
            *idx == interface_index && on_link_prefix_covers(*net, *len, *hop, prefix, prefix_len))).unwrap_or(false) }
        #[cfg(not(windows))]
        { false }
    }

    /// 整张 IPv4 路由表摊成元组：一次读表，多处用
    #[cfg(windows)]
    fn forward_rows() -> Option<Vec<(Ipv4Addr, u8, Ipv4Addr, u32, u32)>> {
        use windows::Win32::NetworkManagement::IpHelper::{
            FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_TABLE2,
        };
        use windows::Win32::Networking::WinSock::AF_INET;
        let mut table: *mut MIB_IPFORWARD_TABLE2 = std::ptr::null_mut();
        if unsafe { GetIpForwardTable2(AF_INET, &mut table) }.0 != 0 {
            return None;
        }
        let rows = unsafe {
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize)
                .iter()
                .map(|row| {
                    (
                        sock_v4(&row.DestinationPrefix.Prefix),
                        row.DestinationPrefix.PrefixLength,
                        sock_v4(&row.NextHop),
                        row.InterfaceIndex,
                        row.Metric,
                    )
                })
                .collect()
        };
        unsafe { FreeMibTable(table as *const core::ffi::c_void) };
        Some(rows)
    }

    /// 路由表里是否已有「该前缀 + 该网关 + 该接口」这一条
    #[cfg(windows)]
    pub fn forward_exists(
        prefix: Ipv4Addr,
        prefix_len: u8,
        gateway: Ipv4Addr,
        interface_index: u32,
    ) -> bool {
        match forward_rows() {
            Some(rows) => rows.iter().any(|(net, len, hop, idx, _)| {
                *idx == interface_index && *len == prefix_len && *net == prefix && *hop == gateway
            }),
            None => false,
        }
    }

    #[cfg(not(windows))]
    pub fn forward_exists(
        _prefix: Ipv4Addr,
        _prefix_len: u8,
        _gateway: Ipv4Addr,
        _interface_index: u32,
    ) -> bool {
        false
    }

    /// 接口别名（界面显示用），查不到时退回 `接口 #N`
    #[cfg(windows)]
    pub fn interface_alias(interface_index: u32) -> String {
        use windows::Win32::NetworkManagement::IpHelper::{GetIfEntry2, MIB_IF_ROW2};
        let mut row = MIB_IF_ROW2 { InterfaceIndex: interface_index, ..Default::default() };
        if unsafe { GetIfEntry2(&mut row) }.0 != 0 {
            return format!("接口 #{interface_index}");
        }
        let end = row.Alias.iter().position(|c| *c == 0).unwrap_or(row.Alias.len());
        let name = String::from_utf16_lossy(&row.Alias[..end]);
        if name.trim().is_empty() {
            format!("接口 #{interface_index}")
        } else {
            name
        }
    }

    #[cfg(not(windows))]
    pub fn interface_alias(interface_index: u32) -> String {
        format!("接口 #{interface_index}")
    }

    /// 一条路由要绑成什么样
    #[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct RoutePlan {
        pub interface_index: u32,
        pub interface_alias: String,
        pub gateway: Ipv4Addr,
        /// 目标在该接口链路上，网关为 0.0.0.0；可与该接口的默认路由并存。
        pub gateway_is_on_link: bool,
    }

    /// 只读生成自动方案及可供选择的出口；接口不可用、fake-IP 和接管方均排除。
    #[cfg(windows)]
    pub fn route_choices_for(prefix: Ipv4Addr, prefix_len: u8, exclude: Option<u32>) -> (Option<RoutePlan>, Vec<RoutePlan>) {
        use windows::Win32::NetworkManagement::IpHelper::{GetIpInterfaceEntry, MIB_IPINTERFACE_ROW};
        use windows::Win32::Networking::WinSock::AF_INET;
        let Some(mut rows) = forward_rows() else { return (None, Vec::new()); };
        let mut metrics = std::collections::HashMap::new();
        rows.retain_mut(|(_, _, _, index, metric)| {
            let interface_metric = metrics.entry(*index).or_insert_with(|| {
                let mut row = MIB_IPINTERFACE_ROW { Family: AF_INET, InterfaceIndex: *index, ..Default::default() };
                (unsafe { GetIpInterfaceEntry(&mut row) }.0 == 0 && row.Connected).then_some(row.Metric)
            });
            match interface_metric {
                Some(value) => { *metric = metric.saturating_add(*value); true }
                None => false,
            }
        });
        let candidates: Vec<_> = crate::route_selection::candidates(&rows, prefix, prefix_len, exclude)
            .into_iter().filter(|r| route_binding_valid(prefix, prefix_len, r.gateway, r.interface_index)).collect();
        let automatic = crate::route_selection::automatic(&candidates, prefix);
        let to_plan = |r: &crate::route_selection::Candidate| RoutePlan {
            interface_index: r.interface_index, interface_alias: interface_alias(r.interface_index),
            gateway: r.gateway, gateway_is_on_link: r.gateway == Ipv4Addr::UNSPECIFIED,
        };
        (automatic.map(&to_plan), candidates.iter().map(to_plan).collect())
    }

    #[cfg(not(windows))]
    pub fn route_choices_for(_prefix: Ipv4Addr, _prefix_len: u8, _exclude: Option<u32>) -> (Option<RoutePlan>, Vec<RoutePlan>) {
        (None, Vec::new())
    }

    pub fn route_plan_for(prefix: Ipv4Addr, prefix_len: u8, exclude: Option<u32>) -> Option<RoutePlan> {
        route_choices_for(prefix, prefix_len, exclude).0
    }

    #[cfg(test)]
    mod binding_tests {
        use super::*;
        #[test]
        fn subnet_probe_points_cover_nested_route_changes_and_ipv4_boundaries() {
            let row = |prefix: &str, len| (prefix.parse().unwrap(), len, Ipv4Addr::UNSPECIFIED, 1, 0);
            let rows = vec![row("0.0.0.0", 0), row("10.0.0.0", 32), row("10.0.0.64", 26), row("10.0.1.0", 24)];
            let points = prefix_probe_points("10.0.0.0".parse().unwrap(), 24, &rows);
            assert_eq!(points.iter().map(ToString::to_string).collect::<Vec<_>>(),
                vec!["10.0.0.0", "10.0.0.1", "10.0.0.64", "10.0.0.128"]);
            assert_eq!(prefix_probe_points("255.255.255.255".parse().unwrap(), 32,
                &[row("255.255.255.255", 32)]), vec!["255.255.255.255".parse::<Ipv4Addr>().unwrap()]);
            assert_eq!(prefix_probe_points(Ipv4Addr::UNSPECIFIED, 0, &[]), vec![Ipv4Addr::UNSPECIFIED]);
            assert!(prefix_probe_points(Ipv4Addr::UNSPECIFIED, 33, &rows).is_empty());
        }

        #[test]
        fn on_link_binding_checks_the_target_prefix_instead_of_a_default_gateway() {
            let row = "10.20.0.0".parse().unwrap();
            let target = "10.20.0.25".parse().unwrap();
            assert!(on_link_prefix_covers(row, 24, Ipv4Addr::UNSPECIFIED, target, 32));
            assert!(on_link_prefix_covers(row, 24, Ipv4Addr::UNSPECIFIED, row, 24));
            assert!(!on_link_prefix_covers(row, 24, Ipv4Addr::UNSPECIFIED, row, 16));
            assert!(!on_link_prefix_covers(row, 24, "10.20.0.1".parse().unwrap(), target, 32));
            assert!(!on_link_prefix_covers(row, 24, Ipv4Addr::UNSPECIFIED, "10.21.0.25".parse().unwrap(), 32));
            assert!(!on_link_prefix_covers(Ipv4Addr::UNSPECIFIED, 0, Ipv4Addr::UNSPECIFIED, target, 32));
        }
    }

    /// 纯函数版归属判断，供单测直灌
    pub fn covers_prefix(net: Ipv4Addr, len: u8, target: Ipv4Addr) -> bool {
        if len > 32 {
            return false;
        }
        let mask = u32::from(prefix_len_to_mask(len));
        (u32::from(net) & mask) == (u32::from(target) & mask)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pinned_of(text: &str) -> Vec<(String, String)> {
        parse_managed(text)
            .unwrap()
            .into_iter()
            .map(|(k, v)| (k, v))
            .collect()
    }

    #[test]
    fn hosts_marker_state_machine() {
        let ok = "# BEGIN TUN-BYPASS-MANAGED\n172.30.2.109 xtbg.test # 行尾注释\n# END TUN-BYPASS-MANAGED\n";
        assert_eq!(pinned_of(ok), vec![("xtbg.test".into(), "172.30.2.109".into())]);
        assert!(parse_managed(&format!("{ok}{ok}")).is_err());
        assert!(parse_managed("# END TUN-BYPASS-MANAGED\n").is_err());
        assert!(parse_managed("# BEGIN TUN-BYPASS-MANAGED\n1.2.3.4 a.test\n").is_err());
        assert!(parse_managed("1.2.3.4 stray.test\n").unwrap().is_empty());
    }

    #[test]
    fn apply_pins_keeps_bytes_outside_the_block() {
        let src = "# localhost\r\n127.0.0.1 localhost\r\n\r\n# BEGIN TUN-BYPASS-MANAGED\r\n10.0.0.2 old.test\r\n# END TUN-BYPASS-MANAGED\r\n# 尾部注释\r\n";
        let (out, changed) = apply_pins(
            src,
            &[
                Pin { host: "new.test".into(), address: "10.0.0.3".into() },
                Pin { host: "old.test".into(), address: "10.0.0.9".into() },
            ],
        )
        .unwrap();
        assert_eq!(changed, 2);
        assert!(out.starts_with("# localhost\r\n127.0.0.1 localhost\r\n\r\n"));
        assert!(out.ends_with("# END TUN-BYPASS-MANAGED\r\n# 尾部注释\r\n"));
        // 块内按 host 排序，旧条目被覆盖而不是并存
        assert!(out.contains("10.0.0.9 old.test"));
        assert!(!out.contains("10.0.0.2 old.test"));
        assert!(out.contains("10.0.0.3 new.test"));
        assert_eq!(out.matches("# BEGIN TUN-BYPASS-MANAGED").count(), 1);
        assert_eq!(pinned_of(&out).len(), 2);
    }

    #[test]
    fn apply_pins_is_idempotent_and_creates_missing_block() {
        let src = "# localhost\r\n127.0.0.1 localhost\r\n";
        let pin = [Pin { host: "a.test".into(), address: "10.0.0.2".into() }];
        let (once, changed) = apply_pins(src, &pin).unwrap();
        assert_eq!(changed, 1);
        assert!(once.contains(HOSTS_BEGIN));
        assert!(once.ends_with("\r\n"));
        // 再写一次：一条都不该变，文本也不该动
        let (twice, changed2) = apply_pins(&once, &pin).unwrap();
        assert_eq!(changed2, 0);
        assert_eq!(twice, once);
        assert_eq!(pinned_of(&twice), vec![("a.test".into(), "10.0.0.2".into())]);
    }

    #[test]
    fn apply_pins_refuses_junk_and_broken_markers() {
        let broken = "# BEGIN TUN-BYPASS-MANAGED\n10.0.0.2 a.test\n";
        assert!(apply_pins(broken, &[Pin { host: "b.test".into(), address: "10.0.0.3".into() }]).is_err());
        let ok = "# BEGIN TUN-BYPASS-MANAGED\n# END TUN-BYPASS-MANAGED\n";
        // fake-IP 段与回环都不能当固定值：钉进接管地址等于把直连又送回代理
        assert!(apply_pins(ok, &[Pin { host: "b.test".into(), address: "198.18.0.7".into() }]).is_err());
        assert!(apply_pins(ok, &[Pin { host: "b.test".into(), address: "127.0.0.1".into() }]).is_err());
    }

    #[test]
    fn route_args_match_route_exe_grammar() {
        let add = route_add_args("172.33.0.0", 16, "26.0.48.1", 42);
        assert_eq!(
            add.join(" "),
            "-p add 172.33.0.0 mask 255.255.0.0 26.0.48.1 if 42"
        );
        assert_eq!(
            route_delete_args("172.33.0.0", 16, "26.0.48.1", 42).join(" "),
            "-p delete 172.33.0.0 mask 255.255.0.0 26.0.48.1 if 42"
        );
        // 默认路由单独一档：/0 的掩码是 0.0.0.0
        assert_eq!(prefix_len_to_mask(0), Ipv4Addr::UNSPECIFIED);
        assert_eq!(prefix_len_to_mask(32), Ipv4Addr::BROADCAST);
    }

    #[test]
    fn mask_round_trips_only_for_contiguous_masks() {
        for len in 0..=32u8 {
            assert_eq!(mask_to_prefix_len(prefix_len_to_mask(len)), Some(len));
        }
        assert_eq!(mask_to_prefix_len("255.0.255.0".parse().unwrap()), None);
    }

    #[test]
    fn prefix_ownership_is_mask_aligned() {
        let t = |s: &str| s.parse::<Ipv4Addr>().unwrap();
        assert!(net::covers_prefix(t("172.33.0.0"), 16, t("172.33.7.9")));
        assert!(!net::covers_prefix(t("172.33.0.0"), 16, t("172.34.0.1")));
        // 主机路由只盖住自己
        assert!(net::covers_prefix(t("10.18.6.44"), 32, t("10.18.6.44")));
        assert!(!net::covers_prefix(t("10.18.6.44"), 32, t("10.18.6.45")));
        // 网段地址没对齐掩码也算得出来，归属判断不能依赖上游先归一化
        assert!(net::covers_prefix(t("172.33.0.1"), 16, t("172.33.9.9")));
    }
}
