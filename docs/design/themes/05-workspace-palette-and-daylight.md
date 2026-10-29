# 工作区配色与柔光

2026-10-20 · 第三轮视觉修正：**2 底色 × 12 强调色 × 2 氛围 = 48 组**

> **当前实现以第 11–13 节为准。** 第 1–10 节保留第二轮方案与验收记录；其中暗色底色、边缘进光配方及相应像素阈值已被第三轮替代。2026-10-22 起，外框层级与 1px 反光边被第 13 节的整窗同场取代。

## 摘要

工作区保留**纸、墨**两套底色与 12 档强调色。根据「柔光变差、暗色整窗灰蒙」的实际反馈，恢复两端留白的连续柔光，并重新调整暗色层级：

- 柔光落在左上与右下留白，发散点向窗口内收，去掉窄竖带和顶部白色提亮层；卡片、输入框、全屏阅读与书写保持实底。
- 暗色采用外框 `#121315` → 画布 `#18191b` → 卡片 `#232427` 的层级，外框后退，内容保持清晰。
- 正文、辅助和弱文字重新分级，避免大面积灰卡片、明亮描边和相近文字共同形成灰雾感。
- 设置里只剩两张底色卡和 12 枚色丸；经典布局的 8 套底色、10 档强调色原样保留。

以下第 1–10 节为第二轮历史记录。

## 1. 为什么收回六套底色

上午的 6 底色方案让工作区组合从 44 组涨到 144 组，但六套底色里有四套在 64px 缩略图上难以区分，用户仍要付出选择成本。更重要的是，上一版为了不让浅色内容被染色，给画布盖了 90% 遮罩、给结构光固定彩度，结果是：

- 浅色底只剩下很淡的色相，强调色的表现力被一起压掉；
- 深色底的外框、目录、辅助面板都被同一层灰场包住，整窗「灰蒙蒙」；
- 玫瑰仍然会把留白洗成粉，石墨仍然几乎失效，只是问题从内容挪到了结构。

这一轮不再用遮罩换中性，而是把强调色限制在**边缘**：内容面保持实底，溢光和边线直接使用强调色本体。组合数也随之收敛为 2 × 12 × 2 = 48。

## 2. 12 档强调色

### 2.1 色板

浅色档用于纸底，深色档用于墨底。浅色主按钮使用实底 + 白字；深色主按钮使用 14% 混色底 + 50% 混色字。H/C 为浅色档的 OKLCH 色相与彩度。

| id | 名称 | 浅色档 | 深色档 | H | 白字对比（纸） | 深色按钮对比（墨） |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `ink` | 蓝 | `#1b76c4` | `#7eb1e6` | 250 | 4.73 | 7.58 |
| `indigo` | 靛 | `#6966c6` | `#a3a5e7` | 282 | 4.86 | 7.46 |
| `plum` | 紫 | `#9456ae` | `#c39bd5` | 315 | 5.00 | 7.42 |
| `rose` | 玫瑰 | `#b74679` | `#e290b0` | 355 | 5.04 | 7.37 |
| `brick` | 砖红 | `#ba4b47` | `#e2958e` | 25 | 5.02 | 7.41 |
| `clay` | 橙 | `#b05a00` | `#db9d72` | 55 | 4.87 | 7.45 |
| `amber` | 琥珀 | `#916d00` | `#c8a865` | 85 | 4.78 | 7.53 |
| `olive` | 橄榄 | `#747813` | `#adb271` | 112 | 4.73 | 7.60 |
| `celadon` | 绿 | `#38804b` | `#84bc8f` | 150 | 4.82 | 7.65 |
| `teal` | 青 | `#00817c` | `#6bbdb8` | 190 | 4.74 | 7.63 |
| `graphite` | 灰 | `#6e747a` | `#a7adb4` | 250 | 4.73 | 7.57 |
| `sand` | 砂 | `#7b7263` | `#b4ab9d` | 80 | 4.74 | 7.57 |

- 浅色 12 档实底白字最低 **4.727:1**（灰），高于 4.5 底线；最高 5.04。
- 深色 12 档混色按钮最低 **7.367:1**（玫瑰），最高 7.653（绿），全部远高于 4.5。
- 与上一版的灰调色板相比，彩度整体抬升：蓝从 `#536d85` 回到 `#1b76c4`，砖红 `#ba4b47`、绿 `#38804b`、青 `#00817c` 都重新能被认成「颜色」，而不是灰。
- 有彩色最小 OKLab 距离 **0.0527**（琥珀/橄榄），高于 0.04 门槛。灰与砂走中性，不靠彩度区分。

### 2.2 语义

- 12 档色相覆盖蓝、靛、紫、玫瑰、砖红、橙、琥珀、橄榄、绿、青、灰、砂，相邻色相最小间隔约 25°，不再有上一版 4 对近亲。
- `graphite` 是预览与中性锚点；退役它会牵动设置预览和 E2E 锚点，不做无配套的替换。
- `teal` 在工作区是青 `#00817c`，与经典布局的湖蓝 `#077190` 同名不同值，迁移规则见第 7 节。

### 2.3 按钮

- 浅色：`--bg-workspace-primary: var(--accent)`，`--text-workspace-primary: var(--accent-on)`（白）。
- 深色：`--bg-workspace-primary: color-mix(in oklab, var(--accent) 14%, var(--bg))`，hover 17%、active 20%；文字 `color-mix(in oklab, var(--accent) 50%, var(--text))`。
- 色点：`--workspace-accent-swatch: var(--workspace-accent-source)`，直接显示强调色本体。
- 弹窗内的按钮不属于工作区主色，沿用全局按钮规范。

## 3. 纸与墨

### 3.1 纸

| 令牌 | 值 |
| --- | --- |
| `--bg` | `#fcfcfc` |
| `--panel-bg` | `#ffffff` |
| `--sunken` | `#f3f3f2` |
| `--fill` | `#eeeeed` |
| `--hover` / `--active` | `#f3f3f2` / `#e8e8e6` |
| `--border` / `--border-strong` | `#e5e5e3` / `#cdcdca` |
| `--border-subtle` / `--border-hover` | `#efefed` / `#c1c1be` |
| `--workspace-frame` | `#efefee` |
| `--workspace-light` | `#ffffff` |

正文与辅助文字继续吃 `global.css` 的经典纸底已发货值，不在工作区重复定义。

### 3.2 墨

| 令牌 | 值 | 用途 | 实测 |
| --- | --- | --- | --- |
| `--bg` | `#1d1d1c` | 画布 | L\* 10.7，不近纯黑 |
| `--panel-bg` | `#2a2a29` | 卡片 | 卡片/画布对比 1.17 |
| `--sidebar-bg` / `--workspace-frame` | `#232322` | 外框、侧栏 | L\* 13.7，夹在画布与卡片之间 |
| `--workspace-light` | `#2e2e2c` | 外框受光参考 | — |
| `--sunken` | `#191918` | 下沉面 | — |
| `--fill` / `--hover` / `--active` | `#30302e` / `#353533` / `#3d3d3a` | 控件面 | — |
| `--border` | `#454541` | 默认描边 | 描边/卡片 1.49 |
| `--border-strong` / `--border-hover` | `#5a5a54` / `#64645d` | 强描边、hover | — |
| `--border-subtle` | `#30302d` | 细分割 | — |
| `--text` | `#d8d7d1` | 正文 | 卡片 9.96，画布 11.70 |
| `--text-secondary` | `#b3b2ab` | 辅助 | 卡片 6.75，与正文 L\* 差 13.4 |
| `--text-muted` | `#a8a7a0` | 弱文字 | 卡片 5.95 |
| `--text-faint` | `#888780` | 装饰 | 不承担正文 |
| `--shadow-xs` / `--shadow-card` | `none` | 卡片 | 靠明度与描边分层 |
| `--shadow-sm` / `--shadow` | 1px/4px 黑影 | 浮层 | 只给浮层 |

墨的关键不是「黑」，而是**三层明度**：画布 10.7 → 外框 13.7 → 卡片 17.0。上一版把画布盖到近黑、再把结构刷成同一层灰，才出现「灰蒙蒙」；这一版让画布退后，卡片和文字重新站到前面。

### 3.3 为什么只有两套

- 纸/墨覆盖了绝大多数使用场景：白天近白、夜间暖炭。
- 绢/雾/岩/苔在缩略图和实际界面上都与纸/墨过于接近，保留只会增加选择成本。
- 两套底色的 `--bg` / `--panel-bg` / 文字 / 描边全部是完整 96 槽，不再有「补 frame/light、其余继承」的混搭路径。

## 4. 边缘进光

### 4.1 四个受光位置

