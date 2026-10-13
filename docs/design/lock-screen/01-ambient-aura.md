# 01 · 锁页光场（摄影壁纸退役 + 呼吸光晕 + 乳胶噪波）

范围：只动锁页（`src/components/auth/UnlockPage.vue`）与它的底图链路。解锁后的五个模块页面一律不碰。
前置：本文取代 `docs/design/lock-wallpaper/01-bing-wallpaper-lockscreen.md`（必应画卷那一轮），那份只留作裁撤依据。

## 决策（2026-10-12 用户拍板）

| 议题 | 结论 |
| --- | --- |
| 摄影壁纸 | **不要壁纸了**——必应取图链路整体退役，不留休眠代码、不留开关（框架级决定零兼容，不做新旧并存） |
| 底的画法 | 采纳第二稿的**自由流体呼吸光场 + 物理乳胶微噪波**，取代静态 `--lock-wash` 渐变作为唯一可读性底 |
| 题词副行 | 第二稿把 `Desko · 本地工作台已就绪` 加回来了，**不采**：同位置的说明已在同一轮里被裁掉 |
| 右下角控制器 | 第二稿要 4 颗 accent 圆点 + 暖纸/暖墨切换钮，**不采**：既有裁决是「底部控制器不上锁屏」，主题走设置弹窗外观页签 |

## 一、裁撤账目

Rust 侧（整文件删除，`mod.rs` / `main.rs` 同步摘注册）：

- `src-tauri/src/services/wallpaper_service.rs` — 取清单、按像素档下 jpg、`archive.json` 缓存
- `src-tauri/src/commands/wallpaper.rs` — `wallpaper_get(index,width)` / `wallpaper_count()`
- `src-tauri/src/main.rs` — `generate_handler!` 里两条命令 + `asset_protocol_scope` 对 `wallpapers/` 的放行
- `src-tauri/src/paths.rs` — `wallpapers_dir()`
- `src-tauri/src/commands/settings.rs` — `ALLOWED_KEYS` 去掉 `lock_wallpaper`

前端（整文件删除）：

- `src/services/wallpaper.ts`、`src/services/api/wallpaper.ts`、`src/services/api/index.ts` 的 `wallpaperApi` 导出
- `src/components/settings/SettingsDialog.vue` — 「锁页 / 每日一张底图」整节（含 `lockWallpaper` ref 与 `saveLockWallpaper`）
- `src/components/layout/TitleBar.vue` — 锁定态窗控的微距阴影两则（为兜住「深黑峭壁 / 高光雪山」而加，底不再是照片就没活可干了，一并撤）
- `src/components/auth/UnlockPage.vue` — `.lock-photo` / `.lock-aperture` / `.has-photo` 全套可读性配方、页脚署名与「换一张」

不回收的两处，都是有意的：

- 已落盘的 `<profile>/wallpapers/` 缓存目录与其中 jpg 属用户数据，代码撤册后成了孤儿，交给用户自己删，程序不再读写它。
- 老库里已写入的 `lock_wallpaper` 设置行留在 `settings` 表里，键一进 `ALLOWED_KEYS` 之外就再也读不到，为一行死数据做迁移不值得。

## 二、锁页视觉层（自下而上）

1. `.unlock-bg`：既有 `--lock-wash` 径向微光，静态底，保留不动。
2. `.lock-aura`：光场容器，`contain: strict` 把重绘圈在这一层，负 inset + 等比放大让光团能漂出窗口外沿而不留硬边。
3. `.lock-aura-blob.a/.b/.c`：三团光晕，`border-radius: 50%` + `filter: blur()` 打成无边界软斑，24s / 28s / 32s 超慢贝塞尔 `infinite alternate` 漂移 + 呼吸缩放。`will-change: transform` + `transform: translate3d()` 让它们进独立合成层，位移由 compositor 走，不逐帧重算模糊。
4. `.lock-grain`：全屏 `feTurbulence`（`fractalNoise`、`baseFrequency .85`、`numOctaves 3`）内联 SVG，`opacity: .035`，压在光场上、内容之下；`pointer-events: none`。它是静态贴图，不参与动画。
5. `.unlock-canvas`：题词 + 300px 内容栈，不变。

