import { expect, test } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { webApp } from '../web-helpers'

const sessionId = '019a12fe-1324-7123-8213-3291052e3500'
const config = {
  settings: { codex_enabled: 'true', codex_quota_auto_refresh_minutes: '0' },
  codex: { sessions: [
    { sessionId, title: '检查会话列表与用量统计在手机和桌面窗口中的可读性', cwd: 'C:/Code/desko', projectName: 'desko', daysAgo: 0, hoursAgo: 1, input: 1230000, cached: 980000, output: 92000, model: 'gpt-5.4', turns: 27 },
    { sessionId: 'second', title: '修复窗口布局', cwd: 'C:/Code/desko', projectName: 'desko', daysAgo: 0, hoursAgo: 2, input: 180000, cached: 120000, output: 22000, model: 'gpt-5.4-mini', turns: 6 },
  ] },
}

for (const width of [1040, 1440]) {
  test(`${width}px 今日用量首屏能读到模型首行，图表刻度不随宽度缩放`, async ({ page }) => {
    await page.setViewportSize({ width, height: 670 })
    await page.clock.setFixedTime(new Date('2026-10-23T10:00:00Z'))
    await bootUnlocked(page, config, '/codex')
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await expect(page.locator('.usg-model-row').first()).toBeInViewport({ ratio: 1 })
    const axisSize = await page.locator('.hour-x').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) * (el as SVGTextElement).getScreenCTM()!.a)
    expect(axisSize).toBeGreaterThanOrEqual(11)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  })
}

test('手机 Web 会话标题独占正文行，刻度可读且每日明细无需横向查表', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.setFixedTime(new Date('2026-10-23T10:00:00Z'))
  const app = await webApp(page, config, '/codex')
  await app.login('.content-inner')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  const row = page.locator(`.sess-row[data-sid="${sessionId}"]`)
  await expect(row).toBeVisible()
  const title = await row.locator('.sess-title').boundingBox()
  const meta = await row.locator('.sess-meta').boundingBox()
  expect(title!.width).toBeGreaterThan(260)
  expect(meta!.y).toBeGreaterThanOrEqual(title!.y + title!.height)
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.hour-x').first()).toBeVisible()
  const axisSize = await page.locator('.hour-x').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) * (el as SVGTextElement).getScreenCTM()!.a)
  expect(axisSize).toBeGreaterThanOrEqual(11)
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-daily')).toBeVisible()
  expect(await page.locator('.usg-daily .usg-table-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  expect(app.errors).toEqual([])
})

test('模型明细中的短 ID 仍可复制完整会话 ID', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copiedUsageSessionId = value } } })
  })
  await page.clock.setFixedTime(new Date('2026-10-23T10:00:00Z'))
  await bootUnlocked(page, config, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await page.locator('.usg-model-row[data-model="gpt-5.4"]').click()
  const copy = page.getByRole('button', { name: `复制会话 ID：${sessionId}`, exact: true })
  await expect(copy).toHaveText('019a12fe…3500')
  await copy.click()
  await expect.poll(() => page.evaluate(() => (window as any).__copiedUsageSessionId)).toBe(sessionId)
})
