import { test, expect } from '@playwright/test'
import { bootUnlocked, openSettings } from '../helpers'

// 纸底与对话框同一套材质：两角各一团掺强调色的径向光，画布与阅读面共用；墨底保持四段。
const FIELDS: Record<string, string> = {
  paper: 'radial-gradient(52% 54% at 0% 0%, C, C 100%), radial-gradient(52% 54% at 100% 100%, C, C 100%), none',
  ink: 'linear-gradient(132deg, C 0%, C 40%, C 66%, C 100%), none',
}
/** 柔光颜色由强调色推导（oklch 序列化还带抖动），断言只锁光场的形状与停靠点，颜色一律归一成 C。 */
const geometry = (image: string) => image.replace(/(?:(?:rgba?|hsla?|color|oklab|oklch)\([^)]*\))/g, 'C')

for (const theme of ['paper', 'ink']) {
  test(`${theme} 全屏阅读面与画布同场，书写面保持实底`, async ({ page }) => {
    let themeUrl = ''
    page.on('request', request => { if (new URL(request.url()).pathname === '/src/services/theme.ts') themeUrl = request.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'true' },
      notes: [{ title: '专注阅读', content_html: '<p>柔光留在背景，书写面保持清晰。</p>' }],
    }, '/notes')
    await page.locator('.memo').hover()
    await page.getByRole('button', { name: '全屏查看', exact: true }).click()
    const surface = page.locator('.fs')
    const color = await surface.evaluate(element => getComputedStyle(element).backgroundColor)
    const field = () => Promise.all([
      surface.evaluate(element => getComputedStyle(element).backgroundImage),
      page.locator('.workspace-surface').evaluate(element => getComputedStyle(element).backgroundImage),
    ] as const)
    for (const enabled of [true, false, true]) {
      await page.evaluate(async ([url, enabled]) => {
        const service = await import(/* @vite-ignore */ url)
        await service.chooseAccent('rose')
        await service.chooseBackgroundAtmosphere(enabled)
      }, [themeUrl, enabled] as const)
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const [reading, canvas] = await field()
      expect(geometry(reading), `氛围${enabled ? '开' : '关'}时的阅读面光场`).toBe(enabled ? FIELDS[theme] : 'none')
      expect(reading, '阅读面与画布共用同一光场，不留第二层底').toBe(canvas)
      await expect(surface).toHaveCSS('background-color', color)
    }
    await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
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
