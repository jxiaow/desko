import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, expectToast, waitForToastGone } from '../helpers'

test.describe('统一外观状态', () => {
  test('开启氛围时预览按卡片缩放，改变窗口大小不改变预览配方', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await bootUnlocked(page, { settings: { theme: 'paper', accent: 'plum', background_atmosphere: 'true' } })
    await openSettings(page)
    // 固定卡片尺寸，单独验证绘制坐标不会随窗口变化；正常布局允许卡片自适应。
    await page.addStyleTag({ content: '.theme-row { max-width: 480px; }' })
    const previews = () => page.locator('.theme-prev').evaluateAll((els) => els.map((el) => {
      const style = getComputedStyle(el)
      return { theme: el.getAttribute('data-theme'), image: style.backgroundImage, color: style.backgroundColor }
    }))
    const before = await previews()
    expect(before).toHaveLength(8)
    expect(new Set(before.map((preview) => preview.color)).size).toBe(8)
    for (const preview of before) expect(preview.image, `${preview.theme} 柔光应使用卡片尺寸`).not.toMatch(/[\d.]+v[wh]\b/)
    const images: Buffer[] = []
    const cards = page.locator('.theme-prev')
    for (let i = 0; i < before.length; i++) images.push(await cards.nth(i).screenshot({ animations: 'disabled' }))
    await page.setViewportSize({ width: 1600, height: 1000 })
    await expect.poll(previews).toEqual(before)
    for (let i = 0; i < before.length; i++) {
      const after = await cards.nth(i).screenshot({ animations: 'disabled' })
      const difference = await page.evaluate(async ([before, after]) => {
        const pixels = async (png: string) => {
          const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob())
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext('2d')!
          context.drawImage(bitmap, 0, 0)
          bitmap.close()
          return context.getImageData(0, 0, canvas.width, canvas.height)
        }
        const [a, b] = await Promise.all([pixels(before), pixels(after)])
        if (a.width !== b.width || a.height !== b.height) return 255
        let max = 0
        for (let j = 0; j < a.data.length; j++) max = Math.max(max, Math.abs(a.data[j] - b.data[j]))
        return max
      }, [images[i].toString('base64'), after.toString('base64')])
      // 容许浏览器随绘制位置产生的微小渐变抖动，卡片尺寸与局部配方仍须一致。
      expect(difference, `${before[i].theme} 预览只应随卡片尺寸变化`).toBeLessThanOrEqual(3)
    }
  })

  test('外部入口切换时，已打开的设置同步更新且不重新读取外观', async ({ page }) => {
    let themeModuleUrl = ''
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/src/services/theme.ts') themeModuleUrl = request.url()
    })
    await bootUnlocked(page)
    const reads = () => page.evaluate(() => (window as any).__E2E__.invocations.filter(
      (call: { cmd: string; args: { key?: string } }) => call.cmd === 'get_setting'
        && ['theme', 'accent', 'background_atmosphere'].includes(call.args.key ?? ''),
    ).length)
    const readCount = await reads()
    const dialog = await openSettings(page)

    expect(themeModuleUrl).not.toBe('')
    await page.evaluate(async (url) => {
      const theme = await import(/* @vite-ignore */ url)
      await theme.chooseTheme('slate')
      await theme.chooseAccent('rose')
      await theme.chooseBackgroundAtmosphere(false)
    }, themeModuleUrl)

    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('岩')
    await expect(dialog.getByRole('radio', { checked: true })).toHaveText('洋红')
    await expect(dialog.getByRole('switch', { name: '背景氛围' })).not.toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'slate')
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'off')
    expect((await e2e.snapshot(page)).settings).toMatchObject({ theme: 'slate', accent: 'rose', background_atmosphere: 'false' })
    expect(await reads()).toBe(readCount)
  })

  test('保存失败后重新打开设置，仍显示本次已生效的完整外观', async ({ page }) => {
    let settingsModuleUrl = ''
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/src/services/api/settings.ts') settingsModuleUrl = request.url()
    })
    await bootUnlocked(page, { settings: { theme: 'paper', accent: 'ink', background_atmosphere: 'true' } })
    const dialog = await openSettings(page)
    expect(settingsModuleUrl).not.toBe('')
    await page.evaluate(async (url) => {
      const { settingsApi } = await import(/* @vite-ignore */ url)
      settingsApi.setSetting = async () => { throw new Error('test: storage unavailable') }
    }, settingsModuleUrl)

    await dialog.locator('.theme-chip', { hasText: '墨' }).click()
    await expectToast(page, /已切换，但没能保存/)
    await waitForToastGone(page)
    await dialog.locator('.accent-pill[data-accent-id="celadon"]').click()
    await expectToast(page, /已切换，但没能保存/)
    await waitForToastGone(page)
    await dialog.locator('.setting-item', { hasText: '背景氛围' }).locator('label.switch').click()
    await expectToast(page, /已切换，但没能保存/)
    await waitForToastGone(page)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    const reopened = await openSettings(page)
    await expect(reopened.locator('.theme-chip.on .theme-chip-name')).toHaveText('墨')
    await expect(reopened.getByRole('radio', { checked: true })).toHaveText('翡翠')
    await expect(reopened.getByRole('switch', { name: '背景氛围' })).not.toBeChecked()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink')
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'celadon')
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'off')
    expect((await e2e.snapshot(page)).settings).toMatchObject({ theme: 'paper', accent: 'ink', background_atmosphere: 'true' })
  })

  test('未选中的主题预览直接跟随 CSS 色值，且不影响当前主题', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'paper', accent: 'rose' } })
    const dialog = await openSettings(page)
    await page.addStyleTag({ content: '[data-theme="slate"] { --panel-bg: rgb(13, 29, 47); } [data-base="dark"][data-accent="rose"] { --accent: rgb(121, 61, 97); }' })

    const preview = dialog.locator('.theme-prev[data-theme="slate"]')
    await expect(preview.locator('.tp-row').first()).toHaveCSS('background-color', 'rgb(13, 29, 47)')
    await expect(preview.locator('.tp-rail-dot')).toHaveCSS('background-color', 'rgb(121, 61, 97)')
    await expect(dialog.locator('.theme-prev[data-theme="paper"] .tp-row').first()).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')

    await dialog.locator('.theme-chip', { hasText: '岩' }).click()
    await expect(dialog.locator('.accent-pill[data-accent-id="rose"] .accent-dot')).toHaveCSS('background-color', 'rgb(121, 61, 97)')
  })
})
