# Codex Web UI 原生集成（2026-10-22）

> 2026-10-27：对话入口已屏蔽（`src/services/featureFlags.ts` 的 `CODEX_DIALOG_ENABLED = false`），桌面页签与「设置 → Web 访问」的 Codex Web UI 卡片都不再出现。本文与代码留作实现记录，恢复只需改回 `true`。

用户已选择 Vue + Tauri 原生集成。本记录取代 18 号草案的待定范围：保留参考工作台的工作区写入、四类审批、Markdown 与 Git 查看；选择目录后由 Rust 启动本机 `codex app-server --listen stdio://`。

## 使用

1. 在 Desko 启用 Codex 模块，进入 **Codex → 对话**，选择运行环境与工作目录。Windows 使用本机 CLI；WSL 选择发行版，用户可留空使用该发行版默认用户。
2. 新对话选择模型与「工作区写入 / 只读」，输入消息并发送。模型与权限在新会话创建时确定；执行期间可停止，审批卡片由用户明确回答。
3. 需要原工作台历史时，先选择原工作目录，再点击「导入 Web UI 对话」，选择 `C:\Code\Codespace\codex-web-ui\.local\threads.json`。只导入当前工作目录且尚未登记的索引；正文仍从 Codex 读取。导入不会删除或改写源文件。
4. 切换 Codex 账号后，当前任务完成或停止，再点击「重新连接」，让新子进程重新读取 CLI 登录状态。

依赖所选环境已安装、已登录的 Codex CLI。可用 `CODEX_BIN` 指定原生可执行文件；Windows 按显式路径、npm 原生包、PATH 查找。`CODEX_WINDOWS_SANDBOX=mxc|elevated|inherit` 沿用参考实现，默认 `mxc`，只影响 Windows 子进程配置。

## Windows 与 WSL 双环境（2026-10-22 增补）

- Windows 版 Desko 可切换 Windows 和已安装的 WSL 发行版；已连接时点击顶部的环境名称切换。任务执行期间禁止更换环境或目录。
- WSL 输入 `/home/...`、`/mnt/c/...`、`~/...` 或 Windows 绝对路径，支持浏览后自动转换。`\\wsl.localhost\发行版\...` / `\\wsl$\发行版\...` 只接受所选发行版；路径作为独立参数传递，空格、中文与 shell 字符不参与脚本拼接。
- WSL 使用 `wsl.exe --distribution ... [--user ...] --cd ~ --exec bash -lc ...` 启动，依赖发行版内 bash、python3 和 Linux Codex CLI。支持 PATH、`~/.local/bin` 和 nvm 安装；不回退到挂载的 Windows CLI。Git 查询也在相同发行版与用户下执行。
- Windows 的 `CODEX_BIN`、`CODEX_HOME` 和任务身份环境变量不透传给 WSL；WSL 登录 shell 中自身配置仍有效。连接后记录实际 Linux 用户，重连与恢复不受发行版默认用户随后变化影响。登录态沿用所选环境；此功能不额外同步凭据。
- SQLite 主键升级为 `(environment, id)`，保留旧索引为 native。WSL 以发行版、用户区分身份，路径按 Linux 大小写比较；前端最近目录、上次选择、草稿恢复也按环境区分。两个环境可以登记相同 threadId，切换时不会串用草稿或审批。
- WSL Python 适配器随 Rust 二进制嵌入，无需额外部署脚本。Codex 运行在独立 Linux 进程组，stdin EOF、HUP、TERM 或子进程退出后清理该组；Windows Job 继续持有 `wsl.exe`。主动脱离进程组的外部服务不属于这项清理保证。
- Linux 版 Desko 的本机启动分支保持可用；本次没有构建或运行 Linux 桌面安装包，双环境实测指 Windows Desko 后端分别启动 Windows CLI 与 WSL CLI。

本轮验证：生产构建、12 项对话前端单测、16 项 Rust Codex 自动测试、3 项 Linux 适配器测试、7 项对话 E2E；另运行显式启用的 Rust 实机冒烟，Windows 和 `Ubuntu-26.04 / jxiaow` 都成功 initialize、读取账号类型与 7 个模型、运行各自 Git。`node scripts/codex-wsl-lifecycle-check.mjs Ubuntu-26.04` 强制结束 Windows 连接进程后，确认 Linux 测试父子进程均退出。所有实机检查均未创建会话或启动模型任务。

WSL CLI 为 `0.163.0`，已用该 CLI 生成协议 schema，并通过同一 `codex-protocol-check.mjs` 校验。收尾复编时还补齐了工作区 `fileshare-core/src/lib.rs` 对已有 `theme_values.rs` 的一行模块声明，以解除该并行改动造成的编译错误。

可重复的实机连接检查（Windows PowerShell）：

