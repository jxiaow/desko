# 小记 · 导出与归档

- 状态：待拍板（未动代码）
- 日期：2026-10-14
- 样张：`archive-frame1.png`（归档视图）·`archive-frame2.png`（归档勾选态）·`archive-frame3.png`（主列表导出菜单）·`archive-frame4.png`（批量导出弹窗）
- 样张源码：`_mock_style.html` + `_frame1..4.html`（拼成整页后无头 Edge 1040×670 拍帧）

## 1. 现状

| 事实 | 出处 |
|---|---|
| `notes` 表只有 id/title/content_html/category/created_at/updated_at + pinned/starred + 加密六列，无任何归档/状态列 | `src-tauri/src/db/schema.rs:26`、`:107`、`:121` |
| 前端模型同样无归档字段 | `src/types/index.ts:67` |
| 卡片 ⋯ 菜单只有 加密/锁回/解除加密/删除；删除是物理直删，无回收站 | `src/components/notes/NoteCard.vue:124`、`src/stores/notes.ts:520` |
| 侧栏视图是 `all|pinned|starred` 三档枚举，加一档成本极低 | `src/stores/notes.ts:11`、`NotesModule.vue:19` |
| 批量 dock 已有：全选/置顶/收藏/删除 | `NotesModule.vue:454` |
| `tauri-plugin-dialog` + `plugin-fs` + `zip` 依赖已就绪，capabilities 已放行 | `src-tauri/Cargo.toml:19,20,40`、`capabilities/default.json` |
| 现成的「另存到磁盘」先例：备份导出 | `src/components/settings/BackupPane.vue:368`、`src-tauri/src/commands/backup.rs:258` |
| 加密正文明文只在解锁后存在于前端 `notePlains`，后端有 `reveal_note` 路径 | `src/stores/notes.ts:69`、`src-tauri/src/commands/note_lock.rs:381` |

## 2. 拍板结论（本轮已定）

1. 导出入口三档：单条 / 批量勾选 / 全库。
2. 导出格式四档：Markdown、HTML、Word、PDF。
3. 加密小记必须先解锁，只导出明文；解锁失败的条目跳过并在结果里报数。
4. 归档的展示口径见 §4，样张待拍板。

## 3. 导出

### 3.1 交互

- **单条**：卡片 hover 动作排在既有 全屏·编辑·置顶·收藏 之后插入「导出」「归档」两枚，再接 复制·⋯（frame3）。点导出直接在动作排下方弹 4 档格式菜单，选格式 → 系统另存对话框 → 落盘。单条不再套一层应用内弹窗，省一跳。
- **批量**：勾选态 dock 增加「导出」；全库入口在页栏右侧一枚方形下载钮（frame1 右上）。两者共用一个应用内弹窗（frame4）：标题带条数、`.seg` 选格式、说明块、主按钮「导出…」→ 系统对话框（单条目标文件 / 多条目标文件或目录）。
- **归档视图**同样能导出，且归档条目不进「全库」默认范围——全库导出只导未归档的，归档视图里另有「导出全部归档」。

### 3.2 格式与产物

| 格式 | 产物 | 图片附件 | 实现 |
|---|---|---|---|
| Markdown | `.md`（多条时 `.zip`） | base64 内嵌进 `![](data:...)` | 前端 HTML→MD 转换器（新增 `src/utils/noteExport.ts`），正文先过 `sanitizeNoteHtml` 同一条清洗链 |
| HTML | `.html`（多条时 `.zip`） | 同上，内嵌 | 模板拼装：真实 token 的打印友好样式 + 标题/日期/标签头 |
| Word | `.doc`（多条时 `.zip`） | 内嵌 | 同一份 HTML 加 Word 命名空间头（`<html xmlns:w=...>` + `<meta name=ProgId content=Word.Document>`），Word/WPS 直接打开。**明确不是 `.docx`**，弹窗说明里写清楚 |
| PDF | `.pdf`（多条合并成一份） | 内嵌 | 见 §3.3 |

单条四档都是单文件；多条时 md/html/doc 打成 `.zip`（`zip = "2"` 已在依赖里），PDF 合并成一份连续文档。

### 3.3 PDF 通道（技术风险点）

WebView2 的 `ICoreWebView2_7::PrintToPdf` 能把任意 HTML 打成 PDF，`webview2-com 0.39.1` 已在 `Cargo.lock`（tauri 传递依赖），但 wry/tauri 没有把这颗 API 暴露成现成命令，需要：

1. 用 `WebviewWindowBuilder` 开一颗 `visible(false)` 的 `export-*` 窗口，`http://localhost:1420/#/export?job=<id>`；
2. 前端把渲染好的 HTML POST 给该窗口，窗口 `document.write` 后回一句 ready；
3. Rust 侧从该窗口拿 `ICoreWebView2`（`with_webview` / `hwnd` + `GetAccessibleFromHwnd` 路线）调 `PrintToPdf(path, settings)`；
4. 完成后关闭临时窗口。

