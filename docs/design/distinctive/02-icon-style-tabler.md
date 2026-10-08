# 02 · 应用内图标换骨架：Tabler Icons

## 0. 一句话结论

App 内 50 枚功能图标的**形状骨架**整体换成 Tabler Icons（MIT，v3.48.0），路径数据 vendored 进 `src/utils/icons.ts`，零运行时依赖；同时把散落在 11 个组件里的 31 处手写内联 SVG 收进同一个注册表。窗控四颗与品牌标不动，1.05px 笔画轨与圆润度规则不动。

## 1. 为什么要换

现有 50 枚 glyph 是早期手工临摹 Feather 的产物，问题不在笔画粗细（上一轮已把实笔恒定在 1.05px），而在**骨架**：

- 同一族图标各画各的，圆角半径、切角方式、留白边界都不统一，24 格上没有一个共同的母版；
- 31 处内联 SVG 从未进过注册表，等于第二套未经审校的图标源，尺寸/描边/颜色全靠抄，抄漏一处就不一致；
- 上一轮圆润度只能对**已有的多边形**做倒角修补，改不了形状本身的僵硬感。

结论：修补到边际收益递减，需要换一套有母版的骨架。

## 2. 候选与拍板过程

三套候选在**真实 token、真实页面**里出过高保真 mock（脚本：`scripts/.tmp-tabler-mock.mjs`、`scripts/.tmp-lucide-mock.mjs`，产物在 `design/icon-style-mock/`）：

| 候选 | 骨架特征 | 结论 |
| --- | --- | --- |
| Tabler | 24 格满幅、圆角母版统一、几何偏硬朗 | **采用** |
| Lucide | 24 格略内收、端点更软 | 落选，形似现方案，换过去收益小 |
| Phosphor / Remix | 面性/双轴风格，与 1.05px 笔画轨冲突 | 未进对拍 |

全部对比图共用同一条 1.05px 笔画轨，所以看到的差异只来自形状骨架，不来自线宽。

侧栏「验证码」一枚对拍过三次：Tabler `auth-2fa` 在 14px 下把 "2FA" 三个字母糊成一团，不可读；换 `numbers` 后三颗数字没有容器，22px 的图标轨里读作渲染坏了；2026-09-30 定为 `key`（斜置剪影，与标题栏那颗正立挂锁不同形）。

同一天侧栏另外四枚也重选了一遍，判据只有一条：**22px 下轮廓要能单独认出来**。`notebook` 的书脊+两点糊成一团 → `note`；`files` 与「复制」同形 → `folder`；`devices` 读作"多窗口" → `network`；`bookmark` 站得住，未动。候选对比板见 `design/nav-icon-mock/`。

## 3. 映射表（61 键）

脚本 `scripts/vendor-tabler-icons.mjs` 里的 `MAP` 是唯一事实来源，下表为人读版本。
左列 = `icons.ts` 键名，右列 = Tabler 图标名（outline 除非注明 filled）。

### 3.1 已存在的 50 键

| 键 | Tabler | 键 | Tabler |
| --- | --- | --- | --- |
| search | search | orderedlist | list-numbers |
| searchEmpty | search-off | quote | blockquote |
| x | x | code | code |
| star | star | divider | separator |
| pin | pin | link | link |
| unpin | pinned-off | external | external-link |
| dots | dots | copy | copy |
| trash | trash | eye | eye |
| upload | upload | eyeOff | eye-off |
| check | check | lock | lock |
| checkall | square-check | unlock | lock-open |
| image | photo | lockOff | lock-off |
| max | arrows-maximize | folder | folder |
| min | arrows-minimize | terminal | terminal |
| tag | tag | plus | plus |
| all | category | user | user |
| doc | file-text | mapPin | map-pin |
| clip | paperclip | alert | alert-triangle |
| edit | pencil | chevDown | chevron-down |
| filter | filter | shield | shield |
| clock | clock | globe | world |
| panel | layout-sidebar-right | gear | settings |
| bulletlist | list | navEntries | bookmark |
| navNotes | note（原 notebook） | navFiles | folder（原 files） |
| navMfa | key（原 numbers） | navLan | network（原 devices） |

`max` / `min` 是**小记全屏/还原**按钮（`NoteFullscreen.vue:87`、`NoteToolbar.vue:93`），不是窗控，因此可以换；选 `arrows-maximize`/`arrows-minimize` 而非 `maximize`/`minimize`（后者是四角括号，在 13px 下与窗控混淆）。

### 3.2 新增 11 键（来自内联 SVG）

| 键 | Tabler | 用途 |
| --- | --- | --- |
| arrowRight | arrow-right | 解锁页提交 |
| chevRight | chevron-right | 设置行展开 |
| clipboard | clipboard | 快捷指令复制 |
| file | file | 文件选择 |
| folderOpen | folder-open | 目录选择（两处） |
| cloud | cloud | 备份状态徽标 |
| download | download | 备份下载 |
| adjustments | adjustments | 设置页签·通用 |
| palette | palette | 设置页签·外观 |
| info | info-circle | 设置页签·关于 |
| database | database | 设置页签·数据 |

