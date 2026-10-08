// 一次性验收：文件快捷 添加/编辑 弹窗按首页新风格适配后的效果
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/shortcut-dialog'
mkdirSync(OUT, { recursive: true })

const SEED = {
  entries: [],
  urlPaths: [],
  notes: [],
  fileShortcuts: [
    { name: '项目资料', path: 'C:/work/desko/project', shortcut_type: 'folder' },
    { name: '月度报告', path: 'C:/work/reports/2026-09.pdf', shortcut_type: 'file' },
    { name: '预算表', path: 'C:/work/finance/budget.xlsx', shortcut_type: 'file' },
    { name: '需求文档', path: 'C:/work/spec/client-arch.docx', shortcut_type: 'file' },
    { name: '构建脚本', path: 'C:/work/tools/build.ps1', shortcut_type: 'file' },
    { name: '压缩包', path: 'C:/work/inbox/app-package.zip', shortcut_type: 'file' },
  ],
  mfaTokens: [],
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })

for (const theme of ['paper', 'ink']) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, { ...SEED, settings: { theme, accent: 'ink' } })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.waitForSelector('.sidebar, .app-shell')
  await page.locator('a.nav-item[href="/files"]').click()
  await page.waitForSelector('.shortcut-list .grid-card')

  const shot = async (name) => {
    await page.waitForTimeout(340)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    console.log(`${theme}-${name}.png`)
  }

  // 1. 新增：空表单
  await page.locator('.page-bar button.btn-primary').click()
  await page.waitForSelector('.shortcut-dialog')
  await shot('1-add-empty')

  // 2. 新增：填了路径 + 名称（类型自动落到 folder 前先手动键入）
  await page.locator('.shortcut-dialog .path-input-row input').fill('C:/work/reports/annual-2026.pdf')
  await page.locator('.shortcut-dialog input[placeholder="快捷方式名称"]').fill('年度报告')
  await shot('2-add-filled')
  await page.keyboard.press('Escape')

  // 3. 编辑：hover 第一张卡 → 编辑钮（第二个 .ib）
  const card = page.locator('.shortcut-list .grid-card').first()
  await card.hover()
  await card.locator('.sc-acts .ib').nth(1).click()
  await page.waitForSelector('.shortcut-dialog')
  await shot('3-edit')

  await page.close()
}
await browser.close()
console.log('done')
