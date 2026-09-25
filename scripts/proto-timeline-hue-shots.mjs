// 导轨/色相原型出图：无头 Edge 打开 docs/design/timeline-hue/*.html，按窗口本体裁剪截图。
// 用法：node scripts/proto-timeline-hue-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(import.meta.dirname, '../docs/design/timeline-hue')
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })

const PAGES = ['01-rail', '02-hue']
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1100, height: 730 }, deviceScaleFactor: 1.5 })
for (const name of PAGES) {
  await page.goto(`file:///${DIR.replace(/\\/g, '/')}/${name}.html`)
  await page.waitForTimeout(300)
  await page.locator('.win').screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${OUT}/${name}.png`)
}
await browser.close()
