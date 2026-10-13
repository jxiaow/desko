# Codex 会话列表与 token 统计（S1 设计稿 · 待拍板 2026-10-11）

配套 `06-port-gap-audit.md` §4.1 的 S1 档。T1（五项前端欠账）与 R1（配额自动刷新）已于本日交付，本文是「全都做」的第三档，**拍板后才动 Rust**。

一句话方案：**只读**地把官方 `~/.codex` 里的会话列表与每会话 token 累计量搬进 desko，命令面 +2（在册 61 → 63），Rust 侧一份 1094 行只读切片（含 5 条读侧内联测试）+ 一个 570 行逐字节 keeper，前端在 Codex 页加第二档「会话」（不新增模块、不加开关）。

## 1. 范围

| 在 S1 内 | 明确不在（附去处） |
|---|---|
| 会话列表（`sessions/` + `archived_sessions/` 全量）| 回收站移入/恢复/彻底删除/清空 → S2 |
| 每会话 token 累计量（读 rollout 即时算）| `session_usage` 三表增量同步与报表 → S3 |
| 按标题搜索（`title_query`）| 导入导出 zip、跨实例同步、打开会话位置 → S4，建议不做 |
| 就地展开看详情（完整 cwd / 会话 ID / 更新时间）| 正文搜索（`content_query`）：命令参数保留但 UI 不接，见 §8-C |
| 只读官方文件，**不写一个字节** | 会话的删除/改名/置顶等任何回写 |

## 2. 上游机制还原（本轮逐文件核验）

上游这一域的命令面在 `commands/codex_instance.rs`（3917 行，随多实例域整体裁掉），S1 只需其中两条：

```rust
// commands/codex_instance.rs:2011 / :2019
codex_list_sessions_across_instances(title_query, content_query) -> Vec<CodexSessionRecord>
codex_get_session_token_stats_across_instances(session_ids) -> Vec<CodexSessionTokenStats>
```

两条都是**同步纯文件读**（上游连 `spawn_blocking` 都没包，靠 tauri 命令线程），零网络、零凭据读取。desko 侧命令包了一层 `spawn_blocking`（见 §6.7）。

### 2.1 数据来源全在磁盘

`list_sessions_across_instances`（`codex_session_manager.rs:491`）→ `collect_instances()`（`:1574`）→ 每个实例目录读四类东西：

| 文件 | 用途 | 读法 |
|---|---|---|
| `<home>/sessions/**/rollout-*.jsonl`、`<home>/archived_sessions/**/rollout-*.jsonl` | 会话本体（`SESSION_DIRS`，`:21`；递归 `list_rollout_files` `:2156`） | 只读**首行**取 `session_meta`（`read_rollout_session_meta` `:2188`）+ 读**尾部 ≤4 MB** 取最后活动时间（`ROLLOUT_ACTIVITY_MAX_SCAN_BYTES` `:29`） |
| `<home>/session_index.jsonl` | 标题兜底与 `updated_at` | 整读一次成 map（`:2483`） |
| `<home>/sqlite/state_5.sqlite`、`<home>/sqlite/*.db\|*.sqlite` | 官方侧栏真正显示的标题与项目名 | `SQLITE_OPEN_READ_ONLY`（`codex_session_display.rs:253`），任何失败静默回退 |
| 进程表 | 「该实例的 Codex 是否在跑」 | desko 侧 `process::collect_codex_process_entries()` 返空 → 恒 `false`，语义正确 |

标题优先级：`SessionDisplayContext::resolve_title(id, index_title)` → 兜底会话 ID；项目名 `project_name_for_cwd(cwd)`（`load_thread_snapshots` `:2107`）。这正是 rev5 那套「侧栏按 `model_provider` 过滤」的同源数据，只是这里只读不修。

### 2.2 token 数是官方自己算的累计值

`read_token_stats_from_rollout`（`:357`）从文件尾部往前找**最后一条** `event_msg/payload.type == "token_count"`，取 `info.total_token_usage` 的 `input/output/total`（`parse_token_stats_lines` `:443`）。所以它是**该会话的累计用量**，不是 desko 估算，也不是单轮。缓存键 `(路径, 文件长度, mtime)`（`TOKEN_STATS_CACHE` `:33`），文件没变就不重读。UI 文案必须写「累计」，别写成「本次」。

