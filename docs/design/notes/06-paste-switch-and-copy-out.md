# 粘贴整理开关与「复制」放出卡排

日期：2026-10-23　状态：**已实现**（单开关管两处自研步骤；复制进卡头 hover 排第 4 颗、⋯ 菜单删除该重复入口）

## 1. 现状事实（逐条回扫代码核验过）

小记三个书写面（顶部草稿 `composer`、卡片就地编辑 `card`、全屏 `full`）共用 `src/components/notes/NoteEditor.vue` 一颗编辑器，粘贴路径只有这一处，所以一个开关能管全三面。

`NoteEditor.vue:275-277` 挂了三个入口，其中**自研的"格式优化"只有两处**：

| 步骤 | 位置 | 干了什么 |
| --- | --- | --- |
| ① 抢占纯链接粘贴 `pasteLinkAsUrl` | `NoteEditor.vue:585-611`，注册在 `:276` | 剪贴板 `text/plain` 是一整条 http(s) 地址时，丢掉 HTML、只把地址当带 link mark 的文字落子；若 HTML 里正好是「一个链接 + 链接文字==唯一文本」，追加弹出「转换为标题」气泡（`:623-631`） |
| ② 空白整理 `normalizeNotePaste` | `src/utils/notePaste.ts:78-86`，注册在 `:277` | 合并相邻 `hardBreak` 及其间空白（`:16-36`）、删空段落（`:7-14`）、纯空白粘贴只留一段（`:52-55`）、删空段落后重算 `openStart/openEnd` 让引用/列表保持闭合（`:58-75`）；代码块与 `<pre>` 逐字保留（`:41-44`、`:79`） |

**不归这两处管、本开关也关不掉的**（写清楚，免得关掉后用户以为还能"原样"）：

- 字体/颜色/字号/对齐/表格丢失 = Tiptap+ProseMirror 按 schema 解析剪贴板 HTML，认不出的节点与内联样式进不来；本仓库没有装表格扩展（`NoteEditor.vue:334-357` 的 extensions 里无 Table），表格**无论开关开合都会掉**。
- 地址自动变链接：StarterKit 的 `link` 配了 `autolink: true` + `linkOnPaste: true`（`NoteEditor.vue:341-348`）。关掉①只是不再抢这条粘贴、不再弹标题气泡，纯地址仍可能被编辑器自己识别成链接。要连这一步也关掉得重建扩展集合，本轮不做。
- 截图/图片文件粘贴转附件（`NoteEditor.vue:790-813`，绑定在 `:819`）：**不受开关影响**。图片进 `attachments/` 是小记的数据形态，不是格式整理；关掉只会变成"图片贴不进去"。
- `#标签` 高亮、斜杠菜单、Markdown 输入规则：与粘贴无关。

`src/components/notes/NoteMoreMenu.vue:90-92` 的「复制正文」是卡排 hover 排与全屏阅读态首栏共用的那一颗 ⋯ 里的菜单项；链路与 `copyRichToClipboard` 双轨（`text/html` + 裸链接纯文本）都保持不动。

## 2. 拍板结论

### 2.1 一颗开关：「粘贴时整理格式」，默认开（开＝现状）

关掉＝②跳过、①跳过；其他一律不变。放在 **设置 → 模块配置 → 小记**（`src/modules/settings/NotesSettings.vue`，该面板目前只有口令那一行，这是它第一颗真控件），不放「通用」——只管小记一域。

- 键名 `note_paste_cleanup`，值 `"true" | "false"`，**缺键＝开**（老档案、Web 端首次读空串都落回现状，不需要迁移）。
- 一条通道：`settingsApi` → SQLite `meta`，与 `background_atmosphere`/`lock_on_close` 同族；不走 `localStorage`（`stores/notes.ts:23-27` 那种 rail-pinned 是"界面偏好、各端各自记"，本项是**内容行为**，该跟配置与档案走）。
- 读取时机：状态落在 notes store（`notePasteCleanup = ref(true)` + 一个 `loadNotePasteCleanup()`），store 体内自起一次，覆盖"先进小记"与"直接开设置弹窗"两条路；`editorProps` 的两个 handler 在**每次粘贴时**读 `.value`，因此不需要重建编辑器，切换后下一笔粘贴即生效。
- 三处登记必须同时加，少一处就是静默失败或 Web 端报错：`src-tauri/src/commands/settings.rs:58` `ALLOWED_KEYS`、`e2e/mocks/backend.ts:655` `SETTINGS_ALLOWED_KEYS`（`registry.ts:38` 的注释就是这条坑）、`src/services/transport.ts:4` `WEB_PREFERENCES`（并进 `:90` 的 `defaults` 给 `'true'`，Web 端存 `desko.web.note_paste_cleanup`）。
- 控件按"失败回滚"那一档写：`:checked` 单向 + `@change` 里 `previous` 兜回（`src/modules/settings/CodexSettings.vue:72-86` 现成模式），不用 `v-model`，免得写库失败后界面和库里不一致。

文案（一句一个意思，界面自解释）：

- 名称：`粘贴时整理格式`
- 说明：`关掉后粘贴尽量原样落子：不再合并空行与空段落，粘纯链接也不再弹「转换为标题」。图片仍存为附件。`

### 2.2 复制进卡头 hover 排，⋯ 菜单删掉「复制正文」

