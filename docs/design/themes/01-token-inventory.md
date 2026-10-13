# desko 主题令牌清单（机器导出）

> 由 `node scripts/theme-tokens-dump.mjs` 从 `src/styles/global.css` 与 `src/**` 现场解析生成，请勿手改。
> 底色槽位 **96** 个，其中跟随 accent 的 **17** 个；底色 4 套 × accent 5 档 = 20 个可见组合，但 accent 覆盖层只按**极性**写，共 10 块。

## 1. 契约与读法（这份文件是自包含的，读它的人不需要项目访问权）

**这份清单怎么用**：
- 第 2 节 = 全部键名逐字列出 + 现有 4 套底色（纸 / 雪 / 墨 / 岩）的当前值，它是**参考系**：新配色必须落在同一套键名上，键名照抄、不许自创也不许省略。
- 第 3 节 = accent 族 17 槽在 10 个极性组合下的当前值。
- 第 4 节 = 面族明度阶梯（每个面的 L\*、相邻档差多少）；第 5 节 = 对比度实测（字色对四面、彩底上的字、语法色对底）——这两节是**判据**，不是风格建议。
- 第 6 节 = 从现值反推出的推导公式：新加一档强调色只需要定 1 个主色，其余 16 槽按公式给。
- 第 7 节 = 不许重设计的东西（别名层跟着源头走，尺度层恒定）。
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
| `--accent` ⟨accent⟩ | #3d5a80 | #3d5a80 | #89a8cd | #89a8cd | 主强调色：主按钮底、链接、激活描边 | src/styles/global.css ×47, src/components/notes/NoteCard.vue ×11, src/components/codex/CodexModule.vue ×7 +29处 / 共 132 |
| `--accent-hover` ⟨accent⟩ | #31496a | #31496a | #a2bcda | #a2bcda | 主强调色悬停（比 accent 深一档） | src/styles/global.css ×5, src/components/auth/SetupPage.vue, src/components/auth/UnlockPage.vue +2处 / 共 9 |
| `--accent-active` ⟨accent⟩ | #283d58 | #283d58 | #6f92ba | #6f92ba | 主强调色按下 | src/components/notes/NoteEditor.vue ×4, src/styles/global.css ×3, src/components/auth/UnlockPage.vue +2处 / 共 10 |
| `--accent-on` ⟨accent⟩ | #ffffff | #ffffff | #171614 | #171614 | accent 底上的文字，恒为最亮/最暗一点 | src/styles/global.css ×7, src/components/codex/CodexModule.vue ×2, src/components/notes/NoteFullscreen.vue ×2 +5处 / 共 16 |
| `--accent-soft` ⟨accent⟩ | #e8eef4 | #e8eef4 | rgba(137, 168, 205, 0.15) | rgba(137, 168, 205, 0.15) | accent 的浅水洗底：选中行、浅色徽标 | src/styles/global.css ×17, src/components/notes/NoteCard.vue ×4, src/components/notes/NoteEditor.vue ×2 +10处 / 共 34 |
| `--accent-light` ⟨accent⟩ | #d3dfeb | #d3dfeb | rgba(137, 168, 205, 0.26) | rgba(137, 168, 205, 0.26) | 比 soft 再重一档的 accent 底 | src/components/codex/CodexUsagePanel.vue ×2, src/components/notes/NoteCard.vue ×2, src/components/entries/EntriesModule.vue +4处 / 共 9 |
| `--accent-ring` ⟨accent⟩ | rgba(61, 90, 128, 0.16) | rgba(61, 90, 128, 0.16) | rgba(137, 168, 205, 0.32) | rgba(137, 168, 205, 0.32) | 焦点环 / 外发光 | src/styles/global.css ×5, src/components/bypass/BypassModule.vue ×2, src/components/mfa/MfaModule.vue ×2 +10处 / 共 21 |
| `--text-brand` ⟨accent⟩ | #31496a | #31496a | #adc6e2 | #adc6e2 | accent 族的文字档（链接、激活标签） | src/styles/global.css ×12, src/components/layout/Sidebar.vue ×2, src/components/entries/EntriesModule.vue +2处 / 共 17 |
| `--badge-ver-bg` ⟨accent⟩ | #e8eef4 | #e8eef4 | rgba(137, 168, 205, 0.15) | rgba(137, 168, 205, 0.15) | 版本胶囊徽标底 | _无人引用_ |
| `--badge-ver-text` ⟨accent⟩ | #31496a | #31496a | #adc6e2 | #adc6e2 | 版本胶囊徽标字 | _无人引用_ |
| `--brand-g1` ⟨accent⟩ | #6c88aa | #6c88aa | #adc6e2 | #adc6e2 | 品牌标渐变上端 | src/components/shared/BrandLogo.vue ×2 / 共 2 |
| `--brand-g2` ⟨accent⟩ | #3d5a80 | #3d5a80 | #89a8cd | #89a8cd | 品牌标渐变中段（= accent） | src/components/shared/BrandLogo.vue / 共 1 |
| `--brand-g3` ⟨accent⟩ | #283d58 | #283d58 | #6f92ba | #6f92ba | 品牌标渐变下端 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-orb-1` ⟨accent⟩ | rgba(61, 90, 128, 0.07) | rgba(61, 90, 128, 0.07) | rgba(137, 168, 205, 0.14) | rgba(137, 168, 205, 0.14) | 画布/锁屏的第一团光晕（也进 --canvas-bg） | src/styles/global.css / 共 1 |
| `--lock-orb-2` ⟨accent⟩ | rgba(61, 90, 128, 0.045) | rgba(61, 90, 128, 0.045) | rgba(137, 168, 205, 0.07) | rgba(137, 168, 205, 0.07) | 画布/锁屏的第二团光晕 | src/styles/global.css / 共 1 |
| `--toast-info` ⟨accent⟩ | #93aecb | #93aecb | #4c6c92 | #4c6c92 | 信息 toast 的图标/文字色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--selection` ⟨accent⟩ | rgba(61, 90, 128, 0.18) | rgba(61, 90, 128, 0.18) | rgba(137, 168, 205, 0.30) | rgba(137, 168, 205, 0.30) | 文本选区底色 | src/styles/global.css / 共 1 |

