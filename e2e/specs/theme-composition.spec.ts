import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, openSettings, waitForToastGone } from '../helpers'
import { contrast, lab } from '../../scripts/lib/theme-tokens.mjs'

const THEMES = { paper: '纸', snow: '雪', ink: '墨', slate: '岩' } as const
const ACCENTS = ['ink', 'celadon', 'clay', 'plum', 'rose'] as const
type Theme = keyof typeof THEMES
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
    const pixels: [number, number, number][] = []
    for (const x of [60, 270, 480, 720, 980]) {
      for (const y of [380, 500, 620]) {
        const patch = ctx.getImageData(x - 2, y - 2, 5, 5).data
        const rgb: [number, number, number] = [0, 0, 0]
        for (let i = 0; i < patch.length; i += 4) {
          for (let c = 0; c < 3; c++) rgb[c] += patch[i + c] / 25
        }
        pixels.push(rgb)
      }
    }
    const root = getComputedStyle(document.documentElement)
    const color = (name: string): [number, number, number] => {
      ctx.fillStyle = root.getPropertyValue(name).trim()
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) as [number, number, number]
    }
    return {
      pixels,
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

test('二十组主题的实际合成色保持区别，画布文字与主按钮可读', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 670 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
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
  for (const theme of Object.keys(THEMES) as Theme[]) {
    let dialog = await openSettings(page)
    await dialog.locator('.theme-chip', { hasText: THEMES[theme] }).click()
    await waitForToastGone(page)
    rendered[theme] = []
    for (const [index, accent] of ACCENTS.entries()) {
      if (index) dialog = await openSettings(page)
      await dialog.locator(`.accent-pill[data-accent-id="${accent}"]`).click()
      await waitForToastGone(page)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      const got = await renderedPalette(page)
      const label = `${theme}/${accent}`
      expect(Math.min(...got.pixels.map(bg => contrast(got.meta, bg))), `${label} 画布辅助文字`).toBeGreaterThanOrEqual(4.5)
      for (const bg of got.buttonStates) {
        expect(contrast(got.buttonText, bg), `${label} 主按钮文字`).toBeGreaterThanOrEqual(4.5)
      }
      rendered[theme].push(got.pixels)
    }
    for (let i = 0; i < ACCENTS.length; i++) {
      for (let j = i + 1; j < ACCENTS.length; j++) {
        const label = `${theme}: ${ACCENTS[i]} / ${ACCENTS[j]}`
        expect(distance(rendered[theme][i], rendered[theme][j]), label)
          .toBeGreaterThan(theme === 'paper' || theme === 'snow' ? 2 : 2.5)
      }
    }
  }
  for (let i = 0; i < ACCENTS.length; i++) {
    expect(distance(rendered.paper[i], rendered.snow[i]), `纸/雪 × ${ACCENTS[i]}`).toBeGreaterThan(3)
    expect(distance(rendered.ink[i], rendered.slate[i]), `墨/岩 × ${ACCENTS[i]}`).toBeGreaterThan(7)
  }
})
