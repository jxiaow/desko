# Design QA Verdict: Pass with warnings（通过，有警告）

走查基线：Qoder `design-review` 插件 v0.1.0（design-qa + accessibility-review 方法论），主题 light-cool 与 linear-dark 实测渲染取证 + 七套主题 96 槽静态令牌扫描。

## Summary

五页骨架、焦点环、reduced-motion、Esc 关闭、行卡 tabindex/aria-label 等既有基线全部实测通过；主要风险集中在两点——多数弹窗缺 `role=dialog` 语义、以及 faint/muted 文字层在正文级用途下不达 4.5:1。无阻塞级问题。

## Evidence Reviewed

- 设计契约：`src/styles/global.css`（96 槽 ×7 主题 + 别名层零新增 hex）、弹窗基线、行卡体系
- 渲染实现：vite e2e 模式 1430 端口，1040×670，解锁后五页 + 收藏新增弹窗，Edge channel
- 自动化产物：`.design-qa/reports/audit-light-cool.json`、`audit-linear-dark.json`（脚本 `scripts/design-audit.mjs` 可复跑）
- 静态扫描：243 个关键令牌配对逐主题计算（解析自主题块，跳过 2 个非 hex 值：深两套 `--badge-ver-text`）

## Major Issues

### 1. 弹窗缺 dialog 语义与模态声明
- Severity: major
- Evidence: `design-audit` `dialog-semantics`：EntryFormDialog 渲染实例 `role=null, aria-modal=null, aria-label=null`；带 `.dialog` 皮肤但无 role 的组件共 8 个（DetailDialog、SettingsDialog、ConfirmDialog、ChangePasswordDialog、MfaModule、FileShortcutsModule、BackupPane、EntryFormDialog）
- 对照：NoteFullscreen、NoteLockDialog 已做对
- User/design impact: 读屏器不知道进入模态层，背景内容可被误读
- Recommended fix: 全局 `.dialog` 基础模板统一补 `role="dialog" :aria-label="title"` + `aria-modal="true"`，改一处基元而不是 8 处页面
- Verification: 复跑 `node scripts/design-audit.mjs`，dialog-semantics 三项非 null

### 2. 正文级辅助文字用 faint 层，实测低于 3:1
- Severity: major（needs-design-decision）
- Evidence: 渲染实测 `.ec-note`（收藏行"备注"，如"代码托管平台"）= 2.54:1（light-cool）/ 2.32:1（linear-dark）；静态扫描 `.meta-dot/.ec-note` 同源 `--text-faint`
- Observed / Expected: 承载内容的文字建议 ≥4.5；当前是刻意的弱层级
- Recommended fix: 若保留"备注=可忽略"的视觉意图可豁免，但需明确决策；否则 `.ec-note` 升到 `--text-muted`，并把 faint 限定为纯装饰（点分隔符、水印）
- Verification: 复跑审计，ec-note ratio ≥ 4.5 或登记豁免

### 3. 表单占位符全主题不达标
- Severity: major
- Evidence: `.form-group input::placeholder` 用 `--text-faint`，七套主题 2.00–2.58:1；WCAG 视占位符为文本
- Recommended fix: 占位符最低降档到 `--text-muted`（搜索框已是 muted）
- Verification: 静态配对复扫

### 4. 深色两套主按钮/激活角标边缘失败
- Severity: major（数值边缘）
- Evidence: `--accent-on/--accent`：jetbrains-dark 4.28:1、linear-dark 4.47:1（按钮 13px 字，需 4.5）；linear-dark 激活页签计数（accent 字 on accent-soft 16% 叠加卡底，合成后约 3.1:1，工具在 alpha 背景上会低估，见 info）
- Recommended fix: 深色两套 accent 各压暗一档（只动主题层，槽位契约不变），或主按钮字重升 600 并按 large-text 3:1 判定
- Verification: 复跑 `contrast3` 静态扫描对应配对

## Minor Issues

- `.entry-card` 是 `role="button"` 但只绑 Enter，Space 不响应（实测 `afterSpace:false / afterEnter:true`）——补 `keydown.space.prevent` 同处理器。
- `NoteCard .memo-head` 有 `@click` 无 `cursor:pointer`，与其它可点区不一致。
- light-cool `.tab-count` 12px 计数 4.34:1，边缘失败；升半档灰度或 3px 加粗按大字豁免。
- 头像色相 4（栗黄 `--cat-4`）白字 3.21–3.59:1，四套主题失败——七套同病，建议全族头像色 L* 再压一档（呼应暗色小字清晰度既有结论）。

## Design Debt

- `--text-muted` 落在 `--fill/--sunken` 上 2.67–3.62:1（凹槽里的弱化文字是最常见的实际使用位），建议为凹槽配专用更深档 muted。
- 浅色三套 `--success/--warning` 直接做小字文本 3.19–3.91:1；带 soft 底色时可接受，裸色文本处需清点。
- 两套深色的 `--badge-ver-*` 为非 hex 值（rgba/引用），静态扫描无法覆盖，需人工核。

