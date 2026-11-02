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

test('标签放不下时整组收成一个入口，收起态仍可搜索连续多选', async ({ page }) => {
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
  // 全显或全收：收起态条上只留已选，绝不出现「挑几个 + 更多 N」的半截列表
  await expect(workbar.locator('.wb-tags .wb-tag')).toHaveCount(0)
  // 页签是功能入口，收起标签不能把它裁掉
  await expect(workbar.locator('.workspace-workbar-tabs .wb-tab')).toHaveCount(4)
  await entry.click()
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
  // 已选的两枚常驻条上，且不带视图页签那条下划线
  await expect(workbar.locator('.wb-tags .wb-tag.active')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  await workbar.getByRole('button', { name: /^归档/ }).click()
  await expect(workbar.locator('.wb-tags')).toHaveCount(0)
  await workbar.getByRole('button', { name: /^全部/ }).click()
  // 收起态下未选标签根本不上条，所以判据是「已选清空」而不是「那枚标签变未选中」
  await expect(workbar.locator('.wb-tag.active')).toHaveCount(0)
})

test('标签放得下时整组摊开，不出现收起入口', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootUnlocked(page, {
    notes: [{ title: '三枚标签', content_html: '<p>#工作 #家庭 #阅读</p>' }],
  }, '/notes')
  const workbar = page.locator('.workspace-workbar')
  await expect(workbar.locator('.wb-tags .wb-tag')).toHaveCount(3)
  await expect(workbar.locator('.wb-more')).toHaveCount(0)
  expect(await workbar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
})
