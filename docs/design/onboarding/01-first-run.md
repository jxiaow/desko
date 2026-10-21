# 01 · 首启两屏：设置主密码 + 模块选择

日期：2026-10-21　状态：**已交付**（2026-10-21 落地；样张在 `.tmp/onboarding-20261021/`）

范围：`src/components/auth/SetupPage.vue`、`src/views/ModulesEmptyView.vue`（桌面分支）、`src/App.vue` 的标题栏态、`src/modules/registry.ts`、`src/modules/runtime.ts`。解锁页与工作区骨架不动。

取代：`docs/design/modules/01-module-runtime.md` 的「零模块态」段中「首次设置主密码后进入 `/start`，沿用原有零模块空态……不展示引导列表」这一条。模块运行时的其余决策（八块默认关、按需挂载、关闭保留数据）不变。

## 一、问题

### 1.1 设置主密码页是 auth 家族里的异类（实测）

- `SetupPage.vue:34` 是一张 400px 实心卡片：`--radius-lg` + `--shadow-lg` + 1px 边框，里面 56px 大 logo、20px/700 标题、通栏 accent 按钮。解锁页却是光场 + 衬线题词 + 300px 窄栈（`UnlockPage.vue:109`），同一段 auth 流程前后换了一套视觉系统。
- 主按钮 hover 上浮 `translateY(-1px)` 并加 `--shadow-md`（`SetupPage.vue:141`）。auth 家族其他控件都没有位移反馈，操作像网页表单而不像工作台。
- 输入框没有显隐开关，高度靠 12px padding 撑，和锁页 40px 定高字段对不上。
- 错误信息按内容占位（`SetupPage.vue:55`），报错时整块下推，输入焦点跟着跳。
- `App.vue:258` 只在 `appState === 'locked'` 时给标题栏 `is-locked`，所以设置主密码时标题栏显示「首页」面包屑 + 设置齿轮 + 锁定按钮——此时工作区、设置对象和可锁定的会话都还不存在。

### 1.2 零模块落地页看起来像出错，不像开始（实测）

- 八块模块一律默认关（`src/modules/state.ts:10`），所以每个新用户设完主密码都会落到 `/start`。当前页面是通用的空态：齿轮图标 +「暂无已启用的模块」+「管理模块」（`ModulesEmptyView.vue:16-21`）。
- 用户此刻还没见过模块名称、图标和用途；模块列表藏在设置弹窗第二个页签里，要两步才能看到。
- 文案「在设置中启用模块后，即可开始使用」把选择推给了设置，而不是让用户当场完成选择。
- `docs/design/modules/01-module-runtime.md:97` 当时明确决定「不展示引导列表」。本轮改判：首次运行需要一屏选择器，且它同时承担以后的零模块落地页。

## 二、设置主密码：并入 auth 语言

### 2.1 方向

设置主密码是 auth 流程的第一屏，之后用户长期只看解锁页。两屏必须共用同一套底、同一套题词和同一个 300px 窄栈，不引入第二个 auth 版式。设置页不轮换题词、不加逐字动画：一次性动作只需要安静。

### 2.2 版式

```
                 慢慢来，比较快
                    [ 徽标 ]
                 欢迎使用 Desko
        [ 🔒  主密码（至少 6 位）        👁 ]
        [ 🔒  再次输入主密码       👁   → ]
                    （20px 错误槽）
        加密保存全部数据，遗忘后无法找回。
```

题词与 300px 栈之间保持锁页的 34px 间距；栈内徽标、标题、字段、说明自上而下居中。

### 2.3 规格