- 未归档视图那排变 5 颗：全屏查看 · 编辑 · 置顶 · **复制** · ⋯；归档视图那排同样把复制插在末位可切换那颗之后：全屏查看 · 编辑 · 取消归档 · **复制** · ⋯。
- 加密未解锁那条（解锁 · 导出）不加——密文没有可复制的正文。
- 批量态整排隐藏（`NoteCard.vue:259`）不变。
- **不留两个入口**：`NoteMoreMenu.vue` 删掉 `:90-92` 那项与 `copy` emit（`:26`），沿用本文件 `:96` 已立的规则「排上占了哪颗开关，菜单只补另一颗」。
- 菜单是共用的，删了这边全屏阅读态也跟着没有复制，所以 `NoteFullscreen.vue:147-161` 首栏右侧补一颗 `bar-btn` 复制（顺序：置顶 · 编辑 · **复制** · ⋯）。
- 几何不用重算：5 × 26px + 4 × 2px gap + 2 × 3px padding = **144px**，仍在无标题卡现有的右让位预算 `--memo-controls-width: 160px`（`NoteCard.vue:614`）之内；钮一律吃 `.memo-acts .ib` 现成档位（26px、15px 图标），不新增类。

已知风险：一排 5 颗同族细描边图标比 4 颗密。若拍帧判定挤，退路是复制改落卡脚（`.memo-foot` 那一行常显），本轮不预付这层复杂度。

## 3. 落点

| 文件 | 改动 |
| --- | --- |
| `src/stores/notes.ts` | 新增 `notePasteCleanup` 状态 + `loadNotePasteCleanup()` + `setNotePasteCleanup()`（写失败回滚并返回 false），store 体内起一次读取 |
| `src/components/notes/NoteEditor.vue:276-277` | 两个 handler 各自短路：关掉时 `handlePaste` 返回 `false`、`transformPasted` 原样返回 `slice`（`:82` 的 `content.eq` 快速路径本来就保证不产生事务差异） |
| `src/modules/settings/NotesSettings.vue` | 加第一颗 `.setting-item` + `.switch` 行（`:checked`+`@change` 回滚），接 store |
| `src/components/notes/NoteCard.vue:266-309` | 排里加一颗 `<button class="ib" title="复制正文">`（复用已声明的 `copy` emit，`:62`），向 `NoteMoreMenu` 的 `@copy` 接线随之移除 |
| `src/components/notes/NoteMoreMenu.vue:26,90-92` | 删 `copy` emit 与菜单项 |
| `src/components/notes/NoteFullscreen.vue:147-161` | 首栏补 `bar-btn` 复制，接 `NotesModule.vue` 已有的 `copyNote`（`:345-346`） |
| `src-tauri/src/commands/settings.rs:58`、`e2e/mocks/backend.ts:655`、`src/services/transport.ts:4,90` | 三处登记 `note_paste_cleanup` |

## 4. 验收

- **e2e 契约改动**：`notes.spec.ts:675`、`:879` 的 `.memo-acts button` 计数 4 → 5；`:677` 的 ⋯ 文案数组去掉 `'复制正文'`；`:236-249` 两条复制用例改点卡排那颗（按 `aria-label="复制正文"` 定位，不靠 nth），并补一条「⋯ 菜单里查不到复制正文」的去重断言。`notes-reading.spec.ts:36`（批量态无排）与 `NotesModule.test.ts:505` 不动。
- **e2e 新增**（`notes-paste.spec.ts` 里，沿用现有 `paste()` 辅助）：开关关掉后 ①同样那笔富文本粘贴，空行/空段落**保持原样**（`br` 计数与段落数按关态预期重写，现有三例变体循环仍跑开态默认）；②粘纯链接后 `.pasted-link` 那颗「转换为标题」气泡不出现，且 `Control+z` 仍一笔回滚。
- **单测**：`src/utils/notePaste.test.ts` 不动（纯函数，开关在调用侧）；store 补一条 `setNotePasteCleanup` 写失败回滚 + 缺键默认开。
- **拍帧**（临时 spec 落 %TEMP%，1040×670，纸/墨双主题）：卡排 5 颗 hover 帧、无标题卡右让位帧（验 144 不压正文）、⋯ 菜单帧、全屏阅读态首栏帧、小记设置页开关两态帧。

## 5. 实现记录

- 设置读写与失败回滚在 `src/stores/notes.ts`；读取带版本校验，防止启动时的慢读取覆盖用户刚改的值。对应测试收在 `src/stores/notes.merge.test.ts`，Web 本地设置契约在 `src/services/transport.test.ts`。
- 卡片、归档卡与全屏阅读态各保留一处复制入口；锁住的卡不提供复制。纸/墨 1040×670 截图收在本机 `.tmp/notes-review-20261023/`。
- 既有粘贴 e2e 修正了两个落点假设：非空段落末尾的首块会接入原段落；代码块后的补空段落不能用 `Ctrl+End` 当成代码内部。未改变粘贴整理纯函数。
- 两份方案的相关单测共 120 个通过；`notes.spec.ts`、`notes-paste.spec.ts`、`notes-reading.spec.ts` 共 76 个浏览器用例通过。使用 Edge 与固定的 e2e 主应用构建，避免热更新中途重置会话。
- 全仓检查尚未通过：范围外的 Codex HUD 出现 `walk` 类型字段、`HUD_IDLE_MOVES` / `saveHudWalk` 导出不匹配，阻断全仓类型检查及完整构建。浏览器验收使用已生成的固定主应用构建，未包含独立 HUD 窗口入口；合并 HTML 全程留在惰性文档中的最后调整已复跑对应 29 个单测。
