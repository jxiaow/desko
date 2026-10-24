# 23 · Codex 桌面挂件：行为重设计（2026-10-23，已拍板）

一句话方案：**撤掉「整窗跟位」的桌面巡游，角色钉在用户放下的锚点上，由一个低频行为导演轮播每只皮肤自己的招牌动作；点角色除钉住外再表演下一手，告警动作保留。** 呼吸、眨眼、耳摆等微动不变，窗口尺寸、面板、数据口径全部不动。右键菜单同时从 WebView2 浏览器菜单换成挂件自己的原生菜单。

状态：**已拍板**（2026-10-23）。行为方向、点角色语义、设置改名、新增 4 条动作、右键原生菜单五项均通过。先出真 token 动态 mock 做视觉确认，再改码。

## 1. 结论：不是调参问题，是机制问题

### 1.1 现在的走法 = 滑一步 → 回弹一帧 → 停一下

| 证据 | 位置 | 后果 |
|---|---|---|
| 单步 6 / 4 / 3px，角色宽 112px | `CodexHudApp.vue:57-61` | 一步只有身体宽的 5.4% / 3.6% / 2.7%，视觉上是抖动，不是迈步 |
| 整只角色用 `.walk` 一起平移，只把一只爪子抬 1.2px | `CodexHudSprite.vue:422-446` | 没有「一只脚踩地、身体越过它」的交替支撑，任何参数下都像滑行 |
| `endStride()` 在 `setPosition` 的 Promise 之前就把 lane 归零 | `CodexHudApp.vue:296-314` | 窗口移动是异步的，必然出现「角色先回弹、窗口后追上」的帧；Windows 小透明窗被 DWM 节流时更明显 |
| 每次跟位触发的 `Moved` 都走 `markDragging()` | `CodexHudApp.vue:510-525` | 每拍进入 150ms 拖动态，和 hover / 展开的时序打架 |
| 走到绳头先压扁转身，转身完直接 `beginBeat()` | `CodexHudApp.vue:343-353` | 绕过 `afterHold()`，招牌动作的计数器根本不递减 |

### 1.2 招牌动作被绑在走路节拍上，所以只剩告警可见

- 唯一递减 `beatsToMove` 的地方是 `afterHold()`（`CodexHudApp.vue:317-341`），而它只在正常迈步后经过。
- 默认右下角锚点下，±48px 的绳长整段伸出屏外，几乎每拍都被 Rust 夹回、走 `beginTurn()`；转身又不经过 `afterHold()`。20 号文档 §6 已记账：45s 采样一次招牌动作都没放。
- 关掉「桌面走动」、系统减少动效、或者指针停在角色上时，节拍根本不跑；能留下来的只有 `applyPayload()` 里的告警动作（`CodexHudApp.vue:180-181`）。
- 所以「招牌动作只在警告专用」不是动作写少了，是**动作调度寄生在一个失败的运动机制上**。

### 1.3 结论

位移与表演是两件事。继续调 stride、glide、曲线，只是在失败机制里换参数。新方案保留动作语法（跳、摇摆、伸缩、打盹），把承载它们的舞台从「整个桌面」换回「角色脚下这一点」。

## 2. 新行为模型

### 2.1 三层

| 层 | 何时 | 内容 | 与现状 |
|---|---|---|---|
| 常驻微动 | 一直 | 呼吸 / 摇摆、眨眼、耳摆 / 触角摆、耳抽动 | 不动 |
| 生活场景 | 没人管它时，每 7–14s | 招牌动作轮播 + 定期打盹 | 新增；取代走路节拍 |
| 事件回应 | 用户或数据触发 | 悬停展开小跳、点角色、告警动作 | 小跳与告警不动，点角色改 |

### 2.2 行为导演

