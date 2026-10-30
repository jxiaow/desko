# 双工作面：两套完整 UI 实施方案

- 日期：2026-10-25
- 状态：v2，范围已拍板（桌面解锁态外壳 + 8 模块主面；锁屏/设置/HUD 共用）；P1 已落地，见第 13 节
- 目标：同一份数据、同一个应用里，提供两套完整可日常使用的界面；用真实使用决定去留

## 1. 两套的定义

| | A 现行 | B 工作面 |
| --- | --- | --- |
| 外壳 | 48px 顶栏 + 左侧模块轨 | 40px 封面 + 32px 章节栏 |
| 模块入口 | 侧栏 8 项 + 设置 | 章节栏 8 项 + 封面设置 |
| 模块主面 | 现有卡片/列表/面板 | 每模块一张专用工作面（密表、对照板、状态台、内容面） |
| 数据 | 同一套 store / service / SQLite | 同左，零迁移 |
| 切换 | 设置 → 外观 → 工作区外壳 | 同左，切后重载 |

“完整”指：A 里现在能做的每一个用户动作，B 都能到；复杂动作可以继续用现有弹窗，不要求重画。B 不新增功能，也不修现网缺口——现网缺的（文件无拖拽/多选、验证码无持久错误态等）两边保持同缺，否则 A/B 结论不公平。

## 2. 范围

**包含**
- 桌面解锁态：外壳 B + 8 个模块主面 + 切换设置。
- 与 B 相关的键盘路径（Ctrl+K、Esc、方向键、Enter/Space、c 键等）保持对等。
- 双模式测试与视觉验收。

**共享，不各做一套**
- 锁屏/初始设置、设置弹窗、HUD、Toast/Confirm/Quit。
- 所有业务 store/service、复杂对话框（编辑、导入、认证、切号、探测、应用、导出等）。
- 主题令牌、字体、氛围光；不新增色板。

**不做**
- 跨模块全局搜索（A 没有，B 也不加）。
- 锁屏/设置/HUD 的重绘。
- Web 运行时改用 B；B 只服务桌面解锁态，Web 固定 A。
- 借这次改版顺手补功能。

## 3. 结论先行

1. **共享舞台，只换外壳。** 保留 `CodexWorkspace` 作为两套共用的舞台（`#workspace-surface`、`.main-content`、目录、全屏），模块页与目录子树始终挂在同一棵舞台里，外壳只作为它的兄弟节点换入换出。
2. **切壳靠重载，不做热切换。** 两套外壳的 Teleport 目标、轮询、拖放监听都不同；热切换会让目标失联或双挂。写入偏好后 `location.reload()`，一次干净的重挂比一套复杂的迁移逻辑可靠。代价：重载后回到锁定态，需要重新解锁——这是已接受的代价，不是缺陷。KeepAlive 与滚动恢复只在单次会话内生效，不跨切壳承诺。
3. **先对等清单，再画表面。** 每个模块先按第 8 节的清单逐项勾，缺一项不算完成。
4. **从干净工作树起分支。** 现在工作树里有并行会话的未提交改动，恰好包含 `EntriesModule.vue`、`CodexModule.vue`。先让它们提交，再从新 HEAD 起分支；否则 B 会缺你正在用的功能，试用结论失真。
   - 实况（P1 开工时）：收藏/Codex 那批已随 `324f312`、`490c639` 落库；工作树仍带并行会话的 Web 访问 WIP（`src/main.ts`、`services/runtime.ts`、`styles/web.css`、`src-tauri/src/web_access/*`）。P1 没等它，因为外壳 B 不读这批文件；B 的壳与这些改动无交集，P2 起若交集出现需先回看这条。

## 4. 架构

### 4.1 组件结构

```text
App（共享：锁/初始化、设置、Toast/Confirm/Quit、HUD 桥、hover guard、模式分支）
├─ Chrome A（v-if mode=A）：TitleBar + Sidebar
├─ Chrome B（v-if mode=B）：WorkbenchCover + ChapterStrip
└─ CodexWorkspace（复用为舞台，始终挂载，prop shell 决定是否渲染页头）
   ├─ #workspace-surface
   ├─ surface-head → WorkbenchSurfaceHead（B 专用插槽；`<slot v-if="shell === 'workbench'">`，插槽存在也不能让 A 多出整条页头）
   │  ├─ 页名/条数（pageHead）
   │  ├─ #workspace-page-toolbar（模块页栏 Teleport 目标）
   │  └─ #workspace-fixed-tools（目录开关等页面级租户）
   ├─ .main-content → ModuleRouterView（KeepAlive + 滚动恢复）
   └─ #workspace-directory-content（notes / entries / codex）
```

