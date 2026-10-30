import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, openNoteRead, tipButton } from '../helpers'

const notes = Array.from({ length: 24 }, (_, i) => ({
  title: `滚动记录 ${i}`,
  pinned: i < 12,
  content_html: `<p>滚动记录 ${i}：用于检查一列到底的便签流与置顶小标。</p>`,
}))

async function expectFullscreen(page: Page) {
  const dialog = page.locator('.fs')
  await expect(dialog).toBeVisible()
  await expect(page.locator('#workspace-page-toolbar .search-box')).toBeHidden()
  await expect(page.locator('#workspace-directory-toggle')).toBeHidden()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  const header = page.locator('#workspace-page-toolbar > .fs-head')
  await expect(header).toBeVisible()
  await expect(dialog.locator('.fs-head')).toHaveCount(0)
  await expect(dialog).toHaveAttribute('aria-owns', 'note-fullscreen-toolbar')
  const controls = (await page.locator('.titlebar-buttons').boundingBox())!
  const toolbar = (await header.boundingBox())!
  expect(toolbar.y).toBe(0)
  expect(toolbar.height).toBe(48)
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(controls.x - 11)
  const surface = (await page.locator('.workspace-surface').boundingBox())!
  const full = (await dialog.boundingBox())!
  expect(full).toEqual(surface)
  // 原搜索框的位置也必须由全屏层接管，防止只藏控件、仍留一条空工具栏。
  expect(await dialog.evaluate((el, point) => el.contains(document.elementFromPoint(point.x, point.y)), {
    x: surface.x + 80, y: surface.y + 24,
  })).toBe(true)
  await page.keyboard.press('Control+k')
  await expect(page.locator('#workspace-page-toolbar input')).not.toBeFocused()
}

for (const width of [800, 1280]) {
  test(`${width}px 小记一列到底：置顶小标在最前、跟着滚动走，没有日期章节`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes }, '/notes')
    await expect(page.locator('.memo')).toHaveCount(24)
    await expect(page.locator('.day-head')).toHaveCount(0)
    const label = page.locator('.slip-label')
    await expect(label).toHaveText(/置顶/)
    await expect(label.locator('.slip-label-count')).toHaveText('12')
    // 置顶段只给有标记的卡补一枚图钉，普通卡不带
    await expect(page.locator('.memo').nth(0).locator('.memo-pin')).toBeVisible()
    await expect(page.locator('.memo').nth(12).locator('.memo-pin')).toHaveCount(0)
    const stream = page.locator('.stream')
    const top0 = (await label.boundingBox())!.y
    await stream.evaluate(el => { el.scrollTo({ top: 160, behavior: 'instant' }) })
    await expect.poll(async () => (await label.boundingBox())!.y).toBe(top0 - 160)
  })

  test(`${width}px 新建全屏隐藏搜索和目录，退出恢复草稿与目录偏好`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes }, '/notes')
    const editor = page.locator('.composer .ProseMirror')
    await editor.fill('全屏草稿')
    await tipButton(page.locator('.composer'), '全屏书写').click()
    await expectFullscreen(page)
    await page.locator('.fs .ProseMirror').fill('全屏草稿补充')
    await page.keyboard.press('Escape')
    await expect(page.locator('.fs')).toHaveCount(0)
    await expect(editor).toHaveText('全屏草稿补充')
    await expect(page.locator('#workspace-page-toolbar .search-box')).toBeVisible()
    await expect(page.locator('.workspace-workbar')).toBeVisible()
    await tipButton(page.locator('.composer'), '全屏书写').click()
    await expectFullscreen(page)
    await expect(page.locator('.workspace-workbar')).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(page.locator('.workspace-workbar')).toBeVisible()
  })

  test(`${width}px 已有小记全屏阅读切换编辑覆盖整个内容面并保存`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes: [notes[0]] }, '/notes')
    await openNoteRead(page.locator('.memo'))
    await expectFullscreen(page)
    await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
    await expectFullscreen(page)
    await page.locator('.fs .ProseMirror').fill('全屏修改后保存')
    await page.keyboard.press('Escape')
    await expect(page.locator('.fs')).toHaveCount(0)
    await expect(page.locator('#workspace-page-toolbar .search-box')).toBeVisible()
    await expect.poll(async () => (await e2e.snapshot(page)).notes[0].content_html).toContain('全屏修改后保存')
  })
}

