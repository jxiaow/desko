# 20 · Codex 桌面额度挂件（2026-10-22，已交付）

一句话方案：把「当前账号额度 + 今日用量」压成一枚 **136×74 的透明桌面小组件**，默认只露角色；鼠标停在角色上向下展开 136×144 的数据面板（点角色可钉住），三款皮肤（兔子 / 企鹅 / 蜗牛）在 Codex 设置里切换，默认关；额度取当前账号，今日用量取本机全部账号的本地扫描汇总。

状态：**已交付**（2026-10-22，第十一轮按皮肤分动作后复核）。视觉三款全保留、兔子默认（样张 `.tmp/codex-hud-20261021/S5-cute.png`，源文件 `cute.src.html`）；设置页、快照映射、HUD 窗口与生命周期均已落地，单测 / e2e / 构建 / 原生 CDP 复验通过。

> **2026-10-23 行为已被 [23 号文档](./23-hud-behavior-redesign.md) 替代**：本文的 §3.8 绕锚巡游、§3.9 常驻步态（`gait-*` / `lift-*`）与「桌面走动」开关（键 `codex_hud_walk`）整套删除，换成锚点固定的「生活行为导演」——招牌动作升级为常驻小动作（每皮肤 3 手 + 打盹），开关改名「桌面小动作」（键 `codex_hud_ambient`），右键改弹挂件自己的两项原生菜单。窗口尺寸、三款角色、悬停 160ms 展开、点角色钉住、点面板打开 Codex、拖动与落盘全部不变。下文 §3.8 / §3.9 / §4 / §5 / §6 里讲巡游、步态、绳长的段落留作历史，以该行说明为准。

> **2026-10-26 锁定行为已被 [24 号文档](./24-hud-locked-refresh.md) 替代**：锁定不再隐藏窗口、也不再冻结快照。挂件继续显示，主窗口的挂件服务改为按「配额自动刷新」间隔调用只读命令 `desko_hud_refresh_locked`，刷新当前账号额度与本机今日用量（0=不联网）；锁屏只拿渲染聚合值，账号、邮箱与凭据都不进前端。下文所有「锁定立即隐藏 / 不展示任何数据 / 解锁重亮相」的段落留作历史，以该行说明为准。

## 2026-10-22 交互走查修订

以下四点为本轮更新，替代后文历史验收中对应的旧行为；窗口尺寸与三款角色保持不变。

- 转身的 `scaleX` 只作用于 `.char`，`.walk` 仅负责位移；向左转身后展开的数据面板仍正向显示。
- `prefers-reduced-motion: reduce` 同时停止巡游、步态和角色动画，并监听系统偏好实时变化；悬停、点击固定、打开 Codex 和手动拖动照常可用。停止巡游不改用户设置或保存的锚点。
- 固定面板后在角色右上显示图钉，取消固定或重新亮相后撤销。
- 异常时收起态也保留告警角标。展开面板的第三行优先说明原因（额度偏低 / 已用尽 / 暂不可用 / 刷新失败并使用缓存），金额留在该行的悬停说明；状态恢复后自动回到金额行。刷新失败优先说明缓存事实，防止把旧额度当成实时余额。

> 2026-10-22 视觉结论：兔子（双耳 = 两档额度）、企鹅（肚皮 = 主额度）、蜗牛（螺壳 = 主额度）三款都保留，设置里可选；不做页内常驻挂件，桌面小窗是唯一生产入口；设置页用 1× 实际大小预览。
>
> 2026-10-22 第二轮：默认只画角色，数据面板点击后才出现；面板字号整体上调，窗口随展开/收起切换高度。
> 2026-10-22 第三轮：文字再精简（去掉常显的 `>` 提示符与 `Codex ↗` 文案，只留异常态 `!` 和右下角 `↗`），字号再上一档（主额度 18px、今日 token 15px、金额 14px），颜色收成两级（标签 `--text-secondary`、数字 `--text`，不再用 `--text-muted`）；面板 128×79，展开窗口 136×149。
> 2026-10-22 第四轮：展开改成 hover（160ms 停留）与点击双入口，点角色只是钉住；指针离窗即收起。角色屏幕位置全程不动——窗口只在高度方向长，`reserve_height()` 始终按展开高度做落位与 work area 夹取。
> 2026-10-22 第五轮：兔子去扁（角色框 112×54 → 112×66，长耳 + 圆头 + 胸口 + 前爪，窗口随之 136×74 / 136×149）；加待机动作——三皮肤眨眼（错峰 5.6s / 6.7s / 4.9s）+ 兔耳抽动（7.3s），由 `idle` prop 只在桌面窗口挂载，设置页预览仍静止，`prefers-reduced-motion` 全关。
> 2026-10-22 第六轮：用户要「让它动起来」，四档全要。动作按 transform 分层重做（`.figure` 呼吸/摇摆 → `.act` 触发位移 → 耳摆 → 耳抽 → 眼眨，蜗牛另加触角摆），拆成 `idle`（常驻）与 `react`（触发）两道闸门，设置页预览也传 `idle` 所以三款同步呼吸；桌面展开那一下小跳、点角色那一下眨眼。另加「真走动」：绕锚点系绳巡游 ±48px，偏移永不落盘，鼠标靠近即停（§3.8）；设置里新增「桌面走动」开关。
> 2026-10-22 第七轮：面板文案与排版重排。第二行去掉 `今日` 标签（第二、三行本来就只放当日汇总，这两个字是重复信息，只留在可访问名称里）；额度标签统一成拉丁短标（`周` → `w`、`天` → `d`，和 `5h` / `2w` 同族，读屏侧由 `hudWindowAria` 展开成「周额度」「5 小时额度」）；字号整体降一档（主额度 18 → 16、token 15 → 13、金额 14 → 12、标签 12 → 11）；排列改成两栏——数值靠左、`tok` 与 `↗` 贴右缘成一条辅助列，行高 18 / 15 / 13、行距 6 / 4，面板随之 128×79 → 128×74、展开窗口 136×149 → 136×144。单位 `tok` 常显，未扫描时仍是 `— tok`。
> 2026-10-22 第八轮：第七轮那套「数值靠左、单位靠右」的真两栏被**真机数据**推翻——用户账号只有周窗口（第一行只剩 `w 20%`）、今日才 `9.76亿`，`margin-left:auto` 把 `tok` / `↗` 甩到右缘后，三行中间各留 40px 以上空洞，看着像没排完。改成**居中读数栈**：三行都以面板中线为轴，`tok` 紧贴数字（3px）、`↗` 回到第三行行内（4px），两档额度之间留 4px 组距。几何一毫米没动（面板 128×74 / 窗口 136×144），纯 CSS。顺带补一个真空洞：`state.today` 为 null 时第三行原本只剩一颗 `↗` 飘在中间，现在写 `未定价`。
> 2026-10-22 第九轮：**取消挂件上的右键隐藏**，改在**系统托盘菜单加一颗「桌面额度挂件」勾选项**（`CheckMenuItem`，位置在「锁定」与「退出」之间）。托盘只发 `tray-hud-toggle` 意图，翻转与落盘仍走主窗口的 `saveHudEnabled()`——开关的真相只有一个；勾选态由前端用新命令 `desko_hud_set_tray` 回写，写的是 `codex_hud_enabled` 而不是窗口可见性，所以锁屏隐藏不会把勾吃掉。`desko_hud_request_close` 命令与 HUD 侧 `@contextmenu` 一并删除；Alt+F4 / 系统关闭请求保留（走窗口 `CloseRequested`，不经那颗命令）。两处补丁记账：tauri 2.12.2 **没有** `menu_item_by_id` 之类的按 ID 查项，所以句柄必须自己留在 managed state（`HudTrayItem`）里；勾选项首帧就得是真值——挂件桥要解锁后才激活，等它回写会让整个锁屏期间显示成「关」，因此建菜单时直接读 `meta("codex_hud_enabled")`（`get_meta` 是明文表，锁着也能读；读不到回落 `false`）。
> 2026-10-22 第十轮：**走动改成相位锁定**。第六轮那套「一拍整窗跳一个 `stride`、角色始终居中」被指「走动这个效果目前很差」——窗口每拍瞬移，角色从没走过路。换成 **跨步 → 跟位 → 落地停** 三段一拍：角色先在窗口内用 `glide` 毫秒滑出 `stride`（`.walk` 一条 translate3d），滑到位那一帧在同一个 JS 任务里 `setPosition` 把窗口挪走同样的量、同时把 lane 以 `ms:0` 归零，屏幕坐标因此连续（接手前后 `x + lane` 恒等）；随后 `hold` 停一拍。步态重定：单步 5/3/2 → **6/4/3px**，一拍 1400/2100/3100ms → **glide 340/420/620 + hold 210/260/340**；绳长 ±48px、认领令牌、偏移不落盘、有人在就不走全部照旧。走到绳头不再硬挤，先压扁（`scaleX(.84)`，`turnMs` 240/240/160）转身。另加一拍「张望」，每隔 4 步不跟位。
> 2026-10-22 第十一轮：**「张望」和三只共用的那套步态全删，换成按皮肤的专属动作**。用户反馈「我觉得效果不好，我们可以针对这几种类型，做不同的效果，比如说兔子鞠躬，卷耳朵；企鹅摆动翅膀等等」，拍板范围三条：走动保留（相位锁定不动）、每只 3 个动作按 9 个进码、事件三条里先只做见底那一条。落地为 **常驻步子 3 条 + 招牌动作 6 条**：兔子蹲跳降档（身子压 −1.5px / +1px、scaleY .98 / .96）、企鹅摇摆步（±3.6° 绕底边中点）、蜗牛伸脖子（`.mv-body` 前移 2px / 回缩 −.5px，壳不动），每拍都挂，由 `gait-a`/`gait-b` 一对 **transition** 承担而不是无限循环 keyframes——同奇偶的 class 同时驱动落脚与身子，天生同相；招牌动作 **鞠躬 / 卷耳朵 / 摆翅膀 / 伸脖子 / 触角打结 / 缩壳** 是一次性 keyframes，由根节点 `mv-*` class 触发，插在节拍间隙每 3–5 拍抽一个（`MOVE_GAPS=[3,4,5]`，按计数器轮转，不掷骰子）。时长同源：JS 收尾用 `HUD_MOVE_MS[id]`、CSS 用 `--mv-dur`，两处读同一张表，不会动画还没放完就被摘 class。见底/失败那一下只在**状态跳变**且**窗已亮着**时放，按皮肤映射（兔 → 卷耳朵、企鹅 → 摆翅膀、蜗牛 → 缩壳），首次快照与解锁重亮相只对齐基线不重放。`prefers-reduced-motion` 分两道闸门：招牌动作在 JS 里根本不放，常驻步子走的是 transition、`animation: none` 管不到它，得在 CSS 里单独把 `.mv-fig` / `.mv-body` 的 transition 与 transform 收掉。

## 1. 现状实测