### 面 / 底

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--bg` | #f8f8f7 | #f8fbfe | #1d1c1a | #191c20 | 窗体画布底（最外层面） | src/styles/global.css ×4, src/components/auth/UnlockPage.vue ×3, src/components/auth/SetupPage.vue ×2 +7处 / 共 16 |
| `--panel-bg` | #fcfcfc | #fefefe | #22211e | #1f2328 | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） | src/styles/global.css ×23, src/components/fileshare/FileShareModule.vue ×5, src/components/settings/SettingsDialog.vue ×5 +12处 / 共 54 |
| `--chrome-bg` | rgba(248, 248, 247, 0.78) | rgba(248, 251, 254, 0.85) | rgba(29, 28, 26, 0.86) | rgba(25, 28, 32, 0.86) | 标题栏一类的半透明吸顶底 | _无人引用_ |
| `--sunken` | #f1f1f0 | #e8ecf2 | #181716 | #15171b | 下陷面：输入槽、代码底、字母块、页栏铺底 | src/styles/global.css ×6, src/components/bypass/BypassModule.vue, src/components/codex/CodexSessionsPanel.vue +1处 / 共 9 |
| `--fill` | #eaeae8 | #e2e5eb | #2a2927 | #272c33 | 中性填充：进度槽、占位块、次级底 | src/styles/global.css ×9, src/components/codex/CodexModule.vue ×3, src/components/codex/CodexBatchDeleteDialog.vue +7处 / 共 20 |
| `--hover` | #f7f7f7 | #f6f9fe | #282622 | #252a30 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） | src/styles/global.css ×15, src/components/notes/NoteEditor.vue ×2, src/components/settings/BackupPane.vue ×2 +9处 / 共 29 |
| `--active` | #eeedeb | #e5e8ee | #343431 | #313740 | 行/项按下选中底 | src/styles/global.css / 共 1 |
| `--overlay` | rgba(29, 28, 26, 0.42) | rgba(20, 22, 25, 0.40) | rgba(0, 0, 0, 0.62) | rgba(0, 0, 0, 0.65) | 遮罩层（弹窗背后的那层压暗） | src/components/entries/EntryFormDialog.vue, src/components/entries/PathsDialog.vue, src/components/files/FileShortcutsModule.vue +3处 / 共 6 |

### 文字

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--text` | #333230 | #202123 | #e6e4de | #e3e6ec | 正文一级字 | src/styles/global.css ×27, src/components/bypass/BypassModule.vue ×8, src/components/settings/SettingsDialog.vue ×6 +29处 / 共 106 |
| `--text-secondary` | #4d4c49 | #424346 | #c7c4bd | #c3c8d2 | 二级字（说明、次要字段） | src/styles/global.css ×24, src/components/codex/CodexModule.vue ×4, src/components/codex/ResetCreditDialog.vue ×4 +20处 / 共 65 |
| `--text-muted` | #6b6a66 | #5d5f63 | #aeaba4 | #abb1be | 三级字（标签、时间戳） | src/styles/global.css ×34, src/components/bypass/BypassModule.vue ×9, src/components/codex/CodexUsagePanel.vue ×7 +30处 / 共 123 |
| `--text-faint` | #95948e | #8d8f93 | #9c9992 | #989fab | 四级字（占位、辅助）——深色下最低 5.8:1 底线 | src/components/bypass/BypassModule.vue ×3, src/components/codex/CodexModule.vue ×3, src/components/codex/CodexSessionsPanel.vue ×3 +18处 / 共 36 |
| `--text-url` | #4d4c49 | #424346 | #c9c6bf | #c5c9d4 | 裸链接字色 | src/components/fileshare/FileShareModule.vue ×3, src/components/entries/EntriesModule.vue, src/components/files/FileShortcutsModule.vue +1处 / 共 6 |

