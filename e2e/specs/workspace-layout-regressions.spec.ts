import { test, expect, type Locator } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'
import type { E2EConfig } from '../mocks/backend'

const seed: E2EConfig = {
  settings: { mfa_enabled: 'true', codex_enabled: 'true', background_atmosphere: 'false' },
  notes: [{ title: '布局检查', content_html: '<p>保持阅读列、工具栏与交互状态清晰。</p>' }],
  entries: Array.from({ length: 6 }, (_, i) => ({ name: `收藏 ${i}`, url: `https://example.invalid/${i}`, password: 'demo', category: '工作' })),
  fileShortcuts: [{ name: '项目', path: 'C:/demo', shortcut_type: 'folder' }],
  mfaTokens: [{ issuer: 'GitHub', label: 'demo@example.invalid' }],
  codex: { accounts: [{ email: 'demo@example.invalid', current: true }, { email: 'other@example.invalid' }] },
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

for (const width of [1040, 1920]) {
  test(`${width}px 侧栏折叠开关贴住轨道接缝，内容宽度随之变化`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, seed, '/notes')
    const toggle = page.getByRole('button', { name: '收起侧栏', exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const before = await bounds(toggle)
    const expanded = (await bounds(page.locator('.workspace-main'))).width
    expect(before.x).toBeGreaterThanOrEqual(208)
    await toggle.click()
    const collapsedButton = page.getByRole('button', { name: '展开侧栏', exact: true })
    await expect(collapsedButton).toHaveAttribute('aria-expanded', 'false')
    const collapsed = await bounds(collapsedButton)
    expect(collapsed.x).toBeLessThan(before.x)
    expect({ y: collapsed.y, width: collapsed.width, height: collapsed.height }).toEqual({ y: before.y, width: before.width, height: before.height })
    expect((await bounds(page.locator('.workspace-main'))).width).toBeGreaterThan(expanded)
    await page.mouse.click(collapsed.x + collapsed.width / 2, collapsed.y + collapsed.height / 2)
    await expect(page.getByRole('button', { name: '收起侧栏', exact: true })).toBeVisible()
    expect((await bounds(page.locator('.workspace-main'))).width).toBe(expanded)
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')
  })
}

for (const width of [800, 1040, 1920]) {
  test(`${width}px 顶栏、工作栏与内容共用阅读列，控件不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, seed)
    const toolbar = page.locator('#workspace-page-toolbar')
    await expect(page.locator('.titlebar-outer #workspace-page-toolbar')).toBeVisible()
    expect((await bounds(page.locator('.titlebar-outer'))).height).toBe(48)
    let searchOffset: number | undefined
    const columns: Record<string, { x: number; width: number }> = {}
    for (const [route, columnSelector] of [
      ['notes', '.composer'], ['entries', '.card-grid:has(.entry-card)'], ['files', '.shortcut-list'],
      ['mfa', '.card-grid:has(.mfa-card:not(.skeleton))'], ['codex', '.rcard-list:has(.acc-row)'],
    ]) {
      await page.locator(`a.nav-item[href="/${route}"]`).click()
      const column = page.locator(columnSelector).first()
      await expect(column).toBeVisible()
      const main = await bounds(page.locator('.workspace-main'))
      const content = await bounds(column)
      columns[route] = { x: content.x, width: content.width }
      expect(content.width).toBeLessThanOrEqual(1120.5)
      expect(content.x).toBeGreaterThanOrEqual(main.x + 32)
      expect(content.x + content.width).toBeLessThanOrEqual(main.x + main.width - 32)
      const heading = await bounds(page.locator(route === 'codex' ? '.cx-header-tabs' : '.titlebar-left'))
      expect(Math.abs(heading.x - content.x)).toBeLessThanOrEqual(1)
      const actions = await bounds(toolbar.locator('.page-actions'))
      expect(actions.x + actions.width).toBeLessThanOrEqual(content.x + content.width + 1)
      expect(actions.x + actions.width).toBeLessThanOrEqual((await bounds(page.locator('.titlebar-buttons'))).x - 11)
      expect((await bounds(toolbar)).y).toBe(0)
      expect(actions.y + actions.height).toBeLessThanOrEqual(48)
      if (route !== 'mfa') {
        const search = await bounds((route === 'codex' ? page.locator('#codex-view-filters') : toolbar).locator('.search-box'))
        // 各页阅读列宽度不同（小记与 Codex 940、其余 1120），比较的是搜索框在列内的起始偏移。
        const offset = search.x - content.x
        if (searchOffset === undefined) searchOffset = offset
        if (route === 'codex') {
          expect(search.x).toBe(content.x)
          expect(search.y).toBeGreaterThanOrEqual(48)
          await expect(toolbar.locator('.search-box')).toHaveCount(0)
        } else expect(Math.abs(offset - searchOffset)).toBeLessThanOrEqual(1)
        // 工具条档搜索框 flex: 1 1 120px、max-width: 360px（CodexWorkspace 顶栏改版后的档位）。
        expect(search.width).toBeLessThanOrEqual(360.5)
        expect(search.width).toBeGreaterThanOrEqual(120)
      }
      if (route === 'notes' || route === 'entries') {
        const workbar = page.locator('.workspace-workbar')
        const bar = await bounds(workbar)
        expect(bar.height).toBe(42)
        expect(bar.x).toBe(content.x)
        expect(bar.width).toBe(content.width)
        expect(await workbar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
        await expect(page.locator('.workspace-directory')).toBeHidden()
        await expect(page.locator('#workspace-directory-toggle')).toHaveCount(0)
      }
      const card = page.locator('.memo, .entry-card, .shortcut-row, .mfa-card:not(.skeleton), .acc-row').first()
      const border = await card.evaluate(el => getComputedStyle(el).borderTopColor)
      expect(border).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
      expect(await page.locator('.workspace-main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
    // 小记与 Codex 同一个外壳、同一条页头，列宽必须一致：小记早先单走 720，
    // 切页时页名与搜索框横跳约 94px（1240 窗），窄列本身也在宽窗里空掉两侧。
    expect(columns.notes).toEqual(columns.codex)
  })
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 卡面有安静边界，悬停、选中与键盘焦点仍有清楚反馈`, async ({ page }) => {
    await bootUnlocked(page, { ...seed, settings: { ...seed.settings, theme, fileshare_enabled: 'true' }, fileshare: { running: true, shareDirs: ['C:/demo/share'] } })
    const memo = page.locator('.memo').first()
    const border = await memo.evaluate(el => getComputedStyle(el).borderTopColor)
    const canvas = await page.locator('.workspace-main').evaluate(el => getComputedStyle(el).backgroundColor)
    expect(border).not.toBe(canvas)
    expect(border).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
    await memo.hover()
    await memo.locator('.memo-check').click()
    const selectedMemo = page.locator('.memo.is-sel')
    await expect(selectedMemo).not.toHaveCSS('border-top-color', border)
    await page.mouse.move(0, 0)
    await selectedMemo.hover()
    await expect(selectedMemo).toHaveCSS('border-top-color', /rgb\(|color\(|oklab\(|oklch\(/)
    await selectedMemo.locator('.memo-check').click()
    await tipButton(memo, '编辑').click()
    const editing = page.locator('.memo.editing')
    const hasRing = (element: Element) => {
      const style = getComputedStyle(element)
      return style.boxShadow !== 'none' && !/rgba\(0, 0, 0, 0\)|transparent/.test(style.borderColor)
    }
    await expect.poll(() => editing.evaluate(hasRing)).toBe(true)
    await editing.hover()
    await page.waitForTimeout(250)
    expect(await editing.evaluate(hasRing)).toBe(true)
    for (const [route, selector] of [['entries', '.entry-card'], ['mfa', '.mfa-card']]) {
      await page.locator(`a.nav-item[href="/${route}"]`).click()
      const card = page.locator(selector).first()
      await page.keyboard.press('Tab')
      await card.focus()
      await expect.poll(() => card.evaluate(hasRing)).toBe(true)
      await card.hover()
      await page.waitForTimeout(250)
      expect(await card.evaluate(hasRing)).toBe(true)
    }
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.send-panel')).toHaveCSS('box-shadow', 'none')
    // 卡面改为柔影分层（描边只留一丝），仍是一层短软影，不是抬起的浮层。
    await expect(page.locator('.drop-card')).toHaveCSS('box-shadow', /0px 1px 2px/)
  })
}

test('800px Codex 长标签和排序不会溢出，筛选与账号操作仍可使用', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  const tag = '研发团队测试环境专用账号'
  await bootUnlocked(page, {
    ...seed,
    codex: { accounts: [{ email: 'demo@example.invalid', tags: [tag], current: true }, { email: 'other@example.invalid' }] },
  }, '/codex')
  await page.getByRole('button', { name: '账号标签', exact: true }).click()
  await page.getByRole('menuitemradio').filter({ hasText: tag }).click()
  await page.getByRole('button', { name: '账号排序', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '可用配额优先', exact: true }).click()
  await expect(page.getByRole('button', { name: '账号标签', exact: true }).locator('.opt-value')).toHaveCSS('white-space', 'nowrap')
  const pane = await bounds(page.locator('.workspace-main'))
  for (const button of await page.locator('.cx-tabs-row button, #workspace-page-toolbar button').all()) {
    const box = await bounds(button)
    expect(box.x).toBeGreaterThanOrEqual(pane.x + 24)
    expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width - 24)
  }
  expect(await page.locator('.content-inner').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '账号标签', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '全部标签', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('desko:web-access-status', {
    detail: { running: true, lan: true, port: 8420 },
  })))
  await expect(page.locator('.web-running')).toBeVisible()
  await expect.poll(async () => {
    const actions = await bounds(page.locator('#workspace-page-toolbar .page-actions'))
    const controls = await bounds(page.locator('.titlebar-buttons'))
    return actions.x + actions.width <= controls.x - 11 && actions.y + actions.height <= 48
  }).toBe(true)
  await page.getByRole('button', { name: '添加账号', exact: true }).click()
  await expect(page.locator('.dialog:visible h3')).toContainText('添加 Codex 账号')
})
