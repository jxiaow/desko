# Codex token 统计补全与零入口面清账（08 设计稿 · 2026-10-12）

配套 `06-port-gap-audit.md`。S1（只读会话列表）交付后，用户提出三条：**功能还漏很多**、**token 统计没做好**、**进页不自动刷额度**。第三条已当场修完（见 §5），本文处理前两条：把 token 那一档做实（§2，本轮就做），并把 29 条在册零入口命令按域拆开等拍板（§3–§4）。

## 1. 实测底账（本机只读扫描，2026-10-12）

脚本口径：遍历 `~/.codex/sessions` 与 `archived_sessions` 下全部 `.jsonl`，对每个文件从尾部按 512 KB 分块读、上限 4 MB，取最后一条 `event_msg/token_count` 的 `payload.info.total_token_usage`。这与 `codex_session_manager.rs:165 read_token_stats_from_rollout` 同一条路，只是 Node 版本每文件都读满 4 MB（Rust 命中即停，只会更快）。

| 量 | 实测 |
|---|---|
| rollout 文件数 | 67 |
| 目录总量 | 943.4 MB |
| 全量尾扫耗时 | **218 ms**（Node 上界；Rust 命中即停 + `TOKEN_STATS_CACHE` 按 (len, mtime) 命中后近零） |
| 带 `total_token_usage` 的文件 | 67 / 67（一条都没缺） |

`total_token_usage` 实际有 **6 个键**，S1 的结构体只留了 3 个：

```
input_tokens  cached_input_tokens  cache_write_input_tokens
output_tokens  reasoning_output_tokens  total_tokens
```

抽一条真号（rollout-2026-09-22…01a0c740）：

```
input 1 843 378 / cached 1 761 280 / output 11 784 / reasoning 1 617 / total 1 855 162
```

**这就是「没做好」的根因**：Codex 的 `input_tokens` 是每轮重发的上下文累计，缓存命中占九成以上。上面这条**净输入只有 82 098**，而界面按现在的口径显示「输入 1 843 378」。用户看到的数既不能对应账单，也没法横向比较，还会让人以为配额是被单条会话吃掉的。

第二条根因是**可见范围**：S1 按「组展开才取该组 token」实现（`codexState.loadSessionTokens` 只补缺失、`CodexSessionsPanel.toggleGroup` 触发），于是一进「会话」档只有目录名和条数，任何合计量都看不到。实测全量只要 218 ms，这条口径是当初照抄上游的保守值，现在数据不支持它。

## 2. 本轮就做：token 统计补全（S1.5，零新命令、零新表）

判据：**在册仍是 63 = 63 = 63**，只加字段不改命令面；`session_usage` 三表仍不建（那是 S3）。

| # | 改动 | 落点 |
|---|---|---|
| A | `CodexSessionTokenStats` 补 `cachedInputTokens` / `cacheWriteInputTokens` / `reasoningOutputTokens` 三键；尾扫解析器一并读出 | `codex-core/src/modules/codex_session_manager.rs:108`（结构体）、`:254 parse_token_stats_lines`、`:165 read_token_stats_from_rollout` 的返回改 6 值 |
| B | 进「会话」档即一次全量预取（拿当前列表全部 sessionId 调一次），不再等展开；展开只在缓存缺失时补取 | `codexState.loadSessions` 成功后串一次 `loadSessionTokens(全部 id)`；`CodexSessionsPanel.toggleGroup` 去掉「展开才取」 |
| C | 聚合上屏：组头加「合计 X · 输入 Y / 输出 Z」，页头条数后加全会话合计；行上把输入拆成「净输入 + 缓存」两档，缓存与推理进悬停明细 | `CodexSessionsPanel.vue` 模板 + `tokensLine()` |

对上游的偏离要写明白：`codex_session_manager.rs` 是 rev 系列的改写件（`collect_instances` 已单实例化），A 项再加三字段属于**读侧扩面**，不删不改上游已有的三个键，与 `01-plan.md` 的「字节一致」约束只作用于 keeper 文件，不作用于此件。B、C 全在前端。

顺带收掉的两处口径：`compact()` 现在把 1 843 378 印成 `1.8M`，聚合行需要千分位；「token 统计未取到」在 B 之后只可能是真没数（文件不含 token_count），文案改成「这条会话没有 token 记录」。

### 2.1 执行结果（2026-10-12，本轮已交付）

