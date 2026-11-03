# 小记 · 编辑器与阅读层增强

日期：2026-10-30　状态：**方案待拍板（未动业务代码）**
关联：[02-links.md](02-links.md)（选中浮条）、[05-reading-archive-batch.md](05-reading-archive-batch.md)（阅读层）、[09-slip-stream.md](09-slip-stream.md)（卡面与阅读入口）

## 1. 核到的事实

三张书写面（顶部草稿 `composer`、卡片就地 `card`、全屏 `full`）共用 `src/components/notes/NoteEditor.vue` 一颗编辑器；阅读面是 `NoteFullscreen.vue` 的 `mode="view"`，不是另做的 Markdown 渲染器。

| 面 | 现有能力 | 出处 |
| --- | --- | --- |
| 写 · 块级 | 正文 / H1–H3 / 无序 / 有序 / 任务 / 引用 / 代码块（14 种语言）/ 分割线 / 图片（拖右下角改宽） | `NoteEditor.vue:107-120`、`:234-264`、`:590-637` |
| 写 · 行内 | 粗体 / 斜体 / 删除线 / 行内码 / 链接的 mark 全在 StarterKit 里，靠 Markdown 输入规则与快捷键触发 | `package.json:28`、`NoteEditor.vue:409-424` |
| 写 · 选中浮条 | 只有「行内代码」「添加链接」两颗 | `NoteEditor.vue:924-949` |
| 写 · 斜杠菜单 | 10 条，正文排第一；没有图片、链接 | `NoteEditor.vue:107-120` |
| 写 · 粘贴 | 纯链接转成 link、可选转网页标题；空白整理；图片 Ctrl+V / 拖入落盘 | `NoteEditor.vue:661-709`、`:867-889`、`NotesModule.vue:308-377` |
| 写 · 历史 | 卡片与全屏底栏有撤销/重做；顶部草稿只有 Ctrl+Z | `NoteToolbar.vue:74-82`、`NoteComposer.vue:60-74` |
| 读 · 排版 | 与全屏书写共用 `.note-doc`；标题提升、时间/字数/标签、附件、外链交本机打开 | `NoteFullscreen.vue:193-227`、`global.css:2964-2995` |
| 读 · 任务 | 勾选框被显式关掉指针事件，是只读装饰 | `NoteFullscreen.vue:362` |
| 读 · 代码 | 低亮语法高亮；没有复制入口 | `global.css:2987-2988`、`:3085-3093` |
| 读 · 图片 | 正文图最大 56vh；没有放大查看 | `global.css:2995` |
| 读 · 回顶 | 回顶只挂在书写态，阅读态没有 | `NoteFullscreen.vue:229-231` |

清洗器已允许 `strong / b / em / i / s / u / code / pre`；`mark` 不在白名单。图片、任务、标签的结构在阅读面都保留，只有 `#标签` 文本被 `stripTagsFromHtml` 收走、改由底部胶囊承担（`NoteCard.vue:167-186` 的卡面勾选先例在阅读面可以复用）。

## 2. 缺口与判断

| 编号 | 面 | 缺口 | 影响 | 建议 |
| --- | --- | --- | --- | --- |
| W1 | 写 | 粗体/斜体/删除线只能靠 `**`、`*`、`~~` 或快捷键；选中浮条只有两颗 | 不知道 Markdown 的人找不到基础格式；移动端更难敲触发符 | **已随 [11-editor-typography.md](11-editor-typography.md) 落码（2026-10-30）**：浮条补 B / I / S 三颗 |
| R1 | 读 | 任务勾选框是死控件；卡面却能勾且落库 | 阅读长清单时点不动，得退出、回卡面再点 | **本轮做（需确认语义）**：允许在阅读面勾选并落库 |
| R2 | 读 | 代码块只能手动框选复制，横向滚动时更难 | 技术小记的高频动作 | **本轮做**：代码块悬停出「复制」 |
| R3 | 读 | 正文图封在 56vh，截图细节读不出 | 截图、表格图、长图的实际阅读 | **本轮做**：点图看大图（适应视口，不做缩放器） |
| R4 | 读 | 阅读态没有回顶 | 长文滚到底后只能一路滚回 | **本轮做**：复用 `NoteScrollTop` |
| W2 | 写 | 没有下划线、高亮、表格 | 需要扩 schema、清洗器、导出三处 | 不做：与「快速记一条」的定位不成比例，也会把正文视觉拉花 |
| W3 | 写 | 顶部草稿没有撤销/重做钮 | Ctrl+Z 已可用；书写条工具栏再塞两颗会挤掉「图片/全屏/保存」 | 不做 |
| R5 | 读 | 没有文内查找（Ctrl+F） | 长文定位 | 暂缓：等长文实际变多再做；先在方案里留位 |
| R6 | 读 | 没有标题目录 | 同上 | 暂缓：小记以短为主，目录会新增一层常驻 chrome |
| W4 | 写 | 斜杠菜单没有图片/链接 | 工具栏、浮条已有同动作 | 不做：同一动作不在同屏加第二个入口 |

