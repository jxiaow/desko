// 把 scripts/theme-shots.mjs 产出的同屏截图并排成四主题对比图。
// 用法：node scripts/theme-compare.mjs
import { chromium } from '@playwright/test'
import { readdirSync } from 'node:fs'

const OUT = 'design/theme-shots'
const THEMES = [
  { id: 'cool', name: '冷灰' },
  { id: 'white', name: '素白' },
  { id: 'dark', name: '夜墨' },
  { id: 'classic', name: '经典' },
]

const screens = [...new Set(readdirSync(OUT).filter((f) => f.endsWith('.png') && !f.startsWith('compare-')))];
const keys = [...new Set(screens.map((f) => f.split('-').slice(1).join('-')))].sort()

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font:13px system-ui;background:#fff}
h2{margin:0;padding:10px 14px;background:#1a1b20;color:#fff;font-size:14px}
.row{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;background:#888}
.cell{background:#fff;position:relative}
.cell b{position:absolute;top:6px;left:6px;padding:3px 8px;background:#000c;color:#fff;font-size:12px;border-radius:4px;z-index:2}
.cell img{display:block;width:100%}
</style>
${keys
  .map(
    (k) => `<h2>${k}</h2><div class="row" id="row-${k.replace('.png', '')}">${THEMES.map(
      (t) => `<div class="cell"><b>${t.name} ${t.id}</b><img src="${t.id}-${k}"></div>`,
    ).join('')}</div>`,
  )
  .join('')}
`

const browser = await chromium.launch({ channel: 'chrome' })
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
