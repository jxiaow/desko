# 内网穿透模块 — 现状与方案

日期：2026-10-09（10-09 复审后改写；同日二次修订：**范围从"只把局域网传输挂出去"扩为通用服务穿透**，局域网传输降为列表里的一条预置服务，且它在公网侧要自己的新界面而不是套用局域网页）　状态：**已拍板**（Q1 named 域名直上 / Q2 仅随 desko 起停 / Q3 二进制自动拉取）；域名前置条件已实测满足（见 Q1 步骤 1）

## 结论

不难，但不是"加个开关"的量级。启动一个 cloudflared 子进程在本仓库有成熟先例可抄，真正的工作量在三处：**named 隧道的授权与幂等续做、把本机任意服务推到公网所需的按服务鉴权加固、以及它与锁屏/备份两个既有模块的耦合**。后两者是产品定位的实质外扩（desko 是本地个人工作台），所以放行的边界是"只许指向 `127.0.0.1` 上本机显式登记过的服务，一条一份公网设置"，不做通用代理开关，且**公网面必须比局域网面更严，不能原样端出去**。

难度分级：

| 分面 | 难度 | 依据 |
|---|---|---|
| 子进程生命周期 | 低 | sidecar 模式现成 |
| cloudflared 自动获取与升级 | 低 | `ureq` 已是直接依赖（`src-tauri/Cargo.toml:36`） |
| named tunnel 授权与建隧道 | **高** | OAuth 跳出 GUI、凭据落盘核验、create/route 的幂等续做 |
| 鉴权加固 | **高** | 现有口令机制自认"只挡君子"，公网直连即暴露爆破面；且现在要按服务逐条判，不是一刀切 |
| 服务表与 ingress 生成 | 中 | 一条隧道挂 N 条 `hostname → 127.0.0.1:port`，配置文本由 desko 生成，写坏即整条隧道起不来 |
| 锁屏 / 备份的耦合 | 中 | 两处都是既有语义，改错即回归。锁屏一侧已定：不动隧道（见 Q2）；备份一侧要防的是凭据件混进打包范围 |
| 运行态与地址回填 | 中 | 判活只能信子进程状态——本机 DNS 返 fake-IP，自检不可用 |
| 多 connector 的劈流识别 | 中 | 官方支持同隧道多副本，冲突不报错、只表现为间歇性失败 |

## 可复用的现状

- **sidecar 监督模式**：`src-tauri/src/commands/fileshare.rs:140` 的 `spawn_service()` 已定形——子进程带 `--config/--status/--parent` 三参数，父进程掉线即自杀，配置与状态走 app data 下两个 JSON 文件（热加载 400ms）。穿透子进程是第二条同构边车，这套可整体平移。
- **模块注册三件套**：路由（`src/router/index.ts`）+ 侧栏项（`src/components/layout/Sidebar.vue`）+ 特性开关（`src/services/fileshareFeature.ts` 的模式：SQLite meta 存 flag，设置弹窗加页签）。
- **进程分发（仅参考，不采用）**：`tauri.conf.json:39` `externalBin: ["binaries/desko-fileshare"]` + `scripts/sync-fileshare-server.mjs` + NSIS `beforeBuildCommand`。cloudflared 改走自动拉取，但落盘目录与校验可沿用这套脚本的形状。
- **存根先例**：`scripts/mock-build.mjs` 已有"用假实现喂真 token 跑验收"的做法，假 cloudflared 照此办理。

## Q1 隧道形态：**named（自有域名 + 凭据），v1 直上**

不做 quick 的降级双路径，链路只有一条：稳定子域、凭据落盘。随之而来的是一条**跨 GUI 的授权状态机**，这是本模块真正的复杂度所在，分五步：

