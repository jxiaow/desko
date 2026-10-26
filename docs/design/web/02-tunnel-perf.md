# Web 页公网访问性能账与修复方案

日期：2026-10-25　状态：R1、R2 已落码并本地验收（浏览器对拍 + Rust 单测）；新包已装本机，公网面复跑只差把 Web 服务起点起来（§5.5）；R3–R6 另批待拍板

适用范围：`web_access`（Desko Web，`127.0.0.1:8420`）经内网穿透公网面访问。局域网面与 Codex Web UI（8421）本次未实测，见 §6。

## 1. 结论

慢不是出在 Rust 服务处理上，而是出在**每次访问都要从这台电脑重新搬 2.8 MB**：其中 93.6% 是那颗内置中文可变字体，剩下的是首屏那 7 个 JS/CSS/图标请求各自的公网往返。同一批资源在本机 loopback 上是 1–6 ms，服务端不是瓶颈。

两条硬账：

- 冷开首屏约 2.85 MB，其中 `/fonts/harmonyos-sans-sc.woff2` 占 2,736,152 B。Cloudflare 边缘会把文本 brotli 压掉约 76%（实测 65,639 → 13,484 B），但不压 woff2（已是压缩格式），所以字体一分都省不掉。
- 所有响应被硬编码 `Cache-Control: no-store`，含不含任何用户数据的 `/assets/*`（Vite 文件名已带内容哈希）与 `/fonts/*`。二次访问、每次刷新、每次整页导航都要把上面这笔账重付一遍——实测重放首屏那 5 个请求耗时 5.21 s。

落码后的账（R1+R2，见 §2.1/§2.2 对拍）：同一页面冷开从 **10 条 / 2,866.5 KB 出网、load 4.22 s** 降到 **8 条 / 158.8 KB**，其中字体那一条整条消失（2,681.8 KB 出网 / 2,736,152 B 原文，占改前 93.6%）。R2 的缓存分档在 Rust 侧，本机由 `cargo test` 走真 HTTP 逐条验过；公网面的"二次访问不重传"要等装了新包的 `desko.exe` 把 Web 服务起起来才能复测——新包已就位（§5.5），那一格待复跑。

## 2. 实测数据

### 2.1 对拍：同一页面，改前 vs 改后

测法：`node scripts/web-perf.mjs <base> --browser`（Edge headless + CDP `encodedDataLength`，记的就是出网字节；`load 墙钟` 取 `load` 事件，不含后面为字体判定留的静置）。冷开 `goto` 后停 2 s，再往 body 里塞一句中文并等 `document.fonts.ready`——字体只有解析到对应字形才会要，不塞这句就测不出 R1。改前那轮打的是已安装 `desko.exe` 服务出的公网域名（服务端自带 runtime 标记，脚本不拦任何请求）；改后本地那轮打的是 `npm run build` 的 `dist/` 经 `vite preview` 出，缺 Rust 注入的那行 meta，由脚本补注同一行；改后公网那轮打的是重装后的 `desko.exe`。除"改后本地"外都不带会话（未登录），所以差值只可能是资产与字体。

同一把尺子上的改前基线复跑过两次，条数会差 1：`/app-icon.svg` 一次被请求两遍（favicon 与标题栏各一次），下表取两次里字节与条数都更保守的那次（10 条 / 2,866.5 KB）。

| 指标 | 改前（公网面 / 旧包） | 改后（本地 dist / 新包） | 改后（公网面 / 新包） |
|---|---|---|---|
| 冷开出网 | 2,866.5 KB / 10 条 | 158.8 KB / 8 条 | 待复跑 |
| 冷开 `load` 墙钟 | 4.22 s | 59 ms（loopback，只作对照） | 待复跑 |
| 其中 `/fonts/*.woff2` | 2,681.8 KB（1 条） | 0（没有该请求） | 待复跑 |
| 生效的 `--font-ui` | `"HarmonyOS Sans SC", "Segoe UI", …` | `-apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", …` | 待复跑 |
| `<html>` 的 class | 空 | `desko-web` | 待复跑 |
| body 计算字体含内嵌族 | 是 | 否 | 待复跑 |
| 二次导航出网 | 184.1 KB / 8 条 / load 2.16 s，`/assets/*` 6 条全重传 | 158.8 KB / 8 条 / load 42 ms，`/assets/*` 6 条全重传 | 待复跑 |

