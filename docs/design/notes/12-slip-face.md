# 小记卡面：纸片档质感与声部

日期：2026-11-02　状态：**已实现（第一刀：只落小记）**　验收帧：`.tmp/notes-visual-20261102/r5-*`
关联：[09-slip-stream.md](09-slip-stream.md)（单列便签流骨架，本轮不动结构）、[11-editor-typography.md](11-editor-typography.md)（全屏阅读层字号，与本页两套档）、[../workspace/01-desktop-layout.md](../workspace/01-desktop-layout.md)（卡面令牌）

## 1. 一句话

结构照旧（一条连续的纸片流），改的是**纸片的质感**和**卡内三行字的声部**：近影分离（影的配方已被 [13-slip-landed.md](13-slip-landed.md) §3 取代，声部与内距仍有效）、首块升为标题、正文退一档字色、标签不再是胶囊、宽窗下正文收在 720 的阅读列。

## 2. 病根（全部为实测值，非观感推测）

帧与量法：`.tmp/notes-visual-20261102/`（`shot3.mjs` / `shot4.mjs` 注入候选样式表跑真 app，`r3-*` / `r4-*` 为对拍帧）。

| 项 | 现状实测 | 为什么不耐看 |
| --- | --- | --- |
| 声部 | 有标题卡：标题 16/24 · `#1f2023`，正文 14/24 · 同一个 `#1f2023`，两行之间 **0px 间距** | 标题与正文只差 2px，同色同基线节奏，读起来是一坨字 |
| 无标题卡 | 首块 = 正文档（14/24 · 400 · `--text`） | 真机里绝大多数是 1–3 行短记且无 H1–H6 首块（`noteDisplay.ts` 只认首块标题），于是**整页没有任何一行是标题声部** |
| 时间 | 12/18，自成一条 24px 行的右端 | 与标题不同基线，右上角像贴上去的 |
| 卡面 | 1px 实描边（纸底 `rgb(15 23 42 / 7%)`）+ 10px 圆角 + `0 10px 24px -12px` 浮岛影 | 描边和投影同时在做分离，等于给每张卡套了一个「按钮框」，短记流读成控件墙 |
| 标签 | 灰底胶囊，且正文里已有一行 `#词` | 同一信息两种表达，胶囊还把它抬成了和正文同级的物件 |
| hover | 整张卡刷 `--hover-chrome` 灰底 | 纸片被涂成按钮；动作排浮在灰底上无分组 |
| 行长 | 1440 下卡宽 1109 → 内宽 1067，14px 中文 **约 76 字/行** | 扫读时行尾与行首之间没有回勾，短记被拉成横条 |

## 3. 参照与被否

- 参照：**Apple 备忘录 / Google Keep 的纸片**——每张仍是独立纸片，首行即标题，标签是文字。（「靠影不靠框」这半句已被 [13-slip-landed.md](13-slip-landed.md) 推翻：纸片的分离改由发丝边承担。）
- 已否，本轮不做：把卡合成连续白面 + 行间发丝线（11-02 轮「这种 ui 不行」，判词是**结构：纸片身份丢了**）；双栏索引、日期章节/时间轴、多列卡墙（见 09）。

## 4. 卡面配方（纸片档）

> **本节已于同日部分作废**：「描边退场、只留近影」被 [13-slip-landed.md](13-slip-landed.md) §3 反转成「发丝边 + 零影」，`--slip-shadow` / `--slip-shadow-hover` 两枚令牌已删。下表与「要点」段保留为决策过程记录；`--radius-slip`、`--text-meta`、内距三行仍然有效。

第一刀**不翻全局令牌**（§10 第 1 项拍板），改为新增四枚纸片专用令牌，值放在 `workspace-themes.css`，只有小记读它们：

