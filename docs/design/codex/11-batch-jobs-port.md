# Codex 批量作业（11 设计稿 · 2026-10-12 · 已拍板）

配套 `08-token-stats-and-entry-audit.md` §4 F1 与 `06-port-gap-audit.md` §5 T2。用户 2026-10-12「按照你推荐的来」把这一档排在 A2 图、账号回收站之后（08 §5.3 同日点头）。

**同日三项拍板**：① 导入会话的明文盘快照**全停**（推荐项）；② 批量删除**全量走作业面、单通道**（推荐项）；③ 导入 tab 的两段式预览**不做，保留今天的一把梭**（**这条不是推荐项**，见 §3.2）。③ 直接把本轮从 11 条砍成 **6 条**：导入那一族没有界面可挂，继续在册零入口。

## 1. 一句话方案

账号页的批量删除今天是一把 `delete_codex_accounts`：删 200 条要占住 UI 几十秒、中途失败无明细。改成有 jobId 的作业面（进度 / 暂停 / 续跑 / 重试失败），六条命令**全在册、全编译得动**，纯动前端；Rust 侧只做一个防御性收口——**把导入会话的明文凭据盘快照停掉**（§3）。在册 75 不动。

## 2. 现状核验（逐行读 desko 自己的代码，`file:line` 均可复查）

| 事实 | 位置 | 含义 |
|---|---|---|
| 11 条全部已注册 | `src-tauri/src/main.rs:385-390`（delete 6）+ `396-400`（import 5） | 三相等 75 = 75 = 75 **今天就把它们算在内**；本轮不新增、不摘册，在册数不动 |
| 命令体全在，非桩 | `commands/codex_account_commands.rs:1224-1259`（delete 6 条 `#[tauri::command]`）、`:1402-1438`（import 5 条） | 与 06 的「半成品」判定同一形状：写侧到位、读侧为零 |
| 前端零入口 | `grep -rn "batch_delete\|batch_import\|batchImport" src/` 无命中（`batch_delete_entries` 是收藏模块同名不同物） | 11 条可达面今天纯粹白送 |
| **每条批量删除都会留底** | 作业循环 `:332-337` 调 `codex_account::remove_account(id)`；`:588-590` 单条转 `remove_accounts(&[id])`；`modules/codex_account_lifecycle.rs:613-619` 先 `archive_codex_account(&account)?` 再写 tombstone | 上一轮（10 号稿）做的账号回收站**自动覆盖批量删除**，一行新代码都不用写。删 N 条 = 回收站里 N 份加密留底 |
| 删除作业状态双份 | 内存 `CODEX_BATCH_DELETE_JOBS`（`:10-11`）+ 盘 `<data dir>/codex_batch_delete_jobs/<jobId>.json`（`:8,120-124,165-200`） | 快照内容只有 accountId 与错误串（`:100-114`），**不含凭据**，原样留 |
| 导入作业状态双份 | 内存 `CODEX_BATCH_IMPORT_SESSIONS`（`modules/codex_account_provider.rs:36-38`）+ 盘 `<data dir>/codex_batch_import_sessions/<id>.json`（`modules/codex_account_import.rs:2039-2042,2098-2125`） | 快照含**未加密凭据**，见 §3.1 |
| 上游的 API 服务池清理在 desko 是死码 | `run_account_pool_cleanup_best_effort`（`:270`）零调用；`api_service_cleaned`（`:111,406,488`）只写不读；`modules/codex_local_access.rs:231` `remove_deleted_accounts_from_local_access_pool()` 直接 `Ok(())`、`:85` `collection_contains_account()` 恒 `false` | 上游在作业收尾时要把删掉的号从本地网关账号池摘走（`be24ce6` 同件 `:302,341-344`）。desko 的 `codex_local_access` 整件是裁剪桩，**池子恒空**，所以砍掉这个调用不改变任何可达行为。`git show HEAD` 对过，不是 desko 改坏了 |
| 没有任何「列出作业/会话」命令 | 上游 `lib.rs` 与本仓 `keep_cmds.json` 的该族命令名逐字对账：import 侧 5 条、delete 侧 6 条，无 `list_*` | **jobId 只活在前端内存里**；应用重启后盘上那份快照永远读不回来（`ensure_..._loaded` `:235-248`、`:2225-2236` 只在拿着 id 时才有意义）。删除侧因此「不能跨重启续跑」是后端给定的形状，不是 desko 偷的工 |

