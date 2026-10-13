# 01 · 锁页画卷（必应每日壁纸 + 抗干扰可读层）

> **已作废（2026-10-12）**：用户裁决「不要壁纸了」，摄影壁纸链整体退役，本文只作为裁撤账目的依据保留。
> 现行设计见 `docs/design/lock-screen/01-ambient-aura.md`；本文里的尺寸契约、题词规格与豁免裁决由那份继承。

范围：只动锁页（`src/components/auth/UnlockPage.vue`）与它需要的取图链路。解锁后的五个模块页面一律不碰。

## 决策（2026-10-12 用户拍板）

| 议题 | 结论 |
| --- | --- |
| 壁纸来源 | 必应每日壁纸公开接口，Rust 侧抓取 + 本机落盘缓存 |
| 逐字错峰入场 | 「禁入场动画」裁决对锁页题词**显式豁免**，其余页面禁令不变 |
| 底部常驻控制器 | 不上锁屏；只在右下角留一颗极轻「换一张」浮钮，主题/Accent 仍走设置弹窗外观页签 |

## 一、尺寸契约（逐条对齐外部规格）

外部规格列的硬性工程尺寸与 `UnlockPage.vue` 现档逐条核对，落差的都记在这里：

- 内容栈 300px、垂直真居中（2026-09-24 裁决：不做「中心 42% 微偏上」）
- 徽标底座 52×52 / radius 14 / 内嵌 38px 品牌标。底座下边距留 **8px**（规格的 12px 不采：BrandLogo 的 viewBox 自带约 40% 留白，光学间距已够）
- 标题 16px / 600 / -0.01em / 下边距 22px（`.lock-title` 抬到 20px 仍是未点头的开放项，本轮不动）
- 输入条 40px 高、1px 发丝边、`padding: 0 62px 0 36px`；圆角走宿主输入框档 **`--radius`(10px)**，与首启建码页同源——规格字面的 8px 是它自带令牌表里 `--radius-md` 的值，映射到 desko 不能照抄成 12px 的卡片档
- Focus：边框恒 1px 转 accent + 外叠 `3px 8%` 弥散光晕；**左锁图标同步点亮 accent**（图标排在 input 之前，只能由 `.unlock-field:focus-within` 往下够）
- 显隐钮 26×26 @ right 33px（圆角 `--radius-ib` 9px、图标 15px，均按 desko 图标轨，不落规格的 6px/16px）、解锁钮 26×26 @ right 5px 内嵌 13px 箭头 + `0 1px 3px` 接触影
- 错误槽定高 20px 只切 opacity（另加 `margin-top: 4px` 呼吸）、报错 WAAPI 0.35s X 轴轻晃（`cubic-bezier(.36,.07,.19,.97)`，不重刷 DOM、不失焦）；摆幅取 5/4/3/2px，比规格的 6/5/4/3 收一档
- 题词 `clamp(22px, 3vw, 32px)`，比规格的 `clamp(24px, 3.2vw, 38px)` 小一档：38px 时 17 字对句要吃到约 800px 宽，会顶出中央光晕（760px）的保护范围，宁可小字压光晕内。`max-width` 取规格的 **90vw**，给长对句留不被 `ellipsis` 截断的余量
- 题词↔锁块间距 34px（规格 36px，差 2px 不调）

## 二、取图链路

### Rust：`src-tauri/src/services/wallpaper_service.rs`（新）

- 依赖已在树里：`ureq = "2"`、`serde_json = "1"`，不新增 crate。
- 档案接口：`GET https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8`（6s 超时，带 UA）。返回 8 天的 `startdate / title / copyright / urlbase`。
- 清晰度：`urlbase` 的后缀按目标像素档替换，窗口面积 × devicePixelRatio ≤ 2.3 MP 取 `_1920x1080`，否则取 `_UHD`（3840×2160）。**不拿 480 小图放大**——那正是规格禁止的插值发糊来源。
- 落盘缓存：`src-tauri/src/paths.rs` 增 `wallpapers_dir()`（`<profile root>/wallpapers/`），与 `favicons_dir()` 同构；文件名为 `<image id>_<档>.jpg`。命中即返回本地路径，**当天命中则零网络**；档案清单同目录存 `archive.json`（含抓取日期，跨天或「换一张」时才回网）。
- 失败面：网络不可达 / 接口改版 / 无今日项 → 一律 `None`，前端回退到既有 `--lock-wash` 微光底。不弹 toast、不留错误文案——锁页不能因为一张图变成用不了。
- 交完图之后仍可能坏：路径给出后文件被清或解码失败，`<img>` 的 `@error` 会调 `forgetWallpaper()` 把整层撤册（`src`/署名一起清），`.has-photo` 随之落回，绝不留一片对着纯色微光底空转的光晕。「换一张」只在 `src` 真的变了时才淡出（`watch` 把关），取图失败时 `src` 不变，画卷不会被自己刷成空白。