- **锚点固定**：生活场景期间不调 `setPosition`，窗口屏幕位置除了用户拖动永不变化。用户放下的点就是它永远在的点。
- **时序**：`reveal` 后 3s 先表演一手（hello）；之后按 `[7, 11, 8, 14, 10]s` 的固定间隔轮转；每第 5 个场景换成打盹（`doze` 3.2s），打盹后安静 18s。
- **不掷骰子**：间隔、动作池、打盹插入点全部用计数器轮转，第几秒放哪一手能数出来，单测才断言得动。
- **闸门**：展开中、钉住中、指针在窗内、按下未起、正在拖动、减少动效、设置关闭、窗口未 reveal —— 不排新场景。场景进行中被打断时不强行掐断（最长 3.2s），但点角色和告警可以打断。
- **计数器在 reveal 重置**：解锁重亮相、重开挂件、换皮肤都从第一手开始，不补演。
- **窗口隐藏不排程**：`document.visibilityState === 'hidden'` 或未 reveal 时清掉场景计时器，省掉锁屏期间的无效计时。

```
reveal ─3s─▶ hello(1手) ─7~14s─▶ 场景 ─7~14s─▶ 场景 … 第5场=打盹(3.2s) ─18s─▶ …
                                    └─ 有人在看 / 减少动效 / 设置关 → 停排程，指针离开后按下一档间隔恢复
```

### 2.3 动作库存

现有 6 条全部保留；新增 4 条（`hop` / `waddle` / `peek` / `doze`），总表仍以 `src/utils/codexHud.ts` 为唯一时长源。

| 动作 | 皮肤 | 时长 | 动的层 | 画面 |
|---|---|---|---|---|
| `bow` 鞠躬 | 兔 | 1150ms | `.mv-fig` `.mv-head` `.mug` `.mv-ear-*` | 现有 |
| `fold` 卷耳朵 | 兔 | 1350ms | `.mv-fig` `.mv-ear-*` | 现有 |
| `flap` 摆翅膀 | 企鹅 | 1600ms | `.mv-fig` `.flip-*` | 现有，放慢为两拍；每拍约 350ms，落翅停一下再收 |
| `stretch` 伸脖子 | 蜗牛 | 1600ms | `.mv-body` `.stalk-*` | 现有 |
| `tangle` 触角打结 | 蜗牛 | 1400ms | `.mv-body` `.stalk-*` | 现有 |
| `tuck` 缩壳 | 蜗牛 | 1900ms | `.mv-body` `.mv-shell` `.stalk-*` | 头颈连同触角缩到壳后（身体缩到 .84/.88 并左移 10px），壳向右下压合 2px 盖住脸，停 0.9s 再回弹 |
| `hop` 原地蹦 | 兔 | 1400ms | `.mv-fig` `.mv-head` `.mug` `.mv-ear-*` `.paw-a/b` | 压身停一拍 → 弹起 3px（耳尖离窗沿仍留 1.6px）→ 空中悬一拍 → 落地沉一下再回弹；爪离地收起 2.6px，耳滞后 3.4px 下坠以避免耳尖顶出窗沿 |
| `waddle` 原地摇摆步 | 企鹅 | 1800ms | `.mv-fig` `.foot-a/b` `.flip-*` | 左右倒 3 次，双脚交替抬，鳍反相配平；把原来走路里的步态语法留下，但不搬窗口 |
| `peek` 侧身探头 | 企鹅 | 1600ms | `.mv-fig` `.eyes` `.flip-r` | 身体侧倾 6°、眼珠侧移 1px，停一拍再回正 |
| `doze` 打盹 | 三款 | 3200ms | `.mv-fig` `.mv-head` `.mug` `.eyes` `.mv-ear-*` / `.antennae` `.flip-*` | 闭眼、头身下沉；兔耳垂、蜗牛触角收、企鹅鳍落；停 2.4s 后苏醒回弹 |

动作池：

| 皮肤 | 生活场景池（轮转） | 点角色池 | 告警 |
|---|---|---|---|
| 兔 | `bow` → `hop` → `fold` | 同左 | `fold` |
| 企鹅 | `waddle` → `flap` → `peek` | 同左 | `flap` |
| 蜗牛 | `stretch` → `tangle` → `tuck` | 同左 | `tuck` |

