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

for (const width of [800, 1235]) {
  test(`${width}px 下展开模型可查看所选时间内的会话明细`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
      { sessionId: 'today-a', title: '模型用于代码审查', cwd: 'C:\\demo', daysAgo: 0, input: 1_000_000, cached: 800_000, output: 100_000, model: 'gpt-5.4', turns: 3 },
      { sessionId: 'today-b', title: '模型用于修复输入法', cwd: 'C:\\notes', daysAgo: 0, input: 500_000, cached: 400_000, output: 50_000, model: 'gpt-5.4', turns: 2 },
      { sessionId: 'history', title: '历史会话', cwd: 'C:\\demo', daysAgo: 1, input: 1000, output: 100, model: 'gpt-5.4', turns: 1 },
      { sessionId: 'other', title: '其他模型的会话', cwd: 'C:\\demo', daysAgo: 0, input: 1000, output: 100, model: 'other-model', turns: 1 },
    ] } })
    const row = page.locator('.usg-model-row[data-model="gpt-5.4"]')
    await expect(row).toHaveAttribute('title', /合计 165万 · 净输入 30万 · 缓存 120万 · 输出 15万/)
    await row.focus()
    await page.keyboard.press('Enter')
    const detail = page.getByRole('region', { name: 'gpt-5.4 会话用量', exact: true })
    await expect(detail.locator('tbody tr')).toHaveCount(2)
    await expect(detail).toContainText('模型用于代码审查')
    await expect(detail).toContainText('模型用于修复输入法')
    await expect(detail).toContainText('C:\\notes')
    await expect(detail).not.toContainText('历史会话')
    await expect(detail).not.toContainText('其他模型的会话')
    await expect(detail.locator('[data-session="today-a"] td')).toHaveText(['110万', '20万', '80万', '10万', '3', '$2.20'])
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await detail.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `.tmp/refresh-ime-model/model-sessions-${width}.png` })
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(detail.locator('tbody tr')).toHaveCount(3)
    await row.click()
    await expect(detail).toHaveCount(0)
  })
}

for (const width of [800, 1235]) {
  test(`${width}px 下金额和请求数贯通会话、项目、今日、每日及模型明细`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
      { sessionId: 'priced-today', title: '有缓存的请求', cwd: 'C:\\demo', daysAgo: 0, input: 1_000_000, cached: 800_000, output: 100_000, reasoning: 20_000, model: 'gpt-5.4', turns: 3 },
      { sessionId: 'priced-history', cwd: 'C:\\demo', daysAgo: 1, input: 500_000, cached: 400_000, output: 50_000, model: 'gpt-5.4-mini', turns: 2 },
    ] } })
    await expect(page.locator('.usg-cost')).toHaveText('估算金额 $2.20')
    await expect(page.locator('.usg-count')).toHaveText('3 次请求 · 1 条会话')
    await expect(page.locator('.usg-model-cost')).toHaveText('$2.20')
    await expect(page.locator('.usg-model-requests')).toHaveText('3 次请求')
    await expect(page.locator('.hour-detail')).toContainText('3 次请求 · 估算 $2.20')
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.locator('.usg-cost')).toHaveText('估算金额 $2.53')
    await expect(page.locator('.usg-count')).toHaveText('5 次请求 · 2 条会话')
    await expect(page.locator('.usg-day-cost')).toHaveText(['$2.20', '$0.3300'])
    await expect(page.locator('.usg-model-cost')).toHaveText(['$2.20', '$0.3300'])
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await page.screenshot({ path: `.tmp/codex-billing/usage-${width}.png` })
    await page.getByRole('button', { name: '会话', exact: true }).click()
    await expect(page.locator('.sess-billing dd')).toHaveText(['$2.53', '5'])
    await expect(page.locator('.grp-tok')).toContainText('请求 5 次')
    await expect(page.locator('.grp-tok')).toContainText('估算 $2.53')
    if (await page.locator('.grp-head').getAttribute('aria-expanded') === 'false') await page.locator('.grp-head').click()
    await page.locator('.sess-row[data-sid="priced-today"]').click()
    const facts = page.locator('.sess-facts')
    await expect(facts.locator('div').filter({ has: page.getByText('请求数', { exact: true }) }).locator('dd')).toHaveText('3')
    await expect(facts.locator('div').filter({ has: page.getByText('估算金额（USD）', { exact: true }) }).locator('dd')).toHaveText('$2.20')
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await page.screenshot({ path: `.tmp/codex-billing/sessions-${width}.png` })
  })
}