- 模式分支直接写在 `App.vue` 的解锁态模板里，没有单独的 `WorkspaceHost` 组件：舞台本来就在 App 树内，再包一层只是给同一棵树一张新名字。
- 同一时刻只挂一套 chrome，四个挂载 ID 全应用唯一。
- `Chrome B` 不复制舞台逻辑，只负责导航与封面。
- `CodexWorkspace` 的 `shell` prop 经 `workspaceShellKey` provide 给舞台内所有消费者：它同时管两件事——页头插槽是否渲染、`hasPageDirectory(moduleId, shell)` 是否允许目录与 Ctrl+B。用 prop 而不是判 `$slots`：`<template v-if="workbench" #surface-head>` 在 A 下仍会注册插槽函数，`$slots` 判真会让 A 平白多出整条页头（现值 76px）。
- 保留 `.codex-layout` 作为共享舞台样式根（名字是历史包袱，但避免复制整份布局 CSS）；B 增加 `.workbench-shell` 修饰类做覆盖，并把 `--sidebar-rail-w` 归零，让内容列宽与 Toast 侧距跟着重算。
- 两套外壳的窗口拖拽/双击最大化/窗控/品牌菜单/同步与 Web 状态从 `TitleBar` 抽成共享件：`useWindowChrome`（原语）、`WindowControls`、`AppMenuButton`、`WebStatusButton`，不复制两份。`BackupBadge` 自带尺寸档，因此在两套里都能直接放。
- 模块导航数据（启用状态、live 点、选中态）沿用 `modules/state.ts` 的 `enabledModules` 与 `modulePath`，侧栏与章节栏共用，没有第二份来源。

### 4.2 舞台契约（不能被 B 弄丢）

| 契约 | A | B |
| --- | --- | --- |
| `#workspace-surface` | CodexWorkspace | 同左；`.fs` 仍须是它的直接子节点 |
| `#workspace-page-toolbar` | TitleBar | WorkbenchSurfaceHead |
| `#workspace-fixed-tools` | TitleBar 窗口键左侧 | surface-head 右端（唯一租户是目录开关，它是页面级控件，不搬进封面） |
| `#workspace-directory-content` | CodexWorkspace aside | 同一 aside，B 样式 |
| `#workspace-cover-search` | 无此挂载点 | WorkbenchCover 正中（B 专用）；当前这一面的搜索住在封面，页头那行只留页名与动作 |
| `workspaceLayoutKey = true` | CodexWorkspace provide | 同左 |
| `workspaceDirectoryKey` | CodexWorkspace provide | 同左 |
| `.main-content` 包裹 | 是 | 是 |
| Toast 顶距 | `--toast-top: 52px` | `--toast-top: calc(82px + var(--workbench-head-h))`（封面 40 + 章节 32 + 余量 10 + 页头 52 = 134），`--toast-side` 归零 |
| 页头方言 | 面包屑在 `headingInContent` 时降级为 `span`；`inline` 让位 12px、`replace` 归零间距 | 同一套：`surface-name` 跟着降级，`inline`/`replace` 在 surface-head 上改 `--workspace-heading-gap`（`replace` 另隐藏页名）。`inline` 已在互传上拍帧验过（穿透同一方言，未单独拍），`replace` 在 Codex 五视图页签上验过；`headingInContent` 目前全仓无生产者，只是照 A 保留的处理 |
| 全屏 `#workspace-surface > .fs` | 隐藏主面/目录/非独占页栏 | 主面与目录同样隐藏，但封面、章节栏、页头保留：小记把全屏头部 Teleport 进 `#workspace-page-toolbar`，页头一藏它就没人可点；`.fs` 改为从页头下沿（`top: var(--workbench-head-h)`）接管，页头抬到 `.fs` 之上 |

### 4.3 切换

- 设置 → 外观 → 工作区外壳：现行 / 工作面；默认现行。切换前先过确认框，正文写明"切换后窗口会重新载入，需要重新解锁"。
- 偏好落在 `localStorage['desko.layout_mode']`（`classic` / `workbench`），由 `services/layoutMode.ts` 同步读。没走外观偏好的异步链：值必须在首帧就定下来，等一次 `invoke` 会先闪一帧另一套壳。
- 切换确认后写入并重载窗口；数据零迁移，切回无损。
- 锁屏/初始设置不受模式影响；Web 运行时强制 A（`WorkbenchCover`/`ChapterStrip` 只挂在桌面解锁态分支，`isWebRuntime` 下 `layoutMode` 不参与渲染）。

### 4.4 B 的封面与章节栏

- **40px 封面**：整条拖拽、双击最大化；品牌菜单靠左、当前这一面的搜索居中、锁定/设置/同步/Web 状态与窗口三键靠右。搜索不是全局搜索，是「这一面」的搜索（模块把它从页栏搬到封面正中，页栏那行腾给页名与动作）；封面用三格 grid，中格 `minmax(0, min(360px, 34vw))`，窄窗先让给两侧真实内容。A 没有这个挂载点，A 的搜索照旧住页栏。
- **32px 章节栏**：8 个模块、选中态（`--sidebar-active` + `--text-brand`）、禁用态、互传 live 点；窄窗只收紧内距，不换行。
- **surface-head（52px，固定不滚）**：单行脊梁——26px 页名与条数同排比基线（「网址收藏 12 条」），模块页栏动作（新增/刷新/选择等）32px 在这条带子里上下各 10px 居中；Codex 五视图页签。表格表头在下方内容区自己粘顶。（曾按 mock 抬到 76px 两行字阶，见 §15；真窗口 670 高下被判拥挤，账已还掉，见 §16。）
- **目录**：保留共享右侧栏（notes / codex）；**收藏已拍板（2026-10-25）= 由工作面筛选行承担分类与计数**，B 下收藏页不显示目录、Ctrl+B 对收藏不生效（能力等价，不是删功能：同一批分类与计数换个承载位）。P1 开发态里收藏仍用 A 的目录，P2 落收藏密表时一并收掉。
- **宽窗**：1040 为设计基准；≥1440 时限宽或加列，P6 必须有 1560/1920 帧，不靠拉伸交差。

