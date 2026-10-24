import { test, expect } from '@playwright/test'
import { webApp, selectModule } from '../web-helpers'

const settings = { codex_enabled: 'true', fileshare_enabled: 'true', tunnel_enabled: 'true', background_atmosphere: 'false' }

for (const width of [1100, 1440, 1920]) {
  test(`${width}px 桌面 Web 有名称的模块导航、搜索与浏览器设置`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const app = await webApp(page, { settings, entries: [
      { name: 'GitHub', url: 'https://github.com', category: '开发' },
      { name: 'Figma', url: 'https://figma.com', category: '设计' },
    ] })
    await app.login()
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toHaveCSS('width', '216px')
    await expect(sidebar.getByRole('group', { name: '日常工具', exact: true }).getByRole('link')).toHaveCount(4)
    await expect(sidebar.getByRole('group', { name: '开发与连接', exact: true }).getByRole('link')).toHaveCount(3)
    await expect(page.locator('.titlebar-wordmark')).toHaveText('Desko')
    await expect(page.locator('.titlebar-wordmark')).toBeVisible()
    await expect(page.locator('.titlebar-outer')).toHaveCSS('height', '64px')
    await expect(sidebar.locator('[aria-current="page"]')).toHaveAccessibleName('小记')
    const heading = await page.locator('.titlebar-left').boundingBox()
    const composer = await page.locator('.composer').boundingBox()
    expect(Math.abs(heading!.x - composer!.x)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Desko 菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '模块管理', exact: true }).click()
    const modulePreferences = page.getByRole('dialog', { name: '浏览器设置' })
    await expect(modulePreferences.getByRole('switch', { name: '小记', exact: true })).toBeChecked()
    await modulePreferences.getByRole('button', { name: '完成', exact: true }).click()
    for (const module of ['网址收藏', '文件快捷', '验证码', 'Codex', '局域网传输', '内网穿透', '小记']) {
      await selectModule(page, module)
      await expect(sidebar.getByRole('link', { name: module, exact: true }).locator('.nav-text')).toBeVisible()
      expect(await page.locator('.app-root').evaluate(el => el.scrollWidth > el.clientWidth + 1), module).toBe(false)
    }
    await selectModule(page, '网址收藏')
    await page.getByPlaceholder('搜索名称或网址…').fill('GitHub')
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(page.locator('.entry-card')).toContainText('GitHub')
    await sidebar.getByRole('button', { name: '设置', exact: true }).click()
    const preferences = page.getByRole('dialog', { name: '浏览器设置' })
    await preferences.getByRole('button', { name: '墨', exact: true }).click()
    await preferences.getByRole('button', { name: '完成', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink')
    await expect(sidebar.getByRole('button', { name: '退出浏览器访问', exact: true })).toBeVisible()
    expect(app.errors).toEqual([])
  })
}

test('桌面 Web 分组跟随模块启停，退出仍走真实会话清理', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const app = await webApp(page, { settings })
  await app.login()
  const sidebar = page.locator('.sidebar')
  for (const id of ['notes', 'entries', 'files', 'mfa']) await app.desktopModuleChange(id, false)
  await expect(sidebar.getByRole('group', { name: '日常工具', exact: true })).toHaveCount(0)
  await expect(sidebar.getByRole('link')).toHaveCount(3)
  await app.desktopModuleChange('notes', true)
  await expect(sidebar.getByRole('group', { name: '日常工具', exact: true }).getByRole('link')).toHaveCount(1)
  await selectModule(page, '小记')
  await sidebar.getByRole('button', { name: '退出浏览器访问', exact: true }).click()
  await expect(page.locator('.unlock-input')).toBeVisible()
  await expect(sidebar).toHaveCount(0)
  await expect(page.locator('.memo')).toHaveCount(0)
  expect(app.errors).toEqual([])
})

test('1040px 浏览器使用紧凑轨，调整到宽屏后显示模块名称', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 844 })
  const app = await webApp(page, { settings })
  await app.login()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '56px')
  await expect(page.locator('.sidebar .nav-text').first()).toBeHidden()
  await expect(page.locator('.titlebar-lock')).toBeVisible()
  await expect(page.locator('.web-sidebar-logout')).toBeHidden()
  await page.setViewportSize({ width: 1280, height: 844 })
  await expect(page.locator('.sidebar')).toHaveCSS('width', '216px')
  await expect(page.locator('.sidebar .nav-text').first()).toBeVisible()
  await expect(page.locator('.titlebar-lock')).toBeHidden()
  await expect(page.locator('.web-sidebar-logout')).toBeVisible()
  expect(app.errors).toEqual([])
})

test('独立 Codex Web 保持紧凑对话布局', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const app = await webApp(page, { settings }, '/codex', 'codex')
  await app.login('.codex-dialog')
  await expect(page.locator('.sidebar')).toHaveCSS('width', '56px')
  await expect(page.locator('.titlebar-outer')).toHaveCSS('height', '48px')
  await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)
  await page.getByRole('textbox', { name: '服务器工作目录', exact: true }).fill('C:\\Code\\fixture')
  await page.getByRole('button', { name: '连接工作目录', exact: true }).click()
  await expect(page.locator('.dialog-composer')).toBeVisible()
  expect(app.errors).toEqual([])
})
