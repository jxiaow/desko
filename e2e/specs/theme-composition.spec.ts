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
    const main = rect('.workspace-body > .main-content'), panel = rect('.workspace-workbar'), card = rect('.memo'), composer = rect('.composer')
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
      panel: pixel(panel.right - 10, panel.bottom + 8),
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
      cardBg: color(style('.memo').backgroundColor),
    }
  }, png.toString('base64'))
}

for (const theme of THEMES) {
  test(`${theme} 的十二种强调色：${theme === 'paper' ? '两角色光可见，卡片吃同一层光' : '结构采光可见'}，内容中性`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
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
        // 渐变在大椭圆上有 8bit 抖动，相邻像素可能差 2 级；2 级以内视觉仍是连续底色。
        expect(Math.max(...logo.map((value, i) => Math.abs(value - rail[i]))), `${label} Logo 与侧栏交界处底色连续`).toBeLessThanOrEqual(2)
      }
      for (const rgb of [flat.frame, flat.edge, ...flat.outer]) {
        expect(distance(rgb, flat.canvas[1]), `${label} 关闭柔光后整窗同场`).toBeLessThan(.5)
      }
      // 导航轨与画布同底色；开启柔光时一起采光，Logo 与侧栏保持连续。
      expect(distance(glow.frame, flat.frame), `${label} 图标轨随柔光一起采光`).toBeGreaterThan(.3)
      expect(glow.inputBg, `${label} 开关采光不影响输入底色`).toEqual(flat.inputBg)
      const left = distance(glow.upperGlow, flat.upperGlow), right = distance(glow.lowerGlow, flat.lowerGlow)
      const delta = (rgb: RGB, base: RGB): RGB => [rgb[0] - base[0], rgb[1] - base[1], rgb[2] - base[2]]
      const chromatic = (rgb: RGB) => Math.max(...rgb) - Math.min(...rgb)
      const neutral = accent === 'graphite' || accent === 'sand'
      if (theme === 'paper') {
        // 纸底与对话框同一套材质：两角都是掺强调色的径向光，卡面也吃同一层光。
        // 白光提亮在 #fafafa 上只有 1.7ΔE 上限，可见性全靠彩色；纯灰在这里等于关灯。
        // 中性强调色在这里本来就只剩明暗（灰光在白底上约 1ΔE），门槛随分支放宽。
        expect(distance(glow.composerBg, flat.composerBg), `${label} 新增小记吃同一层光`).toBeGreaterThan(neutral ? .8 : 1.5)
        const cardPaint = await page.locator('.memo').first().evaluate(element => {
          const style = getComputedStyle(element)
          return { image: style.backgroundImage, attachment: style.backgroundAttachment }
        })
        expect(cardPaint.image, `${label} 卡片接入画布光场`).toMatch(/radial-gradient/)
        expect(cardPaint.attachment.split(',').map(value => value.trim()), `${label} 卡片光随窗口固定`).toEqual(['fixed', 'fixed'])
        expect(glow.cardBg, `${label} 卡片底色本身不受采光影响`).toEqual(flat.cardBg)
        expect(distance(glow.middle, flat.middle), `${label} 中部不留整片染色`).toBeLessThan(1.5)
        for (const [name, corner] of [['主光', glow.upperGlow], ['补光', glow.lowerGlow]] as const) {
          const tint = delta(corner, name === '主光' ? flat.upperGlow : flat.lowerGlow)
          if (neutral) expect(chromatic(tint), `${label} ${name}中性分支不引入彩色`).toBeLessThanOrEqual(5)
          else expect(chromatic(tint), `${label} ${name}是色光不是灰雾`).toBeGreaterThanOrEqual(2)
        }
        if (!neutral) {
          expect(left, `${label} 左上主光可见`).toBeGreaterThan(1.5)
          expect(right, `${label} 右下补光可见`).toBeGreaterThan(1.5)
        }
      } else {
        expect(distance(glow.card, glow.surface), `${label} 卡片实底`).toBeLessThan(.5)
        expect(glow.card, `${label} 开关采光不影响卡片`).toEqual(flat.card)
        expect(glow.composerBg, `${label} 开关采光不影响新增小记实底`).toEqual(flat.composerBg)
        if (!neutral) {
          expect(left, `${label} 左上迎光端可见`).toBeGreaterThan(1.5)
          expect(right, `${label} 右下背光端可见`).toBeGreaterThan(1)
        }
        // 光有方向才像光：暗底两端都变化，迎光端必须比背光端亮。
        // 只有暗端变化则是纯暗角、读不出光源，所以这里用带符号的明度差把关。
        expect(lab(glow.upperGlow).L - lab(glow.lowerGlow).L, `${label} 光轴自左上落向右下`).toBeGreaterThan(1.5)
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
        // 新表面由发丝边界承担主要分层，悬停只做轻量色阶变化。
        expect(canvasDistance, `${label} 氛围${on ? '开' : '关'}时悬停卡面仍与画布分层`).toBeGreaterThan(1.2)
        const hoverDistance = distance(hover.card, rest.card)
        expect(hoverDistance, `${label} 悬停与常态有清楚的色阶差异`).toBeGreaterThan(3.2)
        expect(hoverDistance, `${label} 悬停明暗变化保持柔和`).toBeLessThan(7.5)
        // 悬停填充本身是中性档；纸底卡面还叠着强调色光，只要求色差落在抖动范围内。
        if (hoverSurface) {
          if (theme === 'paper') expect(distance(hover.card, hoverSurface), `${label} 悬停保持中性`).toBeLessThan(1.5)
          else expect(hover.card, `${label} 悬停保持中性，不随强调色染色`).toEqual(hoverSurface)
        } else hoverSurface = hover.card
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
    // Codex 的搜索框在账号数 >1 时才出现（单账号没有可筛的东西）
    await bootUnlocked(page, { settings: { theme: 'ink', codex_enabled: 'true', background_atmosphere: 'true' }, codex: { accounts: [{ email: 'layout@example.com' }, { email: 'second@example.com' }] } }, '/codex')
    const main = page.locator('.workspace-main')
    expect(await main.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    const surface = await main.boundingBox()
    expect(width - surface!.x - surface!.width).toBe(0)
    await expect(page.locator('.search-box')).toBeInViewport()
    await expect(page.locator('.acc-row').first()).toBeInViewport()
    await expect(page.locator('.acc-row').last()).toBeInViewport()
    await expect(page.locator('.workspace-main')).not.toHaveCSS('background-color', 'rgb(38, 38, 37)')
    await expect(page.locator('.workspace-main')).toHaveCSS('background-image', /linear-gradient/)
  })
}