## 5. 模块对等清单（审计结论，实施前再逐项复核）

以下“必守”均来自对现行代码的只读审计；复杂弹窗默认复用，不重写。

### 5.1 收藏

- **B 表面**：密表 + 文字筛选行 + 行内详情 + 批量停靠栏。
- **必守**：Ctrl+K 搜索（名称+URL）；分类筛选与计数（含“更多”）；新增/编辑/建副本/删除/详情；复制网址、用户名、密码（30s 剪贴板清除）；打开网址；批量选择、全选筛选结果、取消本屏、隐藏选中数、批量删除；Esc 退批量；方向键网格、Enter/Space、c 键；密码遮罩；子路径 CRUD；favicon 字母兜底与锁标；骨架、加载失败重试、空集合隐藏搜索筛选、未匹配空态。
  - 两处清单勘误（P2a 复核）：~~只看锁定~~ 全仓无实现（`grep 只看锁定|lockedOnly|onlyLocked` 无命中），是审计时误记，不是待补功能；**锁标**在 A 是 `ec-cred` 一颗点，B 不再画点——同一判据（有用户名或有密码）改为「账号」「密码」两列本身有内容 + 无凭据时眼睛转 `faint`，符合"锁标只是装饰"的既有裁定。
- **列语义（B）**：6 列 = 站点（档面 + 名称 + 勾选位）/ 分类 / 账号 / 密码 / 添加于 / 操作（打开·详情·⋯）。子路径与备注不上表，收在「详情」展开行里（与 A 的 DetailDialog 同口径：那里也只是显示，改要走编辑→子路径弹窗）。
- **复用**：`EntryFormDialog`、`EntryFields`、`DetailDialog`、`EntryActionMenu`、`PathsDialog`、`useBatch`、`useGridKeys`、`useClipboard`、password store。
- **风险**：目录分类与筛选行重复（需二选一）；批量停靠栏；跨筛选选择与隐藏计数。

### 5.2 Codex

- **B 表面**：额度对照板（账号主视图）+ 会话/用量/回收站三个现有视图；页签住在 surface-head。
- **必守**：三视图切换；刷新额度；切号（含 WSL 预览与重启设置）；添加（浏览器 OAuth/设备码/API Key/导入）；编辑；复制邮箱；单条/批量导出 JSON；重登；强刷令牌；重置 5h 额度；WSL 使用；删除（回收站/异步批删）；会话搜索、打开位置/文件、移入回收站；用量四区间与分享海报；60s 门；批量停靠栏与隐藏选中；删除任务跨弹窗续跑；配额失败保留旧值；stale/error 态；3s 轮询与 pageActive。
- **复用**：Auth/Import/Switch/WslAssign/Edit/ResetCredit/BatchDelete/UsageShare/AccountConfirm 九个弹窗，Quota/Sessions/Usage/Trash 四个面板，`codexState`。
- **风险**：账号板不能把批量、筛选、排序、WSL 入口挤掉；轮询只能挂一次。

### 5.3 小记

- **B 表面**：保留现有内容形态——日期分组卡片流 + 编辑面 + 全屏阅读面；只换外壳与留白，不压成表格。
- **必守**：顶部编辑框（保存/放弃/全屏/加图）；卡片悬停动作与更多菜单（收藏/归档/导出 md/html/doc/pdf/加密/重锁/解除/删除）；就地编辑、撤销重做、标签、全屏；批量（全选本屏/导出/归档/置顶收藏/合并≥2/删除）；归档“全部取消归档”；关键词 + 四视图 + 标签 OR；置顶组 + 日期分组；全库口令锁；骨架/三种空态/失败重试；Ctrl+K、Esc、↑↓、Enter/Space、Ctrl+Enter、`/`、Ctrl+Z；拖入图片；全屏 view/edit 双态。
- **复用**：全部小记组件、`NoteLockDialog`、`NoteExportController`、`PopoverMenu`、`ConfirmDialog`、notes store。
- **风险**：全屏依赖 `#workspace-surface > .fs` 与页栏 exclusive；目录与全屏让位；草稿/自动保存/`usePageActive` 不能被外壳切换打断。

### 5.4 文件

- **B 表面**：密表（名称/路径/类型/操作）+ 行内更多；添加/编辑弹窗复用。
- **必守**：新建/编辑（路径粘贴、选文件/文件夹、名称、类型、Ctrl+Enter）；点击打开（桌面 `open_file`；Web 文件夹浏览、文件下载）；复制路径（按钮/C，1.2s 回执）；打开所在目录；终端打开；删除确认；右键菜单（桌面）；Ctrl+K、Esc、方向键、Enter/Space；搜索空态、骨架、加载失败重试；Web 隐藏写操作。
- **复用**：添加/编辑对话框、`WebFilesDialog`、fileShortcuts store。
- **风险**：Web 只读分支；现网缺的拖拽/多选两边都不加。

### 5.5 验证码

