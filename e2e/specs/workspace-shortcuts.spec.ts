import { test, expect } from '@playwright/test'
import { bootUnlocked, openSettings } from '../helpers'

for (const path of ['/notes', '/entries', '/files']) {
  test(`${path} 的搜索快捷键不抢设置弹窗焦点，关闭弹窗后恢复`, async ({ page }) => {
    // 三页的搜索框都挂在「有内容」后面，空库时 Ctrl+K 无处可聚焦
    await bootUnlocked(page, {
      notes: [{ title: '种子', content_html: '<p>正文</p>' }],
      entries: [{ name: '示例收藏', url: 'https://example.com', password: '' }],
      fileShortcuts: [{ name: 'demo.txt', path: 'C:/Work/demo.txt', shortcut_type: 'file' }],
    }, path)
    const dialog = await openSettings(page)
    const close = dialog.locator('.dialog-close')
    await close.focus()
    await page.keyboard.press('Control+k')
    await expect(close).toBeFocused()
    await page.keyboard.press('Control+b')
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.keyboard.press('Control+k')
    await expect(page.locator('.page-bar .search-box input')).toBeFocused()
  })
}

test('添加文件的 Ctrl+Enter 仍可提交，搜索快捷键不把输入移到背景页', async ({ page }) => {
  await bootUnlocked(page, {}, '/files')
  await page.locator('.page-bar .btn-primary').click()
  const dialog = page.getByRole('dialog', { name: '添加快捷方式', exact: true })
  const name = dialog.getByPlaceholder('快捷方式名称')
  await name.fill('键盘创建')
  await page.keyboard.press('Control+k')
  await expect(name).toBeFocused()
  await dialog.getByPlaceholder('文件或文件夹路径').fill('C:/demo/project')
  await page.keyboard.press('Control+Enter')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.shortcut-row')).toContainText('键盘创建')
})
