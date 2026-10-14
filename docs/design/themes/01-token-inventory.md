# desko 主题令牌清单（机器导出）

> 由 `node scripts/theme-tokens-dump.mjs` 从 `src/styles/global.css`、`src/styles/materials.css` 与 `src/**` 现场解析生成，请勿手改。
> 底色槽位 **96** 个，其中跟随 accent 的 **17** 个；底色 4 套 × accent 5 档 = 20 个可见组合，但 accent 覆盖层只按**极性**写，共 10 块。

## 1. 契约与读法（这份文件是自包含的，读它的人不需要项目访问权）

**这份清单怎么用**：
- 第 2 节 = 全部键名逐字列出 + 现有 4 套底色（纸 / 雪 / 墨 / 岩）的当前值，它是**参考系**：新配色必须落在同一套键名上，键名照抄、不许自创也不许省略。
- 第 3 节 = accent 族 17 槽在 10 个极性组合下的当前值。
- 第 4 节 = 面族明度阶梯（每个面的 L\*、相邻档差多少）；第 5 节 = 对比度实测（字色对四面、彩底上的字、语法色对底）——这两节是**判据**，不是风格建议。
- 第 6 节 = 从现值反推出的推导公式：新加一档强调色只需要定 1 个主色，其余 16 槽按公式给。
- 第 7 节 = 不许重设计的东西（别名层跟着源头走，尺度层恒定；材质层按氛围状态覆盖）。
- 第 9 节 = 交付格式（填空模板，照抄键名回填即可）；第 10 节 = 历史踩过的坑；第 11 节 = 可直接粘贴的任务提示词。

**硬契约**：
- 底色轴 `[data-theme="paper"|"snow"|"ink"|"slate"]` 各填**完全相同的槽位名**，缺一个槽 = 切过去那块颜色不动。
- 第二根轴是**极性** `light` / `dark`，由底色决定（纸/雪=light，墨/岩=dark），用户不能单设。
- accent 覆盖层 `[data-base=x][data-accent=y]` 只许动第 3 节列出的 17 个槽，且 2×5=10 块必须齐全——新增底色**不必**再配一轮 accent，只要在 theme.ts 的 POLARITY 表里登记它属于哪一极。
- 底色块内**只放具体色值**，不许出现 `var()`；accent 块允许 `color-mix()` 引用随底走的槽（如洗底掺 `var(--panel-bg)`）。引用别的槽仍是别名层的活。
- 第 7 节的派生/尺度槽由 `var()` 指向源头，新配色**不要**给它单独给值，除非确实要断开。
- 本项目侧的校验（不需要你执行）：`node scripts/check-theme-coverage.mjs`；行为回归：`npx playwright test e2e/specs/theme.spec.ts`。

## 2. 底色层：全部槽位 × 现有 4 套值

### accent 族（17 槽，由覆盖层重填）

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--accent` ⟨accent⟩ | #315f9b | #315f9b | #7faeee | #7faeee | 主强调色：主按钮底、链接、激活描边 | src/styles/global.css ×47, src/components/notes/NoteCard.vue ×10, src/components/codex/CodexModule.vue ×8 +34处 / 共 146 |
| `--accent-hover` ⟨accent⟩ | #264c80 | #264c80 | #a0c3f5 | #a0c3f5 | 主强调色悬停（比 accent 深一档） | src/styles/global.css ×5, src/components/auth/SetupPage.vue, src/components/auth/UnlockPage.vue +2处 / 共 9 |
| `--accent-active` ⟨accent⟩ | #1e3d68 | #1e3d68 | #6692d0 | #6692d0 | 主强调色按下 | src/components/notes/NoteEditor.vue ×4, src/styles/global.css ×3, src/components/auth/UnlockPage.vue +2处 / 共 10 |
| `--accent-on` ⟨accent⟩ | #ffffff | #ffffff | #121e30 | #121e30 | accent 底上的文字，恒为最亮/最暗一点 | src/styles/global.css ×7, src/components/codex/CodexModule.vue ×2, src/components/notes/NoteFullscreen.vue ×2 +5处 / 共 16 |
| `--accent-soft` ⟨accent⟩ | #e7eef8 | #e7eef8 | rgba(127, 174, 238, 0.16) | rgba(127, 174, 238, 0.16) | accent 的浅水洗底：选中行、浅色徽标 | src/styles/global.css ×17, src/components/notes/NoteCard.vue ×4, src/components/notes/NoteEditor.vue ×2 +12处 / 共 35 |
| `--accent-light` ⟨accent⟩ | #cfdef1 | #cfdef1 | rgba(127, 174, 238, 0.28) | rgba(127, 174, 238, 0.28) | 比 soft 再重一档的 accent 底 | src/components/codex/CodexUsagePanel.vue ×2, src/components/notes/NoteCard.vue ×2, src/components/codex/CodexTodayUsageChart.vue +5处 / 共 10 |
| `--accent-ring` ⟨accent⟩ | rgba(49, 95, 155, 0.16) | rgba(49, 95, 155, 0.16) | rgba(127, 174, 238, 0.32) | rgba(127, 174, 238, 0.32) | 焦点环 / 外发光 | src/styles/global.css ×5, src/components/mfa/MfaModule.vue ×2, src/components/notes/NoteCard.vue ×2 +11处 / 共 21 |
| `--text-brand` ⟨accent⟩ | #264c80 | #264c80 | #b0cef8 | #b0cef8 | accent 族的文字档（链接、激活标签） | src/styles/global.css ×12, src/components/bypass/BypassModule.vue ×2, src/components/layout/Sidebar.vue ×2 +4处 / 共 20 |
| `--badge-ver-bg` ⟨accent⟩ | #e7eef8 | #e7eef8 | rgba(127, 174, 238, 0.16) | rgba(127, 174, 238, 0.16) | 版本胶囊徽标底 | _无人引用_ |
| `--badge-ver-text` ⟨accent⟩ | #264c80 | #264c80 | #b0cef8 | #b0cef8 | 版本胶囊徽标字 | _无人引用_ |
| `--brand-g1` ⟨accent⟩ | #668cbd | #668cbd | #b0cef8 | #b0cef8 | 品牌标渐变上端 | src/components/shared/BrandLogo.vue ×2 / 共 2 |
| `--brand-g2` ⟨accent⟩ | #315f9b | #315f9b | #7faeee | #7faeee | 品牌标渐变中段（= accent） | src/components/shared/BrandLogo.vue / 共 1 |
| `--brand-g3` ⟨accent⟩ | #1e3d68 | #1e3d68 | #6692d0 | #6692d0 | 品牌标渐变下端 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-orb-1` ⟨accent⟩ | rgba(49, 95, 155, 0.07) | rgba(49, 95, 155, 0.07) | rgba(127, 174, 238, 0.14) | rgba(127, 174, 238, 0.14) | 历史光晕色槽（保留主题契约；当前材质由 accent 推导） | _无人引用_ |
| `--lock-orb-2` ⟨accent⟩ | rgba(49, 95, 155, 0.045) | rgba(49, 95, 155, 0.045) | rgba(127, 174, 238, 0.07) | rgba(127, 174, 238, 0.07) | 历史光晕色槽（保留主题契约；当前材质由 accent 推导） | _无人引用_ |
| `--toast-info` ⟨accent⟩ | #96b7df | #96b7df | #315f9b | #315f9b | 信息 toast 的图标/文字色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--selection` ⟨accent⟩ | rgba(49, 95, 155, 0.18) | rgba(49, 95, 155, 0.18) | rgba(127, 174, 238, 0.30) | rgba(127, 174, 238, 0.30) | 文本选区底色 | src/styles/global.css / 共 1 |

