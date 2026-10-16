import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane, waitForToastGone } from '../helpers'

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

  test('零模块态：落在空态页，直达任何模块 URL 也进不去', async ({ page }) => {
    await bootUnlocked(page, OFF, '/entries')
    await expect(page).toHaveURL(/\/start$/)
    await expect(page.locator('.empty-title')).toHaveText('暂无已启用的模块')
    await expect(page.locator('.empty-desc')).toHaveText('在设置中启用模块后，即可开始使用。')
    await expect(page.getByRole('button', { name: '管理模块', exact: true })).toBeVisible()
    await expect(page.locator('a.nav-item')).toHaveCount(0)
    expect(await e2e.count(page, 'list_notes')).toBe(0)
    expect(await e2e.count(page, 'list_entries_with_paths')).toBe(0)
  })

  test('零模块态：空页按钮直达设置「模块」页签，开一个就落地', async ({ page }) => {
    await bootUnlocked(page, OFF)
    await page.locator('.empty-state .action-btn').click()
    const dialog = page.locator('.settings-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.nav-tab.on')).toHaveText('模块')

    await moduleNameRow(page, '小记').locator('.switch-slider').click()
    await expectToast(page, '小记已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveCount(1)
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.getByText('暂无已启用的模块', { exact: true })).toHaveCount(0)
    await expect(page.locator('.notes-page')).toBeVisible()

    await openSettings(page, 'modules')
    await moduleNameRow(page, '网址收藏').locator('.switch-slider').click()
    await expectToast(page, '网址收藏已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page).toHaveURL(/\/notes$/)
  })
})
