import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

const seed = { settings: { codex_enabled: 'true' }, codex: {
  accounts: [{ email: 'demo@example.invalid' }],
  sessions: [
    { sessionId: 'one', title: '调整搜索布局', cwd: 'C:/Work/Desko', input: 10000, output: 1000, daysAgo: 1 },
    { sessionId: 'two', title: '补充目录操作', cwd: 'C:/Work/Other', input: 20000, output: 2000, daysAgo: 0 },
    { sessionId: 'three', title: '核对会话详情与用量', cwd: 'C:/Work/Other', input: 5000, output: 500, daysAgo: 7 },
  ],
} }
async function boot(page: import('@playwright/test').Page, width = 1040) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 800 })
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.sess-row')).toHaveCount(3)
}
async function chooseDirectory(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: '目录筛选', exact: true }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
}

for (const width of [390, 800, 1040]) {
  test(`${width}px 平铺会话在原卡片内展开，目录筛选不扫描`, async ({ page }) => {
    await boot(page, width)
    await expect(page.locator('.sess-detail')).toHaveCount(0)
    const count = await e2e.count(page, 'codex_list_sessions_across_instances')
    const select = page.getByRole('button', { name: '目录筛选', exact: true })
    const selectWidth = (await select.boundingBox())!.width
    await chooseDirectory(page, 'Other — C:/Work/Other')
    expect((await select.boundingBox())!.width).toBe(selectWidth)
    await expect(page.locator('.sess-row')).toHaveCount(2)
    expect(await e2e.count(page, 'codex_list_sessions_across_instances')).toBe(count)
    const row = page.locator('.sess-row[data-sid="two"]')
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.sess-item').filter({ has: row }).locator('.sess-identity dd')).toHaveText('two')
    await expect(page.locator('.sess-detail')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.locator('.sess-item').filter({ has: row }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    await page.screenshot({ path: `.tmp/codex-inline/${width}.png` })
    await row.click()
    await expect(page.locator('.sess-detail')).toHaveCount(0)
    await expect(row).toBeFocused()
    await page.locator('.sess-row[data-sid="three"]').click()
    await expect(page.locator('.sess-identity dd')).toHaveText('three')
    await page.keyboard.press('Escape')
    await expect(page.locator('.sess-detail')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '目录筛选', exact: true })).toContainText('Other')
    await page.getByRole('button', { name: '目录操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '将此目录会话移到回收站', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('2 条会话')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    expect(await e2e.count(page, 'codex_move_sessions_to_trash_across_instances')).toBe(0)
  })
}

test('目录与关键词共同筛选，空结果仍可切回全部目录', async ({ page }) => {
  await boot(page)
  await chooseDirectory(page, 'Other — C:/Work/Other')
  await page.getByRole('textbox', { name: '搜索会话标题', exact: true }).fill('调整')
  await expect(page.getByText('当前目录没有匹配的会话', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '查看全部目录', exact: true }).click()
  await expect(page.locator('.sess-row')).toHaveCount(1)
  await expect(page.locator('.sess-row')).toContainText('调整搜索布局')
})
