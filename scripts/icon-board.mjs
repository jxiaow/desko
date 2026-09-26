// 图标全家福：把 utils/icons.ts 的全部图标按 AppIcon 的渲染规格
// （viewBox 24、stroke-width 2、round cap/join）在 14/16/20/24 四档尺寸下排一遍，
// 每套主题一张图，专查描边粗细、光学尺寸和深色下的可读性。
// 用法：node scripts/icon-board.mjs        （不需要起服务器，纯离线渲染）
// 输出：design/icon-board/<themeId>.png
import { chromium } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

// v2 双轴：2 底色 × 4 accent = 8 块板
const COMBOS = [
  { id: 'paper-ink', theme: 'paper', accent: 'ink' },
  { id: 'paper-celadon', theme: 'paper', accent: 'celadon' },
  { id: 'paper-clay', theme: 'paper', accent: 'clay' },
  { id: 'paper-plum', theme: 'paper', accent: 'plum' },
  { id: 'ink-ink', theme: 'ink', accent: 'ink' },
  { id: 'ink-celadon', theme: 'ink', accent: 'celadon' },
  { id: 'ink-clay', theme: 'ink', accent: 'clay' },
  { id: 'ink-plum', theme: 'ink', accent: 'plum' },
]
const SIZES = [14, 16, 20, 24]

// 1) 图标注册表
const iconsSrc = readFileSync('src/utils/icons.ts', 'utf8')
const icons = [...iconsSrc.matchAll(/^  (\w+): '(.*)',$/gm)].map(([, name, markup]) => ({ name, markup }))
if (!icons.length) throw new Error('icons.ts 解析结果为空，检查注册表格式')

// 2) 主题令牌：把 global.css 的底色块 + accent 覆盖块原样搬进页面，拼成每组的 [data-theme][data-accent] 块
const css = readFileSync('src/styles/global.css', 'utf8')
const grab = (re, label) => {
  const m = css.match(re)
  if (!m) throw new Error(`global.css 里没找到 ${label} 块`)
  return m[1]
}
const blocks = COMBOS.map((c) => ({
  ...c,
  body:
    grab(new RegExp(`\\[data-theme="${c.theme}"\\]\\s*\\{([\\s\\S]*?)\\}`), `data-theme="${c.theme}"`) +
    grab(new RegExp(`\\[data-theme="${c.theme}"\\]\\[data-accent="${c.accent}"\\] \\{([\\s\\S]*?)\\}`), `accent="${c.accent}"`),
}))

const cell = (icon) => `
  <div class="cell">
    <div class="row">${SIZES.map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.markup}</svg>`).join('')}</div>
    <div class="nm">${icon.name}</div>
  </div>`

const html = `<!doctype html><meta charset="utf-8"><style>
${blocks.map((b) => `[data-theme="${b.theme}"][data-accent="${b.accent}"] {${b.body}}`).join('\n')}
body { margin: 0; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.theme { background: var(--bg); color: var(--text); padding: 20px 24px; }
.hd { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.sub { font-size: 12px; color: var(--text-muted); margin-bottom: 14px; }
.grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.cell { background: var(--panel-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 8px 6px; }
.row { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 26px; }
.nm { font-size: 10px; color: var(--text-muted); text-align: center; margin-top: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
${COMBOS.map((c) => `
<div class="theme" data-theme="${c.theme}" data-accent="${c.accent}" id="t-${c.id}">
  <div class="hd">${c.id}</div>
  <div class="sub">每格从左到右：14 / 16 / 20 / 24 px · 共 ${icons.length} 枚 · 规格同源 AppIcon（stroke-width 2）</div>
  <div class="grid">${icons.map(cell).join('')}</div>
</div>`).join('')}`

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.5 })
await page.setContent(html, { waitUntil: 'load' })
mkdirSync('design/icon-board', { recursive: true })
for (const c of COMBOS) {
  await page.locator(`#t-${c.id}`).screenshot({ path: `design/icon-board/${c.id}.png` })
  console.log(`design/icon-board/${c.id}.png`)
}
await browser.close()
