# 24 · Codex 桌面挂件：锁定后继续刷新（2026-10-26，已落码）

一句话方案：**应用锁定后挂件窗口继续留在桌面，主窗口的挂件服务按「配额自动刷新」的间隔调用一条新的只读命令，刷新当前账号额度与本机今日用量；锁屏只拿到渲染需要的聚合值，拿不到账号、邮箱或任何凭据。**

状态：**已拍板、已落码**（2026-10-26）。用户要求原文：「锁定后，如果有挂件，这块儿的数据也需要更新的」；拍板回复「开始」。落地与验证见 §10。

## 1. 现状：文档说隐藏，代码已改成保留但冻结

| 位置 | 现在的行为 |
|---|---|
| `src/App.vue:91-117` | `finishLock()` 第一件事是 `suspendCodexHudData()`，挂件不隐藏 |
| `src/services/codexHud.ts:231-236` | 锁定只保存最近快照、`dataActive=false`、释放配额 ticker；期间不读账号 |
| `src/services/codexHud.ts:146-164` | 锁定时推 `locked:true`，HUD 第三行显示「解锁后更新」 |
| `src/services/codexState.ts:114-129` | `clearCodexSession()` 清空账号与今日用量、停全局 ticker |
| `src/components/codex/hud/CodexHudSprite.vue:262-265` | `locked` 时第三行替换掉今日成本 |
| `docs/design/codex/20-quota-hud.md:174/477/567`、`23-hud-behavior-redesign.md:170` | 仍写「锁定立即隐藏 / 不展示任何数据」 |

漂移来源：`56b388c`（2026-10-24）把 `finishLock` 从 `deactivateCodexHudBridge()`（隐藏）改成 `suspendCodexHudData()`（保留冻结快照），文档没跟。本文件把锁定行为定成全量版本，并补上刷新链路。

## 2. 拍板点

| 决策 | 选择 | 理由 |
|---|---|---|
| 锁定时窗口 | 保留显示；开关关 / 模块关 / Alt+F4 仍销毁 | 用户要的是「锁定后还能看到并更新」，不是把挂件收起来 |
| 锁定期间刷新什么 | 当前账号额度 + 本机今日用量 | 挂件只渲染这两个数；账号列表不进锁屏 |
| 刷新节奏 | 沿用 `codex_quota_auto_refresh_minutes`（5/10/30 分钟）；0=不轮询 | 用户关掉自动刷新就该真的不联网；设置页已有 warning |
| 锁定那一拍 | 立即刷一轮，随后按间隔轮询 | 锁屏第一眼不应该停在几小时前的数 |
| 锁定时的刷新范围 | 只刷当前账号；不跑自动切号、不更新托盘、不发配额预警 toast | 锁屏只负责展示；切号/托盘/提醒都属于解锁态的用户动作 |
| 失败 | 保留上一份快照；额度错误进 `quota_error`，挂件按既有 `stale` 显示 | 不因一次网络失败把数字清空 |
| 锁定态文案 | 删掉 `locked` 标记与「解锁后更新」，第三行始终显示今日成本/状态 | 数据已经会更新，原提示变成假话；成本行是有效信息位 |
| IPC 数据边界 | 新命令只回 `auth_mode / authorization_status / quota / quota_error / usage_updated_at` + `today{tokens,costUsd}` | `CodexAccount` 完整结构含 token 与 API Key，绝不能整包回前端 |
| 新命令授权 | 不要求 master key；要求 Codex 模块开 + 挂件开 + HUD 窗口存在 | 锁屏没有 master key，但账号详情用机器本地密钥加密，后端能读；命令名走 `desko_hud_*`，避开 `is_codex_command` 闸门 |

## 3. 后端：一条只读命令

### 3.1 命令

`src-tauri/src/commands/hud.rs` 新增：

```rust
#[tauri::command]
pub async fn desko_hud_refresh_locked(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<HudLockedPayload, String>
```

无参数。今天的窗口由后端按本地时区算（不信任前端传时间范围），与前端 `usageWindowFrom('today')` 同为「本地零点 → 现在」。

