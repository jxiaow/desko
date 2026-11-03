# 内容区去影：一张卡只剩一条线

日期：2026-11-02 ｜ 状态：**已实现（2026-11-02）**
前置：[小记落地档（13-slip-landed）](../notes/13-slip-landed.md)（小记先走了一刀）
对拍帧：`.tmp/shadow-audit-20261102/`（密集卡 5 页 × 纸墨、浮层 4 层 × 纸墨，1440×900 @1×）

## 1. 问题

小记落地档把卡影归零后，同屏并排的其它模块仍带着 `--shadow-card-rest`：
纸底 `0 1px 2px .04 + 0 10px 24px -12px .11`，墨底 `0 1px 2px .30 + 0 10px 24px -12px .42`。
对拍帧里能直接看出收藏卡比小记卡"浮"着半档——同一条阅读列上两种卡面语言。

实测台账（`shots.mjs` 的 INVENTORY，按元素类名归并）：

| 档 | 元素 | 现状 |
| --- | --- | --- |
| 内容卡 | `entry-card` ×8、`shortcut-row` ×6、`mfa-card` ×5、`rcard-row` ×2 | 全部吃同一枚 `--shadow-card-rest` |
| 内容面板 | `.rowlist`、`.tn-card`、`.hero` | 同上（`.hero`/`.bp-card.probing` 直接读经典 `--shadow-card`） |
| 内容小件 | `card-check` ×8（收藏卡勾选钮） | `--shadow-sm`，批量态同屏 8 颗 |
| 浮层 | `settings-dialog`、`.dialog`、`.popover`、`app-tip` | `0 16px 36px -8px .12 + 0 4px 10px -2px .04 + 0 0 0 1px`；墨底 `0 24px 54px -12px .85` |
| 缩略图 | 设置里的 `tp-row` / `tp-sheet` | 写死的迷你窗影（墨底同样是纸底那组值） |

浮层用的是 `--shadow-pop` 一档，量级是卡影的 3 倍以上，和内容卡不是同一套令牌；
内容区去影碰不到它们，所以这一刀可以整片落，不需要逐页补浮层。

## 2. 判据：内容卡四态

与落地档对齐，内容卡只剩"一条线"这一种分层语言：

| 态 | 线 | 底 | 影 | 位移 |
| --- | --- | --- | --- | --- |
| 静息 | `--border-card`（`--card-line-soft`：纸 7% / 墨 8%） | `--bg-surface` | **none** | 无 |
| 悬停 | `--card-line-hover`（text 22%） | 不变 | **none** | 无 |
| 焦点 | `--accent` + `0 0 0 3px --accent-ring` | 不变 | **none** | 无 |
| 选中 | `--accent` | `--accent-soft` | **none** | 无 |

两条连带决定（不这么做，"统一"只统一了静息态）：

1. **悬停不再洗底。** 现在 `.grid-card` / `.mfa-card` / Codex 卡在 hover 时把底色换到 `--sunken` / `--hover`；
   洗底是"抬起"方言的另一半，小记落地档已拍板不要，并列时必须一起退场，hover 只把线压深。
2. **小记选中态跟着归一。** `.memo.is-sel` 目前是「accent 线 + 再套一圈 1px accent 环 + `--shadow-sm` + 上移 1px」，
   比收藏卡的选中（只换 accent 线 + 淡底）多两层；本轮收成与 `.grid-card.selected` 同一套。
   这是落地档里漏掉的一处漂移，不是新设计。

## 3. 令牌改动

| 令牌 | 位置 | 现值 | 新值 |
| --- | --- | --- | --- |
| `--shadow-card-rest` | `workspace-themes.css` 共用块 | 纸 `.04/.11`、墨 `.30/.42` | **none** |
| `--shadow-card-hover` | 同上 | 纸 `.05/.15`、墨 `.34/.50` | **none** |
| `--slip-line-hover` | 纸/墨块 → 共用块 | `color-mix(in srgb, var(--text) 22%, transparent)` | 改名 `--card-line-hover`，仍 22%，升为全部内容卡的悬停线 |

- 经典布局的 `--shadow-card` / `--shadow-md` 一律不动：`.tab.active`、导出弹窗分段、锁屏页要它们。
- `--border-card-hover`（`--card-line-strong` 12%/14%）保留给 `/start` 模块选择器的 `.module-tile`，
  不再供内容卡使用——12% 是"有影时代"的悬停强度，影退场后撑不出变化。
- `workspace-themes.css` 里那段「线负责边界、影负责浮起，任何一边归零卡片就会糊进背景」的注释要改写：
  本轮的前提正是"线独扛"，并记录窄卡（248px）与宽卡（1109px）都验证过。

## 4. 逐项改动