- `doze` 不进生活池，由导演每第 5 个场景插入；它是「生活」，不是招牌。
- 告警动作与生活池共用同一条动作，不再独占；告警的语义由 `!`、状态文案和触发时机承担，不靠动作排他。
- 动作时长继续用 `HUD_MOVE_MS` 单点定义，CSS 的 `--mv-dur` 与 JS 收尾同源。

### 2.4 点角色 = 钉住 + 表演下一手

- 现在点角色只眨一下；新行为下点击先切钉住，再让该皮肤轮转池前进一手（`bow` → `hop` → `fold` …）。点一下有回应，也把 6 条招牌动作变成可主动看到的。
- 打盹时点它会取消打盹、立刻演下一手。
- 悬停展开的小跳 `hud-hop` 保持不动；点面板打开 Codex、拖动、双击无额外动作全部照旧。
- 可访问名称同步改成「点击角色钉住并看下一个动作」。

### 2.5 设置

- 「桌面走动」整行换成「桌面小动作」，默认开，键 `codex_hud_ambient`；旧的 `codex_hud_walk` 不再读取，从 `ALLOWED_KEYS` 移除（库里旧值留着无害）。
- 关闭后：不排生活场景、不打盹；呼吸/眨眼/耳摆照旧；点角色仍会演下一手（这是用户主动触发，不属于「小动作」自治）。
- 描述文案：`角色会不时做一个自己的小动作；鼠标靠近或展开面板时保持安静。点角色可钉住并让它表演下一手。`
- 三张皮肤预览仍只传 `idle`，不伪装成可交互；预览不播生活场景。

### 2.6 减少动效

- `prefers-reduced-motion: reduce`：生活场景、点角色动作、告警动作全部不放（JS 侧不挂 `mv-*`）；常驻微动 CSS 收掉；悬停、钉住、打开 Codex、拖动照旧。
- 打盹属于动作，也归零；角色静止，不出现「闭眼睡着但不呼吸」的半截状态。

### 2.7 不动的部分

- 窗口 136×74 / 展开 136×144、四边 4px 透明内边距、角色 112×66、面板尺寸与字号全部不变。
- 悬停 160ms 展开、移开收起、点角色钉住、点面板打开 Codex、拖动 4px 阈值与位置落盘不变。
- 告警状态（`!`、`额度偏低/已用尽/刷新失败`）、空态虚线轮廓、主题跟随不变。
- Rust 侧 `Moved` 夹回工作区保留（用户拖动仍需要）；生活场景不再产生 `Moved`，`expectedMove` 认领令牌、绳长、掉头、冷却全部删除。

### 2.8 右键菜单换成挂件原生菜单

现状没有自定义右键：右键弹出的是 WebView2 默认浏览器菜单（刷新、另存为、打印、检查……），对一枚桌面挂件既无用又出戏。改成自绘原生菜单，只有两项：

| 菜单项 | 动作 |
|---|---|
| 挂件设置… | 显示并聚焦主窗口，打开设置弹窗的 `codex` 页签（挂件组在那一页） |
| 隐藏挂件 | 与 Alt+F4 同一条收口：隐藏窗口 → `codex-hud:request-close` → 主窗口把 `codex_hud_enabled` 置 false 并销毁窗口 |

- **不重复已有动作**：左键点角色已是「钉住」、点面板已是「打开 Codex」，菜单不放这两项；只收低频且没有可见入口的两件事（设置、隐藏）。
- 前端根节点 `@contextmenu.prevent` 后 `invoke('desko_hud_context_menu')`；菜单由 Rust `MenuItem` + `Menu::popup` 在光标处弹出，`WebviewWindow::on_menu_event` 路由两个 ID。
- `hud-settings` 用新事件 `codex-hud:open-settings` 交给主窗口；`App.vue` 收到后 `settingsInitialTab='codex'`、`showSettings=true`，不切路由。
- `hud-hide` 复用既有 `codex-hud:request-close`，开关真相仍只有 `codex_hud_enabled` 一份；菜单不直接改窗口可见性。
- 建窗时顺手 `SetAreDefaultContextMenusEnabled(false)`，把 WebView2 自带菜单彻底关掉，不依赖页面事件是否被吞。
- 右键不展开面板、不钉住、不触发角色动作；菜单弹出期间指针离开窗口按既有规则收起（菜单是系统层，不占页面指针）。