### 描边

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--border` | #e6e6e4 | #dbdfe6 | #30302d | #2d333b | 发丝描边：卡片/输入/分隔，分层主力 | src/styles/global.css ×38, src/components/fileshare/FileShareModule.vue ×9, src/components/notes/NoteEditor.vue ×5 +29处 / 共 112 |
| `--border-strong` | #d5d5d2 | #c6c9d0 | #434340 | #3f4752 | 重描边：需要压住的边界、--shadow 的 1px 环 | src/styles/global.css ×5, src/components/notes/NoteEditor.vue ×3, src/components/settings/SettingsDialog.vue ×2 +6处 / 共 16 |
| `--border-subtle` | #f1f1f0 | #eef2f9 | #252421 | #23272e | 极浅描边（比 --border 更退） | src/components/bypass/BypassModule.vue, src/styles/global.css / 共 2 |
| `--border-hover` | #d5d5d2 | #c6c9d0 | #434340 | #3f4752 | 悬停描边 | src/styles/global.css ×3, src/components/fileshare/FileShareModule.vue, src/components/mfa/MfaModule.vue / 共 5 |

### 徽标

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--badge-cat-bg` | #f0f0ee | #e5e8ee | #252421 | #23272e | 分类胶囊徽标底 | src/styles/global.css / 共 1 |
| `--badge-cat-border` | #e6e6e4 | #dbdfe6 | #30302d | #2d333b | 分类胶囊徽标描边 | _无人引用_ |
| `--badge-cat-text` | #4d4c49 | #424346 | #c7c4bd | #c3c8d2 | 分类胶囊徽标字 | _无人引用_ |

### 投影

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--shadow-xs` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(20, 22, 25, 0.03) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 最小投影 | src/styles/global.css ×3, src/components/auth/UnlockPage.vue, src/components/notes/NoteComposer.vue +1处 / 共 6 |
| `--shadow-card` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(20, 22, 25, 0.03) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 行卡投影（轻量化轮起只留一丝贴地感） | src/styles/global.css ×9, src/components/fileshare/FileShareModule.vue ×2, src/components/mfa/MfaModule.vue ×2 +3处 / 共 17 |
| `--shadow-sm` | 0 1px 3px 0 rgba(29, 28, 26, 0.05) | 0 1px 3px 0 rgba(20, 22, 25, 0.04) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | 小投影 | src/styles/global.css ×4, src/components/notes/NoteCard.vue ×2, src/components/fileshare/FileShareModule.vue +2处 / 共 9 |
| `--shadow` | 0 4px 12px -2px rgba(29, 28, 26, 0.06), 0 0 0 1px #d5d5d2 | 0 4px 12px -2px rgba(20, 22, 25, 0.05), 0 0 0 1px #c6c9d0 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #434340 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #3f4752 | 常规浮层投影（带 1px 描边环） | _无人引用_ |
| `--shadow-md` | 0 6px 16px -6px rgba(29, 28, 26, 0.10) | 0 6px 16px -6px rgba(20, 22, 25, 0.08) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 中投影 | src/styles/global.css ×2, src/components/auth/SetupPage.vue, src/components/mfa/MfaModule.vue / 共 4 |
| `--shadow-lg` | 0 12px 28px -8px rgba(29, 28, 26, 0.14) | 0 12px 28px -8px rgba(20, 22, 25, 0.12) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 大投影 | src/components/auth/SetupPage.vue / 共 1 |
| `--shadow-pop` | 0 16px 36px -8px rgba(29, 28, 26, 0.12), 0 4px 10px -2px rgba(29, 28, 26, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 16px 36px -8px rgba(20, 22, 25, 0.10), 0 4px 10px -2px rgba(20, 22, 25, 0.03), 0 0 0 1px rgba(0, 0, 0, 0.05) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 弹层/菜单投影（最高一档常规浮面） | src/styles/global.css ×5, src/components/notes/NoteEditor.vue ×2, src/components/mfa/MfaModule.vue +2处 / 共 10 |
| `--shadow-dock` | 0 26px 60px -18px rgba(29, 28, 26, 0.32), 0 6px 18px rgba(29, 28, 26, 0.14) | 0 26px 60px -18px rgba(20, 22, 25, 0.28), 0 6px 18px rgba(20, 22, 25, 0.12) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 批量操作药丸投影（高于任何弹层） | src/components/notes/NoteFullscreen.vue, src/styles/global.css / 共 2 |

### 状态色

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--danger` | #a9443c | #b83a30 | #e08079 | #df817c | 危险/删除实色 | src/styles/global.css ×15, src/components/entries/EntryFields.vue ×4, src/components/codex/CodexBatchDeleteDialog.vue ×3 +13处 / 共 40 |
| `--danger-on` | #ffffff | #ffffff | #181716 | #181517 | 危险底上的字 | src/components/layout/TitleBar.vue, src/styles/global.css / 共 2 |
| `--danger-hover` | #8c362f | #992e26 | #ea9d97 | #e89e99 | 危险悬停 | src/components/fileshare/FileShareModule.vue, src/components/tunnel/TunnelModule.vue, src/styles/global.css / 共 3 |
| `--danger-soft` | #f7ece9 | #faecea | #271a17 | #271a19 | 危险浅底 | src/styles/global.css ×8, src/components/fileshare/FileShareModule.vue ×3, src/components/tunnel/TunnelModule.vue ×2 +4处 / 共 17 |
| `--danger-border` | #eacfc8 | #f0cfcb | #462924 | #472927 | 危险描边 | src/components/fileshare/FileShareModule.vue ×2, src/components/entries/DetailDialog.vue, src/components/tunnel/TunnelModule.vue +1处 / 共 5 |
| `--success` | #3d7355 | #2e7a50 | #6fbf95 | #6cbd94 | 成功实色 | src/styles/global.css ×6, src/components/fileshare/FileShareModule.vue ×2, src/modules/settings/FileshareSettings.vue ×2 +6处 / 共 16 |
| `--success-soft` | #ecf3ee | #eaf4ee | #17211c | #16221d | 成功浅底 | src/styles/global.css ×4, src/components/codex/ResetCreditDialog.vue / 共 5 |
| `--warning` | #96682a | #9c681e | #d9a95f | #d9aa63 | 警告实色 | src/styles/global.css ×7, src/components/bypass/BypassModule.vue ×5, src/components/mfa/MfaModule.vue ×4 +8处 / 共 31 |
| `--warning-soft` | #f6efdf | #f9f0df | #241e13 | #251f15 | 警告浅底 | src/styles/global.css ×4, src/components/codex/CodexAuthDialog.vue, src/components/fileshare/FileShareModule.vue +3处 / 共 9 |

