# Codex 移植缺口对账（2026-10-11）

> 触发：「codex 相关功能你没有完整移植，现在实现的只是半成品」。
> 本文不辩护、不认账，只把三层摊开数一遍：**上游全量 / desko 后端在册 / desko 前端已接**。
> 全部数字来自当场 grep，复现命令见 §7。

## 1. 三层账

| 层 | 数量 | 判据 |
|---|---|---|
| 上游 cockpit-tools 前端调用的 codex 命令 | **188** | `grep -rhoE "invoke\(['\"][a-z0-9_]*codex…" src` 去重 |
| desko 后端在册（编译进包、`invoke` 可达） | **61** | `keep_cmds.json`；`#[tauri::command]` 定义数 = `main.rs` 注册数 = 在册数（`gate_tests` 常驻守卫） |
| desko 前端已接（`services/api/codex.ts` 有 `invoke`） | **28** | 逐个核对，28 条**都有**组件调用方，API 层无空挂方法 |
| **在册但零入口**（后端搬了、前端当它不存在） | **33** | 61 − 28 |
| **整域未搬** | **133** | 188 − 61 与上游交集外的部分 |

半成品感的来源可以量化成一句话：**在册的 61 条里只有 28 条真在界面上跑，另外 33 条是搬进来就睡着的死重**。这不是"少做了 133 条"那种范围分歧，而是自家边界内的欠账——见 §2。

## 2. 33 条在册零入口，按功能族

### F1 批量作业（11 条）—— 最大的一块
`start_codex_batch_delete` `get_codex_batch_delete` `pause_codex_batch_delete` `resume_codex_batch_delete` `retry_failed_codex_batch_delete` `clear_codex_batch_delete`
`start_codex_batch_import_from_files` `get_codex_batch_import_preview` `confirm_codex_batch_import` `resume_codex_batch_import` `cancel_codex_batch_import`

后端是一整套**可预览、可暂停、可续跑、可重试失败项**的作业机（返回 `CodexBatchDeleteJobStatus`）。前端只用了 `delete_codex_accounts` 一梭子 + `import_codex_from_files` 一次性：勾选 40 条删除没有任何进度面，中途失败只有一条 toast，失败项无从重试。**这是「账号管理」域内的直接欠账，不是范围外。**

### F2 API Key 凭据族（6 条）
`add_codex_account_with_token`（三段 token 直建）、`import_codex_access_token_account`、`update_codex_api_key_credentials`、`update_codex_api_key_bound_oauth_account`、`sync_codex_api_key_provider_accounts`、`update_codex_account_api_model_mappings`

现状：添加弹窗只收 `key + base_url`（`add_codex_account_with_api_key`）。**API Key 账号一旦入库就锁死**——`CodexEditDialog` 只改名称/备注/标签，key 失效、换 base url、换模型目录都只能删了重加。`update_codex_api_key_credentials` 就在册躺着。

### F3 模型与配置面（8 条）
`get_codex_quick_config` `save_codex_quick_config` `get_codex_model_reasoning_efforts` `save_codex_context_management` `save_codex_model_catalog` `export_codex_model_config` `import_codex_model_config` `preview_codex_model_config_import`

上游的「模型/推理强度/上下文管理/模型目录」四块编辑面在 desko 完全没有；`config.toml` 侧只能「打开文件」手动改。

### F4 配额与订阅（3 条）
`refresh_codex_subscription_info` —— **有效缺口**：它比前端在用的 `refresh_codex_account_profile` 多做订阅档位/到期刷新并连带更新托盘菜单，行内「刷新订阅信息」其实只取了 profile。
`refresh_all_codex_quotas` —— 页条的「刷新配额」用 `refresh_codex_quotas_batch` 传全量 id 达到同效，**这条属重复**。
`refresh_current_codex_quota` —— 同上，可用批量代替，属重复。

