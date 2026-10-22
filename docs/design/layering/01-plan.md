# 层间阶梯与线描降噪

日期：2026-10-21 ｜ 修订：2026-10-21（review 后：搜索框专用边框、外框决策、sunken 级联、锁屏条件） ｜ 状态：**已落地**
后续：2026-10-22 工作区外壳改为整窗同场，外框→画布台阶与 1px 反光边退役，见[工作区配色与柔光 §13](../themes/05-workspace-palette-and-daylight.md)。
前置：[工作区配色与柔光（第三轮）](../themes/05-workspace-palette-and-daylight.md)
基线截图：`.tmp/visual-review-20261021/`（37 状态 × 纸/墨 = 74 帧，E2E mock，1040×670 @1.5x）

## 问题

用 74 帧逐页对账后，把"不耐看"定位到两件可量化的事：

**1. 层级信号倒挂。** 纸底"外框→纸面"有 4.5 L\* 的落差，但"纸面→卡片"只有 1.0 L\*。
容器比内容更醒目，眼睛要靠一圈 1.17:1 的细线去解析卡片边界，长时间阅读持续耗神。

**2. 分类色噪声。** 收藏页字母块吃 6 桶色相淡染（13% 底 / 65% 字），一屏同时出现 5–6 种粉彩，
与全局单强调色的克制相冲突；量更大时先看到"彩色格子"，再看到收藏本身。

实测（当前工作树）：

| 层级关系 | 纸 | 墨 |
| --- | ---: | ---: |
| 外框 → 画布（ΔL\*） | 4.5 | 3.1 |
| 画布 → 卡面（ΔL\*） | **1.0** | 5.5 |
| 卡片描边 / 卡面（对比度） | 1.17 | 1.21 |
| 分类淡染（底 / 字） | 13% / 65% | 同左 |

## 本轮原则

1. **只换颜色，不换形状**：圆角、间距、字号、布局、阴影语言全部不动。
2. **纸底不回到"浊"**：09-28 否掉过 `#f5f4f1`（L\* 96.3，暖米灰）。本轮画布落点 L\* 96.8，
   中性不带暖黄，且保留近白实底；`--bg` 不得低于 L\* 96.5。
3. **双信号分层**：卡面明度台阶负责"面"，描边负责"边"；不再让一根细线独扛。
   层级顺序固定为“画布→卡面 > 外框→画布”，外框不得反超内容。
4. **只管工作区**：经典布局 8 套底色、10 档强调色、`global.css` 的 96 槽一律不动。
5. **保留分类归堆**：色相机制不砍，只降一档彩度；分类点仍是全色相，字母块变安静。

## 令牌改动表

### 纸（paper）

| 令牌 | 现值 | 新值 | 现 L\* | 新 L\* | 关系变化 |
| --- | --- | --- | ---: | ---: | --- |
| `--workspace-frame` | `#efefee` | `#efefee`（不动） | 94.4 | 94.4 | 外框→画布 4.5 → **2.4**，低于卡面 3.2 |
| `--bg` | `#fcfcfc` | `#f6f6f4` | 99.0 | 96.8 | 画布→卡面 1.0 → **3.2** |
| `--sunken` | `#f3f3f2` | `#ececea` | 95.8 | 93.3 | 画布→下陷 3.2 → **3.5** |
| `--material-inspector-base` | `#f7f7f6` | `#f1f1ef` | 97.2 | 95.1 | 画布→目录 1.8 → **1.7** |
| `--border-card` | `border` 70% + 卡面（≈`#ededeb`） | `var(--border)`（`#e5e5e3`） | — | — | 卡线/卡面 1.17 → **1.26** |
| `--border-card-hover` | `border-hover` 70% + 卡面（≈`#d4d4d2`） | `var(--border-hover)`（`#c1c1be`） | — | — | 悬停边全量显色 |
| `--border-search`（新增，仅纸） | `var(--border)`（1.22） | `color-mix(in srgb, var(--border) 80%, var(--border-hover))`（≈`#dededc`） | — | — | 搜索边/填充 1.22 → **1.30**；对画布 1.25 |
| `--bg-inspector-hover`（新增） | — | `color-mix(in oklab, var(--text) 3.5%, var(--material-inspector-base))` | — | ≈92.3 | 目录行悬停约暗 2.8 L\* |

