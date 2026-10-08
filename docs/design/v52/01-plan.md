# V5.2 规格收编方案（外部设计稿 → desko 现状）

- 来源：`Desko 设计系统与前端开发文档 (V5.2)` + 原型 `~/Downloads/desko_desktop_prototype_v5_2.html`
  （1551 行，已全文读完：令牌 11–76 / 骨架 106–145 / 组件 292–833 / markup 835–1159 / JS 1165–1551）。
  第二份附件 `gemini-code-1790737905518.html` 在 Edge Temp 目录已被清理，读不到，按未提供处理。
- 现状基线：`src/styles/global.css`（paper 净灰 v3 / ink 暖石 D1，两轴 96+17 槽）、
  统一页面骨架（`.page-bar` 48px / 行轨 60px）、行卡体系（轻量化轮 9-28 基线）
- 对拍 mock：`docs/design/v52/proto/01-entries-grid.html` → `scripts/v52-shots.mjs` →
  `docs/design/v52/proto/shots/{paper,ink}-{rows,grid}.png`
- 拍板时间：2026-09-30（同日两轮：先看令牌，后补读全文再定 4 项）

## 1. 裁定总表

| # | V5.2 条目 | 裁定 | 依据 |
|---|---|---|---|
| C1 | 收藏页 3 列卡片浮岛网格 | **采纳**（推翻 2026-09-26「bento 排版不吸收」） | 实尺 mock 过目后拍板 |
| C1b | 文件快捷页同用 `cards-grid` | **采纳**，与收藏页同批改 | 补读 markup `view-files` 后追加 |
| C2 | ink 字阶 `#f2eee6/#c5beb3/#888175/#595349` | **保留现值** | spec muted 4.17:1、faint 2.11:1，低于 ≥5.8:1 底线 |
| C3 | paper 暖纸 `#f7f6f2` + 纯白面 + 暖褐描边/字色 | **保留净灰 v3** | 该组值是「减黄提净」轮之前的暖纸 v2 |
| C4 | ink 物理明度阶梯 `#181716 → #22211e → #282622` | **采纳 spec 原值** | 代价已知：画布→卡片 ΔL* 由 8.7 降到 4.9 |
| — | 顶栏 54px | **采纳**，且**保持单层**（搜索/分类段/新增钮仍在这条里，不拆 spec 的两层） | 补读发现 spec 是「54 身份条 + 内容区控件条」两层，用户选单层 |
| — | 侧栏三态 208 / 56 / 0 | **采纳**（现两态 180 / 64） | Ctrl+B 由二态翻转改三态循环 |
| — | 卡片 hover 抬影 + 主钮 pill + accent 彩色投影 | **全按 spec**（推翻 9-28「抬影作废」，仅限网格卡与主钮） | 见 §5 |
| — | ↑↓←→ 游走 + `C` 复制 + `Enter` 打开 | **采纳**，但按实测列数求步进（spec 写死 ±3） | 见 §6 |
| — | Toast 右下反色胶囊、0.8s | **采纳**，取 spec 配方（见 §7，非我初稿的描边胶囊） | — |
| — | 局域网页 状态横幅 + 大拖拽直投区 | **采纳**，横幅与拖拽区都做 | 后端已核实，见 §8 |
| — | 小记 自伸缩输入盒 + 快捷插入芯片 + note-bubble 卡形 | **按 spec 重做**，与既有机制的冲突见 §9 | — |
| — | 顶栏主题/accent 切换胶囊 | **不做**，主题仍只住设置弹窗 | 用户裁定 |
| — | 小记待办/置顶/过滤/计数联动 | **已在** | tiptap TaskList + `NotesModule` 视图 chips |

## 2. 令牌映射（spec 名 → desko 槽，不改 desko 键名）

| V5.2 | desko | 处理 |
|---|---|---|
| `--bg-canvas` | `--canvas-bg`（= 光晕 over `--sunken`） | 只换 `--sunken` |
| `--bg-surface` | `--panel-bg` / 别名 `--bg-surface` | 换值 |
| `--bg-surface-elevated` | `--hover` | 换值 |
| `--bg-surface-soft` | `--bg` | 换值 |
| `--border-subtle/-card/-hover` | `--border-subtle` / `--border` / `--border-hover` | 换值 |
| `--text-title/-body/-muted/-faint` | `--text` / `--text-secondary` / `--text-muted` / `--text-faint` | **不换**（C2） |
| `--accent-tint` / `--accent-fg` | `--accent-soft` / `--accent-on` | 别名已存在 |
| `--radius-card: 14` | `--radius-xl`（`--radius-card` 现指 `--radius-lg`=10） | 网格卡与小记卡走 `--radius-xl` |
| `--radius-ib: 10` / `--radius-sm: 8` / `--radius-pill: 9999` | 现 9 / 6 / 99 | **不换**（图标骨架轮与胶囊档已拍板） |
| accent 名 `indigo/ochre/violet` | 现 `ink/clay/plum` | **不换名**：`data-accent` 值已持久化 |
| 字号 13.5 / 11.5 / 12.5 / 14.5 / 16 | `--text-sm` 13 / `--text-xs` 12 / 14 / `--text-base` 14 | **落档**：字号阶梯排除半像素 |
| `localStorage` 持久化 | Tauri store + 加密层 | **不移植** |

## 3. ink 新阶梯（C4 落地值）

spec 只给 4 层，其余按「与卡面的 ΔL* 保持现值」在白方向上重新求解
（求解器 `tmp/ink-solve2.mjs`，P1 时移入 `scripts/ink-ladder.mjs` 固化）。

| 槽 | 现值 (L*) | 新值 (L*) | 来源 |
|---|---|---|---|
| `--sunken`（画布基色） | `#1e1d19` (10.7) | **`#181716`** (7.8) | spec canvas |
| `--bg` | `#23221e` (13.2) | **`#1d1c1a`** (10.3) | spec surface-soft |
| `--panel-bg`（卡片） | `#312f29` (19.4) | **`#22211e`** (12.7) | spec surface |
| `--hover` | `#38352e` (22.2) | **`#282622`** (15.2) | spec surface-elevated |
| `--active` | `#46423a` | `#343431` (21.6) | ΔL* 等距 |
| `--fill` | `#3b382f` | `#2a2927` (16.6) | 同上 |
| `--sidebar-bg` | `#282621` | `#1a1917` (8.8) | 画布→卡片方向求解 |
| `--border-subtle` | `#34322c` | `#252421` | Δ1.5 |
| `--border` | `#413e37` | `#30302d` | Δ7.0 |
| `--border-strong` / `--border-hover` | `#565249` | `#434340` | Δ15.6 |