**先做小样验证**：单独一个 spike 命令跑通「隐藏窗 → PDF 落盘」再决定是否进主线。若 COM 取指路线在本机不通，回退方案是无头 `msedge.exe --print-to-pdf`（本机 Edge 常驻，`--headless` 已验证可用），代价是多一次进程启动（约 1–2s）。

### 3.4 加密条目

导出前置检查：命中加密条目且域未解锁 → 复用 `NoteLockDialog` 过一次口令；用户取消或失败 → 该条跳过。落盘只写明文，绝不导出密文信封。完成后 toast 报「N 条中 M 条已导出，K 条因未解锁跳过」。

## 4. 归档

### 4.1 语义

- 归档 = 从「全部/置顶/收藏」和搜索里消失，只活在「归档」视图；不是删除，不占回收站概念。
- 归档态保留全部既有属性（置顶/收藏/加密/标签），取消归档后原样回到主列表。
- 归档不影响加密：加密条目归档后仍是密文，`reveal` 只在解锁域时发生。
- 彻底删除仍是物理直删（本轮不引入回收站）。

### 4.2 数据

```sql
ALTER TABLE notes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN archived_at TEXT;
```

照 `schema.rs:107` 的 `pragma_table_info` 探测 + 幂等 ALTER 套路追加；`archived_at` 用来在归档视图头部显示「最近归档 N 天前」。

### 4.3 前后端落点（归档已按此实现）

| 层 | 落地 |
|---|---|
| schema | `schema.rs:142` 探针 + 两条 `ALTER TABLE`（`archived` 带默认 0、`archived_at` 可空），幂等：重开库不二次 ALTER |
| 仓储 | `list_all_notes` 不加参数，归档行照常带回，视图切分留在 store；`set_note_archived(id, flag, now)`（`note_repo.rs:233`）只在状态真翻转时写 `archived_at`，且不动 `updated_at`；`batch_set_archived`（`:244`）返回真改动条数 |
| 命令 | `set_note_archived`、`batch_set_archived`（`commands/notes.rs`，都要主密钥在手），注册在 `main.rs` 命令表 |
| store | `NoteView` 加 `'archived'`；`filteredNotes` 四分支（`notes.ts:222`）；`viewCounts` 四档、`archivedNotes`、`archiveSummary`；`tagCounts` 排除归档行；动作 `setArchived` / `batchSetArchived` / `unarchiveAllFiltered` |
| UI | `VIEWS` 加「归档」（新 `archive`/`unarchive` 图标，Solar 描边轨）；归档视图挂 38px 上下文条 + 一次性「全部取消归档」；书写框在归档视图收掉；dock 动作集按视图切换；顶栏条数按视图口径（`NotesModule.vue` `headTotal`） |
| mock/e2e | `NoteRecord` 加 `archived`/`archived_at`、seed 与 `create_note` 同步、两条 handler；`notes.spec.ts` 两个归档用例（单条往返 + 批量与全量恢复） |

### 4.4 动作去重（已实现）

hover 排、⋯ 菜单两处不得出现同一颗。
- 主列表 hover：查看、编辑、置顶、收藏、**归档**、复制、⋯（共 7 颗；导出那一颗随 §3 一起加）
- 归档视图 hover：查看、编辑、**取消归档**、**删除**、⋯（共 5 颗）
- 归档视图的 ⋯：置顶/取消置顶、收藏/取消收藏、复制正文、加密（或锁回/解除加密）——即被让出 hover 排的那几颗，删除不在这里重复

## 5. 交付顺序

1. PDF spike 验证（决定 §3.3 走哪条通道）——不通就当场改方案，不硬推进主线。
2. ~~归档：schema → repo → 命令 → store → UI → mock → e2e → 拍帧。~~ 已交付（2026-10-14）：Rust 3 条单测 + store/组件 6 条单测 + e2e 2 条用例全绿，真机 1040×670 三帧与 frame1/2/3 对拍通过。
3. 导出：转换器 → 单条菜单 → 批量/全库弹窗 → 加密前置 → mock → e2e → 拍帧。

## 6. 待点头

- [x] §4 归档样张三帧（frame1/2/3）照此实现 —— 已拍板并落地
- [x] §3.3 PDF 先花一轮做 spike；本机 WebView2 COM 路线不通则回退无头 Edge（多 1–2s）—— 已拍板，spike 未跑
- [x] Word 只出 `.doc`（Word-HTML），不做真 `.docx` —— 已拍板
- [ ] 多条导出打 `.zip`（本机已验证 ZIP64 之外的小包 Explorer 可读，导出量级在 MB 内）