- A：`CodexSessionTokenStats` 六键上 wire（`cachedInputTokens` / `cacheWriteInputTokens` / `reasoningOutputTokens` 三键新增），尾扫解析改走内部 `RolloutTokenUsage`，缺位按 0 记账；`parse_token_stats_lines_reads_all_six_usage_fields` 内联测试用真机那条 1.84M/1.76M 的形状断言。
- B：`loadSessions()` 成功后 `void loadSessionTokens(全部 id)`（不 await，数字不拖慢首屏）；`sessionsEpoch` 与面板那条 watch 一并删掉——预取与它会同刻抢同一批 id，留着就是重复请求。展开仍保留一次补缺（预取失败或搜索后新出现的 id）。
- C：`.sess-sum` 一行给全量合计（未取齐时改说「token 取数中 · 已有 n / N 条」，不拿半截数当结论）；组头 `.grp-tok` 只在整组都有数时出合计；行上两位（净输入 / 输出），其余进 `title`；详情段六位带千分位。
- 判据全绿：`cargo check --bin desko` 0 error、`gate_tests` 2/2、`cargo test -p codex-core codex_session` 11/11、三相等 **63 = 63 = 63**（未加命令）；`vue-tsc` 0、`vitest` 207/207（新增「列表一到手就按全部 id 预取，扫失败不预取」，改写「只问缺的那几条 + 刷新后全量重取」）；`codex.spec.ts` 30/30（「展开才取」改成「进档即全量预取、展开不再补取」，新增「合计量上屏」）；全量 e2e 225 passed / 2 failed（仍是既有的两条「插入芯片」）；`codex-shots.mjs` 13 帧全部本次新拍。


## 3. 全账：上游 257 条 codex 命令，desko 带了 75 条

〔2026-10-12 修正〕本节原来只对了「在册」的命令（63 条里谁没有入口），那是**半张账**——它看不见「上游有、连册都没进」的整片。用户点名「会话删除这些功能都没有吗」，正落在那半张账里：删除会话的 5 条命令一条都没进来，而我上一版没说。

〔同日二次修正〕上一版的域表**各行加起来是 186 条，与我同节写的 196 对不上**，且「A 会话域 19」是把已带的 2 条读侧命令算进「未入册」。现在整张表由脚本机械产出（`generate_handler!` 括号配平取全量 → 名字含 codex → 与 `keep_cmds.json` 差集 → 按域首条命中归类，行数恰好等于总数），不再手分。

〔同日三次修正，S4 之后〕`codex_query_session_usage` 进册并接了前端，账随之变成 **71 在册 / 交集 69 / 未入册 188 / 42 有入口 / 29 零入口**。另外两件必须写进方法里：
- 上游那份克隆（`C:/Code/ai-question/.tmp/cockpit-tools`，`be24ce6`）**工作树已被删空过**——`src-tauri/src/commands/` 只剩 7 个文件，直接读文件算出来是「94 条 / 93 条 codex」这种假账。对账必须走 git 对象：`git show HEAD:src-tauri/src/lib.rs > .scratch/up-lib.rs`，脚本读这份快照。
- 域名正则的**先后顺序就是口径**：`codex_sync_threads_across_instances`、`codex_repair_session_visibility_across_instances` 这些「会话域里带 instance 字样」的命令，若先匹配 `/instance/` 就会被算进实例管理域，A 会话域从 11 掉到 7、C 域从 24 涨到 28。脚本里 A 必须排在 C 前，注释也写在那一行上。

口径：上游 `be24ce6` 的 `src-tauri/src/lib.rs` 里 `generate_handler![…]` 注册 **800** 条命令，名字含 `codex` 的 **257** 条；desko `keep_cmds.json` 含 `codex` 的 **75** 条（S4 之后，含 2 条 desko 侧改写名 `codex_repair_session_visibility_for_launch_target`、`get_codex_history_visibility_provider`），与上游同名交集 **73** 条。**257 − 73 = 184 条从未进册**。前端 `src/**` 里出现过的 invoke 名：**46 有入口 / 29 零入口**。`main.rs` 注册同为 75（脚本按行剥注释，`main.rs:471` 那句文档注释里的 `codex_core::commands::codex::xxx` 不计）。

| 域（未入册） | 条数 | 内容 | desko 要不要 |
|---|---|---|---|
| A 会话域 | **11** | 导入导出 5、跨实例同步 2、可见性修复 3、用量 1 | 逐条见 §3.1 |
| B 本地接入网关 `codex_local_access_*` | 49 | CLIProxyAPI sidecar 的路由/密钥/请求日志/计价面板（含 4 条 stats） | 不做：desko 不带 sidecar 子进程 |
| C 实例管理 `*instance*` | 24 | 多实例创建/启停/网关/终端 | 不做：S1 裁定「codex 只能有一个模块」 |
| D 代理目录/引擎/活动 `codex_proxy_*` | 28 | 代理节点目录、引擎安装、活动流 | 不做：同 B |
| E 统一代理 `codex_unified_proxy_*` | 4 | 统一代理预览与开关 | 不做 |
| F 鹈鹕 `codex_pelican_*` | 15 | 上游的截图/产物留存玩法 | 不做 |
| G 定时唤醒 `codex_wakeup_*` | 12 | 定时任务与唤醒历史 | 不做：与「不需要自动切号」同源 |
| H SSH | 7 | 远端服务器与隧道 6 + `sync_current_codex_account_to_ssh_server` | 不做 |
| I 模型供应商 `*model_provider*` | 7 | 供应商池与用量 | 不做 |
| K 临时登录 `*temp_login*` | 4 | 一次性登录导入链 | 不做：属切号域 |
| Z 账号外围 | 23 | 出口代理测速 6、app speed 5、账号分组 2、**`export_codex_recycled_accounts`（裁定不接）**、`codex_account_proxy_recent_requests`、`set_codex_launch_on_switch`、`codex_managed_lb_provider_id`、`codex_oauth_open_incognito_window`、`add_codex_account_from_grok`、`fetch_codex_account_note_mail_url`、`codex_clear_client_auth_observation`、`codex_focus_runtime_owner` | 账号回收站那 5 条里已交付 4 条（见 `10-account-recycle-bin-port.md` §10），第 5 条 `export_codex_recycled_accounts` 把解密凭据明文落盘、裁定不接，故仍挂在本行；其余不做，`set_codex_launch_on_switch` 属切号域永久排除 |
| **合计** | **184** | | |

