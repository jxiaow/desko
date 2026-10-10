# 模块自带配置页签（module settings panes）— 现状与方案

日期：2026-10-10　状态：**已拍板**（承接 `01-module-runtime.md`）

已定方向（本轮问答）：删掉「通用」页签、弹窗默认落「外观」；「修改小记口令」跟着小记模块走；只有**带配置项**的模块才在设置左导航里出页签。

## 结论

01 轮把"入口"收进了注册表，但"配置"还散在壳里：设置弹窗点名了三个模块（terminal 行是给文件快捷的、`.codex-path` 是给 Codex 的、`noteKey` 行是给小记的），第四个（局域网传输）干脆在壳里手写了 50 行面板 + 一个 `v-if`。模块有没有配置、配置长什么样，仍然要改 `SettingsDialog.vue` 才能回答。

方案：`ModuleDef` 再加一个可选成员 `settings`（页签名、图标、面板组件的懒加载器）。设置弹窗的左导航由"固定页签 + 按 `MODULES` 顺序插入的已开启模块页签"拼成；面板组件放在 `src/modules/settings/`，关着的模块既不下载面板 chunk、也不跑它的 `load()`。壳层从此不再 import 任何模块 store 或模块 API。

## 现状盘点（实测）

| 配置项 | 现在住在哪 | 属于谁 | 键 / 来源 |
| --- | --- | --- | --- |
| 在终端中打开 | 设置「通用」页 `SettingsDialog.vue:309` | 文件快捷 | `terminal`（`services/terminal.ts`），消费方只有 `FileShortcutsModule.vue:224` |
| 端口 / 仅本机访问 / 访问口令 | 设置「局域网传输」页 `SettingsDialog.vue:349`（整段在壳里） | 局域网传输 | `fileshare_*` 命令，状态经 `services/fileshareSettings.ts` 单例与模块页共享 |
| 官方凭据路径 + 打开 config.toml | 设置「模块」页里 `v-if="m.id === 'codex'"` 的 `.codex-path` 块 `SettingsDialog.vue:335` | Codex 账号 | `get_codex_storage_paths`（只读，本机事实） |
| 修改小记口令 | 设置「安全」页 `SettingsDialog.vue:473`，`v-if="noteKey.is_set"` | 小记 | `notesStore.noteKey`，动作由 App.vue 的 `openChangeNoteKey` 弹窗承接 |
| 主密码 / 自动锁定 / 关窗锁定 / 锁屏锁定 | 设置「安全」页 | 平台 | `auto_lock_timeout` 等 |
| 主题 / 强调色 | 设置「外观」页 | 平台 | `theme` / `accent` |
| 档案、数据与备份、关于 | 各自页签 | 平台 | — |

壳层为这三件事额外背的债：`SettingsDialog.vue` 顶部 import 了 `useNotesStore`、`codexApi`、`fs*` 五件套；`loadSettings()` 里三处 `if (moduleFlags.x)` 逐个点名（`:83`、`:84`、`:85`）；`initialTab` 的类型是 `'general' | 'modules' | 'fileshare'` 硬写死的联合（`App.vue:36`）。

## 目标形态

### 注册表扩一个成员

```ts
export interface ModuleDef {
  // …01 轮已有字段
  /** 有 settings 才在设置左导航出页签；关着的模块连面板 chunk 都不下载 */
  settings?: {
    label: string            // 页签名：'小记' / '文件快捷' / '局域网传输' / 'Codex 账号'
    icon: IconName           // 页签图标，复用侧栏那套 Solar 键
    pane: () => Promise<Component>  // 懒加载配置面板
    load?: () => Promise<void> | void  // 打开弹窗时预热：口令状态 / 凭据路径 / 服务状态
  }
}
```

`load` 由壳在"该模块开启且弹窗打开"时调一次，替代现在 `loadSettings()` 里那三行点名。没有配置的四个模块（网址收藏、验证码、内网穿透、直连清单）不写 `settings`，也就不出页签——它们的设置本来就在各自页面里（穿透的接入准备、直连的探测目标），不造空页。

### 页签集合与顺序

固定页签：`档案 · 模块 · [模块配置页签] · 外观 · 数据与备份 · 安全 · 关于`。模块配置页签按 `MODULES` 顺序插在「模块」之后，即 `小记 → 文件快捷 → 局域网传输 → Codex 账号`（缺哪个是因为哪个关着）。默认落点从 `general` 改 `appearance`。

「通用」页签删除：它唯一的行搬去「文件快捷」后就是空页，留一个空壳比删掉更容易让人误解"还有别的通用项"。

开关只在「模块」页签，配置页签不重复放开关（同一动作不得有两个入口）。

### 面板组件

