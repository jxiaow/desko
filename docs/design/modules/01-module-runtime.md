# 模块化运行时（module runtime）— 现状与方案

日期：2026-10-10　状态：**已拍板**（Q1 独立空态页 / Q2 「模块」页签只收 8 个页面模块 / Q3 关核心页不弹确认、只 toast）

已定方向（本轮问答）：8 个页面模块全部可开关，设置弹窗新增独立「模块」页签；按需加载做前端运行层（注册表 + 路由/store/预取按开关挂载），不动后端命令注册与编译期裁剪；核心三页也允许关，允许「零模块」状态。

## 结论

现在不是一个"模块系统"，是 8 份各写各的硬编码：5 个附加模块各自有一份 ~35 行几乎重复的 `*Feature.ts`（默认关、只控侧栏 `v-if`），3 个核心页写死在 `Sidebar.vue` 与 `router/index.ts` 里，`App.vue` 还无条件预取收藏数据。路由本身已经是 lazy chunk（`NotesView` 538KB、`MfaView` 138KB 各自分包），所以"按需下载"其实已经有了；真正缺的是**按需挂载**——关掉的模块现在仍然带着它的 store、侧栏分支、解锁预取和锁定清理。

方案是把这些散点收成一处：`src/modules/registry.ts` 声明每个模块的开关键、路由、图标、简介、默认值，以及四个生命周期钩子（boot / onLock / onDisable / settingsTab）；`Sidebar.vue`、`router/index.ts`、`App.vue`、`SettingsDialog.vue` 改为消费注册表，不再点名任何模块。关闭 = 隐藏入口 + 停常驻服务 + 不预取，**数据与口令一律保留**，重开即用。

## 现状盘点（实测）

| 模块 | 路由 | 开关现状 | 开关之外还钉在哪 |
|---|---|---|---|
| 小记 | `/notes` | 无，常驻 | `router/index.ts:8`；`Sidebar.vue:65`（含计数）；`App.vue:50-53,76-77`（口令解锁态）；`SettingsDialog.vue:29-31,566`（小记口令行） |
| 网址收藏 | `/entries` | 无，常驻 | `router/index.ts:7`；`Sidebar.vue:76`（计数）；`App.vue:85-86,98`（解锁后无条件 `fetchEntries`）、`:79-80`（锁定时重置搜索态）、`:164`（备份恢复后重拉） |
| 文件快捷 | `/files` | 无，常驻 | `router/index.ts:9`；`Sidebar.vue:87`（计数）；`App.vue:89-93`（进页才 `fetchShortcuts` 的 watch） |
| 验证码 | `/mfa` | `mfaFeature.ts` | `Sidebar.vue:98`；`SettingsDialog.vue:382`；`MfaModule.vue:8` 页内自读 |
| 局域网传输 | `/fileshare` | `fileshareFeature.ts`（关闭连带停监听） | `Sidebar.vue:106`；`SettingsDialog.vue:338,390` + 独立设置页签 + `settingsInitialTab` 联合类型 `App.vue:45`；`FileShareModule.vue:7` |
| 内网穿透 | `/tunnel` | `tunnelFeature.ts`（关闭停隧道进程） | `Sidebar.vue:114`；`SettingsDialog.vue:402`；`TunnelModule.vue:7` |
| 直连清单 | `/bypass` | `bypassFeature.ts` | `Sidebar.vue:122`；`SettingsDialog.vue:412`；`BypassModule.vue:13` |
| Codex 账号 | `/codex` | `codexFeature.ts` | `Sidebar.vue:130`；`SettingsDialog.vue:422` + `loadCodexPaths()`（`:236`）；`CodexModule.vue:7` |

三处共性缺陷，正好是收口后的收益：

1. **开关只在侧栏生效**。`router/index.ts` 无条件注册 8 条路由，关掉「内网穿透」后直接访问 `/tunnel` 照样进得去，只是侧栏没入口。
2. **读取时机挂在侧栏**。`Sidebar.vue:38` 的 `onMounted` 是唯一拉 flag 的地方，而侧栏只在解锁态挂载——所以锁定页、设置弹窗首帧看到的都是缺省值，`App.vue` 的解锁回调必须赌侧栏已经读完。
3. **落库失败的回滚各写一遍**。5 份 `saveXFeature` 各自 try/回滚/附带停服，`SettingsDialog` 里再各自抄一次"关掉时把人从页面上带走"（`:180,190,203,215,227`），文案 `router.replace('/notes')` 硬编码落地页。

