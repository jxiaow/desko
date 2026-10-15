import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, waitForToastGone } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

const THEMES = { paper: '纸', snow: '雪', linen: '绢', mist: '雾', ink: '墨', slate: '岩', midnight: '夜', moss: '苔', purewhite: '素白', warmgray: '暖灰', charcoal: '炭黑' } as const
const ACCENTS = ['ink', 'celadon', 'clay', 'plum', 'rose', 'teal', 'forest', 'amber', 'coral', 'graphite'] as const
type Theme = keyof typeof THEMES
const LIGHT_THEMES: Theme[] = ['paper', 'snow', 'linen', 'mist', 'purewhite', 'warmgray']
type RGB = [number, number, number]

// 从实际截图取画布空白处的像素，覆盖主光、辅光与中间过渡。
// 仅检查 token 是否不同，捕捉不到透明叠加后仍然近似同色的回归。
async function renderedPalette(page: Page) {
  const png = await page.screenshot({ animations: 'disabled' })
  return page.evaluate(async (base64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${base64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    const sample = (x: number, y: number): [number, number, number] => {
      const patch = ctx.getImageData(x - 2, y - 2, 5, 5).data
      const rgb: [number, number, number] = [0, 0, 0]
      for (let i = 0; i < patch.length; i += 4) {
        for (let c = 0; c < 3; c++) rgb[c] += patch[i + c] / 25
      }
      return rgb
    }
    const pixels: [number, number, number][] = []
    for (const x of [60, 270, 480, 720, 980]) {
      for (const y of [180, 400, 520, 620]) {
        pixels.push(sample(x, y))
      }
    }
    // 避开 1px 分割线和正文，只比较分界两侧相邻的背景。
    const edge = document.querySelector('.sidebar')!.getBoundingClientRect().right
    const seams = [180, 380, 500, 620].map(y => [sample(edge - 8, y), sample(edge + 8, y)])
    const root = getComputedStyle(document.documentElement)
    const color = (name: string): [number, number, number] => {
      ctx.fillStyle = root.getPropertyValue(name).trim()
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as [number, number, number]
    }
    return {
      pixels,
      sidebar: pixels.slice(0, 4),
      // 主光已移到内容上方，辨色检查取这一区域，底部保留原底色。
      primary: pixels.filter((_, i) => i % 4 === 0),
      seams,
      meta: color('--text-canvas-meta'),
      buttonText: color('--accent-on'),
      buttonStates: ['--accent', '--accent-hover', '--accent-active'].map(color),
    }
  }, png.toString('base64'))
}

function distance(a: RGB[], b: RGB[]) {
  return a.reduce((sum, rgb, i) => {
    const x = lab(rgb)
    const y = lab(b[i])
    return sum + Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
  }, 0) / a.length
}

test('一百一十组主题的实际合成色保持区别，画布文字与主按钮可读', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1040, height: 670 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let themeModuleUrl = ''
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/src/services/theme.ts') themeModuleUrl = request.url()
  })
  await bootUnlocked(page, {
    notes: [
      { content_html: '<p>整理思路，专注手头的工作。 #工作</p>' },
      { content_html: '<p>留一点空间，记录新的想法。 #灵感</p>' },
    ],
  })
  if (await page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().width < 100)) {
    await page.locator('.sidebar-toggle').click()
  }
  const rendered = {} as Record<Theme, RGB[][]>
  const primary = {} as Record<Theme, RGB[][]>
  const sidebars = {} as Record<Theme, RGB[][]>
  // 点击、保存与预览同步由 theme.spec 覆盖；本例集中检查全部开/关组合的实际像素。
  expect(themeModuleUrl).not.toBe('')
  for (const theme of Object.keys(THEMES) as Theme[]) {
    rendered[theme] = []
    primary[theme] = []
    sidebars[theme] = []
    let flatPixels: RGB[] | undefined
    for (const accent of ACCENTS) {
      await page.evaluate(async ([url, theme, accent]) => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseTheme(theme)
        await t.chooseAccent(accent)
        await t.chooseBackgroundAtmosphere(true)
      }, [themeModuleUrl, theme, accent])
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const got = await renderedPalette(page)
      const label = `${theme}/${accent}`
      for (const [left, right] of got.seams) {
        expect.soft(distance([left], [right]), `${label} 侧栏与内容背景衔接`).toBeLessThan(4.5)
      }
      expect(Math.min(...got.pixels.map(bg => contrast(got.meta, bg))), `${label} 画布辅助文字`).toBeGreaterThanOrEqual(4.5)
      for (const bg of got.buttonStates) {
        expect(contrast(got.buttonText, bg), `${label} 主按钮文字`).toBeGreaterThanOrEqual(4.5)
      }
      rendered[theme].push(got.pixels)
      primary[theme].push(got.primary)
      sidebars[theme].push(got.sidebar)
      await page.evaluate(async url => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseBackgroundAtmosphere(false)
      }, themeModuleUrl)
      await expect(page.locator('.app-root')).toHaveCSS('background-image', 'none')
      const flat = await renderedPalette(page)
      expect(distance(got.pixels, flat.pixels), `${label} 开启氛围可见`).toBeGreaterThan(1.5)
      if (flatPixels) expect(flat.pixels, `${label} 关闭氛围后底色不随强调色变化`).toEqual(flatPixels)
      flatPixels = flat.pixels
      expect(Math.min(...flat.pixels.map(bg => contrast(flat.meta, bg))), `${label} 关闭氛围辅助文字`).toBeGreaterThanOrEqual(4.5)
    }
    for (let i = 0; i < ACCENTS.length; i++) {
      for (let j = i + 1; j < ACCENTS.length; j++) {
        const label = `${theme}: ${ACCENTS[i]} / ${ACCENTS[j]}`
        expect.soft(distance(primary[theme][i], primary[theme][j]), label)
          .toBeGreaterThan(LIGHT_THEMES.includes(theme) ? 2 : 2.5)
      }
    }
  }
  for (let i = 0; i < ACCENTS.length; i++) {
    // 侧栏减轻染色后，仍保留纸与雪的冷暖辨识。
    expect.soft(distance(sidebars.paper[i], sidebars.snow[i]), `纸/雪侧栏 × ${ACCENTS[i]}`).toBeGreaterThan(4)
    const themes = Object.keys(THEMES) as Theme[]
    for (const [j, a] of themes.entries()) for (const b of themes.slice(j + 1)) {
      const light = LIGHT_THEMES.includes(a)
      if (light !== LIGHT_THEMES.includes(b)) continue
      // 中性底色刻意保留相近明度，仍需可辨，但不追求冷暖底色的跨度。
      const neutral = ['purewhite', 'warmgray', 'charcoal'].some(theme => theme === a || theme === b)
      const minimum = neutral ? (light ? 2 : 3) : a === 'ink' && b === 'slate' ? 7 : light ? 3 : 5
      expect.soft(distance(rendered[a][i], rendered[b][i]), `${THEMES[a]}/${THEMES[b]} × ${ACCENTS[i]}`).toBeGreaterThan(minimum)
    }
  }
})


