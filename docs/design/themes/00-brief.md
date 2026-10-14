# 主题扩展任务书

给外部设计模型用的输入包。两份文件配套：本文件讲规则和交付格式，`01-token-inventory.md` 是机器导出的全量令牌清单（改主题后重跑 `node scripts/theme-tokens-dump.mjs --out docs/design/themes/01-token-inventory.md` 即与代码同步）。

**交接方式**：把 `01-token-inventory.md` **整份**贴给对方模型——它自包含（键名、每槽涂在哪里、明度阶梯、对比度实测、推导公式都在里面，末尾第 11 节就是任务提示词），对方不需要项目访问权。本文件是给改代码这一侧看的。

## 现状

三样两轴，不是"N 套主题"：

- **底色轴** `paper`（纸，象牙白与暖灰）/ `snow`（雪，中性瓷白：亮、净、分层靠明度台阶）/ `ink`（墨，暖墨灰阶）/ `slate`（岩，较亮的蓝灰板岩），各填完全相同的 **96** 个槽位。
- **极性** `light` / `dark` 由底色决定（paper/snow=light，ink/slate=dark），用户不能单设，也不落盘。
- **accent 轴** 墨蓝（缺省）/ 青瓷 / 赭石 / 紫罗 / 暮瑰，每档在 `[data-base=x][data-accent=y]` 覆盖层里只重写 **17** 个 accent 族槽——挂的是极性，不是底色。
- 相乘 = 4 × 5 = **20 个可见组合**，但 CSS 里的 accent 块只有 **10 块**（2 极性 × 5 档），`src/styles/global.css:122-740`。

产品是本地个人工作台（收藏 / 小记 / 文件 / 局域网 / 验证码等模块平等），不是保险箱。配色要经得起长时间阅读与密集列表。

现有配色的合成修正及截图取色回归标准见 [03-composed-color-distinction.md](./03-composed-color-distinction.md)。本文后续历史刻度以最新实现与自动导出清单为准。

## 可做的两种扩展

| 类型 | 需要给的值 | 说明 |
| --- | --- | --- |
| 新增一档底色 | 96 槽 ×1 | 只要归一极（light/dark），accent 层**一块都不用补**——现有那档 accent 会自动叠在新底上。与同极已发货底色的面族平均 ΔRGB 低于 8 会被 intake 提示（等于同一张底挪半档，却要多养 5 个组合的出图矩阵）。**刻度**：现值 纸↔雪 10.7（雪走"亮白＋明度台阶"，与纸的对照是暖↔净）、墨↔岩 10.5；10 是"看得出是个方向"的经验线，8 是能被否掉的底线 |
| 替换一档底色 | 96 槽 ×1 | 换 id 换名，旧 id 进 `theme.ts` 的 `LEGACY_THEME` 迁移表（存量选择才不会掉回默认底）。2026-10 的 `sand`→`snow` 走的就是这条 |
| 新增一档 accent | 17 槽 ×2（亮/暗各一档） | 成本低得多，推荐先走这条 |

先问清要哪条再动手。

## 硬约束（历史上被用户否过的点，别再犯）

1. **只换颜色，不换形状。** 圆角、间距、字号、动效、布局在 `:root` 尺度层，主题不许碰（清单第 7.2 节）。比较两套配色时"形状不一样"会被误读成"颜色不一样"。
2. **底色块内只放具体色值，禁 `var()`。** accent 层**允许**只读引用底色槽（`var(--panel-bg)` / `color-mix(..., var(--sidebar-bg))`），因为它引用的已经是"当前那张面"——这正是跨底色自适应的机制。需要跟随别的槽位走的派生值仍写在别名层（清单第 7.1 节），那层切主题自动跟随，新配色**不要**给它单独赋值。
3. **键集必须逐字相同。** 少填一个槽不报错，但切过去那块颜色不动，成一片补丁。
4. **对比度底线**：深色主题小字 ≥5.8:1（`--text-muted` 是底线值，`--text-faint` 不得更低）；浅色下状态色全部 ≥4.5:1 可读写。
5. **分层账**：`--panel-bg` 与 `--sunken` 差要肉眼可分；卡面每通道 **≤254**（纸 252 / 雪 254 是现有两档，255 会把明适应顶到顶、下陷面发脏）；改 `--panel-bg` 必须同步重切 `--hover` 保持约 5 级差，否则行悬停无反馈。墨底画布→卡面 ΔL\* 只有 4.9，分层由 `--border` 发丝描边主担，换色时别把描边调没。
6. **彩底上的字取最亮/最暗一点**：`--accent-on`、`--danger-on`、`--cat-text`、`--brand-knob` 不跟随主色相。
7. **accent 别跟着暖底走**：赭石配在暖墨底上，主钮描边和 tab 下划线会融进底色——暗极性五档一律比亮极性同档提明度、降彩度。
8. 深色轴不做整轴转冷、不做近黑画布、不做半透明文字。（浅色轴相反：雪不掺蓝，走"亮白＋明度台阶"，靠中性灰与纸的暖白对照，不靠色温差。）
9. **压深下陷面要连带重算 code 族**：`--sunken` 一变深，吃在它上面的 `--code-*`（以及带色的 `--ft-*`）对比就跟着掉，得按色相保比例压暗顶回 ≥4.5。只交七个面的阶梯、不管侧槽，是这类改动最常见的漏账。
10. **「冷」只许走 Lab 的 b\* 轴，a\* 必须留在 0 附近。** 把冷灰写成 R&lt;G&lt;B 单调递增会带上绿分量（a\* 负到 −1 上下），实机读作**青涩**而不是冷——这一版就是这么被否的。参照已发货的冷底 `slate`：a\* 全在 −0.6～+0.5，冷度全在 b\*（−3.1～−6.5）。卡面本身不带色相，冷度交给它周围那圈面。intake 会拦：交付物的 `--bg` 只要 b\* 为负就算冷底，面族＋描边＋文字九槽任一 a\* ≤ −1.0 直接点名退回。