| 元素 | 规格 | 来源 |
| --- | --- | --- |
| 页面底 | `<AmbientBackground />` + `background: var(--bg-lock)`，`position: relative; overflow: hidden` | 与 `UnlockPage.vue:109` 完全同源，不新增图片/令牌 |
| 画布 | `.setup-canvas`：`flex: 1` 居中，`z-index: 10` | 抄锁页 `.unlock-canvas` |
| 题词 | 宋体栈，`clamp(22px, 3vw, 32px)` / 600，字距 `.22em`，静态一行「慢慢来，比较快」 | 锁页题词规格；不建定时器、不拆字符 |
| 徽标座 | 52px，圆角 14，`--bg-surface` + `--border` + `--shadow-xs`，logo 38px | 抄 `.lock-tile` |
| 标题 | 16px / 600，下距 22px，「欢迎使用 Desko」 | 抄 `.lock-title` |
| 字段 | 40px 定高，`--radius`(10px)，`--bg-surface`，1px `--border`；左图标 left 10 / 16px | 抄 `.unlock-field` |
| 输入内距 | `0 62px 0 36px`；两个字段都留 62px，第二只眼的横向位置与第一只对齐 | 第一字段虽无提交箭头，仍保留同一右内距，文字不会钻到眼睛下面 |
| 显隐 | 26px 透明按钮，right 33；`--text-muted` → hover `--text`；藏 `::-ms-reveal/::-ms-clear` | 抄 `.reveal-btn` |
| 提交 | 第二字段内 26px accent 方块箭头，right 5；`--radius-sm`，13px 箭头 | 抄 `.unlock-btn` |
| 焦点 | 边框换 `--accent` + `0 0 0 3px color-mix(in srgb, var(--accent) 8%, transparent)`；图标随 `:focus-within` 变 accent | 抄锁页，禁止加粗 ring |
| 错误槽 | 20px 定高，`--text-xs` / `--danger`，只切透明度；`aria-live="polite"` | 抄 `.unlock-error-slot`，报错零位移 |
| 说明 | 300px 宽居中，12px / 1.6 `--text-muted`，上距 10px；一行放得下「加密保存全部数据，遗忘后无法找回。」 | 新文案，替代原两行 tip |

字段间 10px；密码规则、错误文案与校验顺序全部沿用现有逻辑（少于 6 位 → 两次不一致 → 调用 `setupMasterPassword`），不新增强度条或规则提示。

### 2.4 状态与键盘

- 两个字段各自独立显隐，互不牵连；按钮带 `aria-label`/`title`（显示密码 / 隐藏密码）。
- `autofocus` 第一字段；两字段 `autocomplete="new-password"`；表单内回车提交。
- 提交期间箭头 `disabled`，防止重复建库；失败信息进固定错误槽，输入时即清空。
- 无入场动画、无错误抖动；只有错误槽的透明度过渡。

### 2.5 标题栏

`App.vue:258` 改为：

```vue
<TitleBar v-if="appState !== 'unlocked'" is-locked ... />
```

`v-if` 已保证进入该分支时不是解锁态，所以直接写静态 `is-locked`；设置页复用锁定态标题栏：36px 浮层、透明底、只有窗口控制键，不显示面包屑/设置/锁定。`app-root.locked-bg` 仍只给锁定态；设置页自己铺 `--bg-lock` 和光场。

## 三、首个模块选择页

### 3.1 方向

桌面版 `/start` 从「空态 + 去设置」改成「模块选择器」：标题下直接给出八块模块的图标、名称和一句差异说明，点选即启用，侧栏当场出现入口。Web 运行时保留原空态不变。

Web 不回退的原因：Web 侧模块开关来自服务端已启用的集合，且局域网传输、内网穿透等动作依赖桌面进程；在浏览器里放一组「点选即启用」的卡片会误导用户以为能在这里开服务。桌面首启才是这个选择器的对象。

### 3.2 版式

```
从这里开始
选择要启用的模块
启用的模块会出现在侧栏；之后可随时在设置中调整。

[小记 ✓] [网址收藏 ✓] [文件快捷 ✓] [验证码  ]
[局域网传输] [内网穿透] [网络直连] [Codex  ]

已启用 3 个模块                              进入工作台 →
```

