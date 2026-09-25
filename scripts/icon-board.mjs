// 图标全家福：把 utils/icons.ts 的全部图标按 AppIcon 的渲染规格
// （viewBox 24、stroke-width 2、round cap/join）在 14/16/20/24 四档尺寸下排一遍，
// 每套主题一张图，专查描边粗细、光学尺寸和深色下的可读性。
// 用法：node scripts/icon-board.mjs        （不需要起服务器，纯离线渲染）
// 输出：design/icon-board/<themeId>.png
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

const THEMES = [
  'light-cool', 'light-warm', 'light-celadon', 'aluminum-pro',
  'swiss-monochrome', 'linear-dark', 'jetbrains-dark',
]
const SIZES = [14, 16, 20, 24]

// 1) 图标注册表
const iconsSrc = readFileSync('src/utils/icons.ts', 'utf8')
const icons = [...iconsSrc.matchAll(/^  (\w+): '(.*)',$/gm)].map(([, name, markup]) => ({ name, markup }))
if (!icons.length) throw new Error('icons.ts 解析结果为空，检查注册表格式')

// 2) 主题令牌：把 global.css 的主题块原样搬进页面（CSS 变量挂在 [data-theme] 元素上即可继承）
const css = readFileSync('src/styles/global.css', 'utf8')
const blocks = THEMES.map((id) => {
  const m = css.match(new RegExp(`\\[data-theme="${id}"\\] \\{([\\s\\S]*?)\\}`))
  if (!m) throw new Error(`global.css 里没找到 [data-theme="${id}"] 块`)
  return { id, body: m[1] }
})

const cell = (icon) => `
  <div class="cell">
    <div class="row">${SIZES.map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.markup}</svg>`).join('')}</div>
    <div class="nm">${icon.name}</div>
  </div>`

const html = `<!doctype html><meta charset="utf-8"><style>
${blocks.map((b) => `[data-theme="${b.id}"] {${b.body}}`).join('\n')}
body { margin: 0; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.theme { background: var(--bg); color: var(--text); padding: 20px 24px; }
.hd { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.sub { font-size: 12px; color: var(--text-muted); margin-bottom: 14px; }
.grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.cell { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 8px 6px; }
.row { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 26px; }
.nm { font-size: 10px; color: var(--text-muted); text-align: center; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
${THEMES.map((id, i) => `
<div class="theme" data-theme="${id}" id="t-${id}">
  <div class="hd">${id}</div>
  <div class="sub">每格从左到右：14 / 16 / 20 / 24 px · 共 ${icons.length} 枚 · 规格同源 AppIcon（stroke-width 2）</div>
  <div class="grid">${icons.map(cell).join('')}</div>
</div>`).join('')}`

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.5 })
await page.setContent(html, { waitUntil: 'load' })
mkdirSync('design/icon-board', { recursive: true })
for (const id of THEMES) {
  await page.locator(`#t-${id}`).screenshot({ path: `design/icon-board/${id}.png` })
  console.log(`design/icon-board/${id}.png`)
}
await browser.close()
