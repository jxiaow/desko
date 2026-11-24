# 局域网传输 · 网页端改版方案

日期：2026-10-22　状态：r2 已落地（§2 骨架、§3 令牌单一来源、§4 主题戳、§5 图标、§6 类型档、§7 折叠队列全部进码）；r3 文字独立成对象（§12）、r4 两端并成一条对话流（§13）已进码，`cargo test -p fileshare-core` 116 绿
mock：`design/fs-web/mock-src.html` → `design/fs-web/mock.html` → 21 帧（真 token）；真机验收图 32 帧由 `scripts/fs-web-shots.mjs` 落 `.tmp/fs-web/shots/`

## 0. 结论

浏览器页（`desko-fileshare.exe` 服务端渲染）按 App 当前视觉重做：**下载独占整页，上传回到弹窗**。配色不再手抄：令牌与图标由构建脚本从 App 单一来源生成，主题随 desko 当前外观落盘（"主题戳"）。

r1 曾把上传做成第二个页签，2026-10-23 被否：宽屏（≥1260）下行列表被无限撑宽、名字与大小之间一片空；而上传是一个有始有终的动作，占一整页不如一张定高弹窗（App 里传文件本来就是弹窗）。r2 的两条硬账：列宽有封顶公式且行档随容器换形；队列的可见行数与任务数无关，且**传成功的不进队列**。

行为面一律不动：口令与端口只在 desko 改、同名自动 `(1)`、单文件 4 GiB、全目录合并按修改时间倒序、Origin/`Sec-Fetch-Site` 同站门（403）不放宽、服务只手动启动、锁屏不停 sidecar。

## 1. 现状与根因

`src-tauri/fileshare-core/src/templates/home.html` 是 2026-09-29 手抄的一份令牌：

| 项 | 网页现状 | App 现状 |
|---|---|---|
| 令牌命名 | `--r-*` / `--t-*` / `--panel` / `--muted` | `--radius-*` / `--text-*` / `--panel-bg` / `--text-muted` |
| 底色 | 纸 `#f7f6f4` / 墨 `#191816`（`prefers-color-scheme`） | 工作区纸 `#f6f6f4` / 墨面 `#26282c`＋底 `#18191b` |
| 强调色 | 一档手写 `#3d5a80` | 12 档 × 2 极性，`--workspace-accent-source` 派生 |
| 文件色 | 6 桶 | 9 桶（`--ft-*`），且缺视频/音频 |
| 图标 | 内联 feather 2px 描边 | Solar Round Linear 骨架，实笔 1.15px |
| 骨架 | 48px 磨砂顶栏 + 工具条 | 64px `.page-bar` + 面板卡行（壳 14 / 双行 64 / 发丝分行） |
| 弹窗 | 头 14px padding + `.seg` 白块 | 壳 14 / 头 44 无线 / 底栏 46 透明＋顶线 / 钮 28 r7 |
| 氛围光 | 无 | 边缘进光，`--bg-workspace` 随 `data-atmosphere` 切换 |

根因不在模板，在契约：`ShareConfig`（`src-tauri/fileshare-core/src/config.rs:12`）只有 `port / localOnly / shareDirs / passwordSha256 / public`，**没有主题字段**，sidecar 无从得知 App 当前外观，只能各画一套。所以先补契约，再换骨架；否则这次对齐下次照样漂移。

## 2. 骨架：下载独占整页 + 上传弹窗

页条 64px（App `.page-bar` 档）：`brand + 页名 + 条数 ｜ 搜索 + 上传 + 齿轮`。没有页签——上传这件事有始有终，住弹窗比住第二个页签便宜，页条也不再需要为它保留第二个动作入口（「粘贴文字」住在弹窗的 `.seg` 里）。

**列宽公式**（宽屏那条账的正解，帧 1–4/9/10）：`:root { --col-max: 1440px; --gutter: 24px }`，`.pagebar` 与 `.wrap` 共用同一条 `padding-left/right: max(var(--gutter), calc((100% - var(--col-max)) / 2))`——页条与正文同轴，1920 下不再一根通栏条压着一段居中英，两侧留白由构造保证。底色仍是满幅 `--bg-workspace`。

