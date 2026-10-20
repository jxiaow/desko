import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

const THEMES = ['paper', 'ink'] as const
const ACCENTS = ['ink', 'celadon', 'clay', 'amber', 'plum', 'rose', 'graphite', 'sage', 'sky', 'lavender', 'peach'] as const
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
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const main = rect('.workspace-body > .main-content'), panel = rect('.workspace-directory'), card = rect('.memo'), composer = rect('.composer')
    const paint = {
      canvas: [.1, .4, .7, .9].map(x => pixel(main.x + main.width * x, main.bottom - 50)),
      frame: pixel(28, main.bottom - 50),
      outer: [pixel(canvas.width * .66, 20), pixel(canvas.width - 3, main.y + 100), pixel(main.x + main.width * .4, canvas.height - 2)],
      panel: pixel(panel.right - 12, panel.y + panel.height * .65),
      card: pixel(card.right - 10, card.bottom - 10),
      composerBorder: pixel(composer.x, composer.y + composer.height / 2),
      composerBg: pixel(composer.x + 4, composer.y + composer.height / 2),
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
      inputText: color(input.color),
      inputBg: color(search.backgroundColor),
      searchBorder: color(search.borderTopColor),
      searchBorderWidth: Number.parseFloat(search.borderTopWidth),
      surface: color(root.getPropertyValue('--bg-surface').trim()),
    }
  }, png.toString('base64'))
}

for (const theme of THEMES) {
  test(`${theme} 的十一种强调色：柔光实际可见，卡片不染色，搜索边框和文字可辨`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1280, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let themeUrl = ''
    page.on('request', req => { if (new URL(req.url()).pathname === '/src/services/theme.ts') themeUrl = req.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'false' },
      notes: [{ title: '渲染检查', content_html: '<p>整理思路，专注手头的工作。</p>' }],
    }, '/notes')
    await page.getByRole('button', { name: '展开目录', exact: true }).click()
    expect(themeUrl).not.toBe('')
    let flatCanvas: RGB[] | undefined
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
      expect(distance(glow.panel, flat.panel), `${label} 目录柔光不能只改变量而没有像素变化`).toBeGreaterThan(.3)
      expect(distance(glow.frame, flat.frame), `${label} 外框柔光可见`).toBeGreaterThan(.3)
      expect(distance(glow.card, glow.surface), `${label} 卡片实底`).toBeLessThan(.5)
      expect(glow.card, `${label} 开关柔光不影响卡片`).toEqual(flat.card)
      expect(contrast(glow.text, glow.card), `${label} 正文文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(glow.inputText, glow.inputBg), `${label} 搜索文字`).toBeGreaterThanOrEqual(4.5)
      expect(glow.searchBorderWidth, `${label} 搜索默认边框`).toBeGreaterThanOrEqual(1)
      expect(contrast(glow.searchBorder, glow.inputBg), `${label} 边框不能与搜索底色融在一起`).toBeGreaterThan(1.2)
      expect(contrast(glow.composerBorder, glow.composerBg), `${label} 新增小记默认边界可见`).toBeGreaterThan(1.2)
      expect(contrast(flat.composerBorder, flat.composerBg), `${label} 关闭柔光后新增小记默认边界可见`).toBeGreaterThan(1.2)
      if (theme === 'ink') {
        expect(contrast(glow.titleText, glow.card), `${label} 标题保持可读`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(glow.titleText, glow.card), `${label} 标题避免过亮`).toBeLessThan(10)
        for (const rgb of [...flat.outer, ...glow.outer, flat.frame, glow.frame]) {
          expect(lab(rgb).L, `${label} 顶栏、侧边和底边保持炭灰，不能接近纯黑`).toBeGreaterThanOrEqual(12)
        }
        expect(contrast(glow.secondaryText, glow.card), `${label} 辅助文字可读`).toBeGreaterThanOrEqual(4.5)
        expect(lab(glow.text).L - lab(glow.secondaryText).L, `${label} 正文与辅助文字字阶分明`).toBeGreaterThan(12)
        expect(distance(flat.card, flat.canvas[1]), `${label} 卡片与正文底色分层`).toBeGreaterThan(1.5)
        for (const [index, rgb] of glow.canvas.entries()) {
          expect(distance(rgb, glow.frame), `${label} 正文位置 ${index} 与外框分层`).toBeGreaterThan(2)
          expect(Math.max(...rgb) - Math.min(...rgb), `${label} 正文位置 ${index} 保持中性炭灰`).toBeLessThanOrEqual(3)
        }
      }
      measurements.push({ accent, frame: distance(glow.frame, flat.frame), panel: distance(glow.panel, flat.panel) })
    }
    await testInfo.attach('rendered-surfaces', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })
}

for (const width of [800, 1920]) {
  test(`${width}px 的墨色 Codex 页面保持内容与外框层次，搜索可见且没有横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await bootUnlocked(page, { settings: { theme: 'ink', codex_enabled: 'true', background_atmosphere: 'true' }, codex: { accounts: [{ email: 'layout@example.com' }] } }, '/codex')
    const main = page.locator('.workspace-main')
    expect(await main.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    const surface = await main.boundingBox()
    expect(width - surface!.x - surface!.width).toBe(6)
    await expect(page.locator('.search-box')).toBeInViewport()
    await expect(page.locator('.acc-row')).toBeInViewport()
    await expect(page.locator('.workspace-main')).not.toHaveCSS('background-color', 'rgb(38, 38, 37)')
    await expect(page.locator('.workspace-main')).toHaveCSS('background-image', /radial-gradient/)
  })
}
