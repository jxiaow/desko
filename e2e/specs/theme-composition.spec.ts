import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, waitForToastGone } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

const THEMES = { paper: '纸', snow: '雪', linen: '绢', mist: '雾', ink: '墨', slate: '岩', midnight: '夜', moss: '苔' } as const
const ACCENTS = ['ink', 'celadon', 'clay', 'plum', 'rose', 'teal', 'forest', 'amber', 'coral', 'graphite'] as const
type Theme = keyof typeof THEMES
const LIGHT_THEMES: Theme[] = ['paper', 'snow', 'linen', 'mist']
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
    const headerBottom = document.querySelector('.titlebar')!.getBoundingClientRect().bottom
    const pixel = (x: number, y: number): [number, number, number] => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3) as [number, number, number]
    const separators = [
      [pixel(edge - 1, 450), pixel(edge - 4, 450)],
      [pixel(650, headerBottom - 1), pixel(650, headerBottom - 4)],
    ]
    const root = getComputedStyle(document.documentElement)
    const color = (name: string): [number, number, number] => {
      ctx.fillStyle = root.getPropertyValue(name).trim()
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as [number, number, number]
    }
    const search = document.querySelector<HTMLInputElement>('.page-bar .search-box input')!
    const searchBox = search.closest('.search-box')!.getBoundingClientRect()
    const composer = document.querySelector('.composer')!.getBoundingClientRect()
    const placeholderSamples = [
      [getComputedStyle(search, '::placeholder').color, sample(searchBox.right - 12, searchBox.top + searchBox.height / 2)],
      [getComputedStyle(document.querySelector('.composer .ProseMirror p')!, '::before').color, sample(composer.right - 14, composer.top + 20)],
    ] as const
    const placeholders = placeholderSamples.map(([text, background]) => {
      ctx.fillStyle = text
      ctx.fillRect(0, 0, 1, 1)
      return [pixel(0, 0), background] as const
    })
    return {
      placeholders,
      pixels,
      sidebar: pixels.slice(0, 4),
      center: sample(640, 460),
      ambientEdges: [sample(310, 12), sample(270, 100), sample(980, 640)],
      separators,
      seams,
      meta: color('--text-canvas-meta'),
      readingBackground: color('--bg-surface'),
      readingText: color('--text'),
      inputBackground: color('--bg-input'),
      inputText: color('--text-secondary'),
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

test('八十组主题的全窗氛围轻柔可辨，阅读区域与主按钮保持可读', async ({ page }) => {
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
  const sidebars = {} as Record<Theme, RGB[][]>
  // 点击、保存与预览同步由 theme.spec 覆盖；本例集中检查全部开/关组合的实际像素。
  expect(themeModuleUrl).not.toBe('')
  for (const theme of Object.keys(THEMES) as Theme[]) {
    rendered[theme] = []
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
      for (const [line, face] of got.separators) {
        expect.soft(distance([line], [face]), `${label} 框架分割线保持轻淡`).toBeLessThan(4.5)
      }
      expect(Math.min(...got.pixels.map(bg => contrast(got.meta, bg))), `${label} 画布辅助文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(got.readingText, got.readingBackground), `${label} 正文卡片`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(got.inputText, got.inputBackground), `${label} 输入区域`).toBeGreaterThanOrEqual(4.5)
      for (const [text, background] of got.placeholders) expect(contrast(text, background), `${label} 搜索和书写占位提示`).toBeGreaterThanOrEqual(4.5)
      for (const bg of got.buttonStates) {
        expect(contrast(got.buttonText, bg), `${label} 主按钮文字`).toBeGreaterThanOrEqual(4.5)
      }
      if (LIGHT_THEMES.includes(theme)) {
        for (const pixel of got.pixels) {
          const background = lab(pixel)
          expect.soft(background.L, `${label} 浅色画布保持明亮`).toBeGreaterThan(93)
          expect.soft(Math.hypot(background.a, background.b), `${label} 浅色画布减少灰染和彩色雾面`).toBeLessThan(8)
        }
      }
      rendered[theme].push(got.pixels)
      sidebars[theme].push(got.sidebar)
      await page.evaluate(async url => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseBackgroundAtmosphere(false)
      }, themeModuleUrl)
      await expect(page.locator('.app-root')).toHaveCSS('background-image', 'none')
      const flat = await renderedPalette(page)
      const edgeDifference = Math.max(...got.ambientEdges.map((pixel, i) => distance([pixel], [flat.ambientEdges[i]])))
      expect.soft(edgeDifference, `${label} 边缘氛围可辨`).toBeGreaterThan(.3)
      const canvasDifference = distance(got.pixels.slice(4), flat.pixels.slice(4))
      expect.soft(canvasDifference, `${label} 氛围覆盖内容周围的留白`).toBeGreaterThan(.15)
      expect.soft(canvasDifference, `${label} 留白染色保持轻柔`).toBeLessThan(LIGHT_THEMES.includes(theme) ? 3 : 8)
      expect(distance([got.center], [flat.center]), `${label} 中部仍保留主题底色`).toBeLessThan(10)
      if (['linen', 'mist', 'midnight', 'moss'].includes(theme)) {
        const reading = lab(got.readingBackground)
        expect(Math.hypot(reading.a, reading.b), `${label} 正文卡片保持低彩度`).toBeLessThan(7)
      }
      if (flatPixels) expect(flat.pixels, `${label} 关闭氛围后底色不随强调色变化`).toEqual(flatPixels)
      flatPixels = flat.pixels
      expect(Math.min(...flat.pixels.map(bg => contrast(flat.meta, bg))), `${label} 关闭氛围辅助文字`).toBeGreaterThanOrEqual(4.5)
    }
  }
  for (let i = 0; i < ACCENTS.length; i++) {
    // 近白画布仍保留纸与雪的轻微冷暖差，不为辨识度压暗浅色主题。
    expect.soft(distance(sidebars.paper[i], sidebars.snow[i]), `纸/雪侧栏 × ${ACCENTS[i]}`).toBeGreaterThan(1)
    const themes = Object.keys(THEMES) as Theme[]
    for (const [j, a] of themes.entries()) for (const b of themes.slice(j + 1)) {
      const light = LIGHT_THEMES.includes(a)
      if (light !== LIGHT_THEMES.includes(b)) continue
      const minimum = a === 'ink' && b === 'slate' ? 7 : light ? 1 : 5
      expect.soft(distance(rendered[a][i], rendered[b][i]), `${THEMES[a]}/${THEMES[b]} × ${ACCENTS[i]}`).toBeGreaterThan(minimum)
    }
  }
})

test('Codex 常态与宽窗保留分区柔光，深底呈现提亮而非暗色染底', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  let themeModuleUrl = ''
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/src/services/theme.ts') themeModuleUrl = request.url()
  })
  await bootUnlocked(page, {
    settings: { codex_enabled: 'true' },
    codex: { accounts: [{ email: 'studio@example.com', plan_type: 'pro', weekly: 40 }] },
  }, '/codex')
  await expect(page.locator('.acc-row')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const sampleCanvas = async () => {
    const png = await page.screenshot({ animations: 'disabled' })
    return page.evaluate(async base64 => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const sample = (x: number, y: number): RGB => {
        const data = ctx.getImageData(Math.round(x) - 3, Math.round(y) - 3, 7, 7).data
        const rgb: RGB = [0, 0, 0]
        for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += data[i + c] / 49
        return rgb
      }
      const empty = [.15, .35, .55, .75, .9].map(x => sample(img.width * x, img.height * .84))
      const top = sample(img.width * .3, 20)
      const card = document.querySelector('.acc-row')!.getBoundingClientRect()
      const cardPixel = sample(card.right - 20, card.bottom - 16)
      const style = getComputedStyle(document.documentElement)
      const color = (name: string): RGB => {
        ctx.fillStyle = style.getPropertyValue(name).trim()
        ctx.fillRect(0, 0, 1, 1)
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as RGB
      }
      return { empty, top, cardPixel, base: color('--sunken'), panel: color('--bg-surface'), meta: color('--text-canvas-meta') }
    }, png.toString('base64'))
  }
  const measurements = []
  for (const [width, height] of [[1040, 670], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height })
    for (const [theme, accent] of [['snow', 'teal'], ['ink', 'celadon'], ['slate', 'ink']]) {
      await page.evaluate(async ([url, theme, accent]) => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseTheme(theme)
        await t.chooseAccent(accent)
        await t.chooseBackgroundAtmosphere(true)
      }, [themeModuleUrl, theme, accent])
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const got = await sampleCanvas()
      const lightness = got.empty.map(pixel => lab(pixel).L)
      const span = Math.max(...lightness) - Math.min(...lightness)
      const topLift = lab(got.top).L - lab(got.base).L
      const label = `${theme}/${accent} ${width}×${height}`
      // 浅底只保留轻微方向变化，深底柔光仍需高于底色。
      expect.soft(span, `${label} 留白有明暗方向`).toBeGreaterThan(theme === 'snow' ? .1 : 1)
      if (theme === 'snow') expect.soft(span, `${label} 浅色柔光不形成灰雾`).toBeLessThan(2)
      if (theme !== 'snow') expect.soft(topLift, `${label} 顶光高于底色`).toBeGreaterThan(1)
      expect.soft(Math.min(...[got.top, ...got.empty].map(bg => contrast(got.meta, bg))), `${label} 辅助文字`).toBeGreaterThanOrEqual(4.5)
      expect.soft(distance([got.cardPixel], [got.panel]), `${label} 账户卡片保持实底`).toBeLessThan(.5)
      await page.evaluate(async url => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseBackgroundAtmosphere(false)
      }, themeModuleUrl)
      const flat = await sampleCanvas()
      expect.soft(flat.empty, `${label} 关闭后恢复均匀底色`).toEqual(flat.empty.map(() => flat.empty[0]))
      expect.soft(flat.cardPixel, `${label} 氛围开关不染色卡片`).toEqual(got.cardPixel)
      measurements.push({ label, span, topLift })
    }
  }
  await testInfo.attach('codex-canvas-measurements', { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' })
})


for (const [theme, [name, bg, text]] of Object.entries({ paper: ['纸', 'rgb(248, 247, 245)', 'rgb(36, 35, 33)'], snow: ['雪', 'rgb(250, 251, 252)', 'rgb(32, 36, 43)'], ink: ['墨', 'rgb(20, 21, 24)', 'rgb(241, 242, 244)'] })) {
  test(`${name}的氛围开关独立生效，关闭后十种强调色保持画布纯色`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { theme, accent: 'ink', background_atmosphere: 'true' } })
    const dialog = await openSettings(page)
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
    await dialog.locator('.theme-chip-name').getByText(theme === 'paper' ? '雪' : '纸', { exact: true }).click()
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