### 命令（`src-tauri/src/commands/`，进 `main.rs` 的 `generate_handler!`）

- `wallpaper_get(index: usize, width: u32) -> Option<Wallpaper>`：`{ path, title, copyright, day }`，`width` 是前端算出的目标像素宽（窗口宽 × devicePixelRatio），据此选 `_1920x1080` 还是 `_UHD`
- `wallpaper_count() -> usize`：清单里可用的张数，前端据此在「换一张」时回绕索引

前端 `src/services/wallpaper.ts`：走 `convertFileSrc`（与 favicon 同一条已验证可行的路径，asset scope 为空不影响 favicon，故同样适用）；非 Tauri 环境（e2e mock、截图脚本）直接返回 `null`，CI 不发外网。

### 开关

- `settings.rs` 的 `ALLOWED_KEYS` 增 `lock_wallpaper`，值 `'true'/'false'`，**默认开**。
- 设置弹窗外观页签在「强调色」下加一行「锁页画卷」开关 + 一句说明（离线时自动回到纯色底）。

## 三、锁页视觉层（自下而上）

1. `.unlock-bg`：既有 `--lock-wash` 径向微光，作为无图时的底（保留）。
2. `.lock-photo`：`<img>`，`object-fit: cover` + `object-position` 居中，`image-rendering: -webkit-optimize-contrast`。**禁止** `transform: scale()` + 负 margin 的铺法（插值发糊的根源）。图未就位时 `opacity: 0`，就位后一次淡入（这是内容替换的补间，不是入场动画）。
3. `.lock-aperture`：局部羽化径向光晕，以内容栈为圆心（纸底暖白 / 墨底近黑，由 `color-mix` 从既有槽反推），**取代**规格禁掉的大面积顶/底黑白渐变。
4. 题词层 / 内容层：抗干扰靠**多重微距立体阴影**——文字挂三层 text-shadow（1px 贴地 + 大范围同主题反差漫射 + 远距环境影），面板挂发丝内圈 + 环境接触阴影。深黑峭壁、高光雪山、杂乱树影三档背景都要过 WCAG 对比。
5. `.lock-photofoot::before`：署名住在中央光晕之外，对它的暗底/亮底照片会失效，故在左下角**单独**补一片贴角羽化（`radial-gradient` 椭圆，约 58% 窗宽 × 104px，锚在 `12% 100%`）。它是第 3 层同一种手法的局部版，不是顶/底横带。

新增令牌一律**不加全局槽**（96 槽契约 + `scripts/check-theme-coverage.mjs` 不动），配方写在 `UnlockPage.vue` 的 scoped 样式里，从既有槽 `color-mix` 派生。

### 题词（海报位）

- 位置：内容栈**上方**，与栈合成一个整体后视口居中（不把整块往上推）。
- 字体：衬线（`Songti SC / SimSun / Noto Serif SC`），`clamp(22px, 3vw, 32px)`，`letter-spacing: 0.22em`，单行不换行、超宽用 `max-width: 82vw` + `ellipsis` 收口。
- 动效：逐字错峰入场（进 24ms/字、出 12ms/字，blur+位移），10s 平滑轮播。这是本轮豁免项。
- 副行不做：`Desko · 本地工作台已保护` 那行说明（含左右细线）已于 2026-10-12 裁掉，题词下面直接是锁块。

### 右下角

一颗极轻「换一张」浮钮 + 一行必应图片署名（标题 / 版权方，11px、同一套微距阴影；署名背后另有一片贴角羽化兜住亮岩/暗苔两类极端底）。不放 accent 点、不放暖纸/暖墨切换。

## 四、验收

1. `cargo build`（src-tauri 本机可完整编译）+ `npm run build`。
2. 真机截图对拍：临时 e2e spec 走 `bootUnlocked` 前抓锁页，8 组合（paper/ink × 4 accent）各一张，落 `%TEMP%` 后删 spec；含「有图 / 无图回退」两态。
3. `node scripts/check-theme-coverage.mjs` 与 `npx playwright test e2e/specs/theme.spec.ts`（确认零新增全局槽、锚点未破）。
4. `node scripts/design-audit.mjs` + `color-sweep.mjs` 在壁纸态复测文字对比度；现有各 shots 脚本解锁序列（`.unlock-input` → `e2e-master-123`）不受影响。

## 五、不做

- 不做内置图、不做用户自选目录、不做壁纸预览页。
- 不做锁屏上的 accent / 底色切换控件。
- 不给解锁后任何页面加动画豁免。