**所以本轮的账**：六条删除命令的入口 + 一处安全收口。删除作业的价值不是「能删」（`delete_codex_accounts` 今天就能删），是**删大批量时看得见、能停、失败有名**。

## 3. 拍板结果与两处裁定

### 3.1 导入会话盘快照 → 全停（① 已拍板）

`CodexBatchImportSessionSnapshot`（`codex_account_import.rs:1997-2006`）里 `source_items[].value: serde_json::Value`（`:1964-1968`）是**解析后的原始导出 JSON**，refresh_token / id_token 逐字在内；`items[].draft: CodexBatchImportDraft`（`:1976-1990`）是 `Account(CodexAccount)` / `FullToken { tokens }` / `AccessToken { access_token }`。写盘走 `serde_json::to_string_pretty` + `fs::write`（`:2107-2114`），**不落密**——与账号档案那条路（`secure_account_storage::serialize_account_file` + `write_secret_string_atomic`，见 10 号稿 §2）正相反。

清理只有一处：`confirm` 成功收尾 `sessions.remove(id)` + `remove_codex_batch_import_session_snapshot(id)`（`:3302-3305`）。而 `cancel`（`:3107-3120`）不清反而**再写一次**；扫完不确认就关窗 → 明文永久留在数据目录，且因为 §2 末条（没有 list 命令）永远没有任何界面能把它读回来或删掉。

**执行**：`save_codex_batch_import_session_snapshot` / `_best_effort` 停成不写盘，`load_...` 恒返 `None`——会话只在进程内存里活。代价是「跨重启继续导入」实质消失，而它本来也不可能（id 不落地，重启后前端手里什么都没有，那份快照唯一的作用就是泄）。这与 10 号稿 §3.2 砍「导出留底到磁盘」是同一条原则的两侧：一条是用户选的明文口，一条是自动长的明文口。

③ 拍板后这一族不接界面，所以这条改动从「本轮功能的前置」变成**纵深防御**：命令还在册、还能被 `invoke` 到，先把最坏的副作用摘掉。delete 侧的盘快照保留原样（内容不是凭据，动它没有收益只有偏差）。

### 3.2 两段式导入预览 → 不做，保留一把梭（③ 已拍板，非推荐项）

本轮原计划把 `CodexAuthDialog.vue:180-196` 的「选文件 → 立刻全量导入」换成 预览 → 勾选 → 确认。用户裁定**保留现路径**。后果写清：

- 导入那一族 5 条（`start_codex_batch_import_from_files` `get_codex_batch_import_preview` `cancel_codex_batch_import` `resume_codex_batch_import` `confirm_codex_batch_import`）**继续零入口**，本轮不接。
- 它们因此进 #30 那批待拍板摘册账（§8）。按 R6 只改 `keep_cmds.json` 重跑流水线，不趁本轮偷偷减在册。
- desko 今天与导入有关的行为一个字不动：选文件走 `import_codex_from_files`、粘贴走 `import_codex_from_json`、导入本机走 `import_codex_from_local`。§5.2 的语义核验留着，接的那天直接可用，不必重扫。

## 4. 命令面

| 项 | 值 |
|---|---|
| 做 | `start_codex_batch_delete` `get_codex_batch_delete` `pause_codex_batch_delete` `resume_codex_batch_delete` `retry_failed_codex_batch_delete` `clear_codex_batch_delete`（6 条，名字与上游逐字一致） |
| 不做 | 导入那一族 5 条（§3.2）。本轮不新增任何命令 |
| 在册账 | **75 → 75**（不新增、不摘册） |
| 入口账 | 有入口 46 → **51**（+6，`delete_codex_accounts` 让位 −1）；零入口 29 → **24** |
| 模块侧 | 一处：§3.1 停盘。作业本体、状态机、DTO 全是现成的 |
| 前端落点 | `src/services/api/codex.ts` 补 6 个方法与 `CodexBatchDeleteJobStatus`；`src/services/codexState.ts` 补删除作业 store；新建 `CodexBatchDeleteDialog.vue`；改 `CodexModule.vue` dock |

## 5. 上游语义（删除作业，逐行核验 `commands/codex_account_commands.rs`）

DTO `CodexBatchDeleteJobStatus { jobId, status, total, completed, failed, errors[{accountId, error}] }`，`#[serde(rename_all = "camelCase")]`（`:82-98`）。`status` 是裸 `String`，取值 `running`（`:399,327,435,489`）/ `paused`（`:457`）/ `completed`（`:319`）/ `failed`（`:317`）。

