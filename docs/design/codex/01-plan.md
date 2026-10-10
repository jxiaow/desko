# Codex 账号管理模块集成方案（2026-10-09，rev4 · 已实现）

rev4 变更（实现定稿，取代 rev3 的施工计划）：

1. 路线由「5 处照搬 + 其余新写」改为**整域裁剪照搬**：Codex 账号域的文件逐字节从上游搬进子 crate `src-tauri/codex-core/`，被砍的域整体不落地，保留的流程里只删指向被砍域的分支语句。keeper 文件与上游 diff 为空。
2. 范围再收：rev3 仍保留的**定时唤醒（`codex exec` spawn + quota_reset 调度）与多实例 CODEX_HOME 隔离**，rev4 一并砍掉，只留「账号管理 + 切号」。
3. 存储不改：不再新建 `codex_accounts` 等四张表、不再把凭据密文塞进 desko 的 `data.db`；沿用上游自己的账号库（文件 + Windows 官方凭据存储），只把数据目录指到 desko 的档案目录下。
4. 命令面收敛到 **59 条**并以此为裁剪判据（见「命令注册表即裁剪边界」）。
5. 前端按 desko 风格重写（不是移植上游 Vue），模块藏在设置总开关后、默认关。

rev3/rev2 的身份与协议对齐清单（下文 §A–§I）**原样保留**：那是对上游逐字段核验的结果，也是本次照搬代码的行为说明书，仍然有效。

> 许可前提不变：desko 目前 private 且无 LICENSE，属私有自用；公开或商用时 CC-BY-NC-SA-4.0 的 SA/NC 条款对整体生效，见「许可与署名」。

## rev5（2026-10-10 增补）：切号收尾的会话可见性修复

rev4 的「只留账号管理 + 切号」漏了一步收尾：**切号会改写官方 `config.toml` 的 `model_provider`，官方客户端侧栏按这个键过滤 `threads`，凭据形态一变（OAuth ↔ API Key），旧会话会集体从侧栏消失**。上游对此的处置挂在多实例域（已砍），rev5 只把**单目标 quick 修复**搬回来并挂在切号之后：

1. 新增 2 条命令（`get_codex_history_visibility_provider`、`codex_repair_session_visibility_for_launch_target`）→ **在册命令 59 → 61**（D10 的判据同步，`keep_cmds.json` 已补两条）。
2. 修复实现按可达闭包整文件照搬上游（`codex_session_visibility*` 五件 + `backup_storage.rs` + `db.rs` 切片 + `codex_session_file_time.rs`），**由 D1'' 的「整域裁剪」扩展为「按可达闭包整文件搬」**；深修路径的 `rebuild_thread_metadata` 仍留桩，quick 不调它，不影响本次语义。
3. 触发点在前端 `codexState.switchTo`：切号前后各读一次 `model_provider`，**值变了才修**（同形态切号一次都不跑），修复使用上游自带改前备份、零联网，失败只降级成 error toast，不回滚已完成的切号。
4. 不搬会话管理产品面（`codex_instance.rs` 的多实例/看护/唤醒仍在砍掉的域里），也不引入 `codex_instances` 之类的表。

细节、决策与验收见 [`02-session-visibility-repair.md`](./02-session-visibility-repair.md)。

## 交付边界

一句话：**只保留「账号管理 + 切号」**（rev5 补了切号收尾的会话可见性修复，见下）。

不进 desko 的上游能力：代理引擎（mihomo / sing-box、账号级出口）、本地 API 网关（CLIProxyAPI sidecar、`/v1/responses` 反代、混合模型路由）、桌面 App CDP 注入、多实例与 Agent Identity、定时唤醒与调度、会话管理产品面（实例列表 / 看护 / 侧栏会话浏览，仅保留切号收尾用到的 quick 修复）、其他平台账号模块（trae / grok / claude / cursor / kiro / windsurf / qoder / opencode / deepseek / kimi …）、批量能力压测。

## 决策记录（as-built）