| 问题 | 证据 |
|---|---|
| 额度只在 Codex 页活着，离开就断 | 定时器随页面起停：`codexState.ts:291-292` 的注释写明「离开即停」，`startQuotaTicker` / `stopQuotaTicker` 在 `codexState.ts:356-377`；页面在 `CodexModule.vue:373-402` 进出时启停 |
| 没有第二个窗口 | `tauri.conf.json:13-26` 只声明 `main`；`capabilities/default.json:5` 也只授权 `main` |
| 没有挂件可消费的快照 | 账号、额度、用量都住在主窗口 Pinia/模块级 ref（`codexState.ts:41-44`、`:811-821`），锁定即清（`codexState.ts:103-153`）；主窗口一隐藏，没有别的东西能把数推给桌面 |
| 今日用量已经能算，但只在用量页按需扫 | `loadUsage()` 现扫官方 rollout，`codexState.ts:986-1025`；扫描范围是全机本地会话，不按账号切分，金额在 `api/codex.ts:209-220` 里允许为 `null` |
| 设置页没有挂件入口 | Codex 设置只有配额自动刷新、配额预警两行（`CodexSettings.vue:388-414`）；`settings.rs:57` 的 `ALLOWED_KEYS` 里也没有挂件键 |
| 视觉还停留在样张，没有组件 | 拍板样张在 `.tmp/codex-hud-20261021/`，仓库内没有 sprite 组件；三款皮肤目前只有 mock 的 SVG |
| 主题和字体可以复用，但 HUD 需要独立入口 | 字体内置在 `global.css:97-100`；工作区主题靠 `data-layout="workspace"` + `data-theme/base/accent/atmosphere`（`theme.ts:145-148`）。HUD 若直接复用主窗口壳，会把 1040×670 的布局带过去 |
| Codex 命令有模块 + 解锁闸门 | `main.rs:89-106` 的 `authorize_codex`；`is_codex_command` 按 `codex_` 前缀/`_codex_` 段匹配（`main.rs:74-87`）。挂件窗口的控制命令不能叫 `codex_hud_*`，否则锁定/关闭时会被闸门挡住 |

## 2. 产品形态

- **桌面 only**：不往已经拥挤的 Codex 页塞第二枚 hero；生产入口只有桌面小窗。设置页只放 1× 展开态预览和开关。
- **收起只露角色**：常驻时只占 136×74，动物本身就是额度表；不弹通知、不抢焦点，动作只有低频微动（呼吸/摆耳/眨眼）、绕锚点的小范围巡游（§3.8）和它自己走路时的步子与招牌动作（§3.9）。
- **停一下才看数**：鼠标停在角色上即向下展开数据面板（主次额度 / 今日 token / 金额），移开就收起；想常驻读数点一下角色钉住。面板里的数据不常驻视线。
- **三款皮肤同一个面板**：身体换轮廓和填充位置，面板版式固定为三行；读者不会因为换皮肤而重新学一遍数据。
- **默认关**：新模块进设置总开关，默认 `false`；打开后常驻右下角，可拖走。

实际尺寸（窗口 136×74 收起 / 136×144 展开；四周 4px 透明内边距；角色 112×66；面板 128×74 从角色内 y62（绝对 y66）开始，与角色下缘重叠 4px，兔子前爪正好搭在面板上沿）：

```
收起                              展开
┌──────────────────┐            ┌──────────────────┐
│    ╭─╮      ╭─╮   │            │    ╭─╮      ╭─╮   │  角色 112×66
│    │ │╲    ╱│ │   │            │    │ │╲    ╱│ │   │  （长耳 y4.6→31
│    ╰─╯ ╰──╯ ╰─╯   │            │    ╰─╯ ╰──╯ ╰─╯   │   圆头 y26→59.5
│      ╰──╮╭──╯     │            │      ╰──╮╭──╯     │   前爪 cy64）
└──────────────────┘            │  ┌─┴─────┴─────┐  │  面板 128×74 @ 绝对 y66
                                │  │ ! 5h 68% w 42% │ │
                                │  │ 194.2万    tok   │ │
                                │  │ ≈$12.34       ↗ │  │
                                │  └───────────────┘  │
                                └──────────────────┘
```

面板不显示账号、邮箱、会话标题、cwd 或路径；额度是当前账号的百分比，今日用量是本机全部账号的汇总（见 §5.1 的口径说明）。

## 3. 规格

### 3.1 尺寸与骨架

| 部件 | 规格 |
|---|---|
| 窗口 | 收起 136×74 / 展开 136×144 逻辑像素；宽度取 Windows 最小跟踪宽度，按 `width:100%` 铺满并让 128 内容居中（左右 4px 透明带）；透明，无边框、无窗口阴影 |
| 角色 | 112×66，水平居中、顶边 4px；z-index 3；`pointer-events:none`，点击交给整窗 |
| 面板 | 128×74，绝对顶边 66px（角色内 y62，与角色下缘重叠 4px）；z-index 2；内边距 `8px`，内宽 110；1px 边框，4px 圆角 |
| 第一行 | 高 18px；警示符（仅异常时）/ 主额度标签 / 主百分比 / 次额度标签 / 次百分比 / 光标，间距 4px |
| 第二行 | 高 15px，上距 6px；token 靠左、`tok` 贴右缘，与第三行的 `↗` 成一条辅助列 |
| 第三行 | 高 13px，上距 4px；金额靠左、`↗` 贴右缘 |
| 命中区 | 整个客户区（收起 136×74，展开 136×144）；透明边也吃指针，避免「看得见点不到」 |
| 缩放 | 逻辑尺寸固定，跟随系统 DPI；125% 下实际 170×92.5 / 170×180，不做第二套字号 |
| 画布 | 角色 SVG `viewBox="0 0 112 66"`；整块 sprite 收起 128×66、展开 128×136（多出的 70px = 面板 74 − 重叠 4），窗口高度 = sprite + 上下 4px |

窗口透明，页面 `html/body/#app` 必须覆盖成 `background: transparent; overflow: hidden`，否则 `global.css` 的画布底色会让小窗变成一块实心板。

窗口高度随展开态在两个值之间切换，由 `desko_hud_set_expanded` 同步设置；不靠 CSS 撑窗口。展开时若窗口底边超出当前显示器 work area，Rust 把整体上提到贴住底边，角色不会带着面板沉到屏幕外。

### 3.2 主题与色板

面板跟随应用当前主题与强调色；角色是固定配色的吉祥物，不随主题反相：

| 角色 | 纸 / 墨 | 用途 |
|---|---|---|
| 面板底 | `--panel-bg` | 面板的面 |
| 面板线 | `--border` | 1px 边 |
| 主文字 | `--text` | 主/次百分比、token、金额 |
| 次文字 | `--text-secondary` | 额度标签、`tok`、占位文案 |
| 强调 | `--accent` | 警示符、光标、`↗`、额度填充；跟随用户强调色 |
| 低额度 | `#e08079` / `#b85a52` | 主额度填充 / 描边，固定色，保证三套皮肤一致 |
| 角色亮面 | `#f6f2e7` | 兔子、企鹅、蜗牛的奶油身体 |
| 角色暗线 | `#24262b` | 1.2px 轮廓；墨色下企鹅帽/鳍加 `color-mix(in srgb, var(--text) 38%, #24262b)` 的 0.7px 内缘 |
| 腮红 | `--danger` 20% | 三款共用 |
| 喙 / 脚 | `--warning` | 企鹅 |
| 次额度耳 | 纸 `accent 66% + #f6f2e7`，墨 `accent 68% + #24262b` | 兔子右耳；比主耳浅，不抢主额度 |

- 不使用用量页的净输入蓝 / 缓存绿 / 输出橙：挂件只有「额度 + 今日总量」，没有分类编码，借数据色会被读成某一段。
- 低额度只换主额度填充和描边；次额度保持强调色，不一起报警。
- 面板底、字色、边框全部走现有主题令牌；不新增主题槽，也不跟随 `--workspace-accent-source` 之外的色板。
- HUD 入口设置 `data-layout="workspace"`，导入 `global.css` + `workspace-themes.css`；不导入 `web.css` / 布局壳。首帧快照到达前窗口保持隐藏，避免纸/墨闪一帧。

### 3.3 字体与字阶

字体栈继承应用：`--font-ui`（HarmonyOS Sans SC 优先）、`--font-mono`（Consolas 优先）。HUD 不额外 `document.fonts.load`，因为 `global.css` 已经内置字体；窗口显示前等一次 `document.fonts.ready`，超时也照常显示。

| 元素 | 字号 / 字重 |
|---|---|
| 警示符 `!` | 11 / 700，等宽；只在低额度或刷新失败时出现，正常态不占位 |
| 主额度标签、次额度标签 | 11 / 400，UI 字体 |
| 主额度百分比 | 16 / 600，等宽，`letter-spacing:-.02em` |
| 次额度百分比 | 12 / 600，等宽 |
| 光标 | 2×11，强调色；低额度/刷新失败时跟随警示色 |
| token | 13 / 600，等宽 |
| `tok` | 10 / 400，等宽；紧贴数字右侧 3px |
| 金额 | 12 / 600，等宽 |
| `↗` | 11 / 400，强调色；跟在金额右侧 4px，同一居中组；只作「点这里打开 Codex」的可见提示，不单独绑事件 |

- **三行一律居中**（`justify-content:center`）：面板 110px 内宽，真实值往往只用掉一半，靠两端撑开的排法会在行中间留下大片空洞。居中让三行共轴，单位贴住自己的数字。
- 面板内 `white-space:nowrap`；第一行按真实窗口标签（`5h` / `w`）排版，两个 `100%` 也落在 110px 内宽里；占位文案超长时省略号。
- 百分比是整数；主额度是面板里的视觉锚点，16px 仍比收起态的角色更先被读到。
- 数字一律 `--text`、标签一律 `--text-secondary`：面板只有两级层次，不再往 `--text-muted` 掉一档，小字号下第三档读不出来。
- token 走 `formatTokenCount`（`codexUsage.ts:15-19`），金额走 `formatHudCost`；两者都是短串，三行固定高不会因数据变化跳动。
- 第二、三行不加标签：面板的第二行永远是 token、第三行永远是金额，`tok` 与 `≈$` 已经自解释，`今日` 只在可访问名称里保留。最宽实值（`9,876.5万 tok` / `≈$999.99`）实测在 110px 内宽里不裁切。

### 3.4 三款皮肤

三款共用 112×66 的角色框、奶油身体、深色轮廓、腮红和「不画大白眼」的规则；只换外形和主额度载体。次额度在兔子上是右耳，在企鹅/蜗牛上只在展开面板里显示。

| 皮肤 | 主额度载体 | 次额度 | 表情 / 识别点 | 空态 |
|---|---|---|---|---|
| 兔子（默认） | 左耳内耳填充，从耳根 `y30` 长到耳尖 `y4`（行程 26，`y = 30 − 26×p`） | 右耳，同几何，颜色更浅 | 长耳 + 圆头（`y26→59.5`）、闭眼、腮红、胡须、胸口，两只前爪 `cy64` 搭在面板上沿 | 整只虚线轮廓，五官和填充隐藏 |
| 企鹅 | 肚皮椭圆 `cx56 cy48 rx16 ry12`，填充顶边 `60 − 24×p`，波浪边 | 只在展开面板里 | 奶油蛋形身体（`y5→63`）、深色帽/鳍、点眼 `cy27`、橙喙橙脚、腮红 | 虚线蛋形，帽/鳍/喙/脚隐藏 |
| 蜗牛 | 螺壳圆 `cx51 cy25 r21.5`（整组下沉 10，绝对 `cy35`），填充顶边 `46.4 − 42.8×p`，螺旋线固定 | 只在展开面板里 | 奶油足/头、眼柄圆点眼带高光、微笑、腮红 | 虚线壳和足，眼柄/螺旋隐藏 |

- 低额度：主载体填充 `#e08079`、描边 `#b85a52`；第一行前面多出 `!`（danger），光标同色。次额度不变。
- 空态：只留虚线轮廓，不画半透明假数据；展开面板的第一行写占位文案，第二行用量照常显示。
- 无入场、无面板滑入/淡入；展开/收起只改窗口高度。角色有常驻微动、触发小动作与走路时的步子 / 招牌动作（见 §3.7、§3.9），跳的是角色不是面板；面板自己永远不滑入、不淡入、不位移。
- 几何以拍板样张为准；实现时拆成 `bunny` / `penguin` / `snail` 三组 path，共用 `.tag`。不改 112×66 的头身框；面板字号是 HUD 专属档，不回灌主界面。

