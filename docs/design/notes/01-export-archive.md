# 小记 · 导出与归档

- 状态：归档与导出已实现、已验证（代码未提交）
- 日期：2026-10-14；导出验证更新：2026-10-15
- 样张：`archive-frame1.png`（归档视图）·`archive-frame2.png`（归档勾选态）·`archive-frame3.png`（主列表导出菜单）·`archive-frame4.png`（批量导出弹窗）
- 样张源码：`_mock_style.html` + `_frame1..4.html`（拼成整页后无头 Edge 1040×670 拍帧）

## 1. 初始现状（实施前基线）

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
4. 归档的展示口径见 §4，样张已拍板并实现。
5. 多条 Markdown / HTML / Word 导出为 ZIP；多条 PDF 合并为单文件。

## 3. 导出

### 3.1 交互

- **单条**：卡片 hover 动作排在既有 全屏·编辑·置顶·收藏 之后插入「导出」「归档」两枚，再接 复制·⋯（frame3）。点导出直接在动作排下方弹 4 档格式菜单，选格式 → 系统另存对话框 → 落盘。单条不再套一层应用内弹窗，省一跳。
- **批量**：勾选态 dock 增加「导出」；全库入口在页栏右侧一枚方形下载钮（frame1 右上）。两者共用一个应用内弹窗（frame4）：标题带条数、`.seg` 选格式、说明块、主按钮「导出…」→ 系统另存对话框（单条文件 / 多条 ZIP / 合并 PDF，均选目标文件）。
- **归档视图**同样能导出，且归档条目不进「全库」默认范围——全库导出只导未归档的，归档视图里另有「导出全部归档」。

### 3.2 格式与产物

| 格式 | 产物 | 图片附件 | 实现 |
|---|---|---|---|
| Markdown | `.md`（多条时 `.zip`） | base64 内嵌进 `![](data:...)` | 前端 HTML→MD 转换器（新增 `src/utils/noteExport.ts`），正文先过 `sanitizeNoteHtml` 同一条清洗链 |
| HTML | `.html`（多条时 `.zip`） | 同上，内嵌 | 模板拼装：真实 token 的打印友好样式 + 标题/日期/标签头 |
| Word | `.doc`（多条时 `.zip`） | 内嵌 | 同一份 HTML 加 Word 命名空间头（`<html xmlns:w=...>` + `<meta name=ProgId content=Word.Document>`），Word/WPS 直接打开。**明确不是 `.docx`**，弹窗说明里写清楚 |
| PDF | `.pdf`（多条合并成一份） | 内嵌 | 见 §3.3 |

单条四档都是单文件；多条时 md/html/doc 打成 `.zip`（`zip = "2"` 已在依赖里），PDF 合并成一份连续文档。

### 3.3 PDF 通道（已验证并接入）

Windows 桌面版使用 WebView2 的 `ICoreWebView2_7::PrintToPdf`，实现见 `src-tauri/src/services/note_pdf.rs`。`webview2-com 0.39.1` 与配套的 `windows 0.62` 已显式加入 Windows 目标依赖，保持与 Tauri 的 COM 接口类型一致。

1. 前端生成清洗后、图片内嵌的完整 HTML，Rust 写入 UUID 命名的临时 HTML，避开 `NavigateToString` 的大小限制。
2. `WebviewWindowBuilder` 创建 `visible(false)` 的 `export-*` 窗口，初始地址 `about:blank`，再通过原生 `Navigate` 加载临时文档。无需开发服务器或额外前端路由。
3. `with_webview` → `controller().CoreWebView2()` 取得 COM 接口；关闭文档 JavaScript，CSP 仅允许内联样式与 data 图片，窗口不授予应用 capabilities。
4. 原生 `NavigationCompleted` 回调触发 `PrintToPdf`，使用 A4 纵向、打印背景、关闭页眉页脚；多条小记连续排版。
5. 最长等待 60 秒；成功、失败或取消都会销毁临时窗口并清理临时 HTML。先输出到目标目录中的临时 PDF，完成状态复核后才提交到所选路径。

**验证结果（2026-10-15）**：独立 Tauri spike 成功生成两页 PDF，解析确认中文文字与内嵌图片完整；主应用的单条和三条合并导出也已真实落盘并解析。COM 路线可用，本轮无需无头 Edge 回退。PDF 当前仅支持 Windows 桌面版。

### 3.4 加密条目

导出前先刷新待保存正文；命中加密条目且域未解锁 → 复用 `NoteLockDialog` 过一次口令，输错时可重试，取消后跳过未解锁条目。域已解锁时，单条锁回的条目免密再次解开。落盘只写明文，绝不导出密文信封。完成后 toast 报「N 条中 M 条已导出，K 条未解锁或已不存在，已跳过」。若无可导出条目，不打开系统保存框。

