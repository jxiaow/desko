# desko 主题令牌清单（机器导出）

> 由 `node scripts/theme-tokens-dump.mjs` 从 `src/styles/global.css`、`src/styles/materials.css` 与 `src/**` 现场解析生成，请勿手改。
> 底色槽位 **96** 个，其中跟随 accent 的 **17** 个；底色 8 套 × accent 10 档 = 80 个可见组合，但 accent 覆盖层只按**极性**写，共 20 块。

## 1. 契约与读法（这份文件是自包含的，读它的人不需要项目访问权）

**这份清单怎么用**：
- 第 2 节 = 全部键名逐字列出 + 现有 8 套底色（纸 / 雪 / 绢 / 雾 / 墨 / 岩 / 夜 / 苔）的当前值，它是**参考系**：新配色必须落在同一套键名上，键名照抄、不许自创也不许省略。
- 第 3 节 = accent 族 17 槽在 20 个极性组合下的当前值。
- 第 4 节 = 面族明度阶梯（每个面的 L\*、相邻档差多少）；第 5 节 = 对比度实测（字色对四面、彩底上的字、语法色对底）——这两节是**判据**，不是风格建议。
- 第 6 节 = 从现值反推出的推导公式：新加一档强调色只需要定 1 个主色，其余 16 槽按公式给。
- 第 7 节 = 不许重设计的东西（别名层跟着源头走，尺度层恒定；材质层按氛围状态覆盖）。
- 第 9 节 = 交付格式（填空模板，照抄键名回填即可）；第 10 节 = 历史踩过的坑；第 11 节 = 可直接粘贴的任务提示词。

**硬契约**：
- 底色轴 `[data-theme="paper"|"snow"|"linen"|"mist"|"ink"|"slate"|"midnight"|"moss"]` 各填**完全相同的槽位名**，缺一个槽 = 切过去那块颜色不动。
- 第二根轴是**极性** `light` / `dark`，由底色决定（纸/雪/绢/雾=light，墨/岩/夜/苔=dark），用户不能单设。
- accent 覆盖层 `[data-base=x][data-accent=y]` 只许动第 3 节列出的 17 个槽，且 2×10=20 块必须齐全——新增底色**不必**再配一轮 accent，只要在 theme.ts 的 POLARITY 表里登记它属于哪一极。
- 底色块内**只放具体色值**，不许出现 `var()`；accent 块允许 `color-mix()` 引用随底走的槽（如洗底掺 `var(--panel-bg)`）。引用别的槽仍是别名层的活。
- 第 7 节的派生/尺度槽由 `var()` 指向源头，新配色**不要**给它单独给值，除非确实要断开。
- 本项目侧的校验（不需要你执行）：`node scripts/check-theme-coverage.mjs`；行为回归：`npx playwright test e2e/specs/theme.spec.ts`。

## 2. 底色层：全部槽位 × 现有 8 套值

### accent 族（17 槽，由覆盖层重填）

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent` ⟨accent⟩ | #2856c7 | #2856c7 | #2856c7 | #2856c7 | #9bbfff | #9bbfff | #9bbfff | #9bbfff | 主强调色：主按钮底、链接、激活描边 | src/styles/global.css ×46, src/styles/materials.css ×22, src/styles/workspace-themes.css ×14 +41处 / 共 196 |
| `--accent-hover` ⟨accent⟩ | #234bad | #234bad | #234bad | #234bad | #a9c8ff | #a9c8ff | #a9c8ff | #a9c8ff | 主强调色悬停（比 accent 深一档） | src/styles/global.css ×5, src/components/auth/SetupPage.vue, src/components/auth/UnlockPage.vue +2处 / 共 9 |
| `--accent-active` ⟨accent⟩ | #1e4093 | #1e4093 | #1e4093 | #1e4093 | #86a5dc | #86a5dc | #86a5dc | #86a5dc | 主强调色按下 | src/components/notes/NoteEditor.vue ×6, src/styles/global.css ×3, src/styles/workspace-themes.css ×2 +5处 / 共 16 |
| `--accent-on` ⟨accent⟩ | #ffffff | #ffffff | #ffffff | #ffffff | #171b22 | #171b22 | #171b22 | #171b22 | accent 底上的文字，恒为最亮/最暗一点 | src/styles/global.css ×7, src/components/codex/CodexModule.vue ×2, src/components/notes/NoteFullscreen.vue ×2 +7处 / 共 18 |
| `--accent-soft` ⟨accent⟩ | #dde4f6 | #dde4f6 | #dde4f6 | #dde4f6 | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | accent 的浅水洗底：选中行、浅色徽标 | src/styles/global.css ×17, src/components/notes/NoteCard.vue ×4, src/components/notes/NoteEditor.vue ×3 +13处 / 共 37 |
| `--accent-light` ⟨accent⟩ | #c3d0ef | #c3d0ef | #c3d0ef | #c3d0ef | rgba(155, 191, 255, 0.24) | rgba(155, 191, 255, 0.24) | rgba(155, 191, 255, 0.24) | rgba(155, 191, 255, 0.24) | 比 soft 再重一档的 accent 底 | src/components/notes/NoteCard.vue ×2, src/components/entries/EntriesModule.vue, src/components/fileshare/FileShareModule.vue +3处 / 共 7 |
| `--accent-ring` ⟨accent⟩ | rgba(40, 86, 199, 0.2) | rgba(40, 86, 199, 0.2) | rgba(40, 86, 199, 0.2) | rgba(40, 86, 199, 0.2) | rgba(155, 191, 255, 0.36) | rgba(155, 191, 255, 0.36) | rgba(155, 191, 255, 0.36) | rgba(155, 191, 255, 0.36) | 焦点环 / 外发光 | src/styles/global.css ×5, src/components/mfa/MfaModule.vue ×2, src/components/notes/NoteCard.vue ×2 +8处 / 共 18 |
| `--text-brand` ⟨accent⟩ | #234bad | #234bad | #234bad | #234bad | #adcbff | #adcbff | #adcbff | #adcbff | accent 族的文字档（链接、激活标签） | src/styles/global.css ×12, src/components/bypass/BypassModule.vue ×2, src/components/layout/Sidebar.vue ×2 +11处 / 共 28 |
| `--badge-ver-bg` ⟨accent⟩ | #dde4f6 | #dde4f6 | #dde4f6 | #dde4f6 | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | rgba(155, 191, 255, 0.1) | 版本胶囊徽标底 | _无人引用_ |
| `--badge-ver-text` ⟨accent⟩ | #234bad | #234bad | #234bad | #234bad | #adcbff | #adcbff | #adcbff | #adcbff | 版本胶囊徽标字 | _无人引用_ |
| `--brand-g1` ⟨accent⟩ | #6485d7 | #6485d7 | #6485d7 | #6485d7 | #adcbff | #adcbff | #adcbff | #adcbff | 品牌标渐变上端 | src/components/shared/BrandLogo.vue ×2 / 共 2 |
| `--brand-g2` ⟨accent⟩ | #2856c7 | #2856c7 | #2856c7 | #2856c7 | #9bbfff | #9bbfff | #9bbfff | #9bbfff | 品牌标渐变中段（= accent） | src/components/shared/BrandLogo.vue / 共 1 |
| `--brand-g3` ⟨accent⟩ | #1e4093 | #1e4093 | #1e4093 | #1e4093 | #86a5dc | #86a5dc | #86a5dc | #86a5dc | 品牌标渐变下端 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-orb-1` ⟨accent⟩ | rgba(40, 86, 199, 0.07) | rgba(40, 86, 199, 0.07) | rgba(40, 86, 199, 0.07) | rgba(40, 86, 199, 0.07) | rgba(155, 191, 255, 0.14) | rgba(155, 191, 255, 0.14) | rgba(155, 191, 255, 0.14) | rgba(155, 191, 255, 0.14) | 历史光晕色槽（保留主题契约；当前材质由 accent 推导） | _无人引用_ |
| `--lock-orb-2` ⟨accent⟩ | rgba(40, 86, 199, 0.045) | rgba(40, 86, 199, 0.045) | rgba(40, 86, 199, 0.045) | rgba(40, 86, 199, 0.045) | rgba(155, 191, 255, 0.07) | rgba(155, 191, 255, 0.07) | rgba(155, 191, 255, 0.07) | rgba(155, 191, 255, 0.07) | 历史光晕色槽（保留主题契约；当前材质由 accent 推导） | _无人引用_ |
| `--toast-info` ⟨accent⟩ | #91baff | #91baff | #91baff | #91baff | #2856c7 | #2856c7 | #2856c7 | #2856c7 | 信息 toast 的图标/文字色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--selection` ⟨accent⟩ | rgba(40, 86, 199, 0.22) | rgba(40, 86, 199, 0.22) | rgba(40, 86, 199, 0.22) | rgba(40, 86, 199, 0.22) | rgba(155, 191, 255, 0.3) | rgba(155, 191, 255, 0.3) | rgba(155, 191, 255, 0.3) | rgba(155, 191, 255, 0.3) | 文本选区底色 | src/styles/global.css / 共 1 |