| # | 决策 | 理由 |
|---|---|---|
| D1'' | **整域裁剪照搬**取代 rev3 的混合路线：账号域代码逐字节搬，逻辑零重写 | 用户判据是「一定要和开源项目的一样，不然容易封号」。任何重写都是新的偏差面；裁剪只删可达路径，不改留存路径 |
| D4 | 后端独立子 crate `src-tauri/codex-core/` | 沿用 `fileshare-core` 先例；`Cargo.toml` 的 `members = ["fileshare-core", "codex-core"]`，keeper 代码里的 `crate::` 路径不用改 |
| **D7** | **codex-core 的 `version` 填上游当前版本串 `1.3.66`**，不用 desko 自己的 `0.1.0` | keeper 的身份头是 `env!("CARGO_PKG_VERSION")` 拼出来的 `Codex Desktop/{version}`（`codex_oauth.rs:54`），版本串换成 0.1.0 会发出一个上游从未发过的形态；填同版本让 keeper 文件保持零改动 |
| **D8** | **切号不重启、不拉起 Codex 进程**：`switch_codex_account(account_id, launch_after_switch: false)` | 上游的「切完顺手重启客户端」依赖受管进程/实例域（已砍）。desko 只改写官方凭据文件，页面标题行明说「切换前先退出 Codex 客户端」，把重启的主动权留给人 |
| **D9** | **账号库沿用上游存储**，数据目录经 `COCKPIT_TOOLS_DATA_DIR` 指到 `<desko 档案目录>/codex/` | 上游 `account::get_data_dir()` 本就优先读这个环境变量，改指一次即可，不必改任何路径解析代码；也不引入 desko 的 DB/加密改动面 |
| **D10** | **命令注册表即裁剪边界**：`keep_cmds.json` 列**在册**命令（rev4 基线 59 条，rev5 加 2 条会话可见性修复 → **61 条**），移植树里凡带 `#[tauri::command]` 且不在册的一律删 | 裁剪判据从「人肉点函数名」变成一张可审计的名单；`audit_cmds.py` 双向对账（在册未定义 / 定义未在册）必须都为 0。`src-tauri/src/main.rs` 的 `gate_tests::registered_codex_cmds_are_gated` 是同一条对账的常驻守卫（定义数 = 注册数 = 在册数） |
| **D11** | 模块总开关 `codex_enabled` 默认关，开关只放在设置「通用」面板 | 与 `mfa_enabled`、`fileshare_enabled` 同构：直敲 `/codex` 会被带回小记页，侧栏入口也不渲染 |
| D6 | codex-core 对 OpenAI 域名的请求走 reqwest（native-tls），不用 desko 现有的 ureq | 见 §R0；照搬之后这条自动成立——keeper 代码自带 reqwest。`codex-core/Cargo.toml` 的 features 串照抄上游并加 `socks,blocking` |

## 移植流水线