**结论**：184 条里真正属于 desko 定位的两块已经做完——**账号回收站 4 条**（S5 交付，第 5 条导出不接）与**会话侧 7 条**（§7 已交付）；A 域「用量」那一格按 §8.3 的 A2 已交付，见 `09-usage-chart-port.md` §9。其余绑在多实例 / sidecar / 定时托管这些 desko 明确不做的域上，不进入册。这张账取代「188/63/131」「196」「189」三种旧算法。

### 3.1 会话域全量 21 条（在册 10 / 未入册 11）

| 簇 | 命令 | 状态 |
|---|---|---|
| 只读列表 | `codex_list_sessions_across_instances` `codex_get_session_token_stats_across_instances` | **已带**（S1 + S1.5，前端有入口） |
| 回收站 | `codex_move_sessions_to_trash_across_instances` `codex_list_trashed_sessions_across_instances` `codex_restore_sessions_from_trash_across_instances` `codex_delete_trashed_sessions_across_instances` `codex_empty_session_trash_across_instances` | **已交付**（§7，前端有入口） |
| 打开位置 | `codex_open_session_location` `codex_open_session_rollout` | **已交付**（§7，前端有入口） |
| 用量聚合 | `codex_query_session_usage` | **已交付**（§8.3 A2 → `09-usage-chart-port.md`：新命令进册、前端「用量」第四档柱状图有入口） |
| 导入导出 | `codex_export_sessions` `codex_preview_session_export` `codex_import_sessions` `codex_preview_session_import` `codex_validate_session_import_paths` | 未做：要引 zip 依赖，且导出物是整条 rollout 原文 |
| 跨实例同步 | `codex_sync_threads_across_instances` `codex_sync_sessions_to_instance` | 不做：单实例 |
| 可见性修复 | `codex_repair_session_visibility_across_instances` `codex_list_session_visibility_repair_instances` `codex_list_session_visibility_repair_providers` | 不做：desko 已有单实例版在册并接进切号收尾 |
| 用量同步 | `codex_sync_session_usage`（另有 `codex_query_model_provider_usage` 归 I 域） | 不做：它是 B 路的 sqlite 落盘件，desko 走 A2 的即扫即算，不留表 |

## 4. 在册零入口面：29 条按域拆分（等拍板）

机械口径：`keep_cmds.json` 里含 `codex` 的 75 条，减去 `src/**` 里出现过的 invoke 名。**75 在册 / 46 有入口 / 29 零入口**（`.scratch/recon.mjs` 产出；S4 与 S5 那 5 条新命令一进去就有入口，所以有入口 41→42→46、零入口面纹丝不动 29）。〔F1 删除侧交付后，同日实测：**75 / 51 / 24**，见 §5 第 3 条与 `11-batch-jobs-port.md` §10。〕〔同日 S7 摘册 13 条后：**62 在册 / 51 有入口 / 11 零入口**，见 `12-zero-entry-prune.md`；下表是摘册前的 29 条拆分，留作逐域判定的底账。〕〔2026-10-20 WSL 登录态同步新增 `get_codex_wsl_auth_status` / `sync_codex_auth_to_wsl`，两条都有入口：**64 在册 / 53 有入口 / 11 零入口**。〕