- **B 表面**：实时令牌网格/密表；圆环或细条读秒；复制仍是主动作。
- **必守**：每秒本地递减；归零拉新码；换码闪光；≤5s 警示；页失活暂停、回来自刷新；点击/Enter/Space 复制并显示“已复制”1.2s；新增（otpauth/手动密钥/图片识别/Ctrl+V 图片或链接）；删除确认并提示需站点侧重绑；骨架/空态。
- **复用**：添加验证码对话框、确认框、`mfaApi`。
- **风险**：定时器与 KeepAlive 生命周期；聚焦态与键盘。

### 5.6 互传（fileshare）

- **B 表面**：连接台——服务状态、地址/二维码、目标目录、拖放区、已收列表、设置入口。
- **必守**：启停与启动中/停止中三态；地址与本机地址复制；二维码；共享目录增删/设目标/手输路径；拖入文件或多选；4GiB/同名重命名；投递项复制提取链接；无口令/仅本机/端口漂移警告；设置端口/仅本机/口令；侧栏 live 点；`onDisable` 停服；加载失败重试、空投递/空目录；pageActive 轮询与拖放。
- **复用**：FileshareSettings、拖放与投递逻辑、fileshare service。
- **风险**：拖放监听与 KeepAlive；端口/口令设置只在设置页签，B 需内嵌或保留深链；现网无历史/搜索，两边保持一致。

### 5.7 穿透（tunnel）

- **B 表面**：服务密表 + 准备流程（三步进度）+ 诊断展开。
- **必守**：启停三态与服务计数；获取/校验程序；浏览器授权（倒计时/打开/取消）；撤销授权；建隧道/接管/找回凭据；主域名重试；服务增改、应用、复制地址、重新登记、移除；行状态（待应用/端口未监听/待设置口令/已就绪）；未应用数；诊断与出口检查；3s 轮询与聚焦补刷；启动禁用原因；空服务/骨架/错误重试；`onDisable` 停隧道。
- **复用**：`TunnelServiceDialog`、确认框、`tunnelState`。
- **风险**：授权倒计时与取消；轮询；窄窗页栏内联排版。

### 5.8 直连（bypass）

- **B 表面**：健康度总览 + 目标密表 + 异常卡/chip + 探测输入。
- **必守**：输入探测/取消；加入/更新清单、重探、改原文探测并保存、移出；配置直连（计划/UAC/结果）；撤销上次配置；检查全部/停止；复制清单、直连目标、结论；hero 可用/总数、出口分布、hosts 记录；需处理卡、chip 筛选、上次检查；行展开草稿；planKey/CDN/出口覆盖/blocked；空清单仍可撤销；单一全局任务互斥；切页不停止重验；加载失败重试/空清单/无命中。
- **复用**：`BypassProbeDialog`、`BypassApplyDialogs`、`BypassChipDialog`、`BypassTargetDetail`、`useBypassProbe`。
- **风险**：无顶栏 Teleport（页栏内联），B 的 surface-head 要给它位置；UAC 等待与长任务；重验在切页后继续。

## 6. 外壳 B 职责清单

- 窗口：整条拖拽、双击最大化、最小化/最大化/关闭、hover guard、最大化状态。
- 品牌：Desko 菜单（档案/关于/外观/模块管理）、Web 运行时差异。
- 状态：锁定/退出、设置、同步/备份徽标、Web 状态轮询、互传/穿透 live 点。
- 页头：pageHead 页名/条数；`headingInContent` / `replace` 两种方言。
- 工具：`#workspace-page-toolbar`、`#workspace-fixed-tools`、`#workspace-cover-search`（B 专用，模块按面把搜索挂进封面正中）、目录开关。
- 导航：8 章、启用/禁用、选中态、窄窗收紧。
- 内容：surface-head、目录 aside、全屏让位、Toast 顶距。
- 主题：纸/墨、强调色、氛围光沿用现有令牌。
- 锁屏/初始化：沿用现有浮层，不随模式改。

## 7. 实施阶段

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| P0 | 本方案 + 对等清单 + 干净基座 | 用户拍板；并行 WIP 已提交 |
| P1 | WorkspaceHost / 舞台插槽 / 共享窗控与导航 / 外壳 B 骨架 / 模式设置与重载 | A 模式现有测试全绿；B 能启动并承载现有模块页 — **已达成，见第 13 节** |
| P2 | 收藏密表 + Codex 账号板（含对等清单） | 两模块在 B 下逐项勾完；做一次方向复盘 |
| P3 | 文件、验证码、直连、穿透 | 四模块对等 + B 模式 e2e |
| P4 | 互传 | 拖放/轮询/三态对等 |
| P5 | 小记（内容面 + 全屏 + 目录） | 内容形态未被压扁；全屏与草稿正常 |
| P6 | 八模块全量对账、双模式测试、视觉与试用 | 无回退到 A 页面的模块；两套都可日常用 |

- P1–P5 期间，未迁移模块在 B 下暂时显示 A 的页面，仅作开发态；不得把这种混合态交给用户试用。
- P2 后做一次方向复盘：不是反悔，是在投入剩余六个模块前确认外壳与两张锚点面成立。
- 每个阶段结束都跑 A 模式回归；B 模式至少跑本阶段模块的 smoke/e2e。

## 8. 验收

