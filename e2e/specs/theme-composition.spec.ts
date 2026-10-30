import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

/* 骨架契约（框 + 浮片）：
   1. 柔光只染窗框——窗框是唯一的「光场」，浮片与卡片是实底，不随采光变化；
   2. 三层明度各差一档：框（有色/更深） < 浮片 < 卡片；
   3. 关掉柔光后窗框回到纯色，浮片与卡片纹丝不动。 */
const THEMES = ['paper', 'ink'] as const
const ACCENTS = ['ink', 'indigo', 'plum', 'rose', 'brick', 'clay', 'amber', 'olive', 'celadon', 'teal', 'graphite', 'sand'] as const
type RGB = [number, number, number]
const distance = (a: RGB, b: RGB) => {
  const x = lab(a), y = lab(b)
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b)
}
const chromatic = (rgb: RGB) => Math.max(...rgb) - Math.min(...rgb)

/** 取真实渲染像素：窗框四点 + 浮片 + 卡片。 */
async function renderedSurfaces(page: Page) {
  const png = await page.screenshot({ animations: 'disabled' })
  return page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + base64)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0); bitmap.close()
    const pixel = (x: number, y: number): RGB => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3) as RGB
    // 渐变有像素抖动；平面色取 5×5 均值，避免 1px 差异放大成断言失败。
    const meanPixel = (x: number, y: number): RGB => {
      const data = ctx.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data
      const rgb: RGB = [0, 0, 0]
      for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += data[i + c] / 25
      return rgb
    }
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const surface = rect('.workspace-surface')
    const rail = rect('.sidebar')
    const main = rect('.workspace-body > .main-content')
    const card = rect(document.querySelector('.memo') ? '.memo' : '.grid-card')
    const composer = rect('.composer')
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const input = style('.search-box input'), search = style('.search-box'), body = style('.memo-body')
    const root = getComputedStyle(document.documentElement)
    const color = (value: string): RGB => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as RGB
    }
    return {
      // 窗框：左轨上/中段、标题栏带、浮片下沿与右沿
      railTop: pixel(rail.right - 4, rail.y + 10),
      railMid: pixel(rail.right - 4, rail.y + rail.height * .62),
      // 关灯后的「纯色」检查点取左轨内侧留白：浮片投影够不到这里。
      railLeftTop: pixel(rail.x + 6, rail.y + rail.height * .2),
      railLeftBottom: pixel(rail.x + 6, rail.y + rail.height * .9),
      topStrip: pixel(surface.x + surface.width * .55, 12),
      // 补光锚在右下角，取样贴住那个角，别取到中段的无光区。
      bottomStrip: pixel(surface.right + 4, surface.bottom + 5),
      rightStrip: pixel(surface.right + 5, surface.y + surface.height * .5),
      // 浮片与卡片（都取中部平坦区）
      sheet: meanPixel(main.x + main.width * .5, main.bottom - 60),
      card: pixel(card.right - 14, card.bottom - 14),
      composerBg: pixel(composer.x + 8, composer.y + composer.height / 2),
      text: color(body.color),
      titleText: color(style('.memo-title').color),
      secondaryText: color(root.getPropertyValue('--text-secondary').trim()),
      mutedText: color(root.getPropertyValue('--text-muted').trim()),
      inputText: color(input.color),
      inputBg: color(search.backgroundColor),
      searchBorder: color(search.borderTopColor),
      searchBorderWidth: Number.parseFloat(search.borderTopWidth),
    }
  }, png.toString('base64'))
}

