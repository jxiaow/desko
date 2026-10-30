# Codex 切号与 WSL 账号（2026-10-23，定稿 v5）

一句话：**设置里只留一个「切换账号时重启 Codex」开关，默认关；Windows 切号是否关闭重开由它决定。WSL 与 Windows 默认各用各的账号：切 Windows 时在确认里勾选「同时用于 WSL」才一起切；卡片 ⋯ 的「在 WSL 中使用」是只改 WSL 的入口。所有写入都先关闭对应运行中的 Codex，避免旧进程把凭据写回。**

静态设计稿：[22-account-switch-wsl-ux.html](22-account-switch-wsl-ux.html)

九帧：A 设置开关 ON / B 账号页独立 WSL 账号 / C 卡片菜单 / D1 切号确认·只切 Windows / D2 切号确认·同时用于 WSL / E WSL 账号确认 / F 设置开关 OFF / G API Key 边界态 / H 已用于 WSL 的卡片菜单。

> v5 修订（相对 v4）：撤掉 44px WSL 跟随条、状态矩阵、手动同步/重启后台、逐目标勾选与 WSL 终端重开。WSL 是否跟随改由**每次切号确认里的「同时用于 WSL」**决定，默认不勾；WSL 只关闭后台与 CLI，不重开。旧的两条自动同步链路一并退役。

## 1. 现状核对

| 事实 | 代码位置 | 对本设计的影响 |
|---|---|---|
| 设置页有整块「WSL 登录态同步」：自动同步、源状态、逐目标状态、立即同步、刷新、重启后台 | `CodexSettings.vue:365-463`，挂载时读状态 `:316` | v5 整块删除，只留新的 Windows 重启开关；WSL 账号入口搬到账号卡片。 |
| 切号后隐式同步 WSL | `codexState.ts:243` 调 `autoSyncWslAuthAfterSwitch()`，受 `codex_wsl_auth_auto_sync` 控制 | 删除；否则不勾「同时用于 WSL」也可能被旧开关改写 WSL。 |
| 进入 Codex 页自动同步，10 分钟节流 | `CodexModule.vue:394`、`codexState.ts:1045-1055` | 删除；页面只做只读账号探测。 |
| 旧的单目录 WSL 写穿 | `codex_account_projection.rs:1144-1185` 的 `configured_codex_wsl_config_dir()` / `sync_default_codex_account_to_wsl()`，调用点在 `codex_account_runtime_switch.rs:726,908` | 删除。这是“切 Windows 顺带改 WSL”的隐藏链路，留着会与勾选框冲突。 |
| 旧键默认值 | `config.rs:108-123,739-752`：`codex_sync_wsl` / `codex_wsl_config_dir` / `codex_wsl_auth_auto_sync` 均默认 false/空 | 三个键整体退役，不做兼容迁移。 |
| 现有切号事务 | `switch_codex_account`（`codex_account_commands.rs:790`）已按「准备凭据 → `before_commit` → 提交」执行，并有 `codex:switch-progress` 事件 | 复用这条事务：关闭 Windows 客户端放进 `before_commit`，准备失败或关闭失败都不会写 `auth.json`。 |
| WSL 目标发现 | `codex_wsl_auth_sync.rs`：运行中发行版里已存在的用户/root `~/.codex` | 复用发现逻辑；不创建 `~/.codex`。 |
| Windows 客户端枚举 | 当前没有；`process.rs:119` 的 `collect_codex_process_entries()` 是恒空桩 | 新写 `codex_clients.rs`，不要改这个桩的语义。 |
| WSL 交互式 CLI | TUI 挂在 pts 上，外部进程无法把新 `codex` 塞回原终端 | v5 明确：关闭后**不重开**，由用户自己再启动。 |
| desko 自己的 Codex 对话 runtime | 2026-10-30 已随对话功能移除，desko 不再运行自己的 `codex app-server` | 不涉及。 |

## 2. 目标与非目标

| 在内 | 不在内 |
|---|---|
| 设置新增「切换账号时重启 Codex」，默认关 | WSL 跟随条、状态矩阵、逐目标状态 |
| Windows 切号确认内提供「同时用于 WSL」勾选，默认不勾 | 每次切号自动同步 WSL |
| 勾选后 WSL 跟着切，并关闭 WSL 后台与 CLI（不重开） | 重开 WSL CLI / 新窗口重跑 / 自动续对话 |
| 卡片 ⋯「在 WSL 中使用」：只改 WSL，Windows 不动 | 同步到指定某一个 WSL 目标（仍是一次写全部目标） |
| 卡片上的「WSL 使用中」状态标 | 反向同步 WSL → Windows |
| 关闭 Windows 应用与交互式 CLI，写入后重开；CLI 回原目录 | 重启 IDE 插件或 `codex exec` |
| 删除设置里的 WSL 登录态同步、进页自动同步、旧单目录写穿 | 同步 `config.toml`、模型目录、会话历史 |
| Windows/WSL 各用不同账号；同一账号也能显式一起切 | 后台定时器、文件监听、自动拉起 WSL |
| WSL 仅接受 OAuth 账号 | 逐客户端勾选（重启范围固定为识别到的全部） |

## 3. 设置 → Codex

位置：设置弹窗 → Codex 页签，「凭据与文件」之后新增「切换账号」分组，「会话统计」之前。设计稿 A / F 帧。

```
切换账号
切换账号时重启 Codex                                      [开关]
Windows 切号会先关闭正在运行的 Codex 应用与 CLI，写入后重开（CLI 回原目录）。
WSL 是否一起切，在确认里勾选；默认保持 WSL 的账号与进程不动。
⚠ 正在运行的 Windows Codex 任务会中断。
WSL 的账号也可以随时在卡片 ⋯ 里单独设置。
```