### 3.5 状态矩阵

| 状态 | 判定 | 角色 | 展开面板 |
|---|---|---|---|
| 收起（默认） | `expanded=false` | 按额度填充 | 不渲染，窗口 136×74 |
| 展开 | 指针停在角色上 160ms，或点角色钉住 | 同上，被面板压住 4px | 三行数据，窗口 136×144 |
| 正常 | 有主额度，主百分比 ≥10 | 主填充强调色 | `5h 68% w 42%` + `194.2万 tok` + `≈$12.34` |
| 低额度 | 主百分比 0–9，或周额度用尽带动主额度为 0 | 主填充珊瑚色，第一行前加 `!` | 百分比照常显示；aria 写明「额度偏低」 |
| 刷新失败有缓存 | `quota_error` 存在，但仍有可读额度 | 保持上次填充 | 第一行前加 `!`（warning），不抹掉数据；不显示原始错误串 |
| 只有一档 | 没有次额度（常见于没有周窗口） | 兔子右耳留空；企鹅/蜗牛无变化 | 只显示主额度，光标紧跟主百分比 |
| 无 5 小时窗口 | `codexQuotaWindows` 只返回周/天 | 周/天升级为主额度 | 标签用 `w` / `d`，不伪造 `5h` |
| 只有额外窗口 | 标准窗口为空，`additional_rate_limits` 有值 | 第一扇额外窗口兜底为主额度 | 标签 `额外`；完整名称只在 aria |
| 只有 Credits | 无标准/额外窗口，Credits 有百分比或不限额 | 主额度显示 Credits | `Credits 40%`；不限额显示 `∞`（填充 100%） |
| 待授权 | `authorization_status === pending` | 虚线剪影 | 第一行 `待授权` |
| API Key 无额度 | `auth_mode === apikey` 且无可读服务额度 | 虚线剪影 | 第一行 `按量计费` |
| 无账号 | 账号列表为空，或没有当前账号 | 虚线剪影 | 第一行 `暂无账号` |
| 暂无额度 | 账号正常但没有可读窗口 | 虚线剪影 | 第一行 `暂无额度` |
| 获取失败且无缓存 | `quota_error` 且没有可读额度 | 虚线剪影 | 第一行 `额度获取失败`，前面加 `!`（warning） |
| 今日未扫描 | `today === null` | 不变化 | 第二行 `— tok`（单位照留，别只剩一个孤零零的破折号），第三行金额隐藏 |
| 金额未定价 | `estimatedCostUsd === null` | 不变化 | 第三行 `未定价` |
| 深色 | `data-theme="ink"` | 角色不变，面板换墨色令牌 | 同版式 |
| 挂件关闭 / 模块关闭 | 设置关或 Codex 模块关 | 无窗口 | —— |
| 锁定 | 应用锁定 | 窗口保留 | 继续展示并刷新当前账号额度与今日用量（见 24 号文档） |

占位文案的优先级：`获取失败且无缓存` > `待授权` > `API Key 无额度` > `无账号` > `暂无额度`。有缓存时永远优先显示缓存 + `!`，不退回剪影；`!` 只由异常态决定，正常态第一行不放任何符号。

### 3.6 交互

- **悬停角色**：指针进入角色区停留 160ms 即向下展开面板，窗口变 136×144，角色同时小跳一下（§3.7）；主窗口不动、不抢焦点。掠过（<160ms）不弹——伸手去点桌面图标时不该被挂件拦住视线。
- **移开鼠标**：未钉住时指针离开整窗即收起，窗口回 136×74。角色位置在展开/收起这一步永远不动，所以展开不会把指针从角色上甩走（见下条；绕锚巡游是另一回事，见 §3.8）。
- **左键点角色**：钉住/取消钉住，同时眨一下作为回应（§3.7）。钉住后移开鼠标面板仍保留；取消时若指针已不在窗口内立刻收起。
- **左键点面板**：先解钉收起，再打开主窗口并跳到 Codex 账号页；如果主窗口已在用量/会话/回收站页，切回账号页。面板右下角的 `↗` 只是这条动作的可见提示，不单独绑事件。
- **拖动**：按下后移动超过 4px 才 `startDragging()`；不到 4px 算点击。拖动由窗口的 `Moved` 事件判定（`startDragging` 之后页面未必还收得到 `pointerup`），150ms 没有新的移动才算拖完；拖动中不展开，若正展开则先收起（钉住态不动），拖完指针仍在角色上才重新计时展开。
- **底边预留，角色不动**：定位与拖动钳制一律按展开高度 144 预留下探空间，`desko_hud_set_expanded` 只改高度不改坐标。早期版本在展开溢出时把整窗上提，收起后又留在被上提的位置——每展开一次角色就永久上移 75px，改成点击时看不出，改成悬停就是抖动回路，故删除。巡游（§3.8）改的是这一轮窗口的实时位置，落盘位置仍是被放置的那一点。
- **托盘开关**：系统托盘菜单里的「桌面额度挂件」勾选项与设置页那颗开关同源。点它只发 `tray-hud-toggle`，主窗口的挂件桥翻转 `codex_hud_enabled` 并落盘，窗口随之显示/销毁；勾选态再由 `desko_hud_set_tray` 回写。建菜单时先读一次设置真值当首帧，不等解锁后的回写。应用锁定时挂件桥仍在监听，点托盘照样开关挂件；关掉即销毁窗口并停掉锁定轮询（见 24 号文档）。
- **不做右键**：第九轮删掉。收起态只有 136×74，右键既没有可见菜单、又和「点角色钉住」抢同一颗指针，隐藏改由托盘与设置页承担。
- **Alt+F4 / 系统关闭请求**：隐藏挂件并把 `codex_hud_enabled` 置 false（设置里的开关同步关），由窗口 `CloseRequested` 拦截后发 `codex-hud:request-close`；不销毁后假装还在。
- **不做双击**：双击会连触两次展开/收起，没有额外语义；也不做「双击隐藏」。
- **不抢焦点**：数据刷新、皮肤/主题变化、展开/收起、解锁恢复都只推状态或改窗口尺寸，不 `set_focus`；只有用户点面板才把焦点交给主窗口。
- **无悬浮 tooltip**：收起窗口只有 136×74，浮层会被裁；交互提示写在设置组描述里（见 §4.2），可访问名称放在根节点 `aria-label`。
- **无点击穿透**：整窗可点；不提供「鼠标穿透」选项。

### 3.7 动作：常驻微动 + 触发动作

角色不能是死的，但常驻小件不能抢注意力。全部是纯 CSS transform，不碰数据、不碰面板的出现方式。分层是硬约束：**同一元素挂两条 transform 动画只会互相覆盖**，所以一层一个 `<g>`。从外到内三皮肤共用 `.figure` → `.act`，再往下各自分叉（`.mv-*` 是第十一轮为走路新开的动作槽，见 §3.9；谁也不占谁的 transform）：

| 皮肤 | 从 `.act` 往内的链 |
|---|---|
| 兔 | `.mv-fig` →（`.mv-head` →（`.ear-l` → `.mv-ear-l` → `.ear-flick`）、（`.ear-r` → `.mv-ear-r` → `.ear-flick`）、`.head`、`.mug` → `.eyes`）+ `.paw-a` `.paw-b` |
| 企鹅 | `.mv-fig` →（`.flip-l` `.flip-r`、`.foot-a` `.foot-b`、身体 / 肚皮、`.eyes`） |
| 蜗牛 | `translate(0,10)` →（`.mv-body` →（`.antennae` → `.stalk-l` / `.stalk-r`，柄尖各带一组 `.eyes`）、`.mv-shell`） |

蜗牛的眼睛长在两根触角上，所以 `.eyes` 在蜗牛是 2 个节点、另两款各 1 个；鞠躬要「头沉」，兔的耳 + 头 + 五官必须先在 `.mv-head` 里成一组，耳朵自己再各留一层给卷耳朵。

| 层 | 动作 | 周期 | 幅度 | 闸门 |
|---|---|---|---|---|
| `.figure` | 呼吸（兔 / 蜗牛：`translateY(-1.2px)` + `scale(1.008)`）、左右摇摆（企鹅 ±1.6°，轴在底边中点） | 3.4s / 企鹅 2.9s / 蜗牛 4.6s | 亚像素，看不见在动、停下来的时候能察觉 | `idle` |
| `.ear-l` `.ear-r` `.antennae` | 耳摆 / 蜗牛触角摆：−2.8° → +2.4°，轴在耳根与触角根（`transform-origin: 86% 100%` / `14% 100%`） | 3.1s，右耳 `animation-delay:-1.6s`，触角 3.8s | ≤ 2.8° | `idle` |
| `.ear-flick` | 兔耳抽动：以耳根为轴 −7°，回弹 +2.5° | 7.3s，右耳 `animation-delay:-3.9s` | 大部分时间停在 0%，关键帧 62% / 74% 才是抽动窗口 | `idle` |
| `.eyes` | 眨眼 `scaleY(.06)`（`transform-box: fill-box` + `transform-origin: center`） | 兔 5.6s / 企鹅 6.7s / 蜗牛 4.9s（故意错峰） | 一次快眨 + 一次半途眨 | `idle` |
| `.act` | 展开那一下小跳：−3.4px → +0.7px → −1.2px → 0 | 0.62s，单次 | 只跳一次，不循环 | `react` + `expanded` |
| `.eyes`（poke） | 点角色那一下眨眼 `hud-wink`（`scaleY(.06)`） | 0.48s，单次 | 覆盖同元素的眨眼循环（`.sprite.react.poke` 特异性更高） | `react` + `poke` |

- **两道闸门各自独立**：`idle` 管常驻微动，桌面窗口和设置页预览都传；`react` 管交互触发，只有桌面窗口传——预览不可交互，不该伪装成可点，也不该在预览里替用户跳一下。`poke` 由 `CodexHudApp.vue` 在点角色后拉高 520ms 再落。
- **触发不改面板的出现方式**：面板仍然不滑入、不淡入（无入场动画的约束照旧），跳的是角色这一层 `.act`，不是 `.tag`。
- **`prefers-reduced-motion: reduce`**：`.figure` / `.eyes` / `.ear-l` / `.ear-r` / `.ear-flick` / `.antennae` / `.act` 一律 `animation: none`；招牌动作在 JS 里就被挡掉，连 `mv-*` 的 class 都不挂；常驻步子走的是 transition，`animation: none` 管不到它，CSS 里另收一道（`.mv-fig` / `.mv-body` 的 `transition: none` + gait class 下 `transform: none`）。系统级降低动效偏好优先于我们的审美选择。落脚（`.paw-*` / `.foot-*`）和 lane 不在这条里——它们属于「桌面走动」那颗用户开关，关掉偏好不该把走动也停了。
- **额度填充跟着耳朵一起转**：`clipPath` 坐标在被引用元素的用户空间里解析，所以耳组旋转时内耳裁剪同步走，不会出现填充溢出耳廓或边缘脱离描边。
- 微动层周期都 ≥ 2.9s、幅度 ≤ 2.8°，确保「不主动看就注意不到」；触发层是单次、小于 0.65s 的反馈，只在用户自己引发的手势上出现。走路那两层（步子与招牌动作）幅度更大，但它只在「桌面走动」开着且在走时出现，站定就归零（§3.9）。

### 3.8 巡游（绕锚点走动）

用户要「真走动」，但「你把它放在哪，它就在哪」这条硬约束不能松。解法是系绳：走的是**围绕锚点的临时偏移**，不是位置本身。

第十轮把「一拍瞬移」改成**相位锁定的一拍三段**——角色在窗口里滑，滑到位那一帧窗口才接手，屏幕坐标全程连续：