## 3. 为什么不继续修走路

| 机制 | 能做到什么 | 为什么不做 |
|---|---|---|
| 窗内滑 + 整窗跟位（现状） | 屏幕坐标连续，但依赖异步 `setPosition` | 必露回弹帧；透明小窗被 DWM 节流时更抖；没有支撑脚，滑行感改不掉 |
| 60fps 连续移动窗口 | 真位移、无窗内滑 | CPU 常驻开销、跨屏/DPI 抖动、丢帧；为一枚额度挂件不值得 |
| 加大窗口 + 点击穿透舞台 | 角色可在窗内用纯 CSS 走，视觉最好 | 需要 Win32 命中区（`SetWindowRgn`）或全局光标轮询 + `set_ignore_cursor_events`，还要处理面板、拖动、DPI、多屏；风险与维护成本高，本轮不做 |

**本轮选择：把「走」从空间位移改成原地演出**。兔子的蹦、企鹅的摇摆步、蜗牛的伸缩都保留，只是不再搬窗口。若后续仍坚持真空间位移，唯一诚实的路径是第三条「舞台窗」，应单开一轮，不混在这次行为重设计里。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `src/utils/codexHud.ts` | `CodexHudMove` 加 `hop` / `waddle` / `peek` / `doze`；`HUD_MOVE_MS` 加 4 条；`HUD_IDLE_MOVES` 换成生活池（兔 `bow/hop/fold`、企鹅 `waddle/flap/peek`、蜗牛 `stretch/tangle/tuck`）；新增 `HUD_DOZE_MOVE`、`HUD_SCENE_GAPS_MS`、`HUD_FIRST_SCENE_MS`、`HUD_DOZE_GAP_MS`；`HUD_ALERT_MOVES` 不动 |
| `src/components/codex/hud/CodexHudSprite.vue` | 新增 `mv-hop` / `mv-waddle` / `mv-peek` / `mv-doze` 的触发规则与 keyframes；打盹时 `.eyes` 用更高特异性的动作规则盖住眨眼；reduce 段补新动作；删 `lift` / `gait` / `gait-ms` props 与 `gait-*` / `lift-*` / `.paw` 过渡规则（不再有巡游） |
| `src/components/codex/hud/CodexHudApp.vue` | 删除整套巡游（`WALK_*`、`walkPose`、`walkLift`、`walkGait`、`walkOffset`、`walkDir`、`leashPx`、`canWalk`、`beginBeat` / `endStride` / `afterHold` / `beginTurn` / `takeIdleMove` / `settleWalk` / `parkAtAnchor` / `claimWalkMove` / `expectedMove`）；新增场景导演（`sceneTimer`、`gapTurn`、`moveTurn`、`sceneCount`、`scheduleScene`、`playScene`、`resetDirector`）；`onMoved` 不再区分巡游与拖动，只走拖动 + 防抖落盘；点角色改为钉住 + 播下一手；删除 `.walk` 外壳与 `characterStyle`；根节点加 `@contextmenu.prevent` → `desko_hud_context_menu` |
| `src/services/codexHud.ts` | 键改 `codex_hud_ambient`，`hudWalk` → `hudAmbient`，`saveHudWalk` → `saveHudAmbient`；payload 的 `walk` → `ambient`；`watch` 列表同步 |
| `src/modules/settings/CodexSettings.vue` | 「桌面走动」行换成「桌面小动作」；开关变量、保存函数、描述文案同步；皮肤预览不动 |
| `src-tauri/src/commands/hud.rs` | 窗口生命周期不变；巡游相关注释与 `expectedMove` 说明删除；`Moved` 夹回保留；新增 `desko_hud_context_menu`（原生菜单两项 + `popup_menu`）、窗口级 `on_menu_event`（`hud-settings` / `hud-hide`）、建窗时关掉 WebView2 默认右键菜单 |
| `src/App.vue` | 新增 `codex-hud:open-settings` 监听：`settingsInitialTab='codex'` + `showSettings=true` |
| `src-tauri/src/commands/settings.rs` | `ALLOWED_KEYS` 删 `codex_hud_walk`、加 `codex_hud_ambient` |
| `src-tauri/capabilities/hud.json` | 删 `core:window:allow-set-position`（生活场景不再调；拖动走 `startDragging`，Rust 夹回在 Rust 侧） |
| `src/components/codex/hud/CodexHudApp.test.ts` | 删巡游用例（步长、绳长、掉头、跟位、送达锚点、冷却）；加场景导演用例（首场景 3s、间隔轮转、打盹插入、暂停闸门、点角色轮转、告警优先级、reveal 重置、reduce、设置关闭、全程不调 `setPosition`）；右键调用命令、不展开不钉住 |
| `CodexHudSprite.test.ts` | 4 条新动作的 class / 时长 / 层集合；打盹盖住眨眼；reduce 收口；删 gait / lift 断言 |
| `src/utils/codexHud.test.ts` | 新动作表、场景间隔、生活池轮转 |
| `src/services/codexHud.test.ts` | `codex_hud_ambient` 读写与回滚 |
| `e2e/specs/codex-hud-settings.spec.ts` | 「桌面小动作」标签、持久化、读回；`codex_hud_walk` 不再出现 |
| `docs/design/codex/20-quota-hud.md` | 顶部加一行：巡游与步态已被 23 号文档替代；§6 的「屏缘绳长待拍板」标为作废 |