连带必改：`--chrome-bg` → `rgba(29,28,26,.86)`、`--frost-bg` → `rgba(34,33,30,.88)`、
`--frost-border` → `#30302d`、`--sidebar-hover` → `#282622`、`--lock-wash-a/b` → `#1d1c1a`/`#22211e`、
`--brand-knob` → `#1d1c1a`、`--danger-on` → `#181716`、`--shadow` 的 1px 环 → `#434340`、
`--danger-soft`/`--success-soft`/`--warning-soft`/`--danger-border` 保色相整族缩放到与卡面同 ΔL*。
`--tip-bg/--toast-bg`（反色浮层）、`--cat-*`、`--ft-*`、`--code-*` 卡面变暗后对比自动上升，
跑 `scripts/color-sweep.mjs` 复核，不预先改。
`src/services/theme.ts` 的 ink `prev` 预览块（page/sidebar/card/rowHover/edge）必须同步。

**P1 落地时的两处改判**（写码时按"沿用旧对应关系"执行，覆盖上面两行原值）：
`--chrome-bg` 与 `--lock-wash-a` 跟 **`--bg`** 走而不是跟画布——旧值关系是 chrome-bg==bg、wash-a==bg，
跟了 sunken 会让吸顶条与锁页底比应用底色暗一档、凭空多出一层；
`--lock-wash-b` 跟 `--panel-bg`、`--danger-on` 跟 `--sunken`、`--shadow` 环跟 `--border-strong`，同理。

**P1 验收已过**（2026-09-30）：`check-theme-coverage.mjs` 2×96 对齐 + 8/8 accent 组合；
`color-sweep.mjs` ink 四组合对比度不达标项为 0，纸底三处旧豁免（meta-dot 装饰 / span@10 与 hints-dot 4.49 在 fill 上）未变；
面族台阶实测 L\* 7.8(画布) → 8.8(侧栏) → 10.3(bg) → 12.7(卡面) → 16.6(fill)；
`sticky-band-check.mjs` 五页全 ok；`theme-shots.mjs ink` 12 屏 × 4 accent 出图于 `design/theme-shots/ink-*`。

验收账：字阶在新卡面 text 12.66 / secondary 9.25 / muted 7.02 / faint 5.66:1。

## 4. 浮岛网格（C1 + C1b，收藏页与文件页）

- 容器：`display:grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap:14px`
  —— spec 原值 310px 在默认窗（内容宽 928px）只落 2 列，与「3 列自适应」自相矛盾，取 280px
- 卡直接浮在画布上，**不再包 `.rowlist` 白面板**（否则卡中卡）
- 卡：`--radius-xl` / padding 15 / `--panel-bg` / 1px `--border` / `--shadow-card`
- 内容：34×34 图标槽（`--radius-ib`；字母块沿用 `color-mix(text 7%)`，favicon 到货换图标面，
  **不用 spec 的 emoji 头像**）→ 标题 13px/600 单行截断 → URL/路径 12px `--font-mono` `--text-muted`
  → 脚注 `1px dashed --border-subtle`：左分类胶囊（文件页左"更新于"），右 hover 显形的复制钮
- 保留现有：勾选批量 `.card-check`、`.selected` 浸润态、⋯ 菜单与右键
- 密度账：一屏约 6 条（一行卡 10 条）。搜索、分类段、批量不受影响
- 文件页额外列：路径长，`--font-mono` 12px 下按尾部优先截断（保文件名，省中间）

## 5. hover 与主钮（全按 spec，含对 9-28 基线的局部推翻）

- 网格卡 hover/focus：`transform: translateY(-2px)` + `--shadow-pop` + `--border-hover`；
  底色换 `--hover`（ink 下即 elevated；**paper 下 spec 的 elevated==surface==纯白，等于不换底色**，
  我们保 paper 换 `--sunken`，否则浅色 hover 无反馈——这条是 spec 自身的洞）
- 键盘焦点：`border-color: var(--accent)` + `0 0 0 3px var(--accent-soft), var(--shadow-pop)`
- 主钮 `.btn-primary`：`--radius-pill` 圆角 + `box-shadow: 0 4px 14px -3px var(--accent)` +
  hover `translateY(-1px)`；**高度仍锁 28px 档**（spec 的 `padding:7px 15px` 会落到 ~30px，
  与弹窗底栏 46px/28px 尺寸轴冲突），只改圆角与投影
- 行卡（验证码/设置/弹窗内列表）不受本节影响，仍按 9-28 轻量化基线
- 副作用清单：`prefers-reduced-motion` 下位移被压掉，抬影保留；`design-audit.mjs` 的
  「hover 不得抬影」规则项需按新边界改写（只豁免网格卡与主钮）

## 6. 键盘系统

- `EntriesModule.onListKeydown` 现只处理 ↑↓；改为二维：↑↓ 跨行（±n）、←→ 同邻（±1）。
  **n 由实测列数得出**（读 `.grid` 的 `getComputedStyle().gridTemplateColumns` 分段计数），
  不写死 spec 的 3——窗口收窄到 2 列时 spec 的 ±3 会跳错行
- `C` = 复制当前卡片的 URL/路径（复用 `copyText` 通道，走 desko 的 text/plain 裸链接轨）；
  `Enter` = 打开（spec 文档写了但 JS 未实现，我们补上）
- 焦点态用 DOM `focus()` + `:focus-visible`，不引入 spec 的 `.focused` 手工类；
  过滤后隐藏卡不参与游走序列；输入框/编辑器（contenteditable）聚焦时一律不劫持

## 7. Toast（取 spec 配方）

- 位置：`right:20px; bottom:20px`（避开批量浮底栏 `--dock-clearance`）
- 形态：**反色胶囊**——`background: var(--text); color: var(--bg)`，padding 6px 14px、
  `--radius-pill`、12px/500、`box-shadow: 0 6px 20px rgba(0,0,0,.2)`
  （ink 下自动翻成亮底暗字，与现 `--toast-bg` 反色族一致，故改用 `--toast-bg/--tip-fg` 而非字面 text/bg）
- 时长：0.18s 进出，出现后 **0.8s** 淡出；错误类保留 2.4s（0.8s 读不完一句失败原因）

## 8. 局域网页（横幅 + 拖拽直投）

- 状态横幅：40px 方块图标槽（`--accent-soft` 底 + accent 图标）+ 服务状态标题 + `--font-mono` 的
  `http://IP:PORT`；右侧「管理共享」走 `.btn-secondary` 档（`.btn` 在本仓不存在），点击仍开设置弹窗
  fileshare 页签（不新做面板）
