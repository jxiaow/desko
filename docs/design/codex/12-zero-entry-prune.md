# 零入口收面：13 条摘册（12 设计稿 · 2026-10-12 · 已放行）

配套 `08-token-stats-and-entry-audit.md` §4 的零入口拆分与 §5 第 6 条。用户 2026-10-12 对「最小集」清单放行（原话「开始」），本稿落第一轮：**只收面，不接新界面**。

## 1. 一句话方案

把 13 条「在册、编译得动、但前端零入口且已判定不接」的命令从 `keep_cmds.json` 与 `main.rs` 的注册表里同时摘掉：在册 **75 → 62**，零入口 **24 → 11**。函数体一行不删（R6），`trim.py` 不重跑（§3）。

## 2. 名单与逐条理由

| # | 命令 | 域 | 为什么摘 |
|---|---|---|---|
| 1 | `start_codex_batch_import_from_files` | F1 导入 | 2026-10-12 拍板「导入 tab 不做两段式预览，保留一把梭」→ 这一族 5 条永久无界面可挂。desko 今天的导入走 `import_codex_from_files` / `import_codex_from_json` / `import_codex_from_local`，一条不少 |
| 2 | `get_codex_batch_import_preview` | F1 导入 | 同上；预览是两段式的第一段 |
| 3 | `confirm_codex_batch_import` | F1 导入 | 同上；没有预览就没有确认 |
| 4 | `cancel_codex_batch_import` | F1 导入 | 同上 |
| 5 | `resume_codex_batch_import` | F1 导入 | 同上，且 11 号稿 §3.1 已把导入会话盘快照停掉——跨重启「继续导入」实质已不存在，这条留在册只是留个必然报「导入会话不存在」的入口 |
| 6 | `create_pending_codex_oauth_account` | F2 后 | 上游「待授权账号池」玩法，desko 的 pending 只作为行内状态显示（`authorization_status`），不代管未完成的 OAuth 会话 |
| 7 | `sync_codex_api_key_provider_accounts` | F2 后 | API Key 供应商池同步，绑的是已砍的本地接入网关域 |
| 8 | `update_codex_api_key_bound_oauth_account` | F2 后 | 同上（Key ↔ OAuth 绑定） |
| 9 | `update_codex_account_api_model_mappings` | F2 后 | 按模型映射 key，同域 |
| 10 | `refresh_all_codex_quotas` | F4 | 与已接的 `refresh_codex_quotas_batch` 同义，留三条刷新入口等于白送三个可达面 |
| 11 | `refresh_current_codex_quota` | F4 | 同上 |
| 12 | `restore_codex_active_takeover_if_enabled` | F5 | 属已砍的接管域；Rust 侧除自身定义（`codex_account_commands.rs:1962`）外零调用，自动切号永久排除 |
| 13 | `delete_codex_accounts` | 本轮让位 | 11 号稿 §6-6 单通道拍板：账号页「删除所选」全量改走删除作业面，这条整把命令转零入口。留着 = 一条绕过作业面、无进度无明细的直删路 |

**摘册后剩下的 11 条零入口**（本稿不动，仍待拍板）：F2 前 2 条（`add_codex_account_with_token` `import_codex_access_token_account`，「手里只有一个 access token」的入口，08 建议做）+ F3 整域 9 条（`save_*` 四条会写官方 `config.toml` / 模型目录，接不接等于决定 desko 是不是「只读旁观者」）。

## 3. 执行边界（这条最重要）

**不重跑 `trim.py`。** 流水线（`01-plan.md` §移植流水线）的 `port.py → rewire.py → trim.py → proc.py → slice.py` 是从上游克隆整体再生，跑一遍会把 desko 的手工改动全抹掉：11 号稿 §3.1 的停盘、10 号稿的回收站分片、S4 的按轮差分聚合、`codex_core` 里所有出处注释。`wire.py` 本身也只认 `cmd_order.json`（一次性插线，带 `if not in` 幂等守卫），不是 keep 的镜像生成器。

所以本轮的「重跑流水线」= 手工做它该做的两件事，且只做这两件：

