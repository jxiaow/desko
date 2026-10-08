// V5.2 收编轮 P5 交付出图：局域网页（状态横幅 + 拖拽直投）× 两主题 × 停止/运行/拖入高亮/已投/多目录
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/v52-lan-shots.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/v52-lan'
mkdirSync(OUT, { recursive: true })

const DIR = 'C:\\desko-e2e\\shared'
const cfg = (theme, fileshare) => ({
  settings: { theme, accent: 'ink', fileshare_enabled: 'true' },
  entries: [{ name: 'GitHub', url: 'https://github.com' }],
  fileshare,
})

const RUN = { running: true, shareDirs: [DIR] }

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))

  const boot = async (fileshare) => {
    await page.addInitScript((c) => { window.__E2E_CONFIG__ = c }, cfg(theme, fileshare))
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.unlock-input')
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await page.waitForSelector('.dir-add')
    await page.waitForTimeout(260)
  }

  const shot = async (name) => {
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    console.log(`${theme}-${name}.png`)
  }

  const drag = (type, paths) =>
    page.evaluate(
      ([t, p]) => window.__E2E__.emitEvent('tauri://drag-drop', { type: t, paths: p, position: { x: 520, y: 330 } }),
      [type, paths],
    )

  await page.mouse.move(1020, 660)

  // 1 未启动：横幅只说没启动，拖拽井置灰
  await boot({ shareDirs: [DIR] })
  await shot('1-stopped')

  // 2 运行中（无口令）：横幅给局域网地址，警告位亮一次
  await boot(RUN)
  await shot('2-running')

  // 3 拖入悬停：虚线井转 accent
  await drag('enter', [`${DIR}\\photo.jpg`])
  await shot('3-drag-active')

  // 4 落盘后：提取链接行 + 失败原因 toast（错误档驻留 2.4s，来得及拍全窗）
  await drag('drop', ['D:\\tmp\\photo.jpg', 'D:\\tmp\\big_pack.zip', 'D:\\tmp\\季度报告.pdf'])
  await shot('4-received')

  // 5 多共享目录：投到哪一格由芯片选
  await boot({ running: true, shareDirs: [DIR, 'D:\\share\\docs'], hasPassword: true })
  await shot('5-multi-dir')

  await page.close()
}
await browser.close()
console.log('done')
