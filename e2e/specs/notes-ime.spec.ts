import { test, expect } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, tipButton } from '../helpers'

const task = (text: string) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>${text}</p></div></li></ul>`
const commits = [['，', 0], ['新内容，', 0], ['新内容，', 1], ['新内容，', 3], ['”', 0], ['）', 0], ['…', 0]] as const
const taskLines = [['甲乙', 1], ['甲乙', 2], ['', 0], ['<strong>甲乙</strong>', 1], ['<strong>甲乙</strong>', 2]] as const

for (const variant of ['composer', 'card', 'full'] as const) {
  test(`Todo 中文标点：${variant} 在行中、行尾、空项和粗体中支持标点及候选词合并提交`, async ({ page }) => {
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
    for (const [inputText, caretOffset] of commits) for (const composition of ['none', 'end-before-flush', 'end-after-flush']) for (const [text, offset] of taskLines) {
      const before = await pm.evaluate((el, { html, offset }) => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        editor.commands.setContent(html)
        let start = 0
        editor.state.doc.descendants((node, pos) => { if (!start && node.isTextblock) start = pos + 1 })
        editor.commands.setTextSelection(start + offset)
        editor.view.focus()
        return start + offset
      }, { html: task(text), offset })
      const composing = composition !== 'none'
      if (composing) await pm.evaluate(el => el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })))
      await pm.evaluate((el, { composition, composing, inputText, caretOffset }) => {
        const selection = window.getSelection()!
        let node = selection.focusNode!
        let offset = selection.focusOffset
        if (node.nodeType !== Node.TEXT_NODE) {
          const text = document.createTextNode('')
          node.insertBefore(text, node.childNodes[offset] ?? null)
          node = text
          offset = 0
        }
        // 提交后光标可能留在整段输入起点，也可能已到文字末尾、仍在逗号前。
        ;(node as Text).insertData(offset, inputText)
        selection.collapse(node, offset + caretOffset)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: composing ? 'insertCompositionText' : 'insertText', isComposing: composing, data: inputText }))
        if (composition === 'end-before-flush') el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: inputText }))
      }, { composition, composing, inputText, caretOffset })
      const state = () => pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        const selection = window.getSelection()!
        return { text: editor.state.doc.textContent, head: editor.state.selection.head, domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset) }
      })
      const plain = text.replace(/<[^>]*>/g, '')
      if (composition === 'end-after-flush') {
        await expect.poll(async () => (await state()).text).toBe(plain.slice(0, offset) + inputText + plain.slice(offset))
        await pm.evaluate((el, data) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data })), inputText)
      }
      await expect.poll(state, `${variant}/${text}/${offset}/${composition}/caret:${caretOffset}`).toEqual({ text: plain.slice(0, offset) + inputText + plain.slice(offset), head: before + inputText.length, domHead: before + inputText.length })
      await page.keyboard.insertText('续')
      await expect.poll(state).toEqual({ text: plain.slice(0, offset) + inputText + '续' + plain.slice(offset), head: before + inputText.length + 1, domHead: before + inputText.length + 1 })
    }
    // 成对补全时保留符号中间的合法落点，不能把后续文字推到右括号之外。
    for (const pair of ['（）', '“”', '【】']) {
      await pm.evaluate((el, { html, pair }) => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        editor.commands.setContent(html)
        editor.commands.focus('start')
        editor.commands.setTextSelection(editor.state.selection.head + 1)
        const selection = window.getSelection()!
        const node = selection.focusNode as Text
        const offset = selection.focusOffset
        node.insertData(offset, pair)
        selection.collapse(node, offset + 1)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: pair }))
      }, { html: task('甲乙'), pair })
      await expect.poll(() => pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        return editor.state.doc.textBetween(editor.state.selection.head, editor.state.selection.head + 1)
      })).toBe(pair[1])
      await page.keyboard.insertText('续')
      await expect.poll(() => pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.state.doc.textContent)).toBe(`甲${pair[0]}续${pair[1]}乙`)
    }
    const start = await pm.evaluate((el, html) => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent(html)
      editor.commands.focus('start')
      return editor.state.selection.head
    }, task(''))
    const cdp = await page.context().newCDPSession(page)
    // 候选仍在合成时允许光标停在文字中间，不能按已提交的标点强行移到末尾。
    await cdp.send('Input.imeSetComposition', { text: '中文候选，', selectionStart: 2, selectionEnd: 2 })
    await expect.poll(() => pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      const selection = window.getSelection()!
      return { text: editor.state.doc.textContent, head: editor.state.selection.head, domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset), composing: editor.view.composing }
    })).toEqual({ text: '中文候选，', head: start + 2, domHead: start + 2, composing: true })
    await cdp.send('Input.insertText', { text: '中文候选，' })
    await pm.evaluate((el, html) => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent(html)
      editor.commands.focus('start')
    }, task(''))
    await cdp.send('Input.imeSetComposition', { text: 'zhongwen', selectionStart: 8, selectionEnd: 8 })
    await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.insertText', { text: '中文，' })
    await page.keyboard.insertText('续')
    await expect.poll(() => pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      return { text: editor.state.doc.textContent, head: editor.state.selection.head }
    })).toEqual({ text: '中文，续', head: start + 4 })
    await cdp.detach()

    // 提交中文时会替换已有的拼音范围，编辑器原选区在范围末尾，而非替换起点。
    const replacement = await pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>甲xin乙</p></div></li></ul>')
      editor.commands.focus('start')
      const start = editor.state.selection.head
      editor.commands.setTextSelection(start + 4)
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      const selection = window.getSelection()!
      const node = selection.focusNode as Text
      node.replaceData(1, 3, '新内容，')
      selection.collapse(node, 4)
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true, data: '新内容，' }))
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '新内容，' }))
      return start
    })
    const replacementState = () => pm.evaluate(el => {
      const editor = (el as HTMLElement & { editor: Editor }).editor
      const selection = window.getSelection()!
      return { text: editor.state.doc.textContent, head: editor.state.selection.head, domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset) }
    })
    await expect.poll(replacementState).toEqual({ text: '甲新内容，乙', head: replacement + 5, domHead: replacement + 5 })
    await page.keyboard.insertText('续')
    await expect.poll(replacementState).toEqual({ text: '甲新内容，续乙', head: replacement + 6, domHead: replacement + 6 })
  })
}