关闭态：

```
切换账号时重启 Codex                                      [开关]
关闭时，Windows 切号只改写官方凭据，不关闭、不重启 Windows 的 Codex。
这个开关只决定 Windows 是否重启。
WSL 是否一起切，在切号确认里勾选。
```

规则：

- 新增键 `codex_switch_restart_codex`（bool，默认 false）。不复用 `codex_launch_on_switch`，也不复用任何旧 WSL 键。
- 开关只决定 **Windows** 是否关闭重开。它不读 WSL 状态，不改变 WSL 账号，不影响卡片 ⋯ 的 WSL 入口。
- 开关打开/关闭立即落盘；失败回滚控件并 toast。保存中禁用，避免连点。
- 关闭态的设置行不出现“任务会中断”的警告；切号确认里的对应提示见 §5.4。
- 删除整个「WSL 登录态同步」块：自动同步开关、源状态、目标列表、立即同步、刷新状态、重启后台，以及相关状态、函数、imports、样式。设置页挂载时不再调用 `loadWslAuthStatus()`。
- 保留「自动统计 WSL 会话」与「额外统计目录」，它们属于用量统计，与切号无关。
- 无 WSL、无 `~/.codex` 的用户看到的就是一个普通开关，页面不出现任何 WSL 运行态控件。

## 4. 账号页

### 4.1 页面形态

- **没有跟随条。** 筛选区下方直接是账号列表；页脚给一条只读说明。
- WSL 当前使用的账号在卡片标题行显示 `WSL 使用中` 状态标，沿用 `terminal` 图标与描边样式（`.badge.wsl`）。它只是状态，不是入口。
- 页脚文案：
  - 有 WSL 目标：`Windows 与 WSL 的账号互不影响；WSL 可在卡片 ⋯ 里单独换号。`
  - 无 WSL 目标：`切号只改写官方凭据文件；Windows 是否重启由设置里的开关决定。`
- 状态标的判定来自 **WSL 侧 `auth.json` 的只读探测**，不是本地记忆：
  - 所有正在运行且有 `~/.codex` 的目标身份一致，且能在账号库中匹配到（优先 `account_id`，缺失时用 email），才给该卡片加「WSL 使用中」。
  - 目标身份不一致、读取失败或没有目标：不加任何 WSL 状态标。没有“部分使用中”的中间态。
- 探测在进入账号页时执行一次，切号/WSL 写入后重新执行；不启动 daemon、不刷新 token、不写任何文件。失败静默，不影响列表与 Windows 切号。

### 4.2 卡片菜单

在现有 `⋯` 菜单中插入一项「在 WSL 中使用」，位置在「强制刷新令牌 / 刷新账号信息」之后、「重新登录 / 账号与密钥」之前。点击关闭菜单并打开 E 帧确认。

菜单状态：

| 账号 / 环境 | 菜单项 | 说明 |
|---|---|---|
| OAuth 账号，有 WSL 目标，WSL 不是该账号 | 可点「在 WSL 中使用」 | 打开确认；写入后不改 Windows 当前账号。 |
| 该账号就是 WSL 当前账号（目标一致） | 禁用「WSL 已使用此账号」 | 用 `check` 图标；避免重复写入。换 WSL 账号去另一张卡。 |
| 纯 API Key 账号（无 OAuth 绑定） | 禁用「在 WSL 中使用」 | 菜单底部注：`API Key 账号没有可写入 WSL 的登录态。` |
| 没有运行中的 WSL 目标 / 没有 `~/.codex` / 探测失败 | 整项不出现 | 不给不用 WSL 的人增加噪音；不创建 `~/.codex`。 |
| 有多个目标且身份不一致 | 可点「在 WSL 中使用」 | 写入会把全部目标对齐到该账号；不提供逐目标选择。 |

- 菜单项不做单独的二级子菜单，也不在账号卡片上常驻 WSL 按钮；只保留 `⋯` 里的一个入口（H 帧展示已使用态）。
- 点击后若 WSL 目标在预览与执行之间消失，后端按“未检测到 WSL 目标”报错，不写任何账号。

## 5. Windows 切号确认

### 5.1 打开时机

行尾「切换」不再直接走通用 `ConfirmDialog`，改为打开专用 `CodexSwitchDialog`（360px 确认档，沿用 `.dialog` 基线：44px 头、46px 底栏、28px 按钮）。原因：需要承载勾选框、重启范围与两侧警告；这些内容塞不进原通用确认。

- 点击后立即打开弹窗，正文（目标邮箱）即时可见；Windows / WSL 行先显示 `正在检查正在运行的 Codex…`，预览返回后填计数。
- 预览并行做两件事：枚举 Windows Codex（应用 + 交互式 CLI），读取 WSL 目标与运行态。
- 预览期间勾选框与主按钮禁用；预览完成后启用。WSL 预览失败只收起 WSL 选项，不阻断 Windows 切号；Windows 预览失败且总开关为开时，主按钮保持禁用并给「重试 / 取消」。
- 执行期间弹窗不可关闭：Esc、×、取消全部禁用，主按钮显示阶段文案。全部结束后才关闭。
- 关闭 Windows 客户端失败时，弹窗保留并显示原因（典型是跨提权），不写凭据；用户可手动退出后重试或取消。

### 5.2 D1：默认不勾

