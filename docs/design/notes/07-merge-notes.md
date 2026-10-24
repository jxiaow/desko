# 多条小记合并成一条

日期：2026-10-23　状态：**已实现**（正文拼接 + 同类列表焊接；新建一条；源条目确认弹窗后直接删；全加密→结果也加密、混选拦下）

## 1. 需求一句话与它的硬账

勾选多条小记 → 合成一条，且**各条正文里的列表并成一个列表**。动笔前核到四件必须先认的账：

1. **图片不用拷文件，但顺序错了会删掉文件。** 附件住在共享平铺目录、文件名 `<uuid>__<原名>`（`src-tauri/src/services/attachment_service.rs:138-139`），正文只写 `attachments/<名>`（`src/services/attachmentSrc.ts:33`）。删条目时走 `delete_unreferenced_files`（`attachment_service.rs:327-336`），判据是**"还有没有 attachment 表里的行认领它"**，不看正文。所以合并结果必须先 `bind_attachments` 把这些名字认领到新 id，**才能**删源；`bind` 没成功就删源，图片文件当场没了。
2. **批量删除有现成命令**：`api.batchDeleteNotes(ids)`（`src/services/api/notes.ts:23-24` → `src-tauri/src/commands/notes.rs:65-76`），单事务循环；e2e mock 同形（`e2e/mocks/backend.ts:2135-2146`）。
3. **读密文要有明文在手**：加密条目只有 `notePlains[id]` 非空才读得到正文（`src/stores/notes.ts:78-79`；锁着的卡连点开都不行，`NotesModule.vue:195`）。导出那条链已有现成口径：跳过 + 计数提示（`src/components/notes/NoteExportController.vue:54-64`）。
4. **合并要新写一个纯函数**：仓库里没有任何"相邻同类列表并干"的工具（全仓 grep merge/consolidate 无命中），能复用的是 `sanitizeNoteHtml`（认 `data-type`/`data-checked`，`src/utils/sanitizeNoteHtml.ts:75-81`）和 `noteExport.ts:28-55` 那套 DOM 走块写法。

## 2. 拍板结论

### 2.1 正文怎么合：拼接 + 同类列表焊接

新纯函数 `mergeNoteHtml(parts: string[]): string`（新文件 `src/utils/noteMerge.ts`），规则表：

| 情形 | 处理 |
| --- | --- |
| 块顺序 | 按各源 `created_at` **升序**（旧→新）逐顶层块 append。列表显示是新→旧，清单是攒出来的，追加在后更合语义 |
| 相邻两块的"族"相同 → 焊成一块 | 族只有三种：`ol`、`ul`（普通项目列表）、`ul[data-type="taskList"]`（待办，`NoteEditor.vue:352-353` 的 TaskList/TaskItem）。同族才并 `li`，异族相邻原样摆 |
| 两块之间只隔着空块（空 `p`、只有 `br`/`&nbsp;` 的 `p`） | 空块**吃掉**再焊。吃不掉就永远不相接，用户要的"一个列表"合不出来 |
| 两块之间夹着非空段落/标题/引用/图片/`hr` | 不焊，结构保留（本项不是"把所有东西变成一个列表"，是"把被劈开的列表接回去"） |
| 列表内部的嵌套子列表 | 逐字保留，只并顶层块（`TaskItem` 是 `nested: true`） |
| 非列表块（`p`/`h1-h3`/`blockquote`/`pre`/`img`/`a`/`hr`） | 逐字保留，不插"来源标题"这类原库没有的分节结构 |
| 整条只有空白/空段落的源 | 贡献 0 块，不在结果里留洞 |
| 收尾 | 结果过一道 `sanitizeNoteHtml`（未知标签它是**拆壳不丢内容**，`:44-46`），再 `normalizeAssetHtml`（`attachmentSrc.ts:73`）。库里存的已是相对形态，仍过一遍，为的是"落库口径只有一条"（同 `publishNote`，`src/stores/notes.ts:327`） |

