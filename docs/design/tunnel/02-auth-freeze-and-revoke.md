# 穿透模块两处缺陷：授权等待期界面卡死 + 无法撤销授权

## 2026-10-14：授权完成后不更新，刷新并输入主密码后卡住

后续排查确认 `login_start_inner` 登记授权子进程后，仍持有 `tunnel.login` 的 `MutexGuard` 就调用 `login_status_inner`。状态读取会再次获取同一把不可重入的锁，授权请求因此永不返回；轮询、取消与退出收尾也会等待这把锁。浏览器完成授权或刷新 WebView 都无法解除后端死锁。

修复在登记完成后显式释放锁，再读取状态。授权状态与进程登记逻辑接收当前 `TunnelState` 和档案路径，使回归测试可以通过真实存根子进程验证这条命令路径，而无需真实 Cloudflare 账号。

前端同时修正三处时序：每个状态请求返回即更新；先由授权查询领取登录目录中的凭据，再读取接入进度；页面挂载时立即注册轮询、原生聚焦和 DOM 聚焦/可见性监听，不等待首轮刷新。重叠刷新按各字段已应用的请求序号处理，防止旧结果覆盖新授权，同时允许慢查询在下一轮尚未返回时更新页面。

主密码解锁表单原来同时绑定表单提交和 Enter 松键，慢验证期间可能重复执行解锁。现统一通过表单提交，并在验证期间拒绝重复请求、禁用提交按钮，失败后可重新提交。

验证：新增两条 Rust 回归测试在修复前均以登记授权超时失败，修复后穿透相关 34 项、主密码命令 6 项全部通过；新增前端 10 项回归测试、类型检查和生产构建通过。穿透与认证浏览器用例 38 项通过，其中覆盖授权后刷新、Enter 输入主密码解锁、识别授权和切换页面。Cloudflare 浏览器授权在自动化中由存根模拟，真实账号桌面流程仍需安装新包验证。

用户报：「授权时打开浏览器 APP 会无响应，其次授权了的，无法撤销授权」。两条各自独立，一条是线程模型违约，一条是命令面缺一格。

## 结论

1. **卡死**：轮询路径上有 6 条命令声明成同步命令（跑在主线程 = 窗口消息泵），其中 `tunnel_binary_status` 在校验留痕缺失时要把 55MB 的 cloudflared 全量哈希一遍，而 `tunnel_provision_status` 在同一个 tick 里又调它一次。授权等待期用户正停在穿透页，3 秒一轮，每轮最多冻住泵 1 秒上下 —— 表现就是"无响应"。修法：这些命令一律改 `async` + `spawn_blocking`，并**把全量哈希从状态读路径彻底移走**（执行路径每次都哈希，这条不变）。
2. **撤销**：命令面根本没有撤销授权这一格，界面也没有。授权是否完成只看 `cert.pem` 在不在，于是唯一"撤销"手段是让用户手工删文件。修法：新增 `tunnel_revoke`（停进程 + 删本机凭据材料）与授权行上的「撤销本机授权」。

## 缺陷一：证据

`src-tauri/src/commands/tunnel.rs` 文件头自己写了规则：

> 起停要等子进程回话，一律 async：同步命令跑在主线程，轮询 sleep 会冻结窗口消息泵。

但被 `tnRefresh()` 每 3 秒打的那五条里，四条是同步命令：

| 命令 | 声明 | 位置 |
| --- | --- | --- |
| `tunnel_provision_status` | **sync** | `commands/tunnel.rs:941` |
| `tunnel_login_status` | **sync** | `commands/tunnel.rs:955` |
| `tunnel_binary_status` | **sync** | `commands/tunnel.rs:997` |
| `tunnel_status` | **sync** | `commands/tunnel.rs:1013` |
| `tunnel_list_services` | async | `commands/tunnel.rs:1033` |

调用方：`src/services/tunnelState.ts:19`（五条 `Promise.all`）+ `src/components/tunnel/TunnelModule.vue:86`（`setInterval` 3000ms，`busy` 期间跳过）。

重的那口在 `src-tauri/src/services/tunnel_service.rs:312 binary_status()`：留痕 `.cloudflared.exe.verified` 不在时走 `sha256_of(&path)` 全量洗 55MB（`tunnel_service.rs:322`）。本机实测这个量级的 SHA-256 约 0.7 秒；`provision_inner` 在 `tunnel_service.rs` 里又调一次 `binary_status`，两者都是同步命令 ⇒ **同一轮最多两次全量哈希，全在主线程**。

现场佐证：`%APPDATA%/com.desko.app/profiles/default/tunnel/bin/2026.10.0/` 下 `cloudflared.exe` 落盘于 2026-10-09 15:51，而校验留痕直到今天 16:45 才出现 —— 中间这段时间每次进页面都在付全量哈希的账。哈希对不上时更糟：留痕永远补不发，于是**每轮都哈希**，永不收敛。

第二条堵点（同源、概率低）：`list_services_inner`（`commands/tunnel.rs:700`）在持有 `db` 互斥锁的整段 `map(service_dto)` 里做 TCP 探测，每条未听的端口 250ms（`commands/tunnel.rs:674`）。这段时间内两条同步命令要拿同一把 `db` 锁（`tunnel_id()`、`service_counts()`）⇒ 锁等待也砸在主线程上。

## 缺陷一：修法

