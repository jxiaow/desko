import { test, expect, type Locator } from '@playwright/test'
import { bootUnlocked, startApp, e2e, E2E_PASSWORD, openSettings } from '../helpers'
import { lab } from '../../scripts/lib/theme-tokens.mjs'

async function dialogPaint(dialog: Locator) {
  const png = await dialog.page().screenshot({ animations: 'disabled' })
  return dialog.evaluate(async (element, base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    const rect = element.getBoundingClientRect()
    const pixels = [.12, .88].flatMap(x => [8, rect.height - 8].map(y =>
      [...context.getImageData(Math.round(rect.x + rect.width * x), Math.round(rect.y + y), 1, 1).data].slice(0, 3),
    ))
    const inputs = [...element.querySelectorAll<HTMLInputElement>('input[type="text"],input[type="password"],textarea')]
      .filter(input => input.checkVisibility()).map(input => {
        const style = getComputedStyle(input)
        return { image: style.backgroundImage, color: style.backgroundColor }
      })
    return { pixels, inputs }
  }, png.toString('base64'))
}

for (const theme of ['paper', 'ink']) for (const width of [1040, 1920]) {
  test(`${theme} ${width}px 的表单、设置和小弹窗均有局部柔光，输入区域保持实底`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1040 ? 670 : 1080 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let themeUrl = ''
    page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url() })
    await bootUnlocked(page, { settings: { theme, accent: 'ink', background_atmosphere: 'true' } }, '/entries')

    async function check(dialog: Locator) {
      await expect(dialog).toBeVisible()
      const results = []
      for (const on of [false, true]) {
        await page.evaluate(async ([url, on]) => (await import(/* @vite-ignore */ url)).chooseBackgroundAtmosphere(on), [themeUrl, on] as const)
        await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
        if (!on) await expect(dialog).toHaveCSS('background-image', 'none')
        results.push(await dialogPaint(dialog))
      }
      const change = (index: number) => {
        const flat = lab(results[0].pixels[index]), glow = lab(results[1].pixels[index])
        return Math.hypot(flat.L - glow.L, flat.a - glow.a, flat.b - glow.b)
      }
      expect(change(0), '弹窗左上主光实际可见').toBeGreaterThan(1.5)
      expect(change(3), '弹窗右下辅光实际可见').toBeGreaterThan(1)
      expect(results[1].inputs).toEqual(results[0].inputs)
      for (const input of results[1].inputs) expect(input.image).toBe('none')
    }

    await page.getByRole('button', { name: '新增条目', exact: true }).click()
    await check(page.locator('.entry-form-dialog'))
    await page.locator('.entry-form-dialog .dialog-close').click()
    const settings = await openSettings(page)
    await check(settings)
    await settings.locator('.nav-tab', { hasText: '安全' }).click()
    await settings.locator('.setting-item', { hasText: '修改主密码' }).click()
    await check(page.locator('.masterpw-dialog'))
  })
}

test.describe('背景材质', () => {
  test('开关同时改变画布、浮层与图标轨的光，轨道与输入区域保持实底', async ({ page }) => {
    await bootUnlocked(page, { settings: { background_atmosphere: 'true' } })
    const dialog = await openSettings(page)
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    const toggle = control.getByRole('switch')

    const background = (selector: string) => page.locator(selector).evaluate((el) => {
      const style = getComputedStyle(el)
      return { image: style.backgroundImage, color: style.backgroundColor }
    })

    await expect(toggle).toBeChecked()
    // 主光与辅光分布在留白两端，卡片和输入区域继续保持实底。
    expect((await background('.app-root')).image).toContain('radial-gradient')
    const sidebar = await background('.sidebar')
    // 图标轨、Logo 格与画布共用底色和光场。
    expect(sidebar.image).toContain('radial-gradient')
    expect(sidebar.color).not.toMatch(/rgba|transparent|\//)
    expect(sidebar).toEqual(await background('.app-root'))
    expect(await background('.titlebar-brandcell')).toEqual(sidebar)
    expect((await background('.settings-dialog')).image).toContain('radial-gradient')
    expect((await background('.settings-nav')).color).toMatch(/rgba|\/\s*0\./)

    await control.locator('label.switch').click()
    await expect(toggle).toBeEnabled()
    expect((await e2e.snapshot(page)).settings.background_atmosphere).toBe('false')
    expect((await background('.app-root')).image).toBe('none')
    expect((await background('.settings-dialog')).image).toBe('none')
    // 关闭氛围后，导航轨和画布一起恢复纯色。
    expect((await background('.sidebar')).image).toBe('none')
    expect((await background('.sidebar')).color).toBe(sidebar.color)

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
    await bootUnlocked(page, { settings: { background_atmosphere: 'true' } })
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

  test('启动恢复关闭状态，锁屏采用静态柔光且不持续创建动画图层', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await startApp(page, { config: { settings: { background_atmosphere: 'false' } } })
    await expect(page.locator('.unlock-input')).toBeVisible()
    await expect(page.locator('.unlock-page')).toHaveCSS('background-image', 'none')
    for (const layer of ['.unlock-bg']) {
      await expect(page.locator(layer)).toBeHidden()
    }
    await expect(page.locator('.unlock-bg')).toHaveCSS('animation-name', 'none')
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
    for (const layer of ['.unlock-bg']) {
      await expect(page.locator(layer)).toBeVisible()
    }
    await expect(page.locator('.unlock-bg')).toHaveCSS('background-image', /radial-gradient/)
    await expect(page.locator('.unlock-bg')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.unlock-bg')).toHaveCSS('filter', 'none')
    await expect(page.locator('.unlock-bg')).toHaveCSS('will-change', 'auto')
    expect(await page.locator('.unlock-bg').evaluate(el => el.getAnimations({ subtree: true }).some(a => a.effect?.getTiming().iterations === Infinity))).toBe(false)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('.unlock-bg')).toHaveCSS('animation-name', 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('.unlock-bg')).toHaveCSS('animation-name', 'none')

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
    for (const layer of ['.unlock-bg']) {
      await expect(page.locator(layer)).toBeHidden()
    }
    await expect(page.locator('.unlock-bg')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.unlock-input')).toBeVisible()
  })
})