## 目标形态

### 模块清单与默认值

| id | 标题 | 设置键 | 默认 | 备注 |
|---|---|---|---|---|
| `notes` | 小记 | `notes_enabled`（新增） | 关 | 缺键按关读 |
| `entries` | 网址收藏 | `entries_enabled`（新增） | 关 | 同上 |
| `files` | 文件快捷 | `files_enabled`（新增） | 关 | 同上 |
| `mfa` | 验证码 | `mfa_enabled` | 关 | 沿用现键 |
| `fileshare` | 局域网传输 | `fileshare_enabled` | 关 | 关闭停监听 |
| `tunnel` | 内网穿透 | `tunnel_enabled` | 关 | 关闭停隧道进程 |
| `bypass` | 直连清单 | `bypass_enabled` | 关 | — |
| `codex` | Codex 账号 | `codex_enabled` | 关 | — |

排序沿用当前侧栏顺序（小记 → 收藏 → 文件 → 验证码 → 局域网 → 穿透 → 直连 → Codex）。

**判据只有一条**（2026-10-16 改定）：八块一律 `raw === 'true'`，库里没写过这个键就没有入口，落地页交给 `/start` 空态。本节最初写的「核心三页缺键按开读」和注册表里的 `defaultEnabled`/`core` 两个字段已随之删除——`!== 'false'` 那半棵留着只会让人以为还有第二档缺省。同一条判据在 `src-tauri/src/web_access/bridge.rs` 的 `require_module` 里另有一份，改判据必须同时改它，否则 Web 侧比桌面侧多开三块。e2e mock 代表的是「三个主页面已被用户打开」的库（`e2e/mocks/backend.ts` 的 settings 缺省），测空态的用例显式写 `'false'`。

### 注册表

`src/modules/registry.ts`（新增）：

```ts
export interface ModuleDef {
  id: string                 // 'notes' | 'tunnel' | ...
  settingKey: string         // 'notes_enabled'，与 Rust 白名单同名
  title: string              // 侧栏文字 + 标题栏面包屑（现 route.meta.title）
  icon: IconName             // 现 AppIcon 的 nav* 键
  navClass: string           // 现 m-not / m-ent …，类名不动以免动 global.css 与 shots 锚点
  order: number
  view: () => Promise<Component>            // 现 router 里的动态 import，原样搬进来
  boot?: () => Promise<void>                // 解锁后要预取的数据（收藏列表 / 侧栏计数所需）
  count?: () => number                       // 侧栏计数位，只有三页有
  onLock?: () => void                        // 锁定时的模块内状态清理（口令明文、搜索态）
  onDisable?: () => Promise<void>            // 关闭时的常驻副作用收口（停监听、停隧道）
  settingsTab?: { id: string; label: string }  // fileshare 的伴生设置页签
}
```

`src/modules/state.ts`（新增）：唯一的 flag 读写口，取代 5 个 `*Feature.ts`。

- `loadModuleFlags()`：一次读全部键（并行），bootstrap 阶段、`app.mount` 之前跑完，首帧的路由/侧栏/设置就都是终态，不留"侧栏闪一下"的中间帧。
- `enabledModules()` / `isModuleEnabled(id)` / `resolveLanding()`：`resolveLanding()` = 启用模块里 order 最小者，全关时返回内置空态页。
- `setModuleEnabled(id, on)`：先落库、成功后才翻内存（保留现有"没落库的入口不出现在侧栏"的回滚语义）；`on` 为 false 时依次跑 `onDisable`；若当前正停在该模块页面上，`router.replace(resolveLanding())`。

### 生命周期时序

```
bootstrap(main.ts)
  ├─ primeAppearance           ← 现状，不动
  └─ loadModuleFlags()         ← 新增，先于挂载
挂载 App
  ├─ addRoute(仅 enabled)      ← 路由由注册表按需注册；禁用的 path 不落进 matcher
  └─ 锁定/解锁
       解锁 → 对每个启用模块跑 boot()
       锁定 → 对每个启用模块跑 onLock()
设置 → 模块页签
  └─ setModuleEnabled → 当场补/撤该模块路由 + onDisable + 重解析落地页
```

路由改为在运行时按 flag 注册，比"注册全部 + 守卫拦截"更贴合"按需加载"：禁用模块的 chunk 连请求都不会发出。守卫仍保留一条兜底（未注册 path → `resolveLanding()`），顺带把现在这条未匹配的 404 空白也收掉。