```powershell
$env:DESKO_TEST_WSL_DISTRO = 'Ubuntu-26.04'
cargo test -p desko --manifest-path src-tauri/Cargo.toml installed_windows_and_wsl_handshake_without_tasks -- --ignored --nocapture
node scripts/codex-wsl-lifecycle-check.mjs Ubuntu-26.04
```

## 源实现与目标覆盖

源目录没有 Git 历史，本次读取的代码 SHA-256 记录在 [21-codex-web-ui-source.json](21-codex-web-ui-source.json)。未复制 `.local` 中的会话或其他用户数据到仓库。

| 原入口 / 行为 | Desko 实现 | 异常与寿命 |
|---|---|---|
| `server/rpc.mjs`：发现 CLI、initialize / initialized、JSONL 关联、stderr 排空 | `services/codex_bridge/rpc.rs` | 请求 30 秒，最多 12 个在途；独立 stdin 写线程 5 秒期限，退出拒绝 pending；Windows Job Object 清理子树 |
| 双环境扩展：选择 Windows / WSL、发行版与用户 | `environment.rs` + `wsl_runner.py` + `CodexDialogConnection.vue` | WSL 内规范化路径、启动 Linux CLI 与 Git、清理 Linux 进程组；环境身份进入持久化与 UI 恢复 |
| `runtimeEnvironment`：隔离桌面当前任务变量 | `rpc.rs::TASK_ENV` | 移除原 6 个身份变量和继承的 `CODEX_MCP_NODE_PATH`，让 CLI 使用自身的工具运行时发现；不修改用户环境 |
| `bridge.start / bootstrap`：账号类型、模型、工作区、索引 | `Runtime::start / bootstrap` | 仅返回账号类型和套餐；启动/协议错误内联显示，重连不自动重发消息 |
| `createThread`：固定 cwd、可用模型、权限档位 | `Runtime::create` | 校验模型；仅 read-only / workspace-write；on-request + user reviewer；持久化后才把会话交给前端 |
| `resume / selectThread`：同线程去重恢复、最近 200 轮、快照补流 | `Runtime::resume / snapshot` | 每个 thread 的互斥锁保证恢复顺序；历史分页期间的通知在缓存合并，快照包含 eventSeq |
| `send`：1–32000 字符、并发发送闸门、首消息标题 | `Runtime::send` | starting / live turn / 未确认超时拒绝重复提交；失败保留输入，超时需刷新核对 |
| `interrupt` | `Runtime::interrupt` | 使用当前 turnId；响应先于或晚于完成通知均不重置已完成状态 |
| `onNotification`：流式文本、命令日志、完成状态 | `model::apply_event` + `Runtime::receive` | 缓存最近 200 轮；命令日志只留尾部 200000 字符；完成/失败清除待审批，保留已流出的文本；忽略推理增量 |
| `onRequest / respond`：命令、文件、权限、结构化问题 | `model::approval_result` + `Runtime::respond` | requestId 保留 string / number 区分；验证所属线程、一次性响应；权限只授权本次请求的范围且限当前轮；其余反向请求返回 -32601 |
| `repositoryStatus`：分支与 porcelain 状态 | `workspace.rs` | 只运行 Git 读取命令，禁用可选锁，单命令 10 秒/2 MiB 上限；重命名与含空格中文路径可读 |
| `ThreadStore`：索引与持久化 | `db/codex_thread_repo.rs` + `codex_dialog_threads` | 与当前 Desko 档案共用 SQLite；只存 metadata，不存消息正文或凭据；旧时间戳不能覆盖新 metadata |
| `src/conversation.mjs`：applyEvent / hydrate / restore / finishSend | `utils/codexTurnReducer.ts` | 快照 seq 去重、流式先于 send 响应、optimistic 气泡去重；请求完成清除审批 |
| `src/main.jsx`：会话选择、发送、停止、Markdown、工具、问题、改动面板 | `CodexDialogPanel / Markdown / Approval.vue` + `useCodexDialog` | 旧异步选择不能覆盖新会话；中文输入法 Enter 不提交；刷新同会话保留草稿；断线保留待确认输入并与历史核对 |
| `src/client.mjs`：请求关联与断线恢复 | Tauri invoke + `codex:dialog` | 不再需要 WebSocket 重连；切页签/解锁后从运行进程获取快照；进程退出由用户显式重连 |
| `server/index.mjs`、`scripts/stop.mjs`、HTTP/WS 安全头与端口 | 原生命令与独立 Rust Web worker | 不引入 Node 服务、React 或 iframe；Desko Web 通过入口跳到独立 Codex Web UI，只有该服务开放对话命令 |
| `src/styles.css`、React 图标与外链 | Desko 主题令牌、Solar 图标、现有 openExternal | Markdown 使用 marked + DOMPurify 的标签/属性白名单，外链只开放 http/https/mailto；无任意 HTML 控件 |

