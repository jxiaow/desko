import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
test.describe('导航与布局', () => {
  test('默认路由重定向到 /notes（启动即选中小记）', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page).toHaveURL(/\/notes$/)
  })

  test('图标导航常驻，模块切换更新外层标题并保留业务数据', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)
    await expect(page.locator('.sidebar-toggle')).toHaveCount(0)
    expect(await page.locator('.sidebar-nav .nav-item').evaluateAll(
      els => els.map(el => el.getAttribute('href')),
    )).toEqual(['/notes', '/entries', '/files'])
    await expect(page.locator('a.nav-item[href="/notes"]')).toHaveClass(/active/)
    await expect(page.locator('a.nav-item[href="/notes"]')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    expect(await e2e.count(page, 'list_notes')).toBe(1)
    for (const [path, title] of [['entries', '网址收藏'], ['files', '文件快捷'], ['notes', '小记']]) {
      await page.locator(`a.nav-item[href="/${path}"]`).click()
      await expect(page).toHaveURL(new RegExp(`/${path}$`))
      await expect(page.locator('.titlebar-outer .titlebar-brand')).toContainText(title)
      await expect(page.locator('.sidebar')).toBeVisible()
      if (path === 'files') await expect(page.locator('.empty-title')).toHaveText('暂无快捷方式')
    }
    expect(await e2e.count(page, 'list_file_shortcuts')).toBe(1)
  })

  test('失焦冻结 hover、重新获得焦点当场解冻：回来第一下点击不该被遮罩吞', async ({ page }) => {
    await bootUnlocked(page)
    /** 遮罩是整窗 fixed 的 .hover-blocker，压在最上层时命中的就是它，按钮收不到这一下 */
    const hit = () =>
      page.evaluate(() => {
        const btn = document.querySelector('.titlebar-btn.tb-util')!
        const r = btn.getBoundingClientRect()
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)!
        return el === btn || btn.contains(el) ? 'button' : (el.getAttribute('class') ?? el.tagName)
      })

    await e2e.emitEvent(page, 'window-focus', false)
    await expect(page.locator('.hover-blocker')).toHaveCount(1)
    expect(await hit()).toBe('hover-blocker')

    // 真机恢复时 WebView2 只在旧坐标重放一次 pointermove，按坐标差那条规则解不开，
    // 只能靠焦点事件当场解除
    await e2e.emitEvent(page, 'window-focus', true)
    await expect(page.locator('.hover-blocker')).toHaveCount(0)
    expect(await hit()).toBe('button')
  })

  test('Ctrl+B 只切换有目录的页面，模块图标保持可用', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await page.locator('.titlebar-brand').click()
    await page.keyboard.press('Control+b')
    await expect(page.locator('.workspace-directory')).toBeVisible()
    await page.keyboard.press('Control+b')
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await page.locator('a.nav-item[href="/files"]').click()
    await page.keyboard.press('Control+b')
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-restore')).toHaveCount(0)
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
