import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked } from '../helpers'

const longHtml = Array.from({ length: 60 }, (_, i) => `<p>第 ${i + 1} 段：编辑长小记，保留正文与光标位置。</p>`).join('')

for (const theme of ['paper', 'ink']) {
  for (const variant of ['composer', 'card', 'full']) {
    test(`${theme} ${variant} 长正文可回到顶部，正文与选区不变`, async ({ page }) => {
      await page.setViewportSize({ width: 1040, height: 670 })
      await bootUnlocked(page, { settings: { theme }, notes: [{ title: '长小记', content_html: longHtml }] }, '/notes')
      if (variant !== 'composer') {
        await page.locator('.memo').hover()
        await page.locator('.memo').getByRole('button', { name: '编辑', exact: true }).click()
        if (variant === 'full') await page.locator('.memo.editing').getByRole('button', { name: '全屏书写', exact: true }).click()
      }
      const scope = page.locator(variant === 'composer' ? '.composer' : variant === 'card' ? '.memo.editing' : '.fs')
      const pm = scope.locator('.ProseMirror')
      await pm.evaluate((el, html) => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        if (html) editor.commands.setContent(html)
        editor.commands.focus('end')
      }, variant === 'composer' ? longHtml : '')
      const snapshot = () => pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        return { html: editor.getHTML(), from: editor.state.selection.from, to: editor.state.selection.to }
      })
      const before = await snapshot()
      const scroll = variant === 'full' ? scope.locator('.fs-scroll') : pm
      await scroll.evaluate(el => { el.scrollTop = 0 })
      const top = scope.getByRole('button', { name: '回到顶部', exact: true })
      await expect(top).toHaveCount(0)
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight })
      await expect(top).toBeVisible()
      if (variant === 'full') {
        await top.focus()
        await top.press('Enter')
      } else await top.click()
      await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0)
      await expect(top).toHaveCount(0)
      await expect(pm).toBeFocused()
      expect(await snapshot()).toEqual(before)
    })
  }
}