**功能对等**
- 每模块按第 5 节逐项勾选，用户签字确认“能做到”而不是“看起来像”。
- 两套共用同一 store；切换前后数据、锁定状态、同步状态一致。
- 复杂弹窗复用清单：不得为 B 另写一套业务逻辑。

**测试**
- A 模式：现有单测 + e2e 全绿，每个阶段回归。
- B 模式：每模块 smoke + 关键路径 e2e（搜索、复制、批量、切号、拖放、全屏、探测、启停）。
- 切换：写入偏好 → 重载 → 落在正确外壳；数据无损；Web 强制 A。
- 生命周期：轮询只挂一次；拖放/键盘监听不重复；锁定/解锁后无残留；HUD 不受影响。

**视觉**
- 1040×670 纸/墨；1560/1920 宽窗；800×600 窄窗。
- 无横向溢出；表头粘顶；`scrollbar-gutter: stable`；28px 控件档；无入场动画。
- 对比度：纸面 ≥4.5:1，墨面 ≥5.8:1；沿用现有令牌，不新增颜色体系。
- 全屏、目录、Toast、锁定态逐帧检查。

**试用**
- 两套都完成后，用真实任务跑至少一周：找站并打开、判断该用哪个 Codex 账号、改一条收藏、记一条、传一个文件、起一条隧道/直连检查。
- 记录哪边多一次弹窗、多滚一屏；不用埋点，按实际使用体感决定。

## 9. 风险与止损

- **双轨维护**：试用期冻结 UI 改动；必须修的 bug 两边同步；否则 B 会因缺修复而输。
- **对等漂移**：只复用弹窗和 store，不复制业务逻辑；每模块清单是硬门槛。
- **Teleport/挂载**：切壳重载；四个 ID 唯一；全屏目标不挪。
- **轮询/监听双挂**：同一时刻只挂一套 chrome；BackupBadge/Web 状态/拖放/轮询随 chrome 单实例。
- **小记是最大风险**：如果 B 保不住内容形态，停下来报告，不硬压成表；这会直接影响“完整”的成立。
- **范围膨胀**：B 不加新功能；现网缺口两边同缺；全局搜索、设置/锁屏重绘都不进这轮。
- **基座不干净**：并行 WIP 未提交就开工，B 会缺功能，试用无效；这是开工前置，不是建议。
- **永久双轨**：如果最后要永久保留两套，每次 UI 改动都要双实现、双测试；这是另一个决定，需明确接受。

## 10. 拆除方案

默认按“试用后决定”处理：

- B 胜：删除 A 外壳、侧栏与旧主面 + 切换项 + A 专属测试；A 保留在 git 历史。
- A 胜：删除 B 分支/外壳/工作面 + 切换项，master 不留双轨。
- 若选择永久双轨：保留切换，但建立双实现契约（每个 UI 改动必须双模式通过），并接受维护成本。

## 11. 拍板记录（原待拍板四项，2026-10-25 全部落定）

1. **“完整”的边界**：**已拍板** = 按本方案，桌面解锁态外壳 + 8 模块主面；锁屏/设置/HUD 共用。
2. **收藏 B 的分类入口**：**已拍板（2026-10-25）= 工作面筛选行**，见 4.4。
3. **两套是临时试用还是永久并存**：按用户原话"我通过使用去决定"执行 = 临时试用，两套都完成后跑一周再定去留；永久并存不是默认。
4. ~~**开工基座**~~ **已被实况取代**：P1 直接从当前 HEAD 起（收藏/Codex 那批已落库，工作树只剩并行会话的 Web 访问 WIP，与壳 B 无交集），见第 3 节第 4 条实况。

## 12. 审计来源

- 收藏/Codex：`src/components/entries/*`、`src/views/EntriesView.vue`、`src/components/codex/CodexModule.vue`、`src/services/codexState.ts`、`src/stores/entries.ts`。
- 小记/文件/验证码：`src/components/notes/*`、`src/components/files/FileShortcutsModule.vue`、`src/components/mfa/MfaModule.vue`、`src/stores/notes.ts`、`src/services/api/mfa.ts`。
- 互传/穿透/直连：`src/components/fileshare/FileshareModule.vue`、`src/components/tunnel/*`、`src/components/bypass/*`、`src/services/fileshareSettings.ts`、`src/services/tunnelState.ts`、`src/services/api/bypass.ts`。
- 外壳：`src/App.vue`、`src/components/layout/TitleBar.vue`、`Sidebar.vue`、`CodexWorkspace.vue`、`ModuleRouterView.vue`、`workspaceLayout.ts`、`useWorkspaceDirectory.ts`、`src/stores/pageHead.ts`。

审计只覆盖用户可见面与外壳耦合；每个模块开工前仍要按清单逐项复核，不拿这份表当免检。

## 13. P1 实施记录（2026-10-25）

**新增**：`services/layoutMode.ts`、`composables/useWindowChrome.ts`、`layout/WindowControls.vue`、`layout/WebStatusButton.vue`、`layout/AppMenuButton.vue`、`layout/WorkbenchCover.vue`、`layout/ChapterStrip.vue`、`layout/WorkbenchSurfaceHead.vue`。
**改动**：`App.vue`（模式分支、`--toast-top/-side`、`.workbench-shell` 把 `--sidebar-rail-w` 归零）、`TitleBar.vue`（改为共享件的消费者，自身只剩面包屑与窗口位测量）、`CodexWorkspace.vue`（`shell` prop + B 的全屏让位规则）、`BackupBadge.vue`（自带 34×30 档，不再依赖标题栏样式）、`ToastNotification.vue`（`top` 改吃 `--toast-top`，A 侧仍是 52px）、`SettingsDialog.vue`（外观页首块「工作区外壳」）。

