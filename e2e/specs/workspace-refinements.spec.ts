import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

for (const width of [800, 1280]) {
  test(`${width}px 辅助侧栏未固定可收起，固定后不打断正文编辑且手动关闭保留固定状态`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes: [{ title: '清单', content_html: '<p>待办 #工作</p>', pinned: true }] })
    const panel = page.locator('.workspace-directory')
    const toggle = page.locator('#workspace-directory-toggle')
    await toggle.click()
    const bounds = (await panel.boundingBox())!
    const body = (await page.locator('.workspace-body').boundingBox())!
    const content = (await page.locator('.workspace-body > .main-content').boundingBox())!
    expect(bounds.x).toBe(content.x + content.width)
    expect(bounds.x + bounds.width).toBe(body.x + body.width)
    expect(bounds.y).toBe(body.y)
    expect(bounds.y + bounds.height).toBe(body.y + body.height)
    await expect(page.locator('.workspace-directory-backdrop')).toHaveCount(0)
    await panel.getByRole('button', { name: '固定目录', exact: true }).click()
    await expect(panel.getByRole('button', { name: '取消固定目录', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const editor = page.locator('.composer .ProseMirror')
    await editor.click()
    await editor.fill('固定侧栏时继续写作')
    await page.locator('.page-bar .search-box input').click()
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
    await expect(page.locator('.workspace-directory-backdrop')).toHaveCount(0)
    await panel.getByRole('button', { name: /置顶/ }).click()
    await expect(panel).toBeVisible()
    await expect(editor).toHaveText('固定侧栏时继续写作')
    await page.locator('.composer button.btn-primary').click()
    await expect.poll(async () => (await e2e.snapshot(page)).notes.length).toBe(2)
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '关闭辅助侧栏', exact: true }).click()
    await expect(panel).toBeHidden()
    await toggle.click()
    await expect(panel.getByRole('button', { name: '取消固定目录', exact: true })).toBeVisible()
    await panel.getByRole('button', { name: '取消固定目录', exact: true }).click()
    await page.locator('.page-bar .search-box input').click()
    await expect(panel).toBeHidden()
  })
}

test('固定状态按模块独立保存，重启恢复并能取消固定', async ({ page, context }) => {
  await bootUnlocked(page)
  await page.locator('#workspace-directory-toggle').click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  await page.getByRole('link', { name: '网址收藏', exact: true }).click()
  await page.locator('#workspace-directory-toggle').click()
  await expect(page.getByRole('button', { name: '固定目录', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('link', { name: '小记', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消固定目录', exact: true })).toBeVisible()
  await expect.poll(async () => (await e2e.snapshot(page)).settings.workspace_directory_pinned).toBe('{"notes":true}')
  const saved = (await e2e.snapshot(page)).settings
  const restarted = await context.newPage()
  await bootUnlocked(restarted, { settings: saved })
  await expect(restarted.locator('.workspace-directory')).toBeVisible()
  await restarted.getByRole('button', { name: '取消固定目录', exact: true }).click()
  await expect.poll(async () => (await e2e.snapshot(restarted)).settings.workspace_directory_pinned).toBe('{"notes":false}')
  await restarted.close()
})

test('左上角 Desko 菜单可进入档案和关于，Esc 只关闭菜单', async ({ page }) => {
  await bootUnlocked(page)
  const brand = page.getByRole('button', { name: 'Desko 菜单', exact: true })
  const box = (await brand.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(56)
  expect(box.y + box.height).toBeLessThanOrEqual(42)
  await brand.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  for (const [entry, tab] of [['档案管理', '档案'], ['关于 Desko', '关于']]) {
    await brand.click()
    await page.getByRole('menuitem', { name: entry, exact: true }).click()
    await expect(page.locator('.settings-dialog .nav-tab.on')).toHaveText(tab)
    await page.keyboard.press('Escape')
  }
})

for (const [path, label, dialog] of [
  ['/entries', '新增条目', '新增网址收藏'],
  ['/files', '添加快捷方式', '添加快捷方式'],
  ['/mfa', '新增验证码', '添加验证码'],
  ['/codex', '添加账号', '添加 Codex 账号'],
]) {
  test(`${path} 创建按钮只有图标，仍能通过名称定位并使用键盘打开`, async ({ page }) => {
    await bootUnlocked(page, { settings: { mfa_enabled: 'true', codex_enabled: 'true' } }, path)
    const button = page.getByRole('button', { name: label, exact: true }).first()
    await expect(button).toHaveText('')
    expect((await button.boundingBox())!.width).toBe(28)
    const bounds = (await button.boundingBox())!
    const icon = (await button.locator('svg').boundingBox())!
    expect(Math.abs(icon.x + icon.width / 2 - bounds.x - bounds.width / 2), '加号水平居中').toBeLessThanOrEqual(.5)
    expect(Math.abs(icon.y + icon.height / 2 - bounds.y - bounds.height / 2), '加号垂直居中').toBeLessThanOrEqual(.5)
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.dialog:visible h3')).toContainText(dialog)
  })
}
