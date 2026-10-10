# 重置 5 小时额度：确认框 + 重置次数明细（rev1 · 2026-10-10）

对拍稿：`docs/design/codex/03-page-redesign.src.html` 的帧 **E / F**
（重跑：`node scripts/mock-build.mjs docs/design/codex/03-page-redesign.src.html docs/design/codex/03-page-redesign.html` 然后 `PW_CHANNEL=msedge node scripts/mock-frames.mjs docs/design/codex/03-page-redesign.html docs/design/codex 03-frame accounts batch adddialog settings reset-dialog reset-states`）

## 0. 结论先行：零后端改动

明细早在链路上。`get_codex_reset_credits`（`src-tauri/codex-core/src/commands/codex_account_commands.rs:1455`）
→ `codex_quota::fetch_account_reset_credits()`（`modules/codex_quota.rs:1490`，走
`wham/rate-limit-reset-credits`，带 401 重试）已经返回**整份快照**：

```rust
pub struct CodexResetCreditsSnapshot { available_count: Option<i64>, credits: Vec<CodexResetCredit>, next_expires_at: Option<i64> }
```

缺的只是前端：`src/services/api/codex.ts` 没声明 `get_codex_reset_credits` 的返回类型，
`CodexAccount.quota` 也只声明了 `reset_credits_available` / `reset_credits_next_expires_at`
两个数，没声明 `reset_credits`。**本轮不新增命令、不动 keep_cmds.json、不动 Rust。**

上游同构：cockpit-tools 是「行内 pill → 打开确认弹窗，弹窗体内直接列明细」
（`CodexAccountsOverviewPanel.tsx:2500-2600`、`useCodexAccountsOverviewController.tsx:1700-1730`）。
本轮照抄这个结构，入口仍走 desko 的 ⋯ 菜单（desko 行上不摆 pill）。

## 1. 逐字段映射

明细每行的字段全部来自 `CodexResetCredit`（`models/codex.rs:431-446`）：

| 行内文案 | 后端字段 | 规则 |
|---|---|---|
| 状态 chip | `status` ‖ `raw_status` ‖ 由 `expires_at` 推 | 见 §2 归一表 |
| `发放：10-08 09:58` | `granted_at` | unix 秒；空 → 整段不出 |
| `到期：10-12 20:00` | `expires_at` | 空 → 整段不出 |
| `使用：09-20 21:14` | `redeemed_at` | **仅** 状态=已使用 且字段有值时出（本轮新增，上游不显） |

弹窗头部：

| 文案 | 字段 |
|---|---|
| `将立即用掉「邮箱」的一次 5 小时额度重置…还剩 N 次` | 账号 `email` + `available_count`（快照优先，缺则回落到列表里的 `quota.reset_credits_available`） |
| `最近到期：10-12 20:00` | `next_expires_at`；空 → 整行不出 |

`id` / `reset_type` / `raw_status` 不渲染（`id` 只用作 `v-for` 的 key）。

## 2. 状态归一（前端，与后端 `is_available_reset_credit` 同一套判据）

后端把 `status` 小写后原样透传；缺状态时它会用 `expires_at` 补一个 `expired`。前端显示四档：

| 显示 | 命中 | 形制 |
|---|---|---|
| 可用 | `status` 为空且（无 `expires_at` 或未过期），或 `available`/`active`/`granted` | `--success-soft` 底 + `--success` 字 |
| 已使用 | `redeemed` / `used` / `consumed` | `--fill` 底 + `--text-secondary` 字 |
| 已过期 | `expired`，或 `expires_at` 已过 | 同上 |
| 未知 | 其余非空状态字面量 | 同上 |

只有「可用」给正面色；已使用/已过期是既成事实，不给 danger——否则一屏红字把「还剩 2 次」的重点冲掉。

## 3. 布局规格

