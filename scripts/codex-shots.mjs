// Codex 账号页重排交付出图：三行行内事实 × 两主题 / 批量 dock / 重置确认框 / 添加账号（登录·导入）/ 设置·Codex 面板
// 用法：先起 vite --mode e2e --port 1430，再 PW_CHANNEL=msedge node scripts/codex-shots.mjs
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:1430'
const OUT = 'shots'
const EXPECTED = [
  'codex-list.png',
  'codex-list-ink.png',
  'codex-batch.png',
  'codex-reset-confirm.png',
  'codex-auth.png',
  'codex-import.png',
  'codex-settings.png',
]

const ACCOUNTS = [
  {
    email: 'main@e2e.dev', account_name: '主力', plan_type: 'pro', hourly: 82, weekly: 60, current: true,
    user_id: '9f6305d7-1111-2222-3333-444455556666', account_structure: 'personal',
    subscription_until: '2027-01-01T10:18:00', tags: ['工作'], login_provider: 'google',
  },
  {
    email: 'team@e2e.dev', account_name: '团队号', plan_type: 'team', hourly: 34, weekly: 71,
    organization_id: 'org-7c31a90b11', account_structure: 'team',
    subscription_until: '2027-03-06T09:00:00', tags: ['团队'], login_provider: 'github',
  },
  {
    email: 'back@e2e.dev', account_name: '备用', plan_type: 'plus', hourly: 12, weekly: 44,
    account_structure: 'personal', subscription_until: '1798761600', login_provider: 'password',
  },
]

const config = (theme) => ({
  settings: { codex_enabled: 'true', theme, accent: 'ink' },
  codex: { accounts: ACCOUNTS },
})

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge' })
mkdirSync(OUT, { recursive: true })
// 缺帧对账：先删旧图，跑完数一遍
EXPECTED.forEach((f) => existsSync(`${OUT}/${f}`) && rmSync(`${OUT}/${f}`))

async function openApp(theme) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 670 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => console.log(`[${theme}] pageerror: ${e.message}`))
  await page.addInitScript((cfg) => { window.__E2E_CONFIG__ = cfg }, config(theme))
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.unlock-input')
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await page.locator('a.nav-item[href="/codex"]').click()
  await page.waitForSelector('.acc-row')
  return page
}

const shot = async (page, name) => {
  await page.waitForTimeout(320)
  await page.screenshot({ path: `${OUT}/${name}` })
  console.log(`wrote ${name}`)
}

// 1/2 账号页：两主题，三行事实 + 配额块
for (const theme of ['paper', 'ink']) {
  const page = await openApp(theme)
  await page.mouse.move(1030, 660)
  await shot(page, theme === 'paper' ? 'codex-list.png' : 'codex-list-ink.png')
  if (theme === 'paper') {
    // 3 批量态：dock 里含「导出所选 JSON」
    await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
    await page.locator('.acc-row').nth(0).locator('.acc-main').click()
    await page.locator('.acc-row').nth(1).locator('.acc-main').click()
    await shot(page, 'codex-batch.png')

    // 4 重置 5 小时额度：弹窗里先摆可用次数与明细（只有还有次数的号才出这一项）
    await page.locator('.page-bar .bar-btn', { hasText: '退出选择' }).click()
    await page.locator('.acc-row[data-email="back@e2e.dev"] .acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '重置 5 小时额度' }).click()
    const reset = page.locator('.reset-credit-dialog')
    await reset.waitFor()
    await reset.locator('.rc-row').first().waitFor()
    await shot(page, 'codex-reset-confirm.png')
    await reset.locator('.dialog-footer button', { hasText: '取消' }).click()
    await reset.waitFor({ state: 'detached' })

    // 5/6 添加账号：浏览器登录 tab 与导入 tab
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.waitFor()
    await shot(page, 'codex-auth.png')
    await dialog.locator('.seg-btn', { hasText: '导入' }).click()
    await dialog.locator('.pathline').waitFor()
    await shot(page, 'codex-import.png')
    await dialog.locator('.dialog-close').click()

    // 7 设置·Codex 面板：凭据路径与「打开 config.toml」
    await page.locator('button[title="设置"]').click()
    const settings = page.locator('.settings-dialog')
    await settings.waitFor()
    await settings.locator('.nav-tab', { hasText: 'Codex 账号' }).click()
    const path = settings.locator('.codex-path')
    await path.waitFor()
    await path.scrollIntoViewIfNeeded()
    await shot(page, 'codex-settings.png')
  }
  await page.close()
}

await browser.close()

const missing = EXPECTED.filter((f) => !existsSync(`${OUT}/${f}`))
if (missing.length) {
  console.error(`缺帧：${missing.join(', ')}`)
  process.exit(1)
}
console.log(`${EXPECTED.length} 帧全部为本次新拍`)
