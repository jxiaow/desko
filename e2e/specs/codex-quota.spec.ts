import { expect, test, type Page } from '@playwright/test'
import { bootUnlocked } from '../helpers'

const row = (page: Page, email: string) => page.locator(`.acc-row[data-email="${email}"]`)
const seed = {
  settings: { codex_enabled: 'true', codex_quota_auto_refresh_minutes: '0' },
  codex: { accounts: [
    { email: 'free@example.invalid', plan_type: 'free', hourly: 64, quota: { hourly_window_minutes: 10080, hourly_window_present: true, weekly_window_present: false } },
    { email: 'plus@example.invalid', plan_type: 'plus', hourly: 80, weekly: 35, quota: { hourly_window_minutes: 300, weekly_window_minutes: 10080, hourly_window_present: true, weekly_window_present: true } },
    { email: 'business@example.invalid', plan_type: 'business', quota: { hourly_window_present: false, weekly_window_present: false, raw_data: { spend_control: { individual_limit: { limit: '25000', used: '8000', remaining: '17000', remaining_percent: 68 } } } } },
    { email: 'empty@example.invalid', quota: { hourly_window_present: false, weekly_window_present: false } },
  ] },
}

test('各会员按接口实际窗口展示，不存在的窗口不显示 100%，Credits 使用真实总量', async ({ page }) => {
  await bootUnlocked(page, seed, '/codex')
  const free = row(page, 'free@example.invalid')
  await expect(free.locator('.q')).toHaveCount(1)
  await expect(free.locator('.q-tag')).toHaveText('周额度')
  await expect(free.getByRole('meter')).toHaveAttribute('aria-valuenow', '64')
  const plus = row(page, 'plus@example.invalid')
  await expect(plus.locator('.q-tag')).toHaveText(['5 小时额度', '周额度'])
  await expect(plus.locator('.q-when')).toHaveCount(2)
  const business = row(page, 'business@example.invalid')
  await expect(business.locator('.q')).toHaveCount(1)
  await expect(business.locator('.credit-number')).toHaveText('17,000')
  await expect(business.locator('.credit-total')).toHaveText('/ 总额度 25,000')
  await expect(business.locator('.q-num')).toHaveText('68%')
  const empty = row(page, 'empty@example.invalid')
  await expect(empty.getByRole('meter')).toHaveCount(0)
  await expect(empty.locator('.q-when')).toHaveText('暂无配额')
})

test('不存在的窗口不会参与额度筛选和排序，按月 Credits 参与比较', async ({ page }) => {
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '账号排序', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '可用配额优先', exact: true }).click()
  await expect(page.locator('.acc-row').first()).toHaveAttribute('data-email', 'business@example.invalid')
  await expect(page.locator('.acc-row').last()).toHaveAttribute('data-email', 'empty@example.invalid')
  await page.getByRole('button', { name: '账号状态', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '低配额 ≤20%', exact: true }).click()
  await expect(page.locator('.acc-row')).toHaveCount(0)
})

test('周额度耗尽明确提示主窗口不可用，Pro 子档位使用不同标识', async ({ page }) => {
  await bootUnlocked(page, { settings: seed.settings, codex: { accounts: [
    { email: 'pro@example.invalid', plan_type: 'pro', hourly: 70, weekly: 0 },
    { email: 'lite@example.invalid', plan_type: 'prolite' },
    { email: 'max@example.invalid', plan_type: 'promax' },
  ] } }, '/codex')
  const pro = row(page, 'pro@example.invalid')
  await expect(pro.locator('.q-num')).toHaveText(['0%', '0%'])
  await expect(pro.locator('.blocked')).toContainText('周额度用尽，暂不可用')
  await expect(pro.locator('.tier')).toHaveClass(/plan-pro$/)
  await expect(row(page, 'lite@example.invalid').locator('.tier')).toHaveText('PRO 100')
  await expect(row(page, 'max@example.invalid').locator('.tier')).toHaveText('PRO 500')
})