| 令牌 | 现值（全局卡档） | 纸片档新值 | 落点 |
| --- | --- | --- | --- |
| 描边 | `1px solid var(--border-card)` | `1px solid transparent`（保留占位，改宽度会抖 1px） | `NoteCard.vue` / `NoteComposer.vue` |
| 圆角 | `--radius-card` = `--radius-lg`（10） | `--radius-slip: 14px` | `workspace-themes.css` 共享块 |
| 静影 | `0 1px 2px 4%, 0 10px 24px -12px 11%` | `--slip-shadow: 0 1px 2px 6%, 0 3px 10px -2px 7%` | 同上 |
| -hover 影 | `0 2px 4px 5%, 0 16px 30px -12px 15%` | `--slip-shadow-hover: 0 2px 4px 7%, 0 10px 22px -6px 13%` | 同上 |
| 墨底影 | `0 1px 2px 30%, 0 10px 24px -12px 42%` | `--slip-shadow: 0 1px 2px 40%, 0 4px 14px -4px 50%`（hover `45%/60%`） | `[data-theme="ink"]` 块 |
| 弱档字色 | `--text-muted` 纸底 `#74777c`（4.49:1） | `--text-meta` 纸底 `#63666b`（**5.76:1**），墨底暂同 `--text-muted` | 同上 |
| 内距 | `14px 16px 14px 24px` | `15px 20px 13px 24px`（左内距仍给勾选点列让位） | `NoteCard.vue` |

要点：影的**扩散半径从 24px 收到 10px**。原来的 24px 大扩散影是给「浮岛卡」用的，短记一排排叠起来会糊成一片灰；近身小影只说「这张纸比画布高一点点」，正是备忘录/Keep 读来干净的原因。

**卡面的真正归属不在 `global.css`**：全 APP 的卡面由 `src/components/layout/CodexWorkspace.vue:310` 那条全局（非 scoped）规则统一画框（`border-color: var(--border-card)` + `box-shadow: var(--shadow-card-rest)` + `border-radius: 10px`，特异度 (0,4,0)），scoped 里的卡面写法会被它整片盖掉——第一刀落码时就是这样静默失败的（`r5` 之前的帧仍是 10px 圆角 + 发丝线）。现已把该规则拆成两条：其余卡照旧画框，`:is(.memo, .composer)` 只接 `--bg-surface` / `--bg-surface-hover` 两枚令牌绑定，不再被画框；`.memo` 同时从该文件的两条 hover 规则（描边+影、`--bg-surface-hover` 洗底）里摘掉。第二刀翻令牌时仍以这一条为总闸。

这四枚纸片档令牌还没进 `docs/design/themes/01-token-inventory.md`：那份清单由 `scripts/theme-tokens-dump.mjs` 整篇生成，刷新会带动 600+ 行无关计数，属单独拍板的事，本轮只手工删掉了失去消费方的 `--border-composer` 一行。

## 5. 声部配方

| 行 | 字号/行高 | 字重 | 字色 |
| --- | --- | --- | --- |
| 标题（真标题卡的 `.memo-title`） | 15 / 22 | 600 | `--text` |
| **无标题卡的首块**（`p`/`h1–h6`，≤40 字，首块内无图/任务/列表/代码） | 15 / 22 | 600 | `--text` |
| 正文其余块 | 14 / 22 | 400 | `--text-secondary` |
| 块间距 | `> * + *` 由 8px 收到 **4px**（三行预算内多挤得下半行） | | |
| 时间 | 12 / **22**（与标题同基线） | 400 | `--text-meta` |
| 标签 | 12 / 18 | 400（命中态 600） | `--text-meta` |

- 纸底 `--text-secondary` = `#55585d`，白卡面实测 **7.14:1**；墨底 = `rgb(183,191,202)` 对 `#26282c` **7.96:1**。两底都在 ≥5.8 的深色小字底线之上。标题 `--text` 纸底 16.29 / 墨底 11.28。
- **存量红已按「只修卡面」处理**：`--text-muted` 纸底 `#74777c` 白卡面 4.49:1（画布 4.31）不动，全局继续用它；卡内时间与标签改读新增的 `--text-meta`（纸底 `#63666b`，**5.76:1**；墨底暂等于 `--text-muted`，那一底本就够）。全局 `--text-muted` 是否一并提到 5.76 另轮拍板。
- 首块升标题只对**没有真标题**的卡生效（`noteDisplay.ts` 新增 `voiceFirst`）；有真标题时首块已被 `promoted` 藏掉，不会重复。**护栏（§10 第 2 项拍板）**：首块纯文本超过 **40 字**不升，避免一条长记整段抢戏；`e2e/specs/notes-reading.spec.ts` 对「升 / 不升 / 引用不升」三态都有锚点。
- 截断渐隐（`--memo-max-h` 72 → **66** = 3×22）保留 11-02 的 mask 配方：末 20px 淡到 25%，墨底末行不整行消失。

