# Codex token 用量图（09 设计稿 · 2026-10-12 · 已拍板并已交付，执行结果见 §9）

配套 `08-token-stats-and-entry-audit.md` §8。用户 2026-10-12 批复「按照你推荐的来」，推荐项是 §8.3 的 **A2：按轮聚合出图、不建表**。本文把 A2 落到可执行的粒度，拍板后才动代码。

## 1. 一句话方案

新增一档「用量」：把官方 rollout 里**每条会话的累计 token 快照做差分**，按本地日与模型聚合成柱状与条列。零新表、零落盘、零新依赖；在册命令 +1（用的是上游同名命令）。

## 2. 数据源核验（本机只读，2026-10-12）

〔交付追记〕核验脚本原先落在 `test-results/`，那是 Playwright 的 outputDir、每跑必清，脚本已没；数字是当天实测留档，长期重跑的对账脚本挪在 `.scratch/recon.mjs`（同样不入库）。方法学坑见 08 §3 三次修正。

73 个 rollout / 965 MB，全量逐行扫 **1.68 s**（Node 无优化）。三个候选源对账结果：

| 候选源 | 出现量 | 与「会话累计总量」的关系 | 结论 |
|---|---|---|---|
| `event_msg/token_count` → `info.total_token_usage`（累计快照） | 15 974 条，全部带 `timestamp`；其中一部分 `info: null`（只带额度快照，须跳过） | 单调不减（73/73 无回落），**取相邻快照之差即为该轮用量，求和天然等于最后的累计值** | **采用** |
| `token_usage_record`（每轮一条，带 usage 六键） | 15 732 条 | 逐条求和 56/73 精确相等，17/73 **偏大 ≤2%**（同一 thread、无累计回落、ordinal 单调，无重复记录可指认） | 不采用：与列表已显示的数不同账 |
| `token_count` → `info.last_token_usage`（每轮值） | 15 978 处 | 逐条求和 43/73 相等，整体**偏小 17.5%** | 不采用：同上 |

model 字段位置（25 个文件抽样）：`session_meta.payload.model` 25/25 命中、`turn_context.payload.model` 246 处（含 `gpt-5.6-sol` / `gpt-5.6-luna` 两档）；`thread_settings_applied` 不带 model。→ 按上游同法跟踪「当前 model」：见到 session_meta / turn_context 就更新，之后的 token_count 归属它。

上游对照（`be24ce6:src-tauri/src/modules/codex_session_usage.rs`，1 965 行）：它也是**累计快照差分**为主、缺 `last` 时回退高水位差（该件第 4 行注释），并把结果落进 `session_usage_events` sqlite 三表。desko 只借它的差分口径，不借它的存储——所以不接 `codex_sync_session_usage`，不建表，不落盘。

## 3. 命令面

| 项 | 值 |
|---|---|
| 命令名 | `codex_query_session_usage`（**与上游同名**，在册账按名字对） |
| 在册账 | 70 → **71**；三相等 `main.rs` = `keep_cmds.json` = `#[tauri::command]` = 71 |
| 未入册账 | 189 → 188（§8.3 那条「A2 在册 70 不变」被本方案替换，理由见下） |
| 入参 | `{ fromTimestamp?: number, toTimestamp?: number }`（epoch 秒，闭开区间；上游的 `instanceId` 不收，desko 单实例） |
| 不做 | `codex_sync_session_usage`（要表）、`estimatedCostUsd`（定价函数在明确不做的 `codex_local_access_*` 域）、`byInstance` |

**为什么不改现有那条 stats 命令**：`codex_get_session_token_stats_across_instances` 返回 `Vec<CodexSessionTokenStats>`，S1.5 的前端、单测、mock、e2e 全按这个形状验收过。往里塞按天/按模型分桶必须把返回改成对象，等于砸一条已交付路径换一个命令名——不值。新开一条上游同名的命令，册上多一行、账更干净。

## 4. 后端设计（`src-tauri/codex-core`）

新 DTO（全部 `#[serde(rename_all = "camelCase")]`）：

```
CodexSessionUsageReport {
  totals: CodexUsageTotals {
    inputTokens, cachedInputTokens, cacheWriteInputTokens,
    outputTokens, reasoningOutputTokens, totalTokens,   // 六键与 §2 of 08 同源
    requestCount,     // 参与统计的 token_count 快照条数
    sessionCount,     // 有非零用量的会话数
    fileCount,        // 实际读取的 rollout 数
  },
  byDay:   Vec<CodexUsageBucket>,   // key = "2026-10-12"（本地日）
  byModel: Vec<CodexUsageBucket>,   // key = model 名，label 同名
  fromTimestamp, toTimestamp,       // 回显生效窗口
  scanMillis,                       // 本轮扫描耗时，前端如实显示
}
CodexUsageBucket { key, label, inputTokens, cachedInputTokens, outputTokens, totalTokens, requestCount }
```

