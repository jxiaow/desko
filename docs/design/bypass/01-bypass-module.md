# 直连清单模块（bypass）— 现状与方案

日期：2026-10-09　状态：**已拍板**（Q1 每次落盘一次 UAC / Q2 侧栏独立模块页 / Q3 清单文件导入已于 2026-10-10 撤销，见下）

## 结论

能真集成，不是套壳。外部脚本里 90% 的逻辑在本仓库有等价物或可直接落成 Rust：DoH 取真址（`ureq` 已在依赖里）、路由表解析（`fileshare-core/src/net.rs:51` 已经解析 `route print`）、hosts 标记区读写、落库记账。

搬不动的只有一件：**写 hosts 和加路由要管理员**，而 desko 主进程是普通权限。所以形态必须是"探测判断全自动、落盘那一下提权"——把要改系统的动作攒成一批，一次 UAC 落完，其余全程静默。不建议为省这一次弹窗去装常驻提权服务，理由见 Q1。

## 要集成的到底是什么

基准是 `ai-snippets/vpn/update-tun-bypass.ps1`（663 行）＋两份清单。它做的事拆成四步，desko 逐条对应：

### 1 探测（免提权，主进程内）

输入归一化 → 本机解析 → DoH 交叉核对 → 逐候选探活 → 出口判定。

| 动作 | 脚本做法 | desko 落法 |
|---|---|---|
| 归一化 | `ConvertTo-DomainTarget:119`：裸域名→443；URL→取 scheme 的端口，拒 userinfo | 同规则，额外接受 `1.2.3.4` 与 `172.30.2.0/24`（纯 IP/CIDR 只需路由，不进 hosts） |
| 本机解析 | 依赖系统解析器 | `GetAddrInfoW`（`windows` 0.61.3 已导出，`WinSock/mod.rs:69`），答案落 `198.18.0.0/15` 即判"被接管"（实测未钉的 `www.baidu.com` 返 `198.18.0.136`）。**但探测第一步必须先读 hosts 管理区**：已钉条目的系统解析返回的就是我们自己写的值（实测 `xtbg.xylink.com` 直接返 `172.30.2.109`），不先区分就会把"已接管"误判成"直连可用、无需处理" |
| 真实地址 | DoH `dns.alidns.com/resolve`，走 `curl --ipv4`（`Resolve-RealIPv4:175`，注释说明 `Invoke-RestMethod` 会卡在 AAAA 上） | `ureq` 强制 IPv4 + 15s 超时。**实测 DoH 端点自己也被劫成 `198.18.0.81`，但请求经代理通道照样返真答案**（`xtbg` → `172.30.2.109`），所以走 std resolver 即可、不必为它单开解析路径。成功判据仍是"答案不落 `198.18.0.0/15`"；另备第二个公共 DoH 端点回退，端点属公共服务而非环境常量 |
| 逐候选探活 | `Test-Endpoint:197`：`curl --resolve domain:port:ip` 取第一个通的 | 锁定版 `ureq 2.12.1` 自带 `Resolver` trait（`src/resolve.rs`，对闭包有 blanket impl），`AgentBuilder::resolver` 直接就是 `--resolve` 语义，**不必自己撸 rustls**。实测等价探活 `http=200 ip=172.30.2.109 time=0.23s`。这一步顺带解释"域名对但端口不通"（`qa525ob` 案例），错文要写"请改用 URL 形式给出实际端口"，而不是报解析失败 |
| 出口判定 | `Get-Egress`←`Find-NetRoute` | `GetBestRoute2`（`windows` crate 补 `Win32_NetworkManagement_IpHelper` feature，现版本 0.61 只开了 5 个 feature，见 `Cargo.toml` 末尾）；读操作不提权 |

**接管方不点名，靠探**。代码里不存在任何代理产品名：判据只有一条——本机哪块网卡的地址落在 `198.18.0.0/15`（RFC 2544 基准段，各家 TUN 代理做 Fake-IP 的通用选择），那块卡就是当前接管 DNS 与流量的对方；界面要显示的是它的实际别名（`Get-FakeIpAlias:317` 同款探测），换客户端不用改一行代码。文案一律说"代理/接管方"。

