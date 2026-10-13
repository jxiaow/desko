# CodexAccount 字段差判定（13 设计稿 · 2026-10-12）

补 `06-port-gap-audit.md` 三层账里那条「结构体字段差（`CodexAccount` 66 → 声明 24）」。用户 2026-10-12 放行最小集（原话「开始」），本稿是判定 + 一条接入口。

## 1. 一句话结论

42 条未声明里 **34 条属已砍域或后端内部态**（永远 `None`/`false`，声明了就是死字段）、**6 条是凭据与 PII**（约定禁止进前端）、**1 条待拍板**（额度历史曲线），真正该接的只有 **1 条：`reauth_reason`**——切号失败时后端已经把原因写进这个串，行上那颗「需重新登录」徽标却把它丢了。

## 2. 取证法（不是数名字，是数写点）

脚本 `.scratch/fieldgap.mjs`（不入库）：从 `models/codex.rs` 的 `pub struct CodexAccount` 逐字段取 `rust 名 / 类型 / serde rename 与 alias / skip_serializing_if`，与 `src/services/api/codex.ts` 的 `export interface CodexAccount` 键名求差（**该结构体没有 `rename_all`，线上键名就是下划线**，与 11 号稿 §5.2 同一条），再对每个差集字段在 `src-tauri/**`（除定义文件）与 `src/**` 里数 `\b` 引用点。

判据是「**有没有活的写点**」：只看类型声明会漏判，只看命令注册会误判——所以三个候选字段各追到函数级：

| 字段 | 写点 | 结论 |
|---|---|---|
| `reauth_reason` | `codex_account_revoked_access.rs:30`（撤销访问）、`codex_account_runtime_switch.rs:129`（**切号失败把 `user_error` 原样写入**）；清位有 4 处 | 写点在 desko 的活路径上（切号与配额刷新都会走） |
| `client_auth_status` + `last_client_auth_observed_at` / `last_client_login_redirect_at` / `last_client_launch_at` / `last_client_auth_instance_id` | 唯一写函数 `update_client_auth_observation`（`codex_account_token_refresh.rs:225-243`）**零调用方**（`grep -rn update_client_auth_observation` 除定义外无命中） | 观测者属实例 CDP 域，desko 没带 → 永远 `None` |
| `team_quota_history` | 15 处命中全在 `models/codex.rs` 自身（类型与默认值） | 填它的是上游团队额度曲线，A2 那轮明确「额度历史曲线本轮不做」→ 待拍板 |

## 3. 42 条判定表

### 3.1 接（1 条）

| 字段 | 类型 | 为什么接 |
|---|---|---|
| `reauth_reason` | `Option<String>` | 行上 `requires_reauth` 为真时已经出「需重新登录」黄徽标（`CodexModule.vue:470`），但为什么登不上——令牌被撤销 / 切号时上游报错——后端早算好了，界面丢掉了。接法：徽标 `:title` 挂这个串，与「待授权」那颗同一写法（`:471` 已挂 `授权状态：…`） |

### 3.2 禁止声明（6 条，凭据与 PII）

`openai_api_key`（API Key 明文）、`two_factor_secret`、`account_password`、`phone_number`、`mail_url`、`agent_identity`（内含 `agent_private_key`，`models/codex.rs` 的 `CodexAgentIdentity`）。

这 6 条**不是「还没接」，是永不进前端类型声明**：声明了就会有第二个念头去渲染。前端唯一的 `openai_api_key` 字样是 `CodexAuthDialog.vue:338` 粘贴框的格式示例串，不读值。§5 另记一笔它们今天确实过 IPC。

### 3.3 已砍域，永久不声明（26 条）