### 侧栏

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--sidebar-bg` | #edecea | #e5e8ee | #1a1917 | #17191d | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） | src/styles/global.css ×2, src/components/layout/Sidebar.vue, src/components/notes/NotesModule.vue +1处 / 共 5 |
| `--sidebar-hover` | #e5e5e3 | #e2e5ec | #282622 | #252a30 | 侧栏项悬停底 | src/components/layout/Sidebar.vue ×2, src/components/notes/NotesModule.vue, src/components/settings/SettingsDialog.vue / 共 4 |

### 品牌 / 锁屏

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--brand-knob` | #ffffff | #ffffff | #1d1c1a | #191c20 | 品牌标上的高光旋钮/最亮点 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-wash-a` | #fbfbfa | #fefefe | #1d1c1a | #191c20 | 锁屏渐变上端 | src/styles/global.css / 共 1 |
| `--lock-wash-b` | #edecea | #e5e8ee | #22211e | #1f2328 | 锁屏渐变下端 | src/components/auth/UnlockPage.vue, src/styles/global.css / 共 2 |

### 毛玻璃 / 浮层

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--frost-bg` | rgba(255, 255, 255, 0.86) | rgba(255, 255, 255, 0.88) | rgba(34, 33, 30, 0.88) | rgba(31, 35, 40, 0.88) | 毛玻璃底栏背景 | src/components/notes/NoteFullscreen.vue / 共 1 |
| `--frost-border` | #e6e6e4 | #dbdfe6 | #30302d | #2d333b | 毛玻璃底栏描边 | _无人引用_ |
| `--tip-bg` | #26241f | #202225 | #efede8 | #eef0f5 | 气泡提示底（深色主题下反转成亮底） | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--tip-fg` | #f2f0ea | #f7f8fa | #1d1c1a | #191c20 | 气泡提示字 | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--toast-bg` | #26241f | #202225 | #efede8 | #eef0f5 | toast 底 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-ok` | #9cc4ae | #91c9a6 | #2f7d52 | #2f7d52 | toast 成功色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-err` | #e09a92 | #e28e84 | #b23c37 | #b23c37 | toast 错误色 | src/components/shared/ToastNotification.vue / 共 1 |

### 滚动条 / 选区

| 槽位 | paper（纸） | snow（雪） | ink（墨） | slate（岩） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- |
| `--scrollbar` | rgba(29, 28, 26, 0.16) | rgba(20, 22, 25, 0.14) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | 滚动条滑块 | src/styles/global.css / 共 1 |
| `--scrollbar-hover` | rgba(29, 28, 26, 0.28) | rgba(20, 22, 25, 0.24) | rgba(255, 255, 255, 0.26) | rgba(255, 255, 255, 0.26) | 滚动条悬停 | src/styles/global.css / 共 1 |

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
| `--ft-unk` | #7a7f88 | #6e7580 | #6b7280 | #6d7481 | 文件类型图标色：未知（灰） | _无人引用_ |

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
| `--font-ui` | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | 界面字族（两底色同值，内置 HarmonyOS Sans SC） | src/styles/global.css / 共 1 |
| `--font-mono` | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | 等宽字族（Consolas 优先，中文回落族必须接上） | src/components/codex/CodexModule.vue ×4, src/components/entries/DetailDialog.vue ×4, src/components/fileshare/FileShareModule.vue ×4 +24处 / 共 49 |

## 3. accent 族：17 槽 × 2 极性 × 5 档

同一极的几套底色共用一块（例如纸底和雪底吃到完全相同的 accent 值）；带 ⟨随底⟩ 的槽用了 `var()`/`color-mix()`，会跟着底色走。