| 段 | 谁在动 | 怎么做 |
|---|---|---|
| 跨步 `glide` | 角色 | `.walk` 一条 `translate3d(lane,…)`，配 `cubic-bezier(.22,.61,.36,1)` 滑出 `stride`；同时挂 `lift-a`/`lift-b` 抬对应那只脚、`gait-a`/`gait-b` 压身子（§3.9） |
| 跟位 | 窗口 | `endStride()` 在**同一个 JS 任务**里 `setPosition(锚点 + 偏移 + lane×scale)`、挂 `expectedMove` 令牌，并把 lane 以 `ms:0` 瞬时归零。接手前后 `x + lane` 恒等，角色不会被「闪」过去 |
| 落地停 `hold` | 两者 | 窗口停在新位、角色回到窗口中心，落脚与步子 class 清成中性；这一拍末尾由 `afterHold()` 决定下一手（继续迈步 / 抽招牌动作） |

| 步态 | 兔子 | 企鹅 | 蜗牛 |
|---|---|---|---|
| 单步 `stride` | 6px | 4px | 3px |
| 跨步 `glide` | 340ms | 420ms | 620ms |
| 落地停 `hold` | 210ms | 260ms | 340ms |
| 一拍合计 | 550ms | 680ms | 960ms |
| 转身 `turnMs` | 240ms（先压 108ms） | 240ms | 160ms |
| 常驻步子 | 蹲跳降档 | 摇摆步 | 伸脖子 |

- **锚点 = 用户放的那一点**：挂载与每次 reveal 后 `reanchor()` 读 `outerPosition()`，之后每拍都是 `anchor + offset`；只有真拖动才更新锚点。
- **撞绳头先压扁再转身**：`|offset + dir×stride| > 绳长` 时不走这一步，改 `beginTurn()`——`scaleX(.84)` + 抬起 0.5px（占 `turnMs` 的 45%），下一半时间翻面回正。兔和企鹅左右几乎对称，光翻面看不出掉了头，挤压那一下才是「掉头」的记号。
- **被挡住就原地收车道**：`settleWalk()` 用 180ms 把 lane/bob/face 收回中性，窗口停在它当前所在的那一点，不强行送回锚点；`scheduleWalk()` 按一拍长度空转重试，指针一走自然接上。
- **绳长 ±48 逻辑像素**（按 `scaleFactor()` 换算成物理像素），撞到绳头自动掉头。撞到屏幕边被 Rust 夹回时，`claimWalkMove` 按实际落点重算偏移并立即掉头，不会继续往墙里挤。
- **巡游的 `Moved` 不是拖动**：每次 `setPosition` 前挂一个 `expectedMove` 认领令牌，250ms 内有效。命中 → 不 `markDragging`、不写 `codex_hud_save_position`、不动锚点；没命中 → 视为用户意图，重新锚点。指针按下时直接清空令牌：手已经搭上来了，之后的任何移动都算用户拖。
  - 认领窗口从 800ms 收到 250ms 是有意的：太长会把紧随其后的真拖动 `Moved` 也吞掉，用户会觉得自己没拖动成功。
- **有人在就不走**：展开中、钉住中、正在拖、指针在窗内、按下未起的 `armed`，以及碰过它之后 1.5s 冷却期内，一律原地不动。
- **偏移永不落盘**：只活在当前窗口生命周期里；`codex_hud_position` 记录的始终是锚点。锁定隐藏后重新亮相、重开挂件都从锚点重新开始。
- **关掉走动会送回锚点**：`walk: false` 的快照一到，若当前偏移非 0，就把它 `setPosition` 回锚点再停——不丢在巡游半路上。锚点来源标志 `anchored` 未置真（`outerPosition()` 没读到）时不动窗，避免把挂件甩到 (0,0)。
- **开关**：设置 → Codex → 桌面挂件组里的「桌面走动」，默认开，键 `codex_hud_walk`；关掉后仍保留皮肤选择与总开关语义。
- 需要 Rust 侧放行：`core:window:allow-set-position` 不在 `core:default` 里，缺它时 `setPosition` 被 capability 拒绝，而走动是静默 catch 的——现象就是「代码全对、单测全绿、窗口一动不动」。

### 3.9 按皮肤的专属动作（9 条）

第十一轮的拍板：走动保留，每只 3 个动作，事件三条先接一条。三只不许共用同一套肢体语言——企鹅靠摇摆步、兔子靠压身子、蜗牛靠脖子，走路的样子本身就是皮肤识别点。

**常驻步子（3 条，每拍都挂）**：一对 class `gait-a` / `gait-b` + `--gait-ms`，走的是 **transition**，不是无限循环 keyframes。

| 皮肤 | 动的层 | a 档 | b 档 | 时长 | 为什么这么动 |
|---|---|---|---|---|---|
| 兔 | `.mv-fig` | `translateY(-1.5px) scaleY(.98)` | `translateY(1px) scaleY(.96)` | 跟该拍的 glide / hold | 蹲跳降档：窗内只有 12px 横向余量，跳不起来，就压身子 |
| 企鹅 | `.mv-fig` | `rotate(3.6deg)` | `rotate(-3.6deg)` | 同上 | 摇摆步：轴在底边中点，企鹅的识别点就是左右倒 |
| 蜗牛 | `.mv-body` | `translateX(2px)` | `translateX(-.5px)` | 同上 | 身体在刚体壳下面蠕动，`.mv-shell` 恒不动 |

**招牌动作（6 条，一次性 keyframes）**：根节点挂 `mv-<id>`，时长由 `--mv-dur` 给。

| 动作 | 皮肤 | 时长 | 动的层 | 关键幅度 | 用在哪 |
|---|---|---|---|---|---|
| 鞠躬 `bow` | 兔 | 1150ms | `.mv-fig` `.mv-head` `.mug` `.mv-ear-l` `.mv-ear-r` | 头沉 1px、五官在头里再下滑 3.4px、双耳 ±14° | 节拍间隙 |
| 卷耳朵 `fold` | 兔 | 1350ms | `.mv-fig` `.mv-ear-l` `.mv-ear-r` | 右耳绕耳根 `rotate(56deg) scaleY(.88)` 整组折过去（额度条跟着折），身子 −1.6° 配平 | 节拍间隙 + 见底告警 |
| 摆翅膀 `flap` | 企鹅 | 900ms | `.mv-fig` `.flip-l` `.flip-r` | 两鳍反相 ±30° / ±28°，鳍尖甩出身体轮廓之外；身子 ±2.4° 做配平 | 节拍间隙 + 见底告警 |
| 伸脖子 `stretch` | 蜗牛 | 1600ms | `.mv-body` `.stalk-l` `.stalk-r` | 身体绕尾根右移 5px + `scaleX(1.02)`，触角 ±9° 超前一点 | 节拍间隙 |
| 触角打结 `tangle` | 蜗牛 | 1400ms | `.mv-body` `.stalk-l` `.stalk-r` | 两触角对倒 ±30° 在中间交叠，身子退 1px | 节拍间隙 |
| 缩壳 `tuck` | 蜗牛 | 1900ms | `.mv-body` `.mv-shell` `.stalk-l` `.stalk-r` | 头退回 −4.5px + `scaleX(.98)`、触角压平 −46° / +42°、壳 `scaleY(.98)` 紧一下，缩住停在 42%–72% 再探出来 | 见底告警 |

- **正视图的「低头」只有这一种画法**：鞠躬时头的轮廓自己不能动（动了人就散），沉的是 `.mv-head`（1px）+ 五官所在的 `.mug`（再 3.4px），耳朵被 `.mv-head` 一起带走。卷耳朵折的是耳朵整组，所以耳根之上的额度填充条跟着一起折，不会出现「耳皮动了、水位没动」。
- **调度只有一个落点**：`afterHold()`（落地停那一拍）。优先级是 事件 > 节拍间隙招牌 > 每拍步子；放动作的那一拍不迈步，`after(HUD_MOVE_MS[pick], beginBeat)` 接着走。
- **间隔与顺序都不掷骰子**：`MOVE_GAPS = [3, 4, 5]` 配 `HUD_IDLE_MOVES`（兔 `bow`→`fold`、企鹅 `flap`、蜗牛 `stretch`→`tangle`），由 `moveTurn` 计数器轮转，第几拍放哪一手能数出来，单测才断言得动。企鹅池子只有那一手是刻意的：它的鳍已经在摇摆步里用了，再来一手会打架。
- **同一个动作连放两次不会重启动画**：`playMove()` 先摘 class、`await nextTick()`，再挂回去。
- **时长同源**：JS 收尾用 `HUD_MOVE_MS[id]`、CSS 用 `--mv-dur`，两处读 `src/utils/codexHud.ts` 同一张表；写两遍必然漂，漂了就是动画还没放完被摘 class。`--gait-ms` 同理，直接喂当拍的 glide / hold。
- **步子用 transition 而不是 keyframes**：JS 的计时器是节拍的主人，keyframes 自己走时间轴迟早漂拍，漂了就变成「腿在动、身子不动」。a/b 两个目标由同一个 `walkStrides % 2` 驱动，落脚（`lift-*`）与步子（`gait-*`）天生同相。
- **招牌动作只在「没人管它」时抽**：`canMove()` = 非 reduce 且未展开、未钉住、未在拖、指针不在窗内、没有按下未起的 `armed`。人在看的时候不许表演。
- **见底那一下挂在 `applyPayload` 的状态边界，不是 watch**：`alert = severe || stale || placeholderAlert`，只在 `alert && !wasAlert`、且 `revealed`（窗已经亮着）、且非 reduce 时放；`wasAlert` 每次快照都重新对齐，所以首次快照、解锁后重亮相、重开挂件都只同步基线，不补演一遍缩壳。动作按 `HUD_ALERT_MOVES` 分皮肤（兔 `fold` / 企鹅 `flap` / 蜗牛 `tuck`）——缩壳那两层（`.mv-shell` + 触角）只长在蜗牛身上，拿去当三款共用的告警动作等于给企鹅兔子演一个没有零件的动作。
- **另两条事件按拍板先不进码**：蹲跳（展开面板）、展鳍（刷新成功）的 keyframes 没写，`.act` 上已有的展开小跳 `hud-hop` 保留不动。
- **reduce 下分两道闸门**：招牌动作由 JS 挡（连 class 都不挂）；常驻步子走 transition，`animation: none` 管不到它，CSS 里单独把 `.mv-fig` / `.mv-body` 收成 `transition: none` + `transform: none`。lane 与落脚仍跟着节拍走——那是「桌面走动」那颗用户开关的事。

## 4. 设置

### 4.1 位置

在 `CodexSettings.vue` 的配额预警行之后、模板收尾之前插入「桌面挂件」组（`CodexSettings.vue:388-414` 之后）。设置页只在 Codex 模块启用时出现（`SettingsDialog.vue:277-281`），所以不需要在组内再处理「模块已关」。

### 4.2 版面

```
桌面挂件                                          [开关]
在桌面常驻一枚 Codex 额度角色。
鼠标停在角色上即展开额度与今日用量，移开收起；点角色可钉住展开，
点面板打开 Codex；拖拽移动位置；系统托盘菜单里有同一颗开关。

桌面走动                                          [开关]
角色绕着你放的位置小范围慢走，左右各 48px。鼠标一靠近就停；
记录下来的位置仍是你放置的那一处。

皮肤
┌──────────┐  ┌──────────┐  ┌──────────┐
│  兔子     │  │  企鹅     │  │  蜗牛     │   1× 实际大小
│ 136×144  │  │ 136×144  │  │ 136×144  │   （展开态）
└──────────┘  └──────────┘  └──────────┘
兔子 · 双耳显示两档额度
企鹅 · 肚皮显示主额度
蜗牛 · 螺壳显示主额度

预览为展开态示例数据 · 实际大小；额度取当前账号，今日用量为本机全部账号汇总。
```