第二列与第三列之间不能对齐的口径要说清：改前与"改后公网"走 Cloudflare（zstd），"改后本地"走 loopback（gzip），所以本地那一列只用来证 R1 的字体判据，不比时间；`/assets/*` 的文件名与体积几轮之间也不是同一个包（文本 182.5 KB → 约 157 KB 里含并行会话的改动，不是本轮的功劳）。本轮的量级差只有一条：字体。

"改后本地"那一行的二次导航不是 R2 失败：那一轮由 `vite preview` 出，它给 `/assets/*` 写的是 `no-cache`，而分档逻辑在 `respond_guarded`（Rust）。这一档由 `web_access::tests::hashed_assets_are_cacheable_while_every_data_face_stays_no_store` 走真 HTTP 断言（见 §5），公网那一轮的复用只能由"改后公网"这一列给出。另外改前那轮二次导航没再要字体——浏览器内存缓存兜住了，不能当成"字体只贵一次"。

### 2.2 逐条耗时（改前，用来说明"条数本身也要钱"）

测法：2026-10-25，本机对已登记的命名隧道 `https://desko.xiaolink.xyz`（ingress → `http://127.0.0.1:8420`）用 curl 逐条取；loopback 对照组用同一批路径直连 `127.0.0.1:8420`，`Host: 127.0.0.1:8420`。数据为公网面单流传输，未做并发。字节列为原文（除注明 br 者），与 §2.1 的出网口径不同。

| 资源 | 字节 | 公网面 total | loopback total |
|---|---|---|---|
| `GET /`（HTML 壳） | 753 | 1.30 s（含 TCP+TLS） | 1 ms |
| `/assets/main-D2SRyQ0m.js` | 210,663 | 3.07 s | 6 ms |
| `/assets/_plugin-vue_export-helper-DUpx0em6.js` | 148,112 | 1.13 s | 2 ms |
| `/assets/_plugin-vue_export-helper-C2ngBi16.css` | 92,867 | 2.09 s | 1 ms |
| `/assets/main-Czb6nqIb.css` | 65,639（br 后 13,484） | 0.88 s | 1 ms |
| `/fonts/harmonyos-sans-sc.woff2` | 2,736,152 | 9.22 s（约 290 KB/s） | 未测 |
| 首屏 5 请求重放一轮 | 约 519 KB 原文 | 5.21 s wall | 约 11 ms |

要点：公网面单请求往返地板约 0.7 s，请求条数本身就要钱；字体一颗顶五个文本资源之和的二十倍。

## 3. 根因排序

**P0-1 字体挂在系统 CJK 之前。** `src/styles/global.css` 十二套主题的 `--font-ui`（:269、:394、:513、:633、:735、:837、:939、:1041 …）都把 `'HarmonyOS Sans SC'` 排在 `'Microsoft YaHei UI'`/`'PingFang SC'` 之前。浏览器按字形逐个回退：Latin 走 Segoe UI 命中，任何中文都必须等这颗 2.7 MB 的可变字体。桌面内嵌它是为了本机视觉一致，Web 侧这个代价完全不成比例。

**P0-2 静态资产被一律 `no-store`。** `src-tauri/src/web_access/mod.rs:336-341` 在 `respond_guarded` 里对所有响应写死同一组安全头，含 `("Cache-Control", "no-store")`。`/assets/*` 走 `bridge.rs:304 asset()` 出编译产物，不携带任何用户数据；把它们和 `/api/*` 同档对待，等于每次导航重传整个包。