标题与分类沿用 `publishNote` 同一口径，不新造答案：`deriveTitleFromHtml(merged)`（`src/utils/format.ts:89-92`）、`category = noteMeta(merged).tags[0]`（`src/stores/notes.ts:330`）。正文里的 `#标签` 是文字本身，跟着块自然带过来。

### 2.2 落点：新建一条 + 源直接删（确认弹窗）

- 新建走 `api.createNote`（id 由 Rust 侧 `Uuid::new_v4` 生成，`note_service.rs:5`），`created_at = 现在` → 结果自然落在「今天」组最前（排序 `stores/notes.ts:250`、分组 `:254-272`）。置顶/收藏/归档一律 false，**不继承任何一条源的状态**（继承哪条都是偏爱）。
- 删除用 `api.batchDeleteNotes(源 ids)`，确认弹窗沿用 `confirmStore.showConfirm`（`src/stores/confirm.ts:15`）与既有文案同调：
  - 标题 `合并小记`，正文 `N 条小记将合成一条，原条目将被删除，此操作不可撤销。`，动作钮 `合并`。

### 2.3 加密边界：整组同性质

- 全明文 → 结果明文。
- 全加密且都在手（`notePlains` 齐）→ 结果**也加密**：复用 `api.lockNote(newId)` 命令，成功后按现有加密口径维护明文缓存，本会话仍可读。直接调用命令可避免临时明文条目先进入列表；store 的 `lockNote` 要求条目已在列表中，且以返回值报告错误。
- 混选 → **当场拦下**，连确认都不出，toast `请只合并同类：勾选里既有加密也有明文小记`。口令边界不在合并里被悄悄抹掉。
- 全加密但整库口令没开 → 按导出口径跳过并计数：`未合并：N 条小记未解锁`。

### 2.4 顺序把不可回滚那一步放最后

调用序按组的性质分两条，唯一原则：**删源永远是最后一步**，任何前置失败都不留下"内容变少或变性"的中间态。

```
明文组： createNote → bindAttachments → batchDeleteNotes
加密组： createNote → bindAttachments → lockNote → batchDeleteNotes
```

失败面逐条（写死在实现里，别留给运气）：

| 失败点 | 收场 |
| --- | --- |
| `createNote` 抛错 | 什么都不动，`合并失败：` + message（沿用 `publishNote` 的 `创建失败：` 措辞族，`stores/notes.ts:349`） |
| `bindAttachments` 抛错 | **不删源、不上锁**；补偿 `deleteNote(newId)` 撤掉刚建的那条，toast `合并中止：附件登记失败：…`。源条目与图片文件一根毛都没动 |
| `lockNote` 抛错（加密组） | 同样不删源，撤新条目，toast `合并中止：新条目加密失败：…`。绝不允许"源已删、结果却成了明文" |
| `batchDeleteNotes` 抛错 | 新条目已成型、源还在（用户看到重复内容）。toast 明说：`合并未完成：新条目已生成，原条目删除失败：…`，不清选择、让用户能立刻重试 |
| 全成 | 记 `notes` 前插新条、清掉源的行与 `notePlains`（照 `batchDelete` 的本地收尾写法，`stores/notes.ts:900-914`），清空选择退出待选，toast `已合并 N 条小记` |

## 3. 落点

| 文件 | 改动 |
| --- | --- |
| `src/utils/noteMerge.ts` | **新增**：纯函数 `mergeNoteHtml(parts)`，§2.1 那张表全在这，不碰 store、不碰 DOM 之外的东西 |
| `src/stores/notes.ts` | 新增 `mergeSelectedNotes()`（读选中 id → 排序 → 取明文口径（加密走 `notePlains[id]`）→ §2.1 拼正文 → §2.4 调用序 → 本地收尾与 toast）；随 `batchDelete` 同族导出 |
| `src/components/notes/NotesModule.vue:653-666` | 非归档那一支加一颗文字钮 `合并`，`:disabled="selectedNoteIds.size < 2"`，接 `mergeSelectedNotes()`；归档视图不做合并（那支只有「取消归档」，且合并会把归档条目拉回活跃列表，语义打架） |
| `e2e/mocks/backend.ts` | 无需新命令；修正 `bind_attachments` 去重口径为同一 note id + 文件名，让共享图片能登记到合并结果名下，与 Rust 一致 |