### 面 / 底

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--bg` | #f8f5f0 | #f1f2f3 | #1d1c1a | #252932 | 窗体画布底（最外层面） | src/styles/materials.css ×6, src/components/auth/SetupPage.vue ×2, src/components/entries/EntryFields.vue +6处 / 共 15 |
| `--panel-bg` | #fcfaf7 | #fefefe | #22211e | #2b303a | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） | src/styles/materials.css ×11 / 共 11 |
| `--chrome-bg` | rgba(248, 245, 240, 0.78) | rgba(241, 242, 243, 0.85) | rgba(29, 28, 26, 0.86) | rgba(37, 41, 50, 0.86) | 标题栏一类的半透明吸顶底 | _无人引用_ |
| `--sunken` | #f1ede7 | #ebecee | #181716 | #1f232b | 下陷面：输入槽、代码底、字母块、页栏铺底 | src/styles/global.css ×4, src/styles/materials.css ×3, src/components/bypass/BypassModule.vue +2处 / 共 10 |
| `--fill` | #e8e2d9 | #dbdde0 | #2a2927 | #323844 | 中性填充：进度槽、占位块、次级底 | src/styles/global.css ×9, src/components/codex/CodexPlanBadge.vue ×2, src/components/codex/CodexTodayUsageChart.vue ×2 +10处 / 共 23 |
| `--hover` | #f6f3ee | #f7f8f9 | #282622 | #323844 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） | src/styles/global.css ×14, src/components/notes/NoteEditor.vue ×2, src/components/settings/BackupPane.vue ×2 +10处 / 共 29 |
| `--active` | #eae4db | #e1e3e6 | #343431 | #3b4351 | 行/项按下选中底 | src/styles/materials.css / 共 1 |
| `--overlay` | rgba(29, 28, 26, 0.42) | rgba(18, 19, 22, 0.42) | rgba(0, 0, 0, 0.62) | rgba(0, 0, 0, 0.65) | 遮罩层（弹窗背后的那层压暗） | src/components/entries/EntryFormDialog.vue, src/components/entries/PathsDialog.vue, src/components/files/FileShortcutsModule.vue +3处 / 共 6 |

### 文字

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--text` | #333230 | #1a1b1d | #e6e4de | #edf0f6 | 正文一级字 | src/styles/global.css ×28, src/components/settings/SettingsDialog.vue ×8, src/components/notes/NoteEditor.vue ×6 +37处 / 共 123 |
| `--text-secondary` | #4d4c49 | #3e3f42 | #c7c4bd | #d2d7e1 | 二级字（说明、次要字段） | src/styles/global.css ×24, src/components/codex/CodexUsagePanel.vue ×5, src/components/codex/ResetCreditDialog.vue ×4 +29处 / 共 87 |
| `--text-muted` | #6b6a66 | #5b5d61 | #aeaba4 | #bbc3d0 | 三级字（标签、时间戳） | src/styles/global.css ×35, src/components/codex/CodexUsagePanel.vue ×11, src/components/codex/CodexSessionsPanel.vue ×10 +38处 / 共 159 |
| `--text-faint` | #95948e | #85888d | #9c9992 | #adb6c5 | 四级字（占位、辅助）——深色下最低 5.8:1 底线 | src/components/codex/CodexTrashPanel.vue ×2, src/components/codex/CodexUsagePanel.vue ×2, src/components/entries/EntriesModule.vue ×2 +15处 / 共 25 |
| `--text-url` | #4d4c49 | #3e3f42 | #c9c6bf | #d2d7e1 | 裸链接字色 | src/components/fileshare/FileShareModule.vue ×3, src/components/entries/EntriesModule.vue, src/components/files/FileShortcutsModule.vue +2处 / 共 7 |

### 描边

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--border` | #e2dbd1 | #d3d5d9 | #30302d | #3e4654 | 发丝描边：卡片/输入/分隔，分层主力 | src/styles/global.css ×37, src/components/fileshare/FileShareModule.vue ×9, src/components/settings/SettingsDialog.vue ×6 +35处 / 共 126 |
| `--border-strong` | #cec5b8 | #b9bdc2 | #434340 | #535f71 | 重描边：需要压住的边界、--shadow 的 1px 环 | src/styles/global.css ×5, src/components/notes/NoteEditor.vue ×3, src/components/settings/SettingsDialog.vue ×2 +6处 / 共 16 |
| `--border-subtle` | #f1ede7 | #e9ebee | #252421 | #303743 | 极浅描边（比 --border 更退） | src/components/bypass/BypassProbeDialog.vue, src/styles/global.css / 共 2 |
| `--border-hover` | #cec5b8 | #b9bdc2 | #434340 | #535f71 | 悬停描边 | src/styles/global.css ×3, src/components/bypass/BypassModule.vue ×2, src/components/fileshare/FileShareModule.vue +1处 / 共 7 |

### 徽标

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--badge-cat-bg` | #eee8df | #ebecee | #252421 | #303743 | 分类胶囊徽标底 | src/styles/materials.css / 共 1 |
| `--badge-cat-border` | #e2dbd1 | #d3d5d9 | #30302d | #3e4654 | 分类胶囊徽标描边 | _无人引用_ |
| `--badge-cat-text` | #4d4c49 | #3e3f42 | #c7c4bd | #d2d7e1 | 分类胶囊徽标字 | _无人引用_ |

### 投影

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--shadow-xs` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 最小投影 | src/styles/global.css ×3, src/components/auth/UnlockPage.vue, src/components/notes/NoteComposer.vue +1处 / 共 6 |
| `--shadow-card` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 行卡投影（轻量化轮起只留一丝贴地感） | src/styles/global.css ×9, src/components/bypass/BypassModule.vue ×2, src/components/fileshare/FileShareModule.vue ×2 +5处 / 共 19 |
| `--shadow-sm` | 0 1px 3px 0 rgba(29, 28, 26, 0.05) | 0 1px 3px 0 rgba(18, 19, 22, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | 小投影 | src/styles/global.css ×4, src/components/notes/NoteCard.vue ×2, src/components/fileshare/FileShareModule.vue +2处 / 共 9 |
| `--shadow` | 0 4px 12px -2px rgba(29, 28, 26, 0.06), 0 0 0 1px #cec5b8 | 0 4px 12px -2px rgba(18, 19, 22, 0.06), 0 0 0 1px #b9bdc2 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #434340 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #535f71 | 常规浮层投影（带 1px 描边环） | _无人引用_ |
| `--shadow-md` | 0 6px 16px -6px rgba(29, 28, 26, 0.10) | 0 6px 16px -6px rgba(18, 19, 22, 0.10) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 中投影 | src/styles/global.css ×2, src/components/auth/SetupPage.vue, src/components/mfa/MfaModule.vue / 共 4 |
| `--shadow-lg` | 0 12px 28px -8px rgba(29, 28, 26, 0.14) | 0 12px 28px -8px rgba(18, 19, 22, 0.14) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 大投影 | src/components/auth/SetupPage.vue / 共 1 |
| `--shadow-pop` | 0 16px 36px -8px rgba(29, 28, 26, 0.12), 0 4px 10px -2px rgba(29, 28, 26, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 16px 36px -8px rgba(18, 19, 22, 0.12), 0 4px 10px -2px rgba(18, 19, 22, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 弹层/菜单投影（最高一档常规浮面） | src/styles/global.css ×5, src/components/notes/NoteEditor.vue ×2, src/components/mfa/MfaModule.vue +2处 / 共 10 |
| `--shadow-dock` | 0 26px 60px -18px rgba(29, 28, 26, 0.32), 0 6px 18px rgba(29, 28, 26, 0.14) | 0 26px 60px -18px rgba(18, 19, 22, 0.32), 0 6px 18px rgba(18, 19, 22, 0.14) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 批量操作药丸投影（高于任何弹层） | src/components/notes/NoteFullscreen.vue, src/styles/global.css / 共 2 |

### 状态色

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--danger` | #a9443c | #b83a30 | #e08079 | #df817c | 危险/删除实色 | src/styles/global.css ×15, src/components/entries/EntryFields.vue ×4, src/components/codex/CodexBatchDeleteDialog.vue ×3 +15处 / 共 43 |
| `--danger-on` | #ffffff | #ffffff | #181716 | #181517 | 危险底上的字 | src/components/layout/TitleBar.vue, src/styles/global.css / 共 2 |
| `--danger-hover` | #8c362f | #992e26 | #ea9d97 | #e89e99 | 危险悬停 | src/components/fileshare/FileShareModule.vue, src/components/tunnel/TunnelModule.vue, src/styles/global.css / 共 3 |
| `--danger-soft` | #f7ece9 | #faecea | #271a17 | #271a19 | 危险浅底 | src/styles/global.css ×8, src/components/fileshare/FileShareModule.vue ×3, src/components/tunnel/TunnelModule.vue ×2 +4处 / 共 17 |
| `--danger-border` | #eacfc8 | #f0cfcb | #462924 | #472927 | 危险描边 | src/components/fileshare/FileShareModule.vue ×2, src/components/entries/DetailDialog.vue, src/components/tunnel/TunnelModule.vue +1处 / 共 5 |
| `--success` | #3d7355 | #2e7a50 | #6fbf95 | #6cbd94 | 成功实色 | src/styles/global.css ×6, src/components/bypass/BypassModule.vue ×2, src/components/fileshare/FileShareModule.vue ×2 +7处 / 共 18 |
| `--success-soft` | #ecf3ee | #eaf4ee | #17211c | #16221d | 成功浅底 | src/styles/global.css ×4, src/components/codex/ResetCreditDialog.vue / 共 5 |
| `--warning` | #96682a | #9c681e | #d9a95f | #d9aa63 | 警告实色 | src/styles/global.css ×7, src/components/mfa/MfaModule.vue ×4, src/components/notes/NoteCard.vue ×3 +10处 / 共 30 |
| `--warning-soft` | #f6efdf | #f9f0df | #241e13 | #251f15 | 警告浅底 | src/styles/global.css ×4, src/components/codex/CodexAuthDialog.vue, src/components/fileshare/FileShareModule.vue +2处 / 共 8 |

