# Solar 图标集（应用内图标骨架）

- 作品：**Solar**（Linear / Round / Bold 家族，共 8706 枚），本仓库取用其中 63 枚：
  `src/utils/icons.ts` 里 62 枚 `*-linear` 描边件 + 1 枚 `*-bold` 实心件（已收藏状态位）。
- 作者：**480 Design** — https://www.figma.com/community/file/1166831539721848736
- 许可：**CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- 取数：`@iconify-json/solar` v1.2.13（https://icon-sets.iconify.design/solar/）的 `icons.json`，
  经 `scripts/vendor-solar-icons.mjs` 一次性转写为路径数据 vendored 进 `src/utils/icons.ts`，运行时零依赖。
- 改动（CC BY 4.0 要求注明）：剥掉每枚 body 自带的 `fill / stroke / stroke-width / stroke-linecap /
  stroke-linejoin`，改由 `AppIcon.vue` 按渲染尺寸反算 `stroke-width`（全窗实笔恒 1.15px，圆头圆角），
  以与宿主控件尺寸轴对齐。未改动图形轮廓本身。
- 版本背景：见 `docs/design/distinctive/03-icon-style-solar.md`（骨架选型、线宽与实心状态规则）。

# Codex 品牌图标

- `src/utils/icons.ts` 的 `navCodex` 使用 [AGENTS.md 的 Codex SVG](https://github.com/agentsmd/agents.md/blob/main/public/logos/codex.svg)，原仓库为 `openai/agents.md`。
- 保留原始 24×24 图形路径，将固定颜色换成 `currentColor`，以适配应用主题；品牌路径使用实心填充，不叠加 Solar 描边。
- 仓库许可：[MIT](https://github.com/agentsmd/agents.md/blob/main/LICENSE)。许可文本保留如下：

```text
MIT License

Copyright (c) 2025 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