**与方案的两处偏离**（已回写 4.1 / 4.2）：没有独立 `WorkspaceHost` 组件；B 全屏保留封面与章节栏、页头抬到 `.fs` 之上。

**踩到的坑，留给 P2–P6**
- 插槽存在 ≠ 插槽被渲染：`<template v-if="workbench" #surface-head>` 在 A 下仍会注册插槽函数，`$slots` 判真会让 A 平白多出 48px 页头。故用显式 `shell` prop，页头写成 `<slot v-if="shell === 'workbench'" name="surface-head" />`；同一个 prop 顺带管住目录与 Ctrl+B（见 4.1）。
- 设置里的选择控件不得复用 `.accent-pill`，也不得用 `role="radio"`：`theme.spec.ts:107` 按 `.accent-pill` 枚数、`:151` 按 `.accent-pill[aria-checked="true"] .accent-name` 锚定强调色行，`workspace-layout.spec.ts:342` 按 `getByRole('radio')` 数到 12、`appearance.spec.ts:92` 按 `getByRole('radio', { checked: true })` 取唯一选中项。借名或借 role 都会把它们改红。现解：类名 `.choice-pill`（与 `.accent-pill` 共享同一条样式规则）+ `role="group"` 配 `aria-pressed`，与 `CodexUsageShareDialog` 的浅色/深色丸同一方言。
- B 只服务桌面：`workbench` 计算属性必须带 `!isWebRuntime()`，否则同一份偏好值会把 Web 运行时推进 B（方案第 2 节写的是 Web 固定 A）。
- 章节栏截图里"上一枚章还带着底色"不是残留态：`--transition-fast` 的 background 过渡被点完立刻拍的帧抓在半程（实测三枚章的 alpha 依次 0.418 / 0.084 / 0）。验收要看终帧，别按这种帧判 bug。

**验证**
- `vue-tsc --noEmit` 干净。
- 单测：65 份通过、4 份失败共 23 条，与 `490c639` 落库时记的红账逐条同号（`App.web` 1 条 `matchMedia`、`BypassModule` 20 条 `ResizeObserver`、`WebSettingsDialog` 1 条、`WebAccessPane` 1 条），本轮没有新增红；`App.web.test.ts` 那条已核到 `useWorkspaceDirectory.ts:20` 与 `App.vue` 的调用在 HEAD 上逐字存在，归属旧账。
- B 骨架 e2e（临时 spec，跑完即删）：A 壳无回归（侧栏/标题栏在位、`#workspace-page-toolbar` 与 `#workspace-fixed-tools` 各一处）；B 壳能挂 8 章并承载 A 页面——收藏（含目录开合与 Ctrl+B）、验证码、互传（`inline` 让位）、Codex（`replace` 顶掉页名）、小记全屏（`.fs` 从 48px 页头下沿接管、全屏工具栏在视口内）；设置里切壳先出确认框且正文含"重新载入"。
- 全量 e2e（`PW_CHANNEL=msedge`，4 worker）：651 passed / 34 条唯一失败。其中 `appearance.spec.ts:70` 与 `workspace-layout.spec.ts:337` 是本轮那颗选择丸借了 `role="radio"` 造成的，改法后两条复跑转绿；余下 32 条逐条落在 `490c639` 记的红账族里（toast 固定目录点不到导致的 2 分钟超时、theme 的 hex 锚点、files 的对话框、web-access/web-workspace 等），没有新增族。`appearance.spec.ts:100` 归属存疑，用"临时把本轮新增块 `v-if=false` 藏掉"复跑，失败点与文案逐字相同，判为旧账。

## 14. P2a 实施记录（2026-10-25）

**新增**：`components/entries/EntriesWorkbench.vue`（B 的收藏密表，props/emits 与 `EntriesModule` 逐字同形，切壳只换表现层组件、不换 `EntriesView` 的那串绑定）、`e2e/specs/entries-workbench.spec.ts`（13 条常驻，取代 P1 跑完即删的临时 spec）。
**改动**：`EntriesView.vue`（`useWorkspaceShell()` 选 surface，A/B 走同一个 `<component :is>`；Esc 退批量仍住在这个视图里，两套白继承）、`EntryActionMenu.vue`（加 `showDetail`，默认 true，B 传 false——「详情」已经是行内一颗钮，⋯ 里不再重复第二遍）、`CodexWorkspace.vue`（`:has(> .filter-band)` 收滚动容器留白）。

**拍板落地**：4.4 承诺的收藏目录收口已做——B 下收藏页不挂目录、Ctrl+B 对收藏不生效，分类与计数由工作面筛选行承担（前 7 枚直接成丸，第 8 枚起进「更多」可搜索面板）。偏好存储 `hasWorkspaceDirectory` 一位未动，切回 A 目录还在。