算法（`codex_session_manager.rs` 追加一段，只读）：

1. `collect_instances()`（既有单实例改写点）→ `load_thread_snapshots()` 拿全部会话与其 rollout 路径；不传会话列表就不依赖 `session_index`，直接枚举 `SESSION_DIRS` 下的 `*.jsonl`，与 `list_sessions` 取同一目录集。
2. 逐文件流式读（`BufReader`，64 KB 缓冲，**不整文件进内存**；965 MB 是 73 个文件之和，不是单文件）。
3. 文件内顺序扫行：`session_meta` / `turn_context` 更新 `current_model`；`event_msg/token_count` 且 `info.total_token_usage` 存在时，取 `delta = saturating_sub(本次累计, 上次累计)` 六键，按 `timestamp` 的**本地日**（`chrono::Local`）归桶，同时归进 `current_model` 桶，`requestCount += 1`。累计回落（换 thread / 压缩）时 delta 自然钳 0，不出现负柱。
4. 窗口过滤在归桶处做（`from <= ts < to`），不改差分——差分必须从头算，否则首个快照的增量丢失。
5. 缓存：`USAGE_SCAN_CACHE: HashMap<PathBuf, UsageFileCacheEntry { file_len, modified_at, events: Vec<UsageEvent> }>`，命中即回放事件、不重读文件；与既有 `TOKEN_STATS_CACHE` 同一对 `(len, mtime)` 判据，两个缓存互不失效。首次全量约 1.2 s（Rust 顺序读，Node 实测 1.68 s 上界），此后仅变化的文件重扫。
6. `spawn_blocking` 包裹（与 §7 的 7 条命令同法）。

内联单测（`temp_dir` 造 rollout，全 mock 数据）：
- `day_buckets_sum_back_to_final_cumulative`：三条快照（含一条 `info: null`、一条数值不变）→ 断言 `byDay` 各桶六键之和 == 最后累计，且 `totalTokens` 与 S1.5 列表口径一致。
- `model_switch_follows_turn_context`：session_meta 给 A 模型、中途 turn_context 给 B 模型 → 两段增量分别落 A/B 桶。
- `cumulative_drop_clamps_to_zero`：累计回落不产生负数、不丢后续增量。
- `window_filter_keeps_delta_chain`：窗口从第二天开始，首桶仍拿到当天真实增量。

## 5. 前端设计

| 项 | 落点与做法 |
|---|---|
| 入口 | `CodexModule.vue:343` 的 `.cx-tabs` 加第四档「用量」（accounts / sessions / trash / usage），面板 `v-if` 挂载同前三档 |
| 组件 | 新建 `src/components/codex/CodexUsagePanel.vue`（不塞进 `CodexSessionsPanel.vue`，那件已 300+ 行且是列表语义） |
| 状态 | `codexState.ts` 加 `usageReport` / `usageLoading` / `usageError` + `loadUsage(range)`；进「用量」档才请求，切窗口重算走缓存命中即秒回 |
| 窗口 | `.seg` 三档：近 7 天 / 近 30 天 / 全部（默认 30）；切档只换 `fromTimestamp`，不重扫磁盘（缓存回放） |
| 图 | 自绘 div 柱状，**不进图表库**（`package.json` 依赖不涨）。每天一根柱，柱高按 `totalTokens`；柱内两段：下段净输入（`input - cached`）、上段缓存命中，输出与推理进 `title` 悬停明细。理由：缓存占 input 九成以上，单段柱会把真实账单量级压成一条线 |
| 顶栏 | `.page-bar` 一行总量：总 token、净输入、缓存、输出、推理、轮次、会话数；末尾如实标「扫描 N 个文件 · X ms」 |
| 按模型 | 横向条列（`.rcard-list` 同族细线分行，禁卡中卡），每行 模型名 + 总量 + 占比 |
| 空态 | 无 session 或窗口内无数据 → `.page-note` 一句实话：「这个窗口里没有 token 记录」；不得画一根 0 高的假柱 |
| 口径脚注 | 面板底部一句：「按天数字来自官方会话文件里的逐轮累计快照差值，与「会话」档每条会话的合计同源；会话一经移出官方目录，图上那天也随之减少。」 |
| 动画 | 无入场动画；柱状不做逐根生长 |
| 深色可读 | 柱底 `--fill`、净输入 accent、缓存 `--hover-chrome`，小字 ≥5.8:1；两套主题各出一帧 |

