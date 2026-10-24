import { test, expect } from '@playwright/test'
import { webApp, selectModule } from '../web-helpers'

const settings = { codex_enabled: 'true', fileshare_enabled: 'true', tunnel_enabled: 'true' }
const notes = [{ title: '工作小记', content_html: '<h2>工作小记</h2><p>接着完成手机端</p>' }]

test.describe('手机工作台', () => {
  test.use({ hasTouch: true, isMobile: true })

  for (const width of [360, 390]) {
    test(`${width}px 顶部全量模块导航、分类筛选与主题`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 })
      const app = await webApp(page, { settings, notes, entries: [
        { name: 'GitHub', url: 'https://github.com', category: '开发' },
        { name: 'Vue 文档', url: 'https://vuejs.org', category: '开发' },
        { name: 'Figma', url: 'https://figma.com', category: '设计' },
      ] })
      await app.login()
      await expect(page.locator('.web-mobile-brand')).toHaveText('Desko')
      const open = page.getByRole('button', { name: '打开模块导航', exact: true })
      await open.tap()
      const drawer = page.getByRole('dialog', { name: '模块', exact: true })
      await expect(drawer).toHaveCSS('width', `${width}px`)
      await expect(drawer.getByRole('link')).toHaveCount(7)
      await expect(drawer.locator('[aria-current="page"]')).toHaveAccessibleName('小记')
      await drawer.getByRole('button', { name: '关闭模块导航' }).tap()
      await expect(open).toBeFocused()
      await selectModule(page, '网址收藏')
      const categories = page.getByRole('navigation', { name: '快捷收藏分类' })
      await categories.getByRole('button', { name: '开发', exact: true }).tap()
      await expect(page.locator('.entry-card')).toHaveCount(2)
      await page.getByPlaceholder('搜索名称或网址…').fill('GitHub')
      await expect(page.locator('.entry-card')).toHaveCount(1)
      await categories.getByRole('button', { name: '设计', exact: true }).tap()
      await expect(page.locator('.entry-card')).toHaveCount(0)
      await page.getByPlaceholder('搜索名称或网址…').fill('')
      await expect(page.locator('.entry-card')).toHaveCount(1)
      await open.tap()
      await expect(drawer.locator('[aria-current="page"]')).toHaveAccessibleName('网址收藏')
      await drawer.getByRole('button', { name: '设置', exact: true }).tap()
      const preferences = page.getByRole('dialog', { name: '浏览器设置' })
      await preferences.getByRole('button', { name: '墨', exact: true }).tap()
      await preferences.getByRole('button', { name: '完成', exact: true }).tap()
      for (const module of ['小记', '文件快捷', '验证码', 'Codex', '局域网传输', '内网穿透']) {
        await selectModule(page, module)
        expect(await page.locator('.app-root').evaluate(el => el.scrollWidth > el.clientWidth + 1), module).toBe(false)
      }
      expect(app.errors).toEqual([])
    })
  }

  test('小记正文下的菜单保留查看、编辑、置顶和复制', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const app = await webApp(page, { notes })
    await app.login()
    const memo = page.locator('.memo').first()
    const more = () => memo.getByRole('button', { name: '更多操作', exact: true }).tap()
    const menu = () => page.getByRole('menu')
    const body = await memo.locator('.memo-body').boundingBox()
    const actions = await memo.locator('.memo-acts').boundingBox()
    expect(actions!.y).toBeGreaterThanOrEqual(body!.y + body!.height)
    await more()
    await menu().getByRole('button', { name: '全屏查看', exact: true }).tap()
    const fullscreen = page.getByRole('dialog', { name: '全屏查看小记' })
    await expect(fullscreen).toBeVisible()
    await page.locator('#note-fullscreen-toolbar').getByRole('button', { name: /退出全屏/ }).tap()
    await more()
    await menu().getByRole('button', { name: '编辑', exact: true }).tap()
    await page.locator('.memo.editing .ProseMirror').fill('手机编辑后的正文')
    await page.getByRole('button', { name: '退出编辑', exact: true }).tap()
    await expect(memo.locator('.memo-body')).toHaveText('手机编辑后的正文')
    await more()
    await menu().getByRole('button', { name: '置顶', exact: true }).tap()
    await expect(memo).toHaveClass(/pinned/)
    await memo.getByRole('button', { name: '复制正文', exact: true }).tap()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('手机编辑后的正文')
    expect(app.errors).toEqual([])
  })

  test('横屏模块列表可滚动，变宽后关闭导航', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    const app = await webApp(page, { settings })
    await app.login()
    await page.getByRole('button', { name: '打开模块导航', exact: true }).tap()
    const drawer = page.getByRole('dialog', { name: '模块', exact: true })
    const body = drawer.locator('.web-drawer-body')
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
    await drawer.getByRole('button', { name: '设置', exact: true }).scrollIntoViewIfNeeded()
    await expect(drawer.getByRole('button', { name: '设置', exact: true })).toBeInViewport()
    await page.setViewportSize({ width: 1200, height: 844 })
    await expect(drawer).toHaveCount(0)
    await expect(page.locator('.sidebar')).toBeVisible()
    expect(app.errors).toEqual([])
  })
})