### 侧栏

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--sidebar-bg` | #eae4db | #e3e5e8 | #1a1917 | #22262e | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） | src/styles/materials.css ×4, src/styles/global.css / 共 5 |
| `--sidebar-hover` | #e2dbd1 | #dadee1 | #282622 | #303743 | 侧栏项悬停底 | src/components/layout/Sidebar.vue ×2, src/components/notes/NotesModule.vue, src/components/settings/SettingsDialog.vue / 共 4 |

### 品牌 / 锁屏

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--brand-knob` | #ffffff | #ffffff | #1d1c1a | #252932 | 品牌标上的高光旋钮/最亮点 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-wash-a` | #fcfaf7 | #fefefe | #1d1c1a | #252932 | 锁屏渐变上端 | src/styles/materials.css / 共 1 |
| `--lock-wash-b` | #eae4db | #e3e5e8 | #22211e | #2b303a | 锁屏渐变下端 | src/styles/materials.css ×2 / 共 2 |

### 毛玻璃 / 浮层

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--frost-bg` | rgba(252, 250, 247, 0.86) | rgba(254, 254, 254, 0.88) | rgba(34, 33, 30, 0.88) | rgba(43, 48, 58, 0.88) | 毛玻璃底栏背景 | src/components/notes/NoteFullscreen.vue / 共 1 |
| `--frost-border` | #e2dbd1 | #d3d5d9 | #30302d | #3e4654 | 毛玻璃底栏描边 | _无人引用_ |
| `--tip-bg` | #26241f | #1f2124 | #efede8 | #eef0f5 | 气泡提示底（深色主题下反转成亮底） | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--tip-fg` | #f2f0ea | #f4f5f6 | #1d1c1a | #252932 | 气泡提示字 | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--toast-bg` | #26241f | #1f2124 | #efede8 | #eef0f5 | toast 底 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-ok` | #9cc4ae | #91c9a6 | #2f7d52 | #2f7d52 | toast 成功色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-err` | #e09a92 | #e28e84 | #b23c37 | #b23c37 | toast 错误色 | src/components/shared/ToastNotification.vue / 共 1 |

### 滚动条 / 选区

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--scrollbar` | rgba(29, 28, 26, 0.16) | rgba(18, 19, 22, 0.16) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | 滚动条滑块 | src/styles/global.css / 共 1 |
| `--scrollbar-hover` | rgba(29, 28, 26, 0.28) | rgba(18, 19, 22, 0.28) | rgba(255, 255, 255, 0.26) | rgba(255, 255, 255, 0.26) | 滚动条悬停 | src/styles/global.css / 共 1 |

### 头像分类色

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--cat-1` | #5f62b8 | #5465c4 | #8a8fd8 | #8c90da | 分类色板 1（紫蓝）：头像/色相钉，六档同明度同彩度 | _无人引用_ |
| `--cat-2` | #7b5fb0 | #735eb8 | #ab8de6 | #ac8fe6 | 分类色板 2（紫） | _无人引用_ |
| `--cat-3` | #a85b7d | #a6587d | #de8fb8 | #dc91b8 | 分类色板 3（玫红） | src/components/mfa/MfaModule.vue / 共 1 |
| `--cat-4` | #937042 | #946e38 | #d8b078 | #d7b17c | 分类色板 4（褐） | _无人引用_ |
| `--cat-5` | #46806b | #3f8067 | #6fc0a0 | #70c1a2 | 分类色板 5（苔绿） | _无人引用_ |
| `--cat-6` | #457f8a | #3b808e | #6fb8c8 | #71b9c9 | 分类色板 6（青蓝） | _无人引用_ |
| `--cat-text` | #ffffff | #ffffff | #171614 | #14171c | 头像色块上的字 | _无人引用_ |

### 文件类型色

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--ft-pdf` | #b8564f | #be4e46 | #f0716b | #ef726d | 文件类型图标色：PDF（红） | _无人引用_ |
| `--ft-doc` | #4a6d9c | #3a689e | #7aa2f7 | #7ca3f7 | 文件类型图标色：文档（蓝） | _无人引用_ |
| `--ft-sheet` | #3f7a5e | #337d57 | #3fb950 | #42ba54 | 文件类型图标色：表格（绿） | _无人引用_ |
| `--ft-deck` | #a0603a | #a65e31 | #e0a45c | #dfa561 | 文件类型图标色：演示（橙） | _无人引用_ |
| `--ft-arch` | #6a5a99 | #6957a0 | #a98be8 | #aa8ce8 | 文件类型图标色：压缩包（紫） | _无人引用_ |
| `--ft-code` | #8a7534 | #8c7324 | #e0c060 | #dfc165 | 文件类型图标色：代码（黄） | _无人引用_ |
| `--ft-mark` | #5e6672 | #586374 | #8c94a6 | #8f96a7 | 文件类型图标色：Markdown（中性灰蓝） | _无人引用_ |
| `--ft-img` | #9a5a72 | #9d5472 | #e08bb8 | #df8cb8 | 文件类型图标色：图片（品红） | _无人引用_ |
| `--ft-unk` | #7a7f88 | #6e7580 | #6b7280 | #8f96a7 | 文件类型图标色：未知（灰） | _无人引用_ |

### 代码语法色

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--code-fg` | #1a1b20 | #191a1d | #e4e2dc | #e2e5eb | 代码块前景/底色字 | src/components/notes/NoteCard.vue, src/components/notes/NoteEditor.vue, src/components/notes/NoteFullscreen.vue / 共 3 |
| `--code-kw` | #9d5275 | #a04975 | #de9ab8 | #dd9cb8 | 语法色：关键字 | src/styles/global.css / 共 1 |
| `--code-str` | #3a7256 | #2f7351 | #6fd0a8 | #72d0a8 | 语法色：字符串 | src/styles/global.css / 共 1 |
| `--code-num` | #96593a | #9b542e | #e0b072 | #deb177 | 语法色：数字 | src/styles/global.css / 共 1 |
| `--code-type` | #7d6a2f | #776422 | #e0c060 | #dec165 | 语法色：类型名 | src/styles/global.css / 共 1 |
| `--code-fn` | #4a6d9c | #3a689e | #8aa8e0 | #8ea9df | 语法色：函数名 | src/styles/global.css / 共 1 |
| `--code-var` | #5e6672 | #586374 | #b6b2a8 | #b8b5ac | 语法色：变量 | src/styles/global.css / 共 1 |
| `--code-com` | #686a73 | #63656f | #9d9991 | #9fa098 | 语法色：注释（最静档，但必须在 --sunken 上可读） | src/styles/global.css / 共 1 |
| `--code-tag` | #6a5a99 | #6957a0 | #ab8de6 | #ac8fe6 | 语法色：标签 | src/styles/global.css / 共 1 |
| `--code-pun` | #5e6168 | #5b606a | #8c94a6 | #8f96a7 | 语法色：标点 | src/styles/global.css / 共 1 |

