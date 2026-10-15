use crate::net::covers_prefix;
use crate::{in_fake_ip, usable_v4};
use std::net::{IpAddr, Ipv4Addr};

pub(crate) type ForwardRow = (Ipv4Addr, u8, Ipv4Addr, u32, u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Candidate {
    pub interface_index: u32,
    pub gateway: Ipv4Addr,
    pub matched_prefix: Option<u8>,
    pub metric: u32,
}

/// 保留目标的匹配路由，以及供用户选择的已知网关；不从相邻主机推断网段归属。
pub(crate) fn candidates(
    rows: &[ForwardRow],
    prefix: Ipv4Addr,
    prefix_len: u8,
    exclude: Option<u32>,
) -> Vec<Candidate> {
    if prefix_len > 32 {
        return Vec::new();
    }
    let mut out: Vec<Candidate> = Vec::new();
    for &(net, len, hop, index, metric) in rows {
        if index == 0
            || Some(index) == exclude
            || len > 32
            || in_fake_ip(net)
            || (hop != Ipv4Addr::UNSPECIFIED && !usable_v4(IpAddr::V4(hop)))
        {
            continue;
        }
        let matched = (len <= prefix_len && covers_prefix(net, len, prefix)).then_some(len);
        // 0.0.0.0 只表示目标本身在链路上，不能当作任意目的地的网关。
        if hop == Ipv4Addr::UNSPECIFIED && (matched.is_none() || len == 0) {
            continue;
        }
        let next = Candidate {
            interface_index: index,
            gateway: hop,
            matched_prefix: matched,
            metric,
        };
        if let Some(old) = out
            .iter_mut()
            .find(|r| r.interface_index == index && r.gateway == hop)
        {
            if next.matched_prefix > old.matched_prefix
                || (next.matched_prefix == old.matched_prefix && metric < old.metric)
            {
                *old = next;
            }
        } else {
            out.push(next);
        }
    }
    out.sort_by_key(|r| {
        (
            std::cmp::Reverse(r.matched_prefix),
            r.metric,
            r.interface_index,
            r.gateway,
        )
    });
    out
}

pub(crate) fn automatic(candidates: &[Candidate], prefix: Ipv4Addr) -> Option<&Candidate> {
    let [a, b, ..] = prefix.octets();
    let needs_explicit_route = !usable_v4(IpAddr::V4(prefix))
        || prefix.is_private()
        || prefix.is_documentation()
        || (a == 100 && (64..=127).contains(&b));
    candidates.iter().find(|r| match r.matched_prefix {
        Some(0) => !needs_explicit_route, // 内网及共享地址缺少明确路由时，由用户选择 LAN / VPN。
        Some(_) => true,
        None => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ip(s: &str) -> Ipv4Addr {
        s.parse().unwrap()
    }
    fn row(net: &str, len: u8, hop: &str, index: u32, metric: u32) -> ForwardRow {
        (ip(net), len, ip(hop), index, metric)
    }

    #[test]
    fn public_target_uses_real_default_gateway_instead_of_proxy() {
        let rows = [
            row("0.0.0.0", 0, "198.18.0.2", 7, 0),
            row("0.0.0.0", 0, "172.33.122.254", 8, 25),
        ];
        let options = candidates(&rows, ip("125.39.27.223"), 32, Some(7));
        let plan = automatic(&options, ip("125.39.27.223")).unwrap();
        assert_eq!(
            (plan.interface_index, plan.gateway),
            (8, ip("172.33.122.254"))
        );
    }

    #[test]
    fn explicit_vpn_gateway_wins_over_default_even_with_higher_metric() {
        let rows = [
            row("0.0.0.0", 0, "172.33.122.254", 8, 25),
            row("10.0.0.0", 24, "26.0.48.1", 16, 281),
        ];
        let options = candidates(&rows, ip("10.0.0.243"), 32, None);
        assert_eq!(
            automatic(&options, ip("10.0.0.243")).unwrap().gateway,
            ip("26.0.48.1")
        );
    }

    #[test]
    fn local_target_stays_on_link_even_when_its_adapter_has_a_default_gateway() {
        let rows = [
            row("0.0.0.0", 0, "192.168.1.1", 8, 25),
            row("192.168.1.0", 24, "0.0.0.0", 8, 281),
        ];
        let options = candidates(&rows, ip("192.168.1.42"), 32, None);
        assert_eq!(
            automatic(&options, ip("192.168.1.42")).unwrap().gateway,
            Ipv4Addr::UNSPECIFIED
        );
    }

    #[test]
    fn private_target_without_explicit_route_requires_choice_and_retains_known_vpn_gateways() {
        let rows = [
            row("0.0.0.0", 0, "172.33.122.254", 8, 25),
            row("10.0.0.240", 32, "26.0.48.1", 16, 281),
        ];
        let options = candidates(&rows, ip("10.0.0.243"), 32, None);
        assert!(automatic(&options, ip("10.0.0.243")).is_none());
        assert_eq!(options.len(), 2);
        assert!(options
            .iter()
            .any(|r| r.gateway == ip("26.0.48.1") && r.matched_prefix.is_none()));
    }

    #[test]
    fn shared_and_non_public_targets_do_not_automatically_use_the_physical_default() {
        let rows = [row("0.0.0.0", 0, "172.33.122.254", 8, 25)];
        for raw in [
            "100.64.0.1",
            "100.100.100.100",
            "100.127.255.254",
            "127.0.0.1",
            "169.254.1.1",
            "198.18.0.5",
            "203.0.113.1",
        ] {
            let options = candidates(&rows, ip(raw), 32, None);
            assert!(automatic(&options, ip(raw)).is_none(), "{raw}");
        }
        let options = candidates(&rows, ip("100.128.0.1"), 32, None);
        assert!(automatic(&options, ip("100.128.0.1")).is_some());
    }

    #[test]
    fn whole_network_requires_a_route_covering_the_whole_prefix() {
        let rows = [row("10.0.0.0", 25, "26.0.48.1", 16, 25)];
        let options = candidates(&rows, ip("10.0.0.0"), 24, None);
        assert!(automatic(&options, ip("10.0.0.0")).is_none());
    }

    #[test]
    fn equal_prefix_uses_lowest_combined_metric_and_deduplicates_gateways() {
        let rows = [
            row("0.0.0.0", 0, "192.168.1.1", 8, 50),
            row("0.0.0.0", 0, "192.168.2.1", 9, 30),
            row("125.39.0.0", 16, "192.168.2.1", 9, 100),
        ];
        let options = candidates(&rows, ip("8.8.8.8"), 32, None);
        assert_eq!(options.len(), 2);
        assert_eq!(
            automatic(&options, ip("8.8.8.8")).unwrap().interface_index,
            9
        );
    }

    #[test]
    fn excluded_adapter_and_fake_ip_gateways_are_never_options() {
        let rows = [
            row("0.0.0.0", 0, "192.168.1.1", 7, 0),
            row("0.0.0.0", 0, "198.18.0.2", 9, 0),
            row("198.18.0.0", 15, "0.0.0.0", 10, 0),
        ];
        assert!(candidates(&rows, ip("198.18.0.5"), 32, Some(7)).is_empty());
    }
}
