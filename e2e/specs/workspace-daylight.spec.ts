import { test, expect } from '@playwright/test'
import { bootUnlocked, openNoteRead, openSettings } from '../helpers'

// 骨架契约：柔光只染窗框，全屏阅读面就是内容浮片本身——实底、不吃光，
// 无论氛围开还是关、换成哪个强调色，阅读面始终是同一块底色。
for (const theme of ['paper', 'ink']) {
  test(`${theme} 全屏阅读面与浮片同场，书写面保持实底`, async ({ page }) => {
    let themeUrl = ''
    page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'true' },
      notes: [{ title: '专注阅读', content_html: '<p>柔光留在背景，书写面保持清晰。</p>' }],
    }, '/notes')
    await openNoteRead(page.locator('.memo'))
    const surface = page.locator('.fs')
    const fill = () => surface.evaluate(element => {
      const cs = getComputedStyle(element)
      return { image: cs.backgroundImage, color: cs.backgroundColor }
    })
    const sheetColor = await page.locator('.workspace-surface').evaluate(element => getComputedStyle(element).backgroundColor)
    const reading = await fill()
    expect(reading.image, '阅读面不接窗框的柔光').toBe('none')
    expect(reading.color, '阅读面就是浮片底色').toBe(sheetColor)
    for (const enabled of [true, false, true]) {
      await page.evaluate(async ([url, enabled]) => {
        const service = await import(/* @vite-ignore */ url)
        await service.chooseAccent('rose')
        await service.chooseBackgroundAtmosphere(enabled)
      }, [themeUrl, enabled] as const)
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      // 光只换窗框那一层，阅读面纹丝不动。
      const frame = await page.locator('.app-root').evaluate(element => getComputedStyle(element).backgroundImage)
      expect(frame === 'none', `氛围${enabled ? '开' : '关'}时的窗框光场`).toBe(!enabled)
      const now = await fill()
      expect(now.image, `氛围${enabled ? '开' : '关'}时的阅读面光场`).toBe('none')
      expect(now.color, `氛围${enabled ? '开' : '关'}时的阅读面底色`).toBe(reading.color)
    }
    await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
    await expect(surface).toHaveCSS('background-image', 'none')
    await expect(surface).toHaveCSS('background-color', reading.color)
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