- **API 服务池 / 模型改写（12）**：`api_provider_mode` `api_provider_id` `api_model_catalog` `api_model_context_windows` `api_model_mappings` `api_sync_model_catalog_to_codex` `api_wire_api` `api_supports_websockets` `api_supports_vision` `api_model_vision_support` `api_vision_routing_model` `app_speed` —— 宿主是 S7 摘掉的 F2 后 4 条与本地接入网关（49 条未入册整域）。desko 只留了 `api_provider_name` / `api_base_url` 两条只读事实（已声明，API Key 行的元信息）。
- **实例与 sidecar（3）**：`api_instance_access_mode` `api_startup_model` `api_image_generation_account_ids` —— 实例域 24 条未入册。
- **本地网关绑定（2）**：`bound_oauth_account_id` `bound_oauth_use_local_gateway`。
- **Grok 上游（1）**：`upstream_grok_account_id`（`add_codex_account_from_grok` 未入册）。
- **客户端认证观测（5）**：`client_auth_status` + `last_client_*` 4 条 —— §2 已证零写点。
- **出口代理（2）**：`egress_proxy_url`（注意它 `serialize_with = serialize_summary`，出网的是摘要不是 URL 本身）、`egress_proxy_disabled` —— 宿主 `test_codex_account_egress_proxy` 等 4 条未入册。desko 的「直连清单」是系统代理规则，与账号级出口代理不是一回事，不借这个字段。
- **历史备份元数据（3）**：`codex_fingerprint_mode` `codex_cli_only` `codex_cli_only_allow_app_server` —— 结构体注释逐字写着「Legacy import/export metadata only」「历史备份元数据；不再限制客户端」，上游自己都不读。

### 3.4 后端内部态，不声明（8 条）

`token_generation`（令牌代际计数）、`token_source_mode`、`subscription_query_last_attempt_at` / `_last_success_at` / `_next_retry_at` / `_last_error`（订阅刷新的节流与退避，写点全在 `codex_quota.rs`）、`team_quota_history`（§3.5）。

这些是「后端怎么决定下一步做什么」的状态，不是「用户要看的事实」。前端要的同义信息另有出口：令牌新鲜度看 `token_updated_at` / `usage_updated_at`（都已声明），订阅失败看 `quota_error`（已声明）。

### 3.5 待拍板（1 条）

`team_quota_history`：接它等于把 A2 那轮明确摘掉的「额度历史曲线」再放回来。要放就该单独一轮（数据形状、按天还是按周、和 `.usg-col` 那套两段柱怎么同屏），不在本稿顺手做。

## 4. 本轮执行面（只此一条）

1. `src/services/api/codex.ts`：`CodexAccount` 补 `reauth_reason?: string | null`。
2. `src/components/codex/CodexModule.vue:470`：那颗徽标挂 `:title`，无串时退回原文案。
3. e2e：fixture 里给一条 `requires_reauth: true` + `reauth_reason`，断言徽标 `title` 含该串；`codex-shots.mjs` 的 `codex-pending-fields.png` 那一帧顺手把这条摆上（该帧已有「待授权 / 配额拉取失败」两态，加这一态不新增帧）。

不新增命令、不动 Rust、不改在册账（62 不动）。

## 5. 记档不动手：凭据确实过 IPC

`list_codex_accounts()` 返回 `Vec<CodexAccount>`（`codex_account_commands.rs:513`），`get_current_codex_account()` 同理，共 **20 处**命令返回该结构体或其 `Vec`。这 6 条凭据字段里除 `Option::is_none` 会省掉空值外，**只要有值就随响应进 webview**：

- `tokens: CodexTokens` 是 `#[serde(default)]`，**没有** `skip_serializing_if` → `access_token` / `refresh_token` 每次列表都完整出网（desko 的档案在盘上是密文，这一段是解密后的响应）。前端只读 `tokens.id_token` 解 `auth_provider`（`CodexModule.vue:152`）。
- 导入路径能把 `account_password` / `two_factor_secret` / `phone_number` / `mail_url` 填进来：这四条带 camelCase `alias`（`models/codex.rs`），官方导出 JSON 里有就吃得进。desko 自己的 UI 不传（`update_codex_account_note` 那四条可选参数前端从不给），但**导入过的第三方档案可能带**。

