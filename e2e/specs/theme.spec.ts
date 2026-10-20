import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, openSettings, settingsTab, visiblePane } from '../helpers'
import { lab } from '../../scripts/lib/theme-tokens.mjs'

// 正式桌面使用两套底色和十一种强调色；通过真实设置入口验证全部组合。
const BASES = {
  paper: { name: '纸', pol: 'light', bg: 'rgb(252, 252, 252)', text: 'rgb(36, 35, 33)' },
  ink: { name: '墨', pol: 'dark', bg: 'rgb(30, 30, 29)', text: 'rgb(206, 205, 200)' },
} as const
const ACCENT_HEX = {
  light: { ink: '#536d85', celadon: '#52735b', clay: '#97644b', plum: '#7f6489', rose: '#9c5875', amber: '#87702e', graphite: '#646b70', sage: '#3e6d53', sky: '#3e6988', lavender: '#70548d', peach: '#915848' },
  dark: { ink: '#94a9c0', celadon: '#97b59a', clay: '#bfa185', plum: '#b5a0c1', rose: '#c59aad', amber: '#c1ad78', graphite: '#abadad', sage: '#9ccbb1', sky: '#9ac5e4', lavender: '#c7b1e4', peach: '#d9b09e' },
} as const

type BaseId = keyof typeof BASES
type AccentId = keyof typeof ACCENT_HEX.light

const ACCENT_NAMES: Record<AccentId, string> = {
  ink: '蓝', celadon: '绿', clay: '橙', plum: '紫', rose: '玫瑰', amber: '琥珀', graphite: '灰', sage: '鼠尾草', sky: '雾蓝', lavender: '薰衣草', peach: '蜜桃',
}

/** 底色档的 accent 主色：查的是那一极的覆盖层 */
const accentOf = (base: BaseId, accent: AccentId) => ACCENT_HEX[BASES[base].pol][accent]

const readAnchors = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.body)
    const root = getComputedStyle(document.documentElement)
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      base: document.documentElement.getAttribute('data-base'),
      accentAttr: document.documentElement.getAttribute('data-accent'),
      bg: s.backgroundColor,
      text: s.color,
      accent: root.getPropertyValue('--accent').trim(),
    }
  })