- **start**（`:377-423`）：id 去空白、丢空串；**空集合直接返 `status:"completed"` 且 `jobId:""`**（`:386-393`）——前端拿着空 id 去轮询会撞上「批量删除任务不存在」，必须在发请求前挡掉。jobId = `codex-delete-{uuid}`（`:396`）。先落盘再 spawn（`:412-420`），落盘是 best-effort：注释写明 Windows 数据目录在 junction/reparse point 下可能 `ERROR_UNTRUSTED_MOUNT_POINT`，**不得阻断删除**（`:410-411`）。
- **run loop**（`:301-375`）：每轮先查 `paused`（`:308`）；`next_index >= len` 时按 `failed > 0 ? "failed" : "completed"` 收尾（`:315-320`）；每条走 `spawn_blocking(remove_account)`（`:332-337`）；成功再清唤醒任务里的账号引用，失败只 `log_warn`（`:344-354`）；**`completed` 是「已处理」计数**——失败也 +1（`:361`），`failed` 单列，`errors` 逐条攒。每条处理完落一次盘（`:373`）。
- **get**（`:261-268`）：内存没命中回落到盘快照（`:235-248`），盘也没有 → `批量删除任务不存在`（`:243`）。**这一族没有事件**，`get` 是唯一的进度来源 → 前端轮询。
- **pause**（`:449-464`）：只在 `running` 时置 `paused`；**正在跑的那一条会跑完**（loop 下一轮才看闸）。文案不得写「立即中断」。
- **resume**（`:425-447`）：`status ∈ {completed, failed, running}` 时**原样返回、不报错**（`:432-434`）；其余（即 `paused`）置 running 并重新 spawn。→ 对已结束任务是 no-op，前端不用防重复点。
- **retry_failed**（`:466-501`）：`running` 或 `errors` 空 → no-op（`:473-475`）；否则把 `account_ids` 换成失败 id 去重、`total/completed/failed/errors/next_index` **全部重置**、置 running（`:476-491`）。→ **上一轮的失败明细会被抹掉**，弹窗必须在点之前把要留的行留在前端（§6-3）。
- **clear**（`:503-509`）：摘内存 + 删盘快照，无返回值、恒 `Ok(())`。
- **没有 cancel**：删除作业只能 `pause` 之后 `clear` 放弃这个任务，**已删掉的不会回来**（它们进回收站，见 §2）。

盘快照的 id 校验：`sanitize` 只认 `[A-Za-z0-9_-]`（`:127-139`），拼路径 `format!("{id}.json")`（`:141-144`）——路径穿越不可达。加载时把 `running` 改判 `paused`（`:223-225`），崩在中间的任务重启后是「暂停」而非「假在跑」。

## 5.2 上游语义（导入会话，核验留档，本轮不接）

DTO 全 `#[serde(rename_all = "camelCase")]`，**但 `ConfirmResult.imported: Vec<CodexAccount>` 里的 `CodexAccount` 没有 `rename_all`**（`models/codex.rs:176-178`）→ 同一份响应外壳驼峰、账号体下划线。接的那天前端类型声明按这个混合形状写，别统一。

- `start(app, file_paths, check_quota)`（`:1402-1409`）→ `{ sessionId }`，后台开扫，`status:"scanning"`（`:3085`）。`get_codex_batch_import_preview`（`:1421-1426`）在扫描期间就能拿到已扫出的 items。
- `item`：`{ itemId, source, label, accountId?, email?, accountType, provider?, quotaStatus, quotaError?, status, error?, defaultSelected, selectable, existing }`（`:1899-1916`）。`status` ∈ `ready/existing/invalid/quota_failed`（`:2767-2778`）；`quotaStatus` ∈ `success/failed/skipped`；session `status` ∈ `scanning/ready/cancelled/importing`；`phase` ∈ `scanning/importing`。
- 失败四类串：`文件读取失败`（`:2886`）、`文件解析失败`（`:2864`）、`未识别账号` + `未找到有效的 Codex 账号凭据`（`:2686-2694`）、`解析失败`（`:2709,2736`）。`existing` = `load_account(&account.id).is_some()`（`:2758-2776`）。
- `resume` 只接受 cancelled，否则 `只有已取消的导入会话可以继续`（`:3116-3135`）。`confirm`（`:1428-1438`）会**消费会话**（`:3302-3305`），之后轮询即「导入会话不存在」。
- 写面：逐条 `upsert_account_with_import_hints` / `upsert_account_from_access_token_with_hints` → `save_account`（`codex_account_index.rs:989`）→ `save_account_unchecked`（`:1026-1032`）写 desko 自己的档案目录。**不写 `~/.codex`**——唯一例外 `reactivate_imported_current_if_needed`（`:1435` → `:1262-1269`）：导入的号正好是当前激活号时重写官方 speed 一处。
- 事件三条：`codex:batch-import-progress` / `-completed` / `-preview`（`:2240-2253`），扫描侧 ~250ms 节流（`:2184-2191`）。