## Acceptable Differences / info

- 头像瓦片 `.ec-tile` 实测 ratio=1 为工具伪影：审计器未合成半透明/渐变背景，实际是彩色底白/彩字，人工抽查正常。
- 占位符与 faint 层的"刻意弱 hierarchy"是本仓库既往设计决策，本报告只登记不推翻。

## 实测通过项（本轮验收目标）

- reduced-motion：`emulateMedia(reduce)` 后 transition 实算 1e-05s，全局压制生效
- focus-visible：离散控件（btn/tab/ib/eb/mini/pop-item/nav-item/行卡/瓦片卡）统一 accent-ring 环，`outline:none` 均有环替换
- 键盘：行卡 tabindex=0 + aria-label + Enter 激活；Esc 关闭弹窗全通过（useEscapeClose）
- emoji 图标：0 处（仅 1 处 CSS `content:'✓'`，非图标用途）
- 滚动条：竖向滚动容器 scrollbar-gutter:stable 全挂
- 七套主题 96 槽位齐全，别名层零新增 hex

## 修复记录（2026-09-25 同日复验）

- major#1 已修：8 文件 12 个弹窗根全部补 `role=dialog + aria-modal + aria-label`（标题即标签）；复跑审计 EntryFormDialog 实例三项非 null。
- major#3 已修：`.form-group` 与解锁页 `::placeholder` 由 faint 升 muted。
- major#4 已修：linear-dark accent `#6366f1→#5b5ee6`、jetbrains-dark `#3574f0→#316dea`，rgba 衍生槽（soft/light/ring/badge/brand-g2/lock-orb/selection）整族平移，theme.ts 预览与 theme.spec 锚点同步；主按钮白字复测 5.01/4.66:1，审计失败清单中主按钮项清零。
- e2e 全量回归 97 passed；复跑取证 `.design-qa/reports/audit-*-r2.json`。
- 遗留待拍板：major#2（备注/meta 的 faint 弱层级是否升档）；minor 4 条与 debt 未动。

## 修复记录·第二轮（2026-09-25，"按推荐全清"）

- 悬案1（major#2）已修：`EntriesModule .ec-note` faint→muted；`.meta-dot` 保留 faint（纯装饰分隔符，审计清单中该项按装饰豁免登记）。
- 悬案2（debt#1）已修：七套 `--text-muted` 整档升深——cool `#6b7280→#686e7c`、warm `#8c8074→#73695f` 附近微调、celadon `#7d9185→#5e7065`、aluminum `#667085→#5d677a`、swiss `#6b7280→#676e7b`、linear-dark `#6b7280→#858c99`、jetbrains `#727783→#979ba5`。验收基准=**panel/hover/bg/sidebar ≥4.5**（bg 为占位符实际底，逐值实算迭代）；`--fill/--sunken` 3.97–4.47 为**刻意豁免**（升满会压平 secondary<muted<faint 阶梯，阶梯已在每主题亮度序列中核验保留）。
- minor：`.entry-card`/`.shortcut-row`/MFA 码行补 `@keydown.space.prevent` 同处理器，NoteCard `onKeydown` 同时接受 `' '`；渲染实测三主题 `afterSpace:true`。`.memo-head` 补 `cursor:pointer`。`.tab-count` light-cool 边缘失败随 muted 升档自然消除（复测未再入清单）。
- 头像 debt：仅浅色三套 12 槽位**保色相轻压**（cool/aluminum cat-4/5/6、warm cat-1/2/4/5、celadon cat-4/6），静态复扫 `--cat-text` 六色相 7 套全过；深色两套 `--cat-text` 本就是深墨，无需动（修正第一轮"全族压 L*"的过宽建议）。
- 验证：静态 245 对复扫 FAILS 60+→32（剩余全为登记豁免项：faint 装饰位、fill/sunken、裸态 success/warning、accent-on-soft 类）；渲染审计 r3 三主题（light-cool/linear-dark/jetbrains-dark）`.design-qa/reports/audit-*-r3.json`；e2e 全量 97 passed。
- 人工复核遗留：`.tab.active .tab-count` 在深色下 accent 字压 accent-soft 底，审计器半透明合成失败（ratio=1 伪影），需肉眼确认选中态可读性；`--badge-ver-*` rgba 值仍需人工核。

## 未覆盖（诚实边界）

- 视觉回归基线（dialog-shots/unify-shots 流水线）本轮未重跑；截图级比对不在本次结论内
- 渲染对比度全量扫描只做了默认页 + 收藏页，其余三页依赖静态令牌扫描结论
- 读屏器实机播报、Tab 序完整遍历未做（需手工清单，见插件 Manual Review）