- **左上溢光**：内容画布左上角一束强调色径向光，交代光源方向。
- **外框左缘**：外框/侧栏左缘 6% 宽的强调色竖带，强度 4%（墨 12%）。
- **1px 反光边**：工作区表面顶边一道强调色高光，纸底辅以白色内框，墨底辅以 5% 白内框。
- **辅助面板**：极淡的顶部洗色 + 2%（墨 3%）底色混合，目录与内容面仍可区分。

卡片、输入框、新增小记、书写纸不接光。强调色不进入内容面。

### 4.2 令牌

基础（纸）：

```css
--material-inspector-base: #f7f7f6;
--material-workspace-spill-strength: 8%;
--material-workspace-navigation-strength: 4%;
--material-workspace-rim:
  inset 0 1px 0 color-mix(in srgb, var(--accent) 16%, #fff),
  inset 0 0 0 1px color-mix(in srgb, #fff 80%, transparent),
  inset 0 -1px 0 color-mix(in srgb, var(--accent) 4%, transparent);
```

墨：

```css
--material-inspector-base: #20201f;
--material-workspace-spill-strength: 14%;
--material-workspace-navigation-strength: 12%;
--material-workspace-rim:
  inset 0 1px 0 color-mix(in srgb, var(--accent) 62%, transparent),
  inset 0 0 0 1px color-mix(in srgb, #fff 5%, transparent),
  inset 1px 0 0 color-mix(in srgb, var(--accent) 14%, transparent),
  inset 0 18px 30px -26px color-mix(in srgb, var(--accent) 16%, transparent),
  inset 0 -1px 0 color-mix(in srgb, #fff 3%, transparent);
```

中性强调色在浅底上几乎不留色，`graphite` / `sand` 的溢光强度单独抬到 10%。

其余派生令牌：

| 令牌 | 纸 | 墨 |
| --- | --- | --- |
| `--bg-workspace-selected` | accent 10% + panel | 同左 |
| `--bg-workspace-hover` | text 5% + panel | 同左 |
| `--bg-workspace-search` | panel 72% + frame | 同左 |
| `--bg-workspace-primary` | `var(--accent)` | accent 14% + bg |
| `--text-workspace-primary` | `var(--accent-on)` | accent 50% + text |

### 4.3 氛围开：画布合成

纸：

```css
--bg-workspace:
  radial-gradient(ellipse 44% 52% at 0% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 72%),
  linear-gradient(180deg, #fff, transparent 30%),
  var(--bg);
--bg-workspace-frame:
  linear-gradient(90deg, color-mix(in srgb, var(--accent) 4%, transparent), transparent 6%),
  linear-gradient(180deg, #fff, transparent 34%),
  var(--workspace-frame);
--bg-inspector:
  linear-gradient(180deg, color-mix(in srgb, var(--accent) 3%, transparent), transparent 26%),
  color-mix(in srgb, var(--accent) 2%, var(--material-inspector-base));
```

墨：

```css
--bg-workspace:
  radial-gradient(ellipse 30% 26% at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 74%),
  linear-gradient(180deg, rgb(255 255 255 / 2%), transparent 22%),
  var(--bg);
--bg-workspace-frame:
  linear-gradient(90deg, color-mix(in srgb, var(--accent) 12%, transparent), transparent 6%),
  linear-gradient(180deg, color-mix(in srgb, #fff 4%, transparent), transparent 34%),
  var(--workspace-frame);
--bg-inspector:
  linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, transparent), transparent 26%),
  color-mix(in srgb, var(--accent) 3%, var(--material-inspector-base));
```

溢光半径按实测放大过：E2E 采样点位于 `.main-content` 左上角（约视口 y=106），旧 40% × 34% 的椭圆在采样点已经衰减，6% 强度差不足 1.5；现在纸底 44% × 52% × 8%，12 档全部通过。

### 4.4 反光边挂载

只挂外层 `.workspace-surface`，氛围关闭时不生成：

```css
.workspace-surface::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 30;
  pointer-events: none;
  border-radius: inherit;
  box-shadow: var(--material-workspace-rim);
}
```

### 4.5 关掉氛围

- `--bg-workspace` 回 `--bg`；
- `--bg-workspace-frame` 回 `--workspace-frame`；
- `--bg-inspector` 回 `--material-inspector-base`；
- `::after` 不再生成；
- 强调色只留在按钮、选中态、焦点环和色点上。

### 4.6 不变量

- 卡片、输入框、新增小记在两种氛围状态下像素完全一致。
- 内容画布采样点与关氛围时的色差 < 2；墨底所有正文位置保持中性炭灰（通道差 ≤ 3）。
- 左上溢光开关差 > 1.5；外框与目录差 > 0.3；顶部反光边差 > 2。
- 墨底顶栏、侧边、底边 L\* ≥ 12，不接近纯黑；标题对比 < 10，避免夜间过曝。
- 正文 ≥ 4.5、辅助 ≥ 4.5、搜索与新增小记边框 ≥ 1.2，与前几轮门槛一致。
- 灰/砂开关氛围引入的 RGB 通道差 ≤ 5，不额外泛绿或泛蓝。

## 5. 设置与预览

- 工作区底色卡只有两张，排 1 行 2 列（`workspace-theme-row` 的 `grid-template-columns` 为 `repeat(2, ...)`）。
- 预览固定 `data-accent="graphite"`、`data-atmosphere="off"`，只比较底色，不随当前强调色或氛围变化。
- 12 枚色丸保持 28px 档，按 6 列网格排两行；窄窗也不出现 7+5 的断行。
- 氛围说明：「强调色只照亮外框与边缘，内容保持实底」。
- 经典布局的 8 张卡仍按原网格排列；Web 设置弹窗不涉及工作区预览。

## 6. 迁移

### 6.1 底色

```ts
export const WORKSPACE_THEMES = THEMES.filter(t => ['paper', 'ink'].includes(t.id))

const WORKSPACE_THEME_MAP = {
  snow: 'paper', linen: 'paper', mist: 'paper',
  midnight: 'ink', slate: 'ink', moss: 'ink',
}
```

| 存着的 id | 工作区读取 | 经典布局 |
| --- | --- | --- |
| `paper` / `ink` | 原样 | 原样 |
| `snow` / `linen` / `mist` | `paper` | 原样 |
| `midnight` / `slate` / `moss` | `ink` | 原样 |
| `apricot` / `seafoam` / 更早 id | 先走 `LEGACY_THEME`，再按上表归并 | 按 `LEGACY_THEME` |

### 6.2 强调色

```ts
const WORKSPACE_ACCENT_MAP = { forest: 'olive', coral: 'brick' }
const CLASSIC_ACCENT_MAP = { indigo: 'plum', brick: 'coral', olive: 'forest', sand: 'graphite' }
const RETIRED_ACCENT = { sage: 'celadon', sky: 'ink', lavender: 'plum', peach: 'clay' }
```

- 读取顺序：`RETIRED_ACCENT` → `isAccentId` → `LEGACY_ACCENT[rawTheme]` → 默认。
- 12 档 id 与上一轮相同，这一轮只换了色值；用户存着的 `ink` / `rose` 等 id 不需要迁移。
- `teal` 保留 id，工作区显示新的青色；`forest` / `coral` 分别迁到橄榄/砖红。
- 工作区独有的 `indigo/brick/olive/sand` 进入经典布局时映射到已有近似色，不新增经典 accent 块。
- 迁移只发生在读取时，不回写设置。

## 7. 落地

1. `src/services/theme.ts`
   - `WORKSPACE_THEMES` 收为纸/墨；
   - 恢复六套旧底色的读取映射；
   - 12 档强调色注册表不变。
2. `src/styles/workspace-themes.css`
   - 删除 `linen` / `mist` / `slate` / `moss` 工作区块；
   - 纸底只留面族；墨底重写画布/卡片/外框/文字/描边/阴影；
   - 24 条 accent source 换成新色板；默认强调色 `#1b76c4`。
3. `src/styles/materials.css`
   - 删除旧的 key/fill 场光、画布遮罩、导航色、inspector 场光；
   - 边缘进光令牌、两组合成、`.workspace-surface::after` 反光边；
   - 灰/砂浅底溢光强度分支。
4. `src/components/settings/SettingsDialog.vue`
   - 工作区底色行 3 列 → 2 列；预览仍固定石墨 + 氛围关。
5. 测试与脚本：`theme.test.ts`、`theme.spec.ts`、`theme-composition.spec.ts`、`workspace-layout.spec.ts`、`workspace-daylight.spec.ts`、`appearance.spec.ts`、`codex-usage.spec.ts`、`scripts/workspace-daylight-shots.mjs`。

不碰：`global.css` 的 8 套 96 槽与经典 2×10 accent 块、`src-tauri` 设置键、布局尺寸、弹窗基线、小记/收藏/文件/局域网/验证码/Codex 页面结构、经典布局与锁屏材质。