### 字体

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--font-ui` | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | 界面字族（两底色同值，内置 HarmonyOS Sans SC） | src/components/codex/CodexTodayUsageChart.vue, src/styles/global.css / 共 2 |
| `--font-mono` | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | 等宽字族（Consolas 优先，中文回落族必须接上） | src/components/entries/DetailDialog.vue ×4, src/components/fileshare/FileShareModule.vue ×4, src/components/codex/CodexUsagePanel.vue ×3 +31处 / 共 55 |

## 3. accent 族：17 槽 × 2 极性 × 5 档

同一极的几套底色共用一块（例如纸底和雪底吃到完全相同的 accent 值）；带 ⟨随底⟩ 的槽用了 `var()`/`color-mix()`，会跟着底色走。

| 槽位 | light×ink | dark×ink | light×celadon | dark×celadon | light×clay | dark×clay | light×plum | dark×plum | light×rose | dark×rose |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent` | #315f9b | #7faeee | #246e60 | #73c5ad | #9b562b | #e1a15f | #7951a8 | #bd9ae0 | #9b3f68 | #e991b6 |
| `--accent-hover` | #264c80 | #a0c3f5 | #1c594d | #95d6c4 | #804422 | #edbb87 | #63418d | #d1b7ed | #813255 | #f2afcb |
| `--accent-active` | #1e3d68 | #6692d0 | #16483f | #57a88f | #69361b | #c78848 | #503473 | #a37bc9 | #692846 | #cc7399 |
| `--accent-on` | #ffffff | #121e30 | #ffffff | #10251e | #ffffff | #2b1b0d | #ffffff | #26162f | #ffffff | #301321 |
| `--accent-soft` | #e7eef8 | rgba(127, 174, 238, 0.16) | #e4f1ec | rgba(115, 197, 173, 0.16) | #f8ede2 | rgba(225, 161, 95, 0.16) | #f0eaf8 | rgba(189, 154, 224, 0.16) | #f8e8ef | rgba(233, 145, 182, 0.16) |
| `--accent-light` | #cfdef1 | rgba(127, 174, 238, 0.28) | #c6e5d9 | rgba(115, 197, 173, 0.28) | #eed7bf | rgba(225, 161, 95, 0.28) | #e0d1f0 | rgba(189, 154, 224, 0.28) | #efcedf | rgba(233, 145, 182, 0.28) |
| `--accent-ring` | rgba(49, 95, 155, 0.16) | rgba(127, 174, 238, 0.32) | rgba(36, 110, 96, 0.16) | rgba(115, 197, 173, 0.32) | rgba(155, 86, 43, 0.16) | rgba(225, 161, 95, 0.32) | rgba(121, 81, 168, 0.16) | rgba(189, 154, 224, 0.32) | rgba(155, 63, 104, 0.16) | rgba(233, 145, 182, 0.32) |
| `--text-brand` | #264c80 | #b0cef8 | #1c594d | #a4dfce | #804422 | #f2c799 | #63418d | #dcc6f2 | #813255 | #f6bfd7 |
| `--badge-ver-bg` | #e7eef8 | rgba(127, 174, 238, 0.16) | #e4f1ec | rgba(115, 197, 173, 0.16) | #f8ede2 | rgba(225, 161, 95, 0.16) | #f0eaf8 | rgba(189, 154, 224, 0.16) | #f8e8ef | rgba(233, 145, 182, 0.16) |
| `--badge-ver-text` | #264c80 | #b0cef8 | #1c594d | #a4dfce | #804422 | #f2c799 | #63418d | #dcc6f2 | #813255 | #f6bfd7 |
| `--brand-g1` | #668cbd | #b0cef8 | #62a291 | #a4dfce | #be8655 | #f2c799 | #a17bc7 | #dcc6f2 | #c27394 | #f6bfd7 |
| `--brand-g2` | #315f9b | #7faeee | #246e60 | #73c5ad | #9b562b | #e1a15f | #7951a8 | #bd9ae0 | #9b3f68 | #e991b6 |
| `--brand-g3` | #1e3d68 | #6692d0 | #16483f | #57a88f | #69361b | #c78848 | #503473 | #a37bc9 | #692846 | #cc7399 |
| `--lock-orb-1` | rgba(49, 95, 155, 0.07) | rgba(127, 174, 238, 0.14) | rgba(36, 110, 96, 0.07) | rgba(115, 197, 173, 0.14) | rgba(155, 86, 43, 0.07) | rgba(225, 161, 95, 0.14) | rgba(121, 81, 168, 0.07) | rgba(189, 154, 224, 0.14) | rgba(155, 63, 104, 0.07) | rgba(233, 145, 182, 0.14) |
| `--lock-orb-2` | rgba(49, 95, 155, 0.045) | rgba(127, 174, 238, 0.07) | rgba(36, 110, 96, 0.045) | rgba(115, 197, 173, 0.07) | rgba(155, 86, 43, 0.045) | rgba(225, 161, 95, 0.07) | rgba(121, 81, 168, 0.045) | rgba(189, 154, 224, 0.07) | rgba(155, 63, 104, 0.045) | rgba(233, 145, 182, 0.07) |
| `--selection` | rgba(49, 95, 155, 0.18) | rgba(127, 174, 238, 0.30) | rgba(36, 110, 96, 0.18) | rgba(115, 197, 173, 0.30) | rgba(155, 86, 43, 0.18) | rgba(225, 161, 95, 0.30) | rgba(121, 81, 168, 0.18) | rgba(189, 154, 224, 0.30) | rgba(155, 63, 104, 0.18) | rgba(233, 145, 182, 0.30) |
| `--toast-info` | #96b7df | #315f9b | #92ccb8 | #246e60 | #dbb489 | #9b562b | #c3a4e2 | #7951a8 | #e4a3c0 | #9b3f68 |

## 4. 面族明度阶梯（实色层，换主题时这一族定生死）