- 外框不压暗：原稿 `#e8e8e6` 让外框→画布 4.9 反超卡面 3.2，层级仍然倒挂；且顶栏条数（muted）会掉到 4.44:1。
  保 `#efefee` 时 2.4 < 3.2、条数 4.74:1；备选 `#ededeb`（3.1、条数 4.65）留待对拍。
- 卡面 `--panel-bg` 保持 `#ffffff`（L\* 100），不再追高画布亮度。
- 纸底正文 `#242321` 对新画布 14.51:1，弱文字 `#6d6963` 5.04:1，均高于门槛。
- 描边对画布 1.17:1，对卡面 1.26:1；边界不再只靠一条 1.17 的线。
- 搜索面是 `panel 72% + frame`（≈L\* 98.6），边框对填充只有 1.22，达不到本轮 1.25 口径；
  专用令牌只写纸块，墨搜索框维持 `var(--border)`。

### 墨（ink）

| 令牌 | 现值 | 新值 | 现 L\* | 新 L\* | 关系变化 |
| --- | --- | --- | ---: | ---: | --- |
| `--panel-bg` | `#232427` | `#26282c` | 14.2 | 16.1 | 画布→卡面 5.5 → **7.3** |
| `--fill` | `#292b2f` | `#2c2f33` | 17.5 | 19.3 | 卡面→填充 3.3 → **3.2** |
| `--hover` | `#2b2d32` | `#303238` | 18.5 | 20.8 | 卡面→悬停 4.3 → **4.7** |
| `--border-subtle` | `#2b2e34` | `#30333a` | 18.9 | 21.2 | 卡面→细线 4.7 → **5.2** |
| `--border-card` | `border` 70% + 卡面（≈`#303238`） | `var(--border)`（`#35383f`） | — | — | 卡线/卡面 1.21 → **1.26** |
| `--border-card-hover` | `border-hover` 70% + 卡面 | `var(--border-hover)`（`#5c626e`） | — | — | 悬停边全量显色 |

不动：`--bg` `#18191b`、`--workspace-frame` `#121315`、`--sunken` `#111214`、
`--active` `#34373d`、`--border` `#35383f`、`--border-strong` / `--border-hover`、
文字族、阴影、`--workspace-light`。

- 新阶梯：画布 8.7 → 卡面 16.1 → 填充 19.3 → 悬停 20.8 → 细线 21.2 → 描边 23.5（按下 23.0）。
- 正文对新卡面 11.28:1（原 11.85），弱文字 6.51:1，均 ≥5.8 底线。
- `--active` 与卡面仍差 6.9 L\*，不会被悬停吃掉。

### 分类淡染（仅工作区）

覆盖写在 `workspace-themes.css`，不动 `global.css` 的经典规则：

| 项 | 现值 | 新值 |
| --- | --- | --- |
| `.grid-slot--hue` 底 | `color-mix(hue 13%, panel)` | `color-mix(hue 9%, panel)` |
| `.grid-slot--hue` 字 | `color-mix(hue 65%, text)` | `color-mix(hue 55%, text)` |
| 分类点（`.ec-cat i`） | 全色相 | 不变 |

- 6 桶色相互差保持；未分类的中性字母档、favicon 到货后的亮底档不变。
- 文件扩展名徽章 `--ft-*`、验证码中性档面、状态色（成功/警告/危险）一律不动。

## 联动面

### 自动跟随（无需改值，但必须对账）

| 派生令牌 | 公式 | 本轮结果 |
| --- | --- | --- |
| `--bg-workspace` | `var(--bg)`（氛围关） | 纸 -2.2 L\*；墨不变 |
| `--bg-workspace-search` | `panel 72% + frame` | 纸 ≈98.6（不变），从略暗于画布变为略亮于画布 |
| `--border-search`（纸） | `border 80% + border-hover` | 新令牌，搜索边/填充 1.22 → **1.30** |
| `--bg-workspace-hover` | `text 5% + panel` | 墨随卡面抬升 |
| `--bg-workspace-selected` | `accent 10% + panel` | 随卡面抬升 |
| `--bg-input` / `--bg-input-focus` | `var(--bg)` / `var(--panel-bg)` | 纸输入面 -2.2 L\*，与卡面拉开 |
| `--bg-dialog` / `--toast-bg` / `--tip-bg` | `var(--panel-bg)` | 墨弹窗、toast 抬到 `#26282c` |
| `--frost-bg` | `panel 94%` | 自动跟随 |
| 锁屏（墨）`--lock-wash-b` | `var(--bg)` | 墨锁屏底不变（`--bg` 未动） |

