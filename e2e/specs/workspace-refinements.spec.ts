import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

for (const width of [800, 1280]) {
  test(`${width}px 页级筛选不打断正文编辑，宽导航可随时收起`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes: [{ title: '清单', content_html: '<p>待办 #工作</p>', pinned: true }] })
    const workbar = page.locator('.workspace-workbar')
    const editor = page.locator('.composer .ProseMirror')
    await expect(workbar).toBeVisible()
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await editor.click()
    await editor.fill('切换筛选时继续写作')
    await workbar.getByRole('button', { name: /置顶/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
    await expect(editor).toHaveText('切换筛选时继续写作')
    const expanded = (await page.locator('.workspace-main').boundingBox())!.width
    if (width >= 900) {
      await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
      await expect(editor).toHaveText('切换筛选时继续写作')
      await expect.poll(async () => (await page.locator('.workspace-main').boundingBox())!.width).toBeGreaterThan(expanded)
    } else {
      await expect(page.locator('.sidebar')).toHaveCSS('width', '56px')
      await expect(page.locator('.titlebar-outer .sidebar-toggle')).toBeHidden()
    }
    await page.locator('.composer button.btn-primary').click()
    await expect.poll(async () => (await e2e.snapshot(page)).notes.length).toBe(2)
    if (width >= 900) await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  })
}

test('侧栏状态跨模块与重启保持，桌面不再出现辅助目录', async ({ page, context }) => {
  const content = {
    notes: [{ title: '目录检查', content_html: '<p>保留小记目录</p>' }],
    entries: [{ name: '目录检查', url: 'https://example.invalid', category: '工作' }],
  }
  await bootUnlocked(page, content)
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await page.getByRole('link', { name: '网址收藏', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '56px')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('link', { name: '小记', exact: true }).click()
  await expect(page.locator('.workspace-workbar')).toBeVisible()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  const saved = (await e2e.snapshot(page)).settings
  const restarted = await context.newPage()
  await bootUnlocked(restarted, { ...content, settings: saved })
  await expect(restarted.locator('.sidebar')).toHaveCSS('width', '56px')
  await expect(restarted.locator('.workspace-directory')).toBeHidden()
  await restarted.close()
})

test('左上角 Desko 菜单可进入档案和关于，Esc 只关闭菜单', async ({ page }) => {
  await bootUnlocked(page)
  const brand = page.getByRole('button', { name: 'Desko 菜单', exact: true })
  const box = (await brand.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(148)
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