| 槽（按纸底 L\* 从高到低排） | 纸底值 | 纸 L\* | 雪底值 | 雪 L\* | 墨底值 | 墨 L\* | 岩底值 | 岩 L\* | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--panel-bg` | #fcfaf7 | 98.3 | #fefefe | 99.7 | #22211e | 12.7 | #2b303a | 19.8 | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） |
| `--bg` | #f8f5f0 | 96.6 | #f1f2f3 | 95.4 | #1d1c1a | 10.3 | #252932 | 16.6 | 窗体画布底（最外层面） |
| `--hover` | #f6f3ee | 95.9 | #f7f8f9 | 97.5 | #282622 | 15.2 | #323844 | 23.4 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） |
| `--sunken` | #f1ede7 | 93.9 | #ebecee | 93.4 | #181716 | 7.8 | #1f232b | 13.6 | 下陷面：输入槽、代码底、字母块、页栏铺底 |
| `--sidebar-bg` | #eae4db | 90.8 | #e3e5e8 | 90.9 | #1a1917 | 8.8 | #22262e | 15.1 | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） |
| `--active` | #eae4db | 90.8 | #e1e3e6 | 90.2 | #343431 | 21.6 | #3b4351 | 28.2 | 行/项按下选中底 |
| `--fill` | #e8e2d9 | 90.1 | #dbdde0 | 88.0 | #2a2927 | 16.6 | #323844 | 23.4 | 中性填充：进度槽、占位块、次级底 |

**从现值反推的阶梯规则（新底色请沿用，别自创一层）**：

- 纸：七档实色面全部挤在 L\*90.1–98.3 这 8.2 的窄窗口内，排序后相邻档差只有 0.0–3.1。**浅色下的"分层"不靠色块明暗，靠发丝描边**：`--border` 比卡面暗 RGB 26、比画布暗 22、比下陷面暗 15。卡面 98.3 最亮但**不用纯白**（255 会把眼睛适应点亮到顶，旁边 93.9 的下陷面就显脏）。
- 纸：`--hover`（L\*95.9）比卡面暗 2.4、比画布还暗 0.7：行悬停是"略微压暗"而不是提亮，且只铺在卡面上（画布/页栏面上的控件悬停走另一档派生值 --hover-chrome，从字色反推 9%）。
- 墨：方向整体反转（面朝"变亮"分层）：`--sunken` 7.8（最底）→ 侧栏 8.8 → 画布 10.3 → 卡面 12.7 → 悬停 15.2 → 填充 16.6 → 按下 21.6。卡面比画布只亮 ΔL\*2.4、比最底的下陷面亮 ΔL\*4.9，**分层主要由 `--border` 发丝描边主担**，墨底描边必须明显亮于卡面。
- 墨：比卡面亮的槽一律在"白方向"上按 ΔL\* 求解（沿用旧差值）；带色相的软底（danger/success/warning-soft）保色相整族 RGB 等比缩放到同一 ΔL\*。不要逐个手调色号——求解器见 `scripts/ink-ladder.mjs`。

## 5. 对比度实测（这是判据，不是建议）

字色对四面（卡面 / 下陷 / 画布 / 侧栏）的对比度：

| 槽 | 纸 | 雪 | 墨 | 岩 | 底线 |
| --- | --- | --- | --- | --- | --- |
| `--text` | 12.29 / 10.98 / 11.78 / 10.14 | 17.09 / 14.58 / 15.38 / 13.66 | 12.66 / 14.08 / 13.39 / 13.82 | 11.59 / 13.79 / 12.76 / 13.28 | ≥4.5 |
| `--text-secondary` | 8.24 / 7.36 / 7.90 / 6.80 | 10.44 / 8.91 / 9.39 / 8.34 | 9.25 / 10.28 / 9.78 / 10.09 | 9.17 / 10.91 / 10.09 / 10.51 | ≥4.5 |
| `--text-muted` | 5.20 / 4.64 / 4.98 / 4.28 | 6.54 / 5.58 / 5.89 / 5.23 | 7.02 / 7.81 / 7.43 / 7.66 | 7.46 / 8.87 / 8.20 / 8.54 | 暗底 ≥5.8 |
| `--text-faint` | 2.92 / 2.61 / 2.80 / 2.41 | 3.53 / 3.01 / 3.17 / 2.82 | 5.66 / 6.30 / 5.99 / 6.18 | 6.48 / 7.70 / 7.13 / 7.42 | 暗底 ≥5.5（已被 5.8 卡过） |
| `--text-url` | 8.24 / 7.36 / 7.90 / 6.80 | 10.44 / 8.91 / 9.39 / 8.34 | 9.44 / 10.50 / 9.98 / 10.30 | 9.17 / 10.91 / 10.09 / 10.51 | ≥4.5 |
| `--danger` | 5.63 / 5.03 / 5.40 / 4.64 | 5.65 / 4.82 / 5.08 / 4.51 | 5.78 / 6.42 / 6.11 / 6.30 | 4.77 / 5.68 / 5.25 / 5.47 | ≥4.5 |
| `--success` | 5.33 / 4.76 / 5.11 / 4.39 | 5.19 / 4.42 / 4.67 / 4.14 | 7.33 / 8.15 / 7.75 / 8.00 | 5.89 / 7.01 / 6.48 / 6.75 | ≥4.5 |
| `--warning` | 4.68 / 4.18 / 4.48 / 3.86 | 4.72 / 4.03 / 4.25 / 3.77 | 7.51 / 8.35 / 7.94 / 8.19 | 6.23 / 7.41 / 6.85 / 7.14 | ≥4.5 |
| `--text-brand` | 8.30 / 7.42 / 7.95 / 6.84 | 8.58 / 7.32 / 7.72 / 6.85 | 9.99 / 11.11 / 10.57 / 10.90 | 8.21 / 9.77 / 9.04 / 9.41 | ≥4.5 |

彩底上的字（`*-on` 与分类/语法色）：

| 前景 | 底色 | 纸 | 雪 | 墨 | 岩 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `--accent-on` | `--accent` 主按钮字 | 6.48 | 6.48 | 7.33 | 7.33 | 白/近黑取底色阶最亮(纸)最暗(墨)一点 |
| `--danger-on` | `--danger` 危险按钮字 | 5.87 | 5.70 | 6.42 | 6.53 | 同上 |
| `--cat-text` | `--cat-1` 头像色板 1 上的字 | 5.35 | 5.20 | 6.03 | 6.09 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-2` 头像色板 2 上的字 | 5.11 | 5.22 | 6.62 | 6.69 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-3` 头像色板 3 上的字 | 4.71 | 4.87 | 7.51 | 7.51 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-4` 头像色板 4 上的字 | 4.53 | 4.62 | 8.96 | 8.96 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-5` 头像色板 5 上的字 | 4.60 | 4.67 | 8.37 | 8.42 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-6` 头像色板 6 上的字 | 4.51 | 4.50 | 8.07 | 8.11 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--ft-pdf` | `--panel-bg` 文件图标色 | 4.50 | 4.77 | 5.58 | 4.60 | ≥3:1（图形件） |
| `--ft-doc` | `--panel-bg` 文件图标色 | 5.09 | 5.70 | 6.39 | 5.32 | ≥3:1（图形件） |
| `--ft-sheet` | `--panel-bg` 文件图标色 | 4.85 | 4.94 | 6.34 | 5.28 | ≥3:1（图形件） |
| `--ft-code` | `--panel-bg` 文件图标色 | 4.31 | 4.53 | 9.11 | 7.53 | ≥3:1（图形件） |
| `--ft-unk` | `--panel-bg` 文件图标色 | 3.86 | 4.61 | 3.33 | 4.47 | ≥3:1（图形件） |
| `--code-fg` | `--sunken` 代码语法色 | 14.74 | 14.72 | 13.82 | 12.48 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-kw` | `--sunken` 代码语法色 | 4.62 | 4.80 | 8.03 | 7.14 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-str` | `--sunken` 代码语法色 | 4.84 | 4.81 | 9.60 | 8.48 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-num` | `--sunken` 代码语法色 | 4.76 | 4.80 | 9.06 | 7.99 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-fn` | `--sunken` 代码语法色 | 4.55 | 4.86 | 7.47 | 6.67 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-com` | `--sunken` 代码语法色 | 4.62 | 4.91 | 6.31 | 5.97 | ≥4.5:1；注释是最静档但仍要可读 |

> 头像行只看色板本身对卡面：`--cat-text` 是色块上的字（纸底白字 / 墨底近黑字），不落在卡面上。

## 6. accent 族推导配方（把 10 组合的现值反推成公式）

用途：**新加一档 accent 只要定一个主色**，其余 16 槽按这里的配方推导；新底色不吃新值——它只需登记进 POLARITY，复用所在极性的这一列。`+白/面色 n%` 指 `color-mix(in srgb, 主色 n%, 参照色)`，`×k` 指 RGB 等比缩放，`αn%` 指主色按 n% 不透明度叠在面上。

