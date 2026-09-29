# 全 App 去"普通笨重"·特色化方案（2026-09-29）

## 用户反馈

> 整个 APP 除了锁屏页外，其余页面看着普通笨重，没有任何特色。

锁屏是满意基准：居中内容流、无卡片、大量留白、发丝细节、一点品牌色、有呼吸节奏。
其余页面反其道：工具条挤、行行都是独立胶囊卡、层级全靠字号硬撑、背景一片死灰 —— 像"表格后台"，不像锁屏那个"工作台"。

## 诊断（为什么笨重且没特色）

1. **顶部三件套挤压**：搜索框 + 分类 tabs + 计数 + 右侧两钮全挤在一条 48px 栏里，密而无序，是全 App"笨重感"第一来源。
2. **胶囊海**：每个条目都是一枚等宽 56px 白卡 + 16px 缝，整页 8-10 枚重复体块，视觉节拍单调；卡片本身没有主次，只有"多"。
3. **零品牌延续**：锁屏的漫反射微光、圆点节奏、发丝描边语言，进 App 后全部消失，只剩灰底白卡 —— 所以"没有任何特色"。
4. **标题层没有存在感**：页面标题 15px 与正文 14px 几乎同阶，没有"翻开一页"的编辑感。

## 方案（三档，可叠加，全部只动视觉不动功能）

### A · 呼吸头部（推荐，先做）
- 页头改成锁屏式两段：大标题（20px/600，紧挨一行 12px 灰描述）居左；工具条（搜索/tabs/按钮）降为第二行，行高放宽到 56px，元素间距用 --space-4。
- 标题下加锁屏同款 accent 短划（24px×2px 圆角），作为全 App 的"页签记号"，品牌延续点 1。

### B · 列表去胶囊（推荐，先做）
- 收藏/文件/验证码列表：行卡不再一行一卡，改为**一张大白卡承载整表**，行间 1px 发丝分隔（设置弹窗已验证此语言，全 App 统一）。
- 收益：胶囊海消失，页面立刻轻一半；hover 行内浅染即可，不需要每行浮起。
- 小记页保留双列卡（内容卡天然不等高，不属于胶囊海）。

### C · 微光画布（锦上添花，后做）
- 页面背景从死灰 --bg 换成锁屏同款径向微光（中心偏上、±2% 明度），深色下即现有 lock-wash 语言。
- 空态插画位复用 motto-dot 三点节奏。

## 拍板记录

| 档 | 决定 | 说明 |
|----|------|------|
| A  | 否决 | 两轮 mock（两行呼吸头部 / 34px 单行细页头）均被否："不实用""加个标题不算改动"。现有标题（顶栏面包屑）保持原样，不再动页头层。 |
| B  | 通过 | 按 mock（design/distinctive/mock-paper.png / mock-ink.png）落地，范围收窄为收藏+文件两张行列表；验证码为多列网格卡，不属胶囊海，保留。 |
| C  | 通过 | 微光画布铺五页；三点节奏先只给收藏页空态。 |

## 实施记录（2026-09-29）

- **B**：global.css 新增 `.rowlist`（整表白卡：--bg-surface + 发丝描边 + radius-xl + 行间 `> * + *` 发丝线，骨架行压平）。EntriesModule `.entry-list`、FileShortcutsModule `.shortcut-list`/`.loading-list` 挂该类；行卡皮（背景/描边/圆角/阴影）从 `.entry-card`/`.shortcut-row` 摘除，hover 改 `--sunken` 行内浅染，选中改浸润底 + 1px 内描边（`inset 0 0 0 1px accent`），focus-visible 改 2px 内环。
- **C**：`.content-inner` 与 NotesModule `.stream` 加双径向微光（复用 `--lock-orb-1/2`，随 accent 联动，背景钉在容器上不随内容滚动）；global.css 新增 `.empty-motto` 三点节奏，收藏页空态文案"收一处 · 启一窗 · 开一页"。
- **e2e**：entries.spec 选中态 box-shadow 锚点改内环值；theme.spec 的 paper/ink bg/text 锚点补齐 P3 提亮轮与 ink 中性化轮遗留的过期值（4 红转绿）。全量 vitest 187、playwright 102 绿；unify-shots paper-ink / ink-ink 两套实拍通过。

## 实施记录 · 减重轮 + T1（2026-09-29）

B+C 落地后实拍反馈"依然不理想，还是很笨重"→ 根因在行内物体过重，不在容器。追加一轮：

