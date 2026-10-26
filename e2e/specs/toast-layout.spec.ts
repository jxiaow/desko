import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const theme of ['paper', 'ink']) {
  for (const width of [520, 1280]) {
    test(`${theme} ${width}px 长提示不溢出正文，图标完整，多行内容可读`, async ({ page }) => {
      await page.setViewportSize({ width, height: 670 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      let toastUrl = ''
      page.on('request', request => { if (new URL(request.url()).pathname === '/src/stores/toast.ts') toastUrl = request.url() })
      // 目录只在有内容时挂载（空库 Ctrl+B 空转），这里要的是「固定目录」那颗钮
      await bootUnlocked(page, { settings: { theme }, notes: [{ title: '种子', content_html: '<p>正文</p>' }] }, '/notes')
      await page.keyboard.press('Control+b')
      await page.getByRole('button', { name: '固定目录', exact: true }).click()
      for (const [index, message] of [
        '请求失败：https://example.invalid/' + 'long-path-without-spaces-'.repeat(30),
        '导入结果：部分账号未能完成。'.repeat(20),
        Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 项：导入失败，请检查路径和连接状态。`).join('\n'),
      ].entries()) {
        await page.evaluate(async ([url, message]) => (await import(/* @vite-ignore */ url)).useToastStore().showToast(message, 'error'), [toastUrl, message])
        const toast = page.locator('.toast.error')
        await expect(toast).toBeVisible()
        await expect.poll(async () => (await toast.boundingBox())!.y).toBe(52)
        const main = (await page.locator('.workspace-body > .main-content').boundingBox())!
        const box = (await toast.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(main.x + 10)
        expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width - 10)
        expect(box.y).toBe(52)
        expect(box.height).toBeLessThanOrEqual(240)
        expect(await toast.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        const icon = (await toast.locator('svg').boundingBox())!
        expect(icon.width).toBe(13)
        expect(icon.height).toBe(13)
        const text = toast.locator('.toast-message')
        await expect(text).toHaveText(message)
        expect(await text.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        const textBox = (await text.boundingBox())!
        expect(icon.x + icon.width).toBeLessThan(textBox.x)
        expect(Math.abs(icon.y + icon.height / 2 - textBox.y - 9)).toBeLessThanOrEqual(1)
        if (index === 2) {
          expect(await text.evaluate(element => element.scrollHeight)).toBeGreaterThan(textBox.height)
          expect(await text.evaluate(element => {
            element.scrollTop = element.scrollHeight
            const range = document.createRange()
            range.setStart(element.firstChild!, element.textContent!.length - 8)
            range.setEnd(element.firstChild!, element.textContent!.length)
            const last = range.getBoundingClientRect(), bounds = element.getBoundingClientRect()
            return last.top >= bounds.top && last.bottom <= bounds.bottom + 1
          })).toBe(true)
        }
        await page.screenshot({ path: `.tmp/toast-layout/${theme}-${width}-${index}.png`, animations: 'disabled' })
      }
    })
  }
}
