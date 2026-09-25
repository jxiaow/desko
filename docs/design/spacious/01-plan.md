# 大方化：尺度上抬 + 层级重做 + 行内重排

日期：2026-09-24 ｜ 前置：`docs/design/unify/01-audit-and-plan.md`（五页骨架统一）

## 问题

统一骨架后用户反馈"设计有点小气"。定位到四个来源：

1. 字号阶梯整体压在下限：主档 13px，元信息 11px，全 UI 在 11~13px 打转。
2. 层级只靠 1px 发丝线：白卡 + 浅灰边 + 近零阴影（--shadow-card 实为 shadow-xs），整页像线框图。
3. 几何全在下限：行高 58、栏内控件 32、图标块 32、卡片圆角 12。
4. 行内又空又碎：URL 列固定在中部，中间大片空白，右侧飘两小撮细弱元素。

## 已拍板

- 力度：**全套**（尺度 + 层级 + 布局），字号阶梯上抬属全局改约。
- 行内布局：**重排，信息靠左聚拢**；r12 的五栏定基宽对齐作废。

## 数值契约

### A. 尺度层（主题间恒定）

| 令牌 | 旧 | 新 |
| --- | --- | --- |
| --text-xs / sm / base / md | 11 / 12 / 13 / 14 | 12 / 13 / 14 / 15 |
| --text-lg / xl / 2xl | 16 / 18 / 22 | 17 / 20 / 24 |
| --icon-xs/sm/md/lg/xl-px | 11 / 13 / 14 / 18 / 24 | 12 / 14 / 16 / 20 / 26 |
| --radius / md / lg / xl | 8 / 10 / 12 / 16 | 10 / 12 / 14 / 18 |
| 行高（entry/file 行卡） | 58 | 64 |
| ec-tile 图标块 | 32 | 36 |
| 行卡左右内衬 | 12 | 16 |
| 列表行间 gap | 8 | 10 |
| .page-bar 高 | 44 | 48（--stream-bar-h 同步） |
| 栏内控件高（btn/search） | 32 | 34 |

### B. 层级（灰底浮白卡，发丝线退役）

- `--shadow-card` 从别名层（= shadow-xs）**升为主题槽位**，7 套主题各自填：
  - 浅色：`0 1px 2px rgba(·,0.04), 0 8px 20px -8px rgba(·,0.10)` 量级，柔和宽大。
  - 深色：小落差投影 + `0 0 0 1px 高光线`（沿用"暗色靠高光描边分层，不靠阴影"）。
- 行卡/备忘卡 `border: 1px solid transparent`（保留 focus/selected 的 border-color 通路），默认不再吃 --border-subtle。
- 浅色主题页面底色 `--bg` 加深一档（如 light-cool #f7f8fa → #eef1f6），拉开与白卡的对比。
- hover 配方同步：去 color-mix 浸润改"阴影抬升 + 描边显色"，避免灰底上再染一层。

### C. 行内重排（收藏 / 文件）

收藏行：`[check?] [tile 36] [主列 flex:1 → 名 15/600；meta 行 = 域名 · 路径 · 备注（12px，截断）] [分类胶囊] [hover 动作]`
- URL、路径、备注并进第二行，中间空白被主列吃掉；锁标识并入分类前。
- 文件行同理：名 + 路径 meta 行，右侧类型胶囊 + 时间。
- 小记页不动形态，只随令牌放大；验证码/局域网页跟随尺度。

## 影响面与验证

- 主题槽位契约 +1（--shadow-card）：7 套主题 + check-theme-coverage.mjs 联动。
- e2e：行高 58→64、page-bar 44→48 的几何断言与锚点更新；notes 单测跟随。
- 验证流水线：vue-tsc+vite build → 覆盖检查 → vitest → Playwright e2e → unify-shots 双主题截图自查。

## 实施记录

2026-09-24 落地：