**三条硬教训，留给 P3–P6**
- `<td>` 上不得写 `display:flex`：改掉 display 它就不再是 table-cell，整行列对齐散架、行高被顶成两块。横向排布交给格内包装层（`.site-wrap` / `.cell-line`），格子本身只管对齐与省略。spec 里已用 `toHaveCSS('display','table-cell')` 钉住。
- 全局类名撞车是静默的：`global.css:1928` 躺着 `.row-detail`（设置行的说明块，`flex-direction:column`），B 的「详情」钮原本就叫这个名，箭头被掰到第二行且压成 13×4。改名 `.act-detail` / `.act-open`，并用 `toHaveCSS('flex-direction','row')` 钉住。凡在 B 的新表面里起类名，先 grep `global.css`。
- sticky 带与滚动容器留白打架：`.content-inner` 的 `padding-top:16px` 让 `sticky top:0` 的筛选行下面露一条能看见滚动内容的缝（实测 y 差 16）。按 `global.css` 页面骨架的既有约定，容器收成 0、把 16px 写进带内（带高 46 = 30 呼吸 + 16 首行留白），`.filter-btn` 吃 `height:100%` 后选中下划线正好落在带底。只在有筛选行时收，靠 `:has()`，不污染别的模块。

**窄窗方言**：≤900px 只有「打开」脱字留形（external 那颗图标自己认得出来），「详情」必须留字——只剩箭头就成了无字谜。断点跟 `.codex-layout` 的 900 走；B 侧轨为 0，窗口 900 ≈ 表宽 836。

**验证**
- `vue-tsc --noEmit` 干净。
- `entries-workbench.spec.ts` 13/13；与 A 侧同口径的 `entries.spec.ts` 一起跑 29/29。
- 收藏相邻单测 66/66。
- `App.web.test.ts` 的 `matchMedia` 仍红：`useWorkspaceDirectory.ts:20` 在 HEAD 上逐字已存在，归属第 13 节记录的旧账，不是本轮新增。
- 帧在 `.tmp/entries-workbench/`（不入仓）：01 满表、02 摊开行、03/03a 遮罩与明文、04 批量停靠、05 未匹配、07a 更多面板、08 粘顶、09 窄窗、10 宽窗 1560、11 空库。
- 坑：列表是 `ORDER BY created_at DESC`（`src-tauri/src/db/entry_repo.rs:24`），而 e2e mock 的时间戳按种子顺序递增 ⇒ DOM 行序是 SEED 的倒序（GitHub 落最后一行，压在批量停靠栏下）。按位置走行的用例因此不认名字，改行序前先回看这条。

## 15. P2a 回面：实体对齐 mock 观感（2026-10-25）

用户反馈「实体没有之前的 mock 好看」。逐帧对拍后确认差距全是我落码时自己改掉的，不是渲染差异。

**先纠一条我自己写的理由**：§4.4 原文「不放全局搜索——避免与 A 能力不一致」是个稻草人。mock 里那颗字段明确 `aria-label="搜索当前工作面"`，它从来不是全局搜索，A 的页栏搜索也不是全局搜索，两者能力等价。搜索按面走，封面正中放得下。

**再废一条假设**：「mock 看着疏是因为行高」不成立——两边都是 44px。mock 的疏朗来自 `deviceScaleFactor: 1.5` 与 9 行种子，属于拍摄产物，别再拿行高说事。

**回面五处**
- 搜索搬到封面正中：新增 B 专用挂载点 `#workspace-cover-search`（`workspaceLayout.ts`），`WorkbenchCover` 改三格 grid。控件档直接认领页栏那一档 `.search-box.flat`，只覆盖一行 `height: 28px`（36/32 两档在 40px 的带子里都会顶到上下沿）——按 `global.css:2286` 的既有约定，不重抄令牌。
- 页头恢复两行字阶：26px 页名 + 小字条数，`--workbench-head-h` 48 → 76，全屏 `.fs` 顶距与 Toast 下沿都跟着这条账走（见 §4.2）。
- 摊开行改横排：网址占两格、添加于/更新于各一格，路径与备注是长句占满整行。竖排清单会把网址切成一列一行，摊开的意义就没了。
- 冷密码格补一个字：整列只剩一颗眼睛会被读成「这列是空的」，改 `眼睛 + 显示`。九行同列不吃 `.mini` 的灰底（那档是给单颗动作的），用透明字钮。
- 「添加于」换相对时间：`formatRelativeTime` → 刚刚 / N分钟前 / N小时前 / N天前，7 天外回落到 `YYYY-MM-DD`；绝对时间挂在 `title` 与摊开行的「添加于」格。
- **不回的一处**：mock 里的「最近访问」列。`Entry` 没有访问时间与访问次数字段，补它要动后端列，不属于观感回面。

**新账，留给 P3–P6**
- sticky 表头与带子之间不能有 1px 余地：`.entry-board` 的 `margin-top: 2px`（无带子时给表格吸的一口气）落在带子下沿与粘顶表头之间，滚起来会透出滚动行的字底。规则：有带子时这 2px 归零（`:not(.has-filter-band)`），带子自己的 16px 呼吸已经够了。断言用 `document.elementFromPoint` 打带子下沿 +0.5/+2/+6 三颗像素，必须全是 `TH`——只看 `boundingBox` 会漏掉这一类缝。
- mock 里出现的每一列，落码前先核数据是否存在（`Entry` 有无 last-visit / locked / tag）。核不过就当面向用户讲清「这一列是画出来的」，不要默默删掉再被反问为什么少了。
- 种子时间戳要拍时间列的多种形态就显式给 `created_at` / `updated_at`（`E2EEntrySeed` 已支持，不写才按数组顺序铺秒级）；显式值仍要守 §14 那条倒序账。