| 域 | 条数 | 命令 | 要不要做 |
|---|---|---|---|
| **F1 批量作业** | 11（删除侧 6 + 导入侧 5） | `start_codex_batch_import_from_files` `get_codex_batch_import_preview` `confirm_codex_batch_import` `cancel_codex_batch_import` `resume_codex_batch_import` `pause_codex_batch_delete` `resume_codex_batch_delete` `retry_failed_codex_batch_delete` `clear_codex_batch_delete` `get_codex_batch_delete` `start_codex_batch_delete` | **建议做**：这是账号页「多号轮换」真正缺的那块，也是 06 §5 里的 T2。要新开一个作业弹窗（预览 → 进度 → 暂停/续跑/重试失败），纯动前端 + 已有命令，不碰 Rust。批量导入的读面是官方目录、写面是 desko 自己的档案，不写 `~/.codex`。〔2026-10-12 交付，拆成两半〕**删除侧 6 条已全部接上**（作业弹窗 + dock 把手，`11-batch-jobs-port.md`）；**导入侧 5 条经拍板不做两段式预览、保留今天的一把梭**，因此继续零入口，进 §5 第 6 条的待摘账。Rust 侧另做一处收口：导入会话的明文凭据盘快照停掉（11 §3.1）。 |
| **F2 API Key 与 pending 凭据** | 6 | `add_codex_account_with_token` `import_codex_access_token_account` `create_pending_codex_oauth_account` `sync_codex_api_key_provider_accounts` `update_codex_api_key_bound_oauth_account` `update_codex_account_api_model_mappings` | **部分建议做**：前两条是「手里只有一个 access token」的入口，添加弹窗该收；后四条绑的是 API Key 池与按模型映射 key 的上游玩法，desko 定位（本地个人工作台、不代管客户端）用不上，**建议摘册**。 |
| **F3 模型与配置面** | 9 | `get_codex_quick_config` `save_codex_quick_config` `get_codex_model_reasoning_efforts` `save_codex_model_catalog` `save_codex_context_management` `export_codex_model_config` `import_codex_model_config` `preview_codex_model_config_import` `get_codex_config_toml_path` | **要拍板**：`save_*` 四条会**写官方 `config.toml`/模型目录**，等于改客户端行为，与 S1 的「只读、不写官方目录一个字节」是相反承诺；`get_codex_config_toml_path` 已被设置页的 `get_codex_storage_paths` 覆盖，属重复。要么整域不做并摘册，要么明确「desko 要接管 Codex 配置」。 |
| **F4 配额变体** | 2 | `refresh_all_codex_quotas` `refresh_current_codex_quota` | **建议摘册**：与已接的 `refresh_codex_quotas_batch` 同义，留三条入口等于白送三个可达面（06 §5 收面选项已点到）。 |
| **F5 残留** | 1 | `restore_codex_active_takeover_if_enabled` | **建议摘册**：属已砍的接管域，Rust 侧零调用。 |

摘册动作按 R6 只能改 `keep_cmds.json` 后重跑流水线，不得手删函数体。

〔2026-10-12 S7 摘册落地，逐域对账〕**已摘 13 条**：F1 导入 5（§5 第 3 条拍板不做两段式预览）+ F2 后 4 + F4 2 + F5 1 + 被单通道顶掉的 `delete_codex_accounts`。**在册剩 11 条零入口 = F2 前 2（待接，§5 第 4 条）+ F3 整域 9（待拍板，§5 第 5 条）**。执行细节与「为何不重跑 `trim.py`」见 `12-zero-entry-prune.md` §3。

## 5. 待点头

1. §2 三项（补字段 / 全量预取 / 聚合上屏）——用户既已点名「token 统计没做好」，本轮按此做完，无需额外点头；只把口径变化写进 07 §8-B 的补充。
2. §7 会话回收站 7 条——用户点名「会话删除这些功能都没有吗」，按此做。**边界要认下来**：这一条路会删官方 `~/.codex` 里的 rollout 文件并重写 `session_index.jsonl`，与 S1 的「只读」承诺相反；补偿是先留底 + 可还原 + 二次确认，且实现与验收全程只跑 e2e mock，不碰真号（用户 2026-10-12 约束「千万不要拿真实数据测试」）。
3. F1 批量作业 11 条：要不要开这一档弹窗（工作量最大的一块）。〔2026-10-12 已点头，排在账号回收站之后。〕〔同日交付〕按 11 号稿 §3 的三项拍板收口成 **6 条**：删除侧 6 条全接（作业弹窗 + dock，单通道，`delete_codex_accounts` 让位成零入口），导入侧 5 条**不做两段式预览**、保留一把梭，继续零入口并入第 6 条的待摘账。入口账 46 / 29 → **51 / 24**（+6 新接、−1 让位）。
4. F2 前两条（token 直投账号）要不要接。
5. F3：接管官方 `config.toml` 做还是不做——这条决定 desko 是不是「只读旁观者」；§7 已经先开了「写官方目录」这一头，F3 是它的延伸（改配置而非改会话）。
6. F2 后四条 + F4 两条 + F5 一条共 **7 条**摘册（改 `keep_cmds.json` + 重跑流水线）。〔同日三次修正〕上一版这里写「共 11 条」「63 + 7 − 11 = 59」两处都对不上：11 是 §4 表里各建议摘册行没有一条能加出来的数，而 S2 已经把在册抬到 70。〔同日四次修正，S4 之后〕S4 又把在册抬到 **71**，按当前建议的账是 **71 − 7 = 64**；若 F3 整域也摘（§4 那条待拍板），再减 9 = **55**。〔同日五次修正，S5 之后〕S5 再抬到 **75**，账随之是 **75 − 7 = 68**，F3 整域再减 9 = **59**。〔同日六次修正，F1 删除侧之后〕F1 导入那 5 条经拍板不接界面，随之下线转待摘 → **75 − 12 = 63**（F3 整域再减 9 = **54**）；被单通道顶掉的 `delete_codex_accounts` 也已是零入口，一并摘 → **62**。摘册动作本身仍归本条待拍板，F1 那一轮没有顺手减在册（75 不动）。〔同日 S7 已执行〕13 条全部下线，在册 **75 → 62**，零入口 **24 → 11**；剩下的账是 62 − 11 = **51** 条有入口，若 F3 整域也摘再 −9 = **53**。逐条理由与判据见 `12-zero-entry-prune.md`。
7. 账号回收站 5 条（`*recycled_account*` / `empty_codex_recycle_bin`）：账号页的删除现在直接掉 desko 记录，照 §7 同一套留底写法补回收站。〔2026-10-12 已点头，排在 A2 图之后、F1 弹窗之前；这一条会动 desko 自己的账号档案，不碰 `~/.codex`。〕〔交付修正〕实际接的是 **4 条**：第 5 条 `export_codex_recycled_accounts` 要把解密后的凭据写成明文文件，与「导出只到剪贴板」相反，经裁定不接。另外「账号页的删除现在直接掉 desko 记录」这句只对了一半——`remove_accounts` 早就在删除前先写一份加密快照，缺的只是读回来看的那层命令，见 `10-account-recycle-bin-port.md` §2。

