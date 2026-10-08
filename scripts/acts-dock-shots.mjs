// #3 脱吸动作排验收：真应用里长卡原位（悬停显形，钉在卡右上角）vs 滚动脱吸（磨砂浮岛压在吸顶栏下沿）。
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/acts-dock-shots.mjs
// 输出 design/acts-dock/<theme>-{inplace,docked}.png
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/acts-dock'
mkdirSync(OUT, { recursive: true })

const PARA = '<p>尺度层不动，主题层只管颜色。这一版把 inset 骨架收口：灰底画布 + 白面板列表 + 居中阅读列，行轨统一 60px。吸顶件与画布同源，图标笔画并轨。</p>'
const LONG = `<h2>脱吸动作排样张</h2>${PARA.repeat(10)}<h3>待办</h3><ul><li>把动作排从头部提出</li><li>做成卡片的 sticky 浮层</li><li>顶哨兵滚过吸顶栏下沿时显形</li></ul>${PARA.repeat(8)}`
const FILL = '<p>垫底的一条，只为让列表够长、能滚起来。</p>'

// 新→旧排序：数组末尾的最先显示。长记放最前 → 显示在末尾，前面堆 filler 保证顶部之上还有可滚的量。
const NOTES = [
  { title: '脱吸样张', content_html: LONG, category: '工作' },
  ...Array.from({ length: 6 }, (_, i) => ({ title: `垫底 ${i + 1}`, content_html: FILL })),
]

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

  // 定位那张长卡（按标题文本）
  const card = page.locator('.memo', { hasText: '脱吸动作排样张' }).first()
  const unfold = card.locator('.memo-unfold')
  if (await unfold.count()) await unfold.first().click()
  await page.waitForTimeout(200)

  // 把长卡顶部滚到距列表顶端 gapY 处：>88 为原位、<88 为脱吸。rect 相对定位，不依赖 offsetParent。
  const placeCardTop = (gapY) => page.evaluate((y) => {
    const s = document.querySelector('.stream')
    const c = [...document.querySelectorAll('.memo')].find((el) => el.textContent.includes('脱吸动作排样张'))
    if (!s || !c) return
    s.style.scrollBehavior = 'auto'
    const delta = c.getBoundingClientRect().top - (s.getBoundingClientRect().top + y)
    s.scrollTop += delta
  }, gapY)

  // A 原位：卡顶落在吸顶栏下沿之下（150px），悬停 → 动作排钉在卡右上角
  await placeCardTop(150)
  await card.hover()
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${OUT}/${theme}-inplace.png` })

  // B 脱吸：卡顶滚到吸顶栏下沿之上（30px < 88px 线），动作排应钉在 88px 处显形为磨砂浮岛
  await placeCardTop(30)
  await page.mouse.move(1020, 660)
  await page.waitForTimeout(360)
  await page.screenshot({ path: `${OUT}/${theme}-docked.png` })

  const docked = await page.locator('.memo-acts.docked').count()
  const scrolled = await page.evaluate(() => document.querySelector('.stream')?.scrollTop)
  console.log(`${theme}: scrollTop=${scrolled}，脱吸中浮岛数=${docked}`)
  await ctx.close()
}
await browser.close()
console.log('done')
