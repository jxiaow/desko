# 小记 · 正文链接

- 状态：已实现、已验证（代码未提交）
- 日期：2026-10-15
- 范围：正文里 `<a>` 的存、显、点、复制、导出往返；选中浮动条补链接与行内码入口

## 1. 初始现状（实施前基线）

| 事实 | 出处 |
|---|---|
| 编辑器的扩展表里没有 link：粘进来的 `<a href>` 在 schema 中无处落，ProseMirror 只留文字、静默丢掉地址 | `src/components/notes/NoteEditor.vue:252` |
| 下游早就为链接建好了，只是没水：清洗器保留 `href`、补 `target=_blank` 并强制 `rel="noopener noreferrer"` | `src/utils/sanitizeNoteHtml.ts:53` |
| 复制双轨的纯文本轨出裸地址，标题只活在 HTML 轨（此前已拍板） | `src/utils/format.ts` `htmlToLinkText` |
| 三张面共用一条链接样式，注释里点名的就是卡片/全屏/书写三处 | `src/styles/global.css:2661` |
| Markdown 导出走 turndown，链接自然成 `[标题](地址)` | `src/utils/noteExport.ts` |
| WebView2 没有新窗口处理器：`<a target=_blank>` 点了不会自己开，必须显式交给本机 | `src/utils/openExternal.ts:3` |
| 排序状态机有三档但没有任何入口；两个插入命令也没人调 | 已删：`noteSort`、`insertTask`、`insertInlineCode` |

症状串起来即：链接进来被降成文字 → 复制出去当然没有链接。缺的是存，不是显。

## 2. 拍板结论（本轮已定）

1. 正文里存地址本身，不存 Markdown 包装；本轮只治「地址丢了」。
2. 书写面点击不跳转，只有阅读面（卡片正文、全屏只读）点开本机浏览器。
3. 选中浮动条补三颗：行内代码 / 添加链接（已链接则改链）/ 移除。
4. **第二步不做**：粘贴字面 `[标题](地址)` 折成真链，等这一步的粘贴体感拍过再说。
5. **不引完整 Markdown 粘贴解析**：`#` 在本编辑器是标签触发字符（`src/utils/format.ts:29`），标题/列表语法会和标签、斜杠菜单打架。
6. 顺手按「死代码就删除」清掉排序三档与两个没人调的插入命令，不给它们补 UI。

## 3. 落点

| 位置 | 做了什么 |
|---|---|
| `src/components/notes/NoteEditor.vue:259` | `StarterKit.configure({ link: {...} })`：`openOnClick:false`、`autolink`、`linkOnPaste`、`defaultProtocol:'https'`、`validate` 接清洗器口径、`HTMLAttributes` 与清洗器回写的 rel/target 对齐 |
| `src/utils/sanitizeNoteHtml.ts:13` | 导出 `safeLink()`：什么算合法地址只留这一份答案，编辑器与渲染共用 |
| `src/utils/openExternal.ts:24` | `openLinkFromClick()`：阅读面正文里的点击认领链接，其余不接管 |
| `src/components/notes/NoteCard.vue:239` | 卡片正文点击链路排在勾选之后：开链接不等于把卡片切到编辑态 |
| `src/components/notes/NoteFullscreen.vue:113` | 全屏只读面同一入口 |
| `src/components/notes/NoteEditor.vue:658` | `.fmt-bar` 浮动条：第二个 Teleport 到 body，`position:fixed` + `coordsAtPos` 视口坐标，钮一律 `mousedown.prevent`，改链期间把选区记在 `linkRange` 里 |

浮动条沿用本仓库既有的浮层方言（斜杠菜单同款），没有为一条浮层引 `@tiptap/extension-bubble-menu` / floating-ui。

## 4. 决策记录

| 决策 | 理由 | 代价 |
|---|---|---|
| Link 不单独注册，只经 StarterKit 配 | v3 的 StarterKit 自带 link，再 `Link.configure()` 会得到 `Duplicate extension names found: ['link']`，两处配置互相盖 | 配置项得写进 `StarterKit.configure`，读代码时容易漏 |
| 不加 `@tiptap/extension-link` 直接依赖 | 声明 `^3.31.3` 会重新解析到 3.32.0，与 `@tiptap/starter-kit` 锁死的 `@tiptap/pm@3.31.3` 冲突装不上（ERESOLVE） | 依赖表里看不到 link，得知道它是传递依赖 |
| 地址合法性只认 `safeLink` 一份 | 否则编辑器放行、清洗器再把 `href` 删掉，同一地址两套结论 | 校验规则改一处会影响两处 |
| 阅读面读 `getAttribute('href')`，不读 `anchor.href` | `#锚点` 与 `/相对` 经 `anchor.href` 会被补成本机 localhost，等于把内部片段送到外部浏览器 | 得自己按前缀放行 |
| `#` 与 `/` 开头的地址允许存、允许显示，但不走外部浏览器 | 它是同一篇文档内的跳转，语义属于本应用；外部化只认 `http(s):`/`mailto:`。协议相对写法 `//host/x` 一并被 `safeLink` 拒掉 | 点这类地址目前没有就地跳转 |
| 移除链接要求整段选中 | mark 只 unset 一半会把它劈成两截（e2e 第一版就栽在这里） | 半选时点移除只清掉半边 |
| 加链/移除后把光标落到选区末尾 | `.focus()` 补发的那拍事务会按旧选区把浮条重新浮出来：留着选中态就是「关掉又弹开」的竞态（e2e 复现过一次 flaky） | 落地后不能立刻再点移除，得重新划选 |
| 代码块内不浮条 | 块里划字是为了复制，浮层只会压住下一行 | 块内想加行内码得先退出块 |
| 第三颗做成「移除」文字钮 | Solar 骨架 69 键里没有断链图形，为它加一颗图标不值 | 与另两颗图标钮视觉不齐 |

## 5. 验收

- 单测 104 绿：`src/utils/openExternal.test.ts`（4，含正文链接点击认领 3 例）、`sanitizeNoteHtml.test.ts`、`stores/notes.test.ts`（41）、`utils/format.test.ts`（56）。
- e2e 6 绿（`e2e/specs/notes.spec.ts`，连跑两轮不飘）：
  1. `:1009` 粘 `<a>` 后地址留在 DOM 与落库正文里；
  2. `:1022` 裸地址输入后自动成链；
  3. `:1030` 阅读面点正文链接 → `shell:open` 记一次，卡片不切编辑态；
  4. `:1048` 浮动条加链（裸域名补 `https://`）与整段移除；
  5. `:1072` 行内码落进选区，且代码块内不浮条；
  6. `:222` 原有「一键复制带链接的小记」不回归。
- 卡片正文只露首块时，链接住在被提升成标题的那一段里（`display:none`），要点开全文才点得着——这是标题行提升方言的既有行为，不是链路断。
- jsdom 单测里链接夹具必须不挂进 `document.body`，否则 `<a href="/notes">` 会真导航，测试被一条无害警告拖着走形。
- **未覆盖**：真机 WebView2 里 `plugin-shell open` 真开浏览器（e2e 走的是 mock 记账）。

## 6. 余量（未拍板）

1. 粘贴字面 `[标题](地址)` 折成真链（原方案第二步）。
2. 阅读面对 `#`/`/` 型地址的就地跳转。
3. 链接 hover 预览与一键复制地址的胶囊。
