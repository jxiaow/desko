# 主题轴改造：accent 挂极性 + 接入 sand/slate/rose

状态：**已落地**（第 7 节三处 mock 已拍板，结论见第 8 节；代码/工装/e2e 全绿，剩全量出图对拍与提交）。
起因：外部模型按 `00-brief.md` 交回一套扩展稿（暖砂 sand / 玄板 slate 两底色 + amber/sage/rose 三强调色），核对后判：底色两稿可用，accent 三稿只有一档是新的；同时暴露出现有双轴契约的扩展成本问题。

## 1. 结论

三件事一次做完：

1. **accent 覆盖层的选择器从「底色 × accent」改成「极性 × accent」**：`[data-theme=x][data-accent=y]` → `[data-base="light|dark"][data-accent=y]`。块数从 `底色数 × accent数` 变成 `2 × accent数`，加底色不再补块。
2. **接入两新底色** `sand`（暖砂，浅）/ `slate`（玄板，深）—— 各 96 槽，交付稿已填满、键集逐字对齐。
3. **接入一档新强调色** `rose`（暮瑰红）—— amber（琥珀）与 sage（鼠尾草）判为撞色，**不收**。

改完是 **4 底色 × 5 accent = 20 组合**，而 CSS 里的 accent 块只有 **10 块**（2 极性 × 5 档）；不改结构的话要写 **20 块**，且以后每加一套底色再补 5 块。

## 2. 交付物判决（`scripts/theme-intake.mjs` 实测）

契约层全过：

| 项 | 结果 |
| --- | --- |
| sand / slate 键集 | 各 96 槽填满，逐字对得上基准，无自创、无省略 |
| accent 块 6 个（amber/sage/rose × 纸墨） | 各 17 槽，全在白名单内，无 `var()` |
| `--font-ui` / `--font-mono` | 与现值逐字相同（这两槽在底色层里是抄常量，不是设计项） |
| 面族阶梯 | 七面相对卡面的 ΔL\* **方向与现值全同序**，没有翻侧；每面比现值离卡面远 0.5–1.9 级＝分层稍强，属口味 |

对比度层没有硬伤（`·` 为达标，`!` 为低于现值但差距 <1.0）：

```
sand（浅，对 paper 现值判）  面：sunken 93.1 → sidebar 91.3 → bg 96.2 → hover 94.8 → panel 97.6 → fill 90.3 → active 91.4
  ! --text 12.01（现 12.48）  ! --text-secondary/url 7.91（现 8.37）  ! --text-muted 5.06（现 5.28）
  · --text-faint 2.95（现 2.96，装饰档持平）  · --danger 5.53（现 5.72）  · --success 5.29  · --warning 4.68
  · 语法色最低 --code-com 4.58（现 4.77）
slate（深，对 ink 现值判）    面：sunken 7.7 → sidebar 8.7 → bg 10.1 → panel 13.5 → hover 16.8 → fill 17.8 → active 22.8
  · --text 12.64  · secondary 9.41  · muted 7.35  · faint 5.93   ← 深色小字 ≥5.8 底线全过，secondary/url 还优于 ink 现值
  · --danger 5.69  ! --success 7.03（现 7.33）  · --warning 7.43
```

sand 那一串 `!` 是**分母变了**不是字变淡：sand 卡面 L\*97.6，比 paper 的 99.0 本来就暗 1.4 级。

**真正拦下的是撞色**（新档主色与现有档主色的 RGB 距离，阈值 40）：

| 新档 | 最近邻 | 纸底距离 | 墨底距离 |
| --- | --- | --- | --- |
| amber `#92572b` / `#d29d66` | clay `#9a5b33` / `#d09a6a` | **12** | **5** |
| sage `#3d6c55` / `#7bb396` | celadon `#3d7355` / `#7fb89a` | **7** | **8** |
| rose `#984c64` / `#d78aa0` | clay | 51 | 57 |

amber 和 clay 是一个色相的两种拼写，sage 与 celadon 更近——墨底上距离 5–8，等于设置里摆两颗看不出区别的色丸。rose 站得住。

另外两稿的**缺省主色各写了一套**：sand 内置 `#425b76`（灰蓝）、slate 内置 `#80a4c9`（冰蓝），都不等于现墨蓝 `#3d5a80` / `#89a8cd`。同一档「墨蓝」在四套底色上会有四个值——这是品牌色失控，不是设计自由度。本次按缺省族回墨蓝处理，那两组值丢弃。