### 3.2 返回结构

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HudLockedPayload {
    account: Option<HudLockedAccount>,
    today: Option<HudLockedToday>,
}

#[derive(Serialize)]
struct HudLockedAccount {           // 保持 snake_case，与前端 CodexAccount 字段一致
    auth_mode: CodexAuthMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    authorization_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota: Option<CodexQuota>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_error: Option<CodexQuotaErrorInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage_updated_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HudLockedToday { tokens: u64, cost_usd: Option<f64> }
```

`quota.raw_data` 保留：额外额度窗口与 Credits 的映射依赖它。`id / email / tokens / openai_api_key / account_name` 等字段在结构上就不存在，不靠事后过滤。

### 3.3 流程

1. 校验：`codex_enabled == "true"`、`codex_hud_enabled != "false"`、`app.get_webview_window("codex-hud").is_some()`；任一不满足返回 Err。
2. `codex_account::get_current_account()`；无当前账号 → `{ account: None, today }`。
3. 并行：
   - 额度：`codex_quota::refresh_quotas_for_account_ids_in_background(&[id], true)`（与未锁定时 HUD ticker 同一条批量路径：后台优先级、尊重分组刷新策略、超时 120s）；不看单账号返回值成功与否。
   - 用量：`tauri::async_runtime::spawn_blocking(|| codex_session_manager::query_session_usage(Some(day_start), Some(now + 1)))`，只取 `totals`。
4. 无论额度刷新成功/失败，重新 `load_account(&id)` 取最新 `quota / quota_error / usage_updated_at`（刷新失败时错误已落盘），组装 `account`。
5. 用量扫描失败 → `today: None`，前端保留同一天上一份；额度批量调用本身 Err（队列/线程级）→ 整条命令 Err，前端保留旧快照。

### 3.4 明确不做

- 不调 `run_codex_post_refresh_checks`：锁屏不自动切号。
- 不调 `codex_core::modules::tray::update_tray_menu`：托盘不是常驻数据面。
- 不调 `checkQuotaAlert`：锁屏不弹用量 toast。
- 不刷新全部账号：挂件只显示当前账号。

## 4. 前端：锁定 ticker

### 4.1 数据与类型

- `src/utils/codexQuota.ts` 导出 `CodexQuotaAccount = Pick<CodexAccount, 'auth_mode' | 'authorization_status' | 'quota' | 'quota_error' | 'usage_updated_at'>`，`codexQuotaWindows` / `codexAdditionalQuotaWindows` / `codexCredits` / `codexQuotaRemaining` 的入参从 `CodexAccount` 放宽到它；`CodexHudSource.account` 同宽。完整 `CodexAccount` 天然可传，纯类型改动。
- `src/services/codexHud.ts` 新增锁定态局部状态：`lockedTimer`、`lockedTask`、`lockedStarting`、`lockedTodayDay`。
- 命令直接 `invoke<HudLockedPayload>('desko_hud_refresh_locked')`，不新增 API wrapper。

### 4.2 生命周期

| 时刻 | 行为 |
|---|---|
| `suspendCodexHudData()` | 保存快照 → `dataActive=false` → 释放常规 ticker → `startLockedRefresh()` |
| `startLockedRefresh()` | 条件：`active && hudWanted && hudReady && !dataActive && isTauriRuntime()`；`await loadQuotaSettings()` 后若 `minutes <= 0` 直接返回；先 `refreshLockedData()` 再 `setInterval(minutes * 60_000)`；同一条 ticker 已在跑不重复起 |
| `refreshLockedData()` | `lockedTask` 在跑就跳过；调命令；成功且仍锁定 → 用返回的 account 重建 `lockedSnapshot`，`today` 非空才替换并记 `lockedTodayDay`；失败静默保留旧快照；结束 `pushState()` |
| HUD ready / 窗口已存在后 show | 若 `!dataActive` 也调 `startLockedRefresh()` |
| `activateCodexHudBridge()`（解锁） | `stopLockedRefresh()`；清 `lockedSnapshot`；走原有 `ensureHudData()` |
| `hideHud` / `closeFromHud` / `deactivate` | `stopLockedRefresh()` |
| 开关关 / 模块关 | 走 `syncHudWindow` → `hideHud` → 停 ticker |
| 跨天 | 每次刷新前若 `lockedTodayDay !== localDayKey(new Date())`，先把快照 `today` 置 null，避免 0 点后沿用昨天的数 |

并发闸：`lockedTask` 保证网络未回来不叠第二轮；`setInterval` 固定节拍，错过的拍不补。

### 4.3 锁屏仍不读的东西

不调 `refreshAccounts()`、不调 `loadTodayUsage()`、不读 `currentAccount` / `accounts`；`lockedSnapshot` 只由本命令返回的聚合值构建。解锁后仍走原 `ensureHudData()`。

## 5. UI

- `CodexHudSprite.vue`：删掉 `locked` prop 与「解锁后更新」分支；第三行恢复 `statusMessage / costValue` 原逻辑。
- `CodexHudApp.vue`：删 `locked` ref、payload 读取、aria 的「应用已锁定，解锁后更新」后缀。
- `src/utils/codexHud.ts`：`CodexHudEventPayload` 删 `locked` 字段。
- 冷启动锁屏、还没有快照时仍显示占位「应用已锁定」（`codexHud.ts:152`），第一次刷新回来即被真实数据替换；这不是冻结提示，只是「还没数」。

## 6. 安全边界

- 账号详情（token）用 `secure-account-storage.key` AES-256-GCM 加密，密钥在机器本地，**不需要 master password**（`src-tauri/codex-core/src/modules/secure_account_storage.rs:1-37`）；锁定只清 `AppState.master_key` 与前端账号列表，后端仍能读账号文件。
- 新命令越过 `authorize_codex`（`main.rs:90-100`）的 master key 条件，但没有越过数据边界：返回结构里没有 id/email/token/API Key/账号列表，只有渲染需要的额度与今日总量。
- 命令名不叫 `codex_hud_*`，否则会被 `is_codex_command`（`main.rs:74-87`）命中并被 master key 闸门挡住；`desko_hud_*` 是现有挂件命令的命名约定。
- 额外保留三道服务端闸门：模块开、挂件开、HUD 窗口存在；没挂件就没有这条数据通道。
- 代价：锁定期间的额度刷新会像未锁定一样使用该账号 token 调上游；若 access token 过期会触发既有 token 刷新流程。这是「数据继续更新」的必要条件，不新增凭据落盘格式。

## 7. 测试与验收

### 7.1 单测（`src/services/codexHud.lifecycle.test.ts`）

- 锁定：立即 invoke `desko_hud_refresh_locked`；成功后 `emitTo` 的 state 换成新额度/新 today；窗口不 hide/destroy。
- 节拍：fake timers 前进 10 分钟 → 第二次 invoke；`quotaRefreshMinutes=0` → 不 invoke、不起 timer。
- 解锁：再前进一个间隔不再 invoke；`desko_hud_show` 仍只有一次。
- 失败：invoke reject → 旧快照保留，无未处理 rejection。
- 跨天：`lockedTodayDay` 是旧日期时先清 today。
- 改 `CodexHudApp.test.ts:260-267`：锁定快照仍显示 68% 与今日成本，不再出现「解锁后更新」与「应用已锁定」aria。

### 7.2 Rust

- `hud.rs` 单测：`HudLockedAccount` 序列化后键集合只有五个，断言没有 `tokens / email / id / openai_api_key`。
- `main.rs` 既有 `desko_codex_dialog_is_gated_and_other_own_commands_are_not` 自动覆盖新命令名不被当成 codex 命令。
- `cargo check --all-targets`。

### 7.3 门禁

`vue-tsc --noEmit`、`vitest run`、`cargo check --all-targets`。

### 7.4 原机验收

- 起 `tauri dev`，锁屏，观察 HUD 不消失；把 `codex_quota_auto_refresh_minutes` 临时设 5，等 5 分钟看数值/`usage_updated_at` 变化；解锁后确认常规路径恢复。
- 只做锁定/解锁与自动刷新，不切号、不删除、不点额度重置；账号动作仍只跑 e2e mock。
- 若当前没有可刷新账号，则验「无账号 → 占位 + 不报错」与单元测试；另在隔离档案 `com.desko.hudtest` 验窗口/闸门路径（该档案无账号，不能验真实刷新）。

## 8. 改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/commands/hud.rs` | 新命令、闸门、sanitized 结构、用量扫描、单测 |
| `src-tauri/src/main.rs` | 注册 `desko_hud_refresh_locked` |
| `src/utils/codexQuota.ts` | `CodexQuotaAccount` 放宽入参 |
| `src/utils/codexHud.ts` | `CodexHudSource.account` 放宽；删 payload `locked` |
| `src/services/codexHud.ts` | locked ticker、快照更新、生命周期接点、删 locked 推送 |
| `src/components/codex/hud/CodexHudApp.vue` | 删 locked ref / aria / 传参 |
| `src/components/codex/hud/CodexHudSprite.vue` | 删「解锁后更新」分支与 locked prop |
| `src/services/codexHud.lifecycle.test.ts` | 新增锁定 ticker 用例、改 locked 断言 |
| `src/components/codex/hud/CodexHudApp.test.ts` | 改锁定文案用例 |
| `docs/design/codex/20-quota-hud.md` | 锁定语义改指向 24；ticker / 生命周期 / 验收表同步 |
| `docs/design/codex/23-hud-behavior-redesign.md` | 「锁定隐藏/解锁恢复」改为「锁定保留并继续刷新」 |

## 9. 风险 / 未决

- 配额自动刷新设 0 时锁定不轮询：这是既有设置语义，设置页已有 warning；如果要求「锁定后无条件刷新」，需要单独改这条设置的口径。
- 锁定时不自动切号：当前账号额度耗尽时挂件就显示 0%，不会替用户换号；换号属于解锁态动作。
- 冷启动锁屏第一帧可能先显示「应用已锁定」占位，取决于首次网络往返；不会显示假数字。
- 原机验收依赖当前账号可刷新；若无法在真机上安全验证，以单测 + Rust 序列化测试为准并在落地记录里注明。

## 10. 落地记录（2026-10-26）

| 项 | 结果 |
|---|---|
| Rust | `commands/hud.rs` 新命令、三道闸门、sanitized 结构、本地零点用量扫描；`main.rs` 已注册。`hud::tests` 2 例通过 |
| 前端 | `CodexQuotaAccount` 放宽额度映射入参；挂件桥新增锁定 ticker、跨天清理、迟到结果作废；删除 payload `locked`、HUD 的「解锁后更新」与「应用已锁定」aria 后缀 |
| 单测 | `vitest run` 69 文件 829 例全绿（含生命周期新增 5 例：立即刷新、节拍、0=关、失败保留、跨天） |
| 类型/编译 | `vue-tsc --noEmit` 0 error；`cargo check --all-targets` 通过（只有仓库既有 warning） |
| 原机复验 | **本轮未跑**。用户安装版 `C:\Users\jxiaow\AppData\Local\Desko\desko.exe` 正在运行，dev 实例会被单实例锁挡住；隔离档案 `com.desko.hudtest` 无账号，验不了真实额度刷新。按 §7.4 兜底，以单测 + Rust 序列化测试为准；未触碰真实账号与真实口令。下次关闭运行中的 Desko 后可补：启用挂件 → 锁屏 → 等一个刷新间隔看数值/`usage_updated_at` → 解锁确认常规路径恢复 |

与 §4.2 的两处实现补充：

- `stopLockedRefresh()` 递增 `lockedEpoch` 并把 `lockedTask` 置空：解锁或隐藏时还在飞的请求回来也不会改快照；解锁后立刻再锁，新周期的立即刷新不会被上一轮请求挡住。
- `refreshLockedData()` 除并发闸外还检查 `active / hudWanted / hudReady`；窗口已被销毁时不再发起命令。