### 2.3 上游前端的节奏（值得照抄的部分）

`CodexSessionManager.tsx`：`buildGroups()` 按 cwd 分组（`:92`），`buildDefaultExpandedGroups()` **返回空数组**（`:118`）——首屏只列项目，会话与 token 数都在展开时才取（`loadTokenStatsForGroups` `:629`，按组批量传 id，带请求版本号防串台）。这就是「几百个 rollout 也不卡」的真正原因：**不是后端快，是首屏不碰 token 统计**。

### 2.4 wire 形状

`CodexSessionRecord` / `CodexSessionTokenStats` 都带 `#[serde(rename_all = "camelCase")]`（`:39`/`:95`），前端拿到的键是 `sessionId` `title` `cwd` `projectName` `updatedAt` `locationCount` `locations[]{instanceId,instanceName,running}` `sessionKind` 与 `inputTokens` `outputTokens` `totalTokens`；`updatedAt` 是 unix **秒**。invoke 侧参数名同样是 camelCase（`titleQuery` / `sessionIds`）。

## 3. 拦路石与 desko 单实例口径

### 3.1 两处桩

```rust
// 上游 codex_session_manager.rs:1576/1577，desko 侧现状
get_default_codex_home() -> Ok(PathBuf::new())              // modules/codex_instance.rs:56
load_instance_store()    -> Err("该能力已在裁剪版中移除")      // :86
```

`load_instance_store()` 的 `Err` 会顺着 `collect_instances()?` 原样冒到前端；`get_default_codex_home()` 的**空路径更阴险**——就算补掉 store，`data_dir` 是空串，扫描会落到进程当前工作目录，产出一份看着像列表的空数据。

### 3.2 决策：不改桩，改注入点

rev5 已经趟出正确形状：`commands/codex_session_visibility_commands.rs:18` 在**命令层**取 `codex_account::get_codex_home()`（= `CODEX_HOME` 或 `~/.codex`），显式造一个 `CodexSyncInstance { id: "__default__", name: "默认实例", data_dir, last_pid: None }` 传进 `repair_session_visibility_quick_for_instance`，整条 `collect_instances()` 根本不走。S1 同形：

- **函数名不变，只换函数体**：只读切片里的 `collect_instances()` 上游在此枚举 instance store，desko 版改成官方默认目录一份 —— **这是全篇唯一一处真写 Rust**，其余全是照搬。同名同签名，月度 diff 的偏差就落在这 8 行体内。
- 桩本身不动。理由：`get_default_codex_home()`/`load_instance_store()` 另有 6 个在册调用点（`commands/codex_account_commands.rs:736/752`、`modules/backup_storage.rs:1079`、`codex_account_model_catalog.rs:1673/1674/1682`、`codex_account_model_config_transfer.rs:42/44/864/867`、`codex_account_projection.rs:1235/1244/1293/1294/1362/1363`、`codex_account_token_refresh.rs:635`）。把它们从「拿不到」翻成「拿得到」= 让账号域六条**从没真跑过的分支当场第一次真跑**，那是另一次带验收的改动，不该塞进一个只读列表里。
- 顺带核验（本轮扫过，不是推测）：`codex_account_token_refresh.rs:635` 的 `?` 之上，两个调用方 `codex_account_runtime_switch.rs:188/404` 都写作 `.map(...).unwrap_or(false)`，桩返 `Err` 只降级成「没有活着的官方运行时」，**不炸**；`commands/codex_account_commands.rs:736` 同理。桩现状是安全的，只是别顺手改。

### 3.3 命名照上游

desko 里两条命令仍叫 `codex_list_sessions_across_instances` / `codex_get_session_token_stats_across_instances`。先例：`codex_repair_session_visibility_for_launch_target`、`get_codex_history_visibility_provider` 都是照抄上游名，哪怕 desko 版只有单目标。收益是 S2/S3/S4 若落地，服务层与上游逐字可比；代价是名字里的 `across_instances` 在 desko 是恒为 1 的复数——记进 §6 差异。两个名字都含 `_codex_`/`codex_` 前缀，`main.rs:45 is_codex_command` 自动纳管（`codex_enabled` 关时后端直接拒）。