```
切换账号并重启 Codex                                      ×
────────────────────────────────────────────────────────
将把 team@example.com 写入 Windows 官方凭据。

[ ] 同时用于 WSL
    不勾时 WSL 保持工作账号（main@example.com），账号与进程都不动。

Windows   关闭 1 个应用、2 个 CLI；写入后重开，CLI 回原目录
────────────────────────────────────────────────────────
⚠ 正在运行的 Windows Codex 任务会中断。
ⓘ 只写 Windows 的 auth.json；WSL 的账号与进程不变。
────────────────────────────────────────────────────────
Esc 关闭                                  取消   切换并重启
```

- 默认不勾。WSL 与 Windows 各自保留自己的账号，这是“两边用不同账号”的常态。
- 不勾时后端完全不碰 WSL：不停进程、不读目标、不写 `auth.json`。只读的状态探测除外。
- 勾选框标题固定「同时用于 WSL」；描述随目标账号变化，不写两种以上长句。

### 5.3 D2：勾选后

```
[✓] 同时用于 WSL
    WSL 也切到团队账号（team@example.com）；
    关闭正在运行的 WSL Codex，不重开。

Windows   关闭 1 个应用、2 个 CLI；写入后重开，CLI 回原目录
WSL       关闭 1 个后台、3 个 CLI，不重开
────────────────────────────────────────────────────────
⚠ 正在运行的 Windows 与 WSL Codex 任务会中断。
ⓘ 两边都写 auth.json；WSL 下次启动用团队账号。
```

- 勾选后 WSL 行才出现；不勾时没有 WSL 行，避免让用户以为 WSL 总会被动。
- 勾选后主按钮仍是「切换并重启」（总开关开）或「切换」（总开关关），不改写成“切换并同步”。
- WSL 只关后台与 CLI，不重开；不承诺恢复原终端或续上对话。用户下次自己在 WSL 里起 `codex`，读到的就是新账号。
- 写入顺序见 §7.1：Windows 提交成功后才动 WSL，Windows 失败不会让 WSL 先被关掉。

### 5.4 状态变化

| 状态 | 勾选框 | Windows 行 | WSL 行 | 说明 |
|---|---|---|---|---|
| 总开关 ON，Windows 有客户端 | 正常 | 显示应用/CLI 计数与“写入后重开” | 勾选后显示 | 主按钮「切换并重启」 |
| 总开关 ON，Windows 无客户端 | 正常 | 不显示；给一句“未检测到运行中的 Windows Codex” | 勾选后显示 | 主按钮「切换」；不要让“重启”落空 |
| 总开关 OFF，有 WSL 目标 | 正常 | 不显示；给警告“正在运行的 Windows Codex 可能继续使用旧账号。” | 勾选后显示 | 主按钮「切换」 |
| 总开关 OFF，无 WSL 目标 | **整项不显示** | 不显示 | 不显示 | 与旧确认等价：正文 + 取消/切换 |
| WSL 已在目标账号 | 勾选 + 禁用 | 按总开关 | 不显示 | 描述：“WSL 已经使用此账号，不会关闭 WSL 的 Codex。” |
| 目标账号是 API Key | 禁用 | 按总开关 | 不显示 | 描述：“API Key 账号没有可写入 WSL 的登录态。” |
| 无 WSL 目标 / 探测失败 | 不显示 | 按总开关 | 不显示 | 预览失败可给一句低调说明，不阻断 Windows |
| WSL 探测到但无运行进程 | 正常 | — | 勾选后不显示计数行，给“未检测到运行中的 WSL Codex，直接写入” | 仍会写 auth.json |
| 正在执行 | 锁定为当前值 | 显示阶段 | 显示阶段 | 不可关闭 |

- 计数只用于展示；执行时后端重新枚举，实际数量可以不同。文案不要承诺“刚好 N 个”。
- “WSL 已在目标账号”时勾选框禁用但保持勾选，表达的是“不会重复关闭”；不是让用户误以为还会动 WSL。
- 目标账号是 API Key 时不显示 WSL 行；勾选框禁用即可，不要点开一个无法执行的确认。
- 没有任何 WSL 目标时，不显示勾选框，也不在页面其他位置提 WSL。

## 6. WSL 单独切号确认（E 帧）

入口：账号卡片 `⋯` →「在 WSL 中使用」。只改 WSL，Windows 当前账号与 Codex 完全不动。

```
在 WSL 中使用账号                                        ×
────────────────────────────────────────────────────────
将把 team@example.com 写入以下 WSL 目标。
~/.codex/auth.json

目标      Ubuntu-26.04（jxiaow）、
          Ubuntu-24.04（root）
Codex     关闭后台与 3 个 CLI，不重开
────────────────────────────────────────────────────────
⚠ 正在运行的 WSL Codex 会中断。
ⓘ Windows 的账号与 Codex 不变；只写 auth.json，不动 config.toml。
────────────────────────────────────────────────────────
Esc 关闭                                  取消   用于 WSL
```

规则：

- 目标最多列 3 条；超过 3 条显示「等 N 个」，不提供逐目标勾选。写入仍是一次全部目标。
- 目标只包含**运行中的发行版里已存在的 `~/.codex`**，用户目录与 root 都算；不创建目录，不安装 Codex。
- 只写 `auth.json`，不写 `config.toml`、模型目录、会话。写入前关闭 WSL 的共享后台与交互式 CLI；关闭后不重开。
- 主按钮「用于 WSL」使用危险色，因为会中断正在运行的任务；这与现有确认弹窗的危险动作样式一致。
- 账号已是 WSL 当前账号时，入口本身就是禁用的；后端再校验一次，返回“已在使用”而不重复写。
- 页面探测无目标或失败时入口不出现；点击后的计数预览失败则在弹窗内显示错误与「重试」，不写任何账号。
- 弹窗执行中不可关闭；完成后关闭并 toast，例如：`team@example.com 已用于 WSL，2 个目标，3 个 Codex 已关闭`。

