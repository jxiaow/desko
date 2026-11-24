import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootUnlocked } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

/* 骨架契约（导轨 + 通栏内容面）：
   1. 外层窗框承载柔光，内容面与卡片使用主题实底；
   2. 三层明度各差一档：导轨（比内容面降一档） < 内容面 < 卡片；
   3. 柔光开关与强调色只影响窗框的受光区域。 */
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
    const searchBox = rect('.search-box')
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
    const input = style('.search-box input'), search = style('.search-box'), body = style('.memo-body')
    const root = getComputedStyle(document.documentElement)
    const color = (value: string): RGB => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as RGB
    }
    return {
      // 窗框取标题栏与导轨留白，避开图标与文字。
      railTop: meanPixel(rail.right - 4, rail.y + 10),
      // 关灯后的「纯色」检查点取左轨内侧留白：浮片投影够不到这里。
      railLeftTop: meanPixel(rail.x + 6, rail.y + rail.height * .2),
      railLeftBottom: meanPixel(rail.x + 6, rail.y + rail.height * .9),
      topStrip: meanPixel(surface.x + surface.width * .55, 12),
      seamRail: meanPixel(rail.right - 4, rail.y + rail.height * .62),
      seamSheet: meanPixel(surface.x + 4, rail.y + rail.height * .62),
      // 内容面与卡片（都取中部平坦区）
      sheet: meanPixel(main.x + main.width * .5, main.bottom - 60),
      card: pixel(card.right - 14, card.bottom - 14),
      composerBg: pixel(composer.x + 8, composer.y + composer.height / 2),
      text: color(body.color),
      titleText: color(style('.memo-title').color),
      secondaryText: color(root.getPropertyValue('--text-secondary').trim()),
      mutedText: color(root.getPropertyValue('--text-muted').trim()),
      inputText: color(input.color),
      inputBg: pixel(searchBox.x + searchBox.width / 2, searchBox.bottom - 4),
      searchBorder: pixel(searchBox.x + searchBox.width / 2, searchBox.y),
      searchBorderWidth: Number.parseFloat(search.borderTopWidth),
    }
  }, png.toString('base64'))
}

async function bootComposition(page: Page, theme: (typeof THEMES)[number]) {
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
  return themeUrl
}

async function captureAtmosphere(page: Page, themeUrl: string, accent: (typeof ACCENTS)[number], enabled: boolean) {
  await page.evaluate(async ([url, accent, enabled]) => {
    const theme = await import(/* @vite-ignore */ url)
    await theme.chooseAccent(accent)
    await theme.chooseBackgroundAtmosphere(enabled)
  }, [themeUrl, accent, enabled] as const)
  await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
  return renderedSurfaces(page)
}

async function textContrast(locator: Locator, pseudo?: string) {
  const [foreground, background] = await locator.evaluate((element, pseudo) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')!
    const layers = []
    for (let node: Element | null = element; node; node = node.parentElement) {
      layers.unshift(getComputedStyle(node).backgroundColor)
    }
    // 将半透明底色按绘制顺序叠加，再计算实际可见的文字颜色。
    const sample = (): RGB => [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as RGB
    const paint = (color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
    }
    paint('#fff')
    for (const color of layers) paint(color)
    const background = sample()
    paint(getComputedStyle(element, pseudo).color)
    return [sample(), background]
  }, pseudo)
  return contrast(foreground, background)
}

