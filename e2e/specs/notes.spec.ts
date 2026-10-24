import { test, expect, Page, Locator } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { bootUnlocked, e2e, expectToast, openSettings, tipButton, visiblePane, waitForToastGone } from '../helpers'

/** 全库一把小记口令：立的时候卡位数，之后解锁照原样填 */
const NOTE_PASS = 'note-pw-1234'

const SEED = {
  notes: [
    { title: '会议纪要', content_html: '<p>第一条小记：周会纪要与待办</p>' },
    { title: '灵感', content_html: '<p>第二条小记：灵感片段 #产品</p>' },
    { title: '清单', content_html: '<p>第三条小记：周末采购清单</p>' },
  ],
}

function memo(page: Page, text: string) {
  return page.locator('.memo').filter({ hasText: text })
}

async function openDirectory(page: Page) {
  const button = page.getByRole('button', { name: '展开目录', exact: true })
  if (await button.isVisible()) await button.click()
}

/** 加密系与删除这些低频动作住在卡头 ⋯ 里：悬停露排 → 开菜单 → 按文字点。
    菜单项前有图标，文字要用 :text-is 精确比（hasText 的正则不吃首尾空白） */
async function noteMenu(page: Page, card: Locator): Promise<Locator> {
  await card.hover()
  await tipButton(card, '更多操作').first().click()
  return page.locator('.popover')
}

/** Tiptap 3 的 TaskItem 结构：li[data-checked] + label>input + div>p */
const TODO_HTML =
  '<p>发布前清单</p>' +
  '<ul data-type="taskList">' +
  '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>跑一遍 E2E</p></div></li>' +
  '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>打包</p></div></li>' +
  '</ul>'

async function gotoNotes(page: Page) {
  await bootUnlocked(page, SEED, '/notes')
  await expect(page.locator('.notes-page')).toBeVisible()
}

/** 真机按 Ctrl+V 在 Playwright 里给不出剪贴板，派发同形事件：DataTransfer 里放图片 File
 *  就是「剪贴板有图」，只给 text/html 就是「从别处复制的富文本」 */
async function pasteInto(
  page: Page,
  selector: string,
  { files = [], html }: { files?: { name: string; type: string }[]; html?: string },
) {
  await page.evaluate(({ selector, files, html }) => {
    const transfer = new DataTransfer()
    for (const file of files) {
      transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], file.name, { type: file.type }))
    }
    if (html) transfer.setData('text/html', html)
    ;(document.querySelector(selector) as HTMLElement)
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, { selector, files, html })
}