test.describe('主题', () => {
  test('没存过外观时用默认：纸底 × 蓝，背景保持纯色', async ({ page }) => {
    await bootUnlocked(page)
    const got = await readAnchors(page)
    expect(got.theme).toBe('paper')
    expect(got.accentAttr).toBe('ink')
    expect(got.bg).toBe(BASES.paper.bg)
    expect(got.text).toBe(BASES.paper.text)
    expect(got.base).toBe('light')
    expect(got.accent).toBe(accentOf('paper', 'ink'))
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'off')
    await expect(page.locator('.app-root')).toHaveCSS('background-image', 'none')
    const dialog = await openSettings(page)
    await expect(dialog.getByRole('switch', { name: '背景氛围' })).not.toBeChecked()
  })

  test('已存的外观在首屏之前就挂上，不走默认色', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'ink', accent: 'clay' } })
    const got = await readAnchors(page)
    expect(got.theme).toBe('ink')
    expect(got.accentAttr).toBe('clay')
    // 挂载前就 await 过 get_setting，所以这一次读取发生在 createApp 之前
    expect(await e2e.count(page, 'get_setting')).toBeGreaterThanOrEqual(1)
    expect(got.bg).toBe(BASES.ink.bg)
    expect(got.base).toBe('dark')
    expect(got.accent).toBe(accentOf('ink', 'clay'))
  })

  test('库里存着的旧主题 ID 在读取时迁移，不闪默认色', async ({ page }) => {
    for (const legacy of ['dark', 'dark-carbon', 'cyber-hacker', 'linear-dark', 'jetbrains-dark', 'matte-obsidian']) {
      await bootUnlocked(page, { settings: { theme: legacy } })
      const got = await readAnchors(page)
      expect(got.theme, legacy).toBe('ink')
      expect(got.bg, legacy).toBe(BASES.ink.bg)
    }
  })

  test('旧主题 ID 同时带走就近的 accent 档', async ({ page }) => {
    const cases: Array<[string, BaseId, AccentId]> = [
      ['light-cool', 'paper', 'ink'],
      ['light-warm', 'paper', 'clay'],
      ['light-celadon', 'paper', 'celadon'],
      ['nordic-sage', 'paper', 'celadon'],
      ['linear-dark', 'ink', 'plum'],
      ['swiss-monochrome', 'paper', 'ink'],
      ['cool', 'paper', 'ink'],
      ['pure-canvas', 'paper', 'ink'],
    ]
    for (const [legacy, base, accent] of cases) {
      await bootUnlocked(page, { settings: { theme: legacy } })
      const got = await readAnchors(page)
      expect(got.theme, legacy).toBe(base)
      expect(got.accent, legacy).toBe(accentOf(base, accent))
    }
  })

  test('认不出的值整套回落默认，不抛错', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'no-such-theme', accent: 'no-such-accent' } })
    const got = await readAnchors(page)
    expect(got.theme).toBe('paper')
    expect(got.accentAttr).toBe('ink')
  })

  test('两张底色卡 + 十一枚 accent 丸，点一张立刻换色并落盘', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip')).toHaveCount(2)
    await expect(dialog.locator('.theme-chip-name')).toHaveText(['纸', '墨'])
    await expect(dialog.locator('.accent-pill')).toHaveCount(11)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('纸')

    await dialog.locator('.theme-chip', { hasText: '墨' }).click()
    await expectToast(page, '已切换主题')
    expect((await e2e.snapshot(page)).settings.theme).toBe('ink')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ink')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-base'))).toBe('dark')
    // 切换有 0.2s 底色补间（theme-anim），computed style 要等过渡结束才是终值
    await expect(page.locator('body')).toHaveCSS('background-color', BASES.ink.bg)
    await expect(page.locator('body')).toHaveCSS('color', BASES.ink.text)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('墨')
    await waitForToastGone(page)
  })

  test('绢和更早的杏色设置归并到纸，保留强调色与柔光，不在读取时改写旧值', async ({ page }) => {
    for (const theme of ['linen', 'apricot']) {
      await bootUnlocked(page, { settings: { theme, accent: 'sage', background_atmosphere: 'true' } })
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper')
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage')
      await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'on')
      await expect(page.locator('body')).toHaveCSS('background-color', BASES.paper.bg)
      const dialog = await openSettings(page)
      await expect(dialog.locator('.theme-chip')).toHaveCount(2)
      await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('纸')
      expect((await e2e.snapshot(page)).settings.theme).toBe(theme)
      await dialog.locator('.theme-chip', { hasText: '墨' }).click()
      await dialog.locator('.theme-chip', { hasText: '纸' }).click()
      expect((await e2e.snapshot(page)).settings.theme).toBe('paper')
      await page.keyboard.press('Escape')
    }
  })

  test('accent 丸换色不换底：只动强调族并单独落盘', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)

    await dialog.locator('.accent-pill[data-accent-id="celadon"]').click()
    await expectToast(page, '已切换强调色')
    expect((await e2e.snapshot(page)).settings.accent).toBe('celadon')
    await expect(page.locator('body')).toHaveCSS('background-color', BASES.paper.bg)
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()))
      .toBe(accentOf('paper', 'celadon'))
    await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText('绿')
    await waitForToastGone(page)
  })

  for (const base of Object.keys(BASES) as BaseId[]) {
    test(`${BASES[base].name}主题：十一种强调色都能切换、保存并匹配预览`, async ({ page }) => {
      await bootUnlocked(page, { settings: { theme: base } })
      const dialog = await openSettings(page)
      const seen = new Set<string>()
      const swatches: Array<{ id: string; color: [number, number, number] }> = []
      for (const accent of Object.keys(ACCENT_NAMES) as AccentId[]) {
        await dialog.locator(`.accent-pill[data-accent-id="${accent}"]`).click()
        await waitForToastGone(page)
        const got = await readAnchors(page)
        const label = `${base}/${accent}`
        expect(got.theme, label).toBe(base)
        expect(got.base, `${label} 极性`).toBe(BASES[base].pol)
        expect(got.accentAttr, label).toBe(accent)
        expect(got.bg, `${label} 底色`).toBe(BASES[base].bg)
        expect(got.text, `${label} 文字`).toBe(BASES[base].text)
        expect(got.accent, `${label} 主色`).toBe(accentOf(base, accent))
        expect((await e2e.snapshot(page)).settings.accent ?? 'ink').toBe(accent)
        const preview = dialog.locator(`.theme-prev[data-theme="${base}"]`)
        const surfaces = await page.evaluate((base) => {
          const preview = document.querySelector(`.theme-prev[data-theme="${base}"]`)!
          const app = getComputedStyle(document.querySelector('.app-root')!)
          const nav = getComputedStyle(document.querySelector('.sidebar')!)
          const miniature = getComputedStyle(preview)
          const miniatureNav = getComputedStyle(preview.querySelector('.tp-rail')!)
          return { app: app.backgroundImage, preview: miniature.backgroundImage, nav: nav.backgroundColor, previewNav: miniatureNav.backgroundColor, swatch: getComputedStyle(preview.querySelector('.tp-row-tag')!).backgroundColor }
        }, base)
        // 预览独立缩放、定位；光场各色标的颜色与强度须与工作区一致。
        const fieldColors = (image: string) => image.match(/(?:color|rgba?)\([^)]*\)/g)
        expect(fieldColors(surfaces.preview), `${label} 预览画布`).toEqual(fieldColors(surfaces.app))
        expect(surfaces.previewNav, `${label} 预览导航`).toBe(surfaces.nav)
        expect(await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()), `${label} 预览强调色`).toBe(got.accent)
        swatches.push({ id: accent, color: surfaces.swatch.match(/[\d.]+/g)!.slice(0, 3).map(Number) as [number, number, number] })
        seen.add(`${got.bg}|${got.accent}`)
      }
      expect(seen.size).toBe(11)
      for (const [i, a] of swatches.entries()) for (const b of swatches.slice(i + 1)) {
        const x = lab(a.color), y = lab(b.color)
        expect(Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b), `${base}: ${a.id}/${b.id} 实际强调色辨识`).toBeGreaterThan(2)
      }
    })
  }

  test('刷新后仍是选的那组', async ({ page }) => {
    for (const [theme, accent] of [['ink', 'plum'], ['paper', 'amber'], ['paper', 'graphite'], ['ink', 'sky'], ['paper', 'sage']] as const) {
      await bootUnlocked(page, { settings: { theme, accent } })
      const dialog = await openSettings(page)
      await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText(BASES[theme].name)
      await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText(ACCENT_NAMES[accent])
      expect(await readAnchors(page)).toMatchObject({ theme, base: BASES[theme].pol, accentAttr: accent, accent: accentOf(theme, accent) })
    }
  })

  test('toast 随当前主题变化，墨使用低亮度底色', async ({ page }) => {
    // 自动锁定行要有值才可用，否则数字框跟着开关一起禁用
    await bootUnlocked(page, { settings: { theme: 'ink', accent: 'plum', auto_lock_timeout: '5' } })
    const dialog = await openSettings(page, 'security')

    // 改自动锁定并失焦提交，这是成本最低的"必出一条 toast"的路径。
    // 每次传不同值：input 的 change 只在内容真的变了时才触发。
    const probeToast = async (minutes: string) => {
      await visiblePane(dialog).locator('.number-input').fill(minutes)
      await dialog.locator('h2').click()
      const toast = page.locator('.toast.success')
      await expect(toast).toBeVisible()
      const style = await toast.evaluate((el) => {
        const s = getComputedStyle(el)
        return { bg: s.backgroundColor, color: s.color }
      })
      await waitForToastGone(page)
      return style
    }

    const EXPECT: Record<BaseId, { bg: string; color: string }> = {
      ink: { bg: 'rgb(37, 37, 36)', color: 'rgb(154, 181, 165)' },
      paper: { bg: 'rgb(38, 36, 31)', color: 'rgb(156, 196, 174)' },
    }
    const order: BaseId[] = ['ink', 'paper']
    for (const [i, base] of order.entries()) {
      await settingsTab(dialog, 'appearance')
      await dialog.locator('.theme-chip', { hasText: BASES[base].name }).click()
      await waitForToastGone(page)
      await settingsTab(dialog, 'security')
      expect(await probeToast(String(7 + i)), base).toEqual(EXPECT[base])
    }
  })

  test('品牌标渐变读主题令牌，多实例的 id 互不相同', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'paper', accent: 'plum' } })
    // 打开设置后同屏有三个 logo（应用侧栏 + 菜单抬头 + 关于区），正是 id 撞车会暴露的场合
    const dialog = await openSettings(page, 'about')
    await expect(dialog.locator('.about-logo .brand-logo')).toBeVisible()
    const stops = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo stop')].map((s) => getComputedStyle(s).stopColor),
    )
    expect(stops.length).toBeGreaterThanOrEqual(6)
    expect(new Set(stops).size).toBe(3)
    expect(stops.every(color => !color.includes('0, 0, 0, 0'))).toBe(true)
    // 重复 id 会让第二个 logo 静默套用第一个的渐变：不报错，只是颜色不对
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo linearGradient')].map((g) => g.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