for (const [theme, [name, bg, text]] of Object.entries({ purewhite: ['素白', 'rgb(245, 245, 245)', 'rgb(44, 44, 44)'], warmgray: ['暖灰', 'rgb(234, 233, 230)', 'rgb(52, 51, 47)'], charcoal: ['炭黑', 'rgb(31, 31, 31)', 'rgb(232, 232, 232)'] })) {
  test(`${name}的氛围开关独立生效，关闭后十种强调色保持画布纯色`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { theme, accent: 'ink', background_atmosphere: 'true' } })
    const dialog = await openSettings(page)
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'plain')
    await expect(page.locator('body')).toHaveCSS('color', text)
    const toggle = dialog.getByRole('switch', { name: '背景氛围' })
    await expect(toggle).toBeEnabled()
    await expect(toggle).toBeChecked()
    await expect(page.locator('.app-root')).toHaveCSS('background-image', /radial-gradient/)
    await expect(dialog.locator(`.theme-prev[data-theme="${theme}"]`)).toHaveCSS('background-image', /radial-gradient/)
    await dialog.locator('.setting-item', { hasText: '背景氛围' }).locator('label.switch').click()
    await waitForToastGone(page)
    await expect(toggle).not.toBeChecked()
    await expect(page.locator('.app-root')).toHaveCSS('background-color', bg)
    expect((await e2e.snapshot(page)).settings).toMatchObject({ theme, accent: 'ink', background_atmosphere: 'false' })
    const backgrounds: string[] = []
    for (const accent of ACCENTS) {
      await dialog.locator(`.accent-pill[data-accent-id="${accent}"]`).click()
      await waitForToastGone(page)
      const colors = await page.evaluate(() => {
        const app = getComputedStyle(document.querySelector('.app-root')!)
        const nav = getComputedStyle(document.querySelector('.sidebar')!)
        const miniature = getComputedStyle(document.querySelector('.theme-prev[data-theme="' + document.documentElement.dataset.theme + '"]')!)
        return { app: app.backgroundImage, color: app.backgroundColor, nav: nav.backgroundImage, preview: miniature.backgroundImage }
      })
      expect(colors.app).toBe('none')
      expect(colors.nav).toBe('none')
      expect(colors.preview).toBe('none')
      backgrounds.push(colors.color)
    }
    expect(new Set(backgrounds).size).toBe(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    const got = await renderedPalette(page)
    for (const bg of got.buttonStates) expect(contrast(got.buttonText, bg)).toBeGreaterThanOrEqual(4.5)
    expect(Math.min(...got.pixels.map(bg => contrast(got.meta, bg)))).toBeGreaterThanOrEqual(4.5)
    await openSettings(page)
    await dialog.locator('.theme-chip-name').getByText('纸', { exact: true }).click()
    await waitForToastGone(page)
    await expect(toggle).toBeEnabled()
    await expect(toggle).not.toBeChecked()
    await expect(page.locator('.app-root')).toHaveCSS('background-image', 'none')
    await dialog.locator('.theme-chip-name').getByText(name, { exact: true }).click()
    await waitForToastGone(page)
    await dialog.locator('.setting-item', { hasText: '背景氛围' }).locator('label.switch').click()
    await waitForToastGone(page)
    await expect(toggle).toBeChecked()
    await expect(page.locator('.app-root')).toHaveCSS('background-image', /radial-gradient/)
    expect((await e2e.snapshot(page)).settings).toMatchObject({ theme, accent: 'graphite', background_atmosphere: 'true' })
  })
}