批量底栏于是成为：全选 · 取消全选 · 导出(非 Web) · 归档 · 更多 ▾ · **合并** · 删除 · 完成。Web 端不做豁免——合并只用标准 CRUD，经 `/api/invoke` 走桌面侧（`src/services/transport.ts:97`），只有导出因为要落盘文件才是 native-only（`NotesModule.vue:647`）。

与 `06-paste-switch-and-copy-out.md` 无冲突：那份动的是卡头 hover 排与设置面板，这份只在批量底栏加一颗，两个容器。

## 4. 验收

- **单测（新）** `src/utils/noteMerge.test.ts`：同族 `taskList` + 中间空段落 → 焊成 1 块且 `li` 数相加；`taskList` 与 `ul` 相邻 → 仍 2 块；中间夹非空段落 → 不焊；嵌套子列表逐字保留；纯空白源贡献 0 块；`img src="attachments/x__a.png"` 过完仍是相对形态；结果里 `data-type`/`data-checked` 未被洗掉。
- **单测（store）** `src/stores/notes.merge.test.ts`：拼接顺序旧→新；混选拒绝且一次 API 都没发；加密组 `lock_note` 调用序在 `batch_delete_notes` **之前**；`bind_attachments` 失败时源未被删且新条目被补偿删除；`batch_delete_notes` 失败时保留选择、新条目留库；未解锁跳过计数。
- **组件测** `NotesModule.test.ts`：现有 `:481` 用位置取第一条 `.dock-btn`（= 全选），新用例一律按 `text-is`/`aria-label` 定位，别再加位置断言。
- **e2e**（`e2e/specs/notes.spec.ts` 批量段之后，沿用 `memo(page, text)`(`:16`)、`.memo-check` 勾选、`expectToast`）：
  1. 三条 seed（甲=2 项待办、乙=2 项待办、丙=3 项项目列表）→ 勾选三条 → 点 `合并` → 断言确认文案 → 新卡里 `ul[data-type="taskList"]` 计数 **1**、其 `li` 计数 **4**、`ul:not([data-type])` 仍 **1** 且 3 项 → 甲乙丙三卡消失 → toast `已合并 3 条小记`。
  2. 加密组：两条已解锁的加密条目 → 合并后 `encrypted` 为真、源消失，本会话仍可读；重新锁定后新卡显示 `.memo-locked`/锁形（口令未开那条另测跳过文案）。
  3. 只勾 1 条时 `合并` 处于 `disabled`（与 `:675` 那排计数一起看）。
- **拍帧**（临时 spec 落 %TEMP%，1040×670，纸/墨双主题）：底栏含合并钮两态（可选 1 条 / 2 条）、确认弹窗、合并前后同屏对比、全加密那组的锁形卡。

## 5. 实现记录

- 删除源条目前核对附件登记结果；`bindAttachments` 即使没有抛错，只要漏登记图片，也会撤销新条目并保留源条目。
- 确认后重新核对源条目与解锁状态，并先落完待保存编辑；应用锁定后到达的异步结果不会重新填回列表或明文缓存。合并执行中禁止重复发起。
- 附件登记或加密失败时撤销新条目；若撤销本身也失败，明确提示并保留可见的新条目，便于处理。删源失败则保留完整结果与原选择。
- 纸/墨 1040×670 截图收在本机 `.tmp/notes-review-20261023/`，临时拍帧 spec 位于 `%TEMP%/desko-notes-review-20261023/`。
- 两份方案的相关单测共 120 个通过；小记、粘贴及阅读三个 spec 共 76 个浏览器用例通过。全仓类型检查及完整构建受范围外的 Codex HUD 类型/导出不匹配阻断，专项验收使用固定的 e2e 主应用构建。
- 最后自查将 HTML 拼接容器也改为惰性文档，清洗前不把原始节点移入当前页面的文档；对应合并工具与 store 的 29 个单测复跑通过。