| 槽位 | light×ink | dark×ink | light×celadon | dark×celadon | light×clay | dark×clay | light×plum | dark×plum | light×rose | dark×rose |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent` | #3d5a80 | #89a8cd | #3d7355 | #7fb89a | #9a5b33 | #d09a6a | #5f62b8 | #9ba0e8 | #984c64 | #d78aa0 |
| `--accent-hover` | #31496a | #a2bcda | #325f47 | #99c9af | #7f4a29 | #dbb088 | #4e519c | #b2b6ef | #7d3d51 | #e3a3b5 |
| `--accent-active` | #283d58 | #6f92ba | #284c39 | #669b7e | #673b21 | #b8854f | #3f4280 | #8389d6 | #642f3f | #bd7287 |
| `--accent-on` | #ffffff | #171614 | #ffffff | #16211b | #ffffff | #211a12 | #ffffff | #17162a | #ffffff | #241419 |
| `--accent-soft` | #e8eef4 | rgba(137, 168, 205, 0.15) | #e6f0ea | rgba(127, 184, 154, 0.16) | #f5ece4 | rgba(208, 154, 106, 0.16) | #ececf8 | rgba(155, 160, 232, 0.16) | #f6eaee | rgba(215, 138, 160, 0.16) |
| `--accent-light` | #d3dfeb | rgba(137, 168, 205, 0.26) | #cde4d7 | rgba(127, 184, 154, 0.28) | #ecd9c6 | rgba(208, 154, 106, 0.28) | #d9daf0 | rgba(155, 160, 232, 0.28) | #edd7e0 | rgba(215, 138, 160, 0.28) |
| `--accent-ring` | rgba(61, 90, 128, 0.16) | rgba(137, 168, 205, 0.32) | rgba(61, 115, 85, 0.16) | rgba(127, 184, 154, 0.32) | rgba(154, 91, 51, 0.16) | rgba(208, 154, 106, 0.32) | rgba(95, 98, 184, 0.16) | rgba(155, 160, 232, 0.32) | rgba(152, 76, 100, 0.16) | rgba(215, 138, 160, 0.32) |
| `--text-brand` | #31496a | #adc6e2 | #325f47 | #a3d4b8 | #7f4a29 | #e0bb92 | #4e519c | #bcbff2 | #7d3d51 | #ebb3c3 |
| `--badge-ver-bg` | #e8eef4 | rgba(137, 168, 205, 0.15) | #e6f0ea | rgba(127, 184, 154, 0.16) | #f5ece4 | rgba(208, 154, 106, 0.16) | #ececf8 | rgba(155, 160, 232, 0.16) | #f6eaee | rgba(215, 138, 160, 0.16) |
| `--badge-ver-text` | #31496a | #adc6e2 | #325f47 | #a3d4b8 | #7f4a29 | #e0bb92 | #4e519c | #bcbff2 | #7d3d51 | #ebb3c3 |
| `--brand-g1` | #6c88aa | #adc6e2 | #6f9c85 | #a3d4b8 | #b98a63 | #e0bb92 | #8b8ecd | #bcbff2 | #b97a8e | #ebb3c3 |
| `--brand-g2` | #3d5a80 | #89a8cd | #3d7355 | #7fb89a | #9a5b33 | #d09a6a | #5f62b8 | #9ba0e8 | #984c64 | #d78aa0 |
| `--brand-g3` | #283d58 | #6f92ba | #284c39 | #5f9377 | #673b21 | #b8854f | #3f4280 | #7f85cf | #642f3f | #b66a80 |
| `--lock-orb-1` | rgba(61, 90, 128, 0.07) | rgba(137, 168, 205, 0.14) | rgba(61, 115, 85, 0.07) | rgba(127, 184, 154, 0.14) | rgba(154, 91, 51, 0.07) | rgba(208, 154, 106, 0.14) | rgba(95, 98, 184, 0.07) | rgba(155, 160, 232, 0.14) | rgba(152, 76, 100, 0.07) | rgba(215, 138, 160, 0.14) |
| `--lock-orb-2` | rgba(61, 90, 128, 0.045) | rgba(137, 168, 205, 0.07) | rgba(61, 115, 85, 0.045) | rgba(127, 184, 154, 0.07) | rgba(154, 91, 51, 0.045) | rgba(208, 154, 106, 0.07) | rgba(95, 98, 184, 0.045) | rgba(155, 160, 232, 0.07) | rgba(152, 76, 100, 0.045) | rgba(215, 138, 160, 0.07) |
| `--selection` | rgba(61, 90, 128, 0.18) | rgba(137, 168, 205, 0.30) | rgba(61, 115, 85, 0.18) | rgba(127, 184, 154, 0.30) | rgba(154, 91, 51, 0.18) | rgba(208, 154, 106, 0.30) | rgba(95, 98, 184, 0.18) | rgba(155, 160, 232, 0.30) | rgba(152, 76, 100, 0.18) | rgba(215, 138, 160, 0.30) |
| `--toast-info` | #93aecb | #4c6c92 | #9cc4ae | #3f7a5e | #d9b08f | #8a5a2f | #a9abdd | #4e519c | #dca6b7 | #874356 |

## 4. 面族明度阶梯（实色层，换主题时这一族定生死）

| 槽（按纸底 L\* 从高到低排） | 纸底值 | 纸 L\* | 雪底值 | 雪 L\* | 墨底值 | 墨 L\* | 岩底值 | 岩 L\* | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--panel-bg` | #fcfcfc | 99.0 | #fefefe | 99.7 | #22211e | 12.7 | #1f2328 | 13.5 | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） |
| `--bg` | #f8f8f7 | 97.6 | #f8fbfe | 98.5 | #1d1c1a | 10.3 | #191c20 | 10.1 | 窗体画布底（最外层面） |
| `--hover` | #f7f7f7 | 97.2 | #f6f9fe | 97.8 | #282622 | 15.2 | #252a30 | 16.8 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） |
| `--sunken` | #f1f1f0 | 95.1 | #e8ecf2 | 93.3 | #181716 | 7.8 | #15171b | 7.7 | 下陷面：输入槽、代码底、字母块、页栏铺底 |
| `--active` | #eeedeb | 93.8 | #e5e8ee | 91.9 | #343431 | 21.6 | #313740 | 22.8 | 行/项按下选中底 |
| `--sidebar-bg` | #edecea | 93.4 | #e5e8ee | 91.9 | #1a1917 | 8.8 | #17191d | 8.7 | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） |
| `--fill` | #eaeae8 | 92.6 | #e2e5eb | 90.9 | #2a2927 | 16.6 | #272c33 | 17.8 | 中性填充：进度槽、占位块、次级底 |

