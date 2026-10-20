import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, tipButton } from '../helpers'

const notes = Array.from({ length: 24 }, (_, i) => ({
  title: `滚动记录 ${i}`,
  pinned: i < 12,
  content_html: `<p>滚动记录 ${i}：用于检查分组吸顶与卡片遮挡。</p>`,
}))

async function expectFullscreen(page: Page) {
  const dialog = page.locator('.fs')
  await expect(dialog).toBeVisible()
  await expect(page.locator('#workspace-page-toolbar .search-box')).toBeHidden()
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
  test(`${width}px 小记滚动时置顶和日期标题贴住正文上沿并遮住底下卡片`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes }, '/notes')
    await expect(page.locator('.memo')).toHaveCount(24)
    const stream = page.locator('.stream')
    for (const header of [page.locator('.day-head.pinned'), page.locator('.day-head:not(.pinned)').first()]) {
      await header.evaluate(el => {
        const scroller = el.closest('.stream')!
        scroller.scrollTo({ top: scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 160, behavior: 'instant' })
      })
      await expect.poll(async () => (await header.boundingBox())!.y - (await stream.boundingBox())!.y).toBe(0)
      expect(await header.evaluate(el => {
        const r = el.getBoundingClientRect()
        return [1, r.height / 2, r.height - 1].every(y => el.contains(document.elementFromPoint(r.x + 40, r.y + y)))
      })).toBe(true)
    }
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
    await page.getByRole('button', { name: '展开目录', exact: true }).click()
    // 窄窗的浮层会遮住书写框，先用 Escape 退出；宽窗保留展开状态。
    if (width < 1100) await page.keyboard.press('Escape')
    else await page.getByRole('button', { name: '固定目录', exact: true }).click()
    await tipButton(page.locator('.composer'), '全屏书写').click()
    await expectFullscreen(page)
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await page.keyboard.press('Escape')
    if (width >= 1100) await expect(page.locator('.workspace-directory')).toBeVisible()
  })

  test(`${width}px 已有小记全屏阅读切换编辑覆盖整个内容面并保存`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await bootUnlocked(page, { notes: [notes[0]] }, '/notes')
    await page.locator('.memo').hover()
    await page.getByRole('button', { name: '全屏查看', exact: true }).click()
    await expectFullscreen(page)
    await page.locator('.fs').getByRole('button', { name: '编辑', exact: true }).click()
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

test('全屏正反向 Tab 保持在书写面内，退出后回到原来的卡片操作', async ({ page }) => {
  await bootUnlocked(page, { notes: [notes[0]] }, '/notes')
  await page.locator('.memo').hover()
  const entry = page.getByRole('button', { name: '全屏查看', exact: true })
  await entry.click()
  const dialog = page.locator('.fs')
  await dialog.getByRole('button', { name: /退出全屏/ }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(entry).toBeFocused()
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
  await card.hover()
  const entry = card.getByRole('button', { name: '全屏查看', exact: true })
  const scroll = await page.locator('.stream').evaluate(el => el.scrollTop)
  await entry.click()
  await page.locator('.fs').getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('.fs .ProseMirror').press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
  await expect(entry).toBeFocused()
  expect(await page.locator('.stream').evaluate(el => el.scrollTop)).toBe(scroll)
})

test('全屏叠加删除确认时 Escape 只取消删除，再次 Escape 才退出全屏', async ({ page }) => {
  await bootUnlocked(page, { notes: [notes[0]] }, '/notes')
  await page.locator('.memo').hover()
  await page.getByRole('button', { name: '全屏查看', exact: true }).click()
  await tipButton(page.locator('.fs'), '更多操作').click()
  await page.locator('.popover').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.locator('.confirm-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.confirm-dialog')).toBeHidden()
  await expect(page.locator('.fs')).toBeVisible()
  expect((await e2e.snapshot(page)).notes).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.fs')).toHaveCount(0)
})