## 3. 为什么必须改结构（不改的代价）

现契约：`[data-theme=x][data-accent=y]` 覆盖层 × `底色数 × accent数` 块（`src/styles/global.css:395-472`），守护脚本按这张全矩阵要求齐块（`scripts/check-theme-coverage.mjs:139`）。

三个结构性毛病：

1. **块数乘法爆炸**：4 底色 × 5 accent = 20 块，10 块是本轮新增的重复劳动——amber/sage/rose 在 sand 上和 paper 上的差别只是面板白一点/暖一点。
2. **accent 值是"对某一底色调的"**，交付稿自己就说明了这一点：sand/slate 各自重写了 accent 族 17 槽缺省值，导致第 2 节末尾那个品牌色漂移。
3. **深档其实不需要按底色分**：dark 档整族走半透明（soft α15–16%、light α26–28%、ring α32%、selection α30%），α 合成天然是"叠在当前面上"，换一张面自动跟着变。真正按底色分的只有浅档那几个**掺白实色**。

也就是说，现有多出来的那一维（底色）本来就只有一个极性差异，把它显式化就是正确的轴。

## 4. 新契约（三层职责）

```
底色层  [data-theme="paper|ink|sand|slate"]      96 槽全填（含 accent 族 17 槽的缺省兜底）
accent 层 [data-base="light|dark"][data-accent=x] 只填 accent 族，块数 = 2 × accent 档数
别名层  :root                                     var()/color-mix() 派生，不变
```

- `<html>` 上多挂一个 `data-base`，值由 `src/services/theme.ts` 从 `POLARITY[theme]` 映射，用户**不能**单独设置它——它是底色的属性，不是第三个轴，不进设置项、不落盘。
- **解禁一条、保留一条**：底色层照旧禁 `var()`；accent 层**允许**只读引用底色槽（`var(--panel-bg)`）。这不是放松纪律——accent 层原本必须按底色分块才能引用底色，极性轴之后它引用的已经是"当前那张面"，这正是自适应的机制。
- 缺省兜底族按极性统一回墨蓝现值（sand/slate 的 accent 族不再自带主色）。

**洗底族三个槽改由 color-mix 落到当前卡面**：`--accent-soft`、`--accent-light`、`--badge-ver-bg`。

方案 A（推荐）：accent 层里写成 `color-mix(in srgb, var(--accent) 11%, var(--panel-bg))`（light 档）/ α 混（dark 档），配比按极性等两个值给。这样 sand 上的洗底 ΔL\* 回到 −5.1 左右，与纸底同幅；代价是**纸底现值会微动**——`#e8eef4` 经 color-mix 复算约 `#e5ecf1`，ΔL\* ≤1，要在 mock 里认一下。
方案 A′（回退）：light 档洗底保留实色，sand 上洗底幅度从 5.1 收到 3.7 级——仍看得见，只是淡一档，代价是这套值永远绑在白面板上。

## 5. 跨极性复用的实测代价（数值已算，不是估计）

五档主色在"同极性另一张卡面"上的对比度：

| 档 | paper `#fcfcfc` | sand `#faf8f3` | 落差 |
| --- | --- | --- | --- |
| 墨蓝 `#3d5a80` | 6.89 | 6.66 | −0.23 |
| 青瓷 `#3d7355` | 5.41 | 5.23 | −0.18 |
| 赭石 `#9a5b33` | 5.22 | 5.05 | −0.17 |
| 紫罗 `#5f62b8` | 5.21 | 5.04 | −0.17 |
| 暮瑰 `#984c64` | 5.76 | 5.57 | −0.19 |

| 档 | ink `#22211e` | slate `#1f2328` | 落差 |
| --- | --- | --- | --- |
| 墨蓝 `#89a8cd` | 6.55 | 6.43 | −0.12 |
| 青瓷 `#7fb89a` | 7.07 | 6.94 | −0.13 |
| 赭石 `#d09a6a` | 6.53 | 6.40 | −0.13 |
| 紫罗 `#9ba0e8` | 6.58 | 6.46 | −0.12 |
| 暮瑰 `#d78aa0` | 6.16 | 6.04 | −0.12 |

主色全部仍 ≥5.0（浅）/ ≥6.0（深），复用不塌。深档 α 洗底叠到 slate 与叠到 ink 的 L\* 差 0.3–0.8，同一档。**唯一要盯的就是第 4 节那三个掺白实色。**

