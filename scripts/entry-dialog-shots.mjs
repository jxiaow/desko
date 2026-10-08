// 收藏弹窗新风格 mock 出图：先跑 node scripts/mock-build.mjs，再跑本脚本
// 用法：node scripts/entry-dialog-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const OUT = 'design/v52-entry-dialog'
const mock = path.resolve('design/v52-entry-dialog/mock.html')

// Playwright 默认带 --hide-scrollbars，会把自定义滚动条整条抹掉
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', ignoreDefaultArgs: ['--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1120, height: 760 }, deviceScaleFactor: 2 })
await page.goto(`file:///${mock.replace(/\\/g, '/')}`)
await page.evaluate(() => document.fonts.ready)

// 每屏出两张：整窗（看弹窗在真实画布上的分量）+ 弹窗紧裁（看细节）
const n = await page.locator('.stage').count()
for (let i = 0; i < n; i++) {
  const stage = page.locator('.stage').nth(i)
  const id = await stage.getAttribute('id')
  await stage.screenshot({ path: `${OUT}/${id}.png` })
  await stage.locator('.dialog').screenshot({ path: `${OUT}/${id}-crop.png` })
  console.log(`${id}.png / ${id}-crop.png`)
}
await browser.close()