## 7. 执行事务

### 7.1 Windows 切号（含可选 WSL）

前置：用户点击「切换」后已拿到预览；确认时把 `restartWindows`（总开关快照）与 `applyToWsl`（勾选快照）传给后端。后端在真正执行时重新枚举，不信任前端计数。

1. **准备目标凭据**：沿用 `prepare_account_switch_locked`。刷新 token、校验账号、失败即在关闭任何客户端之前返回；此时不写凭据、不动客户端。
2. **关闭 Windows 客户端**（仅 `restartWindows`）：枚举 MSIX 应用与交互式 CLI，保存重开计划；逐个关闭。任一条目关不掉就中止，并把已关闭的条目按计划重开，返回错误；**不写凭据**。
3. **提交 Windows**：`switch_account_with_prepared` 写官方 `auth.json`/keyring，更新当前账号索引。此时才发生账号变化。
4. **重开 Windows**（仅 `restartWindows`）：只重开第 2 步确实在运行的条目；应用按运行时解析的 AUMID 拉起，CLI 在原 cwd 新开 Windows Terminal 窗口并按原 argv 运行。失败不回滚切号，返回失败数与重开计划。
5. **WSL**（仅 `applyToWsl`）：若目标账号不是 OAuth，前端本就不该勾选；后端返回校验错误（在提交前应已拒绝）。否则：
   1. 重新发现 WSL 目标；没有目标则本次 WSL 记为 `skipped`，Windows 切号保留。
   2. 关闭所有目标的 WSL 后台与交互式 CLI。任一个目标关不掉就**整体不写 WSL**，返回 `aborted`；已关闭的进程保持关闭（v5 不重开），Windows 切号保留。
   3. 用第 1 步准备好的**同一份 OAuth 凭据**写每个目标的 `auth.json`（不二次刷新、不再轮换 RT），由 WSL helper 以目标用户写入并设置 0600。
   4. 读回每个目标身份并与目标账号比对；逐目标返回 `done` / `failed`。
   5. 不重启 daemon、不重开 CLI。下次在 WSL 启动 Codex 时由它自己拉起后台。
6. 返回汇总：Windows 关闭/重开计数、WSL 成功/失败目标、重开计划 id（如有失败）。前端刷新账号列表与 WSL 状态标，关闭弹窗，按结果发 toast。

顺序理由：先准备后关闭，避免“凭据不可用却先把用户工作打断”；先 Windows 提交后 WSL，避免 Windows 写失败却已经把 WSL 关掉；WSL 内部先准备/校验再停进程，失败时不动 WSL。

### 7.2 WSL 单独切号

1. 校验账号：只接受普通 OAuth；API Key、Agent Identity、Web Session 直接拒绝。
2. 准备凭据：
   - 若该账号就是当前 Windows 账号：使用当前官方 `auth.json` 的登录态；已过期则提示先切回/刷新，不为 WSL 单独轮换当前账号的 RT。
   - 若不是当前账号：走 `prepare_account_switch_locked` 的准备/刷新链路；它不被 Windows 客户端占用，轮换 RT 不影响当前登录。
3. 重新发现 WSL 目标；没有目标直接报错，不停止任何进程。
4. 关闭 WSL 后台与 CLI：先交互式 CLI，最后共享后台，避免前台进程把后台重新拉起。停止前校验 PID + startTicks + uid，拒绝非交互 `codex`。
5. 用第 2 步的凭据写每个目标的 `~/.codex/auth.json`（helper 以目标用户写入，0600），不写 `config.toml`，不写 managed projection。
6. 读回身份比对，返回逐目标结果。不重开进程，不改 Windows 当前账号，不 touch Windows `auth.json`。
7. 刷新账号页的 WSL 状态标；toast 汇总。

### 7.3 Windows 客户端识别

| 类别 | 识别 | 关闭 | 重开 |
|---|---|---|---|
| Codex 应用 | MSIX 包 `OpenAI.Codex_2p2nqsd0c76g0` 的进程树：`ChatGPT.exe` 及 `codex.exe app-server` / `exec-server` / `codex-code-mode-host` 等子进程 | 按包路径/进程树匹配；先向主窗口发关闭消息，等 3s，必要时整树结束 | 仅原本在运行才重开；运行时解析包族 `!App` AUMID，经 `shell:AppsFolder` 拉起，不硬编码版本 |
| 交互式 CLI | `codex.exe`，argv 不含 `app-server` / `exec-server` / `exec` 等非交互子命令，且祖先不是 Codex 应用或 desko | 结束进程；控制台程序没有等价优雅关闭 | 新 Windows Terminal 窗口，原 cwd + 原 exe/argv；WT 不可用退回新控制台 |
| 不算 | `codex exec`、IDE 插件 app-server、`pid-update-loop` | 不结束 | 不重开 |

- `spawn_wt_command(dir, exe, args)` 复用 `file_shortcuts.rs` 的 WT 候选与 740 回退；不要把命令拼成 shell 字符串。
- 若无法可靠取得原 argv，只在原 cwd 重开裸 `codex`，不猜测参数；文案不承诺恢复原命令。
- Windows 客户端枚举失败且总开关为开：不写凭据，提示重试或手动退出；总开关为关：不需要枚举，直接写。
- 跨提权关闭失败不静默跳过；中止并提示“请以相同权限运行 desko，或手动退出该 Codex 后重试”。

