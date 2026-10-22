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

for (const width of [800, 1040, 1920]) {
  test(`${width}px 保留通栏顶栏与无边框卡面，目录开关保持搜索和操作对齐`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, seed)
    const toolbar = page.locator('#workspace-page-toolbar')
    await expect(page.locator('.titlebar-outer #workspace-page-toolbar')).toBeVisible()
    expect((await bounds(page.locator('.titlebar-outer'))).height).toBe(48)
    await expect(page.locator('.workspace-main > #workspace-page-toolbar')).toHaveCount(0)
    let searchLeft: number | undefined
    for (const [route, columnSelector] of [
      ['notes', '.composer'], ['entries', '.card-grid:has(.entry-card)'], ['files', '.shortcut-list'],
      ['mfa', '.card-grid:has(.mfa-card:not(.skeleton))'], ['codex', '.rcard-list:has(.acc-row)'],
    ]) {
      await page.locator(`a.nav-item[href="/${route}"]`).click()
      const column = page.locator(columnSelector).first()
      await expect(column).toBeVisible()
      const main = await bounds(page.locator('.workspace-main'))
      const content = await bounds(column)
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
        if (searchLeft === undefined) searchLeft = search.x
        if (route === 'codex') {
          expect(search.x).toBe(content.x)
          expect(search.y).toBeGreaterThanOrEqual(48)
          await expect(toolbar.locator('.search-box')).toHaveCount(0)
        } else expect(Math.abs(search.x - searchLeft)).toBeLessThanOrEqual(1)
        expect(search.width).toBeLessThanOrEqual(300)
        expect(search.width).toBeGreaterThanOrEqual(120)
        if (width >= 1040) expect(search.width).toBe(300)
      }
      const card = page.locator('.memo, .entry-card, .shortcut-row, .mfa-card:not(.skeleton), .acc-row').first()
      await expect(card).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
      if (route === 'notes' || route === 'entries') {
        await page.locator('#workspace-directory-toggle').click()
        await page.getByRole('button', { name: '固定目录', exact: true }).click()
        const directory = await bounds(page.locator('.workspace-directory'))
        const dockedContent = await bounds(column)
        const dockedActions = await bounds(toolbar.locator('.page-actions'))
        expect(directory.width).toBeGreaterThanOrEqual(200)
        expect(directory.width).toBeLessThanOrEqual(248)
        expect(directory.y).toBe(48)
        expect(dockedActions.x + dockedActions.width).toBeLessThan(directory.x)
        expect(Math.abs(dockedActions.x + dockedActions.width - dockedContent.x - dockedContent.width)).toBeLessThanOrEqual(1)
        expect(Math.abs((await bounds(page.locator('.titlebar-left'))).x - dockedContent.x)).toBeLessThanOrEqual(1)
        if (width <= 1040) expect((await bounds(toolbar.locator('.search-box'))).x).toBe(searchLeft)
        if (width <= 1040) expect(dockedContent.x).toBe(content.x)
        const selected = page.locator('.workspace-directory .directory-link.active').first()
        expect(await selected.evaluate(element => {
          const probe = document.createElement('span')
          probe.style.color = 'var(--text-brand)'
          element.append(probe)
          const expected = getComputedStyle(probe).color
          probe.remove()
          return getComputedStyle(element).color === expected && getComputedStyle(element.querySelector('svg')!).color === expected
        })).toBe(true)
        await page.locator('#workspace-directory-toggle').click()
      }
      expect(await page.locator('.workspace-main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }
  })
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 卡面无常态边框，悬停仍保留小记编辑与键盘焦点`, async ({ page }) => {
    await bootUnlocked(page, { ...seed, settings: { ...seed.settings, theme, fileshare_enabled: 'true' }, fileshare: { running: true, shareDirs: ['C:/demo/share'] } })
    const memo = page.locator('.memo').first()
    await expect(memo).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.composer')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await memo.hover()
    await memo.locator('.memo-check').click()
    const selectedMemo = page.locator('.memo.is-sel')
    await expect(selectedMemo).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await page.mouse.move(0, 0)
    const selectedBackground = await selectedMemo.evaluate(element => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--accent-soft)'
      element.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    })
    await expect(selectedMemo).toHaveCSS('background-color', selectedBackground)
    await selectedMemo.hover()
    await expect(selectedMemo).toHaveCSS('background-color', selectedBackground)
    await expect(selectedMemo).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await selectedMemo.locator('.memo-check').click()
    await tipButton(memo, '编辑').click()
    const editing = page.locator('.memo.editing')
    await page.mouse.move(0, 0)
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
      await page.mouse.move(0, 0)
      await page.keyboard.press('Tab')
      await card.focus()
      await expect.poll(() => card.evaluate(hasRing)).toBe(true)
      await card.hover()
      await page.waitForTimeout(250)
      expect(await card.evaluate(hasRing)).toBe(true)
      expect(await card.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    }
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.drop-card')).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.drop-card')).toHaveCSS('box-shadow', 'none')
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