### F5 切号与登录中间态（2 条）
`codex_cancel_account_switch` —— 切号弹窗/行内**没有取消**，`busyId` 期间只能干等，而它正是设计文档里被砍掉的那颗按钮，后端函数（含 `codex:switch-progress` 的 `cancelled` 事件）原样在册。
`create_pending_codex_oauth_account` —— 上游用它先占位再等登录，desko 登录失败即无痕。

### F6 其他（3 条）
`import_codex_from_json`（粘贴 JSON 文本导入，前端只走文件选择）、`get_codex_config_toml_path`（路径来自 `get_codex_storage_paths`，未单独用）、`restore_codex_active_takeover_if_enabled`（已砍的接管域残留，**无 Rust 侧调用点**，纯死重）。

## 3. 前端字段欠账（后端在发，前端不认）

`CodexAccount` 结构体 **66** 个字段，`codex.ts` 只声明 **24** 个，未声明 42。其中多数属被砍域（`egress_proxy_*` `agent_identity` `upstream_grok_account_id` `api_*` `app_speed`），但下面这些是**已经在传给前端、连类型都写了却一行没渲染**：

| 字段 | 状态 | 后果 |
|---|---|---|
| `authorization_status` | 已声明，零渲染 | 授权异常（token 失效/需重登）在行内没有任何标记，只能点了「刷新订阅信息」才知道 |
| `quota_error` | 已声明，零渲染 | 配额取失败时行只显示「未取到配额」，具体原因丢在后端 |
| `token_updated_at` `created_at` `last_used` | 已声明，零渲染 | 「这号多久没动过」全无，多号轮换时无从判断 |
| `reauth_reason` `client_auth_status` `last_client_launch_at` | 未声明 | 上游的客户端登录状态观测整块没接 |
| `team_quota_history` | 未声明 | 上游的团队配额历史（曲线）没接 |
| `codex_fingerprint_mode` | 未声明 | OAuth **设备指纹收敛模式**（缺省按 `off`）——与封号风险直接相关的那一个，界面碰不到（详见 01-plan §协议对齐） |
| `codex_cli_only` `codex_cli_only_allow_app_server` | 未声明 | 上游自己注为「历史备份元数据，不再作为客户端放行策略」，**不接无害** |
| `two_factor_secret` `account_password` `phone_number` `mail_url` | 未声明（**有意**） | 安全约束：前端永不渲染凭据类字段，只解 `tokens.id_token` 的 `auth_provider` 当登录方式标签 |
| `CodexQuota.hourly_window_present` `weekly_window_present` `raw_data` | 未声明 | 窗口不存在时仍画 0% 条，与"窗口无数据"不可分辨 |

**2026-10-12 本层已判定并结清**，逐条判定见 `13-account-field-diff.md`：42 条未声明里 34 条属已砍域或后端内部态（永远 `None`/`false`）、6 条凭据与 PII（有意永不声明，上表最后一条即其一部分）、1 条待拍板（`team_quota_history`），真正该接的只有 `reauth_reason` 一条，已接（声明 + 「需重新登录」徽标 title + e2e + 拍帧）。表内 `client_auth_status` / `last_client_launch_at` 那组经函数级核验：唯一写函数 `update_client_auth_observation` **零调用方**，属已砍的实例 CDP 观测域，不是"还没接"。接完的账是 66 → 声明 25 / 未声明 41。

## 4. 整域未搬的 133 条

这一层是 **01-plan D1''/「交付边界」的既有决策**，不是遗漏，列出来只为把话说清：