**行档随容器换形**（帧 1/2 对拍）：`.wrap { container-type: inline-size }`，`@container (min-width: 1260px)` 时行改成六列 `34px 图标 · 名 · 目录 · 大小 · 日期 · 下载`（`min-height: 56px`、`.fpath` 隐 `.fdir` 现、目录右对齐），窄于此回到「名 / 路径」双行 64px。两形态的 DOM 同时挂着，靠 CSS 互斥：`.fpath` 走 `pages::path_tail`（尾两段），`.fdir` 走 `pages::dir_leaf`（`…/末段`），完整路径在 `title`。行宽封顶后名字不再被无限撑开，也不会把大小与日期顶到屏幕右缘。

**「上传」主钮**（`--accent` 实心）：在投时右下角标报在手边个数、钮底沿挂 2px 聚合进度线；全停且有失败时角标转 danger。弹窗关掉后，这唯一一处继续报状态（帧 10），下载列表不被打断。

**上传弹窗**（帧 5–9/19–21）：560×`min(470px,100%)`，定高、flex 列，切页签不抖。从上到下：顶沿 3px 聚合进度条（只在投时现）→ 头（`落到 …/share/docs · 46 / 188 个`）→ `.seg` 文件／文字 → 体 → 底栏（一行提示 + 关闭 + 再加文件／选择文件）。
文件档三态：**空**＝大井吃掉剩余高度（唯一给大井的一态）；**在投**＝井收成一条 `busy`（主色淡染，「正在投进 docs · 也可以继续往下拖」+ 已传/共/速率）+ 队列；**投完有失败**＝井收成一条 `slim`（check 字面形，「这一批投完 · N 个已落盘」+ 共/用时/未落盘数）+ 只剩失败档。文字档同一定高弹窗，textarea 吃剩余高度，存好即关弹窗刷列表，不进队列。

**拖入中**（帧 11）：监听挂在整页而非井——纱 6% 主色 + 一圈虚线 + 药丸「松手投进 docs · N 个文件」；松手即开弹窗（文件档）并起队列。

**手机 390**（帧 15/16）：`--col-max: 520px`、`--gutter: 14px`，页名与条数让位、搜索换第二行；日期让位、队列大小列让位、下载钮恒显；`.dlg-foot .st` 允许换行——它是文字档唯一的报错位，宁可两行也不能截。toast 由桌面「贴内容列右下缘」改成两侧 14px。

**定高弹窗里的空隙只落在两处**（真机帧 12/31 拍出来的账）：弹窗不跟内容长，所以「行少」时那截空白必须有归属——上传弹窗把它留给队列自己（`#q-rows` 撑开，总账行贴体块底沿、与底栏连成一组，不飘在半空被误读成队列的一行）；目录与外观弹窗把它给目录 textarea（`.grp.grow`，色板不再被顶到底栏跟前）。文字档空态的底栏那句与有内容时共用后半句（「存好后直接出现在下载列表」），不写「空文本」这种状态词，也不让那一行跳字。

**共用件**：齿轮 = 目录与外观（帧 14，壳与上传弹窗同族但按内容分档 470/540，第一个目录徽标「上传落点」+ 三档色板 跟随/纸/墨）；口令页（帧 18）照搬 App 锁屏字段档——40px 字段、左 16px 锁标、20px 眼、26px 实心 `--accent` 主钮、20px 防跳动错误槽。

## 3. 令牌单一来源

新增 `scripts/gen-fileshare-assets.mjs`，产出 `src-tauri/fileshare-core/src/templates/tokens.css`（入库，cargo 不需要 node）：

按选择器**逐字复制**这三处的工作区块，不改写、不重命名：

1. `src/styles/global.css` 的 `:root` 与 `[data-theme="ink"]`（结构令牌 + 两档底色 + `--ft-*`）
2. `src/styles/workspace-themes.css` 全部 `:root[data-layout="workspace"]…` 块（纸/墨画布对、极性微调、12×2 的 `--workspace-accent-source`）
3. `src/styles/materials.css` 的 `:root[data-layout="workspace"]…` 块（柔光配方、`--hover-chrome`）