新增命令只有 `codex_dialog_action(action, params)`，白名单 action 为 `environments / status / connect / disconnect / bootstrap / createThread / selectThread / send / interrupt / respond / workspace / importIndex`。除连接操作外，携带 runtimeId，旧工作区的在途动作不能误投给新连接。命令归 Desko 自研域，不加入 vendored `codex-core/keep_cmds.json`。

## 与旧草案和参考实现的区别

- 支持完整四类交互和 workspace-write；没有 danger-full-access 入口，不自动批准，不自动重投超时消息。
- 工作目录通过原生文件夹选择器明确选择，可选择非 Git 目录；Git 不可用只影响改动面板。
- 独立工作台列表仅显示本档案创建或显式导入的会话；原「会话」页仍从 Codex 权威文件扫描，不接管其他客户端的活动任务。
- 复用 CLI 登录与刷新行为，不通过新桥强制轮换 Desko 账号的 refresh token。未支持的反向刷新请求与源实现一样明确拒绝。
- 切页签、隐藏窗口、锁屏不停止已发出的任务；锁屏无输入与审批入口，解锁后恢复快照。模块关闭、切档案、恢复备份、退出应用停止进程。
- 恢复备份持有进程生命周期锁直到数据库替换完成；所有 metadata 写入在数据库锁内校验连接状态与 data_epoch，防止旧任务回写恢复后的数据库。
- 消息不做新的全文存储；新索引随 Desko 档案备份。会话的原始正文仍需要原 CLI 的记录存在，跨机器导入索引本身不搬运正文。

## 验证

- `npm run build`：TypeScript 与生产前端构建通过；对话页面按需加载。
- 全量 Vitest：64 个文件，721 个测试通过。新增覆盖事件补流、完成先于发送响应、Unicode 日志边界、审批 ID 类型、HTML 清洗、切换会话、刷新草稿、断线输入恢复和卸载期间取消后续发送。
- Rust Codex 相关测试：13 个通过，1 个仅用于子进程的夹具入口标记 ignored。真实 Windows 管道验证拆分 UTF-8、响应关联、失败/超时清理与 stdin 堵塞时的退出；另覆盖恢复活动任务后的工作区切换保护。仅使用测试子进程，不调用真实模型。
- `npm run check:codex-protocol`：本机 `codex-cli 0.162.1` 实时生成 schema；8 个请求、1 个客户端通知、4 个反向请求、8 个服务器通知及关键字段均通过。
- 本机 CLI 连接冒烟：使用相同 stdio、Windows mxc 配置与任务环境隔离，实际完成 initialize / initialized / account/read / model/list，读取到 ChatGPT 登录类型与 7 个模型；未启动会话或模型任务。
- Playwright Edge：累计 71 个用例通过，覆盖对话流式/历史恢复/审批/问题/停止/CLI 缺失、既有 Codex 页面回归、锁屏恢复审批与 Web 页面隐藏原生入口。
- 浅色、深色及 800×600 最小窗口截图保存在 `.tmp/codex-integration/`，以合成测试数据检查布局，最小窗口下输入框和发送按钮可见。

尚未使用真实账号发起模型任务，因此真实网络流式、模型执行文件修改、真实账号切换后再次对话仍需要桌面联调；自动化测试不代表这些外部效果已经验证。没有提交、推送或生成安装包。


## 独立 Web 服务与手机访问（2026-10-23）

「设置 → Web 访问」分别管理 Desko Web（8420）和 Codex Web UI（8421）。二者复用同一 Rust 可执行文件的 `--desko-web-worker` 无窗口模式，各占一个子进程；进程在 Tauri Builder 和单实例初始化之前进入服务模式。退出桌面时回收，Windows Job Object 负责父进程异常退出时的清理。

桌面保有数据库和每个浏览器独立的 WebVault。worker 只通过随机密钥保护的 loopback 通道调用 Backend 白名单；密钥经 stdin 发送，启动结果经 stdout 返回，stdin EOF 表示退出。下载保留流式转发，内部文件响应显式保留长度，避免 chunked 自动转换丢失资源长度。父进程监控 worker 与数据代次，失效时停止该服务的 CLI 连接；worker 检查内部通道失效并自行退出。

Codex 服务持有自己的 BridgeState；通知写入该服务的队列，经带会话验证的短轮询传给浏览器。它不接收桌面对话的通知，队列溢出后浏览器重新获取快照。浏览器退出不自动停止执行中的任务，服务关闭、模块关闭、档案代次失效或桌面退出时停止。两个服务使用不同 cookie 名称，因为同一主机的不同端口会共享 cookie 空间。

两个 Web 页面使用桌面工作区骨架、纸/墨底色和共享组件。手机改为模块抽屉、两行工具栏、覆盖目录；专用 Codex 页面只保留一行标题，历史列表和 Git 改动面板按需覆盖。工作目录可手动填写服务器路径，原生目录和索引选择器仅保留在桌面。对话能力、审批与权限枚举沿用现有 Rust 实现。

使用和验证命令见 [Web 访问](../../web-access.md)。