1. **前置校验**——需要 Cloudflare 账号 + 该账号下已接入 Cloudflare DNS 的域名。**`xiaolink.xyz` 实测已满足**：NS 为 `bayan/lilith.ns.cloudflare.com`，SOA primary 为 `dns.cloudflare.com`（serial 2415523214），且 `tunnel./opencode./qwen.xiaolink.xyz` 经 Cloudflare DoH 均解析到边缘 Anycast `104.21.36.206 / 172.67.199.151`（已 proxied）；apex 本身无 A 记录。校验逻辑仍要保留，但它检查的是"该账号下有无可用 zone"，不是"这台机器能否解析"。
2. **授权**——`cloudflared tunnel login` 会自己拉起浏览器。desko 是带锁屏的窗口应用，这一步必须：显式提示"将在浏览器完成授权"、轮询凭据文件是否出现、给超时和取消，且**授权回来后再判定**，不能靠命令退出码当真凭据有效。
3. **凭据目录**——`cert.pem`（账号级）与隧道凭据 JSON 收进 desko 自己的目录，不写 `~/.cloudflared`，否则与外部工具/其他链路互踩且无法随模块清理。
   **实测结论（cloudflared 2026.10.0，本机 2026-10-09）**：`--home-path` **不存在**（`flag provided but not defined: -home-path`），原方案的这个假设作废。真实手段是三个各管一段的入口：
   - `--origincert <path>` / 环境变量 `TUNNEL_ORIGIN_CERT` / config.yml 的 `origincert` 键：指定 cert.pem 读取路径。不指定时它按 `[~/.cloudflared ~/.cloudflare-warp ~/cloudflare-warp]` 顺序找，找不到就报"Cannot determine default origin certificate path"（错文自带搜索路径，可直接当诊断输出用）。
   - `--credentials-file <path>` / `TUNNEL_CRED_FILE`：`tunnel create` 往这里写隧道凭据，`tunnel run` 从这里读。**这个能完全落在 desko 目录，没有异议。**
   - **`tunnel login` 没有指定 cert 输出路径的 flag**（只有 `--loginURL/--callbackURL/--fedramp`）。所以落点要么靠 `TUNNEL_ORIGIN_CERT` 环境变量（写入是否遵循该变量**待 P2 实测**，验证需要真实账号授权一次），要么兜底方案：login 后同时检查我们的目录与 `~/.cloudflared/cert.pem`，若落在后者就搬进前者，此后一律显式传 `--origincert`。**两种写法都要在 P2 一开始就跑通再往下搭状态机。**
   **选址硬约束**：该目录必须落在备份打包范围与附件目录之外——备份包会收 DB、attachments、dek/wrap（`src-tauri/src/commands/backup.rs:146-194`），一旦 `cert.pem` 或 tunnel secret 被扫进去，就会随备份上云，而云端密文永不删（既有取舍），等于不可撤回的泄露。落地前要用备份导出实测一次"凭据文件不在包内"。
4. **建隧道 + 挂服务**——`tunnel create` 拿隧道 ID；一条隧道下面挂 N 条 `hostname → 127.0.0.1:port` 的 ingress（写进 desko 自己那份 config.yml，`tunnel run --config` 读它），每条 hostname 各调一次 `tunnel route dns`。幂等要求最高的地方：任一步中断后重进要能识别"做到哪了"并续上，而不是重复创建垃圾隧道或重复登记记录。
   - **子域可配置，不写死**。`tunnel route dns` 要求 hostname 属于 `cert.pem` 对应的 zone，跨 zone 会失败——登记前要先校验归属，失败给"该域名不在此账号下"的明确错文，而不是把 cloudflared 的原文糊给用户。多服务时这条判断逐条做，一条失败不牵连其余。
   - 远端资源（已建隧道、已写 DNS 记录）在本地删除模块时**不回收**——与备份侧同类取舍一致，代价是云端只增，需在界面注明。
5. **运行与自检**——`tunnel run` 起来后确认注册成功，再把公网地址回填 UI。**自检不得走本机 DNS**：本机系统解析器对公网域名返回 fake-IP（实测 `tunnel.xiaolink.xyz` 本地解析为 `198.18.0.44`，而 DoH 的真实答案是 `104.21/172.67`），任何从本机发出的域名请求都会稳定误判成"隧道挂了"。判活只信两样——cloudflared 子进程自己的状态输出，以及必要时走 DoH 拿真实记录。**不留周期性重启**：同类实现里见过"健康检查成功码判定永不成立 → 每约 10 分钟无谓重启一次"的病灶，本模块的判据必须先跑通再接看门狗。

### 实测出的现成机制：能省的自研一律省掉（2026.10.0）

`--help` 逐条核过，四件事 CLI 自己就给了，不要自己造：

| 用途 | cloudflared 给的 | 用法 |
|---|---|---|
| **真连上了没** | `--pidfile` | 它是**首次成功连上边缘之后**才写 PID，不是启动就写——正好当"注册成功"的信号，比 scrape 日志可靠 |
| **判活** | `tunnel ready` | 打本地 `/ready` 端点并按结果给退出码；配 `--metrics` 指定监听地址 |
| **他处是否也在跑这条隧道** | `tunnel info <TUNNEL> -o json` | 直接列**active connectors**，带 `--show-recently-disconnected`、可按 `startedAt/numConnections/version` 排。劈流检测就用它，不用猜 |
| **机器可读的日志** | `--output json`、`--logfile`、`--log-directory` | 状态机读结构化输出，不解析人读文本 |