**从现值反推的阶梯规则（新底色请沿用，别自创一层）**：

- 纸：七档实色面全部挤在 L\*92.6–99.0 这 6.3 的窄窗口内，排序后相邻档差只有 0.3–2.1。**浅色下的"分层"不靠色块明暗，靠发丝描边**：`--border` 比卡面暗 RGB 22、比画布暗 18、比下陷面暗 11。卡面 99.0 最亮但**不用纯白**（255 会把眼睛适应点亮到顶，旁边 95.1 的下陷面就显脏）。
- 纸：`--hover`（L\*97.2）比卡面暗 1.7、比画布还暗 0.3：行悬停是"略微压暗"而不是提亮，且只铺在卡面上（画布/页栏面上的控件悬停走另一档派生值 --hover-chrome，从字色反推 9%）。
- 墨：方向整体反转（面朝"变亮"分层）：`--sunken` 7.8（最底）→ 侧栏 8.8 → 画布 10.3 → 卡面 12.7 → 悬停 15.2 → 填充 16.6 → 按下 21.6。卡面比画布只亮 ΔL\*2.4、比最底的下陷面亮 ΔL\*4.9，**分层主要由 `--border` 发丝描边主担**，墨底描边必须明显亮于卡面。
- 墨：比卡面亮的槽一律在"白方向"上按 ΔL\* 求解（沿用旧差值）；带色相的软底（danger/success/warning-soft）保色相整族 RGB 等比缩放到同一 ΔL\*。不要逐个手调色号——求解器见 `scripts/ink-ladder.mjs`。

## 5. 对比度实测（这是判据，不是建议）

字色对四面（卡面 / 下陷 / 画布 / 侧栏）的对比度：

| 槽 | 纸 | 雪 | 墨 | 岩 | 底线 |
| --- | --- | --- | --- | --- | --- |
| `--text` | 12.48 / 11.33 / 12.05 / 10.85 | 15.98 / 13.59 / 15.52 / 13.13 | 12.66 / 14.08 / 13.39 / 13.82 | 12.64 / 14.35 / 13.67 / 14.08 | ≥4.5 |
| `--text-secondary` | 8.37 / 7.60 / 8.08 / 7.27 | 9.81 / 8.34 / 9.53 / 8.06 | 9.25 / 10.28 / 9.78 / 10.09 | 9.41 / 10.69 / 10.19 / 10.49 | ≥4.5 |
| `--text-muted` | 5.28 / 4.79 / 5.09 / 4.59 | 6.34 / 5.40 / 6.16 / 5.21 | 7.02 / 7.81 / 7.43 / 7.66 | 7.35 / 8.34 / 7.95 / 8.18 | 暗底 ≥5.8 |
| `--text-faint` | 2.96 / 2.69 / 2.86 / 2.58 | 3.21 / 2.73 / 3.12 / 2.64 | 5.66 / 6.30 / 5.99 / 6.18 | 5.93 / 6.74 / 6.42 / 6.61 | 暗底 ≥5.5（已被 5.8 卡过） |
| `--text-url` | 8.37 / 7.60 / 8.08 / 7.27 | 9.81 / 8.34 / 9.53 / 8.06 | 9.44 / 10.50 / 9.98 / 10.30 | 9.54 / 10.83 / 10.32 / 10.63 | ≥4.5 |
| `--danger` | 5.72 / 5.19 / 5.52 / 4.97 | 5.65 / 4.81 / 5.49 / 4.64 | 5.78 / 6.42 / 6.11 / 6.30 | 5.69 / 6.47 / 6.16 / 6.34 | ≥4.5 |
| `--success` | 5.41 / 4.91 / 5.23 / 4.70 | 5.19 / 4.41 / 5.04 / 4.26 | 7.33 / 8.15 / 7.75 / 8.00 | 7.03 / 7.98 / 7.61 / 7.83 | ≥4.5 |
| `--warning` | 4.75 / 4.31 / 4.58 / 4.13 | 4.72 / 4.01 / 4.58 / 3.88 | 7.51 / 8.35 / 7.94 / 8.19 | 7.43 / 8.44 / 8.04 / 8.28 | ≥4.5 |
| `--text-brand` | 8.93 / 8.11 / 8.62 / 7.76 | 9.09 / 7.73 / 8.82 / 7.47 | 9.16 / 10.19 / 9.69 / 10.00 | 8.99 / 10.21 / 9.73 / 10.02 | ≥4.5 |

彩底上的字（`*-on` 与分类/语法色）：