- **横幅吃掉原「访问地址」卡的表头**（落地时的去重裁定）：`监听中` 在页条胶囊、横幅标题、地址卡
  三处重复，`http://IP:PORT` 在横幅与局域网行两处重复。故地址卡只留一张：上半是横幅（状态 + 管理共享），
  下半是局域网/本机两行地址；页条只剩启停钮
- 拖拽区：`1.5px dashed --border-hover`、`--bg`(surface-soft) 底、padding 32px 20px、
  hover/`drag-active` 转 accent 描边 + `--accent-soft` 底；`scrollbar-gutter: stable` 照旧
- 落盘通道（**已核实并推翻原方案**）：`fileshare-core` 的 `POST /upload` 从桌面 WebView **打不到**——
  `handlers.rs:73-84` 对 POST 校验 `Sec-Fetch-Site` 与 `Origin` 主机，与 `Host` 不一致直接
  `403 Cross-site request rejected`；`tauri.localhost` 的 Origin 永远不等于 `127.0.0.1:端口`，
  有口令态还要 `fsid` HttpOnly cookie。这道门是刻意挡 DNS 重绑/跨站表单的，**不放宽**。
  改走 Tauri 命令 `fileshare_import_files(shareIndex, paths)`（`src-tauri/src/commands/fileshare.rs`），
  路径来自 `getCurrentWebview().onDragDropEvent`，落盘复用同一套公开件
  `sanitize_upload_name` + `claim_available_name`（`photo.jpg → photo (1).jpg`，绝不覆盖）。
  大小上限：网页端限单次请求合计 4 GiB，本地拖入按**单文件** 4 GiB 限（一次拖是多份独立拷贝，
  合计封顶会把大批投递拦在半路）；文件夹、读不到、超限、已在目标目录各自回一条原因，不静默丢。
  服务未运行时拖拽区置灰并提示「先启动服务」，不静默失败
- 完成后按 §7 出 toast，并在页内追加提取链接行（复用现有链接行样式）：
  `http://IP:PORT/download?share=N&name=<url 编码名>`，与 `pages.rs:42 download_href` 同格式

## 9. 小记页（按 spec 重做，与既有机制对账）

现状核实：`.memo` 已是独立卡（`--bg-surface` + `--radius-card` + hover 换 `--bg-surface-hover` +
pinned 描边 accent-light + editing 3px 环），composer 已有 `:focus-within` accent 描边 + 3px 环 +
`Ctrl+Enter 发布` 提示 + 展开后 `min-height:148px`。所以 spec 的「重做」里真正缺的只有三件：

1. **真自伸缩**：按 `scrollHeight` 逐键伸缩（现只在聚焦时跳到 148px 定高），失焦收回一行
2. **快捷插入芯片**：`- [ ] 待办` / `` `代码` `` / `#标签`，插在光标处（复用 tiptap chain，不改 Markdown 源）
3. **卡 meta 行**：时间 + 可点标签 + 置顶/复制，按 spec 排在正文上方（现动作条已在上方，只需把标签做成可点胶囊）

冲突处置（默认按下列执行，如不认同请在批准时指出）：

- spec 的 `note-bubble:hover translateX(2px)` **不采纳**（横向位移在流里像抖动，且你禁过入场动画）
- spec 卡形不带 `--memo-max-h` 折叠：保留现有折叠/展开（长文上限 144px + 展开钮），否则长记把流撑爆
- 全屏书写密度 B 档（13.5/23 只读、15.5/1.68 书写）与列宽**不动**，本节只改流卡与 composer
- 置顶态用描边（现 `--accent-light`），不用 spec 的 `0 0 0 1px accent-tint` 双描边

## 10. 不做项

1. `--radius-sm` 6→8、`--radius-ib` 9→10、`--radius-pill` 9999
2. accent 改名 indigo/ochre/violet（要动持久化值）
3. 半像素字号 13.5/11.5/12.5/14.5
4. `localStorage` 便签持久化（与 Tauri store + 加密层重复）
5. `.tab-view` 的 opacity/translateY **入场动画**（你明确禁过）
6. emoji 头像（🐧⚡🏗️）、侧栏底部「同步就绪」脉冲点（本地工具无同步）、`⌘K` 文案（Windows 写 Ctrl K）
7. 顶栏主题/accent 胶囊
8. 窗口 `max-width:1240px/height:800px/border-radius:18px`（原型专属，真窗由 Tauri 给 1040×670、`decorations:false`）
9. spec 侧栏只有 4 项（无验证码模块）—— 我们保持 5 项

## 11. 分期

| 期 | 内容 | 主要文件 | 验收 |
|---|---|---|---|
| P1 ✅ | ink 新阶梯 + 连带槽位 + theme.ts 预览 | `src/styles/global.css`、`src/services/theme.ts` | `check-theme-coverage.mjs`、`color-sweep.mjs`、`theme-shots.mjs` |
| P2 ✅ | 页条 54px（单层）+ 侧栏三态 208/56/0 | `global.css`、`App.vue`、`layout/Sidebar.vue`、`layout/TitleBar.vue`、`e2e/specs/navigation.spec.ts` | `nav-shots.mjs`、`navigation.spec.ts`、`sticky-band-check.mjs` |
| P3 ✅ | 收藏页 + 文件页浮岛网格 + 键盘二维游走 + hover/主钮抬影 | `entries/EntriesModule.vue`、`files/FileShortcutsModule.vue`、`global.css`、`composables/useGridKeys.ts`、`design-audit.mjs` | `entries.spec.ts`、`files.spec.ts`、`grid-shots.mjs` |
| P4 ✅ | Toast 右下反色胶囊 0.8s | `components/shared/ToastNotification.vue`、`stores/toast.ts` | `entries.spec.ts` 新用例、`toast-shots.mjs` |
| P5 ✅ | 局域网横幅 + 拖拽直投（改走 Tauri 命令，见 §8） | `fileshare/FileShareModule.vue`、`services/api/fileshare.ts`、`src-tauri/src/commands/fileshare.rs`、`main.rs`、`e2e/mocks/tauri-webview.ts`、`vite.config.ts` | `fileshare.spec.ts` 新增 5 条拖投用例、`v52-lan-shots.mjs` + 手测真机 |
| P6 ✅ | 小记自伸缩 composer + 插入芯片 + meta 行标签胶囊 | `notes/NoteEditor.vue`、`notes/NoteComposer.vue`、`notes/NoteCard.vue`、`notes/NoteToolbar.vue`、`stores/notes.ts` | `notes.spec.ts` 新增 5 条、`v52-notes-shots.mjs`、`fs-density.mjs` 不回退 |