test('额外模型额度、零 Credits、仅余额和未提供额度的 API 账号不会丢失或冒充会员额度', async ({ page }) => {
  await bootUnlocked(page, { settings: seed.settings, codex: { accounts: [
    { email: 'spark@example.invalid', plan_type: 'pro', quota: { raw_data: { additional_rate_limits: [{ limit_name: 'Codex Spark', rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_at: 1801000000 } } }] } } },
    { email: 'zero@example.invalid', plan_type: 'business', quota: { hourly_window_present: false, weekly_window_present: false, raw_data: { spend_control: { individual_limit: { limit: 100, remaining: 0 } } } } },
    { email: 'balance@example.invalid', quota: { hourly_window_present: false, weekly_window_present: false, raw_data: { credits: { balance: '42' } } } },
    { email: 'api@example.invalid', auth_mode: 'apikey' as const, quota: null },
  ] } }, '/codex')
  await expect(row(page, 'spark@example.invalid').locator('[data-window="additional:0:primary"] .q-num')).toHaveText('65%')
  await expect(row(page, 'zero@example.invalid').locator('.credit-number')).toHaveText('0')
  const balance = row(page, 'balance@example.invalid')
  await expect(balance.locator('.credit-number')).toHaveText('42')
  await expect(balance.getByRole('meter')).toHaveCount(0)
  const api = row(page, 'api@example.invalid')
  await expect(api.locator('.tier')).toHaveText('API Key')
  await expect(api.locator('.acc-quota')).toContainText('按供应商计费')
  await expect(api.getByRole('meter')).toHaveCount(0)
})

test('800px 窗口下实际额度与批量操作仍可用', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await row(page, 'free@example.invalid').getByRole('button', { name: '选择 free@example.invalid', exact: true }).click()
  await expect(page.locator('.dock-count')).toHaveText('已选 1 条')
  expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(row(page, 'business@example.invalid').locator('.credit-number')).toHaveText('17,000')
})

test('重置日期直接显示本地时间，月额度与额外模型一致，用户 ID 不出现在卡片中', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-14T04:00:00Z'))
  const reset = Date.parse('2026-10-14T05:30:00Z') / 1000
  await bootUnlocked(page, { settings: seed.settings, codex: { accounts: [
    { email: 'time@example.invalid', account_name: '时间测试', user_id: 'synthetic-user-id', hourly: 80, weekly: 60, quota: { hourly_reset_time: reset, weekly_reset_time: null, raw_data: {
      additional_rate_limits: [{ limit_name: 'Codex Spark', rate_limit: { primary_window: { used_percent: 35, limit_window_seconds: 18000, reset_at: reset } } }],
    } } },
    { email: 'monthly@example.invalid', plan_type: 'business', quota: { hourly_window_present: false, weekly_window_present: false, raw_data: {
      spend_control: { individual_limit: { limit: 100, remaining: 70, reset_at: reset } },
    } } },
  ] } }, '/codex')
  const localTime = await page.evaluate(timestamp => {
    const date = new Date(timestamp * 1000)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, reset)
  const times = page.locator('.q-reset-at')
  await expect(times).toHaveText(Array(3).fill(`重置 ${localTime}`))
  await expect(times.first()).toHaveAttribute('datetime', '2026-10-14T05:30:00.000Z')
  const account = row(page, 'time@example.invalid')
  await expect(account.locator('[data-window="weekly"] .q-when')).toHaveText('尚未提供重置时间')
  await expect(account).not.toContainText('用户 ID')
  await expect(account).not.toContainText('synthetic-user-id')
})

test('可重置次数随首个实际额度显示，只有周窗口或月 Credits 时仍保留', async ({ page }) => {
  await bootUnlocked(page, { settings: seed.settings, codex: { accounts: [
    { email: 'weekly-only@example.invalid', plan_type: 'free', quota: {
      hourly_window_present: false, weekly_window_present: true, weekly_window_minutes: 10080, reset_credits_available: 1,
    } },
    { email: 'monthly-only@example.invalid', plan_type: 'business', quota: {
      hourly_window_present: false, weekly_window_present: false, reset_credits_available: 2,
      raw_data: { spend_control: { individual_limit: { limit: 100, remaining: 70 } } },
    } },
  ] } }, '/codex')
  await expect(row(page, 'weekly-only@example.invalid').locator('.reset-credits')).toHaveText('可重置 1 次')
  await expect(row(page, 'monthly-only@example.invalid').locator('.reset-credits')).toHaveText('可重置 2 次')
  for (const email of ['weekly-only@example.invalid', 'monthly-only@example.invalid']) {
    const layout = await row(page, email).evaluate(el => ({
      barBottom: el.querySelector('.q-bar')!.getBoundingClientRect().bottom,
      creditsTop: el.querySelector('.reset-credits')!.getBoundingClientRect().top,
    }))
    expect(layout.creditsTop).toBeGreaterThan(layout.barBottom)
  }
})
