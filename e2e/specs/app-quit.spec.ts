import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, startApp } from '../helpers'

async function requestQuit(page: Page) {
  await expect.poll(() => e2e.hasListener(page, 'tray-quit')).toBe(true)
  await e2e.emitEvent(page, 'tray-quit')
  const dialog = page.getByRole('dialog', { name: '退出 Desko？', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.locator('.quit-overlay')).toHaveCSS('opacity', '1')
  return dialog
}

test('托盘重复请求只显示一个退出框，取消不退出且可再次打开', async ({ page }) => {
  await bootUnlocked(page)
  const dialog = await requestQuit(page)
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused()
  await e2e.emitEvent(page, 'tray-quit')
  await expect(page.locator('.quit-dialog')).toHaveCount(1)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await e2e.count(page, 'quit_app')).toBe(0)
  await requestQuit(page)
  await dialog.getByRole('button', { name: '确认退出', exact: true }).click()
  await expect.poll(() => e2e.count(page, 'quit_app')).toBe(1)
})

test('Esc 与关闭按钮均取消，Tab 焦点保持在退出框内', async ({ page }) => {
  await bootUnlocked(page)
  const dialog = await requestQuit(page)
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: '确认退出', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await requestQuit(page)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await e2e.count(page, 'quit_app')).toBe(0)
})

for (const initialized of [true, false]) {
  test(`${initialized ? '锁定' : '首次设置'}界面也能确认退出`, async ({ page }) => {
    await startApp(page, { config: { initialized } })
    const dialog = await requestQuit(page)
    await dialog.getByRole('button', { name: '确认退出', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'quit_app')).toBe(1)
    expect(await e2e.count(page, 'update_note')).toBe(0)
  })
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 退出框使用当前主题且在窄窗口完整显示`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1040, height: 670 })
    await bootUnlocked(page, { settings: { theme } })
    const dialog = await requestQuit(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    expect(await dialog.evaluate(el => getComputedStyle(el).borderRadius)).toBe('14px')
    await page.screenshot({ path: testInfo.outputPath(`quit-${theme}.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 360, height: 600 })
    const box = await dialog.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(16)
    expect(box!.x + box!.width).toBeLessThanOrEqual(344)
    await expect(dialog.getByRole('button', { name: '确认退出', exact: true })).toBeInViewport()
  })
}