后端在导出前和提交目标文件前复核主密钥、小记 DEK、锁定代次和数据代次；打印期间也检查应用锁定、换库与密钥收回，状态变化则取消，不提交旧会话明文。

### 3.5 实现落点与边界

| 层 | 落地 |
|---|---|
| 转换器 | `src/utils/noteExport.ts`：共用 `sanitizeNoteHtml` 清洗；Markdown 保留任务列表、链接、代码块；HTML/Word/PDF 共享打印模板，使用浅色主题令牌；文件名清理与大小写去重 |
| 入口与交互 | `NoteCard.vue` 四格式菜单；`NotesModule.vue` 管理单条/勾选/全库范围；`NoteExportController.vue` 负责保存前刷新、解锁、读取图片、系统另存与结果提示 |
| 原生图片与写盘 | `commands/note_export.rs`：仅主窗口可调用；附件路径限制在附件目录内，图片最多 48 MB；`services/note_export.rs`：校验格式、文件名与重复项，正文最多 64 MB，先写同目录临时文件再提交，失败保留旧文件 |
| PDF | `services/note_pdf.rs`：隐藏 WebView2 窗口与原生打印回调，不运行正文脚本 |
| mock / 测试 | `e2e/mocks/backend.ts` 增加图片读取与导出写盘 handler；`noteExport.test.ts` 6 条、Rust 导出单测 3 条、`notes-export.spec.ts` 11 条 |

导出仅在桌面端提供入口。正文引用的本地图片以 base64 内嵌；丢失或不支持的图片、外链图片保留文字占位，并在完成提示中报数。Word 产物为带 UTF-8 BOM 与 Word 命名空间的 `.doc`（Word-HTML）；已验证文件内容与编码，尚未在 Word/WPS 内做打开与排版验收。

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

### 4.4 动作去重（10-16 收敛后）

hover 排、⋯ 菜单两处不得出现同一颗。卡片排一律四颗，其余进 ⋯（详见 `04-action-dock.md`）。

- 主列表 hover：查看、编辑、置顶、⋯（共 4 颗）
- 归档视图 hover：查看、编辑、取消归档、⋯（共 4 颗）
- 未解锁卡片 hover：解锁、导出（共 2 颗；发起导出后先走解锁前置）
- 主列表的 ⋯：复制正文、收藏/取消收藏、归档/取消归档、导出 ▸、加密（或锁回/解除加密）、删除
- 归档视图的 ⋯：同上，只是把「归档」换成被让出 hover 排的「置顶/取消置顶」，删除在这里回归

## 5. 交付顺序

1. ~~PDF spike 验证（决定 §3.3 走哪条通道）。~~ 已通过（2026-10-15）：`with_webview` 直接获取 WebView2 COM 接口，中文、图片与分页验证通过。
2. ~~归档：schema → repo → 命令 → store → UI → mock → e2e → 拍帧。~~ 已交付（2026-10-14）：Rust 3 条单测 + store/组件 6 条单测 + e2e 2 条用例全绿，真机 1040×670 三帧与 frame1/2/3 对拍通过。
3. ~~导出：转换器 → 单条菜单 → 批量/全库弹窗 → 加密前置 → mock → e2e → 拍帧。~~ 已实现（2026-10-15）：75 条相关前端单测、3 条 Rust 导出单测、53 条小记 e2e（含 11 条导出）通过，生产前端构建与 Windows 原生构建通过。真机 1040×670 验证四格式单条、ZIP、PDF 合并、加密跳过与解锁、覆盖已有文件和拒绝锁定条目；PDF 与 ZIP 均经独立解析校验。

验证产物：`.tmp/note-export-spike/sample.pdf`（两页小样）；`.tmp/note-export-spike/native/verification.json`、`artifact-verification.json`（原生验证结果）；`export-native-menu.png`、`export-native-dialog.png`（本目录原生截图）。

## 6. 决策记录

- [x] §4 归档样张三帧（frame1/2/3）照此实现 —— 已拍板并落地
- [x] §3.3 PDF 先花一轮做 spike；本机 WebView2 COM 路线不通则回退无头 Edge（多 1–2s）—— COM 路线已跑通并接入
- [x] Word 只出 `.doc`（Word-HTML），不做真 `.docx` —— 已拍板
- [x] 多条导出打 `.zip` —— 已按本轮完整导出实现范围落地；中文文件名、UTF-8 内容与 CRC 校验通过
