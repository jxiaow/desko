# 开发与构建

[返回产品介绍](../README.md)

## 技术栈

- **前端** Vue 3、TypeScript、Vite、Pinia、vue-router；小记编辑器是 TipTap（`marked` / `turndown` 做 Markdown 进出，`DOMPurify` 净化，`lowlight` 高亮）。
- **桌面壳** Rust + Tauri 2，无装饰自定义窗口、托盘、单实例锁；`rusqlite`（bundled SQLite）落数据，`aes-gcm` + `pbkdf2` 做主密钥与字段加密。
- **Cargo workspace**（[src-tauri/Cargo.toml](../src-tauri/Cargo.toml)）除主程序外还有三颗独立 crate：`fileshare-core`（传输服务进程 `desko-fileshare`）、`netguard-core`（提权 helper `desko-netguard`）、`codex-core`（Codex 账号/会话/用量）。`desko-fileshare` 与 `desko-netguard` 作为 `externalBin` 随安装包分发。
- **窗口与平台** WebView2 + `windows` crate（会话锁定、路由探测、Job Object 兜住 cloudflared、`runas` 拉提权 helper）。
- **外观** 纸/墨两套底色 × 多强调色，令牌集中在 [src/styles/workspace-themes.css](../src/styles/workspace-themes.css)；中文用内置可变字体子集，见 [public/fonts/NOTICE.md](../public/fonts/NOTICE.md)。图标骨架见 [public/icons/NOTICE.md](../public/icons/NOTICE.md)。

## 目录结构

```
src/                Vue 前端
  views/            8 个模块页 + 空态页
  components/       按模块分目录，另有 layout / settings / shared
  stores/           Pinia 状态（auth、notes、entries、…）
  services/         Tauri 调用封装、运行时判定、主题、额度挂件
  modules/          模块注册表 + 模块自带设置页签
  styles/           global.css 与主题/材质样式
src-tauri/src/      Rust
  commands/         前端可调的全部命令（按领域分文件）
  services/         命令背后的实现（含隧道、传输、网络选路、备份、档案）
  db/               SQLite schema 与各数据仓库（note_repo / entry_repo / …）
  backup/           备份容器与校验
  crypto.rs         主密钥、封条、字段加解密
  paths.rs          当前档案根路径（进程内唯一写入点）
src-tauri/{fileshare,netguard,codex}-core/   独立 crate 与服务二进制
src-tauri/gen/schemas/   Tauri 自动生成的权限 schema，不入版本库
e2e/                Playwright 规格与内存版 fake backend（镜像 Rust 契约）
docs/design/        按主题分目录的设计文档（编号 = 决策顺序）
scripts/            截图/走查/构建辅助脚本
design/ shots/      历轮 mock 与走查产物，默认不入版本库
```

## 环境要求

- Windows 10/11（需 WebView2 运行时，Win11 自带）。
- Node.js `^20.19.0 || ^22.12.0 || >=24.0.0`。
- Rust 稳定版 + MSVC 工具链与 Windows SDK（`rustup` 默认 GNU 工具链不能构建 Tauri）。

## 跑起来

```bash
npm install
npm run tauri dev
```

`tauri dev` 的 `beforeDevCommand` 会先把 `desko-fileshare`、`desko-netguard` 两颗 debug 二进制构建到 `src-tauri/target/debug/`，再拉起 Vite（`http://127.0.0.1:1420`）。装完包直接跑就行，不必手工预构建。

几条容易踩的：

- **单实例锁**：已有 Desko 在跑时，新起的 dev 会秒退。先退出正在运行的实例。
- **缺二进制**：`externalBin` 声明的 exe 找不到时主程序 `exit 101`。改动过 sidecar 后重跑 `node scripts/sync-fileshare-server.mjs` / `node scripts/sync-netguard-helper.mjs`。
- **端口占用**：1420（dev）或 1430（e2e/mock）被占会让 Vite 直接失败，`--strictPort` 下不会自动换端口。
- **想在浏览器里看界面**：裸 `npm run dev` 打开的页面没有原生桥、也没有 mock，调不通。用 e2e 那套内存后端起：`npm run dev -- --mode e2e --port 1430 --strictPort`，`scripts/*-shots.mjs` 全部指向这个地址。纯设计稿（注真 token 的单页 mock）走 `node scripts/mock-build.mjs <src.html> <out.html>` 后直接打开。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 只起 Vite（`tauri dev` 挂载它；浏览器直开没有数据后端，见上） |
| `npm run tauri dev` | 起桌面版 |
| `npm run build` | `vue-tsc --noEmit` 类型检查 + `vite build` |
| `npm run build:installer` | `tauri build` 出 NSIS 包，再把安装包拷到根目录 `installer/` |
| `npm run test` | Vitest 单元测试（watch） |
| `npm run test:run` | Vitest 单次全跑 |
| `npm run test:e2e` | Playwright 全量端到端（自带 e2e 模式的 Vite mock 后端） |
| `npm run check:codex-protocol` | 用本机 codex CLI 生成协议 JSON schema，核对本仓库依赖的方法与字段仍在（不登录、不建任务、不调模型） |