页眉、网格、底栏都住在 `.content-inner.onb-page`：上内距 40px，下内距沿用 22px；内层 `flex: 1` 纵向排布，底栏 `margin-top: auto` 贴住内容区底部。模块页头（`usePageHeadStore().setHead('')`）继续保持为空，不叠加第二个标题。

### 3.3 规格

| 元素 | 规格 |
| --- | --- |
| 眉题 | 12px / 1.5 `--text-muted`，下距 8px，「从这里开始」 |
| 标题 | 22px / 600，字距 `-0.02em`，行高 1.35，「选择要启用的模块」 |
| 引导句 | 13px / 1.6 `--text-secondary`，上距 8px，下距 26px |
| 网格 | `grid-template-columns: repeat(auto-fill, minmax(196px, 1fr))`，间距 12px；1040px 窗宽下为 4 列 × 2 行 |
| 卡面 | 最小高 126px，内距 14px，圆角 12px，`--border-card` + `--bg-surface`；hover 只换 `--border-card-hover` |
| 选中卡 | 边框 `color-mix(in srgb, var(--accent) 40%, var(--border))`；底 `color-mix(in srgb, var(--accent) 5%, var(--bg-surface))` |
| 图标座 | 34px，圆角 10，`--sunken` + `--text-secondary`；图标 20px |
| 选中图标 | 底 `color-mix(in srgb, var(--accent) 12%, var(--bg-surface))`，色 `--text-brand` |
| 勾选框 | 17px 圆角方块（6px），1px `--border-strong`；选中实心 `--accent` + `--accent-on` 的 12px 勾 |
| 模块名 | 13px / 600，行高 1.4 |
| 一句说明 | 12px / 1.65 `--text-muted`，单行 `nowrap` + 省略号 |
| 底栏 | 上距 22px；左计数 12px `--text-muted`；右 `.btn-primary` 36px，箭头 13px |
| 动效 | 只有边框/底色 `var(--transition)`；无入场、无 stagger、无卡片浮起 |

勾选框用方块而不是圆点，避免被读成单选；每张卡是 `<button aria-pressed>`，网格是 `role="group"`，计数用 `aria-live="polite"`。

### 3.4 交互

- **点卡即写库**：复用 `toggleModule(id, on)`，不设「保存」步；`moduleFlags` 是响应式的，侧栏图标、计数和卡的选中态同帧变化。
- **写库期间**：同一张卡忽略重复点击；失败时 `setModuleEnabled` 已把 flag 扳回，卡面自动还原，toast 报「开启失败: …」，成功不弹 toast（卡面和侧栏就是反馈）。
- **底栏**：0 个时左「点击模块开始启用」、右「进入工作台」禁用；≥1 个时左「已启用 n 个模块」、右可点。CTA 只做一件事：`router.replace(landingPath() ?? EMPTY_PATH)`。
- **停留**：选择器打开期间，启用模块**不自动跳走**。否则点第一张卡就会被带去模块页，回不到选择器。实现见 4.2 的 landing hold。
- **与设置共存**：从标题栏齿轮进「模块」页签开/关，关闭弹窗后仍停在选择器，卡面与侧栏已同步；要进入工作台可以点 CTA，也可以直接点侧栏图标。这改变了旧空态「设置里开一个就自动落地」的行为，只发生在 `/start`。
- **零选择**：允许全部不选，留在选择器，不弹确认；没有可跳转的页面，所以 CTA 禁用而不是隐藏。
- Web 运行时：不挂选择器、不设 landing hold，原「管理模块」空态与自动落地语义原样保留。

### 3.5 文案

八张卡沿用注册表顺序（即侧栏顺序），新增 `brief` 一句版；设置页继续用现有更长的 `desc`，两者不互相替代。