for (const theme of THEMES) {
  test(`${theme}：强调色按钮、链接和辅助文字达到 4.5:1`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, {
      settings: { theme, background_atmosphere: 'true' },
      entries: [{ name: '维基', url: 'https://example.org/help', category: '参考' }],
      notes: [{ title: '示例', content_html: '<p>内容</p>' }],
    }, '/notes')
    await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' })
    const noteTime = await textContrast(page.locator('.memo-foot .memo-time').first())
    const placeholder = await textContrast(page.locator('.search-box input').first(), '::placeholder')
    expect(noteTime, '小记时间').toBeGreaterThanOrEqual(4.5)
    expect(placeholder, '搜索占位文字').toBeGreaterThanOrEqual(4.5)

    await page.locator('a.nav-item[href="/entries"]').click()
    const html = page.locator('html')
    const link = page.locator('.ec-domain').first()
    const toolbar = page.getByRole('button', { name: '新增条目', exact: true })
    const measurements = []
    const setAccent = (accent: (typeof ACCENTS)[number]) =>
      html.evaluate((element, accent) => { element.dataset.accent = accent }, accent)
    for (const accent of ACCENTS) {
      await setAccent(accent)
      await page.mouse.move(0, 0)
      const linkRest = await textContrast(link)
      await link.hover()
      const linkHover = await textContrast(link)
      const toolbarRest = await textContrast(toolbar)
      await toolbar.hover()
      const toolbarHover = await textContrast(toolbar)
      await page.mouse.down()
      const toolbarActive = await textContrast(toolbar)
      await page.mouse.move(0, 0)
      await page.mouse.up()
      measurements.push({ accent, linkRest, linkHover, toolbarRest, toolbarHover, toolbarActive })
    }

    await toolbar.click()
    const dialog = page.getByRole('dialog', { name: '新增网址收藏' })
    const dialogButton = dialog.getByRole('button', { name: '保存条目', exact: true })
    const cancelButton = dialog.getByRole('button', { name: '取消', exact: true })
    await expect(dialogButton).toBeEnabled()
    const dialogMeasurements = []
    for (const accent of ACCENTS) {
      await setAccent(accent)
      await page.mouse.move(0, 0)
      const rest = await textContrast(dialogButton)
      await dialogButton.hover()
      const hover = await textContrast(dialogButton)
      await page.mouse.down()
      const active = await textContrast(dialogButton)
      await cancelButton.hover()
      await page.mouse.up()
      dialogMeasurements.push({ accent, rest, hover, active })
    }

    await testInfo.attach('contrast', {
      body: JSON.stringify({ noteTime, placeholder, measurements, dialogMeasurements }),
      contentType: 'application/json',
    })
    for (const { accent, ...ratios } of [...measurements, ...dialogMeasurements]) {
      for (const [state, ratio] of Object.entries(ratios)) {
        expect.soft(ratio, `${theme}/${accent}/${state}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
}

for (const theme of THEMES) {
  test(`${theme}：所有强调色开启后窗框都有可见的柔光`, async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    const themeUrl = await bootComposition(page, theme)
    const measurements = []
    for (const accent of ACCENTS) {
      const flat = await captureAtmosphere(page, themeUrl, accent, false)
      const glow = await captureAtmosphere(page, themeUrl, accent, true)
      const upper = distance(glow.railTop, flat.railTop)
      const lower = distance(glow.railLeftBottom, flat.railLeftBottom)
      const top = distance(glow.topStrip, flat.topStrip)
      const label = `${theme}/${accent}`
      expect(top, `${label} 标题栏有柔光`).toBeGreaterThan(1)
      expect(upper, `${label} 导轨顶部有柔光`).toBeGreaterThan(1.5)
      expect(lower, `${label} 导轨底部有可见反光`).toBeGreaterThan(3.5)
      expect(glow.sheet, `${label} 正文底色保持一致`).toEqual(flat.sheet)
      if (accent === 'graphite' || accent === 'sand') {
        await testInfo.attach(`${theme}-${accent}-softlight`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' })
      }
      measurements.push({ accent, top, upper, lower })
    }
    await testInfo.attach('frame-glow', { body: JSON.stringify(measurements), contentType: 'application/json' })
  })

  test(`${theme}：窗框有柔光，内容面与卡片保持实底`, async ({ page }) => {
    test.setTimeout(90_000)
    const themeUrl = await bootComposition(page, theme)

    let sheetPaint: RGB | undefined
    let cardPaint: RGB | undefined
    for (const accent of ACCENTS) {
      const flat = await captureAtmosphere(page, themeUrl, accent, false)
      const glow = await captureAtmosphere(page, themeUrl, accent, true)
      const label = `${theme}/${accent}`

      // 1. 关掉柔光后窗框是一块纯色：左轨上下两端没有可见差异。
      expect(distance(flat.railLeftTop, flat.railLeftBottom), `${label} 关闭柔光后窗框同色`).toBeLessThan(1)

      // 2. 拿开启柔光后的像素与同主题基准比较。
      if (sheetPaint) expect(glow.sheet, `${label} 内容面底色不随强调色变化`).toEqual(sheetPaint)
      else sheetPaint = glow.sheet
      expect(glow.sheet, `${label} 内容面底色不随柔光变化`).toEqual(flat.sheet)
      if (cardPaint) expect(distance(glow.card, cardPaint), `${label} 卡片底色不随强调色变化`).toBeLessThan(1.2)
      else cardPaint = glow.card
      expect(distance(glow.card, flat.card), `${label} 卡片不吃窗框的柔光`).toBeLessThan(.8)

      // 3. 三层明度各差一档：片高于框、卡高于片（纸墨同向）。
      expect(distance(flat.sheet, flat.railLeftTop), `${label} 浮片浮在窗框上`).toBeGreaterThan(1.2)
      expect(distance(glow.card, glow.sheet), `${label} 卡片浮在浮片上`).toBeGreaterThan(1)
      expect(lab(glow.card).L, `${label} 卡片比浮片亮`).toBeGreaterThan(lab(glow.sheet).L)

      // 接缝只保留一档明度差，不能出现反向提亮或突兀色带。
      expect(lab(glow.seamSheet).L - lab(glow.seamRail).L, `${label} 导轨比正文深`).toBeGreaterThan(.5)
      expect(distance(glow.seamRail, glow.seamSheet), `${label} 接缝色差克制`).toBeLessThan(6)
      expect(glow.seamSheet, `${label} 接缝内侧保持实底`).toEqual(flat.seamSheet)

      // 4. 正文与控件保持可读。
      expect(contrast(glow.text, glow.card), `${label} 正文文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(glow.inputText, glow.inputBg), `${label} 搜索文字`).toBeGreaterThanOrEqual(4.5)
      expect(glow.searchBorderWidth, `${label} 搜索默认边框`).toBeGreaterThanOrEqual(1)
      expect(contrast(glow.searchBorder, glow.inputBg), `${label} 边框不能与搜索底色融在一起`).toBeGreaterThan(1.2)
      expect(distance(flat.composerBg, flat.sheet), `${label} 新增小记靠色阶与浮片分层`).toBeGreaterThan(1)
      if (theme === 'ink') {
        expect(contrast(glow.titleText, glow.card), `${label} 标题保持可读`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(glow.titleText, glow.card), `${label} 标题避免过亮`).toBeLessThan(15)
        expect(contrast(glow.secondaryText, glow.card), `${label} 辅助文字可读`).toBeGreaterThanOrEqual(4.5)
        // 卡面两档声部：标题走 --text、正文走 --text-secondary（纸片档，见 docs/design/notes/12-slip-face.md）
        expect(lab(glow.titleText).L - lab(glow.text).L, `${label} 标题与正文字阶分明`).toBeGreaterThan(12)
        expect(lab(glow.secondaryText).L - lab(glow.mutedText).L, `${label} 辅助与弱文字不挤在同一字阶`).toBeGreaterThan(6)
        for (const rgb of [glow.sheet, glow.card]) {
          expect(chromatic(rgb), `${label} 浮片与卡片保持中性`).toBeLessThanOrEqual(10)
        }
      }

      // 5. 悬停时卡面保持实底。
      await page.locator('.memo').hover()
      const hover = await renderedSurfaces(page)
      expect(distance(hover.card, hover.sheet), `${label} 悬停后卡片仍与浮片分层`).toBeGreaterThan(1.2)
      expect(distance(hover.card, glow.card), `${label} 悬停不改卡面实底`).toBeLessThan(1)
      await page.mouse.move(0, 0)
    }
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
    // 浮片退役：内容面与导轨边到边相接，四周不再有窗框留白；分界只由导轨那一档更深的底色交代。
    expect(Math.round(surface!.x - (rail!.x + rail!.width))).toBe(0)
    expect(Math.round(width - surface!.x - surface!.width)).toBe(0)
    await expect(page.locator('.search-box')).toBeInViewport()
    await expect(page.locator('.acc-row').first()).toBeInViewport()
    await expect(page.locator('.acc-row').last()).toBeInViewport()
    // 工作区本体透明，浮片是唯一的底色承担者。
    await expect(page.locator('.workspace-main')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(page.locator('.workspace-surface')).toHaveCSS('background-color', 'rgb(28, 30, 33)')
  })
}