| 域 | 条数 | 上游落点 |
|---|---|---|
| 本地 API 网关 / API 服务（`codex_local_access_*`） | 49 | `CodexApiServicePage.tsx`(3896) + `CodexApiServiceView.tsx`(3858) + `CodexApiRequestLogs.tsx` |
| 多实例与 CLI 快速启动（`codex_*_instance*`） | 28 | `CodexInstancesPage.tsx`(846) |
| 代理（出口/统一/活动） | 16 | 上游代理引擎域 |
| 会话管理 / 回收站 / 用量 | 11 | `codex_*session*`（quick 修复路径已由 rev5 单独搬回） |
| SSH 远端 | 7 | `codex_ssh_*` |
| 模型供应商直连测试 | 5 | `save_codex_model_providers` 等 |
| App 加速（CDP 注入） | 5 | `*_app_speed*` |
| 定时唤醒 | 3 | `WakeupTasksPage.tsx` |
| 分组 | 2 | `load/save_codex_account_groups`（上游 `accounts.groups`，账号页有分组头） |
| 临时登录导入 | 2 | `cancel/retry_codex_temp_login*` |
| 备注邮件 / 其他 | 5 | `fetch_codex_account_note_mail_url`、`close_codex_oauth_port`、`codex_oauth_open_incognito_window`、`codex_focus_runtime_owner`、`add_codex_account_from_grok` |

上游账号页 `CodexAccountsOverviewPanel.tsx` 单文件 **3654** 行；desko 的 `CodexModule.vue` + 三个弹窗合计约 700 行。差出去的主要就是 §2 的 F1/F3 和 §4 的网关/实例。

## 4.1 深挖一档：会话管理与 token 统计（01-plan 里被整域裁掉，rev5 只回来一条 quick 修复）

desko 现在有的：切号后的**单目标会话可见性 quick 修复**（rev5，`codex_session_visibility*` 六件 + `codex_session_file_time.rs`，合计 5452 行，已在册跑着）。desko 现在没有的：**任何会话浏览、回收站、导入导出、跨实例同步、会话级 token 用量**。

### 上游这一域的实际体量

| 侧 | 文件 | 行 |
|---|---|---|
| 后端 | `modules/codex_session_manager.rs` | 3834 |
| 后端 | `modules/codex_session_usage.rs` | 1965 |
| 后端 | `modules/codex_thread_sync.rs` | 1630 |
| 后端 | `modules/codex_session_history_sanitize.rs` | 1140 |
| 后端 | `modules/codex_session_display.rs` | 570 |
| 后端 | `modules/codex_session_rollout_sanitize.rs` | 487 |
| 后端 | `modules/codex_session_import_paths.rs` | 425 |
| 命令 | `commands/codex_instance.rs`（11 条会话命令的定义处，desko 里是 0 命令的 131 行桩） | — |
| 前端 | `components/codex/CodexSessionManager.tsx` | 2829 |
| 前端 | `components/codex/CodexSessionUsagePanel.tsx` | 656 |

Rust 侧 ≈ **9,951** 行，前端 ≈ **3,485** 行——比 desko 整个 Codex 账号页（含三个弹窗）都大。

### 数据来源其实是文件，不是网络

`list_sessions_across_instances(title_query, content_query)` 的签名里**没有 instance 参数**，内部 `load_thread_snapshots()` 逐目录扫 `<codex_home>/{sessions,archived_sessions}/**/rollout-*.jsonl`，再用 `session_index` + `SessionDisplayContext` 补标题与工作目录。**零联网**，与账号协议/封号无关。

会话级 token 统计有两条独立实现，别混：
1. `get_session_token_stats_across_instances(session_ids)`（在 session_manager 内）——**当场读 rollout jsonl 算**，无持久化。
2. `codex_session_usage.rs`（`query_session_usage` / `sync_session_usage`）——自建 sqlite 缓存：`session_usage_events` + `session_usage_meta` + `session_log_sync` 三张表，落在 `account::get_data_dir()`（desko 已把它指到 `<档案目录>/codex/`），按文件增量同步高水位。这是上游「用量面板」的数据底座。

另外上游还有一层「**账号配额**」的用量（5 小时/周百分比 + 重置次数）—— 这一条 desko **已经接了**，就是行内那三根 q-bar 和重置弹窗，别再当成缺口。

### 真拦路石：两处桩会让它当场炸

搬这一域**不能整文件 promote**（D1'' 的「keeper 与上游 diff 为空」前提在此域不成立），因为入口函数第一行就踩桩：