- 开关：复用现有 `.switch` 模式（`global.css:1968-1992`），两行两颗——「桌面额度挂件」默认关，「桌面走动」默认开（只在总开关之下才有意义，但两颗各自独立持久化）；保存失败回滚并 toast。
- 皮肤：三张 `role="radio"` 的卡片，136×144 展开态预览 + 名称 + 一行职责；选中用 1px 强调色边 + 右上角 check，不用整卡填充。卡片始终可点，开关关着也能先选皮肤。
- 预览固定为展开态，直接展示面板字号；真实小窗默认收起，点角色才展开。预览用固定示例快照（68% / 42% / 194.2万 tok / ≈$12.34），保证三款在无账号时也能比较。组描述写明「预览为展开态示例数据 · 实际大小」，不把示例数字伪装成真实额度。
- 预览跟随设置弹窗当前主题/强调色；不画入场动画，不做 hover 放大；预览传 `idle` 不传 `react`，所以三款皮肤在设置里一起呼吸眨眼，但不会替用户跳（见 §3.7）。三张卡的周期各不相同（3.4s / 2.9s / 4.6s），起手同相、跑起来自然错开，不会同步成一片闪。
- 当 `quotaRefreshMinutes === 0` 时，在组尾加一行 warning：`配额自动刷新已关闭，挂件额度不会自动更新。` 不新增「挂件专用刷新」开关。
- Web 运行时整组 `v-if="!isWebRuntime()"` 隐藏，和额外统计目录一致。

### 4.3 持久化

| 键 | 取值 | 默认 | 说明 |
|---|---|---|---|
| `codex_hud_enabled` | `"true"` / `"false"` | `false` | 挂件总开关；加进 `settings.rs:57` 的 `ALLOWED_KEYS` |
| `codex_hud_skin` | `"bunny"` / `"penguin"` / `"snail"` | `"bunny"` | 非法值读回时回落兔子；加进 `ALLOWED_KEYS` |
| `codex_hud_walk` | `"true"` / `"false"` | `true` | 巡游开关；同样进 `ALLOWED_KEYS`。缺键按开处理，老档案不迁移 |
| `codex_hud_position` | `{"x":123,"y":456}` | 无 | 物理像素；只由 `desko_hud_save_position` 写，不进 `set_setting` 白名单。巡游偏移不参与持久化，写进去的永远是锚点 |

- 不复用上游 `floating_card_*` 配置（`config.rs:201-302` 那组字段是上游浮动卡自己的形状，desko 的 UI 从未读写它）；挂件设置只走 desko 的 DB meta，避免两个真相源。
- 位置不是用户偏好，失败/缺失就回右下角；不写进 WEB_PREFERENCES（Web 运行时没有挂件）。

## 5. 数据与实现

### 5.1 快照

主窗口负责算，HUD 只负责画。新增一份可序列化的最小快照，不把 `CodexAccount` 整个扔过去：

```ts
type CodexHudSkin = 'bunny' | 'penguin' | 'snail'

interface CodexHudWindow {
  label: string            // 5h / w / d / 额度 / 额外 / Credits
  percentage: number       // 0–100，填充电量用
  unlimited?: boolean      // Credits 不限额：填 100%，文字 ∞
}

interface CodexHudState {
  skin: CodexHudSkin
  theme: {
    theme: string          // paper / ink
    base: 'light' | 'dark'
    accent: string
    atmosphere: boolean
  }
  primary: CodexHudWindow | null
  secondary: CodexHudWindow | null
  placeholder: string | null   // 非空 = 虚线剪影 + 文案
  severe: boolean              // 主额度 0–9 或 blockedBy
  stale: boolean               // 有缓存但刷新失败
  today: { tokens: number; costUsd: number | null } | null
  updatedAt: number | null     // 额度快照时间，仅用于 aria，不上屏
}
```

取值顺序：

1. 当前账号 = `currentAccount`（`codexState.ts:78-80`）；没有当前账号 → `placeholder='暂无账号'`。
2. 标准窗口 = `codexQuotaWindows(account)`（`codexQuota.ts:63-87`）：`primary=[0]`，`secondary=[1]`。
3. 标准窗口为空时，取 `codexAdditionalQuotaWindows(account)[0]` 作 primary（`codexQuota.ts:89-114`），label 固定 `额外`。
4. 还没有时，取 Credits：有百分比或不限额才作 primary（`codexQuota.ts:116-135`），label `Credits`；只有余额没有百分比 → 继续走占位。
5. 仍没有 → 按 §3.5 的优先级给 `placeholder`。
6. `severe = primary.percentage <= 9`，或原窗口的 `blockedBy` 非空；`stale = !!account.quota_error` 且 primary 存在。

标签压缩：

| 来源 | 面板上 |
|---|---|
| 5 小时窗口（300 分钟） | `5h` |
| 其他小时窗口 | `${n}h` |
| 周窗口（10080 分钟） | `w` |
| 多周窗口 | `${n}w` |
| 天窗口（1440 分钟） | `d` |
| 多天窗口 | `${n}d` |
| 分钟窗口 | `${n}m` |
| API Key 的 `服务额度` | `额度` |
| 额外窗口 | `额外` |
| Credits | `Credits` |

实现放在 `codexHud.ts` 的 `hudQuotaLabel(window, account)`，用窗口 id + `account.quota.*_window_minutes` / raw 值判断，不去解析中文 label 串。

今日用量：

- 取 `usageToday` 的 `totals.totalTokens` 与 `totals.estimatedCostUsd`；`formatTokenCount` 处理万/亿，金额用紧凑函数：
  - `null` → `未定价`
  - `0` → `≈$0`
  - `< 0.01` → 3 位小数（`≈$0.004`）
  - `< 100` → 2 位小数（`≈$12.34`）
  - `< 1000` → 2 位小数
  - `≥ 1000` → `≈$1.2k`
- `today === null` 时第二行 `— tok`，不显示金额。
- 口径：官方用量扫描不按账号切分（`loadUsage()` 扫的是本机 rollout），所以「今日」是**全部本地账号的汇总**；面板上不写标签（第二、三行本来就只放当日汇总），口径只在设置组描述与可访问名称里写明「额度取当前账号，今日用量为本机全部账号汇总」。如果必须做当前账号口径，需要 codex-core 在扫描时带账号归属，本轮不做。

隐私：快照不含 `email`、`account_name`、`account_id`、`cwd`、会话标题、文件路径或原始 `quota_error.message`；只保留百分比、标签、今日聚合 token/金额和更新时间。

### 5.2 调度

- **配额定时器改成全应用引用计数**：`startQuotaTicker` / `stopQuotaTicker` 换成 `acquireQuotaTicker(owner)` / `releaseQuotaTicker(owner)`，owner 至少 `'codex-page'` 与 `'codex-hud'`。页面进出只 acquire/release 自己那份；HUD 开着时主窗口不在 Codex 页也继续跑。间隔仍由 `codex_quota_auto_refresh_minutes` 控制，0 不起定时器。
- `syncQuotaTicker` 在设置改间隔时按新值重启；`clearCodexSession` 锁定路径清空 owner 集合、停表。
- **今日用量**：新增 `usageToday` ref 与 `loadTodayUsage()`，10 分钟缓存。优先复用 `usageWindowCache.get('today')`（用量页刚扫过就直接用）；缓存新鲜就不重扫；`usageBusy` 时复用缓存，绝不并发起第二份扫描。HUD 激活时先拉一次，之后独立 10 分钟 tick。
- **进页/激活首刷**：复用 `refreshQuotasOnEnter()` 的 60s 闸门（`codexState.ts:177-181`），HUD 激活时在账号列表就绪后静默补一次配额；`quotaRefreshMinutes === 0` 时不打网络，只显示库里的缓存，设置页给 warning。
- **主窗口隐藏时的节流**：定时器住在主窗口 WebView；主窗口收进托盘后 Chromium 可能把 10 分钟 tick 推迟到分钟级。接受这个代价，不为此把主窗口设成 `backgroundThrottling: disabled`，也不引入 Rust 侧配额定时器（会复制一套 codex-core 调用）。挂件显示的额度最多晚一分钟，可接受。
- **锁定时**：HUD 保留，普通 ticker 仍释放；改由锁定 ticker 按同一间隔（0=关）调 `desko_hud_refresh_locked` 刷新当前账号与今日用量，解锁后停锁定 ticker、重新 acquire 并立即刷一轮。见 24 号文档。

### 5.3 窗口

| 选项 | 值 | 原因 |
|---|---|---|
| label | `codex-hud` | 事件定向、capability 单独授权 |
| size | 收起 136×74 / 展开 136×144 逻辑（内容居中） | §3.1 |
| `transparent` | true | 桌面角色 |
| `decorations` | false | 无标题栏 |
| `shadow` | false | 面板/角色自带阴影，窗口矩形阴影会露馅 |
| `resizable` | false | 固定尺寸 |
| `skipTaskbar` | true | 不占任务栏 |
| `alwaysOnTop` | true | 桌面常驻；不做开关 |
| `visible` | false 创建，首帧快照后 show | 不闪空白 |
| `focus` | false | 创建/刷新不抢焦点 |
| `noRedirectionBitmap` | true（Windows） | 透明窗白闪兜底 |
| URL | `hud.html` | 独立 Vite 入口，不加载主窗口壳 |

- 创建必须在主线程：`run_on_main_thread` 里 `WebviewWindowBuilder`，不要在 worker 上建 WebView（上游浮动卡实现里已有同样的约束）。
- 默认位置：主显示器 work area 右下角，留 24px 逻辑边距；work area 自动避开任务栏。
- 位置保存：HUD 的 `onMoved` 防抖 300ms，调 `desko_hud_save_position(x, y)` 写物理坐标；巡游自己造成的 `Moved` 先被 `expectedMove` 认领掉，进不到这条防抖里，所以落盘的一直是锚点。
- 位置恢复：`monitor_from_point(saved)` 找不到显示器（拔屏/改 DPI）就回默认右下角；找到则把整窗夹进该显示器 work area。
- 展开/收起：HUD 调 `desko_hud_set_expanded(expanded)`；Rust 只对 `set_size` 换 136×74 / 136×144，不改坐标——左上角不动，角色就不动。下探空间在落位时就备好：`reserve_height()`（定位、恢复、拖动钳制都走它）一律按展开高度 × scale 预留，`WindowEvent::Moved` 期间也按同一高度把窗口夹回 work area，所以展开永远不会溢出底边。
- `expanded` 不持久化：重开挂件、隐藏后重建、锁定后重新亮相都从收起态开始；用户点开只影响这一次视线。`desko_hud_reveal` 在 show 前把窗口缩回收起高度，HUD 收到 `reveal` 时同步把 `expanded` 置 false。
- 关闭请求：Rust 拦截 HUD 的 `CloseRequested`，`prevent_close` + hide + 通知主窗口把开关置 false；不留下「窗口没了但开关还开着」。
- 退出：应用退出时窗口随进程销毁；不需要额外清理。
- 不把 HUD 加进 `tauri.conf.json` 的 `windows`：它是运行期按需创建的，配置里没有 `create:false` 也能保证首启不出现。

### 5.4 IPC 与入口

数据单向：主窗口算快照 → Tauri event → HUD 画；HUD 不 import `codexState`、不直调任何 `codex_*` 命令。

