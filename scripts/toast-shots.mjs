// V5.2 P4 交付拍图 → 10-12 搬家轮：toast 顶沿居中反色胶囊（成功 0.8s / 错误 2.4s / 与批量底栏同屏）
// 用法：PW_CHANNEL=msedge node scripts/toast-shots.mjs   （需先起 vite --mode e2e --port 1430）
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dirname, '../design/v52-toast')
mkdirSync(OUT, { recursive: true })

const SEED = {
  settings: { theme: 'paper', accent: 'ink' },
  entries: [
    { name: 'GitHub', url: 'https://github.com/jiangxz/desko', username: '', password: '', notes: '代码托管平台', category: '开发' },
    { name: 'MDN Flexbox', url: 'https://developer.mozilla.org/docs/Web/CSS/flex', username: '', password: '', notes: '', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'me', password: 'Pw#2026', notes: '', category: '邮箱' },
  ],
  notes: [], fileShortcuts: [
    { name: '主程序', path: 'C:/work/src/main.ts', shortcut_type: 'file' },
    { name: '月度报告', path: 'C:/work/reports/2026-09.pdf', shortcut_type: 'file' },
    { name: '项目资料', path: 'C:/work/desko/project', shortcut_type: 'folder' },
  ], mfaTokens: [],
  fileshare: { running: false, port: 8000, boundPort: 8000, shareDirs: [], hasPassword: false },
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  SEED.settings.theme = theme
  const ctx = await browser.newContext({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, SEED)
  await page.goto('http://127.0.0.1:1430/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.entry-card', { timeout: 15000 })
  await page.waitForTimeout(400)

  // 1. 成功胶囊（800ms 即走：只等元素出现、按元素尺寸拍，抢在淡出之前）
  const first = page.locator('.entry-card').first()
  await first.hover()
  const t0 = Date.now()
  await first.locator('.ec-act').first().click()
  const pill = page.locator('.toast')
  await pill.waitFor({ state: 'visible' })
  await pill.screenshot({ path: `${OUT}/${theme}-1-success.png` })
  console.log(`${theme} success shot at +${Date.now() - t0}ms`)
  await page.waitForTimeout(1000)

  // 2. 错误胶囊：文件页空表单提交，2.4s 停留；先收掉弹窗再拍，看它在净画布上的样子
  await page.locator('a.nav-item[href="/files"]').click()
  await page.waitForSelector('.shortcut-row')
  await page.locator('.page-bar button.btn-primary').click()
  const dialog = page.locator('.dialog-overlay .dialog')
  await dialog.locator('button.btn-primary:text-is("添加")').click()
  await page.waitForSelector('.toast.error')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${OUT}/${theme}-2-error.png` })
  await page.waitForTimeout(2600)

  // 3. 与批量底栏同屏：胶囊居上、底栏居中贴底，验互不占位（用错误类，2.4s 停留才拍得清）
  await page.locator('a.nav-item[href="/entries"]').click()
  await page.waitForSelector('.entry-card')
  await page.locator('.page-bar .bar-btn').first().click()
  await first.click()
  await page.waitForSelector('.batch-dock')
  await page.locator('.page-bar .btn-primary').click()
  const entryDialog = page.locator('.dialog-overlay .dialog')
  await entryDialog.locator('.add-path').fill('http://x')
  await entryDialog.locator('.add-path').press('Enter')
  await page.waitForSelector('.toast.error')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(120)
  await page.screenshot({ path: `${OUT}/${theme}-3-with-dock.png` })

  console.log(`${theme}: 3 shots`)
  await ctx.close()
}
await browser.close()
console.log('done')