```rust
// 上游 codex_session_manager.rs:1574 / codex_session_usage.rs:472
let default_dir = modules::codex_instance::get_default_codex_home()?;   // desko 桩 → Ok(空路径)
let store = modules::codex_instance::load_instance_store()?;            // desko 桩 → Err("该能力已在裁剪版中移除")
```

- `load_instance_store()` 返 Err → 会话列表**整条调用当场失败**（错误会原样冒到前端）。
- `get_default_codex_home()` 在 desko 里是 `Ok(PathBuf::new())`（`modules/codex_instance.rs:54`）—— **比 Err 更阴险**：真把 store 那步补掉之后，`data_dir` 是空路径，扫描会落到进程当前工作目录，产出一份"看起来像会话列表"的空/错数据。

所以这一档要先做**单实例化改写**：desko 侧提供一个 `default_only_instances()`（`data_dir` 用官方 `~/.codex`，不读 instance store，`last_pid` 置空即 `is_instance_running` 恒 false——desko 的 `modules::process::collect_codex_process_entries` 本就是惰性空实现，不报错）。这是 §4 全域里**唯一需要写真 Rust** 的一块，其余 133 条的裁剪都是"整域不落地"，这块是"落地了但入口被桩截断"。

### 分档建议（替换 §5 里对应的粗线条）

| 档 | 内容 | 动 Rust? | 判断 |
|---|---|---|---|
| **S1** | 只读会话列表 + 每会话 token 统计（走 rollout jsonl 即时算，第 1 条路，不建缓存表） | **要**：单实例化改写 + 只搬只读可达闭包 | 与 desko 定位不冲突（只读文件，不改客户端行为）； rusqlite 依赖与 `state*.db` 读取路径 rev5 已经趟通，不是从零 |
| **S2** | 会话回收站（移入/恢复/彻底删除/清空） | 要（同一改写） | 会**真删官方 sessions 目录里的文件**，属于改客户端侧数据；要做就接 desko 已有的确认弹窗与备份语义，且默认关 |
| **S3** | 用量面板（第 2 条路：`session_usage` 三表增量同步 + 报表） | 要，且新增三张明文落盘表 | 值不值看 S1 用起来以后——先建缓存表等于替上游做数据迁移决策 |
| **S4** | 导入导出 / 跨实例同步 / `sync_threads_across_instances` / 打开会话位置 | 要 | 「跨实例」在 desko 单实例口径下语义不成立，**建议不做** |

## 4.2 配额自动更新：确实没有，而且断在两处

先厘清上游这套是怎么转的：**自动刷新不是 Rust 里的定时器，是前端调度器**。上游 `hooks/useAutoRefresh.ts` + `utils/autoRefreshScheduler.ts` 按 `UserConfig.codex_auto_refresh_minutes`（`modules/config.rs:103`，**默认 10 分钟**）和 `codex_auto_refresh_plan_types`（`:106`，默认全档位）定时调配额刷新命令；`lib.rs:716` 那段注释是决定性证据——「Keep the WebView alive so its configured quota refresh scheduler can continue updating the native menu bar」，Windows 上为了让调度器继续跑，关窗口只隐藏不销毁。

desko 后端其实**底座都在**，只是没人按时叫它：

| 已在册的部分 | 位置 | 状态 |
|---|---|---|
| 配额缓存 TTL | `modules/quota_cache.rs`（155 行） | 在，被动 |
| 刷新去重/合并/超时（`QUEUE_WAIT_TIMEOUT`/`REFRESH_TIMEOUT` 各 120s） | `modules/codex_quota_refresh_scheduler.rs`（327 行） | 在，但它不是定时器，只串行化并发刷新请求 |
| 索引里认 `quota_auto_refresh_minutes` 判配额陈旧 | `modules/codex_account_index.rs:1083` | 在 |
| 刷新后的后置检查：发 `quota:alert` + 低配额自动切号 | `commands/codex_account_commands.rs:1121` `run_codex_post_refresh_checks`，挂在 5 条配额刷新命令尾部（`:1302/1448/1497/1513/1547`） | 在 |