### 2 判断：四态结论，不是"加就完了"

探测的结果必须落成一个明确态，这是"自动判断"的全部价值：

- **直连可用** → 什么都不做，界面写"当前无需接管"（幂等，避免把公网站误固定进 hosts）。
- **仅缺 DNS 固定** → 已有覆盖路由且出口不是 fake-IP 接口，只写 hosts。xtbg 就是这一态（`172.30.2.109/32` 早就在，隧道是活的）。
- **缺路由** → 要 `route -p add`，同时算出该绑哪个网关。
- **不可达** → 真址全候选探活失败 → **拒绝添加**，给一句根因（服务没起／端口不对／防火墙），别把死地址写进系统。
- **路由型条目（裸 IP / 网段）不看探活**：内网机器多半不在 443 上监听，连不上不等于不可达。这一段流量从哪块网卡出才是它唯一要回答的问题，所以判据只看出口——出口落在接管方＝缺少路由，否则＝直连可用，出口查不到＝出口未确定。旧清单里 `172.33.0.0/16`、`10.0.0.65` 这类行全靠这条才不会被整批误判成死地址。

### 3 处理（提权，攒批一次落）

- hosts 管理区读写：沿用脚本现有的 `BEGIN/END TUN-BYPASS-MANAGED` 标记块（`Read-HostsState:211`）并接管它——Q3 定了脚本退役，复用同名块才能把旧条目原地收编，hosts 里也不会出现两个块。标记嵌套或不配对直接报错，不猜。
- 写入 = 临时文件 + 原子替换 + 时间戳备份（`ps1:492-501`），成功后刷 DNS 缓存。**`windows` 0.61.3 并未导出 `DnsFlushResolverCache`**（实测 crate 源码里搜不到该符号），改用 helper 内 `ipconfig /flushdns`，或自行 `#[link(name = "dnsapi")] extern "system"` 声明。
- 路由绑定：**网关必须落在候选接口自己的网段内**。这是脚本里最贵的一条教训（`Resolve-GatewayInterface:358` 注释）：绑到不含该网关的接口时，Windows 判路由不可用、静默回落默认路由，流量重新被接管方拿走——症状是"路由在，却不通"。这条校验必须原样保留。
- 网关来源优先级：目标网段所属隧道接口的网关 > 自动选上行（排除 fake-IP 接口，按 `InterfaceMetric`）。旧清单里 `via <网关>` 那一档随导入功能一起移除，界面不再给指定网关的入口。
- 复验不过 → 回滚本条（hosts 还原、删掉刚加的路由），状态置"失败 + 根因"。
- 一条边界要写进界面文案：**desko 不改接管方自己的直连/绕过名单**。脚本 `ps1:654` 就是这么提醒的——hosts 只让本机 DNS 不返 fake-IP，流量最终走哪仍由 TUN 侧规则决定，两边名单得一致。所以结论卡要把"仍需加入代理客户端的直连名单"作为未竟事项明列（连域名一起可复制），而不是让用户以为落完盘就通了。

### 4 持续自动（"下一次我给个域名"之外的第二半）

清单住进 desko 之后才有这件事可做：

- 进模块页或点「全量重验」时逐条重探，但 **stale 判据不能是"与 DoH 答案不等"**。实测 `registry.npmmirror.com` 钉的是 `125.39.27.223`，DoH 现答已变成 `122.190.12.50`，且答案里带 CNAME 到 `*.cdngslb.com`——CDN 域名本来就多答案轮换。所以：钉的 IP 不在当前答案集里 **且** 指定该 IP 探活失败，才算 stale；探活还通就不动它。
- 更要紧的是**分类**：DoH 答案含 CDN CNAME 或多答案轮换的域名，探测阶段就该给结论"不适合钉"——钉死等于把访问锁在一个随时失效的节点上，还不如让它走正常 DNS。只有用户显式坚持才落盘。
- 隧道重连后接口号会变：`GetBestRoute2` 检到出口漂移即标"路由需重绑"，不用人肉发现。
- 连续多日失败的条目降级成"待确认"，不无限静默重试。