- 弹窗 **420px**，`.dlg-h` 46px / `.dlg-f` 46px，与既有弹窗同一方言（`ConfirmDialog` 是 360px 的纯文案壳，装不下明细）。
- 体：一句后果说明（`确认用掉…不可撤销`）→ `最近到期` 一行（clock 图标）→ 分隔线 → `重置次数明细` 小标题 + 列表。
- 列表行：`[状态 chip] 发放：<等宽时间> · 到期：<等宽时间>`，行距 6px，**max-height 168px 内滚**，条数多不把弹窗拉长。
- 等宽只给时间与数字；chip 走 `--radius-pill`。
- 底栏：`取消` / `重置`（danger）。**加载中「重置」洗面禁用**（底 `--fill`、字 `--text-secondary`，不整颗 opacity）。

## 4. 边界（帧 F）

| 态 | 明细区 | 「重置」 |
|---|---|---|
| 加载中 | `加载中…` | 禁用 |
| `credits` 为空 | `暂无重置记录` | 可用 |
| 请求失败 | `加载重置记录失败：<err>` 红字 | **可用** |

失败不禁用是有意的：可用次数来自账号列表，不依赖这次请求；明细只是"看清楚再决定"的附加信息，不该反过来挡动作。

## 5. 落点

| 文件 | 改动 |
|---|---|
| `src/services/api/codex.ts` | 新增 `CodexResetCredit` / `CodexResetCreditsSnapshot` 类型、`quota.reset_credits` 声明、`resetCredits(accountId)` 接 `get_codex_reset_credits` |
| `src/components/codex/ResetCreditDialog.vue` | 新组件：打开即拉快照；确认调 `consumeResetCredit`；成功回 `已使用一次额度重置` 并刷新账号 |
| `src/components/codex/CodexModule.vue` | ⋯ 菜单「重置 5 小时额度」改为开这个弹窗（不再是 `confirmStore` 的纯文案确认） |
| `e2e/mocks/backend.ts` | `get_codex_reset_credits` 补 `credits` fixture，覆盖 可用/已使用/已过期 三态 + 空态 |
| `e2e/specs/codex.spec.ts` | 改写「重置 5 小时额度」用例：弹窗列明细、取消不发命令、确定才发；断言三态 chip |
| `scripts/codex-shots.mjs` | `codex-reset-confirm.png` 换成带明细的弹窗帧（可从 mock 帧 E 代替） |

## 6. 本轮裁定（2026-10-10 已拍板）

1. 明细与确认**合并进同一个弹窗**（帧 E）。`ResetCreditDialog.vue` 取代原先的
   `confirmStore` 纯文案确认；`ConfirmDialog` 仍归切号/删除用。
2. 已使用那几条给 **`使用：<时间>` 而不是 `到期`**（帧 E 第三条）。
3. 明细加载中**禁用「重置」**并洗面（帧 F 第一种）：底 `--fill`、字留 `--text-secondary`。
4. ⋯ 菜单这一项维持 **`reset_credits_available > 0`** 才出，不为了看历史把必然失败的按钮摆上来。

## 7. 验收（2026-10-10）

- `vue-tsc --noEmit`：改动文件零错误。
- `vitest run`：16 文件 / 195 例全绿。
- `PW_CHANNEL=msedge playwright test e2e/specs/codex.spec.ts`：16 例全绿，含改写后的
  「重置 5 小时额度：弹窗先列明细，取消不动命令面，确定才扣一次」（钉三态 chip 与 `使用：`）。
- `PW_CHANNEL=msedge node scripts/codex-shots.mjs`：7 帧全为本次新拍，`codex-reset-confirm.png`
  已是带明细的弹窗。
- 全程 e2e mock，未触碰真机账号。

**新增脚本** `scripts/mock-frames.mjs`：把 mock-build 产出的对拍稿逐帧截图（帧容器 `.win`），
带"同名旧图先删 + 跑完数一遍"的缺帧对账。用法见脚本头注释。
