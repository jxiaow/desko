import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

const THEMES = ['paper', 'ink'] as const
const ACCENTS = ['ink', 'indigo', 'plum', 'rose', 'brick', 'clay', 'amber', 'olive', 'celadon', 'teal', 'graphite', 'sand'] as const
type RGB = [number, number, number]
const distance = (a: RGB, b: RGB) => {
  const x = lab(a), y = lab(b)
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}

// 取正式布局里真实渲染的像素，而不是只比较 CSS 变量是否不同。
async function renderedSurfaces(page: Page) {
  const png = await page.screenshot({ animations: 'disabled' })
  return page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + base64)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    const pixel = (x: number, y: number): RGB => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3) as RGB
    // 柔光渐变有像素抖动；中部取局部均值，避免几像素的布局位移改变量化结果。
    const meanPixel = (x: number, y: number): RGB => {
      const data = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data
      const rgb: RGB = [0, 0, 0]
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += data[i + c] / 25
      return rgb
    }
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const surface = rect('.workspace-surface')
    const rail = rect('.sidebar')
    const main = rect('.workspace-body > .main-content'), panel = rect('.workspace-directory'), card = rect('.memo'), composer = rect('.composer')
    const paint = {
      canvas: [.1, .4, .7, .9].map(x => pixel(main.x + main.width * x, main.bottom - 50)),
      middle: meanPixel(main.x + main.width * .5, main.y + main.height * .55),
      upperGlow: pixel(main.x + 8, main.y + 6),
      lowerGlow: pixel(main.right - 12, main.bottom - 50),
      edge: pixel(surface.x + surface.width * .6, surface.y),
      // 轨道外缘避开模块图标，取样位置不随正文工具栏的高度移动。
      frame: pixel(rail.right - 3, rail.y + rail.height * .12),
      navigationJoin: [pixel(rail.right - 3, rail.y - 1), pixel(rail.right - 3, rail.y)],
      outer: [pixel(canvas.width * .66, 20), pixel(main.right - 3, main.y + 100), pixel(main.x + main.width * .4, canvas.height - 2)],
      panel: pixel(panel.right - 12, panel.y + panel.height * .9),
      card: pixel(card.right - 10, card.bottom - 10),
      cardCanvas: meanPixel(card.right - 10, card.bottom + 8),
      composerBg: pixel(composer.x + 6, composer.y + composer.height / 2),
    }
    const color = (value: string): RGB => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as RGB
    }
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const input = style('.search-box input'), search = style('.search-box'), body = style('.memo-body')
    const root = getComputedStyle(document.documentElement)
    return {
      ...paint,
      text: color(body.color),
      titleText: color(style('.memo-title').color),
      secondaryText: color(root.getPropertyValue('--text-secondary').trim()),
      mutedText: color(root.getPropertyValue('--text-muted').trim()),
      inputText: color(input.color),
      inputBg: color(search.backgroundColor),
      searchBorder: color(search.borderTopColor),
      searchBorderWidth: Number.parseFloat(search.borderTopWidth),
      surface: color(root.getPropertyValue('--bg-surface').trim()),
    }
  }, png.toString('base64'))
}