| 方向 | 名称 | 用途 |
|---|---|---|
| main → hud | `codex-hud:state` | `{ state, reveal, walk }`：完整 `CodexHudState` 快照 + 是否走首帧显示握手 + 巡游开关（缺省按允许处理） |
| hud → main | `codex-hud:ready` | HUD 挂载完成，请推首帧 |
| hud → main | `codex-hud:request-close` | 窗口关闭请求（Alt+F4），主窗口落 `enabled=false` |
| tray → main | `tray-hud-toggle` | 托盘勾选项被点：只发意图，翻转与落盘由挂件桥做 |
| main → rust | `desko_hud_show` / `desko_hud_hide` / `desko_hud_destroy` | 窗口生命周期 |
| hud → rust | `desko_hud_reveal` | 字体与两帧绘制落定后 show；锁定态同样显示（数据走只读刷新，24 号文档） |
| main → rust | `desko_hud_set_tray` | 把 `codex_hud_enabled` 的最新值回写到托盘勾选项（第九轮） |
| hud → rust | `desko_hud_save_position` | 防抖保存物理位置 |
| hud → rust | `desko_hud_open_codex` | 显示主窗口并跳到账号页 |
| hud → rust | `desko_hud_set_expanded` | 展开/收起：只把窗口高度换成 136×144 / 136×74，坐标不动；底边余量由 `reserve_height` 在落位与拖动钳制时预留 |
| rust → main | `codex-hud:open` | 主窗口收到后 `router.push('/codex')` + 请求账号页签 |

- 命令统一用 `desko_hud_*`，不要用 `codex_hud_*`：后者会被 `is_codex_command` 的 `codex_` 前缀命中（`main.rs:74-87`），锁定/关闭时反而被授权闸门挡住。窗口命令只做窗口控制；唯一的数据命令是 `desko_hud_refresh_locked`，锁定态只回额度/今日用量的渲染子集，不含账号、邮箱或凭据（见 24 号文档）。
- 首次显示握手：主窗口先注册监听 → 创建隐藏窗口 → HUD `ready` → 主窗口推 `state` → HUD 推完首帧后 show；`state` 需缓存最后一份，后续更新直接推。今日扫描可以晚到，先显示账号/额度，`today` 到位再推一次。
- 新增 `src-tauri/capabilities/hud.json`：`windows: ["codex-hud"]`，权限 `core:default` + `core:window:allow-start-dragging`；不需要 shell/dialog/fs。
- Vite 多页：根目录加 `hud.html`，`vite.config.ts` 的 `build.rollupOptions.input` 加 `hud`；`src/hud.ts` 只挂 Vue + HUD 组件，不装 Pinia/router。
- `runtime.ts` 补 `isTauriRuntime()`（`__TAURI_INTERNALS__` 是否存在）；e2e 的 mock 环境返回 false，设置页仍能测开关/皮肤，但不会去建原生窗口。
- 挂件关闭时 `desko_hud_destroy` 销毁 WebView，释放那份额外内存；重新开启再创建。开关默认关，所以没开的人不付这份 WebView2 成本。

### 5.5 生命周期

| 时刻 | 行为 |
|---|---|
| 启动，已解锁，开关开，模块开 | 加载设置 → 账号/额度 → 创建隐藏 HUD → 推首帧 → show；今日扫描后台补 |
| 启动，锁屏 | 按开关创建并显示；首轮数据回来前占位「应用已锁定」，随后只读刷新当前账号与今日用量（24 号文档） |
| 锁定 | 窗口保留（先于清密钥）；普通 ticker/今日扫描释放，启动锁定 ticker：立即调 `desko_hud_refresh_locked`，之后按配额自动刷新间隔轮询；0=不联网 |
| 解锁 | 停锁定 ticker；重新加载账号/额度（不清空设置），推新快照；窗口已在则不重建 |
| 开关关 | 立即 hide + destroy，release，停锁定 ticker |
| Codex 模块关 | 立即 hide + destroy，release，停锁定 ticker；模块再开时按开关恢复 |
| 主窗口收进托盘 | HUD 保持显示；定时器允许被 WebView 节流 |
| 皮肤/主题/强调色变化 | 只推 `state`，不重建窗口、不抢焦点 |
| Alt+F4 / 系统关闭 | hide，`codex_hud_enabled=false`，设置开关与托盘勾选同步关 |
| 托盘勾选项 | 翻转 `codex_hud_enabled`（与设置页同一落盘路径），窗口随之显示/销毁 |
| 应用退出 | 窗口随进程销毁 |

实现上，`App.vue` 在解锁/启动完成后 `activateCodexHudBridge()`；锁定流程一开始 `suspendCodexHudData()`（保留窗口、切到锁定 ticker），退出或页面卸载才 `deactivateCodexHudBridge()`。bridge 监听 `moduleFlags.codex` 和 `hudEnabled`，自己负责 show/destroy。这样模块重开也能恢复，不必等重启。

窗口活在 Rust 侧，页面重载（开发期 HMR 整页刷新也算）会让主窗口回到锁定态而挂件仍可见；启动判定为非解锁时走 `activateCodexHudBridge(false)`，窗口按开关保留并只读刷新。同理，`loadHudSettings()` 读回带版本闸门：读盘期间用户点过开关（`saveHudEnabled`/`saveHudSkin` 推进版本）就丢弃这次旧值，否则慢一步的读回会把刚关掉的挂件重新点亮。

### 5.6 改动清单

| 文件 | 改动 |
|---|---|
| `src/services/codexHud.ts` | 新增：设置读写、快照映射、bridge、定时器/位置/窗口命令；`hudWalk` ref + `saveHudWalk()`，payload 带 `walk` |
| `src/utils/codexHud.ts` | 第十一轮新增动作表：`CodexHudMove`、`HUD_MOVE_MS`（6 条时长，唯一真相源，CSS `--mv-dur` 与 JS 收尾都读它）、`HUD_IDLE_MOVES`（兔 bow/fold、企鹅 flap、蜗牛 stretch/tangle）、`HUD_ALERT_MOVES`（兔 fold、企鹅 flap、蜗牛 tuck） |
| `src/components/codex/hud/CodexHudSprite.vue` | 新增：三皮肤 sprite（112×66 角色框 + 可展开的三行面板 128×74）；角色按 transform 分层（`.figure` / `.act` / `.ear-*` / `.ear-flick` / `.antennae` / `.eyes`），`idle` 常驻微动 + `react` / `poke` 触发动作。第十一轮再加动作槽一层（`.mv-fig` `.mv-head` `.mug` `.mv-ear-l/r` `.mv-body` `.mv-shell` `.stalk-l/r` `.flip-l/r`）+ props `gait` / `gait-ms` / `move`（替掉原 `looking` 张望）：3 条 gait transition、6 组招牌 keyframes（21 条触发规则 + 21 条 keyframes），reduce 下另收 `.mv-fig` / `.mv-body` 的 transition |
| `src/components/codex/hud/CodexHudApp.vue` | 新增：HUD 根组件、事件监听、悬停展开/移开收起/点击钉住、拖动/点击（第九轮删掉右键隐藏）；绕锚点系绳巡游（步态表 + `expectedMove` 认领 + 冷却 + 关掉送回锚点）与点击眨眼 `poke`。第十轮把巡游改成相位锁定一拍三段（`beginBeat` → `endStride` 同任务里 `setPosition` + lane 归零 → `afterHold`，`WALK_GAIT` 6/4/3px、glide 340/420/620、hold 210/260/340、转身压扁 `WALK_TURN_SQUASH`）；第十一轮加调度（`MOVE_GAPS=[3,4,5]` + `moveTurn` 轮转、`canMove()` 闸门、`playMove`/`cancelMove` 摘挂 class）与 `applyPayload` 状态边界的告警动作（`wasAlert` 只记基线）；`reducedMotion` 在 setup 读一次 `matchMedia` |
| `src/components/codex/hud/CodexHudApp.test.ts` | 新增：手势状态机单测（掠过不弹、停留展开、移开收起、钉住/解钉、点面板开 Codex、拖动抑制与补展开）+ 巡游单测（步长离锚、系绳掉头、钉住/冷却/走动感停、巡游 Moved 不落盘、真拖动重锚、关掉送回锚点）。第十轮：滑到位那一帧才跟位、接手前后屏幕位置连续（`x + lane` 恒等）、跟位不落盘；第十一轮：招牌动作落在节拍间隙且那一下不跟位、按池子轮转出 `['mv-bow','mv-fold']`、步子与落脚同奇偶（`gait-a`/`--gait-ms:340ms` → 中性/`210ms` → `gait-b` + `lift-b`）、刚见底那一下只缩一次同一状态不重放、窗还没亮不放告警、reduce 不放招牌动作但走动照旧、换皮肤换一手（企鹅只有 `mv-flap`） |
| `src/hud.ts` / `hud.html` / `vite.config.ts` | 新增 HUD 入口；Vite 多页 input |
| `src/modules/settings/CodexSettings.vue` | 新增「桌面挂件」组：总开关、走动开关、三张 1× 展开态皮肤卡（预览传 `idle`）、0 刷新 warning |
| `src/services/codexState.ts` | 配额 ticker 引用计数；`usageToday` / `loadTodayUsage` |
| `src/components/codex/CodexModule.vue` | 改用 acquire/release；监听账号页请求 |
| `src/App.vue` | 挂件 bridge 激活/失活；非解锁态兜底 `hideStaleHud()`；`codex-hud:open` 路由与账号页切换 |
| `src/services/runtime.ts` | 新增 `isTauriRuntime()` |
| `src-tauri/src/commands/hud.rs` / `commands/mod.rs` / `main.rs` | 新增窗口命令与主线程创建；定位/拖动钳制按展开高度预留底边（`reserve_height` + `Moved` 夹回），展开只改高度不改坐标；关闭拦截。第九轮：托盘菜单加 `CheckMenuItem("hud")`（初始勾选态在建菜单时读 `meta("codex_hud_enabled")`，锁屏期间也已是真值；句柄存 `HudTrayItem` managed state，因 tauri 2.12.2 无按 ID 查项），点它只 `emit_to("main","tray-hud-toggle")`，新命令 `desko_hud_set_tray` 回写勾选态；删 `desko_hud_request_close` |
| `src-tauri/capabilities/hud.json` | HUD 窗口最小权限：`core:default` + `core:window:allow-start-dragging` + `core:window:allow-set-position`（巡游要 `setPosition`；这条不在 `core:default` 里，缺它前端会被静默拒绝） |
| `src-tauri/src/commands/settings.rs` | `ALLOWED_KEYS` 加三个挂件键 |
| `e2e/mocks/backend.ts` | `SETTINGS_ALLOWED_KEYS` 同步加 `codex_hud_walk`——mock 的白名单和 Rust 是两份，漏一条就是「点开关没反应、开关弹回原值」，只有真跑 e2e 才暴露 |
| `e2e/specs/codex-hud-settings.spec.ts` | 新增设置页冒烟：默认关、三卡、选皮肤持久化、走动开关持久化与读回、0 刷新 warning；皮肤框 144、sprite 136 |
| `src/utils/codexHud.test.ts` | 新增快照/标签/紧凑金额/隐私字段反查 |
| `src/services/codexHud.test.ts` | 新增：读回不得盖掉用户刚写的开关 |
| `src/components/codex/hud/CodexHudSprite.test.ts` | 三皮肤、空态、低额度、无次额度、112×66 几何与 transform 分层（每层各一 `<g>`、`.act` 嵌在 `.figure` 内、蜗牛触角组）、`idle` / `react` 两道闸门互不越权；面板文案第二行逐字 `194.2万tok`（不含 `今日`）、未扫描 `— tok`。第十一轮：`.mv-fig` / `.mv-body` 每款各 1 且 `.mv-shell` 与 `.mv-body` 分家、`.ear-l` → `.mv-ear-l` → `.ear-flick` 三层、`.mv-head` 含 `.mug`、企鹅两鳍、蜗牛两组 `.eyes`；`gait-a` + `--gait-ms` 交得出落脚与步子同层、6 个招牌动作只交出一个 `mv-*` class 且 `--mv-dur` 逐条等于 `HUD_MOVE_MS[id]`、未挂动作时不留任何 `mv-*` |
| `src/services/__tests__/codexState.test.ts` | 适配引用计数 ticker；今日缓存单测 |
| `src/stores/auth.ts` / `src/components/auth/SetupPage.vue` | 首启链路修复：`setupMasterPassword` 收 `onSetup` 回调，在 `appState` 翻转前触发；原先 `emit('setupComplete')` 落在卸载之后，`bootModules()` 从不执行，挂件 bridge 首次启动后一直不激活 |

