import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
test.describe('导航与布局', () => {
  test('默认路由重定向到 /entries', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page).toHaveURL(/\/entries$/)
  })

  test('侧栏收起/展开与三视图切换', async ({ page }) => {
    await bootUnlocked(page)
    // 默认收起：导航文字不渲染，只剩图标
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)

    await page.locator('.sidebar-toggle').click()
    // 验证码模块默认关着，侧栏只有三个常驻入口
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(3)
    // 侧栏骨架：顶部品牌行 + 导航两块，别无他物
    await expect(page.locator('.sidebar > *')).toHaveCount(2)
    // 常驻三项的顺序钉死：小记打头（收藏/文件紧随），改顺序要连这条一起改
    expect(await page.locator('.sidebar-nav .nav-item').evaluateAll(
      (els) => els.map((el) => el.getAttribute('href')),
    )).toEqual(['/notes', '/entries', '/files'])
    // 标题栏只放模块名（品牌位已移入全高侧栏顶部）
    await expect(page.locator('.titlebar-crumb')).toHaveText('网址收藏')

    // 激活态不铺底：图标轨档那层白块会读成图标的底，重音只给字色。
    // 用当前项（已 active、指针没压着）来量——点过的那条会带 hover 填充，量不到激活态本身
    await expect(page.locator('a.nav-item[href="/entries"]')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('a.nav-item[href="/entries"]')).toHaveCSS('box-shadow', 'none')

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
    await page.locator('.sidebar-toggle').click()
    await expect(page.locator('.sidebar .nav-text')).toHaveCount(0)
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

  test('Ctrl+B 三态循环：图标轨 → 展开 → 收起，收起态恢复钮在标题栏', async ({ page }) => {
    await bootUnlocked(page)
    const width = async () => (await page.locator('.sidebar').boundingBox())?.width ?? 0

    // 缺省落图标轨
    await expect(page.locator('.sidebar')).toHaveClass(/collapsed/)
    await expect.poll(width).toBe(56)

    await page.keyboard.press('Control+b')
    await expect.poll(width).toBe(208)

    await page.keyboard.press('Control+b')
    await expect(page.locator('.sidebar')).toHaveCount(0)
    await expect(page.locator('.sidebar-restore')).toBeVisible()

    await page.locator('.sidebar-restore').click()
    await expect.poll(width).toBe(208)
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
