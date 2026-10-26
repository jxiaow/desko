import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, tipButton, visiblePane } from '../helpers'

test('切回小记保留就地编辑状态，工具栏、标题和搜索快捷键跟随当前页面', async ({ page }) => {
  await bootUnlocked(page, {
    notes: [{ title: '正在编辑', content_html: '<p>原有正文</p>' }],
    entries: [{ name: '示例收藏', url: 'https://example.com', password: '' }],
    // 三页的搜索框都只在有内容时挂载，空库那一轮 .search-box 直接不存在
    fileShortcuts: [{ name: 'demo.txt', path: 'C:/Work/demo.txt', shortcut_type: 'file' }],
  })
  await page.locator('.memo').hover()
  await page.locator('.memo-edit').click()
  await page.locator('.memo.editing .ProseMirror').fill('切换模块后继续编辑')

  for (const module of ['entries', 'files', 'notes']) {
    await page.locator(`a.nav-item[href="/${module}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/${module}$`))
    await page.keyboard.press('Control+k')
    const search = page.locator('.search-box input')
    await expect(search).toHaveCount(1)
    await expect(search).toBeFocused()
  }

  await expect(page.locator('.memo.editing')).toBeVisible()
  await expect(page.locator('.memo.editing .ProseMirror')).toHaveText('切换模块后继续编辑')
  await expect(page.locator('.titlebar-crumb')).toHaveText('小记')
  await expect(page.locator('#workspace-page-toolbar .page-bar')).toHaveCount(1)
  await expect(page.locator('#workspace-directory-content .directory-list')).toHaveCount(0)
  await expect.poll(async () => (await e2e.snapshot(page)).notes[0].content_html).toContain('切换模块后继续编辑')
})

test('切回小记保留卡片展开状态和列表滚动位置', async ({ page }) => {
  await bootUnlocked(page, {
    notes: Array.from({ length: 30 }, (_, i) => ({
      title: `记录 ${i}`,
      content_html: Array.from({ length: 15 }, (_, line) => `<p>记录 ${i} 第 ${line} 行</p>`).join(''),
    })),
  })
  const first = page.locator('.memo').first()
  await first.getByRole('button', { name: '展开全文', exact: true }).click()
  const stream = page.locator('.stream')
  await stream.evaluate(el => { el.scrollTop = 600 })
  await expect.poll(() => stream.evaluate(el => el.scrollTop)).toBe(600)

  await page.locator('a.nav-item[href="/entries"]').click()
  await expect(page).toHaveURL(/\/entries$/)
  await page.locator('a.nav-item[href="/notes"]').click()
  await expect(page).toHaveURL(/\/notes$/)

  await expect(first.locator('.memo-unfold')).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => stream.evaluate(el => el.scrollTop)).toBe(600)
})

test('切回收藏保留批量选择，隐藏页面不会响应 Escape', async ({ page }) => {
  await bootUnlocked(page, {
    entries: [{ name: '示例收藏', url: 'https://example.com', password: '' }],
  }, '/entries')
  await page.getByRole('button', { name: '选择条目', exact: true }).click()
  await page.locator('.entry-card').click()
  await expect(page.locator('.dock-count')).toContainText('1')

  await page.locator('a.nav-item[href="/files"]').click()
  await expect(page).toHaveURL(/\/files$/)
  await page.keyboard.press('Escape')
  await page.locator('a.nav-item[href="/entries"]').click()
  await expect(page.locator('.dock-count')).toContainText('1')
  await expect(page.locator('.entry-card')).toHaveClass(/selected/)
})

test('切回 Codex 保留子视图并恢复对应标题', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await page.getByRole('navigation', { name: 'Codex 视图' }).getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.titlebar-crumb')).toHaveText('Codex 会话')
  await page.locator('a.nav-item[href="/notes"]').click()
  await expect(page.locator('.titlebar-crumb')).toHaveText('小记')
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.locator('.cx-tab.active')).toHaveText('会话')
  await expect(page.locator('.titlebar-crumb')).toHaveText('Codex 会话')
})

test('隐藏的小记不接收局域网传输页的原生拖放', async ({ page }) => {
  await bootUnlocked(page, {
    settings: { fileshare_enabled: 'true' },
    fileshare: { running: true },
  })
  await page.locator('a.nav-item[href="/fileshare"]').click()
  await expect(page.getByRole('button', { name: '停止服务', exact: true })).toBeVisible()
  await expect.poll(() => e2e.hasListener(page, 'tauri://drag-drop')).toBe(true)
  await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths: ['C:/test/image.png'] })
  await expect.poll(() => e2e.count(page, 'fileshare_import_files')).toBe(1)
  expect(await e2e.count(page, 'stage_attachment')).toBe(0)
})

test('禁用模块会清掉已缓存的局部状态', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await page.getByRole('navigation', { name: 'Codex 视图' }).getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('a.nav-item[href="/notes"]').click()
  const dialog = await openSettings(page, 'modules')
  const toggle = visiblePane(dialog).locator('.setting-item').filter({ has: page.getByText('Codex', { exact: true }) }).locator('.switch-slider')
  await toggle.click()
  await expect(page.locator('a.nav-item[href="/codex"]')).toHaveCount(0)
  await toggle.click()
  await dialog.locator('.dialog-close').click()
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.locator('.cx-tab.active')).toHaveText('账号')
})

test('锁定会卸载所有模块缓存，解锁后重新创建页面', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await page.getByRole('navigation', { name: 'Codex 视图' }).getByRole('button', { name: '会话', exact: true }).click()
  await page.locator('a.nav-item[href="/notes"]').click()
  await tipButton(page, '锁定').click()
  await page.locator('.unlock-input').fill('e2e-master-123')
  await page.locator('.unlock-btn').click()
  await expect(page.locator('.notes-page')).toBeVisible()
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.locator('.cx-tab.active')).toHaveText('账号')
})