## 4. 移植清单

后端逐字节取自上游 `be24ce6`(v1.3.66)，CRLF 归一；`#[cfg(test)] mod tests` 内联块按 desko keeper 惯例**保留**（丢的只是 `include!("*_tests.rs")` 那种独立测试文件）。

| # | 文件（`src-tauri/codex-core/src/`） | 上游 | 处置 |
|---|---|---|---|
| 1 | `modules/codex_session_display.rs` | 570（`:350` 起 221 行是内联测试） | **逐字节 keeper**（只依赖 std + rusqlite，零跨模块引用，desko 依赖已齐）；内联测试自建临时 `state_5.sqlite`，是 S1 唯一能拿到的 Rust 单测 |
| 2 | `modules/codex_session_manager.rs` | 3834 → 1094 | **desko 只读切片**（非 keeper）：下表逐条照搬 + 一处同名换体（56 个顶层条项）；`:3193` 起的 642 行内联测试只筛读侧 5 条（分类 / 时间戳漂移两档 / 正文搜索两档），写侧用例随写侧代码一起不搬 |
| 3 | `modules/mod.rs` | — | 加 `pub mod codex_session_display;` `pub mod codex_session_manager;` |
| 4 | `commands/codex_session_commands.rs` | — | **desko 新增**（与 rev5 的 `codex_session_visibility_commands.rs` 同形），2 条 `#[tauri::command]`，只做转发并包 `spawn_blocking`；默认实例不在这里注入，在切片第 2 项的 `collect_instances()` 体内 |
| 5 | `commands/codex.rs` | — | `include!("codex_session_commands.rs");`（接在 `:36` 后） |

切片内容（第 2 项，逐条点名以便核验）：

- 常量与结构：`DEFAULT_INSTANCE_ID/NAME`、`SESSION_INDEX_FILE`、`SESSION_DIRS`、`SESSION_INDEX_ACTIVITY_DRIFT_SECONDS`、`TOKEN_STATS_READ_CHUNK_BYTES`、`ROLLOUT_ACTIVITY_READ_CHUNK_BYTES`、`ROLLOUT_ACTIVITY_MAX_SCAN_BYTES`、`CONTENT_SEARCH_*`、`TOKEN_STATS_CACHE`/`CONTENT_SEARCH_CACHE` + `TokenStatsCacheEntry`/`ContentSearchCacheKey`；`CodexSessionLocation`、`CodexSessionRecord`、`CodexSessionTokenStats`、`CodexSessionSearchFilter`、`CodexSyncInstance`、`ThreadSnapshot`
- 列表链：`list_sessions_across_instances`、`classify_session_kind`、`default_session_kind`、`normalize_search_query`、`normalize_content_search_query`、`matches_session_search_filter`、`text_contains_query`、`rollout_conversation_contains_query`(+`_uncached`)、`content_search_cache_key`、`raw_bytes_contains_normalized_query`、`ascii_case_insensitive_contains`、`is_instance_running`、`load_thread_snapshots`、`list_rollout_files`、`read_rollout_session_meta`、`session_meta_id`、`session_meta_cwd`、`read_session_index_map`、`session_index_title`、`parse_session_index_updated_at_seconds`、`resolve_thread_snapshot_updated_at_seconds`、`rollout_file_activity_seconds`、`parse_latest_rollout_activity_seconds`、`parse_rollout_line_timestamp_seconds`、`parse_json_timestamp_seconds`、`normalize_codex_timestamp_seconds`、`system_time_from_unix_seconds`
- 统计链：`get_session_token_stats_across_instances`、`read_token_stats_from_rollout`(+`_uncached`)、`byte_before_is_newline`、`parse_token_stats_lines`
- **同名换体**：`collect_instances()` 的体改成读 `codex_account::get_codex_home()`，`last_pid: None`，不碰 instance store；函数名与签名照上游。
- **不搬**：上表点名的读侧件之外一律不搬——trash 四操作（`:761`–`:1084`）、导出/导入与 `resolve_session_location_dir`/`resolve_session_rollout_path`（`:1084`–`:1573`、`:1601`–`:2089`）、索引回写簇（`rewrite_session_index_without_ids`、`upsert_session_index_with_entry` 等 `:2232`–`:2483` 与 `:2692` 往后）。它们会拖进 desko 侧**不存在**的 `codex_session_import_paths` 与 `codex_official_app_server::{delete_threads, rebuild_imported_thread_metadata}`（该模块在 desko 只剩 8 行、只有 `rebuild_thread_metadata` 一个桩），以及未引入的 `zip`/`sha2` 两个 crate 依赖

