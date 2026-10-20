import { test, expect } from '@playwright/test'
import { bootUnlocked, openSettings } from '../helpers'

for (const theme of ['paper', 'ink']) {
  test(`${theme} 全屏阅读保持实底，柔光开关和强调色不改变书写面`, async ({ page }) => {
    let themeUrl = ''
    page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'true' },
      notes: [{ title: '专注阅读', content_html: '<p>柔光留在背景，书写面保持清晰。</p>' }],
    }, '/notes')
    await page.locator('.memo').hover()
    await page.getByRole('button', { name: '全屏查看', exact: true }).click()
    const surface = page.locator('.fs')
    await expect(surface).toHaveCSS('background-image', 'none')
    const color = await surface.evaluate(element => getComputedStyle(element).backgroundColor)
    for (const enabled of [false, true]) {
      await page.evaluate(async ([url, enabled]) => {
        const service = await import(/* @vite-ignore */ url)
        await service.chooseAccent('rose')
        await service.chooseBackgroundAtmosphere(enabled)
      }, [themeUrl, enabled] as const)
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      await expect(surface).toHaveCSS('background-image', 'none')
      await expect(surface).toHaveCSS('background-color', color)
    }
    await surface.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(surface).toHaveCSS('background-image', 'none')
    await expect(surface).toHaveCSS('background-color', color)
  })
}

test('底色预览不随强调色或氛围变化，使用固定中性基准', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await bootUnlocked(page, { settings: { theme: 'paper', accent: 'ink', background_atmosphere: 'false' } })
  const settings = await openSettings(page)
  const previews = settings.locator('.theme-prev')
  const state = () => previews.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element)
    return { image: style.backgroundImage, color: style.backgroundColor, accent: style.getPropertyValue('--accent'), tag: getComputedStyle(element.querySelector('.tp-row-tag')!).backgroundColor }
  }))
  const before = await state()
  const pixels: Buffer[] = []
  for (const preview of await previews.all()) pixels.push(await preview.screenshot({ animations: 'disabled' }))
  await settings.getByRole('radio', { name: '玫瑰', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
  expect(await state(), '更换强调色后底色卡内容应保持不变').toEqual(before)
  const control = settings.locator('.setting-item', { hasText: '背景氛围' })
  await control.locator('label.switch').click()
  await expect(control.getByRole('switch')).toBeChecked()
  expect(await state(), '开启氛围后底色卡内容应保持不变').toEqual(before)
  for (const [index, preview] of (await previews.all()).entries()) {
    expect((await preview.screenshot({ animations: 'disabled' })).equals(pixels[index]), `底色卡 ${index} 的截图裁片保持不变`).toBe(true)
  }
  await expect(previews).toHaveCount(2)
  for (const preview of await previews.all()) {
    await expect(preview).toHaveAttribute('data-accent', 'graphite')
    await expect(preview).toHaveAttribute('data-atmosphere', 'off')
  }
})