**P1-3 每个公网请求都抢一次全局 DB 锁做 Host 校验。** `mod.rs:195-217 same_origin` 对「来源是 loopback 且 Host 不是本机可信地址」的请求调 `backend.public_hosts(port)`；隧道正是这种情况（cloudflared 从 127.0.0.1 连入并保留公网 Host）。`bridge.rs:116-125` 里这一步是 `state.db.lock()` + `get_meta("tunnel_enabled")` + `list_tunnel_services()`。首屏 6 个资产加此后每条 API 都要过一次，而 `db` 是一整进程一把 Mutex。

**P1-4 只有 4 个 worker，且同步处理慢动作。** `mod.rs:646-658` 起 4 条线程 `recv_timeout` 后同步 `handle`。`bridge.rs:160-168` 的 `favicon_get` 在 worker 线程内 `block_on` 一次远程抓取（代码注释自己承认"A favicon fetch can wait on a remote server"）——4 条慢图标即可让整站排队。命令路径上 `bridge.rs:13-18 require_module` 先抢一次 `db` Mutex，命令内部再抢一次。

**P2-5 事件轮询节奏按本机定的。** `src/services/events.ts:42`：有订阅时 1 s 一轮，订阅了 `codex:dialog` 就 200 ms 一轮。公网单请求地板 0.7 s，200 ms 的节奏只会把 4 个 worker 全占在轮询上。

**P2-6 响应体每 8 KB 复查一次授权。** `mod.rs:291-306 GuardedReader::read` 每次 `read` 跑 `authorized()`，其中锁全局 `security` Mutex；tiny_http 出体用 `io::copy`（默认 8 KiB 缓冲）。210 KB 的 JS 就是约 26 次跨线程抢锁，多个 worker 同时出体时互相排队。

**P2-7 字体 MIME 报错。** 实测公网响应 `Content-Type: application/font-woff`（woff2 应为 `font/woff2`），来源是编译产物的 MIME 表。不影响下载，只影响校验与统计。

## 4. 修复方案

### R1 Web 面不加载内置中文字体（已落码）

动作（原方案）：`mod.rs:564-572` 已在 `<head>` 注入 runtime meta，把同一处扩成给 `<html>` 加 `class="desko-web"`；`src/styles/global.css` 末尾追加一条 `html.desko-web { --font-ui: … }`。

实际落法与此有一处不同，且更省事也更可靠：Rust 侧不动，标记由前端自己打。`src/services/runtime.ts` 新增 `markWebRuntimeRoot()`，读既有的 `meta[name="desko-runtime"][content="web"]` 后给 `<html>` 加 `desko-web`；`main.ts` 在 `mount` 之前、`initializeAppearance` 之前调用它——首屏还没有文字，字体档先就位，就不会去要那颗字体。覆盖规则写在 `src/styles/web.css`（`main.ts` 里它排在 `global.css`、`workspace-themes.css` 之后导入），选择器取 `html.desko-web` + `[data-layout]` + `[data-theme]`：`workspace-themes.css` 用 `:root[data-layout="workspace"]`（0,2,0）把内嵌族排在最前，裸类名压不过它，必须带属性升权；写在 `<html>` 而不是 `.app-root`，是因为弹窗与浮层 teleport 在 app-root 之外。桌面与 E2E 页面没有这行 meta，`markWebRuntimeRoot()` 直接返回 false，仍吃内嵌字体。Codex Web UI（8421）同样注入 `desko-runtime`，因此一并生效。

预期：冷开 2.85 MB → 约 0.12 MB（br 后文本），首屏时间从 10 s 级降到 2–3 s 级。
实测：见 §2.1，2,867.5 KB → 158.4 KB，字体请求归零。
风险：Web 端中文用系统字体，观感与桌面有差；手机上是 PingFang/Noto，可读性无虞。
观感对拍（同一份小记种子、1040×670，桌面走内嵌字体、Web 走系统字体，`e2e` 临时 spec 拍的，spec 已删）：换行位置逐行一致，差别只在字形——`…` 与 `“”` 的标点形状不同，微软雅黑的笔画比 HarmonyOS 略松一点，正文小字没有变淡或发虚。帧留在 `%LOCALAPPDATA%\Temp\desko-r1-shots\web-system-font.png` 与 `desktop-embedded-font.png`（取证用的临时 spec 已删，不入仓）。