test.describe('Notes 小记', () => {
  for (const variant of ['composer', 'card', 'full'] as const) {
    test(`中文标点与组合输入：${variant} 光标跟随输入且保留连续空格`, async ({ page }) => {
      await gotoNotes(page)
      if (variant === 'card') {
        const card = memo(page, '第一条小记')
        await card.hover()
        await card.locator('.memo-edit').click()
      } else {
        await page.locator('.composer .ProseMirror').click()
        if (variant === 'full') await tipButton(page.locator('.composer'), '全屏书写').click()
      }
      const pm = page.locator(variant === 'composer' ? '.composer .ProseMirror' : variant === 'card' ? '.memo.editing .ProseMirror' : '.fs .ProseMirror')
      await pm.fill('甲  乙')
      await pm.press('End')
      const cdp = await page.context().newCDPSession(page)
      const compose = async (text: string) => {
        await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
        await cdp.send('Input.insertText', { text })
      }
      const state = () => pm.evaluate(el => {
        const editor = (el as HTMLElement & { editor: Editor }).editor
        const selection = window.getSelection()!
        return {
          text: editor.state.doc.textContent,
          head: editor.state.selection.head,
          domHead: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
        }
      })
      const text = '甲  乙，。；：“”！（）'
      await compose('，。；：“”！（）')
      await expect.poll(state).toEqual({ text, head: text.length + 1, domHead: text.length + 1 })
      await pm.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(2))
      await compose('，')
      await page.keyboard.insertText('续')
      await expect.poll(state).toEqual({ text: '甲，续  乙，。；：“”！（）', head: 4, domHead: 4 })
      await cdp.detach()

      for (const from of [3, 2]) {
        await pm.fill('甲乙')
        await pm.evaluate((el, from) => {
          const editor = (el as HTMLElement & { editor: Editor }).editor
          editor.commands.setTextSelection(from)
          const selection = window.getSelection()!
          const node = selection.focusNode as Text
          const offset = selection.focusOffset
          // 部分中文输入法直接提交标点时，DOM 已插入逗号，选区仍在提交前的位置。
          node.insertData(offset, '，')
          selection.collapse(node, offset)
          el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '，' }))
        }, from)
        const expected = from === 3 ? '甲乙，' : '甲，乙'
        await expect.poll(state).toEqual({ text: expected, head: from + 1, domHead: from + 1 })
        await page.keyboard.insertText('续')
        await expect.poll(state).toEqual({
          text: from === 3 ? '甲乙，续' : '甲，续乙', head: from + 2, domHead: from + 2,
        })
      }
    })
  }

  test('未发布的全屏内容切换模块后保留，发布后清空输入框', async ({ page }) => {
    await gotoNotes(page)
    const composer = page.locator('.composer .ProseMirror')
    await composer.fill('顶部  输入的内容')
    await tipButton(page.locator('.composer'), '全屏书写').click()
    const fs = page.locator('.fs')
    await expect(page.locator('.fs-head .save-hint')).toHaveText('未保存')
    await fs.locator('.ProseMirror').press('End')
    await page.keyboard.insertText('，全屏里接着写')
    await page.locator('a.nav-item[href="/entries"]').click()
    await expect(page).toHaveURL(/\/entries$/)
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(fs).toBeVisible()
    expect(await e2e.count(page, 'create_note')).toBe(0)
    await expect(fs.locator('.ProseMirror')).toHaveText('顶部  输入的内容，全屏里接着写')
    await fs.locator('.fs-foot button.eb.primary', { hasText: '保存' }).click()
    await expect(fs).toHaveCount(0)
    await expect(composer).toHaveText('')
    await expect(memo(page, '顶部  输入的内容')).toBeVisible()
    await page.locator('a.nav-item[href="/entries"]').click()
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(composer).toHaveText('')
  })

  test('列表标签只显示在底部，富文本标签及六个以上标签不遗漏', async ({ page }) => {
    const html = '<p>标题，#工<strong>作</strong></p><p>正文#产品<br>下一行 #灵感 #生活 #研究 #计划 #更多</p><pre><code>#代码</code></pre><p><a href="https://example.com/#part">链接</a></p>'
    await bootUnlocked(page, { notes: [{ title: '标题 #工作', content_html: html }] })
    const card = page.locator('.memo')
    await expect(card.locator('.memo-title')).toHaveCount(0)
    await expect(card.locator('.memo-body > p').first()).toHaveText('标题，')
    await expect(card.locator('.tag-pill')).toHaveText(['#工作', '#产品', '#灵感', '#生活', '#研究', '#计划', '#更多'])
    await expect(card.locator('.memo-body')).not.toContainText(/#工作|#产品|#灵感|#生活|#研究|#计划|#更多/)
    await expect(card.locator('.memo-body code')).toHaveText('#代码')
    await expect(card.locator('.memo-body a')).toHaveAttribute('href', 'https://example.com/#part')
    await card.hover()
    await card.locator('.memo-edit').click()
    await expect(page.locator('.memo.editing .ProseMirror')).toContainText('#工作')
    await expect(page.locator('.memo.editing .ProseMirror')).toContainText('#更多')
    expect((await e2e.snapshot(page)).notes).toEqual(expect.arrayContaining([expect.objectContaining({ content_html: html })]))
  })

  test('导入的小记在卡片与全屏查看都不会执行 HTML 事件属性', async ({ page }) => {
    const html = '<p>安全正文</p><img src="attachments/missing.png" onerror="window.__noteXss = true">' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>待办</p></div></li></ul>' +
      '<script>window.__noteXss = true</script><a href="javascript:window.__noteXss=true">坏链接</a>'
    await bootUnlocked(page, { notes: [{ title: '安全正文', content_html: html }] }, '/notes')
    const card = page.locator('.memo')
    await expect(card.locator('.memo-body img')).toHaveAttribute('src', /missing\.png/)
    await expect(card.locator('.memo-body img')).not.toHaveAttribute('onerror')
    await expect(card.locator('.memo-body script')).toHaveCount(0)
    await card.hover()
    await tipButton(card, '全屏查看').click()
    const view = page.locator('.fs-view')
    await expect(view.locator('input[type="checkbox"]')).toBeChecked()
    await expect(view.locator('a')).not.toHaveAttribute('href')
    await expect(view.locator('script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__noteXss)).toBeUndefined()
  })

  test('保存失败后锁定会加密暂存，解锁自动找回并写入', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [{ title: '原稿', content_html: '<p>原稿</p>' }],
      notesUpdateFailCount: 1,
    }, '/notes')
    const card = page.locator('.memo')
    await card.hover()
    await tipButton(card, '编辑').click()
    await page.locator('.memo.editing .ProseMirror').fill('锁前最后一笔')
    await page.locator('button[title="锁定"]').click()
    await expect(page.locator('.unlock-input')).toBeVisible()
    expect((await e2e.snapshot(page)).notes[0].content_html).toBe('<p>原稿</p>')
    expect(await e2e.count(page, 'stage_note_drafts')).toBeGreaterThan(0)
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await expect.poll(() => e2e.snapshot(page).then(s => s.notes[0].content_html)).toContain('锁前最后一笔')
    await expect(memo(page, '锁前最后一笔')).toBeVisible()
    expect(await e2e.count(page, 'recover_note_drafts')).toBeGreaterThan(0)
  })

  test('未发布草稿锁定时从页面收回，解锁后恢复书写', async ({ page }) => {
    await bootUnlocked(page, {}, '/notes')
    await page.locator('.composer .ProseMirror').fill('还没发布的草稿')
    await page.locator('button[title="锁定"]').click()
    await expect(page.locator('.unlock-input')).toBeVisible()
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.composer .ProseMirror')).toContainText('还没发布的草稿')
    expect(await e2e.count(page, 'create_note')).toBe(0)
  })

  test('备份恢复强制锁定会丢弃旧库的未发布草稿', async ({ page }) => {
    await bootUnlocked(page, {}, '/notes')
    await page.locator('.composer .ProseMirror').fill('旧库还没发布的草稿')
    await e2e.emitEvent(page, 'tray-lock', { forced: true, resetDrafts: true })
    await expect(page.locator('.unlock-input')).toBeVisible()
    await page.locator('.unlock-input').fill('e2e-master-123')
    await page.locator('.unlock-btn').click()
    await expect(page.locator('.composer .ProseMirror')).toHaveText('')
    expect(await e2e.count(page, 'create_note')).toBe(0)
  })

  test('进入 /notes 自动拉取并渲染 seed 小记', async ({ page }) => {
    await gotoNotes(page)
    await expect(page.locator('.memo')).toHaveCount(3)
    await expect(page.locator('.titlebar-count')).toHaveText('3 条')
    expect(await e2e.count(page, 'list_notes')).toBe(1)
    // 窄栏默认收起，列表占满宽度
    await expect(page.locator('.workspace-directory')).toBeHidden()
    await expect(page.locator('[aria-label="展开目录"]')).toBeVisible()
  })

  test('复制正文：卡头按钮出纯文本，菜单不再重复', async ({ page }) => {
    await gotoNotes(page)
    const m = memo(page, '第一条小记')
    await m.hover()
    await m.getByRole('button', { name: '复制正文', exact: true }).click()
    await expectToast(page, '小记已复制')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('第一条小记：周会纪要与待办')
    await expect((await noteMenu(page, m)).getByText('复制正文', { exact: true })).toHaveCount(0)
  })

  test('一键复制带链接的小记：地址跟着走，纯文本和 HTML 都在', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [{ title: '链接', content_html: '<p>看 <a href="https://gitlab.test/x">GitLab 标题</a></p>' }],
    }, '/notes')
    const m = memo(page, 'GitLab 标题')
    await m.hover()
    await m.getByRole('button', { name: '复制正文', exact: true }).click()
    await expectToast(page, '小记已复制')

    expect(await page.evaluate(() => navigator.clipboard.readText()))
      .toBe('看 https://gitlab.test/x')

    const html = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read())[0]
      const blob = await item.getType('text/html')
      return blob.text()
    })
    expect(html).toContain('href="https://gitlab.test/x"')
  })

  test('composer 发布新小记', async ({ page }) => {
    await gotoNotes(page)
    const publish = page.locator('.composer button.btn-primary')
    await expect(publish).toBeDisabled()

    await page.locator('.composer .ProseMirror').click()
    await page.keyboard.type('E2E 发布测试内容')
    await expect(publish).toBeEnabled()
    await publish.click()

    await expect(page.locator('.memo')).toHaveCount(4)
    await expect(memo(page, 'E2E 发布测试内容')).toBeVisible()
    await expect(page.locator('.titlebar-count')).toHaveText('4 条')
    expect(await e2e.count(page, 'create_note')).toBe(1)
    const created = (await e2e.snapshot(page)).notes.find((n: any) => n.title.startsWith('E2E 发布测试'))
    expect(created).toBeTruthy()
    // 发布后 composer 清空
    await expect(page.locator('.composer .ProseMirror')).toHaveText('')
  })

  test('composer 默认三行，聚焦不跳高，超过三行后随内容增高', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    // scrollHeight 取整、行高 24.65，比对留 2px 余量
    const height = () => pm.evaluate((el) => el.getBoundingClientRect().height)
    const line = () => pm.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
    const over = async (base: number) => (await height()) - base

    const idle = await height()
    await pm.click()
    const floor = await height()
    const lh = await line()

    // 初始就预留三行，聚焦不改变输入区高度。
    expect(idle).toBeGreaterThanOrEqual(3 * lh)
    expect(Math.abs(floor - idle)).toBeLessThan(2)

    // 地板吃得下前两行，不再逐键跳动
    await page.keyboard.type('第一行')
    expect(await over(floor)).toBeLessThan(2)
    await page.keyboard.press('Enter')
    await page.keyboard.type('第二行')
    expect(await over(floor)).toBeLessThan(2)

    // 第三段连行带段距越过地板，此后逐键长
    await page.keyboard.press('Enter')
    await page.keyboard.type('第三行')
    expect(await over(floor)).toBeGreaterThan(2)

    await page.keyboard.press('Enter')
    await page.keyboard.type('第四行')
    expect(await over(floor)).toBeGreaterThan(2 * lh - 6)

    // 失焦不收回：内容还在就保持高
    await page.locator('.memo').first().click()
    await page.waitForTimeout(300)
    expect(await over(floor)).toBeGreaterThan(2 * lh - 6)

    // 删干净或按 Esc 都保留默认三行。
    await pm.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await expect.poll(async () => await over(floor), { timeout: 3000 }).toBeLessThan(2)
    await page.keyboard.press('Escape')
    await expect.poll(async () => await over(idle), { timeout: 3000 }).toBeLessThan(2)
  })

  test('composer 工具栏常显，聚焦、失焦和空内容按 Esc 都不收起', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const bar = page.locator('.composer-bar')
    const visible = () => bar.evaluate((el) => getComputedStyle(el).visibility)

    await expect(visible).resolves.toBe('visible')
    await pm.click()
    await expect.poll(visible, { timeout: 3000 }).toBe('visible')

    await page.locator('.memo').first().click()
    await page.waitForTimeout(300)
    await expect(visible).resolves.toBe('visible')

    await pm.click()
    await page.keyboard.press('Escape')
    await expect.poll(visible, { timeout: 3000 }).toBe('visible')
  })

  test('就地编辑：悬停按钮进入、自动保存、退出编辑', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第一条小记')
    // 双击编辑已移除：手一抖就进编辑，误触太多
    await target.dblclick()
    await expect(page.locator('.memo.editing')).toHaveCount(0)
    await target.hover()
    await tipButton(target, '编辑').click()
    const editor = page.locator('.memo.editing .ProseMirror')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('改写后的第一条内容')

    // 600ms 防抖自动保存 -> update_note
    await expect
      .poll(() => e2e.count(page, 'update_note'), { timeout: 5000 })
      .toBeGreaterThan(0)
    await page.locator('.memo.editing button.eb.primary', { hasText: '退出编辑' }).click()
    await expect(page.locator('.memo.editing')).toHaveCount(0)
    await expect(memo(page, '改写后的第一条内容')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const changed = snap.notes.find((n: any) => n.content_html.includes('改写后的第一条内容'))
    expect(changed).toBeTruthy()
  })

  for (const mode of ['card', 'full'] as const) {
    test(`已有小记 ${mode}：撤销与重做同步保存，退出编辑保留最后修改`, async ({ page }) => {
      await gotoNotes(page)
      const target = memo(page, '第一条小记')
      await target.hover()
      await tipButton(target, '编辑').click()
      if (mode === 'full') await tipButton(page.locator('.memo.editing'), '全屏书写').click()
      const surface = page.locator(mode === 'card' ? '.memo.editing' : '.fs')
      const toolbar = surface.locator('.note-toolbar')
      const pm = surface.locator('.ProseMirror')
      const original = '第一条小记：周会纪要与待办'
      const changed = original + '，继续修改'
      const undo = toolbar.getByRole('button', { name: '撤销', exact: true })
      const redo = toolbar.getByRole('button', { name: '重做', exact: true })
      await expect(toolbar.getByRole('button', { name: '取消', exact: true })).toHaveCount(0)
      await expect(toolbar.getByRole('button', { name: '完成', exact: true })).toHaveCount(0)
      await expect(undo).toBeDisabled()
      await expect(redo).toBeDisabled()
      if (mode === 'card') {
        await expect.poll(() => surface.locator('.memo-time').evaluate(el => getComputedStyle(el).opacity)).toBe('1')
      }
      const savedText = async () => {
        const snapshot = await e2e.snapshot(page)
        return snapshot.notes.find((note: any) => note.content_html.includes('第一条小记'))?.content_html
      }
      await pm.click()
      await pm.press('Control+End')
      await page.keyboard.insertText('，继续修改')
      await expect(pm).toHaveText(changed)
      await expect.poll(savedText).toBe(`<p>${changed}</p>`)
      await undo.click()
      await expect(pm).toHaveText(original)
      await expect.poll(savedText).toBe(`<p>${original}</p>`)
      await redo.click()
      await expect(pm).toHaveText(changed)
      // 重做后立即退出，最后一笔还在防抖窗口里也必须写入。
      await toolbar.getByRole('button', { name: '退出编辑', exact: true }).click()
      await expect(surface).toHaveCount(0)
      expect(await savedText()).toBe(`<p>${changed}</p>`)
      await expect(memo(page, changed)).toBeVisible()
    })
  }

  test('已有小记全屏清空正文后仍可退出，退出会保存空正文', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第一条小记')
    const snapshot = await e2e.snapshot(page)
    const id = snapshot.notes.find((note: any) => note.content_html.includes('第一条小记')).id
    await target.hover()
    await tipButton(target, '编辑').click()
    await tipButton(page.locator('.memo.editing'), '全屏书写').click()
    const fs = page.locator('.fs')
    await fs.locator('.ProseMirror').fill('')
    const exit = fs.locator('.note-toolbar').getByRole('button', { name: '退出编辑', exact: true })
    await expect(exit).toBeEnabled()
    await exit.click()
    await expect(fs).toHaveCount(0)
    await expect.poll(() => e2e.snapshot(page).then(s => s.notes.find((note: any) => note.id === id).content_html)).toBe('<p></p>')
  })

  test('新小记全屏仍可发布或放弃，放弃后切换模块不会恢复内容', async ({ page }) => {
    await gotoNotes(page)
    const composer = page.locator('.composer .ProseMirror')
    await composer.fill('尚未发布的内容')
    await tipButton(page.locator('.composer'), '全屏书写').click()
    const fs = page.locator('.fs')
    const toolbar = fs.locator('.note-toolbar')
    await expect(toolbar.getByRole('button', { name: '保存', exact: true })).toBeEnabled()
    await expect(toolbar.getByRole('button', { name: '退出编辑', exact: true })).toHaveCount(0)
    await toolbar.getByRole('button', { name: '放弃', exact: true }).click()
    await expect(fs).toHaveCount(0)
    await expect(composer).toHaveText('')
    await page.locator('a.nav-item[href="/entries"]').click()
    await page.locator('a.nav-item[href="/notes"]').click()
    await expect(composer).toHaveText('')
    expect(await e2e.count(page, 'create_note')).toBe(0)
  })

  test('草稿纯图发布：stage 后正文出图块，发布时补附件记录', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await e2e.queueDialog(page, 'C:/pics/avatar.png')
    await pm.click()
    await page.locator('.composer button[aria-label="添加图片"]').click()

    // 正文追加了图片块（列表默认 30% 宽），且没有任何文字也能发布
    await expect(pm.locator('.img-node')).toHaveCount(1)
    await expect(pm.locator('.img-node')).toHaveAttribute('style', /width: 30%/)
    const publish = page.locator('.composer button.btn-primary')
    await expect(publish).toBeEnabled()
    await publish.click()

    await expect(page.locator('.memo')).toHaveCount(4)
    const newMemo = page.locator('.memo').first()
    await expect(newMemo.locator('img[data-note-image]')).toHaveCount(1)
    // 正文已引用 -> 不再重复出现在附件位
    await expect(newMemo.locator('.memo-att')).toHaveCount(0)

    const snap = await e2e.snapshot(page)
    const bound = snap.attachments.find((a: any) => a.file_path.includes('avatar.png'))
    expect(bound).toBeTruthy()
    expect(bound.note_id).toBeTruthy()
  })

  test('长小记进入编辑后，初始光标位于文末且保持可见', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [{
        title: '长小记',
        content_html: Array.from({ length: 100 }, (_, i) => `<p>第 ${i} 段正文</p>`).join(''),
      }],
    })
    await page.locator('.memo').hover()
    await tipButton(page.locator('.memo'), '编辑').click()
    const editor = page.locator('.memo.editing .ProseMirror')
    await expect(editor).toBeFocused()
    await expect.poll(() => editor.evaluate(el => {
      const instance = (el as HTMLElement & { editor: Editor }).editor
      const head = instance.state.selection.head
      const caret = instance.view.coordsAtPos(head)
      const bounds = el.getBoundingClientRect()
      return {
        atEnd: head === instance.state.doc.content.size - 1,
        visible: caret.top >= bounds.top && caret.bottom <= bounds.bottom,
      }
    })).toEqual({ atEnd: true, visible: true })
  })

  test('已有小记配图：上传后图片块插进编辑正文', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第一条小记')
    await target.hover()
    await tipButton(target, '编辑').click()
    const editor = page.locator('.memo.editing .ProseMirror')
    await expect(editor).toBeVisible()

    // 光标放到开头再插图：图块应落在光标处而不是文末
    await editor.click()
    await expect(editor).toBeFocused()
    await editor.press('Control+Home')
    await expect.poll(() => editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.state.selection.from)).toBe(1)
    await e2e.queueDialog(page, 'C:/pics/pic.png')
    await page.locator('.memo.editing button[aria-label="添加图片"]').click()
    await expect(editor.locator('.img-node')).toHaveCount(1)
    await expect(editor.locator('> *').first()).toHaveClass(/img-node/)
    await expect(editor.locator('.img-node')).toHaveAttribute('style', /width: 30%/)

    // 拖右下角手柄：改宽度并随正文落库。
    // e2e 里 asset:// 图加载失败、块高为 0，坐标命中不到手柄，改为直接派发 pointerdown，
    // 后续 move/up 用真实鼠标事件走 window 监听。
    const handle = page.locator('.memo.editing .img-node .img-resize')
    const box = await handle.boundingBox()
    await handle.dispatchEvent('pointerdown', { clientX: box!.x + 7, clientY: box!.y + 7 })
    await page.mouse.move(box!.x + 150, box!.y + 7, { steps: 6 })
    await page.mouse.up()
    await expect(editor.locator('.img-node')).not.toHaveAttribute('style', /width: 30%/)

    await page.locator('.memo.editing button.eb.primary', { hasText: '退出编辑' }).click()
    await expect(memo(page, '第一条小记').locator('img[data-note-image]')).toHaveCount(1)
    const snap = await e2e.snapshot(page)
    const saved = snap.notes.find((n: any) => n.content_html.includes('pic.png'))
    expect(saved).toBeTruthy()
    expect(saved.content_html).toMatch(/style="width: \d+(\.\d+)?%/)
    expect(snap.attachments.some((a: any) => a.file_path.includes('pic.png'))).toBe(true)
  })

  test('粘贴截图：字节交附件落盘，图片块插回光标处', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('先看这句')

    await pasteInto(page, '.composer .ProseMirror', { files: [{ name: 'shot.png', type: 'image/png' }] })
    await expect(pm.locator('.img-node')).toHaveCount(1)
    await expect(pm.locator('> *').first()).toHaveText('先看这句')
    expect(await e2e.count(page, 'save_attachment_bytes')).toBe(1)

    // 纯文本/富文本粘贴不接管：不该再多跑一趟字节通道
    await pasteInto(page, '.composer .ProseMirror', { html: '<p>只是文字</p>' })
    await expect(pm).toContainText('只是文字')
    expect(await e2e.count(page, 'save_attachment_bytes')).toBe(1)
  })

  test('拖入图片文件：只收图片，路径走附件落盘补进当前书写面', async ({ page }) => {
    await gotoNotes(page)
    await expect
      .poll(() => e2e.hasListener(page, 'tauri://drag-drop'), { timeout: 10_000 })
      .toBe(true)
    await e2e.emitEvent(page, 'tauri://drag-drop', {
      type: 'drop',
      paths: ['C:/pics/dropped.png', 'C:/notes.txt'],
      position: { x: 420, y: 300 },
    })

    const pm = page.locator('.composer .ProseMirror')
    await expect(pm.locator('.img-node')).toHaveCount(1)
    // 没开任何书写面就落胶囊草稿：只 stage，发布时才补附件记录
    expect(await e2e.count(page, 'stage_attachment')).toBe(1)
    expect(await e2e.count(page, 'save_attachment_bytes')).toBe(0)
  })

  test('全屏书写开着时拖图：图落全屏面并按小记登记', async ({ page }) => {
    await gotoNotes(page)
    const m = memo(page, '第一条小记')
    await m.hover()
    await tipButton(m, '全屏查看').click()
    await page.locator('.fs-head .bar-btn.primary').click()
    const pm = page.locator('section.fs .ProseMirror')
    await expect(pm).toBeVisible()
    await expect
      .poll(() => e2e.hasListener(page, 'tauri://drag-drop'), { timeout: 10_000 })
      .toBe(true)

    await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths: ['C:/pics/in-fs.png'], position: { x: 500, y: 300 } })
    await expect(pm.locator('.img-node')).toHaveCount(1)
    // 全屏面挂的是已有小记：路径直接按 note_id 登记，不再走草稿 stage
    expect(await e2e.count(page, 'upload_attachment')).toBe(1)
    expect(await e2e.count(page, 'stage_attachment')).toBe(0)
  })

  test('归档视图里拖图：没有书写面，只提示不落盘', async ({ page }) => {
    await bootUnlocked(page, { notes: [{ title: '丙', content_html: '<p>已经收走</p>', archived: true }] }, '/notes')
    await openDirectory(page)
    await page.locator('.rail button.rail-item', { hasText: '归档' }).click()
    await expect(page.locator('.composer')).toHaveCount(0)
    await expect
      .poll(() => e2e.hasListener(page, 'tauri://drag-drop'), { timeout: 10_000 })
      .toBe(true)

    await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths: ['C:/pics/nope.png'], position: { x: 40, y: 40 } })
    await expectToast(page, '归档视图里不能写，先退出归档')
    expect(await e2e.count(page, 'stage_attachment')).toBe(0)
    expect(await e2e.count(page, 'upload_attachment')).toBe(0)
  })

  test('粘贴带 base64 内嵌图的富文本：文字进来，图不落库', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await pasteInto(page, '.composer .ProseMirror', {
      html: '<p>前面<img src="data:image/png;base64,iVBORw0KGgo=">后面</p>',
    })

    await expect(pm).toHaveText('前面后面')
    await expect(pm.locator('img')).toHaveCount(0)
    await page.locator('.composer button.btn-primary').click()
    const saved = memo(page, '前面后面')
    await expect(saved.locator('img')).toHaveCount(0)
    const snap = await e2e.snapshot(page)
    expect(snap.notes.some((n: any) => n.content_html.includes('data:image'))).toBe(false)
  })

  test('置顶与收藏', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第三条小记')
    await target.hover()
    await target.locator('button.ib[title="置顶"]').click()
    await expect(target).toHaveClass(/pinned/)
    // 置顶态只由动作按钮表达：状态标里不再放第二个图钉
    await expect(target.locator('.state-pin')).toHaveCount(0)
    await expect(tipButton(target, '取消置顶')).toHaveClass(/on/)
    expect((await e2e.snapshot(page)).notes.find((n: any) => n.content_html.includes('第三条')).pinned).toBe(true)

    await target.hover()
    // 收藏住在 ⋯ 里：卡头右端被动作排压住，状态只由实心星在离开悬停后说明
    await (await noteMenu(page, target)).locator('.pop-item:text-is("收藏")').click()
    await expect((await noteMenu(page, target)).locator('.pop-item:text-is("取消收藏")')).toHaveCount(1)
    // 悬停时状态标让位（opacity 归零），否则它躲在动作排底下一半
    // opacity 带过渡动画，单次采样会读到中间值，轮询到收敛
    await expect
      .poll(() => target.locator('.memo-state').evaluate((el) => getComputedStyle(el).opacity))
      .toBe('0')
    await page.mouse.move(4, 4)
    await expect(target.locator('.state-star')).toBeVisible()
    expect((await e2e.snapshot(page)).notes.find((n: any) => n.content_html.includes('第三条')).starred).toBe(true)
  })

  test('归档：从「全部」收起，在归档视图找回', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [
        { title: '甲', content_html: '<p>在册甲</p>' },
        { title: '乙', content_html: '<p>在册乙</p>' },
        { title: '丙', content_html: '<p>已经收走</p>', archived: true },
      ],
    }, '/notes')

    // 归档行不占「全部」的卡位，也不进顶栏那个条数
    await expect(page.locator('.memo')).toHaveCount(2)
    await expect(page.locator('.titlebar-count')).toHaveText('2 条')

    // 窄窗默认收侧栏，视图切换要先展开
    await openDirectory(page)
    const archivedRail = page.locator('.rail button.rail-item', { hasText: '归档' })
    await expect(archivedRail.locator('.tab-count')).toHaveText('1')
    await archivedRail.click()

    await expect(page.locator('.archive-bar .ab-lead')).toHaveText('已归档 · 不出现在「全部」列表，可在本视图搜索')
    await expect(page.locator('.composer')).toHaveCount(0)
    const archived = memo(page, '已经收走')
    await archived.hover()
    // 归档视图的快捷排与「全部」同构五颗，被让位的开关与低频/危险动作都在 ⋯ 里
    await expect(archived.locator('.memo-acts button')).toHaveCount(5)
    await tipButton(archived, '更多操作').first().click()
    await expect(page.locator('.popover .pop-item')).toHaveText(['收藏', '置顶', '导出', '加密', '删除'])
    await page.keyboard.press('Escape')
    await expect(page.locator('.popover')).toHaveCount(0)
    await tipButton(archived, '取消归档，放回「全部」').click()
    await expectToast(page, '已取消归档，回到「全部」')
    await waitForToastGone(page)
    await expect(page.locator('.empty-title')).toHaveText('还没有归档的小记')
    // 内容区那几击把浮层侧栏收掉了（点内容即收），要读条数得再叫出来
    await openDirectory(page)
    await expect(archivedRail.locator('.tab-count')).toHaveText('0')
    expect((await e2e.snapshot(page)).notes.find((n: any) => n.title === '丙').archived).toBe(false)

    // 回「全部」把在册的那条收走
    await page.locator('.rail button.rail-item', { hasText: '全部' }).click()
    await expect(page.locator('.memo')).toHaveCount(3)
    const target = memo(page, '在册乙')
    await (await noteMenu(page, target)).locator('.pop-item:text-is("归档")').click()
    await expectToast(page, '已归档，可在「归档」视图找回')
    await expect(page.locator('.memo')).toHaveCount(2)
    const snap = (await e2e.snapshot(page)).notes.find((n: any) => n.title === '乙')
    expect(snap.archived).toBe(true)
    expect(typeof snap.archived_at).toBe('number')
  })

  test('批量归档与「全部取消归档」', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [
        { title: '甲', content_html: '<p>在册甲</p>' },
        { title: '乙', content_html: '<p>在册乙</p>' },
        { title: '丙', content_html: '<p>已经收走</p>', archived: true },
      ],
    }, '/notes')

    const first = memo(page, '在册甲')
    await first.hover()
    await first.locator('.memo-check').click()
    await memo(page, '在册乙').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 2 条')
    await page.locator('button.dock-btn:text-is("归档")').click()
    await expectToast(page, '已归档 2 条小记')
    await waitForToastGone(page)
    await expect(page.locator('.memo')).toHaveCount(0)

    await openDirectory(page)
    await page.locator('.rail button.rail-item', { hasText: '归档' }).click()
    await expect(page.locator('.memo')).toHaveCount(3)
    await page.locator('.archive-bar .ab-btn').click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('3 条小记将回到「全部」列表。')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已取消归档 3 条小记')
    await expect(page.locator('.memo')).toHaveCount(0)
    expect((await e2e.snapshot(page)).notes.every((n: any) => !n.archived)).toBe(true)
  })

  test('搜索过滤与 rail 视图筛选', async ({ page }) => {    await gotoNotes(page)
    const search = page.locator('.page-bar .search-box input')
    await search.fill('采购')
    await expect(page.locator('.memo')).toHaveCount(1)
    await expect(page.locator('.titlebar-count')).toHaveText('1 / 3 条')
    await page.locator('button[title="清空搜索"]').click()
    await expect(page.locator('.memo')).toHaveCount(3)

    // 窄栏默认收起，视图筛选要先展开它
    await openDirectory(page)
    await page.locator('.rail button.rail-item', { hasText: '收藏' }).click()
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配的小记')
    await page.locator('.rail button.rail-item.danger', { hasText: '清空筛选' }).click()
    await expect(page.locator('.memo')).toHaveCount(3)
  })

  test('批量删除小记', async ({ page }) => {
    await gotoNotes(page)
    // 勾选即进：点卡的勾选位即入批量态，不碰工具栏钮
    const first = memo(page, '第一条小记')
    await first.hover()
    await first.locator('.memo-check').click()
    await expect(page.locator('.batch-dock')).toBeVisible()

    await memo(page, '第二条小记').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 2 条')
    await expect(memo(page, '第一条小记')).toHaveClass(/is-sel/)
    // 选中后可见的 1px 环随当前强调色变化。
    await expect.poll(() => memo(page, '第一条小记').evaluate(el => getComputedStyle(el).boxShadow)).toContain('0px 0px 0px 1px')
    // 上下键换焦点，微环跟着走
    await page.locator('.memo').first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.memo').nth(1)).toBeFocused()

    await page.locator('button.dock-btn:text-is("删除")').click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('2 条小记将被删除，此操作不可撤销。')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已删除 2 条小记')
    await expect(page.locator('.memo')).toHaveCount(1)
    // 删除后退出批量模式
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    expect((await e2e.snapshot(page)).notes).toHaveLength(1)
  })

  test('合并小记：旧到新焊接同类列表，单选禁用，确认后替换源条目', async ({ page }) => {
    const tasks = (a: string, b: string) => `<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>${a}</p></li><li data-type="taskItem" data-checked="false"><p>${b}</p></li></ul>`
    await bootUnlocked(page, { notes: [
      { title: '甲', content_html: tasks('甲一', '甲二') + '<p><br></p>' },
      { title: '乙', content_html: '<p>&nbsp;</p>' + tasks('乙一', '乙二') },
      { title: '丙', content_html: '<ul><li>丙一</li><li>丙二</li><li>丙三</li></ul>' },
    ] }, '/notes')
    const sourceIds = (await e2e.snapshot(page)).notes.map((n: any) => n.id)
    await memo(page, '甲一').hover()
    await memo(page, '甲一').locator('.memo-check').click()
    const merge = page.getByRole('button', { name: '合并', exact: true })
    await expect(merge).toBeDisabled()
    await memo(page, '乙一').locator('.memo-check').click()
    await memo(page, '丙一').locator('.memo-check').click()
    await merge.click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('3 条小记将合成一条，原条目将被删除，此操作不可撤销。')
    await confirm.getByRole('button', { name: '合并', exact: true }).click()
    await expectToast(page, '已合并 3 条小记')
    await expect(page.locator('.memo')).toHaveCount(1)
    const result = page.locator('.memo')
    await expect(result.locator('ul[data-type="taskList"]')).toHaveCount(1)
    await expect(result.locator('ul[data-type="taskList"] > li')).toHaveText(['甲一', '甲二', '乙一', '乙二'])
    await expect(result.locator('ul:not([data-type]) > li')).toHaveText(['丙一', '丙二', '丙三'])
    const snapshot = await e2e.snapshot(page)
    expect(snapshot.notes).toHaveLength(1)
    expect(sourceIds).not.toContain(snapshot.notes[0].id)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
  })

  test('合并加密小记：保留加密属性，可再次锁定且源条目消失', async ({ page }) => {
    await bootUnlocked(page, { notePassphrase: NOTE_PASS, noteOpen: true, notes: [
      { title: '甲', content_html: '<ul><li>加密甲</li></ul>', encrypted: true },
      { title: '乙', content_html: '<ul><li>加密乙</li></ul>', encrypted: true },
    ] }, '/notes')
    await memo(page, '加密甲').hover()
    await memo(page, '加密甲').locator('.memo-check').click()
    await memo(page, '加密乙').locator('.memo-check').click()
    await page.getByRole('button', { name: '合并', exact: true }).click()
    await page.locator('.confirm-dialog').getByRole('button', { name: '合并', exact: true }).click()
    await expectToast(page, '已合并 2 条小记')
    await expect(page.locator('.memo')).toHaveCount(1)
    const snapshot = await e2e.snapshot(page)
    expect(snapshot.notes[0].encrypted).toBe(true)
    // 与普通加密操作同口径：本会话仍可读，重新锁定后才显示锁形卡。
    await expect(page.locator('.memo li')).toHaveText(['加密甲', '加密乙'])
    await (await noteMenu(page, page.locator('.memo'))).getByText('重新锁定', { exact: true }).click()
    await expect(page.locator('.memo-locked')).toHaveCount(1)
    await expect(page.locator('.memo-body')).toHaveCount(0)
  })

  test('未解锁的小记拒绝合并并显示数量', async ({ page }) => {
    await bootUnlocked(page, { notePassphrase: NOTE_PASS, notes: [
      { title: '甲', content_html: '<p>锁着的甲</p>', encrypted: true },
      { title: '乙', content_html: '<p>锁着的乙</p>', encrypted: true },
    ] }, '/notes')
    await page.locator('.memo').first().hover()
    await page.locator('.memo-check').first().click()
    await page.locator('.memo-check').nth(1).click()
    await page.getByRole('button', { name: '合并', exact: true }).click()
    await expectToast(page, '未合并：2 条小记未解锁')
    await expect(page.locator('.confirm-dialog')).toHaveCount(0)
    expect(await e2e.count(page, 'create_note')).toBe(0)
  })

  test('全屏阅读首栏可以复制正文，菜单不重复', async ({ page }) => {
    await gotoNotes(page)
    const first = memo(page, '第一条小记')
    await first.hover()
    await first.getByRole('button', { name: '全屏查看', exact: true }).click()
    await page.locator('.fs-head').getByRole('button', { name: '复制正文', exact: true }).click()
    await expectToast(page, '小记已复制')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('第一条小记：周会纪要与待办')
    await page.locator('.fs-head').getByRole('button', { name: '更多操作', exact: true }).click()
    await expect(page.locator('.popover').getByText('复制正文', { exact: true })).toHaveCount(0)
  })

  test('工具栏「选择」钮：开待选显形勾选框，Esc 整体退出', async ({ page }) => {
    await gotoNotes(page)
    await page.locator('.page-bar .bar-btn[aria-label="选择小记"]').click()
    // 待选态：勾选框与 0 选 dock 一起出现，随时可以完成选择。
    await expect(page.locator('.memo.batchable')).toHaveCount(3)
    await expect(page.locator('.dock-count')).toHaveText('已选 0 条')
    await memo(page, '第一条小记').click()
    await expect(page.locator('.batch-dock')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.memo.batchable')).toHaveCount(0)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
  })

  test('全屏书写发布', async ({ page }) => {
    await gotoNotes(page)
    // 工具条随展开才出现：先点输入框，再走全屏入口
    await page.locator('.composer .ProseMirror').click()
    await page.locator('.composer button[title="全屏书写"], .composer button[data-tip="全屏书写"]').click()
    const fs = page.locator('section.fs')
    await expect(fs).toBeVisible()

    await fs.locator('.ProseMirror').click()
    await page.keyboard.type('全屏书写的内容')
    await fs.locator('.fs-foot button.eb.primary', { hasText: '保存' }).click()
    await expect(fs).toHaveCount(0)
    await expect(memo(page, '全屏书写的内容')).toBeVisible()
    await expect(page.locator('.memo')).toHaveCount(4)
  })

  test('全屏书写：撤销/重做钮跟着历史栈走，键盘那条也认', async ({ page }) => {
    await gotoNotes(page)
    await page.locator('.composer .ProseMirror').click()
    await page.locator('.composer button[title="全屏书写"], .composer button[data-tip="全屏书写"]').click()
    const fs = page.locator('section.fs')
    await expect(fs).toBeVisible()

    const pm = fs.locator('.ProseMirror')
    const undo = fs.locator('.fs-foot button[aria-label="撤销"]')
    const redo = fs.locator('.fs-foot button[aria-label="重做"]')
    // 没得退时钮在但灰着：藏起来会让人以为这里压根不能撤销
    await pm.click()
    await expect(undo).toBeDisabled()
    await expect(redo).toBeDisabled()

    await page.keyboard.type('第一段')
    await expect(undo).toBeEnabled()
    await undo.click()
    await expect(pm).toHaveText('')
    await expect(undo).toBeDisabled()
    await expect(redo).toBeEnabled()

    await redo.click()
    await expect(pm).toHaveText('第一段')
    // 键盘快捷键与钮同一条历史栈（StarterKit 的 history 一直开着）
    await page.keyboard.press('Control+z')
    await expect(pm).toHaveText('')
  })

  test('全屏查看：只读渲染、转编辑、Esc 关闭', async ({ page }) => {
    await gotoNotes(page)
    const m = memo(page, '第一条小记')
    await m.hover()
    await tipButton(m, '全屏查看').click()
    const fs = page.locator('section.fs')
    await expect(fs).toBeVisible()
    await expect(fs.locator('.fs-title')).toHaveCount(0)
    await expect(fs.locator('.fs-view > p').first()).toBeVisible()
    await expect(fs.locator('.fs-view > p').first()).toHaveText('第一条小记：周会纪要与待办')
    // 只读层没有编辑器，动作住在首栏右侧，底栏不再出现
    await expect(fs.locator('.ProseMirror')).toHaveCount(0)
    await expect(page.locator('.fs-head .save-hint')).toHaveText('只读浏览')
    await expect(fs.locator('.fs-hint')).toHaveCount(0)
    await expect(fs.locator('.fs-foot')).toHaveCount(0)

    // 查看转编辑：书写面接管同一条正文
    await page.locator('.fs-head .bar-btn.primary').click()
    await expect(fs.locator('.fs-view')).toHaveCount(0)
    await expect(fs.locator('.ProseMirror')).toContainText('第一条小记')

    await page.keyboard.press('Escape')
    await expect(fs).toHaveCount(0)
  })

  test('小记口令：一把开全库，行操作全平铺', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [
        { title: '机密事', content_html: '<h2>机密事</h2><p>要加密的正文</p>' },
        { title: '封存', content_html: '<h2>封存</h2><p>封存的正文</p>', encrypted: true },
      ],
    }, '/notes')
    const cards = page.locator('.memo')
    await expect(cards).toHaveCount(2)
    const sealed = cards.nth(0) // seed 里更新的那条，开局就锁着
    const plain = cards.nth(1)
    // 锁着的正文根本不进 DOM
    await expect(page.locator('.memo-body')).not.toContainText('封存的正文')
    await expect(page.locator('.memo-locked')).toHaveCount(1)
    // 露标题上线前锁的那条：库里 title 是空的，本会话第一次解锁前只剩提示语
    await expect(sealed.locator('.memo-locked')).toContainText('已加密 · 点击解锁')
    // 锁着的条目可解锁或发起明文导出；加密动作仍在明文卡的 ⋯ 里
    await expect(sealed.locator('.memo-acts button')).toHaveCount(2)
    await expect(sealed.getByRole('button', { name: '导出', exact: true })).toHaveCount(1)
    await expect(plain.locator('.memo-acts button')).toHaveCount(5)

    // 首次加密就是立全库口令，只有这一次要输两格
    await (await noteMenu(page, plain)).locator('.pop-item:text-is("加密")').click()
    const dialog = page.locator('.note-lock-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input[type="password"]')).toHaveCount(2)
    await expect(dialog.locator('button.btn-primary')).toBeDisabled()
    await dialog.locator('input[type="password"]').first().fill(NOTE_PASS)
    await dialog.locator('input[type="password"]').nth(1).fill(NOTE_PASS)
    await dialog.locator('button.btn-primary').click()
    await expectToast(page, '已加密，本会话内仍可读')
    await expect(dialog).toHaveCount(0)
    // 一把口令开全库：seed 里那条锁着的也跟着见了光
    await expect(sealed.locator('.memo-body')).toContainText('封存的正文')
    await expect(page.locator('.memo-locked')).toHaveCount(0)
    // 解锁后不挂角标：移出鼠标不该再亮一把闭锁让人以为又锁上了
    await page.mouse.move(4, 4)
    await expect(plain.locator('.memo-state')).toBeEmpty()
    await expect(sealed.locator('.memo-state')).toBeEmpty()

    // 悬停时才由 ⋯ 菜单说明加密状态：加密过的那条露出「重新锁定」
    const menu = await noteMenu(page, plain)
    await expect(menu.locator('.pop-item:text-is("重新锁定")')).toHaveCount(1)
    await menu.locator('.pop-item:text-is("重新锁定")').click()
    await expectToast(page, '已重新锁定')
    // 只收回这一条：另一条明文还在手
    await expect(page.locator('.memo-locked')).toHaveCount(1)
    // 这次加密的小记在锁的时候就留了真标题，锁回照样认得出
    await expect(plain.locator('.locked-title')).toHaveText('机密事')
    // 锁回的正文不进搜索
    await page.locator('.page-bar .search-box input').fill('要加密的正文')
    await expect(page.locator('.memo')).toHaveCount(0)
    await page.locator('.page-bar .search-box input').fill('')
    await expect(page.locator('.memo')).toHaveCount(2)

    // 口令还在手：单条再开不再问一次
    await plain.click()
    await expect(dialog).toHaveCount(0)
    await expect(plain.locator('.memo-body')).toContainText('要加密的正文')

    // 整库锁回 → 错口令拦在弹窗里 → 对的一次开全部
    await page.locator('.page-bar button[aria-label="锁定全部加密小记"]').click()
    await expectToast(page, '已锁定全部加密小记')
    await expect(page.locator('.memo-locked')).toHaveCount(2)
    // 解锁时回填的标题留了下来：老数据锁回去也认得出是哪条，还搜得着
    await expect(sealed.locator('.locked-title')).toHaveText('封存')
    await page.locator('.page-bar .search-box input').fill('封存')
    await expect(page.locator('.memo')).toHaveCount(1)
    await page.locator('.page-bar .search-box input').fill('')
    await sealed.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input[type="password"]')).toHaveCount(1)
    await dialog.locator('input[type="password"]').fill('错的口令')
    await dialog.locator('button.btn-primary').click()
    await expect(dialog.locator('.dialog-err')).toContainText('密码错误')
    await dialog.locator('input[type="password"]').fill(NOTE_PASS)
    await dialog.locator('button.btn-primary').click()
    await expect(dialog).toHaveCount(0)
    // 一次解锁 = 全库开：两条锁着的都回来了
    await expect(memo(page, '封存的正文')).toBeVisible()
    await expect(memo(page, '要加密的正文')).toBeVisible()

    // 忘口令兜底：应用已解锁，零输入直接开
    await page.locator('.page-bar button[aria-label="锁定全部加密小记"]').click()
    await sealed.click()
    await dialog.locator('.link-btn').click()
    await expectToast(page, '已用主密码解锁全部加密小记')
    await expect(dialog).toHaveCount(0)
    await expect(memo(page, '封存的正文')).toBeVisible()
    expect(await e2e.count(page, 'note_key_recover')).toBe(1)
  })

  test('设置·小记页签：粘贴整理默认开启，没设过口令时显示说明', async ({ page }) => {
    await bootUnlocked(page, SEED, '/notes')
    const dialog = await openSettings(page, 'notes')
    const pane = visiblePane(dialog)
    await expect(pane.getByRole('checkbox', { name: '粘贴时整理格式' })).toBeChecked()
    const keyRow = pane.locator('.setting-item').filter({ hasText: '小记口令' })
    await expect(keyRow.locator('.setting-name')).toHaveText('小记口令')
    await expect(keyRow.locator('.setting-desc')).toContainText('首次加密小记时设置')
    await expect(pane.locator('.setting-item.clickable')).toHaveCount(0)
  })

  test('设置·小记口令改密链：先解锁再改，旧口令即刻作废', async ({ page }) => {
    const NEW_PASS = 'brand-new-key-9'
    await bootUnlocked(page, {
      notes: [{ title: '封存', content_html: '<p>封存的正文</p>', encrypted: true }],
      notePassphrase: NOTE_PASS,
    }, '/notes')
    const dialog = await openSettings(page, 'notes')
    const row = visiblePane(dialog).locator('.setting-item.clickable')
    await expect(row).toContainText('修改小记口令')

    // 口令不在手：点进去先拦解锁，错口令留在弹窗里
    await row.click()
    const key = page.locator('.note-lock-dialog')
    await expect(key).toHaveAttribute('aria-label', '解锁全部加密小记')
    await key.locator('input[type="password"]').fill('错位的口令')
    await key.locator('button.btn-primary').click()
    await expect(key.locator('.dialog-err')).toContainText('密码错误')

    // 解锁成功不返回设置页，而是直接续上改密格：两格输入
    await key.locator('input[type="password"]').fill(NOTE_PASS)
    await key.locator('button.btn-primary').click()
    await expect(key).toHaveAttribute('aria-label', '修改小记口令')
    await expect(key.locator('input[type="password"]')).toHaveCount(2)
    // 位数不够：提交钮不亮
    await key.locator('input[type="password"]').first().fill('short')
    await key.locator('input[type="password"]').nth(1).fill('short')
    await expect(key.locator('button.btn-primary')).toBeDisabled()
    await key.locator('input[type="password"]').first().fill(NEW_PASS)
    await key.locator('input[type="password"]').nth(1).fill('another-key-9')
    await expect(key.locator('.dialog-err')).toContainText('两次口令不一致')
    await key.locator('input[type="password"]').nth(1).fill(NEW_PASS)
    await key.locator('button.btn-primary').click()
    await expectToast(page, '小记口令已修改')
    await expect(key).toHaveCount(0)

    await dialog.locator('.dialog-close').click()
    // 改完口令域还开着：锁着的正文此刻已经见光（加密 seed 的标题不进锁牌，按位置认这条）
    const sealed = page.locator('.memo').first()
    await expect(sealed.locator('.memo-body')).toContainText('封存的正文')
    // 整库锁回后验轮换：旧口令被拒，新口令一次开全库
    await page.locator('.page-bar button[aria-label="锁定全部加密小记"]').click()
    await expectToast(page, '已锁定全部加密小记')
    await waitForToastGone(page)
    await sealed.click()
    await expect(key).toBeVisible()
    await key.locator('input[type="password"]').fill(NOTE_PASS)
    await key.locator('button.btn-primary').click()
    await expect(key.locator('.dialog-err')).toContainText('密码错误')
    await key.locator('input[type="password"]').fill(NEW_PASS)
    await key.locator('button.btn-primary').click()
    await expect(key).toHaveCount(0)
    await expect(memo(page, '封存的正文')).toBeVisible()
  })

  test('卡片上勾选任务项：改动落库，进编辑态不弹回', async ({ page }) => {
    await bootUnlocked(page, { notes: [{ title: '清单', content_html: TODO_HTML }] }, '/notes')
    const boxes = page.locator('.memo .memo-body input[type=checkbox]')
    await expect(boxes).toHaveCount(2)
    const checked = (i: number) => boxes.nth(i).evaluate((el) => (el as HTMLInputElement).checked)
    const stored = async () => (await e2e.snapshot(page)).notes[0].content_html as string

    await boxes.first().click()
    await expect.poll(() => e2e.count(page, 'update_note')).toBe(1)
    expect(await stored()).toContain('data-checked="true"')
    // 只动点中的那一项
    expect(await checked(1)).toBe(false)

    await boxes.first().click()
    await expect.poll(() => e2e.count(page, 'update_note')).toBe(2)
    expect(await stored()).toContain('data-checked="false"')

    // 连点勾选框是勾了又撤，不该顺手把编辑态拉开
    expect(await checked(0)).toBe(false)

    await boxes.first().click()
    await expect.poll(() => e2e.count(page, 'update_note')).toBe(3)
    expect(await stored()).toContain('data-checked="true"')

    // 进编辑态，勾选状态要跟着带进去
    const m = memo(page, '清单')
    await m.hover()
    await tipButton(m, '编辑').click()
    await expect(page.locator('.memo.editing')).toBeVisible()
    await expect(
      page.locator('.memo.editing .ProseMirror input[type=checkbox]').first(),
    ).toBeChecked()
  })

  test('斜杠命令在有文字的行上另起一块，不留段内换行', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('发布前 /')
    await page.locator('.slash-item', { hasText: '任务列表' }).first().click()
    await page.keyboard.type('abc')
    const sum = await page.evaluate(() => {
      const root = document.querySelector('.composer .ProseMirror')!
      const li = root.querySelector('li')
      const p = li?.querySelector('div > p')
      return {
        blocks: Array.from(root.children).map((c) => c.tagName).join(','),
        itemText: p?.textContent ?? null,
        itemBr: Array.from(p?.querySelectorAll('br') ?? []).length,
        caretInLi: li?.contains(window.getSelection()?.anchorNode ?? null) ?? false,
      }
    })
    // 旧实现插的是段内硬换行：正文掉到勾选框下面一行，光标也不可见
    expect(sum).toEqual({ blocks: 'P,UL,P', itemText: 'abc', itemBr: 0, caretInLi: true })
  })

  test('空任务项的正文撑满行宽，光标有行盒可落', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('/')
    await page.locator('.slash-item', { hasText: '任务列表' }).first().click()
    const w = await page.evaluate(() => {
      const li = document.querySelector('.composer .ProseMirror li')!
      return Math.round(li.querySelector('div > p')!.getBoundingClientRect().width)
    })
    // 正文 div 是弹性项，不撑开就按内容缩成 0 宽，空条目里看不见光标
    expect(w).toBeGreaterThan(100)
  })

  test('任务项勾选框与正文在同一视觉行', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('[] 第一项')
    const diff = await page.evaluate(() => {
      const li = document.querySelector('.composer .ProseMirror li')!
      const box = li.querySelector('input')!.getBoundingClientRect()
      const text = li.querySelector('div p')!.getBoundingClientRect()
      return Math.abs(text.top + text.height / 2 - (box.top + box.height / 2))
    })
    // 块间距规则泄漏进 li 时正文会被压下去 8px，肉眼就是「文字掉到勾选框下面」
    expect(diff).toBeLessThan(3)
  })

  test('勾完任务项光标留在这一条，打字不跑到下一行', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('[] 第一项')
    await page.locator('.composer .ProseMirror input[type=checkbox]').first().click()
    await page.keyboard.type('ABC')
    await expect(pm.locator('li p').first()).toHaveText('第一项ABC')
  })

  test('Markdown：待办前缀把当前行变成任务项', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('[] 买牛奶')
    await expect(pm.locator('ul[data-type="taskList"] li p').first()).toHaveText('买牛奶')
    await expect(pm.locator('input[type=checkbox]')).toHaveCount(1)
  })

  test('键盘快捷键：在光标处起一段行内代码', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('跑 ')
    await page.keyboard.press('Control+e')
    await page.keyboard.type('npm test')
    await expect(pm.locator('code')).toHaveText('npm test')
  })

  /** 把浏览器/IM 里复制的一段带链接文字喂给编辑器 */
  async function pasteHtml(page: Page, plain: string, html: string) {
    await page.evaluate(([plain, html]) => {
      const data = new DataTransfer()
      data.setData('text/plain', plain)
      data.setData('text/html', html)
      document.querySelector('.composer .ProseMirror')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, [plain, html])
  }

  /** 按文档位置划选区：浮动条要的是真选区，不是 DOM 上的 range */
  function selectRange(page: Page, from: number, to: number) {
    return page.locator('.composer .ProseMirror').evaluate((el, range) => {
      ;(el as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(range)
    }, { from, to })
  }

  test('粘贴带链接的文字：地址留在正文里，发布后也还在', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await pasteHtml(page, '看 GitLab 标题', '<p>看 <a href="https://gitlab.test/x">GitLab 标题</a></p>')
    await expect(pm.locator('a')).toHaveAttribute('href', 'https://gitlab.test/x')

    await page.locator('.composer button.btn-primary').click()
    const stored = (await e2e.snapshot(page)).notes
      .find((n: any) => n.content_html.includes('GitLab 标题'))?.content_html
    expect(stored).toContain('href="https://gitlab.test/x"')
  })

  test('粘贴网页链接先保留网址，再由提示转换为标题', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const url = 'https://gitlab.test/rtcsdk/cpp-sdk/-/merge_requests/1108'
    const title = 'fix: forward AI hotword result callbacks (!1108) · GitLab'
    await pm.click()
    await pasteHtml(page, url, `<a href="${url}">${title}</a>`)
    await expect(pm).toHaveText(url)
    await expect(pm.locator('a')).toHaveAttribute('href', url)
    await expect(page.locator('.slash-menu')).toHaveCount(0)
    const prompt = page.getByRole('group', { name: '链接粘贴选项' })
    await expect(prompt).toContainText(title)
    await prompt.getByRole('button', { name: '转换为标题' }).click()
    await expect(pm.locator('a')).toHaveText(title)
    await expect(pm.locator('a')).toHaveAttribute('href', url)
    await expect(prompt).toHaveCount(0)

    await pm.press('End')
    await pm.press('Enter')
    await pasteHtml(page, url, `<a href="${url}">${title}</a>`)
    await prompt.getByRole('button', { name: '保留网址' }).click()
    await expect(pm.locator('a').last()).toHaveText(url)
    await expect(prompt).toHaveCount(0)
  })

  test('粘贴纯网址不弹转换提示，仍保留可点击链接', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const url = 'https://gitlab.test/x'
    await pm.click()
    await pasteHtml(page, url, '')
    await expect(pm.locator('a')).toHaveText(url)
    await expect(pm.locator('a')).toHaveAttribute('href', url)
    await expect(page.getByRole('group', { name: '链接粘贴选项' })).toHaveCount(0)
  })

  test('选中文字时粘贴网址，以网址替换选区', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const url = 'https://gitlab.test/x'
    await pm.fill('待替换')
    await selectRange(page, 1, 4)
    await pasteHtml(page, url, `<a href="${url}">GitLab 标题</a>`)
    await expect(pm).toHaveText(url)
    await expect(pm.locator('a')).toHaveAttribute('href', url)
    await expect(page.getByRole('group', { name: '链接粘贴选项' })).toBeVisible()
  })

  test('撤销粘贴网址时关闭转换提示，编辑器仍可继续输入', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const url = 'https://gitlab.test/x'
    await pm.click()
    await pasteHtml(page, url, `<a href="${url}">GitLab 标题</a>`)
    const prompt = page.getByRole('group', { name: '链接粘贴选项' })
    await expect(prompt).toBeVisible()
    await pm.press('Control+z')
    await expect(pm).toHaveText('')
    await expect(prompt).toHaveCount(0)
    await pm.fill('继续写小记')
    await expect(pm).toHaveText('继续写小记')
    expect(errors).toEqual([])
  })

  test('粘进去的裸地址自动成链', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await page.keyboard.type('看 https://a.test/x ')
    await expect(pm.locator('a')).toHaveAttribute('href', 'https://a.test/x')
  })

  test('阅读面点正文链接：交给本机打开，卡片不进编辑态', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [
        { title: '', content_html: '<p>抬头一句</p><p>看 <a href="https://gitlab.test/x">GitLab 标题</a> 收尾</p>' },
      ],
    }, '/notes')
    const link = page.locator('.memo-body a').first()
    await expect(link).toHaveText('GitLab 标题')
    await link.click()
    // openExternal 先动态 import plugin-shell，落账比点击晚一拍
    await expect
      .poll(() => page.evaluate(() => (window as any).__E2E__.invocations
        .filter((i: any) => i.cmd === 'shell:open' && i.args.path === 'https://gitlab.test/x').length))
      .toBe(1)
    // 卡片一旦切进编辑态就没这个 .memo 了
    await expect(page.locator('.memo')).toHaveCount(1)
  })

  test('选中浮动条：加链接、裸域名补协议、再移除', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const bar = page.locator('.fmt-bar')
    await pm.click()
    await pm.fill('链接目标')
    // 空选区不该浮出浮条
    await expect(bar).toHaveCount(0)

    await selectRange(page, 1, 5)
    await expect(bar).toBeVisible()
    await bar.locator('[aria-label="添加链接"]').click()
    await page.locator('.fmt-input').fill('example.com/docs')
    await page.locator('.fmt-bar [aria-label="确定链接"]').click()
    await expect(pm.locator('a')).toHaveAttribute('href', 'https://example.com/docs')
    await expect(bar).toHaveCount(0)

    await selectRange(page, 1, 5)
    await bar.locator('[aria-label="添加链接"]').click()
    await expect(page.locator('.fmt-input')).toHaveValue('https://example.com/docs')
    await bar.locator('.fmt-text').click()
    await expect(pm.locator('a')).toHaveCount(0)
  })

  test('选中浮动条：行内码落在选区上，代码块里不浮出', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    await pm.click()
    await pm.fill('跑 npm test')
    await selectRange(page, 3, 11)
    await page.locator('.fmt-bar [aria-label="行内代码"]').click()
    await expect(pm.locator('code')).toHaveText('npm test')

    // 整段搬进代码块后，块里划字是为了复制：浮条只会压住下一行
    await pm.evaluate(el => {
      const ed = (el as HTMLElement & { editor: Editor }).editor
      ed.commands.selectAll()
      ed.commands.toggleCodeBlock()
    })
    await expect(pm.locator('pre')).toHaveCount(1)
    await pm.locator('pre').click()
    await page.keyboard.press('Shift+End')
    await expect(page.locator('.fmt-bar')).toHaveCount(0)
  })

  test('卡 meta 行的标签胶囊：点开筛选、再点取消', async ({ page }) => {
    await gotoNotes(page)
    const pill = page.locator('.memo .tag-pill').first()
    await expect(pill).toHaveText('#产品')
    await expect(page.locator('.memo .tag-inline')).toHaveCount(0)
    await expect(memo(page, '第二条小记').locator('.memo-title')).toHaveCount(0)
    await pill.click()
    await expect(page.locator('.titlebar-count')).toHaveText('1 / 3 条')
    await expect(pill).toHaveClass(/on/)
    await pill.click()
    await expect(page.locator('.titlebar-count')).toHaveText('3 条')
  })
})