test('未知模型不会显示为免费，仍保留请求数和已知模型的金额', async ({ page }) => {
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'known', cwd: 'demo', daysAgo: 0, input: 1000, output: 100, model: 'gpt-5.4', turns: 2 },
    { sessionId: 'unknown', cwd: 'demo', daysAgo: 0, input: 500, output: 50, model: 'unpriced-model', turns: 1 },
  ] } })
  await expect(page.locator('.usg-cost')).toHaveText('估算金额 未定价')
  await expect(page.locator('.usg-count')).toHaveText('3 次请求 · 2 条会话')
  await expect(page.locator('.usg-model-cost')).toHaveText(['$0.0040', '未定价'])
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.sess-billing dd')).toHaveText(['未定价', '3'])
})

test('大额用量换算万和亿，悬停仍能核对完整数字', async ({ page }) => {
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'large', cwd: 'demo', daysAgo: 0, input: 1_500_000_000, cached: 1_200_000_000, output: 200_000_000 },
  ] } })
  await expect(page.locator('.usg-num')).toHaveText('17亿')
  await expect(page.locator('.usg-num')).toHaveAttribute('title', '1,700,000,000 Token')
  await expect(page.locator('.usg-metrics dd')).toHaveText(['3亿', '12亿', '2亿'])
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-day-total')).toHaveText('17亿')
  await expect(page.locator('.usg-col[data-recorded="true"]')).toHaveAttribute('title', /合计 17亿 Token · 净输入 3亿 · 缓存 12亿 · 输出 2亿/)
  await expect(page.locator('.usg-col[data-recorded="true"]')).toHaveAttribute('aria-label', /合计 1,700,000,000 Token/)
})

for (const theme of ['paper', 'ink']) {
  test(`${theme} 下三类用量颜色明确，缓存另有纹理和对应图例`, async ({ page }) => {
    await boot(page, { ...seed, settings: { ...seed.settings, theme, accent: 'celadon' } })
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    const colors = await page.locator('.usg-col[data-recorded="true"]').first().locator('.usg-bar').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
    expect(new Set(colors).size).toBe(3)
    expect(colors.every(color => color.startsWith('rgb('))).toBe(true)
    await expect(page.locator('.usg-cached').first()).not.toHaveCSS('background-image', 'none')
    const legend = await page.locator('.daily-legend i').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))
    expect(legend).toEqual(colors)
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
  await expect(page.locator('.usg-count')).toHaveText('2 次请求 · 1 条会话')
  await expect(page.locator('.usg-model-name')).toHaveText('gpt-today')
  await expect(page.getByRole('region', { name: '今日小时用量趋势', exact: true })).toBeVisible()
  await expect(page.locator('.hourly-svg [data-hour]').last()).toHaveAttribute('data-tokens', '13700')
  await expect(page.locator('.composition-legend')).toContainText('80.3%')
  await expect(page.locator('[data-part="cached"]')).toHaveAttribute('title', '缓存命中 1.1万 · 80.3%')
  const widths = await page.locator('.composition-track > span').evaluateAll(elements => elements.map(element => parseFloat((element as HTMLElement).style.width)))
  expect(widths[0]).toBeCloseTo(1300 / 13700 * 100, 2)
  expect(widths[1]).toBeCloseTo(11000 / 13700 * 100, 2)
  expect(widths[2]).toBeCloseTo(1400 / 13700 * 100, 2)
  await expect(page.locator('.usg-daily')).toHaveCount(0)
  expect(await e2e.count(page, COMMAND)).toBe(1)
})

