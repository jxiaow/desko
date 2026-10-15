import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
import type { E2EConfig } from '../mocks/backend'

test.use({ timezoneId: 'Asia/Shanghai' })

const COMMAND = 'codex_query_session_usage'
const seed = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [{ email: 'main@e2e.dev' }],
    sessions: [
      { sessionId: 'today', cwd: 'C:\\demo', daysAgo: 0, input: 12300, cached: 11000, output: 1400, reasoning: 400, model: 'gpt-today', turns: 2 },
      { sessionId: 'yesterday', cwd: 'C:\\demo', daysAgo: 1, input: 1000, cached: 800, output: 100, model: 'gpt-history' },
    ],
  },
}

async function boot(page: Page, config: E2EConfig = seed) {
  await bootUnlocked(page, config, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.getByRole('region', { name: '今日用量', exact: true })).toBeVisible()
}

async function args(page: Page) {
  return page.evaluate(command => (window as any).__E2E__.invocations.filter((call: any) => call.cmd === command).at(-1).args, COMMAND)
}

test('大额用量换算万和亿，悬停仍能核对完整数字', async ({ page }) => {
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'large', cwd: 'demo', daysAgo: 0, input: 1_500_000_000, cached: 1_200_000_000, output: 200_000_000 },
  ] } })
  await expect(page.locator('.usg-num')).toHaveText('17亿')
  await expect(page.locator('.usg-num')).toHaveAttribute('title', '1,700,000,000 Token')
  await expect(page.locator('.usg-metrics dd')).toHaveText(['3亿', '12亿', '2亿'])
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-day-total')).toHaveText('17亿')
  await expect(page.locator('.usg-col[data-recorded="true"]')).toHaveAttribute('aria-label', /合计 1,700,000,000 Token/)
})

for (const theme of ['paper', 'slate']) {
  test(`${theme} 下三类用量颜色明确，缓存另有纹理和对应图例`, async ({ page }) => {
    await boot(page, { ...seed, settings: { ...seed.settings, theme, accent: 'celadon' } })
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    const colors = await page.locator('.usg-col[data-recorded="true"]').first().locator('.usg-stack > span').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
    expect(new Set(colors).size).toBe(3)
    expect(colors.every(color => color.startsWith('rgb('))).toBe(true)
    await expect(page.locator('.usg-cached').first()).not.toHaveCSS('background-image', 'none')
    const legend = await page.locator('.daily-legend i').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
    expect(legend).toEqual([...colors].reverse())
    await page.screenshot({ path: `.tmp/web-stat-fixes/usage-${theme}.png` })
  })
}

