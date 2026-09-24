# 页面风格统一 — 审计与方案

日期：2026-09-24　状态：**已拍板**（Q1 统一无标题 / Q2 小记保留流式只对齐骨架 / Q3 五页一次到位）

## 结论

五个模块页各自实现了一套页面骨架，漂移点集中在顶栏、控件尺寸档、行卡形态、字体档、骨架屏五处。
根因：收藏页 r13 定稿的"行卡体系"从未沉淀为全局骨架，其余页面靠复制粘贴跟进，且各抄各的。

## 逐页现状（证据在各自 `<style scoped>`）

### 顶栏（最大观感差异源）
| 页 | 吸顶 | 高度 | 底 | 分割线 | 标题 |
|---|---|---|---|---|---|
| 收藏 EntriesModule | ✓ | 44px | `--bg-toolbar`（=`--bg` 纯色，注释称"磨砂"为误导） | 有 | 无 |
| 文件 FileShortcutsModule | ✓ | 44px | `color-mix(--panel-bg 72%)` + blur(8px) 真磨砂 | 有 | 无 |
| 小记 NotesModule `.stream-bar` | ✓ | 不定高（padding 撑） | `--bg` 纯色 | **无** | 无 |
| 局域网 FileshareModule | **✗** | 不定高 | 无底 | 无 | **有** 15px/600 |
| 验证码 MfaModule | ✓ | 不定高 | `--bg` 纯色 | 无 | **有** |

### 控件尺寸档
- 搜索框：220/32（收藏） vs 256/28（文件） vs flex≤320/全局高（小记）
- btn-primary：32（收藏）/ 28（文件）/ 36（小记、验证码走全局）/ 34（局域网 add-btn）
- 同名 .ft-ico：32px 两页语义不同（收藏 accent 分桶 vs 文件 --fill 底）；局域网又是 26px
- 胶囊圆角：收藏分类 `.ec-cat` 用 `--radius-tag`，文件 `.cell-type` 用 `--radius-pill`

### 行卡形态
- 收藏/文件：单列行卡（58 定高 vs 48 min-h，padding space-3 vs 10px/space-4）
- 小记：便签流卡（radius-lg，日期分组，stream-max 1200 居中）
- 局域网：分组卡（clean-group-card，行用细线分隔）
- 验证码：网格卡（minmax(216px,1fr)，hover 仅变边框，无阴影）

### 字体档
- 行名：13.5/600（收藏）vs 13/500（文件）vs 13/600（验证码）
- 等宽路径：12.5（收藏）vs 12（文件）
- URL 色 `--text-url` 两页一致 ✓

### 骨架屏
四页四套实现（行高、条宽、动画名 `skeleton-pulse` vs `pulse` 均不一致）。

## 统一方案

### 1. 沉淀全局页面骨架（global.css + 可选 PageShell 组件）
以收藏 r13 骨架为基准收编，凡两页以上出现过的形态一律入全局：
- `.page-bar`：sticky、44px 定高、负 margin 吃满、`--bg-toolbar` 底、1px `--border-line` 下划线
- `--bg-toolbar` 重定义为**半透磨砂**（color-mix 72% + blur 8，采纳文件页现有效果，注释与实现终于一致）
- `.page-title`：要么五页都有、要么都没有 —— 见决策点 Q1
- 工具栏内控件一档：搜索框/按钮高统一 32px，`.btn-primary` 在 `.page-bar` 内固定 32

### 2. 尺寸与字体档位收编
- 行卡名：13.5px/600（收藏档）；次级文字 11.5px；等宽路径 12.5px
- 胶囊：分类类一律 `--radius-tag`，标识类一律 `--radius-pill`，两页同用的 .ft-ico 合并为全局 32px 一档
- 列表间距一律 `--space-2`（8px），首行距顶栏 `--space-2`