## 8. 测试与验收

### 8.1 单测

- `theme.test.ts` 22 项通过：旧六套底色归并为纸/墨；经典布局保留原选择；退役强调色映射不变。
- 全量 vitest **54 个文件、581 项通过**。
- `vue-tsc --noEmit` 通过。
- `node scripts/check-theme-coverage.mjs` 通过：经典 8 套 × 96 槽、20/20 强调色组合完整。工作区强调色由 `workspace-themes.css` 单独承载，不进入该脚本的 import 图。

### 8.2 E2E

- 受影响 6 个 spec **58 项通过**。
- 全量 E2E 结果见第 10.3 节。
- 覆盖点：
  - 纸/墨各 12 档：溢光 > 1.5、外框/目录 > 0.3、顶部反光边 > 2；
  - 内容中部/底部色差 < 2，卡片/输入/新增小记实底不变；
  - 墨底顶栏/侧边/底边 L\* ≥ 12，正文位置通道差 ≤ 3，标题 < 10；
  - 灰/砂 RGB 通道差 ≤ 5；
  - 底色卡数量、名称、背景、选中态与落盘值；
  - 预览不随强调色/氛围变化；
  - 旧主题归并、刷新持久化、toast 深色底。

### 8.3 截图矩阵

| 集合 | 内容 | 张数 |
| --- | --- | ---: |
| 主矩阵 1280×760 | 纸/墨 × 12 强调色 × 氛围开关 | 48 |
| 1040×670 | 纸/墨 × 蓝/灰 × 氛围开关 | 8 |
| 1920×1080 | 同上 | 8 |
| 专项 | 纸/墨 设置、阅读、书写、Codex | 8 |
| **合计** | | **72** |

- 脚本：`PW_CHANNEL=msedge node scripts/workspace-daylight-shots.mjs .tmp/theme-refine-20261020/matrix`
- 报告：`.tmp/theme-refine-20261020/matrix/matrix-report.json`，`passed: true`。
- 最低主按钮对比 **4.7274**（纸/灰）；墨底 7.37–7.65。
- 最近强调色对 琥珀/橄榄 **0.0527**。

### 8.4 风险与边界

- 浅底溢光是整轮最敏感的像素：采样点位于内容区左上，椭圆半径或强度任一变化都会影响 1.5 门槛；改溢光后必须重跑 12 档，不能只看默认蓝。
- 墨底「不发灰」依赖画布/外框/卡片三层明度同时成立；只改 `--bg` 会把外框压回同一层。
- 两套底色意味着 `snow/linen/mist`、`midnight/slate/moss` 在工作区不再可见；这是本轮明确取舍，经典布局不受影响。
- 预览锚定石墨；退役石墨时同步修改预览与 E2E 锚点。
- 并行会话可能同时改同一工作树，验收前重新跑，不按旧行号归因。

## 9. 与上一版的关系

本轮覆盖同日上午的 6 底色方案，以下内容作废：

- 6 底色集合与 `linen/mist/slate/moss` 工作区块；
- 固定彩度 key/fill 场光、`--material-workspace-canvas-veil`、导航色、inspector 场光；
- 90% / 88% 画布遮罩；
- 144 组组合与 205 张截图矩阵。

仍保留的结论：

- 预览去污染（固定石墨 + 氛围关）；
- 迁移先查表、不回写；
- 卡片/输入/书写实底不接光；
- 石墨/砂中立分支的思路（现在只用于溢光强度）。

## 10. 验收记录

### 10.1 实现

- 工作区 2 底色、12 强调色、2 氛围，共 48 组；经典布局 8 底色、10 强调色不变。
- 纸底保持近白实底；墨底重写为画布/外框/卡片三层冷暖中性的炭灰，正文暖白。
- 边缘进光为唯一柔光路径：左上溢光、外框左缘、1px 反光边、辅助面板极淡洗色。
- 设置底色卡 2 张 1 行；预览固定中性基准。
- 旧六套底色读取时归并，不写回。

### 10.2 发布说明

工作区只保留纸、墨两套底色。此前保存的绢、雾、雪会显示为纸；岩、苔、夜会显示为墨。经典布局的八套底色不受影响。12 档强调色 id 不变，但色值整体重新设计：更饱和、更易区分；此前保存的强调色选择无需迁移。工作区独有的强调色进入经典布局时映射到已有近似色。

### 10.3 自动与视觉证据

- 单测：54 个文件、581 项通过。
- 全量 E2E **487 项通过**（3 workers）：`.tmp/theme-refine-20261020/e2e-full-2.log`。首轮暴露的 2 条旧断言（设置主按钮仍是旧蓝、材质画布仍是径向色场）已随模型更新，复跑全绿。
- 受影响 6 个 spec 58 项通过；`materials` / `settings` 修正后 26 项通过。
- 类型检查、生产构建、主题覆盖检查通过。
- 矩阵：72 张截图，`passed: true`；最低按钮对比 4.7274；最近色对 0.0527。
- 墨底实测：正文 9.96（卡片）/ 11.70（画布），辅助 6.75，弱文字 5.95；画布 L\* 10.7、外框 L\* 13.7。
- Standards / Spec 两轴只读复核未发现新的实质问题。

本地验收输出（不入库）：`.tmp/theme-refine-20261020/`。色板对照见 `palette.png` / `palette.json`，截图位于 `matrix/`。

重跑：

```bash
# 需先有 1430 端口的 E2E 模式服务
PW_CHANNEL=msedge node scripts/workspace-daylight-shots.mjs .tmp/theme-refine-20261020/matrix
PW_CHANNEL=msedge npx playwright test e2e/specs/theme.spec.ts e2e/specs/theme-composition.spec.ts e2e/specs/workspace-layout.spec.ts e2e/specs/workspace-daylight.spec.ts e2e/specs/appearance.spec.ts
```

## 11. 第三轮：恢复柔光与暗色层级

### 11.1 问题与修正

第二轮把连续柔光缩成左上小光斑、外框窄竖带，同时给暗色顶部加白色提亮层。暗色卡片和描边也一起抬亮，辅助文字与弱文字的 L\* 间隔只剩 4.08。叠加后呈现灰蒙感，光的方向和层次反而更弱。

现改为左上主光与右下辅光，发散点向窗口内收，取消顶部白色洗层。留白接收柔光；卡片、输入、全屏阅读与书写始终保持实底。菜单等小浮层接收一束 10% 的局部柔光，不再继承通用材质中覆盖整面的底色遮罩；常规对话框采用第 12 节的独立局部光场。两套底色、12 档强调色及迁移规则不变。

### 11.2 暗色当前值

| 角色 | 第二轮 | 当前 | 当前 L\* |
| --- | --- | --- | ---: |
| 外框 | `#232322` | `#121315` | 5.86 |
| 画布 | `#1d1d1c` | `#18191b` | 8.73 |
| 卡片 | `#2a2a29` | `#232427` | 14.21 |
| 默认描边 | `#454541` | `#35383f` | 23.49 |
| 正文 | `#d8d7d1` | `#dfe1e5` | 89.48 |
| 辅助文字 | `#b3b2ab` | `#adb3bd` | 72.76 |
| 弱文字 | `#a8a7a0` | `#929ba8` | 63.66 |

外框后退，画布居中，卡片抬起。辅助与弱文字的明度间隔恢复到 9.10。正文/卡片对比为 11.85，辅助/卡片 7.36，弱文字/卡片 5.53。

### 11.3 柔光当前配方

主光位于 `12% 16%`，椭圆 `68% 78%`；辅光位于 `88% 84%`，椭圆 `72% 80%`，两者均衰减到 `90%`。两处光源从窗口角落移入可见区域，避免左上留白完全没有受光。外框与画布共用发散点和椭圆尺寸。

| 底色 | 主光 OKLCH | 辅光 OKLCH | 画布强度（主/辅） | 外框强度（主/辅） |
| --- | --- | --- | --- | --- |
| 纸 | L 0.90、accent 彩度 × 0.55 | L 0.92、彩度 × 0.5、色相 +24° | 22% / 22% | 32% / 28% |
| 墨 | L 0.48、accent 彩度 × 0.85 | L 0.46、彩度 × 0.7、色相 +24° | 10% / 10% | 32% / 28% |

灰/砂采用零彩度光，浅色主/辅光明度均为 0.96，深色均为 0.48。目录只在右下接受 12% 的主光；工作区边线保持轻微反光。关闭氛围后全部回到各自实底。

### 11.4 验证依据

旧断言要求所有暗色外框 L\* ≥ 12、内容受光色差 < 2，会把外框抬灰并把柔光压到难以辨认。本轮替换为实际层次检查：关闭柔光时外框比画布至少低 1.5 L\*；留白两端有可见光，中央没有整片提亮；卡片、输入与全屏书写不随开关或强调色变化。继续检查文字对比、描边、色点区分与预览稳定性。