### 面 / 底

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--bg` | #fdfcfb | #ffffff | #faf8f4 | #f7fafe | #1b1c1f | #252932 | #34373f | #282b25 | 窗体画布底（最外层面） | src/styles/materials.css ×12, src/styles/workspace-themes.css ×3, src/components/entries/EntryFields.vue +6处 / 共 22 |
| `--panel-bg` | #ffffff | #ffffff | #fffefa | #ffffff | #242529 | #2b303a | #3b3f48 | #30332d | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） | src/styles/materials.css ×17, src/styles/workspace-themes.css ×3 / 共 20 |
| `--chrome-bg` | rgba(253, 252, 251, 0.9) | rgba(255, 255, 255, 0.92) | rgba(250, 248, 244, 0.92) | rgba(247, 250, 254, 0.92) | rgba(27, 28, 31, 0.9) | rgba(37, 41, 50, 0.86) | rgba(52, 55, 63, 0.9) | rgba(40, 43, 37, 0.9) | 标题栏一类的半透明吸顶底 | _无人引用_ |
| `--sunken` | #f8f7f5 | #fafbfc | #f4f1eb | #eff4fa | #141518 | #1f232b | #2e3139 | #22251f | 下陷面：输入槽、代码底、字母块、页栏铺底 | src/styles/materials.css ×7, src/styles/global.css ×4, src/components/codex/CodexUsageShareDialog.vue ×2 +7处 / 共 20 |
| `--fill` | #efede9 | #eff1f4 | #eae6dd | #e4ebf4 | #2d2f34 | #323844 | #444953 | #3b3f36 | 中性填充：进度槽、占位块、次级底 | src/styles/global.css ×9, src/components/codex/CodexModule.vue ×2, src/components/codex/CodexPlanBadge.vue ×2 +13处 / 共 28 |
| `--hover` | #f5f3f0 | #f4f6f8 | #f4f0e8 | #edf3fa | #2c2e33 | #323844 | #444852 | #393d34 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） | src/styles/global.css ×15, src/components/notes/NoteEditor.vue ×2, src/components/notes/NotesModule.vue ×2 +13处 / 共 34 |
| `--active` | #eae7e2 | #e8edf3 | #e9e3d8 | #e0e9f4 | #363940 | #3b4351 | #4b505b | #41463b | 行/项按下选中底 | src/styles/materials.css / 共 1 |
| `--overlay` | rgba(29, 28, 26, 0.42) | rgba(18, 19, 22, 0.42) | rgba(29, 28, 26, 0.42) | rgba(18, 19, 22, 0.42) | rgba(0, 0, 0, 0.62) | rgba(0, 0, 0, 0.65) | rgba(0, 0, 0, 0.65) | rgba(0, 0, 0, 0.62) | 遮罩层（弹窗背后的那层压暗） | src/components/entries/EntryFormDialog.vue, src/components/entries/PathsDialog.vue, src/components/files/FileShortcutsModule.vue +4处 / 共 7 |

### 文字

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--text` | #242321 | #20242b | #302c25 | #263244 | #f1f2f4 | #edf0f6 | #d7dbe4 | #d8dacf | 正文一级字 | src/styles/global.css ×28, src/components/notes/NoteEditor.vue ×9, src/components/settings/SettingsDialog.vue ×8 +45处 / 共 160 |
| `--text-secondary` | #53514d | #4c5664 | #575046 | #4c5b70 | #cbd0d8 | #d2d7e1 | #c6ccd6 | #c1c7b9 | 二级字（说明、次要字段） | src/styles/global.css ×24, src/components/codex/CodexUsagePanel.vue ×6, src/components/notes/NoteEditor.vue ×6 +42处 / 共 121 |
| `--text-muted` | #6d6963 | #667181 | #70685c | #617188 | #adb5c1 | #bbc3d0 | #bbc2cf | #adb6a6 | 三级字（标签、时间戳） | src/styles/global.css ×36, src/components/codex/CodexSessionsPanel.vue ×11, src/components/codex/CodexUsagePanel.vue ×10 +52处 / 共 195 |
| `--text-faint` | #77726c | #727c89 | #776d5f | #697990 | #969fac | #adb6c5 | #a6afbf | #98a18e | 四级字（占位、辅助）——深色下最低 5.8:1 底线 | src/components/codex/CodexTrashPanel.vue ×2, src/components/entries/EntriesModule.vue ×2, src/components/entries/EntryFields.vue ×2 +16处 / 共 26 |
| `--text-url` | #53514d | #4c5664 | #575046 | #4c5b70 | #cbd0d8 | #d2d7e1 | #c6ccd6 | #c1c7b9 | 裸链接字色 | src/components/fileshare/FileShareModule.vue ×3, src/components/entries/EntriesModule.vue, src/components/files/FileShortcutsModule.vue +2处 / 共 7 |

### 描边

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--border` | #e8e5e0 | #e4e8ed | #e6e0d5 | #dce5ef | #35383f | #3e4654 | #505560 | #43493d | 发丝描边：卡片/输入/分隔，分层主力 | src/styles/global.css ×30, src/components/fileshare/FileShareModule.vue ×8, src/components/notes/NoteEditor.vue ×7 +43处 / 共 130 |
| `--border-strong` | #d4cfc7 | #cbd2db | #d1c6b6 | #c2cfdf | #4c525d | #535f71 | #666d7b | #5e6755 | 重描边：需要压住的边界、--shadow 的 1px 环 | src/styles/global.css ×4, src/components/notes/NoteEditor.vue ×3, src/components/settings/SettingsDialog.vue ×2 +8处 / 共 17 |
| `--border-subtle` | #f1efeb | #f0f2f5 | #efebe3 | #eaf0f7 | #2c2e34 | #303743 | #41454f | #353a30 | 极浅描边（比 --border 更退） | src/components/bypass/BypassProbeDialog.vue, src/components/settings/WebAccessPane.vue, src/styles/global.css / 共 3 |
| `--border-hover` | #c9c3ba | #b9c3d0 | #c4b7a4 | #b2c3d9 | #4c525d | #535f71 | #666d7b | #5e6755 | 悬停描边 | src/components/bypass/BypassModule.vue ×2, src/styles/workspace-themes.css ×2, src/components/fileshare/FileShareModule.vue +1处 / 共 6 |

### 徽标

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--badge-cat-bg` | #f0ede6 | #eef2f6 | #eee9df | #e9f0f8 | #2b2d33 | #303743 | #454a55 | #3b4134 | 分类胶囊徽标底 | src/styles/materials.css / 共 1 |
| `--badge-cat-border` | #e4dfd7 | #e4e8ed | #e6e0d5 | #dce5ef | #393d45 | #3e4654 | #59606e | #505947 | 分类胶囊徽标描边 | _无人引用_ |
| `--badge-cat-text` | #53514d | #4c5664 | #575046 | #4c5b70 | #cbd0d8 | #d2d7e1 | #d0d6e1 | #cbd3c1 | 分类胶囊徽标字 | _无人引用_ |

### 投影

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--shadow-xs` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 最小投影 | src/styles/global.css ×3, src/components/auth/SetupPage.vue, src/components/auth/UnlockPage.vue +2处 / 共 7 |
| `--shadow-card` | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | 0 1px 2px 0 rgba(29, 28, 26, 0.04) | 0 1px 2px 0 rgba(18, 19, 22, 0.04) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.05) | 行卡投影（轻量化轮起只留一丝贴地感） | src/components/bypass/BypassModule.vue ×2, src/styles/global.css ×2, src/components/fileshare/FileShareModule.vue +3处 / 共 8 |
| `--shadow-sm` | 0 1px 3px 0 rgba(29, 28, 26, 0.05) | 0 1px 3px 0 rgba(18, 19, 22, 0.05) | 0 1px 3px 0 rgba(29, 28, 26, 0.05) | 0 1px 3px 0 rgba(18, 19, 22, 0.05) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | inset 0 1px 0 rgba(255, 255, 255, 0.07) | 小投影 | src/styles/global.css ×4, src/components/notes/NoteCard.vue ×2, src/components/fileshare/FileShareModule.vue +2处 / 共 9 |
| `--shadow` | 0 4px 12px -2px rgba(29, 28, 26, 0.06), 0 0 0 1px #d4cfc7 | 0 4px 12px -2px rgba(18, 19, 22, 0.06), 0 0 0 1px #cbd2db | 0 4px 12px -2px rgba(29, 28, 26, 0.06), 0 0 0 1px #d1c6b6 | 0 4px 12px -2px rgba(18, 19, 22, 0.06), 0 0 0 1px #c2cfdf | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #4c525d | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #535f71 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #535f71 | 0 4px 14px -2px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 0 0 1px #434340 | 常规浮层投影（带 1px 描边环） | _无人引用_ |
| `--shadow-md` | 0 6px 16px -6px rgba(29, 28, 26, 0.10) | 0 6px 16px -6px rgba(18, 19, 22, 0.10) | 0 6px 16px -6px rgba(29, 28, 26, 0.10) | 0 6px 16px -6px rgba(18, 19, 22, 0.10) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 0 8px 24px -4px rgba(0, 0, 0, 0.65) | 中投影 | src/styles/global.css / 共 1 |
| `--shadow-lg` | 0 12px 28px -8px rgba(29, 28, 26, 0.14) | 0 12px 28px -8px rgba(18, 19, 22, 0.14) | 0 12px 28px -8px rgba(29, 28, 26, 0.14) | 0 12px 28px -8px rgba(18, 19, 22, 0.14) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 0 16px 36px -8px rgba(0, 0, 0, 0.75) | 大投影 | _无人引用_ |
| `--shadow-pop` | 0 16px 36px -8px rgba(29, 28, 26, 0.12), 0 4px 10px -2px rgba(29, 28, 26, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 16px 36px -8px rgba(18, 19, 22, 0.12), 0 4px 10px -2px rgba(18, 19, 22, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 16px 36px -8px rgba(29, 28, 26, 0.12), 0 4px 10px -2px rgba(29, 28, 26, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 16px 36px -8px rgba(18, 19, 22, 0.12), 0 4px 10px -2px rgba(18, 19, 22, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.06) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 0 24px 54px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) | 弹层/菜单投影（最高一档常规浮面） | src/styles/global.css ×5, src/components/notes/NoteEditor.vue ×4, src/components/layout/WebModuleDrawer.vue +3处 / 共 13 |
| `--shadow-dock` | 0 26px 60px -18px rgba(29, 28, 26, 0.32), 0 6px 18px rgba(29, 28, 26, 0.14) | 0 26px 60px -18px rgba(18, 19, 22, 0.32), 0 6px 18px rgba(18, 19, 22, 0.14) | 0 26px 60px -18px rgba(29, 28, 26, 0.32), 0 6px 18px rgba(29, 28, 26, 0.14) | 0 26px 60px -18px rgba(18, 19, 22, 0.32), 0 6px 18px rgba(18, 19, 22, 0.14) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 0 26px 60px -18px rgba(0, 0, 0, 0.9), 0 6px 18px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.09) | 批量操作药丸投影（高于任何弹层） | src/styles/global.css / 共 1 |

### 状态色

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--danger` | #a9443c | #b83a30 | #a4423a | #ab362d | #e08079 | #df817c | #e59894 | #e08079 | 危险/删除实色 | src/styles/global.css ×15, src/components/entries/EntryFields.vue ×4, src/modules/settings/CodexSettings.vue ×4 +18处 / 共 48 |
| `--danger-on` | #ffffff | #ffffff | #ffffff | #ffffff | #141518 | #181517 | #181517 | #181716 | 危险底上的字 | src/components/layout/TitleBar.vue, src/styles/global.css / 共 2 |
| `--danger-hover` | #8c362f | #992e26 | #8c362f | #992e26 | #ea9d97 | #e89e99 | #e89e99 | #ea9d97 | 危险悬停 | src/components/fileshare/FileShareModule.vue, src/components/tunnel/TunnelModule.vue, src/styles/global.css / 共 3 |
| `--danger-soft` | #f7ece9 | #faecea | #f7ece9 | #faecea | #271a17 | #271a19 | #271a19 | #271a17 | 危险浅底 | src/styles/global.css ×8, src/components/fileshare/FileShareModule.vue ×3, src/components/tunnel/TunnelModule.vue ×2 +3处 / 共 16 |
| `--danger-border` | #eacfc8 | #f0cfcb | #eacfc8 | #f0cfcb | #462924 | #472927 | #472927 | #462924 | 危险描边 | src/components/fileshare/FileShareModule.vue ×2, src/components/entries/DetailDialog.vue, src/components/tunnel/TunnelModule.vue +1处 / 共 5 |
| `--success` | #3d7355 | #2e7a50 | #396c50 | #286b46 | #6fbf95 | #6cbd94 | #6cbd94 | #6fbf95 | 成功实色 | src/styles/global.css ×6, src/components/bypass/BypassModule.vue ×2, src/components/fileshare/FileShareModule.vue ×2 +10处 / 共 22 |
| `--success-soft` | #ecf3ee | #eaf4ee | #ecf3ee | #eaf4ee | #17211c | #16221d | #16221d | #17211c | 成功浅底 | src/styles/global.css ×4, src/components/codex/ResetCreditDialog.vue, src/components/layout/TitleBar.vue / 共 6 |
| `--warning` | #96682a | #9c681e | #815924 | #815619 | #d9a95f | #d9aa63 | #d9aa63 | #d9a95f | 警告实色 | src/styles/global.css ×7, src/components/mfa/MfaModule.vue ×4, src/components/notes/NoteCard.vue ×3 +10处 / 共 31 |
| `--warning-soft` | #f6efdf | #f9f0df | #f6efdf | #f9f0df | #241e13 | #251f15 | #251f15 | #241e13 | 警告浅底 | src/styles/global.css ×4, src/components/codex/CodexAuthDialog.vue, src/components/fileshare/FileShareModule.vue +1处 / 共 7 |