**必带启动参数（漏一个就有事故）**：

- `--no-autoupdate`（或 `NO_AUTOUPDATE=true`）。默认它会每 24h 自查更新并**用新版本替换自身、重启进程**——这与"按版本常量拉取 + sha256 白名单"直接冲突：自替换后哈希校验与版本回落全部失效，且替换发生在 desko 毫不知情时。穿透子进程必须由 desko 独占生命周期，不允许它自我升级。
- `--origincert` / `--credentials-file` 显式传绝对路径（见 Q1 步骤 3），不依赖默认搜索顺序。
- `--metrics` 显式给一个端口。默认 `localhost:0` 会随机选，而 `tunnel ready` 需要知道打哪儿；端口写进状态文件供后续判活。
- `--label`：给 connector 一个固定可识别的名字（默认是主机名+uuid）。这是劈流排查时"哪个是我"的唯一抓手。

### 多 connector：不是"互斥"，是"静默劈流"

官方明确支持同一条隧道跑多个 connector 副本："All replicas point to the same tunnel, so if a single host running cloudflared goes down, the remaining replicas continue to serve traffic"，分发是"forwarded to the geographically closest replica"。

所以**"同一隧道两处不能同时连"是错的**，冲突不会报错。真正的风险是：本机 desko 与另一条链路（`ai-snippets/services` 适配 Windows 后会跑同一条隧道）各自的 ingress 不同，同一 hostname 的请求按地理就近落到其中一个 connector，另一台 ingress 不匹配就 404/530——症状是**间歇性失败**，比"启动被拒"难查一个量级，而且 DNS 侧看不出来。

结论反转为一条硬约束：**desko 必须建自己的 tunnel ID 和自己的子域，不复用任何现存隧道**。冲突探测的判据是 `tunnel info <TUNNEL> -o json` 列出的 active connectors（读的是边缘侧真话，不是本机 DNS，也不是本机进程表），不是"域名能不能解析"。凭据层面靠独立目录隔离，不共享 `~/.cloudflared`。

## P2 命令面实测（2026.10.0，本机 2026-10-09）

产物已核：`sha256 = 86aee4017b26…`、55,365,048 B、`cloudflared version 2026.10.0 (built 2026-10-05T08:39 UTC)`。以下逐条来自真二进制的 `--help` 与真实调用（无 cert 时全部止步于本地凭据检查，未触远端）。

**参数位置有两条轴，放错就是"flag provided but not defined"**：

| 归属 | 成员 | 位置 |
|---|---|---|
| 全局 | `--output json` | `cloudflared` 之后、`tunnel` 之前 |
| tunnel 命令级 | `--config` `--origincert` `--no-autoupdate` `--no-prechecks` `--metrics` `--pidfile` `--logfile` `--loglevel` `--label` | `tunnel` 之后、子命令之前 |
| 子命令级 | `create` 的 `-o/--credentials-file/-s`、`list` 的 `-o/--name/--name-prefix`、`info` 的 `-o/--show-recently-disconnected/--sort-by`、`run` 的 `--credentials-file/--token`、`route dns` 的 `--overwrite-dns/-f` | 子命令之后 |

`--label` 属 tunnel 级而非 `run` 级（`tunnel run --help` 里查不到它），P1 的拼装位置经真二进制验证可解析。

**退出码不可信**：`tunnel list`（无 cert）退 1，但 `tunnel --bogus-flag list` 只打 `Incorrect Usage. flag provided but not defined: -bogus-flag` 却**退 0**。所以 CLI 执行器只能以"stdout 里有没有可解析的结果"判成败，不能拿退出码当成功判据——否则参数拼错会被当成一次空列表的成功。

**能省掉三处自研**：

- `tunnel list -o json --name <NAME>`：按名精确过滤，"这条隧道建过没有"一问就知道，幂等的前置探测不用拉全量再自己筛。
- `tunnel token <TUNNEL> --cred-file <path>`：**凭据找回**。隧道在边缘已建、本机 `<uuid>.json` 却丢了（换档案目录、误删、P2 中途断），拿它重新落一份即可，绝不该走到"再建一条"。这是"不产生重复隧道"的正解。
- `tunnel route dns --overwrite-dns/-f`：记录已存在时覆盖而非报错，路由这一步因此天然可重入，不需要为它记"上次做到哪了"。