正文搜索簇（`rollout_conversation_contains_query` 等）**照搬但不接 UI**：`matches_session_search_filter` 直接引用它们，砍了要多改一处上游代码，diff 反而更大。

desko 侧新增（非上游文件）：

| 位置 | 内容 |
|---|---|
| `src-tauri/src/main.rs` | `generate_handler!` 注册 2 条 → 在册 **61 → 63** |
| `codex-core/keep_cmds.json` | 追加 2 个名字（`gate_tests` 要求名单⊆注册面） |
| `src-tauri/src/commands/settings.rs:14` | **不动**（拍板后无新键） |
| `e2e/mocks/backend.ts` | 两条命令 + `codex.sessions` fixture（含 `projectName`/`updatedAt` 秒/`sessionKind`/tokens） |
| `src/services/api/codex.ts` | `listSessions(titleQuery?)` / `sessionTokenStats(ids)` 两条绑定 + `CodexSessionRecord`/`CodexSessionTokenStats` 类型 |
| `src/components/codex/CodexSessionsPanel.vue` | 新组件（会话视图本体） |
| `src/components/codex/CodexModule.vue` | `.page-bar` 最左加两枚 30px 下划线 tab，`v-if` 在账号列表与会话面板之间换；标题栏面包屑的页名/条数随档切换 |

Cargo 依赖零新增：`chrono`/`rusqlite(bundled)`/`serde_json` 都在册；`zip`/`sha2` 只有写侧要，本档不引入。

## 5. 前端设计（desko 方言，不搬上游 React 面板）

上游 2829 行 React 面板不移植，只取它的**信息结构**，按 desko 的行卡骨架重做（对齐 `BypassModule.vue:512` 的 `.rcard` + `.rcard-row` 头部 + `.row-card` 就地展开，`aria-expanded` 同轨）。

### 5.1 入口与开关（已于 2026-10-11 拍板：Codex 页内第二档，不新增模块）

- **不新增 ModuleDef、不新增侧栏项、不新增路由**：会话是同一份官方数据的第二个视图。`codex_enabled` 开着就有这一档。
- **不加 `codex_sessions_enabled`**（拍板：随 `codex_enabled` 一起开）。于是 `settings.rs` 的 `ALLOWED_KEYS` 与 mock 的 `SETTINGS_ALLOWED_KEYS` 都不动，Codex 设置页签也不加开关行。后端两条命令仍由 `main.rs` 的 codex 闸门统一拒（`codex_enabled` 关 = 命令面直接不可达）。
- 切换件放 `.page-bar` 最左：两枚 30px 下划线 tab（`账号` / `会话`），配方照抄 `EntriesModule.vue:404/417` 的 `.tabs .tab`（`--text-xs`、非活动 `--text-muted`、活动 `--text` + 600 + 2px accent 下划线），**去掉 `.tab-thumb` 滑块与过渡**（常驻下划线，不做滑动动画）。scoped 在 Codex 侧自持一份，不动收藏页的分类 tab。
- 页名跟着视图走：身份行退役后由 `usePageHeadStore` 上报标题栏面包屑，在 `Codex 账号` / `Codex 会话` 之间切，条数给当前视图的量词（`N 个` / `N 条`）。两视图共用一条面包屑，但同一时刻只有一档在，不存在两个计数抢位。
- 现状核对（本轮扫过）：desko 的 `.seg` 只作为**弹窗内**的切换件（`global.css:875 .dialog .seg`），页级切换的先例是收藏页 `.page-bar` 里的 `.tabs`——所以这里复用的是 tab 档，不是 seg 档。