### 侧栏

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--sidebar-bg` | #f4f2ee | #f5f7fa | #eee9df | #e9f0f8 | #191a1d | #22262e | #30333b | #252822 | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） | src/styles/materials.css ×3, src/styles/global.css, src/styles/workspace-themes.css / 共 5 |
| `--sidebar-hover` | #eae7e1 | #e9eef4 | #e4ddcf | #dde7f3 | #292b30 | #303743 | #3b3f49 | #33382e | 侧栏项悬停底 | src/components/layout/Sidebar.vue ×2, src/components/notes/NotesModule.vue, src/components/settings/SettingsDialog.vue / 共 4 |

### 品牌 / 锁屏

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--brand-knob` | #ffffff | #ffffff | #ffffff | #ffffff | #1b1c1f | #252932 | #252932 | #1d1c1a | 品牌标上的高光旋钮/最亮点 | src/components/shared/BrandLogo.vue / 共 1 |
| `--lock-wash-a` | #ffffff | #ffffff | #faf8f4 | #f7fafe | #1b1c1f | #252932 | #34373f | #282b25 | 锁屏渐变上端 | src/styles/materials.css / 共 1 |
| `--lock-wash-b` | #f4f2ee | #f5f7fa | #f4f1eb | #eff4fa | #242529 | #2b303a | #2e3139 | #22251f | 锁屏渐变下端 | src/styles/materials.css / 共 1 |

### 毛玻璃 / 浮层

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--frost-bg` | rgba(255, 255, 255, 0.92) | rgba(255, 255, 255, 0.92) | rgba(255, 254, 250, 0.94) | rgba(255, 255, 255, 0.94) | rgba(36, 37, 41, 0.94) | rgba(43, 48, 58, 0.88) | rgba(59, 63, 72, 0.94) | rgba(48, 51, 45, 0.94) | 毛玻璃底栏背景 | src/components/notes/NoteFullscreen.vue / 共 1 |
| `--frost-border` | #e8e5e0 | #e4e8ed | #e6e0d5 | #dce5ef | #35383f | #3e4654 | #505560 | #43493d | 毛玻璃底栏描边 | _无人引用_ |
| `--tip-bg` | #26241f | #1f2124 | #26241f | #1f2124 | #f0f2f5 | #eef0f5 | #eef0f5 | #efede8 | 气泡提示底（深色主题下反转成亮底） | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--tip-fg` | #f2f0ea | #f4f5f6 | #f2f0ea | #f4f5f6 | #1b1c1f | #252932 | #252932 | #1d1c1a | 气泡提示字 | src/components/notes/NoteAttachments.vue, src/styles/global.css / 共 2 |
| `--toast-bg` | #26241f | #1f2124 | #26241f | #1f2124 | #f0f2f5 | #eef0f5 | #eef0f5 | #efede8 | toast 底 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-ok` | #9cc4ae | #91c9a6 | #9cc4ae | #91c9a6 | #2f7d52 | #2f7d52 | #2f7d52 | #2f7d52 | toast 成功色 | src/components/shared/ToastNotification.vue / 共 1 |
| `--toast-err` | #e09a92 | #e28e84 | #e09a92 | #e28e84 | #b23c37 | #b23c37 | #b23c37 | #b23c37 | toast 错误色 | src/components/shared/ToastNotification.vue / 共 1 |

### 滚动条 / 选区

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--scrollbar` | rgba(29, 28, 26, 0.16) | rgba(18, 19, 22, 0.16) | rgba(29, 28, 26, 0.16) | rgba(18, 19, 22, 0.16) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | 滚动条滑块 | src/styles/global.css / 共 1 |
| `--scrollbar-hover` | rgba(29, 28, 26, 0.28) | rgba(18, 19, 22, 0.28) | rgba(29, 28, 26, 0.28) | rgba(18, 19, 22, 0.28) | rgba(255, 255, 255, 0.26) | rgba(255, 255, 255, 0.26) | rgba(255, 255, 255, 0.26) | rgba(255, 255, 255, 0.26) | 滚动条悬停 | src/components/settings/SettingsDialog.vue, src/styles/global.css / 共 2 |

### 头像分类色

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--cat-1` | #5f62b8 | #5465c4 | #5f62b8 | #5465c4 | #8a8fd8 | #8c90da | #8c90da | #8a8fd8 | 分类色板 1（紫蓝）：头像/色相钉，六档同明度同彩度 | _无人引用_ |
| `--cat-2` | #7b5fb0 | #735eb8 | #7b5fb0 | #735eb8 | #ab8de6 | #ac8fe6 | #ac8fe6 | #ab8de6 | 分类色板 2（紫） | _无人引用_ |
| `--cat-3` | #a85b7d | #a6587d | #a85b7d | #a6587d | #de8fb8 | #dc91b8 | #dc91b8 | #de8fb8 | 分类色板 3（玫红） | src/components/mfa/MfaModule.vue / 共 1 |
| `--cat-4` | #937042 | #946e38 | #937042 | #946e38 | #d8b078 | #d7b17c | #d7b17c | #d8b078 | 分类色板 4（褐） | _无人引用_ |
| `--cat-5` | #46806b | #3f8067 | #46806b | #3f8067 | #6fc0a0 | #70c1a2 | #70c1a2 | #6fc0a0 | 分类色板 5（苔绿） | _无人引用_ |
| `--cat-6` | #457f8a | #3b808e | #457f8a | #3b808e | #6fb8c8 | #71b9c9 | #71b9c9 | #6fb8c8 | 分类色板 6（青蓝） | _无人引用_ |
| `--cat-text` | #ffffff | #ffffff | #ffffff | #ffffff | #171614 | #14171c | #14171c | #171614 | 头像色块上的字 | _无人引用_ |

### 文件类型色

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--ft-pdf` | #b8564f | #be4e46 | #9b4842 | #9e413a | #f0716b | #ef726d | #f3918d | #f17771 | 文件类型图标色：PDF（红） | _无人引用_ |
| `--ft-doc` | #4a6d9c | #3a689e | #43638e | #366193 | #7aa2f7 | #7ca3f7 | #88abf8 | #7aa2f7 | 文件类型图标色：文档（蓝） | _无人引用_ |
| `--ft-sheet` | #3f7a5e | #337d57 | #376b53 | #2b6a4a | #3fb950 | #42ba54 | #55c165 | #3fb950 | 文件类型图标色：表格（绿） | _无人引用_ |
| `--ft-deck` | #a0603a | #a65e31 | #8b5432 | #8d502a | #e0a45c | #dfa561 | #dfa561 | #e0a45c | 文件类型图标色：演示（橙） | _无人引用_ |
| `--ft-arch` | #6a5a99 | #6957a0 | #685896 | #66549b | #a98be8 | #aa8ce8 | #b8a0ec | #a98be8 | 文件类型图标色：压缩包（紫） | _无人引用_ |
| `--ft-code` | #8a7534 | #8c7324 | #71602b | #715d1d | #e0c060 | #dfc165 | #dfc165 | #e0c060 | 文件类型图标色：代码（黄） | _无人引用_ |
| `--ft-mark` | #5e6672 | #586374 | #5a626d | #556071 | #8c94a6 | #8f96a7 | #a7acb9 | #949bac | 文件类型图标色：Markdown（中性灰蓝） | _无人引用_ |
| `--ft-img` | #9a5a72 | #9d5472 | #895065 | #8c4b65 | #e08bb8 | #df8cb8 | #e194bd | #e08bb8 | 文件类型图标色：图片（品红） | _无人引用_ |
| `--ft-unk` | #7a7f88 | #6e7580 | #5e6269 | #5a6069 | #6b7280 | #8f96a7 | #a7acb9 | #979ca6 | 文件类型图标色：未知（灰） | _无人引用_ |

### 代码语法色

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--code-fg` | #1a1b20 | #191a1d | #1a1b20 | #191a1d | #e9ecf1 | #e2e5eb | #e2e5eb | #e4e2dc | 代码块前景/底色字 | src/components/notes/NoteCard.vue, src/components/notes/NoteEditor.vue, src/components/notes/NoteFullscreen.vue / 共 3 |
| `--code-kw` | #9d5275 | #a04975 | #904b6c | #95446d | #de9ab8 | #dd9cb8 | #dd9cb8 | #de9ab8 | 语法色：关键字 | src/styles/global.css / 共 1 |
| `--code-str` | #3a7256 | #2f7351 | #376c52 | #2c6b4b | #6fd0a8 | #72d0a8 | #72d0a8 | #6fd0a8 | 语法色：字符串 | src/styles/global.css / 共 1 |
| `--code-num` | #96593a | #9b542e | #8c5336 | #904e2b | #e0b072 | #deb177 | #deb177 | #e0b072 | 语法色：数字 | src/styles/global.css / 共 1 |
| `--code-type` | #7d6a2f | #776422 | #72602b | #705e20 | #e0c060 | #dec165 | #dec165 | #e0c060 | 语法色：类型名 | src/styles/global.css / 共 1 |
| `--code-fn` | #4a6d9c | #3a689e | #43638e | #366193 | #8aa8e0 | #8ea9df | #91ace0 | #8aa8e0 | 语法色：函数名 | src/styles/global.css / 共 1 |
| `--code-var` | #5e6672 | #586374 | #5a626d | #556071 | #b5bdc9 | #b8b5ac | #b8b5ac | #b6b2a8 | 语法色：变量 | src/styles/global.css / 共 1 |
| `--code-com` | #686a73 | #63656f | #5f6069 | #5d5f68 | #9aa3b0 | #9fa098 | #abaca5 | #9f9b93 | 语法色：注释（最静档，但必须在 --sunken 上可读） | src/styles/global.css / 共 1 |
| `--code-tag` | #6a5a99 | #6957a0 | #685896 | #66549b | #ab8de6 | #ac8fe6 | #b89fea | #ab8de6 | 语法色：标签 | src/styles/global.css / 共 1 |
| `--code-pun` | #5e6168 | #5b606a | #5e6168 | #5b606a | #9aa3b0 | #8f96a7 | #a7acb9 | #949bac | 语法色：标点 | src/styles/global.css / 共 1 |