## 数据与代码落点

- 表 `bypass_targets`（域或前缀、粘贴原文 `input`、端口、路径/scheme、真实地址、网关、接口名/索引、状态、stale、备注、最后验证时间）；schema 走 `src-tauri/src/db/schema.rs` 现有迁移路径。原文单独存列，重验才探得回原目标：host 列不含端口/路径/掩码，只按 host 重探会把 `http://host:9090/a` 探成 `https://host:443`。网段的掩码留在 host 里（`172.33.0.0/16`），否则 `/16` 与 `/24` 会在 host 唯一键上撞成一条。
- 命令 `src-tauri/src/commands/bypass.rs`，服务 `src-tauri/src/services/bypass_service.rs`，注册进各自 `mod.rs`——与 `fileshare.rs`/`fileshare_service.rs` 同名同形。
- 提权落盘：第二个 sidecar `binaries/desko-netguard`，manifest `requireAdministrator`，主进程用 `ShellExecuteW("runas")` 拉起，任务书/回执走 JSON 文件——即脚本 `ArgsFile`/`LogPath` 那套协议（`ps1:20-27`）的编译版。`externalBin` 已在 `tauri.conf.json:39` 有用法可抄。
- 总开关按 `fileshareFeature.ts` 的模式：SQLite meta 存 flag，默认关。

## 界面形状

独立模块页（侧栏项，随总开关出现），复用统一骨架：`.page-bar` 54px + 行轨 52px，单列细线分行卡，不做卡中卡、不做入场动画。

- 页栏一个输入位 + 一颗「开始探测」：探测只出结论、不写库，「加入清单」是结论弹窗里的下一步（不可达那条按不动）。结论走一只弹窗（全站弹窗壳，520px：头栏标题＋关闭、底栏 46px／28px 钮、Esc 关），页面上不留常驻结论位；行上的「重新探测」开同一只弹窗，那一行保持原样不收。**默认不自动落盘**：页栏另一颗「写入落盘批次 N」才提权，一批共用一次 UAC（见 Q1、02）。`N` 是真会进批次的那部分，与「待写入 K 条」不是同一个数——CDN 轮换的条目默认不钉（§4）。
- 页栏下面一行小账：hosts 托管区 N 条 · 清单 M 条 · 待写入 K 条 · 固定地址失效 J 条；托管区读不出来时改口并带原因。同一行右端挂一个筛选项，按 host/原文子串过滤，不另开筛选面。
- 一行 = 一条被管条目：目标（等宽小字 Consolas 档）、判定 chip、实际地址/出口接口/指定出口网关/stale 细字，另给 `已写入` / `写入失败` / `CDN 轮换` 三枚小账；行首快捷位给「重新探测」，`⋯` 装「撤销上次写入」（只在有回滚点时在位）、「复制待写入清单」与删除，两处不重复动作。
- 展开档念的是库里那句结论，不跑网络；里面给一个带「原始输入」标签的可编辑输入框 +「保存并重新探测」，写错的域名就地改，按新原文覆盖回这一行（id 与建档时间不动）。
- 空态要说清这页管什么：让指定域名绕过代理直连。

## 实测核验（2026-10-09，本机实跑）

方案里每个技术假设都验过一遍，结论：**可行**，但实测推翻了三处原设计（已就地改进上文）。