选择器保持原样的前提：页面 `<html>` 挂上跟 App 同一组属性——`data-layout="workspace"`、`data-theme`、`data-base`、`data-accent`、`data-atmosphere`。级联自己完成派生（`--accent-soft`、`--text-brand`、`--brand-g1/g3` 全由 `color-mix`/`oklch(from …)` 算出），sidecar 不参与配色计算。

页面画布用 `background: var(--bg-workspace)`、弹窗面用 `var(--bg-dialog)`：`data-atmosphere` 一翻，边缘进光自动跟上，网页不再自写渐变。

`scripts/mock-build.mjs` 改抽同一份 `tokens.css`，删掉 mock 里手写的 `.win[data-theme=…]` 覆盖与 `::before` 渐变——mock 与真页面从这一刻起同源。

## 4. 主题戳契约

`ShareConfig` 新增四字段（camelCase 落盘，与既有键同风格）：

```json
{ "theme": "ink", "base": "dark", "accent": "teal", "atmosphere": "off" }
```

- 写方：`src/services/theme.ts` 的 `applyAppearance` 之后去抖上报（去抖 400ms，与 sidecar 的轮询同档；纸/墨/强调色/氛围任一变化才发，值未变不发）；新命令 `fileshare_set_theme`（`src-tauri/src/commands/fileshare.rs`）走既有 `config::update_file`，只动这四个字段，不吞别人的修改。
- 读方：sidecar 400ms mtime+size 轮询已覆盖，改主题不重启即生效；`pages::home_page/login_page` 把戳写进 `<html>` 属性（模板槽位 `%%HTML_ATTRS%%`，`data-layout="workspace"` 由 `pages::html_attrs` 钉死）。
- 词表也是生成物：`theme_values.rs`（同一支脚本从 `workspace-themes.css` 的选择器抽 `WORKSPACE_THEMES / _BASES / _ACCENTS`），"戳被接受"严格等价于"tokens.css 里真有这一块"。App 新增一档底色或强调色后重跑生成器，网页端才敢跟着换。
- 四值是 desko 那张 `<html>` 的拓印：读侧只查词表，不替它重新推导极性（`base` 因此是独立校验的第三个值，不是 `theme` 的派生量）。
- 兜底：底色或强调色不在词表 → 整戳回落 `paper + light + ink + off`，不留半套；氛围是布尔，`on` 之外一律按关算，不牵动另外三值。公网面（`face.policy.is_some()`）不采信戳，一律纸·蓝，避免把本机外观泄给公网访客。
- 上报失败（服务没起、文件写不进）静默：主题戳是装饰性契约，不得让换主题弹错误条。
- 配置文件还没落地时命令直接跳过（同 `write_public_policies` 的理由：换主题不该凭空创建一份 `shareDirs` 为空的配置，那种配置让服务进程拒绝启动）。于是第一次读取会创建配置件、里面四键为空 —— `fileshareSettings.ts` 的 `fsRefresh` 成功后调 `syncThemeStamp()` 补抄一次，网页不至于因为"服务刚配好"就一路纸·蓝。

## 5. 图标单一来源

`scripts/gen-fileshare-assets.mjs` 同时从 `src/utils/icons.ts` 抽白名单，生成 `src-tauri/fileshare-core/src/icons.rs`：`pub fn icon(name: &str, size: u16) -> String`，套 Solar 骨架的 `<svg … stroke-width="1.15">` 外壳。白名单（约 22 枚）：`navLan search upload download gear folder doc image archive code bulletlist file info clip check alert clock x lock eye arrowRight searchEmpty`。未知名字返回 `file`，不 panic。

`pages.rs` 现有的 8 个手写 `ICON_*` 常量与 feather 路径全部删除，`file_type_icon` 的返回值改当图标名查表用。

## 6. 文件类型色档

现在网页 6 桶、App 9 桶、`files.rs:128` 又是另一套 6 桶分法（`txt/md` 落 doc、`mp4` 落 vid、无 deck/sheet/mark）。统一成 App 的 9 桶并补两档：