- 上轮相关 E2E：9 个 spec、81 项通过（3 workers、无重试），包含纸/墨 × 12 强调色的实际像素检查。
- 主题状态单测 22 项通过；类型检查与主题槽位覆盖检查通过。
- 截图矩阵 72 张，`passed: true`；主按钮最低对比仍为 4.7274。
- 对拍、日志及报告位于 `.tmp/softlight-review/`；机器令牌清单已重新生成。

### 11.5 预览比例与左右受光补充修正

主题预览由拉满两列、固定 64px 高改为 16:10 比例，两张卡的容器最大宽度为 364px。常规预览约 158×99px，外层卡约 176px 宽；宽窗口也不把微缩界面横向拉长。底色预览继续固定中性强调色与关闭氛围，不随当前强调色改变。

柔光验证改为采样左上主光、右下辅光和画布中央；有彩色两端的实际受光变化均应可见，强度比保持在 1:2 到 2:1 以内。中央继续检查没有整片提亮，卡片、输入与全屏书写保持实底。预览比例在 800、1280、1920px 窗口下检查。对拍和验证输出位于 `.tmp/preview-light/`。

本轮 7 个相关 spec、52 项 E2E 通过（无重试），72 张矩阵截图全部存在且报告通过；类型检查、生产构建和主题槽位覆盖检查通过。修改前新增检查能复现 3.54:1 的扁长预览，以及纸/墨左上采样点柔光变化为零的问题。

## 12. 弹窗局部柔光（2026-10-20）

弹窗原本已消费 `--bg-dialog`，但使用全窗固定坐标和单束 10% 主光。1040px 与 1920px 实际截图中，表单和 Codex 弹窗的右下角在开关氛围前后色差为零，左上在宽窗也明显减弱，造成弹窗看起来没有柔光。

工作区新增 `--material-dialog-field`：左上角主光强度 18%，右下角辅光 14%，各使用 78% × 72% 的椭圆并向外衰减。`--bg-dialog` 在背景氛围开启时接入该角色，`--dialog-background-attachment` 改为 `scroll`，光场按弹窗自身边界绘制。共享 `.dialog` 和独立设置弹窗自动继承，输入区域保持原有实底；关闭氛围后恢复纯色。

`materials.spec.ts` 新增纸/墨 × 1040/1920px 的实际像素回归，覆盖条目表单、设置及小尺寸密码弹窗。旧实现四项均失败，修订后通过，并核对输入背景不随氛围开关变化。相关 14 条 E2E 一次通过；同时用墨蓝和当前琥珀强调色复核表单、设置与 Codex 弹窗截图，证据位于 `.tmp/dialog-glow-20261020/`。

## 13. 整窗同场（2026-10-22）

工作区原先叠了三层外壳信号：1px 内反光边、6% 浮起阴影，以及比画布更暗的外框底色。纸面和墨面在内容区上缘都能看到一条亮边与一圈暗框，用户反馈“边框特别明显，像两个界面拼在一起”。

现改为单一光场：窗口底层、图标栏、标题栏与内容面共用 `--bg-workspace`，并保持 `background-attachment: fixed`；内容面去掉阴影与内反光边，只保留 14px 圆角用于裁切。外框专属的 `--bg-workspace-frame` 与 `--material-workspace-rim` 一并退役；柔光不再区分外框与画布强度，整窗按画布配方采光。设置里的主题缩略图同步改成单一底色，不再画内外两层。

`theme-composition.spec.ts` 的像素契约随之改写：关闭柔光时，标题栏、图标栏、右侧与底部留白、内容面必须落在同一像素值（距离容差 < 0.5）；有彩色强调色仍要求图标栏采光可见。实测同场像素：纸 `246,246,244`，墨 `24,25,27`。

## 14. 图标轨与画布统一底色（2026-10-22）

图标轨和 Logo 格共用 `--bg-workspace-rail`，该角色引用 `--bg-workspace`，与主画布保持同一底色。关闭氛围时一起恢复纯色，开启时沿同一固定坐标采光，整条导航轨融入窗口背景。当前模块通过浅色选中反馈区分。

`theme-composition.spec.ts` 检查关闭氛围后图标轨与画布同色，以及氛围开启后的采光变化和 Logo 接缝连续性；`materials.spec.ts` 检查图标轨、Logo 格与窗口底层的背景图和底色一致。

## 15. 全屏阅读面并入同一光场（2026-10-26）

§13 落码时把 `--bg-workspace` 也给了全屏阅读面：`NoteFullscreen.vue` 里 `.fs:has(.fs-doc)` 用 `var(--bg-workspace)` 配 `background-attachment: fixed`，`.fs` 本体继续用 `var(--bg-editor)`。所以摘要与第 11 节那句「卡片、输入、全屏阅读与书写保持实底」只有一半还成立，现口径按态分档：

- 阅读面（有 `.fs-doc`）与画布同一光场、同一固定坐标，进全屏和退出全屏不出现第二次布光；
- 书写面（无 `.fs-doc`）恒为实底，不随氛围开关或强调色改变背景图；
- 卡片与输入继续实底。

`workspace-daylight.spec.ts` 按这条口径重写。柔光颜色由强调色推导（`oklch(from var(--accent) …)` 序列化还带抖动），断言因此只锁光场形状——左上主光 `68% 78% @ 12% 16%`、右下辅光 `72% 80% @ 88% 84%`，颜色一律归一成 `C`；再要求阅读面的 `background-image` 与 `.workspace-surface` 逐字相等、切氛围与强调色后底色不变、切到编辑态回到 `none`。旧断言「阅读态也必须是 `none`」是 §13 之前的账，本轮判为陈旧断言改掉，代码没有回归。

同轮复跑还逮出一处代码偏离本文：墨底四级文字在 `56b388c` 里被顺手改成 `#e5e7eb / #bcc0c7 / #a4a8b0 / #989da7`（前三档提亮、辅助文字反而压暗，层级差被压扁），该提交与本文都没记这笔，已按第 12 节的表回退为 `#dfe1e5 / #b7bfca / #a4adba / #a1aab7`。

## 16. 单一光轴（2026-10-29）

### 16.1 问题

用户反馈「柔光效果没有做好」。以 1040×670、蓝强调色、六条目逐像素对拍，旧配方（第 11 节的两颗等强光斑）有三件事对不上「光」：

1. **纸底的光在压暗并偏蓝。** 左上采样 `#eaf2f6`（L\* 95.01、C 3.43）比底色 `#f6f6f4`（L\* 96.84、C 1.02）更暗也更蓝。主光 `oklch(from var(--accent) 0.9 calc(c * 0.55) h)` 在蓝强调色下超出 sRGB，序列化成 `color(srgb 0.932 0.996 1.065)`，蓝通道被裁到 1 而红绿留住，落在纸上就是一层青灰。
2. **两端等强，没有方向。** 墨底左上 L\* 11.60、右下 L\* 10.76，只差 0.84；纸底左上 95.01、右下 95.45，右下反而更亮。整窗读作一层均匀雾，看不出光从哪来。
3. **外沿大片同值。** 两级光斑在 8bit 上留下 50–100px 长的同一 RGB 平台，越靠近窗口边缘越像色块。

### 16.2 配方

用一条 132° 主轴替代两颗光斑：上端进光、下端收影，`background-attachment` 仍是 `fixed`，图标轨、标题栏、内容面与全屏阅读面继续共用一个坐标（第 13–15 节的口径不变）。

| 底色 | 上端光 | 中间停靠 | 下端影 |
| --- | --- | --- | --- |
| 纸 | `oklch(from var(--accent) 0.985 calc(c * 0.22) 72)` 52% | 同色 20% | `#e5e3df` 30% |
| 墨 | `color-mix(in srgb, var(--accent) 24%, #fff)` 5% | 同色 2.1% | `#000` 42% |
| 灰/砂 | 纸 `oklch(from var(--accent) 0.985 0 none)`、墨 `oklch(from var(--accent) 0.62 0 none)` | 同 | 同 |

停靠点为 `0% / 40% / 66% / 100%`；66% 处光已衰减到 0、影也从 0 起步，两段在这一点接续，不留台阶。

纸底的光按日光配：色相锁在 72°，彩度只取强调色的 0.22——换强调色改的是「冷暖的程度」，不改「这是不是纸」。强调色本身明度偏低，直接混进纸底只会把纸刷灰，第 15 节那层青灰就是这条路。墨底反过来：强调色在暗面读不出来，先把强调色抬到近白再以 5% 混入，右下换纯黑 42%，暗面才有方向。