| 假设 | 实测 |
|---|---|
| 接管方可探且不点名 | 本机唯一 fake-IP 网卡 = `198.18.0.1 / 0dcloud`；未钉域名 `www.baidu.com` 系统解析返 `198.18.0.136` → 判据成立 |
| DoH 能拿到真址 | `dns.alidns.com` 自己也被劫成 `198.18.0.81`，但经代理通道请求照样返 `xtbg → 172.30.2.109`（`Status:0`）→ 无需为 DoH 单开解析路径 |
| 指定真址探活可等价实现 | `curl --resolve xtbg.xylink.com:443:172.30.2.109` 得 `http=200 ip=172.30.2.109 time=0.23s`；`ureq 2.12.1` 的 `Resolver` trait（`src/resolve.rs`）＋`AgentBuilder::resolver` 就是同一语义，不必引 rustls |
| 出口/接口判定 API 齐备 | `windows 0.61.3`：`GetBestRoute2`（IpHelper:328）、`GetIfTable2`、`GetIpForwardTable2`、`CreateIpForwardEntry2`/`SetIpForwardEntry2`、`GetAddrInfoW`（WinSock:69）、`ShellExecuteW`（UI/Shell:4368）全在；需补的 feature：`Win32_NetworkManagement_IpHelper`、`_Ndis`、`_Dns`、`Win32_UI_Shell`、`Win32_Networking_WinSock` |
| 提权 helper 的分发形状 | `externalBin: binaries/desko-fileshare` 已在跑，`src-tauri/binaries/desko-fileshare-x86_64-pc-windows-msvc.exe` 是现成样板；`requireAdministrator` manifest 走 `tauri-build` 的 `WindowsAttributes` |
| 旧清单可导入 | hosts 管理区实存 5 条（`nones`/`gitlab.xylink`/`xycds`/`registry.npmmirror`/`xtbg`），标记块完整 → 接管与导入有真数据可测 |

**实测推翻的三处**：① `DnsFlushResolverCache` 在 windows 0.61.3 里不存在；② 本机解析会读到自己钉的 hosts 值，探测顺序必须先读管理区，否则把"已接管"误判成"直连可用"；③ CDN 域名（`registry.npmmirror` 实证已换节点）不能用"答案不等就 stale"，且这类域名默认不该钉。

**还没验、要在 P2 前补的两条**：`route -p` 加的持久路由重启后是否真在、隧道重连后接口号漂移的实际表现（都得靠重启/断连制造条件）；以及 helper 以 `requireAdministrator` 落进 NSIS 安装包后能否正常弹一次 UAC 并回传结果文件。

## 分期

- **P1**：探测＋四态判定（全程免提权，只读）＋ `bypass_targets` 表＋模块页。到这里已经能回答"给个域名，告诉我该怎么修"。
- **P2**：`desko-netguard` 提权 helper（hosts 标记区 + 持久路由 + flush + 回滚），攒批落盘与复验。
- **P3**：stale 检测、出口漂移、全量重验。（旧清单文件导入做过一版，2026-10-10 撤了，见 Q3。）

## 已定

- **Q1 提权形态：每次落盘弹一次 UAC**。探测、判定、复验全静默，只有真正改系统时提权一次，且多条目攒成一批共用这一次弹窗——"待写入 N 条"（界面用词）就是这个批次。不装常驻提权服务：那等于给本机任意进程留一条静默改 hosts 的通道，正是 hosts 劫持类恶意软件的机制，与 desko"本地个人工作台"的定位相冲。desko 主进程也不整体提权。
- **Q2 入口：侧栏独立模块页**，总开关默认关（沿用 `fileshare_enabled` 的先例：关了只停侧栏入口，模块代码保留在设置里）。选独立页而非设置页签，是因为清单有三态要常驻可见。
- **Q3 清单文件导入：已撤销（2026-10-10）**。原方案是给"从清单文件导入"入口，选 `ai-snippets/vpn/tun-bypass-domains.txt` 与 `tun-bypass-routes.txt`，逐条走同一套探测判定后落库。做过一版（`bypass_read_import` / `bypass_import_line` + 页栏导入按钮 + 逐行进度与停止），同日整条移除：一次性动作不值得常驻一个页栏入口，条目逐条粘进探测框即可。连带删掉只为它存在的 `via_gateway` 列（旧清单手写的下一跳网关没有别的写入口）。外部脚本与那两份 txt 因此继续留在原处，desko 不接管它们的维护。