### 零模块态

`src/views/ModulesEmptyView.vue`（不属于任何模块、不可关）：首次设置主密码后进入 `/start`，沿用原有零模块空态，显示「暂无已启用的模块」及直达设置「模块」页签的「管理模块」按钮，不展示引导列表。侧栏只显示已启用模块，没有额外的添加入口。E2E 中 `initialized: false` 使用新库缺省，其他用例仍使用已添加三个主模块的测试库。

### 设置「模块」页签

- 「通用」页签现有的 5 行开关整块搬到新的「模块」页签（放在「档案」之后），通用只留终端偏好等真·通用项。
- 一行一模块：名称 + 一句功能差异说明 + 28px 档开关；沿用平铺行 + 可见细线分行，不做卡中卡、不做入场动画。
- 核心三页额外挂一句"关闭只隐藏入口，数据与口令保留"；附加模块保留现文案（说明开启后侧栏出现哪一页）。
- `fileshare` 的伴生设置页签继续随开关出现/消失（现状不变）；`codex` 那行下的官方凭据路径 + 「打开 config.toml」跟着搬进「模块」页签对应行内，通用页签不再留任何模块专用内容。

## 落点文件

**新增**
- `src/modules/registry.ts`、`src/modules/state.ts`、`src/modules/README.md`（模块作者要遵守的三条：入口只从注册表出、不得在壳层点名模块、私有状态自己收）
- `src/views/ModulesEmptyView.vue`
- `src/modules/__tests__/state.test.ts`（判据/回滚/落地页/全关四条）

**改造**
- `src/main.ts`：bootstrap 里加 `loadModuleFlags()`
- `src/router/index.ts`：静态 8 条 → 由注册表按需注册 + 兜底守卫；`/` 重定向改为动态
- `src/App.vue`：删 `entries/fileShortcuts/notes` 三个 store 的直接引用（`:6-8`）与 `fetchEntries`/`fetchShortcuts`/`route watch`（`:85-93`）；`doLock` 里的模块专属清理（`:76-80`）改为遍历 `onLock`；`onUnlockComplete`/`onMounted` 改为跑 `boot`
- `src/components/layout/Sidebar.vue`：8 段 `router-link` → `v-for enabledModules()`；5 个 `*Feature` 与 3 个 store 的 import 全删；计数走 `count`（钩子内部取 store）
- `src/components/settings/SettingsDialog.vue`：5 个开关行迁出，加「模块」页签；伴生小依赖（`notesStore.refreshNoteKey`、`loadCodexPaths`）改为随对应模块启用才发请求
- `src-tauri/src/commands/settings.rs:14`、`e2e/mocks/backend.ts:411`：`ALLOWED_KEYS` 各加 `notes_enabled`/`entries_enabled`/`files_enabled`（两处必须同步，漏一处是真机静默 no-op）

**删除**
- `src/services/{mfa,fileshare,tunnel,bypass,codex}Feature.ts` 与对应 4 份 `src/services/__tests__/*Feature.test.ts`（用例并入 `state.test.ts`，fileshare/tunnel 的"关闭必须停服"两条单列保留）

模块自己的页面组件（`MfaModule.vue` 等）里那 5 处 `readXFeature()` 页内自读删掉——flag 已在 bootstrap 读过，页面能挂载就说明是开的。

## 明确不做

- **后端命令裁剪**：Rust 侧 8 组 command 与建表全部维持现状。DB 表全量建，重开模块不需要迁移；invoke 只在模块挂载后才发生。
- **编译期裁剪**：不做 vite feature flag，安装包体积不动。理由：与"用户运行时可配"直接冲突。
- **删除数据**：关闭只隐藏。
- **平台级能力不入开关**：自动锁定、主题、档案、数据与备份、标题栏备份徽标/同步钮、Toast/Confirm——这些是壳不是模块。

## 影响面与回归点