## 6. 已交付：进页自动补配额（回应第三条）

`codexState.ts` 新增 `refreshQuotasOnEnter()`：进 Codex 页那一轮 `refreshAccounts()` 之后静默补一次批量刷新，闸门两道——`quota_refresh_minutes <= 0` 直接跳过（用户关了自动刷新就别理他），距上次刷新不足 60 s 跳过（在别的页签间来回切不打网络）。静默=不播「配额已刷新」，但低额度预警照报，同一档位仍只报一次。

验收：`vue-tsc` 0 error；`vitest` 206/206（新增 2 条：进页那一轮补一次且 60 s 内不重复、关掉自动刷新或零账号时零网络）；`codex.spec.ts` 29/29（原「配额预警」改成「进页那一轮自动补」，新增 60 s 闸门与关闸两条）；全量 e2e 224 passed / 2 failed（两条即既有 `notes.spec.ts:644`、`:654`「插入芯片」）。

## 7. S2 会话回收站与打开位置（7 条命令 · 本轮做）

### 7.1 上游语义（逐行核验 `git show be24ce6:src-tauri/src/modules/codex_session_manager.rs`，3834 行 vs desko 改写件 1146 行）

`move_sessions_to_trash_across_instances`（上游 :761）落到每个实例上走 `trash_snapshots_for_instance_with_app_server`（:2248），顺序是：

1. **先留底**：`copy_snapshot_rollout_to_trash`（:2350）把 rollout 原文件按相对路径复制进
   `<app data dir>/cockpit-tools-codex-session-trash/<UTC %Y%m%d-%H%M%S>/<instanceId>--<sessionId>/files/<相对路径>`，
   同目录写 `manifest.json`（`sessionId/title/cwd/instanceId/instanceName/instanceRoot/originalRolloutPath/relativeRolloutPath/sessionIndexEntry/deletedAt`，驼峰键），并保住原文件的 mtime。
   注意留底落在**应用自己的数据目录**，不在 `~/.codex` 里。
2. **官方删除**：`codex_official_app_server::delete_threads(data_dir, ids)`——spawn 官方 app-server 走 JSON-RPC `thread/delete`，由 Codex 自己删 rollout 文件并清 state DB/catalog 行。
3. **兜底删文件**：无论官方是否成功，`remove_snapshot_rollout_file`（:2416）都删原 rollout（官方已删时该函数见文件不存在直接返回）。
4. **重写索引**：`rewrite_session_index_without_ids`（:2429）按行读 `session_index.jsonl`，丢掉 `id` 命中的行，整体 `write_string_atomic` 落盘。
5. **重建侧栏元数据**：仅在官方删除失败时调 `rebuild_thread_metadata`。
6. 运行中实例（`is_instance_running`）计数进 summary，文案提醒「可能需要刷新或重启后显示」。

还原侧 `restore_trashed_session_entry`（:2820）反过来：校验废纸篓里的 rollout 首条 meta 的 session id 与清单一致 → 若目标位置已有文件，必须同 id 才允许继续（不同 id 或读不出 id 一律拒绝，不覆盖） → 复制回原路径并恢复 mtime → `upsert_session_index_with_entry`（:3009，先存原文，失败则 `restore_session_index_content` 复原） → 删废纸篓条目 + `cleanup_empty_trash_ancestors`。

### 7.2 desko 的改写点（必须写明，不是照搬）

`codex_official_app_server.rs` 在 desko 是 8 行裁剪桩（`rebuild_thread_metadata` 恒返 `Err("该能力已在裁剪版中移除")`），`delete_threads` 根本不存在——desko 不 spawn 官方 app-server。所以：