test('默认展示今天的总量、构成与模型，昨天不会计入当天', async ({ page }) => {
  await boot(page)
  await expect(page.getByRole('navigation', { name: '统计窗口' }).getByRole('button', { name: '今天', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.usg-num')).toHaveText('1.37万')
  await expect(page.locator('[data-metric="fresh"] dd')).toHaveText('1,300')
  await expect(page.locator('[data-metric="cached"] dd')).toHaveText('1.1万')
  await expect(page.locator('[data-metric="output"] dd')).toHaveText('1,400')
  await expect(page.locator('.usg-count')).toHaveText('2 轮 · 1 条会话')
  await expect(page.locator('.usg-model-name')).toHaveText('gpt-today')
  await expect(page.getByRole('region', { name: '今日小时用量趋势', exact: true })).toBeVisible()
  await expect(page.locator('.hourly-svg [data-hour]').last()).toHaveAttribute('data-tokens', '13700')
  await expect(page.locator('.composition-legend')).toContainText('80.3%')
  const widths = await page.locator('.composition-track > span').evaluateAll(elements => elements.map(element => parseFloat((element as HTMLElement).style.width)))
  expect(widths[0]).toBeCloseTo(1300 / 13700 * 100, 2)
  expect(widths[1]).toBeCloseTo(11000 / 13700 * 100, 2)
  expect(widths[2]).toBeCloseTo(1400 / 13700 * 100, 2)
  await expect(page.locator('.usg-daily')).toHaveCount(0)
  expect(await e2e.count(page, COMMAND)).toBe(1)
})

test('同小时记录合并为真实用量，可聚焦查看小时数值，未来时段不画成零', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T10:30:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { ...seed.codex.sessions[0], hoursAgo: 10 },
    { ...seed.codex.sessions[1], daysAgo: 0, hoursAgo: 10.25 },
    { ...seed.codex.sessions[1], sessionId: 'current', daysAgo: 0, input: 500, output: 50, cached: 200 },
  ] } })
  const currentClock = await page.evaluate(() => new Date().getHours())
  const peakClock = `${String(currentClock - 10).padStart(2, '0')}:00`
  await expect(page.locator(`[data-hour="${peakClock}"]`)).toHaveAttribute('data-tokens', '14800')
  await expect(page.locator('.usg-num')).toHaveText('1.54万')
  const pointTotal = await page.locator('.hourly-svg [data-hour]').evaluateAll(points => points.reduce((sum, point) => sum + Number(point.getAttribute('data-tokens')), 0))
  expect(pointTotal).toBe(15350)
  await expect(page.locator('.today-peak')).toContainText('1.48万')
  await page.locator('.hour-target').last().focus()
  await expect(page.locator('.hour-detail')).toContainText('550 Token')
  await expect(page.locator('.hour-detail')).toContainText('本小时累计')
  await expect(page.locator('.hour-future')).toBeVisible()
})

test('未来时间戳记录被截止上界排除，总数和小时曲线仍然同账', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:30:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    seed.codex.sessions[0],
    { ...seed.codex.sessions[1], daysAgo: 0, hoursAgo: -4 },
  ] } })
  await expect(page.locator('.usg-num')).toHaveText('1.37万')
  const pointTotal = await page.locator('.hourly-svg [data-hour]').evaluateAll(points => points.reduce((sum, point) => sum + Number(point.getAttribute('data-tokens')), 0))
  expect(pointTotal).toBe(13700)
  expect((await args(page)).toTimestamp).toBe(Date.parse('2026-10-13T04:30:00Z') / 1000 + 1)
})

test('今天无记录时明确显示 0，历史记录仍可从近 7 天查看', async ({ page }) => {
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [seed.codex.sessions[1]] } })
  await expect(page.locator('.usg-num')).toHaveText('0')
  await expect(page.locator('.empty-title')).toHaveText('今天还没有用量记录')
  await expect(page.locator('.hourly-svg')).toBeVisible()
  await expect(page.locator('.hour-line')).toHaveCount(1)
  await expect(page.locator('.hourly-svg [data-hour][data-tokens="0"]')).toHaveCount(Number(await page.locator('.hourly-svg').getAttribute('data-observed')))
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('1,100')
  await expect(page.locator('.usg-day-total')).toHaveText('1,100')
  await expect(page.locator('.usg-day-row')).toContainText('800')
})

test('近 7 天只计入今天至六天前，每日数字可直接阅读', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { ...seed.codex.sessions[0], daysAgo: 6 },
    { ...seed.codex.sessions[1], daysAgo: 7 },
  ] } })
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('1.37万')
  await expect(page.locator('.usg-day-row')).toHaveCount(1)
  await expect(page.locator('.usg-day-total')).toHaveText('1.37万')
})

