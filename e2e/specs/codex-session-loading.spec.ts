import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const width of [800, 1040]) {
  test(`${width}px 会话及用量骨架、迟到统计与刷新保持布局`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { codex_enabled: 'true' }, codex: {
      accounts: [{ email: 'demo@example.invalid' }],
      sessions: [{ sessionId: 'loading', title: '检查会话与用量加载状态', cwd: 'C:/Work/Desko', projectName: 'Desko', input: 10000, cached: 4000, output: 2000, model: 'gpt-5.4' }],
    } }, '/codex')
    await page.evaluate(async () => {
      const modulePath = performance.getEntriesByType('resource').map(entry => entry.name)
        .find(url => /\/services\/api\/codex\.ts(?:\?|$)/.test(url))!
      const { codexApi } = await import(modulePath)
      for (const method of ['listSessions', 'sessionTokenStats', 'querySessionUsage']) {
        const original = codexApi[method]
        codexApi[method] = async (...args: unknown[]) => {
          await new Promise<void>(resolve => { (window as any)[`release_${method}`] = resolve })
          return original(...args)
        }
      }
    })
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await expect(page.getByRole('status', { name: '正在读取会话' })).toBeVisible()
    await expect(page.locator('.skeleton-project')).toHaveCount(3)
    await page.screenshot({ path: `.tmp/session-review-1022/sessions-loading-${width}.png` })
    await page.evaluate(() => (window as any).release_listSessions())
    await expect(page.locator('.hero-placeholder')).toBeVisible()
    const loadingHeight = await page.locator('.sess-hero').evaluate(el => el.getBoundingClientRect().height)
    if (await page.locator('.grp-head').getAttribute('aria-expanded') === 'false') await page.locator('.grp-head').click()
    await page.locator('.sess-row').click()
    await expect(page.locator('.sess-no-usage')).toContainText('正在读取')
    await page.evaluate(() => (window as any).release_sessionTokenStats())
    await expect(page.locator('.hero-num')).toHaveText('1.2万')
    const loadedHeight = await page.locator('.sess-hero').evaluate(el => el.getBoundingClientRect().height)
    expect(Math.abs(loadedHeight - loadingHeight)).toBeLessThanOrEqual(2)
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await page.screenshot({ path: `.tmp/session-review-1022/sessions-${width}.png` })
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await expect(page.getByRole('status', { name: '正在统计用量' })).toBeVisible()
    await page.screenshot({ path: `.tmp/session-review-1022/usage-loading-${width}.png` })
    await page.evaluate(() => (window as any).release_querySessionUsage())
    await expect(page.locator('.usg-sum')).toBeVisible()
    await expect(page.locator('.codex-skeleton')).toHaveCount(0)
  })
}
