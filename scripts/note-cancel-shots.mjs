// #1a/#1b 验收：composer 展开态（无待办/代码芯片，新记有「放弃」）+ 卡片就地编辑条（有「取消」）。
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/note-cancel-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/note-cancel'
mkdirSync(OUT, { recursive: true })

const NOTES = [{ title: '就地编辑样张', content_html: '<p>点进来看看编辑条上的取消钮。</p>' }]
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  await ctx.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { notes: NOTES, settings: { theme, accent: 'celadon' } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))
  await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.memo')

  // 1 composer 展开：敲一行让它长高，看工具条（无芯片，新记=「放弃」）
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  await page.keyboard.type('新建一条小记')
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${OUT}/${theme}-composer.png` })
  const chipCount = await page.locator('.composer .chip-row, .composer button[aria-label="插入待办项"], .composer button[aria-label="插入行内代码"]').count()
  const discardCount = await page.locator('.composer button', { hasText: '放弃' }).count()

  // 2 卡片就地编辑：动作排悬停才显形可点，先 hover 再点编辑（铅笔）钮
  await page.locator('.memo').first().hover()
  await page.waitForTimeout(120)
  await page.locator('.memo button[title="编辑"]').first().click()
  await page.waitForSelector('.memo.editing .edit-bar')
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${OUT}/${theme}-cardedit.png` })
  const cancelCount = await page.locator('.memo.editing .edit-bar button[title="取消"]').count()

  console.log(`${theme}: composer 芯片数=${chipCount}（应 0），放弃钮=${discardCount}（应≥1），卡编辑取消钮=${cancelCount}（应≥1）`)
  await ctx.close()
}
await browser.close()
console.log('done')