P1→P2→P3 顺序硬依赖（P3 的网格要按 54px 页条算可视高度）；P4/P5/P6 可在 P1 后并行。
每期出图交付（截图内嵌发送）。

**P1 补记**：`e2e/specs/theme.spec.ts` 的 `BASES.ink.bg` 是 `rgb()` 计算值（不是 #hex），按 hex 扫仓扫不到，
首轮漏改导致 4 条主题用例红；已同步为 `rgb(29, 28, 26)`。全量 e2e 103 passed。

**P2 落地记录**（2026-09-30，两处与 spec 不同）：
- **Ctrl+B 的循环顺序改成 rail → expanded → hidden**。spec 从 expanded 起步（expanded→rail→hidden），
  但 desko 缺省档就是图标轨，第一下若收进 0 宽会被当成快捷键失灵；先展开才符合旧两态手感。
- **恢复钮不在页条里，在标题栏**：spec 的 `.restore-sidebar-btn` 挂在页面抬头（它的顶栏就是页面抬头），
  desko 的模块名与恢复入口归 `TitleBar.vue`（`.sidebar-restore`，复用右端 `.tb-util` 32×28 档 + `panel` 图标）。
  挂进 `.page-bar` 要改五份模块 markup，且页条是内容区控件位。
- 侧栏第三态用 `v-if` 直接卸载（0 宽 + 无描边），不做宽度过渡到 0；`--sidebar-rail-w: 56px` 新增为尺度槽，
  图标轨的居中补偿公式与栏宽无关，未动。
- 验收：`navigation.spec.ts` 4 条（含新三态用例）+ 全量 e2e 绿；`sticky-band-check --theme=ink` 五页 ok，
  小记 `.day-head` 的 `top` 自动跟到 54px；`nav-shots.mjs` 补 `0-window-rail`（整窗看页条呼吸）与
  `5-sidebar-hidden`/`6-titlebar-restore`。`sticky-band-check.mjs` 本身不需要改（它扫 sticky，不写死高度）。

**P2 补记（同日实机对拍原型后的侧栏回炉）**：真 app 与原型并排看过，差距不在字形在**这一列的组织方式**，四条逐项拍板落地在 `layout/Sidebar.vue`：

- **侧栏恢复独立面**：`background: transparent → var(--sidebar-bg)`（纸 #edecea / 墨 #1a1917，槽位自拆面轮起一直定义着没人消费）。
  这是对「拆面轮：侧栏并入整窗画布」的显式推翻——只留发丝右界时五枚导航像浮在页面上，不像站成一列。
- **激活行整条转 accent**：文字从 `--text` 改 `--accent`（图标本就 accent），抬影 `--shadow-xs → --shadow-card`；
  计数徽章同步换成圆形等宽数字（`--radius-pill` + `--font-mono`），非激活走 `--fill`/`--text-muted` 中性档。
- **导航图标分两档**：展开档 22→**18px**（文字打头，图标退成锚点），图标轨档保持 **22px**（那里图标是唯一线索，缩到原型的 15px 会空）。
  `AppIcon :size` 与 `.nav-icon` 的 CSS 必须同档，因为实笔 1.05px 是按 size 反算的。
- **品牌头保留徽标**，只把折叠钮从 26px 收到 24px 档（图标 18→16）对齐原型节奏；原型那颗 8px accent 圆点未采纳。
- 未动：行高 36px（原型 38，但 36 是行轨尺寸轴）、底部「同步就绪」footer（§10 已按本地工具无同步否掉）。
- 验收：`vue-tsc` 干净、单测 189、全量 e2e 114 passed（`entries` 分类 tab 那条并行下偶发飘红，单跑 1.1s 绿）；
  `color-sweep` 八组无新增不达标（accent 文字在 `--panel-bg` 上过线）、`check-theme-coverage` 2×96 + 8×17、`sticky-band-check` 五页 ok。
  对拍图：`design/nav-icon-mock/proto-*.png`（原型）vs `design/rail-zoom/*.png`（实现）。

**P3 落地记录**（2026-09-30，四处与 spec/计划不同）：
- **`minmax` 取 280px 而非 spec 的 310px**：默认窗内容宽 928px 下 310 只落 2 列，与 spec 自己写的「3 列自适应」矛盾；
  280 在 1040 窗落 3 列、800 宽落 2 列。列宽槽收在 `global.css` 的 `.card-grid`，两页共用一层壳，卡内布局各页 scoped。
- **栏内主钮恢复 accent 胶囊 + 彩色投影，是对 P2「栏内主钮收白描边」的显式推翻**：内容区改成浮岛网格后区内不再有实心色块，
  白描边主钮在纸底上失去唯一的重音。高度仍锁 30px 栏内档（spec 的 `padding:7px 15px` 会涨到 ~32px，与弹窗 28px 尺寸轴冲突），
  只改圆角与投影，不改 padding/height；`.dialog` 内的主钮不受影响。
- **hover 底色规则必须加 `:not(.selected)`**：`[data-theme=x] .grid-card:hover`（0,3,0）压过 `.grid-card.selected`（0,2,0），
  选中卡一旦被 hover 就丢掉 accent 浸润（e2e 实测 `rgb(241,241,240)` 而非 `rgb(232,238,244)`）。
- **键盘游走独立成 `composables/useGridKeys.ts`**：列数按 `gridTemplateColumns` 实测（不写死，窄窗不会跳错行），
  输入框/编辑区内不劫持方向键，`c` 复制当前卡；Enter/Space 的开启动作留在卡片自身，不进 composable。
- 计划里「要同步改 `design-audit.mjs` 的 hover 不得抬影规则」指向的规则在仓库里并不存在（9-28 基线没落进脚本）。
  改成真的边界检查（§6）：`.grid-card` 静止→hover 必须位移 2px 且阴影换档、页条主钮 radius/height/投影三项、
  反向对照小记流 `.memo` hover 必须 `transform: none`；§7 reduced-motion 补网格卡探针。
  拍基线前要先 `blur()` + 鼠标归零——上一节把焦点留在卡片上，`:focus-visible` 自带抬影，会把「静止态」拍成抬起态。
- DOM 类名沿用旧的（`.entry-card`/`.shortcut-row`/`.ec-name`/`.cell-path`/`.ft-ico`/`.row-acts`），只加 `.grid-card`/`.card-grid`，
  既有 e2e 与拍图脚本按类名的部分不用改；钮面 title 带键盘提示（`复制网址 (C)`/`复制地址 (C)`），`files.spec.ts` 的 `tipButton` 按全等匹配已同步。