脚本在会话工作区（`C:\Code\ai-question\.tmp\`），**不入 desko 仓库**；仓库里只留产物。顺序与职责：

| 脚本 | 干什么 |
|---|---|
| `mk.sh` | 串起下面全部步骤，末尾跑 `cargo check` |
| `port.py` | 从上游克隆搬 hub（`commands/codex*`）、宿主插线（HOST 清单）、`models/`、被砍域的 stub 替身，生成 `modules/mod.rs`，搬 `include_str!` 的两份 JSON 资源 |
| `rewire.py` | 语句级删除：保留流程里指向被砍域（代理/网关/实例/注入）的分支、参数与调用 |
| `trim.py` | 声明清扫 + 整函数删除；**裁剪集由 `keep_cmds.json` 推导**（见 D10），带引用守卫：仍被调用的 helper 不删 |
| `proc.py` | 手切 `modules/process.rs`：只留 `find_pids_by_port` / `is_port_in_use`（OAuth 回调端口探测要用），其余进程枚举改成惰性空实现 |
| `slice.py` | 宿主插线切片（logger / config / i18n 等 desko 侧要接的口子） |
| `audit_cmds.py` `sig.py` `wire.py` `cmd_order.json` | 对账命令面、导出签名、把在册命令按序拼进 `generate_handler!`（rev5 的 2 条为手工追加，未重跑本流水线） |

四条搬入规则：**promote**（整文件逐字节）/ **slice**（切片搬，带出处注释）/ **stub**（被砍域入口留空实现，保持调用点原样）/ **rewire**（删分支不删函数）。

惰性替身的正当性：`collect_codex_process_entries` 返回空、`resolve_codex_pid*` 返回 `None`，等价于上游在「没有受管 Codex 运行时」时的返回值——被砍的域本来就不该有进程。

## 命令面（61 条）

前端 `src/services/api/codex.ts` 用掉 31 条（rev4 的 29 条 + rev5 的可见性修复 2 条）；其余是 keeper 逻辑同体的上游表面（批量导入/删除作业、模型配置导入导出、快捷配置、API Key 供应商同步），**未接入口但保留在册**，因为它们的 helper 与在册命令同体，硬拆会改到留存代码。

分组：

- 列表与当前：`list_codex_accounts` `get_current_codex_account` `get_codex_storage_paths` `get_codex_config_toml_path` `open_codex_config_toml`
- 切号：`switch_codex_account` `codex_cancel_account_switch` `restore_codex_active_takeover_if_enabled`
- 会话可见性修复（rev5）：`get_codex_history_visibility_provider` `codex_repair_session_visibility_for_launch_target`
- 配额与订阅：`refresh_codex_quota` `refresh_codex_quotas_batch` `refresh_all_codex_quotas` `refresh_current_codex_quota` `refresh_codex_account_profile` `refresh_codex_subscription_info` `get_codex_reset_credits` `consume_codex_reset_credit`
- 令牌：`force_refresh_codex_tokens`
- 账号编辑：`update_codex_account_name` `_note` `_tags` `_api_model_mappings` `delete_codex_account` `delete_codex_accounts`
- 新增与导入：`codex_oauth_login_start` `_completed` `_cancel` `codex_oauth_device_auth_start` `codex_oauth_submit_callback_url` `is_codex_oauth_port_in_use` `create_pending_codex_oauth_account` `add_codex_account_with_api_key` `add_codex_account_with_token` `update_codex_api_key_credentials` `update_codex_api_key_bound_oauth_account` `sync_codex_api_key_provider_accounts` `import_codex_from_local` `_files` `_json` `import_codex_access_token_account` `export_codex_accounts`
- 批量作业：`start/get/pause/resume/retry_failed/clear` `_codex_batch_delete`、`start/get/confirm/resume/cancel` `_codex_batch_import`、`get_codex_batch_import_preview`
- 模型配置：`export_codex_model_config` `import_codex_model_config` `preview_codex_model_config_import` `save_codex_model_catalog` `save_codex_quick_config` `get_codex_quick_config` `save_codex_context_management` `get_codex_model_reasoning_efforts`

**`close_codex_oauth_port` 是唯一被主动踢出名单的原候选**：它的实现要调受管 sidecar 的 kill 链（属被砍域），而 `is_codex_oauth_port_in_use` + 端口漂移提示已够 UI 用。

## 前后端契约（照搬之后仍要核对的三处）

1. **命名分界**：账号与配额模型（`models/codex.rs`）无 `rename_all` → 线上是 snake_case；OAuth 应答与路径结构体带 `#[serde(rename_all = "camelCase")]`（`CodexOAuthLoginStartResponse`、`CodexDeviceAuthStartResponse`、`CodexStoragePaths`）→ 线上是 camelCase；`codex_oauth_submit_callback_url` 内部是手搓 `json!({"loginId": ...})`。前端类型按这条分界写，mock 也必须按这条分界造，否则测试会替真实契约说谎。
2. **事件**：`codex:switch-progress` 三套形状混发——步进 `{accountId, step, stepStatus, progress, details}`、收口 `{accountId, type:"complete", stage, progress}`、失败 `{accountId, type:"error", error, canRetry}`；步名 `credentials/accessToken/refreshTokens/writeCredentials/syncSettings` 在前端翻成中文（`codexState.ts` 的 `SWITCH_STEPS`）。`codex-oauth-login-completed` / `-timeout` 带 `loginId`。`quota:alert` 是 snake_case（`current_email` `lowest_percentage` `threshold` …）。
3. **手动粘回调只收口一次**：后端在 `codex_oauth_submit_callback_url` 内部完成换码 + 落库 + 自己发 completed 事件，前端**只认事件**收口弹窗，不再在 invoke 返回后二次收口（否则第二次 `codex_oauth_login_completed` 会撞上「会话已结束」，把成功 toast 顶成错误）。