菜单、popover、dock 继续吃 `--material-floating-field` 里那束 10% 柔光，光源换成 `--material-workspace-light` 并固定在 `0% 0%`。弹窗保留自己的 `--material-dialog-key/fill`：画布光已经是近白日光，18% 混在纸底只剩约 1ΔE，弹窗要靠第 12 节的独立档位才看得见。

### 16.3 实测

1040×670、蓝强调色，取内容面左上、留白中央、右下三点：

| 纸底 | 关闭 | 旧双光斑 | 单一光轴 |
| --- | --- | --- | --- |
| 左上 | `#f6f6f4`（96.84, 1.02） | `#eaf2f6`（95.01, 3.43） | `#faf6ed`（96.96, 4.80） |
| 中央 | `#f6f6f4`（96.84, 1.02） | `#f1f3f4`（95.72, 0.86） | `#f7f6f2`（96.86, 2.07） |
| 右下 | `#f6f6f4`（96.84, 1.02） | `#f0f2f6`（95.45, 2.16） | `#f1f0ed`（94.80, 1.58） |

| 墨底 | 关闭 | 旧双光斑 | 单一光轴 |
| --- | --- | --- | --- |
| 左上 | `#18191b`（8.73, 1.57） | `#1b1f25`（11.60, 4.68） | `#202124`（12.75, 2.20） |
| 中央 | `#18191b`（8.73, 1.57） | `#1a1b1f`（9.82, 2.99） | `#191a1c`（9.23, 1.56） |
| 右下 | `#18191b`（8.73, 1.57） | `#1b1d22`（10.76, 3.76） | `#0e0f10`（4.27, 0.64） |

括号内为 L\* 与彩度。纸底的「亮」由暖度承担：明度只升 0.12，彩度从 1.02 升到 4.80，方向由暗端 −2.04 落地。墨底明度铺开 8.5 L\*（12.75 → 4.27），卡片 16.06 仍高于最亮处，卡面继续比画布亮。1280×760 复测两端与 1040×670 相差 < 0.5 L\*。

12 强调色实拍（`theme-composition`）：纸底迎光端 ΔE 3.26–4.32、背光端 2.05；墨底 4.12–4.50 与 4.40。灰/砂的纸底迎光端只有 0.88——近白纸上没有可抬的明度，方向全靠暗端 2.05，这一档只守「暗端可见 + 上端亮于下端」，不要求迎光端达到 1.5。

### 16.4 断言变更

- `theme-composition.spec.ts`：保留「两端都有变化」（迎光端 > 1.5、背光端 > 1），删掉 `left / right ≥ 0.5` 与 `right / left ≥ 0.5` 两条对称契约——它们要求两端等强，正是 §16.1 第 2 条要消掉的雾。改成带符号的明度差 `lab(upperGlow).L - lab(lowerGlow).L > 1.5`，锁方向而不锁强度比。800/1920px 的 Codex 页改判 `/linear-gradient/`。
- `materials.spec.ts`：`.app-root` 与 `.app-root::before` 的图片断言由 `radial-gradient` 改为 `linear-gradient`；弹窗与锁屏仍断言 `radial-gradient`，它们的局部光场没动。
- `theme.spec.ts`、`workspace-layout.spec.ts`：画布图片断言同样换成 `linear-gradient`。
- `workspace-daylight.spec.ts`：`BEAMS` 改成 `FIELD = 'linear-gradient(132deg, C 0%, C 40%, C 66%, C 100%), none'`，颜色一律归一成 `C`，只锁形状与停靠点。

### 16.5 验证

- 6 个 spec、44 项 E2E 通过（3 workers、无重试）：`theme-composition` 与 `workspace-daylight` 7 项、`materials` 7 项、`theme` / `workspace-layout` / `appearance` 30 项。
- 卡面、输入、全屏书写在开关氛围与 12 强调色下逐字节不变（`glow.card === flat.card`、`composerBg`、输入底色沿用原断言）。
- 留白层次：纸底画布采样最大 ΔE 1.70、墨底 3.83（上限 6）；墨底中央 ΔE 0.84（上限 3）；墨底留白通道极差 ≤ 3（上限 8）。
- 证据：`.tmp/glow-audit/compare/`（旧/关/新 六帧）、`pair-paper.png` 与 `pair-ink.png`（上下对拍）、`ship/`（1040×670 与 1280×760 的工作区、卡面菜单、设置弹窗）。

### 16.6 已知取舍

- **8bit 台阶**：纸底留白最长同值连段 1–2px（平均连段 1.08–1.50）；墨底右下最暗处仍有 1 级台阶、连段最长 41px。不加噪点抖动——材质层首行契约写明「不添加颗粒纹理」，且旧配方在同一位置的同值连段更长。放大取证见 `ship/amp-ink-br.png`。
- **墨底右下角 L\* 4.27** 接近纯黑，是刻意的「离窗越远越暗」；卡片 16.06 不受影响。
- 弹窗内部、锁屏材质、设置里的主题缩略图不在本轮范围：前两者各用自己的 key/fill 与 `--material-lock-field`，缩略图固定关闭氛围，都不消费这条主轴。
- 代码改动只有 `src/styles/materials.css` 的工作区光场三块（光照 token、暗色覆盖、中性覆盖）；布局、组件与 `background-attachment` 均未动。

## 17. 白纸（2026-10-29）

### 17.1 问题

用户反馈「把纸色主题改一下，看久了特别不耐看，我还是喜欢白色」。不是某一处脏，而是整窗同一层暖色：画布 `#f6f6f4`、锁在 72° 色相 52% 的暖光、暖灰阴影 `#e5e3df` 30%、暖棕字 `#34322e / #5c5954 / #756f68`、暖灰描边与侧栏 `#e8e5e0 / #f4f2ee`。长看时整窗像罩了一层米色滤镜，任何内容都带旧纸感；而纸底明度已经在 96.8，没有可再抬的空间，继续加暖只会继续发黄。

### 17.2 配方

收掉整窗暖色，只保留「光有方向」：画布近白、内容面纯白、字色与描边全部中性，暖色只作为光场中段的一丝强调色出现。

| 槽 | 旧纸 | 新纸 |
| --- | --- | --- |
| `--bg` | `#f6f6f4` | `#f9f9fa` |
| `--panel-bg` | `#fcfcfc` | `#ffffff` |
| `--sunken / --fill / --hover / --active` | `#ececea / #eeeeed / #f3f3f2 / #e8e8e6` | `#f4f5f6 / #eff0f1 / #f1f2f4 / #eaebed` |
| `--border / --border-strong / --border-subtle / --border-hover` | `#e5e5e3 / #cdcdca / #efefed / #c1c1be` | `#e6e7e9 / #cfd1d4 / #f0f1f2 / #c1c3c7` |
| `--text / --text-secondary / --text-muted / --text-faint` | `#34322e / #5c5954 / #756f68 / #837d75` | `#1f2023 / #55585d / #74777c / #8c8f94` |
| `--badge-cat-bg / border / text` | `#f0ede6 / #e4dfd7 / #5c5954` | `#f1f2f3 / #e5e6e8 / #55585d` |
| `--sidebar-bg / --sidebar-hover` | `#f4f2ee / #eae7e1` | `#f7f8f9 / #eef0f1` |
| `--workspace-frame` | `#efefee` | `#eceef0` |

光场从四段改成五段（`materials.css:161`），停靠点 `0% / 30% / 52% / 70% / 100%`：

| 段 | 值 |
| --- | --- |
| 0–30% 迎光端 | `#ffffff`（不透明） |
| 52% 中段 | `color-mix(in srgb, var(--accent) 3%, #ffffff)` |
| 70% | `transparent` |
| 100% 背光端 | `color-mix(in srgb, #303338 4.5%, transparent)` |

中段必须用 sRGB 混色：近白处的 OKLCH 会被裁剪，色相跟着漂（§16.1 的青灰就是这条路），`color-mix` 才能让每个强调色都保留自己的色相。灰/砂把 `--material-workspace-tint` 换成 `#ffffff`，中性档不额外引入彩色。

### 17.3 实测

1040×670、蓝强调色、氛围开：迎光端 `#ffffff`（L\* 100）、留白下缘 `#f8f8fa`（97.9）、右下背光端 `#f1f1f2`（95.2），光轴明度差 4.8 L\*（门槛 1.5）。卡面 `#ffffff` 与画布 `#f9f9fa` 差 2.07ΔE，新增小记实底与画布同差；悬停行 `#f2f2f2` 与常态卡面差约 4.7ΔE（门槛 3.2–7.5）。

「纸底没有可抬的明度」在 §16.3 是灰/砂的特例，本轮成为全色相的常态：迎光端与底色只差 2.07ΔE，方向主要落在背光端（约 2.8ΔE）。`theme-composition` 的十二条强调色全部通过既有门槛。

### 17.4 断言与配套变更