test('四个范围来回切换无需再次查询，汇总和图表始终保留', async ({ page }) => {
  await boot(page)
  const snapshots = await page.evaluate(async () => {
    const snapshots = []
    for (const name of ['近 7 天', '近 30 天', '全部', '今天', '近 7 天', '今天']) {
      const button = [...document.querySelectorAll<HTMLButtonElement>('.usage-ranges button')].find(button => button.textContent?.trim() === name)!
      button.click()
      await new Promise(requestAnimationFrame)
      snapshots.push({
        name,
        total: document.querySelector('.usg-num')?.textContent,
        waiting: !!document.querySelector('.usg-wait'),
        chart: !!document.querySelector('.usage-chart-stage > section'),
        selected: button.getAttribute('aria-pressed'),
      })
    }
    return snapshots
  })
  expect(snapshots.map(snapshot => snapshot.total)).toEqual(['1.48万', '1.48万', '1.48万', '1.37万', '1.48万', '1.37万'])
  expect(snapshots.every(snapshot => !snapshot.waiting && snapshot.chart && snapshot.selected === 'true')).toBe(true)
  expect(await e2e.count(page, COMMAND)).toBe(1)
})

test('慢速手动刷新期间保留旧内容且可切换缓存，完成后四个范围一起更新', async ({ page }) => {
  let backendUrl = ''
  page.on('request', request => { if (/\/e2e\/mocks\/backend(?:\.ts)?$/.test(new URL(request.url()).pathname)) backendUrl = request.url() })
  await page.clock.setFixedTime(new Date('2026-10-13T04:00:00Z'))
  await boot(page)
  expect(backendUrl).not.toBe('')
  await page.evaluate(async url => {
    const { getBackend } = await import(/* @vite-ignore */ url)
    const backend = getBackend()
    const invoke = backend.invoke.bind(backend)
    backend.invoke = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'codex_query_session_usage') {
        await new Promise<void>(resolve => { (window as any).__finishUsageRefresh = resolve })
      }
      return invoke(cmd, args)
    }
  }, backendUrl)
  await page.getByRole('button', { name: '重新统计', exact: true }).click()
  await expect(page.locator('.usg-updated')).toHaveText('更新中…')
  await expect(page.locator('.usg-num')).toHaveText('1.37万')
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('1.48万')
  await expect(page.locator('.usg-wait')).toHaveCount(0)
  await page.evaluate(config => {
    window.__E2E__!.seed({ ...config, codex: { ...config.codex, sessions: [
      { ...config.codex.sessions[0], input: 20000, cached: 11000, output: 2000 },
      config.codex.sessions[1],
    ] } })
    ;(window as any).__finishUsageRefresh()
  }, seed)
  await expect(page.locator('.usg-num')).toHaveText('2.31万')
  await expect(page.locator('.usg-updated')).not.toHaveText('更新中…')
  await page.getByRole('button', { name: '今天', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('2.2万')
  expect(await e2e.count(page, COMMAND)).toBe(2)
})

for (const width of [800, 1235]) {
  test(`${width}px 缓存达到十亿时净输入和输出仍清晰可见，完整数字保持真实`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
      { sessionId: 'skewed', cwd: 'demo', daysAgo: 0, input: 1_000_001_300, cached: 1_000_000_000, output: 17 },
    ] } })
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    const column = page.locator('.usg-col[data-recorded="true"]')
    const heights = await page.locator('.usg-mini-col[data-recorded="true"] > .usg-bar').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    expect(heights).toHaveLength(2)
    expect(heights.every(height => height >= 60)).toBe(true)
    await expect(column.locator('.usg-stack')).toHaveAttribute('data-value', '1000001317')
    await expect(column.locator('.usg-output')).toHaveAttribute('data-value', '17')
    await expect(column.locator('.usg-fresh')).toHaveAttribute('data-value', '1300')
    await expect(column).toHaveAttribute('aria-label', /合计 1,000,001,317 Token · 净输入 1,300 · 缓存 1,000,000,000 · 输出 17/)
    await expect(page.locator('.usg-scale[data-metric="output"]')).toHaveAttribute('data-max', '20')
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await expect(page.locator('.daily-chart')).toHaveCSS('opacity', '1')
    await page.screenshot({ path: `.tmp/codex-total-detail/skewed-${width}.png` })
  })
}