- **行减重**：行高 56→48px；图标块 36→28px、去描边、圆角 8px；分类/凭证从胶囊改为 12px 灰文本（ec-cat/ec-cred/cell-type 全部去底去边）；`--ec-text`/`--fs-text` 行距收紧 gap 1px；勾选框 left 对齐 28px 块中心。骨架行同步 48px/28px。
- **页头控件减重**：`.page-bar` 搜索框/主副按钮/图标钮统一 30px 档，搜索框定宽 200px、字号降 --text-xs。
- **tabs 下划线化**：分类 tab 去胶囊底/阴影，30px 高、12px 文本，选中改 2px accent 下划线滑块（滑动动效保留），计数从胶囊改为纯文本。
- **T1 标题栏品牌淡染**：`.titlebar` 底色由 --chrome-bg+磨砂 改为 `color-mix(in srgb, var(--accent) 7%, var(--bg))`，随 accent 联动；锁定态透明变体不受影响。
- **e2e**：entries.spec 选中态内环锚点随 inset 值更新；全量 vue-tsc / 主题覆盖 96 槽 / vitest 187 / playwright 101 绿；unify-shots paper-ink、ink-ink 两套实拍通过。

## 实施记录 · X 两行对位（2026-09-29）

真实数据实拍反馈"这好看吗？"→ 定位三处硬伤：等宽日志行（URL·日期·备注全挤 meta 行）、两字母图标块无意义（LI/LI 重复）、信息全堆左行尾空洞。mock 三稿（X 两行对位 / X 深色 / Y 单行极简，design/distinctive/mock-rows*.png）拍板 X。

- **行首**：28px 字母块删除，改 7px 分类色圆点（hash 取 cat-1..6 六色相，未分类中性灰）——锁屏三点节奏的行内延续；勾选框 hover 时浮到点心（left 11px、对齐第一行中线）。
- **第一行**：名 + 凭证靠左，分类 `margin-left:auto` 定住行尾；hover 时分类淡出，动作钮脱流浮在行尾右缘（渐隐垫底压住其下长文本），不再常驻 98px 定宽列。
- **第二行**：URL 两色拆分（新 util `splitUrlHostPath`：主机实色 --text-url / 路径淡出 --text-faint 尾部截断），旧中段截断 `splitUrlDisplay` 与其测试删除；meta 族字号统一降 --text-xs。
- **e2e**：`.ec-domain` 锚点保留（host-only 文本不变），entries.spec 1 例首跑飘红重试即绿；全量 vitest 188 / playwright 102 绿；unify-shots 两套实拍通过。

## 实施记录 · 拆面大气轮（2026-09-29）

X 行落地后反馈："标题栏配色真丑 + 设计不大气 + 整窗沉重依旧"。诊断收口：窗口叠了四块"板"（淡染标题栏/重色侧栏/磨砂工具条/大白卡），板数不减换色无解。mock（design/distinctive/mock-flat-paper.png / mock-flat-ink.png，真实数据）拍板"可以试试"。

- **画布上移**：双径向微光从 `.content-inner`/`.stream` 移到 `.app-root`（光从窗口顶边铺下，锁屏同源）；`.main-area`/`.main-content` 改透明。
- **标题栏**：T1 accent 淡染作废 → 透明并入画布，去 border-bottom。
- **侧栏**：`--sidebar-bg` 重板 → 透明 + `--border-subtle` 发丝右界；`.sidebar-top` 分割线删；激活态淡染+左柱保留（e2e 锚点未动）。
- **列表**：`.rowlist` 白卡皮（底/边框/圆角/阴影/overflow）全删，行落纸面，行间发丝线升 `--border`；骨架行同步压平。
- **反馈补偿**：行 hover/聚焦底 `--sunken`→`--fill`（画布上浅染几乎不可见），ec-actions 渐隐垫底同步。
- **e2e**：全链无锚点改动，vitest 188 / playwright 102 绿；unify-shots 两套实拍通过。
- **已知风险（真机验收点）**：条目少时去卡后的空画布可能显"秃"而非"大气"；不满意可整轮回退（纯 CSS 层）。

## 实施记录 · inset 分组面板轮（2026-09-29）

拆面轮真机 1235 实拍反馈"不太行，不美观"→ 找专业 app 参考（Raycast/Notion/Linear DESIGN.md），提炼 S 方案（favicon 行锚点+字阶+收列）出 mock 拍板；追问"分割线都没了？"→ 换风格弹窗定为 **inset 分组面板**：灰底画布 + 白面板只包列表本体（工具条浮灰底），整页大卡对比稿看过后作废。mock：design/distinctive/mock-inset-paper/ink.png（1235×777 真实数据+真实 favicon）。

