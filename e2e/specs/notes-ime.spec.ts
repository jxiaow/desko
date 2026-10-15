import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, tipButton } from '../helpers'

const task = (text: string) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>${text}</p></div></li></ul>`

for (const variant of ['composer', 'card', 'full'] as const) {
  test(`Todo 中文逗号：${variant} 在行中、行尾、空项和粗体中支持标点及候选词合并提交`, async ({ page }) => {
    await bootUnlocked(page, { notes: [{ content_html: '<p>待编辑的小记</p>' }] }, '/notes')
    if (variant === 'card') {
      await page.locator('.memo').hover()
      await page.locator('.memo-edit').click()
    } else {
      await page.locator('.composer .ProseMirror').click()
      if (variant === 'full') await tipButton(page.locator('.composer'), '全屏书写').click()
    }
    const pm = page.locator(variant === 'composer' ? '.composer .ProseMirror' : variant === 'card' ? '.memo.editing .ProseMirror' : '.fs .ProseMirror')
    await pm.click()
    await expect(pm).toBeFocused()
    for (const inputText of ['，', '新内容，']) for (const composing of [false, true]) for (const [text, offset] of [['甲乙', 1], ['甲乙', 2], ['', 0], ['<strong>甲乙</strong>', 1], ['<strong>甲乙</strong>', 2]] as const) {
      const before = await pm.evaluate((el, { html, offset }) => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        editor.commands.setContent(html)
        let start = 0
        editor.state.doc.descendants((node, pos) => { if (!start && node.isTextblock) start = pos + 1 })
        editor.commands.setTextSelection(start + offset)
        editor.view.focus()
        return start + offset
      }, { html: task(text), offset })
      if (composing) await pm.dispatchEvent('compositionstart', { data: '' })
      await pm.evaluate((el, { composing, inputText }) => {
        const selection = window.getSelection()!
        let node = selection.focusNode!
        let offset = selection.focusOffset
        if (node.nodeType !== Node.TEXT_NODE) {
          const text = document.createTextNode('')
          node.insertBefore(text, node.childNodes[offset] ?? null)
          node = text
          offset = 0
        }
        // 模拟中文输入法提交标点后，DOM 已插入而选区仍在提交前的位置。
        ;(node as Text).insertData(offset, inputText)
        selection.collapse(node, offset)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: composing ? 'insertCompositionText' : 'insertText', isComposing: composing, data: inputText }))
      }, { composing, inputText })
      const state = () => pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        const selection = window.getSelection()!
        return { text: editor.state.doc.textContent, head: editor.state.selection.head, domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset) }
      })
      const plain = text.replace(/<[^>]*>/g, '')
      if (composing) {
        await expect.poll(async () => (await state()).text).toBe(plain.slice(0, offset) + inputText + plain.slice(offset))
        await pm.dispatchEvent('compositionend', { data: inputText })
      }
      await expect.poll(state, `${variant}/${text}/${offset}/composing:${composing}`).toEqual({ text: plain.slice(0, offset) + inputText + plain.slice(offset), head: before + inputText.length, domHead: before + inputText.length })
      await page.keyboard.insertText('续')
      await expect.poll(state).toEqual({ text: plain.slice(0, offset) + inputText + '续' + plain.slice(offset), head: before + inputText.length + 1, domHead: before + inputText.length + 1 })
    }
    const start = await pm.evaluate((el, html) => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent(html)
      editor.commands.focus('start')
      return editor.state.selection.head
    }, task(''))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '中文，' })
    await page.keyboard.insertText('续')
    await expect.poll(() => pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      return { text: editor.state.doc.textContent, head: editor.state.selection.head }
    })).toEqual({ text: '中文，续', head: start + 4 })
    await cdp.detach()
  })
}