**不是缺口的**：阅读面把 `#标签` 收进底部胶囊，是既有口径（`09-slip-stream.md` 与卡面同款），不在正文里再刷一遍彩色标签；阅读面不做文本编辑，改文字仍走「编辑」。

## 3. 推荐本轮范围

只做一组「把已有能力的闭环补齐」的五项：**W1 + R1 + R2 + R3 + R4**。共同点是：

- 不新增 npm 依赖：B/I/S 是 StarterKit 已有的 mark；复制、回顶复用现有图标与组件。
- 不改数据模型、不改 Rust、不改清洗器与导出：阅读面的勾选回写现有 `content_html`，其余三项都是纯展示层。
- 不动 `.note-doc` 的字号、行距、段距与阅读列宽；阅读层和编辑面的排版仍然一套。
- 不引入入场动画；浮层与悬停态沿用现有的 `--transition-fast`。

预计改动面：`NoteEditor.vue`、`NoteFullscreen.vue` 两个文件为主，`global.css` 只加只读代码块的复制钮与覆盖层尺寸，`NoteScrollTop` 不改。

## 4. 落码设计

### 4.1 选中浮条补 B / I / S（W1）

已交付（2026-10-30），形态与验收以 [11-editor-typography.md](11-editor-typography.md) 为准；下列数值按落码实况标注。

- 位置：`NoteEditor.vue` 的 `.fmt-bar`，在「行内代码」「添加链接」之前插一组三颗，组间加一条 16px 高、`--border` 的细分隔线。当前两颗不退位、不换位置。
- 形态：不新画图标。三颗各用 13.5px 的文字字形——`B` 粗体、`I` 斜体、`S` 删除线，按钮 28px 方钮、圆角 7；激活态沿用 `.fmt-btn.on` 的 `--accent-soft` 底与 `--accent-active` 字。理由：Solar 图标集里没有现成的 B/I/S，硬造三枚线性图标会和这一排的「文字即格式」语义对不上。
- 行为：`toggleBold / toggleItalic / toggleStrike`，`chain().focus()` 后再切，保选区。三颗都带 `aria-pressed` 与 `title`（粗体 Ctrl+B、斜体 Ctrl+I、删除线 Ctrl+Shift+S）；激活态与代码/链接两颗同一读法，靠 `updateFormatBar` 每次事务更新位置对象触发的重渲染刷新，`aria-pressed` 由 `notes-typography.spec.ts` 钉住。
- 边界：代码块里浮条本来就不出现；输入法合成中（`view.composing`）不接切格式，避免把还在候选窗里的文字换 mark；混合选区的激活态按 ProseMirror `isActive` 的既有口径，不额外做三态。
- 宽度：五颗的实际宽约 160px，仍小于 `BAR_W_MAX = 300` 的右缘夹取预算（`NoteEditor.vue:646`），链接输入态不变。
- 不变：`Mod-B / Mod-I / Mod-Shift-S` 的快捷键本来就能用，这一项只是把它们变成看得见的入口。

### 4.2 阅读面任务勾选（R1，需确认）

- 现状：`NoteFullscreen.vue:362` 用 `pointer-events: none` 把勾选框钉成只读，注释写明是「别让人点了以为改了状态」。卡面 `NoteCard.vue:167-186` 已有「渲染序 == 库序」的模型回写先例。阅读面本来就能删附件（`NoteFullscreen.vue:223-225`），「只读」并不是一条零写操作的绝对线。
- 建议：阅读面允许勾选并落库。点击时先 `preventDefault` 掉浏览器默认态，按渲染序找到模型 HTML 里的同序 checkbox，改 `checked` 与最近 `li` 的 `data-checked`，`emit('update', doc.body.innerHTML)`；`NotesModule.onFsUpdate` 走现有 `saveNoteContent`，关闭全屏前 `flushNoteSave` 已经在（`NotesModule.vue:264-267`）。
- 页头：阅读态当前固定写「只读浏览」（`NoteFullscreen.vue:145`）。改成「有保存态就显示保存态，否则只读浏览」——勾完显示「保存中… / 已保存」，状态回落再回到「只读浏览」。不新增按钮，也不把阅读面改名成编辑。
- 边界：加密条必须已经解锁（阅读面本来就只在明文在手时可进）；连续快速点击以库里的最新 `content_html` 为准，与卡面同一口径；勾选不切换成编辑态、不打断滚动位置。
- 可退：如果拍板认为阅读面应严格只读，这一项整条砍掉，其余四项不受影响。

### 4.3 代码块复制（R2）