| 前景 | 底色 | 纸 | 雪 | 墨 | 岩 | 判据 |
| --- | --- | --- | --- | --- | --- | --- |
| `--accent-on` | `--accent` 主按钮字 | 7.06 | 7.06 | 7.36 | 7.36 | 白/近黑取底色阶最亮(纸)最暗(墨)一点 |
| `--danger-on` | `--danger` 危险按钮字 | 5.87 | 5.70 | 6.42 | 6.53 | 同上 |
| `--cat-text` | `--cat-1` 头像色板 1 上的字 | 5.35 | 5.20 | 6.03 | 6.09 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-2` 头像色板 2 上的字 | 5.11 | 5.22 | 6.62 | 6.69 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-3` 头像色板 3 上的字 | 4.71 | 4.87 | 7.51 | 7.51 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-4` 头像色板 4 上的字 | 4.53 | 4.62 | 8.96 | 8.96 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-5` 头像色板 5 上的字 | 4.60 | 4.67 | 8.37 | 8.42 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-6` 头像色板 6 上的字 | 4.51 | 4.50 | 8.07 | 8.11 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--ft-pdf` | `--panel-bg` 文件图标色 | 4.57 | 4.77 | 5.58 | 5.49 | ≥3:1（图形件） |
| `--ft-doc` | `--panel-bg` 文件图标色 | 5.17 | 5.70 | 6.39 | 6.35 | ≥3:1（图形件） |
| `--ft-sheet` | `--panel-bg` 文件图标色 | 4.92 | 4.94 | 6.34 | 6.31 | ≥3:1（图形件） |
| `--ft-code` | `--panel-bg` 文件图标色 | 4.38 | 4.53 | 9.11 | 8.99 | ≥3:1（图形件） |
| `--ft-unk` | `--panel-bg` 文件图标色 | 3.92 | 4.61 | 3.33 | 3.36 | ≥3:1（图形件） |
| `--code-fg` | `--sunken` 代码语法色 | 15.21 | 14.68 | 13.82 | 14.22 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-kw` | `--sunken` 代码语法色 | 4.77 | 4.78 | 8.03 | 8.14 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-str` | `--sunken` 代码语法色 | 4.99 | 4.80 | 9.60 | 9.66 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-num` | `--sunken` 代码语法色 | 4.91 | 4.79 | 9.06 | 9.11 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-fn` | `--sunken` 代码语法色 | 4.69 | 4.85 | 7.47 | 7.60 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-com` | `--sunken` 代码语法色 | 4.77 | 4.89 | 6.31 | 6.80 | ≥4.5:1；注释是最静档但仍要可读 |

> 头像行只看色板本身对卡面：`--cat-text` 是色块上的字（纸底白字 / 墨底近黑字），不落在卡面上。

## 6. accent 族推导配方（把 10 组合的现值反推成公式）

用途：**新加一档 accent 只要定一个主色**，其余 16 槽按这里的配方推导；新底色不吃新值——它只需登记进 POLARITY，复用所在极性的这一列。`+白/面色 n%` 指 `color-mix(in srgb, 主色 n%, 参照色)`，`×k` 指 RGB 等比缩放，`αn%` 指主色按 n% 不透明度叠在面上。

| 槽 | 亮极性（代表底：纸） | 暗极性（代表底：墨） |
| --- | --- | --- |
| `--accent-hover` | ink:主色 ×0.82；celadon:主色 ×0.83；clay:主色 ×0.82；plum:主色 ×0.84；rose:主色 ×0.82 | ink:主色 78% + 白 22%；celadon:主色 79% + 白 21%；clay:主色 79% + 白 21%；plum:主色 77% + 白 23%；rose:主色 78% + 白 22% |
| `--accent-active` | ink:主色 ×0.68；celadon:主色 ×0.66；clay:主色 ×0.66；plum:主色 ×0.69；rose:主色 ×0.64 | ink:主色 ×0.87（残差8.835370374530982）；celadon:主色 ×0.83；clay:主色 ×0.86（残差11.97330469469162）；plum:主色 ×0.89（残差7.960927606840102）；rose:主色 ×0.86（残差4.526692271291637） |
| `--accent-on` | ink:纯白实色；celadon:纯白实色；clay:纯白实色；plum:纯白实色；rose:纯白实色 | ink:近黑实色；celadon:主色 ×0.18；clay:主色 ×0.16；plum:主色 ×0.16（残差4.258426857678664）；rose:主色 ×0.16 |
| `--accent-soft` | ink:主色 11% + 白 89%；celadon:主色 12% + 白 88%；clay:主色 12% + 白 88%；plum:主色 12% + 白 88%；rose:主色 11% + 白 89% | ink:主色 α15%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% |
| `--accent-light` | ink:主色 20% + 白 80%（残差5.64775898259046）；celadon:主色 24% + 白 76%（残差5.961827807188627）；clay:主色 25% + 白 75%（残差6.379276612503645）；plum:主色 23% + 白 77%；rose:主色 21% + 白 79% | ink:主色 α26%；celadon:主色 α28%；clay:主色 α28%；plum:主色 α28%；rose:主色 α28% |
| `--accent-ring` | ink:主色 α16%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% | ink:主色 α32%；celadon:主色 α32%；clay:主色 α32%；plum:主色 α32%；rose:主色 α32% |
| `--text-brand` | ink:主色 ×0.82；celadon:主色 ×0.83；clay:主色 ×0.82；plum:主色 ×0.84；rose:主色 ×0.82 | ink:主色 67% + 白 33%（残差4.520193389738665）；celadon:主色 70% + 白 30%（残差6.389742616834241）；clay:主色 71% + 白 29%；plum:主色 67% + 白 33%；rose:主色 63% + 白 37%（残差5.322036686682566） |
| `--badge-ver-bg` | ink:主色 11% + 白 89%；celadon:主色 12% + 白 88%；clay:主色 12% + 白 88%；plum:主色 12% + 白 88%；rose:主色 11% + 白 89% | ink:主色 α15%；celadon:主色 α16%；clay:主色 α16%；plum:主色 α16%；rose:主色 α16% |
| `--badge-ver-text` | ink:主色 ×0.82；celadon:主色 ×0.83；clay:主色 ×0.82；plum:主色 ×0.84；rose:主色 ×0.82 | ink:主色 67% + 白 33%（残差4.520193389738665）；celadon:主色 70% + 白 30%（残差6.389742616834241）；clay:主色 71% + 白 29%；plum:主色 67% + 白 33%；rose:主色 63% + 白 37%（残差5.322036686682566） |
| `--brand-g1` | ink:主色 73% + 白 27%（残差7.436053833806653）；celadon:主色 73% + 白 27%；clay:主色 74% + 白 26%（残差5.469236339613531）；plum:主色 72% + 白 28%；rose:主色 73% + 白 27%（残差4.972568428946374） | ink:主色 67% + 白 33%（残差4.520193389738665）；celadon:主色 70% + 白 30%（残差6.389742616834241）；clay:主色 71% + 白 29%；plum:主色 67% + 白 33%；rose:主色 63% + 白 37%（残差5.322036686682566） |
| `--brand-g2` | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值 | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值 |
| `--brand-g3` | ink:主色 ×0.68；celadon:主色 ×0.66；clay:主色 ×0.66；plum:主色 ×0.69；rose:主色 ×0.64 | ink:主色 ×0.87（残差8.835370374530982）；celadon:主色 ×0.78；clay:主色 ×0.86（残差11.97330469469162）；plum:主色 ×0.86（残差7.428732998869009）；rose:主色 ×0.82（残差6.743003664616097） |
| `--lock-orb-1` | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7% | ink:主色 α14%；celadon:主色 α14%；clay:主色 α14%；plum:主色 α14%；rose:主色 α14% |
| `--lock-orb-2` | ink:主色 α5%；celadon:主色 α5%；clay:主色 α5%；plum:主色 α5%；rose:主色 α5% | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7% |
| `--selection` | ink:主色 α18%；celadon:主色 α18%；clay:主色 α18%；plum:主色 α18%；rose:主色 α18% | ink:主色 α30%；celadon:主色 α30%；clay:主色 α30%；plum:主色 α30%；rose:主色 α30% |
| `--toast-info` | ink:主色 51% + 白 49%（残差12.168008396098287）；celadon:主色 48% + 白 52%（残差8.022383207950213）；clay:主色 50% + 白 50%（残差12.866337199700183）；plum:主色 53% + 白 47%；rose:主色 46% + 白 54%（残差12.419392575928015） | ink:主色 ×0.66（残差14.01080680311847）；celadon:主色 ×0.61（残差14.413807139658886）；clay:主色 ×0.61（残差17.4353584944257）；plum:主色 ×0.59（残差18.65556941101414）；rose:主色 ×0.57（残差12.017904896059164） |

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
| `--bg-app` | var(--bg) |
| `--bg-surface` | var(--panel-bg) |
| `--bg-surface-hover` | var(--hover) |
| `--bg-surface-active` | var(--active) |
| `--hover-chrome` | color-mix(in srgb, var(--text) 9%, transparent) |
| `--bg-sidebar` | var(--sidebar-bg) |
| `--border-focus` | var(--accent) |
| `--text-primary` | var(--text) |
| `--canvas-bg` | radial-gradient(760px 460px at 82% -120px, var(--lock-orb-1), transparent 70%), radial-gradient(620px 420px at 6% -100px, var(--lock-orb-2), transparent 68%), var(--sunken) |
| `--bg-toolbar` | var(--canvas-bg) |
| `--bg-popover` | var(--panel-bg) |
| `--bg-tag-default` | var(--badge-cat-bg) |
| `--bg-mono-chip` | var(--sunken) |
| `--bg-statusbar` | var(--panel-bg) |
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
| `--fs-max` | 900px |
| `--stream-max` | 1200px |
| `--content-max` | clamp(900px, calc(100vw - 800px), 1120px) |
| `--memo-max-h` | 144px |
| `--rail-w` | 248px |
| `--stream-bar-h` | 64px |
| `--rail-min-room` | 900px |

## 8. 新增一套主题要动的地方（本项目侧，供了解成本）

1. `src/styles/global.css` —— 新底色块补满 96 槽（accent 族那 17 槽填所在极性的缺省档即可）；新 accent 档补齐 2 个极性块
2. `src/services/theme.ts` —— `ThemeId` / `AccentId` 联合类型 + `THEMES` / `ACCENTS` 数组加条目（含 `prev` 预览的 7 个字段与 `dot`/`dotInk`，都是 CSS 值的字面量副本，最易漏）+ 新底色要在 `POLARITY` 表登记极性。设置弹窗与取值校验都由这两个数组驱动
3. `scripts/check-theme-coverage.mjs` —— `BASES` / `ACCENTS` / `POLARITIES` 名单
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