## 测试

```bash
npm run test:run                      # 单元测试（jsdom）
PW_CHANNEL=msedge npx playwright test  # 端到端
```

- E2E 不启动 Tauri，而是在 `127.0.0.1:1430` 用 Vite 的 `--mode e2e` 注入 [e2e/mocks/backend.ts](../e2e/mocks/backend.ts) 这份内存 fake backend；它镜像 `src-tauri/src/commands/*.rs` 的行为契约，改 Rust 命令返回结构时要同步改这里。
- Playwright 复用本机已装浏览器（配置里 channel 默认 `chrome`；本机只有 Edge 时传 `PW_CHANNEL=msedge`）。
- 真机验收走 `npm run tauri dev` 手工确认，单元与 e2e 全绿不等于原生链路可用。

## 数据在哪

每个档案一个目录，启动时确定、进程内不换（切档案靠重启）：

```
%APPDATA%\com.desko.app\profiles\<档案 id>\
  data.db        SQLite：小记、收藏、快捷方式、验证码等工作区数据
  attachments\   小记图片等附件
  favicons\      收藏站点的图标缓存
```

备份由「设置 → 备份」生成，可只留本机，也可经 WebDAV（当前对接坚果云，含它的限流与应用密码规则）自动同步并保留指定份数；恢复需要备份密码。换主密码、切档案、恢复备份或停 Web 服务都会让既有 Web 登录会话失效。

## 设计文档

决策过程按主题放在 [docs/design/](design/)，文件名前两位数字是同一主题内的顺序。仓库保留 Markdown 设计记录；历史 HTML 原型、截图、实验 CSS/JSON/脚本和旧走查报告已归档移出，文中的相关路径与复现命令是历史记录。已入库版本可通过 `git log --all -- <文件路径>` 查找；本机未提交的草稿以清理前备份为准。

新的临时原型与验证产物放在 `design/` 或 `.tmp/`，不入版本库。`src-tauri/gen/schemas/` 由 `tauri-build` 在构建时根据 `capabilities/` 和插件权限重新生成，也不入版本库。

- `themes/`、`atmosphere/`、`layering/`、`lighten/` — 色板、氛围光场、层间阶梯
- `workspace/`、`modules/`、`onboarding/`、`profiles/` — 页面骨架、模块运行时、首启两屏、多档案
- `notes/`、`fs-app/`、`fs-web/`、`tunnel/`、`bypass/`、`codex/`、`web/` — 各领域功能设计
- `lock-screen/`、`toast/`、`selection/`、`unify/`、`v52/`、`redesign/` — 锁页、通知、批量、统一化轮次

## 走查与截图脚本

`scripts/` 下的 `*.mjs` 是设计和验证工具，跑完产物落 `design/`、`.tmp/`（默认不入本）：

旧轮次的专用拍图脚本已随原型归档；通用截图、主题检查、构建发布及测试依赖脚本继续保留。

| 脚本 | 用途 |
|---|---|
| `design-audit.mjs`、`color-sweep.mjs` | 对照设计基线走查；全窗口主题组合的颜色对账 |
| `check-theme-coverage.mjs`、`check-zindex-stack.mjs` | 主题令牌覆盖、层级栈冲突静态检查 |
| `theme-shots.mjs`、`nav-shots.mjs`、`dialog-shots.mjs` 等 `*-shots.mjs` | 各面各弹窗的定帧截图 |
| `theme-tokens-dump.mjs`、`theme-intake.mjs` | 从代码现场导出令牌清单（给外部配色稿当输入）；校验外部配色交付物，只出判决不写项目 |
| `mock-build.mjs`、`mock-cloudflared.mjs` | 把真 token 与真图标路径注进设计 mock 产出可截图页；假 cloudflared，用同一套参数跑通报文状态机 |

## 许可与致谢

字体见 [public/fonts/NOTICE.md](../public/fonts/NOTICE.md)，图标集见 [public/icons/NOTICE.md](../public/icons/NOTICE.md)（各自保留上游许可证条款）。