**`TUNNEL_ORIGIN_CERT` 经实测确实被读**：设了它，错误文本里的 cert 路径就变成指定值（`--origincert` 同效）。写侧（`login` 完成后落哪儿）仍无法在无账号条件下验，见待实测清单 2。

**没有 dry-run**：`route dns` 只有 `--overwrite-dns` 一个选项，zone 归属无法本机预检，只能在远端报错时映射错文。

`--no-prechecks`（env `TUNNEL_NO_PRECHECKS`）会跳过启动前的连通性自检——代理环境下注册卡住时，它是第一个要试的开关，见待实测清单 3。

## Q2 常开范围：**仅 desko 运行期间**

子进程随 desko 起停，`--parent` 看门狗天然不留孤儿，不碰服务、不提权、不改 NSIS 安装阶段。

两条必须写进界面文案的后果：

- **desko 一关，公网地址立刻不可用**。named 的价值是"地址稳定、可分享"，可用性却取决于本机 desko 开着——不是缺陷，但配域名时就得看见这句话，否则第一场外网访问失败会变成疑难排查。
- **锁屏不停隧道**（2026-10-09 拍板，推翻先前"锁屏必须停 ingress"的写法）。起停只由两件事决定：用户点没点、desko 退没退。锁屏是界面锁，不是"这台机器不打开了"的信号——局域网传输的 sidecar 锁屏后照跑是既有语义，隧道跟着同一套，不搞两套心智。先前担心的"'我把 desko 锁了'与'共享目录还在公网上'同时成立"由公网面自己的门槛承担：那条面必须带口令、默认只读、失败要锁定，挂出去的代价在登记与 apply 那一刻就明说过了。要停就在页面上停，或者退程序。

## Q3 暴露面：允许把什么挂出去

穿透一开，本机端口就能被公网摸到，这是模块自身最大的攻击面。范围扩到通用服务后，边界不再是"白名单某一个端口"，而是**一条服务一份设置**。硬约束六条：

1. 目标只许 `127.0.0.1`/`localhost`，写进 ingress 生成处，不接受自由 URL 与远程 host——否则 desko 就成了别人家的开放代理。
2. 一条服务 = 一个子域 + 一个本机端口，且必须是用户在 desko 里显式登记过的。没登记的端口哪怕本机在听也不通，这是"通用"与"任意"的分界。
3. 端口取实际监听值，不取配置值。局域网传输这一条从 `fileshare.status.json` 读 `bound_port`——配置端口会被占用顶漂（`fileshare-core/src/config.rs:10`，向上摸 10 个），照配置连必错。别的服务没有状态文件，登记时读一次本机监听，并在列表行如实标"目标端口没在听"。
4. 谁能进、能做什么，分两种情况说，不假装通用：desko 自己的服务（局域网传输）ingress 指向的是 desko 起的 sidecar，口令/只读/失败锁定都真能强制；**第三方本机端口 desko 不在请求链路上（边缘直连 `127.0.0.1:port`），替它加不了任何鉴权**，只能如实标"鉴权由目标自己负责"并在登记时探一次"无凭据能不能读"。要强制只能引 Cloudflare Access（见 P4）。
5. **公网面的鉴权必须强于局域网面**，不能原样端出去（见下）。
6. v1 只挂 HTTP 服务：ingress 只生成 `service: http://127.0.0.1:<port>` 一种规则。裸 TCP（SSH/RDP/数据库之类）没有"口令"这一层可加，端出去就是无鉴权的直连管道，与第 4、5 条冲突，留进"不做"。

### 鉴权加固：只对 desko 自己的服务成立

现状是"单一共享口令 + 明文 sha256 存在 app data 的 JSON 里"，代码注释自己承认"只挡君子……能离线爆破弱口令"（`fileshare-core/src/config.rs:21-25`）；而 `POST /login`（`handlers.rs:143-156`）与 `auth.rs` 里搜不到任何失败计数、限速、锁定或 429。局域网内这是可接受的便利门槛，**公网直连就是一扇可被脚本爆破的门**。只写"口令强制非空"不足以支撑公网暴露。

v1 的做法（不引入 Cloudflare Access，见"不做"）：

**desko 自己的服务（局域网传输）**——ingress 指向 desko 起的 sidecar，所以下面四条都真能强制：

