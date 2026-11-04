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

test('标签筛选常驻一枚下拉入口，面板内可搜索连续多选', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const many = Array.from({ length: 16 }, (_, i) => `标签${i}`)
  await bootUnlocked(page, {
    notes: [{
      title: '标签整理',
      content_html: `<p>${many.map((t) => '#' + t).join(' ')}</p>`,
    }],
  }, '/notes')
  const workbar = page.locator('.workspace-workbar')
  await expect(workbar).toBeVisible()
  const entry = workbar.getByRole('button', { name: /标签筛选/ })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('16')
  // 标签不再以 chip 形式摊在视图页签后面，条上只有这一枚入口
  await expect(workbar.locator('.wb-tag')).toHaveCount(0)
  await expect(workbar.locator('.workspace-workbar-tabs .wb-tab')).toHaveCount(4)
  await entry.click()
  const panel = page.locator('.tag-pop')
  await expect(panel).toBeVisible()
  await expect(entry).toHaveAttribute('aria-expanded', 'true')
  const search = panel.getByRole('textbox', { name: '搜索标签' })
  await expect(search).toBeVisible()
  const tags = panel.locator('.pop-item')
  await expect(tags).toHaveCount(16)
  await tags.nth(0).click()
  await expect(tags.nth(0)).toHaveClass(/\bon\b/)
  await expect(panel).toBeVisible()
  await tags.nth(1).click()
  await expect(tags.nth(1)).toHaveClass(/\bon\b/)
  // 入口计数改为「已选数」，面板不因选中而关闭
  await expect(entry).toContainText('2')
  // 搜索只筛列表，不动已选
  await search.fill('不存在标签')
  await expect(panel.locator('.pop-item')).toHaveCount(0)
  await expect(panel.locator('.tag-pop-empty')).toBeVisible()
  await expect(entry).toContainText('2')
  await search.fill('')
  await expect(tags).toHaveCount(16)
  await expect(panel.locator('.pop-item.on')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(entry).toContainText('2')

  // 归档视图没有标签组；切回「全部」时旧选中已清空
  await workbar.getByRole('button', { name: /^归档/ }).click()
  await expect(workbar.getByRole('button', { name: /标签筛选/ })).toHaveCount(0)
  await workbar.getByRole('button', { name: /^全部/ }).click()
  await expect(entry).toContainText('16')
})

test('宽窗下标签也只用一枚下拉入口，页头不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootUnlocked(page, {
    notes: [{ title: '三枚标签', content_html: '<p>#工作 #家庭 #阅读</p>' }],
  }, '/notes')
  const workbar = page.locator('.workspace-workbar')
  const entry = workbar.getByRole('button', { name: /标签筛选/ })
  await expect(entry).toBeVisible()
  await expect(entry).toContainText('3')
  await expect(workbar.locator('.wb-tag')).toHaveCount(0)
  await entry.click()
  await expect(page.locator('.tag-pop .pop-item')).toHaveCount(3)
  await page.keyboard.press('Escape')
  expect(await workbar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
})

for (const theme of ['paper', 'ink']) {
  test(`${theme} 标签筛选的搜索框和列表均位于弹层内部`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 800, height: 670 })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'true' },
      notes: [{ title: '标签布局', content_html: `<p>${Array.from({ length: 16 }, (_, i) => `#项目进度与工作安排${i}`).join(' ')}</p>` }],
    }, '/notes')
    await page.getByRole('button', { name: /标签筛选/ }).click()
    const panel = page.locator('.popover:has(.tag-pop)')
    await expect(panel).toBeVisible()
    await page.locator('.tag-pop .pop-item').first().click()
    await page.screenshot({ path: testInfo.outputPath('tag-filter.png') })
    const bounds = await panel.evaluate(el => {
      const outer = el.getBoundingClientRect()
      return {
        overflow: el.scrollWidth > el.clientWidth,
        children: [...el.querySelectorAll('.tag-pop-search, .tag-pop-list, .pop-item')].map(child => {
          const r = child.getBoundingClientRect()
          return { left: r.left - outer.left, right: outer.right - r.right }
        }),
      }
    })
    expect(bounds.overflow).toBe(false)
    for (const child of bounds.children) {
      expect(child.left).toBeGreaterThanOrEqual(5)
      expect(child.right).toBeGreaterThanOrEqual(5)
    }
  })
}