### 字体

| 槽位 | paper（纸） | snow（雪） | linen（绢） | mist（雾） | ink（墨） | slate（岩） | midnight（夜） | moss（苔） | 涂在哪里 | 消费点 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--font-ui` | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | -apple-system, BlinkMacSystemFont, 'Segoe UI', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif | 界面字族（两底色同值，内置 HarmonyOS Sans SC） | src/components/codex/CodexSessionsPanel.vue, src/components/codex/CodexTodayUsageChart.vue, src/components/settings/WebAccessPane.vue +1处 / 共 4 |
| `--font-mono` | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | Consolas, 'JetBrains Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace | 等宽字族（Consolas 优先，中文回落族必须接上） | src/components/codex/CodexUsagePanel.vue ×4, src/components/entries/DetailDialog.vue ×4, src/components/fileshare/FileShareModule.vue ×4 +32处 / 共 62 |

## 3. accent 族：17 槽 × 2 极性 × 10 档

同一极的几套底色共用一块（例如纸底和雪底和绢底和雾底吃到完全相同的 accent 值）；带 ⟨随底⟩ 的槽用了 `var()`/`color-mix()`，会跟着底色走。

| 槽位 | light×ink | dark×ink | light×celadon | dark×celadon | light×clay | dark×clay | light×plum | dark×plum | light×rose | dark×rose | light×teal | dark×teal | light×forest | dark×forest | light×amber | dark×amber | light×coral | dark×coral | light×graphite | dark×graphite |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent` | #2856c7 | #9bbfff | #087662 | #5ed5a9 | #aa4c0c | #ffac6b | #7542c3 | #d3afff | #ac298e | #faa2e1 | #077190 | #5bcee5 | #527221 | #b5cf70 | #7f6608 | #e7c154 | #be3547 | #ffa6b2 | #555c69 | #b7bfcc |
| `--accent-hover` | #234bad | #a9c8ff | #076755 | #75dbb5 | #94420a | #ffb880 | #6639aa | #d9baff | #96247c | #fbafe5 | #06627d | #72d5e9 | #47631d | #bfd684 | #6e5907 | #eaca6c | #a52e3e | #ffb2bd | #4a505b | #c1c8d3 |
| `--accent-active` | #1e4093 | #86a5dc | #065749 | #53b793 | #7e3809 | #da955f | #573190 | #b597dc | #7f1e69 | #d68cc2 | #05546b | #50b1c6 | #3d5418 | #9cb264 | #5e4b06 | #c6a64c | #8d2735 | #da909b | #3f444e | #9da5b1 |
| `--accent-on` | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 | #ffffff | #171b22 |
| `--accent-soft` | #dde4f6 | rgba(155, 191, 255, 0.1) | #d7e9e6 | rgba(94, 213, 169, 0.1) | #f1e2d8 | rgba(255, 172, 107, 0.1) | #e9e1f5 | rgba(211, 175, 255, 0.1) | #f2dded | rgba(250, 162, 225, 0.1) | #d7e8ed | rgba(91, 206, 229, 0.1) | #e3e8db | rgba(181, 207, 112, 0.1) | #ebe7d7 | rgba(231, 193, 84, 0.1) | #f5dfe2 | rgba(255, 166, 178, 0.1) | #e4e5e7 | rgba(183, 191, 204, 0.1) |
| `--accent-light` | #c3d0ef | rgba(155, 191, 255, 0.24) | #bad9d3 | rgba(94, 213, 169, 0.24) | #e7cdbb | rgba(255, 172, 107, 0.24) | #d8caee | rgba(211, 175, 255, 0.24) | #e8c3df | rgba(250, 162, 225, 0.24) | #bad7e0 | rgba(91, 206, 229, 0.24) | #cfd8c1 | rgba(181, 207, 112, 0.24) | #dbd4ba | rgba(231, 193, 84, 0.24) | #edc6cb | rgba(255, 166, 178, 0.24) | #cfd1d5 | rgba(183, 191, 204, 0.24) |
| `--accent-ring` | rgba(40, 86, 199, 0.2) | rgba(155, 191, 255, 0.36) | rgba(8, 118, 98, 0.2) | rgba(94, 213, 169, 0.36) | rgba(170, 76, 12, 0.2) | rgba(255, 172, 107, 0.36) | rgba(117, 66, 195, 0.2) | rgba(211, 175, 255, 0.36) | rgba(172, 41, 142, 0.2) | rgba(250, 162, 225, 0.36) | rgba(7, 113, 144, 0.2) | rgba(91, 206, 229, 0.36) | rgba(82, 114, 33, 0.2) | rgba(181, 207, 112, 0.36) | rgba(127, 102, 8, 0.2) | rgba(231, 193, 84, 0.36) | rgba(190, 53, 71, 0.2) | rgba(255, 166, 178, 0.36) | rgba(85, 92, 105, 0.2) | rgba(183, 191, 204, 0.36) |
| `--text-brand` | #234bad | #adcbff | #076755 | #7bddb8 | #94420a | #ffbb86 | #6639aa | #dbbdff | #96247c | #fbb3e6 | #06627d | #79d7ea | #47631d | #c2d88a | #6e5907 | #ebcc73 | #a52e3e | #ffb6c0 | #4a505b | #c4cbd5 |
| `--badge-ver-bg` | #dde4f6 | rgba(155, 191, 255, 0.1) | #d7e9e6 | rgba(94, 213, 169, 0.1) | #f1e2d8 | rgba(255, 172, 107, 0.1) | #e9e1f5 | rgba(211, 175, 255, 0.1) | #f2dded | rgba(250, 162, 225, 0.1) | #d7e8ed | rgba(91, 206, 229, 0.1) | #e3e8db | rgba(181, 207, 112, 0.1) | #ebe7d7 | rgba(231, 193, 84, 0.1) | #f5dfe2 | rgba(255, 166, 178, 0.1) | #e4e5e7 | rgba(183, 191, 204, 0.1) |
| `--badge-ver-text` | #234bad | #adcbff | #076755 | #7bddb8 | #94420a | #ffbb86 | #6639aa | #dbbdff | #96247c | #fbb3e6 | #06627d | #79d7ea | #47631d | #c2d88a | #6e5907 | #ebcc73 | #a52e3e | #ffb6c0 | #4a505b | #c4cbd5 |
| `--brand-g1` | #6485d7 | #adcbff | #4d9c8e | #7bddb8 | #c27e50 | #ffbb86 | #9c77d4 | #dbbdff | #c365ae | #fbb3e6 | #4c99af | #79d7ea | #82995f | #c2d88a | #a3914d | #ebcc73 | #d06e7b | #ffb6c0 | #858a93 | #c4cbd5 |
| `--brand-g2` | #2856c7 | #9bbfff | #087662 | #5ed5a9 | #aa4c0c | #ffac6b | #7542c3 | #d3afff | #ac298e | #faa2e1 | #077190 | #5bcee5 | #527221 | #b5cf70 | #7f6608 | #e7c154 | #be3547 | #ffa6b2 | #555c69 | #b7bfcc |
| `--brand-g3` | #1e4093 | #86a5dc | #065749 | #53b793 | #7e3809 | #da955f | #573190 | #b597dc | #7f1e69 | #d68cc2 | #05546b | #50b1c6 | #3d5418 | #9cb264 | #5e4b06 | #c6a64c | #8d2735 | #da909b | #3f444e | #9da5b1 |
| `--lock-orb-1` | rgba(40, 86, 199, 0.07) | rgba(155, 191, 255, 0.14) | rgba(8, 118, 98, 0.07) | rgba(94, 213, 169, 0.14) | rgba(170, 76, 12, 0.07) | rgba(255, 172, 107, 0.14) | rgba(117, 66, 195, 0.07) | rgba(211, 175, 255, 0.14) | rgba(172, 41, 142, 0.07) | rgba(250, 162, 225, 0.14) | rgba(7, 113, 144, 0.07) | rgba(91, 206, 229, 0.14) | rgba(82, 114, 33, 0.07) | rgba(181, 207, 112, 0.14) | rgba(127, 102, 8, 0.07) | rgba(231, 193, 84, 0.14) | rgba(190, 53, 71, 0.07) | rgba(255, 166, 178, 0.14) | rgba(85, 92, 105, 0.07) | rgba(183, 191, 204, 0.14) |
| `--lock-orb-2` | rgba(40, 86, 199, 0.045) | rgba(155, 191, 255, 0.07) | rgba(8, 118, 98, 0.045) | rgba(94, 213, 169, 0.07) | rgba(170, 76, 12, 0.045) | rgba(255, 172, 107, 0.07) | rgba(117, 66, 195, 0.045) | rgba(211, 175, 255, 0.07) | rgba(172, 41, 142, 0.045) | rgba(250, 162, 225, 0.07) | rgba(7, 113, 144, 0.045) | rgba(91, 206, 229, 0.07) | rgba(82, 114, 33, 0.045) | rgba(181, 207, 112, 0.07) | rgba(127, 102, 8, 0.045) | rgba(231, 193, 84, 0.07) | rgba(190, 53, 71, 0.045) | rgba(255, 166, 178, 0.07) | rgba(85, 92, 105, 0.045) | rgba(183, 191, 204, 0.07) |
| `--selection` | rgba(40, 86, 199, 0.22) | rgba(155, 191, 255, 0.3) | rgba(8, 118, 98, 0.22) | rgba(94, 213, 169, 0.3) | rgba(170, 76, 12, 0.22) | rgba(255, 172, 107, 0.3) | rgba(117, 66, 195, 0.22) | rgba(211, 175, 255, 0.3) | rgba(172, 41, 142, 0.22) | rgba(250, 162, 225, 0.3) | rgba(7, 113, 144, 0.22) | rgba(91, 206, 229, 0.3) | rgba(82, 114, 33, 0.22) | rgba(181, 207, 112, 0.3) | rgba(127, 102, 8, 0.22) | rgba(231, 193, 84, 0.3) | rgba(190, 53, 71, 0.22) | rgba(255, 166, 178, 0.3) | rgba(85, 92, 105, 0.22) | rgba(183, 191, 204, 0.3) |
| `--toast-info` | #91baff | #2856c7 | #5ed5a9 | #087a65 | #ffac6b | #b04f0c | #d0a9ff | #7542c3 | #fa9cde | #ac298e | #5bcee5 | #087493 | #b5cf70 | #537422 | #e7c154 | #826808 | #ff9aa6 | #be3547 | #b7bfcc | #555c69 |