### 7.4 WSL 停止与写入

- 目标发现复用 `discover_wsl_codex_homes()`：只认运行中发行版里已存在的 `~/.codex`（用户目录与 root）。
- 停止与写入都在 WSL helper 内完成，不在 Windows 侧靠进程名猜：
  - `probe`：只读 `auth.json` 身份，统计后台/交互式 CLI；不刷新 token，不启动 daemon。
  - `stop`：先 SIGTERM，超时再 SIGKILL；每次信号前校验 PID + startTicks + uid；排除 helper 自身与祖先；只停共享后台和挂 pts 的交互式 `codex`。交互式 CLI 退出前保留对应 PTY，退出后清理鼠标/焦点上报、增强键盘、粘贴和备用屏模式；尚未由 Shell 接管时以 `stty sane` 恢复输入、回显与信号。后台 CLI 或已经被其他前台程序接管的 PTY 不重置，Shell 已恢复的 readline 模式不改写。
  - `write-auth`：从 stdin 读取凭据 JSON，以目标用户原子写入 `~/.codex/auth.json`（临时文件 + rename，mode 0600）；拒绝 `.codex` 之外的路径；不回显 token。
- 写入前必须已经停掉该目标的后台与 CLI；任何一个目标停不掉，整体不写 WSL（避免只切一半）。
- 写入后由 helper 读回身份，Windows 侧只拿 email/account_id 结果，不拿 token。
- 不重启 daemon；下一次 WSL 里的 Codex 启动时自行拉起。旧 CLI 不会恢复，旧终端回到 shell。

### 7.5 失败与提示

| 失败点 | 结果 |
|---|---|
| 准备目标凭据失败 | 不关任何客户端、不写任何凭据；弹窗显示错误，可取消。 |
| Windows 客户端关不掉 | 中止写入；按计划重开已关闭的客户端；弹窗提示手动退出或提权后重试。 |
| Windows 写凭据失败 | 按计划重开已关闭的 Windows 客户端；WSL 完全不碰；弹窗显示错误。 |
| Windows 重开失败 | 切号保留；弹窗给「重新打开 Codex」，计划 10 分钟内可重试；WSL 若勾选仍继续。 |
| WSL 目标消失 | Windows 切号保留；WSL 记 `skipped`；toast「账号已切换，未检测到 WSL 目标」。 |
| WSL 进程关不掉 | 不写任何 WSL 目标；已关闭的进程保持关闭；toast「账号已切换；WSL 未跟随，请手动退出后重试」。 |
| WSL 部分目标写失败 | 其余目标保留成功；不重开；toast 报成功/失败目标数；状态标只在整个 WSL 一致时出现。 |
| WSL 写后身份不一致 | 该目标记失败；不重试第二轮；提示重新执行「在 WSL 中使用」。 |
| 取消（执行中） | 不支持；弹窗在执行中不提供取消。切号不能在“已写一半”时假装回滚。 |

- 成功 toast 按实际数量裁剪，不出现“0 个”：
  - 仅 Windows：`已切换到 team@example.com；Windows 重开 1 个应用、2 个 CLI`
  - Windows + WSL：`已切换到 team@example.com；Windows 重开 1 个应用、2 个 CLI；WSL 2 个目标已切换`
  - 仅 WSL：`team@example.com 已用于 WSL；2 个目标，3 个 Codex 已关闭`
- 失败文案区分“账号已切换”与“WSL 未跟随”，不把部分失败报成整体失败。

### 7.6 并发与锁

- Windows 切号与 WSL 单独切号共用同一把切号锁（`CODEX_ACCOUNT_SWITCH_LOCK`），避免一边正在写、另一边又去改同一份凭据。
- 切号进行中：行尾「切换」、卡片 ⋯ 的 WSL 项、设置开关全部禁用；不排队、不静默延后。
- WSL 探测与状态刷新只允许最新一次回包更新 UI；用 epoch 防迟到回包。
- 重开计划只存在后端内存：随机 id、10 分钟 TTL、只暴露计数/失败数给前端；前端不能传 PID、路径或命令。

## 8. 数据与代码改动

### 8.1 配置与退役

| 项 | 改动 |
|---|---|
| `codex_switch_restart_codex` | 新增 bool，默认 false；`config.rs` 加默认值与缺键补齐；`settings.rs` 的 `get_setting` / `set_setting` 加白名单分支。 |
| `codex_sync_wsl` | 删除字段、默认值、缺键补齐，以及 `codex_account_projection.rs` 中所有 `configured_codex_wsl_config_dir()` 分支。 |
| `codex_wsl_config_dir` | 同上；删除旧单目录写穿、`is_default_codex_projection_dir`、`managed_projection_dirs_for_account`、`authority_projection_dirs_for_account`、启动清理里的 WSL 目录分支。 |
| `codex_wsl_auth_auto_sync` | 删除字段与 `settings.rs` 特判；删除前端 `KEY_WSL_AUTH_AUTO_SYNC`、节流常量、排队标志。 |
| 旧配置读取 | 直接不读；不写兼容 shim。旧配置文件里的未知键按现有 serde 行为忽略，下次保存自然消失。 |

### 8.2 前端

