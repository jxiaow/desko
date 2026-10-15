import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, openSettings, settingsTab, visiblePane } from '../helpers'

/** 底色 11 套 × accent 10 档 = 110 组配色，背景氛围独立开关。
 *  底色锚点（bg/text）来自 global.css 的底色块，accent 锚点（--accent）来自
 *  [data-base=x][data-accent=y] 覆盖层——覆盖层挂的是极性，不是底色，
 *  所以 accent 表按 light/dark 两极列，paper 与 snow 共用同一串。
 *  bg/text 用 rgb()：那是 body 计算后的样式。accent 用 #hex：
 *  自定义属性读回来的是令牌原文，浏览器不会帮你转成 rgb()。 */
const BASES = {
  purewhite: { name: '素白', pol: 'light', bg: 'rgb(250, 250, 250)', text: 'rgb(44, 44, 44)' },
  warmgray: { name: '暖灰', pol: 'light', bg: 'rgb(245, 244, 241)', text: 'rgb(52, 51, 47)' },
  charcoal: { name: '炭黑', pol: 'dark', bg: 'rgb(36, 36, 36)', text: 'rgb(232, 232, 232)' },
  paper: { name: '纸', pol: 'light', bg: 'rgb(248, 245, 240)', text: 'rgb(51, 50, 48)' },
  snow:  { name: '雪', pol: 'light', bg: 'rgb(241, 242, 243)', text: 'rgb(26, 27, 29)' },
  linen: { name: '绢', pol: 'light', bg: 'rgb(243, 234, 220)', text: 'rgb(60, 51, 40)' },
  mist: { name: '雾', pol: 'light', bg: 'rgb(237, 243, 238)', text: 'rgb(38, 58, 47)' },
  ink:   { name: '墨', pol: 'dark',  bg: 'rgb(29, 28, 26)',    text: 'rgb(230, 228, 222)' },
  slate: { name: '岩', pol: 'dark',  bg: 'rgb(37, 41, 50)',    text: 'rgb(237, 240, 246)' },
  midnight: { name: '夜', pol: 'dark', bg: 'rgb(20, 30, 46)', text: 'rgb(228, 236, 247)' },
  moss: { name: '苔', pol: 'dark', bg: 'rgb(29, 41, 34)', text: 'rgb(228, 238, 231)' },
} as const

const ACCENT_HEX = {
  light: { ink: '#315f9b', celadon: '#246e60', clay: '#9b562b', plum: '#7951a8', rose: '#9b3f68', teal: '#126b83', forest: '#456d25', amber: '#886008', coral: '#ac443c', graphite: '#56616d' },
  dark:  { ink: '#7faeee', celadon: '#73c5ad', clay: '#e1a15f', plum: '#bd9ae0', rose: '#e991b6', teal: '#71c8e1', forest: '#a7c97b', amber: '#e9c463', coral: '#f09c92', graphite: '#b5bec9' },
} as const

type BaseId = keyof typeof BASES
type AccentId = keyof typeof ACCENT_HEX.light

const ACCENT_NAMES: Record<AccentId, string> = {
  ink: '墨蓝', celadon: '青瓷', clay: '赭石', plum: '紫罗', rose: '暮瑰', teal: '碧青', forest: '松绿', amber: '琥珀', coral: '珊瑚', graphite: '石墨',
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
  test('没存过外观时用默认：纸底 × 墨蓝', async ({ page }) => {
    await bootUnlocked(page)
    const got = await readAnchors(page)
    expect(got.theme).toBe('paper')
    expect(got.accentAttr).toBe('ink')
    expect(got.bg).toBe(BASES.paper.bg)
    expect(got.text).toBe(BASES.paper.text)
    expect(got.base).toBe('light')
    expect(got.accent).toBe(accentOf('paper', 'ink'))
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

  test('十一张底色卡 + 十枚 accent 丸，点一张立刻换色并落盘', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip')).toHaveCount(11)
    await expect(dialog.locator('.accent-pill')).toHaveCount(10)
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
    await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText('青瓷')
    await waitForToastGone(page)
  })

  for (const base of Object.keys(BASES) as BaseId[]) {
    test(`${BASES[base].name}主题：十种强调色都能切换、保存并匹配预览`, async ({ page }) => {
      await bootUnlocked(page, { settings: { theme: base } })
      const dialog = await openSettings(page)
      const seen = new Set<string>()
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
          return { app: app.backgroundImage, preview: miniature.backgroundImage, nav: nav.backgroundColor, previewNav: miniatureNav.backgroundColor }
        }, base)
        const relativeField = surfaces.app.replace(/([\d.]+)vw/g, '$1%').replace(/([\d.]+)vh/g, '$1%')
        expect(surfaces.preview, `${label} 预览画布`).toBe(relativeField)
        expect(surfaces.previewNav, `${label} 预览导航`).toBe(surfaces.nav)
        expect(await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()), `${label} 预览强调色`).toBe(got.accent)
        seen.add(`${got.bg}|${got.accent}`)
      }
      expect(seen.size).toBe(10)
    })
  }

  test('刷新后仍是选的那组', async ({ page }) => {
    for (const [theme, accent] of [['ink', 'plum'], ['linen', 'amber'], ['mist', 'graphite'], ['midnight', 'teal'], ['moss', 'forest']] as const) {
      await bootUnlocked(page, { settings: { theme, accent } })
      const dialog = await openSettings(page)
      await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText(BASES[theme].name)
      await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText(ACCENT_NAMES[accent])
      expect(await readAnchors(page)).toMatchObject({ theme, base: BASES[theme].pol, accentAttr: accent, accent: accentOf(theme, accent) })
    }
  })

  test('toast 跟着极性翻面：暗极性是亮底暗字，亮极性反过来', async ({ page }) => {
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

    // 四套底色各留一档 toast 值：暗极性反转成亮底，且 ink 暖白 / slate 冷白差在 B 通道
    const EXPECT: Record<BaseId, { bg: string; color: string }> = {
      purewhite: { bg: 'rgb(31, 33, 36)', color: 'rgb(145, 201, 166)' },
      warmgray: { bg: 'rgb(38, 36, 31)', color: 'rgb(156, 196, 174)' },
      charcoal: { bg: 'rgb(239, 237, 232)', color: 'rgb(47, 125, 82)' },
      ink:   { bg: 'rgb(239, 237, 232)', color: 'rgb(47, 125, 82)' },
      slate: { bg: 'rgb(238, 240, 245)', color: 'rgb(47, 125, 82)' },
      paper: { bg: 'rgb(38, 36, 31)', color: 'rgb(156, 196, 174)' },
      snow:  { bg: 'rgb(31, 33, 36)', color: 'rgb(145, 201, 166)' },
      linen: { bg: 'rgb(53, 45, 36)', color: 'rgb(156, 196, 174)' },
      mist: { bg: 'rgb(32, 52, 43)', color: 'rgb(145, 201, 166)' },
      midnight: { bg: 'rgb(232, 238, 247)', color: 'rgb(47, 125, 82)' },
      moss: { bg: 'rgb(233, 241, 233)', color: 'rgb(47, 125, 82)' },
    }
    const order: BaseId[] = ['ink', 'slate', 'paper', 'snow', 'linen', 'mist', 'midnight', 'moss']
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
    expect(new Set(stops)).toEqual(new Set(['rgb(161, 123, 199)', 'rgb(121, 81, 168)', 'rgb(80, 52, 115)']))
    // 重复 id 会让第二个 logo 静默套用第一个的渐变：不报错，只是颜色不对
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo linearGradient')].map((g) => g.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
