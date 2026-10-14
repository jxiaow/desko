# P2 提权落盘（desko-netguard）— 可执行设计

日期：2026-10-11　状态：**主要流程已实现，Windows 真机验收待完成**　上游：`01-bypass-module.md` §3、Q1

2026-10-13：已实现的修订约定见 `01-bypass-module.md` 的「2026-10-13 实现修订」与「完整性核对与文案修订」。计划共用、按目标汇总成败、只撤销实际新增的路由、只还原 hosts 托管区、独立回滚入口和失败保留回滚点等行为，以这两节为准。

## 01 里已定、本文不重开的

- **Q1**：只在真正改系统时弹一次 UAC，多条目攒一批共用；不装常驻提权服务，主进程不整体提权。
- 托管区块名沿用 `# BEGIN/END TUN-BYPASS-MANAGED`，把外部脚本写的块原地收编。
- **最贵的一条教训**：路由网关必须落在候选接口自己的网段内，否则 Windows 判路由不可用、静默回落默认路由，症状是"路由在却不通"。
- desko 不改接管方自己的直连名单，未竟事项必须明列并可复制。

本文补的是：helper 的进程形状、任务书/回执协议、失败与回滚语义、库里怎么记、界面怎么消费。

## 1 helper 进程形状

| 项 | 决定 | 理由 |
|---|---|---|
| 位置 | 新 workspace 成员 `src-tauri/netguard-core/`，`[[bin]] name = "desko-netguard"` | 与 `fileshare-core`→`desko-fileshare` 同形，`tauri.conf.json` 的 `externalBin` 已有用法可抄 |
| 生命周期 | **一次性**：读任务书 → 落盘 → 写回执 → 退出 | 常驻服务在 Q1 已被否 |
| 提权方式 | 主进程 `ShellExecuteExW{ lpVerb="runas", lpFile=helper, lpParameters=任务书路径 }`，带 `SEE_MASK_NOCLOSEPROCESS` 拿 `hProcess`，`WaitForSingleObject` 等退出 | 唯一能从普通权限进程拉起提权进程又不留控制台窗口的常规路径；`SEE_MASK_NOCLOSEPROCESS` 是拿到等待句柄的前提 |
| 不提权时的 manifest | **不嵌 `requireAdministrator` manifest** | `runas` 动词本身就强制弹 UAC，嵌 manifest 要引入 `rc.exe`/`mt.exe` 构建期依赖，是纯风险无收益。manifest 留作后续可选项 |
| 需要的 windows feature | 主进程补 `Win32_UI_Shell`（`ShellExecuteExW`）；`Win32_System_Threading`（`WaitForSingleObject`）、`Win32_Foundation` 已在 | 见 `Cargo.toml` 末段 |
| stdio | 不接。所有通信走文件 | 提权进程不继承父 stdio，这是协议必须是文件形态的根因，不是偷懒 |
| 取消 UAC | `ShellExecuteExW` 返回 `ERROR_CANCELLED(1223)` → 记 `cancelled`，**不算失败**，不动清单、不清批次 | 用户有权不改系统，界面不该给他一条红字 |

## 2 任务书 / 回执协议

三个文件都放 app data 目录（与 `fileshare` 的 `config.json` 同目录），普通权限可读、提权进程可写：

- `netguard-task-<batchId>.json` —— 主进程写，helper 读
- `netguard-receipt-<batchId>.json` —— helper 写（先 `.tmp` 再改名，主进程永远读不到半成品）
- `netguard-rollback-<batchId>.json` —— helper 写，存撤销本批所需的原状态

`batchId` = uuid v4，同时是进度与撤销的关联键。

### 任务书

```jsonc
{
  "batchId": "…",
  "createdAt": 1760000000000,
  "hostsPath": "C:\\Windows\\System32\\drivers\\etc\\hosts",
  "items": [
    { "id": "条目 id", "op": "pin",      "host": "xtbg.xylink.com", "address": "172.30.2.109" },
    { "id": "条目 id", "op": "route",    "prefix": "172.33.0.0", "mask": "255.255.0.0",
      "gateway": "26.0.48.1", "interfaceIndex": 42, "interfaceAlias": "vEthernet (TUN)" }
  ]
}
```

