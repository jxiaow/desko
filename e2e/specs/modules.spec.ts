import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, startApp, visiblePane, waitForToastGone } from '../helpers'
import { AuthPage } from '../pages/auth-page'

/** 8 个页面模块全关 */
const OFF = {
  settings: {
    notes_enabled: 'false',
    entries_enabled: 'false',
    files_enabled: 'false',
    mfa_enabled: 'false',
    fileshare_enabled: 'false',
    tunnel_enabled: 'false',
    bypass_enabled: 'false',
    codex_enabled: 'false',
  },
}

const moduleNameRow = (page: Page, name: string) =>
  visiblePane(page.locator('.settings-dialog')).locator('.setting-item', { hasText: name })

/** 页面上拉过哪些视图文件：dev 模式下动态 import 会落成一条 /src/views/XxxView.vue 资源请求 */
const loadedViewChunks = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => n.includes('/src/views/')),
  )

test.describe('模块开关', () => {
  test('首次设置后不预置模块，选择器点选即启用且不跳页', async ({ page }) => {
    await startApp(page, { config: { initialized: false } })
    const auth = new AuthPage(page)
    await auth.completeSetup('abcdef', 'abcdef')
    await auth.expectUnlocked()
    await expect(page).toHaveURL(/\/start$/)
    await expect(page.locator('.onb-page')).toBeVisible()
    await expect(page.locator('.onb-title')).toHaveText('选择要启用的模块')
    await expect(page.locator('.module-tile')).toHaveCount(8)
    await expect(page.locator('.onb-count')).toHaveText('点击模块开始启用')
    await expect(page.locator('.onb-cta')).toBeDisabled()
    await expect(page.locator('a.nav-item')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '模块导航' }).getByRole('link')).toHaveCount(0)
    for (const cmd of ['list_notes', 'list_entries_with_paths', 'list_file_shortcuts', 'list_codex_accounts']) {
      expect(await e2e.count(page, cmd)).toBe(0)
    }

    await page.locator('.module-tile', { hasText: '小记' }).click()
    await expect(page).toHaveURL(/\/start$/)
    await expect(page.locator('.onb-count')).toHaveText('已启用 1 个模块')
    await expect(page.locator('.onb-cta')).toBeEnabled()
    await expect(page.locator('.module-tile[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveCount(1)

    await page.locator('.onb-cta').click()
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('.notes-page')).toBeVisible()
    const settings = (await e2e.snapshot(page)).settings
    expect(settings.notes_enabled).toBe('true')
    expect(settings.entries_enabled).toBeUndefined()
    expect(settings.files_enabled).toBeUndefined()
  })

  test('模块页签：8 行齐全，顺序即侧栏顺序', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page, 'modules')
    expect(
      await dialog.locator('.settings-pane:visible .setting-item .setting-name').evaluateAll((els) =>
        els.map((el) => el.textContent?.trim()),
      ),
    ).toEqual(['小记', '网址收藏', '文件快捷', '验证码', '局域网传输', '内网穿透', '网络直连', 'Codex'])
  })

  test('关核心页：入口当场收起，当前页带回下一个开启的模块，重开即恢复', async ({ page }) => {
    await bootUnlocked(page, {}, '/notes')
    const dialog = await openSettings(page, 'modules')
    await moduleNameRow(page, '小记').locator('.switch-slider').click()
    await expectToast(page, '设置已保存')
    await expect(page).toHaveURL(/\/entries$/)
    expect(await e2e.count(page, 'set_setting')).toBeGreaterThan(0)
    await waitForToastGone(page)

    await moduleNameRow(page, '小记').locator('.switch-slider').click()
    await expectToast(page, '小记已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(page.locator('.notes-page')).toBeVisible()
  })

  test('关闭模块不下载视图 chunk，也不留常驻请求', async ({ page }) => {
    await bootUnlocked(
      page,
      { settings: { tunnel_enabled: 'false', entries_enabled: 'false' } },
      '/tunnel',
    )
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('a.nav-item[href="/tunnel"]')).toHaveCount(0)

    const chunks = await loadedViewChunks(page)
    expect(chunks.some((n) => n.includes('TunnelView'))).toBe(false)
    expect(await e2e.count(page, 'tunnel_status')).toBe(0)
    expect(await e2e.count(page, 'list_entries_with_paths')).toBe(0)
  })

  test('核心页关掉的解锁预取不跑：锁定再解锁仍不发收藏请求', async ({ page }) => {
    await bootUnlocked(page, { settings: { entries_enabled: 'false' } })
    await page.locator('button[title="锁定"]').click()
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.app-layout')).toBeVisible()
    expect(await e2e.count(page, 'list_entries_with_paths')).toBe(0)
    expect(await e2e.count(page, 'list_notes')).toBeGreaterThan(0)
  })

  test('零模块态：落在选择器，直达任何模块 URL 也进不去', async ({ page }) => {
    await bootUnlocked(page, OFF, '/entries')
    await expect(page).toHaveURL(/\/start$/)
    await expect(page.locator('.onb-title')).toHaveText('选择要启用的模块')
    await expect(page.locator('.module-tile')).toHaveCount(8)
    await expect(page.locator('a.nav-item')).toHaveCount(0)
    expect(await e2e.count(page, 'list_notes')).toBe(0)
    expect(await e2e.count(page, 'list_entries_with_paths')).toBe(0)
  })

  test('零模块态：设置与选择器同步，CTA 才进入工作台', async ({ page }) => {
    await bootUnlocked(page, OFF)
    await expect(page.locator('.onb-page')).toBeVisible()
    const dialog = await openSettings(page, 'modules')
    await moduleNameRow(page, '小记').locator('.switch-slider').click()
    await expectToast(page, '小记已开启')
    await dialog.locator('.dialog-close').click()

    await expect(page).toHaveURL(/\/start$/)
    await expect(page.locator('.module-tile[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.locator('.onb-count')).toHaveText('已启用 1 个模块')
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveCount(1)

    await page.locator('.onb-cta').click()
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('.notes-page')).toBeVisible()
  })

  test('最小窗口可滚到底栏，八块全选后 CTA 仍落到顺序最前的模块', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await bootUnlocked(page, OFF)
    await expect(page.locator('.onb-page')).toBeVisible()

    await page.locator('.onb-cta').scrollIntoViewIfNeeded()
    await expect(page.locator('.onb-cta')).toBeInViewport()
    expect(await page.locator('.content-inner.onb-page').evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

    for (const name of ['小记', '网址收藏', '文件快捷', '验证码', '局域网传输', '内网穿透', '网络直连', 'Codex']) {
      const tile = page.locator('.module-tile', { hasText: name })
      await tile.click()
      await expect(tile).toHaveAttribute('aria-pressed', 'true')
    }
    await expect(page.locator('.onb-count')).toHaveText('已启用 8 个模块')
    await expect(page.locator('a.nav-item')).toHaveCount(8)

    await page.locator('.onb-cta').click()
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('.notes-page')).toBeVisible()
  })
})