新增配方一律**不加全局槽**（96 槽契约 + `scripts/check-theme-coverage.mjs` 基线不动），全写在 `UnlockPage.vue` 的 scoped 样式里，从既有槽直接取色。

## 三、令牌映射（不加槽）

第二稿自带一套 rgba 字面量（纸底 `rgba(225,215,198,.72)` 这类染色光团、`--canvas-bg #eceae5`）。照抄会撞两条在册规则：96 槽不许扩、锁页「只映射不加槽」。落法是取既有 accent 联动槽：

- 主/次光团 = `color-mix(in srgb, var(--accent) 13% / 7%, transparent)`。先试过直接吃 `--lock-orb-1/2`（本来就是按 `主题 × accent` 分档的锁页光晕槽），实测墨底 14% 那档刚好、纸底 7% 那档糊完等于没有，改成从 `--accent` 现推透明度后两档底色共用一条公式，切色盘锁页照样跟着换色相。
- 第三团 = `color-mix(in srgb, var(--panel-bg) 55%, transparent)`：中性提亮，不抢 accent 的色相（墨底 panel 与 bg 只差一档，这团在墨底几乎不出力，是纸底的高光呼吸）。
- 底 = `--lock-wash-a/b` + `--bg`，两档底色沿用现槽。
- 噪波不用色：`feTurbulence` 自身是灰阶噪声，靠 `opacity: .035` 压在两套底色上，两主题共用一条规则。

代价说清楚：光场的色相只能跟着 accent 走，做不出第二稿那种「纸底暖米 + 淡绿」的多色相共舞——那要新增槽位，96 槽契约不许。

## 四、尺寸契约沿用（本轮不改）

300px 内容栈、52×52 徽标底座、40px 输入条（圆角 `--radius` 10px，不照抄规格的 8px）、`padding: 0 62px 0 36px`、左锁 16px @ left 10、显隐钮 26×26 @ right 33、提交 26×26 @ right 5 + 13px 箭头、错误槽定高 20px 只切 opacity、报错 WAAPI 0.35s 轻晃（`cubic-bezier(.36,.07,.19,.97)`）、题词逐字错峰 + 10s 轮播。
提交钮 `:active scale(0.94)` 仍不采：desko 的激活反馈档是换色（`--accent-active`），不做缩放。

## 五、动画与成本闸门

- 常驻呼吸是本轮新开的例外，只豁免在锁页光场这一处，其余页面的「禁入场/常驻动画」不变。
- `@media (prefers-reduced-motion: reduce)` 里把三团光晕 `animation: none` 钉死，光场退成一幅静止的软斑贴图；`global.css` 已有的那条通配 `!important` 兜底排在组件样式之后，故 scoped 里必须自己再写一条，不能指望它。
- 尺寸按真实窗口收：主窗默认 1040×670、最小 800×600，故光团取 360–520px 档、模糊 44–68px，比第二稿按 4K 大屏写的 65vw/820px + 80px 模糊小一档。大窗下会显小，但不炸帧。
- `backdrop-filter: blur(24px)` 仍不采（第二稿给徽标座和输入条加了）：WebView2 上每多一层 backdrop 采样就多一次全区域回读，为两个 40×40 的面板不值。

## 六、验收

1. `node scripts/check-theme-coverage.mjs` = 基线 2 条违例（`--toast-side`、`--gc-hue`），不得新增。
2. `npx vue-tsc --noEmit`、`npm run build`、`cargo build`（src-tauri 本机可完整编译）全绿。
3. `npx playwright test e2e/specs/auth.spec.ts e2e/specs/theme.spec.ts e2e/specs/settings.spec.ts`。
4. 原型帧：`docs/design/lock-screen/proto/01-lock-screen.src.html` 经 `scripts/mock-build.mjs` + `scripts/mock-frames.mjs` 出纸/墨 × 常态/聚焦/降动多帧，逐帧核对光场在两档底色上都不压过 `--text` 的对比。
5. 真机：`npm run tauri dev` 起锁页，8 组合（paper/ink × 4 accent）截图对拍，含 reduced-motion 开与关两态。