**断点一（没有触发时机）**：`src-tauri/src` 里没有任何 `interval`/周期 `spawn`，前端也没有——`CodexModule.vue:246` 的 `onMounted` 只跑 `refreshAccounts()`（= `list` + `current`，读缓存），**连进页面自动刷一次配额都没有**。于是 `:251` 那个 `quota:alert` 监听器实际上只可能在你手点「刷新配额」之后才响，等于挂了个哑事件。

**断点二 · 低配额自动切号整条链黑着。** `modules/config.rs:456-469` 五个键（`codex_auto_switch_enabled` 默认 **false**、`codex_auto_switch_primary_threshold` 20、`codex_auto_switch_secondary_threshold` 20、`codex_auto_switch_account_scope_mode` `"all_accounts"`、`codex_auto_switch_selected_account_ids`）随 codex-core 落地，`codex_account_mutations_quota.rs:992` `pick_auto_switch_target_if_needed()` 第一道闸门就读这个 flag，`run_codex_post_refresh_checks` 也原样在调它——但 desko 的 `CodexSettings.vue` 与 `api/codex.ts` 对这些键零引用：没入口，也没时机。

补法两档：

| 档 | 做法 | 动 Rust? | 备注 |
|---|---|---|---|
| **R1（推荐）** | 前端定时器：进 Codex 页起 `setInterval` 调 `refresh_codex_quotas_batch`，离开页面即停；设置·Codex 面板加「自动刷新间隔」下拉（关/5/10/30 分钟）与「低配额预警阈值」；顺带把 `quota:alert` 变成真会响的告警 | **不动** | 与 desko「小窗常驻、切走就该停」的形态一致；零后端改动，e2e mock 可全验 |
| **R2** | Rust 侧起周期任务（`tauri::async_runtime::spawn` + `interval`），窗口关了照刷，托盘能显最新余量 | 要（desko 自己的 `src-tauri/src`，不碰 codex-core） | 代价是要定生命周期口径——按 [[服务生命周期≠锁屏]] 的先例，只由「点停止/程序退出」收口；另外 `auto_switch` 若要用 `selected_group_ids` 圈范围，得先搬 §4 的「分组」域，v1 建议只按「全部账号」 |

**裁定（2026-10-11 用户明令）：desko 不做自动切号，永久排除。**
`codex_auto_switch_*` 五键保持零设置入口、零 UI，也不进任何后续档位——**R2 落地时同样不得打开**。好消息是这不需要动代码：`codex_auto_switch_enabled` 默认 `false`，`pick_auto_switch_target_if_needed()` 第一道闸门即返回 `Ok(None)`，`run_codex_post_refresh_checks` 里那条分支本就 no-op，剩下的只有 `quota:alert` 预警——正是 R1 需要的。
按 [[Respect Exclusions]]，这条不得在后续轮次被悄悄加回；若真要重开，得由用户重新提出。



## 5. 裁定建议（按「先还自家欠账」排序）

**T1 — 纯前端补 F2/F4/F5/F6 与 §3 的已声明字段，不动 Rust、不动 `keep_cmds.json`**
1. 切号中给「取消」（接 `codex_cancel_account_switch`，`switch-progress` 已带 `cancelled`）
2. API Key 账号可改凭据（⋯ → 「API Key 与地址」，接 `update_codex_api_key_credentials`）
3. 添加弹窗导入 tab 加「粘贴 JSON」（接 `import_codex_from_json`）
4. 行内落 `authorization_status` 徽标 + `quota_error` 悬停原因 + `last_used`
5. 订阅刷新从 `refresh_codex_account_profile` 升级为 `refresh_codex_subscription_info`
> 判据：这五条全在「账号管理 + 切号」的既有边界**内**，是当初只做了主干没做收尾。零后端改动，风险最低，收益直接。