- **画布沉底**：`.app-root` 底色 --bg→--sunken（paper #f0efec / ink #131211），白面板成为画布上唯一亮面；微光保留。`--bg-toolbar` 磨砂配方同步改吃 --sunken。
- **900 居中列**：`.content-inner` padding-inline `max(space-5, 50%−450px)`；`.page-bar` 去负边距吃满，与列同宽同左缘。小记页维持自己的 --stream-max 列。
- **列表进面板**：`.rowlist` 恢复白卡皮（panel-bg/边框/radius-xl/影/overflow），只包行列表；骨架行 52px、条块底色改 --fill（白面板上 --hover 比底还亮）。
- **侧栏激活态**：淡染+左柱 → 同材质小白块（panel-bg+shadow-xs），accent 移到图标；::before 柱删除。
- **S 行内容**：行高 48→52；行首 7px 点 → 24px 圆角档（现为分类色 14% 淡染字母块，favicon 后端待接）；字阶 名 15px(--text-md)/URL 13px(--text-sm)/分类 12px muted；勾选框压档中心 left 19px 垂直居中；行 hover 回 --sunken（白面板上比画布档轻才不抢字）。
- **验证**：vue-tsc / 主题 96 槽守护 / vitest 188 / playwright 102 全绿；unify-shots 两套 + 真机 1235 实拍（live-paper/ink-1235.png）。
- **未完**：Rust 侧 favicon 抓取+缓存（任务 #14），到货后替换字母块档面。

## 实施记录 · 主题重做轮（2026-09-29）

inset 落地真机反馈："图标不协调 + 两个主题都重新设计"。诊断：暖画布/白面板/冷墨蓝三温打架 + 分类淡彩字母块像随机糖果。第一稿（mock-theme2）两套一起转冷中性，ink 被否"看着很难受"——近黑画布 + 冷蓝灰阶 + 半透明高对比描边三样叠加。第二稿（mock-theme3-ink.html）只动深色出两方向：D1 暖石（抬亮+实色字）vs D2 石墨（中性低对比）。用户立标准"眼睛舒适、字体不糊"→ D1 收字色档（正文 ≈11:1/次要 ≈6.4:1/最浅 mono ≈5.2:1，全部实色不掺透明）后拍板。paper 保持暖纸现值不动。

- **ink 换 D1 暖石**：画布 --sunken #131211→#171613、--bg→#1c1b18、面板→#24221e；文字四级抬亮为暖白（#edebe6/#c9c6bf/#aba8a1/#8a877f）；描边压软（#34312b/#45413a）；accent 墨蓝提亮一档（#89a8cd 族），brand/lock/selection/badge/toast 面同步；tip/toast 亮底→#efede8。ink×墨蓝缺省覆盖层同值联动。
- **字母块去彩**：`.ec-fav` 分类色 14% 淡染（hue-1..6 + dotHue 哈希）整体作废 → 中性档（--text 7% 淡染底 + --text-muted 字），色彩交还给将到的 favicon。
- **锚点同步**：theme.ts 预览卡/meta、e2e theme.spec 底色/accent/toast 翻面断言换值；其余 e2e 色锚点全在 paper 侧未动。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102 全绿；unify-shots 两套 + 真机 1235 实拍重拍。
- **未完**：paper v2 冷中性稿未拍板（现保持暖纸）；Rust favicon 抓取+缓存（任务 #14）。

## 实施记录 · 主题重做轮（浅色 P3 追加，2026-09-29）

ink D1 落地后追问"浅色的呢"→ 冷调 paper v2 稿作废（与 D1 暖石色温分家），改出 P3「减黄提净」对照稿（mock-theme4-paper.html，P0 现版 vs P3），拍板落地。

- **灰阶抽黄**：画布 --sunken #f0efec→#f1f1f0、--bg→#f8f8f7、--fill→#eaeae8、描边 #e9e8e4→#e6e6e4（strong #d5d5d2）、侧栏 #edecea/#e5e5e3、锁页 wash/frost/徽标胶囊/阴影环同步；accent 墨蓝与状态色不动。
- **字色微收**：四级 #333230/#4d4c49/#6b6a66/#95948e（muted 白底 ≈5.4:1 保持走查基线档）。
- **锚点同步**：theme.ts 纸底预览卡、theme.spec BASES.paper、settings.spec 分组凹槽 sunken rgb；锁页 e2e 无颜色锚点。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102（1 例 flaky 重试即绿）全绿；unify-shots 两套 + 真机 1235 双主题重拍。

## 实施记录 · favicon 抓取轮（任务 #14，2026-09-29）

行首档面从字母块升级为真实 favicon：Rust 侧按需抓取 + 本机文件缓存，前端按 host 去重消费，抓不到一律落中性字母块。

