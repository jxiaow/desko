// 把 scripts/theme-shots.mjs 产出的同屏截图并排成多主题对比图。
// 用法：node scripts/theme-compare.mjs
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'
import { themeCombos } from './lib/theme-tokens.mjs'

const OUT = 'design/theme-shots'
// 底色 × accent 的全部组合（与 theme-shots.mjs 同源，两边都读 theme.ts）
const COMBOS = themeCombos().map(({ id, name }) => ({ id, name }))

const screens = [...new Set(readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.startsWith('compare-')))];
// 组合 id 本身带 '-'，屏名按前缀剥：'paper-celadon-entries.png' -> 'entries.png'
const keyOf = (f) => {
  const hit = COMBOS.map((c) => c.id).sort((a, b) => b.length - a.length).find((id) => f.startsWith(`${id}-`))
  return hit ? f.slice(hit.length + 1) : f.split('-').slice(1).join('-')
}
const keys = [...new Set(screens.map(keyOf))].sort()

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:13px system-ui;background:#fff}
h2{margin:0;padding:10px 14px;background:#1a1b20;color:#fff;font-size:14px}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:#888}
.cell{background:#fff;position:relative}
.cell b{position:absolute;top:6px;left:6px;padding:3px 8px;background:#000c;color:#fff;font-size:12px;border-radius:4px;z-index:2}
.cell img{display:block;width:100%}
</style>
<script>addEventListener('error',e=>{if(e.target.tagName==='IMG')e.target.style.visibility='hidden'},true)</script>
${keys
  .map(
    (k) => `<h2>${k}</h2><div class="row" id="row-${k.replace('.png', '')}">${COMBOS.map(
      (t) => `<div class="cell"><b>${t.name}</b><img src="${t.id}-${k}"></div>`,
    ).join('')}</div>`,
  )
  .join('')}
`

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' })
const page = await browser.newPage({ viewport: { width: 2560, height: 1200 }, deviceScaleFactor: 1 })
// 相对路径要靠 file:// 的目录基准才能解析，setContent 的 about:blank 不行
const { writeFileSync } = await import('node:fs')
const { resolve } = await import('node:path')
writeFileSync(`${OUT}/index.html`, html)
await page.goto(`file:///${resolve(OUT).replace(/\\/g, '/')}/index.html`, { waitUntil: 'networkidle' })
for (const k of keys) {
  await page.locator(`#row-${k.replace('.png', '')}`).screenshot({ path: `${OUT}/compare-${k}` })
  console.log(`compare-${k}`)
}
await browser.close()