`tauri.conf.json` 不改（HUD 由代码创建）；`public/fonts` 不改；不新增依赖。

## 6. 测试与验收

1. `vue-tsc --noEmit` 0 error；`vitest run` 全绿。
2. 单测覆盖：快照优先级（无 5h → 周；额外 → 兜底；Credits → 兜底；pending/apikey/empty/error）、标签压缩、金额紧凑、低额度阈值、无次额度、隐私字段反查（`email|account_name|cwd|session|path`）、ticker 引用计数（两个 owner 释放一个仍跑、全释放即停、0 分钟不起）、今日缓存 10 分钟与并发保护；sprite 几何（`CodexHudSprite.test.ts`）覆盖 112×66 viewBox、眼睛层按款计数（兔 / 企鹅各 1 组、蜗牛 2 组挂两根触角尖）、兔子两组耳 + 耳抽动层 + 主耳填充位置、蜗牛触角组与 `.mv-body` / `.mv-shell` 分家，以及 `idle` / `react` 两道闸门各自独立；手势（`CodexHudApp.test.ts`）覆盖掠过不弹 / 160ms 展开 / 移开收起 / 点角色钉住与解钉 / 点面板开 Codex 并解钉 / 拖动中不展开且拖完补展开 / 右键不再有任何请求（第九轮删掉右键隐藏单测），并断言每次展开/收起落到 `desko_hud_set_expanded` 的 true/false 序列；巡游覆盖首步离开锚点且偏移不落盘、连续采样始终夹在锚点 ±48px 且撞绳那一下压扁掉头（`scaleX(.84)`）、钉住即停、1.5s 冷却、指针进窗那半拍收回来、巡游 `Moved` 被认领不改锚点、真拖动重锚后绕新锚走、`walk:false` 停在原地、走到半路关掉送回锚点；第十一轮的动作调度（节拍间隙抽招牌且那一下不跟位、池子轮转出 `['mv-bow','mv-fold']`、步子与落脚同奇偶、告警只在刚跌进告警那一次、窗未亮不放、reduce 不放招牌但走动照旧、换皮肤换一手＝企鹅只有 `mv-flap`）与 sprite 分层契约（每个动作交出的 `mv-*` 层集合、`--mv-dur` 逐条等于 `HUD_MOVE_MS[id]`、未挂动作时不留任何 `mv-*`）。HUD 两套 17 + 21 用例，全量 61 文件 / 702 用例绿。
3. `PW_CHANNEL=msedge npx playwright test e2e/specs/codex-hud-settings.spec.ts`：默认关；三张皮肤卡；兔子默认；选企鹅后重载仍是企鹅；开关持久化；`quotaRefreshMinutes=0` 出现 warning；设置页截图确认三张 136×144 展开态预览不裁切、不溢出。
4. 原生窗口无法用 Playwright 断言，必须真机 `npm run tauri dev` 验收：
   - 透明无白闪；不在任务栏；始终置顶；数据刷新不抢焦点。
   - 默认 136×74 只露角色；鼠标停在角色上展开到 136×144 且主窗口不动；移开鼠标收起；点角色钉住后移开不收起，再点解钉；面板不滑入、不淡入。
   - 展开/收起全程角色的屏幕坐标不变（同一位置反复 hover 十次，窗口 `outer_position` 不得漂移）；贴在屏幕底边时面板完整可见。
   - 全新档案走完首启两屏后，直接在设置里打开开关就要能出窗：这条覆盖 `bootModules` 是否真的在首启链路里跑过。
   - 点面板打开账号页（在用量页时也切回账号），挂件同时收起解钉；拖动跟手且拖动过程中不展开；右键不再有隐藏动作（窗口保持显示、开关不变）；Alt+F4 隐藏且开关同步关、托盘勾选同步取消；双击没有额外动作。第九轮原生取证：真指针右键与派发 `contextmenu` 两次都是 `visible=true setting=true`，且 `invoke('desko_hud_request_close')` 返回 `Command ... not found`（命令确实从后端摘掉）。（右键菜单已被 23 号轮重做：恢复「挂件设置… / 隐藏挂件」两项，以 23 号文档 §2.8 为准。）
   - 托盘「桌面额度挂件」勾选项：点一下 → `codex_hud_enabled` 落盘取反、窗口出现/销毁、设置页那颗开关同步；勾选态跟着设置走，锁屏隐藏期间勾选不得被取消。第九轮原生取证（隔离档案 `com.desko.hudtest`，事件用 `emit_to` 模拟托盘点击）：`set_tray ok` → 点一下 `setting=false visible="none"` → 再点 `setting=true visible=true`；重启到锁屏时建菜单读回的勾选态为 `true`（临时 `eprintln` 取证后已删）。锁定后点托盘仍能开关：关→窗口销毁并停锁定轮询，开→重建并立即刷新（24 号文档；旧「锁定空操作」取证作废）。
   - 默认右下角：角色距底边 24px + 70px 面板预留，即窗口顶边距底边 168px；往下拖会在预留位停住（invisible floor，角色不会跑到面板放不下的高度）；拖到副屏、重启、拔屏后位置仍在 work area 内；100%/125%/150% 缩放。
   - 锁定后窗口保留并继续刷新（立即一轮 + 按配额自动刷新间隔轮询），解锁后恢复常规刷新；额度自动刷新为 0 时锁定不联网。旧「锁定立即消失」验收随 24 号文档作废。
   - 主题/强调色切换立即生效；低额度 9% 珊瑚色 + `!`；无账号/待授权/API Key/无额度/刷新失败五种占位都能画。
   - 动作（原生 `getComputedStyle` / `getAnimations` 取证）：桌面窗口收起态 `.figure` = 呼吸（企鹅 waddle、蜗牛 4.6s）、`.eyes` = 眨眼、`.ear-l/.ear-r` = 耳摆、`.ear-flick` = 抽动、`.act` = none；hover 展开瞬间 `.act` 出现 `hud-hop`，点角色出现 `poke` 且 `.eyes` 从 `hud-blink` 换成 `hud-wink`；设置页三张预览 `idle=true / react=false`，`.figure` 与 `.eyes` 都有动画名，`.act` 恒为 none。9s 采样至少各命中一次：眨眼时眼睛高度压到 0.11px 级、`.ear-flick` 转角到 6.9°（探头要读 `.ear-flick`，读 `.ear-l` 只会量到 ≤2.8° 的耳摆，会把抽动误判成「没动」）；系统开启「减少动画效果」后常驻微动、触发动作与招牌动作全部归零（JS 根本不放 `mv-*` class，CSS 另收 `.mv-fig` / `.mv-body` 的 transition），但巡游的 lane 与落脚照旧——那颗是「桌面走动」用户开关，不在这个偏好里。
   - 巡游（原生 14s 采样 + 开关走真设置页）：窗口 `outer_position` 的 x 在锚点 ±48px 内逐拍移动、y 与尺寸恒为 136×74；整段期间 `codex_hud_position` 一字不变；指针停在角色上（展开）时 6 次采样同一个 x；在设置页点「桌面走动」关掉 → 窗口被送回锚点并停住（采样同一个 x 且等于落盘 x），再打开 → 恢复走动。缺 `core:window:allow-set-position` 时这套会「单测全绿、窗口一动不动」，capability 改动必须重编才生效。
   - 相位锁定与专属动作（第十一轮原生 CDP 取证，隔离档案 `com.desko.hudtest`，`.tmp/codex-hud-20261021/native-drive.mjs moves`）：三款各采 9s，`getComputedStyle` 的步子目标按拍交替（兔 `translateY(-1.5px) scaleY(.98)` ↔ `translateY(1px) scaleY(.96)`、企鹅 ±3.6° 旋转、蜗牛纯 `translateX`），`transitionDuration` 兔 0.18s/0.34s/0.21s、企鹅 0.42s/0.26s、蜗牛 0.62s/0.34s；**三款都满足 `liftTicks === gaitTicks`**（落脚次数与步子次数逐一相等 = 同拍的直接证据，也是这一轮唯一能证明「没有漂腿」的原生指标）。6 条招牌动作各冻到 50% 拍帧，命中的层与设计逐条对上（`bow` 5 层含 `.mug`、`fold` 3、`flap` 3、`stretch` 3、`tangle` 3、`tuck` 4 含 `.mv-shell`）；告警三款分别 `mv-fold` / `mv-flap` / `mv-tuck`。样张 `.tmp/codex-hud-20261021/R11-native-moves.png`（11 帧 5×）。
   - **（作废，见 23 号文档）一条待拍板的实测（不要当成已通过）**：停在默认右下角时（取证机 `x=1784`，1784 + 136 = 1920 正好贴住右缘），±48px 的绳长整段伸出屏外，几乎每拍都被 Rust 夹回、走的是 `beginTurn()` 那条路；而 `beginTurn()` 完成后直接回 `beginBeat()`，**不经过 `afterHold()`**——`afterHold()` 是唯一递减 `beatsToMove` 的地方。结果 45s 采样里一次招牌动作都没放，把锚点搬到屏中（900×520）后立刻恢复。要么让转身也过一次 `afterHold()`，要么绳长按 work area 收缩，二选一待拍板。—— 巡游已整体删除，绳长 / 屏缘 / `afterHold()` 都不存在了，这条不再需要拍板。
   - 冻帧采样踩坑：真机的服务快照会随时把 mock 推掉的空态盖回来，取证循环必须每 3s 重推一次 mock；出过一张「两只兔子空壳」的假帧，实为 stale frame（同一轮日志里 `cls=sprite idle react mv-bow ph=` 根本不是空态），重跑即正常——判据要看 class，不能只看 PNG。
5. 隐私：HUD 的 DOM、事件 payload、aria-label 均不出现账号邮箱、名称、会话标题、cwd、路径；原始 `quota_error.message` 不上 HUD。
6. 对比度：面板上标签文字在 `--panel-bg` 上 ≥4.5:1；低额度百分比不依赖颜色单独传达（第一行的 `!`）。
7. 视觉对拍：设置页三张 1× 展开态预览与原生展开小窗逐像素同尺寸；原生另拍收起/展开两张桌面截图，确认 136×74 角色与 136×144 面板的实际观感、字号与底边钳制。截图踩坑：Playwright 元素截图走 captureBeyondViewport，会重启动画时间轴，`animation-delay` 的胶片条在 PNG 里全落在 0%——要拍动作序列必须 `animation:none` + 内联 transform 冻住，或 `document.getAnimations()` 逐个 `currentTime` + `pause()`。

## 7. 拍板结论

