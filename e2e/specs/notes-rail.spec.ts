import { test, expect } from '@playwright/test'
import { bootUnlocked, E2E_PASSWORD } from '../helpers'

for (const width of [1280, 760]) {
  test(`小记侧栏 ${width}px：未固定点外部收起，固定后只手动收起`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await bootUnlocked(page, {}, '/notes')
    const open = page.locator('.notes-page button[aria-label="展开侧栏"]')
    const close = page.locator('.notes-page button[aria-label="收起侧栏"]')
    const outside = page.locator('.notes-page .search-box input')
    const rail = page.locator('.rail')
    await open.click()
    await expect(rail).toBeVisible()
    await outside.click()
    await expect(rail).toHaveCount(0)

    await open.click()
    await page.getByRole('button', { name: '固定侧栏', exact: true }).click()
    await expect(page.getByRole('button', { name: '取消固定侧栏', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await outside.click()
    await expect(rail).toBeVisible()
    await page.locator('.rail .rail-item', { hasText: '收藏' }).click()
    await expect(rail).toBeVisible()
    await close.click()
    await expect(rail).toHaveCount(0)

    await open.click()
    await outside.click()
    await expect(rail).toBeVisible()
    await page.getByRole('button', { name: '取消固定侧栏', exact: true }).click()
    await outside.click()
    await expect(rail).toHaveCount(0)
  })
}

test('小记侧栏固定状态跨页面与重启保留，窗口变窄仍展开', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await bootUnlocked(page, {}, '/notes')
  await page.locator('.notes-page button[aria-label="展开侧栏"]').click()
  await page.getByRole('button', { name: '固定侧栏', exact: true }).click()
  await page.locator('a.nav-item[href="/entries"]').click()
  await expect(page).toHaveURL(/\/entries$/)
  await page.locator('a.nav-item[href="/notes"]').click()
  await expect(page.locator('.rail')).toBeVisible()
  await page.setViewportSize({ width: 760, height: 800 })
  await expect(page.locator('.rail.overlay')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.locator('.rail:not(.overlay)')).toBeVisible()

  await page.reload()
  await page.locator('.unlock-input').fill(E2E_PASSWORD)
  await page.locator('.unlock-btn').click()
  await page.locator('.notes-page button[aria-label="展开侧栏"]').click()
  await expect(page.getByRole('button', { name: '取消固定侧栏', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.notes-page .search-box input').click()
  await expect(page.locator('.rail')).toBeVisible()
})