| 文件 | 改动 |
|---|---|
| `src/components/codex/CodexSwitchDialog.vue`（新增） | 360px 确认：标题随开关/有无客户端变化、WSL 勾选及状态分支、Windows/WSL 行、警告、执行阶段、重开失败态。 |
| `src/components/codex/CodexWslAssignDialog.vue`（新增） | E 帧：目标列表（最多 3 条 + 等 N 个）、Codex 关闭计数、危险主按钮、执行态。 |
| `src/components/codex/CodexModule.vue` | `doSwitch` 改为先预览再开专用弹窗；卡片 WSL 状态标；菜单项及四种状态；页脚说明；移除进页自动同步；接入切号进度与结果。 |
| `src/modules/settings/CodexSettings.vue` | 删除 WSL 登录态同步整块及状态/函数/imports/样式；新增「切换账号」分组与开关；挂载只读开关。 |
| `src/services/codexState.ts` | 删除 WSL 自动同步相关 refs/函数/节流；新增开关读写、WSL 探测、切号结果处理；`switchTo` 传 `{ restartWindows, applyToWsl }`；保留 `switchStep` 并补新步名。 |
| `src/services/api/codex.ts` | 新增 `switchCodexAccount`（带客户端策略）、`previewCodexSwitch`、`getCodexWslAssignment`、`previewCodexWslAssignment`、`assignCodexAccountToWsl`、`relaunchCodexClients`；删除旧 `wslAuthStatus` / `syncWslAuth` / `restartWslDaemon` 调用。 |
| `e2e/mocks/backend.ts` | 记录 preview / switch / close / relaunch / stopWsl / writeWsl / relaunch 的调用顺序与参数；提供无 WSL、API Key、已使用、多目标、失败态种子。 |
| `e2e/specs/codex.spec.ts`、`e2e/specs/codex-confirmation.spec.ts` | 覆盖 §10 的 mock 场景；账号类动作只跑 mock。 |
| `src/services/__tests__/codexState.test.ts`、`codexWslAuth.test.ts` | 更新切号分支、先关后写、WSL 不勾不调用、失败不回滚、旧自动同步删除。 |

### 8.3 后端

| 文件 | 改动 |
|---|---|
| `src-tauri/codex-core/src/modules/codex_clients.rs`（新增） | Windows 应用/交互式 CLI 枚举、归类、关闭、重开计划；MSIX 包路径与 AUMID 解析；plan id + TTL；只向前端暴露类别、计数、cwd 标签。 |
| `src-tauri/codex-core/src/modules/codex_wsl_auth_sync.rs` | 保留目标发现与 OAuth 身份读取；删除全量状态、自动同步、当前 Windows → WSL 同步、重启命令及源码结构；新增目标预览与“指定账号写入”入口。 |
| `src-tauri/codex-core/src/modules/codex_wsl_auth_sync.rs` 或新 `codex_wsl_assignment.rs` | `get_codex_wsl_assignment()`（只读身份）、`preview_codex_wsl_assignment(accountId)`（目标 + 待关闭计数）、`assign_codex_account_to_wsl(accountId)`；共用切号锁与准备链路。 |
| `src-tauri/codex-core/src/commands/codex_account_commands.rs` | 新增 `preview_codex_switch(accountId) -> CodexSwitchPreview`、`relaunch_codex_clients(planId)`；`switch_codex_account` 增加 `clientPolicy { restartWindows, applyToWsl }`，返回 `CodexSwitchOutcome`；`before_commit` 内关闭 Windows 客户端；提交后重开；WSL 部分接指定账号写入。去掉未使用的 `launch_after_switch`。 |
| `src-tauri/codex-core/src/resources/codex_wsl_daemon.py` | `probe` 增加身份与运行态计数；新增 `stop`（CLI → daemon）与 `write-auth`（stdin、0600、原子写）；删除不再使用的 `restart` 路径（若没有其他调用方）。 |
| `src-tauri/src/commands/settings.rs` | 新增 `codex_switch_restart_codex` 的读取/保存；删除 `codex_wsl_auth_auto_sync` 分支。 |
| `src-tauri/src/commands/file_shortcuts.rs` | 抽出/新增 `spawn_wt_command(dir, exe, args)`，复用 `wt_candidates()` / `try_spawn_wt()` 与 740 回退。 |
| `src-tauri/src/main.rs` | 注册 `preview_codex_switch` / `switch_codex_account` / `relaunch_codex_clients` / `get_codex_wsl_assignment` / `preview_codex_wsl_assignment` / `assign_codex_account_to_wsl`；删除 `get_codex_wsl_auth_status` / `sync_codex_auth_to_wsl` / `restart_codex_wsl_daemon` 注册。 |
| `src-tauri/codex-core/src/modules/process.rs` | 不改恒空桩；客户端枚举独立放在 `codex_clients.rs`，避免影响账号刷新路径。 |

### 8.4 IPC 形态（camelCase）

```ts
type CodexSwitchPolicy = { restartWindows: boolean; applyToWsl: boolean }

type CodexSwitchPreview = {
  windows: { appCount: number; cliCount: number }
  wsl: null | {
    targets: { distro: string; user: string }[]
    current: null | { id?: string; email: string }
    consistent: boolean
    daemonCount: number
    cliCount: number
    canApply: boolean
    alreadyAssigned: boolean
  }
}

type CodexSwitchOutcome = {
  account: CodexAccount
  windows: {
    closedApp: number; closedCli: number
    reopenedApp: number; reopenedCli: number
    reopenFailures: number; reopenPlanId?: string
  }
  wsl: null | {
    status: 'skipped' | 'done' | 'partial' | 'aborted'
    targets: number; written: number
    daemonsStopped: number; clisStopped: number
    failures: { distro: string; user: string; message: string }[]
  }
}

type CodexWslAssignment = {
  targets: { distro: string; user: string }[]
  current: null | { id?: string; email: string }
  consistent: boolean
  error?: string
}

type CodexWslAssignmentPreview = {
  targets: { distro: string; user: string }[]
  daemonCount: number
  cliCount: number
  alreadyAssigned: boolean
  canApply: boolean
}
```