参数名走 Tauri 的 camelCase→snake_case 映射，`import_codex_from_files` 的形参是 `file_paths`（JS 侧必须传 `filePaths`）。已用脚本把 29 个 invoke 的实参与 Rust 形参逐条对过：多余参数 0，必填参数缺失 0。

## 宿主接线

`src-tauri/src/main.rs`：

- setup 里 `paths::profile_root().join("codex")` → `create_dir_all` → `set_var("COCKPIT_TOOLS_DATA_DIR", ...)` → `codex_core::set_app_handle(...)`。除此之外**不启动任何 codex-core 后台线程**（上游的网关/代理/实例看护都在那些线程里）。
- builder 注册 `tauri_plugin_opener::init()` 与 `tauri_plugin_notification::init()`：被砍域不带插件，但 keeper 代码里的 `AppHandle::opener()` / `notification()` 扩展走的是 `self.state::<T>()`，插件没注册会**直接 panic**，不是返回错误。
- `generate_handler!` 末尾按 `cmd_order.json` 追加 codex 命令（rev4 59 条，rev5 61 条）。

`src-tauri/Cargo.toml`：加 `tauri-plugin-opener`、`tauri-plugin-notification`（带 panic 缘由注释）；`windows` features 补 `Win32_Graphics_Gdi`——这是 desko 自己的 `session_lock.rs` 在 windows 0.61 下的漏项（`WNDCLASSEXW`/`RegisterClassExW` 按条目门控），与本次移植无关，顺手修掉。

`src-tauri/src/commands/settings.rs`：`ALLOWED_KEYS` 追加 `"codex_enabled"`。

## 协议等价审计与裁剪桩契约（2026-10-09）

- **逐字节核验**：`codex_oauth.rs`、`codex_quota.rs`、`codex_account_projection.rs` 与上游 `be24ce6` diff 为 0 行；`codex_account_token_refresh.rs` 仅少一行 `#[cfg(test)]` 声明。⚠️ 基准必须取 `git show HEAD:<path>`——`.tmp/cockpit-tools` 工作树被裁剪脚本改过 16 个文件（proxy_runtime 等），拿工作树当基准会得出"假逐字一致"。
- **HTTP 栈**：`cargo tree` 实证 codex-core 链接 reqwest 0.12.28 + native-tls 0.2.18（Windows 即 schannel），与上游 lock 逐版本一致；features 串照抄上游。
- **裁剪桩契约**：桩的返回值由活调用方决定，不由"能力已裁"决定——凡是会被 `?` 传播的桩返 Err，等于把核心流程当场炸掉，且编译与 mock 都盖不住。本轮炸出三处：① `codex_proxy_runtime::client_builder` 恒 Err → 刷新/配额/检查共 6 处网络调用全挂（本意是无代理透传，改为 `Ok(builder)`）；② `codex_speed::write_official_app_speed` 恒 Err 且切号命令 `?` 传播 → 每次切号直接报错（desko 切号只写 auth.json，桩改为透传 speed 返 Ok）；③ `load_instance_store` 恒 Err——已核实无活调用方（desko 唤醒/多实例不走实例 store），保持现状。
- 不可达即安全：`resolve_reauth_egress_proxy`（前端从不传 `reauthAccountId`）、quota 的 agentIdentity 分支（该形态拒绝入库）里的 Err 桩无需修。