## 6. 改动清单（逐文件）

1. `src/styles/global.css`
   - 新增 `[data-theme="sand"]` / `[data-theme="slate"]` 两块，各 96 槽，取交付稿值，其中 accent 族 17 槽替换成按极性的墨蓝兜底值
   - accent 层选择器 8 块改成 `[data-base=…][data-accent=…]`，并新增 rose 两档；洗底族三个槽按方案 A 改 color-mix
   - 层注释（`:391`）与底色块注释里的"8 组合"说法随之改账
2. `src/services/theme.ts`
   - `ThemeId` 加 `'sand' | 'slate'`、`AccentId` 加 `'rose'`；`THEMES` 补 2 条 `prev`（7 字段全是从 CSS 抄的字面量，最易漏）、`ACCENTS` 补 1 条 `dot`/`dotInk`
   - 新增 `POLARITY: Record<ThemeId, 'light' | 'dark'>`，`applyTheme()` 挂第三个属性
   - 设置→外观的底色卡从 2 张变 4 张（`SettingsDialog.vue` 迭代 `THEMES` 驱动，不用改组件）
3. `scripts/check-theme-coverage.mjs` —— `BASES` / `ACCENTS` 名单、`ACCENT_RE`（`:56`）改极性选择器、`comboKeys`（`:139`）改 `极性 × accent`、新增"每套底色必须在 `POLARITY` 里有极性"的核对；`var()` 禁令只留底色层
4. `scripts/theme-tokens-dump.mjs` —— `BASES`/`ACCENTS` 名单、第 2 节列数、第 3 节矩阵按极性出、第 8 节成本账重写
5. `scripts/theme-intake.mjs` —— 基准仍从 dump 的 paper/ink 两列取，新底色靠交付稿自身；第 3 节完整性改成极性判据
6. `e2e/specs/theme.spec.ts` —— `BASES` 补 sand/slate 的 `rgb(...)` 计算值锚点（跑一次真机取值，别按 hex 猜）、`ACCENT_HEX` 按极性归并、底色卡计数 2→4、色丸 4→5、八组轮换（`:129-150`）改 4×5=20、旧 ID 迁移与 toast 翻面用例值不变
7. 出图脚本组合名 —— `theme-shots.mjs` / `theme-compare.mjs` / `design-audit.mjs` / `color-sweep.mjs` 的 SEED 与组合名单

**不动 Rust**：`src-tauri/src/commands/settings.rs:14` 是键白名单，`theme` / `accent` 已在列。

## 7. 要用 mock 拍板的三处

按老规矩，主观视觉先出真 token 的高保真帧再改代码（`scripts/mock-build.mjs` + `mock-frames.mjs`）：

1. **sand 的四栏并排**：纸 / 暖砂同 accent 同屏，看洗底幅度、行悬停反馈、以及暖面上墨蓝主钮的精神度——顺便验 sand 那套偏黄的 `--tip-bg`/`--toast-bg` 是否跟纸底一致。
2. **slate 的四栏并排**：墨 / 玄板同屏，重点看赭石和青瓷在冷灰底上是否比在暖墨底上更糊（第 5 节的数字只看卡面对比，没看彩度知觉）。
3. **rose 在四套底色上的色丸 + 主钮 + tab 下划线**：玫瑰红在 sand 暖底上会和底"融成一片粉"吗，这条只能看图。

## 8. mock 实况与三处拍板（已定，2026-10-12）

跑法与产物：`scripts/theme-candidate-shots.mjs` 在真 app（e2e mock 后端）上注入候选令牌块，11 组 × 3 屏 = 33 帧，拼成四块对拍板在 `design/polarity-shots/`——`board-light-entries.png`（纸 vs 暖砂，含洗底 A/A′ 两版）、`board-dark-entries.png`（墨 vs 玄板 × 四档 accent）、`board-form.png`（弹窗控件）、`board-editor.png`（书写态语法色）。命令：`PW_CHANNEL=msedge node scripts/theme-candidate-shots.mjs <artifact.txt>`，只重拼板加 `--boards`。落地后 sand/slate 已进 theme.ts，脚本不再注入底色块、只按 `POLARITY` 搬 accent 层——同一份 COMBOS 现在拍的是发货态。

看图结论：

