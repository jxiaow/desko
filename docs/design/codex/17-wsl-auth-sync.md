# Codex 登录态同步到 WSL（2026-10-20，已实现）

一句话方案：**设置 → Codex 新增「WSL 登录态同步」**——把 Windows 侧 Codex 当前登录凭据（`auth.json`）按需/自动推送到运行中的 WSL 发行版，只同步凭据、不碰 `config.toml`；自动同步默认关，手动「立即同步」永远可用。

## 1. 背景与现状实测（2026-10-20）

WSL 里的 Codex 是 2026-10-12 手工从 `C:\Users\jxiaow\.codex\auth.json` 拷过去的。今天两边都过期，实测：

| 项 | Windows | WSL (Ubuntu-26.04 / jxiaow) |
|---|---|---|
| `auth.json` mtime | 10-12 11:19 | 10-12 11:19（同一次拷贝） |
| `auth_mode` | `chatgpt` | `chatgpt` |
| 账号 | 263291365@qq.com · pro | 同左 |
| access_token 到期 | **2026-10-20 10:30（已过期）** | **同左（已过期）** |
| 文件权限 | 644 | 600 |

**结论：现在单纯「再同步一次」没有意义**——Windows 侧自 10-12 起没有刷新过 token，复制过去仍是同一份过期凭据。本功能必须把「源是否过期」摆在界面上，并在源过期时拒绝同步，而不是静默拷一份废 token。

同时确认了三件实现事实：

1. 现有 WSL 集成：`codex_session_wsl.rs` 已在枚举运行中发行版的 Codex 目录（用量统计在用），可直接复用；UNC 路径下 `current` 等符号链接不可读，但 `auth.json` 是普通文件，无影响。
2. 写入选型已实测：从 Windows 经 `\\wsl.localhost\...` 创建/原子改名文件，WSL 侧 owner 仍是 `jxiaow`、mode 644；随后 `wsl.exe -d <distro> -- chmod 600 <path>` 可收敛到 600。原子替换（temp + rename）在 9p 下可用。
3. 后端口径：`read_configured_codex_auth_value(get_codex_home())` 是 desko 认的「官方认证权威源」，按 `cli_auth_credentials_store` 读 `auth.json` 或 Windows 凭据存储；本机是 file 模式。WSL 侧不应照搬 `config.toml`（10-12 已确认它含 Windows 路径、命名管道和 `npx` MCP，搬过去会弄坏 WSL 那份）。

另有一个**已存在但无 UI 的隐藏开关**：`codex_sync_wsl` + `codex_wsl_config_dir`（默认 false / 空），切号时把完整 bundle（auth+config+marker+模型目录）写进一个手工配置的 UNC 目录。它不满足本需求（无发现、无状态、会写 config、仅切号触发），本方案**不复用它、也不删除它**，两者互不干扰。

## 2. 范围

| 在内 | 明确不在 |
|---|---|
| Windows 官方登录态 → WSL `auth.json` 单向同步 | 反向同步（WSL → Windows） |
| 运行中发行版自动发现 + 目标状态展示 | 手动填写目录 / 非运行发行版预配置 |
| 手动「立即同步」+ 可选自动同步（切号后、进 Codex 页时） | 后台定时器 / 文件监听 / 自动拉起 WSL |
| 只写 `auth.json`，原子替换 + 600 | `config.toml`、模型目录、marker、会话数据 |
| 源过期 / 目标更新 / 不同账号的判定 | 代用户刷新 token、重新登录、切号 |

## 3. 规格

### 3.1 源：Windows 侧 Codex 登录态

- 读取 `codex_account::read_configured_codex_auth_value(get_codex_home())`；file/keyring 两种存储都覆盖。
- v1 只支持 `auth_mode=chatgpt`（OAuth）；API Key / agent identity 等形态显示「当前登录形态暂不支持」，不做半吊子搬运（WSL 侧还缺对应 provider 配置）。
- 前端只拿元数据：邮箱、套餐、access_token 到期时间、`auth.json` 路径、是否过期。**token 原文不出后端**。
- 源缺失、不可解析、已过期 → 给出明确原因；**已过期时禁用同步**，文案指明「先在 Windows Codex 里刷新或重新登录」。

### 3.2 目标：运行中的 WSL 发行版

- 枚举方式复用 `codex_session_wsl`：`wsl --list --running --quiet`，再找每个发行版的 `home/*/.codex` 与 `root/.codex`（只认已存在的目录，不替没装 Codex 的发行版创建目录）。
- 每个目标展示：发行版、用户、目标 `auth.json` 的账号/到期时间、同步状态。
- WSL 未运行时目标为空，提示「未检测到运行中的 WSL」，**不自动拉起发行版**。
- 写入路径：`\\wsl.localhost\<distro>\home\<user>\.codex\auth.json`；写完 `wsl.exe -d <distro> -- chmod 600 <linux path>`。chmod 失败按「已写入但权限收敛失败」报告，不吞掉。