## 4. 面族明度阶梯（实色层，换主题时这一族定生死）

| 槽（按纸底 L\* 从高到低排） | 纸底值 | 纸 L\* | 雪底值 | 雪 L\* | 绢底值 | 绢 L\* | 雾底值 | 雾 L\* | 墨底值 | 墨 L\* | 岩底值 | 岩 L\* | 夜底值 | 夜 L\* | 苔底值 | 苔 L\* | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--panel-bg` | #ffffff | 100.0 | #ffffff | 100.0 | #fffefa | 99.6 | #ffffff | 100.0 | #242529 | 14.7 | #2b303a | 19.8 | #3b3f48 | 26.6 | #30332d | 20.8 | 卡片/面板/弹窗面（占窗面约七成，刻意非纯白） |
| `--bg` | #fdfcfb | 99.0 | #ffffff | 100.0 | #faf8f4 | 97.6 | #f7fafe | 98.2 | #1b1c1f | 10.3 | #252932 | 16.6 | #34373f | 23.1 | #282b25 | 17.0 | 窗体画布底（最外层面） |
| `--sunken` | #f8f7f5 | 97.3 | #fafbfc | 98.6 | #f4f1eb | 95.2 | #eff4fa | 96.0 | #141518 | 6.8 | #1f232b | 13.6 | #2e3139 | 20.3 | #22251f | 14.2 | 下陷面：输入槽、代码底、字母块、页栏铺底 |
| `--hover` | #f5f3f0 | 95.9 | #f4f6f8 | 96.8 | #f4f0e8 | 94.9 | #edf3fa | 95.6 | #2c2e33 | 18.9 | #323844 | 23.4 | #444852 | 30.6 | #393d34 | 25.1 | 行/卡片悬停底（必须与 --panel-bg 保持约 5 级差） |
| `--sidebar-bg` | #f4f2ee | 95.5 | #f5f7fa | 97.2 | #eee9df | 92.5 | #e9f0f8 | 94.5 | #191a1d | 9.3 | #22262e | 15.1 | #30333b | 21.3 | #252822 | 15.6 | 侧栏底（纸：比画布略深；墨：落在画布与卡面之间） |
| `--fill` | #efede9 | 93.8 | #eff1f4 | 95.1 | #eae6dd | 91.4 | #e4ebf4 | 92.8 | #2d2f34 | 19.4 | #323844 | 23.4 | #444953 | 30.9 | #3b3f36 | 26.0 | 中性填充：进度槽、占位块、次级底 |
| `--active` | #eae7e2 | 91.7 | #e8edf3 | 93.5 | #e9e3d8 | 90.4 | #e0e9f4 | 92.0 | #363940 | 23.9 | #3b4351 | 28.2 | #4b505b | 34.0 | #41463b | 29.0 | 行/项按下选中底 |

**从现值反推的阶梯规则（新底色请沿用，别自创一层）**：

- 纸：七档实色面全部挤在 L\*91.7–100.0 这 8.3 的窄窗口内，排序后相邻档差只有 0.4–2.1。**浅色下的"分层"不靠色块明暗，靠发丝描边**：`--border` 比卡面暗 RGB 23、比画布暗 21、比下陷面暗 16。卡面 100.0 最亮但**不用纯白**（255 会把眼睛适应点亮到顶，旁边 97.3 的下陷面就显脏）。
- 纸：`--hover`（L\*95.9）比卡面暗 4.1、比画布还暗 3.1：行悬停是"略微压暗"而不是提亮，且只铺在卡面上（画布/页栏面上的控件悬停走另一档派生值 --hover-chrome，从字色反推 9%）。
- 墨：方向整体反转（面朝"变亮"分层）：`--sunken` 6.8（最底）→ 侧栏 9.3 → 画布 10.3 → 卡面 14.7 → 悬停 18.9 → 填充 19.4 → 按下 23.9。卡面比画布只亮 ΔL\*4.4、比最底的下陷面亮 ΔL\*7.9，**分层主要由 `--border` 发丝描边主担**，墨底描边必须明显亮于卡面。
- 墨：比卡面亮的槽一律在"白方向"上按 ΔL\* 求解（沿用旧差值）；带色相的软底（danger/success/warning-soft）保色相整族 RGB 等比缩放到同一 ΔL\*。不要逐个手调色号——求解器见 `scripts/ink-ladder.mjs`。

## 5. 对比度实测（这是判据，不是建议）

字色对四面（卡面 / 下陷 / 画布 / 侧栏）的对比度：

| 槽 | 纸 | 雪 | 绢 | 雾 | 墨 | 岩 | 夜 | 苔 | 底线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--text` | 15.70 / 14.67 / 15.32 / 14.04 | 15.57 / 15.03 / 15.57 / 14.51 | 13.76 / 12.31 / 13.09 / 11.47 | 12.95 / 11.71 / 12.37 / 11.27 | 13.67 / 16.30 / 15.21 / 15.53 | 11.59 / 13.79 / 12.76 / 13.28 | 7.61 / 9.38 / 8.58 / 9.11 | 9.07 / 10.98 / 10.15 / 10.57 | ≥4.5 |
| `--text-secondary` | 7.92 / 7.40 / 7.73 / 7.08 | 7.44 / 7.18 / 7.44 / 6.93 | 7.88 / 7.05 / 7.50 / 6.57 | 6.91 / 6.25 / 6.60 / 6.02 | 9.88 / 11.78 / 11.00 / 11.23 | 9.17 / 10.91 / 10.09 / 10.51 | 6.54 / 8.06 / 7.37 / 7.83 | 7.41 / 8.97 / 8.30 / 8.64 | ≥4.5 |
| `--text-muted` | 5.45 / 5.09 / 5.32 / 4.88 | 4.95 / 4.78 / 4.95 / 4.61 | 5.44 / 4.87 / 5.18 / 4.54 | 4.97 / 4.49 / 4.75 / 4.33 | 7.40 / 8.83 / 8.24 / 8.42 | 7.46 / 8.87 / 8.20 / 8.54 | 5.89 / 7.27 / 6.65 / 7.06 | 6.12 / 7.41 / 6.85 / 7.13 | 暗底 ≥5.8 |
| `--text-faint` | 4.76 / 4.45 / 4.65 / 4.26 | 4.23 / 4.09 / 4.23 / 3.95 | 5.03 / 4.50 / 4.79 / 4.20 | 4.43 / 4.01 / 4.23 / 3.86 | 5.72 / 6.83 / 6.37 / 6.51 | 6.48 / 7.70 / 7.13 / 7.42 | 4.78 / 5.89 / 5.39 / 5.72 | 4.78 / 5.78 / 5.35 / 5.57 | 暗底 ≥5.5（已被 5.8 卡过） |
| `--text-url` | 7.92 / 7.40 / 7.73 / 7.08 | 7.44 / 7.18 / 7.44 / 6.93 | 7.88 / 7.05 / 7.50 / 6.57 | 6.91 / 6.25 / 6.60 / 6.02 | 9.88 / 11.78 / 11.00 / 11.23 | 9.17 / 10.91 / 10.09 / 10.51 | 6.54 / 8.06 / 7.37 / 7.83 | 7.41 / 8.97 / 8.30 / 8.64 | ≥4.5 |
| `--danger` | 5.87 / 5.48 / 5.73 / 5.25 | 5.70 / 5.50 / 5.70 / 5.31 | 6.09 / 5.45 / 5.79 / 5.08 | 6.37 / 5.76 / 6.08 / 5.55 | 5.49 / 6.55 / 6.11 / 6.24 | 4.77 / 5.68 / 5.25 / 5.47 | 4.65 / 5.73 / 5.24 / 5.56 | 4.60 / 5.57 / 5.15 / 5.36 | ≥4.5 |
| `--success` | 5.55 / 5.19 / 5.42 / 4.97 | 5.23 / 5.05 / 5.23 / 4.87 | 6.06 / 5.42 / 5.76 / 5.05 | 6.40 / 5.79 / 6.11 / 5.57 | 6.97 / 8.31 / 7.76 / 7.92 | 5.89 / 7.01 / 6.48 / 6.75 | 4.69 / 5.79 / 5.30 / 5.62 | 5.84 / 7.07 / 6.54 / 6.80 | ≥4.5 |
| `--warning` | 4.87 / 4.55 / 4.75 / 4.36 | 4.76 / 4.59 / 4.76 / 4.43 | 6.14 / 5.50 / 5.84 / 5.12 | 6.41 / 5.79 / 6.12 / 5.58 | 7.14 / 8.51 / 7.94 / 8.11 | 6.23 / 7.41 / 6.85 / 7.14 | 4.96 / 6.12 / 5.60 / 5.94 | 5.98 / 7.24 / 6.69 / 6.97 | ≥4.5 |
| `--text-brand` | 7.83 / 7.32 / 7.64 / 7.00 | 7.83 / 7.56 / 7.83 / 7.30 | 7.76 / 6.95 / 7.38 / 6.47 | 7.83 / 7.08 / 7.48 / 6.82 | 9.30 / 11.10 / 10.36 / 10.58 | 8.04 / 9.57 / 8.85 / 9.22 | 6.41 / 7.91 / 7.23 / 7.68 | 7.80 / 9.44 / 8.73 / 9.08 | ≥4.5 |

彩底上的字（`*-on` 与分类/语法色）：