## 6. 验收判据

1. `cargo check --bin desko` 0 error；`cargo test --bin desko gate_tests` 2/2；`cargo test -p codex-core codex_session` 现有 13 条 + 新增 4 条全绿。
2. 三相等 **71 = 71 = 71**（`main.rs` 注册 / `keep_cmds.json` / `#[tauri::command]`），`slice_report.json` 同步。
3. `npx vue-tsc --noEmit` 0；`npx vitest run` 全绿且新增 `loadUsage` 用例（首次进档请求一次、切窗口不再打网络、失败落 `usageError` 且不吞已显示的数）。
4. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` 全绿：mock 补 `codex_query_session_usage`，断言①按天柱数与种子日期一致且比例正确；②总量行六个数与种子差分之和一致；③切窗口只重算不重扫；④读失败出错误块与重试；⑤空窗口说「没有 token 记录」而不是 0 柱。**全量 e2e 相对基线（232 passed / 2 failed）零新增红**。
5. `node scripts/codex-shots.mjs`：EXPECTED 16 → **18**（`codex-usage-chart`、`codex-usage-empty`），跑完逐名核对「18 帧全部为本次新拍」，交付内嵌截图。
6. 全程只跑 `*@e2e.dev` mock，真机不碰（只读扫描不改变文件，但按既有约束一律不在真号上验功能）。

## 7. 明确不做

- `session_usage` 三表与 `codex_sync_session_usage`（B 路）：只有当要「会话删了图还在」的历史留存时才开，且要自带模型定价表。
- 成本 USD 列：定价函数住在 desko 不带的 `codex_local_access_*`（49 条）域。
- 跨实例/多实例维度、`byInstance`。
- 5 小时额度曲线（`token_count.rate_limits` 的 `used_percent` / `resets_at` 离线可读）：技术上可行，是否做等点头。

## 8. 点头结果（2026-10-12，用户回「按照你推荐的来」）

1. 图形态：**净输入 / 缓存两段柱**（推荐，理由见 §5「图」行）——已点头，按此落地。
2. 默认窗口：**近 30 天**（7 / 30 / 全部三档都在）——已点头，`usageRange` 默认 `'month'`。
3. §7 末条的**额度历史曲线**——**本轮不做**（用户批复里只放行前两项）。

## 9. 执行结果（2026-10-12）

后端（`cargo test -p codex-core codex_session` **17/17**、`cargo test --bin desko gate_tests` **2/2**、三相等 **71 = 71 = 71**）：

- `codex_session_manager.rs` 2241 → **2820 行**。按 §4 落地：`query_session_usage` → `scan_usage_events` → `usage_delta`（`saturating_sub`）→ `accumulate_usage_entry` / `add_to_bucket`，本地日用 `chrono::Local`，缓存 `USAGE_SCAN_CACHE: LazyLock<Mutex<HashMap<PathBuf, UsageFileEntry>>>` 判据仍是 `(len, mtime)`。与 §4 的两处出入：`BufReader` 缓冲取 **256 KB**（`USAGE_READ_CHUNK_BYTES`，64 KB 那档在本机 900 MB 量级上明显吃亏）；model 拿不到时不丢事件，归进 `UNKNOWN_MODEL_LABEL`「未标注模型」桶——否则总量行的六键与按模型条列之和对不上。
- 四个内联单测按 §4 的语义写，名字加了 `usage_` 前缀（`usage_day_buckets_sum_back_to_final_cumulative` / `usage_model_follows_turn_context_and_splits_buckets` / `usage_cumulative_drop_clamps_to_zero` / `usage_window_filters_events_not_the_delta_chain`）。
- `codex_session_commands.rs` 115 → **129 行**，`codex_query_session_usage` 一条走 `spawn_blocking`；`keep_cmds.json` +1、`main.rs` 注册 +1。

前端（`vue-tsc --noEmit` 0、`vitest run` **216/216**，其中 `codexState` 20 条含新增 4 条）：

- `services/api/codex.ts` 补 `CodexUsageBucket` / `CodexUsageTotals` / `CodexSessionUsageReport` + `querySessionUsage()`。键位账踩过一次：`scanMillis` 在 **report 顶层**、不在 `totals` 里，面板照 §4 的形状写在 `totals` 上直接 TS2339。
- `codexState.ts` 418–463 行：`usageRange`（默认 `'month'`）/ `usageReport` / `usageBusy` / `usageError` + `usageWindowFrom()`（本地零点回推 N 天，`'all'` 传 `null`）+ `loadUsage()` + `setUsageRange()` + `invalidateUsage()`。与 §5 的出入：**切窗口仍打一次命令**（缓存命中即秒回，但差分与归桶在 Rust 侧按窗口重算，不是「纯缓存回放」）；状态位叫 `usageBusy` 不叫 `usageLoading`；`loadUsage()` 不带参，窗口从 store 读。
- 作废钩子按「图上画的是官方目录现存的会话」这条口径收：`moveSessionToTrash`、`restoreTrashedSession` 成功后置空 `usageReport`；**彻底删除与清空回收站不作废**（那些会话本来就不在官方目录，重扫一遍数不变）。
- `CodexUsagePanel.vue` 新建 **325 行**：总量行（`.usg-num` + 5 枚 `.usg-chip`）→ 按天柱（`.usg-bars` 带 `data-days` / `data-max`，一天一根 `.usg-col`，`.usg-fresh` 在下 `.usg-cached` 在上）→ 按模型条列（`.usg-model-row` + `.usg-track/.usg-fill`）→ `.page-note` 口径脚注。与 §5 的四处出入：
  1. **柱高按 `inputTokens` 不按 `totalTokens`**——柱里只画净输入与缓存两段，都是输入的组成部分；按 total 缩放会让两段之和永远够不到柱顶，读者按不上比例。输出留在 `title` 与总量行。
  2. **累计曲线没做**（§5「图」行原本列了它）。按天柱 + 按模型条已够回答「哪天、哪个模型吃掉配额」，曲线要在柱上再叠一层归一化坐标，等真机看过图再定。
  3. 窗口三档不放子组件的 `.seg`，而是复用父组件 `CodexModule.vue` 的 `.page-bar` 里一条 `.cx-tabs`：`.cx-tab` 的样式 scoped 在 `CodexModule.vue`，跨不进子组件（仓库既有「壳类跨不进子组件」那条坑）。同档重复点为 no-op，不打网络。
  4. 首扫那 1.7 s **没有「先出 A1 的总量条再叠图」**，而是一行 `.usg-wait`「正在读官方会话目录…」——A1 那份数要另一次 `sessionIds` 全量请求才拿得到，为一句等待文案加一趟往返不值。
  5. 千分位自己插（`String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')`），不用 `toLocaleString`——后者跟运行时 locale 换分隔符，e2e 断言与真机就会不一致。百分比 `pct()` 收一位小数，柱宽与旁边那个数必须同一个值；单段最小 2% 高，避免「有数却看不见」。
