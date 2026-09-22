import { chromium } from 'playwright-core'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const ctx = browser.contexts()[0]
let page = null
for (const p of ctx.pages()) {
  if (await p.evaluate(() => !!document.querySelector('.app-root')).catch(() => false)) { page = p; break }
}
const cdp = await ctx.newCDPSession(page)
const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget')
const home = await page.evaluate(() => location.pathname)

// 展开侧边栏（220px），这是最吃宽度的状态；本来就是展开的就别动它
const toggle = page.locator('button[data-tip="切换侧边栏"], button[title="切换侧边栏"]').first()
const wasCollapsed = await page.evaluate(() => document.querySelector('.sidebar').classList.contains('collapsed'))
if (wasCollapsed) { await toggle.click({ force: true }); await page.waitForTimeout(500) }
console.log('sidebar:', await page.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)), '原本收起:', wasCollapsed)

const overflow = () => page.evaluate(() => {
  const main = document.querySelector('.main-content')
  let worst = 0, who = ''
  for (const el of main.querySelectorAll('*')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0) continue
    const over = Math.round(b.right - innerWidth)
    if (over > worst) { worst = over; who = el.className?.toString().slice(0, 24) || el.tagName }
  }
  return { clip: worst, by: who }
})

for (const route of ['/entries', '/notes', '/files']) {
  await page.locator(`a.nav-item[href="${route}"]`).click()
  await page.waitForTimeout(500)
  const line = []
  for (const w of [800, 860, 900, 960, 1000]) {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: w, height: 600 } })
    await page.waitForTimeout(220)
    const o = await overflow()
    line.push(`${w}:${o.clip === 0 ? 'ok' : `-${o.clip}${o.by ? '(' + o.by + ')' : ''}`}`)
  }
  console.log(route.padEnd(9), line.join('  '))
}

await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } })
await page.locator(`a.nav-item[href="${home}"]`).click()
await page.waitForTimeout(300)
if (wasCollapsed) await toggle.click({ force: true })
console.log('还原 ->', await page.evaluate(() => [location.pathname, innerWidth, innerHeight]))
browser.close()