### 5.2 列表

- 首屏：只列**项目分组头**（`projectName` 或 cwd 末段 · 会话数 · 最近活动相对时间），全部折叠——照上游默认态。
- 展开某项目：该项目下的会话按 `updatedAt` 倒序，每行两档：
  - L1 标题（`title`，空则显示截断后的会话 ID）+ `sessionKind !== 'conversation'` 时的 `.badge`（子代理/外部）
  - L2 `上次使用 <MM-DD HH:mm>` · `累计 <in> / <out> tokens`（`formatLargeNumber` 档：`12.3K`/`1.4M`）
- token 数**只在组展开时按该组 id 批量取一次**（与上游同节奏），取回前该行 token 位显示占位灰线；失败只把该行留空 + 一次 `console.warn`，不弹 toast（列表本身已经出来了）。
- 就地展开单条会话：完整 `cwd`、完整会话 ID（`.mono`）、更新时间、`inputTokens`/`outputTokens`/`totalTokens` 三项。
- 搜索：`.page-bar` 里放全局 `.search-box`（`global.css:916`，与收藏页同档）。与收藏的本地过滤不同，这里是**后端搜索**——输入 300 ms 防抖后重打 `codex_list_sessions_across_instances`，只填 `titleQuery`；无结果走既有空态。
- 顶栏动作只留一颗「刷新」（`refresh` 图标，28px 档）。**不给**删除、打开位置、导出——那是 S2/S4。
- 无入场动画；滚动容器 `scrollbar-gutter: stable`；等宽小字吃 `--font-mono`（Consolas 档）。

### 5.3 空态与错误态

| 情况 | 文案 |
|---|---|
| `~/.codex/sessions` 不存在或零条 | 「官方 Codex 还没有会话记录」+ 一句 `page-note`：本视图只读官方目录，不写任何文件 |
| 命令报错（目录不可读等） | 整页错误块 + 「重试」，错误原文进 `title`，不静默出空列表（空列表会被读成「你没有会话」） |
| `codex_enabled` 关 | 走模块既有守卫，不发请求 |

## 6. 与上游的差异（全部显式登记）

1. `codex_session_manager.rs` 落 desko 是**只读切片**（1094/3834 行），非逐字节 keeper → 月度对账时该文件不参与「diff 为空」判定，`slice_report.json` 已记 `modules/codex_session_manager`（56 kept / `missing_seeds` 空 / 1094 行，与 `modules/account` 同规格）。
2. `collect_instances()` **同名换体**（不改成 `default_instances()`，也不删）：多实例语义在 desko 不成立（§3.2）。
3. 命令名保留 `across_instances` 复数，实际恒 1（§3.3）。
4. `locations[]` 原样返回，前端只用第一项（`running` 恒 `false`，因 `process` 桩）。不裁字段，保 wire 形状与上游可比。
5. UI 与上游 React 面板零代码重合：分组折叠、搜索、展开详情的**信息结构**一致，视觉与交互按 desko 方言重做。
6. 测试面比 rev5 好一档：`codex_session_display.rs` 的内联测试逐字节跟进来 5 条（临时目录自建 `state_5.sqlite`，不碰真实 `~/.codex`），`codex_session_manager.rs` 切片带读侧 5 条（分类 / 索引-活动漂移两档 / 正文搜索两档），合计 10 条 Rust 单测；写侧（trash/export/import）用例随代码一起不搬。上游那 1312 行 `codex_session_visibility_tests.rs` 式的独立测试 include 仍不进 desko。
7. 两条命令在 desko 侧包了 `spawn_blocking`（上游裸调命令线程）：首屏按 §8-B 是全量扫盘，重 I/O 不该压在异步命令线程上；返回值与错误语义逐字照上游。

## 7. 风险