外加 **`starFilled`**（Tabler filled `star`），供 `:filled` 通道使用。

## 4. 两处不动

- **`TitleBar.vue` 窗控四颗**：12 viewBox、1px 笔画、盒尺寸 2–10，是窗体几何而非 App 图标，上一轮圆润度刚把它的矩形骨架收进 `--radius-ib` 体系。换 Tabler 会破坏这套已量化的规则。
- **`BrandLogo.vue`**：品牌标，独立设计物。

## 5. 31 处内联 SVG 收编清单

这些是手写 feather 形状，本轮全部改成 `<AppIcon :name="…" :size="…" />`，调用点与现尺寸一一对应：

| 文件 | 处数 | 换成 |
| --- | --- | --- |
| `SettingsDialog.vue` | 9 | `adjustments` `palette` `globe` `database` `lock` `info` + `x`(close) + `chevRight`×2 |
| `FileShortcutsModule.vue` | 8 | `x` `clipboard` `file` `folderOpen`×2 `edit` `copy` `trash` |
| `BackupPane.vue` | 5 | `x`×4 `download` |
| `UnlockPage.vue` | 2 | `lock` `arrowRight` |
| `ConfirmDialog.vue` | 1 | `x` |
| `EntryFormDialog.vue` | 1 | `x` |
| `EntryFields.vue` | 1 | `chevDown` |
| `OptionSelect.vue` | 1 | `chevDown` |
| `NoteEditor.vue` | 1 | `chevDown` |
| `BackupBadge.vue` | 1 | `cloud` |
| `ChangePasswordDialog.vue` | 1 | 随 SettingsDialog 的 `lock` 通道 |

## 6. 一条被主动放弃的规则

上一轮定过「侧栏五枚 nav 图标采用一处实心焦点族规则」（同一图形里实心块 + 描边并存）。Tabler 的 outline 母版没有这种混合形态，`bookmark / note / folder / key / network` 五枚换成纯描边。

决定：**接受这次丢失**，不为五枚图标单独维护混合体。侧栏的层级感本就由 `--nav-active` 底色与左侧 3px 焦点条承担，不靠图标内部实心块。

> 2026-10-08 更新：03 轮把实心以**稳定状态**的形式收回来过一轮（侧栏当前模块五枚 + 已收藏星标，取 Solar Round Bold 整枚实心，非混合体），与本节当年砍掉的"hover/focus 混合实心"不是同一件事。其中侧栏五枚同日按真窗口走查再次退回描边，只留星标——结论与理由见 `03-icon-style-solar.md` 第 3 节规则 3。本节"层级感不靠图标内部实心块"的判断成立。

## 7. `:filled` 通道

只有 `star` 用到 `filled` prop（`NoteCard.vue:224,256`、`NoteFullscreen.vue:140`、`NoteToolbar.vue:81`）。旧实现靠 `fill=currentColor / stroke=none` 反相，Tabler 的 star 轮廓反相后是个胖五芒星，不好看。改为：`filled=true` 时取 `starFilled` 键（Tabler filled 母版），其余图标行为不变。

## 8. 验证结果（2026-09-29 实测）

| 环节 | 结果 |
| --- | --- |
| `node scripts/check-theme-coverage.mjs` | 通过（2 底色 × 96 槽、8/8 accent × 17 槽） |
| `npx vue-tsc --noEmit` | 通过，退出码 0 |
| `npx vitest run` | 188 / 188 |
| `PW_CHANNEL=msedge npx playwright test` | 102 / 102 |
| `node scripts/icon-board.mjs` | 62 枚 × 4 档 × 8 组，描边包围盒全部落在 1–23 |
| 真机截图 | `unify-shots`（五页 + 滚动）、`dialog-shots`（24 帧）、`nav-shots` 重拍 |

越界守护第一轮只报了 `starFilled` 一枚（1–23 满幅 + 1.8 描边 → 顶到 0.1）。它永远以 `stroke=none` 渲染，按描边量是量错了，于是守护改为：键名以 `Filled` 结尾的按实心件量（笔宽记 0），界仍守 1–23。**没有放宽边界，也没有缩 Tabler 图元。**

## 9. 交付边界

- vendored 脚本 `scripts/vendor-tabler-icons.mjs` 保留在仓库，作为来源可追溯的事实记录；
- 对拍期的 `scripts/.tmp-*.mjs` 临时脚本交付时删除；
- `design/tabler-mock/`、`design/icon-style-mock/`、`design/star-shot/` 已进 `.gitignore`；
- 提交、推送、NSIS 打包均需用户明确确认后才做；ONES 关联每次单独问。