- 新增交付拍图器 `scripts/grid-shots.mjs`（1040×670 × 两主题 × 8 态：静止/hover/键盘焦点/C 复制 toast/批量选中/窄窗 800/文件页/文件页 hover）。
- 验收：`vue-tsc` 干净、单测 188 passed、全量 e2e 103 passed；`check-theme-coverage` 2 底色×96 槽 + 8×17 在白名单内；
  `sticky-band-check` 五页 ok（页条 top 仍 0，行轨高度变化不影响）；`color-sweep` 八组对比度不达标项 **全部归零**
  （P1 基线里 paper 四组还挂着 `meta-dot@15 2.96`/`span@10 4.49`/`hints-dot@10 4.49`，随旧行皮一起删掉了）；
  `design-audit` paper/ink 双跑：网格卡 `moved: true`、`.memo` `transform: none`、reduced-motion 网格卡 `none`。
  游离色里 `span.ft-ico` 与 `span.mfa-tile` 是 P1 前既有项，本轮未新增。

**P4 落地记录**（2026-09-30）：
- 位置 `right/bottom: var(--space-5)`（=20px，与批量底栏同档）。底栏居中、`z-index` 120，胶囊 2000，1040 宽下两者左右分开不相撞（`toast-shots` 的 3 号图专门验这条）。
- 形态按 §7 配方：`--radius-pill` + `6px 14px` + `--text-xs`(12px)/500。投影用字面 `0 6px 20px rgba(0,0,0,.2)` 而非 `--shadow-md/--shadow-pop`——两档对一块小胶囊都过重（pop 是 16px 36px 的弹层档）。
- 反色面不新增槽：沿用既有 `--toast-bg` + `--toast-ok/err/info`（纸底=暗胶囊亮字、墨底翻成亮胶囊暗字），这正是 §7 说的「改用 `--toast-*` 而非字面 text/bg」。
- 时长进 store：`DWELL_MS = { success: 800, info: 800, error: 2400 }`（原 2500 一刀切）。单测 `src/stores/toast.test.ts` 钉死三档与「后一条重置前一条计时器」；错误类留 2.4s 是因为 0.8s 读不完一句失败原因。
- 进出场 0.25s scale → **0.18s opacity + translateY(8px)**，去掉了居中版的 `translateX(-50%)`（右下锚点后不再需要）。reduced-motion 由全局 `transition-duration` 归零覆盖。
- 验收：`entries.spec.ts` 新增「toast 是贴右下的反色胶囊」（贴边 20px + radius 99px + 12px + 反色底三项）；全量 e2e **连跑两轮 104 passed**——57 处 `expectToast` 在 0.8s 驻留下没飘（`e2e/helpers.ts` 注释同步为 800/2400）。

**P5 落地记录**（2026-09-30，两处推翻计划本体）：
- **落盘通道从 HTTP 改成 Tauri 命令**（§8 已改写）：新增 `fileshare_import_files(shareIndex, paths)`，
  路径来自 `getCurrentWebview().onDragDropEvent`（HTML5 `dataTransfer` 在 WebView 里拿不到真实路径），
  落盘复用 `fileshare-core` 的公开件 `sanitize_upload_name` + `claim_available_name`，与网页端上传同名同规则。
  网页端那道 Origin/`Sec-Fetch-Site` 门（`handlers.rs:73-84`，403 Cross-site request rejected）**没有放宽**，
  桌面侧根本不发 HTTP，单通道成立。命令跑 `spawn_blocking`，4 GiB 大文件不冻主线程。
- **横幅吃掉「访问地址」卡的表头**：原页三处说同一件事（页条胶囊「监听中」+ 摘要行 + 地址卡局域网行），
  现收敛为——页条胶囊说生命周期（监听中/已停止），横幅说可达性（同网段设备可访问 / 仅本机可访问 / 服务未启动）
  并持有主地址（`--text-lg` 等宽、整行可点复制、`?` 防火墙提示贴着它），局域网态下本机地址单独成行。
  连带删掉 `.cfg-summary` 摘要行（端口在地址里、口令态在唯一警告位里）与停止态的 `.group-row.dim` 行。
- 大小上限按**单文件** 4 GiB（网页端限的是单次请求合计，本地一次拖入是 N 份独立拷贝，合计封顶会把大批投递拦在半路）；
  文件夹 / 读不到 / 超限 / 已在目标目录 四种情况逐条回中文原因，成功的那几个照常入库，不静默丢。
  同名走 `claim_available_name` 的 `create_new` 占位，`photo.jpg → photo (1).jpg`，**永不覆盖**。
- 提取链接行按 `pages.rs:42 download_href` 同格式拼 `/download?share=N&name=<encodeURIComponent>`，
  显示与复制都是编码后的原文（贴进 curl 不会因空格断参），中文文件名在图里显得长且丑，是有意取舍。
- 投递目标目录：多共享目录时才出 `.dz-chip` 选择条，单目录不做控件；`target` 对目录数变化取 `min` 兜底不越界。
- e2e 侧新增 `e2e/mocks/tauri-webview.ts` + `vite.config.ts` 别名（改别名要重启 1430 的 vite，否则复用旧服务不生效），
  拖放经 `__E2E__.emitEvent('tauri://drag-drop', { type:'drop', paths })` 伪造；mock 命令与 Rust 同语义，
  新增 `fileshare.imported` 存量名演同名避让。
- 验收：`cargo check` 干净、`vue-tsc` 干净、单测 189 passed、全量 e2e **109 passed**（fileshare 12→17）；
  `check-theme-coverage` 2×96 + 8×17 通过、`sticky-band-check` 五页 ok（未新增令牌）。
  `color-sweep` 八组里 paper 四组冒出 `span.hints-dot@10 → 4.49`（`EntryFormDialog.vue:54` 的分隔点，
  P3 记录里它随旧行皮消失过，现由收藏弹窗轮带回来），与本页无关，留给弹窗那条线处理。
- 交付拍图新增 `scripts/toast-shots.mjs`（计划 §11 原写 `dialog-shots.mjs`，但它不拍 toast）。**成功胶囊必须按元素拍**：整窗 clip 的往返要 ~900ms，会拍到淡出中的半透明；元素截图实测 +568ms 落点，仍在驻留窗口内。

**P6 落地记录**（2026-09-30，两处与 §9 字面不同）：

- **自伸缩落在 `NoteEditor` 自己身上**：`syncComposerHeight()` 量 `scrollHeight` 回写 `min-height`，
  先清空再量（`min-height` 是地板，留着上一次的地板值就只涨不落），挂在 `onUpdate` + `transaction(docChanged)` +
  窗口 `resize`（换宽重排后高度要重算）。`min-height` 的过渡一并删掉——逐键伸缩要跟手，缓动慢半拍。
