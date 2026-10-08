// 一次性验收：文件快捷卡片 ⋯ 更多菜单（hover 动作列 + 删除浮层）
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'design/more-menu'
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
    { name: '主程序', path: 'C:/work/src/main.ts', shortcut_type: 'file' },
    { name: '截图', path: 'C:/work/shots/grid-ink.png', shortcut_type: 'file' },
    { name: '日志归档', path: 'C:/work/logs/2026-08.zip', shortcut_type: 'file' },
    { name: '设计稿', path: 'C:/work/design/v52.fig', shortcut_type: 'file' },
    { name: '备忘', path: 'C:/work/notes/todo.md', shortcut_type: 'file' },
    { name: '导出数据', path: 'C:/work/export/data.csv', shortcut_type: 'file' },
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
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` })
    console.log(`${theme}-${name}.png`)
  }

  const card = page.locator('.shortcut-list .grid-card').last()
  await page.mouse.move(1020, 660)
  await shot('0-static')
  await card.hover()
  await shot('1-hover-actions')

  await card.locator('.sc-acts .ib').last().click()
  await shot('2-more-menu')

  await page.close()
}
await browser.close()
console.log('done')