- **Rust `favicon_service.rs`**：`split_url` 只认 http/https、authority 小写做键；缓存落 `%APPDATA%/desko/favicons/<sha256(authority)>.<ext>`；候选 `scheme→https→http` 的 `/favicon.ico`，ureq 连接 2s/整体 4s、256KB 封顶；魔数判型（ico/png/gif/webp/svg），text/html 200 一律拒；抓不到记 `.miss` 冷却 7 天，免得每次开列表都吃超时。命令 `favicon_get` 走 `spawn_blocking`，不占主线程；asset 白名单加 favicons 目录（非递归）。
- **TLS 取舍**：保持正常证书校验、不放宽自签——自签站点会落字母块。个人内网工具若后续要覆盖 Jenkins 类自签站，再单独放白名单。
- **前端 `services/favicon.ts`**：模块级 reactive Map 按 host 去重，同 host 只发一次 IPC；`convertFileSrc(path)` 出图，null/异常静默落字母块。`EntriesModule.vue` 行首 `favOf(item)` 有图显示 16px contain 图、无图显示分类字母；ink 主题档底改实色 #ddd9d2 托图。
- **e2e**：mock `favicon_get: () => null`，行首恒为字母块、不碰网络。
- **验证**：cargo test favicon 4 单测绿 + `--ignored` 真抓取测（github 命中缓存复用）绿；vue-tsc / vitest 188 / playwright 102（1 例 flaky 重试即绿）全绿。

## 实施记录 · 图标笔画统一轮（任务 #18，2026-09-29）

收藏页"按钮图标不协调 + 列表拥挤"→ 量出根因不是审美：`AppIcon.vue` 把 `stroke-width="2"` 写死在 24 viewBox 上，实笔随尺寸走（20px 落 1.67px、16px 1.33px、14px 1.17px），而标题栏三颗窗口控件是 12 viewBox / 实笔 1px，两套笔画同时出现在一窗。用户点名"喜欢最大化风格的图标"，遂以窗口控件为基准统一。

- **笔画轨**：`STROKE_PX = 1.05`，`strokeWidth = 1.05 × 24 / size` 反算，全窗实笔恒定 1.05px（含 12px 锁徽）。`src/utils/icons.ts` 42 个 glyph 不再自带 stroke 属性。
- **几何化**：42 个 glyph 全部按「最大化键」语汇重画——只用 rect/line/circle 原语、rx 2、主体贴 3–21 网格，去掉 feather 的圆头长弧。侧栏 5 枚 + toggle、标题栏 gear/lock 从内联 SVG 改走 `AppIcon`（内联 SVG 从此不再有第二套笔画）。
- **残余内联 SVG**：8 个文件 27 处按各自尺寸改成实笔 1.05px 等效值（12px→2.1、14px→1.8、16px→1.58、18px→1.4），弹窗图形暂留原 feather 形状，只并轨粗细。
- **页栏主钮收白描边**：`.page-bar .btn-primary` 改 `--bg-surface` 底 + `--border-strong` 描边 + `--shadow-xs`，＋号担 accent 色，文字担形；整窗唯一那块实心色让给内容区。弹窗/表单里的 `.btn-primary` 仍是实心 accent，主从关系不变。局域网页的「停止服务」本就是 btn-danger 档，不受影响。
- **行轨 60px 全站并档**：收藏行两行内容 + 锁徽 + 分类，52px 挤；`.entry-card` 60px、`.ec-text` gap 2→5px，scoped 补 `.rowlist .skeleton-row { height: 60px }` 让加载态不跳高。同日跟进：文件页 `.shortcut-row` 48→60、`.fs-text` gap 1→5px + 同款骨架行 override；局域网页 `.url-row/.dir-row/.dir-add-row` 统一 60px（提示行 dim/note 仍按内容收口）。小记是内容卡非行轨，实测单条 89px，本就在 60 之上，不动。
- **顺手修一个真缺陷**：`views/FileshareView.vue` 以 `FileshareModule.vue`（小写 s）导入 `FileShareModule.vue`，Windows 大小写不敏感能跑，但 vite 模块图里是两个身份——改样式后旧 `?t=` 模块仍在图上跑，scoped 属性对不上，整页样式静默脱落；`vue-tsc` 也报 TS1261。路径与标识符已改成真实大小写。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102 全绿；unify-shots（paper-celadon、ink-celadon）+ dialog-shots（paper-celadon）+ 真机尺寸 1235×777 双主题重拍。

### 追加 · 吸顶工具条色带（同日真机反馈）

