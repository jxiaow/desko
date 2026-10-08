// V5.2 收藏页对拍出图：无头 Edge，实尺 1040×670 × 两主题 × 新旧两版
// 用法：node scripts/v52-shots.mjs   （需 PW_CHANNEL=msedge，本机默认通道）
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const DIR = resolve(import.meta.dirname, '../docs/design/v52/proto')
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
const page = await browser.newPage({ viewport: { width: 1120, height: 1500 }, deviceScaleFactor: 1.5 })
await page.goto(`file:///${DIR.replace(/\\/g, '/')}/01-entries-grid.html`)

for (const theme of ['paper', 'ink']) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t
    document.getElementById('tag').textContent =
      `${t === 'paper' ? 'Paper 净灰 v3' : 'Ink V5.2 新阶梯'} · 左 A 一行卡 / B 浮岛网格`
  }, theme)
  await page.waitForTimeout(200)
  for (const [id, name] of [['winA', 'rows'], ['winB', 'grid']]) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    await page.waitForTimeout(120)
    const file = `${OUT}/${theme}-${name}.png`
    await page.locator(`#${id}`).screenshot({ path: file })
    console.log(file)
  }
}
await browser.close()