test.describe('本地日期边界', () => {
  test.use({ timezoneId: 'Asia/Shanghai' })
  test('本地凌晨属于今天，不按 UTC 日期归到昨天', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-12T16:30:00Z') })
    await boot(page)
    await expect(page.locator('.usg-period').first()).toHaveText('2026-10-13 · 本地时间 00:00 起')
    expect((await args(page)).fromTimestamp).toBe(Date.parse('2026-10-12T16:00:00Z') / 1000)
    await expect(page.locator('.usg-num')).toHaveText('1.37万')
  })

  test('页面跨本地午夜自动统计新一天，离开用量页后取消跨日刷新', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-13T15:59:00Z') })
    await boot(page)
    await expect(page.locator('.usg-num')).toHaveText('1.37万')
    await page.clock.fastForward(61_000)
    await expect(page.locator('.usg-num')).toHaveText('0')
    await expect(page.locator('.usg-period').first()).toHaveText('2026-10-14 · 本地时间 00:00 起')
    expect((await args(page)).fromTimestamp).toBe(Date.parse('2026-10-13T16:00:00Z') / 1000)
    expect(await e2e.count(page, COMMAND)).toBe(2)
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await page.clock.fastForward(86_400_000)
    expect(await e2e.count(page, COMMAND)).toBe(2)
  })
})

test.describe('夏令时边界', () => {
  test.use({ timezoneId: 'America/New_York' })
  test('跨夏令时的近 7 天仍从当地零点起', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T17:00:00Z') })
    await boot(page)
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.getByRole('region', { name: '近 7 天用量', exact: true })).toBeVisible()
    expect((await args(page)).fromTimestamp).toBe(Date.parse('2026-10-28T04:00:00Z') / 1000)
    await expect(page.locator('.usg-period').first()).toContainText('2026-10-28 至 2026-11-03')
  })

  test('回拨日的两个 01 点分别统计，25 小时不丢账', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-01T08:00:00Z') })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
      { ...seed.codex.sessions[0], hoursAgo: 2.5 },
      { ...seed.codex.sessions[1], daysAgo: 0, hoursAgo: 1.5 },
    ] } })
    await expect(page.locator('.hourly-svg')).toHaveAttribute('data-hours', '25')
    await expect(page.locator('[data-hour="01:00 (UTC-04:00)"]')).toHaveAttribute('data-tokens', '13700')
    await expect(page.locator('[data-hour="01:00 (UTC-05:00)"]')).toHaveAttribute('data-tokens', '1100')
    await expect(page.locator('.usg-num')).toHaveText('1.48万')
  })

  test('跳时日只有 23 小时，不虚构不存在的 02 点', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-03-08T08:30:00Z') })
    await boot(page)
    await expect(page.locator('.hourly-svg')).toHaveAttribute('data-hours', '23')
    await expect(page.locator('[data-hour="02:00"]')).toHaveCount(0)
    await expect(page.locator('[data-hour="04:00"]')).toHaveAttribute('data-tokens', '13700')
  })
})

test.describe('零点跳时', () => {
  test.use({ timezoneId: 'America/Sao_Paulo' })
  test('今日从首个有效时刻起，近 7 天不把 01 点带到起始日', async ({ page }) => {
    await page.clock.install({ time: new Date('2018-11-04T14:00:00Z') })
    await boot(page)
    await expect(page.locator('.hourly-svg')).toHaveAttribute('data-hours', '23')
    expect((await args(page)).fromTimestamp).toBe(Date.parse('2018-11-04T03:00:00Z') / 1000)
    await expect(page.locator('.usg-period').first()).toContainText('本地时间 01:00 起')
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.getByRole('region', { name: '近 7 天用量', exact: true })).toBeVisible()
    expect((await args(page)).fromTimestamp).toBe(Date.parse('2018-10-29T03:00:00Z') / 1000)
  })
})