用户真机截图指出「新增条目按钮所在的整个区域有底色」。取 DOM 实测：`.page-bar` 铺 `--bg-toolbar = color-mix(--sunken 82%, transparent)`，而它身后是 `.app-root` 的 `--sunken` + 两团径向光晕（`--lock-orb-1/2`，中心就在窗口顶边外侧）。82% 平铺底把光晕压成 18%，静止时那条 48px 带就比四周亮一档（采样：带内 #f1f1f0 三点同值=平，带外 #eeefee/#ecedec 随 x 变=有渐变），且光晕偏绿、位置在右上，正好压在新增钮那一侧。

- **试错**：先改 `background: transparent` + `blur(14px)`——静止态确实无缝，但列表滚进工具条底下时整条变白面板色，白描边主钮当场失去对比，滚动行也透上来。作废。
- **落地**：`.page-bar` 自带与 `.app-root` 同一配方（两团 orb + `--sunken` 实底），配 `background-attachment: fixed` 让渐变按视口定位，于是静止时与身后逐像素重合，滚动时靠不透明底把行完全盖住；`backdrop-filter` 随之删除（实底不需要模糊）。改后采样：带内 #eeefee/#f1f1f0/#edeeec 随 x 变，与带外同一族。
- **遗留**：`--bg-toolbar` 槽自此无引用，但 96 槽是守护脚本与并行会话的共同契约，未擅自删。

### 追加 2 · 全站吸顶色带走查（同日真机反馈「本周2 这里也是有底色」）

小记日头 `.day-head`（吸顶在 `top: var(--stream-bar-h)`）铺的是 `var(--bg)` 平色 #f8f8f7，身后画布是 #f1f1f0 + 光晕——与工具条同一类缺陷。用户要求全站排查，遂把量法沉淀成守护脚本 **`scripts/sticky-band-check.mjs`**：五页自动扫 `position: sticky` 且宽 ≥300/高 ≥18 的横条，同区域拍两帧（原样 / 把它的底临时去掉露出画布）逐像素比对，超阈像素 >3% 判 FAIL 并 exit 1；同时打印「若改回平色 --bg 会是多少」作对照，防阈值自欺。

- **走查结论**：全窗只有两处吸顶件——`.page-bar`（五页）与小记 `.day-head`，无第三处。小记 `.composer`（48px 白卡）不吸顶、是真正的内容卡，保留。
- **单一配方上收**：新增派生槽 `--canvas-bg`（两团 orb + `--sunken`），`.app-root` / `.page-bar` / `.day-head` 三处一律消费它 + `background-attachment: fixed`；`.page-bar` 不再自带字面渐变副本。`--bg-toolbar` 自此指向 `--canvas-bg`（上一节"该槽无引用"的遗留收口：槽回来了，且带的是正确值）。
- **量到的账**：改前 `.day-head` 与画布差 9/255、覆盖 97.15% 像素（ink 5/255、95.95%）——整条都是差的，所以肉眼就是"有底色"；改后 ≤1/255、超阈像素 0%（paper/ink × celadon 两套实测，脚本对七处横条全绿）。
- **给后续的铁律**：任何浮在这层画布上的新吸顶件必须复用 `--canvas-bg` + `fixed`，铺平色（哪怕只差一档）静止时就是一条亮带；改完跑 `node scripts/sticky-band-check.mjs [--shots]`。
- **验证**：96 槽守护（新增派生槽后复跑）/ vue-tsc / vitest 188 / playwright 102 全绿；unify-shots（paper-celadon、ink-celadon）重拍 + `--shots` 出滚动吸顶帧。

### 追加 3 · 最大化阅读列放宽（同日真机截图「最大化后内容宽度再调一下」）

900px 硬上限在 1235 常态窗是优点（居中阅读列、行长不散），在 1920 最大化就变成两侧各空 ~480px 的一条窄带。拍板前先出真 token 候选 mock（900/1040/1120/1240 四档，同数据同尺寸对拍），取 **1120**：URL 行尾与右侧分类标签之间的空带还没散开，1240 起就明显脱节。

- **规则**：新增尺度槽 `--content-max: clamp(900px, calc(100vw - 800px), 1120px)`，`.content-inner` 的 `padding-inline` 由写死的 `calc(50% - 450px)` 改吃这个槽。**按视口给、不按容器百分比给**——侧栏展开/折叠只改两侧空档，行宽纹丝不动（实测同窗两态栏宽都是 1114）。
- **实测**：1920 最大化 → 1114（原 894，+25%）；1440 → 894、1235 → 894 分毫未动（下限 900 仍绑着，故 unify-shots 的 1440 套图无需重拍）。`.page-bar` 是 `.content-inner` 的子节点，工具条随列同宽同左缘，无需另改。
- **小记页保持 1200**（`--stream-max`）：便签正文比数据行需要更宽的阅读列，两页各一档是内容性质不同，不是漂移。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102 全绿；1920×1032 真尺寸双主题拍图 `design/unify-shots/<theme>-celadon/10-max-1920.png`。

