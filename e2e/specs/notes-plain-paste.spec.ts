import { test, expect } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'

async function paste(page: import('@playwright/test').Page, selector: string) {
  await page.locator(selector).evaluate(el => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', '<h2 style="color:#000;font-family:serif">粘贴标题</h2><p><strong>加粗正文</strong> <a href="https://example.com">链接</a></p><p>&lt;b&gt;普通文字&lt;/b&gt;</p>')
    clipboardData.setData('text/plain', '粘贴标题\n加粗正文 链接\n<b>普通文字</b>')
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
}

for (const full of [false, true]) {
  test(`${full ? '全屏' : '列表输入框'}粘贴可改为纯文本，保留前文和换行并可撤销`, async ({ page }) => {
    await bootUnlocked(page, {}, '/notes')
    if (full) await tipButton(page.locator('.composer'), '全屏书写').click()
    const selector = full ? '.fs .ProseMirror' : '.composer .ProseMirror'
    const editor = page.locator(selector)
    await editor.fill('已有内容')
    await editor.press('End')
    await paste(page, selector)
    await expect(editor.locator('strong')).toHaveText('加粗正文')
    await page.getByRole('group', { name: '粘贴选项', exact: true }).getByRole('button', { name: '只粘贴文本', exact: true }).click()
    await expect(editor.locator('h1,h2,h3,strong,em,a,[style]')).toHaveCount(0)
    await expect(editor).toContainText('已有内容')
    await expect(editor).toContainText('<b>普通文字</b>')
    await expect(editor.locator('p')).toHaveCount(3)
    await expect(editor.locator('p').nth(1)).toHaveText('加粗正文 链接')
    await expect(page.getByRole('group', { name: '粘贴选项', exact: true })).toHaveCount(0)
    await editor.press('Control+z')
    await expect(editor.locator('strong')).toHaveText('加粗正文')
    await expect(editor).toContainText('已有内容')
  })
}

test('继续输入后关闭粘贴选项，不覆盖后续编辑', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const editor = page.locator('.composer .ProseMirror')
  await editor.click()
  await paste(page, '.composer .ProseMirror')
  await expect(page.getByRole('group', { name: '粘贴选项', exact: true })).toBeVisible()
  await editor.press('End')
  await editor.pressSequentially('后续输入')
  await expect(page.getByRole('group', { name: '粘贴选项', exact: true })).toHaveCount(0)
  await expect(editor).toContainText('后续输入')
  await expect(editor.locator('strong')).toHaveText('加粗正文')
})