- 登录失败限速 + 指数退避锁定，两维同时计：**hostname × 来源 IP**（给正常用户误输留余地）与 **hostname × 全部来源**（兜住"换个来源 IP 接着试"——隧道那条链路上来源 IP 取自边缘注的 `CF-Connecting-IP`，本机网段里的人随手编一个就能伪造第一维）。计数落 `fileshare.auth.json`（与 `fileshare.json` 同目录，子进程重启与重新绑定都不清零，否则爆破者靠打断连接就能绕过）。
- 公网侧口令强制非空且拒绝弱口令；`fsid` cookie 补 `Secure`（`handlers.rs:450` 现在没有）。会话按归属分桶：局域网一桶、每条公网子域各一桶，一条子域登上的会话读不了另一条；改某条口令只作废那一条的会话。
- 动作面收窄：默认只读（下载/浏览），上传需要显式打开；`POST /settings` 在公网侧直接禁用——它能在服务进程侧改配置。
- 这套设置只作用于这条服务的 hostname，改它不影响其余条目；界面上一眼能看出哪条是"无口令"（列表行的徽标）。

下发通道（sidecar 不碰 SQLite，也不加新 IPC）：desko 把服务表里"算公网的"那几条投影成 `fileshare.json` 的 `public` 数组（`{hostname, passwordSha256, readOnly}`，camelCase），sidecar 现有的 400ms 签名轮询原样热加载。sidecar 认这个数组做三件事：Host 白名单逐条放行、按条取公网口令与只读位、锁定计数分桶。数组里出现无口令的条目即整条 403（fail-closed，desko 侧本不该下发）。

这一侧的真相住在服务表的 `public_password_sha256 / public_read_only` 两列（口令只在 desko 的写入路径上以明文出现，所以"拒弱口令"只能在 desko 侧做，sidecar 只保证非空）；`apply` 遇到还没设口令的自有服务直接拒绝登记子域，投影随服务表的每次增删改与隧道起停重算。

**第三方本机端口**——desko 不在请求链路上，上面一条都落不了地。v1 能做的只有两件事：登记时探一次"无凭据能不能读"并把结果如实标在行上（`目标自带鉴权` / `无鉴权，任何人都能读`），以及把"公网侧开放"这件事在删除/关开关时讲清楚。这不是弱化，是承认代价：**第三方条目要强制鉴权只能引 Cloudflare Access（P4 的可选路径）**，或者用户自己在那台服务上配口令。

前三条是本模块工作量的主要来源，也是"不做 Access"必须付的代价。

## 二进制获取：**自动拉取**

首次启用时按固定版本拉 cloudflared 到 app data，落盘后校验 sha256（白名单版本哈希），校验失败即整体回退、开关置灰并说明原因。不背第三方二进制进安装包，升级只改版本常量。

四条必须实现的行为，缺一就会变成"看起来能用的半成品"：

1. **缓存复用**：已校验通过的同一版本不重复下载（落盘按版本命名）。
2. **版本升级重校验**：版本常量变化即重新校验，旧版本目录保留但不再执行。
3. **区分"网络失败"与"内容不符"**：前者提示重试；后者是**可疑事件**（下载内容被中间层改写），必须显式报出来并拒绝执行，不静默重试。本机历史上出现过全出站 HTTPS 被中间层掐断、以及对特定站点的 TLS 吊销链失败，所以这条路是常态而非边角。
4. **代理环境的注册验证**：cloudflared 要出站到 Cloudflare 边缘完成 connector 注册（QUIC/7844，可回退 HTTP/2）。在本机这种"系统解析器返 fake-IP + 系统代理开启"的环境里，注册能否成功是未验证假设——P1 就要先手工跑通一次并记录用的协议参数，再写状态机；否则 UI 会把网络层失败报成"授权失败"。

## UI 形状

独立模块页（侧栏新项，默认关、藏进设置总开关），复用全局骨架：`.page-bar` 54px、行轨 44/56px、细线分行的单列卡（不做卡中卡）。对拍稿：`02-service-list-ui.html`（三帧 × 两主题，真 token 渲染，2026-10-09 拍板）。

模型是**一条隧道 + N 条服务**，所以页面主角是服务列表，不是隧道本身：