- `src/styles/global.css` 8 个底色块各加 `--ft-vid` / `--ft-audio`（两轴对比度 ≥4.5，跑 `scripts/color-sweep.mjs` 复核）
- `src/components/files/FileShortcutsModule.vue:288` 的 `EXT_SLOT` 加 `vid` / `audio` 两桶
- `src-tauri/fileshare-core/src/files.rs:128` `file_type_icon` 改成与 `EXT_SLOT` 同一份分法（pdf/doc/sheet/deck/arch/code/mark/img/vid/audio/unk），单测 `icon_buckets` 同步

## 7. 上传队列：可见行数与任务数无关

传输面维持**每文件一个请求、串行发**（帧 19–21 那 200 个也不会并成一条请求）：端点与解析不动（`read_multipart` 收一个 part 即可），`?share=0` 不变；一批投完刷一次下载列表（`?partial=1`），不 `location.reload()`；队列只活在浏览器内存，刷新即清，文件本身已落盘。

r2 改的是「队列怎么活」，三条：

**成功不入队列。** `xhr` 成功即从 `queue` 里 `splice` 掉，列表里没有「已完成」这一态。落盘只以两处的汇总出现：弹窗头 `46 / 188 个` 和底栏台账 `已进下载列表 46 个 · 3.9 GB ›`（点 › 关弹窗刷列表）。所以 200 个文件的队列最多同时挂 `在投 1 + 失败若干`，越投越短，绝不可能排出一屏绿色勾。

**折叠。** `RECENT = 2`，某档（排队／失败）≤2 条逐行列出；>2 条先出一条折叠行（`等 N 个 · 展开`／`N 个没有落盘 · 展开`），展开后也只给最近 2 条 + 一条尾注（`更早的 118 个按选择顺序排在后面，不逐条列出`／`更早的 10 条同因`）。失败档默认展开、排队档默认收起（`open = { wait:false, fail:true }`），因为「为什么没成」要一眼看到，「后面还排着多少」不需要。

**口径分开。** 头部与井里报的是**需传**（`needTotal`：入队时扣掉当场判掉的下限外文件后累计，成功 `splice` 时不减），所以进度条能到 100%；`qhead` 报「有活」的 `seen 个文件 · 需传 X`；`qfoot` 报去向；底栏那句 `.st` **不讲条数**（条数住在 `qhead` 和折叠行里，不滚动就能看见），只讲这一批的去向。`qhead`/`qhint` 在没有活时整行隐藏，不拿一句话占位。

**重试只给瞬时失败。** 失败原因沿用服务端既有中文文案，不新增协议字段（413 在前端映射成「超出 4 GiB 上限，没有落盘」）。413（含前端当场判的超限）、403、401 一律 `retry:false`——同因重投还是同因，所以纯超限那一批不给重试入口（帧 21 只有尾注，没有钮）；网络断、5xx 才 `retry:true`，折叠行的「重试这一批」只重投 `retry` 项。

**井（drop 区）跟着状态收形。** 空态才给 178px 大井（唯一一态）；在投时收成一条 `busy`（主色淡染 + 「正在投进 docs · 也可以继续往下拖」+ 已传/共/速率）；投完只剩失败时收成 `slim`（check 字面形 + 「这一批投完 · N 个已落盘」+ 共/用时/未落盘数）。速率按 `item.startedAt` 起算，因此 `paintWell` 在「只有排队、还没轮到」时必须判空取 0——这一条在真机帧里暴露成 `Cannot read properties of undefined (reading 'startedAt')`，已修。

## 8. 保持不动

`guard.rs` 的 Origin/`Sec-Fetch-Site` 同站门、`/fonts/app.woff2` 内嵌字体、会话 cookie 与登录限速、`/settings` 只允许局域网面写、`claim_available_name` 的 `(1)` 避让、`page_entries` 的 mtime 倒序与 `PAGE_SIZE` 续加、`PARTIAL_SEP` 协议、`PublicPolicy.read_only` 语义。