## 6. 宽度：卡面满 1120，正文限宽 720

10-30 定的「小记与其它页同宽 1120」不动，把**页宽**和**行长**解耦：

```
@container slip (min-width: 960px)   /* 卡宽阈值，见下 */
  .memo-body / .memo-foot / .composer-bar → max-width: 720px
  .memo-title → flex: 0 1 auto; max-width: 720px
  .memo-time  → margin-left: auto      /* 时间仍钉卡右缘，形成一条可扫的日期列 */
  .memo.without-title .memo-body::before → width: 0   /* 让位浮动块退场 */
```

- 阈值下限 **920** 的推导：正文右缘 = 20 内距 + 720 = 740；右上控件盒宽 160，其左缘 = 卡宽 − 180。两者不相撞要求卡宽 ≥ 920。落码取 **960**，给控件盒留 40px 余量。
- 卡宽 < 960（默认 1040 窗口实测 709）时整条规则不激活，走现有让位浮动块，**默认窗口零变化**（实测 1040 正文宽仍是 663，与改前同）。
- 用容器查询而不是 `@media`：侧栏收起/目录停靠会改卡宽，视口宽不是判据；`applyClamp` 已挂在 body 宽度的 `ResizeObserver` 上，宽窄切换后截断仍会重算。
- 实测（`r5-*`，`shot5.mjs` 直读真 app，无注入）：1440 卡宽 1109 / 正文 720（约 48 汉字/行），十条卡总高 **754**（改前同量法 817，**−7.7%**，来自 66px 截断与 4px 块间距）；1040 屏内 4.0 张 vs 改前 3.7 张。

## 7. 标签、hover、书写条

- **标签去胶囊**：`#词` 就是文字色（`--text-muted`），hover 才浮出 `--fill` 圆角底，命中筛选态吃 `--accent-soft` + 主色。胶囊只保留在别处（分组头 chip）——卡内它是重复表达。
- **hover 不洗底**：卡面背景色不动，只抬影；动作排自带一枚圆角浮岛底（`--fill`），和纸面分开。
- **书写条 = 一张空纸片**：`.composer` 与卡同档质感，聚焦时描边 + `--accent-ring`。它和卡排是同一个东西的两种状态，不该长得像输入框。

## 8. 全 APP 铺开对账（第二刀，未做）

卡面质感走令牌（§4），一改全改；声部（§5）和正文限宽（§6）只属于小记。

第一刀的实际落法是**新增 `--radius-slip` / `--slip-shadow` / `--slip-shadow-hover` / `--text-meta` 四枚令牌，只让 `.memo` `.composer` 读**，全局 `--radius-card` `--shadow-card-*` `--border-card` `--text-muted` 一律未动。第二刀要做的就是把下面这些消费方也接到纸片档上（或直接翻全局值），届时 `CodexWorkspace.vue:310` 那条总闸是主改点。

| 消费方 | 用哪些令牌 | 跟不跟 | 理由 |
| --- | --- | --- | --- |
| `.memo` `.composer`（小记） | 全套纸片档 | **已跟**（第一刀） | 本轮主体 |
| `.grid-card`（收藏 / 文件浮岛网格） | `--border-card` `--radius-card` `--shadow-card-*` | **跟**，但 hover 的 `translateY(-1px)` 保留 | 与纸片同属「一张卡」，框去掉、影收近后仍需位移补反馈 |
| `.mfa-card` `.rcard` `.tn-card` `.clean-group-card` | 同上 | **跟** | 同一档浮岛 |
| `.rowlist`（白面板 + 行间发丝线） | 只吃 `--radius-card` | **半跟** | 它是一块面板不是一堆纸片，圆角跟、描边留 |
| `SettingsDialog.vue` / `ModulesEmptyView.vue` / `CodexWorkspace.vue` | `--border-card` | **不跟** | 弹窗与内嵌分区的描边是「容器壁」语义，不是卡 |