## 前端落点

```
src/views/CodexView.vue                    壳
src/components/codex/CodexModule.vue       列表页：当前账号胶囊 / 刷新配额 / 选择 / 添加账号；
                                           账号卡（两档配额条 + 切换 + ⋯ 菜单）；本机与导入卡；批量 dock
src/components/codex/CodexAuthDialog.vue   添加账号：浏览器登录 / 设备码 / API Key 三 tab
src/components/codex/CodexEditDialog.vue   名称、标签、备注
src/services/api/codex.ts                  31 个 invoke + 与线上形状对齐的类型
src/services/codexState.ts                 账号列表单例、切号进度、配额与重置时间格式化、
                                           切号收尾的可见性修复触发（rev5）
src/services/codexFeature.ts               codex_enabled 读写（抄 fileshareFeature）
src/router/index.ts                        /codex
src/components/layout/Sidebar.vue          v-if 入口
src/components/settings/SettingsDialog.vue 「通用」面板开关
```

样式全走 `global.css` 既有令牌：动作按钮落 28px `action-btn` 档，行内动作沿用宿主的 `.grid-acts` hover 显形，行高与收藏/文件页同轴，等宽小字 Consolas，无入场动画，`.content-inner` 底部为 dock 预留 `--dock-clearance`。⋯ 菜单与行内快捷钮不重复动作（菜单只留低频项）。

## 验收（本轮实测）

- `cargo check -p codex-core` 0 error；`cargo build`（desko 全量）exit 0。keeper 文件在 Windows 下有 1 条 `unreachable expression` 警告（`codex_account_projection.rs:240`，cfg 结构自带），与上游同形，不改。
- `npx vue-tsc --noEmit` 0；`npm run build` 绿。
- `npx vitest run` 189/189。
- `npx playwright test specs/codex.spec.ts` **11/11**（默认关闸、开关开启、列表与切号、批量删除、改名、浏览器 OAuth 正误两条、设备码、端口占用、删除取消、本机导入与导出、API Key）。
- 全量 e2e：130 passed，2 failed 是 `notes.spec.ts` 里两条指向不存在按钮的既有用例（`.composer button[aria-label="插入待办项" / "插入行内代码"]`，`src/` 全仓查无此串），与本模块无关。
- 桩修复与死代码清理后复测：`cargo check`（全 workspace）过，codex e2e 11/11、vitest 189/189、`vue-tsc` 0。
- 截图（`shots/`，gitignore 内）：`codex-list` `codex-menu` `codex-batch` `codex-auth` `codex-device` `codex-apikey` `codex-list-ink`（墨底档）。

### rev5 复测（2026-10-10）

- 命令面对账：`#[tauri::command]` 定义 **61** = `main.rs` 注册 **61** = `keep_cmds.json` **61**；`cargo test -p desko --bin desko gate_tests` 2/2 通过。
- `cargo check -p codex-core` / `cargo check -p desko --all-targets` / `cargo build` 全 exit 0；唯一警告仍是 `codex_account_projection.rs:240` 的 `unreachable expression`（与上游同形）。
- `npx vue-tsc --noEmit` 0；`npx vitest run` **200/200**。
- `PW_CHANNEL=msedge npx playwright test specs/codex.spec.ts` **13/13**（新增两条：换凭据形态才修 / 修复失败只降级；既有切号用例加了「同形态不修」断言）。
- 全量 e2e：180 passed，2 failed 仍是 `notes.spec.ts` 的「插入芯片」两条既有红（与该模块无关），1 flaky 为 notes 配图用例（重试通过）。
- 截图（`shots/`，gitignore 内）：`codex-repair-info` `codex-repair-ok` `codex-repair-fail`（三档 toast 全窗）+ 同名 `-toast.png`（toast 本体特写）。

## 许可与署名