| 槽 | 亮极性（代表底：纸） | 暗极性（代表底：墨） |
| --- | --- | --- |
| `--accent-hover` | ink:主色 ×0.82；celadon:主色 ×0.80；clay:主色 ×0.82；plum:主色 ×0.83；rose:主色 ×0.82 | ink:主色 74% + 白 26%；celadon:主色 74% + 白 26%；clay:主色 74% + 白 26%（残差4.185872764319669）；plum:主色 70% + 白 30%；rose:主色 72% + 白 28% |
| `--accent-active` | ink:主色 ×0.66；celadon:主色 ×0.65；clay:主色 ×0.66；plum:主色 ×0.67；rose:主色 ×0.67 | ink:主色 ×0.85（残差6.283185668953607）；celadon:主色 ×0.83（残差8.18441247880142）；clay:主色 ×0.86（残差9.611118252679063）；plum:主色 ×0.86（残差10.150648189539567）；rose:主色 ×0.85（残差8.090475663512791） |
| `--accent-on` | ink:纯白实色；celadon:纯白实色；clay:纯白实色；plum:纯白实色；rose:纯白实色 | ink:主色 ×0.18（残差5.329775155508546）；celadon:主色 ×0.17（残差4.090589656308335）；clay:主色 ×0.18；plum:主色 ×0.19（残差7.641484130531964）；rose:主色 ×0.18（残差7.669848208192697） |
| `--accent-soft` | ink:主色 11% + 白 89%；celadon:主色 12% + 白 88%；clay:主色 + 面色 91%（残差4.469963167823835）；plum:主色 11% + 白 89%；rose:主色 11% + 白 89% | ink:主色 α16%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% |
| `--accent-light` | ink:主色 21% + 白 79%（残差7.231226613357933）；celadon:主色 24% + 白 76%（残差8.293814378308412）；clay:主色 + 面色 76%（残差9.057121956853734）；plum:主色 24% + 白 76%（残差5.990322754072508）；rose:主色 + 面色 80%（残差6.728076264519416） | ink:主色 α28%；celadon:主色 α28%；clay:主色 α28%；plum:主色 α28%；rose:主色 α28% |
| `--accent-ring` | ink:主色 α16%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% | ink:主色 α32%；celadon:主色 α32%；clay:主色 α32%；plum:主色 α32%；rose:主色 α32% |
| `--text-brand` | ink:主色 ×0.82；celadon:主色 ×0.80；clay:主色 ×0.82；plum:主色 ×0.83；rose:主色 ×0.82 | ink:主色 61% + 白 39%；celadon:主色 63% + 白 37%（残差4.365265427108596）；clay:主色 62% + 白 38%（残差5.655761829295898）；plum:主色 55% + 白 45%；rose:主色 57% + 白 43% |
| `--badge-ver-bg` | ink:主色 11% + 白 89%；celadon:主色 12% + 白 88%；clay:主色 + 面色 91%（残差4.469963167823835）；plum:主色 11% + 白 89%；rose:主色 11% + 白 89% | ink:主色 α16%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% |
| `--badge-ver-text` | ink:主色 ×0.82；celadon:主色 ×0.80；clay:主色 ×0.82；plum:主色 ×0.83；rose:主色 ×0.82 | ink:主色 61% + 白 39%；celadon:主色 63% + 白 37%（残差4.365265427108596）；clay:主色 62% + 白 38%（残差5.655761829295898）；plum:主色 55% + 白 45%；rose:主色 57% + 白 43% |
| `--brand-g1` | ink:主色 72% + 白 28%（残差6.425547183351284）；celadon:主色 69% + 白 31%（残差7.532636023210671）；clay:主色 + 面色 25%（残差10.308389266051506）；plum:主色 72% + 白 28%（残差7.044246518879589）；rose:主色 + 面色 31%（残差9.374951794776877） | ink:主色 61% + 白 39%；celadon:主色 63% + 白 37%（残差4.365265427108596）；clay:主色 62% + 白 38%（残差5.655761829295898）；plum:主色 55% + 白 45%；rose:主色 57% + 白 43% |
| `--brand-g2` | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值 | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值 |
| `--brand-g3` | ink:主色 ×0.66；celadon:主色 ×0.65；clay:主色 ×0.66；plum:主色 ×0.67；rose:主色 ×0.67 | ink:主色 ×0.85（残差6.283185668953607）；celadon:主色 ×0.83（残差8.18441247880142）；clay:主色 ×0.86（残差9.611118252679063）；plum:主色 ×0.86（残差10.150648189539567）；rose:主色 ×0.85（残差8.090475663512791） |
| `--lock-orb-1` | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7% | ink:主色 α14%；celadon:主色 α14%；clay:主色 α14%；plum:主色 α14%；rose:主色 α14% |
| `--lock-orb-2` | ink:主色 α5%；celadon:主色 α5%；clay:主色 α5%；plum:主色 α5%；rose:主色 α5% | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7% |
| `--selection` | ink:主色 α18%；celadon:主色 α18%；clay:主色 α18%；plum:主色 α18%；rose:主色 α18% | ink:主色 α30%；celadon:主色 α30%；clay:主色 α30%；plum:主色 α30%；rose:主色 α30% |
| `--toast-info` | ink:主色 47% + 白 53%（残差14.581065149418237）；celadon:主色 45% + 白 55%（残差14.457424125091507）；clay:主色 + 面色 52%（残差13.210097406347472）；plum:主色 47% + 白 53%（残差12.155875342735783）；rose:主色 + 面色 59%（残差15.59482931494594） | ink:主色 ×0.58（残差24.505429455889924）；celadon:主色 ×0.52（残差23.5155130973732）；clay:主色 ×0.62（残差16.152142665155253）；plum:主色 ×0.67（残差21.525704067948155）；rose:主色 ×0.59（残差22.816872314133434） |

读法：纸底的浅水洗底（`--accent-soft` / `--badge-ver-bg`）≈ 主色 10–12% 混白，`--accent-light` ≈ 18–22% 混白，`--accent-ring` 是主色 16% 透明；墨底整族改走半透明（soft 15–16%、light 26–28%、ring 32%、selection 30%），因为墨底上浮层要"透出底下的面"而不是叠一层不透明浅斑。`--accent-hover/active` 纸底是主色等比压暗（×0.82 / ×0.68 上下），墨底反过来提亮（×1.19 上下）。

残差 >4 的格子说明那一档是手工微调过的，不是纯公式产物——新配色可以照公式给初值，再用第 5 节的判据回校。

## 7. 不随主题变化的层（外部稿不必、也不应重新设计）

### 7.1 别名/派生槽 —— `var()` 指向源头，切主题自动跟随

| 槽位 | 定义 |
| --- | --- |
| `--sidebar-border` | var(--border) |
| `--sidebar-active` | var(--accent-soft) |
| `--sidebar-text` | var(--text-secondary) |
| `--sidebar-text-active` | var(--accent) |
| `--ft-bg` | var(--fill) |
| `--code-bg` | var(--sunken) |
| `--code-bd` | var(--border) |
| `--border-focus` | var(--accent) |
| `--text-primary` | var(--text) |
| `--border-line` | var(--border) |
| `--border-card-hover` | var(--border-hover) |
| `--border-input` | var(--border) |
| `--border-divider` | var(--border-subtle) |
| `--text-title` | var(--text) |
| `--text-body` | var(--text-secondary) |
| `--shadow-popover` | var(--shadow-pop) |
| `--radius-card` | var(--radius-lg) |
| `--radius-badge` | var(--radius) |
| `--radius-menu` | var(--radius-lg) |
| `--radius-tag` | var(--radius-sm) |
| `--radius-btn` | var(--radius) |
| `--sidebar-active` | color-mix(in srgb, var(--accent) 15%, var(--sidebar-bg)) |

### 7.2 尺度槽 —— 圆角/间距/字号/动效/布局恒定