| id | 标题 | 卡面 brief | 设置页 desc（不动） |
| --- | --- | --- | --- |
| notes | 小记 | 文本与图片，可单独上口令 | 随手记文本与图片，可给单条上口令 |
| entries | 网址收藏 | 网址与账号口令，按标签分组 | 网址与随行的账号口令，按标签分组 |
| files | 文件快捷 | 文件与目录，一键打开或进终端 | 本机文件与目录的快捷入口，一键打开或进终端 |
| mfa | 验证码 | 管理 TOTP 动态码 | 管理 TOTP 动态码 |
| fileshare | 局域网传输 | 同网段设备用浏览器互传 | 同网段设备用浏览器互传文件 |
| tunnel | 内网穿透 | 本机服务经隧道暴露到公网 | 把本机服务经 Cloudflare 隧道暴露到公网 |
| bypass | 网络直连 | 探测域名与网段，配置直连 | 探测域名、IPv4 地址和网段，配置本机 hosts 与直连路由 |
| codex | Codex | 管理多个账号并切换官方凭据 | 管理多个 Codex 账号并切换官方凭据 |

`brief` 在 1040px 默认窗宽下八条都完整单行；窗口收到最小 800px 时仍为三列、单行放得下。再窄由省略号兜底，完整说明始终能在设置里读到。

## 四、实现落点

### 4.1 文件

| 文件 | 改动 |
| --- | --- |
| `src/components/auth/SetupPage.vue` | 模板与 scoped 样式按 2.2/2.3 重写；新增两个显隐 ref 与提交忙碌态；校验与 emit 不变 |
| `src/App.vue:258` | 标题栏在解锁前固定 `is-locked`（`v-if` 已排除解锁态），设置页共用锁定态标题栏 |
| `src/views/ModulesEmptyView.vue` | 桌面分支渲染选择器（页眉/网格/底栏）；Web 分支保留现空态；桌面挂载时开 landing hold、卸载时复位 |
| `src/modules/registry.ts` | `ModuleDef` 增 `brief: string`，八条补齐；`desc` 保持原样 |
| `src/modules/runtime.ts` | 新增 landing hold，并在 `toggleModule` 与 `desko:module-changed` 监听器两处统一判断 |
| `e2e/pages/auth-page.ts` | setup 选择器换成 `.setup-page` / `.setup-input` / `.setup-submit` / `.setup-error` |
| `e2e/specs/auth.spec.ts` | 只改选择器与「错误槽始终在 DOM」相关断言，校验文案不变 |
| `e2e/specs/modules.spec.ts` | 重写三条零模块用例，并补最小窗口 / 八块全选 / CTA 顺序一条（见 5.1） |
| `e2e/specs/web-access.spec.ts` | 不改：Web 仍走旧空态 |
| `docs/design/modules/01-module-runtime.md:97` | 零模块态一段改为指向本文；其余不动 |
| `scripts/modules-shots.mjs` | 第 3 帧仍叫 `3-empty-modules`，内容变为选择器；`EXPECTED` 不改。顺带修掉工作区布局下失效的侧栏展开点击与 `Codex 账号` 旧页签名 |

### 4.2 landing hold 为什么不能只加一个 `stay` 参数

桌面 `set_setting` 写完 `*_enabled` 会发 `desko:module-changed`（`src-tauri/src/commands/settings.rs:7`），`startModuleSync` 的监听器在下一个任务里也会执行「在 `/start` 上启用 → 跳落地页」。给 `toggleModule` 加一次性的 `stay` 参数只挡得住同步调用，挡不住随后到达的事件，页面还是会被带走。

用页面生命周期持有的开关：

```ts
let landingHeld = false
export function holdModuleLanding(hold: boolean): void {
  landingHeld = hold
}

const shouldAutoLand = (enabled: boolean, currentPath: string) =>
  enabled && currentPath === EMPTY_PATH && !landingHeld
```

