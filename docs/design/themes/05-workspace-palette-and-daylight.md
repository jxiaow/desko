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