## 9. 落地清单

| 文件 | 动作 | 状态 |
|---|---|---|
| `scripts/gen-fileshare-assets.mjs` | 新增：抽 tokens.css + 主题戳词表 + icons.rs | 已落地 |
| `scripts/mock-build.mjs` | 改：token 源换成生成的 tokens.css（`--tokens`，其余 mock 不受影响） | 已落地 |
| `design/fs-web/mock-src.html` | r2 重画：21 帧真 token 稿（下载独占整页 + 上传弹窗 + 折叠队列 + 定高弹窗空隙归属），与出货件同口径 | 已落地 |
| `src-tauri/fileshare-core/src/templates/tokens.css` | 新增（生成物，入库） | 已落地 |
| `src-tauri/fileshare-core/src/theme_values.rs` | 新增（生成物，入库）：词表取自 workspace-themes.css 的选择器 | 已落地 |
| `src-tauri/fileshare-core/src/icons.rs` | 新增（生成物，入库） | 已落地 |
| `src-tauri/fileshare-core/src/config.rs` | 改：`theme/base/accent/atmosphere` 四字段 + `ThemeStamp` + 落盘键名单测 | 已落地 |
| `src-tauri/src/commands/fileshare.rs` | 改：`fileshare_set_theme` 命令 | 已落地 |
| `src-tauri/src/main.rs` | 改：注册该命令 | 已落地 |
| `src/services/api/fileshare.ts` | 改：`setTheme` 封装 | 已落地 |
| `src/services/theme.ts` | 改：外观变化去抖上报戳 + `syncThemeStamp` 补抄 | 已落地 |
| `src/services/fileshareSettings.ts` | 改：`fsRefresh` 成功后补抄（新创建的配置件四键为空） | 已落地 |
| `src/services/__tests__/theme.test.ts` | 改：上报去抖、同值不发、失败静默；计时器全程走假的 | 已落地 |
| `src-tauri/fileshare-core/src/pages.rs` | 改：`html_attrs` 注入 + `%%I:name:size%%` 图标槽展开（先展槽再灌数据）；r2：`dir_leaf`（六列形态的 `…/末段`）、空态文案改指「右上上传钮」、`%%UPLOAD_HINT%%` 换掉页签计数槽 | 已落地 |
| `src-tauri/fileshare-core/src/templates/home.html` | 重写：下载独占整页 + 上传弹窗（560×470 定高、`.seg` 文件／文字、三态井、折叠队列、成功不入队）；列宽公式 + 容器查询换行形态；无页签 | 已落地 |
| `src-tauri/fileshare-core/src/templates/login.html` | 重写：锁屏字段档（40 字段 / 左锁标 / 20 眼 / 26 实心主钮 / 20px 报错槽） | 已落地 |
| `src-tauri/fileshare-core/src/files.rs` | 改：`file_type_icon` 对齐 11 档 | 已落地 |
| `src/styles/global.css` | 改：`--ft-vid` / `--ft-audio` × 8 块 | 已落地 |
| `src/components/files/FileShortcutsModule.vue` | 改：`EXT_SLOT` 两桶 | 已落地 |
| `src-tauri/fileshare-core/src/icons.rs` | 补：`eyeOff` 一枚（白名单 25 键） | 已落地 |
| `scripts/gen-fileshare-assets.mjs` | 改：令牌抽取消除 scale 层重复；`REQUIRED_SLOTS` 含 11 个 `--ft-*` | 已落地 |
| `scripts/fs-web-shots.mjs` | 新增：起一次 sidecar、热换主题戳，落 32 帧真机验收图（含 40 文件的折叠队列两帧；`bulk/` 与 `share/empty` 两组数据；CDP 限速 200 KB/s 造出真进度与真排队） | 已落地 |
| `e2e/specs/fileshare.spec.ts` | 不改：该 spec 只覆盖 App 侧模块页，网页端由 `cargo test -p fileshare-core` + `fs-web-shots.mjs` 验收 | 不适用 |

## 10. 验收

