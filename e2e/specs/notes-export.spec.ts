import { test, expect, type Locator, type Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, tipButton } from '../helpers'

const seeds = [
  { title: '项目记录 #工作', content_html: '<p>项目正文 #工作</p><img src="attachments/chart.png" alt="图表">' },
  { title: '生活清单', content_html: '<p>生活正文</p>' },
  { title: '旧记录', content_html: '<p>归档正文</p>', archived: true },
]

const writes = (page: Page) => page.evaluate(() => (window as any).__E2E__.invocations.filter((i: any) => i.cmd === 'note_export_write').map((i: any) => i.args))
const saves = (page: Page) => page.evaluate(() => (window as any).__E2E__.invocations.filter((i: any) => i.cmd === 'dialog:save').map((i: any) => i.args.descriptor))

async function openAll(page: Page) {
  await page.getByRole('button', { name: '导出全部小记', exact: true }).click()
  return page.getByRole('dialog', { name: '导出小记', exact: true })
}

/** 在册小记的导出住在 ⋯ 里：先开更多操作，再进格式子菜单 */
async function openFormatsOf(page: Page, card: Locator) {
  await card.hover()
  await tipButton(card, '更多操作').first().click()
  await page.locator('.popover .pop-item:text-is("导出")').click()
}

test.describe('小记导出', () => {
  for (const [label, format, extension] of [['Markdown', 'markdown', 'md'], ['HTML', 'html', 'html'], ['Word', 'word', 'doc'], ['PDF', 'pdf', 'pdf']]) {
    test(`单条 ${label}：格式菜单直达保存，图片内嵌`, async ({ page }) => {
      await bootUnlocked(page, { notes: seeds, staged: ['chart.png'] }, '/notes')
      const card = page.locator('.memo').filter({ hasText: '项目正文' })
      await card.hover()
      await openFormatsOf(page, card)
      await expect(page.getByRole('dialog', { name: '导出小记' })).toHaveCount(0)
      await e2e.queueDialog(page, `C:\\exports\\note.${extension}`)
      await page.getByRole('menuitem', { name: `${label} (.${extension})`, exact: true }).click()
      await expectToast(page, '已导出 1 条小记')
      const [result] = await writes(page)
      expect(result.format).toBe(format)
      expect(result.noteIds).toHaveLength(1)
      expect(result.files).toHaveLength(1)
      expect(result.files[0].name).toMatch(new RegExp(`\\.${extension}$`))
      expect(result.files[0].content).toContain('项目正文')
      expect(result.files[0].content.match(/#工作/g)).toHaveLength(1)
      expect(result.files[0].content).toContain('data:image/png;base64,')
      expect(result.files[0].content).not.toContain('归档正文')
    })
  }

  test('全库忽略搜索，排除归档；Word ZIP 与 PDF 合并说明随格式更新', async ({ page }) => {
    await bootUnlocked(page, { notes: seeds }, '/notes')
    await page.locator('.page-bar .search-box input').fill('生活正文')
    await expect(page.locator('.memo')).toHaveCount(1)
    const dialog = await openAll(page)
    await expect(dialog.getByRole('heading')).toHaveText('导出 2 条小记')
    await dialog.getByRole('button', { name: 'Word', exact: true }).click()
    await expect(dialog.locator('.export-format-note')).toContainText('不是 .docx')
    await expect(dialog.locator('.export-filename')).toContainText('.zip')
    await dialog.getByRole('button', { name: 'PDF', exact: true }).click()
    await expect(dialog.locator('.export-format-note')).toContainText('合并在一份')
    await expect(dialog.locator('.export-filename')).toContainText('.pdf')
    await e2e.queueDialog(page, 'C:\\exports\\all.pdf')
    await dialog.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'note_export_write')).toBe(1)
    const [result] = await writes(page)
    expect(result.noteIds).toHaveLength(2)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].content.match(/<article>/g)).toHaveLength(2)
    expect(result.files[0].content).not.toContain('归档正文')
  })

  test('批量只导出已选条目，多条 HTML 使用 ZIP 保存', async ({ page }) => {
    await bootUnlocked(page, { notes: [...seeds, { title: '不选', content_html: '<p>未选正文</p>' }] }, '/notes')
    const first = page.locator('.memo').filter({ hasText: '项目正文' })
    await first.hover()
    await first.locator('.memo-check').click()
    await page.locator('.memo').filter({ hasText: '生活正文' }).click()
    await page.locator('.batch-dock').getByRole('button', { name: '导出', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导出小记', exact: true })
    await expect(dialog.getByRole('heading')).toHaveText('导出 2 条小记')
    await dialog.getByRole('button', { name: 'HTML', exact: true }).click()
    await e2e.queueDialog(page, 'C:\\exports\\selected.zip')
    await dialog.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'note_export_write')).toBe(1)
    const [result] = await writes(page)
    expect(result.files).toHaveLength(2)
    expect(result.files.every((f: any) => f.name.endsWith('.html'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('未选正文')
    expect((await saves(page))[0].filters[0].extensions).toEqual(['zip'])
  })

  test('归档中的全量导出仅包含归档小记', async ({ page }) => {
    await bootUnlocked(page, { notes: seeds }, '/notes')
    await tipButton(page.locator('.page-bar'), '展开侧栏').click()
    await page.locator('.rail button.rail-item', { hasText: '归档' }).click()
    await page.getByRole('button', { name: '导出全部归档', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导出小记', exact: true })
    await expect(dialog.getByRole('heading')).toHaveText('导出 1 条小记')
    await e2e.queueDialog(page, 'C:\\exports\\archive.md')
    await dialog.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'note_export_write')).toBe(1)
    expect((await writes(page))[0].files[0].content).toContain('归档正文')
    expect((await writes(page))[0].files[0].content).not.toContain('项目正文')
  })

  for (const unlock of [true, false]) {
    test(`混合加密条目：${unlock ? '解锁后导出明文' : '取消解锁跳过并报数'}`, async ({ page }) => {
      await bootUnlocked(page, { notePassphrase: 'note-pw-1234', notes: [
        { title: '公开', content_html: '<p>公开正文</p>' },
        { title: '机密', content_html: '<p>机密明文</p>', encrypted: true },
      ] }, '/notes')
      const dialog = await openAll(page)
      await e2e.queueDialog(page, 'C:\\exports\\mixed.zip')
      await dialog.getByRole('button', { name: '导出…', exact: true }).click()
      const lock = page.getByRole('dialog', { name: '解锁加密小记', exact: true })
      await expect(lock).toBeVisible()
      if (unlock) {
        await lock.locator('input[type=password]').fill('wrong')
        await lock.getByRole('button', { name: '解锁', exact: true }).click()
        await expect(lock.locator('.dialog-err')).toBeVisible()
        expect(await e2e.count(page, 'note_export_write')).toBe(0)
        await lock.locator('input[type=password]').fill('note-pw-1234')
        await lock.getByRole('button', { name: '解锁', exact: true }).click()
      } else await lock.getByRole('button', { name: '取消', exact: true }).click()
      await expectToast(page, unlock ? '已导出 2 条小记' : '2 条中 1 条已导出，1 条未解锁或已不存在，已跳过')
      const [result] = await writes(page)
      expect(result.files).toHaveLength(unlock ? 2 : 1)
      expect(JSON.stringify(result).includes('机密明文')).toBe(unlock)
      expect((await saves(page))[0].filters[0].extensions).toEqual([unlock ? 'zip' : 'md'])
    })
  }

  test('取消系统保存不写文件，弹窗可重试', async ({ page }) => {
    await bootUnlocked(page, { notes: seeds }, '/notes')
    const dialog = await openAll(page)
    await dialog.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(() => saves(page).then(items => items.length)).toBe(1)
    await expect(dialog.getByRole('button', { name: '导出…', exact: true })).toBeEnabled()
    expect(await e2e.count(page, 'note_export_write')).toBe(0)
    await e2e.queueDialog(page, 'C:\\exports\\retry.zip')
    await dialog.getByRole('button', { name: '导出…', exact: true }).click()
    await expect.poll(() => e2e.count(page, 'note_export_write')).toBe(1)
  })

  test('仅加密条目取消解锁时不弹保存框', async ({ page }) => {
    await bootUnlocked(page, { notePassphrase: 'note-pw-1234', notes: [{ title: '机密', content_html: '<p>机密</p>', encrypted: true }] }, '/notes')
    const card = page.locator('.memo')
    await card.hover()
    await tipButton(card, '导出').click()
    await page.getByRole('menuitem', { name: 'Markdown (.md)', exact: true }).click()
    await page.getByRole('dialog', { name: '解锁加密小记' }).getByRole('button', { name: '取消', exact: true }).click()
    await expectToast(page, '未导出：1 条小记未解锁或已不存在')
    expect(await saves(page)).toHaveLength(0)
    expect(await writes(page)).toHaveLength(0)
  })
})