- **首屏 I/O**：一次全扫 = 每个 rollout 读首行 + 尾部 ≤4 MB。会话数大时（几百上千条）首屏会慢。上游同样如此，且它没做上限；本轮按 §8-B 维持零偏差，真机量出来慢再另立一轮。
- **只读**：与 rev5 不同，本档**不写官方目录一个字节**，也不碰 `state_5.sqlite` 的写锁（`SQLITE_OPEN_READ_ONLY`），官方 Codex 正在跑也能列。风险面因此比 rev5 小一档。**一处例外已在真机逮到**：WAL 模式下只读打开也会重建同目录的 `-shm` 索引文件（见 §9.2），`.db` / `-wal` / rollout 正文一律不动。
- **隐私面**：列表含会话标题与工作目录全路径，都是本机已有数据；不入库、不进 desko 备份、不进截图（fixtures 一律 `*e2e.dev` / `C:\ws\demo-*`）。desko 档案目录里不落任何会话缓存（S3 才建表）。
- **上游漂移**：`state_5.sqlite` 表结构或 rollout 事件格式变了 → 展示标题与 token 数静默回退（上游设计如此），最坏是标题变成会话 ID，不会报错。

## 8. 拍板结论（2026-10-11，四项已定）

- **A′ 入口形态** → **Codex 页内第二档**。裁定口径：**codex 只能有一个模块**——会话不占侧栏位、不进 registry、不加路由。原「独立模块」方案作废；新造页级 tab 位置的代价按 §5.1 收敛成照抄收藏页 tab 档（去滑块），且不动收藏页。
- **A 独立开关** → **不加** `codex_sessions_enabled`，随 `codex_enabled` 一起开。于是 `settings.rs` 白名单、mock `SETTINGS_ALLOWED_KEYS`、Codex 设置页签开关行三处改动全部取消。
- **B 首屏全扫** → **先全扫，零偏差**。真机首屏 > 1 s 再另立一轮补日期窗裁剪（`sessions/YYYY/MM/DD` 分层，裁剪点唯一），本轮不预置条数上限。实测：本机 64 条会话全扫 **28 ms**、6 条 token 统计 24 ms（§9.2），裁剪不必做。
- **C 正文搜索** → **不接**。UI 只留标题搜索，`content_query` 原样传 `null`；将来接 S3 时一并议。

## 9. 验收计划

