import { test, expect, type Locator } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, e2e, openSettings, tipButton, visiblePane } from '../helpers'

async function paste(pm: Locator, text: string, html = '') {
  await pm.evaluate((element, payload) => {
    const data = new DataTransfer()
    data.setData('text/plain', payload.text)
    if (payload.html) data.setData('text/html', payload.html)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { text, html })
}

test('设置关闭整理后，现有编辑器下一次粘贴保留空行，再开启立即生效', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const pm = page.locator('.composer .ProseMirror')
  const dialog = await openSettings(page, 'notes')
  const toggle = visiblePane(dialog).getByRole('checkbox', { name: '粘贴时整理格式' })
  await expect(toggle).toBeChecked()
  await toggle.locator('..').click()
  await expect(toggle).not.toBeChecked()
  await expect.poll(async () => (await e2e.snapshot(page)).settings.note_paste_cleanup).toBe('false')
  await page.keyboard.press('Escape')
  await pm.click()
  const html = '<p>开头</p><p><br></p><p>&nbsp;</p><p>正文<br><br>下一行</p>'
  await paste(pm, '开头\n\n\n正文\n\n下一行', html)
  await expect(pm.locator('> p')).toHaveCount(4)
  await expect(pm.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(2)
  await pm.press('Control+z')
  await expect(pm).toHaveText('')
  const reopened = await openSettings(page, 'notes')
  const reopenedToggle = visiblePane(reopened).getByRole('checkbox', { name: '粘贴时整理格式' })
  await reopenedToggle.locator('..').click()
  await expect(reopenedToggle).toBeChecked()
  await page.keyboard.press('Escape')
  await pm.click()
  await paste(pm, '开头\n\n\n正文\n\n下一行', html)
  await expect(pm.locator('> p')).toHaveCount(2)
  await expect(pm.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(1)
})

test('关闭整理后粘贴链接不弹转换标题，整笔撤销仍然有效', async ({ page }) => {
  await bootUnlocked(page, { settings: { note_paste_cleanup: 'false' } }, '/notes')
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  const before = await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getHTML())
  await paste(pm, 'https://example.com/path', '<a href="https://example.com/path">网页标题</a>')
  await expect(pm.locator('a')).toHaveText('网页标题')
  await expect(page.locator('.pasted-link')).toHaveCount(0)
  await pm.press('Control+z')
  expect(await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getHTML())).toBe(before)
})

for (const variant of ['composer', 'card', 'full'] as const) {
  test(`${variant} 粘贴整理空行，保留格式并支持整笔撤销`, async ({ page }) => {
    await bootUnlocked(page, { notes: [{ title: '', content_html: '<p>原有正文</p><p></p><p></p><p>保留原有空行</p>' }] }, '/notes')
    if (variant === 'card') {
      await page.locator('.memo').hover()
      await tipButton(page.locator('.memo'), '编辑').click()
    } else if (variant === 'full') {
      await page.locator('.composer .ProseMirror').click()
      await tipButton(page.locator('.composer'), '全屏书写').click()
    }
    const pm = page.locator(variant === 'composer' ? '.composer .ProseMirror' : variant === 'card' ? '.memo.editing .ProseMirror' : '.fs .ProseMirror')
    await pm.click()
    if (variant === 'card') await expect(pm.locator('> p')).toHaveCount(4)
    await pm.press('Control+End')
    const before = await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getHTML())
    await paste(pm, '标题\n\n\n正文  保留空格\n\n下一行', '<h2>粘贴标题</h2><p><br></p><p>&nbsp;</p><p><br></p><p><strong>正文  保留空格</strong><br><br> &nbsp; <br>下一行</p>')
    // 非空段落末尾粘贴时，首块按编辑器规则接入原段落。
    if (variant === 'card') await expect(pm).toContainText('保留原有空行粘贴标题')
    else await expect(pm.locator('h2')).toHaveText('粘贴标题')
    await expect(pm.locator('strong')).toHaveText('正文  保留空格')
    await expect(pm.locator('br:not(.ProseMirror-trailingBreak)')).toHaveCount(1)
    await pm.press('Control+z')
    expect(await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getHTML())).toBe(before)
  })
}

test('纯文本空白行、代码块及代码里的网址按各自语义处理', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  await paste(pm, '第一段\r\n  \r\n\t\r\n\r\n第二段  双空格')
  await expect(pm.locator('> p')).toHaveText(['第一段', '第二段  双空格'])
  await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setContent('<pre><code></code></pre>'))
  await pm.click()
  const code = '  const a = 1\n\n\n    run(a)\n'
  await paste(pm, code)
  await expect(pm.locator('pre code')).toHaveText(code, { useInnerText: false })
  expect(await pm.locator('pre code').textContent()).toBe(code)
  // 编辑器会在代码块后补空段落；明确把落点留在代码内部。
  await pm.evaluate(el => {
    const editor = (el as HTMLElement & { editor: Editor }).editor
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1)
  })
  await paste(pm, '  https://example.com/path  ')
  expect(await pm.locator('pre code').textContent()).toBe(code + '  https://example.com/path  ')
  await expect(pm.locator('a')).toHaveCount(0)
})

test('富文本代码、图片、任务列表与引用不会被当作空行删除', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  await paste(pm, '', '<p>开头</p><p></p><pre><code>  a\n\n\n  b</code></pre><p></p><img src="https://example.com/test.png"><blockquote><p>引用一</p><p><br></p><p>引用二</p></blockquote><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>已完成</p><p></p><p>补充</p></li></ul>')
  expect(await pm.locator('pre code').textContent()).toBe('  a\n\n\n  b')
  await expect(pm.locator('.img-node')).toHaveCount(1)
  await expect(pm.locator('blockquote p')).toHaveText(['引用一', '引用二'])
  await expect(pm.locator('li input[type=checkbox]')).toBeChecked()
  await expect(pm.locator('li p')).toHaveText(['已完成', '补充'])
})


test('粘贴首尾空段落不会丢失引用，发布后保存整理结果', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const pm = page.locator('.composer .ProseMirror')
  await pm.click()
  await pm.fill('原文末尾')
  await pm.evaluate(el => {
    const editor = (el as HTMLElement & { editor: Editor }).editor
    editor.commands.setTextSelection(3)
  })
  await paste(pm, '引用正文', '<p></p><p><br></p><blockquote><p>引用正文</p></blockquote><p></p>')
  await expect(pm.locator('blockquote')).toHaveText('引用正文')
  expect(await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.getText())).toContain('原文')
  await page.locator('.composer button.btn-primary').click()
  const saved = page.locator('.memo').filter({ hasText: '引用正文' })
  await expect(saved.locator('blockquote')).toHaveText('引用正文')
})