- **页栏**：整条隧道的状态点与起停（已停止 / 启动中 / 已连上边缘）、服务数、`⋯`（低频项）。公网地址逐条看，不在页栏堆。
- **接入准备**：缺东西时才摊开，按步骤流一行一步——做完的收成 44px 摘要行，当前那步 64px 展开并持有唯一一颗主行动钮，未开始的只写名字。三步齐了整卡压成一行摘要 + `调整`，不再占首屏。
- **公网服务**：一行一条（56px，两行信息）。上行是服务名 + 子域（等宽小字，Consolas 档），下行是 `127.0.0.1:port` + 这行的事实徽标。徽标分两种来源，不混用：desko 自己的服务报策略（需口令 / 只读 / 无口令·全开），第三方报探测结果（目标自带鉴权 / 无鉴权，任何人都能读 / 目标端口没在听）。右侧只给复制与 `⋯`，`⋯` 里放改设置、重新登记子域、删除，不与快捷图标重复。
- **每行不给起停开关**：边缘按整条隧道发流，单条 hostname 拔不掉。列表上只放事实，不放假开关。
- **页脚诊断条**：程序版本、SHA-256、PID、出口检查收在这里，默认一行，点「详情」展开。
- **单条服务的公网设置**另开弹窗（520px，底栏 46px + 28px 钮），按 指向 / 谁能进 / 能做什么 三段问。这是局域网传输在公网侧的全新界面，不套用它的局域网面板。

状态机的可视化仍在：未授权 / 等待浏览器授权（带超时与取消）/ 已授权未建隧道 / 就绪 / 运行中 / 冲突 / 失败，各自一句话说清下一步，不能只给转圈；冲突与失败只在真发生时占一行，不常驻。

「浏览器里授权完、desko 却一动不动」这一类由三条规矩兜住：

- **一轮轮询里每一格独立更新**：五个读命令各取各的结果，某一格读不到只把这一格留在上一帧，并在页面上留一句"状态没读到：…"，不许一个失败把整页冻住且不报错。
- **焦点即回读**：窗口重新拿到焦点就当场回读一次，定时器只作兜底——被浏览器盖住的这段时间里 webview 会把定时器节流，它是本模块唯一一条"改状态在别处发生"的链路，不能只靠它。
- **失败原因用子进程的原话**：授权进程早退而凭据没落位时，把它 stdout 尾部几行带回摊在授权行下，按钮同时退回「去授权」；我们不替它猜原因（标签页被关、zone 选不了、token 创建被拒，只有它自己说得清）。

一条状态提示（不强制改用户既有配置）：

- 局域网传输若 `local_only=false`（这是**默认值**，`fileshare-core/src/config.rs:16-18` serde default bool，即默认监听 `0.0.0.0`），启用穿透时给可见提示"当前同时开放局域网与公网两条路径"，让用户自己决定是否切本地。

无入场动画；控件一律落宿主的尺寸轴——页栏 30px、行内 28px、弹窗字段 32px/13px。

## 局域网传输作为一条服务：三处前置（不改就"连不上或裸奔"）

1. `fileshare-core/src/handlers.rs:67` 的 `host_trusted` 只认 IP 字面量与 localhost，域名 Host 一律拒（`handlers.rs:594` 的单测就是这么断言的）。隧道域名的 Host 进得来去不了，必须把它加进白名单，且白名单来源是本模块服务表里登记过的子域，逐条加，不做通用开关。
2. 经隧道进来的请求与页面同源，`handlers.rs:64-84` 的 Origin/Sec-Fetch-Site 防重绑检查整体失效——所以 Q3 的鉴权加固不是可选项，它是**这两道防线失效后的唯一屏障**。
3. 两个面板各管各的面，不合并：局域网传输在 desko 里仍只有它自己那一个设置面板（管局域网侧），公网的口令/动作面/失败锁定住在穿透模块的弹窗里。合并等于让局域网面板长出公网开关，两边都会读错。

## 测试策略（原方案缺，补上）

授权流程要真账号、真浏览器、真网络，e2e 跑不了；照现状 P2/P3 只能手工验收、回归无保障。

- **Rust 侧单测**：参数拼装（目标只许 loopback、端口白名单）、凭据目录选址断言、限速锁定的计数与恢复。
- **e2e**：模块页的开关默认关、状态文案逐态、锁屏前后运行态不变。沿用仓库既有的 shots 流程（跑前删旧 PNG、跑后按 EXPECTED 逐名核对）。

### P1 实际交付的验证形态（2026-10-09）