- **e2e**：`navigation.spec.ts` 断言 8 个 nav 项，现在必须有前置把 5 个附加模块的 flag 置 true（mock 已支持 `config.settings` 注入，`e2e/mocks/backend.ts:53`）；`mfa/fileshare/tunnel/bypass/codex` 五个 spec 各自补同一前置。新增：模块页签开关往返、禁用后直访 URL 被弹回、零模块态空页。
- **`notes.spec.ts` 两条「插入芯片」是 HEAD 上就红的存量**（断言先行、实现缺位），本轮不背这个锅也不顺手修。
- **shots**：侧栏满配帧应与改前逐像素一致（类名/顺序/计数都不动）；新增「模块」页签与零模块态两帧。验收前照例先确认所有帧为本次新拍。
- **档案切换会重启应用**（`ProfilesPane.vue:134` 之后 app 重启），所以模块开关天然按档案各存一份、重启后重读——不需要额外同步逻辑，但要在文档里写明"每个档案的模块配置独立"。
- **侧栏样式跨不进子组件**：计数与 nav markup 若拆成新组件，scoped 壳样式会整块失效而 e2e 全绿。本轮不拆组件，`v-for` 留在 `Sidebar.vue` 原 `<style scoped>` 下。
- **落盘 JSON 键名**：新增的三个键在 Rust 白名单与 mock 白名单必须逐字一致（snake_case，与现 5 个键同形）。

## 里程碑（实施后回写）

- **P0 收口开关机制** — 已交付。`registry.ts` + `state.ts` 替换 5 份 `*Feature.ts`，4 份测试并入 `state.test.ts`，两处 `ALLOWED_KEYS` 加键。行为与改前等价。
- **P1 按需挂载 + P2 核心三页可关** — 一并交付。两件事改的是同一批文件（`router/index.ts`、`Sidebar.vue`、`App.vue`、`SettingsDialog.vue`），拆开只会在 P1 里留一个"落地页会指向没注册的路由"的半成品，故合并。
- **P3 测试与走查** — 已交付。
  - 五个附加模块 spec 的开关断言改指「模块」页签（`e2e/helpers.ts` 的 `SETTINGS_TAB` 加 `modules: '模块'`），行名跟注册表标题一致：验证码模块→验证码、局域网文件传输→局域网传输。toast 文案统一成 `${title}已开启` / 关闭 `设置已保存`，`mfa`/`codex` 两条断言同步。
  - 新增 `e2e/specs/modules.spec.ts` 6 条：页签 8 行顺序、关核心页的入口收起与落地页下移、关闭模块不下载视图 chunk（`performance` 资源表里查不到 `TunnelView`）、关掉的核心页解锁时不预取、零模块态落 `/start`、空页按钮直达「模块」页签并开一个即落地。全量 188 passed，只剩 `notes.spec.ts` 那两条存量红。
  - 走查脚本 `scripts/modules-shots.mjs`（5 帧、缺帧即非零退出）。**拍帧时抓到一个真 bug**：`.settings-pane` 是 flex column，直接子项 `.group-content` 被压扁后又被自身 `overflow: hidden` 裁掉——8 行的「模块」页签末两行（直连清单、Codex 账号）在弹窗里根本滚不到。修在 `SettingsDialog.vue`：`.settings-pane > .group-content { flex-shrink: 0 }`，超出交给面板滚。其余页签行数少，改前看不出症状。
  - 满配侧栏帧与 09-30 那批旧帧**不做逐像素比对**：中间隔了 V5.2 换肤轮，比了也是噪声。DOM 侧的等价由 `navigation.spec.ts` 钉住（href 顺序、`.nav-item` 类名、计数徽标）。

实施中与方案有出入的三处，都已在代码里落实：

1. `navClass`（`m-not` / `m-lan` …）不进注册表：这些类名在 v2 色相退役后已无任何样式定义、也无选择器引用，随侧栏 `v-for` 一并删除。
2. 五个模块页各自的"直敲 URL 再拦一道"守卫删掉——路由不注册就进不来，兜底改由 `router` 的 catch-all 统一领回落地页。
3. `fetchShortcuts` 从 `App.vue` 的路由 watch 挪进 `FilesView.vue` 的 `onMounted`；`fetchEntries` 挪进 `entries` 模块的 `boot`。壳层不再引用任何模块 store。

新增的开关入口只有一条：`src/modules/runtime.ts` 的 `toggleModule()`（落库 → 撤/补路由 → 正停在该页时带回落地页），设置页只负责提示与页签收口。


## 拍板记录

- **Q1 零模块态的形状** → 独立空态页 `/start`：`/` 有确定去处，恢复入口显眼。它自己不是模块、没有开关。
- **Q2 「模块」页签的管辖边界** → 只收 8 个页面模块。档案、数据与备份、主题、自动锁定是平台能力，不列行——"关掉备份后云端同步归谁管"还没答案。
- **Q3 关核心页要不要二次确认** → 不弹确认，只 toast，与附加模块手感一致；数据与口令一律保留。
