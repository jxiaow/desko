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
    const surface = (await page.locator('.workspace-surface').boundingBox())!
    const content = (await page.locator('.workspace-body > .main-content').boundingBox())!
    expect(bounds.x).toBe(content.x + content.width)
    expect(bounds.x + bounds.width).toBe(surface.x + surface.width)
    expect(bounds.y).toBe(surface.y)
    expect(bounds.height).toBe(surface.height)
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
  const content = {
    notes: [{ title: '目录检查', content_html: '<p>保留小记目录</p>' }],
    entries: [{ name: '目录检查', url: 'https://example.invalid', category: '工作' }],
  }
  await bootUnlocked(page, content)
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
  await bootUnlocked(restarted, { ...content, settings: saved })
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
  expect(box.y + box.height).toBeLessThanOrEqual(48)
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
  test(`${path} 创建按钮带文字标签，能通过名称定位并使用键盘打开`, async ({ page }) => {
    await bootUnlocked(page, { settings: { mfa_enabled: 'true', codex_enabled: 'true' } }, path)
    const button = page.getByRole('button', { name: label, exact: true }).first()
    await expect(button).toContainText(label)
    await expect(button.locator('svg[data-icon="plus"]')).toBeVisible()
    expect((await button.boundingBox())!.height).toBe(32)
    await button.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.dialog:visible h3')).toContainText(dialog)
  })
}