## 交付格式

按清单第 9 节的填空模板逐行回填 `--slot = 值`，accent 档标明**亮 / 暗两极各一份**（不是每张底色一份）。附一份推导说明：主色 → 派生档（hover/active/soft/light/ring）的算法，以及面族七档（下陷/侧栏/画布/悬停/卡面/填充/按下）的明度阶梯数值——参照清单第 4 节的 L\* 表与第 6 节的反推公式，别自创一层。

**直接粘贴**：把 `01-token-inventory.md` **整份**贴给外部模型即可——它自包含（键名逐字、每槽涂在哪里、L\* 阶梯、对比度实测、反推出的推导公式都在里面），末尾第 11 节就是任务提示词，不需要再补项目背景。它交回来的表直接就是第 9 节模板的形状，可逐行 diff。

## 落地要改的五处

1. `src/styles/global.css` —— 新底色块补满 96 槽（accent 族 17 槽填该极性的缺省兜底值）；新 accent 档只需 2 块（`[data-base="light"][data-accent=x]` / `[data-base="dark"][data-accent=x]`）
2. `src/services/theme.ts` —— `ThemeId` / `AccentId` 联合类型 + `THEMES` / `ACCENTS` 加条目，**新底色还要在 `POLARITY` 里登记吃哪一极**（漏了它 accent 层整个不生效）；`prev` 那七个字段（page/sidebar/card/rowHover/edge/accent/ink）和 accent 的 `dot`/`dotInk` 都是 CSS 值的字面量副本，改了 CSS 不改它，设置→外观的预览卡继续显示旧色。取值校验、设置弹窗和出图脚本的组合矩阵都由这几个数组驱动。底色**退役**时旧 id 要进 `LEGACY_THEME` 迁移表，否则存着旧选择的用户一进来就被回落成纸底
3. `scripts/check-theme-coverage.mjs` —— 底色/accent 名单已改成从 theme.ts 现读，加档位不用回来改；它只负责核对 CSS 里每一块都在、极性表覆盖齐、白名单与 `var()` 禁令
4. `e2e/specs/theme.spec.ts` —— `BASES` 的 `rgb(...)` 计算值锚点（别按 hex 扫）与 `ACCENT_HEX`（按 light/dark 两极列，一套底色共用一列）
5. 出图脚本 —— `theme-shots.mjs` / `theme-compare.mjs` / `dialog-shots.mjs` / `color-sweep.mjs` / `icon-board.mjs` 的组合名单统一由 `scripts/lib/theme-tokens.mjs` 的 `themeCombos()` 现读 theme.ts，**加档位不用回来改**；只有 `design-audit.mjs` 收命令行参数（`paper-ink` 形状，照新 id 传即可）

**不用动 Rust**：`src-tauri/src/commands/settings.rs` 与 `e2e/mocks/backend.ts` 的白名单是**键**白名单（`theme` / `accent` 已在列），新增色档不经过它；只有引入新设置键时才改那两处。

## 验收

```bash
node scripts/check-theme-coverage.mjs            # 键集/组合/极性登记/白名单/var() 禁令
node scripts/theme-tokens-dump.mjs --out docs/design/themes/01-token-inventory.md
PW_CHANNEL=msedge npx playwright test e2e/specs/theme.spec.ts   # 20 组轮换 + 四底 toast 翻面
PW_CHANNEL=msedge node scripts/color-sweep.mjs   # 全窗 20 组合配色走查
```

真机截图对拍才是最终验收：色值表看着自洽、落到密集列表上糊掉，是这类改动最常见的失败方式。