**随 `--sunken` 一起变深的次级面（纸 -2.5 L\*，墨不变）**

| 面 | 位置 | 结果 |
| --- | --- | --- |
| Ctrl K / kbd 徽标 | `global.css:1800`、`global.css:2085` | 底降到 93.3；muted 字仍 4.61:1 |
| 纸卡悬停填充 | `global.css:2482` | 与卡面 4.2 → 6.65 L\*，与 `--active` 的 8.1 只差 1.4，目检确认不抢选中 |
| 代码块 / 归档条 / MFA 行悬停 / Codex 会话卡 / 直连展开行 / Web 地址 / 导出与分享弹窗分段器 | `global.css:1341`、`NotesModule.vue:766`、`MfaModule.vue:440`、`CodexSessionsPanel.vue:632`、`BypassModule.vue:901`、`WebAccessPane.vue:111`、`NoteExportController.vue:118,122`、`CodexUsageShareDialog.vue:143,151` | 同比 -2.5 L\*，仍需与卡面分离 |

- 锁屏：氛围开时纸/墨都不消费工作区 `--bg`；**氛围关时 `--bg-lock: var(--bg)`（`materials.css:150`），
  纸锁屏随画布一起 -2.2 L\***，墨锁屏不变。原对账表第 21 行的口径只对氛围开成立。

**柔光（氛围开）**

光场配方不动，只换渐变底 `--bg`。新令牌下实测 24 组（纸/墨 × 12 强调色）：

| 分支 | 左上主光 | 右下辅光 | 目录 .65 | 目录 .9（光源中心） |
| --- | ---: | ---: | ---: | ---: |
| 纸 彩色 10 档 | 4.0–6.1 | 3.0–5.2 | 1.1–1.8 | 2.0–3.4 |
| 墨 彩色 10 档 | 3.6–4.5 | 3.3–4.1 | 2.3–2.9 | 4.0–5.4 |
| 纸 graphite/sand | 0.3 | 0.0 | 0.0 | 0.6 |
| 墨 graphite/sand | 3.0 | 3.0 | 1.5 | 3.0 |

- 彩色 10 档全部过第三轮阈值（主光 >1.5、辅光 >1、两端比 0.5–2），墨底中部 <3、留白单点通道差 ≤8。
- 卡片、搜索底、新增小记底在氛围开关前后像素完全一致；24 组全部成立。
- **中性纸底是明暗级微差**：光色 `oklch(… 0.96 0)` 与新画布/目录底几乎同明度，主光只剩 0.3，
  目录中段（.65）掉到 0，光源中心（.9）仍有 0.6。这是"中性只改明暗"的既有设计，不是漏接；
  但 `theme-composition.spec.ts:91` 的目录采样点必须从 .65 移到 .9，否则会误报。

### 需要新增/改选择器

1. `--bg-inspector-hover` 新令牌 + `.workspace-directory .directory-link:hover:not(.active)`
   改吃它。原因：纸目录底降到 `#f1f1ef` 后，全局悬停色（≈96.1）反而比目录底更亮，
   会失去悬停反馈；专用令牌给 ≈2.8 L\* 的压暗。
2. `--border-card(-hover)` 由"70% 混卡面"改为"全量描边"，全局卡片一起生效，
   不再逐组件覆盖。

### 硬编码/断言同步

| 位置 | 现值 | 新值 |
| --- | --- | --- |
| `e2e/specs/theme.spec.ts:7` paper bg | `rgb(252, 252, 252)` | `rgb(246, 246, 244)` |
| `e2e/specs/theme.spec.ts:221` ink toast bg | `rgb(35, 36, 39)` | `rgb(38, 40, 44)` |
| `e2e/specs/workspace-layout.spec.ts:294` paper inspector | `rgb(247, 247, 246)` | `rgb(241, 241, 239)` |
| `e2e/specs/theme-composition.spec.ts:91` 目录柔光采样 | `panel.y + panel.height * .65` | `panel.y + panel.height * .9`（光源中心；中性纸底 .65 实测 0，.9 为 0.6） |
| `scripts/workspace-daylight-shots.mjs:14-15` | paper `['#fcfcfc','#ffffff','#efefee','#ffffff']`；ink `['#18191b','#232427','#121315','#393b40']` | paper `['#f6f6f4','#ffffff','#efefee','#ffffff']`；ink `['#18191b','#26282c','#121315','#393b40']` |

