import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const width of [1280, 800]) {
  test(`小记页级工作栏 ${width}px：视图常驻且不产生横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await bootUnlocked(page, {
      notes: [
        { title: '待办', content_html: '<p>待办 #工作</p>', pinned: true },
        { title: '归档项', content_html: '<p>旧内容</p>', archived: true },
      ],
    }, '/notes')
    const workbar = page.locator('.workspace-workbar')
    await expect(workbar).toBeVisible()
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await expect(page.locator('#workspace-directory-toggle')).toHaveCount(0)
    for (const label of ['全部', '置顶', '收藏', '归档']) {
      await expect(workbar.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    expect(await workbar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    await workbar.getByRole('button', { name: /^置顶/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
    await workbar.getByRole('button', { name: /^归档/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
    await expect(page.locator('.composer')).toHaveCount(0)
    await workbar.getByRole('button', { name: /^全部/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
  })
}

test('标签更多面板支持连续多选，归档视图清空标签筛选', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootUnlocked(page, {
    notes: [{
      title: '标签整理',
      content_html: '<p>#工作 #家庭 #阅读 #项目 #灵感 #设备 #旅行 #健康</p>',
    }],
  }, '/notes')
  const workbar = page.locator('.workspace-workbar')
  await expect(workbar).toBeVisible()
  const more = workbar.getByRole('button', { name: /更多标签/ })
  await expect(more).toBeVisible()
  await more.click()
  const panel = page.locator('.tag-pop')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('textbox', { name: '搜索标签' })).toBeVisible()
  const tags = panel.locator('.pop-item')
  const firstTag = (await tags.first().locator('.tag-pop-name').innerText()).replace('#', '')
  await tags.first().click()
  await expect(workbar.getByRole('button', { name: new RegExp(firstTag) })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).toBeVisible()
  const secondTag = (await tags.first().locator('.tag-pop-name').innerText()).replace('#', '')
  await tags.first().click()
  await expect(workbar.getByRole('button', { name: new RegExp(secondTag) })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await workbar.getByRole('button', { name: /^归档/ }).click()
  await expect(workbar.locator('.wb-tags')).toHaveCount(0)
  await workbar.getByRole('button', { name: /^全部/ }).click()
  await expect(workbar.getByRole('button', { name: /工作/ })).not.toHaveAttribute('aria-pressed', 'true')
})