1. `src-tauri/codex-core/keep_cmds.json`：删 13 个条目（75 → 62）。
2. `src-tauri/src/main.rs`：删对应的 13 行 `codex_core::commands::codex::X,` 注册（现落点 `:391,403-407,412-413,424-425,427,429,431`）。

**函数体留在原地**（R6 原话：不能手删函数体）。`pub fn` 不注册即不可达，Tauri 只派发 `generate_handler!` 里的名字；留着不影响编译、不出 dead_code 警告，代价只是二进制里那点用不到的代码。真要把 helper 一起摘干净，那是重跑裁剪流水线的事，本稿不做。

**闸门不因此变松**：`is_codex_command`（`main.rs:45-58`）先按名字判（含 `_codex_` / 前缀 `codex_` 一律纳管），`keep_cmds.json` 只是第二层边界名单。摘册后这 13 条若哪天被重新注册，仍会落在 codex 闸门里，且 `gate_tests::registered_codex_cmds_are_gated` 会把「在册未注册」当场报错（`:505-510` 断言 keep ⊆ registered）。

## 4. 账

| 项 | 摘册前 | 摘册后 |
|---|---|---|
| 三相等（`main.rs` 注册 = `keep_cmds.json` = 闸门纳管） | 75 = 75 = 75 | **62 = 62** |
| 有入口 / 零入口 | 51 / 24 | **51 / 11** |
| 08 §5 第 6 条的账 | 75 − 13 = 62 | 落地即闭合；F3 整域若也摘再 −9 = **53** |

## 5. 判据（全程 mock，不碰真号）

1. `cargo test --bin desko gate_tests` **2/2**（keep ⊆ registered 那条必须还过——它只查单向，所以两边走一遍才算真摘干净）。
2. `cargo check -p codex-core` 无新增警告（函数体留着，引用守卫不该被触发）。
3. `.scratch/recon.mjs`：在册 **62**、有入口 **51**、零入口 **11**，且那 13 个名字在三个口径里同时消失。
4. `npx vue-tsc --noEmit` 0；`npx vitest run` 224 全绿（前端一行没改，绿是回归线）。
5. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts` 全绿。**mock 侧的 13 个 handler 保留**：`delete_codex_accounts` 那条用例断言的是「真应用里没人调它」，把 mock handler 删掉会让断言变成空转。
6. 真机零点击。

## 6. 交付结果（2026-10-12）

| 判据 | 实测 |
|---|---|
| 1 闸门 | `cargo test --bin desko gate_tests` **2/2**（keep ⊆ registered 那条仍过——两边各删 13，名单与注册表同时收缩） |
| 2 codex-core 编译 | `cargo check -p codex-core` 只有 **1 条既有警告**（`codex_account_projection.rs:240` unreachable expression，早于本轮），**零新增**：函数体与 helper 一行未动 |
| 3 账 | `.scratch/recon.mjs`：**在册 62 = 注册 62**、有入口 **51**、零入口 **11**；未入册 184 → **197**（+13，这 13 条回到「desko 没带」那一桶）；与上游同名交集 73 → 60（62 − desko 自有 2 条，对得上） |
| 4 前端回归 | `vue-tsc` **0 错误**；`vitest` **17 files / 224 passed**（前端一行未改，绿的是回归线） |
| 5 e2e | `codex.spec.ts` **55 passed**；全量 `PW_CHANNEL=msedge npx playwright test` **250 passed / 2 flaky**（飘的是 `bypass.spec:199` 与 `notes.spec:328`，重试即过，与 codex 无关）。mock 侧 `delete_codex_accounts` handler **保留**，所以「真应用里 0 次调用」那条断言不是空转 |
| 6 真机 | 零点击 |

**执行落点**：`keep_cmds.json` 75 → 62（按名精确删，删的当场核对「只有 13 条」）；`main.rs` 删对应 13 行注册（原 `:391,403-407,412-413,424-425,427,429,431`），剩 62 行 `codex_core::commands::codex::X,`（`:469` 那处匹配是测试注释，不是注册）。`port_manifest.json` / `slice_report.json` 逐字查过：两份产物都不含被摘的名字，没有留下第二张需要跟改的账。

**顺带**：`01-plan.md` §命令面 的「61 条」是 rev5 快照，已在该节加了指向本稿与 08 号稿活账的注，避免下次又拿旧数当现状。