for (const theme of THEMES) {
  test(`${theme}：柔光只染窗框，浮片与卡片实底不随采光变化`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1280, height: 760 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let themeUrl = ''
    page.on('request', req => { if (new URL(req.url()).pathname === '/src/services/theme.ts') themeUrl = req.url() })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'false' },
      notes: [{ title: '渲染检查', content_html: '<h2>渲染检查</h2><p>整理思路，专注手头的工作。</p>' }],
    }, '/notes')
    await expect(page.locator('.workspace-workbar')).toBeVisible()
    expect(themeUrl).not.toBe('')

    let sheetPaint: RGB | undefined
    let cardPaint: RGB | undefined
    const measurements = []
    for (const accent of ACCENTS) {
      await page.evaluate(async ([url, accent]) => {
        const t = await import(/* @vite-ignore */ url)
        await t.chooseAccent(accent)
        await t.chooseBackgroundAtmosphere(false)
      }, [themeUrl, accent])
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const flat = await renderedSurfaces(page)
      await page.evaluate(async url => (await import(/* @vite-ignore */ url)).chooseBackgroundAtmosphere(true), themeUrl)
      await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
      const glow = await renderedSurfaces(page)
      const label = `${theme}/${accent}`
      const neutral = accent === 'graphite' || accent === 'sand'

      // 1. 关掉柔光后窗框是一块纯色：左轨上下两端没有可见差异。
      expect(distance(flat.railLeftTop, flat.railLeftBottom), `${label} 关闭柔光后窗框同色`).toBeLessThan(1)

      // 2. 浮片与卡片是实底：采光开关、换强调色都不改变它们。
      if (sheetPaint) expect(distance(glow.sheet, sheetPaint), `${label} 浮片底色不随强调色变化`).toBeLessThan(1.2)
      else sheetPaint = glow.sheet
      expect(distance(glow.sheet, flat.sheet), `${label} 浮片不吃窗框的柔光`).toBeLessThan(.8)
      if (cardPaint) expect(distance(glow.card, cardPaint), `${label} 卡片底色不随强调色变化`).toBeLessThan(1.2)
      else cardPaint = glow.card
      expect(distance(glow.card, flat.card), `${label} 卡片不吃窗框的柔光`).toBeLessThan(.8)

      // 3. 三层明度各差一档：片高于框、卡高于片（纸墨同向）。
      expect(distance(flat.sheet, flat.railLeftTop), `${label} 浮片浮在窗框上`).toBeGreaterThan(1.2)
      expect(distance(glow.card, glow.sheet), `${label} 卡片浮在浮片上`).toBeGreaterThan(1)
      expect(lab(glow.card).L, `${label} 卡片比浮片亮`).toBeGreaterThan(lab(glow.sheet).L)

      // 4. 采光只在窗框上发生，且有方向。
      const upper = distance(glow.railTop, flat.railTop)
      const lower = distance(glow.bottomStrip, flat.bottomStrip)
      if (!neutral) {
        expect(upper, `${label} 左上迎光端可见`).toBeGreaterThan(1.5)
        expect(chromatic(glow.railTop.map((v, i) => v - flat.railTop[i]) as RGB), `${label} 迎光端是色光不是灰雾`).toBeGreaterThanOrEqual(2)
        if (theme === 'paper') expect(lower, `${label} 右下补光可见`).toBeGreaterThan(1)
        else expect(lab(glow.railTop).L - lab(glow.bottomStrip).L, `${label} 光轴自左上落向右下`).toBeGreaterThan(1.5)
      } else {
        expect(chromatic(glow.railTop.map((v, i) => v - flat.railTop[i]) as RGB), `${label} 中性分支不引入彩色`).toBeLessThanOrEqual(5)
      }

      // 5. 正文与控件仍然可读，且与浮片无关。
      expect(contrast(glow.text, glow.card), `${label} 正文文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(glow.inputText, glow.inputBg), `${label} 搜索文字`).toBeGreaterThanOrEqual(4.5)
      expect(glow.searchBorderWidth, `${label} 搜索默认边框`).toBeGreaterThanOrEqual(1)
      expect(contrast(glow.searchBorder, glow.inputBg), `${label} 边框不能与搜索底色融在一起`).toBeGreaterThan(1.2)
      expect(distance(flat.composerBg, flat.sheet), `${label} 新增小记靠色阶与浮片分层`).toBeGreaterThan(1)
      if (theme === 'ink') {
        expect(contrast(glow.titleText, glow.card), `${label} 标题保持可读`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(glow.titleText, glow.card), `${label} 标题避免过亮`).toBeLessThan(15)
        expect(contrast(glow.secondaryText, glow.card), `${label} 辅助文字可读`).toBeGreaterThanOrEqual(4.5)
        expect(lab(glow.text).L - lab(glow.secondaryText).L, `${label} 正文与辅助文字字阶分明`).toBeGreaterThan(12)
        expect(lab(glow.secondaryText).L - lab(glow.mutedText).L, `${label} 辅助与弱文字不挤在同一字阶`).toBeGreaterThan(6)
        for (const rgb of [glow.sheet, glow.card]) {
          expect(chromatic(rgb), `${label} 浮片与卡片保持中性`).toBeLessThanOrEqual(10)
        }
      }

      // 6. 悬停只做轻量色阶变化，卡片仍然浮在浮片上。
      await page.locator('.memo').hover()
      const hover = await renderedSurfaces(page)
      expect(distance(hover.card, hover.sheet), `${label} 悬停后卡片仍与浮片分层`).toBeGreaterThan(1.2)
      expect(distance(hover.card, glow.card), `${label} 悬停有清楚的色阶差异`).toBeGreaterThan(2.5)
      expect(distance(hover.card, glow.card), `${label} 悬停明暗变化保持柔和`).toBeLessThan(8)
      await page.mouse.move(0, 0)

      measurements.push({ accent, upper: Math.round(upper * 10) / 10, lower: Math.round(lower * 10) / 10, sheet: distance(glow.sheet, flat.sheet) })
    }
    await testInfo.attach('frame-glow', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })
}

for (const width of [800, 1920]) {
  test(`${width}px 的墨色 Codex 页面：浮片贴合工作区，搜索可见且没有横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    // Codex 的搜索框在账号数 >1 时才出现（单账号没有可筛的东西）
    await bootUnlocked(page, { settings: { theme: 'ink', codex_enabled: 'true', background_atmosphere: 'true' }, codex: { accounts: [{ email: 'layout@example.com' }, { email: 'second@example.com' }] } }, '/codex')
    const main = page.locator('.workspace-main')
    expect(await main.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    const surface = await page.locator('.workspace-surface').boundingBox()
    const rail = await page.locator('.sidebar').boundingBox()
    // 浮片左沿与导航轨之间、右沿与窗口之间各留一圈窗框，右侧固定 10px。
    expect(Math.round(surface!.x - (rail!.x + rail!.width))).toBe(8)
    expect(Math.round(width - surface!.x - surface!.width)).toBe(10)
    await expect(page.locator('.search-box')).toBeInViewport()
    await expect(page.locator('.acc-row').first()).toBeInViewport()
    await expect(page.locator('.acc-row').last()).toBeInViewport()
    // 工作区本体透明，浮片是唯一的底色承担者。
    await expect(page.locator('.workspace-main')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.workspace-surface')).toHaveCSS('background-color', 'rgb(38, 41, 47)')
  })
}
