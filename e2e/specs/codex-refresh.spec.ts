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

test('同一天重新进入用量页立即更新，不等下一次定时刷新', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await bootUnlocked(page, config, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('1,100')
  await page.getByRole('button', { name: '账号', exact: true }).click()
  await page.evaluate(config => window.__E2E__!.seed({ ...config, codex: { sessions: [
    { sessionId: 'first', title: '第一条会话', cwd: 'C:\\demo', input: 5000, output: 500, daysAgo: 0 },
  ] } }), config)
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('5,500')
})

test('关闭挂件与配额自动刷新后，账号清单仍轮询本地数据，切回窗口立即补读', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  const settings = { ...config.settings, codex_hud_enabled: 'false' }
  await bootUnlocked(page, { settings, codex: { accounts: [] } }, '/codex')
  await expect(page.locator('.empty-title')).toHaveText('还没有 Codex 账号')
  await page.evaluate(settings => window.__E2E__!.seed({ settings, codex: { accounts: [
    { email: 'first@example.invalid', hourly: 90 },
  ] } }), settings)
  await page.clock.fastForward(30_000)
  await expect(page.locator('.acc-row')).toHaveCount(1)
  await page.evaluate(settings => window.__E2E__!.seed({ settings, codex: { accounts: [
    { email: 'first@example.invalid', hourly: 40 },
    { email: 'second@example.invalid', hourly: 80 },
  ] } }), settings)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.acc-row')).toHaveCount(2)
  await expect(page.locator('.acc-row[data-email="first@example.invalid"] .q-num').first()).toHaveText('40%')
  expect(await e2e.count(page, 'refresh_codex_quotas_batch')).toBe(0)
})

test('没有挂件时账号页切回窗口也会补刷新配额，定时本地读取不改变配额间隔', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await bootUnlocked(page, {
    settings: { ...config.settings, codex_hud_enabled: 'false', codex_quota_auto_refresh_minutes: '5' },
    codex: { accounts: [{ email: 'quota@example.invalid' }] },
  }, '/codex')
  const batch = 'refresh_codex_quotas_batch'
  await expect.poll(() => e2e.count(page, batch)).toBe(1)
  await page.clock.fastForward(90_000)
  expect(await e2e.count(page, batch)).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => e2e.count(page, batch)).toBe(2)
})

test('回收站重新进入、定时和切回窗口都更新，离开该页签后停止轮询', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  const seed = { settings: config.settings, codex: { trash: [{ sessionId: 'a', cwd: 'C:\\demo', title: '原有留底' }] } }
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.thr-row')).toHaveCount(1)
  await page.getByRole('button', { name: '账号', exact: true }).click()
  await page.evaluate(seed => window.__E2E__!.seed({ ...seed, codex: { ...seed.codex, recycled: [{ email: 'deleted@example.invalid' }] } }), seed)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.thr-row')).toHaveCount(2)
  await page.evaluate(seed => window.__E2E__!.seed({ ...seed, codex: { trash: [] } }), seed)
  await page.clock.fastForward(30_000)
  await expect(page.locator('.thr-row')).toHaveCount(0)
  await page.evaluate(seed => window.__E2E__!.seed(seed), seed)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.thr-row')).toHaveCount(1)
  await page.getByRole('button', { name: '账号', exact: true }).click()
  const calls = await e2e.count(page, 'codex_list_trashed_sessions_across_instances')
  await page.clock.fastForward(60_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(await e2e.count(page, 'codex_list_trashed_sessions_across_instances')).toBe(calls)
})