1. `node scripts/gen-fileshare-assets.mjs --check` 生成物三项不变（重复生成幂等）
2. `cargo test -p fileshare-core`（含新增：戳缺失回退、`<html>` 属性注入、每文件 413 映射、图标槽无残留、`js_str` 不能越出脚本、11 档都有真字形、`dir_leaf`、空态文案不再指页签、页条无第二入口）
3. 对拍两端先各出一遍产物：mock 侧 `node scripts/mock-build.mjs design/fs-web/mock-src.html design/fs-web/mock.html --tokens=src-tauri/fileshare-core/src/templates/tokens.css`，真机侧 `node scripts/fs-web-shots.mjs`（在仓库根跑，它会先 `cargo build` 出 sidecar）落 32 帧真机图（纸/墨/青 × 桌面 1920·1280·760·390 × 下载/两形态行档/上传弹窗四态/目录与外观/登录/关氛围/整页拖入/0 文件/单目录/折叠队列），逐帧与 `design/fs-web/mock-src.html` 对拍（同 token 同骨架，允许数据差异）；脚本会打印每帧的 `pageerror`，**任何一帧报错都算未过**（本轮就是这样逮出 `item2rate(undefined)`）。「在投」那几帧必须走 CDP 限速才拍得到——loopback 上 16 MB 在 600ms 内就投完了，不限速拍到的是投完态
4. 换 desko 强调色（群青→湖蓝）与深浅，不重启服务，400ms 内刷新网页跟随
5. `fs-web-shots.mjs` 每轮附带类型档体检：11 枚图标色压在实涂卡面上的对比度逐档打印 + 家族水位（min~max/中位）。类型档是装饰位（文件名与扩展名才是正文），判据是**新档不落单**而非绝对 4.5；`unk` 为中性档，天生低于彩档，不入水位
6. 失败档的**真**帧不拍：要出真 413 得先造一个 >4 GiB 的文件推上去，不值得为一张图占 5 GiB 磁盘。「超限折叠 + 不给重试」由 mock 帧 21 覆盖，真机侧 31/32 两帧覆盖的是折叠机制本身（40 个真实文件、在投 1 + 排队折叠）
7. `npx playwright test e2e/specs/fileshare.spec.ts`（`PW_CHANNEL=msedge`）确认 App 侧模块页未受影响

## 11. 非目标

- 不做网页端目录筛选/排序开关（App 侧也没有）
- 不做公网侧界面（穿透页的公网形态是另一套，见 `docs/design/tunnel/01-tunnel-module.md`）
- 不做队列持久化、断点续传、并发多文件上传
- 不引入前端框架，仍是模板 + 原生 JS

## 12. r3（2026-11-18）· 文字不再借文件的身

r2 把「文字」放进上传弹窗的 `.seg` 里：粘贴 → `/save-text` → 落成 `笔记.txt`。走了一圈文件模型，代价是两头都要开门：

- **App 端根本没有入口**：想发一段验证码，得先建 txt 再拖进来（页面上没有文本框）
- **网页发来的文字桌面上看不见**：落成 `.txt` 之后，桌面页的「本次投递」只记自己拖进去的文件，用户得去共享目录里翻
- **读一条要下载**：列表里点 `.txt` 是 `Content-Disposition: attachment`

r3 把文字变成**自己的对象**：`texts.json`（档案根，不进共享目录）+ `POST /text` + 首页「文字」区块。**`/save-text` 删除**（连同 `.seg`、`#pane-text`），上传弹窗回到只收文件。

