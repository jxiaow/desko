// V5.2 收编轮 P6 交付出图：小记页（逐键自伸缩 composer + 插入芯片 + meta 标签胶囊）× 两主题
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/v52-notes-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/v52-notes'
mkdirSync(OUT, { recursive: true })

const NOTES = [
  { title: '会议纪要', content_html: '<p>第一条小记：周会纪要与待办 #产品 #上线计划</p>' },
  { title: '灵感', content_html: '<p>第二条小记：灵感片段 #产品</p>' },
  { title: '清单', content_html: '<p>第三条小记：周末采购清单</p><ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>买牛奶</p></div></li></ul>' },
]

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))

  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { notes: NOTES, settings: { theme, accent: 'ink' } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.locator('a.nav-item[href="/notes"]').click()
  await page.waitForSelector('.composer .ProseMirror')

  const shot = async (name) => {
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    console.log(`${theme}-${name}.png`)
  }

  const pm = page.locator('.composer .ProseMirror')
  const chip = (label) => page.locator(`.composer button[aria-label="${label}"]`)

  await page.mouse.move(1020, 660)
  // 1 静置：composer 收成一行，标签胶囊在卡顶
  await shot('1-idle')

  // 2 逐键自伸缩：三行内容长到三行高，工具条与芯片显形
  await pm.click()
  await page.keyboard.type('发布前清单')
  await page.keyboard.press('Enter')
  await page.keyboard.type('跑一遍 E2E')
  await page.keyboard.press('Enter')
  await page.keyboard.type('把小记的三件增量核一遍')
  await shot('2-auto-grow')

  // 3 待办芯片：当前行变成任务项
  await page.keyboard.press('Enter')
  await page.keyboard.type('打包安装')
  await chip('插入待办项').click()
  await shot('3-chip-task')

  // 4 代码芯片：光标处起一段行内代码
  await chip('插入行内代码').click()
  await page.keyboard.type('npm run build')
  await shot('4-chip-code')

  // 5 标签胶囊点开筛选：命中的那颗转主色
  await page.locator('.memo .tag-pill').first().click()
  await page.mouse.move(1020, 660)
  await shot('5-pill-filter')

  await page.close()
}
await browser.close()
console.log('done')