| 位置 | 现状 | 改后 |
| --- | --- | --- |
| `global.css` `.grid-card` | rest 影；hover 抬 1px + 影 + `--sunken` 洗底 | 无影；hover 只换 `--card-line-hover` |
| `global.css` `.rcard` | rest/hover 影 | 无影；hover 只换线 |
| `global.css` `.skeleton-card` / `.skeleton-row` | rest 影 | 无影（骨架与真卡同皮） |
| `MfaModule.vue` `.mfa-card` | rest/hover 影 + 抬 1px + 洗底 | 无影；hover 只换线 |
| `global.css` `.rowlist` / `.tn-card` | rest 影 | 无影 |
| `CodexWorkspace.vue:324` 卡面总闸 | rest 影；`:379` hover 影 | 无影；hover 只换线 |
| `CodexWorkspace.vue:389` 卡面 hover 洗底 | `--bg-surface-hover` 作用到 grid/mfa/rcard | 从卡面名单里摘掉（行仍保留） |
| `global.css` `.grid-card .card-check` | `--shadow-sm` | 去掉（同屏 8 颗的重复噪音） |
| `NoteCard.vue` `.memo.is-sel` | accent 环 + `--shadow-sm` + 上移 | accent 线 + `--accent-soft` 底 |
| `NoteAttachments.vue` `.att:hover` | 换 `--border-strong` + `--shadow-sm` | 只换线 |
| `CodexWorkspace.vue` / `MfaModule.vue` 焦点态 | 光圈 + `--shadow-pop` | 只留光圈 |
| `BypassModule.vue` `.hero` | `--shadow-card` | `--shadow-card-rest`（经典布局行为不变） |
| `BypassModule.vue` `.bp-card.probing` | `--shadow-card, inset 2px 0 0 accent` | 只留 `inset 2px 0 0 accent`（`none, inset` 是非法值，声明会被整条丢掉） |

圆角、间距、尺寸、卡面底色、字号一律不动——本轮只动影与悬停反馈。

## 5. 豁免（保留影，且不读卡影令牌）

- 浮层：`.dialog` / `.settings-dialog` / `.popover` / 菜单 / tooltip / toast（`--shadow-pop`）。
- 壳：`.workspace-surface`（`--shadow-sheet`，整窗那一层），批量药丸（`--shadow-dock`）。
- 内容区里的浮出物：`.grid-acts`（卡上 hover 才出现的动作簇）、回顶钮 `NoteScrollTop`。
- 非工作区：锁屏 / 首次设置 / 引导、Codex HUD 精灵。
- 缩略图：设置里的 `tp-row` / `tp-sheet`——画的是迷你窗口本身，不是界面层。

## 6. 风险

1. **纸底卡面与画布只差一档**（`#ffffff` vs `#fafafa`），边界全交给 7% 发丝线。
   落地档已在 1109px 宽卡上验证；本轮要补 248px 窄卡 + 骨架卡（条块占位）两处。
2. **墨底**：8% 白线同样已在小记验证；`rcard` 行、面板卡这类"内容多、留白少"的卡要单独看。
3. 若线确实不够：只允许把 `--card-line-soft` 提一档（纸 7→9%、墨 8→10%），不得把影加回来。

## 7. 验收

- 帧：八页（小记 / 收藏 / 文件 / 验证码 / Codex / 直连 / 局域网 / 穿透）× 纸墨，另加 hover、选中、编辑三态，1× 细看发丝线。
- e2e：`workspace-layout-regressions.spec.ts` 五页循环补 `face.shadow === 'none'`（现在只在 notes 分支钉）；
  非小记卡补一条 hover 只改线的断言。
- `npx vitest run`、`npx vue-tsc --noEmit`、e2e 全量、`design-audit.mjs`、`color-sweep.mjs`。

## 8. 不做

- 不动经典布局的 `--shadow-card` / `--shadow-md`。
- 不动浮层那一档（`--shadow-pop`）与整窗 `--shadow-sheet`。
- 不借这轮改圆角、卡宽、底色、字号；小记的卡宽结论（满幅 1109）继续有效。

## 9. 落地结果（2026-11-02）

实现与上文方案一致，未扩范围：

- 令牌：`workspace-themes.css` 共用块 `--shadow-card-rest/hover: none`、新增 `--card-line-hover`（text 22%，由 `--slip-line-hover` 改名）；
  墨底块删掉了会把卡影重新打开的 `--shadow-card-rest/hover` 覆盖。`--border-card-hover` 只剩 `/start` 的 `.module-tile` 一个调用方。
- 卡面：`global.css`（`.grid-card` / `.rcard` / `.rowlist` / `.tn-card` / 骨架 / `card-check`）、
  `CodexWorkspace.vue` 卡面总闸、`MfaModule.vue`、`NoteCard.vue`、`NoteComposer.vue`、`NoteAttachments.vue`、`BypassModule.vue`
  按第 4 节逐项处理；hover 洗底名单里摘掉卡面，行仍保留洗底。
- 帧（`.tmp/shadow-audit-20261102/`）：`sheet-after-paper.png` / `sheet-after-ink.png`（八页 × 纸墨）、
  `sheet-after-states.png`（悬停 / 选中 / 编辑 × 纸墨）、`sheet-after-zoom.png`（小记卡与收藏卡 3×，带 14px 画布留白）。
  纸底窄卡（248px 收藏卡）与宽卡（1109px 小记）的发丝线都能撑住边界；悬停时线 7%→22%（纸）/ 8%→22%（墨），
  卡面底色与位移不变；选中为 accent 线 + 淡底；书写面焦点为 accent 线 + 3px 光圈。均无影。
- 走查读数（`design-audit.mjs` paper-ink / ink-ink）：`grid-card-hover-line-only` 三项全为 true
  （`lineChanged` / `shadowNone` / `flat`）。其余对比度条目为既有豁免档与走查脚本对 `oklch()` 的误解析，非本轮引入。
- 门禁：`npx vitest run` 68 文件 / 847 用例通过；`npx vue-tsc --noEmit` 无输出；
  e2e 全量 658 通过 / 3 失败——2 条 `titlebar-compact` 复跑转绿（既有 flaky），1 条
  「paper 下目录收起时柔光只染窗框」为 10-30 试光留下的既有长红（`.app-root` 试光态纯渐变无实色），与卡影无关。
  `color-sweep.mjs` 80 组合跑完（exit 0），本轮只改边框色，文字/底色读数与改前同档。