**T1 追加（来自 §4.2 的 R1）**：配额自动刷新 + 低配额预警 —— 进页面起定时器、离开即停，设置·Codex 面板加「自动刷新间隔」「预警阈值」两栏。这条与上面五条同属零 Rust 改动档，且它决定 `quota:alert` 那个哑监听能不能活。自动切号已被用户明令排除，见 §4.2 裁定。

**T2 — 批量作业进度面（F1，11 条）+ 分组（需搬 2 条进册）**
要新开一个作业弹窗（预览/进度/暂停/续跑/重试失败），是真正"从半成品到成品"的一档。仍不动 Rust，但要新增 UI 结构。分组要先决定「desko 要不要分组」——它是上游账号页的视觉主干，会牵动 §行卡体系。

**T3 — 模型与配置面（F3，8 条）**
上游那套 quick config 是给"改 Codex 客户端行为"用的，和 desko 的定位（本地个人工作台，不代管客户端）有冲突。**建议先不做**，除非明确要接管 `config.toml`。

**T4 — §4 整域翻案（133 条）**
要重跑移植流水线（`port.py`/`rewire.py`/`trim.py`）、可能动 Cargo 依赖与表结构。**建议维持裁剪**，与 01-plan 一致。唯一值得单独议的是会话管理与 token 统计，已按 S1–S4 拆开，见 §4.1。

**收面选项**：若 T1/T2 都不做，下面这 23 条应从 `keep_cmds.json` 整条摘掉重跑流水线——F1 批量作业 11、F3 模型配置 8、F4 重复的 `refresh_all_codex_quotas`/`refresh_current_codex_quota`、`get_codex_config_toml_path`（设置页已用 `get_codex_storage_paths`）、`restore_codex_active_takeover_if_enabled`（已砍接管域残留，Rust 侧零调用）。按 R6，手删函数体是禁路，只能摘名单重跑。留着不用等于白送一个 `invoke` 可达面。

## 6. 本轮不做

- 不碰 `src-tauri/codex-core/` 的任何 keeper 文件（D1'' 要求与上游 diff 为空）。
- 不真机验证任何账号类动作（切号/删除/额度重置）；一律 `--mode e2e` mock。
- 不在本文里承诺 T2/T3 的排期，等点头。

## 7. 复现

对账脚本是一次性核验工具，放 `.tmp/`（全局 gitignore），**不入本仓库**；下面是不依赖脚本的等价命令。

```bash
UP='C:/Code/ai-question/.tmp/cockpit-tools/src'

# 层 1：上游前端调用的 codex 命令数（去重后 188）
grep -rhoE "invoke\(['\"][a-z0-9_]*codex[a-z0-9_]*['\"]" "$UP" --include=*.tsx --include=*.ts \
  | sed -E "s/invoke\(['\"]//" | sort -u | wc -l

# 层 2：desko 在册命令数（61）
node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/codex-core/keep_cmds.json','utf8')).length)"

# 层 3：前端已接数（28）= API 层出现的 invoke 名，全部能在组件里找到 codexApi.<method> 调用方
grep -oE "invoke\(\s*'[a-z0-9_]+'" src/services/api/codex.ts | sed -E "s/.*'//" | sort -u | wc -l

# 在册零入口（33）= 层 2 减去层 3；逐条确认无调用方：
#   grep -rn "<cmd>" src src-tauri/src | grep -v keep_cmds.json | grep -vE "fn <cmd>|codex::"
# 结构体字段差（CodexAccount 66 → 声明 24）：
#   正则抓 src-tauri/codex-core/src/models/codex.rs 的 `pub struct CodexAccount` 字段，
#   与 src/services/api/codex.ts 的 `export interface CodexAccount` 键名求差，
#   再拿差集在 src/components/codex/*.vue + src/services/codexState.ts 里 grep 是否出现。

# 闸门守卫（定义 = 注册 = 在册）
cargo test -p desko --bin desko gate_tests
```
