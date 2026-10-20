import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

const seed = {
  settings: { codex_enabled: 'true' },
  codex: { accounts: [{ email: 'link@example.com' }], sessions: [
    { sessionId: 'session-a', title: '同名会话', cwd: 'C:\\project-a', projectName: '项目 A', model: 'gpt-5.4', daysAgo: 0, input: 1000, output: 100 },
    { sessionId: 'session-b', title: '同名会话', cwd: 'C:\\project-b', projectName: '项目 B', model: 'gpt-5.4', daysAgo: 0, input: 2000, output: 200 },
  ] },
}

for (const width of [800, 1280]) {
  test(`${width}px 从模型用量直接定位正确会话，同名会话不会混淆`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await bootUnlocked(page, seed, '/codex')
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索会话标题', exact: true }).fill('没有匹配的搜索')
    await page.getByRole('button', { name: '用量', exact: true }).click()
    await page.locator('.usg-model-row[data-model="gpt-5.4"]').click()
    await page.locator('[data-session="session-a"]').getByRole('button', { name: '查看会话：同名会话', exact: true }).click()
    await expect(page.locator('.sess-identity dd')).toHaveText('session-a')
    await expect(page.locator('.sess-cwd')).toHaveText('C:\\project-a')
    await expect(page.locator('.sess-row[data-sid="session-a"]')).toBeFocused()
    await expect(page.getByRole('textbox', { name: '搜索会话标题', exact: true })).toHaveValue('')
    await expect(page.locator('.sess-card')).toHaveCount(1)
    await expect(page.locator('.sess-card')).toBeInViewport()
  })
}

test('用量中的会话已被外部移走时明确提示，页面仍可继续操作', async ({ page }) => {
  let backendUrl = ''
  page.on('request', request => { if (/\/e2e\/mocks\/backend(?:\.ts)?$/.test(new URL(request.url()).pathname)) backendUrl = request.url() })
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('.grp-head').filter({ hasText: '项目 B' }).click()
  await page.locator('.sess-row[data-sid="session-b"]').click()
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await page.locator('.usg-model-row[data-model="gpt-5.4"]').click()
  expect(backendUrl).not.toBe('')
  await page.evaluate(async url => {
    const { getBackend } = await import(/* @vite-ignore */ url)
    await getBackend().invoke('codex_move_sessions_to_trash_across_instances', { sessionIds: ['session-a'] })
  }, backendUrl)
  await page.locator('[data-session="session-a"]').getByRole('button', { name: '查看会话：同名会话', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('这条会话已不在当前本地目录中')
  await expect(page.locator('.sess-card')).toHaveCount(0)
  if (await page.locator('.grp-head').getAttribute('aria-expanded') === 'false') await page.locator('.grp-head').click()
  await expect(page.locator('.sess-row[data-sid="session-b"]')).toBeVisible()
})

test('会话详情可复制完整 ID 和工作目录', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { (window as any).__copiedSessionValue = value } } })
  })
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('.grp-head').filter({ hasText: '项目 A' }).click()
  await page.locator('.sess-row[data-sid="session-a"]').click()
  await page.getByRole('button', { name: '复制会话 ID', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__copiedSessionValue)).toBe('session-a')
  await page.getByRole('button', { name: '复制工作目录', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__copiedSessionValue)).toBe('C:\\project-a')
})