**安全约束**：关闭/重开只接受后端生成的 plan id 与枚举 scope；不从前端接收 PID、路径、命令行或任意命令。WSL helper 只接受固定 action、目标 home 与 stdin 凭据；结束前校验 PID/startTicks/uid；日志、预览、toast 不含 token 原文、argv 原文或环境变量。

## 9. 边界与风险

- **旧进程回写。** 运行中的 Codex 可能在刷新时重写 `auth.json`；因此必须先关对应客户端再写。关不掉就中止，不能边写边赌。Windows 与 WSL 分别遵守这条。
- **不原子。** Windows 已切、WSL 失败时不回滚；文案必须区分“账号已切换”与“WSL 未跟随”。WSL 不会因为失败自动恢复已关闭的 CLI。
- **WSL 终端不重开。** v5 明确不重开 WSL CLI/终端；旧终端回到 shell，用户自己重新启动。不承诺续上对话；历史仍在 `~/.codex`。
- **同一账号的 RT 轮换。** 两边写入同一账号时，后续各自刷新可能产生不同 RT；Desko 不维护 WSL 的持续写穿（沿用 `17-wsl-auth-sync.md` 的边界）。若 WSL 登录失效，重新执行「在 WSL 中使用」。WSL 与 Windows 使用不同账号时不涉及。
- **无 WSL / 无 `~/.codex`。** 不显示任何 WSL 控件，不创建目录；有发行版但没跑过 Codex 也算无目标，不能报成错误。
- **探测失败静默。** 账号页拿不到 WSL 身份时不显示状态标与菜单项；不阻断 Windows 切号。下次进页或切号后重试。
- **多目标不一致。** 不显示任何状态标；从任一卡片执行 WSL 写入会把全部目标对齐。没有逐目标选择。
- **总开关关闭只改凭据。** 不关应用、不重开，正在运行的 Windows Codex 可能继续用旧账号；确认里必须写明。
- **跨提权。** desko 与 Codex 权限不同时可能关不掉；中止并提示，不静默跳过。
- **应用更新。** MSIX 包族或 AUMID 变化会导致重开失败；给「重新打开」并保留计划，不硬编码版本。
- **desko 自己的 runtime。** 对话功能已移除，desko 不再运行自己的 `codex app-server`；若后续恢复类似能力，需重新评估是否纳入“先关后写”。
- **IDE / 非交互进程。** `codex exec`、IDE app-server、`codex-code-mode-host` 不属于“Codex 应用/CLI”，不关也不重开。
- **慢探测。** Windows 客户端或 WSL 探测可能超过 2 秒；弹窗先开、行内显示检查中，主按钮在 Windows 预览未完成且总开关为开时禁用；不无限等待。
- **计划过期。** 重开计划 10 分钟后失效；过期后按钮改提示“请手动打开 Codex”，不重复拉起。

## 10. 验收

1. **单测**
   - 设置：新键默认 false、持久化、旧 WSL 键不再读写；设置页不再调用旧状态接口。
   - Windows 切号：总开关关不关闭/不重开；总开关开先关后写，关闭失败不写；重开失败返回计划；CLI 只在原 cwd 重开。
   - WSL 勾选：默认不勾时 `stopWsl` / `writeWsl` 调用为 0；勾选时先停后台与 CLI、再写全部目标；不重开；身份读回不一致记失败。
   - WSL 单独切号：不改 Windows 当前账号、不写 Windows `auth.json`、不碰 `config.toml`；当前账号过期不代刷；非当前账号准备失败时不停进程。
   - 状态标：一致 / 不一致 / 无目标 / 读取失败；不启动 daemon、不刷新 token。
   - 客户端识别：应用 vs 交互式 CLI vs `app-server` / `exec`；跨提权失败；无法取得 argv 时只开裸 `codex`。
   - helper：PID/startTicks/uid 校验、SIGTERM→SIGKILL、`write-auth` 0600 原子写、拒绝 `.codex` 外路径、不回显 token。PTY 回归覆盖 SIGTERM/强杀后的终端复位、父 Shell 继续执行命令与 Ctrl+C、新前台程序不被重置，以及多终端清理失败隔离。
   - 安全：预览 / toast / 日志不含 token、argv、环境变量；plan id 不跨 scope 重用。
2. **e2e（mock，账号类动作只跑 mock）**
   - 默认关闭 + 无 WSL：专用确认无勾选框、无重启行；switch 调用不带 close/relaunch/WSL。
   - 开启 + 有 WSL：确认默认不勾；不勾时 WSL 调用为 0；勾选后出现 WSL 行，顺序为 closeWindows → switch → relaunchWindows → stopWsl → writeWsl，且没有 WSL 重开调用。
   - 关闭 + 有 WSL：无 Windows 重启行，仍可勾选 WSL；勾选后只停/写 WSL。
   - 卡片菜单：OAuth 可点；纯 API Key 置灰并显示原因；无目标隐藏；已是 WSL 账号显示「WSL 已使用此账号」。
   - WSL 单独切号：确认列出目标与关闭计数；执行后 Windows 账号、Windows Codex 进程不变。
   - 失败：Windows 关不掉不写；重开失败给「重新打开」；WSL 停不掉不写；部分目标失败 toast 计数正确。
   - 设置页：旧「WSL 登录态同步」块消失；新开关保存后重开弹窗仍保持；删除的按钮不出现。
