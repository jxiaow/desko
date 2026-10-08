# Solar 图标集（应用内图标骨架）

- 作品：**Solar**（Linear / Round / Bold 家族，共 8706 枚），本仓库取用其中 62 枚：
  `src/utils/icons.ts` 里 61 枚 `*-linear` 描边件 + 1 枚 `*-bold` 实心件（已收藏状态位）。
- 作者：**480 Design** — https://www.figma.com/community/file/1166831539721848736
- 许可：**CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- 取数：`@iconify-json/solar` v1.2.13（https://icon-sets.iconify.design/solar/）的 `icons.json`，
  经 `scripts/vendor-solar-icons.mjs` 一次性转写为路径数据 vendored 进 `src/utils/icons.ts`，运行时零依赖。
- 改动（CC BY 4.0 要求注明）：剥掉每枚 body 自带的 `fill / stroke / stroke-width / stroke-linecap /
  stroke-linejoin`，改由 `AppIcon.vue` 按渲染尺寸反算 `stroke-width`（全窗实笔恒 1.15px，圆头圆角），
  以与宿主控件尺寸轴对齐。未改动图形轮廓本身。
- 版本背景：见 `docs/design/distinctive/03-icon-style-solar.md`（骨架选型、线宽与实心状态规则）。