- **假 cloudflared 存根推迟到 P2**。P1 要验的不是状态机的分支剧本，而是"作业对象能不能真的兜住孤儿"——这一条只有起真进程才验得出，所以 `tunnel_service.rs` 的单测直接 `spawn` 一个 `powershell.exe`，带上生产用的 `build_run_args`，等 pidfile 出现后 `drop(job)`（不显式 kill），断言 15s 内进程自己没了。剧本化的注册失败/冲突/断连三态要等 `tunnel login`/`create`/`route` 进状态机才有意义，随 P2 一起进 `scripts/`。
- **界面三态走 e2e mock**：`e2e/mocks/backend.ts` 的 `tunnel` 段能拼出 未绑定 / 有隧道未起 / 进程在跑未连上边缘 / 已连上 / 未取程序 五种组合，`e2e/specs/tunnel.spec.ts` 逐态断言文案与按钮禁用态，含"下载失败（网络）"与"产物校验不符（可疑，已丢弃）"两条错文分流。

### P2 实际交付的验证形态（2026-10-09）

- **命令面用假 cloudflared 剧本，不碰真账号**：`scripts/mock-cloudflared.mjs` 收与真二进制同形的参数，靠 `DESKO_MOCK_STATE / _HOME / _LOGIN / _DELAY / _CONNECTORS` 演分支（cert 写 `--origincert`／写默认 home／一直不回来／注入别处的 connector）。`tunnel_service.rs` 的 16 条单测经 `node` 起它，覆盖 login 落盘与超时、create 连打两次、token 找回丢掉的凭据、route 的 zone 错文原样透出、劈流只读边缘 connector，以及"退 0 但 stdout 不可解析不算成功"。
- **进度是算出来的，不是记下来的**：`provision_step(ProvisionFacts)` 只看本机特征（程序在不在／有没有 cert／有没有记过 tunnel ID／凭据在不在／子域登记了没），中断后重进自然落在第一件还缺的事上，没有"上次做到哪"的会话指针要维护。每步的专属文案由单测断言"两步不共用同一句"。
- **界面 16 条 e2e**：`e2e/mocks/backend.ts` 补齐 授权／建隧道／登记子域／劈流 四组命令的 mock，`e2e/specs/tunnel.spec.ts` 逐态断言（未授权时新建钮按不住且原因写在 title、等待态给倒计时与取消、同名非本机默认不认＋接管、zone 失败透出原话、劈流报处数、中断后重进落在缺的那步）。shots 流水线加到 11 景 × 2 主题。
- **凭据不进备份包由可执行测试把住**：`backup_service.rs` 里先往 `tunnel/` 放好 `<id>.json` 与 `config.yml`，再走真 `create_package`，断言包内只有 `manifest.json` + `data.db`。判得住是因为 `container::build_zip` 是白名单构造（附件只在迁移导出时按清单装），不是"扫一遍再排除"。

## 待实测清单

1. ~~`--home-path` 是否存在~~ → **已实测：不存在**（2026.10.0）。改用 `--origincert` + `--credentials-file`，详见 Q1 步骤 3。
2. ~~**`tunnel login` 的 cert 写入路径能否被 `TUNNEL_ORIGIN_CERT` 重定向**~~ → **读侧已实测：能**（设了它，错误文本里的 cert 路径即变成指定值）。写侧仍待真账号验一次：`login` 无相关 flag，只有全局的 `--origincert` 与这个环境变量。代码按"两种都设 + 完成后同时查 `~/.cloudflared/cert.pem` 并搬进来"实现，验过再删多余那条。
3. **本机代理环境下 connector 注册能否成功**：`tunnel login` 的回调走 `https://login.cloudflareaccess.org/`，注册走出站到边缘。fake-IP + 系统代理的环境里这两步是未验证假设——先手工跑通一次并记录用哪个 `--region/--edge-ip-version/protocol` 组合，再写状态机；否则 UI 会把网络层失败报成"授权失败"。
4. Cloudflare 请求体上限是否适用于 Tunnel 流量：文档口径不一致（max upload 记为 Free/Pro/Business 100 MB、Enterprise 至多 5 GB，但对 Tunnel 是否生效表述含糊），而服务端 `MAX_UPLOAD_BYTES` 是 4 GiB（`handlers.rs:25`）。实测前**不写进 UI 文案**，第一版一律按"经隧道只做下载与小文件"表述。
5. ~~备份导出包里不含凭据文件（见 Q1 步骤 3 的选址硬约束）~~ → **已验（2026-10-09）**：可执行测试，见"P2 实际交付的验证形态"末条。真机再验一次只需在跑过一轮备份后翻包。
6. 下载源已核：固定版本 URL `https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-windows-amd64.exe` 可用（302 跳到带短时效签名的 release-assets 域，须跟随重定向；`latest/download/` 形式也能取到同版本）。当前版本 2026.10.0 的 windows-amd64 sha256 = `86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c`，大小 55,365,048 B——这就是白名单常量的初值。许可证 Apache-2.0。
7. 一条隧道能挂几条 hostname 规则、`route dns` 的记录数有无配额：CLI 与本机都预检不出来。实测前**界面不设上限提示**，只在超限时把 cloudflared 的原话透出来，不自己编"最多 N 条"。