test('减少动态效果时范围滑块和柱图关闭动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await boot(page)
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  const durations = await page.locator('.usage-range-thumb, .usg-bar, .usg-stack, .daily-column').evaluateAll(elements => elements.flatMap(element => getComputedStyle(element).transitionDuration.split(',').map(parseFloat)))
  expect(durations.every(duration => duration <= 0.00001)).toBe(true)
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
  await expect(page.locator(`[data-hour="${peakClock}"] title`)).toHaveText(/· 1\.48万 Token ·/)
  await expect(page.locator(`[data-hour="${peakClock}"] .hour-target`)).toHaveAttribute('aria-label', /· 14,800 Token ·/)
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
  await expect(page.locator('.usg-cost')).toHaveText('估算金额 $0.00')
  await expect(page.locator('.usg-count')).toHaveText('0 次请求 · 0 条会话')
  expect(await page.locator('.composition-track > span').evaluateAll(elements => elements.every(el => el.getBoundingClientRect().width === 0))).toBe(true)
  await expect(page.locator('.today-peak')).toHaveText('今天还没有用量记录')
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
    const refreshedCalls = await e2e.count(page, COMMAND)
    expect(refreshedCalls).toBeGreaterThanOrEqual(2)
    await page.getByRole('button', { name: '账号', exact: true }).click()
    await page.clock.fastForward(86_400_000)
    expect(await e2e.count(page, COMMAND)).toBe(refreshedCalls)
  })
})

test.describe('夏令时边界', () => {
  test.use({ timezoneId: 'America/New_York' })
  test('跨夏令时的近 7 天仍从当地零点起', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-03T17:00:00Z') })
    await boot(page)
    await page.getByRole('button', { name: '近 7 天', exact: true }).click()
    await expect(page.getByRole('region', { name: '近 7 天用量', exact: true })).toBeVisible()
    expect((await args(page)).windows.week).toBe(Date.parse('2026-10-28T04:00:00Z') / 1000)
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
    expect((await args(page)).windows.week).toBe(Date.parse('2018-10-29T03:00:00Z') / 1000)
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

test('总量堆叠与真实构成一致，两个分项小图保留日期间的真实比例', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
  await boot(page, { ...seed, codex: { ...seed.codex, sessions: [
    { sessionId: 'large', cwd: 'C:\\demo', daysAgo: 1, input: 9000, cached: 6000, output: 1000 },
    { sessionId: 'small', cwd: 'C:\\demo', daysAgo: 0, input: 900, cached: 600, output: 100 },
  ] } })
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.locator('.usg-col')).toHaveCount(7)
  await expect(page.locator('.usg-col[data-recorded="false"]')).toHaveCount(5)
  const stacks = await page.locator('.usg-col[data-recorded="true"] .usg-stack').evaluateAll(elements => elements.map(element => ({
    height: element.getBoundingClientRect().height,
    segments: [...element.children].map(part => part.getBoundingClientRect().height),
  })))
  expect(stacks[0].height).toBeGreaterThan(100)
  expect(stacks[1].height / stacks[0].height).toBeCloseTo(0.1, 2)
  expect(stacks[0].segments[0] / stacks[0].height).toBeCloseTo(0.3, 2)
  expect(stacks[0].segments[1] / stacks[0].height).toBeCloseTo(0.6, 2)
  expect(stacks[0].segments[2] / stacks[0].height).toBeCloseTo(0.1, 2)
  for (const name of ['净输入', '输出']) {
    const plot = page.getByRole('group', { name, exact: true })
    const bars = await plot.locator('[data-recorded="true"] > .usg-bar').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    expect(bars[0]).toBeGreaterThan(60)
    expect(bars[1] / bars[0]).toBeCloseTo(0.1, 2)
    await expect(plot.locator('.series-heading')).toContainText('独立刻度')
  }
  await expect(page.locator('.usg-scale')).toHaveCount(3)
  await page.screenshot({ path: '.tmp/codex-total-detail/stack-and-details.png' })
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
  const heights = await page.locator('.usg-mini-col.selected > .usg-bar').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
  expect(heights).toHaveLength(2)
  expect(heights.every(height => height >= 2)).toBe(true)
  await expect(page.locator('.daily-legend')).toHaveText('净输入 4缓存 4输出 4')
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
    bar: el.querySelector('.usg-bar')!.getBoundingClientRect().width,
  })))
  expect(geometry.every(box => box.bar <= 28.1)).toBe(true)
  for (let n = 1; n < geometry.length; n++) expect(geometry[n].x - geometry[n-1].x).toBeCloseTo(geometry[0].width, 0)
})