- `theme-tokens-dump` 只解析 `global.css` 与 `materials.css`（脚本 13–14 行），用于确认经典槽位无 diff；
  `workspace-themes.css` 的新值不在它的输出里，不能拿它当新值验收。

`theme.ts` 的经典预览 meta 不动；工作区预览卡（`.workspace-theme-prev`）直接消费 CSS 令牌，自动跟新色。

## 全模块对账

帧号对应 `.tmp/visual-review-20261021/shots/{paper,ink}/`，纸/墨同号。

| # | 模块 / 面 | 消费令牌 | 预期变化 | 对账重点 | 帧 |
| --- | --- | --- | --- | --- | --- |
| 1 | 外框 / 标题栏 | `--workspace-frame`、`.workspace-surface` 阴影 | 纸外框不动；纸面 -2.2 L\* | 外框→纸面 2.4，小于卡面 3.2；纸面浮起阴影不加重 | 02、24 |
| 2 | 图标栏 | frame、`--bg-workspace-hover/selected` | 底随外框；激活块由 accent 混出 | 激活/悬停仍可辨 | 02、15 |
| 3 | 右侧目录 | `--bg-inspector`、新 hover、selected | 纸目录 95.1；悬停改新令牌（2.8 L\*） | 目录与纸面 1.7 L\*；行悬停不再同色 | 05、08 |
| 4 | 页条 / 搜索 | `--bg-workspace`、`--bg-workspace-search`、`--border-search` | 纸搜索框底不变；边框 1.22 → 1.30 | 仍读作输入面；`Ctrl K` 徽标随 sunken 加深 | 02、07 |
| 5 | 小记列表 | `--bg-surface`、`--border-card`、卡 hover | 纸卡面 3.2、卡线 1.26；墨卡面 7.3；纸卡悬停填充 6.65 | 加密斜纹、分组头、置顶线不变；悬停不抢选中 | 02–04 |
| 6 | 小记全屏 | `--bg-editor`（=`--bg`）、panel | 纸阅读底 -2.2 L\* | 阅读/书写两态分档不变；纸面仍暖白 | 06 |
| 7 | 收藏 | `--border-card`、`.grid-slot--hue`、`--cat-*` | 卡线增强；淡染降至 9/55 | 6 色相仍可归堆；分类点保持全色相 | 07 |
| 8 | 文件快捷 | `--border-card`、`--ft-*` | 仅卡线 | 扩展名徽章色不动 | 09 |
| 9 | 验证码 | `--border-card`、accent 环 | 仅卡面阶梯 | 大数字、计时环不变 | 10 |
| 10 | 局域网传输 | `--border-card`、`--border-subtle`、虚线 | 卡与分割线 | 拖投虚线仍清楚；目录行分割可见 | 11 |
| 11 | 内网穿透 | `--border-card`、`--border-subtle` | 卡与行 | 状态 chip 色相不动 | 12 |
| 12 | 直连清单 | 卡、细线、hero | 卡面/行底 | 2/6 hero 层级不变；风险 chip 不动 | 13–14 |
| 13 | Codex 账号 | `.rcard`、`--fill`（进度轨）、`--hover`、标签 | 墨卡面 +1.9、轨道阶 3.2 | 78%/46% 进度条与轨道仍分离；行悬停 | 15–17 |
| 14 | Codex 会话 | 分组卡、`--border-subtle` | 墨行分割 4.7→5.2 | 分组卡与行分离；hero 不变 | 18–19 |
| 15 | Codex 用量 | 卡、细线（图表网格） | 墨网格 18.9→21.2 | 网格不抢数据；三色柱不变 | 20–22 |
| 16 | Codex 回收站 | 行底、细线 | 随面阶梯 | 风险标签色不动 | 23 |
| 17 | 设置弹窗 | `--bg-dialog`=panel、`--bg-input`=bg、sunken | 纸弹窗仍白、输入面 -2.2；墨弹窗 +1.9；sunken 面 -2.5 | 弹窗与遮罩分离；左侧导航不变形；kbd/分段器仍分得开 | 24–37 |
| 18 | 详情 / 编辑弹窗 | panel、`--border-card`、sunken | 同上 | 密码行、表单行、空态虚线 | dialog-shots |
| 19 | Toast / 提示 | 墨 `--toast-bg`=panel | `#232427` → `#26282c` | 更新断言；纸黑 toast 不变 | theme.spec |
| 20 | 骨架屏 | `--fill` / `--hover` | 墨骨架面抬升 | 骨架块与卡面仍分得开 | e2e skeleton |
| 21 | 锁屏 | 纸走经典 wash；墨 `--lock-wash-b`=`--bg` | 氛围开：纸/墨均不变；氛围关：纸随 `--bg` -2.2 | 氛围关时锁屏底与画布同步，不能仍写成"不消费" | 01 |
| 22 | 主题预览 | `.workspace-theme-prev` 消费同一套令牌 | 缩略图自动跟新 | 两张底色卡与实底一致 | 24 |

