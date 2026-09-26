// R1 原型出图：无头 Edge 打开 docs/design/redesign/<dir>/*.html，按窗口本体裁剪截图。
// 用法：node scripts/redesign-r1-shots.mjs [proto|proto-bento]（默认 proto）
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const SUB = process.argv[2] || 'proto'
const DIR = resolve(import.meta.dirname, `../docs/design/redesign/${SUB}`)
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })

const PAGES = ['01-entries', '02-notes', '03-mfa']
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1100, height: 730 }, deviceScaleFactor: 1.5 })
for (const name of PAGES) {
  await page.goto(`file:///${DIR.replace(/\\/g, '/')}/${name}.html`)
  await page.waitForTimeout(300)
  await page.locator('.win').screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${OUT}/${name}.png`)
}
await browser.close()