for (const range of ['近 7 天', '近 30 天']) {
  test(`${range}总量与两个小图的悬停、点击和键盘日期联动`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-13T04:00:00Z') })
    await boot(page)
    await page.getByRole('button', { name: range, exact: true }).click()
    const total = page.getByRole('group', { name: '每日总量', exact: true })
    const fresh = page.getByRole('group', { name: '净输入', exact: true })
    const output = page.getByRole('group', { name: '输出', exact: true })
    const expectDate = async (date: string) => {
      for (const plot of [total, fresh, output]) {
        await expect(plot.locator('.daily-column.selected')).toHaveAttribute('data-day', date)
        await expect(plot.locator('button[aria-pressed="true"]')).toHaveCount(1)
        await expect(plot.locator('button[tabindex="0"]')).toHaveAttribute('data-day', date)
      }
      await expect(page.locator('.daily-readout')).toContainText(date)
    }
    await total.locator('[data-day="2026-10-12"]').hover()
    await expectDate('2026-10-12')
    await expect(page.locator('.daily-readout')).toContainText('1,100')
    await fresh.locator('[data-day="2026-10-13"]').click()
    await expectDate('2026-10-13')
    await expect(page.locator('.daily-readout')).toContainText('1.37万')
    await output.locator('[data-day="2026-10-13"]').focus()
    await page.keyboard.press('ArrowLeft')
    await expect(output.locator('[data-day="2026-10-12"]')).toBeFocused()
    await expectDate('2026-10-12')
    await page.keyboard.press('Home')
    await expect(page.locator('.daily-readout')).toContainText('无本地记录')
    for (const plot of [total, fresh, output]) await expect(plot.locator('.daily-column.selected .has-value')).toHaveCount(0)
    await page.keyboard.press('End')
    await expectDate('2026-10-13')
    await expect(output.locator('[data-day="2026-10-13"]')).toBeFocused()
    expect(await e2e.count(page, COMMAND)).toBe(1)
  })
}

for (const width of [800, 1235]) {
  test(`${width}px 下总量在上、两个小图并排，30 天日期和刻度不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') })
    await boot(page, { ...seed, codex: { ...seed.codex, sessions: Array.from({ length: 30 }, (_, index) => ({
      sessionId: `day-${index}`, cwd: 'demo', daysAgo: index, turns: 3, model: 'gpt-5.4',
      input: (index % 7 + 1) * 12000 + (index % 5 + 1) * 1300,
      cached: (index % 7 + 1) * 12000,
      output: (index % 6 + 1) * 170,
    })) } })
    await page.getByRole('button', { name: '近 30 天', exact: true }).click()
    const chart = page.getByRole('region', { name: '每日用量趋势', exact: true })
    await expect(chart.locator('.usage-series')).toHaveCount(3)
    await expect(chart.locator('.usg-col')).toHaveCount(30)
    const geometry = await chart.locator('.usage-series').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom }
    }))
    expect(geometry[0].bottom).toBeLessThanOrEqual(geometry[1].y)
    expect(geometry[1].y).toBeCloseTo(geometry[2].y, 0)
    expect(geometry[1].right).toBeLessThan(geometry[2].x)
    expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await expect(chart).toHaveCSS('opacity', '1')
    await chart.screenshot({ path: `.tmp/codex-total-detail/month-${width}.png` })
  })
}