## 分期（每期带验收）

- **P1 骨架**：sidecar 监督（起停、看门狗、状态文件）+ cloudflared 自动拉取（缓存复用、版本重校验、网络/内容不符分流）+ 假 cloudflared 存根 + 模块页与设置开关（默认关）。
  验收：开关默认关；用存根跑通起停与状态回填；desko 退出后无残留进程；下载失败时错文能区分网络与校验。
  **已交付（2026-10-09）**，两处与原文不同：
  - 存根换成 Rust 侧起真进程验作业对象（见测试策略），剧本化三态随 P2。
  - 模块页 P1 只有"运行态 + 穿透程序"两张卡，还没有"一行一条隧道"的列表——可配置的具名隧道要等 P2 的 create/route 才存在，P1 无数据可列。起停动作此时打在唯一的那条（`meta.tunnel_id`）上，界面在 `bound=false` 时把启动钮置灰并说明"本机还没有绑定隧道"。
- **P2 授权与建隧道**：凭据目录隔离（实测后定手段）、login 引导与轮询、create/route dns 的幂等续做、子域可配 + zone 归属校验、按 tunnel ID 的冲突探测与错文。
  验收：中断任一步后重进能续做且不产生重复隧道；冲突态与失败态各有专属文案；凭据不进备份包（实测）。
  **已交付（2026-10-09）**，与原文不同之处：
  - "凭据目录隔离"不需要新手段：`--origincert` 与 `--credentials-file` 两个入口经真二进制读侧确认，落点全在 desko 自己的 app data 子目录；cert 若被真二进制写进默认 `~/.cloudflared`，本机探到后搬进来（搬，不共享）。写侧仍待待实测清单 2 验一次。
  - 幂等靠"本机记录短路 + 名字默认不认"两条一起成立：已记过 tunnel ID 时不再问远端名字（第二次 `create` 走不到）；没记过时，`list --name` 命中的那条一律被拒，界面给"换个名字新建"和显式"接管"两条路，只有接管才把 ID 写进本机记录。`nameTaken` 是瞬时态——轮询读的是本机特征，不会替它继续作证，所以这句话由前端持有。
  - 落盘顺序按"能续"排：`create` 成功 → 先记 ID/名字 → 再放凭据；中途断在任一步，重进时缺什么补什么（凭据丢了走 `tunnel token` 找回，不重建）。
  - 冲突探测判据是 `tunnel info -o json` 里 active connector 的处数，文案只说"另有 N 处也在跑"，不猜是谁、不猜在哪。
  - P2 收口在"就绪"（cert + tunnel + 子域），指向哪个本地端口是 P3 的 ingress，所以就绪那句文案明说这一点。
  - P2 的"子域"按**单条 hostname** 存（`meta.hostname` 一个值）。范围扩到通用服务后它不必回炉：多服务就是同一台机器上把 `route dns` 按每条 hostname 各调一次，单条是它的子集。服务表随 P3 的 ingress 一起进，届时只改 meta 的读法，已验的幂等路径不动。
- **P3 通公网**：服务表（N 条 `子域 → 127.0.0.1:端口` + 每条的公网设置）落库并生成 config.yml 的 ingress；`host_trusted` 按服务表逐条放行；cookie `Secure`；按服务维度的登录失败限速与锁定（跨子进程重启保持）；默认只读、上传另开、`POST /settings` 公网侧禁用；单条服务的公网设置弹窗；只信子进程状态的运行态回填；页面按「UI 形状」一节重做——准备流做完即收成摘要、服务列表当主角、程序与进程信息收进页脚诊断条。
  验收：无口令的服务在公网侧存不下来；限速锁定按服务复现且跨重启仍计数；改一条服务的设置不影响其余条；锁屏与解锁都不动隧道，只有页面停止或退出程序才断；没登记过的本机端口从公网打不通。
- **P4（可选，未拍板）**：Cloudflare Access 策略接管鉴权。做与不做取决于 P3 的加固是否够用。
- 不做：反代分流、裸 TCP 转发（理由见 Q3 第 6 条）、单条子域的独立起停（边缘按整条隧道发流，做不到）、desko 退出后常开、远端隧道资源与 DNS 记录的回收。