for (const theme of THEMES) {
  test(`${theme} 的十二种强调色：结构采光可见，内容中性，卡片和输入不染色`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1280, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let themeUrl = ''
    page.on('request', req => { if (new URL(req.url()).pathname === '/src/services/theme.ts') themeUrl = req.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'false' },
      notes: [{ title: '渲染检查', content_html: '<h2>渲染检查</h2><p>整理思路，专注手头的工作。</p>' }],
    }, '/notes')
    await page.getByRole('button', { name: '展开目录', exact: true }).click()
    expect(themeUrl).not.toBe('')
    let flatCanvas: RGB[] | undefined
    let hoverSurface: RGB | undefined
    const measurements = []
    for (const accent of ACCENTS) {
      await page.evaluate(async ([url, accent]) => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseAccent(accent)
        await t.chooseBackgroundAtmosphere(false)
      }, [themeUrl, accent])
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const flat = await renderedSurfaces(page)
      if (flatCanvas) expect(flat.canvas, `${theme}/${accent} 关闭柔光后内容底色稳定`).toEqual(flatCanvas)
      flatCanvas = flat.canvas
      await page.evaluate(async url => (await import(/* @vite-ignore */ url)).chooseBackgroundAtmosphere(true), themeUrl)
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const glow = await renderedSurfaces(page)
      const label = `${theme}/${accent}`
      for (const paint of [flat, glow]) {
        const [logo, rail] = paint.navigationJoin
        expect(Math.max(...logo.map((value, i) => Math.abs(value - rail[i]))), `${label} Logo 与侧栏交界处底色连续`).toBeLessThanOrEqual(1)
      }
      for (const rgb of [flat.frame, flat.edge, ...flat.outer]) {
        expect(distance(rgb, flat.canvas[1]), `${label} 关闭柔光后整窗同场`).toBeLessThan(.5)
      }
      // 导航轨与画布同底色；开启柔光时一起采光，Logo 与侧栏保持连续。
      expect(distance(glow.frame, flat.frame), `${label} 图标轨随柔光一起采光`).toBeGreaterThan(.3)
      expect(distance(glow.panel, flat.panel), `${label} 目录柔光不能只改变量而没有像素变化`).toBeGreaterThan(.3)
      expect(distance(glow.card, glow.surface), `${label} 卡片实底`).toBeLessThan(.5)
      expect(glow.card, `${label} 开关采光不影响卡片`).toEqual(flat.card)
      expect(glow.inputBg, `${label} 开关采光不影响输入底色`).toEqual(flat.inputBg)
      expect(glow.composerBg, `${label} 开关采光不影响新增小记实底`).toEqual(flat.composerBg)
      if (accent !== 'graphite' && accent !== 'sand') {
        const left = distance(glow.upperGlow, flat.upperGlow), right = distance(glow.lowerGlow, flat.lowerGlow)
        expect(left, `${label} 左上柔光可见`).toBeGreaterThan(1.5)
        expect(right, `${label} 右下辅光可见`).toBeGreaterThan(1)
        expect(left / right, `${label} 左侧柔光不能明显弱于右侧`).toBeGreaterThanOrEqual(.5)
        expect(right / left, `${label} 两端受光强度保持均衡`).toBeGreaterThanOrEqual(.5)
      }
      for (const [index, rgb] of [...glow.canvas, glow.middle].entries()) {
        const baseline = index === glow.canvas.length ? flat.middle : flat.canvas[index]
        expect(distance(rgb, baseline), `${label} 留白柔光保留底色层次`).toBeLessThan(6)
      }
      if (accent === 'graphite' || accent === 'sand') {
        const tint = glow.upperGlow.map((value, i) => value - flat.upperGlow[i])
        expect(Math.max(...tint) - Math.min(...tint), `${label} 中性分支不额外引入彩色`).toBeLessThanOrEqual(5)
      }
      expect(contrast(glow.text, glow.card), `${label} 正文文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(glow.inputText, glow.inputBg), `${label} 搜索文字`).toBeGreaterThanOrEqual(4.5)
      expect(glow.searchBorderWidth, `${label} 搜索默认边框`).toBeGreaterThanOrEqual(1)
      expect(contrast(glow.searchBorder, glow.inputBg), `${label} 边框不能与搜索底色融在一起`).toBeGreaterThan(1.2)
      expect(distance(flat.composerBg, flat.canvas[1]), `${label} 新增小记靠色阶与画布分层`).toBeGreaterThan(1)
      if (theme === 'ink') {
        expect(contrast(glow.titleText, glow.card), `${label} 标题保持可读`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(glow.titleText, glow.card), `${label} 标题避免过亮`).toBeLessThan(15)
        expect(lab(glow.card).L, `${label} 卡片保留暗色实底`).toBeLessThan(17)
        expect(contrast(glow.secondaryText, glow.card), `${label} 辅助文字可读`).toBeGreaterThanOrEqual(4.5)
        expect(lab(glow.text).L - lab(glow.secondaryText).L, `${label} 正文与辅助文字字阶分明`).toBeGreaterThan(12)
        expect(lab(glow.secondaryText).L - lab(glow.mutedText).L, `${label} 辅助与弱文字不挤在同一字阶`).toBeGreaterThan(6)
        expect(distance(flat.card, flat.canvas[1]), `${label} 卡片与正文底色分层`).toBeGreaterThan(1.5)
        for (const rgb of glow.canvas) {
          expect(Math.max(...rgb) - Math.min(...rgb), `${label} 留白受光不能明显偏色`).toBeLessThanOrEqual(8)
        }
        expect(distance(glow.middle, flat.middle), `${label} 中部没有整片提亮的灰雾`).toBeLessThan(3)
      }
      const hoverMeasurements = []
      for (const [on, rest] of [[false, flat], [true, glow]] as const) {
        await page.evaluate(async ([url, on]) => (await import(/* @vite-ignore */ url)).chooseBackgroundAtmosphere(on), [themeUrl, on] as const)
        await page.locator('.memo').hover()
        const hover = await renderedSurfaces(page)
        const canvasDistance = distance(hover.card, hover.cardCanvas)
        expect(canvasDistance, `${label} 氛围${on ? '开' : '关'}时悬停卡面仍与画布分层`).toBeGreaterThan(1.5)
        const hoverDistance = distance(hover.card, rest.card)
        expect(hoverDistance, `${label} 悬停与常态有清楚的色阶差异`).toBeGreaterThan(3.5)
        expect(hoverDistance, `${label} 悬停明暗变化保持柔和`).toBeLessThan(7)
        if (hoverSurface) expect(hover.card, `${label} 悬停保持中性，不随强调色染色`).toEqual(hoverSurface)
        else hoverSurface = hover.card
        hoverMeasurements.push({ on, canvasDistance, hoverDistance })
      }
      await page.mouse.move(0, 0)
      measurements.push({ accent, frame: distance(glow.frame, flat.frame), panel: distance(glow.panel, flat.panel), upper: distance(glow.upperGlow, flat.upperGlow), lower: distance(glow.lowerGlow, flat.lowerGlow), hover: hoverMeasurements })
    }
    await testInfo.attach('rendered-surfaces', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })
}

for (const width of [800, 1920]) {
  test(`${width}px 的墨色 Codex 页面保持整窗同场，搜索可见且没有横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await bootUnlocked(page, { settings: { theme: 'ink', codex_enabled: 'true', background_atmosphere: 'true' }, codex: { accounts: [{ email: 'layout@example.com' }] } }, '/codex')
    const main = page.locator('.workspace-main')
    expect(await main.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    const surface = await main.boundingBox()
    expect(width - surface!.x - surface!.width).toBe(0)
    await expect(page.locator('.search-box')).toBeInViewport()
    await expect(page.locator('.acc-row')).toBeInViewport()
    await expect(page.locator('.workspace-main')).not.toHaveCSS('background-color', 'rgb(38, 38, 37)')
    await expect(page.locator('.workspace-main')).toHaveCSS('background-image', /radial-gradient/)
  })
}
