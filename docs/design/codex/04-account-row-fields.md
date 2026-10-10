# Codex 账号行信息面（rev1 · 2026-10-10）

对拍稿：`docs/design/codex/03-page-redesign.src.html`（帧 A/B 就是本轮行形态）。
改稿重跑：`node scripts/mock-build.mjs docs/design/codex/03-page-redesign.src.html docs/design/codex/03-page-redesign.html`

## 0. 结论先行：零后端改动

数据早在链路上。`list_codex_accounts` → `codex_account::list_accounts_checked()`
（`src-tauri/codex-core/src/modules/codex_account_index.rs:1241`）逐条读账号**详情文件**，
返回整份 `CodexAccount`（`src-tauri/codex-core/src/models/codex.rs:177-347`）。

缺的只是前端：`src/services/api/codex.ts` 的 `CodexAccount` 只声明了 18 个字段，
行内实际只画了 6 个。**本页不新增命令、不动 keep_cmds.json、不动 Rust。**

## 1. 逐字段映射

### L1 身份行

| 文案 | 后端字段 | 规则 |
|---|---|---|
| 名称 | `account_name` ‖ `email` | 原名 `account_name`，空则邮箱 |
| `当前` | `id === currentId` | 只在这一处标，页栏不再重复 |
| `需重新登录` | `requires_reauth` | warn 色 |
| 等级徽标 `PRO`/`PLUS`/`TEAM` | `auth_file_plan_type` ‖ `plan_type` | 大写、等宽、中性底 |
| `API Key` | `auth_mode === 'apikey'` | |

### L2 身份事实行

| 文案 | 后端字段 | 规则 |
|---|---|---|
| `Team Name：个人账户` | `account_structure` | 含 `personal` 或为空且 `plan_type` 非 team → 「个人账户」；否则 `organization_id` 掩码，兜底「团队账户」 |
| `使用 OAuth 登录` | `tokens.id_token` 的 `auth_provider` | 解 id_token 中段（base64url）取根部声明：`password`→Password、`google`→Google 等；解不出退回 `OAuth`；`auth_mode === 'apikey'` → `使用 API Key` |
| `用户 ID：9f6305d7…` | `user_id` ‖ `account_id` | 中部掩码：首 8 + `…`；整段等宽 |
| API Key 账号改出 `供应商：X` | `api_provider_name` | 空则不出这一段 |
| API Key 账号改出 `Base URL：…` | `api_base_url` | 空则不出 |

> 「使用什么登录」按上游口径走 **id_token 的 `auth_provider` 存量声明**，不是「有没有存
> `account_password`」——后者是用户自存的密码，拿它当前者语义就错了。前端只读 id_token、
> 不落地任何凭据。

### L3 时效事实行

| 文案 | 后端字段 | 规则 |
|---|---|---|
| `有效期至 2026-11-10 10:18` | `subscription_active_until` | 已过期 → danger 文案「订阅已过期」；空 → 整段不出（API Key 账号恒不出） |
| `重置 N 次` | `quota.reset_credits_available` | 仅 `> 0` 时出 |
| `标签：工作 / 备用` | `tags` | 空 → 不出（不再显示「无标签」占位） |
| `更新于 10-08 09:58` | `usage_updated_at` | 空 → 不出 |

### 右侧配额块

| 文案 | 后端字段 | 规则 |
|---|---|---|
| `5h` / `周` 两条 | `quota.hourly_percentage` / `weekly_percentage` | ≤20 danger、≤40 warning |
| 底行 `5h 重置 2h · 10/10 16:00` | `quota.hourly_reset_time` / `weekly_reset_time` | 相对（算自时间戳）+ 绝对（本地时区）；取哪个窗口与两条的档位一致 |
| `未取到配额` | `quota == null` 且 `usage_updated_at` 有值 | 整块替换 |

### ⋯ 菜单

刷新这一条配额 / 刷新订阅信息 / 强制刷新令牌 / 重置 5 小时额度（`reset_credits_available > 0`
才出）/ 名称与备注 / 复制邮箱 / 导出这一条 JSON / 删除。

**「重置 5 小时额度」的确认与明细同壳**（10-10，见 `05-reset-credit-details.md`）：上游有
`resetCreditDialogTitle` 与「重置次数明细」；desko 原先一键直达，现在点菜单开
`ResetCreditDialog`——后果说明 + 最近到期 + 逐条明细（可用/已使用/已过期），加载中禁用「重置」。
额度一扣不可撤销，故这一步不能省。