### 3.3 同步语义

- **载荷只有 `auth.json` 一个文件**，整值替换（不做 key 合并）；原子写（temp + rename），沿用 `write_secret_string_atomic`，不生成明文 `.bak`。
- 判定（逐目标独立执行，允许部分成功）：

| 目标现状 | 动作 |
|---|---|
| 同账号，且目标 access_token 到期 ≥ 源 | 跳过：「已是最新」 |
| 同账号，目标更旧 / 已过期 | 覆盖 |
| 不同账号 | 覆盖（WSL 跟随 Windows 当前登录） |
| 目标 `auth.json` 不存在但 `.codex` 存在 | 新建（相当于帮 WSL 登录一次） |
| 目标不可读 / 非 JSON | 覆盖，但结果里标注「原文件不可读，已替换」 |

- 源不可用（缺失 / 不可解析 / 非 OAuth / 已过期）时 `sync_codex_auth_to_wsl` 直接返回错误、不写任何文件；前端保留源状态行与过期提示，并禁用「立即同步」。
- 结果按目标返回 `synced / skipped / failed`，前端汇总成「已同步 N 个目标，跳过 M 个」；失败目标在设置页内联展示原因。

### 3.4 触发

1. **手动**：设置页「立即同步」按钮，永远可用（不依赖自动开关）。
2. **自动（默认关）**：打开后
   - 切号成功后自动跑一次（账号变了，WSL 必须跟随）；
   - 进入 Codex 页时跑一次，距上次自动同步不足 10 分钟则跳过（节流只在前端内存里，不落盘）。
3. 自动同步失败静默：只更新设置页里的状态行，不弹 toast；手动同步失败才弹错误。

### 3.5 界面

位置：**设置 → Codex**，紧挨现有「自动统计 WSL 会话」，同一组 WSL 语义住在一起。不占账号页 `.page-bar`（那里是账号 CRUD/批量的动作面）。

```
WSL 登录态同步                       [开关]
把 Windows 侧 Codex 的登录凭据同步到运行中的 WSL；只写 auth.json，不动 config.toml。
打开开关后，切号成功或进入 Codex 页时自动同步（10 分钟内最多一次）。

Windows 登录：263291365@qq.com · pro · 凭据 2026-10-20 10:30 · 已过期
  Ubuntu-26.04 / jxiaow              同账号 · 待同步
  263291365@qq.com · 凭据 2026-10-20 10:30 · 已过期
[立即同步] [刷新状态]
Windows 侧凭据已过期，请先在 Codex 中刷新或重新登录，再回来同步。
```

- 源过期时按钮禁用，红色/警示档色内联说明；目标行只做状态展示，不单独给按钮（v1 一次同步全部目标）。
- 沿用现有 `.setting-item` / `.switch` / `.action-btn` 尺寸轴，不引入新控件体系。

## 4. 数据契约（不含 token）

```text
get_codex_wsl_auth_status() -> {
  autoSync: bool,
  source: {
    available: bool, path: string, authMode: string,
    email: string|null, plan: string|null,
    accessExpiresAt: number|null, expired: bool, error: string|null
  },                                   // 永远返回对象；不可用由 available=false + error 表达
  targets: [{
    distro: string, user: string, homePath: string,
    state: 'empty'|'same'|'outdated'|'newer'|'different-account'|'unreadable'|'unknown',
    email: string|null, accessExpiresAt: number|null, expired: bool
  }],
  targetError: string|null             // wsl.exe / 目录枚举失败；targets 为空并给出原因
}

sync_codex_auth_to_wsl() -> [          // 直接返回逐目标结果；源不可用/过期时整个命令 Err
  { distro, user, status: 'synced'|'skipped'|'failed', message: string|null }
]
```

`autoSync` 开关走现有 `get_setting/set_setting`，新增 `codex_wsl_auth_auto_sync` 特判（照 `codex_usage_auto_wsl` 的写法），不新增设置类命令。

## 5. 改动清单

