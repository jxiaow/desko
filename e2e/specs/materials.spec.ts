import { test, expect } from '@playwright/test'
import { bootUnlocked, startApp, e2e, E2E_PASSWORD, openSettings } from '../helpers'

test.describe('背景材质', () => {
  test('开关同时改变画布、导航和浮层，输入区域保持实底', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    const toggle = control.getByRole('switch')

    const background = (selector: string) => page.locator(selector).evaluate((el) => {
      const style = getComputedStyle(el)
      return { image: style.backgroundImage, color: style.backgroundColor }
    })

    await expect(toggle).toBeChecked()
    expect((await background('.app-root')).image).toContain('radial-gradient')
    expect((await background('.sidebar')).color).toMatch(/0\.18\)$/)
    expect((await background('.settings-dialog')).image).toContain('radial-gradient')
    expect((await background('.settings-nav')).color).toMatch(/0\.18\)$/)

    await control.locator('label.switch').click()
    await expect(toggle).toBeEnabled()
    expect((await e2e.snapshot(page)).settings.background_atmosphere).toBe('false')
    expect((await background('.app-root')).image).toBe('none')
    expect((await background('.settings-dialog')).image).toBe('none')
    expect((await background('.sidebar')).color).not.toMatch(/rgba/)

    await control.locator('label.switch').click()
    await expect(toggle).toBeEnabled()
    expect((await e2e.snapshot(page)).settings.background_atmosphere).toBe('true')
    expect((await background('.settings-dialog')).image).toContain('radial-gradient')

    await dialog.locator('.nav-tab', { hasText: '安全' }).click()
    await dialog.locator('.setting-item', { hasText: '修改主密码' }).click()
    await expect(page.locator('.dialog')).toBeVisible()
    await expect(page.locator('.dialog input').first()).toHaveCSS('background-image', 'none')
  })

  test('基础对话框自动继承材质，无需登记新的页面类名', async ({ page }) => {
    await bootUnlocked(page)
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.className = 'dialog new-material-consumer'
      el.textContent = '新对话框'
      document.body.append(el)
    })
    const surface = page.locator('.new-material-consumer')
    const image = () => surface.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(await image()).toContain('radial-gradient')

    const dialog = await openSettings(page)
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await expect(surface).toHaveCSS('background-image', 'none')
  })

  test('启动恢复关闭状态，锁屏装饰与动效遵循开关及系统偏好', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await startApp(page, { config: { settings: { background_atmosphere: 'false' } } })
    await expect(page.locator('.unlock-input')).toBeVisible()
    await expect(page.locator('.unlock-page')).toHaveCSS('background-image', 'none')
    for (const layer of ['.unlock-bg', '.lock-aura', '.lock-grain']) {
      await expect(page.locator(layer)).toBeHidden()
    }
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-name', 'none')
    await page.locator('.unlock-input').fill(E2E_PASSWORD)
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.app-layout')).toBeVisible()

    const dialog = await openSettings(page)
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    await expect(control.getByRole('switch')).not.toBeChecked()
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await page.keyboard.press('Escape')
    await page.locator('button[title="锁定"], button[data-tip="锁定"]').click()
    await expect(page.locator('.unlock-page')).toHaveCSS('background-image', /linear-gradient/)
    for (const layer of ['.unlock-bg', '.lock-aura', '.lock-grain']) {
      await expect(page.locator(layer)).toBeVisible()
    }
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-name', /aura-a/)
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-duration', '28s')

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-name', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-name', /aura-a/)

    // 同一会话里关闭后再次锁定，画布与全部装饰都恢复关闭状态。
    await page.locator('.unlock-input').fill(E2E_PASSWORD)
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.app-layout')).toBeVisible()
    const reopened = await openSettings(page)
    const restoredControl = reopened.locator('.setting-item', { hasText: '背景氛围' })
    await expect(restoredControl.getByRole('switch')).toBeChecked()
    await restoredControl.locator('label.switch').click()
    await expect(restoredControl.getByRole('switch')).not.toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'off')
    await page.keyboard.press('Escape')
    await page.locator('button[title="锁定"], button[data-tip="锁定"]').click()
    await expect(page.locator('.unlock-page')).toHaveCSS('background-image', 'none')
    for (const layer of ['.unlock-bg', '.lock-aura', '.lock-grain']) {
      await expect(page.locator(layer)).toBeHidden()
    }
    await expect(page.locator('.lock-aura-blob.a')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.unlock-input')).toBeVisible()
  })
})