| 槽位 | 值 |
| --- | --- |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-8` | 32px |
| `--space-10` | 40px |
| `--space-12` | 48px |
| `--radius-xs` | 4px |
| `--radius-sm` | 6px |
| `--radius-ib` | 9px |
| `--radius` | 10px |
| `--radius-md` | 12px |
| `--radius-lg` | 10px |
| `--radius-xl` | 14px |
| `--radius-pill` | 99px |
| `--text-2xs` | 11px |
| `--text-xs` | 12px |
| `--text-sm` | 13px |
| `--text-base` | 14px |
| `--text-md` | 15px |
| `--text-lg` | 17px |
| `--text-xl` | 20px |
| `--text-2xl` | 24px |
| `--text-3xl` | 30px |
| `--icon-xs-px` | 12px |
| `--icon-sm-px` | 14px |
| `--icon-md-px` | 16px |
| `--icon-tile-px` | 18px |
| `--icon-lg-px` | 20px |
| `--icon-xl-px` | 26px |
| `--dock-clearance` | 96px |
| `--transition-fast` | 0.1s cubic-bezier(0.4, 0, 0.2, 1) |
| `--transition` | 0.15s cubic-bezier(0.4, 0, 0.2, 1) |
| `--transition-slow` | 0.2s cubic-bezier(0.4, 0, 0.2, 1) |
| `--transition-spring` | 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) |
| `--sidebar-w` | 208px |
| `--sidebar-rail-w` | 56px |
| `--page-gutter` | 24px |
| `--scrollbar-track` | 9px |
| `--fs-max` | 1200px |
| `--stream-max` | 1200px |
| `--content-max` | clamp(900px, calc(100vw - 800px), 1120px) |
| `--memo-max-h` | 144px |
| `--rail-w` | 248px |
| `--stream-bar-h` | 64px |
| `--rail-min-room` | 900px |

### 7.3 材质角色 —— 主题提供颜色，氛围开关决定表面策略

以下按源码顺序列出默认定义与状态覆盖。默认定义用于根节点与主题预览的 `.theme-scope`，再叠加当前匹配的 `data-atmosphere` 块；同名槽在不同状态下的值有不同的适用条件。

| 适用选择器 | 槽位 | 定义 |
| --- | --- | --- |
| `:root, .theme-scope` | `--material-tint-primary` | #387ed1 |
| `:root, .theme-scope` | `--material-tint-secondary` | #6d94d4 |
| `:root, .theme-scope` | `--material-grain-image` | url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='deskoGrain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23deskoGrain)' opacity='0.035'/%3E%3C/svg%3E") |
| `:root, .theme-scope` | `--material-grain-size` | 180px 180px |
| `:root, .theme-scope` | `--material-field-primary-size` | 68vw 74vh |
| `:root, .theme-scope` | `--material-field-secondary-size` | 62vw 68vh |
| `:root, .theme-scope` | `--material-field` | var(--material-grain-image) 0 0 / var(--material-grain-size) repeat, radial-gradient(ellipse var(--material-field-primary-size) at 14% 28%, color-mix(in srgb, var(--material-tint-primary) 24%, transparent), transparent 72%), radial-gradient(ellipse var(--material-field-secondary-size) at 86% 82%, color-mix(in srgb, var(--material-tint-secondary) 24%, transparent), transparent 72%) |
| `:root, .theme-scope` | `--material-floating-field` | linear-gradient(color-mix(in srgb, var(--panel-bg) 25%, transparent), color-mix(in srgb, var(--panel-bg) 25%, transparent)), var(--material-field), var(--panel-bg) |
| `:root, .theme-scope` | `--bg-app` | var(--material-field), var(--sunken) |
| `:root, .theme-scope` | `--bg-toolbar` | var(--bg-app) |
| `:root, .theme-scope` | `--bg-sidebar` | var(--sidebar-bg) |
| `:root, .theme-scope` | `--bg-nav-overlay` | var(--sidebar-bg) |
| `:root, .theme-scope` | `--bg-dialog` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-popover` | color-mix(in srgb, var(--panel-bg) 96%, transparent) |
| `:root, .theme-scope` | `--bg-menu` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-dock` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-editor` | var(--bg) |
| `:root, .theme-scope` | `--bg-input` | var(--bg) |
| `:root, .theme-scope` | `--bg-input-focus` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-surface` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-surface-hover` | var(--hover) |
| `:root, .theme-scope` | `--bg-surface-active` | var(--active) |
| `:root, .theme-scope` | `--bg-tag-default` | var(--badge-cat-bg) |
| `:root, .theme-scope` | `--bg-mono-chip` | var(--sunken) |
| `:root, .theme-scope` | `--bg-statusbar` | var(--panel-bg) |
| `:root, .theme-scope` | `--hover-chrome` | color-mix(in srgb, var(--text) 9%, transparent) |
| `:root, .theme-scope` | `--floating-background-attachment` | scroll |
| `:root, .theme-scope` | `--nav-overlay-background-attachment` | scroll |
| `:root, .theme-scope` | `--editor-background-attachment` | scroll |
| `:root, .theme-scope` | `--text-canvas-meta` | var(--text-muted) |
| `:root, .theme-scope` | `--text-nav-label` | var(--text-muted) |
| `:root, .theme-scope` | `--text-nav-section` | var(--text-faint) |
| `:root, .theme-scope` | `--bg-lock` | linear-gradient(135deg, var(--lock-wash-a) 0%, var(--lock-wash-b) 100%) |
| `:root, .theme-scope` | `--bg-lock-wash` | radial-gradient(110% 85% at 50% 40%, var(--lock-wash-b) 0%, var(--bg) 65%), var(--bg) |
| `:root, .theme-scope` | `--bg-lock-aura-primary` | color-mix(in srgb, var(--material-tint-primary) 24%, transparent) |
| `:root, .theme-scope` | `--bg-lock-aura-secondary` | color-mix(in srgb, var(--material-tint-secondary) 18%, transparent) |
| `:root, .theme-scope` | `--bg-lock-aura-neutral` | color-mix(in srgb, var(--panel-bg) 35%, transparent) |
| `:root, .theme-scope` | `--material-decoration-display` | block |
| `:root[data-accent="celadon"], .theme-scope[data-accent="celadon"]` | `--material-tint-primary` | #198c74 |
| `:root[data-accent="celadon"], .theme-scope[data-accent="celadon"]` | `--material-tint-secondary` | #6ebc95 |
| `:root[data-accent="clay"], .theme-scope[data-accent="clay"]` | `--material-tint-primary` | #cf7836 |
| `:root[data-accent="clay"], .theme-scope[data-accent="clay"]` | `--material-tint-secondary` | #dcae50 |
| `:root[data-accent="plum"], .theme-scope[data-accent="plum"]` | `--material-tint-primary` | #8946c6 |
| `:root[data-accent="plum"], .theme-scope[data-accent="plum"]` | `--material-tint-secondary` | #9a6bd0 |
| `:root[data-accent="rose"], .theme-scope[data-accent="rose"]` | `--material-tint-primary` | #ce4f83 |
| `:root[data-accent="rose"], .theme-scope[data-accent="rose"]` | `--material-tint-secondary` | #e68b9d |
| `.theme-scope` | `--material-grain-size` | 18% auto |
| `.theme-scope` | `--material-field-primary-size` | 68% 74% |
| `.theme-scope` | `--material-field-secondary-size` | 62% 68% |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-sidebar` | color-mix(in srgb, var(--sidebar-bg) 18%, transparent) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-nav-overlay` | var(--material-field), var(--sidebar-bg) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-dialog` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-popover` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-menu` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-dock` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-editor` | var(--material-field), var(--bg) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--floating-background-attachment` | fixed |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--nav-overlay-background-attachment` | fixed |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--editor-background-attachment` | fixed |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--text-canvas-meta` | var(--text-secondary) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--text-nav-label` | var(--text-secondary) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--text-nav-section` | var(--text-secondary) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--bg-app` | var(--sunken) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--bg-lock` | var(--bg) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--material-decoration-display` | none |

## 8. 新增一套主题要动的地方（本项目侧，供了解成本）

1. `src/styles/global.css` —— 新底色块补满 96 槽（accent 族那 17 槽填所在极性的缺省档即可）；新 accent 档补齐 2 个极性块
2. `src/services/theme.ts` —— `THEMES` / `ACCENTS` 数组加 ID 与名称，新底色在 `POLARITY` 表登记极性。类型与设置选项由注册表生成；预览直接读取 CSS 颜色与材质，不维护色值副本
3. `scripts/check-theme-coverage.mjs` —— 名单从 `theme.ts` 现读，运行校验即可
4. `e2e/specs/theme.spec.ts` —— `BASES` / `ACCENT_HEX` 锚点表（底色那两列存的是 `rgb(...)` 计算值，不是 hex；`ACCENT_HEX` 按极性键）
5. 截图脚本参数名（`theme-shots.mjs` / `dialog-shots.mjs` / `design-audit.mjs` 等按组合名出图）

**不需要动 Rust**：`src-tauri/src/commands/settings.rs` 与 `e2e/mocks/backend.ts` 的白名单是**键**白名单（`theme` / `accent` 已在列），新增色档不经过它；只有引入新设置键时才改那两处。

## 9. 新配色填空模板