- 第 2 步整步去掉，删除只剩**文件法**（第 3、4 步）。这与上游「官方删除失败」的兜底分支同一条路，上游自己的注释就是「Codex 重启后会同步」。
- 于是 summary 里 `official_delete_fallback_instance_count` / `metadata_rebuild_failed_instance_count` 两个计数在 desko 恒真/恒无意义，**DTO 不收这两个键**，改为 desko 自己的形状：`requestedSessionCount / trashedSessionCount / trashedInstanceCount / runningInstanceCount / trashDirs / message`。留底目录名从 `cockpit-tools-codex-session-trash` 改叫 `desko-codex-session-trash`（旧名不再读，`get_legacy_session_trash_base_dir` 那条 `~/.Trash` 兼容路径同删——desko 从没写过它）。
- `running_instance_count` 这个计数**不收**：desko 的 `process::collect_codex_process_entries()` 是空桩（desko 不启动 Codex，上游按已配置的启动路径匹配进程，同状态下也返空），拿它算「运行中实例数」恒 0，等于把提醒做成假象。改成文案里一句不带条件的实话：「Codex 若在运行，需重启后其侧栏才同步」。
- 命令名保持上游一致（`codex_*_across_instances`、`session_ids: Vec<String>`），在册账按名字对，不改名；唯一缩面是 `codex_open_session_location` / `codex_open_session_rollout` 不收 `instanceId` 参数——desko 没有实例概念，多一个恒为空的参数只是可达面。
- 新增 `codex_open_session_location` / `codex_open_session_rollout`：desko 已有 `tauri_plugin_opener`（`main.rs:87` 注册、`codex_account_commands.rs:565` 同法开凭据目录），命令层照搬上游 wrapper + `resolve_session_rollout_path` / `resolve_session_location_dir` 两个读侧解析器（只多实例收敛成单实例，逻辑不变）。

### 7.3 落点

| 层 | 改动 |
|---|---|
| Rust 模块 | `codex_session_manager.rs` 补写侧切片：`move_sessions_to_trash_across_instances` / `list_trashed_sessions_across_instances` / `restore_sessions_from_trash_across_instances` / `delete_trashed_sessions_across_instances` / `empty_session_trash_across_instances` + `resolve_session_rollout_path` / `resolve_session_location_dir`，及其私有簇（`copy_snapshot_rollout_to_trash`、`remove_snapshot_rollout_file`、`rewrite_session_index_without_ids`、`load_trash_entries*`、`restore_trashed_session_entry`、`upsert_session_index_with_entry`、`delete_trash_entries`、`calculate_path_size`、`remove_path_recursively`、`format_bytes`、`sanitize_for_file_name`、`cleanup_empty_trash_ancestors`、`parse_deleted_at`） |
| 命令 | `codex_session_commands.rs` 7 条 `#[tauri::command]`，重活一律 `spawn_blocking` |
| 闸门 | `keep_cmds.json` +7、`main.rs` 注册 +7；三相等 **63 → 70**，`registered_codex_cmds_are_gated` 自动纳管 |
| API | `services/api/codex.ts` 补 `CodexTrashedSessionRecord` / `CodexSessionTrashSummary` / `RestoreSummary` / `DeleteSummary` 与 7 个 invoker |
| 状态 | `codexState.ts`：`moveSessionToTrash`、`trash` 列表缓存 + `loadTrash` / `restoreFromTrash` / `deleteFromTrash` / `emptyTrash`；删除成功后同时把这条从 `sessions` 与 `sessionTokens` 摘掉，别让合计量拿着已删的数 |
| UI | `.cx-tabs` 第三档「回收站」（条数进 `.titlebar-count`）；会话行详情段补动作行：打开位置 / 打开会话文件 / 移到回收站（`confirmStore.showConfirm` 二次确认，文案必须说清「从官方目录移除，desko 留底可还原」）；回收站档每行「恢复」「彻底删除」，顶部「清空回收站」 |
| 文案 | 面板底部那句「本视图只读官方 Codex 目录，不写任何文件」在删除落地后就是假话，改成「删除只动官方会话目录里的这条会话，先留底进 desko 回收站」 |

### 7.4 风险账

- 这是 desko 第一次往官方 `~/.codex` 写：删 rollout 文件 + 重写 `session_index.jsonl`。原子上写（`write_string_atomic`）+ 先留底，出错可还原；`session_index.jsonl` 不存在时重写步骤直接跳过（与上游同）。
- 官方 Codex 正在跑的时候删除，它的内存态可能把这条会话再写回索引（上游同样只能提示「重启后同步」）。UI 必须把这句说出来，不假装原子一致。
- 绝不用真号验收：全部走 e2e mock（`*@e2e.dev` fixture），Rust 侧只跑内联单测（`temp_dir` 造会话目录）。真机那一次由用户自己点，第一次建议拿一条不要的会话。

### 7.5 执行结果（2026-10-12）

后端（`cargo test -p codex-core codex_session` 13/13、`gate_tests` 2/2、三相等 70 = 70 = 70）：