- `workspace-themes.css:36`：纸底工作区色槽换成上表；`global.css` 的全局纸底块（锁屏、经典块）未动。
- `materials.css:161`：纸底五段光场；旧四段模板移入暗色块（`materials.css:206`），墨底像素不变；中性档只改 `--material-workspace-tint`。
- `CodexWorkspace.vue:104`：浅色卡面悬停档 `var(--text) 4.8% → 6%`。中性阴影不再像暖灰阴影那样压暗画布，4.8% 时悬停卡面与画布只剩 0.88ΔE；暗色块（`:119`）保持 4.8%。
- `theme.spec.ts:7`：`paper.bg → rgb(249, 249, 250)`、`paper.text → rgb(31, 32, 35)`。
- `settings.spec.ts:103`：禁用主按钮 `--fill → rgb(239, 240, 241)`、`--text-secondary → rgb(85, 88, 93)`。
- `appearance.spec.ts:143`：纸底预览行 `#fcfcfc → #ffffff`。
- `workspace-daylight.spec.ts:4`：光场断言按底色分档——纸五段、墨四段。
- `workspace-daylight-shots.mjs:14`：纸底基准 `['#f9f9fa', '#ffffff', '#eceef0', '#ffffff']`。

### 17.5 验证

- `theme-composition` 4/4（含 12 强调色 × 2 底色）、`theme` / `appearance` / `workspace-daylight` / `settings` 45/45 通过。
- 单测 872/872；`vue-tsc --noEmit` 0。
- 验收帧：`.tmp/glow-audit/paper/` 的 `current-ink.png`（旧）与 `after-ink / after-clay / after-notes / after-settings`（真令牌）。
- `workspace-daylight-shots.mjs` 在 `paper/ink: 主按钮对比度 3.77` 处中断。该值来自工作树里并行会话的 `--bg-workspace-primary` 抬亮档（`materials.css:200` 自注约 3.9:1），与本轮调色无关，未改。

### 17.6 已知取舍

- **锁屏与分享产物仍是暖纸。** `--lock-wash-*`（`#ffffff → #f4f2ee`）、用量海报的固定调色板、文件分享模板各自锁了旧值；锁页由并行会话维护，本轮不碰。
- **弹窗投影、滚动条、tip/toast 仍是全局纸底的暖灰 rgba**，出现时间短、单块面积小，肉眼不可辨，未改；若要彻底去暖，可再收一轮。
- **迎光端余量薄。** 纯白画布的物理上限就是 +2ΔE；再想拉大方向感只能加重右下阴影，那会把白纸重新压灰。
- **面板从 `#fcfcfc` 回到 `#ffffff`**，有意推翻 `workspace/04` 记的「收白档」：卡面与画布靠 2.07ΔE 加发丝描边分层，面板停在 `#fcfcfc` 会让每张卡带一层灰罩，与「白纸」不符。

## 18. 白纸的框与光（2026-10-29）

### 18.1 问题

装包后反馈两件事：「各个框、字体、控件等这些样式和背景色是不是要调整一下了呢」＋「柔光还需要调整，现在几乎看不到」。白纸 §17 只换了底色，组件仍吃纸底时代的填色与描边：画布 `#f9f9fa` 与白卡只差 2.07ΔE；输入槽 `--bg-input` 跟随画布（`materials.css:51`），落在白卡与白弹窗上等于隐形（2.11ΔE，只剩一圈描边）；柔光 3% 掺色在中段只剩 1.9ΔE，方向几乎读不出。

字号、字重、栅格不动：白底后字色对比度只涨不跌（正文 16.3:1、次级 7.1:1，白卡上计算），改的是「面」和「线」，不是字。

### 18.2 配方

组件整体深一档（`workspace-themes.css:36` 纸底块），白卡与画布之间重新拉开：

| 槽 | §17 | 本轮 |
| --- | --- | --- |
| `--bg` | `#f9f9fa` | `#f7f8fa` |
| `--sunken / --fill / --hover / --active` | `#f4f5f6 / #eff0f1 / #f1f2f4 / #eaebed` | `#f1f2f4 / #eceef0 / #eff1f3 / #e8eaed` |
| `--border / --border-strong / --border-subtle / --border-hover` | `#e6e7e9 / #cfd1d4 / #f0f1f2 / #c1c3c7` | `#e3e5e8 / #cbced2 / #edeff1 / #bdc1c6` |
| `--bg-input` | 跟随画布（`materials.css:51`） | `#f2f3f5`（聚焦仍回 `--panel-bg`） |

`--bg-input` 的覆盖面由 `--bg-canvas-input` 传递到表单输入、书写面、Codex 与文件分享的控制件；页栏搜索框不在此列（见 18.6）。字色、badge、侧栏、`--workspace-frame` 均未动。

光场（`materials.css:167`）：五段停靠点 `0% / 30% / 52% / 70% / 100%` 不变，只加深两端。

| 段 | §17 | 本轮 |
| --- | --- | --- |
| 52% 中段 | `color-mix(in srgb, var(--accent) 3%, #ffffff)` | `5%` |
| 100% 背光端 | `color-mix(in srgb, #303338 4.5%, transparent)` | `color-mix(in srgb, #262a30 8%, transparent)` |

悬停档跟着画布一起走（`CodexWorkspace.vue:106`）：浅底 `var(--text) 6% → 8%`。画布压深后 6% 悬停与柔光画布只剩 1.13ΔE（门槛 1.2），8% 后对画布 2.11ΔE、对白卡 6.25ΔE（上限 7.5）。暗色块（`:121`）保持 4.8%。

### 18.3 实测

1040×670、蓝强调色、氛围开、真令牌实拍：迎光端 `#ffffff`、中段 `#f5f8fb`（245,248,251）、右下背光端 `#e8e9eb`（232,233,235）。

| 对比 | §17 | 本轮 |
| --- | --- | --- |
| 白卡 × 画布中段 | 1.92ΔE | 3.07ΔE |
| 白卡 × 右下背光端 | 4.94ΔE | 7.75ΔE |
| 输入槽 × 白弹窗 | 2.11ΔE | 4.32ΔE |
| 发丝线 × 白卡 | 8.45ΔE | 9.29ΔE |
| 悬停卡面 × 柔光画布 | 1.13ΔE（6%） | 2.11ΔE（8%） |

`theme-composition` 的既有门槛（1.2 / 6 / 7.5）全部未放宽，靠配方本身通过。

### 18.4 断言与配套变更

- `theme.spec.ts:7`：`paper.bg → rgb(247, 248, 250)`。
- `settings.spec.ts:103`：禁用主按钮 `--fill → rgb(236, 238, 240)`。
- `workspace-daylight-shots.mjs:14`：纸底基准 `['#f7f8fa', '#ffffff', '#eceef0', '#ffffff']`。
- `workspace-daylight.spec.ts:4`：五段停靠点未变，断言不改。
- `appearance.spec.ts:143`：预览行取 `--panel-bg`，仍是 `#ffffff`，不改。
- `CodexWorkspace.vue:106`：悬停 8%，与 `theme-composition` 的 1.2ΔE 门槛联动。

### 18.5 验证

- `theme-composition` 4/4（12 强调色 × 2 底色，含悬停分层）；受影响 spec 206/206；悬停与按钮态补跑 15/15。
- 单测 872/872；`vue-tsc --noEmit` 0。
- 验收帧（真令牌、1040×670）：`.tmp/glow-audit/paper/` 的 `real-entries / real-dialog / real-notes.png`，与 `light-v0 / light-M / light-M-dialog / light-M-notes.png`（mock 三档）逐点对齐。
- `workspace-daylight-shots.mjs` 未整跑：并行会话的 `--bg-workspace-primary` 抬亮档仍让它在 `paper/ink: 主按钮对比度 3.77` 处中断（见 §17.5），与本轮无关。

### 18.6 已知取舍

- **页栏搜索框仍是白底。** `global.css:2295` 的既有配方是「白面 + 描边」，本轮靠画布压深把它反衬出来，没有改成灰槽；改成灰槽会和弹窗里 36px 白底输入档分叉。
- **子路径行与部分 Codex 控件仍走 `--bg-surface` 白底**，不在 `--bg-input` 的覆盖范围，弹窗内仍有一两处白槽。
- **墨底未采用灰槽。** `--bg-input` 在墨底继续跟随画布 `#18191b`，本轮只按纸底的白卡场景调。
- **柔光贴近日光上限。** 中段 5% 已是「白纸」身份下不把留白染灰的上限；再要方向感只能加深右下，等同把白纸压回灰纸。
- §17.2 / §17.4 的色值与行号由本节取代，§17 保留为白纸第一轮记录。

## 19. 只提亮的光（2026-10-29）

### 19.1 问题

