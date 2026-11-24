import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { webApp } from '../web-helpers'

const cases = [
  { route: 'entries', action: '收藏第一个网址', dialog: '新增网址收藏' },
  { route: 'files', action: '添加第一个快捷方式', dialog: '添加快捷方式' },
  { route: 'mfa', action: '添加第一个验证码', dialog: '添加验证码' },
  { route: 'codex', action: '添加第一个账号', dialog: '添加 Codex 账号' },
]
for (const width of [800, 1280]) {
  for (const item of cases) {
    test(`${width}px ${item.route} 空页面入口可用且布局完整`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await bootUnlocked(page, { settings: { mfa_enabled: 'true', codex_enabled: 'true' } }, `/${item.route}`)
      const empty = page.locator('.module-empty-state')
      await expect(empty).toBeVisible()
      await expect(page.locator('#workspace-page-toolbar .page-bar, #workspace-page-toolbar .cx-band-controls')).toHaveCount(0)
      await expect(page.locator('.titlebar-count')).toHaveCount(0)
      await expect(empty).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(empty.getByRole('button', { name: item.action, exact: true })).toBeInViewport()
      expect(await empty.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await page.screenshot({ path: `.tmp/empty-design/${item.route}-${width}.png`, animations: 'disabled' })
      await empty.getByRole('button', { name: item.action, exact: true }).click()
      await expect(page.getByRole('dialog').first()).toBeVisible()
      if (item.route !== 'codex') await expect(page.getByRole('dialog').first()).toContainText(item.dialog)
    })
  }
}
test('Codex 各空页说明正确，切换页签保持正常背景', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  for (const [tab, title] of [['会话', '官方 Codex 还没有会话记录'], ['回收站', '回收站是空的']]) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await expect(page.locator('.module-empty-state .empty-title')).toHaveText(title)
    await page.screenshot({ path: `.tmp/empty-design/codex-${tab}.png`, animations: 'disabled' })
  }
})

test('Web 窄屏空小记仍可直接书写，发布后恢复页头工具', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page, { notes: [] })
  await app.login()
  await expect(page.locator('.notes-empty-state')).toBeVisible()
  await expect(page.locator('.workspace-head')).toBeHidden()
  const editor = page.locator('.composer .ProseMirror')
  const [titlebar, editorBox] = await Promise.all([page.locator('.titlebar-page').boundingBox(), editor.boundingBox()])
  expect(editorBox!.y).toBeGreaterThanOrEqual(titlebar!.y + titlebar!.height)
  await editor.fill('窄屏第一条小记')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.memo')).toContainText('窄屏第一条小记')
  await expect(page.locator('#workspace-page-toolbar .search-box')).toBeVisible()
  expect(app.errors).toEqual([])
})

test('Web 窄屏 Codex 空页的页签始终位于标题下方', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await app.login('.module-empty-state')
  const tabs = page.getByRole('navigation', { name: 'Codex 视图' })
  const [titlebar, initialTabs] = await Promise.all([page.locator('.titlebar-page').boundingBox(), tabs.boundingBox()])
  expect(initialTabs!.y).toBeGreaterThanOrEqual(titlebar!.y + titlebar!.height)
  await tabs.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-view .empty-title')).toHaveText('还没有用量记录')
  expect((await tabs.boundingBox())!.y).toBe(initialTabs!.y)
  expect(app.errors).toEqual([])
})