### 3. 逐页套用（改动量预估）
| 页 | 改动 |
|---|---|
| 文件 | 删本地 page-bar 副本，改吃全局；搜索框 256/28→220 档或统一 256 两页同步；行卡 48→58；.cell-type 圆角→tag；骨架屏并全局 |
| 收藏 | page-bar 底改磨砂 token；其余为基准，仅校验 |
| 小记 | `.stream-bar` 并入全局 44px 磨砂骨架（保留 stream-max 居中与日期分组，见 Q2）；便签卡保留书写面气质，阴影/圆角对齐行卡档位 |
| 局域网 | page-bar 改吸顶 44px 磨砂；分组卡保留（它是设置类内容的正确形态），边框色/圆角/行高入档 |
| 验证码 | page-bar 并入骨架；网格卡 hover 补浸润+阴影与行卡同构 |
| 骨架屏 | 全局 `.skeleton-row/.skeleton-line` + 单一 `skeleton-pulse`，四页删副本 |

### 4. 验收
- 五页截图并排（无头 Edge，走既有 shots 流水线），顶栏/搜索框/按钮/行卡圆角逐项对齐
- `npm run test:e2e` 全绿（e2e 有锚点断言，先复跑再归因——并行会话共改）
- 主题切换抽查：磨砂底在 7 套主题下均可读

## 决策点（逐项确认）

- **Q1 页面标题**：五页统一"无标题"（顶栏即工具栏，侧栏已标明所在页，推荐）vs 统一加 15px 标题
- **Q2 小记页**：只对齐顶栏骨架与令牌，保留便签流/居中书写面（推荐）vs 小记也改成行卡列表
- **Q3 范围**：本轮五页一次到位（推荐）vs 先文件+验证码+局域网三页，小记单独一轮

## 实施记录（2026-09-24，已拍板执行）

拍板结果：Q1 无标题 / Q2 保留流式 / Q3 五页一次到位。

落地内容：
- **global.css 新增页面骨架段**：`.content-inner`（22px 底呼吸 + `:has(.batch-dock)` 换净空）、
  `.page-bar`（sticky 44px、负 margin 吃满、`--bg-toolbar` 磨砂 + blur8、1px 下划线）、
  栏内搜索框/主按钮/`.bar-btn` 一律 32px 档、`.skeleton-row/.skeleton-block/.skeleton-line`（呼吸只走容器）
- `--bg-toolbar` 由纯色 `--bg` 改为 `color-mix(--panel-bg 72%)`，注释与实现一致
- `--stream-bar-h` 52→44；小记 `.stream-bar` 类名并入 `.page-bar`（测试锚点同步改）
- 五页 scoped 副本删除：收藏/文件/小记/局域网/验证码各留页特有 override
- 局域网页 `<h1 class="page-title">` 退役；`.ft-ico`(26px) 改名 `.dir-ico` 与文件页 32px 档脱钩
- 文件页行卡 48→58px 定高、名 13/600、胶囊圆角→`--radius-tag`；验证码卡 hover 与行卡同配方（浸润+阴影）
- 小记便签卡 token 对齐行卡（bg-surface/border-subtle/radius-card/shadow-card + 同款 hover）
- chrome 半像素字号全部落回整数档（13.5→13、12.5→12、11.5→11）；prose 域（小记正文/代码）保留编辑器档位不动
- 新增 `scripts/unify-shots.mjs`：五页 × 主题一键截图 + 滚动磨砂帧 + contact sheet，输出 `design/unify-shots/<theme>/`

验收：`vue-tsc + vite build` 绿；主题覆盖检查 7×95 槽绿；vitest 166 全绿（含 `.stream-bar`→`.page-bar` 锚点同步）；
Playwright e2e 97 全绿；截图见 `design/unify-shots/light-cool/` 与 `design/unify-shots/linear-dark/`。
实测顶栏几何：滚动后 bar.top 与滚动容器贴合无缝，磨砂盖住滚过的行（早前截图"缝"为合成器假象）。
