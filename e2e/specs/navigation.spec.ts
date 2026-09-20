import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, tipButton } from '../helpers'
test.describe('导航与布局', () => {
  test('默认路由重定向到 /entries', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page).toHaveURL(/\/entries$/)
  })

  test('侧栏收起/展开与三视图切换', async ({ page }) => {
    await bootUnlocked(page)
    // 默认收起：导航文字不渲染，只剩图标
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)

    await tipButton(page, '切换侧边栏').click()
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(3)
    // 侧栏只剩导航：版本/加密说明页脚已去掉
    await expect(page.locator('.sidebar > *')).toHaveCount(1)
    await expect(page.locator('.titlebar-crumb')).toHaveText('网址收藏')

    // 小记
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('.notes-page')).toBeVisible()
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveClass(/active/)
    // 面包屑跟着路由走，标题栏不再重复放一份导航
    await expect(page.locator('.titlebar-crumb')).toHaveText('小记')
    expect(await e2e.count(page, 'list_notes')).toBe(1)

    // 文件快捷（路由切换触发 fetchShortcuts）；未 seed 数据时渲染空态
    await page.locator('a.nav-item[href="/files"]').click()
    await expect(page).toHaveURL(/\/files$/)
    await expect(page.locator('.empty-title')).toHaveText('暂无快捷方式')
    expect(await e2e.count(page, 'list_file_shortcuts')).toBe(1)

    // 回条目
    await page.locator('a.nav-item[href="/entries"]').click()
    await expect(page).toHaveURL(/\/entries$/)
    await expect(page.locator('.page-bar')).toBeVisible()

    // 收起侧栏
    await tipButton(page, '切换侧边栏').click()
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)
  })

  test('锁定再解锁后停留在原路由', async ({ page }) => {
    await bootUnlocked(page)
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(page.locator('.notes-page')).toBeVisible()

    await page.locator('button[title="锁定"]').click()
    await expect(page.locator('.unlock-input')).toBeVisible()
    await expect(page).toHaveURL(/\/notes$/)

    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.notes-page')).toBeVisible()
    await expect(page).toHaveURL(/\/notes$/)
  })
})