- **推翻 §9 的「失焦收回一行」**：有内容时不收。收回等于把用户写了一半的三行藏成一行，
  而空内容本来就是一行高，"收回"在自伸缩下已经没有对象。原 e2e 断言 148px 定高的用例改成按行高比对的伸缩用例。
- **芯片必须 `@mousedown.prevent`**：按钮抢走焦点会连带丢掉 ProseMirror 的"待输入标记"和落点，
  代码芯片点了之后打字变成普通文字（实测 DOM 只剩一个空 `<code>`）。芯片统一不抢焦点，动作走编辑器自己的命令链
  （`toggleTaskList` / `toggleCode` / `insertContent`），不往正文塞 markdown 源字符。
- **标签芯片给的是真标签名**（对齐原型 `.suggested-tag`）：取 `tagCounts` 前 3 颗库里已用过的标签，点了整颗插 `#名字 `；
  草稿里已写过的那颗当场让位，库里一个标签都没有才退回通用 `# 标签` 起点。原型那 5 颗常显芯片未照搬——
  芯片在折叠的工具条里，静置时不占版面，多摆就是噪声。
- **胶囊输入栏里原有的「标签」钮删掉**：它和标签芯片是同一个动作摆两次；卡片就地编辑（dense）与全屏书写面照旧保留。
- **meta 行标签胶囊取 `noteMeta()` 那份缓存派生**（`stores/notes.ts` 的 `noteMeta` 改为导出），
  与筛选、分类同一个来源，不会出现胶囊显示三个、点进去筛出另一批；上限 5 颗，第五个之后正文里的内联 `#标签` 仍可点；
  命中的那颗转主色（新增 `activeTags` prop 由 `NotesModule` 传入），悬停不随动作排淡掉——它是筛选入口不是状态标。
- 冲突处置照 §9 执行：`translateX(2px)` hover 未采纳、`--memo-max-h` 折叠保留、B 档密度与列宽未动、置顶仍用描边。
- 验收：`vue-tsc` 干净、单测 189 passed、全量 e2e **115 passed**（notes 20→26）；`fs-density.mjs` 四组数值与 P6 前一致
  （129% / 118%）、`check-theme-coverage` 2×96 + 8×17 通过、`sticky-band-check` 五页 ok、`design-audit` 无新增回归；
  `color-sweep` 八组里仍只有 P5 记录的 `span.hints-dot@10 → 4.49`（`EntryFormDialog.vue:54`），芯片与胶囊未进不达标名单。
- 交付拍图：`scripts/v52-notes-shots.mjs` → `design/v52-notes/`，两主题 × 静置一行 / 三行自伸缩 / 待办芯片 / 代码芯片 / 胶囊点开筛选。
- 事后对照原型复核（同日）：机制一致，唯一实质缺口是标签芯片只给一个 `#` 起点、没给建议词，已按上条补齐；
  两处有意偏离保留——空内容占位高度按 desko 的一行（原型 60px 地板是它自己的 `min-height`，不等于这里的按钮档），
  芯片放在折叠工具条内而非常显（理由同「多摆就是噪声」）。其余差异为令牌映射（胶囊圆角、`--shadow-pop`、toast 右距 24、网格 280），不改。

**P6 对拍轮落地记录**（2026-09-30，同种子同尺 1040×670 与原型逐像素对拍后取舍得出的五项）：

- 对拍基线：`design/v52-notes/cmp-proto-*.png` 与 `cmp-app-*.png` 两主题各一对，同一份种子内容
  （置顶卡带行内代码 + `#会议`、今日卡带两项待办其中一项已完成）。种子必须用 Tiptap 3 的规范任务列表结构
  （`e2e/specs/notes.spec.ts:20` 那段），扁平 `<li data-checked>` 解析不出来，会误判成"勾选了却没划线"。
- **流卡正文降一档**：`14/24 → var(--text-sm)/20`（`NoteCard.vue` `.memo-body`）。流卡是浏览面、全屏是书写面，
  两者不该同字号；降完一屏多看两条，书写面与 B 档密度不受影响。
- **卡间距 8→12（`--space-3`）、左内距 32→24（`--space-6`）**：左内距是给勾选框留的位，而那颗钮九成时间隐形，
  不该让正文为它缩进一大截；12px 是把分组内两条卡的呼吸拉开到与分组头同档。
- **正文内联 `#标签` 去底**：`.tag-inline`（`global.css`）只留 `--accent-active` 字色 + `--radius-xs` 内衬，
  hover 才出 `--accent-soft`。卡顶那颗胶囊才是标签的筛选入口，正文里再刷一颗实心药丸是同一件事说两遍还压过正文。
- **任务勾选框自绘，配方收进 `global.css`**：14px、`--border-strong` 描边、`--radius-xs` 圆角、勾选后转 `--accent`
  底 + `--accent-on` 对勾；完成项 `line-through` 并降 `--text-muted`（不是 faint——还剩哪几条是信息）。
  原生 `accent-color` 那副直角系统外观与整套令牌不在同一只手。三处书写面（流卡只读 / 就地编辑 / 全屏）共用一份，
  各层只留一行按本层行高微调的 `margin-top`（5/4/5px），因此**删掉了 scoped 里的 `accent-color` 与 `margin-top`**：
  `:deep()` 编译成带 `[data-v-hash]` 的选择器，权重盖过全局规则，留着就是全局配方失效。
- **行内代码降到 12px、去描边、转 accent 字色**：`font-size: var(--text-xs)`、无 `border`、`color: var(--accent-active)`，
  保留 `--code-bg` 底。三处书写面同步；代码块 `pre` 仍带 `--code-bd` 描边不动，它是独立区块不是行内点缀。
- **否决项与保留项（现场推翻本轮提案，记录以免下轮重提）**：
  页条下的 pill 筛选行**被否**——小记体量小，搜索够用，多一行控件是负担；
  由此连带误删的**列表分组头与「置顶」头原样保留**，`NotesModule.vue` 与其单测完全回退，
  本轮在该文件净剩一行（`.day-list` 的 gap）。"去掉"只指本轮新加的东西，不含既有列表结构。
  动作排仍 hover 才显（不常显）、composer 一行地板与自伸缩不变。