1. `cargo check --bin desko` 0 error；`cargo test -p desko --bin desko gate_tests` 2/2；`cargo test -p codex-core codex_session` 全绿（新进来的内联读侧用例，跑在临时目录，不碰真实 `~/.codex`）；对账三相等：`#[tauri::command]` 定义数 = `main.rs` 注册数 = `keep_cmds.json` 在册数 = **63**。
2. `npx vue-tsc --noEmit` 0；`npx vitest run` 全绿（含 `codexState.test.ts` 不回归）。
3. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts`：新增 4 条——「停在账号档时零会话命令，切到会话档才取一次，切回不重复取」「列表按项目折叠，展开才取 token 统计（断言 `codex_get_session_token_stats_across_instances` 恰 1 次且只含该组 id）」「标题搜索只打 `titleQuery` 且命令收到的是 trim 后的值，`contentQuery` 恒为 `null`」「命令报错出整页错误块而非空列表」。全量 e2e 除既有两条「插入芯片」红外 0 失败。
4. `node scripts/codex-shots.mjs` 帧数 10 → 13（`codex-sessions-collapsed` / `-expanded` / `-empty`），跑完按 `EXPECTED` 逐名核对缺帧即非零退出；fixtures 全 `*e2e.dev`。
5. 真机（唯一硬判据，需你点头才跑）：开着真实 Codex 客户端的情况下打开「会话」档，确认列表能出、标题与官方侧栏一致、展开后 token 数与官方用量同量级、`~/.codex` 目录 mtime 无变化（只读自证）。**不用真账号做任何切号/删除动作。**

### 9.1 本轮执行结果（2026-10-11）

1–4 全绿，5 未跑（等你点头）：

- 后端：`cargo check --bin desko` 0 error（只剩既有的 `codex_account_projection.rs:240 unreachable` 告警）、`gate_tests` 2/2、`cargo test -p codex-core codex_session` 10/10（切片 5 + 显示层 5，全在临时目录）、三相等 **63 = 63 = 63**。
- 前端：`vue-tsc` 0 error；`vitest` 204/204（`codexState.test.ts` 新增 3 条会话档用例：错误态复位、在途补扫、token 只补缺失）；`codex.spec.ts` 27/27（含新增 4 条）；全量 e2e 222 passed / 2 failed，两条即既有的 `notes.spec.ts:644`、`:654`「插入芯片」，与本轮无关。
- 出图：`codex-shots.mjs` 13 帧全部本次新拍，新增 `codex-sessions-collapsed` / `-expanded` / `-empty`；fixtures 仍全 `*e2e.dev`，会话 cwd 用 `C:\ws\demo-*` 假路径。

落地时相对本计划的两处收紧，都写进代码不留在口头：

- **在途补扫**：官方目录一次全扫可能几秒，扫期间改搜索词若被 `sessionsBusy` 直接吞掉，列表会停在旧词上。改成记一次 `rescanQueued`，本轮结束立刻按最新词补扫（`codexState.ts`）。
- **刷新要喂饱展开中的组**：`reloadSessions()` 清 token 缓存后自增 `sessionsEpoch`，面板据此给已展开的组重新取数，否则刷新完那些行会一直显示「token 统计未取到」。**〔2026-10-12 已被 08 §2 取代：改成进档一次全量预取，`sessionsEpoch` 随之删除，刷新清缓存后由预取直接喂饱。〕**

一处已知不改动：顶栏面包屑仍取模块名「Codex 账号」（`registry.ts:175`），页头 `<h1>` 才随档位切成「Codex 会话」。改名要连带动 `e2e/helpers.ts:93` 与 `modules.spec.ts:38` 两处标题断言，收益只是文案，留作它议。

### 9.2 真机读数结果（2026-10-12，本机 `~/.codex`）

跑法：关掉本机在跑的 `desko.exe`（连同其 `tauri dev` 进程树）→ 重新 `npm run tauri -- dev`，带 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223` → 经 CDP 在页面里 `import('/src/services/api/codex.ts')` 直调两条命令（`withGlobalTauri:false`，`window.__TAURI__` 拿不到，vite 的源码路径可以）。全程只读，未点任何写操作。

| 判据 | 结果 |
| --- | --- |
| 列表能出 | 64 条，一次全扫 28 ms；`locations[].instanceId` 全是 `__default__`、`running` 恒 `false`（§2.1 桩口径吻合） |
| 分组 | 3 档：`dev` 44 条、`xyhm` 17 条、`master` 3 条；`sessionKind` 全 `conversation` |
| token 同量级 | 单条最大 `input 147,584,066 / output 743,897`，与官方长会话的累计口径一致；6 条统计 24 ms |
| 只读自证 | 2289 个文件逐条比 `路径\|尺寸\|mtime`：**尺寸零变化**；只有 `state_5.sqlite-shm` 与 `sqlite/codex-dev.db-shm` 两个 WAL 索引的 mtime 动了。静置 12 s 无变化、再跑一轮全扫 + 统计也零变化 → 判定为只读连接**首次**打开时 SQLite 重建 `-shm` 索引（WAL 模式只读也需写 `-shm`，否则 `SQLITE_READONLY_CANTINIT`），`.db` 与 `-wal` 本体未被触碰。§7 那条「不写一个字节」据此改成上表的准确口径 |

真机逮出的一处前端缺陷（已修）：后端无标题时把**整条 UUID 原样填进 `title`**（64 条里 16 条如此），面板原本只在 `title` 为空串时才缩短，真机上这 16 行会摆满 36 字符。改为 `title === sessionId` 同样按无标题处理，行上出 `01a12582…`，完整 ID 留在悬停与详情。e2e fixture 里那条原本虚构的 `title: ''` 也换成真机形状，钉住这个行为。

**仍缺的一步**：会话档在真机上的那一帧截图——应用锁页需要主口令，这一步只能你解锁后代跑（或你自己看一眼）。数据面与只读面已由上表闭环。
