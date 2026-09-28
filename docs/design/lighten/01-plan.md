# 轻量化：阴影扁平 + 圆角收紧 + 配色提透明度

日期：2026-09-28 ｜ 前置：`docs/design/spacious/01-plan.md`（第十四轮大方化基线）

## 问题

用户反馈整个 APP 配色和样式"笨重"。定位到三个来源（按视觉重量排序）：

1. **每行都是浮起卡**：`--shadow-card` 是 `0 8px 20px -8px rgba(·,0.10)` 量级的宽大软影，
   收藏/文件/验证码/小记/局域网五类行卡全在"浮"，且 hover 还再抬升一档
   （`--shadow-card-hover`）。列表页一屏十几张浮卡，重量是堆叠出来的。
2. **色温偏闷**：paper 底色族 `#f5f4f1 / #eceae5 / #e7e5df` 全是低明度暖米灰，
   相邻层级只差 3~5 个色阶，整屏发"浊"，像蒙了一层灰。
3. **几何与字重顶格**：圆角 14/18（--radius-lg/xl）、行高 64、行首标题 15px/600，
   在默认 1040×670 小窗里显挤显沉。

## 拍板结果

2026-09-28 用户拍板：**P1–P4 全做**（含原建议暂缓的 P4）。落地时两处微调：

- 行卡默认描边吃 `--border` 而非 `--border-subtle`：墨色档 subtle 比原高光环轻太多，
  提一档才能两主题等重。
- P3 只动 paper 底族 + 阴影，ink 的底色/文字 hex 原样保留（墨色本就靠描边+高光分层，不存在"浊"）。

| 阶段 | 内容 | 建议 | 风险 |
| --- | --- | --- | --- |
| P1 | 阴影扁平化 | 先做 | 动主题槽位契约（--shadow-card） |
| P2 | 圆角收紧 | 与 P1 同批 | 低，纯令牌 |
| P3 | 配色提透明度 | 与 P1 同批 | 中：96 槽 + 预览 meta 四处联动 |
| P4 | 行高 64→56 / 字重回调 | **暂缓** | 高：推翻上轮刻意拍板，且 e2e 几何断言大面积飘 |

### P1 阴影扁平化

- 行卡族（entry-row / file-row / mfa-card / note-card / fileshare 卡）：
  默认态去投影，回归 1px 发丝描边分层（默认描边吃 `--border`，hover 时 `--border-hover` 显色）；
  `--shadow-card` 浅色档填 `0 1px 2px rgba(29,28,26,0.04)`（≈原 shadow-xs），墨色档保留
  `0 0 0 1px 高光线` 那层、去掉 `0 6px 18px` 大投影。
- `--shadow-card-hover` 不再"抬影"，改背景 `--hover` + 描边显色；选中态保留 accent-ring。
- 阴影语言只留给：弹窗/下拉（--shadow-pop）、Dock（--shadow-dock）、锁屏。
  槽位本身保留（不破坏 check-theme-coverage 契约），只是填值变轻。

### P2 圆角收紧

- `--radius-lg` 14→10（--radius-card / --radius-menu 随别名走）；
  `--radius-xl` 18→14（弹窗外壳）。`--radius` 10 / `--radius-md` 12 不动，
  胶囊、头像、四桶分类色块形态不变。

### P3 配色提透明度（paper 为主，ink 同步色温）

- 页面底 `--bg`：`#f5f4f1` → `#f7f6f4`（提亮减黄）；`--sidebar-bg` `#eceae5` → `#eeede9`；
  `--sunken/--fill` 同向中性化一档，`--fill` 与 `--bg` 拉开至少 6 个色阶。
- 文字族不动（上轮走查刚修完 muted 档位），accent 四档母色不动。
- 联动清单：global.css 底色块 + theme.ts `THEMES.prev` 预览色 + e2e 锚点色 + dialog-shots 重截。

### P4（已拍板执行）

行高 64→56（entry-card / shortcut-row / skeleton-row 同步），行标题 15px/600→14px/500
（.ec-name / .row-name / .card-issuer）。page-bar 48、栏内控件 34、图块 36 不动。

## 影响面与验证

- 主题槽位：--shadow-card / --shadow 填值变化 → `check-theme-coverage.mjs` 须过；
  paper/ink × 4 accent 共 8 组目检。
- 组件面：EntriesModule / FileShortcutsModule / MfaModule / FileshareModule / NoteCard
  的 hover 阴影逻辑；global.css 内 4 处 --shadow-card 使用者（778/1029/1189-1194 行卡与骨架屏）。
- e2e：行高/骨架几何断言不动（P4 暂缓所以 64 保持）；锚点色若 P3 改动须同步。
- 验证流水线：vue-tsc + vite build → 覆盖检查 → vitest → Playwright e2e →
  dialog-shots + 行卡五页截图，交付时内嵌图给验收。

## 实施记录

2026-09-28 落地 P1–P4 全部：

- P1：`--shadow-card` paper=`0 1px 2px 0 rgba(29,28,26,0.04)`、ink=`inset 0 1px 0 rgba(255,255,255,0.04)`；
  `--shadow-card-hover` 别名删除，五类行卡 hover 改"描边显色 + 背景 `--bg-surface-hover`"；
  行卡/便签/分组卡/骨架屏/search-box/tab.active 默认描边吃 `--border`。
- P2：`--radius-lg` 14→10、`--radius-xl` 18→14（卡片、菜单、弹窗壳、下拉随令牌走）。
- P3：paper 底族提亮减黄（bg #f7f6f4 / fill #e9e8e4 / hover #faf9f7 / active #eeede9 /
  sidebar #eeede9 / border #e9e8e4 / strong #d8d6d1 / sunken #f0efec），chrome/frost/lock-wash/
  badge 同步；theme.ts `THEMES.prev` 联动；ink 底色 hex 未动。
- P4：entry-card / shortcut-row / skeleton-row 64→56；.ec-name / .row-name / .card-issuer
  `--text-md`/600 → `--text-base`/500。
- 验证：check-theme-coverage 通过（96 槽对齐）；vue-tsc + build 通过；vitest 187/187；
  Playwright e2e 96 passed + 1 flaky（分类 tab 用例重试即过，非本批改动）；
  unify-shots paper-ink/ink-ink 与 dialog-shots paper-ink 目检通过。
