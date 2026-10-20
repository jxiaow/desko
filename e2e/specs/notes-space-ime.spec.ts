import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, tipButton } from '../helpers'

for (const variant of ['composer', 'card', 'full'] as const) {
  test(`Todo 空格选词后标点二次确认：${variant} 后续文字留在标点后`, async ({ page }) => {
    await bootUnlocked(page, { notes: [{ content_html: '<p>待编辑的小记</p>' }] }, '/notes')
    if (variant === 'card') {
      await page.locator('.memo').hover()
      await page.locator('.memo-edit').click()
    } else {
      await page.locator('.composer .ProseMirror').click()
      if (variant === 'full') await tipButton(page.locator('.composer'), '全屏书写').click()
    }
    const pm = page.locator(variant === 'composer' ? '.composer .ProseMirror' : variant === 'card' ? '.memo.editing .ProseMirror' : '.fs .ProseMirror')
    const state = () => pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      const selection = window.getSelection()!
      return { text: editor.state.doc.textContent, head: editor.state.selection.head, domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset) }
    })
    const cdp = await page.context().newCDPSession(page)
    for (const punctuation of ['，', '。', '！', '；', '）']) for (const timing of ['commit', 'late', 'next-key', 'next-input']) {
      const lateCaret = timing === 'late'
      const start = await pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p></p></div></li></ul>')
        let start = 0
        editor.state.doc.descendants((node, pos) => { if (!start && node.isTextblock) start = pos + 1 })
        editor.commands.setTextSelection(start)
        editor.view.focus()
        return start
      })
      await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
      await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 })
      // 空格确认候选词，正文不插入空格；提交由输入法执行。
      await pm.dispatchEvent('keydown', { key: ' ', code: 'Space', keyCode: 229, isComposing: true })
      await cdp.send('Input.insertText', { text: '你好' })
      await expect.poll(state).toEqual({ text: '你好', head: start + 2, domHead: start + 2 })
      await pm.dispatchEvent('compositionstart', { data: '' })
      await pm.evaluate((el, punctuation) => {
        const selection = window.getSelection()!
        const node = selection.focusNode as Text
        const offset = selection.focusOffset
        node.insertData(offset, punctuation)
        selection.collapse(node, offset + 1)
        el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: punctuation }))
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: punctuation }))
      }, punctuation)
      await expect.poll(state).toEqual({ text: '你好' + punctuation, head: start + 3, domHead: start + 3 })
      // 同一标点确认两次时，正文可不变，原生选区却在确认期间或之后退回。
      await pm.evaluate((el, { punctuation, lateCaret }) => {
        const selection = window.getSelection()!
        const node = selection.focusNode!
        const offset = selection.focusOffset
        const moveCaret = () => selection.collapse(node, offset - 1)
        if (!lateCaret) moveCaret()
        el.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: punctuation }))
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: punctuation }))
        el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: punctuation }))
        if (lateCaret) setTimeout(moveCaret, 5)
      }, { punctuation, lateCaret })
      if (timing === 'next-key' || timing === 'next-input') {
        if (timing === 'next-key') await page.keyboard.press('A')
        else await page.keyboard.insertText('续')
        await expect.poll(state, `${variant}/${punctuation}/${timing}`).toEqual({ text: '你好' + punctuation + (timing === 'next-key' ? 'A' : '续'), head: start + 4, domHead: start + 4 })
        continue
      }
      // 覆盖合成结束后的异步选区清理，避免只断言短暂正确的那一帧。
      await page.waitForTimeout(50)
      await expect.poll(state, `${variant}/${punctuation}/late:${lateCaret}`).toEqual({ text: '你好' + punctuation, head: start + 3, domHead: start + 3 })
      await page.keyboard.insertText('续')
      await expect.poll(state).toEqual({ text: '你好' + punctuation + '续', head: start + 4, domHead: start + 4 })
    }
    await cdp.detach()
  })
}