### R2 缓存分层：静态 immutable，数据面照旧 no-store（已落码）

动作：`respond_guarded` 按路径分档，新增 `cache_control_for(url)`——`/assets/*`（Vite 文件名自带内容哈希）给 `public, max-age=31536000, immutable`；其余一律 `no-store`。HTML、`/api/*`、附件、下载、`/app-icon.svg` 都落在这"其余"里，CSP、`X-Frame-Options`、`nosniff`、`Set-Cookie`、`Content-Disposition` 一条没动。

与方案的偏差：`/fonts/*` 不给 `immutable`，改给 `public, max-age=604800`（7 天）。原方案打算给字体 URL 挂 `?v=<app 版本>`，但那条链要求改 `asset()` 出 HTML 时重写 CSS 里的字体 URL——编译出的 CSS 是产物，动它要么改构建要么改字节，代价不值：R1 之后 Web 面根本不再请求字体，这档只是给未来的字体用法留个不至于拿旧字节的兜底，7 天短到升级后自愈。

预期：二次访问只剩 HTML + API 往返，实测那 5.21 s 的重复轮子降到约 1.3 s。同一把浏览器尺子上的改前二次导航是 8 条 / 184.1 KB / load 2.16 s（§2.1），5.21 s 是 §2.2 的 curl 串测口径，两个数别混着引用。
风险：这是有意的取舍变化——公网访问者的浏览器会长期缓存这些资产（只有代码，无用户数据）；换设备/清缓存才重新拉。`docs/web-access.md` 已同步这句。

### R3 Host 白名单进内存快照

动作：隧道服务的 `hostname+port+routed` 集合在登记/变更处刷新一次（沿用 `notify_module_change` 那条失效链），`same_origin` 改读 `RwLock`/原子快照，不再每请求 `db.lock()`。
预期：公网面每请求少一次全局锁与两次 SQLite 读。

### R4 favicon 挪出 worker

动作：`favicon_get` 只回本机已缓存的图标文件名；未命中时把抓取丢进有界后台队列并立刻返回空，前端下次自然取到。抓取本身加超时。
预期：4 个 worker 不再被远程站点长期占用——这一条是"整站卡死"和"只是慢"的分界。

### R5 并发与轮询自适应

动作：worker 4 → 16（有界，配合 R3 后每请求更短）；`events.ts:42` 的间隔按访问面分档，公网面 200 ms 档并入 1 s 档。流式改单请求分块不在本轮，风险与收益不划算。
预期：多标签/对话期间不再出现轮询吃满 worker。

### R6 收尾

`authorized()` 降为每响应一次 + 每 1 MB 一次复查；`require_module` 用模块开关快照免二次锁；woff2 MIME 修成 `font/woff2`。局域网传输页那颗 2.7 MB 字体已带 `immutable`（`fileshare-core/handlers.rs:669-680`），只首次慢，本轮不动，R1 落地后一并评估换子集。

## 5. 验收口径与结果

1. 新增 `scripts/web-perf.mjs`：两种模式。默认 curl 模式按 HTML 壳的 `src/href` 逐条取（`--compressed` 的 `size_download`，与 §2.2 同源），断言冷开出网 ≤ 200 KB、二次访问仍需重传 ≤ 3 条、出网 CSS 里有生效的 Web 字体覆盖且覆盖内不带 `HarmonyOS Sans SC`；`--browser` 模式用 CDP 记每条出网字节，断言 `--font-ui` 与 `body` 计算字体里没有内嵌族、`<html class>` 含 `desko-web`、首屏不出现 `/fonts/*`、二次导航 `/assets/*` 重传 0 条。结果写 `.tmp/web-perf-<host>.json`。改前改后两张表已并排贴在 §2.1。
   - 已跑：改前公网面 10 条 / 2,866.5 KB / load 4.22 s，五条判据全 FAIL（预算、字体请求、`<html>` 无标记、`--font-ui` 仍带内嵌族、二次仍重传 6 条 `/assets/*`）——这就是改前的基线；改后本地 `dist/` 8 条 / 158.8 KB / load 59 ms，字体判据全过，只剩"二次仍重传 `/assets/*`"一条 FAIL，成因是 preview 不出我们的头，见 §2.1。
