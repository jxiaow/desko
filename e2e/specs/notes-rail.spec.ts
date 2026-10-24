import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

for (const width of [1280, 800]) {
  test(`小记目录 ${width}px：默认收起，窄窗选择后关闭，宽窗保持展开`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await bootUnlocked(page, { notes: [{ title: '待办', content_html: '<p>待办 #工作</p>', pinned: true }] }, '/notes')
    const panel = page.locator('.workspace-directory')
    const toggle = page.locator('#workspace-directory-toggle')
    await expect(panel).toBeHidden()
    await toggle.click()
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: /置顶/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
    if (width < 1100) {
      await expect(panel).toBeHidden()
      await toggle.click()
      await page.locator('.search-box input').click()
      await expect(panel).toBeHidden()
    } else {
      await page.locator('.search-box input').fill('待办')
      await expect(panel).toBeVisible()
      await toggle.click()
      await expect(panel).toBeHidden()
    }
  })
}

test('固定小记目录独立于收藏目录，跨页面和重启恢复，缩放不改变偏好', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const content = {
    notes: [{ title: '目录检查', content_html: '<p>目录检查 #工作</p>' }],
    entries: [{ name: '目录检查', url: 'https://example.invalid', category: '工作' }],
  }
  await bootUnlocked(page, content, '/notes')
  await page.locator('#workspace-directory-toggle').click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  await page.locator('a.nav-item[href="/entries"]').click()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.locator('a.nav-item[href="/notes"]').click()
  await expect(page.locator('.workspace-directory')).toBeVisible()
  await page.setViewportSize({ width: 800, height: 800 })
  await expect(page.locator('.directory-docked .workspace-directory')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('.directory-docked .workspace-directory')).toBeVisible()
  await expect.poll(async () => (await e2e.snapshot(page)).settings.workspace_directory_open).toBe('{"notes":true}')
  const saved = (await e2e.snapshot(page)).settings
  const restarted = await context.newPage()
  await bootUnlocked(restarted, { ...content, settings: saved }, '/notes')
  await expect(restarted.locator('.workspace-directory')).toBeVisible()
  await restarted.close()
})