| 面 | 现在 |
|---|---|
| 落盘 | `<profile>/texts.json`，单条 64 KiB、总 100 条，超出从尾部掉出去。跨进程锁与配置同一套（`.json.lock` + 原子 rename） |
| 写入方 | ① 网页 `POST /text`（source=`web`）② App 命令 `fileshare_text_push`（source=`app`）。服务没启动也能记，网页那一侧等它启动后自然看得见 |
| 网页区块 | 页头之下、共享文件之上：粘贴框 + 「发到电脑」+ 卡面清单（来源 / 时间 / 全文 / 复制 / 删除）。全文直接进 DOM，CSS 裁四行、溢出才放「展开」，没 JS 也能读前四行 |
| 首屏条数 | 网页最多摊 12 条（再多一句「还有 N 条，在 desko 里看」）；App 侧是一列可滚动的卡，最多 100 |
| 复制 | 局域网是 `http://10.x.x.x`，**不是安全上下文**，`navigator.clipboard` 拿不到 → 走 `execCommand` 兜底，失败就明说「长按选中」 |
| App 侧 | 投递卡开成「文件 / 文字」两档（页头右端页签，页高不变）；文字档 = 输入框 + 发到网页 + 最近往来（复制 / 删除）。网页发来的新条目靠 3 秒轮询报到，页签上挂未读数 |
| 公网只读 | `/text` 与 `/text-delete` 一并收进 `read_only` 那条策略 |

**对端的称呼是「网页」，不是「手机」**（11-18 定稿）。这条链路真正的好处是"对端是浏览器页面"——电脑、平板、手机都能开，写成手机就把自己限定在现场扫码这一个用法上。两端标签按各自视角写：App 侧 `app`→「发到网页」、`web`→「来自网页」；网页侧对调成 `web`→「发到电脑」、`app`→「来自电脑」。

App 端读同一个 `texts.json`（`fileshare_texts`），因此两端的"最近往来"是同一份东西，不存在两边各记一套。

## 13. r4（2026-11-18）· 两端合成一条对话流

r3 把文字扶正了，但页面上因此变成**三份清单**：App 侧「投递卡片 / 共享文件 / 最近往来」，网页侧「文字区块 / 共享文件 / 上传弹窗」。用户原话是"能不能改成 IM 形式，可以互相发消息和文件"——问题不在哪一份不好看，在**同一段往来被切成了三种形态**：想确认"刚才那个文件对方收到了没"，得在三个区块之间对时间。

r4 把三者并成一条流：一条消息 = 一次往来，文字和文件是同一层的两种 `kind`。

| 面 | 现在 |
|---|---|
| 存储 | `<profile>/messages.json`，单条 200 条上限（超出从尾部掉），文字单条 64 KiB。仍是跨进程锁 `.json.lock` + 原子 rename |
| 模型 | `Message { id, dir, kind, text, name, size, share, dir_hint, created_ms }`。`dir` 是方向（`app` / `web`），`kind` 是 `text` / `file` |
| 文件消息 | **不存内容**，只存一份快照（名字、大小、落在第几个共享目录）。文件仍落在共享目录里，`share` 就是"在哪一栏能找到它" |
| 记录时机 | 三处各记一条，都是"落盘成功之后"：网页 `POST /upload`（`dir=web`）、App 拖入 `fileshare_import_files`（`dir=app`）、网页 `POST /text`（`dir=web`）。**失败的不记** |
| 方向 | 桥这一层就定死：同一个 `fileshare_message_push`，桌面调记 `app`，浏览器经 `/api/invoke` 调记 `web`（`web_access/network.rs`）。方向写错了，对面就会看到"自己说的话" |
| 谁在说话 | 两端各按自己的视角算：App 看到 `app`→「我」、`web`→「网页」；浏览器看到 `web`→「我」、`app`→「电脑」。位置（左/右）与气泡底色跟着走 |
| 文件气泡的动作 | App：扩展名牌 + 名字 + 大小 + 「定位」（资源管理器 `/select`）。浏览器：名字 + 「下载」（`/download?share=&name=`）。在浏览器上给"定位"没有意义——那会在**别人的电脑**上弹窗 |
| 文件已不在目录里 | 网页端 `GET /` 渲染时逐个 stat，缺了就把下载位换成「已不在共享目录」，不做一个点了才报错的死链 |
| 网页首屏 | 只摊最近 40 条（`WEB_STREAM_LIMIT`），再多一屏到底；全量在 App 里看 |
| 轮询 | 仍是 3 秒一次 `fileshare_messages`；`knownIds` 只对"新到且来自对面"的报一声 toast，不重复报到 |
| 旧数据 | 启动时 `migrate_legacy_texts` 把 `texts.json` 并进流（每条补 `kind=text` 与时间），原文件改名 `texts.json.migrated` 留档，不删 |
| 路由 | `POST /text` 保留；`/text-delete` 改名 `/message-delete`；三者（`/upload`、`/text`、`/message-delete`）一起进 `read_only` 策略 |
| 命令 | `fileshare_texts / fileshare_text_push / fileshare_text_delete` → `fileshare_messages / fileshare_message_push / fileshare_message_delete`，另加 `fileshare_reveal_file` |

