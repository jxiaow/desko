# Codex 实时会话桥（2026-10-20，草案 · 待拍板）

> 2026-10-22：用户已选择原生集成，实际实现与验证记录见 [21-codex-web-ui-integration.md](21-codex-web-ui-integration.md)。以下保留为历史草案，其只读范围与待拍板条目不再描述当前实现。

一句话方案：**在 desko 内用 Rust 直连官方 `codex app-server` stdio，为 Codex 模块新增「对话」页签**——把 `C:\Code\Codespace\codex-web-ui`（907 行 React+Node）当协议规格书用，只搬它的 method 面与状态机，Node/ws/HTTP 静态服务/React 整层丢弃；v1 锁 `read-only` 沙箱、不做审批回环，写代码仍回 CLI/IDE。

状态：**待拍板**。第 8 节 P1–P6 每条都要签字后才开工。参考实现目录无 `.git`，开工前先自行纳管一份。

---

## 1. 现状实测（2026-10-20，本机）

### 1.1 desko 侧：只有读盘，没有驱动

| 事实 | 证据 |
|---|---|
| desko 从不 spawn `codex` | `codex-core` 内真实 spawn 只有 `security` / `wsl.exe` / `ps` / `lsof` / `netstat`；唯一 `Command::new(codex)` 在 `#[ignore]` 测试里 |
| 唯一的 app-server 模块是 8 行裁剪桩 | [src-tauri/codex-core/src/modules/codex_official_app_server.rs:6](file:///C:/Code/Codespace/desko/src-tauri/codex-core/src/modules/codex_official_app_server.rs#L6) 恒返 `Err("该能力已在裁剪版中移除")`，上游同名为 962 行实现 |
| CLI daemon 只探测、不执行 | [src-tauri/codex-core/src/modules/codex_cli_daemon.rs:6](file:///C:/Code/Codespace/desko/src-tauri/codex-core/src/modules/codex_cli_daemon.rs#L6) 探 macOS unix socket 后**拼一行字符串给前端**，`:18` 注释写明 "never executes this command"；非 macOS 走 `:65-66` 的 `let _ = codex_home` 空分支 |
| 会话列表走磁盘解析 | `codex_session_manager.rs:1476` 扫 `rollout-*.jsonl`，`:1509` 读首行 `session_meta`，合并 `session_index.jsonl`；命令 `codex_list_sessions_across_instances`（[src-tauri/src/main.rs:446](file:///C:/Code/Codespace/desko/src-tauri/src/main.rs#L446)） |
| 会话正文已可在前端原文展示 | `web_codex_read_session` → [src-tauri/src/web_access/bridge.rs:164](file:///C:/Code/Codespace/desko/src-tauri/src/web_access/bridge.rs#L164) |

**结论**：desko 有"看 Codex 干过什么"，没有"让 Codex 现在干什么"。本功能补的正是后者，且不与任何现有链路重叠。

### 1.2 官方 app-server 在本机的真实形态

`codex-cli 0.162.1`，`codex` 在 `%APPDATA%\Roaming\npm\codex.cmd`。`codex app-server --help` 自述 **[experimental]**，并带 `daemon` / `proxy` / `generate-ts` / `generate-json-schema` 四个子命令——**最后一项是协议对账的现成工具，本方案必须用上（见 §6）**。

`codex app-server generate-json-schema --out <dir> --experimental` 生成的权威协议面：

| 方向 | method 数 | 本方案取用 |
|---|---|---|
| ClientRequest（我们发） | **170** | 6 |
| ClientNotification | 1（`initialized`） | 1 |
| ServerRequest（我们须答） | **11** | v1 只 1（见 P2） |
| ServerNotification（我们须处理/忽略） | **84** | 8 |

取用面 6/170 + 1/11 + 8/84。**面窄是这功能可行的前提**，也是它最大的风险来源——窄意味着全部靠白名单硬编码，上游改名即断。

### 1.3 参考实现对 0.162.1 仍然有效（逐条核过）

- `thread/start` 发 `{cwd, sandbox, approvalPolicy, serviceName, model}` ↔ `ThreadStartParams` 全部存在 ✓
- `thread/resume` 发 `{threadId, cwd, sandbox, approvalPolicy, excludeTurns}` ↔ `ThreadResumeParams` ✓
- `turn/start` 发 `{threadId, cwd, input}` ↔ `TurnStartParams` ✓（注意该结构里是 `sandboxPolicy` 而非 `sandbox`，参考实现没在 turn 级传沙箱，本方案保持一致）
- `SandboxMode` = `read-only | workspace-write | danger-full-access`；参考实现只暴露前两档，**`danger-full-access` 不给 UI 入口**（继承这个决定）
- `AskForApproval` = `untrusted | on-request | never` **或** granular 对象（`mcp_elicitations / rules / sandbox_approval / skill_approval / request_permissions`）；参考实现固定 `on-request`，本方案 v1 也固定
- `Turn` = `{id, status, items, itemsView, error, startedAt, completedAt, durationMs, rootTurnId}`；`TurnStartedNotification` = `{threadId, turn}` ✓

### 1.4 schema 里三处可以让 desko 版比参考实现干净

1. **`Thread` 对象同时带 `id` 和 `sessionId`** —— 会话主键对账不用猜，也不用等实测（§7 D4）。
2. **`turn/start` 有 `clientUserMessageId`** —— 参考实现用 `optimistic` 假条目 + `userMessage` 过滤来防"用户气泡闪两次"，那是没读 schema 的土办法；desko 版直接用 `clientUserMessageId` 落真实 id，删掉整条 optimistic 逻辑。
3. **命令审批参数带 `availableDecisions`、`command`、`reason`、`cwd`、`commandActions`、`proposedNetworkPolicyAmendments`** —— 参考实现硬编码"允许一次 / 拒绝"两颗钮；二期开审批时必须**按 `availableDecisions` 渲染**、把 `command` 原文显示出来，不给用户盲签。
4. `ToolRequestUserInputParams` 带 `isBlocking` 与 `autoResolutionMs` —— 非阻塞征询不该冻住输入框，参考实现没区分。

### 1.5 现成可复用的 desko 基建

| 需要 | 现成范式 |
|---|---|
| 长驻子进程 + 双向管道 | `services/tunnel_service.rs` 已有 piped child + stdout/stderr drainer 线程 + **Job Object**（`ProcessJob`）——必须复用，否则关窗杀不掉 `codex.exe` 会留孤儿（`externalBin` 少一颗 exe 就 exit 101 的老坑属另一类） |
| sidecar 声明与同步 | `tauri.conf.json` `externalBin` + `scripts/sync-fileshare-server.mjs` / `sync-netguard-helper.mjs` 模式 |
| 异步 + JSON | `codex-core` 已 `tokio features=["full"]`、`serde_json`；主 crate `tokio` 只开 `net,sync,time,macros` |
| 落库 | `src-tauri/src/db/`（`schema.rs` + 每域一个 `*_repo.rs`），比参考实现的 `threads.json` 自建持久层合适 |
| 会话 UI 挂载 | Codex 模块现为 4 页签 `accounts / sessions / usage / trash`（[src/components/codex/CodexModule.vue:431](file:///C:/Code/Codespace/desko/src/components/codex/CodexModule.vue#L431)），加第 5 页签 `dialog` 不动 `src/modules/registry.ts` |
| 代码高亮 | 依赖里已有 `lowlight` + `@tiptap/extension-code-block-lowlight`；**无 `marked`、无 `DOMPurify`** |

---

## 2. 参考实现盘点：逐层去留

| 层 | 原文件（行） | 集成后 |
|---|---|---|
| JSONL stdio JSON-RPC | `server/rpc.mjs`(121) | **重写为 Rust**，语义逐条照搬：id 前缀 `web:` → `desko:`、30s 单请求超时、stderr 只排空不外泄、`fail()` 时 reject 全部 pending、`runtimeEnvironment()` 剥掉的 6 个 `CODEX_*` 注入变量一个不能少 |
| `codex.exe` 发现 | `server/rpc.mjs:6-24` `findCodex` | **重写为 Rust**，三级：`CODEX_BIN` → npm 打包路径 `@openai/codex-win32-<arch>\vendor\<triple>\bin\codex.exe` → PATH 逐个 `codex.exe`；`CODEX_WINDOWS_SANDBOX` 校验 `mxc|elevated|inherit` 后拼 `-c windows.sandbox="..."` |
| 会话状态机 + 审批 + 广播 | `server/bridge.mjs`(235) | **重写为 Rust**（本功能核心） |
| git 工作区改动 | `server/workspace.mjs:repositoryStatus`(42) | **v1 砍掉**。它需要跑 `git -C`，是纯装饰面板，且 desko 无"仓库工作区"概念；`Thread.gitInfo` 若够用再议 |
| 会话索引持久层 | `server/workspace.mjs:ThreadStore`(JSON 文件 + 原子写) | **改为 desko SQLite**（`codex_thread` 表），不造第二个持久层 |
| HTTP 静态服务 / WS / 安全头 | `server/index.mjs`(111) | **整层丢弃**。集成后没有监听端口，host/origin 校验、CSP、路径穿越防护、`/api/shutdown`、4317 全部不需要；净减一个 TCP 面 |
| WS 客户端 + 退避重连 | `src/client.mjs`(38) | **丢弃**，改 Tauri `invoke` + `listen` |
| 事件折叠 reducer | `src/conversation.mjs`(72) | **重写为 TS**（`applyEvent` / `hydrateConversation` / `restoreView` 三函数语义必须逐条保，尤其 `serverRequest/resolved` 按 `JSON.stringify(requestId)` 比对——`RequestId` 是 string|number 联合，不能当字符串比） |
| React UI | `src/main.jsx`(254) | **按 desko 令牌重画成 Vue**。lucide-react → Solar 图标轨；marked+DOMPurify → v1 纯文本 + `lowlight` 代码块；样式按弹窗/页签基线与 28px `.action-btn` 尺寸轴 |
| 测试 | `tests/bridge.test.mjs`(204)、`conversation.test.mjs`(56) | **当验收规格表**：并发 12 上限、32000 字输入上限、命令输出 200000 字符尾部截断、`recent` 环形 200 turn、resume 去重（`resuming` promise 复用）、跨工作区 thread 拒绝（`owns()` + `samePath` 大小写不敏感） |

---

## 3. 范围

| 在内（v1） | 明确不在 |
|---|---|
| 单进程 `codex app-server --listen stdio://` 子进程，随 Codex 页签首次进入时拉起 | 常驻后台服务、开机拉起、多实例 |
| 新建会话、选模型、`read-only` 沙箱、发一条消息、流式看回复、停止（`turn/interrupt`） | `workspace-write` / `danger-full-access`、任何写文件能力 |
| 会话列表与 desko 盘扫会话合流（同一 `sessionId` 一条） | 会话导入导出、跨机续接 |
| 反向请求只应答 `account/chatgptAuthTokens/refresh`（转调 desko 既有刷新链路，见 P2） | 4 类审批（命令/文件/权限/征询）全部 `-32601` 拒绝 |
| 断线重连：子进程退出后按 1.5s→上限 15s 退避重启，页面显示连接态 | 自动重发被打断的 turn（宁可让用户确认，绝不静默重投） |
| 前端事件补挂：切页签/关面板后事件仍进缓存，回来按 `seq` 折叠 | 通知栏提醒、托盘徽标、后台跑完播报 |
| `initialize` 协议闸门 + 面板级禁用 | 用 app-server 反代 desko 现有的账号/用量链路（**另开单一通道，禁止**） |

---

## 4. 规格

### 4.1 进程与生命周期

1. 发现 `codex.exe`（§2 三级），找不到 → 页签内联"未找到 Codex CLI"+ 说明，**不弹 toast、不重试**。
2. spawn：`codex app-server --listen stdio://`，`cwd` = 会话选定的目录（v1 候选集见 P5），`windowsHide`、stdio 三 pipe，env 走剥除后的副本。
3. `initialize {clientInfo:{name:"desko_codex_bridge", title:"Desko", version: 应用版本}}` → 成功才 `status=ready`；失败即 `status=unsupported` 并禁用输入（P4）。
4. 输入侧写：一行一条 JSON，`\n` 结尾；输出侧 `BufReader::lines()` 逐行 parse，parse 失败静默跳过（上游会混非 JSON 行）。
5. stderr 只排空丢弃，**不进日志、不进前端**（参考实现的理由成立：可能带认证/配置细节）。
6. 收口：切档案 / 退出应用 / 页签关闭后空闲 10 分钟 → `stdin.shutdown()` + `kill` + Job Object 兜底杀子树。子进程意外退出 → 全部 pending 请求 reject + 广播 `runtime` 掉线。
7. **锁屏不停进程**（沿用"服务生命周期 ≠ 锁屏"的既有裁定），但锁屏期间不得有可输入面：见 P3。

### 4.2 协议白名单（全部硬编码，逐条在册）

发出（6）：`initialize`、`thread/start`、`thread/resume`、`thread/turns/list`、`turn/start`、`turn/interrupt`；通知 1 条：`initialized`。

接收并折叠（8）：`turn/started`、`item/started`、`item/completed`、`item/agentMessage/delta`、`item/commandExecution/outputDelta`、`turn/completed`、`serverRequest/resolved`、`error`。

接收但丢弃（明示，不静默）：`item/reasoning/*`（v1 不显示思考过程）、其余 74 条 ServerNotification（含 `thread/tokenUsage/updated`、`account/*`）——计数不入前端。

反向请求：只 `account/chatgptAuthTokens/refresh` 走真应答，其余 10 条统一 `-32601` + 文案"该请求 desko 当前不处理"，并在诊断行计数（不弹窗）。

`thread/start` 固定：`approvalPolicy="on-request"`、`serviceName="desko_codex_bridge"`、`sandbox="read-only"`、`ephemeral` **不传**（传了不落盘 → 盘扫看不见 → 违反 §4.4）。

### 4.3 状态机（与参考实现逐条对齐）

- 每 thread 一份 `live {items, recent(≤200 turn), turnId, status, resumed, starting}`。
- `starting` 闸门 + `status ∈ {inProgress, waitingOnApproval}` 时拒发新 turn，错误文案照抄「当前对话正在执行，请等待完成或先停止」。
- `resume` 用 in-flight promise 去重，同 threadId 并发只发一次 RPC。
- 广播带单调 `seq`；前端缓存 `seq > snapshot.eventSeq` 的事件，回来时 `restoreView` 折叠。
- 标题：首条消息 `text.trim().chars().take(42)` 覆盖"新对话"。
- 长度：输入 1–32000 字符；命令输出项累积超 200000 只留尾部（注释写明理由：Codex 自己留全文，UI 只留尾）。

### 4.4 与盘扫/用量的关系（单一通道原则）

- **主键 = `sessionId`**（`Thread.id` 与 `session_meta.session_id` 实测同字段，desko 以 `sessionId` 归一）。
- 会话列表**仍只由现有盘扫提供**，不新增第二条扫描通道；本桥只负责"驱动"，负责往 SQLite 写 `desko` 侧元数据（模型、沙箱、最后活跃、当前 turn 状态）。
- 用量页不动：桥不许为用量另开 RPC（`account/usage/read`、`thread/tokenUsage/updated` 明确不用）。

### 4.5 界面

位置：**Codex 模块第 5 页签「对话」**，与 `sessions` 并列；不加侧栏模块，不改 `registry.ts`。

```
[账号] [会话] [用量] [回收站] [对话]                     ← 现有 cx-tabs 追加一颗
左侧 thread 列表(200px, 复用 .rcard 行卡)   右侧对话区
  新对话 · 正在执行 ●                        ┌ agentMessage 气泡
  重构登录页 …                               │ 命令输出 <pre> + lowlight
  …                                          └ 连接态: 已连接 0.162.1 · read-only
[工作目录 ▾ xyhm]  [模型 ▾ 账号可用清单]
┌────────────────────────────────────────┐
│ 输入…(Enter 发送 / Shift+Enter 换行)   │   [发送] [停止]
└────────────────────────────────────────┘
```

硬约束（按仓库既有视觉裁定）：无入场动画；`scrollbar-gutter: stable`；按钮走 28px `.action-btn` 档；图标只从 Solar 轨取；深色小字 ≥5.8:1；等宽小字 Consolas。空态：无 thread → 一行说明 + 一颗「新对话」；连接失败 → 内联原因 + 「重试连接」，不甩 toast。

---

## 5. 数据契约

```text
codex_bridge_status() -> {
  status: 'idle'|'connecting'|'ready'|'unsupported'|'exited',
  cliVersion: string|null, codexPath: string|null, error: string|null,
  rejectedServerRequests: u32
}
codex_bridge_start()  -> { status, cliVersion }          // 幂等；失败 Err 带原因
codex_thread_create({cwd, model?}) -> { threadId, sessionId, title }
codex_thread_send({threadId, text}) -> { turnId }
codex_thread_interrupt({threadId}) -> ok
codex_thread_snapshot({threadId}) -> { thread, turns[], activeTurn, requests, eventSeq }
codex_threads_list() -> [{ threadId, sessionId, title, cwd, model, status, updatedAt }]
```

事件（Tauri emit，前端 `listen`）：

| 事件 | 载荷 |
|---|---|
| `codex:runtime` | `{status, error?}` |
| `codex:threads` | `[{threadId, status, updatedAt}]` |
| `codex:event` | `{seq, method, params}` 原始通知，前端 reducer 折叠 |
| `codex:rejected` | `{method, count}` 诊断，仅页签底部一行 |

`requests` / 审批相关结构 v1 保留字段位但不填充（二期开审批不再改契约）。

---

## 6. 改动清单

| 文件 | 内容 |
|---|---|
| `src-tauri/src/services/codex_bridge/mod.rs`（新增） | 子进程生命周期、Job Object、管道 drainer、pending map、超时；**独立 crate 目录，不进 `codex-core`（见 D1）** |
| `src-tauri/src/services/codex_bridge/protocol.rs`（新增） | 白名单常量 + serde 结构（只声明用到的字段，其余 `serde_json::Value` 透传） |
| `src-tauri/src/services/codex_bridge/discovery.rs`（新增） | `codex.exe` 三级发现、`windows.sandbox` 参数拼装、env 剥除清单 |
| `src-tauri/src/commands/codex_bridge.rs`（新增） | §5 七条命令，`main.rs` `generate_handler!` 注册 |
| `src-tauri/src/db/schema.rs` + `db/codex_thread_repo.rs`（新增/改） | `codex_thread` 表；不落消息正文（正文仍以 rollout 文件为权威） |
| `src/services/api/codex.ts` + `codexState.ts` | 命令封装 + `listen` 订阅 + reducer |
| `src/utils/codexTurnReducer.ts`（新增） | `applyEvent`/`hydrateConversation`/`restoreView` 的 TS 移植，单测逐条对拍参考实现 |
| `src/components/codex/CodexDialogPanel.vue`（新增） | 第 5 页签面板 |
| `src/components/codex/CodexModule.vue` | 追加页签与 `view === 'dialog'` 分支 |
| `e2e/mocks/backend.ts` + `e2e/specs/codex.spec.ts` | mock 七条命令 + `codex:*` 事件；用例见 §9 |
| `scripts/codex-protocol-check.mjs`（新增） | **上游对账脚本**：跑 `codex app-server generate-json-schema --experimental`，把 §4.2 白名单逐条比对生成 schema 的 `ClientRequest`/`ServerRequest`/`ServerNotification` method 枚举，缺项即非零退出。挂进 `npm run` 检查链，替代"每月人工对照"里看不见的那半 |
| `docs/design/codex/06-port-gap-audit.md` 活账 | §5 的 7 条新命令**不进 `keep_cmds.json`**——那本账 64 颗只记上游 cockpit-tools 移植面，混入自研命令会让每月逐文件 diff 失去基准；改在 06 号活账里单开「desko 自研命令面」一栏登记 |

---

## 7. 决策记录（本方案自定，可推翻）

- **D1 桥代码放主 crate `src-tauri/src/services/codex_bridge/`，不放 `codex-core`。** 理由：`codex-core` 是要与上游 cockpit-tools 逐文件 diff 对账的 vendored 裁剪仓（`slice_report.json` + `keep_cmds.json` 64 颗在册），混进自研域会永久污染对账基线；且 `UPSTREAM.json` 的 `syncPolicy` 是"每月人工对照"，新增文件会让对照面变大。
- **D2 不搬 Node。** 理由：`engines.node>=22` + `ws` 会成为 desko 第一颗需要外部脚本运行时的 sidecar；现有两颗（`desko-fileshare`、`desko-netguard`）都是自包含 exe。且集成后没有浏览器，`index.mjs` 大半变死码。
- **D3 v1 只 `read-only`、无审批。** 理由：审批一开，P2/P3 两个最难的问题（锁屏期间弹审批、反向请求拥有本机执行权）当场落地；先跑通"驱动 + 流式 + 中断"这条主干，风险面小一个量级，且 3 周内就能验证协议闸门稳不稳。
- **D4 主键用 `sessionId`，`threadId` 只作 RPC 句柄。** 依据：schema 里 `Thread` 同时有 `id` 与 `sessionId`，本机最新 rollout 的 `session_meta.payload` 里 `id == session_id == 01a152fe-1ade-7f60-9ddd-be018cf18cdc`，且都出现在文件名。用 `sessionId` 归一可直接和盘扫、用量、回收站对齐。
- **D5 不引入 `marked`/`DOMPurify`。** 理由：v1 消息按纯文本渲染 + `lowlight` 高亮代码块已够读；引 markdown 解析器等于给 agent 输出开 HTML 注入口，而 desko 的 HTML 清洗链路是为小记设计的，语义不同。二期若要渲染 markdown，须单独拍板清洗器。
- **D6 optimistic 假消息不移植**，改用 `clientUserMessageId`（§1.4-2）。
- **D7 审批决策二期实现时必须按 `availableDecisions` 渲染**，不得硬编码两颗钮（§1.4-3）。

---

## 8. 待拍板（每条附推荐，签了才开工）

- **P1 v1 是否就锁 `read-only`（不写文件、不审批）？**
  推荐：**是**。这是把功能从"能跑"推到"敢常开"的最短路径；写权限与审批作为二期独立拍板。
- **P2 `account/chatgptAuthTokens/refresh` 这个反向请求怎么处置？**
  背景：Codex 会在 token 到期时**反过来向客户端要新 token**，参考实现把它当不支持直接 `-32601`。desko 若也拒，长时间会话会在 token 到期点断掉。
  推荐：**v1 就实现它**，转调 desko 既有刷新链路。但这与"desko 强制刷新会轮换 refresh_token、可能打断运行中的官方客户端"这条既有约束直接相关（见 `17-wsl-auth-sync.md` D3）——所以要你点头的是**是否允许本桥触发一次刷新**，不接受则 v1 明确写"长会话可能在凭据到期时中断"，并在桥里做掉线重连兜底。
- **P3 锁屏时正在跑的 turn 怎么办？**
  推荐：**进程与 turn 继续跑**（锁屏不是停止信号），但锁屏后**不得自动 accept 任何审批**（v1 无审批，此条等于零成本），且解锁时 `codex:event` 缓存必须补齐；若 turn 卡在 `waitingOnApproval`（二期），锁屏期间该 turn 挂起至解锁，不自动拒绝。请确认这条排序。
- **P4 协议不匹配时的表现？**
  推荐：**整体禁用 + 明说原因**，输入框 disabled + 一行"当前 Codex 版本 (x) 的 app-server 与本版本 desko 不匹配，已停用对话页签"；**不做部分降级、不做静默桩**（裁剪桩返 `Err` 把流程炸在看不见处已踩过一次）。`scripts/codex-protocol-check.mjs` 作为 CI/本地闸门。
- **P5 工作目录怎么选？**
  推荐：候选集 = **Files 模块已有的目录快捷方式**（`list_file_shortcuts`）∪ **盘扫会话里出现过的 `cwd`**（`codex_session_manager` 已在读），下拉选择不给自由路径输入框。理由：`read-only` 沙箱的"能读到什么"完全由这个选择决定；自由路径等于绕过 desko 现有的目录授权面。
  注意一处**有意分歧**：参考实现强制 `WORKSPACE_PATH` 必须是 Git 仓库根（`index.mjs` 启动即校验 `.git`），desko 版不沿用——快捷方式可以指向非仓库目录（如日志导出目录），只读问答照样有意义。
- **P6 局域网/web 侧暴露面？**
  现状：`web_access` 会把 desko 前端 HTTP 服务出去（可绑 `0.0.0.0`），Codex 命令走显式白名单（[src-tauri/src/web_access/codex.rs:14](file:///C:/Code/Codespace/desko/src-tauri/src/web_access/codex.rs#L14)，且过 `authorize_codex`）。
  推荐：**§5 七条命令一律不入 `web_access` 白名单**，手机/局域网侧看不到「对话」页签；并加一条 e2e/自检断言防以后有人顺手加进去。要移动端驱动本机 agent 的话，那是另一个功能，单独拍。

---

## 9. 验收计划

1. **Rust 单测**：`findCodex` 三级发现（含 npm 打包路径与 PATH 兜底、`CODEX_BIN` 指向不存在时的报错）；env 剥除清单生效；非 JSON 行不炸解析；超时后 pending 清空；子进程退出 → 全 pending reject + 一次 `runtime` 掉线；Job Object 在 kill 后不留 `codex.exe`。
2. **reducer 对拍**：`codexTurnReducer` 用参考实现 `tests/conversation.test.mjs` 的同一批输入，断言输出逐字段一致（含 optimistic 分支——D6 改用 `clientUserMessageId` 后该用例改写并注明差异）。
3. `node scripts/codex-protocol-check.mjs` 0 退出；把 codex 升到下一版后重跑，验证它会红。
4. `npx vue-tsc --noEmit` 0 error；`npx vitest run` 全绿。
5. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts --retries=0` 全绿，新增用例：未找到 CLI 的禁用态、ready 后发消息 → 流式增量渲染 → `turn/completed` 收口、`starting` 闸门内重复发送被拒、切页签期间事件不丢（回来 seq 折叠正确）、锁屏/解锁后状态一致、**web 侧断言「对话」页签与七条命令均不可达**。
6. shots：`.tmp/codex-dialog/` 浅色/深色 + 空态 + 掉线态 + 0.162.1 不匹配禁用态，五帧全部本次新拍后目检。
7. **真机验收由用户执行**（真实账号动作不由代理代点）：本机 `codex 0.162.1` 发一条只读问题，确认流式回复、`turn/interrupt` 生效、desko 会话页与用量页出现同一条 `sessionId` 且不重复。
8. 提交与推送另行点头。

---

## 10. 成本与结论

- 新增 Rust 约 600–750 行、Vue/TS 约 350–450 行、mock+用例约 200 行、对账脚本约 120 行。合计 ~1.2–1.5k 行，**比 `17-wsl-auth-sync.md` 那种单点功能大一个量级**，与隧道模块（`docs/design/tunnel/`）同档。
- 主要不确定性集中在 **P2（凭据刷新权）** 和 **协议漂移**（app-server 自述 experimental，170 个 method 里只取 6 个，改名即断）；前者要你拍板，后者已由 §6 的 `codex-protocol-check.mjs` 变成可执行闸门，不再是口头风险。
- 综合判断：**值得做**。它是 Codespace 同级仓库里唯一给 desko 带来新维度的候选，且 desko 侧的进程管理、落库、模块挂载、页签骨架全部有现成范式，属于"补齐裁剪掉的域"而不是"新造一套体系"。