一套**新底色**要填满下面全部 96 个槽（带 ⟨accent⟩ 的 17 个也要给缺省值，它们是 `data-accent` 缺失时的兜底）；
一套**新 accent** 只要给 17 个槽 × 亮/暗两极 = 34 个值，**不必**逐底色给。

```text
# accent 族（17 槽，由覆盖层重填）
--accent = <accent 族，需给亮/暗两档>
--accent-hover = <accent 族，需给亮/暗两档>
--accent-active = <accent 族，需给亮/暗两档>
--accent-on = <accent 族，需给亮/暗两档>
--accent-soft = <accent 族，需给亮/暗两档>
--accent-light = <accent 族，需给亮/暗两档>
--accent-ring = <accent 族，需给亮/暗两档>
--text-brand = <accent 族，需给亮/暗两档>
--badge-ver-bg = <accent 族，需给亮/暗两档>
--badge-ver-text = <accent 族，需给亮/暗两档>
--brand-g1 = <accent 族，需给亮/暗两档>
--brand-g2 = <accent 族，需给亮/暗两档>
--brand-g3 = <accent 族，需给亮/暗两档>
--lock-orb-1 = <accent 族，需给亮/暗两档>
--lock-orb-2 = <accent 族，需给亮/暗两档>
--toast-info = <accent 族，需给亮/暗两档>
--selection = <accent 族，需给亮/暗两档>
# 面 / 底
--bg = 
--panel-bg = 
--chrome-bg = 
--sunken = 
--fill = 
--hover = 
--active = 
--overlay = 
# 文字
--text = 
--text-secondary = 
--text-muted = 
--text-faint = 
--text-url = 
# 描边
--border = 
--border-strong = 
--border-subtle = 
--border-hover = 
# 徽标
--badge-cat-bg = 
--badge-cat-border = 
--badge-cat-text = 
# 投影
--shadow-xs = 
--shadow-card = 
--shadow-sm = 
--shadow = 
--shadow-md = 
--shadow-lg = 
--shadow-pop = 
--shadow-dock = 
# 状态色
--danger = 
--danger-on = 
--danger-hover = 
--danger-soft = 
--danger-border = 
--success = 
--success-soft = 
--warning = 
--warning-soft = 
# 侧栏
--sidebar-bg = 
--sidebar-hover = 
# 品牌 / 锁屏
--brand-knob = 
--lock-wash-a = 
--lock-wash-b = 
# 毛玻璃 / 浮层
--frost-bg = 
--frost-border = 
--tip-bg = 
--tip-fg = 
--toast-bg = 
--toast-ok = 
--toast-err = 
# 滚动条 / 选区
--scrollbar = 
--scrollbar-hover = 
# 头像分类色
--cat-1 = 
--cat-2 = 
--cat-3 = 
--cat-4 = 
--cat-5 = 
--cat-6 = 
--cat-text = 
# 文件类型色
--ft-pdf = 
--ft-doc = 
--ft-sheet = 
--ft-deck = 
--ft-arch = 
--ft-code = 
--ft-mark = 
--ft-img = 
--ft-unk = 
# 代码语法色
--code-fg = 
--code-kw = 
--code-str = 
--code-num = 
--code-type = 
--code-fn = 
--code-var = 
--code-com = 
--code-tag = 
--code-pun = 
# 字体
--font-ui = 
--font-mono = 
```

## 10. 硬性对比度底线（历史裁定，别破）

- 深色主题下小字对比 ≥5.8:1：`--text-muted` 是新卡面上的底线值，`--text-faint` 不得更低。
- `--panel-bg` 与 `--sunken` 的差必须肉眼可分（纸底实测下限约 #fafafa），差 6 级就糊。
- 改 `--panel-bg` 必须同步重切 `--hover`，保持约 5 级差，否则行悬停无反馈。
- `--accent-on / --danger-on / --cat-text / --brand-knob` 是彩底色块上的字，取该底色阶的最亮（纸）/最暗（墨）一点，不跟随主色相。
- 主题块内只放实色；需要跨主题自适应的派生值走 `--hover-chrome` 那类 `color-mix()` 配方写在别名块。

## 11. 贴给外部模型的提示词（连同本文件一起贴过去即可，它不需要项目访问权）

```text

你为一个 Windows 桌面工作台 App 定一套新配色。这个 App 是本地个人工作台（收藏链接 / 小记 / 文件快捷方式 /
局域网传输 / 验证码 / 终端 / 分流清单等模块平等并列），不是保险箱，也不是营销页。
界面实况：左侧 208px 图标+文字导航栏；顶部 44px 标题栏；主区是密集列表或卡片网格，一行一行紧挨着，
单屏常有 10–20 行；每张卡片右下角有 URL 与时间戳两行极小的辅助文字；卡上有小圆角徽标胶囊；
有输入框、下拉、开关、分段控件；有弹窗（宽约 520px）与浮层菜单。屏幕长期亮着、用户是同一人反复长时间使用。


【任务】只做二选一，不要混着给：
  A. 一档新强调色（推荐）：定 1 个主色 hex，按随附清单第 6 节的公式推导其余 16 槽，给亮极性/暗极性两份，共 34 行。**不要按底色逐套给**——同一极性下的几套底色吃的是同一份值。
  B. 一套新底色：按第 9 节模板把 96 个槽逐个给值（带 ⟨accent⟩ 的 17 个也要给缺省值，取它所属极性的那一档）。


【输入】随附的清单文件是唯一事实来源，已含全部槽名、四套底色现值、每个槽涂在哪里、明度阶梯与对比度实测。
你无法访问代码仓库，所以：**槽名必须逐字照抄**，不许自创、不许省略、不许改名、不许合并成一个 CSS 变量。


【输出格式】只要一张表，一行一个：`槽名 = 值`。值用 #rrggbb 或 rgba(r, g, b, a)。
不要输出 CSS、不要输出 JSON、不要写注释、不要解释你改了什么风格。表之后另起一段，只写两件事：
  1) 面族明度阶梯的数值（画布/卡面/下陷/悬停各档的 L*，以及相邻差）；
  2) 强调色主色 → 派生档的推导式（悬停、按下、浅水洗底、焦点环各是主色的百分之几）。


【硬约束，破一条就返工】
- 键集与清单逐字一致。少一个槽不会报错，但切过去那块颜色不动，等于成品有补丁。
- 只给颜色。圆角/间距/字号/动效/布局都有独立体系（清单第 7 节），一律不许碰。
- 值里不许出现 var() 或引用别的槽；需要自适应的派生值本项目自己处理。
- 明度阶梯照第 4 节：浅色那套所有实色面挤在很窄的高 L* 窗口里、深色那套整体反转（面朝变亮分层），
  两轴的分层都由发丝描边主担——所以描边槽必须明显区别于相邻面，别给成一模一样。
- 对比度底线照第 5 节的实测表对齐：深色底上小字 ≥5.8:1，浅色底上正文/说明文字 ≥4.5:1，
  注释一类的"最静"档也必须可读；彩底色块上的字取该色阶最亮或最暗的一点。
- 不许整体转冷、不许近黑画布、不许半透明文字、不许给卡片纯白底（卡面每通道 ≤254：纸 252 / 雪 254 是现有两档）。
- 要做冷底：冷度**只走 Lab 的 b\* 轴，a\* 留在 0 附近**（写成 R<G<B 单调递增会带绿分量，a\* 负到 −1 上下，实机读作"青涩"）。
  intake 对此有闸门：`--bg` 的 b\* 为负即按冷底判，面族＋描边＋文字九槽任一 a\* ≤ −1.0 直接退回。参照已发货的岩底：a\* −0.6～+0.5、b\* −3.1～−6.5。
- 压深 `--sunken` 要连带重算吃在它上面的 `--code-*`（以及带色的 `--ft-*`）对比，按色相保比例压暗顶回 ≥4.5——只交七个面的阶梯不管侧槽是这类稿最常见的漏账。
- 深底上的强调色要提明度、降彩度；直接拿浅色档的 hex 放到深底上会融进底色。
- 交付前自查：把每个"字色 × 它要落的底色"组合按 WCAG 相对亮度算一遍，低于上面底线的自己重调，
  不要把没算过的值交出来。
```

