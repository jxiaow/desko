import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, openNoteRead } from '../helpers'

for (const theme of ['paper', 'ink']) {
  for (const width of [800, 1040]) {
    test(`${theme} ${width}px 阅读标题与标签、批量待选和归档搜索`, async ({ page }) => {
      await page.setViewportSize({ width, height: 670 })
      const created = new Date(new Date().getFullYear() - 1, 4, 18, 12, 30).getTime()
      await bootUnlocked(page, {
        settings: { theme },
        notes: [
          { title: '阅读记录', content_html: '<h2>阅读记录 #工作</h2><p>保留正文，突出标题。</p>', created_at: created, updated_at: created + 61_000 },
          { title: '另一条', content_html: '<p>另一条</p><p>独立记录 #生活</p>' },
          { title: '旧归档', content_html: '<p>旧归档</p><p>归档内容</p>', archived: true },
        ],
      }, '/notes')
      const reading = page.locator('.memo').filter({ hasText: '阅读记录' })
      await expect(reading.locator('.memo-time')).toContainText('已编辑')
      await openNoteRead(reading)
      await expect(page.locator('.fs-title')).toHaveText('阅读记录')
      await expect(page.locator('.fs-view > :first-child')).toBeHidden()
      await expect(page.locator('.fs-view')).not.toContainText('#工作')
      await expect(page.locator('.fs-meta')).toContainText(`${new Date().getFullYear() - 1}年`)
      await expect(page.locator('.fs-meta')).toContainText('已编辑')
      await page.locator('.fs-tags').getByRole('button', { name: '#工作', exact: true }).click()
      await expect(page.locator('.fs')).toHaveCount(0)
      await expect(page.locator('.memo')).toHaveCount(1)
      await reading.locator('.tag-pill').click()
      await expect(page.locator('.memo')).toHaveCount(2)

      await page.getByRole('button', { name: '选择小记', exact: true }).click()
      const dock = page.locator('.batch-dock')
      await expect(page.locator('.dock-count')).toHaveText('已选 0 条')
      await expect(page.locator('.composer')).toHaveCount(0)
      await expect(page.locator('.memo-acts')).toHaveCount(0)
      await expect(dock.getByRole('button', { name: '删除', exact: true })).toBeDisabled()
      await expect(dock.getByRole('button', { name: '更多', exact: true })).toBeDisabled()
      expect(await dock.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= innerWidth)).toBe(true)
      await reading.focus()
      await page.keyboard.press('Enter')
      await expect(reading).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Space')
      await expect(page.locator('.dock-count')).toHaveText('已选 0 条')
      await expect(dock).toBeVisible()
      await expect(reading.locator('.tag-pill')).toBeDisabled()
      const tag = (await reading.locator('.tag-pill').boundingBox())!
      await page.mouse.click(tag.x + tag.width / 2, tag.y + tag.height / 2)
      await expect(reading).toHaveAttribute('aria-pressed', 'true')
      await expect(page.locator('.memo')).toHaveCount(2)
      await dock.getByRole('button', { name: '更多', exact: true }).click()
      await page.locator('.popover').getByRole('button', { name: '置顶', exact: true }).click()
      await expect.poll(async () => (await e2e.snapshot(page)).notes.find((note: { title: string }) => note.title === '阅读记录')?.pinned).toBe(true)
      await dock.getByRole('button', { name: '取消全选', exact: true }).click()
      await expect(page.locator('.dock-count')).toHaveText('已选 0 条')
      await dock.getByRole('button', { name: '完成', exact: true }).click()
      await expect(page.locator('.composer')).toBeVisible()

      await page.locator('.workspace-workbar .wb-tab').filter({ hasText: '归档' }).click()
      await expect(page.locator('.titlebar-count')).toHaveText('归档 · 1 条')
      await expect(page.locator('.ab-lead')).toHaveText('已归档 · 不出现在「全部」列表，可在本视图搜索')
      expect(await page.locator('.archive-bar').evaluate(el => {
        const bar = el.getBoundingClientRect()
        return el.scrollWidth <= el.clientWidth && [...el.children].every(child => {
          const r = child.getBoundingClientRect()
          return r.top >= bar.top && r.bottom <= bar.bottom
        })
      })).toBe(true)
      await page.getByRole('textbox', { name: '搜索归档小记', exact: true }).fill('归档内容')
      await expect(page.locator('.titlebar-count')).toHaveText('归档 · 1 / 1 条')
      await expect(page.locator('.memo')).toHaveCount(1)
      await page.getByRole('textbox', { name: '搜索归档小记', exact: true }).fill('不匹配')
      await expect(page.locator('.titlebar-count')).toHaveText('归档 · 0 / 1 条')
      await expect(page.locator('.empty-title')).toHaveText('未找到匹配的小记')
    })
  }
}

