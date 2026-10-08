// 图标全家福：把 utils/icons.ts 的全部图标按 AppIcon 的渲染规格
// （viewBox 24，实笔恒定 STROKE_PX，按尺寸反算 stroke-width，round cap/join）
// 在 14/16/20/24 四档尺寸下排一遍，每套主题一张图，专查描边粗细、光学尺寸和深色下的可读性。
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
// 与 AppIcon.vue 同源：实笔宽按尺寸反算，全窗恒定 1.15px（写死 2 会让小板子和真界面不像）
const STROKE_PX = 1.15
const strokeFor = (s) => +(STROKE_PX * 24 / s).toFixed(2)

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

const cell = (icon) => {
  // 实心件在 AppIcon 里走 fill=currentColor / stroke=none，板上必须同规格，否则看着像没画完
  const filled = icon.name.endsWith('Filled')
  const paint = filled ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor"'
  return `
  <div class="cell">
    <div class="row">${SIZES.map((s) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" ${paint} stroke-width="${strokeFor(s)}" stroke-linecap="round" stroke-linejoin="round">${icon.markup}</svg>`).join('')}</div>
    <div class="nm">${icon.name}</div>
  </div>`
}

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
  <div class="sub">每格从左到右：14 / 16 / 20 / 24 px · 共 ${icons.length} 枚 · 规格同源 AppIcon（实笔恒定 ${STROKE_PX}px）</div>
  <div class="grid">${icons.map(cell).join('')}</div>
</div>`).join('')}`

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1320, height: 900 }, deviceScaleFactor: 1.5 })
await page.setContent(html, { waitUntil: 'load' })

// 几何守护：Solar 是满幅件（图形本体占 2–22，比 Tabler 的 3–21 更铺得开），所以留白全部来自
// viewBox 边到画布的距离。按 App 内最小档位（12px，sw = 轨宽 × 24/12）量含笔宽的紧包围盒：
// 越出 0–24 就会被 viewBox 裁掉一角 —— 肉眼看缩略图看不出来。
const MIN_RENDER_PX = 12
const overflow = await page.evaluate((sw12) => {
  const bad = []
  for (const theme of document.querySelectorAll('.theme')) {
    theme.querySelectorAll('.cell').forEach((cell, i) => {
      const svg = cell.querySelector('.row svg')
      // 实心件（*-Filled）在 AppIcon 里走 fill=currentColor / stroke=none，不该按描边量
      const filled = cell.querySelector('.nm').textContent.endsWith('Filled')
      const sw = filled ? 0 : sw12
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const el of svg.querySelectorAll('path,rect,circle,line,polyline')) {
        const b = el.getBBox()
        x0 = Math.min(x0, b.x - sw / 2); y0 = Math.min(y0, b.y - sw / 2)
        x1 = Math.max(x1, b.x + b.width + sw / 2); y1 = Math.max(y1, b.y + b.height + sw / 2)
      }
      if (x0 < 0 || y0 < 0 || x1 > 24 || y1 > 24)
        bad.push(`${cell.querySelector('.nm').textContent}: (${x0.toFixed(2)},${y0.toFixed(2)})–(${x1.toFixed(2)},${y1.toFixed(2)})`)
    })
    break
  }
  return bad
}, strokeFor(MIN_RENDER_PX))
for (const line of overflow) console.log(`越界 ${line}`)

mkdirSync('design/icon-board', { recursive: true })
for (const c of COMBOS) {
  await page.locator(`#t-${c.id}`).screenshot({ path: `design/icon-board/${c.id}.png` })
  console.log(`design/icon-board/${c.id}.png`)
}
await browser.close()
if (overflow.length) { console.log(`${overflow.length} 枚图标描边越出 viewBox（0–24），会被裁角`); process.exit(1) }
