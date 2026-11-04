import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const atmosphere of ['true', 'false']) {
  for (const accent of ['ink', 'plum']) {
    test(`暗色 ${accent} 氛围 ${atmosphere} 标题栏与正文背景衔接`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await bootUnlocked(page, { settings: { theme: 'ink', accent, background_atmosphere: atmosphere, mfa_enabled: 'true' } }, '/mfa')
      await expect(page.locator('.mfa-empty-state')).toBeVisible()
      const backgrounds = await page.evaluate(() => ['.titlebar-outer', '.workspace-surface'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector)!)
        return { color: style.backgroundColor, image: style.backgroundImage, attachment: style.backgroundAttachment }
      }))
      expect(backgrounds[0]).toEqual(backgrounds[1])
      if (atmosphere === 'true') {
        expect(backgrounds[0].image).not.toBe('none')
        expect(await page.locator('.workspace-main').evaluate(el => getComputedStyle(el, '::before').backgroundImage)).toBe(backgrounds[1].image)
      }
      else expect(backgrounds[0].image).toBe('none')
      await page.screenshot({ path: `.tmp/dark-titlebar/${accent}-${atmosphere}.png`, animations: 'disabled' })
    })
  }
}