`op` 只有两值：`pin`（写 hosts 托管区）与 `route`（加持久路由）。一条 `needRoute` 的域名是两个 op 各一条（hosts 固定 + 路由），一条 `cidr/ip` 只有 `route`。

### 回执

```jsonc
{
  "batchId": "…", "startedAt": …, "finishedAt": …,
  "hostsBackup": "…netguard-hosts-backup-<batchId>",   // 整文件字节备份，落 app data
  "items": [ { "id": "…", "op": "pin", "ok": true, "changed": true, "error": "" } ],
  "rolledBack": false, "rollbackError": ""
}
```

`changed: false` = 系统里本来就是对的，跳过（幂等靠它，重复点「写入」不该报错）。

### 无回执

helper 非零退出或超时（`APPLY_BUDGET = 90s`）却没留下回执 → 主进程合成一条 `error: "提权进程未回传结果"`，并按 §4 的即时校验重读系统状态判实际后果。**不猜成功**。

## 3 helper 内部执行序

1. 读任务书 → 读 hosts 全文 → 解析托管区（复用 01 的标记规则：嵌套/不配对即错，不猜）。
2. **整文件字节备份**到 app data（提权进程写、普通进程读，故必须放 app data 而非 `System32`）。
3. 生成新区块：区内既有条目原样保留，按 `host` 覆盖或追加本批的 `pin`；块外字节不动。
4. 写临时文件 → `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` 原子替换。
5. 逐条 `route`：`GetIpForwardTable2` 查既有 → 命中且网关/接口一致则 `changed:false` 跳过；命中不一致 `SetIpForwardEntry2`；不命中 `CreateIpForwardEntry2`。**随后**用 `route.exe -p add` 落持久化（API 建的路由重启即失，`-p` 才进注册表 `PersistentRoutes`）。
   - 只认 `route.exe` 退出码，不解析它的输出（本机代码页 936，中文输出解析是坑）。
   - 网关落段校验在**主进程**先做（早失败早报错），helper 里再断言一次（它是最后一道闸）。
6. `ipconfig /flushdns`（`DnsFlushResolverCache` 在 windows 0.61.3 里不存在，01 §3 实测已记）。
7. **即时校验**：重读 hosts 确认托管区含本批每条 `pin`；重查路由表确认每条 `route` 在位。网络级通不通不在这里判（见 §4）。
8. 任一即时校验失败 → 回滚**整批**（hosts 还原备份 + 删掉本批刚加的持久路由），回执 `rolledBack: true`。半批状态最难向用户解释。
9. 写回执（`.tmp` → 改名）。

## 4 复验与状态机

两级校验，各管各的：

- **helper 即时校验**：只回答"写进去没有"（文件/路由表里在不在）。
- **落盘后复验**：批次落定后由页面对本批逐条跑一次既有 `bypass_recheck`（静默进行，不再另念一句「重验完成」压掉落盘的账），回答"判定变了没有"。判定脱离 `hostsOnly/needRoute` → `applied`；仍判要写 → `failed`，原因留在行上看。撤销那一批以后同样重探——退回原样却还挂着「已写入」是半句假话。

库里 `bypass_targets` 新增两列（`schema.rs` 走 `pragma_table_info` 守卫迁移）：

| 列 | 值 | 含义 |
|---|---|---|
| `apply_state` | `none` / `applied` / `failed` | 本条最近一次落盘结果 |
| `apply_batch` | batchId 或空 | 撤销时找回对应的 rollback 文件 |

**「待写入」的定义随之收窄**：`verdict ∈ {hostsOnly, needRoute}` **且** `apply_state ≠ 'applied'`。否则写过的条目会永远挂在待写入里，那个数字就废了。

CDN 轮换（`cdnLike`）的条目默认不进批次（01 §4：钉死等于锁在会失效的节点上）：确认弹窗里它单独占一行，写明原因，右边给一个「仍要固定」勾选位——勾上才把这条的 id 交回 `bypass_plan` / `bypass_apply` 的 `allowCdn`，账由后端重算，界面不自己加减。

