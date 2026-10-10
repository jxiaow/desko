# 03 · 应用内图标换骨架：Solar Round

## 0. 一句话结论

App 内 61 枚功能图标的形状骨架从 Tabler 整体换成 **Solar Round Linear**（CC-BY-4.0，`@iconify-json/solar` v1.2.13，vendored 进 `src/utils/icons.ts`，零运行时依赖），实笔恒定宽度由 **1.05px 提到 1.15px**，并新增 **Solar Round Bold** 实心件专供状态位（已收藏星标；侧栏当前模块五枚曾一并收编，同日按真窗口走查退回描边，见 §3 规则 3）。窗控四颗与品牌标继续豁免。本文取代 `02-icon-style-tabler.md` 的骨架选择与线宽结论；02 的映射表、内联 SVG 收编记录、圆润度母版规则仍然有效。

## 1. 为什么要换

Tabler 这一版把"有没有图标可用"解决了（62 键注册表 + 31 处内联 SVG 收编），但形状本身是硬朗直角那一挂：24 格上切角小、端点平，和 desko 的圆角容器（`--radius` / `--radius-ib: 9px` / 34px `.grid-slot` 浮岛）贴在一起时，图标像被塞进圆角盒里的方件。本轮诉求是换一种整体气质，不是修单枚。

## 2. 候选与拍板

对拍全部在**真 token、真类名**的离线 mock 里出图（脚本与产物都在未跟踪目录，不进仓库代码）：

| 脚本 | 产物 |
| --- | --- |
| `tmp/iconsets/map.mjs` | 62 键 × 7 套候选的名称映射，`--emit` 出 `resolved.json`，七套全部**回落 0** |
| `tmp/iconsets/board.mjs` | `design/icon-style-mock/round2/{16-rail-paper,16-rail-ink,16-native-paper,62-rail-paper}.png` |
| `tmp/iconsets/ui.mjs` | `design/icon-style-mock/round2/ui-<style>-<theme>.png`（1040×670 真窗口，侧栏/顶栏/行卡/弹窗全在宿主尺寸轴上） |
| `tmp/iconsets/rail.mjs` | `rail-{15,22}-paper.png`、`rail-15-ink.png`（同骨架四档线宽） |
| `tmp/iconsets/solid.mjs` | `solid-{paper,ink}.png`（全程描边 vs 状态位实心） |

候选与结论：

| 候选 | 骨架特征 | 结论 |
| --- | --- | --- |
| Solar Round Linear | 圆头收笔、圆角母版与容器同族 | **采用** |
| Phosphor Regular | 最工整、小字最清晰，但与 Tabler 同族，观感变化不足 | 落选 |
| Majesticons Line | 细几何、最轻盈；缺「局域网」件，只能借 `globe`，与行卡「网站」撞形 | 落选 |
| Iconoir | 缺 chevron，`chevDown` 降级成整支箭头；`unlock`/`folderOpen` 形怪 | 落选 |
| Solar Round Bold / Phosphor Duotone | 15px 下发糊、成团 | 不作通用轨，只作状态位实心（前者） |

## 3. 三条定稿规则

1. **骨架 = Solar Round Linear**，24 格满幅，与现注册表同网格，`AppIcon` 的 `viewBox="0 0 24 24"` 不动。
2. **实笔恒定 1.15px**（原 1.05）。换算式不变：`stroke-width = 轨宽 × 24 / size`，所以 12px 落 2.30、18px 落 1.53、22px 落 1.25，视觉宽度全轴一致。取 1.15 的理由：Solar 的形比 Tabler 更圆更闭合，1.05 在墨底上像没画完；1.30 时 `gear`/`trash`/`dots` 的小结构开始粘连。
3. **状态位实心**：只有"剪影本身即语义"的件走 Solar Round Bold——当前一枚，已收藏星标（`star`，`filled` 通道）。带内腔的件（放大镜、齿轮、方框类）一律不做实心：`search-bold` 在 14px 就是一团黑饼，这是硬边界。
   - 与 02 的区别要说清：02 砍掉的是把实心当 **hover/focus 反馈**用；本轮实心标的是**稳定状态**（已收藏），不是瞬时反馈。
   - **侧栏当前模块不用实心**（10-08 真窗口走查后回退，八格对拍见 `tmp/nav-active-mock.mjs` → `design/nav-active-mock/`）：收起态那枚落在 22px，Bold 母版的内腔被填满，在白块里读成一块色斑而不是图标；激活语义已由 `--panel-bg` 白块 + 抬影 + accent 文字三重说尽，图标再实心是第四遍。容器保留现状，图标退回描边母版，只转 `--accent`。
   - 本轮**不接** `lockFilled`：`lock` 在 9 个调用点里身份不一（条目加密标记 / 标题栏锁定动作 / 设置页签 / 空态大图），逐一定性的成本大于收益，锁一律保持描边。

## 4. 映射表