1. **slate 成立**：暖墨底调出的四档 accent 搬到冷灰底上，主钮、tab 下划线、分类徽标全部站得住；卡面↔下陷 ΔL\*5.8（ink 是 4.9），分层比现墨底还清楚一档。
2. **sand 成立但有一处露馅**：见第 3 点。
3. **洗底真正的问题不在卡面，在侧栏**：`--sidebar-active` 是 `var(--accent-soft)` 的别名，而 soft 是按**卡面**切的浅洗。纸底侧栏 L\*93.4、soft L\*93.9，激活行是"比侧栏亮一丝"的浮起感，看着没事；sand 侧栏 L\*91.3 更暗更黄，同一块冷蓝洗底就变成**一块凉斑**。
   - A′（掺白实色直接搬）：凉斑明显，色相与暖底打架。
   - A（洗底改 `color-mix` 到 `var(--panel-bg)`）：凉斑洗成中性灰，但在侧栏上几乎看不见激活行了（洗底与侧栏 L\* 持平）。
   - 两条都不是正解。正解是把 `--sidebar-active` 从"复用卡面洗底"改成按侧栏底现切——副作用是纸底现状会从"亮一丝"翻成"暗一档"，属可见改动，要单独拍。
4. **rose 在 sand 上最弱**：五档里 rose 的浅档洗底最浅（对 sand 卡面 ΔL\*−3.3，其余 −3.7～−3.9），侧栏激活行基本不出。要么 rose 的 soft/light 两槽单独压深一档，要么接受"暖砂配暮瑰偏柔"。

**三处拍板（用户逐条点头，均取推荐项）**：

1. **侧栏另切一档**：别名层新增 `[data-base="light"]` 块，`--sidebar-active` 改按侧栏底现切——`color-mix(in srgb, var(--accent) 15%, var(--sidebar-bg))`。15% 是按"与 `--sidebar-hover` 拉开 ΔL\* 5 级"解出来的，不是照搬卡面的 11%。暗极性沿用 α 洗不动：α 合成与 `color-mix` 15% 在数值上同式，这一改动对 ink/slate 是**逐像素无操作**。
2. **纸底跟着翻**：上一条在纸底同样可见——激活行由"比侧栏亮一丝"翻成"暗一档"，用户明确允许 shipped 外观变这一处。卡面侧的洗底族（`--accent-soft` / `--accent-light` / `--badge-ver-bg`）保留第 4 节的 A′ 方案（掺白实色），没有改成 color-mix 落卡面：A 版把侧栏凉斑洗成中性灰的同时也把激活行洗没了，正解在侧栏不在卡面。
3. **rose 压深一档**：浅极性 `--accent-soft` / `--badge-ver-bg` 从 `#f7ecf0` 压到 `#f6eaee`，对纸卡面 ΔL\* 由 −4.6 到 −5.2、对砂卡面由 −3.3 到 −3.9，与另四档同幅。`--accent-light` 本就在带内，不动。

## 9. 实施顺序与验收

顺序：mock 三帧拍板 → global.css（底色块 + accent 层改造）→ theme.ts → 守护脚本 → dump 重导出 → e2e 锚点 → 出图脚本 → 全量对拍。

```bash
node scripts/check-theme-coverage.mjs
node scripts/theme-tokens-dump.mjs --out "C:/Code/Codespace/desko/docs/design/themes/01-token-inventory.md"
PW_CHANNEL=msedge npx playwright test e2e/specs/theme.spec.ts
PW_CHANNEL=msedge node scripts/theme-shots.mjs && node scripts/theme-compare.mjs
PW_CHANNEL=msedge node scripts/color-sweep.mjs
```

密集列表页的真机截图是终判——色值表自洽但落到 20 行一屏上糊掉，是这类改动最常见的失败方式。

## 10. 落地时多出来的三处（第 6 节清单之外）

第 6 节的清单是按"令牌层"列的，动手时另有三处会跟着极性轴走，漏一处就是 sand/slate 上的补丁：