for (const width of [800, 1235]) {
  test(`${width}px 下当天与历史用量清晰显示，页面无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 })
    await page.clock.install({ time: new Date('2026-10-13T10:30:00Z') })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
      { ...seed.codex.sessions[0], sessionId: 'h8', hoursAgo: 10.5, input: 7200, cached: 6000, output: 800 },
      { ...seed.codex.sessions[0], sessionId: 'h12', hoursAgo: 6.5, input: 19000, cached: 15000, output: 1000 },
      { ...seed.codex.sessions[0], sessionId: 'h13', hoursAgo: 5.5, input: 12000, cached: 9000, output: 2000 },
      { ...seed.codex.sessions[0], sessionId: 'h15', hoursAgo: 3.5, input: 4500, cached: 4000, output: 500 },
      { ...seed.codex.sessions[0], sessionId: 'h18', hoursAgo: .5, input: 12500, cached: 10500, output: 1500 },
      seed.codex.sessions[1],
    ] } })
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await page.screenshot({ path: `.tmp/codex-parity/shots/usage-today-${width}.png` })
    await page.getByRole('button', { name: '近 30 天', exact: true }).click()
    await expect(page.locator('.usg-day-row')).toHaveCount(2)
    await expect(page.locator('.usg-today-mark')).toHaveText('今天')
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await page.screenshot({ path: `.tmp/codex-parity/shots/usage-month-${width}.png` })
  })
}

test('每日柱高按同一刻度比较，缓存占比与实际 Token 一致', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'large', cwd: 'C:\\demo', daysAgo: 1, input: 9000, cached: 6000, output: 1000 },
    { sessionId: 'small', cwd: 'C:\\demo', daysAgo: 0, input: 900, cached: 600, output: 100 },
  ] } })
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-col')).toHaveCount(7)
  await expect(page.locator('.usg-col[data-recorded="false"]')).toHaveCount(5)
  const bars = await page.locator('.usg-col[data-recorded="true"] .usg-stack').evaluateAll(elements => elements.map(element => {
    const parts = [...element.children].map(child => child.getBoundingClientRect().height)
    return { parts, total: parts.reduce((sum, value) => sum + value, 0), height: element.getBoundingClientRect().height }
  }))
  expect(bars[0].total).toBeGreaterThan(80)
  expect(bars[1].total / bars[0].total).toBeCloseTo(0.1, 2)
  expect(bars[0].parts[1] / bars[0].total).toBeCloseTo(0.6, 2)
  expect(bars[0].total).toBeLessThanOrEqual(bars[0].height + 1)
  await page.screenshot({ path: '.tmp/app-review/web-plain-chart/codex-usage-bars.png' })
})


test('少量用量不因百分比舍入成为零柱，并可用键盘读取真实值', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'large', cwd: 'demo', daysAgo: 1, input: 9000, cached: 6000, output: 1000 },
    { sessionId: 'small', cwd: 'demo', daysAgo: 0, input: 8, cached: 4, output: 4 },
  ] } })
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  const column = page.locator('.usg-col').last()
  await column.focus()
  await expect(column).toBeFocused()
  await expect(column).toHaveAttribute('aria-label', /合计 12 Token/)
  const heights = await column.locator('.usg-stack > span').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
  expect(heights.every(height => height > 0)).toBe(true)
  await expect(page.locator('.usg-scale')).toHaveText('1.2万6,0000')
})


test('缺失日期保留间隔，键盘可查看零记录日期和完整明细', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { ...seed.codex.sessions[0], daysAgo: 6 },
    seed.codex.sessions[1],
  ] } })
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  const columns = page.locator('.usg-col')
  await expect(columns).toHaveCount(7)
  await expect(columns.first()).toHaveAttribute('data-day', '2026-10-07')
  await expect(columns.last()).toHaveAttribute('data-day', '2026-10-13')
  await columns.nth(5).focus()
  await expect(page.locator('.daily-readout')).toContainText('1,100')
  await page.keyboard.press('ArrowRight')
  await expect(columns.last()).toBeFocused()
  await expect(page.locator('.daily-readout')).toContainText('无本地记录')
  await page.keyboard.press('Home')
  await expect(columns.first()).toBeFocused()
  await expect(page.locator('.daily-readout')).toContainText('1.37万')
  const geometry = await columns.evaluateAll(elements => elements.map(el => ({
    x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width,
    bar: el.querySelector('.usg-stack')!.getBoundingClientRect().width,
  })))
  expect(geometry.every(box => box.bar <= 28.1)).toBe(true)
  for (let n = 1; n < geometry.length; n++) expect(geometry[n].x - geometry[n-1].x).toBeCloseTo(geometry[0].width, 0)
})