- 验收：`vue-tsc` 干净、单测 189 passed、全量 e2e **115 passed**（无新增用例，本轮纯视觉）；
  `color-sweep` 八组仍只有 P5 记录的 `span.hints-dot@10 → 4.49`，新的 13px 正文与 accent 行内标签/代码均未进不达标名单；
  `check-theme-coverage` 2×96 + 8×17 通过、`sticky-band-check` 五页 ok、`design-audit` 无新增回归、
  `fs-density.mjs` 保持 129% / 118%（B 档未动）。未新增任何令牌。

**真机微调轮**（2026-09-30，跑起来后现场提的五项，覆盖 P6 记录里"composer 一行地板"那条）：

- **侧栏折叠钮图标调大**：`Sidebar.vue:57` 由固定 16 改 `collapsed ? 20 : 18`，与同列导航图标（22 / 18）同档。
  rail 档补一条：`.sidebar.collapsed .sidebar-nav { padding-left: calc(var(--space-2) + 9px) }`——
  新滚动条配方给竖向滚动容器留了 9px 槽，会把图标整体左推离中线，用等量左内衬补回。
- **书写面展开即三行地板**：删掉 `NoteEditor.vue` 里那套 JS 量高回写（`syncComposerHeight` +
  `COMPOSER_FLOOR_FOCUSED` + transaction/resize 监听），改成 CSS `min-height: 94px`，由 `roomy` prop 挂在
  composer 的粘性 `open` 态上。地板跟"展开"走而不跟"聚焦"走：点「发布」先触发 blur，
  若地板当场收回，书写面在 mousedown 与 mouseup 之间缩掉约 50px，按钮从指针底下被抽走，发布点不动
  （这曾让四条 e2e 同时红：钮是 enabled、也 click 命中，`create_note` 计数仍为 0）。
  高度仍由内容自己顶，`min-height` 只是地板，`max-height: 46vh` 是滚动上限。
- **composer 标签建议芯片撤掉**：`NoteComposer.vue` 的 `tagCounts` prop、`insertTag`/`insertTagNamed`/`tagChips`
  全删，芯片排只剩待办 + 代码。上一轮补的"给库里真用过的标签名"随本轮一并撤，不算回退——
  右栏标签区已是同一入口。
- **小记页条只留选择与侧栏开关**：`NotesModule.vue` 删排序（clock）与筛选（funnel）两颗 `bar-btn`、
  两个 `PopoverMenu`、`SORTS`/`pickFilter`/`pickSort`/`chooseView`/`chooseSort`/`resetFilters`/`filterAnchor`
  及死样式 `.pop-sec.tight`、`.tab.danger`。store 的 `noteSort` 保留（`filteredNotes` 仍读，`src/stores/notes.test.ts:226`
  仍覆盖），排序从此由视图档决定、不再暴露给用户调。
- **全站滚动条改细浮动胶囊**：`global.css` 一段——槽 9px、轨道透明、thumb 用
  `border: 3px solid transparent` + `background-clip: padding-box` 浮在槽中成 3px 胶囊，
  hover 只换色不变粗，圆角 `--radius-pill`，颜色仍走 `--scrollbar` / `--scrollbar-hover`
  两轴令牌。配套把 `scrollbar-gutter: stable` 铺到 `.content-inner, .stream, .rail, .sidebar-nav, .dialog-body,
  .settings-pane, .remote-list, .fs-scroll`，槽位常驻，滚动条出现/消失不让内容横跳。
  刻意不设 `scrollbar-color`——设了 Chromium 会忽略整套 `::-webkit-scrollbar`。局部例外保留：
  `EntriesModule.vue:446/449`（隐藏）、`EntryFields.vue:429-435`（hover 才显）、`NoteEditor.vue:630`（slash 菜单 4px）。
- 出图坑：Playwright 默认带 `--hide-scrollbars`，会把整套自定义滚动条抹成零宽零绘——
  滚动条相关拍图必须 `ignoreDefaultArgs: ['--hide-scrollbars']`，否则会误判成"配方没生效"。
  `scripts/tweak-shots.mjs` 已内置该参数，产出 `design/v52-tweak/{paper,ink}-{1-bar,2-composer,3-scroll-notes,
  3b-scroll-hover,4-rail,5-expanded,6-dialog,7-page}.png`。
- 验收：`vue-tsc` 干净、单测 189 passed、notes e2e 24 passed、全量 e2e **113 passed**（删两条标签芯片用例、
  composer 伸缩用例改写为"展开给三行地板、越过地板才逐键长"）、`check-theme-coverage` 2×96 + 8×17 通过、
  `sticky-band-check` 五页 ok、`color-sweep` 八组仍只有 `span.hints-dot@10 → 4.49`。未新增令牌。

**收藏轮**（2026-09-30，四项：滚动条 hover、卡面减负、hover 勾选框、收藏弹窗换语言）：

- **hover 变粗是简写回退**：`::-webkit-scrollbar-thumb:hover` 原写 `background: …`，该简写把
  `background-clip` 重置回 `border-box`，3px 透明内衬被填上，thumb 从 3px 涨成整条 9px——看着像 hover
  自己加粗。基础态与 hover 态都改 `background-color:` 后，4x 取样实测静置 3px、hover 3px 只是变亮。
  教训：只要规则里靠 `background-clip`/`border` 造形状，hover/active 态就禁写 `background` 简写。
- **卡面减负**：`EntriesModule.vue` 删 `.ec-paths` 行（首条路径 + 「+N」）与整条 `path-pop` 弹层、脚注 `.ec-note`，
  连带 `pathsAnchor`/`pathsEntry`/`openPathsMenu`/`closePathsMenu`/`openPath` 与 `joinEntryUrl` 引用一并清；
  `.ec-domain` 先改 `-webkit-line-clamp: 2` 最多两行，同日再收为**恒定一行 + 尾部省略号**
  （`display:block` + `white-space:nowrap` + `text-overflow:ellipsis`，整条地址留在 `title` 与详情弹窗）。
  数据面不动：`notes`/`paths` 仍存仍读，只在详情弹窗显形。收一行后卡高实测 125→117.7px
  （`15 + 40.7 名/URL + 11 + 34 脚注 + 15 + 2 描边`），脚注由 `margin-top:auto` 钉底，卡底不留空带。
- **勾选框只在批量态显形**：`global.css` 的显形规则收成 `.grid-card:not(.entry-card):hover .card-check`
  + `:focus-visible` + `.batching` 三条——收藏卡整张就是详情入口，指针扫过抛一颗可点的框极易误触；
  批量入口唯一落在页条「选择」钮（`useBatch.ts:13` 注释同步）。配套修掉一个真口子：批量态下卡上的
  `a.ec-domain` 仍带 `@click.prevent.stop`，点它会把浏览器带起来而勾不上，现按 `isBatchMode` 分流到
  `toggleSelect`（`entries.spec.ts` 补一条"已选 3 项 + `shell:open` 计数 0"）。
  e2e 与 `dialog-shots.mjs`、`entry-shots.mjs` 三处勾选取入口随之改写。
