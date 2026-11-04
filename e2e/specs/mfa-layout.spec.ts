import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const theme of ['paper', 'ink']) {
  test(`${theme} 验证码空列表与有数据时保持相同页面背景`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { mfa_enabled: 'true', theme }, mfaTokens: [] }, '/mfa')
    await expect(page.locator('.mfa-empty-state')).toBeVisible()
    const backgrounds = () => page.evaluate(() => ['.app-root', '.workspace-surface', '.titlebar'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector)!)
      return { color: style.backgroundColor, image: style.backgroundImage }
    }))
    const empty = await backgrounds()
    await page.screenshot({ path: `.tmp/mfa-background/${theme}-empty.png` })
    await page.getByRole('button', { name: '添加第一个验证码', exact: true }).click()
    await page.locator('.uri-box').fill('otpauth://totp/Example:demo?secret=JBSWY3DPEHPK3PXP&issuer=Example')
    await page.getByRole('dialog', { name: '添加验证码' }).getByRole('button', { name: '添加', exact: true }).click()
    await expect(page.locator('.mfa-card')).toHaveCount(1)
    await expect(page.locator('.mfa-empty-state')).toHaveCount(0)
    expect(await backgrounds()).toEqual(empty)
  })
}

for (const width of [800, 1280]) {
  test(`${width}px 服务与账号分行，八位验证码不挤压倒计时`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await bootUnlocked(page, { settings: { mfa_enabled: 'true' }, mfaTokens: [
      { issuer: 'GitHub', label: 'alice@example.com' },
      { issuer: 'Google Workspace', label: 'work.account@example.com', digits: 8 },
      { issuer: 'Microsoft Azure', label: 'administrator@example.com' },
      { issuer: 'Cloudflare', label: 'team@example.com' },
      { issuer: 'Notion', label: 'personal@example.com' },
      { issuer: 'GitLab', label: 'developer@example.com' },
    ] }, '/mfa')
    await expect(page.locator('.mfa-card')).toHaveCount(6)
    for (const card of await page.locator('.mfa-card').all()) {
      const name = (await card.locator('.card-issuer').boundingBox())!
      const account = (await card.locator('.card-label').boundingBox())!
      const code = (await card.locator('.card-code').boundingBox())!
      const ring = (await card.locator('.ring').boundingBox())!
      expect(account.y).toBeGreaterThanOrEqual(name.y + name.height)
      expect(code.x + code.width).toBeLessThan(ring.x)
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    }
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `.tmp/mfa-layout/${width}.png`, animations: 'disabled' })
  })
}