## 实施记录 · 侧栏图标家族 + 窗控三钮并轨（任务 #19/#20，2026-09-29）

真机截图两点：「侧边栏上的图标都很普通」（五枚是 feather 通用件 link/doc/folder/shield/globe，语义与模块本体脱节，且互相不成一族）、「窗口控制的三个按钮，关闭按钮与其余的不一致」（关闭画在 10×10 光学盒 / 1.2px 实笔，另两颗是 8×8 / 1px）。拍板前用真 token 高保真 mock（`design/nav-mock/`，现用 vs 新案并排、折叠 64 与展开 180 两态、96px 构造放大、双主题）过目后才动代码。

- **家族构造**：五枚同一只手写的骨架——圆角矩形（rx 2）担结构 + 恰好一处实心焦点担语义，主体收在 3–21 网格，和「最大化」那颗同族。语义各自咬死模块本体：收藏=书签绶带（实心页眉段）、小记=缩略块+三行正文、文件快捷=窄页+斜出实心箭头、验证码=令牌卡+三格实心数字条、局域网=竖手机+横屏+中间实心传输箭头。
- **键名另建**：`navEntries / navNotes / navFiles / navMfa / navLan`，不复用 `link/doc/folder/shield/globe`——`folder` 等仍在行内（文件快捷行、局域网目录行）服役，改键名会连带改掉内容区语义。`Sidebar.vue` 五处 `:size="20"` 不变，仍走 `AppIcon`，实心焦点靠子元素自带 `fill="currentColor" stroke="none"`，笔画轨 1.05px 不破。
- **窗控三钮并档**：最小化 `rect 2,5.5 8×1`、最大化 `rect 2,2 8×8 rx1.5 stroke1`、还原按同一 2–10 外框重切（`rect 2,4.2 6×6` + 斜出包角）、关闭 `M2 2 10 10M10 2 2 10` stroke1 round cap。四颗形全在 2–10 光学盒、全 1px 实笔。
- **顺手修两处工具失真**：`scripts/icon-board.mjs` 过去把 `stroke-width="2"` 写死在板子上，与 `AppIcon` 的 1.05px 反算轨不同源（板子好看、真界面不像），已改为按尺寸反算；`e2e/mocks/tauri-window.ts` 的 `isMaximized()` 恒返回 false，导致「还原」那颗 glyph 在 E2E 与截图里永远拍不到，现让 `toggleMaximize()` 真翻转状态。
- **验收工具**：新增 `scripts/nav-shots.mjs [combo...]`，真应用里拍折叠档 / 展开档 / 五个模块各自激活态 / 标题栏按钮（含还原态），默认双主题，输出 `design/nav-shots/<combo>/`。注意侧栏默认就是折叠档（`App.vue isSidebarCollapsed = true`），且全局 tooltip 会把 `title` 搬进 `data-tip`，按钮别按 `title` 属性选。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102 全绿；icon-board 八套重拍；nav-shots 双主题 16 帧。

### 追加 · 侧栏图标放大到 22px（同日真机反馈「侧边栏上的图标有点小」）

20px 盒看着小不是错觉：glyph 主体收在 24 网格的 3–21（占 18/24），20px 落地的实占只有 15px，比 14px 行标题高不了多少。真 token 三档对拍（20 现用 / 22 / 24，行轨 36px 与实笔 1.05px 都不动）后取 **22px**：实占 16.5px，36px 行内仍留 7px 上下余量；24px 只剩 6px，图标与文字间隙被吃掉 2px，激活白卡显得顶满。

- **落点**：`Sidebar.vue` 五枚 `:size` 20→22，`.nav-icon` 与其 `svg` 的 20px 同步改 22（这条 CSS 优先于 SVG 呈现属性，只改组件属性不生效）。折叠档 64px 与 `padding-left` 补偿不受影响，图标仍落中线。
- **验证**：vue-tsc / vitest 188 / playwright 102 全绿；`scripts/nav-shots.mjs` 双主题 16 帧重拍。
- **跟进（同日「收起和展开的图标也有点小」）**：侧栏 toggle 那颗 `panel` 16→18px（实占 12→13.5px），按钮 26px、品牌行 42px 不变；20px 会与左侧品牌标的 20px logo 对扛，辅助件压过模块件，故否。小记页工具栏里同名 `panel` 走 28px `.bar-btn` 轴，不跟着改。验证同上全绿，nav-shots 重拍。