风险（必须先拍帧再落码）：纸底画布 `#fafafa` 与卡面 `#fff` 只差约 2% 亮度，描边撤掉后分离全靠影。小记帧已证明成立；`.grid-card` 是 280px 宽的矮卡，影面积更小，需要单独拍一轮 8 主题组合的帧（`scripts/color-sweep.mjs` + 全页走查）。
另记一笔冲突：`workspace-themes.css:27-29` 立过规矩——「线负责说清边界在哪，影负责说清它浮在上一层；任何一边归零，卡片就会糊进背景」。纸片档是**有意**在小记这一档破掉它（靠 2% 亮度差 + 近影分离）。同日 [13-slip-landed.md](13-slip-landed.md) 把破例换了个方向：**留线、去影**，并把它写成正式例外声明（§4）；其余页面仍按原规矩线+影成对。

## 9. 落码顺序与验收

1. `NoteCard.vue`：卡面档 + 声部 + 标签 + hover + 容器查询（scoped）
2. `NoteComposer.vue` / `NoteEditor.vue`：书写条同档质感与内距
3. `workspace-themes.css`：新增 `--radius-slip` `--slip-shadow` `--slip-shadow-hover` `--text-meta`（纸/墨两底）
4. `noteDisplay.ts`：`voiceFirst` + 40 字护栏
5. `CodexWorkspace.vue:310`：拆总闸，`.memo` `.composer` 不再被统一画框，并从该文件两条 hover 规则里摘出 `.memo`
6. `NotesModule.vue`：`--memo-max-h: 66px`
7. 测试：`notes-reading.spec.ts` 声部三态锚点已更新；`r5-*` 帧 + `shot5.mjs` 计算样式复核

验收（纸墨两底 × 1040/1440/1920，`shot5.mjs` 直读真 app、无注入）：radius `14px`、border `1px solid rgba(0,0,0,0)`、影为 `--slip-shadow`、`container-name: slip`、1440/1920 正文宽 720 而 1040 保持 663、首块声部 15/22·600·`--text`、超 40 字首块仍 14/22·400、时间 12/22·纸底 `#63666b`——六档全部实测通过。1040 屏内 4.0 张 ≥ 改前 3.7；`--text-secondary` 纸 7.14 / 墨 7.96 ≥5.8；截断卡末行仍有 20px→25% 渐隐；无入场动画。
hover 另拍（`hover5.mjs`，纸墨两底）：卡面 `backgroundColor` 前后逐字相同、`borderTopColor` 保持透明，只有 `boxShadow` 从 `--slip-shadow` 换到 `--slip-shadow-hover`。
测试账：单测 847/847（`noteDisplay.test.ts` 补了声部三态：短段落升 / 图片任务引用不升 / >40 字不升）；e2e 657 passed，3 条红与本刀无关（`titlebar-compact` 搜索框 233.67/239.9 撞 240 下限、`workspace-layout:287` 关柔光后 `.app-root` 由透明变实色——两条都在 `/files` 与窗框材质上，小记卡面无涉）。

## 10. 拍板记录

1. 铺开时机 → **先只落小记**，全局令牌不翻，第二刀下一轮再铺（见 §8）。
2. 长首行护栏 → **加**：首块纯文本 > 40 字不升标题声部。
3. `--text-muted` 4.49:1 存量红 → **只修卡面**：新增 `--text-meta` 供卡内时间与标签使用，全局 `--text-muted` 本轮不动。
4. 便签列宽 → **卡面满 1120、正文限宽 720**（10-30 的 1120 页宽裁定不破）。

待拍（下一轮）：全局 `--text-muted` 是否一并提到 `#63666b`；纸片档铺满全 APP（第二刀）；阅读层短记空面（10-26 待拍加法①）。