删除这一族**没有**事件，只有轮询；这两侧形状不同是后端给定的，不是设计口味。

## 6. desko 的改写点（必须写明，不是照搬）

1. **空 id 挡在前面**：`start` 返回 `jobId === ''`（空选择被后端吞掉）时不轮询、直接收尾。
2. **轮询有闸**：只在 `status === 'running'` 轮（500ms）；`paused`/`completed`/`failed` 立刻停（停在 `paused` 上等于白问）。弹窗卸载 `clearInterval`。
3. **失败明细的邮箱要前端存**：`errors` 只带 `accountId`（`:93-98`），而成功的号已不在列表里、反查会 miss。开作业那一刻把 `id → email` 抄进 store；`retry_failed` 抹掉 `errors`（§5）之前把当前明细也留着，重试后按新 `errors` 覆盖。
4. **作业活过弹窗**：jobId 存 `codexState`（模块级，切页面不丢）。关掉弹窗作业继续跑，dock 上留一条「删除中 X/Y」重新进入。应用重启作业随进程一起没了——§2 末条已核，不假装能恢复。
5. **计数口径写进文案**：`completed` 含失败，页面上写「已处理 X / N」，不写「已删除 X 条」；失败数另起。
6. **单通道（② 已拍板）**：dock 的「删除所选」全量改走作业面，不再调 `delete_codex_accounts`。不做「小批量一把梭、超阈值才开作业」的双路。
7. **收尾调 `clear`**：`completed`/`failed` 且用户收窗时把 jobId 与盘快照一起清掉，dock 上那条入口随之消失。放弃暂停中的任务同样走 `clear`（§5：已删的不回来）。
8. 回收站那一族仍零路径入参；本轮新接的六条只收 `account_ids` / `jobId`，且 `jobId` 受 §5 的字符集校验。

## 7. UI 方案（desko 方言，不新造尺寸档）

**7.1 删除作业弹窗 `CodexBatchDeleteDialog.vue`**（按弹窗基线：壳 radius 14 / 头 44 / 底栏 46 透明 / 定高 `min(480, 84vh)`；行方言照 `ResetCreditDialog.vue:103-160` 的 `.rc-list` / `.rc-row` / `.rc-status`，不新造控件尺寸档）

- 正文首行：`已处理 X / N`，`失败 Y` 另列。
- 一条细进度条（复用切号 `.switch-line` 那档比例条方言，无动画）。
- 失败明细：行 = 邮箱（§6-3 存的）+ 错误串；`.rc-list` 自带 `max-height` + `scrollbar-gutter: stable`。
- 底栏按 `status` 换：`running` → 「暂停」；`paused` → 「继续」+「放弃任务」；`failed` → 「重试失败」+「完成」；`completed` → 「关闭」。任何状态都允许关闭 = 收窗不停作业（§6-4）。
- 「重试失败」按下会抹掉上一轮明细（§5），所以点之前先把当前列表存进 store（§6-3）。

**7.2 dock**：`已选 N 条` 那颗「删除所选」保持位置与危险档，按下出确认 → 确认回调改成 start job + 开弹窗。作业进行中 dock 追加一条入口，页条不重复挂第二颗。

**7.3 导入 tab 不动**（§3.2）。

## 8. 账目对账（跑 `.scratch/recon.mjs` 复核，不手算）

| 项 | 本轮前 | 本轮后 |
|---|---|---|
| 三相等（`main.rs` = `keep_cmds.json` = `#[tauri::command]`） | 75 = 75 = 75 | **75 = 75 = 75**（不动） |
| 有入口 / 零入口 | 46 / 29 | 51 / 24 |
| 08 §5.6 的摘册账 | 75 − 7 = 68（F3 整域再 −9 = 59） | F1 导入 5 条随 §3.2 转待摘 → **75 − 12 = 63**（F3 整域再 −9 = 54）；转零入口的 `delete_codex_accounts` 再摘 → −1 = 62 |

摘册本身仍归 #30 待拍板，本轮不顺手减。