装包后反馈「这个柔光效果看着很难受」，接着是「你不觉得这效果很丑吗？眼睛看着也不舒服」。§18 的五段光场不是颜色选错：白纸上先是一条斜向色带（52% 停靠点掺 5% 强调色，实测 a\* −2.5 / b\* +0.5），再在右下压 8% 冷灰（b\* −1.6，对白卡 7.75ΔE）。眼睛把中段读成色渍、把暗角读成脏角。换成完全中性的灰（白→`#eceef0`）后整窗的斜向亮度斜坡仍在，观感不改善；只在进光角掺色的折中（A3/A4/A5、D6/D9）实测内容区采样与不掺色完全相同——色被侧栏和页栏挡住，不可见。

结论：问题在大面积斜向渐变的占位，不在色相。§16 的「光有方向才像光」在两个端点都被放大到全窗时，白纸上只会剩一条带。

### 19.2 配方

纸底光场改为三段，只提亮、不压暗（`materials.css:167`）：

```
linear-gradient(132deg,
  var(--material-workspace-light) 0%,
  var(--material-workspace-light) 26%,
  transparent 74%)
```

| 段 | 值 |
| --- | --- |
| 0–26% | `#ffffff`（不透明） |
| 74% | `transparent`，之后就是画布本色 `#f7f8fa` |

74% 之后回到画布本色，全窗没有一处比画布更暗，结构上不可能再出现暗角；中段也不掺强调色，不会形成色带。强调色退出纸底光场，只留在控件（导航选中、焦点、主操作）。

- 删除 `--material-workspace-tint`、纸底的 `--material-workspace-shade / -strength`，以及灰/砂的 tint 覆盖；墨底的 `light / shade` 键与四段光场未动。
- 设置项说明「随强调色显示背景柔光」改为「为背景叠加一层方向柔光」（纸底不再随色，墨底仍然）。

### 19.3 实测

真令牌、纸底 celadon、氛围开、1040×670：

| 采样 | 值 | 相对氛围关闭 |
| --- | --- | --- |
| 左上迎光（main 左上角 +8/+6） | `#ffffff` | +2.67ΔE |
| 右下背光（main 右下 −12/−50） | `#f7f8fa`（247,248,250） | 0.00ΔE |
| 光轴明度 | 上 L\* 100.0 / 下 97.6 | 差 2.4（门槛 1.5） |
| 画布底缘四采样 | — | 0.00 / 0.00 / 0.00 / 0.00 |
| 中部 | — | 0.00ΔE |
| 悬停卡面 | — | 对常态卡 6.25ΔE、对画布 3.96ΔE |

1280×760 同上：迎光 +2.67ΔE、背光 0.00ΔE、画布底缘 1.56 / 0.84 / 0.00 / 0.00。卡面、输入槽、新增小记实底不受开关影响（`theme-composition` 逐项断言）。全屏阅读面沿对角线取样 255 → 247,248,250 单调下落，没有台阶，也没有第二段光源。

### 19.4 断言与配套变更

- `materials.css:167`：纸底三段光场；纸底 `--material-workspace-field` 不再引用 `--accent`。
- `workspace-daylight.spec.ts:4`：`paper → 'linear-gradient(132deg, C 0%, C 26%, C 74%), none'`。
- `theme-composition.spec.ts:116`：纸底背光端改为「回到画布本色」< 0.5ΔE；墨底保留背光端 > 1ΔE；迎光端 > 1.5ΔE 与「光轴自左上落向右下」> 1.5 L\* 不变。
- `workspace-layout.spec.ts:276`：换强调色时纸底光场必须不变（不再掺色），墨底必须变化。
- `SettingsDialog.vue:353`：说明文案改为「为背景叠加一层方向柔光」。
- `CodexWorkspace.vue:103`：悬停保持 8%，注释去掉「画布压深」前提。

### 19.5 验证

- `theme-composition` + `workspace-daylight` 7/7；`theme` / `appearance` / `materials` / `workspace-layout` / `workspace-layout-regressions` / `web-desktop-layout` 49 通过 + 2 失败——`workspace-layout` 的纸底换色断言按新不变量改写后 12/12，`web-desktop-layout:83` 是 Codex Web 屏蔽期已知红。
- 全量 e2e 654 passed / 27 skipped / 6 failed：5 条 Codex Web 已知红 + `web-access:256` 1 条 flaky（单跑 31 passed，过重试）。
- 单测 872/872；`vue-tsc --noEmit` 0；`check-theme-coverage` 只剩 Codex HUD 既有 3 处。
- 验收帧（真令牌、1040×670）：`.tmp/glow-audit/paper/real-l1-notes / real-l1-entries / real-l1-settings / real-l1-reading.png`。

### 19.6 已知取舍

- **纸底柔光与强调色彻底解耦。** 换强调色时纸底画布纹丝不动——色一出现在大面积留白上就会被读成渍。墨底仍随强调色。
- **方向感只剩 2.4 L\*。** 白纸的物理上限：画布 L\* 97.6，白光也只到 100；再想强方向只能压暗背光端，那就是被否掉的脏角。
- **空面上的斜坡仍在。** 全屏阅读这类大面积留白，亮部到画布的过渡横跨 48% 的光轴长度；实测单调无台阶，但细看仍是一层斜坡。
- **灰/砂在纸底不再需要专门分支**，tint 覆盖已删；墨底 light 覆盖保留。
- §17.2 / §18.2 / §18.4 的光场段与断言由本节取代，历史记录保留。

## 20. 中性白（2026-10-29）

### 20.1 问题

装包后用户发来实拍截图：「这不是白色吧」。截图里整窗只有一种平色，采样为 `#f7f8fa`（247,248,250，b\* −1.1），白卡 `#ffffff`、白页栏 `#ffffff` 把它反衬成一块冷灰。§18/§19 的纸底从来不是「白」，而是 Tailwind slate 式的冷灰族：每个中性槽都带 2–4 级蓝（`#f7f8fa / #f1f2f4 / #e3e5e8 / #f2f3f5`）。单看每级都近白，铺满整窗后眼睛只读出「冷」，于是白卡越白，画布越像蓝灰。

结论：这一轮不动光场、不动字号字重，只把纸底中性色退成 R=G=B，并把画布抬到白场上限。

### 20.2 配方

`workspace-themes.css:36` 纸底块整体换为中性灰（R=G=B）：

| 槽 | §18 | 本轮 |
| --- | --- | --- |
| `--bg` | `#f7f8fa` | `#fafafa` |
| `--sunken / --fill / --hover / --active` | `#f1f2f4 / #eceef0 / #eff1f3 / #e8eaed` | `#f5f5f5 / #f0f0f0 / #f3f3f3 / #ececec` |
| `--border / --border-strong / --border-subtle / --border-hover` | `#e3e5e8 / #cbced2 / #edeff1 / #bdc1c6` | `#e6e6e6 / #cfcfcf / #f0f0f0 / #c2c2c2` |
| `--bg-input` | `#f2f3f5` | `#f4f4f4` |
| `--sidebar-bg / --sidebar-hover` | `#f7f8f9 / #eef0f1` | `#fafafa / #f0f0f0` |
| `--workspace-frame` | `#eceef0` | `#f0f0f0` |
| `--badge-cat-bg / -border` | `#f1f2f3 / #e5e6e8` | `#f3f3f3 / #e8e8e8` |

字色 `--text / -secondary / -muted / -faint` 未动：它们是深灰，白底上只影响可读性，不构成大面积色偏。

**画布 `#fafafa` 是白场上限**：再白一级（`#fdfdfd`），白光柔光的迎光端与「新增小记靠色阶分层」都掉到 1.5ΔE 以下，两个既有门槛同时失效——白到那个程度，白纸上就既没有光也没有卡。

### 20.3 实测

纸底、olive、氛围开、1040×670，真令牌采样：

| 采样 | 值 | 相对纯白 |
| --- | --- | --- |
| 画布（右下背光端 / 侧栏 / 轨道） | `#fafafa`（250,250,250） | 1.73ΔE，b\* 0.0 |
| 迎光端（main 左上） | `#ffffff` | 0.00ΔE（对画布 +1.73ΔE） |
| 白卡 / 新增小记 / 页栏 | `#ffffff` | — |
| 输入槽 `#f4f4f4` × 画布 | — | 2.07ΔE |
| 发丝线 `#e6e6e6` × 白卡 | — | 8.7ΔE |
| 悬停卡面 `#ededed` × 白卡 / 画布 | — | 6.24 / 4.5ΔE |

对照：旧画布 `#f7f8fa` 对纯白 2.64ΔE，其中 1.1 全在 b\* 上——正是那 1.1 的蓝被读成「不是白」。

### 20.4 断言与配套变更