test('小记口令弹窗说明全库范围、自动聚焦，错误保留在弹窗内并可直接恢复', async ({ page }) => {
  await bootUnlocked(page, {
    notePassphrase: 'test-note-password',
    notes: [{ title: '保密记录', content_html: '<p>保密记录</p>', encrypted: true }],
  }, '/notes')
  await page.locator('.memo').click()
  const dialog = page.getByRole('dialog', { name: '解锁全部加密小记', exact: true })
  await expect(dialog.locator('input')).toBeFocused()
  await expect(dialog.locator('.lead')).toContainText('小记或应用锁定后需重新解锁')
  await dialog.locator('input').fill('wrong')
  await dialog.getByRole('button', { name: '解锁', exact: true }).click()
  await expect(dialog.locator('.dialog-err')).toBeVisible()
  await dialog.locator('input').fill('')
  await dialog.getByRole('button', { name: '用主密码恢复口令', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.memo-body')).toContainText('保密记录')
  await expect(page.locator('.memo-title')).toHaveCount(0)
})

test('首段混排图片和任务时，阅读标题不隐藏正文中的媒体或任务控件', async ({ page }) => {
  await bootUnlocked(page, {
    notes: [{ title: '混排记录', content_html: '<p>配图说明<img src="attachments/preview.png" data-note-image></p><blockquote><p>任务说明</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>待办</p></div></li></ul></blockquote>' }],
  }, '/notes')
  await expect(page.locator('.memo-body > p')).toBeVisible()
  await openNoteRead(page.locator('.memo'))
  await expect(page.locator('.fs-view > p')).toBeVisible()
  await expect(page.locator('.fs-view img')).toBeVisible()
  await expect(page.locator('.fs-view input[type="checkbox"]')).toBeVisible()
})

test('普通首段、引用和自动摘要保持正文，只有标题格式生成标题行', async ({ page }) => {
  await bootUnlocked(page, {
    notes: [
      { title: '自动生成的摘要', content_html: '<p>普通首段</p><p>第二段正文</p>' },
      { title: '引用摘要', content_html: '<blockquote><p>引用首段</p></blockquote><p>后续正文</p>' },
      { title: '真正的标题', content_html: '<h2>真正的标题</h2><p>标题下的正文</p>' },
    ],
  }, '/notes')
  await expect(page.locator('.memo-title')).toHaveText(['真正的标题'])
  const plain = page.locator('.memo').filter({ hasText: '普通首段' })
  await expect(plain.locator('.memo-body > p').first()).toBeVisible()
  await expect(plain.locator('.memo-body > p').first()).toHaveCSS('font-weight', '400')
  await plain.hover()
  await openNoteRead(plain)
  await expect(page.locator('.fs-title')).toHaveCount(0)
  await expect(page.locator('.fs-view > p').first()).toBeVisible()
  await expect(page.locator('.fs-view > p').first()).toHaveCSS('font-weight', '400')
  await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.locator('.fs .ProseMirror > p').first()).toHaveCSS('font-weight', '400')
  await page.keyboard.press('Escape')
  await plain.hover()
  await plain.getByRole('button', { name: '编辑', exact: true }).click()
  await expect(page.locator('.memo.editing .ProseMirror > p').first()).toHaveCSS('font-weight', '400')
  await page.keyboard.press('Escape')
  const quote = page.locator('.memo').filter({ hasText: '引用首段' })
  await quote.hover()
  await openNoteRead(quote)
  await expect(page.locator('.fs-title')).toHaveCount(0)
  await expect(page.locator('.fs-view > blockquote')).toBeVisible()
})