2. `src-tauri/src/web_access/tests.rs` 补头部分支用例：`hashed_assets_are_cacheable_while_every_data_face_stays_no_store` 走真 HTTP 断 `/assets/*` 得 `immutable`、`/fonts/*` 得 7 天、`/notes` 与 `POST /api/invoke` 得 `no-store`，并对 `/api/attachments/*`、`/api/files/*`、`/app-icon.svg` 直接单测 `cache_control_for`，同时钉住 `X-Frame-Options: DENY`、`nosniff` 与 CSP 里的 `default-src 'self'` 没被动过。`cargo test --bin desko web_access`：27 passed / 0 failed / 1 ignored（既有的 process 用例本来就 ignore）。
3. 前端标记链单测：`src/services/runtime.test.ts` 补一条——桌面与 E2E 页面不打标记，注入 meta 后才把 `desko-web` 落到 `<html>`，重复调用不叠加 class。`vitest run` 7 passed；`npm run build`（vue-tsc + vite）通过。
4. `e2e/` Web 相关四本（`web-access` / `web-workspace` / `web-desktop-layout` / `tunnel`）必须仍全绿；R2 不得把任何 `/api/` 路径放进可缓存档（已由 2 的用例硬钉）。注意 `e2e/web-helpers.ts:73` 注入的就是这行 runtime 标记，所以这四本从此按 Web 面的系统字体度量跑——溢出类断言的结论会随字形宽度变，结果见 §8。
5. 真机对拍（包已装，待复跑）：装机包必须由 `npx tauri build` 出。本轮先试了 `cargo build --release`——编译链接全过（1m59s）、进程也起得来，但产物 40,242,688 B 里 `harmonyos-sans-sc` 与任何 `assets/*.js` 的键都 grep 不到，`frontendDist` 一颗没嵌，装上去是个没有 UI 的空壳（已当场还原）。`npx tauri build` 的产物 43,610,624 B，字体键命中 1 次、`main-DRM8IaJ-.js` 与本轮 `dist/assets/` 同名，安装包落在 `src-tauri/target/release/bundle/nsis/Desko_1.0.0_x64-setup.exe`（15,436,199 B）。**判据是 grep 二进制里的 chunk 名与字体键，不是"进程活着"。**
   装法：旧包先备份到 `%LOCALAPPDATA%\Temp\Desko-reinstall-backup-20261025-145918\desko.exe`（43,610,112 B，SHA-256 `D83B01C7…`），再覆盖 `%LOCALAPPDATA%\Desko\desko.exe`（新包 SHA-256 `38CD633A…`）并重启。两颗 sidecar（`desko-fileshare.exe`、`desko-netguard.exe`）本轮 diff 不涉，原样留着。
   还差两步人手：Web 服务与隧道都不随进程自启（`web_access_start` 只有设置页 `WebServicePane.vue` 会调），要解锁 Desko → 设置 → Web 服务 → 启动，再起隧道，然后 `node scripts/web-perf.mjs https://<公网域名> --browser` 补 §2.1 最后一列。
6. 蜂窝复测（未做）：手机关掉 Wi-Fi 走蜂窝开一次公网地址，看首屏是否秒级出字（`font-display: swap` 已在，但 R1 之后根本不等字体）。

## 6. 未验证事项

- 9.22 s / 290 KB/s 是**这台电脑的上行**，不是访问者的下行速率；外地手机经 Cloudflare 到边缘是另一条账，只可能更差不会更好。
- 未做并发压测：§3 的 P1-3、P1-4、P2-6 是按代码路径推的排队，不是实测出的等待时间。
- Codex Web UI（8421）那一面 `epoch()` 每次要跑 `authorize_codex`（`bridge.rs:126-129`），叠加 P2-6 的每 8 KB 复查会更贵；本轮未测。
- 局域网面与 fileshare 页未复测；`Downloads` 目前 45 个文件，"每请求全目录重扫"（`fileshare-core/handlers.rs:298-334`）在这台机器上还不构成瓶颈，文件数上千时需要单独立账。