整 crate 是上游裁剪件，署名写在 `src-tauri/codex-core/src/lib.rs` 头部（来源 / 仓库 / 许可 / 改动摘要四行），`Cargo.toml` 的 `description` 亦注明「移植自 jlcodes99/cockpit-tools 裁剪版」。

desko 仍是 private 且无 LICENSE → 私有自用不触发 SA/NC。**一旦公开或商用**，先做三件事：仓库根放 CC-BY-NC-SA-4.0 的 LICENSE、`package.json` 与 `src-tauri/Cargo.toml` 补 `license` 字段、README 显著位置注明含上游衍生代码。

**上游漂移**：上游约 2–3 天发一版（本次基线 `be24ce6` / `v1.3.66`）。对照点集中在 §A–§I 的常量与判据；每月人工对照一次，**不做自动同步**——自动同步会把代理与网关代码再拖回来。同步时 keeper 文件仍走「整文件覆盖 + 重跑 rewire/trim」，不手改。

## §A–§I 身份与协议对齐清单（rev2/rev3 核验结果，仍然有效）

### A. 身份常量

| 项 | 值 | 出处 |
|---|---|---|
| `client_id` | `app_EMoamEEZ73f0CkXaXp7hrann` | `codex_oauth.rs:18` |
| `ORIGINATOR` | `Codex Desktop` | `:23` |
| `SCOPES` | `openid profile email offline_access api.connectors.read api.connectors.invoke` | `:24-25` |
| token / authorize 端点 | `auth.openai.com/oauth/token`、`/oauth/authorize` | `:20-21` |
| device 端点 | `.../api/accounts/deviceauth/usercode`、`.../token`；验证页 `auth.openai.com/codex/device`；`redirect_uri=https://auth.openai.com/deviceauth/callback` | `:36-39` |
| 超时 | token 请求 25s；device 总超时 900s；轮询 `interval` 缺省 5s；PKCE 超时 600s | `:34,40,41,29` |
| 刷新提前量 | access JWT `exp < now+300s` 视为过期；id_token 提前 600s | `:32-33` |
| 回调端口 | 1455，被占回退 1457；`is_codex_oauth_port_in_use` 在发起前探测 | `codex_oauth.rs` |

### B. 两套不同的 User-Agent

- **auth.openai.com 侧**（`apply_codex_auth_identity_headers`，`codex_oauth.rs:47-60`）：只设 2 个头部——`User-Agent: Codex Desktop/{CARGO_PKG_VERSION} ({OS}; {ARCH})`、`originator: Codex Desktop`。版本串即上游 crate 版本，**由 D7（codex-core `version = "1.3.66"`）保证与上游一致**。
- **chatgpt.com 侧**（`codex_desktop_user_agent`，`codex_quota.rs:1331-1355`）：`Codex Desktop/{official_client_version} ({OS标签} {系统版本}; {arch，aarch64→arm64})`，OS 标签取 `Mac OS|Windows|Linux`，`official_client_version` 优先级 = 用户配置 `codex_oauth_app_version` → remote-config 缓存 → 内置默认 **`26.820.60940`**。

### C. Device flow 的确切请求

```
POST .../deviceauth/usercode
  Content-Type: application/json, Accept: application/json
  身份头：无
  body {"client_id": CLIENT_ID}
  -> {device_auth_id, user_code, interval?}；两者任一为空即失败

POST .../deviceauth/token      （轮询，同上 headers，同样不加身份头）
  body {"device_auth_id", "user_code"}
  -> 2xx {authorization_code, code_verifier, code_challenge} 三者齐备才继续
     code_verifier 由服务端返回，本地不生成

POST https://auth.openai.com/oauth/token
  form-encoded，仅 5 个键：grant_type=authorization_code, code, redirect_uri, client_id, code_verifier
  无 scope / audience / state / code_challenge；用裸 client，不加身份头

刷新 POST https://auth.openai.com/oauth/token
  JSON body，仅 3 个键：client_id, grant_type=refresh_token, refresh_token
  headers = apply_codex_auth_identity_headers
```