### 状态类对账

- **置顶日头**：纸画布加深后纯 accent 只剩 4.37:1，落地时改为 `accent 80% + text 20%`（纸 5.39 / 墨 8.48），色相不变。
- **悬停**：卡片边由"70% 淡出"改为全量 `--border-hover`，纸 `#c1c1be` / 墨 `#5c626e`；
  目录行单独用 `--bg-inspector-hover`（纸 2.8 L\*）。
- **悬停填充**：纸卡吃 `--sunken`，与卡面 4.2 → 6.65 L\*；墨卡吃 `--hover`，4.3 → 4.7 L\*。
  纸卡悬停离 `--active` 只差 1.4 L\*，目检不得读成"已选中"。
- **选中**：accent 10% + 卡面，随卡面自动变化；焦点环 accent 24% 不动。
- **禁用**：只洗面的既有规范不变，但禁用字/面都在新卡面上，需目检设置禁用按钮与 Codex 重登。
- **分割线**：卡内分割一律 `--border-subtle`，墨底阶差从 4.7 提到 5.2；卡边界仍吃 `--border-card`。
- **空态 / 虚线**：吃 `--border`，本轮不变。

## 实施清单

1. `src/styles/workspace-themes.css`
   - 基础块：`--border-card` / `--border-card-hover` 改为全量描边；纸外框保持 `#efefee`。
   - 纸块：`--bg`、`--sunken`、新增 `--border-search`（80% border + 20% border-hover）。
   - 墨块：`--panel-bg`、`--fill`、`--hover`、`--border-subtle`。
   - 新增工作区作用域的 `.grid-slot--hue` 覆盖（9% / 55%）。
2. `src/styles/materials.css`
   - 纸 `--material-inspector-base` → `#f1f1ef`；新增 `--bg-inspector-hover`（3.5% mix）。
3. `src/components/layout/CodexWorkspace.vue`
   - `.directory-link:hover` 从 `--bg-workspace-hover` 改吃 `--bg-inspector-hover`。
4. `e2e/specs/theme.spec.ts`、`e2e/specs/workspace-layout.spec.ts:294`、`scripts/workspace-daylight-shots.mjs`：同步硬编码色值；
   `theme-composition.spec.ts:91` 目录柔光采样点从 .65 移到 .9。
5. 重生成 `docs/design/themes/01-token-inventory.md`（经典槽位应无 diff，用于确认没误伤；
   工作区新值不在该文件里）。

不改：`global.css` 的 8 套底色与 accent 块、`theme.ts`、Rust、布局尺寸、弹窗基线、行卡档位、图标骨架。

## 验收

```bash
# 先固化 before 基线：capture.mjs 会原地覆盖 shots/
cp -r .tmp/visual-review-20261021/shots .tmp/visual-review-20261021/before-shots

node scripts/check-theme-coverage.mjs
node scripts/theme-tokens-dump.mjs --out docs/design/themes/01-token-inventory.md
npx vue-tsc --noEmit
PW_CHANNEL=msedge npx playwright test e2e/specs/theme.spec.ts e2e/specs/theme-composition.spec.ts e2e/specs/workspace-daylight.spec.ts e2e/specs/workspace-layout.spec.ts e2e/specs/materials.spec.ts e2e/specs/appearance.spec.ts
PW_CHANNEL=msedge node scripts/color-sweep.mjs
PW_CHANNEL=msedge node scripts/workspace-daylight-shots.mjs .tmp/layering-20261021/matrix
PW_CHANNEL=msedge node scripts/dialog-shots.mjs paper   # 需先起 vite --mode e2e --port 1430
PW_CHANNEL=msedge node .tmp/visual-review-20261021/capture.mjs   # 重拍 74 帧，对照 before-shots
```

量化门槛：