## 5 界面消费

- 页栏在「开始探测」右边加一颗 `.btn-secondary`「写入落盘批次 N」，`N = 待写入里真能自动定的那部分`（`needs_apply` 且非 CDN 默认态）；`待写入 K 条` 仍按 `needs_apply` 计，两个数天生可以不等。`K = 0` 时这颗钮不出。
- 点开确认弹窗（全站弹窗壳）：逐条列"要动什么"——`xtbg.example.com → hosts 固定 172.30.2.109` / `172.33.0.0/16 → 持久路由 绑 26.0.48.1（接口 vEthernet (TUN)）`；定不出出口或带 CDN 特征的那几行改念原因并计入头栏「M 条不写入」；底栏一句"需要管理员权限，将弹出一次系统确认"，主钮「确认并写入」，`ready = 0` 时按不动。
- 写入中：那颗钮改念「等待授权」并禁探测、禁页栏另一个动作——helper 起来到用户答完 UAC 之间没有进度可报，只能明说在等。
- 结果：一只结果弹窗（成功 X · 跳过 Y · 失败 Z + 每条原因，按落盘动作计，一条域名可能两行）。「撤销本批」只在**批次还留着**时给：helper 半批失败会自己回滚，回滚干净了系统就是没写过的样子，那时逐条账改念「已回滚」，既不留「已写入」也不留撤销的余地；只有回滚自己没成（回执带 `rollbackError`）才把批次留着，弹窗明说「回滚未完成，已写入的部分仍在系统里」，逐条账保持「已写入」，界面才给这只钮。全成功则只 toast，不拦人。
- 单位：页栏「写入落盘批次 N」、小账「待写入 K 条」、确认弹窗「本批写入 N 项」与收尾 toast 都按清单条目计；只有结果弹窗的逐条账按落盘动作计，因为它逐条念的就是往系统里动的每一笔。
- 行上：`apply_state` 出成 chip 后的小字（`已写入` / `写入失败`），`cdnLike` 出成「CDN 轮换」小字——现在它只在弹窗里露一次，行上看不到，等于没探。
- `⋯` 菜单加两项：「撤销上次写入」（有 rollback 点时）、「复制待写入清单」（把 pending 的域名/网段连行复制，供粘进接管方直连名单——01 §3 的未竟事项）。

## 6 同批附带（01 §4 欠的三条）

1. **全量重验** `bypass_recheck_all`：页栏入口，逐条串行复用 `bypass_recheck`，带进度与停止。出口漂移（`ifIndex` 变了）在单条重探里就是 verdict 变化，全量重验才有意义。
2. 行上 `cdnLike` 标记（见 §5）。
3. `⋯`「复制待写入清单」（见 §5）。

## 7 风险与未验

- **重启后持久路由是否真在**：01 §实测 末尾列为未验，本文用 `route -p add` 承接，必须真机重启验一次，不能只信退出码。
- **NSIS 装好后 `runas` 能否正常弹并回传回执**：`binaries/desko-fileshare` 是同路径先例，但它是普通权限启动，提权路径未跑过。装完在本机跑一次真实批次才算过。
- **接口号漂移**：隧道重连后 `ifIndex` 变，rollback 文件里记的接口可能已不是那块卡。撤销按"删该前缀的持久路由"实现，不按接口删，避开这个坑。
- 主进程与 helper 对托管区块的解析规则必须逐字同形，否则一边认的块另一边不认。故解析函数放 `netguard-core`，主进程 `use` 它，不各写一份。

## 8 分期

- **P2-a**：`netguard-core` crate（协议 + 解析 + 落盘 + 回滚）＋ 单测；主进程 launch/wait/回执解析；`apply_state`/`apply_batch` 迁移。到这一步命令行可跑通。
- **P2-b**：`bypass_apply` / `bypass_revert` 命令 + 确认弹窗 + 进度 + 结果弹窗 + 撤销。
- **P2-c**：§6 三条 + mock/e2e/截图同步。