**验证**：`entries-workbench.spec.ts` 14/14（新增「页头两行字阶与封面搜索同高」与粘顶缝断言）；A 侧 `entries.spec.ts` + `workspace-layout.spec.ts` 同跑 28/28；`vue-tsc --noEmit` 干净。帧已重拍在 `.tmp/entries-workbench/`：`00-at-1040` 为基准尺寸满表、`08-sticky` 为粘顶无缝。

## 16. P2a 密度轮：压固定带换行呼吸（2026-10-25）

用户在**真机 1040×670**（不是 mock）上看 §15 那一版，判「有点拥挤」。先在活的窗口上量，三笔账：

| 账 | 实测 |
| --- | --- |
| 纵向固定带 | 222px / 670 = 33% 才见到第一行字（封面 40 + 章节 32 + 页头 76 + 筛选带 46 + 表头 28），一屏 10 行 |
| 行内 | 站点格两行字实占 33px，行高 44 ⇒ 上下各 5px 呼吸 |
| 横向 | 976px 摊六列，操作列 174px 装 53+53+24 三颗，站点列 300px 已在截断 URL |

**改法（用户选「压固定带换行高」）**：页头 76→52（条数从第二行搬回页名同一排、动作改居中）、筛选带 46→40（首行留白 16→10）、行高 44→52（呼吸 5→9）。

**我上一条提议里的算账错了，留此记账**：当时说「省出的 30px 全补给行高，一屏仍 10 行」——30px 摊到 10 行只有 3px/行，要给到 9px 呼吸就得认 9 行/屏。真实结果：固定带 222→192，一屏 10→**9** 行。少一行是这轮的代价，不是收益；下次报"呼吸"必须同时报"行数"，两者是一笔此消彼长的账。

**为什么不砍行内两行字**：真库里 `Linux x64 Private`、`WinQT Dev` 这类条目没有可认的 favicon，URL 就是它的身份；把 URL 从主行拿掉换疏朗，等于让一半的行变成无字谜。所以留两行字、把行高抬到配得上它的高度。

**还留着的账**：横向六列没动（`只裁列` 那版被搁置），操作列仍 174px 三颗钮。P3 落文件/验证码密表时若同判拥挤，先从这里续。

**验证**：`entries-workbench.spec.ts` 14/14（页头断言改为「单行脊梁 + 动作居中 + 行呼吸 ≥9」，粘顶缝断言不变，实测带子下沿 164 = 表头顶 164）；A 侧 `entries` + `workspace-layout` 28/28；`vue-tsc --noEmit` 干净。真机帧在 `%TEMP%\desko-wb-live\`（CDP 驱动，口令解锁后拍，密码列全程停在冷态）。

## 17. 整轮回撤：双壳方案作废（2026-10-26）

用户看完 §15–§16 那一版（真机 1040×670），判「还是现版本的好，把这一版本撤销吧」，并补了一句范围：**整个改动回撤，只保留侧边栏在左边的**。所以撤的不是某轮微调，是双壳方案本身。

- **回到哪**：工作树恢复单壳 A（顶栏 + 56px 左侧模块轨）。P1–P2a 动过的 10 个文件按 `git checkout --` 复原（`App.vue`、`TitleBar.vue`、`workspaceLayout.ts`、`BackupBadge.vue`、`CodexWorkspace.vue`、`SettingsDialog.vue`、`ToastNotification.vue`、`useWorkspaceDirectory.ts`、`EntriesView.vue`、`EntryActionMenu.vue`），B 专属的 10 个新增文件删除（`WorkbenchCover.vue`、`ChapterStrip.vue`、`WorkbenchSurfaceHead.vue`、`AppMenuButton.vue`、`WebStatusButton.vue`、`WindowControls.vue`、`useWindowChrome.ts`、`layoutMode.ts`、`EntriesWorkbench.vue` 与 `entries-workbench.spec.ts`）。`git status` 里这些路径已全部干净，零悬挂引用。
- **备份**：`%TEMP%\desko-shellB-revert-20261025`（637 行 tracked patch + 被删文件原件）。
- **本文留着**：§1–§16 是「为什么第二套壳不值」的审计记录，不是待办。P2b–P6 作废，别再从 §7 的阶段表续做。
- **边界**：并行会话的浏览器访问改动全程未碰——`src/main.ts`、`src/services/runtime.ts`（含其单测）、`src/styles/web.css` 的字体块、`e2e/mocks/backend.ts`、`src-tauri/src/web_access/*`、`docs/design/web/02-tunnel-perf.md`、`scripts/web-perf.mjs`。

**这轮真正的收获在门禁**：回撤后 `git status` 干净了，但红着的测试说明不了任何事。逐条判归属的结果记在 `docs/design/workspace/02-full-height-directory-and-visual-audit.md` 的「测试门禁基线」一节；本文只留一句教训——**换工作面这种整屏改动，验证债要和本轮改动一起还，别留给下一轮当尺子**。
