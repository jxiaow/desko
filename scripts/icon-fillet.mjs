// 图标圆角打样：把 icons.ts 里的纯直线多边形按给定倒圆半径重切，离线板并排对比。
// 用法：node scripts/icon-fillet.mjs [半径1 半径2 ...] [--png]（默认半径 0 2 3，0=现状）
//   --png 用无头浏览器把板子拍成 design/icon-fillet/board.png
// 只处理"全由 M/L/H/V/Z 组成"的 path；含曲线/圆弧的（clip、dots、search 等）原样保留。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'

const ARGS = process.argv.slice(2).filter((a) => a !== '--png')
const PNG = process.argv.includes('--png')
const src = readFileSync('src/utils/icons.ts', 'utf8')
const RADII = (ARGS.length ? ARGS : ['0', '2', '3']).map(Number)
const OUT = 'design/icon-fillet'
mkdirSync(OUT, { recursive: true })

const glyphs = [...src.matchAll(/^  ([a-zA-Z0-9_]+): '(.*?)',$/gm)].map(([, name, body]) => ({ name, body }))

import { toPolylines, fillet, roundBody } from './lib/icon-round.mjs'

const STROKE_PX = 1.05
const cell = (body, s) => {
  const sw = +(STROKE_PX * 24 / s).toFixed(2)
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

const S = 88
const rows = glyphs.map((g) => {
  const cells = RADII.map((r) => {
    const body = roundBody(g.body, r, r === 0 ? 2 : r + 1.5)
    return `<td class="c"><div>${cell(body, S)}</div><small>r=${r}</small></td>`
  }).join('')
  const changed = RADII.slice(1).some((r) => roundBody(g.body, r, r + 1.5) !== g.body)
  return `<tr class="${changed ? '' : 'same'}"><th>${g.name}</th>${cells}<td class="raw">${g.body.replace(/</g, '&lt;')}</td></tr>`
}).join('\n')

writeFileSync(`${OUT}/board.html`, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:12px system-ui;background:#fcfcfc;color:#333230}
h2{margin:0;padding:8px 12px;background:#1d1c1a;color:#fff;font:14px system-ui}
table{border-collapse:collapse;width:100%}
th{text-align:right;padding:0 10px;font-weight:600;width:110px;vertical-align:middle}
td{border-bottom:1px solid #e6e6e4;padding:6px 8px;vertical-align:middle}
td.c{text-align:center;width:${S + 24}px}
td.c small{display:block;color:#8a8884}
td.raw{font:11px Consolas,monospace;color:#8a8884;word-break:break-all}
tr.same{opacity:.45}
</style><h2>图标倒圆打样 · 半径单位 = 24 网格 · 实笔恒定 ${STROKE_PX}px · 灰显=无直线多边形不受影响</h2>
<table>${rows}</table>`)
console.log(`已生成 ${OUT}/board.html（半径 ${RADII.join(' / ')}，共 ${glyphs.length} 枚）`)

if (PNG) {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(`file:///${process.cwd().replace(/\\/g, '/')}/${OUT}/board.html`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/board.png`, fullPage: true })
  await browser.close()
  console.log(`已拍 ${OUT}/board.png`)
}