1. **按底色分叉的非令牌样式**：全仓只剩两处 `[data-theme=…]` 的选美规则——`.grid-card:hover` 的填充档（亮吃 `--sunken`、暗吃 `--hover`）与 `.grid-slot--icon` 的 favicon 亮底垫（只有暗极性要）。都改成 `[data-base=…]`；`MfaModule.vue` 的同一条早先已经改过。判据：这类规则表达的从来是"亮底还是暗底"，不是"哪一套底色"。
2. **出图脚本的组合名单**：`theme-shots` / `theme-compare` / `dialog-shots` / `color-sweep` / `icon-board` / `theme-candidate-shots` 原先各自抄了一份 8 组名单，现统一由 `scripts/lib/theme-tokens.mjs` 的 `themeCombos()` 从 theme.ts 现读（20 组）；`color-sweep` 的面族台阶打印条件从"paper-ink / ink-ink 两个 id"改成"accent 为墨蓝的每套底色"；`ink-ladder.mjs` 的 accent 复核正则跟着改到 `data-base="dark"`。
   - 顺带修回一处旧失修：`theme-shots.mjs` 解锁后直接在落地页找 `.entry-card`，而落地页自「小记作首页」起已是小记——脚本自 09-29 起就在第一组上崩。现改成点 `.nav-item[href="/entries"]`，并补上"开跑清旧帧 + 收尾逐名核对 12 屏"的缺帧闸门（目录里那批 `white-*` / `linear-dark-*` 退役 id 帧就是没人核对才留下的）。
3. **`mock-build.mjs`**：摘 token 块的选择器集合改成极性键，并额外摘 `[data-base="light"]`（否则 mock 上的侧栏激活行还是旧的卡面洗底）；老 mock-src 只挂 `data-theme`，构建时按 `POLARITY` 自动补 `data-base`，不回头改历史稿。

## 11. 本轮明确不做

- amber / sage 两档：撞色，不收。若要暖橙与灰绿的色相方向，得让外部模型在拉开距离（≥40）的前提下重推，不是在现值上改两个字节。
- sand / slate 自带的缺省主色（`#425b76` / `#80a4c9`）：丢弃，缺省族按极性回墨蓝。
- 尺度层：不碰。别名层只动 `--sidebar-active` 一处（第 8 节拍板 1），其余派生槽照旧。
- 不把 `data-base` 变成用户可选设置。

## 12. 后续轮（2026-10-12）：砂 → 雪

同一套机器跑的第二轮，只是把浅色轴的一档换掉——外部模型交回一份 96 槽浅极性底稿（冷调近白、文字重一档），用户拍板**替换** `sand` 而不是新增第五底。

- 机制上零新账：`POLARITY` 登记一行、global.css 换一块、theme.ts 的 `THEMES` 换条目，10 块 accent 与 20 组合矩阵一动不动。这正是极性轴想要的性质——换底色不再触发 accent 轮。
- 旧 id 进 `LEGACY_THEME`：`sand: 'snow'`。库里存着「砂」的选择就近落到雪，不会被 `readAppearance` 回落成纸底。
- 交付稿自带的 accent 族（`#2b6cb0` 一族 17 槽）照第 11 节的老规矩丢弃，缺省族回亮极性墨蓝。要那个更亮的蓝得当**第六档 accent** 重出一稿（亮/暗两极 × 17 槽），不是塞在底色块里。
- 纯白禁令放宽一档：卡面上限从「纸底 252」改成「每通道 ≤254」，255 仍然不许。写进 `00-brief.md` 硬约束 5 与清单第 10 节，`theme-intake.mjs` 同步这条闸门。
- 新增两条 intake 判据：卡面纯白（拦下，每通道 ≤254）、与同极已发货底色的面族平均 ΔRGB（只报数不拦，锚点见第 13 节）。
- 工装顺手收口：`check-theme-coverage.mjs` 与 `theme-tokens-dump.mjs` 的底色/accent 名单改为从 theme.ts 现读（原先各抄一份，换档必漏），`theme-candidate-shots.mjs` 的对拍集合与拼板改为按交付物里的候选底色自动推导（原先硬编 11 组上一轮的决定）。

## 13. 同一轮的回头账（2026-10-13）：雪从「亮半档」重解成「高对比冷白」

照稿落地的第一版雪底（卡面 `#fefefe` / 画布 `#fafaf9` / 下陷 `#f3f3f2`）过了 coverage、过了 e2e 锚点、数值表自洽，用户实机看一眼的结论是**「和纸基本一样」**。逐槽实测坐实：面族七槽全体只提亮 ΔL\* +0.3～+1.3（平均 ΔRGB **3.9**），差异其实落在非面族（正文 ΔL\* −3.8、`--border-strong` ΔRGB 9.3、danger/success 更饱和）——密集列表上这些读作"清楚了一点"，不读作"换了张底"。

重解的取向：**卡面不动，分层全部往下要**。