| 新文件 | 内容 | 从哪搬 |
| --- | --- | --- |
| `src/modules/settings/NotesSettings.vue` | 修改小记口令一行（`noteKey.is_set` 才出现），点它 `emit` 给 App 的弹窗 | 「安全」页那一行 |
| `src/modules/settings/FilesSettings.vue` | 在终端中打开 `OptionSelect` + 保存 | 「通用」页整页 |
| `src/modules/settings/FileshareSettings.vue` | 端口 / 仅本机访问 / 访问口令三行 | 「局域网传输」页整段 |
| `src/modules/settings/CodexSettings.vue` | `authPath`/`configPath` 展示 + 打开 config.toml | 「模块」页的 `.codex-path` 块 |

面板组件自己 `storeToRefs` 取状态、自己保存，样式沿用 `global.css` 的 `.group-content` / `.setting-item` / 28px 控制轴档，不新增皮肤。

`load()` 预热需要组件和壳共用同一份数据：小记口令在 `notesStore.noteKey`、局域网传输在 `services/fileshareSettings.ts`，都是现有单例；Codex 凭据路径需要有个地方给 `load()` 写、给 `CodexSettings.vue` 读。最自然的是扩写已有的 `src/services/codexState.ts`（里面已有账号列表单例），加 `storagePaths` ref 与 `loadStoragePaths()`，不另造新文件。

### 壳层怎么渲染

`SettingsDialog.vue` 保留固定页签的 markup，模块页签与面板由 `v-for` 出：

- 页签 id 直接用 `ModuleId`（与 01 轮 `onToggleModule` 里 `tab.value === id` 的写法对齐），`TabId = 固定页签 | ModuleId`。
- 面板**首次点开才挂**，挂上后用 `v-show` 常驻——这是「局域网传输」页 `number-input` 的既有约束（切页即卸载会吞掉 `@change`），不能退化成 `v-if`。
- 关掉某模块时，若正停在它的页签，回落到「外观」（现在是回落 `general`，那个页签即将不存在）。
- 左导航高度账：640×480 的壳，导航 152px 宽，最坏 6 固定 + 4 模块 = 10 项 ≈ 400px，落在 84vh 内不滚；满配帧要拍一张确认。

## 落点文件

**新增**：`src/modules/settings/{NotesSettings,FilesSettings,FileshareSettings,CodexSettings}.vue`

**改动**：
- `src/modules/registry.ts` — 四个模块加 `settings`；`IconName` 复用现有键。
- `src/components/settings/SettingsDialog.vue` — 删「通用」页与三处点名 import；左导航改"固定 + `v-for` 模块页签"；面板改 `<component :is>` + 首开挂载；`loadSettings` 的模块预热改走 `settings.load`。
- `src/App.vue` — `settingsInitialTab` 类型改引 `TabId`；`'general'` 移除，默认 `'appearance'`。
- `src/views/ModulesEmptyView.vue`、`src/services/fileshareSettings.ts` — 事件 `detail` 不变（`'modules'` / `'fileshare'`），只是页签归属换了主人。
- `e2e/helpers.ts` — `SETTINGS_TAB` 去 `general`、加 `files`/`notes`/`codex`；`openSettings` 默认参数已是 `appearance`，不动。
- `e2e/specs/settings.spec.ts` — 唯一用到 `general` 的断言（`:91` 终端偏好）改指「文件快捷」。

**删除**：设置弹窗的「通用」页签、原 `.fs-*` 与 `.codex-path` scoped 样式（随对应组件迁走）。

## 明确不做

- 不给没有配置的模块造页签。
- 不把模块页内的操作（口令弹窗、服务启停、探测）搬进设置——本轮只搬"设置弹窗里已有的模块专属行"。
- 不改设置弹窗定高 `min(480px, 84vh)` 与 28px 控制轴。
- 不动 `01-module-runtime.md` 已交付的开关语义与落库键。

## 影响面与回归点

- **默认落点变了**：`App.vue:36` 的 `settingsInitialTab` 初值从 `general` 改 `appearance`。e2e 侧影响很小——`openSettings()` 每次都会显式点一个页签，实测全仓只有 `settings.spec.ts:91` 一处以 `general` 为入口（断言终端偏好），改指「文件快捷」即可。
- **小记口令行的位置**：全仓 e2e 现在没有任何「修改小记口令」断言（实测 `grep` 只命中 `SettingsDialog.vue:473`），所以这条搬家不带回归账；反过来，本轮要补一条"开小记 → 页签出现、口令行在里面"的断言，别让搬家变成无人看管。
- **模块配置页签的显隐**：关模块 → 页签当场消失；开模块 → 页签当场出现。这条要 e2e 钉一条往返。
- **shots**：满配 10 页签的左导航帧 + 四个模块配置页签各一帧；跑法照 `scripts/modules-shots.mjs` 的缺帧对账。注意 01 轮抓到的 `.settings-pane > .group-content` 压扁坑——新面板都是"面板直接子项"，`flex-shrink: 0` 那条规则必须留着。

## 里程碑（实施后回写）

- **S1 注册表 + 壳层渲染** — 已完成。
- **S2 四个面板组件搬迁与壳层去点名** — 已完成。
- **S3 e2e 与 shots** — 已完成。