刷新错误分类（`codex_account_token_refresh.rs:13-51`，小写 `contains` 匹配）：`unsupported_country_region_territory`→地区；`refresh_token_reused`→已轮换凭据被复用（不阻断健康状态/切号，需重新登录）；`refresh_token_expired`；`refresh_token_invalidated|token_invalidated|token_revoked|…|status=401`→服务端撤销/需重认证。这套分类随 keeper 代码原样搬入，未改写。

### D. 配额与套餐（两套头部策略）

| 调用 | 头部 |
|---|---|
| GET `chatgpt.com/backend-api/wham/usage`（超时 20s，无 query 无 body） | `Authorization: Bearer`、`Accept: application/json`、`originator: Codex Desktop`、codex 形态 UA、`ChatGPT-Account-Id`、FedRAMP 账号才加 `x-openai-fedramp: true`。**明确不带** Referer / sec-fetch / OpenAI-Beta |
| GET `backend-api/accounts/check/v4-2023-04-27`、GET `backend-api/subscriptions` | **伪装浏览器**：UA 固定 `Mozilla/5.0 … Chrome/147.0.0.0 Safari/537.36`、`Referer: https://chatgpt.com/`、`x-openai-target-path` 与 `x-openai-target-route` = 请求路径 |

`ChatGPT-Account-Id`：`account.account_id`，否则解 access_token JWT 的 `https://api.openai.com/auth.chatgpt_account_id`（回退 `account_id`）。

响应解析：`{plan_type, rate_limit, code_review_rate_limit, rate_limit_reset_credits}`；`rate_limit.{allowed, limit_reached, primary_window, secondary_window}`，primary=hourly、secondary=weekly；`window.{used_percent, limit_window_seconds, reset_after_seconds, reset_at}`。落库口径：`percentage = 100 - used_percent`（**界面上是「剩余 %」，100 = 满**）、`window_minutes = ceil(limit_window_seconds/60)`、重置时间存 `reset_at` epoch。**没有 `next_reset_at` 字段。**

> HTTP 库的默认 `User-Agent` 必须逐请求覆盖，不能让库兜底。

### E. 写盘格式（切号投影，`codex_account_projection.rs`）

`auth.json` 键序与 `skip_serializing_if = None`（`models/codex.rs:459-489`）：顶层 `auth_mode, OPENAI_API_KEY, base_url(别名 api_base_url/apiBaseUrl), tokens, agent_identity(别名 agentIdentity), personal_access_token, last_refresh`；`tokens = {id_token, access_token, refresh_token, account_id}`。

四种形态：API Key（`auth_mode:"apikey"`）、仅 access token（`{"OPENAI_API_KEY":null,"personal_access_token":"at-…"}`，**无 auth_mode**）、完整 OAuth（`auth_mode:"chatgpt"`、`OPENAI_API_KEY:null`、`tokens{…}`，`refresh_token` 恒为 Some、缺失写空串；`account_id` 取字段或 JWT claim；`last_refresh` chrono Utc）、AgentIdentity（识别但 desko 侧无入口）。写入策略 temp + rename 原子写；`restrict_auth_file_permissions` 仅 `#[cfg(unix)]` 生效，**Windows 下是 no-op**，与上游一致，不加 `icacls`。

`config.toml`：`forced_login_method` 只在用户已自行设置且与目标不一致时改写，**绝不新增该键、绝不创建 config.toml**；投影不写 `service_tier`。

> rev5 更正：rev4 这里写的「**desko 的切号投影 = 只写 auth.json**」不准确。照搬进来的 `codex_account_projection.rs`（与上游逐字节一致）在 **API Key 形态**下确实会写 `config.toml` 的 `model_provider`（值域 `openai` / `openai_api_key` / `cockpit_api` / `codex_local_access`）。**这正是会话可见性修复要存在的原因**——侧栏按 `model_provider` 过滤 `threads`，切到另一种凭据形态后旧会话会被过滤掉。