- **收藏弹窗换语言（尺寸轴不动）**：`design/v52-entry-dialog/mock-src.html` 先出真 token 高保真 mock 拍板，
  再落代码。外壳仍是 42px 头 / 520·480 壳 / 32px 字段 / 46px `--fill` 底栏 + 28px 钮，换的是内部三处：
  详情四块 `--sunken` 卡中卡 → `.detail-row` 一层平铺（键 40px 左、值右、行 38px）；子路径的 `--sunken`
  内嵌盒 → `.path-list` 平铺发丝行（视窗 80px 恒定不变，弹窗总高零变化）；密码字段加自绘显隐钮
  （`.pwd-wrap input::-ms-reveal { display:none }` 关掉 WebView2 那颗改不动样式的原生钮）。
  「凭证」分组名随之消失，用户名/密码各自成行。
- **发丝线必须用 `--border` 不是 `--border-subtle`**：墨底面板 `#22211e` 上 `--border-subtle #252421`
  只差 ΔL1.5，等于没画；`--border #30302d` 差 ΔL7.0，纸底同档 ΔL7.8。mock 与代码同步改过一次。
- 新增可复用件：`scripts/mock-build.mjs`（把 `global.css` 的 token 块与 `utils/icons.ts` 的真图标注进
  `mock-src.html` 的 `<!--TOKENS-->` / `{{i:名:尺寸}}` 占位，产出可直接截图的 `mock.html`）、
  `scripts/entry-dialog-shots.mjs`（四屏出图）。`scripts/entry-shots.mjs` 扩到 8 屏（新增/编辑/详情/密码显隐）。
- 验收：`vue-tsc` 干净、单测 189 passed、entries e2e 12 passed + 1 例首跑飘红复跑即过（既有 `.popover .pop-item`
  时序）、全量 e2e 111 passed / 1 flaky / 2 failed——两条失败是小记插入芯片（`aria-label="插入待办项"` 在
  `src/components/notes/` 已扫不到，属并行会话在改的 composer，与本仓收藏轮无关）、`check-theme-coverage`
  2×96 + 8×17 通过、`sticky-band-check` ok、`design-audit` exit 0 无 finding、`color-sweep` 八组仍只有
  `span.hints-dot@10 → 4.49`。未新增令牌。

**子路径独立弹窗轮**（2026-09-30，用户看落地后的新增弹窗："布局不太行"→"能多增加一个弹窗吗"）：

- 诊断（可核的硬账）：子路径块 = 标题 20 + 视窗 80 + 添加行 6/32，加组距共 156px，占 565px 弹窗的 28%，
  而新建态这里信息量为 0；列表只有 `border-top`（行才带 `border-bottom`），空态时区块不闭合，
  添加行离列表 6px、离下一个 label 12px，两头不靠。
- 三项裁定（逐项弹窗拍板，不是一次甩清单）：① 添加行并入列表末行，**80px 视窗恒定这条不变量作废**
  （弹窗总高不再需要钉死）；② 整块搬进独立弹窗，表单里只留一行入口；③ 弹窗内增删**只写回父表单的草稿数组**，
  落库统一等「保存条目」——新增态条目连 id 都没有，"即时落库"根本做不到，写回草稿是唯一两条路同口径的解。
- 落地：新建 `src/components/entries/PathsDialog.vue`（520px 壳 / 42px 头带「N 个 · 条目名」/ 38px 平铺发丝行 /
  行右三颗 24px `.ib`：打开·复制·删除 / 添加行并入末行 / 46px `--fill` 底栏 + 28px「完成」，
  正文 `max-height: 46vh` + `scrollbar-gutter: stable`）；表单侧 `.paths-manage` 一行入口吃 32px 字段档
  （mono 摘要 + "管理 ›"，空态一句"未添加 · 点击管理"）；`LocalPath` 从 `EntryFields.vue` 上抬进
  `src/types/index.ts` 两处共用；`openUrl` 走 `PathsDialog → EntryFields → EntryFormDialog → EntriesView` 三级透传，
  复用 `EntriesView.vue:89` 那颗 `plugin-shell` 的 `open`，不新开第二条通道。
- 叠弹窗与副本：Esc 靠 `useEscapeClose` 的栈只关最上层（子路径弹窗 `v-if` 挂载即后注册，一次按键不会连表单一起关）；
  `.footer-hints` / `.kbd` / `.hints-dot` 从 `EntryFormDialog` 的 scoped 里上抬为全局——第二个弹窗要用就是副本。
  行内「添加」钮单独钉 28px，否则吃全局 `.btn-primary` 的 36px 撑破 44px 行。
- 并行会话同轮把 520px 表单壳从 `padding-top: 7vh` 顶挂改成居中基线，新弹窗跟居中，别再写回 `flex-start`。
- 尺寸账（`getBoundingClientRect` 实测，非估算）：新增弹窗 565 → **479.5px**；子路径弹窗空态 157px、三条时 271px。
- 验收：`vue-tsc` 干净、单测 189 passed、entries e2e 12 passed + 1 例既有 `.popover .pop-item` 时序飘红复跑即过
  （新增用例扩了草稿回写断言：点「完成」时 `snap.urlPaths` 仍为 0，「保存条目」后落 1 条
  `{ entry_id, path: '/web', label: '首页' }`）、`check-theme-coverage` 2×96 + 8×17、`sticky-band-check` ok、
  `design-audit` exit 0、`color-sweep` 八组对比度全清（历史那条 `hints-dot@10` 已不再报）。未新增令牌。
  出图：`design/v52-entry-tweak/{paper,ink}-{5-form-new,5b-paths-empty,5c-paths-draft,5d-form-with-draft,9-paths-manage}.png`。

## 12. 风险
- C4 把画布→卡片分层差压到 ΔL*4.9，深色下「面板浮起」主要靠描边；实机看糊的回退方案是卡面抬到
  `#26241f`（Δ6.6）、画布守 `#181716`，不整轴回老阶梯
- C1/C1b 一次改两张列表页 + §5 推翻 9-28 抬影裁定，`design-audit.mjs` 与 `row-card` 基线文档要同步改口径，
  否则下轮走查会把合规改动报成回归
- P5 拖拽直投是**新增写入路径**（外部文件落进共享目录），要确认大小上限与同名冲突提示，避免静默覆盖
- 并行会话同改 `desko` 工作树：改 `global.css` 前先 `git status`，行号会漂