1. `tunnel_provision_status` / `tunnel_login_status` / `tunnel_login_cancel` / `tunnel_binary_status` / `tunnel_status` / `tunnel_stop` 改 `async fn` + `spawn_blocking` 并返回 `Result<T, AppError>`，与本模块其余命令同一形态。判据不变，只换执行线程。
2. `binary_status()` **不再哈希**：只回 `installed`（文件在不在）+ 留痕里那份哈希前缀。留痕缺失时 `actualSha256` 回 `null`，页面上就是"未校验"，出口是既有那颗钮（`fetchBinary` → `ensure_binary` 全量哈希并删除不符产物）。执行路径 `ensure_binary → verified_existing` 每次全量哈希这条硬约束保持不动 —— 未通过校验的二进制永远进不了执行路径。
   - 前端相应：`TunnelModule.vue` 页脚「已校验/未获取」两档改成按 `verified` 说三档（未获取 / 未校验 / 已校验），详情行的 SHA-256 为 `null` 时显示「未校验」。
3. `list_services_inner` 先取行、`drop` 掉 `db` 锁，再做端口探测。

不动的东西：轮询节奏（3 秒）与 `busy` 闸门、`tunnel_login_status` 的判据、`.verified` 留痕机制本身。

## 缺陷二：现状

- `authorized` 的唯一来源是 `cert_path(root).exists()`（`tunnel_service.rs:cert_path`，落在 `tunnel/cf/cert.pem`）。命令面（`src/services/api/tunnel.ts` 的 `tunnelApi`）没有撤销入口，`TunnelSetupCard.vue` 在 `authDone` 后只留一句"本机已有授权凭据"，连重新授权的按钮都收掉了。
- 实测 `cloudflared.exe tunnel --help`（2026.10.0）：子命令只有 `login / create / route / vnet / run / list / ready / info / delete / cleanup / token / diag`，**没有 `logout`**。所以撤销只能由我们自己落文件：cert.pem 里同时含私钥，删掉它本机就以不能再签发/取凭据。

## 缺陷二：修法

新增一条命令 `tunnel_revoke`（async + spawn_blocking），顺序固定：

1. 收在途的授权子进程（若有），顺带让 `login` 回 `idle`；
2. 停隧道进程并清 pidfile（复用 `kill_process` + `clear_runtime_files`）—— 不停就删凭据，正在跑的 connector 还在公网面亮着，那是最坏的一种"撤销"；
3. 删 `tunnel/cf/cert.pem`、`staged.json`、以及当前 `tunnel_id` 对应的 `<id>.json`；
4. **保留**：META 里的 `tunnel_id/tunnel_name`、服务表、`<id>.yml` 配置（配置是服务表的投影，`apply` 随时重算，留着不暴露任何东西）。

留这些是为了续做成立：同一账号重新授权后，`ensure_tunnel_inner` 读到本机记录就直接走 `fetch_credentials` → `cloudflared tunnel token` 取回同一隧道 ID 的凭据，不问远端"建过没有"，也不会第二条隧道。

语义边界（文案要如实说清）：撤销的是**本机**授权材料。Cloudflare 账号侧在登录时签发的那个 API Token 不在本机，不由我们回收 —— 与既有设计文档「不做：远端隧道资源与 DNS 记录的回收」（`docs/design/tunnel/01-tunnel-module.md:227`）同一条边界。要彻底吊销要到 Cloudflare 控制台。

UI：`TunnelSetupCard.vue` 授权行在 `authDone` 时给一颗 `btn-secondary`「撤销本机授权」，走 `useConfirmStore.showConfirm` 二次确认（与 `TunnelServicesCard.vue:72` 删除服务同一条路径），确认后调 `tunnelApi.revoke()` 再 `emit('refresh')`。这一步做完后 `step` 回到 `not-authorized`，那颗「去授权」自然回来 —— 不新增状态机分支。

## 验收

- `cargo test -p desko tunnel`：29 条穿透相关单测全部通过。
- `npx vue-tsc --noEmit` + `npm run test:run`（195 tests）通过。
- 手工：进穿透页，开任务管理器看 desko.exe 的 UI 线程 —— 3 秒轮询期间窗口可拖动、可输入；`tunnel_binary_status` 在无留痕时不再有磁盘读峰值。
- 撤销链路：已授权 → 撤销 → 页面回到第 2 步、`cf/` 下无 cert/creds；重新授权后回到第 3 步且隧道 ID 与撤销前一致（不产生第二条隧道）。
- `e2e/specs/tunnel.spec.ts` 补两条：撤销按钮在 `authDone` 出现、`idle` 不出现；页脚三档文案。

## 涉及文件

- `src-tauri/src/commands/tunnel.rs`（命令改 async、`list_services_inner` 提前放锁、新增 `tunnel_revoke` + `revoke_inner`、注册进 `src-tauri/src/main.rs`）
- `src-tauri/src/services/tunnel_service.rs`（`binary_status` 去哈希、新增 `verified` 字段与 `secret_dir` 清理辅助）
- `src/services/api/tunnel.ts`（`revoke()`、`TunnelBinary.verified`）
- `src/components/tunnel/TunnelSetupCard.vue`（撤销入口 + 确认）
- `src/components/tunnel/TunnelModule.vue`（页脚三档）
- `e2e/specs/tunnel.spec.ts`、`scripts/tunnel-shots.mjs`