## 7. 待点头清单

1. ~~R1（Web 面换系统字体，砍 2.7 MB）~~ 已落码，§2.1 对拍通过。
2. ~~R2（`/assets/*` 放行 immutable，其余保 `no-store`）~~ 已落码，`/fonts/*` 偏差为 7 天，见 §4；文档 `docs/web-access.md` 已同步缓存取舍。
3. R3、R4（去每请求 DB 锁、favicon 挪出 worker）——另批，需要单独点头。
4. R5、R6（worker 扩容、轮询分档、授权复查降频、woff2 MIME）——另批。
5. ~~新增 `scripts/web-perf.mjs` 并把改前/改后两张对拍表写回本文档 §2/§5~~ 已完成。
6. ~~待点头：重装 `desko.exe` 后在公网面复跑 `--browser` 一轮，补 §2.1 最后一格~~ 已点头并装完（新包在跑，见 §5.5）；剩最后一步：解锁后把 Web 服务与隧道起点起来，公网那一列当场补上。

## 8. 回归与归因

`vitest`、`npm run build`、`cargo test --bin desko web_access` 全绿（§5.2、§5.3）。e2e 这边不干净，但红灯都不在本轮 diff 里。

测法：`PW_CHANNEL=msedge npx playwright test` 跑 `tunnel` / `web-access` / `web-workspace` / `web-desktop-layout` 四本——4 worker 首轮 79 passed / 10 failed；随后把这 10 条单 worker 串行复跑（不并发跑 cargo、不并发起 preview），仍然 10 failed / 7 passed。能复现，所以不是负载假红。三族逐条对账：

| 族 | 用例 | 现象 | 归属 |
|---|---|---|---|
| 「展开目录」按钮不在 DOM | `web-access:195`、`web-access:240`、`web-access:264` 的 320/390、`web-workspace:27` 的 360/390/1440；同一条用例在 768/1040 是过的 | `locator.click/tap/boundingBox` 一直 `waiting for getByRole('button', { name: /^(展开\|收起)目录$/ })` 到超时 | 今天落地的 `490c639` 把 `WorkspaceDirectoryToggle.vue` 从就地渲染改成 `<Teleport to="#workspace-fixed-tools" defer>` 并加了 `pageActive` 闸门，按钮在不在从此取决于 teleport 宿主与 KeepAlive 状态 |
| 小记口令找回入口 | `web-access:209` | 断言解锁弹窗里有「主密码直接恢复」按钮，`src/` 全仓已搜不到这句文案 | spec 落后于「全库一把小记口令 + 兜底免输入」那次改动 |
| 隧道回读文案 | `tunnel:151`、`tunnel:378` | spec 要 `状态没读到：` / `主域名没读到：`，HEAD 的文案是 `无法读取状态：`（`TunnelModule.vue:214`）/ `无法读取主域名：`（`TunnelSetupCard.vue:265`） | spec 落后 HEAD 文案 |

本轮改动不可能造成第一族：它只往 `<html>` 加一个 class、只替换 `--font-ui`/`--font-mono` 两个变量，而那颗按钮的三个 `v-if` 输入（`directory`、`pageActive`、`workspaceLayout && showFilters`）全是纯状态，字面宽度加不进也减不出 DOM 节点。真正与字体口径有关的断言——横向溢出、阅读列居中、`toBeInViewport`——在没有按钮阻塞的用例里全绿：`web-access` 768/1440/1920、`web-desktop-layout` 六条、`web-workspace` 768/1040。另外工作树里还带着别的会话未提交的 notes 在制品（`src/composables/useBatch.ts`、`src/utils/selection.ts`），e2e 与它们共用 1430 这台 dev server，跑的就是它们的代码；这四本要由 notes/标题栏那条线确认，本轮不替别人改红灯。