## 9. 判据（验收口径，全程 `*@e2e.dev` mock，不碰真号）

1. `cargo test -p codex-core`：§3.1 停盘要有一条**反向**单测——跑一次 `start → preview`，断言 `codex_batch_import_sessions` 目录不存在或为空（这条比正向断言重要：它证明明文不落盘）。
2. `cargo test --bin desko gate_tests` 2/2；三相等仍 75 = 75 = 75。
3. `npx vue-tsc --noEmit` 0；`npx vitest run` 全绿，`codexState` 补：start 空选不轮询 / 只在 running 轮询、终态即停 / jobId 随弹窗关闭存活 / `clear` 后入口消失 / 失败明细邮箱取自开局快照。
4. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` 全绿。mock 侧必须让删除作业**逐条推进**（带步进延时），断言：暂停停在中间且已成功的那几条进回收站、续跑接着删、失败条目进明细并显示邮箱、重试后成功数接着走、完成收窗后 dock 入口消失、切页面回来作业还在。
5. `node scripts/codex-shots.mjs`：EXPECTED 19 → **21**（删除作业进行中 / 失败明细两帧），逐名核对「21 帧全部为本次新拍」，交付内嵌截图。
6. 真机零点击：批量删除会写 desko 自己的账号档案，10 号稿 §10.3 同一条约束。

## 10. 执行结果（2026-10-12，本轮已交付）

§9 六条逐条实测，全程 `*@e2e.dev` mock，真机零点击。

| 判据 | 实测 |
|---|---|
| 1 §3.1 反向单测 | `cargo test -p codex-core batch_import` → `modules::codex_account::desko_session_snapshot_tests::batch_import_session_never_reaches_disk` **1 passed**（181 filtered out）。断言口径：`start → preview` 之后 `codex_batch_import_sessions` 目录不存在或为空。`save_*` 停成空 `Ok(())`、`load_*` 恒 `None`（`codex_account_import.rs:2037-2042,2114-2118`，两处 desko 改动注释都在）。 |
| 2 命令闸门 | `cargo test --bin desko gate_tests` **2/2**；`.scratch/recon.mjs`：`keep_cmds` 含 codex **75** = `main.rs` 注册 **75**，本轮在册不动。 |
| 3 前端类型与单测 | `npx vue-tsc --noEmit` **0 错误**；`npx vitest run` **17 files / 224 passed**，其中 `codexState` **28** 条（本轮新增 5 条：空选择不发请求 / 只在 running 轮询且终态即停（`list_codex_accounts` 恰 3 次）/ 暂停即停轮 / 收窗不停作业、只有终态收窗才 `clear` / 失败明细邮箱取自开局快照，`retry` 抹掉 `errors` 后仍显示、抄不到退回 id）。 |
| 4 e2e | `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` **55 passed**。mock 侧删除作业按 `deleteStepMs` 逐条推进（`setTimeout` 串状态机，`paused` 当闸），新增 `Codex 批量删除作业` 5 条：轮询到终态即停 / 暂停停在中间且已成功的那几条进回收站、续跑接着删 / 失败明细带开局邮箱、重试只跑那几条、终态收窗 `clear` 恰 1 次 / 收窗不停作业 + dock 把手 + 切页面回来还在 / 放弃任务走 `clear` 且不回滚。另把原有两条批量用例改判为**单通道**：`delete_codex_accounts` 0 次、`start_codex_batch_delete` 1 次。 |
| 5 截图 | `node scripts/codex-shots.mjs` → **21 帧全部为本次新拍**（EXPECTED 19→21，新增 `codex-delete-job.png` 进行中一帧、`codex-delete-failed.png` 失败明细一帧）。首跑被长跑 e2e server 残留的 `vite-error-overlay` 吞掉解锁点击，重跑即过——不是本轮代码问题（`vue-tsc` 与逐模块 dev-server 转译均干净）。 |
| 6 真机 | 零点击，未碰 `~/.codex` 与真号。 |

**§8 的账落地核对**：三相等 75 = 75 = 75；有入口 **51** / 零入口 **24**（`delete_codex_accounts` 如 §6-6 转零入口，导入那一族 5 条如 §3.2 留在册零入口，一并进 #30 待摘）。

**没照 §7.1 抄的两处**：底栏按钮用纯文字（图标注册表里没有 pause/play/retry 三枚，硬凑会造新档），失败明细行方言就地写成 `.bd-row`（30px + `--border` 底线），与 `.rc-row` 同尺寸档而非引 `ResetCreditDialog` 的 scoped 类。
