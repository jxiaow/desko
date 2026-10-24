import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

test.use({ timezoneId: 'Asia/Shanghai' })
const LIST = 'codex_list_sessions_across_instances'
const USAGE = 'codex_query_session_usage'
const config = {
  settings: { codex_enabled: 'true', codex_quota_auto_refresh_minutes: '0' },
  codex: { sessions: [{ sessionId: 'first', title: '第一条会话', cwd: 'C:\\demo', input: 1000, output: 100, daysAgo: 0 }] },
}

test('会话首次展开最近项目，手动收起后自动刷新不展开，再次展开的详情随刷新保留', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await bootUnlocked(page, config, '/codex')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.hero-num')).toHaveText('1,100')
  await expect(page.locator('.grp-head')).toHaveAttribute('aria-expanded', 'true')
  await page.locator('.grp-head').click()
  await expect(page.locator('.sess-row')).toHaveCount(0)
  await page.clock.fastForward(30_000)
  expect(await e2e.count(page, LIST)).toBe(2)
  await expect(page.locator('.grp-head')).toHaveAttribute('aria-expanded', 'false')
  await page.locator('.grp-head').click()
  await page.locator('.sess-row').click()
  await page.evaluate(config => window.__E2E__!.seed({ ...config, codex: { sessions: [
    { sessionId: 'first', title: '第一条会话已更新', cwd: 'C:\\demo', input: 2000, output: 200, daysAgo: 0 },
    { sessionId: 'second', title: '新增的会话', cwd: 'C:\\demo', input: 3000, output: 300, daysAgo: 0 },
  ] } }), config)
  await page.clock.fastForward(30_000)
  await expect(page.locator('.hero-num')).toHaveText('5,500')
  await expect(page.locator('.grp-head')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.sess-row[data-sid="first"]')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.sess-row')).toHaveCount(2)
  await expect(page.locator('.sess-row[data-sid="first"]')).toContainText('第一条会话已更新')
  await page.getByRole('button', { name: '账号', exact: true }).click()
  const calls = await e2e.count(page, LIST)
  await page.clock.fastForward(60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(await e2e.count(page, LIST)).toBe(calls)
})

test('用量自动刷新汇总与已展开的模型明细，切回窗口补取，离开后停止', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await bootUnlocked(page, config, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('1,100')
  await page.locator('.usg-model-row').click()
  await expect(page.locator('.usg-model-detail')).toContainText('第一条会话')
  await page.evaluate(config => window.__E2E__!.seed({ ...config, codex: { sessions: [
    { sessionId: 'first', title: '第一条会话', cwd: 'C:\\demo', input: 3000, output: 300, daysAgo: 0 },
  ] } }), config)
  await page.clock.fastForward(30_000)
  await expect(page.locator('.usg-num')).toHaveText('3,300')
  await expect(page.locator('.usg-model-row')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.usg-model-detail td').first()).toHaveText('3,300')
  const calls = await e2e.count(page, USAGE)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => e2e.count(page, USAGE)).toBe(calls + 1)
  await page.getByRole('button', { name: '账号', exact: true }).click()
  await page.clock.fastForward(60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(await e2e.count(page, USAGE)).toBe(calls + 1)
})