## 5. 测试与验收

1. `vue-tsc --noEmit` 0 error；`vitest run` 全绿。
2. 单测：
   - 3s 后第一手；之后按 `[7,11,8,14,10]s` 与生活池轮转，断言第几秒放哪一手。
   - 第 5 个场景是 `doze`，结束后间隔 18s。
   - 悬停 / 展开 / 钉住 / 拖动 / reduce / 设置关闭时不排新场景；指针离开后恢复。
   - 点角色：钉住翻转 + 下一手前进；展开态也播；打盹时被点击打断。
   - 告警在状态跳变时只播一次，优先于生活场景；窗口未 reveal 不播。
   - 生活场景全程不调用 `appWindow.setPosition` / `desko_hud_save_position`。
   - 每皮肤池轮转不越界；换皮肤重置计数。
3. 原生（`npm run tauri dev` + CDP / 隔离档案）：
   - 60s 采样 `outer_position` 一字不变；至少命中 5 手不同动作。
   - 点角色 6 次能看到该皮肤池内全部动作；告警仍只放一次。
   - 关闭「桌面小动作」后 30s 内不再出现 `mv-*`，呼吸/眨眼仍在；reduce 下全部归零。
   - 悬停展开、点面板打开 Codex、拖动落盘、锁定隐藏/解锁恢复全部回归通过。
   - 右键弹出两项原生菜单，无 WebView2 浏览器菜单；「挂件设置…」打开 `codex` 页签且 HUD 不消失；「隐藏挂件」后 `codex_hud_enabled=false`，设置页总开关与托盘勾选同步关闭。
   - 观察 CPU：生活场景不应比现有常驻微动带来可感知的额外占用；不再有每拍 `setPosition`。
4. 视觉：先出 `.tmp/codex-hud-behavior-20261023/` 下的真 token 动态 mock（三款并排，可切换常驻 / 点击 / 告警 / 打盹），确认观感后再改码；实现完成后再出原生冻帧与 60s 采样。

