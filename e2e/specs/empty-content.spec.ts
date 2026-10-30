import { test, expect } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'

const settings = { codex_enabled: 'true', workspace_directory_open: '{"notes":true,"entries":true}', workspace_directory_pinned: '{"notes":true,"entries":true}' }
const content = {
  notes: [{ title: '可检索的小记', content_html: '<p>可检索的小记 #工作</p>' }],
  entries: [{ name: '可检索的收藏', url: 'https://example.invalid', category: '工作' }],
  fileShortcuts: [{ name: '可检索的文件', path: 'C:/demo', shortcut_type: 'folder' as const }],
}

for (const route of ['notes', 'entries', 'files']) {
  test(`${route} 空库隐藏搜索与筛选，恢复完整画布`, async ({ page }) => {
    await bootUnlocked(page, { settings })
    await page.locator(`a.nav-item[href="/${route}"]`).click()
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(page.locator('#workspace-page-toolbar .search-box')).toHaveCount(0)
    await expect(page.locator('#workspace-directory-toggle')).toHaveCount(0)
    await expect(page.locator('.workspace-directory')).toBeHidden()
    const main = (await page.locator('.workspace-main').boundingBox())!
    // 浮片右侧留 10px 窗框，除此之外内容面通栏。
    expect(page.viewportSize()!.width - (main.x + main.width)).toBe(10)
  })

  test(`${route} 搜索无结果时仍能清除条件找回内容`, async ({ page }) => {
    await bootUnlocked(page, { settings, ...content })
    await page.locator(`a.nav-item[href="/${route}"]`).click()
    const rows = page.locator(route === 'notes' ? '.memo' : route === 'entries' ? '.entry-card' : '.shortcut-row')
    await expect(rows).toHaveCount(1)
    const input = page.locator('#workspace-page-toolbar .search-box input')
    await input.fill('没有匹配的关键字')
    await expect(page.locator('.empty-state')).toBeVisible()
    await expect(input).toBeVisible()
    await tipButton(page.locator('#workspace-page-toolbar'), route === 'notes' ? '清空搜索' : '清除搜索').click()
    await expect(rows).toHaveCount(1)
    await expect(input).toHaveValue('')
  })
}

test('创建第一条、删除最后一条小记时，搜索与目录随内容更新', async ({ page }) => {
  await bootUnlocked(page, { settings })
  await page.locator('.composer .ProseMirror').fill('第一条小记')
  await page.locator('.composer .ProseMirror').press('Control+Enter')
  const memo = page.locator('.memo')
  await expect(memo).toHaveCount(1)
  await expect(page.locator('#workspace-page-toolbar .search-box')).toBeVisible()
  await expect(page.locator('.workspace-workbar')).toBeVisible()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await memo.hover()
  await tipButton(memo, '更多操作').click()
  await page.locator('.popover .pop-item').filter({ hasText: '删除' }).click()
  await page.locator('.confirm-dialog .btn-danger').click()
  await expect(memo).toHaveCount(0)
  await expect(page.locator('#workspace-page-toolbar .search-box')).toHaveCount(0)
  await expect(page.locator('.workspace-workbar')).toHaveCount(0)
  await expect(page.locator('.workspace-directory')).toBeHidden()
})

test('Codex 空账号、会话与用量隐藏对应搜索筛选，保留刷新入口', async ({ page }) => {
  await bootUnlocked(page, { settings })
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('.account-filters')).toHaveCount(0)
  await expect(page.locator('.cx-tabs-row .search-box')).toHaveCount(0)
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.empty-state')).toBeVisible()
  await expect(page.locator('.session-search-mode')).toHaveCount(0)
  await expect(page.locator('.cx-tabs-row .search-box')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-sum')).toBeVisible()
  await expect(page.locator('.usage-ranges')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重新统计', exact: true })).toBeVisible()
})

test('空回收站仅首次扫描显示骨架，再次刷新始终保留空态', async ({ page }) => {
  let apiUrl = ''
  page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/api/codex.ts') apiUrl = request.url() })
  await bootUnlocked(page, { settings })
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.getByRole('button', { name: '回收站', exact: true })).toBeVisible()
  expect(apiUrl).not.toBe('')
  await page.evaluate(async url => {
    const { codexApi } = await import(/* @vite-ignore */ url)
    const releases: Array<() => void> = []
    for (const method of ['listTrash', 'listRecycled']) {
      const original = codexApi[method]
      codexApi[method] = () => new Promise((resolve, reject) => {
        releases.push(() => original().then(resolve, reject))
      })
    }
    ;(window as any).__finishTrashScan = () => releases.splice(0).forEach(release => release())
  }, apiUrl)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(page.locator('.thr-view')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.thr-sk')).toHaveCount(2)
  await page.evaluate(() => (window as any).__finishTrashScan())
  await expect(page.locator('.empty-title')).toHaveText('回收站是空的')
  await expect(page.locator('.thr-view')).toHaveAttribute('aria-busy', 'false')
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(page.locator('.thr-view')).toHaveAttribute('aria-busy', 'true')
  await expect(page.locator('.empty-title')).toHaveText('回收站是空的')
  await expect(page.locator('.thr-sk')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).__finishTrashScan())
  await expect(page.locator('.thr-view')).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeEnabled()
  await expect(page.locator('.empty-title')).toHaveText('回收站是空的')
})