3. **视觉**
   - 九帧（A、B、C、D1、D2、E、F、G、H）在 paper/ink 下逐帧对拍；360px 确认、760×560 设置弹窗、1040 常规窗；
   - 800px 窄窗下确认与设置页不横向溢出；菜单不遮触发点；勾选后弹窗高度增长不裁底栏；
   - 警告用 `--warning`；禁用项不用整颗 opacity；无入场动画。
4. **真机**
   - 账号切号、Windows 客户端关闭/重开、WSL 停止与写盘的实现验证，仍遵守**账号类动作只跑 mock**的约定：代理只验证 UI、mock 与纯只读探测，不拿真实账号点一次切号。

## 11. 拍板记录（v5 定稿）

| 编号 | 决策 | 结果 |
|---|---|---|
| D1 | 设置开关默认关？ | **是。** 不用 WSL 或不想重启的人零变化。 |
| D2 | WSL 是否跟随由谁决定？ | **每次切号确认里的「同时用于 WSL」，默认不勾。** 开关只管 Windows。 |
| D3 | 卡片 ⋯ 还保留 WSL 入口吗？ | **保留。** 它是只改 WSL、不动 Windows 的入口。 |
| D4 | 勾选后 WSL 怎么处理？ | **关闭共享后台与交互式 CLI，不重开。** 不恢复终端、不续对话。 |
| D5 | Windows 重启范围？ | **应用 + 交互式 CLI；写入后重开，CLI 回原目录。** 不含 `codex exec`、IDE app-server。 |
| D6 | WSL 支持哪些账号？ | **仅普通 OAuth；API Key / Agent Identity / Web Session 不写。** |
| D7 | 还要跟随条/状态矩阵/手动同步吗？ | **不要。** 只留卡片状态标与卡片 ⋯ 入口。 |
| D8 | 旧 WSL 同步链路怎么处理？ | **整体退役。** 含 `codex_sync_wsl`、`codex_wsl_config_dir`、`codex_wsl_auth_auto_sync` 与进页/切号自动同步。 |
| D9 | 提供逐目标勾选吗？ | **否。** 一次写全部运行中的 WSL 目标。 |
| D10 | 失败怎么处理？ | **提交前失败不写；提交后失败不回滚，分开报“账号已切换 / WSL 未跟随”；重开失败保留计划可重试。** |

## 12. 关联文档

- [17-wsl-auth-sync.md](17-wsl-auth-sync.md)：WSL 目标发现、只写 auth.json、源过期不代刷、RT 轮换边界；v5 沿用这些契约，只换了入口与交互。
- [20-quota-hud.md](20-quota-hud.md)：额度挂件，与本交互无耦合。


## 13. 实现与验证（2026-10-23）

已按 v5 落地：设置只控制 Windows 重启，确认框每次默认不勾 WSL；账号卡片提供只读状态标与独立 WSL 分配入口。旧 WSL 自动同步的设置、IPC、进页调用、隐式写穿和后台重启入口已退役，会话统计配置保留。

- 前端：`CodexSwitchDialog.vue`、`CodexWslAssignDialog.vue` 复用 360px 确认壳；预览期间禁用提交，执行时阻止关闭并保留键盘焦点，失败保留行内重试。无目标或探测失败时隐藏 WSL 项。
- Windows：`codex_clients.rs` 识别官方包与交互式 CLI；关闭失败恢复已关闭条目，提交前再次检查是否有新进程。终止时使用创建 FILETIME 和同一内核句柄核验身份；argv 无法读取时，只对可确认来自终端的 CLI 采用原目录裸命令回退。
- 事务：`codex_switch_flow.rs` 保持凭据准备 → 关闭 Windows → 提交 → 重开 → 可选 WSL 的顺序。重开失败保留随机计划，限制当前档案与 Codex home、10 分钟有效，仅重试失败条目。Windows 已提交后的网关或 WSL 失败按部分成功返回。
- WSL：固定 `probe` / `stop` / `write-auth` helper，使用目标用户执行；核验 PID/startTicks/uid，先关 CLI 再关后台，全部目标停止成功后才写入。只原子替换 `auth.json`（0600），读回身份，不重开进程，不二次刷新当前 Windows 账号。
- Web：沿用浏览器凭据切换的既有边界；服务端强制关闭 Windows 重启和 WSL 分配策略，Web 不提供本机进程控制。

验证结果：

| 检查 | 结果 |
|---|---|
| 前端状态层单测 | 86 项通过 |
| Rust 事务、身份、关闭恢复、计划隔离与配置测试 | 20 项通过 |
| Windows Terminal 参数引用测试 | 1 项通过 |
| WSL helper 合成文件与进程测试 | 14 项通过 |
| 浏览器回归（账号、会话、用量、Web、响应式与九帧布局） | 125 项通过 |
| `vue-tsc --noEmit`、Vite 生产构建、Windows 原生构建 | 通过 |

截图与日志保存在本地 `.tmp/account-switch-20261023/`，其中 `screens/` 为实现截图、`prototype/` 为 HTML 九帧参照。paper/ink 各验证 800px 和 1040px，另验证 390px Web；确认框宽 360px，常规设置窗 760×560，未发现横向溢出或菜单遮挡触发点。

遵守 §10.4：上述账号切换与关闭/重开全部使用 mock 或合成夹具，未切换真实账号、刷新真实令牌、结束真实 Codex 进程或写入真实 `auth.json`。真实环境的跨提权、MSIX 激活和 WSL 终止效果未作破坏性实测。
