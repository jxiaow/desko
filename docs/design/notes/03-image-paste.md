# 小记 · 图片进正文（粘贴与拖入）

- 状态：设计已定，待实施
- 日期：2026-10-15
- 范围：截图 Ctrl+V、资源管理器拖文件、富文本里带来的 base64 图三条入径；不动附件目录的存法与显示口径

## 1. 初始现状（实施前基线）

| 事实 | 出处 |
|---|---|
| 图片块、宽度手柄、附件目录、`asset:` 显示口径全都在，唯独没有「把图送进来」的第二条路：编辑器全文没有 `paste` 也没有 `drop` | `src/components/notes/NoteEditor.vue:155`（NoteImage）、`:621`（insertImage） |
| 唯一的入口是选图按钮：弹原生对话框拿**路径字符串**，再落盘 | `src/components/notes/NotesModule.vue:214`（pickImagePath）、`:230`（addImageToNote）、`:253`（addImageToDraft） |
| 桌面侧拿不到字节通道：`File` 走 `uploadBrowserImage` → `invoke('web_upload_attachment')`，而这个名字只存在于 Web 桥的分发表（`bridge.rs:250`），没注册成 tauri 命令；桌面 runtime 直接「未知命令」 | `src/services/api/notes.ts:61`、`src/services/browserImage.ts:15`、`src-tauri/src/main.rs:325`（命令表里没有它） |
| HTML5 拖放在 Tauri 窗口里给不出真实路径，本仓一律走原生窗口级事件；`dragDropEnabled` 没写即默认开 | `src/components/fileshare/FileShareModule.vue:194`、`docs/design/v52/01-plan.md:258`、`src-tauri/tauri.conf.json:13`（窗口块无该键） |
| 落盘服务只认扩展名推 mime：`mime_of` 有 png/jpg/jpeg/gif/webp，没有 bmp，而 Web 侧允许表里有 | `src-tauri/src/services/attachment_service.rs:89`、`src-tauri/src/web_access/bridge.rs:436` |
| base64 图会被清洗器判死，但剪贴板解析不经过清洗器：`safeImage` 只收 `attachments/`、`http(s)://`、`asset://`，而 `NoteImage.parseHTML` 是裸 `img[src]` | `src/utils/sanitizeNoteHtml.ts:19`、`src/components/notes/NoteEditor.vue:171` |
| 三张书写面（胶囊草稿、卡片就地编辑、全屏书写）都只是包了 NoteEditor，插图靠外层握着 ref 追加 | `src/components/notes/NoteComposer.vue:62`、`NoteCard.vue:474`、`NoteFullscreen.vue:114` |

第三行是这一轮的关键：**不是「没做粘贴」，是桌面端根本没有能收字节的通道**，所以先补命令，再谈交互。

## 2. 拍板结论

1. 字节通道统一成一个名字 `save_attachment_bytes { name, data, noteId }`：注册为 tauri 命令，Web 桥分发表同用一个键（`web_upload_attachment` 退役，不留别名）。前端只有一条调用，不再按 runtime 分名。
2. 粘贴走光标：NoteEditor 拦 `paste`，剪贴板里有图片文件就 `preventDefault`，把字节交给外层注入的 `saveImage`，回来直接插在当前落点。文本/HTML 粘贴一律不接管，上一轮的 `autolink`/`linkOnPaste` 不受影响。
3. 拖入走「当前书写面」：小记页挂载期间注册窗口级 `onDragDropEvent`（与局域网传输同一条通道），落盘复用同一颗函数，插入沿用现有 ref 分支（全屏→卡→胶囊）。窗口级事件给不了可靠的落点，本仓先例也不看坐标。
4. 没有活动书写面时拖入：**只提示，不自动开一条纯图小记**。自动开草稿会把「拖进来」变成不可逆的建档动作，等这一档的体感拍过再说。
5. 富文本里夹的 base64 图：在 `NoteImage` 的 parseHTML 上加 `getAttrs` 闸门，复用清洗器那一份 `safeImage` 口径，不合格直接不解析（连节点一起不要）。这样「粘进去有、重开没了」当场消失，也不用另写一套判断。
6. `mime_of` 补 `bmp`，与 Web 侧允许表对齐；字节通道的名字若没有可用扩展名，默认按 `png` 落盘（截图工具给的就是 `image.png`，真给无扩展名也别把 mime 判成 octet-stream）。
7. 一次粘多图：按剪贴板顺序逐张落盘逐张插入，单张上限沿用 15 MB。

