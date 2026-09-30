import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, openSettings, settingsTab, visiblePane } from '../helpers'

/** v2 双轴：2 底色 × 4 accent。
 *  底色锚点（bg/text）与 accent 锚点（--accent）分别对应 global.css 的
 *  底色块和 [data-theme=x][data-accent=y] 覆盖层。
 *  bg/text 用 rgb()：那是 body 计算后的样式。accent 用 #hex：
 *  自定义属性读回来的是令牌原文，浏览器不会帮你转成 rgb()。 */
const BASES = {
  paper: { bg: 'rgb(248, 248, 247)', text: 'rgb(51, 50, 48)' },
  ink:   { bg: 'rgb(35, 34, 30)',    text: 'rgb(230, 228, 222)' },
} as const

const ACCENT_HEX = {
  paper: { ink: '#3d5a80', celadon: '#3d7355', clay: '#9a5b33', plum: '#5f62b8' },
  ink:   { ink: '#89a8cd', celadon: '#7fb89a', clay: '#d09a6a', plum: '#9ba0e8' },
} as const

type BaseId = keyof typeof BASES
type AccentId = keyof typeof ACCENT_HEX.paper

const ACCENT_NAMES: Record<AccentId, string> = {
  ink: '墨蓝', celadon: '青瓷', clay: '赭石', plum: '紫罗',
}

const readAnchors = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.body)
    const root = getComputedStyle(document.documentElement)
    return {
      theme: document.documentElement.getAttribute('data-theme'),
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
    expect(got.accent).toBe(ACCENT_HEX.paper.ink)
  })

  test('已存的外观在首屏之前就挂上，不走默认色', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'ink', accent: 'clay' } })
    const got = await readAnchors(page)
    expect(got.theme).toBe('ink')
    expect(got.accentAttr).toBe('clay')
    // 挂载前就 await 过 get_setting，所以这一次读取发生在 createApp 之前
    expect(await e2e.count(page, 'get_setting')).toBeGreaterThanOrEqual(1)
    expect(got.bg).toBe(BASES.ink.bg)
    expect(got.accent).toBe(ACCENT_HEX.ink.clay)
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
      expect(got.accent, legacy).toBe(ACCENT_HEX[base][accent])
    }
  })

  test('认不出的值整套回落默认，不抛错', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'no-such-theme', accent: 'no-such-accent' } })
    const got = await readAnchors(page)
    expect(got.theme).toBe('paper')
    expect(got.accentAttr).toBe('ink')
  })

  test('两张底色卡 + 四枚 accent 丸，点一张立刻换色并落盘', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip')).toHaveCount(2)
    await expect(dialog.locator('.accent-pill')).toHaveCount(4)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('纸')

    await dialog.locator('.theme-chip', { hasText: '墨' }).click()
    await expectToast(page, '已切换主题')
    expect((await e2e.snapshot(page)).settings.theme).toBe('ink')
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('ink')
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
      .toBe(ACCENT_HEX.paper.celadon)
    await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText('青瓷')
    await waitForToastGone(page)
  })

  test('八组配色轮换，锚点色各不相同', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    const seen: Record<string, string> = {}
    for (const base of Object.keys(BASES) as BaseId[]) {
      await dialog.locator('.theme-chip', { hasText: base === 'paper' ? '纸' : '墨' }).click()
      await waitForToastGone(page)
      for (const accent of Object.keys(ACCENT_NAMES) as AccentId[]) {
        await dialog.locator(`.accent-pill[data-accent-id="${accent}"]`).click()
        await waitForToastGone(page)
        const got = await readAnchors(page)
        const label = `${base}/${accent}`
        expect(got.theme, label).toBe(base)
        expect(got.accentAttr, label).toBe(accent)
        expect(got.bg, `${label} 底色`).toBe(BASES[base].bg)
        expect(got.text, `${label} 文字`).toBe(BASES[base].text)
        expect(got.accent, `${label} 主色`).toBe(ACCENT_HEX[base][accent])
        seen[label] = `${got.bg}|${got.accent}`
      }
    }
    expect(new Set(Object.values(seen)).size).toBe(8)
  })

  test('刷新后仍是选的那组', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'ink', accent: 'plum' } })
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('墨')
    await expect(dialog.locator('.accent-pill[aria-checked="true"] .accent-name')).toHaveText('紫罗')
  })

  test('toast 跟着底色翻面：墨底是亮底暗字', async ({ page }) => {
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

    expect(await probeToast('7')).toEqual({ bg: 'rgb(239, 237, 232)', color: 'rgb(47, 125, 82)' })

    await settingsTab(dialog, 'appearance')
    await dialog.locator('.theme-chip', { hasText: '纸' }).click()
    await waitForToastGone(page)
    await settingsTab(dialog, 'security')
    expect(await probeToast('8')).toEqual({ bg: 'rgb(38, 36, 31)', color: 'rgb(156, 196, 174)' })
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
    expect(new Set(stops)).toEqual(new Set(['rgb(139, 142, 205)', 'rgb(95, 98, 184)', 'rgb(63, 66, 128)']))
    // 重复 id 会让第二个 logo 静默套用第一个的渐变：不报错，只是颜色不对
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo linearGradient')].map((g) => g.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