**共享目录入口没有取消**：网页端仍留 `#btn-files`「共享文件」折叠块（原来的全量文件列表带搜索），因为"翻一个上月传的 pdf"不是对话流擅长的事。对话流管"刚才那一来一回"，文件列表管"我扔进去过什么"。

两端都是同一份 `messages.json`，不存在各记一套；这也是为什么"服务停了仍能读历史"——流在档案里，不在端口上。

## 14. r5（2026-11-19）· 桌面端：整页一张卡，连接信息压成卡头

r4 之后桌面端仍是「连接卡 + 对话卡」上下两块。默认窗 1040×670 里：页头 56 + 连接卡 ~200 + 间隙 22 + 状态栏 28，留给对话的只有 340px 左右——一次露两条往来，"发一句话"要先滚一下。用户的原话是「对话窗口明显太小」。

试过两版，只有第三版立住：

1. **左栏方案**（连接信息独立成 `clamp(250px,32%,300px)` 的窄栏，对话占右栏）——高度上来了，但 260px 宽的栏里只有地址和三行元信息，下半截是一大片空；二维码被挤到底部，卡头还想在栏里再放一次标题。实机截图被否：「排版不行」。
2. **上下堆叠 + 加大卡高**——只是把滚动条往后推，连接卡本身的信息量不值 200px。
3. **定稿：整页一张卡**。连接信息不再占版面，压成卡头的一行。

| 面 | 现在 |
|---|---|
| 卡头 | 左起：`对话` + `N 条 · 网页 M` + 监听状态胶囊 + 访问地址（点了即复制）；右端：`文件存到` 目录选择、`二维码`、`启动/停止服务`、共享设置齿轮。`spacer` 把两组分开 |
| 卡头子项 | `.chat-head > * { flex: none }`，只有地址 `flex: 0 1 auto` 可被压窄（省略号收尾）。不这么写，窗口一紧计数和按钮会各自缩成半截 |
| 二维码 | 从卡头那颗按钮往下落的浮层（`.qr-pop`，绝对定位在卡内）。同网段地址、本机地址、口令说明都搬进去——这些是"第一次连"才看一次的东西，不该常驻占行。`.qr-scrim` 铺满卡身，点空白收起；卡头 `z-index: 25` 高于遮罩，浮层开着也能直接点停止服务 |
| 提示条 | 仅本机 / 未设口令 / 端口漂移合成一条 `.chat-warn`，贴在卡头下方。r4 时「仅本机」只写在二维码旁的小字里，等于没提示 |
| 未启动 | 服务没起时流的第一屏是一张 `fs-idle` 说明卡（访问范围 / 端口 / 口令），历史记录照常读 |
| 高度 | `.lan-content` 是 `flex: 1`；`.chat-card` 跟着吃掉剩余高度（`min-height: 340px`）。整页不再有第二条滚动条，`.lan-page` 的 scrollHeight 必须 ≤ clientHeight |
| 窄窗 | ≤1000px 隐藏「文件存到」四个字只留选择器，地址上限收到 150px；≤600px 卡头不再重复页名与条数（手机上有页面标题），地址全交给二维码浮层 |
| 骨架屏 | 同一个卡形：`loading-head` / `loading-stream` / `loading-composer` 三段，载入完成不跳 |

**为什么连接信息可以退到卡头**：这一页的常态是"已经连上了，正在传东西"。地址与二维码只在"换一台设备连"时用得上，用一次；对话流是每一秒都在看的。r2 定下的"下载独占整页"其实是同一个判断，只是当时把它做成了另一张卡。