- `codex_session_manager.rs` 1146 → 2241 行，写侧切片按 §7.2 落地：先 `copy_snapshot_rollout_to_trash` 留底、再 `remove_snapshot_rollout_file`、最后 `rewrite_session_index_without_ids`；留底根目录 `desko-codex-session-trash/<UTC 批次>/<instanceId>--<sessionId>/{manifest.json,files/…}`。两条新内联单测：一条走「移进去 → 原文件没了 → 清单读得到 → 恢复回文件与索引 → 回收站空」的整圈，一条验索引重写遇到解析不了的行时原样保留。
- `codex_session_commands.rs` 115 行 / 7 条命令，重活一律 `spawn_blocking`；两条「打开」走 `app.opener().open_path()`，与 `codex_account_commands.rs:565` 同法。
- 桩账按「Prune stub contract」收口：`running_instance_count` 不进 DTO，提醒写成不带条件的一句文案。

前端（`vue-tsc --noEmit` 干净、`vitest run` 212 passed / 17 files，其中 `codexState` 16 条含新增 5 条回收站用例）：

- `.cx-tabs` 第三档「回收站」，条数进 `.titlebar-count`；会话详情段的动作行为 打开位置 / 打开会话文件 / 移到回收站（后者 `.action-btn.danger`，确认框把「先留底、再从官方目录移除、Codex 重启才同步」三件事说完）。
- 状态收口与 §7.3 有一处偏差并已在代码里注明：删除/清空/恢复成功后**当场摘掉那一行**，不再整页回读目录（`dropTrashRow`），只有「移进回收站」那次是把 `trashLoaded` 作废——当时人还在会话档，留底清单没人看，等进档再扫。合计量在移动成功那一刻就少掉这条的 token，不需要重扫。
- 会话档底部那句脚注已改成实话：「这一档列的是官方 Codex 留在本机的会话；移到回收站会先留底进 desko，再从官方目录移除。」

mock 与出图（全程 `*@e2e.dev`，未碰真号）：

- `e2e/mocks/backend.ts` 补 7 条命令 + `trash` / `trashFail` / `openFail` 三个旋钮：官方列表与留底是同一份内存的两个数组，移动就是从这边挪到那边，恢复原样挪回（连同 token 与体积），删除/清空只减留底并累计释放量。
- `e2e/specs/codex.spec.ts` 602 → 783 行，新增「Codex 会话回收站」7 条：移动全圈（含取消一次、合计量 65.1K→51.4K、页头 4→3→4 条）、留底清单（时间倒序、2.0 KB / 3.0 MB 分档、短 ID、彻底删除与清空的文案与体积账）、进回收站档不扫官方目录、打开两条按 `sessionId` 调用且成功不播 toast、打不开只一条红 toast、清单读不到出错误块、移动失败列表与留底都不动。全量 e2e：232 passed，2 failed 为 notes「插入芯片」两条 HEAD 即红的存量。
- `scripts/codex-shots.mjs` 13 → 16 帧（`codex-trash-confirm` / `codex-trash-list` / `codex-trash-empty`），跑完按 EXPECTED 逐名核对「16 帧全部为本次新拍」。

未做：真机那一次（会真删 `~/.codex/sessions` 里的一条 rollout）等点头，建议拿一条不要的会话试。

## 8. token 图表：为什么摘掉、又怎么补回来（已点头 → A2 已交付）

### 8.1 「为啥不做图」的老实回答

两个原因，第一个是我照你的话裁的，第二个是我自己算错的账：

1. 2026-10-12 你说过「token，我不需要图表」，我据此把 S3 报表面板整块从路线上摘了，还写进 §3.1 当定案。现在你回问「你为啥不做图」，这两句是相反的——我不把它当作自动撤回，图的取舍等这一轮点头。
2. 摘的时候我还有个技术借口：上游的图绑在 `codex_query_session_usage` + `codex_sync_session_usage` + sqlite 三表上，而 desko 明确不做 `*instance*`（24 条）和本地接入网关（49 条）两域，成本列又是直接调 `codex_local_access::estimate_model_token_cost_usd`——照搬等于给不做的项目引一条依赖。**今天重扫，这个借口只有一半成立**（见 §8.2）。

### 8.2 当时重扫的底账（只读；脚本 `fullscan.mjs` / `eventypes.mjs`）

〔2026-10-12 追记〕这两个一次性扫描脚本原先写在 `test-results/` 下，那是 Playwright 的 outputDir——每次跑 e2e 会整个清空，脚本已随之没了。对账脚本（要长期重跑的那条）挪到 `.scratch/recon.mjs`，同样不入库；下表数字是当天实测留档，重跑要按 §3 的 git 对象口径重写。