- 只读面每个 `pre` 在渲染后补一颗 24px 的复制钮（现有 `copy` 图标，静态拼 24 网格 SVG，不新造图标），绝对定位在代码块右上角，用 `--bg-surface` 实底、`--border` 描边、`--shadow-xs`；默认为 `opacity: 0`，`pre:hover / pre:focus-within` 显形（与卡面动作排同一套悬停语言，不做入场动画）。
- 装饰在 `v-html` 之后做，先清掉旧的 `.code-copy` 再补，保证任务勾选导致重渲染时不叠钮。复制文本在装饰前快照进 `data-code`，不要用 `pre.textContent`——按钮自己的「复制」二字会混进剪贴板。
- 点击走现有 `useClipboard.copyToClipboard(text, '代码')`，成功提示沿用「已复制」；复制内容只含代码，不含语言标签或行号（当前本来就没有行号）。
- 键盘：按钮可 Tab 到，Enter/Space 触发；`aria-label="复制代码"`。失败时不静默，走 toast 的错误轨。
- 不在编辑面加同一个钮：编辑面已有语言选择器，代码框选复制是主路径；阅读面才是「读代码」的地方。

### 4.4 图片看大图（R3）

- 阅读面点 `img[data-note-image]` 打开覆盖层：`position: fixed`、`inset: 0`，复用现有 `.dialog-overlay`（`--overlay` 遮罩、z-index 1000 已登记在 `scripts/check-zindex-stack.mjs`，不新增 z-index 档位），图片按 `max-width: calc(100vw - 96px)` / `max-height: calc(100vh - 96px)` 适应视口，保持原比例，不做缩放、拖移、轮播。覆盖层 Teleport 到 body，避免卷进阅读面的焦点陷阱。
- 关闭：点遮罩、点右上角关闭钮、Esc 三路。Esc 用 `useEscapeClose` 的条件注册，必须比全屏阅读层先关（覆盖层后注册、`afterTarget` 为 false，现有关闭栈已支持）；点图片本身不关闭，避免读细节时误触。
- 焦点：打开时焦点落到关闭钮，覆盖层自己循环 Tab，不逃到阅读层背后；关闭后焦点回到阅读面。覆盖层不参与 `.note-doc` 排版，不加任何过渡。
- 边界：图片在外链 `a` 里时，链接优先（先交给 `openLinkFromClick`），不抢成看图；附件区缩略图不属于正文图，本轮不接。

### 4.5 阅读面回顶（R4）

- `NoteFullscreen.vue:229` 的 `.fs-scroll-actions` 从「仅书写态」改为两态都渲染，里面仍然只放 `NoteScrollTop`，target 是现有的 `scrollRef`。回顶钮本身不改，大于 80px 才出现。
- 阅读面没有底栏，回顶钮落在阅读面底沿上方，与书写态的落位同一套；不遮挡正文最后一行。

## 5. 不变项

- 三张书写面共用一颗编辑器的结构不变；阅读面仍不是第二个编辑器。
- `.note-doc` 的字号、行距、段距、列表与代码块排版不动；`--fs-max`、`--workspace-content-max` 不动。
- `sanitizeNoteHtml`、`safeLink / safeImage`、导出（Markdown/HTML/PDF/Word）、附件目录与加密链路不动。
- 暂无新图标需求：复制用现有 `copy`，关闭用 `x`，回顶用 `NoteScrollTop` 现有的 `chevDown`。
- 不改页面级快捷键：仍只有 Ctrl+B / Ctrl+K，不新增功能键；B/I/S 的快捷键是编辑器 mark 自带的。

## 6. 验收

- 单测：格式化命令的可用性、阅读面 checkbox 模型回写（渲染序对位、`data-checked` 同步）各补一条；现有 `NotesModule.test.ts` 的阅读/卡面断言不改语义。
- e2e：`notes.spec.ts` 补三组——选中浮条 B/I/S 的落笔与激活态；阅读面勾任务后关掉再开仍在、卡面同步；代码块复制钮出现且复制内容不含按钮文案。看图覆盖层补开/关与 Esc 层级（Esc 只关覆盖层，不关阅读面）。
- 拍帧：1040×670 纸/墨两底色，阅读面（代码块复制钮、任务已勾/未勾、图片大图覆盖层）与选中浮条五钮；1440×900 再看一次阅读列宽与覆盖层比例。
- 无障碍：三颗格式钮有 `aria-pressed` 与可读 `title`；代码复制钮可键盘触发；覆盖层有 `role="dialog"`、焦点环与 Esc；不靠颜色单独表达激活态。
- 回归：滚动条 `scrollbar-gutter: stable` 不回退；正文不因悬停按钮出现横移；阅读面字号/行距与编辑面仍逐行一致。

## 7. 待拍板

1. **阅读面任务勾选**：推荐放开（落库，页头显示保存态）；若坚持「阅读面只读」，这一项删除，保留 W1/R2/R3/R4。
2. **看图覆盖层**：默认只做「适应视口的大图」，不做缩放/拖移；如果截图细节需要 100% 像素级查看，另立一轮。
3. **R5/R6（文内查找、标题目录）**：本轮不做，等长文实际变多再单独出方案；不在这一轮顺手加半套。