- `toggleModule` 与事件监听器都改用 `shouldAutoLand(...)` 决定是否 `router.replace`。
- hold 只抑制「在 `/start` 上启用后自动落地」；关闭当前模块时的离开逻辑不变，避免把用户留在已撤路由的页面上。
- 只有桌面 `ModulesEmptyView` 在 `onMounted` 开、`onUnmounted` 复位；CTA 显式跳转后随着卸载自动解除。

### 4.3 组件边界

选择器直接写在 `ModulesEmptyView.vue` 里，不抽新组件、不抽共享 auth 组件：它只服务这一条路由，卡片的数据源就是 `MODULES`，抽出去只会多一层 props。`brief` 是注册表元数据，属于模块自身，放注册表。

## 五、测试与产物

### 5.1 e2e 改写

- `modules.spec`「首次设置后不预置模块」：设密后断言 `.onb-page` 可见、八张 `.module-tile`、CTA 禁用；点「小记」后 URL 仍为 `/start`、侧栏出现 1 个入口、按钮文案变「已启用 1 个模块」；点 CTA 后落在 `/notes`，`notes_enabled === 'true'`，其余键仍未写入。
- 零模块直达：`bootUnlocked(page, OFF, '/entries')` 后仍在 `/start`，断言选择器标题、八张卡、0 个导航项；不再断言 `.empty-title`/「管理模块」（桌面没有这两个东西了）。
- 「开一个就落地」改为「选择器 ↔ 设置同步」：从标题栏齿轮进「模块」页签开「小记」，关弹窗后仍停留在选择器、卡面已选中；点 CTA 才进 `/notes`。这条同时守住 landing hold 不被事件监听器击穿。
- 最小窗口 + 八块全选：800×600 下滚到底栏，逐张卡启用后断言「已启用 8 个模块」、侧栏 8 个入口，CTA 仍落到注册表最前的小记（`/notes`）。
- `auth.spec`：设密页仍走 `<6 位` → `两次不一致` → 成功；只换 locator。
- Web 零模块用例保持原样，验证 Web 分支没有跟着改。

### 5.2 截图

- `scripts/modules-shots.mjs` 第 3 帧改为选择器；脚本已在工作区布局下跑通（14 帧全部本次新拍，0/2 帧拍恒为 rail 的侧栏）。0 选中纸/墨由临时对拍覆盖（`.tmp/onboarding-20261021/`，不入仓）。
- 验收前按 `project-shots-stale-frame-guard` 先删旧 PNG、跑后逐名核对，确认第 3 帧是本次新拍。

## 六、验收

- 设置页：纸/墨两主题下，与解锁页并排看是同一套底、题词和窄栈；标题栏只剩窗口控制键；无面包屑、齿轮、锁定。
- 设置页：错误槽出现时字段和说明不位移；Enter 可提交；两只眼睛各自独立；提交中箭头不可重复点。
- 选择页：1040×670 下 4×2，八条 brief 完整单行，底栏贴底；纸/墨的选中态都能一眼分辨。
- 选择页：0/3/8 三种选中数，侧栏图标数、计数文案、CTA 可用态始终一致；点卡不跳页、无闪跳；CTA 落到顺序最前的已启用模块。
- 选择页：800×600 最小窗口下三列、可纵向滚动，底栏仍可到达；无入场动画。
- Web：零模块页与「管理模块」流程保持原样。

## 七、不做

- 不做多步向导、欢迎页、跳过按钮；选择器只有一屏。
- 不预选任何模块，八块仍默认关；用户不选就留在选择器。
- 不改密码规则、不加强度条、不改 setup 的后端调用。
- 不新增插图、背景图或令牌；光场、徽标、图标全部复用现有资产。
- 不改解锁页的题词轮换、逐字错峰或错误抖动。
- 不改 Web 零模块空态，也不让 Web 挂 landing hold。
- 不重排模块顺序：选择器、设置行、侧栏统一用注册表顺序。
- 不抽 `ModuleCard`、`AuthMasthead` 等新组件；本轮只有两处使用点，抽出去只会增加传参。
