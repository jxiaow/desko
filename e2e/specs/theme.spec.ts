import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, openSettings, settingsTab, visiblePane } from '../helpers'

/** 每套主题的三个锚点色，与 global.css 的主题块一一对应。
 *  选这三个是因为它们分别代表"面 / 文字 / 主色"，切换时最容易露馅。
 *  bg/text 用 rgb()：那是 body 计算后的样式。accent 用 #hex：
 *  自定义属性读回来的是令牌原文，浏览器不会帮你转成 rgb()。 */
const ANCHORS = {
  cool:    { bg: 'rgb(248, 248, 250)', text: 'rgb(27, 27, 32)',    accent: '#5b57d9' },
  classic: { bg: 'rgb(250, 251, 252)', text: 'rgb(17, 24, 39)',    accent: '#6366f1' },
  white:   { bg: 'rgb(255, 255, 255)', text: 'rgb(24, 24, 27)',    accent: '#4b47c4' },
  dark:    { bg: 'rgb(12, 12, 15)',    text: 'rgb(238, 238, 243)', accent: '#7b77f0' },
} as const

type ThemeId = keyof typeof ANCHORS

const readAnchors = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.body)
    const root = getComputedStyle(document.documentElement)
    return {
      attr: document.documentElement.getAttribute('data-theme'),
      bg: s.backgroundColor,
      text: s.color,
      accent: root.getPropertyValue('--accent').trim(),
    }
  })

test.describe('主题', () => {
  test('没存过主题时用默认的冷灰', async ({ page }) => {
    await bootUnlocked(page)
    const got = await readAnchors(page)
    expect(got.attr).toBe('cool')
    expect(got.bg).toBe(ANCHORS.cool.bg)
    expect(got.text).toBe(ANCHORS.cool.text)
  })

  test('已存的主题在首屏之前就挂上，不走默认色', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'dark' } })
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark')
    // 挂载前就 await 过 get_setting，所以这一次读取发生在 createApp 之前
    expect(await e2e.count(page, 'get_setting')).toBeGreaterThanOrEqual(1)
  })

  test('设置里四张主题卡，点一张立刻换色并落盘', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip')).toHaveCount(4)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('冷灰')

    await dialog.locator('.theme-chip', { hasText: '夜墨' }).click()
    await expectToast(page, '已切换主题')
    expect((await e2e.snapshot(page)).settings.theme).toBe('dark')
    const got = await readAnchors(page)
    expect(got.attr).toBe('dark')
    expect(got.bg).toBe(ANCHORS.dark.bg)
    expect(got.text).toBe(ANCHORS.dark.text)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('夜墨')
    await waitForToastGone(page)
  })

  test('四套主题轮换，三个锚点色各不相同', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page)
    const seen: Record<string, string> = {}
    for (const id of Object.keys(ANCHORS) as ThemeId[]) {
      const name = { cool: '冷灰', classic: '经典', white: '素白', dark: '夜墨' }[id]
      await dialog.locator('.theme-chip', { hasText: name }).click()
      await waitForToastGone(page)
      const got = await readAnchors(page)
      expect(got.attr, id).toBe(id)
      expect(got.bg, `${id} 底色`).toBe(ANCHORS[id].bg)
      expect(got.text, `${id} 文字`).toBe(ANCHORS[id].text)
      expect(got.accent, `${id} 主色`).toBe(ANCHORS[id].accent)
      seen[id] = got.bg
    }
    expect(new Set(Object.values(seen)).size).toBe(4)
  })

  test('刷新后仍是选的那套', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'white' } })
    const dialog = await openSettings(page)
    await expect(dialog.locator('.theme-chip.on .theme-chip-name')).toHaveText('素白')
  })

  test('toast 跟着主题翻面：深色下是亮底暗字', async ({ page }) => {
    // 自动锁定行要有值才可用，否则数字框跟着开关一起禁用
    await bootUnlocked(page, { settings: { theme: 'dark', auto_lock_timeout: '5' } })
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

    expect(await probeToast('7')).toEqual({ bg: 'rgb(240, 240, 245)', color: 'rgb(31, 122, 88)' })

    await settingsTab(dialog, 'appearance')
    await dialog.locator('.theme-chip', { hasText: '冷灰' }).click()
    await waitForToastGone(page)
    await settingsTab(dialog, 'security')
    expect(await probeToast('8')).toEqual({ bg: 'rgb(27, 27, 32)', color: 'rgb(127, 211, 174)' })
  })

  test('品牌标渐变读主题令牌，多实例的 id 互不相同', async ({ page }) => {
    await bootUnlocked(page, { settings: { theme: 'dark' } })
    // 打开设置后同屏有三个 logo（应用侧栏 + 菜单抬头 + 关于区），正是 id 撞车会暴露的场合
    const dialog = await openSettings(page, 'about')
    await expect(dialog.locator('.about-logo .brand-logo')).toBeVisible()
    const stops = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo stop')].map((s) => getComputedStyle(s).stopColor),
    )
    expect(stops.length).toBeGreaterThanOrEqual(6)
    expect(new Set(stops)).toEqual(new Set(['rgb(143, 138, 255)', 'rgb(111, 106, 228)', 'rgb(74, 69, 184)']))
    // 重复 id 会让第二个 logo 静默套用第一个的渐变：不报错，只是颜色不对
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('.brand-logo linearGradient')].map((g) => g.id),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })
})