### 本页不做（主动裁掉的产品面）

`添加至 API 服务`、代理编辑卡、服务面板、账户余额（Credits，中转账号专属）、
供应商切换、分组、回收站、团队配额历史 —— 对应命令不在 61 条白名单里，
补它们等于二次移植，不在本轮。

## 2. 布局规格

- 行高 **88px**（其余页 60px 轨不变，本页因信息量加高）；行间仍是发丝线，不套卡中卡。
- **未取到的字段整段不占位**，不留 `—`、不留空 label——行的高低由事实条数决定观感，不留坑。
- 等宽只给：用户 ID、Base URL、数值（`重置 2 次` 的 2）、等级徽标。
- L2 静音（`--text-muted`）、L3 次强（`--text-secondary`），与配额块的实时读数分层。
- 批量态：行内只留勾选框 + ⋯，收起「切换」（选择过程中不摆破坏性动作）。

## 3. 落点

| 文件 | 改动 |
|---|---|
| `src/services/api/codex.ts` | `CodexAccount` 补声明：`account_structure` / `user_id` / `organization_id` / `subscription_active_until` / `api_provider_name` / `api_base_url` / `tokens.id_token` |
| `src/components/codex/CodexModule.vue` | 三行行结构；删「本机与导入」整卡；`导出所选 JSON` 进批量 dock；页栏去「当前」胶囊；行加 `data-email` 稳定定位钩子 |
| `src/components/codex/CodexAuthDialog.vue` | 第 4 个 tab「导入」接 `importLocal()` / `importFromFile()`，读 `storagePaths()` 展示本机凭据路径 |
| `src/components/settings/SettingsDialog.vue` | 通用页 Codex 区块加凭据路径 + 「打开 config.toml」（10-10 被并行会话抽成独立 `codex` 页签 → `src/modules/settings/CodexSettings.vue`，`helpers.ts` 的 `SETTINGS_TAB` 已同步） |
| `e2e/mocks/backend.ts` | fixture 账号补上述字段，覆盖「字段齐全 / 字段缺省」两态；`login_provider` 造带 `auth_provider` 的假 id_token |
| `e2e/specs/codex.spec.ts` | 行定位改 `accountRow(page, email)` = `.acc-row[data-email=…]`（L1 只显名称，邮箱不再在行文本里） |
| `scripts/codex-shots.mjs` | 交付出图：两主题账号页 / 批量 dock / 重置确认框 / 添加账号（登录·导入）/ 设置·Codex 面板，缺帧非零退出 |

### 踩到的坑

`.grid-acts` 是**条目卡体系里 hover 才显影**的一档（`global.css:1486` `opacity: 0`，靠
`.grid-card:hover` 抬起）。账号行沿用这个类名时按钮常驻不可见——e2e 的 `opacity: 0`
不算不可见，测试全绿也照不出。行尾动作改用本页自己的 `.acc-acts`，常显。

## 4. 本轮裁定（已拍板）

1. 批量态收起行内「切换」——选择过程中不摆破坏性动作。**已按此实现。**
2. `reset_credits_available === 0` 时不显示「重置 0 次」——**已按「> 0 才出」实现。**
3. 等级徽标保持中性底（`--fill` + `--text-secondary`），不抢 accent。**已按此实现。**
4. `account_password` / `two_factor_secret` 随列表响应下发（模型没有 `skip_serializing`，
   与上游一致），但**前端一次都不渲染**；「使用什么登录」改读 `tokens.id_token` 的
   `auth_provider`。收紧串口仍需另开一轮。

## 5. 验收（10-10 复跑）

- `vue-tsc --noEmit`：codex / settings 改动文件零错误。
- `vitest run`：16 文件 / 195 例全绿。
- `PW_CHANNEL=msedge playwright test e2e/specs/codex.spec.ts`：16 例全绿（新增
  「行内三行事实」「重置 5 小时额度要过确认框」「导入 tab」「设置·Codex 面板」四例）。
- `PW_CHANNEL=msedge node scripts/codex-shots.mjs`：7 帧全为本次新拍，落在 `shots/`，
  其中 `codex-reset-confirm.png` 是确认框。
- 全部走 e2e mock，未触碰真机账号数据。
