// 侧栏 + 窗口控件验收截图：真应用里拍「展开 180 / 折叠 64」两态侧栏，
// 外加标题栏右端那一排按钮（含最大化和还原两种 glyph），每套配色一张。
// 用法：先起 vite --mode e2e --port 1430，再 node scripts/nav-shots.mjs [combo ...]
// 默认拍 paper-celadon 与 ink-celadon；输出 design/nav-shots/<combo>/*.png
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const COMBOS = process.argv.slice(2).length ? process.argv.slice(2) : ['paper-celadon', 'ink-celadon']

const SEED = (theme, accent) => ({
  settings: { theme, accent, mfa_enabled: 'true', fileshare_enabled: 'true' },
  entries: [{ name: 'GitHub', url: 'https://github.com', username: 'dev', password: 'x' }],
  notes: [{ title: '纪要', content_html: '<p>正文</p>', category: '工作' }],
  fileShortcuts: [{ name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' }],
  mfaTokens: [{ issuer: 'GitHub', label: 'dev@example.com' }],
  fileshare: { running: true, port: 8000, boundPort: 8000, shareDirs: ['D:\\share\\docs'], hasPassword: true },
})

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const combo of COMBOS) {
  const theme = combo.slice(0, combo.indexOf('-'))
  const accent = combo.slice(combo.indexOf('-') + 1)
  const out = `design/nav-shots/${combo}`
  mkdirSync(out, { recursive: true })

  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, SEED(theme, accent))
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.app-layout')
  await page.waitForTimeout(400)

  const shoot = async (name, locator) => {
    await (locator ?? page.locator('body')).screenshot({ path: `${out}/${name}.png` })
    console.log(`${out}/${name}.png`)
  }

  // 侧栏默认就是折叠档（App.vue isSidebarCollapsed = true），先拍折叠，再展开
  await shoot('1-sidebar-collapsed', page.locator('.sidebar'))
  await page.locator('.sidebar-toggle').click()
  await page.waitForTimeout(400)
  await shoot('2-sidebar-expanded', page.locator('.sidebar'))
  // 展开档里逐个模块点一遍，看 accent 重音落在哪枚 glyph 上
  for (const path of ['/notes', '/files', '/mfa', '/fileshare']) {
    await page.locator(`a.nav-item[href="${path}"]`).click()
    await page.waitForTimeout(250)
    await shoot(`2-sidebar-active-${path.slice(1)}`, page.locator('.sidebar'))
  }
  await page.locator('a.nav-item[href="/entries"]').click()
  await page.waitForTimeout(250)

  // 标题栏右端：设置/锁定分隔 + 最小化/最大化/关闭
  await shoot('3-titlebar-buttons', page.locator('.titlebar-buttons'))
  // 还原态 glyph：mock 的 toggleMaximize 会翻转 isMaximized，点中间那颗即换形
  // （不按 title 选——全局 tooltip 会把 title 搬进 data-tip，属性选择器拍不到）
  await page.locator('.titlebar-buttons button').nth(3).click()
  await page.waitForTimeout(400)
  await shoot('4-titlebar-restored', page.locator('.titlebar-buttons'))

  await page.close()
}

await browser.close()
console.log('done')