### 追加 · 小记全屏层密度收档 B（同日真机反馈「全屏编辑器里的间距能调整小点，一屏显示不了多少内容」）

全屏层是这张桌子上最大的一块面积，但改前只读纸面 14.5px/27px、书写态 17px/1.9，段间距 16px、标题上距 24/20px，纸面内边距 40×48——同一篇样张在 1040×670 真尺寸窗里只读态一屏只放得下 92%、书写态 89%（还要滚动才看到结尾）。拍板前出真 token 三档 mock（现状 / A 温和 / B 更紧，同数据同视口对拍），取 **B 更紧**。

- **只读纸面 `.fs-view`**：正文 14.5/27 → **13.5px/23px**，块间距 `--space-4` → **10px**，标题上距 `--space-6` → **14px**（h2 单独 12、h3 10）；字号阶梯 h1 24/32 → **20/26**、h2 18/26 → **17/24**、h3 16/24 → **15.5/22**。外壳同步收：`.fs-meta` 下距 `--space-5` → 8px、`.fs-inner` 上下内边距 `--space-6 --space-8` → **12px 20px**、`.fs-doc` 内边距 `--space-10 --space-12` → **20px 28px**。
- **书写态 `.note-editor.v-full`**：正文 17/1.9 → **15.5px/1.68**（行距 32→26px，中文仍宽松），块间距 → 10px，h1 27px/上距 `--space-6` → **23px/`--space-4`**、h2 21px/`--space-5` → **18px/12px**。
- **不动项**：书写列宽 900、纸面列宽 800、字族、颜色槽、`--fs-max` 一律不动——本轮只收纵向密度，横向阅读行长是上一轮（追加 3）刚定的。列表缩进、引用左边框、代码块内边距保持原样。
- **量到的账**：`scripts/fs-density.mjs` 在真应用里种同一篇样张（含二三级标题/列表/引用/代码块），打开全屏只读态与书写态各量一次「可视高 ÷ 整篇高」，落地后 **只读 92% → 129%、书写 89% → 118%**，即改前需要滚动才看完的篇幅，现在一屏有余。
- **验收工具**：`PW_CHANNEL=msedge node scripts/fs-density.mjs [combo ...]` 打印两态字号/行距/整篇高/可视高一并输出 `design/fs-density/<combo>-{view,edit}.png`（默认 paper-celadon、ink-celadon）。以后调纵向密度以这个百分比为准，别凭肉眼。
- **验证**：vue-tsc / vitest 188 / playwright 102 全绿；双主题四帧。

### 追加 · 纸底卡片收白档：--panel-bg 离开纯白（同日真机四页截图「白色卡片是不是太白了」）

纸底面族原本是 `--panel-bg #ffffff(255)` 压在 `--sunken #f1f1f0(241)` 画布上，差 14 级。卡片占窗面七成，255 是屏幕能给的最高亮度，眼睛的适应点被它顶到最亮，旁边那圈灰就显脏——这就是"太白"的成因。**关键账**：`--border #e6e6e4(230)` 比画布还深 11 级，卡片浮起一直靠这条发丝线担，不靠亮度差，所以收卡片亮度不掉分离度。

真 token 四档对拍（改 `global.css` 等价、8× 边缘放大才看得出缝）：现状 255 / 微收 253 / **收一档 252** / 收两档 250。收两档起，卡片与 #f1f1f0 只剩 6 级，行内字母块、输入槽、代码底（都吃 `--sunken`）开始和卡面糊在一起，故否。

- **落地**：`--panel-bg #ffffff → #fcfcfc`，`--hover #fbfbfa → #f7f7f7`。**hover 必须跟着重切**——卡片降到 252 后，旧 hover 只剩 2 级差，行悬停等于没反馈；新值与卡面保持 5 级。凹槽上的 `.setting-item` 悬停差由 10 级降到 6 级，仍在可见阈内。
- **一处硬编码副本**：`src/services/theme.ts` 的 `THEMES[].prev` 是主题预览卡的字面量副本（`card` / `rowHover`），不改它，设置→外观里那张"纸"卡会继续展示旧的纯白。已同步为 `#fcfcfc` / `#f7f7f7`。
- **不动项**：`--accent-on / --danger-on / --cat-text / --brand-knob` 仍是纯白——它们是彩底上的字与开关旋钮，语义就是"最亮的一点"，跟着收会发灰。`--frost-bg` 半透明白同理。墨底（ink）本轮未动。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 102 全绿；unify-shots（paper-celadon 五页）与 dialog-shots（paper-celadon 26 帧）重拍。