- 纸：画布 L\* ≥ 96.5；卡面步进 ≥ 2.5；卡线/卡面 ≥ 1.25；
  外框步进 2.2–3.2 且**必须小于卡面步进**；顶栏条数（muted on frame）≥ 4.5。
- 墨：卡面 L\* ≤ 17.0；卡面步进 ≥ 7.0；正文 ≥ 11、弱文字 ≥ 5.8；卡线/卡面 ≥ 1.25。
- 分类字母：对淡染底 ≥ 4.5（最终组合逐色相实测：纸 7.11–7.87；墨 6.42–7.47；
  降染后文字更靠近正文色，对比反而升高）。
- 纸底正文对画布 ≥ 14；弱文字 ≥ 5.0；输入面与卡面 ≥ 1.05。
- 搜索框：专用边框对填充 ≥ 1.25（实测 1.30），对画布 ≥ 1.17（实测 1.25）；
  新增小记维持"填充 + 边框"双信号。搜索框不再依赖 05 §4.6 的旧口径。
- 目录悬停：纸 2.5–3.5 L\*（配方 3.5% 实测 2.8）。
- 氛围开：彩色 10 档的左上主光 >1.5、右下辅光 >1、两端比 0.5–2、目录光源中心 >0.3；
  中性 2 档只查不串色（通道差 ≤5）与目录光源中心 >0.3（纸 .9 实测 0.6、墨 3.0）；
  卡片/输入/新增小记开关前后像素一致。实测窗口见上文"柔光"表。

目检门槛（前后 74 帧并排）：

1. 纸底卡片一眼可见边界，不再"找边"；
2. 墨底卡片从画布里浮出来，但仍是炭灰、不发灰泛蓝；
3. 收藏页彩色字母块退到背景层，同分类仍能一眼归堆；
4. 目录面板与纸面可分，行悬停可见；
5. 文件徽章、状态色、进度条、图表数据色一个都没变。

## 风险与回退

| 风险 | 触发点 | 回退 |
| --- | --- | --- |
| 纸面回到"浊" | 画布 < L\* 96.5 或掺暖黄 | 回 `#f8f8f6`（步进 2.5） |
| 墨卡抬太多，填充分不开 | `--fill` 与卡面 < 2.5 L\* | `--panel-bg` 回到 `#25272b` |
| 纸目录悬停同色 | 忘记接 `--bg-inspector-hover` | 悬停步进应 ≥ 2.5 L\* |
| 纸卡悬停太抢 | 悬停面与 `--active` 差 < 1.5 L\* | `--sunken` 回 `#efefee`（卡面步 4.2），其余照旧 |
| 搜索边过重 | 搜索边对填充 > 1.45 | 混比回 `90% border + 10% border-hover` |
| 顶栏条数低于 4.5 | 外框被压到 `#ededeb` 以下 | 条数升 `--text-secondary`（6.45） |
| 氛围开时纸底溢光采样变弱 | 彩色档主光 <1.5 或两端失衡 | 只调溢光强度，不动底色 |
| 中性纸底柔光只剩明暗级 | 目录光源中心 <0.3 | 中性光色 L 0.96 → 1.0（会改变第三轮中性观感，须另拍板） |
| 经典布局被误伤 | token dump 出现 diff | 工作区覆盖必须写在 `workspace-themes.css` |

并行会话可能同时改工作树；验收前重跑，不按旧行号归因。

## 本轮不做（另起一轮）

- 卡片内部元素精简（URL 等宽、锁图标 hover 才现）；
- 内容区最大宽度与空态处理；
- 页内小节标题与卡片标题的字阶拉开；
- 收集页 hero 摘要模式。

以上都涉及结构或排版，不属于"只换颜色"的令牌轮次。

## 拍板点

1. 纸画布 `#f6f6f4`（L\* 96.8，步进 3.2）—— 距被否的 `#f5f4f1` 只差 0.65 L\*，必须先看真 token 对拍；
   若验收仍嫌灰，唯一允许的回退档是 `#f8f8f6`（步进 2.5）。
2. 纸外框：A 保持 `#efefee`（推荐，步进 2.4、条数 4.74）；B `#ededeb`（步进 3.1、条数 4.65）；
   C `#e8e8e6`（步进 4.9，反超卡面且条数 4.44，不推荐）。
3. 分类淡染 `9% / 55%` —— 若归堆感不足，先回到 11%，不回到 13%。
4. 墨卡面 `#26282c`（步进 7.3）—— 上限 `#282a2f`（步进 8.3），再高会吃掉悬停层。
