import { test, expect, type Locator } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'

async function expectDanger(button: Locator, foreground: string) {
  await expect.poll(() => button.evaluate((element, token) => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--danger-soft)'
    probe.style.color = `var(${token})`
    element.append(probe)
    const actual = getComputedStyle(element)
    const expected = getComputedStyle(probe)
    const matches = actual.backgroundColor === expected.backgroundColor && actual.color === expected.color
    probe.remove()
    return matches
  }, foreground)).toBe(true)
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 的停止按钮在悬停和键盘按下时保持危险态，空格仍可停止服务`, async ({ page }) => {
    await bootUnlocked(page, {
      settings: { theme, accent: 'celadon', fileshare_enabled: 'true', tunnel_enabled: 'true' },
      fileshare: { running: true, boundPort: 8000, shareDirs: ['C:/Work/Shared'] },
      tunnel: { bound: true, alive: true, registered: true, authorized: true, installed: true, services: [{ hostname: 'files.example.com', port: 8000, routed: true, listening: true }] },
    }, '/fileshare')
    for (const id of ['fileshare', 'tunnel']) {
      await page.locator(`a.nav-item[href="/${id}"]`).click()
      const button = page.locator(id === 'fileshare' ? '.service-toggle' : '.toggle-btn')
      await expect(button).toBeEnabled()
      await expect(button).toHaveClass(/ghost-danger/)
      await page.mouse.move(0, 0)
      await expectDanger(button, '--danger')
      await button.hover()
      await expectDanger(button, '--danger-hover')
      await page.mouse.move(0, 0)
      await button.focus()
      await page.keyboard.down('Space')
      await expectDanger(button, '--danger')
      await page.keyboard.up('Space')
      await expect(button).toContainText(id === 'fileshare' ? '启动服务' : '启动隧道')
      expect(await e2e.count(page, `${id}_stop`)).toBe(1)
    }
  })
}

test('墨色卡片的分类和账号小字在常态与悬停时均达到项目对比度基线', async ({ page }) => {
  await bootUnlocked(page, {
    settings: { theme: 'ink', mfa_enabled: 'true' },
    entries: [{ name: '示例收藏', url: 'https://example.com', password: 'demo', category: '工作' }],
    mfaTokens: [{ issuer: 'GitHub', label: 'demo@example.com' }],
  }, '/entries')
  for (const [id, cardSelector, textSelector] of [
    ['entries', '.entry-card', '.ec-cat'],
    ['mfa', '.mfa-card', '.card-label'],
  ]) {
    await page.locator(`a.nav-item[href="/${id}"]`).click()
    const card = page.locator(cardSelector)
    for (const hover of [false, true]) {
      if (hover) await card.hover()
      else await page.mouse.move(0, 0)
      await expect.poll(() => card.locator(textSelector).evaluate(element => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1
        const context = canvas.getContext('2d')!
        const rgb = (color: string) => {
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        const luminance = (color: number[]) => color.map(value => {
          const channel = value / 255
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
        const foreground = luminance(rgb(getComputedStyle(element).color))
        const background = luminance(rgb(getComputedStyle(element.closest('.entry-card, .mfa-card')!).backgroundColor))
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
      })).toBeGreaterThanOrEqual(5.8)
    }
  }
})