| 前景 | 底色 | 纸 | 雪 | 绢 | 雾 | 墨 | 岩 | 夜 | 苔 | 判据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `--accent-on` | `--accent` 主按钮字 | 6.47 | 6.47 | 6.47 | 6.47 | 9.28 | 9.28 | 9.28 | 9.28 | 白/近黑取底色阶最亮(纸)最暗(墨)一点 |
| `--danger-on` | `--danger` 危险按钮字 | 5.87 | 5.70 | 6.14 | 6.37 | 6.55 | 6.53 | 7.99 | 6.42 | 同上 |
| `--cat-text` | `--cat-1` 头像色板 1 上的字 | 5.35 | 5.20 | 5.35 | 5.20 | 6.03 | 6.09 | 6.09 | 6.03 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-2` 头像色板 2 上的字 | 5.11 | 5.22 | 5.11 | 5.22 | 6.62 | 6.69 | 6.69 | 6.62 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-3` 头像色板 3 上的字 | 4.71 | 4.87 | 4.71 | 4.87 | 7.51 | 7.51 | 7.51 | 7.51 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-4` 头像色板 4 上的字 | 4.53 | 4.62 | 4.53 | 4.62 | 8.96 | 8.96 | 8.96 | 8.96 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-5` 头像色板 5 上的字 | 4.60 | 4.67 | 4.60 | 4.67 | 8.37 | 8.42 | 8.42 | 8.37 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--cat-text` | `--cat-6` 头像色板 6 上的字 | 4.51 | 4.50 | 4.51 | 4.50 | 8.07 | 8.11 | 8.11 | 8.07 | 色块上的字：纸底白字 / 墨底近黑字；六档色板本身要求同明度同彩度 |
| `--ft-pdf` | `--panel-bg` 文件图标色 | 4.69 | 4.81 | 6.12 | 6.42 | 5.31 | 4.60 | 4.64 | 4.65 | ≥3:1（图形件） |
| `--ft-doc` | `--panel-bg` 文件图标色 | 5.30 | 5.75 | 6.10 | 6.39 | 6.08 | 5.32 | 4.64 | 5.09 | ≥3:1（图形件） |
| `--ft-sheet` | `--panel-bg` 文件图标色 | 5.05 | 4.99 | 6.14 | 6.44 | 6.03 | 5.28 | 4.62 | 5.05 | ≥3:1（图形件） |
| `--ft-code` | `--panel-bg` 文件图标色 | 4.49 | 4.57 | 6.10 | 6.39 | 8.66 | 7.53 | 6.01 | 7.26 | ≥3:1（图形件） |
| `--ft-unk` | `--panel-bg` 文件图标色 | 4.02 | 4.65 | 6.07 | 6.34 | 3.17 | 4.47 | 4.64 | 4.66 | ≥3:1（图形件） |
| `--code-fg` | `--sunken` 代码语法色 | 16.06 | 16.80 | 15.25 | 15.74 | 15.42 | 12.48 | 10.31 | 11.99 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-kw` | `--sunken` 代码语法色 | 5.03 | 5.47 | 5.46 | 5.71 | 8.19 | 7.14 | 5.90 | 6.97 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-str` | `--sunken` 代码语法色 | 5.27 | 5.49 | 5.43 | 5.73 | 9.79 | 8.48 | 7.00 | 8.33 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-num` | `--sunken` 代码语法色 | 5.18 | 5.48 | 5.47 | 5.74 | 9.24 | 7.99 | 6.60 | 7.85 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-fn` | `--sunken` 代码语法色 | 4.95 | 5.55 | 5.46 | 5.78 | 7.61 | 6.67 | 5.69 | 6.48 | ≥4.5:1；注释是最静档但仍要可读 |
| `--code-com` | `--sunken` 代码语法色 | 5.03 | 5.60 | 5.54 | 5.75 | 7.16 | 5.97 | 5.68 | 5.61 | ≥4.5:1；注释是最静档但仍要可读 |

> 头像行只看色板本身对卡面：`--cat-text` 是色块上的字（纸底白字 / 墨底近黑字），不落在卡面上。

## 6. accent 族推导配方（把 20 组合的现值反推成公式）

用途：**新加一档 accent 只要定一个主色**，其余 16 槽按这里的配方推导；新底色不吃新值——它只需登记进 POLARITY，复用所在极性的这一列。`+白/面色 n%` 指 `color-mix(in srgb, 主色 n%, 参照色)`，`×k` 指 RGB 等比缩放，`αn%` 指主色按 n% 不透明度叠在面上。

| 槽 | 亮极性（代表底：纸） | 暗极性（代表底：墨） |
| --- | --- | --- |
| `--accent-hover` | ink:主色 ×0.87；celadon:主色 ×0.87；clay:主色 ×0.87；plum:主色 ×0.87；rose:主色 ×0.87；teal:主色 ×0.87；forest:主色 ×0.87；amber:主色 ×0.87；coral:主色 ×0.87；graphite:主色 ×0.87 | ink:主色 86% + 白 14%；celadon:主色 86% + 白 14%；clay:主色 86% + 白 14%；plum:主色 86% + 白 14%；rose:主色 86% + 白 14%；teal:主色 86% + 白 14%；forest:主色 86% + 白 14%；amber:主色 86% + 白 14%；coral:主色 86% + 白 14%；graphite:主色 86% + 白 14% |
| `--accent-active` | ink:主色 ×0.74；celadon:主色 ×0.74；clay:主色 ×0.74；plum:主色 ×0.74；rose:主色 ×0.74；teal:主色 ×0.74；forest:主色 ×0.74；amber:主色 ×0.74；coral:主色 ×0.74；graphite:主色 ×0.74 | ink:主色 ×0.86；celadon:主色 + 面色 17%；clay:主色 + 面色 17%；plum:主色 ×0.86；rose:主色 + 面色 17%；teal:主色 ×0.86；forest:主色 + 面色 17%；amber:主色 + 面色 17%；coral:主色 + 面色 17%；graphite:主色 + 面色 17% |
| `--accent-on` | ink:纯白实色；celadon:纯白实色；clay:纯白实色；plum:纯白实色；rose:纯白实色；teal:纯白实色；forest:纯白实色；amber:纯白实色；coral:纯白实色；graphite:纯白实色 | ink:主色 ×0.14；celadon:主色 ×0.17（残差8.15171688857744）；clay:主色 + 面色 100%（残差13）；plum:主色 ×0.13（残差4.468791690149889）；rose:主色 ×0.13（残差8.882986890915483）；teal:主色 ×0.15（残差9.378846041993835）；forest:主色 + 面色 100%（残差13）；amber:主色 + 面色 100%（残差13）；coral:主色 ×0.13（残差10.651832776727154）；graphite:主色 ×0.15（残差4.196906421952573） |
| `--accent-soft` | ink:主色 16% + 白 84%；celadon:主色 16% + 白 84%；clay:主色 16% + 白 84%；plum:主色 16% + 白 84%；rose:主色 16% + 白 84%；teal:主色 16% + 白 84%；forest:主色 16% + 白 84%；amber:主色 16% + 白 84%；coral:主色 16% + 白 84%；graphite:主色 16% + 白 84% | ink:主色 α10%；celadon:主色 α10%；clay:主色 α10%；plum:主色 α10%；rose:主色 α10%；teal:主色 α10%；forest:主色 α10%；amber:主色 α10%；coral:主色 α10%；graphite:主色 α10% |
| `--accent-light` | ink:主色 28% + 白 72%；celadon:主色 28% + 白 72%；clay:主色 28% + 白 72%；plum:主色 28% + 白 72%；rose:主色 28% + 白 72%；teal:主色 28% + 白 72%；forest:主色 28% + 白 72%；amber:主色 28% + 白 72%；coral:主色 28% + 白 72%；graphite:主色 28% + 白 72% | ink:主色 α24%；celadon:主色 α24%；clay:主色 α24%；plum:主色 α24%；rose:主色 α24%；teal:主色 α24%；forest:主色 α24%；amber:主色 α24%；coral:主色 α24%；graphite:主色 α24% |
| `--accent-ring` | ink:主色 α20%；celadon:主色 α20%；clay:主色 α20%；plum:主色 α20%；rose:主色 α20%；teal:主色 α20%；forest:主色 α20%；amber:主色 α20%；coral:主色 α20%；graphite:主色 α20% | ink:主色 α36%；celadon:主色 α36%；clay:主色 α36%；plum:主色 α36%；rose:主色 α36%；teal:主色 α36%；forest:主色 α36%；amber:主色 α36%；coral:主色 α36%；graphite:主色 α36% |
| `--text-brand` | ink:主色 ×0.87；celadon:主色 ×0.87；clay:主色 ×0.87；plum:主色 ×0.87；rose:主色 ×0.87；teal:主色 ×0.87；forest:主色 ×0.87；amber:主色 ×0.87；coral:主色 ×0.87；graphite:主色 ×0.87 | ink:主色 82% + 白 18%；celadon:主色 82% + 白 18%；clay:主色 82% + 白 18%；plum:主色 82% + 白 18%；rose:主色 82% + 白 18%；teal:主色 82% + 白 18%；forest:主色 82% + 白 18%；amber:主色 82% + 白 18%；coral:主色 82% + 白 18%；graphite:主色 82% + 白 18% |
| `--badge-ver-bg` | ink:主色 16% + 白 84%；celadon:主色 16% + 白 84%；clay:主色 16% + 白 84%；plum:主色 16% + 白 84%；rose:主色 16% + 白 84%；teal:主色 16% + 白 84%；forest:主色 16% + 白 84%；amber:主色 16% + 白 84%；coral:主色 16% + 白 84%；graphite:主色 16% + 白 84% | ink:主色 α10%；celadon:主色 α10%；clay:主色 α10%；plum:主色 α10%；rose:主色 α10%；teal:主色 α10%；forest:主色 α10%；amber:主色 α10%；coral:主色 α10%；graphite:主色 α10% |
| `--badge-ver-text` | ink:主色 ×0.87；celadon:主色 ×0.87；clay:主色 ×0.87；plum:主色 ×0.87；rose:主色 ×0.87；teal:主色 ×0.87；forest:主色 ×0.87；amber:主色 ×0.87；coral:主色 ×0.87；graphite:主色 ×0.87 | ink:主色 82% + 白 18%；celadon:主色 82% + 白 18%；clay:主色 82% + 白 18%；plum:主色 82% + 白 18%；rose:主色 82% + 白 18%；teal:主色 82% + 白 18%；forest:主色 82% + 白 18%；amber:主色 82% + 白 18%；coral:主色 82% + 白 18%；graphite:主色 82% + 白 18% |
| `--brand-g1` | ink:主色 72% + 白 28%；celadon:主色 72% + 白 28%；clay:主色 72% + 白 28%；plum:主色 72% + 白 28%；rose:主色 72% + 白 28%；teal:主色 72% + 白 28%；forest:主色 72% + 白 28%；amber:主色 72% + 白 28%；coral:主色 72% + 白 28%；graphite:主色 72% + 白 28% | ink:主色 82% + 白 18%；celadon:主色 82% + 白 18%；clay:主色 82% + 白 18%；plum:主色 82% + 白 18%；rose:主色 82% + 白 18%；teal:主色 82% + 白 18%；forest:主色 82% + 白 18%；amber:主色 82% + 白 18%；coral:主色 82% + 白 18%；graphite:主色 82% + 白 18% |
| `--brand-g2` | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值；teal:与主色同值；forest:与主色同值；amber:与主色同值；coral:与主色同值；graphite:与主色同值 | ink:与主色同值；celadon:与主色同值；clay:与主色同值；plum:与主色同值；rose:与主色同值；teal:与主色同值；forest:与主色同值；amber:与主色同值；coral:与主色同值；graphite:与主色同值 |
| `--brand-g3` | ink:主色 ×0.74；celadon:主色 ×0.74；clay:主色 ×0.74；plum:主色 ×0.74；rose:主色 ×0.74；teal:主色 ×0.74；forest:主色 ×0.74；amber:主色 ×0.74；coral:主色 ×0.74；graphite:主色 ×0.74 | ink:主色 ×0.86；celadon:主色 + 面色 17%；clay:主色 + 面色 17%；plum:主色 ×0.86；rose:主色 + 面色 17%；teal:主色 ×0.86；forest:主色 + 面色 17%；amber:主色 + 面色 17%；coral:主色 + 面色 17%；graphite:主色 + 面色 17% |
| `--lock-orb-1` | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7%；teal:主色 α7%；forest:主色 α7%；amber:主色 α7%；coral:主色 α7%；graphite:主色 α7% | ink:主色 α14%；celadon:主色 α14%；clay:主色 α14%；plum:主色 α14%；rose:主色 α14%；teal:主色 α14%；forest:主色 α14%；amber:主色 α14%；coral:主色 α14%；graphite:主色 α14% |
| `--lock-orb-2` | ink:主色 α5%；celadon:主色 α5%；clay:主色 α5%；plum:主色 α5%；rose:主色 α5%；teal:主色 α5%；forest:主色 α5%；amber:主色 α5%；coral:主色 α5%；graphite:主色 α5% | ink:主色 α7%；celadon:主色 α7%；clay:主色 α7%；plum:主色 α7%；rose:主色 α7%；teal:主色 α7%；forest:主色 α7%；amber:主色 α7%；coral:主色 α7%；graphite:主色 α7% |
| `--selection` | ink:主色 α22%；celadon:主色 α22%；clay:主色 α22%；plum:主色 α22%；rose:主色 α22%；teal:主色 α22%；forest:主色 α22%；amber:主色 α22%；coral:主色 α22%；graphite:主色 α22% | ink:主色 α30%；celadon:主色 α30%；clay:主色 α30%；plum:主色 α30%；rose:主色 α30%；teal:主色 α30%；forest:主色 α30%；amber:主色 α30%；coral:主色 α30%；graphite:主色 α30% |
| `--toast-info` | ink:主色 45% + 白 55%（残差25.376864043530702）；celadon:主色 57% + 白 43%（残差35.43352772750342）；clay:主色 52% + 白 48%（残差43.938208818593296）；plum:主色 39% + 白 61%（残差23.377023901310707）；rose:主色 39% + 白 61%（残差27.12011488984632）；teal:主色 54% + 白 46%（残差33.658853695645234）；forest:主色 52% + 白 48%（残差28.036914444870547）；amber:主色 54% + 白 46%（残差45.579571833892174）；coral:主色 47% + 白 53%（残差30.304493883501294）；graphite:主色 39% + 白 61%（残差7.334722774435988） | ink:主色 ×0.58（残差50.59519162597287）；celadon:主色 ×0.53（残差41.75301452287171）；clay:主色 ×0.56（残差48.28271323238228）；plum:主色 ×0.61（残差41.3214145579328）；rose:主色 ×0.59（残差53.84106221613128）；teal:主色 ×0.57（残差43.4174082475426）；forest:主色 ×0.49（残差20.432198198606983）；amber:主色 ×0.52（残差35.66940388671595）；coral:主色 ×0.56（残差46.589305114070754）；graphite:主色 + 面色 64%（残差4.814045678359804） |

读法：纸底的浅水洗底（`--accent-soft` / `--badge-ver-bg`）≈ 主色 10–12% 混白，`--accent-light` ≈ 18–22% 混白，`--accent-ring` 是主色 16% 透明；墨底整族改走半透明（soft 15–16%、light 26–28%、ring 32%、selection 30%），因为墨底上浮层要"透出底下的面"而不是叠一层不透明浅斑。`--accent-hover/active` 纸底是主色等比压暗（×0.82 / ×0.68 上下），墨底反过来提亮（×1.19 上下）。

残差 >4 的格子说明那一档是手工微调过的，不是纯公式产物——新配色可以照公式给初值，再用第 5 节的判据回校。

## 7. 不随主题变化的层（外部稿不必、也不应重新设计）

### 7.1 别名/派生槽 —— `var()` 指向源头，切主题自动跟随

| 槽位 | 定义 |
| --- | --- |
| `--sidebar-border` | var(--border-navigation) |
| `--sidebar-active` | var(--accent-soft) |
| `--sidebar-text` | var(--text-secondary) |
| `--sidebar-text-active` | var(--accent) |
| `--ft-bg` | var(--fill) |
| `--code-bg` | var(--sunken) |
| `--code-bd` | var(--border) |
| `--border-focus` | var(--accent) |
| `--text-primary` | var(--text) |
| `--border-line` | var(--border) |
| `--border-card` | var(--border) |
| `--border-card-hover` | var(--border-hover) |
| `--border-input` | var(--border) |
| `--border-divider` | var(--border-subtle) |
| `--text-title` | var(--text) |
| `--text-body` | var(--text-secondary) |
| `--shadow-card-rest` | var(--shadow-card) |
| `--shadow-card-hover` | var(--shadow-md) |
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
| `:root, .theme-scope` | `--material-field-l` | 0.94 |
| `:root, .theme-scope` | `--material-field-k` | 0.45 |
| `:root, .theme-scope` | `--material-field-k-secondary` | 0.35 |
| `:root, .theme-scope` | `--material-field-companion` | -48 |
| `:root, .theme-scope` | `--material-color-primary` | oklch(from var(--accent) var(--material-field-l) calc(c * var(--material-field-k)) h) |
| `:root, .theme-scope` | `--material-color-secondary` | oklch(from var(--accent) var(--material-field-l) calc(c * var(--material-field-k-secondary)) calc(h + var(--material-field-companion))) |
| `:root, .theme-scope` | `--material-primary-strength` | 16% |
| `:root, .theme-scope` | `--material-secondary-strength` | 12% |
| `:root, .theme-scope` | `--material-lock-primary-strength` | 20% |
| `:root, .theme-scope` | `--material-lock-secondary-strength` | 16% |
| `:root, .theme-scope` | `--material-navigation-strength` | 8% |
| `:root, .theme-scope` | `--material-field-primary-size` | clamp(520px, 56vw, 1100px) clamp(400px, 72vh, 820px) |
| `:root, .theme-scope` | `--material-field-secondary-size` | clamp(480px, 52vw, 1000px) clamp(360px, 64vh, 720px) |
| `:root, .theme-scope` | `--material-field-primary-position` | max(18%, calc((100% - var(--content-max)) / 2 + 80px)) 8% |
| `:root, .theme-scope` | `--material-field-secondary-position` | min(91%, calc((100% + var(--content-max)) / 2 - 40px)) 91% |
| `:root, .theme-scope` | `--material-field` | radial-gradient(ellipse 48% 64% at 50% 50%, color-mix(in srgb, var(--panel-bg) 14%, transparent), transparent 90%), radial-gradient(ellipse var(--material-field-primary-size) at var(--material-field-primary-position), color-mix(in srgb, var(--material-color-primary) var(--material-primary-strength), transparent), transparent 100%), radial-gradient(ellipse var(--material-field-secondary-size) at var(--material-field-secondary-position), color-mix(in srgb, var(--material-color-secondary) var(--material-secondary-strength), transparent), transparent 100%) |
| `:root, .theme-scope` | `--material-lock-field` | radial-gradient(ellipse 48% 64% at 50% 50%, color-mix(in srgb, var(--panel-bg) 14%, transparent), transparent 90%), radial-gradient(ellipse var(--material-field-primary-size) at var(--material-field-primary-position), color-mix(in srgb, var(--material-color-primary) var(--material-lock-primary-strength), transparent), transparent 100%), radial-gradient(ellipse var(--material-field-secondary-size) at var(--material-field-secondary-position), color-mix(in srgb, var(--material-color-secondary) var(--material-lock-secondary-strength), transparent), transparent 100%) |
| `:root, .theme-scope` | `--material-floating-field` | linear-gradient(color-mix(in srgb, var(--panel-bg) 60%, transparent), color-mix(in srgb, var(--panel-bg) 60%, transparent)), var(--material-field), var(--panel-bg) |
| `:root, .theme-scope` | `--material-editor-field` | linear-gradient(color-mix(in srgb, var(--bg) 65%, transparent), color-mix(in srgb, var(--bg) 65%, transparent)), var(--material-field), var(--bg) |
| `:root, .theme-scope` | `--border-navigation` | color-mix(in srgb, var(--text) 3%, transparent) |
| `:root, .theme-scope` | `--border-search` | var(--border) |
| `:root, .theme-scope` | `--border-composer` | var(--border) |
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
| `:root, .theme-scope` | `--bg-canvas-input` | var(--bg-input) |
| `:root, .theme-scope` | `--bg-surface` | var(--panel-bg) |
| `:root, .theme-scope` | `--bg-surface-hover` | var(--hover) |
| `:root, .theme-scope` | `--bg-surface-active` | var(--active) |
| `:root, .theme-scope` | `--bg-tag-default` | var(--badge-cat-bg) |
| `:root, .theme-scope` | `--bg-mono-chip` | var(--sunken) |
| `:root, .theme-scope` | `--bg-statusbar` | var(--panel-bg) |
| `:root, .theme-scope` | `--hover-chrome` | color-mix(in srgb, var(--text) 9%, transparent) |
| `:root, .theme-scope` | `--floating-background-attachment` | scroll |
| `:root, .theme-scope` | `--dialog-background-attachment` | scroll |
| `:root, .theme-scope` | `--nav-overlay-background-attachment` | scroll |
| `:root, .theme-scope` | `--editor-background-attachment` | fixed |
| `:root, .theme-scope` | `--text-canvas-meta` | var(--text-secondary) |
| `:root, .theme-scope` | `--text-nav-label` | var(--text-secondary) |
| `:root, .theme-scope` | `--text-nav-section` | var(--text-secondary) |
| `:root, .theme-scope` | `--bg-lock` | linear-gradient(135deg, var(--lock-wash-a) 0%, var(--lock-wash-b) 100%) |
| `:root, .theme-scope` | `--material-decoration-display` | block |
| `:root[data-accent="ink"], .theme-scope[data-accent="ink"]` | `--material-field-companion` | -48 |
| `:root[data-accent="celadon"], .theme-scope[data-accent="celadon"]` | `--material-field-companion` | -32 |
| `:root[data-accent="clay"], .theme-scope[data-accent="clay"]` | `--material-field-companion` | 28 |
| `:root[data-accent="plum"], .theme-scope[data-accent="plum"]` | `--material-field-companion` | 41 |
| `:root[data-accent="rose"], .theme-scope[data-accent="rose"]` | `--material-field-companion` | 54 |
| `:root[data-accent="teal"], .theme-scope[data-accent="teal"]` | `--material-field-companion` | 46 |
| `:root[data-accent="forest"], .theme-scope[data-accent="forest"]` | `--material-field-companion` | -24 |
| `:root[data-accent="amber"], .theme-scope[data-accent="amber"]` | `--material-field-companion` | -21 |
| `:root[data-accent="coral"], .theme-scope[data-accent="coral"]` | `--material-field-companion` | 28 |
| `:root[data-accent="graphite"], .theme-scope[data-accent="graphite"]` | `--material-field-companion` | 48 |
| `:root[data-accent="graphite"], .theme-scope[data-accent="graphite"]` | `--material-color-primary` | color-mix(in oklch, var(--accent) 25%, var(--sunken)) |
| `:root[data-accent="graphite"], .theme-scope[data-accent="graphite"]` | `--material-color-secondary` | color-mix(in oklch, var(--accent) 18%, var(--sunken)) |
| `:root[data-base="light"][data-accent="graphite"], .theme-scope[data-base="light"][data-accent="graphite"]` | `--material-primary-strength` | 12% |
| `:root[data-base="light"][data-accent="graphite"], .theme-scope[data-base="light"][data-accent="graphite"]` | `--material-secondary-strength` | 10% |
| `:root[data-base="dark"], .theme-scope[data-base="dark"]` | `--material-primary-strength` | 18% |
| `:root[data-base="dark"], .theme-scope[data-base="dark"]` | `--material-secondary-strength` | 14% |
| `:root[data-base="dark"], .theme-scope[data-base="dark"]` | `--material-lock-primary-strength` | 22% |
| `:root[data-base="dark"], .theme-scope[data-base="dark"]` | `--material-lock-secondary-strength` | 18% |
| `:root[data-base="dark"]:not([data-accent="graphite"]), .theme-scope[data-base="dark"]:not([data-accent="graphite"])` | `--material-color-primary` | color-mix(in oklch, oklch(from var(--accent) l calc(c * 2) h) 30%, oklch(from var(--sunken) l 0 none)) |
| `:root[data-base="dark"]:not([data-accent="graphite"]), .theme-scope[data-base="dark"]:not([data-accent="graphite"])` | `--material-color-secondary` | color-mix(in oklch, oklch(from var(--accent) l calc(c * 1.6) calc(h + var(--material-field-companion))) 24%, oklch(from var(--sunken) l 0 none)) |
| `.theme-scope` | `--material-field-primary-size` | 56% 72% |
| `.theme-scope` | `--material-field-secondary-size` | 52% 64% |
| `.theme-scope` | `--material-field-primary-position` | 24% 8% |
| `.theme-scope` | `--material-field-secondary-position` | 85% 91% |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-sidebar` | color-mix(in srgb, var(--sidebar-bg) var(--material-navigation-strength), transparent) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-nav-overlay` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-dialog` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--dialog-background-attachment` | fixed |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-popover` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-menu` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-dock` | var(--material-floating-field) |
| `:root[data-atmosphere="on"], .theme-scope[data-atmosphere="on"]` | `--bg-editor` | var(--material-editor-field) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--bg-app` | var(--sunken) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--bg-lock` | var(--bg) |
| `:root[data-atmosphere="off"], .theme-scope[data-atmosphere="off"]` | `--material-decoration-display` | none |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-inspector-base` | #f1f1ef |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-key` | oklch(from var(--accent) 0.9 calc(c * 0.55) h) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-fill` | oklch(from var(--accent) 0.92 calc(c * 0.5) calc(h + 24)) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-key-strength` | 22% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-fill-strength` | 22% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-key-position` | 12% 16% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-fill-position` | 88% 84% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-key-size` | 68% 78% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-fill-size` | 72% 80% |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-field` | radial-gradient(ellipse var(--material-workspace-key-size) at var(--material-workspace-key-position), color-mix(in srgb, var(--material-workspace-key) var(--material-workspace-key-strength), transparent), transparent 90%), radial-gradient(ellipse var(--material-workspace-fill-size) at var(--material-workspace-fill-position), color-mix(in srgb, var(--material-workspace-fill) var(--material-workspace-fill-strength), transparent), transparent 90%) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-floating-field` | radial-gradient(ellipse 80% 65% at var(--material-workspace-key-position), color-mix(in srgb, var(--material-workspace-key) 10%, transparent), transparent 90%), var(--panel-bg) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-dialog-field` | radial-gradient(ellipse 78% 72% at 0% 0%, color-mix(in srgb, var(--material-workspace-key) 18%, transparent), transparent 100%), radial-gradient(ellipse 78% 72% at 100% 100%, color-mix(in srgb, var(--material-workspace-fill) 14%, transparent), transparent 100%), var(--panel-bg) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--material-workspace-rim` | inset 0 1px 0 color-mix(in srgb, #fff 80%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--accent) 5%, transparent) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace` | var(--bg) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-frame` | var(--workspace-frame) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-inspector` | var(--material-inspector-base) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-editor` | var(--bg) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-selected` | color-mix(in oklab, var(--accent) 10%, var(--panel-bg)) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-hover` | color-mix(in oklab, var(--text) 5%, var(--panel-bg)) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-search` | color-mix(in oklab, var(--panel-bg) 72%, var(--workspace-frame)) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-inspector-hover` | color-mix(in oklab, var(--text) 3.5%, var(--material-inspector-base)) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-primary` | var(--accent) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-primary-hover` | var(--accent-hover) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--bg-workspace-primary-active` | var(--accent-active) |
| `:root[data-layout="workspace"], .workspace-theme-prev[data-base]` | `--text-workspace-primary` | var(--accent-on) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-inspector-base` | #1b1c1f |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-workspace-key` | oklch(from var(--accent) 0.48 calc(c * 0.85) h) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-workspace-fill` | oklch(from var(--accent) 0.46 calc(c * 0.7) calc(h + 24)) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-workspace-key-strength` | 10% |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-workspace-fill-strength` | 10% |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--material-workspace-rim` | inset 0 1px 0 color-mix(in srgb, var(--accent) 20%, transparent), inset 0 0 0 1px color-mix(in srgb, #fff 3%, transparent) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--bg-workspace-primary` | color-mix(in oklab, var(--accent) 14%, var(--bg)) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--bg-workspace-primary-hover` | color-mix(in oklab, var(--accent) 17%, var(--bg)) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--bg-workspace-primary-active` | color-mix(in oklab, var(--accent) 20%, var(--bg)) |
| `:root[data-layout="workspace"][data-base="dark"], .workspace-theme-prev[data-base="dark"]` | `--text-workspace-primary` | color-mix(in oklab, var(--accent) 50%, var(--text)) |
| `:root[data-layout="workspace"]:is([data-accent="graphite"], [data-accent="sand"]), .workspace-theme-prev:is([data-accent="graphite"], [data-accent="sand"])` | `--material-workspace-key` | oklch(from var(--accent) 0.96 0 none) |
| `:root[data-layout="workspace"]:is([data-accent="graphite"], [data-accent="sand"]), .workspace-theme-prev:is([data-accent="graphite"], [data-accent="sand"])` | `--material-workspace-fill` | oklch(from var(--accent) 0.96 0 none) |
| `:root[data-layout="workspace"][data-base="dark"]:is([data-accent="graphite"], [data-accent="sand"]), .workspace-theme-prev[data-base="dark"]:is([data-accent="graphite"], [data-accent="sand"])` | `--material-workspace-key` | oklch(from var(--accent) 0.48 0 none) |
| `:root[data-layout="workspace"][data-base="dark"]:is([data-accent="graphite"], [data-accent="sand"]), .workspace-theme-prev[data-base="dark"]:is([data-accent="graphite"], [data-accent="sand"])` | `--material-workspace-fill` | oklch(from var(--accent) 0.48 0 none) |
| `:root[data-layout="workspace"][data-atmosphere="on"], .workspace-theme-prev[data-atmosphere="on"]` | `--bg-dialog` | var(--material-dialog-field) |
| `:root[data-layout="workspace"][data-atmosphere="on"], .workspace-theme-prev[data-atmosphere="on"]` | `--dialog-background-attachment` | scroll |
| `:root[data-layout="workspace"][data-atmosphere="on"], .workspace-theme-prev[data-atmosphere="on"]` | `--bg-workspace` | var(--material-workspace-field), var(--bg) |
| `:root[data-layout="workspace"][data-atmosphere="on"], .workspace-theme-prev[data-atmosphere="on"]` | `--bg-workspace-frame` | radial-gradient(ellipse var(--material-workspace-key-size) at var(--material-workspace-key-position), color-mix(in srgb, var(--material-workspace-key) 32%, transparent), transparent 90%), radial-gradient(ellipse var(--material-workspace-fill-size) at var(--material-workspace-fill-position), color-mix(in srgb, var(--material-workspace-fill) 28%, transparent), transparent 90%), var(--workspace-frame) |
| `:root[data-layout="workspace"][data-atmosphere="on"], .workspace-theme-prev[data-atmosphere="on"]` | `--bg-inspector` | radial-gradient(ellipse 100% 75% at 100% 100%, color-mix(in srgb, var(--material-workspace-key) 12%, transparent), transparent 90%), var(--material-inspector-base) |

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