- `CodexModule.vue`：第四档「用量」夹在会话与回收站之间；`.titlebar-count` 显示「N 轮」（§5 原写「近 30 天 · N 条会话」，窗口名已在页条上，条数已在按模型行里，页头只留轮次这一个数）；页条右侧 `.cx-refresh`「重新统计」。

mock 与出图（全程 `*@e2e.dev`，未碰真号；只读扫描也不动 `~/.codex`）：

- `e2e/mocks/backend.ts` 加 `codex_query_session_usage` 处理器与三个旋钮（`usageFail` / `usageScanMillis` / 种子里的 `model` `turns`）。关键做法：处理器读的是**回收站命令同一份内存 `state.codex.sessions`**，所以「移到回收站 → 图上那天跟着少一笔」在 mock 里天然成立，不用第二份账。
- `e2e/specs/codex.spec.ts` 783 → **939 行**，新增「Codex 用量图」7 条：总量行六键与种子差分之和一致、柱数与 `data-max`、两段高度比（11.1% / 88.9% 与最小 2% 那档）、按模型条列占比与条宽同源、切窗口只重算（同档不重发）、读失败出错误块 + 重试、空窗口说「这个窗口里没有 token 记录」而不是 0 根柱、移动一条到回收站后当天与页头轮次同时少一笔且只重扫一次、彻底删除与清空不重扫。
- `scripts/codex-shots.mjs` EXPECTED 16 → **18**：`codex-usage-chart.png`、`codex-usage-empty.png`，跑完逐名核对「18 帧全部为本次新拍」。

判据合计：`codex.spec.ts` **43/43**（含新增 7 条用量图），全量 e2e **240 passed / 2 failed / 1 flaky**——两条 failed 仍是 `notes.spec.ts:644`、`:654`「插入芯片」HEAD 即红的存量，flaky 是 `settings.spec.ts:220` 重跑即过，与本轮无关。相对 §7.5 那次的 232 passed，涨的 8 条里 7 条是本轮新增，另 1 条来自并行会话在 tunnel/bypass 两条 spec 里补的用例（本工作树多会话共改，总数不是本轮单独可归因的账）。

未做：真机那一次首扫（读 `~/.codex` 全量 rollout，900 MB 量级）等用户自己进「用量」档看，图对不对由眼睛判。