| 量 | 实测 | 对上游借口的影响 |
|---|---|---|
| rollout 文件 | 73 个 / 965 MB（§1 早先测的是 67 个 / 943.4 MB——同一台机器同一天的两个读数，目录在长，这本身就是「会话级快照会过期」的证据） | — |
| **全量逐行扫**（把每行都解析一遍，非 S1.5 的尾扫） | **1.68 s**（Node，无优化） | 「建表才画得起图」不成立：Rust 顺序读一次扫完更快，还能按 `(len, mtime)` 缓存 |
| `event_msg/token_count` 行数 | 15 974 | 其中不少 `info: null`（只带 `rate_limits`），desko 尾扫得往回走才拿到最后一个有效累计值——§1 那句「67/67 都带 total_token_usage」是**会话级**成立，不是每行成立 |
| `token_usage_record` 行数 | 15 732 | **按轮时间序列就在文件里**：每条带 `timestamp` + `thread_id` + `turn_id` + `usage` 六键，这就是图的真实数据源，不需要 sqlite |
| `turn_context` 行数 / 带 `model` 的行 | 1 156 / 2 604 | 按模型分档也可读（`session_meta` 里也有 model，如 `gpt-5.6-sol`） |
| `token_count.rate_limits` | 每条带 `used_percent` / `window_minutes` / `resets_at` | 附带可能：5 小时额度的历史曲线，不必联网 |

**为什么现在页面上的数画不成图**：S1.5 上的是每条会话的**最后一个累计总量**（`total_token_usage`），一个会话一个点。拿它按天铺柱状，等于把「连着跑了三天、最后一轮在昨天」的会话整笔算到昨天。这就是我说「口径不支持」的地方——不是图做不了，是**这个数不能当按天的数用**。

### 8.3 三条路（命令面账各不相同）

| 路 | 画什么 | 在册 | 后端 | 代价与口径 |
|---|---|---|---|---|
| A1 现状聚合 | 按项目/按会话的**总量条**（横向 bar，无时间轴）：回答「谁吃掉了配额」 | 70 不变 | 零（数据已在内存） | 零成本、零谎言，也没有趋势 |
| **A2 按轮聚合（推荐，已按此交付）** | 「用量」第四档：按天柱状 + 累计曲线 + 按模型条，悬停给输入/缓存/输出/推理四档 | 原计划 70 不变（`codex_get_session_token_stats_across_instances` 加一种形态：`sessionIds` 传空即全量，返回补 `byDay` / `byModel` / `totals`）；**实际 70 → 71**，见 §8.4 偏差 1 | Rust 补一个 `token_usage_record` 逐行解析器，只读、不落盘、不建表；首次约 1.7 s 后台跑（先出 A1 的数再叠图），之后 `(len, mtime)` 命中近零 | 时间戳是真的，图可信；仍是「官方目录里现存的会话」，删掉的会话不在图上 |
| B 上游那套 | A2 全部 + 请求数 + 成本 USD + **已删会话的历史留存** | 70 → 72 | rusqlite 三表 + 增量游标 + 分叉会话 replay-prefix 去重（上游该件 1 965 行，大半是这套机器） | 成本列依赖 desko 不带的 `codex_local_access` 定价表，要么砍这列要么自带价表；多一个落盘件（损坏/迁移面）。B 的独有价值只剩「会话删了图还在」和「请求数」 |

推荐 **A2**：你的痛点是「配额被谁、在哪天吃掉」，A2 的时间序列来自官方文件里真实的按轮记录，且不碰在册账、不在本机多写一个文件——延续 S1 的「只读官方目录」。B 相对 A2 只多出历史留存与成本，成本那列正好压在明确不做的域上；等哪天要「把已删会话也算进账」再开 B 不迟（回收站留底 §7 已能补一部分）。

UI 落点（不与骨架冲突）：`.cx-tabs` 第四档「用量」，柱状自绘 div，**不进图表库依赖**（`package.json` 现有依赖不涨），高度固定、走 `--fill`/accent 令牌、无入场动画；页头 `.titlebar-count` 显示扫描范围（如「近 30 天 · 73 条会话」）。全量首扫那 1.7 s 期间先显示 A1 的总量条，别让图区空转。

### 8.4 点头结果与偏差（2026-10-12）

用户回「按照你推荐的来」，三条推荐按 announced 顺序放行：A2 图 → 账号回收站 5 条 → F1 批量作业弹窗。子项点头为：柱状**净输入 / 缓存两段**、默认窗口**近 30 天**、**额度历史曲线本轮不做**。

与上表有两处偏差，按实际落地记：

1. A2 没有走「给现有 stats 命令加一种传空即全量的形态」，而是**新开一条命令** `codex_query_session_usage`（就是上游那一条，名字照搬）：在册 **70 → 71**，三相等随之 71 = 71 = 71。理由是现有那条按 `sessionIds` 取尾扫快照（会话档的行内数），与这里「按窗口全量差分聚合」是两种返回形状，塞进同一条命令会让前端两个调用点各自依赖一半字段——上游本来也是两条命令。
2. 累计曲线没做。按天柱 + 按模型条已够回答「哪天、哪个模型吃掉配额」，曲线要在柱上再叠一层归一化坐标，值不值等真机看过图再说。

执行结果、判据与截图见 `09-usage-chart-port.md` §9。