- 尺度层：字号阶梯/圆角/图标阶梯按上表整体上抬；`.page-bar` 44→48（--stream-bar-h 同步），栏内控件 32→34，bar-btn 基座 32→34；body 走 --text-md；--memo-max-h 138→144（6×24 行高）。
- 主题层：`--shadow-card` 升为第 96 个槽位，7 套主题各自填（浅色宽大软影、深色小投影+高光环）；五套浅色主题 --bg 加深一档；别名层删除旧 --shadow-card 映射。
- 行卡：收藏/文件/小记/验证码四类卡 `border: 1px solid transparent` + `--shadow-card`，hover 改"描边显色 + --shadow-card-hover 抬升"，accent 浸润配方退役；局域网分组卡外框同款。
- 收藏行重排：ec-id 由定宽 210 改 flex:1，URL/路径/备注并进名下方 meta 行（域名 mono · 路径 · 备注，依次截断）；ec-target/ec-branch 独立列删除，路径胶囊降级为纯文本链接；行高 64、图标块 36、动作钮 30px/图标 16。
- 文件行重排：同款两行结构（名 + 路径 meta），动作图标 13→14。
- 验证码：卡 issuer --text-md、码 30px、栅格 minmax 216→240。
- 验证：vue-tsc/vite build 绿；check-theme-coverage 7×96 对齐；vitest 166 绿；Playwright e2e 97 绿（theme.spec 五套浅色 bg 锚点随 --bg 更新）；unify-shots 浅色/深色两套重拍自查通过。

## 协调轮（同日，用户反馈"搜索栏和列表不协调"→"侧栏别扭"→"逐页自查"）

- 顶栏去带：`--bg-toolbar` 由 panel-bg 72% 改 **--bg 72%**（静止看不出有条带，滚动仍磨砂穿透），`.page-bar` 下划线删除；左右间距本就与 `.content-inner` 同 space-5，栏内控件与行卡左缘对齐。
- 栏内控件收进浮卡语言：`.search-box`、`.tab.active` 改 bg-surface + 透明边框 + `--shadow-card`，圆角 `--radius`(10px)=行卡 14px 下一档；tab 字号收进 --text-sm。
- 侧栏（大方化轮漏网）：折叠导轨 56→64px，图标 18→20，行高 32→36，圆角 radius-sm→radius；折叠档隐藏左侧胶囊柱（窄栏不贴边显漂浮），展开档保留；字号收阶梯（品牌 13.5→14、条目 13→14、计数 11→12）。
- 逐页自查补齐两处不一致：① 文件页搜索框补 Ctrl K 键帽 + Ctrl/Cmd+K 聚焦监听（与收藏/小记同键位），`.search-kbd` 从收藏 scoped 升进 global（9.5px→--text-xs）；② 验证码卡补 36px 发行方图块（词首两枚/中文前两字，四桶 tone 哈希与收藏行同配方），label 行缩进与 issuer 左缘对齐（实测 x=149 一致）。
- 验证：tsc 绿；vitest 166 绿；e2e 97 绿（notes 图片上传一次瞬时飘红，复跑即过）；light-cool/linear-dark 全六张重拍自查通过。

## 弹窗协调轮（同日，用户"继续啊，各个对话框呢"→ 全弹窗逐张自查）