| 槽 | 纸（暖） | 雪 v1 | 雪 v2 | v2 对卡面 ΔL\*（纸） |
| --- | --- | --- | --- | --- |
| `--panel-bg` | fcfcfc | fefefe | **fefefe** | 0（−0.8） |
| `--bg` | f8f8f7 | fafaf9 | **f2f4f5** | −3.6（−1.4） |
| `--sunken` | f1f1f0 | f3f3f2 | **e3e6e9** | −8.5（−3.8） |
| `--fill` | eaeae8 | ececeb | **d8dce0** | −12.1（−6.3） |
| `--sidebar-bg` | edecea | f0f0ee | **e5e8ec** | −7.8（−5.5） |
| `--border` | e6e6e4 | e4e4e2 | **dadfe2** | −11.1（−7.7） |
| `--text` | 333230 | 2a2a29 | **1f2122** | 16.03:1（12.48:1） |

- 结果：与纸底的面族平均 ΔRGB **3.9 → 10.5**，正好落在墨↔岩那一档，"一档独立底色"的刻度由此定在 10。
- 色温同时翻面：纸的灰阶 R>B（暖），雪翻成 B>R（冷中性），toast/气泡那颗暖黑也从 `#232322` 改成 `#1f2326`，免得冷白上顶着一粒暖黑。
- **压深下陷面的连带账**：`--sunken` 深了两档，吃在它上面的 code 族对比跟着掉，`--code-type/--code-fn/--code-com/--ft-unk` 按色相保比例压暗才顶回 ≥4.5。改面族不能只算七个面。
- 卡面 254 的上限、`--hover` 与卡面 ≈5 级差、`--panel-bg` 明显高于 `--sunken` 这三条老约束一条没破——v2 是把差往大里做，不是往小里做。
- intake 的 ΔRGB 提示保留不拦，但注释里写死了这段来历：**低于 8 的浅色底实在机上不构成新方向**，交稿方若要它得自己说清为什么。

### 13.1 同日的第二笔账：冷度走错了轴（青 → 蓝）

v2 落上去用户实机反馈「底色偏青涩」。Lab 实测坐实：v2 的灰阶 a\* 一路为负（`--border` a\*=−1.13、`--border-strong` −1.44、`--text-muted` −1.06、`--text-faint` −1.01、`--fill` −0.61），b\* 才 −2 出头——**绿分量和蓝分量差不多对半**，所以读作"青"而不是"冷"。病根是把冷灰写成 R&lt;G&lt;B 单调递增（G 抬得相对比 B 还多）。

对照被认可为"冷板岩"的 `slate`：它的 a\* 全在 0 附近（面族/描边/文字一起扫是 −0.58～+0.49），冷度**全部**压在 b\*（−3.1～−6.5）。配方差异就是这一条轴。

- 修法：明度阶梯一格不动（逐槽 ΔL\*<0.2），把冷度重解回蓝轴——`a*≈0`、`b*` −1.7（画布）到 −3.4（描边/侧栏悬停）。求解式：给定 L\* 与目标 b\*、强制 a\*=0，反解 sRGB。
- 卡面回中性 `#fefefe`：解出来的 `#fefeff` 会把 B 通道顶到 255，破第 12 节刚立的 ≤254；卡面本来也不该带色相，冷度交给它周围那圈面。
- 连带同轴的槽一起翻：`--badge-cat-bg` `--lock-wash-b` `--frost-border` `--text-url`，以及那颗暖黑翻成 `#202225` 的 toast/气泡。
- 结果：与纸底面族平均 ΔRGB 10.5 → **10.6**（门槛没丢），文字 15.99:1、muted 6.35:1，code 族对新下陷面 `#e3e6ea` 仍全部 ≥4.5。
- 这条写进 `00-brief.md` 硬约束第 10 节：**浅色轴的"冷"只许走 b\*，a\* 必须留在 0 附近**；带 a\* 负值的灰阶一律判"青涩"。
- intake 加禁令二（`scripts/theme-intake.mjs`，与卡面纯白同级、**拦下**）：交付物 `--bg` 的 b\* 为负即判为冷底，此时面族＋描边＋文字九槽里任一 a\* ≤ −1.0 就点名该槽。阈值取在已发货冷底（±0.6）与被否那版（−1.0～−1.4）之间；回归测试两个方向都验过——现值雪底不报，v2 那套灰阶报出 `border / border-strong / text-muted / text-faint` 四槽。