## 6. 拍板结论（2026-10-23）

1. **方向**：锚点固定的「生活行为导演」✅ 通过——放弃整窗巡游，保留原地的跳 / 摇摆 / 伸缩语法。
2. **点角色**：钉住 + 表演下一手 ✅ 通过（替换纯眨眼）。
3. **设置**：把「桌面走动」改成「桌面小动作」，默认开 ✅ 通过。
4. **动作范围**：新增 `hop` / `waddle` / `peek` / `doze` 4 条 ✅ 通过。
5. **右键菜单**：换成挂件原生菜单（挂件设置… / 隐藏挂件）✅ 通过，替代 WebView2 默认菜单。
6. **观感复核**：兔子 `hop` 900ms 过快（mock 默认 2× 快放时更明显），改为 **1400ms**，蹲伏 / 悬空 / 落地各留一拍；mock 默认 1×，`排期 2×` 只加速排期，不再缩短动作本身。
7. **旧动作复检**：企鹅 `flap` 900ms 三拍过快，改为 **1600ms 两拍**；蜗牛 `tuck` 原先把 4.5px 横移当缩壳、看不出动作，改为头颈收进壳后、壳压合盖脸，停 0.9s。

> 若后续仍要「在桌面上真走」，按第 3 节的「舞台窗」单开一轮，不在本次改动里夹带。

## 7. 落地记录（2026-10-23）

改码时对本文档的偏离，均已核验现状后选择如下：

| 条目 | 文档写法 | 实际落地 | 原因 |
|---|---|---|---|
| §4 `src/App.vue` | 新增 `codex-hud:open-settings` 监听 | 由服务层 `activateCodexHudBridge()` 监听并调 `requestOpenSettingsTab('codex')` | 主窗口侧已有这条桥（`desko:open-settings-tab`），再加一处就是两份入口；服务只在解锁后激活，与挂件本身的生命周期一致 |
| §4 `HUD_IDLE_MOVES` | 「换成生活池」 | 改名 `HUD_LIFE_MOVES` | 它已不是「待机微动」，与 §2.1 的三层叫法对齐 |
| §2.8 建窗时关默认菜单 | `create_hud_window` 里调 | 挪到 `desko_hud_reveal` | 建窗那一刻 webview 还没就绪，`with_webview` 拿不到 `controller()`；亮相是首个可靠时机 |
| §2.8 `Menu::popup` | — | `WebviewWindow::popup_menu(&menu)`，在系统光标处弹出 | `Manager::get_window` 不在公开 trait 上；`popup_menu` 自带光标定位，无需把页面坐标换算给 Rust |
| §2.4 点角色 | 钉住 + 演下一手 | 顺带删掉 `poke` prop 与 `hud-wink` keyframes | 眨眼原本只有点角色一个触发者，改成演下一手后它是死代码 |
| §2.2 换皮肤 | 计数归零 | 计数归零 **且** 重排首档 3s | 只归零的话，新皮肤会沿用旧池子排到一半的那一档，档期与手感都对不上 mock |
| §2.2 告警 / 点击 | 优先于生活场景 | `playMove` 进门先 `stopScenes()` | 与 mock 对账查出的偏差：在排的那档不撤，会在告警演到一半时把它掐掉 |

单测台另记一条：`vi.useFakeTimers()` 会接管 `requestAnimationFrame`，亮相的两帧桩必须打在它之后（`beforeEach` 里），否则 3s 首档的边界会被真帧时延糊掉。

验收状态：`vue-tsc --noEmit` 0 error、`vitest run` 67 文件 784 例全绿、`cargo check --all-targets` 通过、`e2e/specs/codex-hud-settings.spec.ts` 4 例通过（含 `codex_hud_ambient` 持久化与读回）。§5.3 的原机项（60s `outer_position` 采样、右键两项原生菜单、`codex_hud_enabled` 收口）尚未跑，需要起 `tauri dev`。