- `theme.spec.ts:7`：`paper.bg → rgb(250, 250, 250)`。
- `settings.spec.ts:103`：禁用主按钮 `--fill → rgb(240, 240, 240)`。
- `workspace-daylight-shots.mjs:14`：纸底基准 `['#fafafa', '#ffffff', '#f0f0f0', '#ffffff']`。
- 光场、`theme-composition` 门槛、`workspace-daylight` 停靠点、悬停 8% 均不改。

### 20.5 验证

- `theme-composition` 4/4（12 强调色 × 2 底色）：迎光 1.73ΔE 仍过 1.5 门槛，新增小记 × 画布 1.73ΔE 仍过 1 门槛，悬停 3.2–7.5 区间内。
- `workspace-daylight` / `theme` / `settings` / `appearance` / `materials` 52/52；`workspace-layout` / `workspace-layout-regressions` / `navigation` / `empty-content` / `ui-audit-fixes` 41/41。
- 验收帧（真令牌、1040×670）：`.tmp/glow-audit/paper/final-notes-on / final-entries-on / final-settings-on.png`；候选对照 `neutral-r1-now / n1 / n2 / n3.png`。

### 20.6 已知取舍

- **白度有硬上限。** 画布每往白抬一级，白光柔光与新增小记的色阶就少一截；`#fafafa` 是两条 1.5ΔE 门槛的交点。要纯白画布就必须同时废掉纸底柔光、并让白卡只靠描边+投影分层。
- **字色仍是冷调深灰**（`#1f2023 / #55585d`）。深灰字在大面积留白上不构成色偏，且改字色会牵动全部对比度锚点；本轮不动。
- **墨底及其余主题不受影响**，本轮只改纸底块。
- §18.2 / §18.4 的纸底色值由本节取代，§19 的光场继续有效。

## 21. 与对话框同一套材质（2026-10-29）

### 21.1 问题

装包后先收到「柔光没有起效果」，再看实拍：「柔光效果还是不行，我觉得对话框里的效果都比首页的好。是不是哪里有问题？」

不是坏了。§19/§20 把纸底光场压成「只提亮」，而白纸上明度这条路已经到顶：画布 `#fafafa` 到纯白只有 1.73ΔE（255→250），铺满整窗后肉眼几乎读不出来。对话框看着更好，不是因为更亮——两者的明度差是同一量级——而是它的两角色光掺了强调色，有色相变化可读。

首页还多一层遮挡：卡片占掉内容区大半，光只铺在画布上，能看见的只剩卡片缝。§19 的结论「色一出现在大面积留白上就会被读成渍」只对整窗斜向渐变成立；把色收在两个角、不构成色带，就不适用。

### 21.2 配方

`materials.css:165` 把对话框的两角色光上提为工作区共享令牌，弹窗与画布从此同一色温、同一浓度（18% / 14%）：

```
--material-key:  oklch(from var(--accent) 0.9 calc(c * 0.55) h)
--material-fill: oklch(from var(--accent) 0.92 calc(c * 0.5) calc(h + 24))
--material-workspace-field:
  radial-gradient(ellipse 52% 54% at 0% 0%,   color-mix(in srgb, var(--material-key)  18%, transparent), transparent 100%),
  radial-gradient(ellipse 52% 54% at 100% 100%, color-mix(in srgb, var(--material-fill) 14%, transparent), transparent 100%)
```

- **尺寸按物理半径折算。** 对话框的 `78% 72%` 是它自己 520px 的面（半径约 405px）；照搬到 1040px 的工作区就是 810px，空页中段会被整片染色。折算到工作区取 `52% 54%`，光守两个角。40% 档实测连小记首屏的卡面都退回纯白，太小。
- **卡面吃同一层光。** `--material-surface-field` 只在纸底 + 氛围开时等于画布光场（`materials.css:242`）；`global.css:2531` 一条 `:root[data-layout="workspace"] .workspace-main :is(.memo, .composer, .grid-card, .mfa-card, .rcard, .tn-card, .clean-group-card, .rowlist)` 把光铺到卡面，`background-attachment: fixed` 让卡片滚动时穿过同一片视口光，而不是各自带一条渐变。墨底保持 `none`——深底再加一层彩光会把卡面糊成色块。
- 卡面的 hover / selected 从 `background:` 简写改 `background-color:`，否则会把光一起重置掉。
- **导轨对齐视口。** `.app-root::before`（`CodexWorkspace.vue:80`）不写 `fixed`（会被提升到弹窗遮罩之上），改用 `background-size: 100vw 100vh` + 左上对齐；侧栏本体（`Sidebar.vue:69`，web 运行时唯一可见的那层）同样处理。两侧从此与画布采样同一坐标。
- 设置说明回到「随强调色为背景叠加柔光」（`SettingsDialog.vue:353`）——两种底色的光现在都由强调色推导。

### 21.3 实测

纸底 olive、1040×670、真令牌，相对氛围关闭：

| 采样 | 值 | ΔE |
| --- | --- | --- |
| 内容区左上（main +8/+6） | `247,247,241` | 3.28 |
| 内容区右下（main −12/−50） | `245,248,244` | 2.52 |
| 图标轨（rail 右缘、12% 高处） | `248,248,244` | 2.19 |
| 画布底缘 90% 处 | `246,249,245` | 2.40 |
| 新增小记（左缘中点） | `253,254,251` | 1.64 |
| 卡片右下角 | `254,254,253` | 0.63 |
| 中部（卡片上） | `255,255,255` | 0.00 |

indigo：两角 2.90 / 2.96，中部 0.00；graphite：1.17 / 1.14，中部 0.00（中性分支只剩明暗，门槛随分支放宽）。两角都过 1.5，中部干净；光斑外的卡片区域仍是纯白。

### 21.4 断言与配套变更

- `theme-composition.spec.ts`：纸底分支整体改写——两角可见 > 1.5、色差通道极差 ≥ 2（中性档 ≤ 5）、中部 < 1.5、卡片 `background-image` 为 `radial-gradient` 且 `background-attachment` 全为 `fixed`、卡片底色 `backgroundColor` 不随采光变化、新增小记 > 1.5（中性档 0.8）。墨底分支保持实底与光轴明度差。
- `workspace-daylight.spec.ts:6`：纸底期望改为 `radial-gradient(52% 54% at 0% 0%, C, C 100%), radial-gradient(52% 54% at 100% 100%, C, C 100%), none`。
- `workspace-layout.spec.ts:252`：两种底色换强调色都必须换光；纸底卡片 image 为 `radial-gradient` 且固定；关氛围后卡片 image 回到 `none`、底色不变。
- `materials.spec.ts:78` / `theme.spec.ts:50`：`.app-root`、`::before` 与 `.workspace-main` 的期望从 `linear-gradient` 改为 `radial-gradient`。
- `scripts/workspace-daylight-shots.mjs` 未改：它读的是 `--bg / --panel-bg / --workspace-frame / --workspace-light` 四个令牌，本轮没动。

### 21.5 验证

- `theme-composition` 4/4（12 强调色 × 2 底色）、`workspace-daylight` 7/7、`workspace-layout` 12/12。
- `materials / theme / appearance / settings` 49；`workspace-layout-regressions / web-desktop-layout / navigation / empty-content / ui-audit-fixes` 35。
- 单测 872/872；`vue-tsc --noEmit` 0；`check-theme-coverage` 只剩 Codex HUD 既有 3 处。
- `design-audit paper-olive`：28 条发现全部是既有 `--text-muted` 4.12–4.49 豁免档，无色值变化。
- 验收帧（真令牌）：`.tmp/glow-audit/final/` 的 `paper|ink × notes / entries / files / reading / settings / lock`，空页 `paper-{entries,notes,files}-empty-{1040,1920}.png`；定档对照 `paper/land-v2-{40x44,52x54}-{notes,entries}.png`。

### 21.6 已知取舍

- **冷色强调色会带一层淡紫。** 靛/紫的左上角实测 `245,246,251`，是「与对话框逐位同配方」的直接结果；要压掉它就得让工作区单独降彩度，那弹窗与画布就不再是同一套材质。
- **光按窗口比例放大。** 1920 宽时两角的半径各约 1000px，铺得比 1040 更开（中部仍是白的）。要恒定物理半径得改成 px/clamp，本轮按对话框的百分比口径保留。
- **小记首屏的卡片基本不受光**（卡片从 y=312 起，落在 54% 竖向半径之外的尾端，实测 0.5ΔE）；纸底的可见光落在页头、新增小记与首屏上方的收藏/快捷卡上。想照亮更深的卡片只能放大椭圆，空页就会重新被染色。
- **纸底卡片不再是纯实底**（仅限氛围开）。底色本身不变，文字对比度不受影响；墨底仍保持实底。
- §19.4 / §20.4 里「纸底光场不掺强调色」「背光端回到画布」两条断言由本节取代，历史记录保留。