| 文件 | 内容 |
|---|---|
| `src-tauri/codex-core/src/modules/codex_wsl_auth_sync.rs`（新增） | 源读取、目标发现、状态判定、原子写入 + chmod；`include!` 进 `codex_account.rs` 复用同模块作用域 |
| `src-tauri/codex-core/src/modules/codex_session_wsl.rs` | 把发行版枚举/UNC→Linux 路径解析提成可复用函数（现有 `discover_usage_dirs` 语义不变） |
| `src-tauri/codex-core/src/commands/codex_account_commands.rs` | 新增 2 条命令；`src-tauri/src/main.rs` 注册 |
| `src-tauri/codex-core/keep_cmds.json` | 在册 62 → 64，补两条 |
| `src-tauri/src/commands/settings.rs` | `codex_wsl_auth_auto_sync` 的 get/set 特判 |
| `src/services/api/codex.ts` + `codexState.ts` | 状态/同步 API、自动同步节流、切号成功后触发 |
| `src/modules/settings/CodexSettings.vue` | 新设置分组（状态行 + 目标列表 + 同步按钮 + 开关） |
| `e2e/mocks/backend.ts`、`e2e/specs/codex.spec.ts` | mock 两条命令；三条用例：默认关 + 过期源禁用同步、手动同步成功并刷新状态、开启自动后进 Codex 页静默同步一次 |
| `docs/design/codex/08-token-stats-and-entry-audit.md` | 命令面活账更新（如仍要求同步） |

## 6. 决策记录（已定）

- **D1 源 = Windows 官方登录态**，不是 desko 账号库。理由：用户手工流程就是这个文件；Windows Codex 自己刷新后，同步立刻拿到最新；不依赖账号是否导入过 desko；也不触发 refresh_token 轮换。
- **D2 只同步 `auth.json`**。10-12 已证实 `config.toml` 不可跨平台搬；WSL 未运行时不强行写入。
- **D3 源过期不代刷**。desko 强制刷新会轮换 refresh_token，而官方 profile 的后台不写穿是既有设计（避免打断运行中的客户端）；本功能不碰这条线。源过期只提示用户去 Codex 刷新/重登，然后点同步。
- **D4 自动同步默认关**，且只挂「切号后 + 进 Codex 页」两个轻量触发，不做后台定时器/文件监听。理由：无新增常驻线程、无 WSL 唤醒；需要时手动按钮兜底。
- **D5 入口放设置 → Codex**，与「自动统计 WSL 会话」同组；账号页动作面不动。

## 7. 风险与边界

- 写入的是真实凭据：命令实现不得把 token/refresh_token 写日志或返回前端；统一走 `write_secret_string_atomic`。
- 同一账号、WSL token 更新时默认不覆盖：防止把 WSL 刚刷新出来的新 RT 链压回旧链。
- WSL 发行版名/用户名可能含空格或非 ASCII：路径解析和 `wsl.exe` 参数按 `OsStr` 传递，不做字符串拼接式 shell 调用。
- 多用户发行版会把当前账号凭据写进每个已有 `.codex` 的用户目录；个人机可接受，文档明示。
- 与既有隐藏开关 `codex_sync_wsl` 并存：两者都开启时，切号会各写一次（旧的开关仍写完整 bundle）；本方案不打开旧开关、不改其默认值。

## 8. 验收计划

1. Rust 单测：UNC→Linux 路径解析、账号/到期判定矩阵（same/newer/outdated/different/empty）、源过期拒绝写。
2. 机制真机测试只用**假凭据 + 临时目标目录**（不复用真实 `~/.codex/auth.json`，遵守账号类动作只跑 mock 的约定）；重点验证 600 与原子替换。
3. `npx vue-tsc --noEmit` 0 error；`npx vitest run` 全绿。
4. `PW_CHANNEL=msedge npx playwright test e2e/specs/settings.spec.ts e2e/specs/codex.spec.ts --retries=0` 全绿（含新增默认关/过期禁用/目标状态三条）。
5. 真机手动验收：用户在设置页点一次「立即同步」，确认 WSL `~/.codex/auth.json` 的 mtime/账号/到期时间变化，`codex login status` 在 WSL 内为 `Logged in`。此步需要用户自己点（真实账号动作）。
6. 提交与推送另行点头。

## 9. 定案：源过期只提示、不代刷

用户已拍板按 D3 执行：源过期时只展示原因并禁用同步，不提供「刷新 Token 并同步」；refresh_token 轮换与运行中客户端的写穿问题都不在本功能范围内。

## 10. 交付记录（2026-10-20）

- 后端：4 条 Rust 单测通过（路径解析、状态矩阵、源过期拒绝写、原子替换不留明文 `.bak`）；`cargo check` / `cargo check -p codex-core --all-targets` 通过。
- 前端：`npx vue-tsc --noEmit` 0 error；`npx vitest run` 52 文件 / 544 用例全绿。
- e2e：`PW_CHANNEL=msedge npx playwright test e2e/specs/codex.spec.ts e2e/specs/settings.spec.ts --retries=0` 85 条全绿（含本功能 3 条）。
- 视觉：800px 宽浅色/深色 + 无目标空态截图目检通过（`.tmp/codex-wsl/settings-wsl-auth-*.png`，本地不入库）。
- 真机验收待用户执行：在设置页点「立即同步」，确认 WSL `~/.codex/auth.json` 的账号/到期时间变化与 `codex login status` 结果；真实账号动作不由代理代点。