`scripts/vendor-solar-icons.mjs` 的 `MAP` 是唯一事实来源，下表为人读版本（Solar 名一律去 `-linear` 后缀读；`square-alt-arrow-up`、`pin-broken`、`lock-broken` 为整名照用）。

> 10-08 后续：标题栏那颗备份徽标从"只读状态"改成"点了就跑一轮"的同步钮，形也跟着换——`cloud`（说的是"云"这个名词）改成 `refresh`（循环双箭头，说的是"再走一遍"这个动作），`cloud` 键失去最后一个调用点、随即删注册表条目，键数仍 61+1。
>
> 10-10 图标轨辨识度轮：侧栏收到 56px 后图标是唯一线索，八枚里有五枚在 22px 读作"灰色抽象符号"（`folder` 像袋子、`server` 像列表、`key` 一团加一根棍、`square-alt-arrow-up` 方框加箭头、`globe` 的大陆线糊成斑），且轨档既无文字也无 hover 名称。本轮按"剪影互不重复"重挑八枚（对拍板：`design/rail-icon-mock/`），换形不换风格族，实笔仍 1.15px；同时给 `.nav-item` 补只在图标轨档生效的 `title`（展开档文字已在，挂上就是重复噪声），走全局 tooltip 出模块名。穿透/直连/Codex 三枚原先借通用键 `globe`/`external`/`user`（这三键在别处仍是原义），故新立 `navTunnel`/`navBypass`/`navCodex` 三键，注册表 66 描边 + 1 实心。

### 4.1 描边 66 键

| 键 | Solar | 键 | Solar |
| --- | --- | --- | --- |
| `search` | magnifier | `searchEmpty` | magnifier-slash |
| `x` | close | `star` | star |
| `pin` | pin | `unpin` | pin-broken |
| `dots` | menu-dots | `trash` | trash-bin-minimalistic |
| `upload` | upload-minimalistic | `check` | check |
| `checkall` | check-square | `image` | gallery |
| `max` | maximize | `min` | minimize |
| `tag` | tag | `all` | grid-2x2 |
| `doc` | document | `clip` | paperclip |
| `edit` | pen | `filter` | filter |
| `clock` | clock-circle | `panel` | panel-right |
| `bulletlist` | list | `orderedlist` | list-ordered |
| `quote` | quote | `code` | code |
| `divider` | minus | `link` | link |
| `external` | square-alt-arrow-up | `copy` | copy |
| `eye` | eye | `eyeOff` | eye-closed |
| `lock` | lock | `unlock` | lock-unlocked |
| `lockOff` | lock-broken | `folder` | folder |
| `terminal` | command | `plus` | add |
| `user` | user | `mapPin` | map-point |
| `alert` | danger-triangle | `chevDown` | alt-arrow-down |
| `shield` | shield | `globe` | globe |
| `gear` | settings | `navEntries` | tag |
| `navNotes` | notebook | `navFiles` | folder-with-files |
| `navMfa` | lock-password | `navLan` | devices |
| `navTunnel` | cloud-upload | `navBypass` | checklist-minimalistic |
| `navCodex` | user-circle | `arrowRight` | arrow-right |
| `clipboard` | clipboard | `file` | file-text |
| `folderOpen` | folder-open | `refresh` | refresh |
| `download` | download-minimalistic | `adjustments` | settings-minimalistic |
| `palette` | palette | `info` | info-circle |
| `chevRight` | alt-arrow-right | `database` | database |
| `undo` | undo-left-round | `redo` | undo-right-round |

### 4.2 实心 1 键（Round Bold）

| 键 | Solar |
| --- | --- |
| `starFilled` | star-bold |

`starFilled` 由实心表出，描边表不再产出任何 `*Filled` 键。侧栏五枚 `nav*Filled`（`bookmark-bold`/`document-text-bold`/`folder-bold`/`key-bold`/`server-bold`）曾收编在此，10-08 真窗口走查后连同键名一并删除，理由见 §3 规则 3。

## 5. 弱形核验（15/18/22px 逐枚看过，板：`design/icon-style-mock/round2/probe-weak.png`）

| 键 | Solar 首落名 | 问题 | 定稿 |
| --- | --- | --- | --- |
| `navNotes` | `notes-linear` | 两张斜叠的纸，15px 读作一片叶子 | `document-text-linear`（圆角方 + 三行线） |
| `divider` | `separator-horizontal-linear` | 菱形夹一条横线，读作"排序" | `minus-linear`（就是一条横线） |
| `adjustments` | `slider-horizontal-linear` | Solar 的 slider 全系都像打印机/托盘 | `settings-minimalistic-linear`（六角螺母，与标题栏圆齿轮不同形） |
| `unpin` | `pin-bold`（映射漏网） | 描边族里混进实心件 | `pin-broken`（断口图钉；该枚只出现在 12px 菜单项且带「取消置顶」文字） |
| `terminal` | `command-linear` | ⌘ 而非 `>_`，Solar 无 `terminal-linear` | 保留 ⌘（文件快捷页 14px，语义"命令"够用） |