**为什么不用 `#[serde(skip_serializing)]` 一把改**：档案落盘走的是同一个 `Serialize`（`secure_account_storage::serialize_account_file`），加了就是**存的时候丢凭据**，切号当场炸。

**真要修的正确形状**（单独一轮，本稿不动）：加 `CodexAccount::redacted_for_client()`，在 §5 那 20 个命令边界上套，保留 `tokens.id_token`、丢掉其余凭据与 PII；`export_codex_accounts` 返回 Rust 侧拼好的 `String`（`:1382`），不经这条路，导出不受影响。代价是 20 处返回点逐个过一遍，且要给「序列化后不含这些键」补一条 Rust 单测。

desko 定位是本地个人工作台、不是保险箱（`docs` 里那条老裁定），所以这一条记为**加固项**而非漏洞；要不要动，等拍板。

## 6. 判据

1. `npx vue-tsc --noEmit` 0；`npx vitest run` 全绿。
2. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` 全绿，含新增那条「需重新登录」徽标 title 断言。
3. `node scripts/codex-shots.mjs` 仍 **21 帧全部为本次新拍**（`codex-pending-fields.png` 内容变了但不加帧）。
4. `.scratch/fieldgap.mjs` 复跑：未声明 42 → **41**，且差集里再不含任何有活写点的字段。
5. 真机零点击（`reauth_reason` 只在 mock 上验）。

## 7. 交付结果（2026-10-12）

判据 5 条全部实测通过：

| 判据 | 实测 |
|---|---|
| `npx vue-tsc --noEmit` | 0 错误（"vue-tsc OK"） |
| `npx vitest run` | Test Files 17 passed / Tests 224 passed |
| `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` | 55 passed（12.6s），含新增的 `toHaveAttribute('title', /令牌已被撤销/)` |
| `PW_CHANNEL=msedge node scripts/codex-shots.mjs` | **21 帧全部为本次新拍**，未加帧；`codex-pending-fields.png` 现是四行：当前/PRO、待授权、**需重新登录 + PLUS**、配额拉取失败 |
| `.scratch/fieldgap.mjs` 复跑 | Rust 66 / 前端声明 **25** / 未声明 **41**（原 24 / 42），差集里不再含有活写点的字段 |

落地的四处：

1. `src/services/api/codex.ts` — `CodexAccount` 补 `reauth_reason?: string | null`（带一条注释说明串来自 `codex_account_runtime_switch.rs:129`，只上徽标 title）。
2. `src/components/codex/CodexModule.vue:470` — `<span v-if="a.requires_reauth" class="badge warn" :title="a.reauth_reason || undefined">需重新登录</span>`；与 `:471`「待授权」那颗同一写法。
3. `e2e/mocks/backend.ts` 三处（fixture 旋钮 `reauth_reason?`、DTO 类型 `reauth_reason: string \| null`、构造器 `a.reauth_reason ?? null`）；`e2e/specs/codex.spec.ts` 那条用例改名「待授权、需重新登录的原因、配额失败原因与上次使用都落在行内」，并加了一条**只有** `reauth: true` 不带串的账号，断言 `not.toHaveAttribute('title')` —— 防止「无串也挂个空 title」。
4. `scripts/codex-shots.mjs` — `FIELD_ACCOUNTS` 三种状态 → 四种（`reauth@e2e.dev`，串写成「令牌已被撤销，请重新登录（悬停才出这一串）」，让拍帧自解释为什么图里看不到这行字）。

真机零点击：本轮只在 `*@e2e.dev` fixture 上验，`~/.codex` 未读写。

§5 那条「凭据过 IPC」的加固按约定**没动**——它要改 20 个命令返回点并补一条序列化单测，等拍板。

未声明 41 条的构成随本轮判定不变：34 已砍域/内部态 + 6 凭据与 PII + 1 待拍板（`team_quota_history`）。