## 14. 后续轮（2026-10-13）：雪从「冷灰台」改回「白」

v3 落上去用户新账：「雪是白色的，你能不能搞个白色的底色呢」。这一轮没有新机制，只把第 13 节那架跷跷板换了一头压。

- **先量清楚"不白"在哪**：雪底卡面 `#fefefe`（254）已经是禁令内的最白档，离纯白 1 级、肉眼分不出。灰的是它周围那圈面——第 13 节为了把 ΔRGB 推到 10.6 把画布压到 L\*96.1、侧栏 L\*93.5、下陷 L\*91.2、填充 L\*87.6，这几块占窗面大头，所以整窗读作"冷灰台"。**"白"与"和纸底拉得开"是同一根轴的两端**，第 13 节往"拉得开"压满，这轮就得往"白"回退。
- **sRGB 的硬账**：L\* 越高越装不下冷度。画布 L\*98.5 时 a\*=0 的解只能给到 b\*=−1.7（再蓝就出界），卡面 L\*99.7 时 b\* 必然为 0。所以"带蓝味的白卡"在 sRGB 里不存在——白卡只能中性，冷度交给描边那圈（`--border` b\*=−3.9）。这条决定了候选的形状，不是取舍。
- 出候选走的是既有工装：求解器（给定 L\* + 目标 b\*、强制 a\*=0 反解 sRGB，越界时二分收缩）→ 克隆现值雪底整块、只覆盖 17 槽 → 写 `design/intake/white-20261013.txt` → `theme-intake.mjs` 判（两档全过，只有提示）→ `theme-candidate-shots.mjs` 在真 app 上出对拍板（75 帧 21 板）。三档摆给用户拍：甲 白·顶格（画布 L\*98.5、下陷 −5.0，ΔRGB 7.1）、乙 白·留半档（下陷 −6.4／侧栏 −7.7／填充 −8.8，ΔRGB 8.5）、丙 保持现值。
- **用户拍乙 + 替换雪底**（不新增第 5 底）。终值：`--bg #f8fbfe`、`--sunken #e8ecf2`、`--sidebar-bg #e5e8ee`、`--fill #e2e5eb`、`--hover #f6f9fe`、`--active #e5e8ee`、`--border #dbdfe6`、`--border-strong #c6c9d0`、`--border-subtle #eef2f9`；卡面/文字/toast 族一动不动。与纸底 ΔRGB **8.5**——回到 8 线之上、10 线之下，这是"白"换掉"最分明"的价。
- code 族**不回提**：v2 为深下陷压暗的那一档（`#776422`/`#3a689e`/`#63656f`…）对新的 `#e8ecf2` 是 4.78–4.89:1，照纸底原值反而掉到 4.46（下陷面仍比纸底深一档）。压暗的理由变了但结论沿用——这类"上一轮的连带账"别顺手回退。
- 刻度写回三处：`00-brief.md` 扩展表（10 = 方向线、8 = 会被否的底线）、`theme-intake.mjs` 的 ΔRGB 报告行（现值 纸↔雪 8.5 / 墨↔岩 10.5）与注释（把"白↔拉得开"这架跷跷板写死，免得下一轮又照 10 去压）。
- 落地面与前三轮相同，仍是零新账：global.css 一块（17 槽）+ theme.ts `prev` + `e2e/specs/theme.spec.ts` 的 `BASES.snow.bg`（`rgb(248, 251, 254)`）。accent 层、POLARITY、20 组合矩阵、Rust 侧一律没动。
- 验收：coverage 0（4 底色 × 96 槽 / 10 accent 组合）/ theme.spec 11-11 / intake 对已发货雪底重跑「全部判据通过」（10 条提示：三档面比纸深 2 级以上、success 比纸低 0.23、三枚语法色低 0.2 以内）/ color-sweep 20 组 exit 0 / theme-shots 20×12 重拍 + compare 板 / inventory 重跑。

## 15. 后续轮（2026-10-13）：雪从「白·留半档」换成「中性瓷白」

第 14 节落上去当天，用户四条账一起到：太蓝偏冷／与纸太像／对比不足／整体换性格。这轮不再压那架跷跷板，而是换一根轴解。