### F. 官方凭据存储（rev3 的待确认 3 就此关闭）

Windows 侧官方凭据不只在 `auth.json`：`codex_account_windows_auth_store.rs` 读 `<CODEX_HOME>/secrets/codex_auth.age`（age scrypt）与系统凭据项，`credentials_present()` 在查找失败时**保留档案而不是销毁**。该模块随 keeper 一起搬入，所以「导不到 Windows 官方凭据库」的担心不成立。macOS 侧的 `security find-generic-password` 分支同样在文件里（desko 只在 Windows 跑，不影响）。

### G. 导入识别顺序（`codex_account_import.rs:31-133`，顺序不能改）

AgentIdentity（`auth_mode`/嵌套字段/`credentials.{agent_runtime_id+agent_private_key}`）→ apikey（`auth_mode=="apikey"`）→ `personal_access_token` → 官方凭据存储快照（OAuth 必须走官方 store，不得用 auth.json 绕过）→ `tokens` → 回退 `OPENAI_API_KEY` → 全不匹配报 `未找到可导入的官方 Codex 凭据`。

### H. 上游已废弃的伪装

`codex_fingerprint_mode` 现在**只是导入/导出元数据，对线上请求无任何影响**（`models/codex.rs` 注释 "never projected into runtime credentials"）。取值 `off|device|session|full`，未设≡`off`。上游全仓**没有** `machine_id`/`session_id`/`install_id`/`Version` 头；唯一安装级标识是 `official_client_stable_id()`（`{data_dir}/codex-official-client-identity.txt` 里的 UUIDv4），只作为 authorize URL 的 `source_surface_stable_id` 与 `codex_origin_stable_id`，device flow 不带它。

### I. PKCE authorize query（记录备查）

`response_type, client_id, redirect_uri, scope, code_challenge, code_challenge_method=S256, id_token_add_organizations=true, codex_cli_simplified_flow=true, codex_streamlined_login=true, state, originator, codex_app_version, source_surface_stable_id, codex_origin_stable_id`；外层再包 `https://chatgpt.com/codex/desktop-auth?authorize_url=<enc>&codex_streamlined_login=true&no_universal_links=1`。

## 风险（as-built）

- **R0 指纹不一致**：随 D1'' 与 D6/D7 关闭到「与上游同形」——同一套 reqwest features、同一套身份头代码、同一个版本串。剩余差异是 desko 的进程身份（可执行文件名、签名），上游同样无法控制。
- **R1 refresh_token 单点**：同账号被官方 CLI 与 desko 同时刷新会互相踢出。desko 不后台刷令牌（只在列表刷新/切号时按上游提前量刷），`_reused` 按 §C 分类，不误判账号死亡。
- **R2/R3 私有端点与版本串漂移**：见「许可与署名」的月度人工对照；所有常量集中在 keeper 模块顶部，改一处即可。
- **R4 ToS**：定位个人本机工具，不外发、不对外供 API。
- **R5 明文 auth.json**：官方格式要求明文投影，上游 Windows 也不收紧 ACL，desko 与之一致。
- **新增 R6：命令面里有未接入口的在册命令**（批量作业、模型配置、API Key 供应商同步）。它们能经 `invoke` 直达，属上游行为的一部分；若后续要收面，只能整条从 `keep_cmds.json` 摘掉并重跑流水线，不能手删函数体。

## 已作废（rev3 及更早的条目）

D1 混合路线（5 处照搬）、D3 唤醒只走 CLI spawn、D5 凭据密文入 `data.db`；§5 唤醒 argv 与 quota_reset 调度判据；`codex_accounts` / `codex_switch_history` / `codex_wakeup_runs` / `codex_instances` 四张表；`codex_wakeup*` / `codex_instance*` 命令；F1–F3 分期与「一次性抓包抽检」（照搬之后线上形态与上游同构，抽检不再是前置）；待确认 1–5（依次由 D6、D7、§F、范围裁剪、未做托盘集成关闭）。