### 追加 · 圆润度轮：控件容器、矩形件、多边形字骨三处一起收（同日真机反馈「图标和图标按钮不圆润，看久了就不好看了」）

不圆润是三件独立的事，各自量出来才动手：

1. **图标按钮的容器是全场最方的一档**。28px 的 `.ib` / `.bar-btn` / `.mini-btn` 吃 `--radius-sm 6px`，圆角只占短边 **21%**；卡片是 10/56≈18%、弹窗 14/…、还有 20px 胶囊压着——按钮单独比它们都方，看着就是"没跟上"。
2. **矩形件的 rx 2 在数学上就是直角**。24 网格上的 rx 2 落到 14px 图标只剩 1.17px，而那一档的 `stroke-width` 属性值本身就是 1.8——圆角半径只比笔画宽 1.1 倍，描边一盖就没了。
3. **多边形字骨的尖角没法靠 CSS 救**。`AppIcon` 根 svg 早就写了 `stroke-linejoin="round"`，但它只能给外角倒约半个笔宽（≈0.9 单位）的圆，五角星、图钉、漏斗这类尖角仍然是尖的。

拍板走"三条全做"，落地口径：

- **容器**：新增 `--radius-ib: 9px`（28px 短边的 32%，回到卡片/弹窗那条轨）。只给按钮——`global.css` 里 `.dialog-close / .ib / .eb / .mini-btn / .bar-btn / .mini` 六处，加 11 处组件自持的图标钮（标题栏 util、侧栏 toggle、解锁页显隐钮、小记展开钮、语言钮、小记工具栏、设置关闭、添加路径、局域网两个钮）。**输入字段、标签、气泡、页签、分段控件、窗控三键仍走 `--radius-sm`**：圆角轴一分为二，字段跟着按钮一起圆会失去"可填写"的方正提示，窗控是上一轮刻意做方的。
- **矩形件**：`rx = max(旧值, min(3.5, 0.30 × 短边))`。17×17 的 `checkall`/`panel`、17×15 的 `image`、17×14 的 `link` 抬到 **3.5**；11.5 方的 `copy` 3.4；15×10 的 `lock`/`unlock`/`lockOff` 3；17×13 的 `navMfa` 3.5；10.5×17 的 `navFiles` 3.1；7×14 的 `navLan` 2.1。短边 ≤7 的三枚（`navNotes` 6.5 方、`navLan` 6.5 方、MFA 的 2.2×4 数字条）按公式留在 rx 2——再圆就成胶囊，字形会散。
- **多边形字骨**：12 枚手工重画 `eye / eyeOff / filter / pin / unpin / edit / trash / tag / doc / upload / external / folder`。规则是**凸角倒角、凹角保持尖**（凹角倒圆会把缺口填掉，漏斗的颈、图钉的肩都是靠凹角才认得出的）。

踩到的两个坑，记下来免得重犯：

- **通用倒角算法不能用**。`scripts/lib/icon-round.mjs` 那套按顶点等比倒角的机械做法，在曲边和尖角上直接糊形（眼睛的弧被倒到形外、星/勾/加号全成一团）。它只留作诊断板，真改必须逐枚手写。
- **图钉第一版改坏了**。先按"头 + 帽檐"两截分别倒角，14px 实拍读成一朵蘑菇；重做成单条闭合轮廓（顶点 6 个，凸角用 `Q` 过原顶点、手柄 ≤0.32×邻边）才认得出是图钉。倒角会吃掉尖端，所以帽檐两角的手柄要单独收短，否则整枚变窄。
- **不动项**：`star` 五个尖、`alert` 三角、`mapPin` 下尖、`max/min` 窗控件保持硬角——星形和警告靠尖才有识别度，磨平会糊成一团。

- **验收工具**：`scripts/icon-board.mjs` 加了描边越界守护，按 14px 档（stroke 最粗）算含笔宽的紧包围盒，任何一枚越出 1–23 就退出码 1——这类裁角在缩略图里肉眼看不出来。
- **验证**：96 槽守护 / vue-tsc / vitest 188 / playwright 101 passed + 1 flaky（`entries` 分类页签那条，重放即绿，与本轮无关）；`icon-board` 八块板、`unify-shots` 五页、`dialog-shots` 26 帧重拍。

---

> **后续**：形状骨架整体换 Tabler，见 [`02-icon-style-tabler.md`](02-icon-style-tabler.md)。本文的圆润度规则（`--radius-ib`、rx 公式、凸角倒/凹角留尖）继续生效，只"侧栏五枚一处实心焦点"那条随换骨架作废。