## 3. 落点

| 层 | 动什么 |
|---|---|
| Rust 服务 | `attachment_service.rs`：新增 `save_image_bytes(db, name, bytes, note_id: Option<&str>)`（校验扩展名与大小 → `create_new` 落临时文件 → 复用 `store_file`/`create_attachment` → 删临时文件）；`mime_of` 补 bmp |
| Rust 命令 | `commands/notes.rs` 新增 `save_attachment_bytes`（先 `get_master_key`，再锁库调服务）；`main.rs:325` 命令表补一行 |
| Web 桥 | `bridge.rs`：`upload()` 只留 require_module / require_note_access + base64 解码，落盘交给服务；分发表键 `web_upload_attachment` → `save_attachment_bytes` |
| 前端通道 | `browserImage.ts` 调 `save_attachment_bytes`；`api/notes.ts:61` 的 `uploadAttachment`/`stageAttachment` 签名不动（`string \| File` 两条都还有效） |
| 编辑器 | `NoteEditor.vue`：`saveImage` prop + `paste` 拦截；`NoteImage` parseHTML 加 `getAttrs` 闸门 |
| 三张面 | `NoteComposer.vue`/`NoteCard.vue`/`NoteFullscreen.vue` 各转发一个 `save-image` |
| 模块 | `NotesModule.vue`：`saveImage(noteId, file)` 一颗共用落盘函数（选图按钮也改走它）、`applyImage(target, src)` 收敛现有四处 ref 分支、窗口级拖放注册与卸载 |
| 测试 | `e2e/mocks/backend.ts` 加 `save_attachment_bytes`；`notes.spec.ts` 加粘贴/拖入/无书写面/base64 四条；`web-access.spec.ts` 两处方法名跟着改 |

## 4. 决策记录

- **为什么不复用 `stage_attachment` 加个可选参数**：那条命令的语义是「把这台机器上的某个路径收进来」，字节版的校验面（扩展名白名单、15 MB、临时文件 `create_new`）完全不同，塞一个参数会变成两套行为共用一个入口。
- **为什么 base64 而不是 raw IPC body**：与 Web 桥那条已经跑通的路径保持一致，省掉一次 transport 层特殊化。代价是 2 MB 截图在 JSON 里膨胀到约 2.7 MB；截图体量下不构成瓶颈，真出现大文件粘贴再换 raw body。
- **为什么拖入不判落点**：`onDragDropEvent` 的 `position` 是窗口级坐标，WebView2 下与 CSS 像素的换算在本仓没有验证过；局域网传输那条同样只用 `paths`。宁可不判，也不要一个看起来精确实则按不准的高亮。
- **`getAttrs` 闸门而不是粘贴时清洗 HTML**：PM 的剪贴板解析路径拿不到「清洗前/后」两份片段，改写插入内容会绕开 Link 扩展自己的 `linkOnPaste`。在 schema 层拒绝 data URI 是最小改动，且和阅读面的清洗器同一个谓词，不会出现两套答案。

## 5. 验收

- `cargo test` 覆盖 `save_image_bytes`：合法 png 落盘、无扩展名按 png、bmp 得到 `image/bmp`、超 15 MB 拒、`..`/带路径分隔符的名字拒。
- e2e（`PW_CHANNEL=msedge`，`e2e/specs/notes.spec.ts`）：
  1. 胶囊草稿里粘一张位图 → 后端收到 `save_attachment_bytes`，图块插在光标处；纯文字/富文本粘贴不接管；
  2. 没有任何书写面时拖入 → 落到胶囊草稿，只 `stage_attachment`；
  3. 全屏书写开着时拖入 → 图落全屏面，按该小记走 `upload_attachment`；
  4. 归档视图里拖入 → 只有 toast，一个字节通道都不碰；
  5. 粘贴带 `data:image/png;base64,…` 的富文本 → 文字进来、图不落库。
- 真机按一次截图 Ctrl+V、一次从资源管理器拖 png（交付截图）。

## 6. 余量

- WebView2 是否把剪贴板位图真的暴露成 `clipboardData.files` 需真机确认；若 `getAsFile()` 给空字节，兜底只能提示「请用选图按钮」，不做静默丢弃。
- 从资源管理器**复制**（而非拖拽）文件再粘贴：Chromium 对非本应用来源的文件剪贴板可能只给名字不给字节，届时考虑桌面端走 `plugin-clipboard-manager` 读路径。
- 拖入自动建一条纯图小记、以及拖入时给书写面画一圈高亮，本轮都不做。