- 底栏统一：`.dialog-footer` 全局收编收藏弹窗 r13 原型档——46px 浅底条（--fill）+ 28px 按钮档（primary/secondary/danger 一律 height 28 / padding 0 12 / --text-sm）；EntryFormDialog 与 shortcut 的 scoped 副本（sidebar-bg 底、28px 钮）删除，只留本弹窗布局差量（左键标右按钮 = space-between）。改密/确认/详情/添加验证码底栏首次同色同档。
- 字段档统一：全局 `.form-group` 由 36px/14px 落进收藏弹窗原型档——输入 32px 定高、--text-sm 13px、label --text-xs 12px/6px 下距；textarea 单独拆块（6px 11px 内距、min-height 56）。shortcut 路径组容器同钉 32px（原 31.7 与名称框差 4px 高低不平），mfa uri-box 内距对齐 textarea。
- 分段控制器一套语言：shortcut type-seg 与 mfa add-tabs 统一为"凹槽轨道（--sunken 无边框 padding 3）+ 浮白选中块（--bg-surface + --shadow-xs + 透明边框）"；add-tabs 的 accent-soft 选中态与外框描边退役，选中文字回归 --text 600。
- 杂项：mfa 正文"识别图片"钮落 32px 字段档（不得高过底栏主钮）；path-act 三枚图标钮底由 sidebar-bg 改透明。
- 验收脚本沉淀：`scripts/dialog-shots.mjs [themeId]`（沿用 unify-shots 的 SEED/解锁流），一次拍全 11 张：新增收藏/详情/快捷方式/添加验证码/确认删除/设置三页+局域网页/改密嵌套/小记行内编辑器；输出 `design/dialog-check/`（已进 .gitignore）。
- 验证：tsc 绿；vitest 166 绿；e2e 96 过 + notes 图片上传 1 例瞬时 flaky（重试即过，与并行会话先例一致）；light-cool/linear-dark 两套 11 张重拍自查通过（深色分段块靠高光底、浅色靠阴影，均与页面 .tab 同读法）。
- 收藏页浮层补审（同日追问"收藏页面的呢"）：⋯ 动作单/批量底坞本就吃全局 `.popover` 语言，通过；分类下拉（teleport 到 body）原是小圆角 + shadow-md + hover accent-soft 的孤例，收进 `.popover` 同套（radius-lg + shadow-pop + padding space-1，条目落 .pop-item 同档 8×12/13px，hover 改 --hover、选中保 accent-soft，max-height 168→200）；dialog-shots.mjs 扩到 15 张（+12-entry-menu/13-entry-category/14-entry-detail-notes/15-entry-batch），双主题重拍，e2e 97 全绿。

## 纯 UI 收尾轮（同日，用户"都实现"——只做视觉，不加功能）

- 一行级微修：① `.nav-item:focus-visible` 补进焦点环名单（只上 ring 不动 border，避免吃掉侧栏自身的透明边框占位）；② 七套主题 `--font-mono` 统一为 Consolas 优先（原先三套 Cascadia 打头、一套 JetBrains 打头，等宽小字跨主题换字体）；③ `tabular-nums` 补到备份附件 `.file-meta`。勘误：`::selection` 上轮误报缺失——实为已主题化（`--selection` 七槽 + global 1009 行），收回该条建议。
- 数字排印：详情弹窗密码改常显等宽并抬到 15px 档（跟验证码 30px 同一条"读一个值"排印思路），顺手清掉该弹窗的 r9 小数遗孤（13.5→--text-sm、12.5→--text-sm）；`.detail-value.mono` 条件类整删，密码两态同字体不再跳字宽。
- 设置密度：`.settings-pane > .group-content:only-child { margin: auto 0 }`——安全/通用这类单卡稀疏页垂直居中，超高时 auto 边距自动归零不裁头，与「关于」页同思路；多卡组（外观/备份）不受影响。
- 右键菜单同源核验（读码）：文件页右键浮层直接吃全局 `.popover`/`.pop-item`，与 ⋯ 动作单同一语言，无需改。
- 审计口径扩到 7 主题 × 24 场景：`dialog-shots.mjs` 支持 `all`，新增 0-lock-screen（进门先拍）、16/17 设置通用+关于、20..23 四页空状态（空种子独立 context）、24/25 窄窗 800/720；新脚本 `icon-board.mjs` 离线渲染 42 枚图标 × 14/16/20/24 四档 × 7 主题（design/icon-board/）。
- 自查结论：图标板全过（同源注册表 stroke-width 2，明暗可读）；7×24 弹窗/页面截图未见缺陷——窄窗 800 保留"更多"、720 收进下拉，降级正常；深色单卡居中、底栏 --fill 带、焦点环均正确。
- 验证：tsc 绿；check-theme-coverage 7×96 绿；vitest 166 绿；e2e 97 绿；dialog-shots all（168 张）+ icon-board（7 张）重拍自查通过。