## 6. 实现改动清单

| 文件 | 改动 |
| --- | --- |
| `scripts/vendor-solar-icons.mjs` | 新增。照 `vendor-tabler-icons.mjs` 的形状：`MAP` + `FILLED_MAP` 两张表为唯一事实来源，剥掉 iconify body 自带的 `fill/stroke/stroke-width/stroke-linecap/stroke-linejoin`，交回根 `<svg>` 继承；未映射键直接抛错 |
| `src/utils/icons.ts` | 重新生成 61 描边键 + 1 实心键；表头注释改记 Solar 来源与三条轨规则 |
| `src/components/shared/AppIcon.vue` | `STROKE_PX` 1.05 → 1.15；注释同步。`filled` 通道与 `viewBox` 不动 |
| `src/components/layout/Sidebar.vue` | 无改动（曾加的五枚 `:filled="route.path === '/xxx'"` 已按 §3 规则 3 撤除，激活态回到只换色、容器表达状态） |
| `scripts/icon-board.mjs` | `STROKE_PX` 同步 1.15；bbox 守卫改按 Solar 的实际留白重标——Solar 是满幅件（图形本体 2–22，Tabler 是 3–21），旧判据"越出 1–23"在 12px 档必然假报警，改成按 App 内最小档 12px 的含笔包围盒对 0–24（真正的裁切边界）量；`*Filled` 实心件在板上按 `fill=currentColor / stroke=none` 画，与 AppIcon 同规格 |
| `public/icons/NOTICE.md` | 新增，CC-BY-4.0 署名条目（作者 480 Design、取数版本、改动说明），与 `public/fonts/NOTICE.md` 同构 |

不动：`TitleBar.vue` 窗控四颗（12 格 / 1px）、`BrandLogo`、`NoteCard.vue` 等已有的 `:filled="…starred"` 调用点（键名不变，自动吃到新的 `starFilled`）。

## 7. 守卫与验收

1. `node scripts/icon-board.mjs`（8 主题组合 × 14/16/20/24，含描边越界守卫）；
2. `node scripts/check-theme-coverage.mjs`、`vue-tsc`、`vitest run`、playwright e2e（`PW_CHANNEL=msedge`）；
3. `design-audit.mjs` + `color-sweep.mjs`：实心件按"面性"量对比度，不得沿用描边豁免；
4. `dialog-shots.mjs` / `unify-shots.mjs` 全量重拍，跑前删旧帧、跑后按 `EXPECTED` 逐名核对；
5. 人工看四张真窗口图（纸/墨 × 列表/弹窗）与侧栏激活态（描边图标 + 白块）。

## 8. 已知代价

- Solar 是 CC-BY-4.0（Tabler 是 MIT，02 里没有许可章节）。路径 vendored 进仓库后必须留署名条目：`src/utils/icons.ts` 表头写来源与许可链接，另立 `public/icons/NOTICE.md`（与内置字体的 `public/fonts/NOTICE.md` 同构）；
- 1.15px 比 1.05 重一档，浅色小字旁的图标会更"跳"，验收时以 `design-audit` 的对比度与真窗口图为准，不靠放宽阈值；
- `unpin` 的断口图钉不是通用"取消置顶"形，靠菜单文字兜底。

## 9. 落地结果（2026-10-08）

- `src/utils/icons.ts` 重生成 **62 键**（61 描边 + 1 实心），`scripts/vendor-solar-icons.mjs` 一次跑通、无未映射键、无残留 `fill/stroke` 属性；侧栏五枚实心母版在真窗口走查后删除，注册表回到 62 键；
- `icon-board.mjs`：8 主题组合 × 14/16/20/24，描边越界 **0** 枚。最贴边的一档是 12px（含笔包围盒 0.85–23.15，离 viewBox 边 0.85 单位）——Solar 满幅，留白全靠 viewBox 那 2 单位，线宽若再往上提一档就要开始裁角；
- `check-theme-coverage` 通过；`vue-tsc --noEmit` 无错；`vitest run` **189/189**；playwright **112 passed**，2 条红是 `e2e/specs/notes.spec.ts` 里未提交的「插入芯片」用例（找 `.composer button[aria-label="插入待办项"]`，该 aria-label 在 `src/` 与 HEAD 里都不存在，`git log -S` 查无），属并行会话在建功能，与本轮回无关；另 1 条重试即绿（几何飘红）；
- `color-sweep`（8 组合）：最低 4.49 的两处仍是既定的 11px 装饰位豁免，游离色仍只有 `span.ft-ico`（文件类型色块）——换骨架没有引入新的颜色面；`design-audit` 在 `paper-ink`/`ink-ink` 下 exit 0；
- 重拍：`dialog-shots all`（8 组合 × 25 帧，逐名核对全部为本次新拍）、`unify-shots` 的 `paper-ink` 与 `ink-ink`；人工看过纸/墨两底的收藏页、小记页、条目菜单（12px 档）、设置弹窗页签与锁屏。