| 决策 | 本轮建议 | 理由 |
|---|---|---|
| 皮肤范围 | **三款全保留**，设置里可选，兔子默认 | 用户已拍板；三款共用面板和尺寸，维护成本可控 |
| 生产入口 | **只做桌面小窗**，不做页内 sprite | Codex 页已有额度卡和用量图，再塞一枚会重复 |
| 默认状态 | **默认关** | 新模块先藏进设置总开关；不打扰没用的人 |
| 窗口尺寸 | **收起 136×74 / 展开 136×144**，4px 透明内边距，内容居中 | 收起时只留角色；宽度取 Windows 最小跟踪宽度，不再被系统改动 |
| 头身比例 | **角色框 112×54 → 112×66**，兔子改长耳（耳尖 y4.6）+ 圆头 + 胸口 + 前爪搭面板上沿 | 用户反馈「兔子有点扁」；把耳朵长度还给剪影，窗口上下各让出比例，面板与角色的重叠仍是 4px |
| 展开方式 | **悬停展开 / 移开收起，点角色钉住，点面板打开 Codex** | 用户要的是「hover 或点击就出现下面的内容」；悬停负责随手看，钉住负责常驻读数，两个手势不互相顶掉 |
| 角色位置 | **展开/收起/拖动全程不动**，定位按展开高度预留底边；巡游只改这一轮窗口的实时位置 | 上提避让会让角色每展开一次永久上移 75px；换成悬停就是「一动就甩走指针」的抖动回路。走动与「你放它就在哪」的冲突用系绳解开：锚点落盘、偏移不落盘 |
| 面板文字 | **只留数据**：去掉常显的 `>` 提示符与 `Codex ↗` 文案，第二行也不再写 `今日`，保留异常态 `!` 和右下角 `↗`；窗口标签一律拉丁（`5h` / `w` / `2w` / `d` / `45m`），第二行固定补 `tok` 单位 | 用户要求「文字要精简」；`>` 在正常态不携带信息，`Codex` 三字由 `↗` 与 aria 承担；`今日` 同理——第二行只能是 token、第三行只能是金额，这两个字是重复信息，只在 aria 里留给读屏。`周`→`w` 与 `2w` / `d` 同族，中文全称改由 `hudWindowAria()` 现算（「周额度 42%」），读屏不受影响 |
| 面板字号 | **主额度 16px / token 13px / 金额 12px / 次额度 12px**，标签 11px、`tok` 10px；标签一律 `--text-secondary`、数字一律 `--text`；第二行上距 6px、第三行 4px，行高 18/15/13 | 用户第七轮要求「文字稍微小点、排列修改一下」：字号整体降一档后行距重分，面板从 79 收到 74、窗口 144；`9,876.5万` + `≈$999.99` + `100%/100%` 极值仍不溢出（内宽 110px，三行无法合并到两行就是这个宽度定的） |
| 面板对齐 | **三行居中，单位贴住数字**：`.hud-row1/2/3` 一律 `justify-content:center`；`tok` 距数字 3px、`↗` 距金额 4px、两档额度间 4px | 第七轮的「数值靠左 + 单位靠右」在 mock 满值下好看，真机数据（只有周窗口、`9.76亿`）一上来三行中间各空 40px 被指「排版很差」。居中后共一条轴、无空洞，且单档/双档、短值/极值四种形态都不需要再调 |
| `today` 为 null | **第三行写 `未定价`，不只剩一颗 `↗`** | 居中排法下，空的 `.est` 会让 `↗` 单独飘在行中间；`costValue` 直接兜底 `未定价`，`.est` 不再 `v-if` |
| 置顶 | **固定置顶**，不做开关 | 桌面指示器的核心价值；设置里少一个选项 |
| 额度口径 | **当前账号** | 原始需求就是当前账号额度 |
| 今日口径 | **本机全部账号汇总** | 现有扫描不按账号切分；面板上不写标签（第二行只补 `tok` 单位），设置里明示；要当前账号口径需后端改造，另开一轮 |
| 未扫描 / 未定价 | **第二行仍写 `— tok`，第三行写「未扫描」或「未定价」** | 单位常显，避免空行被当成还没刷新 |
| 无 5 小时窗口 | **周/天升级为主额度** | 不硬编码 5 小时，也不留空 |
| 额外窗口 / Credits | **只兜底主额度，不占次额度** | 面板只有两个额度槽；完整名称放 aria |
| 低额度阈值 | **主额度 0–9%**，珊瑚色 + `!` | 与配额预警的 20% 阈值解耦；角色是视觉提示，不抢 toast 的语义 |
| 点击 / 拖动 | **左键角色钉住/解钉、左键面板打开账号页；>4px 才拖动** | 不做双击；悬停已经承担「看一眼」，点击只负责把它留下来 |
| 隐藏方式 | **托盘勾选项 / Alt+F4 / 设置开关**，无关闭钮、无右键 | 收起只有 136×74，没有位置放关闭钮；右键在第九轮被取消——没有可见菜单，还和「点角色钉住」抢同一颗指针 |
| 锁定 | **保留窗口并继续刷新当前账号额度与今日用量**（24 号文档） | 用户要求锁定后挂件数据也要更新；锁屏只拿渲染聚合值，不拿账号或凭据 |
| 主窗口隐藏 | **HUD 继续显示** | 桌面常驻是需求本身 |
| 刷新为 0 | **尊重设置，不偷偷联网**，设置页 warning | 用户关自动刷新就应该真的关 |
| 今日刷新 | **10 分钟本地扫描缓存** | 与配额网络解耦；不并发扫 |
| 动画 | **面板无入场/无滑入；角色分两层闸门**：`idle` 常驻（呼吸/摇摆 + 耳摆 + 抽动 + 眨眼，周期 2.9–7.3s），`react` 触发（展开小跳 0.62s、点角色眨眼 0.48s，只有桌面窗口传）；走路那几层见 §3.8/§3.9；`prefers-reduced-motion` 下微动与触发 `animation: none`、招牌动作 JS 侧直接不放、步子 CSS 侧收掉 transition | 用户反馈「还是静态的」「可以让它动起来吗」，四档全要。常驻层把幅度压到 ≤2.8°、亚像素级，主动看才注意得到；触发层只在用户自己引发的手势上给回应，面板本身照旧不滑入不淡入 |
| 设置页预览 | **传 `idle` 不传 `react`**，三款皮肤一起呼吸眨眼 | 用户要「预览也同步动」；但不传 `react`——预览不可交互，跳一下会把「可点」的假象带到设置里 |
| 巡游 | **绕锚点系绳 ±48px，默认开，可关**；有人在（展开/钉住/拖动/靠近/刚碰过）一律不走 | 「真走动」和「位置不动」正面冲突，解法不是二选一而是把两个概念拆开：用户放的是锚点，走的是临时偏移。关掉会送回锚点，不留在中途 |
| 走动节奏 | **相位锁定一拍三段**（角色窗内滑出 → 到位那一帧窗口接手同样的量 → 停一拍），步态 6/4/3px、glide 340/420/620ms、hold 210/260/340ms；撞绳头先 `scaleX(.84)` 压扁再转身 | 第六轮「一拍整窗跳 `stride`」被指「效果很差」：窗口每拍瞬移，角色从没走过路。跟位与 lane 归零放在同一个 JS 任务里，屏幕坐标才接得上（`x + lane` 恒等）；兔/企鹅左右几乎对称，光翻面看不出掉头，挤压那一下才是记号 |
| 动作按皮肤专属 | **9 条**：每只 1 条常驻步子（兔压身 / 企鹅摇摆 / 蜗牛伸脖子，用 transition 不用循环 keyframes）+ 每只 2~3 手招牌动作（兔鞠躬·卷耳朵、企鹅摆翅膀、蜗牛伸脖子·触角打结·缩壳）；第十轮的「张望」删除 | 用户点名「我觉得效果不好，我们可以针对这几种类型，做不同的效果，比如说兔子鞠躬，卷耳朵；企鹅摆动翅膀」。步子用 class 交替的目标值，与落脚同一个 `walkStrides % 2` 驱动，天生同相，不会出现「腿在动、身子不动」 |
| 动作调度 | **事件 > 节拍间隙招牌 > 每拍步子**，唯一调度点是 `afterHold()`；招牌动作每 3–5 拍抽一手、按计数器轮转，放动作那一拍不迈步；`canMove()` 闸门（有人在看不演） | 掷骰子没法断言，计数器能数出第几拍放哪一手；不迈步是因为窗口一动，动作的 50% 就被切走 |
| 见底告警动作 | **分皮肤** `HUD_ALERT_MOVES`（兔 `fold` / 企鹅 `flap` / 蜗牛 `tuck`），只在状态跳变且窗已亮着时放一次，挂在 `applyPayload` 而不是 watch | 缩壳的两层（`.mv-shell` + 触角）只长在蜗牛身上，拿它当三款共用动作等于给企鹅兔子演一个没有零件的动作；用 watch 会让首次快照、解锁重亮相、重开挂件都补演一遍 |
| 动作时长 | **`HUD_MOVE_MS` 单点定义**，CSS 读 `--mv-dur`、JS 收尾定时器读同一张表 | 写两遍必然漂，漂了就是动画没放完被摘 class |
| 事件三条 | 本轮只接**见底 / 失败**；蹲跳（展开面板）、展鳍（刷新成功）按拍板不进码，keyframes 未写 | 用户拍板「另两条等走动那条定了再叠」；展开那一下已有 `.act` 的 `hud-hop`，不重复加 |
| 屏缘绳长 | **已作废（2026-10-23，见 23 号文档）**：巡游整套机制删除，锚点固定不动窗口 | 无需再拍板：转身 / `afterHold()` / work area 收缩三个选项都随巡游一起消失 |
| 设置预览 | **1× 展开态真实 sprite + 示例数据** | 三款可比较，也能直接看清面板字号；真实小窗用实时数据 |
| 额外 WebView 成本 | **接受**，关闭即 destroy | 换独立置顶/透明/不抢焦点；默认关，没开的人不付 |

样张：`.tmp/codex-hud-20261021/S5-cute.png`（三款 2× 细节 + 底部 1× 实际大小）；第五轮去扁与待机对拍 `.tmp/codex-hud-20261021/prod-v2-strip.png`（纸/墨收起 + 眨眼/抽动冻结序列）、`prod-v2-settings.png`（设置页三张 1× 预览）、`native-motion-{rest,blink,twitch,expanded}.png`（原生真实窗口冻帧）；第六轮动作分层与巡游取证 `native-react-{hop,wink}.png`（展开小跳 / 点击眨眼瞬间）、`native-preview-motion.png`（设置页三张一起呼吸，`react=false`）、`native-walk-{patrol,parked}.png`（巡游中与关掉送回锚点）、`settings-preview.png`（「桌面走动」开关入位，e2e 落帧）；第七轮面板去标签对拍 `native-expanded-bunny.png`（真实窗口 1×）、`native-collapsed-bunny.png`（收起 1× 只露角色）、`native-hover-{expanded,collapsed}.png`（hover 展开 / pointerleave 收起，`posSame=true` 证明角色不动）；第八轮居中排版对拍 `ty-{real-single,real-dual,widest,low,empty}.png`（同一 CSS 的 3×，`real-single` 就是用户真机形态：只有周窗口 + `9.76亿`，行序 `w20%` / `9.76亿tok` / `≈$418.41↗`）、`native-realdata.png`（真机 1× 同数据）、`native-expanded-full.png`（真机 1× 极值 `5h100%w100%` / `9,876.5万tok` / `≈$999.99↗`，`clip=[]`）；设计源在 `.tmp/codex-hud-20261021/cute.src.html`，未入版本库；第十轮节奏 mock 与真 token 对拍在 `.tmp/codex-hud-20261021/`（`R11-native-moves.png` = 第十一轮 11 帧原生冻帧合片：三款静置 + 6 条招牌动作 50% + 三款见底告警，取证脚本 `native-drive.mjs moves`，同样未入库）。实现已按本文落地，改动清单见 §5.6；提交与推送另行确认。
