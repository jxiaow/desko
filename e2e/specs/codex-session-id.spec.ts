import { expect, test } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const width of [1040, 800]) {
  test(`${width}px 下列表与详情完整显示会话 ID`, async ({ page }) => {
    const sessionId = '0192ec3a-61d4-7b85-a423-123456789abc'
    await page.setViewportSize({ width, height: 800 })
    await bootUnlocked(page, {
      settings: { codex_enabled: 'true', codex_quota_auto_refresh_minutes: '0' },
      codex: {
        accounts: [{ email: 'id@example.invalid' }],
        sessions: [{ sessionId, title: sessionId, cwd: 'C:\\demo', projectName: '示例项目' }],
      },
    }, '/codex')
    await page.getByRole('button', { name: '会话', exact: true }).click()
    const row = page.locator(`.sess-row[data-sid="${sessionId}"]`)
    await expect(row.locator('.sess-title')).toHaveText(sessionId)
    await row.click()
    const value = page.locator('.sess-identity dd')
    await expect(value).toHaveText(sessionId)
    expect(await value.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
}