test('编辑器 Ctrl+B 只处理加粗，不展开目录', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  const editor = page.locator('.composer .ProseMirror')
  await editor.fill('加粗文字')
  await editor.press('Control+a')
  await editor.press('Control+b')
  await expect(editor.locator('strong')).toHaveText('加粗文字')
  await expect(page.locator('.workspace-directory')).toBeHidden()
})

test('全屏里 Escape 先关闭命令菜单，再退出全屏，保留草稿', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  await page.locator('.composer .ProseMirror').fill('写作草稿')
  await tipButton(page.locator('.composer'), '全屏书写').click()
  const editor = page.locator('.fs .ProseMirror')
  await editor.press('Control+End')
  await editor.press('Enter')
  await editor.press('/')
  await expect(page.locator('.slash-menu')).toBeVisible()
  await editor.press('Escape')
  await expect(page.locator('.slash-menu')).toBeHidden()
  await expect(page.locator('.fs')).toBeVisible()
  await editor.press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
  await expect(page.locator('.composer .ProseMirror')).toContainText('写作草稿')
})

test('全屏正反向 Tab 保持在书写面内，退出后回到原来的卡片', async ({ page }) => {
  await bootUnlocked(page, { notes: [{ ...notes[0], content_html: `${notes[0].content_html}<p>#工作</p>` }] }, '/notes')
  const card = page.locator('.memo')
  await openNoteRead(card)
  const dialog = page.locator('.fs')
  const header = page.locator('.fs-head')
  const exit = header.getByRole('button', { name: /退出全屏/ })
  const tag = dialog.getByRole('button', { name: '#工作', exact: true })
  const inFullscreen = () => page.evaluate(() => ['.fs', '#note-fullscreen-toolbar'].some(selector => document.querySelector(selector)?.contains(document.activeElement)))
  await exit.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(tag).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(exit).toBeFocused()
  await header.getByRole('button', { name: '更多操作', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(tag).toBeFocused()
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await inFullscreen()).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(card).toBeFocused()
})

test('全屏中文组合输入的 Escape 不退出书写面', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  await page.locator('.composer .ProseMirror').click()
  await tipButton(page.locator('.composer'), '全屏书写').click()
  const editor = page.locator('.fs .ProseMirror')
  await editor.click()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '候选', selectionStart: 2, selectionEnd: 2 })
  await editor.press('Escape')
  await expect(page.locator('.fs')).toBeVisible()
  await cdp.send('Input.insertText', { text: '候选' })
  await page.keyboard.insertText('，续')
  await expect(editor).toHaveText('候选，续')
  await expect.poll(() => editor.evaluate(el => (el as HTMLElement & { editor: { view: { composing: boolean } } }).editor.view.composing)).toBe(false)
  await editor.press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
  await expect(page.locator('.composer .ProseMirror')).toHaveText('候选，续')
  await cdp.detach()
})

test('从滚动列表全屏阅读、转编辑再退出，恢复原来的焦点和阅读位置', async ({ page }) => {
  await bootUnlocked(page, { notes }, '/notes')
  const card = page.locator('.memo').nth(7)
  const stream = page.locator('.stream')
  // Enter 前 Playwright 会先把这条滚进视口，落点等滚动停稳后再取
  await openNoteRead(card)
  await page.waitForTimeout(400)
  const scroll = await stream.evaluate(el => el.scrollTop)
  expect(scroll).toBeGreaterThan(0)
  await page.locator('.fs-head').getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('.fs .ProseMirror').press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
  await expect(card).toBeFocused()
  expect(await stream.evaluate(el => el.scrollTop)).toBe(scroll)
})

test('全屏叠加删除确认时 Escape 只取消删除，再次 Escape 才退出全屏', async ({ page }) => {
  await bootUnlocked(page, { notes: [notes[0]] }, '/notes')
  await openNoteRead(page.locator('.memo'))
  await tipButton(page.locator('.fs-head'), '更多操作').click()
  await page.locator('.popover').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.confirm-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.confirm-dialog')).toBeHidden()
  await expect(page.locator('.fs')).toBeVisible()
  expect((await e2e.snapshot(page)).notes).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
})