- **病根分成两处**：蓝味不在画布（v3 画布 b\* 只有 −1.7），在侧栏/下陷/描边那一圈 B&gt;R 的残值，整窗读作"淡蓝"；"与纸太像"则跟色温无关——v3 七槽的 ΔL\* 排布与纸几乎同幅（只差 1～2 级），两底其实是**同一套台阶换了下色温**，所以 ΔRGB 才只有 8.5。
- **解法：温度归零，分层改由明度台阶主担。** 卡面顶到 intake 上限 `#fefefe`，画布 ΔL\*−4.2／下陷 −6.3／侧栏 −8.8／填充 −11.6（纸 −1.4／−3.8／−5.5／−6.3）——纸靠发丝线分层，雪靠台阶分层，从此两底不是同构。灰阶九槽 a\* 最负 −0.80（intake 拦线 −1.0）、b\* 最深 −3.06，`--bg` b\*=−0.6 仍触发冷底禁令但无一越线。
- 对比整档加深：描边 ΔL\*−14.4（纸 −7.7）、重描边 −23.2（纸 −13.8）；文字 17.09／二级 10.44／muted 6.54／faint 3.53，四档全部反超纸现值。阴影 alpha 从 v3 的 0.03–0.12 提到 0.04–0.14（与纸同档），`--shadow` 的 1px 环跟 `--border-strong` 走 `#b9bdc2`。
- **与纸 ΔRGB 8.5 → 10.7**：第一次"白"和"拉得开"同时拿到，代价是"雪=冷白"的字面联想没了。刻度写回两处：`00-brief.md`（硬约束 8 的浅色轴注解改成"雪不掺蓝，靠中性灰与纸的暖白对照"）与 `theme-intake.mjs` 的 ΔRGB 报告行／注释（现值 纸↔雪 10.7）。
- 候选走既有工装：两块 96 槽候选写 `design/snow-redesign/artifact.txt`——甲 中性瓷白（全中性）、乙 冷雾瓷白（留 b\*≈−2 的半档冷，保"雪=冷"的字面感）。intake 两块全过（28 条提示，其中 14 条是刻意的台阶差）→ `theme-candidate-shots.mjs` 真 app 出图 45 帧 14 板 → **用户拍甲**。推荐甲的理由：乙那半档冷意实机仍读得出蓝，"太蓝"这条账只解了一半。
- 连带账：`--tip-bg`/`--toast-bg` 从掺蓝的 `#202225` 回中性 `#1f2124`（v2 那句"别在冷白上留一颗暖黑"随之作废，注释改成"与瓷白同色温"）；`--frost-bg` 255→254 守纯白禁令；`--badge-cat-*`/`--lock-wash-b`/`--frost-border`/`--text-url` 同轴一起翻。
- **下陷面被 color-sweep 回提了一档**：首版给 `#e7e8ea`（ΔL\*−7.7），sweep 逮出 clay/plum 两档 accent 的 12px 小字（`.tab.active .tab-count`、小记 `.day-head`）对它只有 4.36–4.37——上版对 `#e8ecf2` 是 4.52，等于本轮顺手把这两档压破 4.5 线。回提到 `#ebecee`（ΔL\*−6.3，仍比纸深 2.5 级）后两档 4.53，台阶故事改由画布/侧栏/填充三档担。`--badge-cat-bg` 同轴跟走。
- code 族**不回提**：v2 压暗的那一档（`#776422`/`#3a689e`/`#63656f`…）对 `#ebecee` 是 4.80–5.34:1，照纸底原值反而掉到 4.4 档——第 14 节这条账原样成立。
- 落地面：global.css 一块（96 槽整块重写，与上版逐槽对账实改 **37** 槽）+ theme.ts `prev` + theme.spec 两处锚点（`BASES.snow.bg/text`、`EXPECT.snow.bg`）+ 00-brief 三处 + intake 报告行 + inventory 重跑。accent 层、POLARITY、20 组合矩阵、Rust 侧零改动。
- 验收：coverage 0（4 底色 × 96 槽 / 10 accent 组合）/ theme.spec 11-11 / intake 对已发货雪底重跑「全部判据通过」（9 条提示：七档面对卡面比纸深 2 级以上——本轮刻意、success 比纸低 0.23、`--code-str` 对下陷低 0.18）/ color-sweep 20 组「对比度不达标」全部 `(none)`（含回提前报红的 snow-clay、snow-plum 两档）/ theme-shots 雪 5 组 × 12 屏重拍 / inventory 重跑。本轮只动雪底，纸/墨/岩的帧未重拍。
