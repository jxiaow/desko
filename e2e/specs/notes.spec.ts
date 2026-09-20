import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, tipButton } from '../helpers'

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

test.describe('Notes 小记', () => {
  test('进入 /notes 自动拉取并渲染 seed 小记', async ({ page }) => {
    await gotoNotes(page)
    await expect(page.locator('.memo')).toHaveCount(3)
    await expect(page.locator('.bar-count')).toHaveText('3 / 3 条')
    expect(await e2e.count(page, 'list_notes')).toBe(1)
    // 窄栏默认收起，列表占满宽度
    await expect(page.locator('.rail')).toHaveCount(0)
    await expect(page.locator('[aria-label="展开侧栏"]')).toBeVisible()
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
    await expect(page.locator('.bar-count')).toHaveText('4 / 4 条')
    expect(await e2e.count(page, 'create_note')).toBe(1)
    const created = (await e2e.snapshot(page)).notes.find((n: any) => n.title.startsWith('E2E 发布测试'))
    expect(created).toBeTruthy()
    // 发布后 composer 清空
    await expect(page.locator('.composer .ProseMirror')).toHaveText('')
  })

  test('就地编辑：双击进入、自动保存、完成退出', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第一条小记')
    await target.dblclick()
    const editor = page.locator('.memo.editing .ProseMirror')
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('改写后的第一条内容')

    // 600ms 防抖自动保存 -> update_note
    await expect
      .poll(() => e2e.count(page, 'update_note'), { timeout: 5000 })
      .toBeGreaterThan(0)
    await page.locator('.memo.editing button.eb.primary', { hasText: '完成' }).click()
    await expect(page.locator('.memo.editing')).toHaveCount(0)
    await expect(memo(page, '改写后的第一条内容')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const changed = snap.notes.find((n: any) => n.content_html.includes('改写后的第一条内容'))
    expect(changed).toBeTruthy()
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
    await target.locator('button.ib[title="收藏"]').click()
    await expect(tipButton(target, '取消收藏')).toHaveClass(/on warn/)
    // 悬停时状态标让位（opacity 归零），否则同一行出现两个星
    expect(await target.locator('.memo-state').evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    await page.mouse.move(4, 4)
    await expect(target.locator('.state-star')).toBeVisible()
    expect((await e2e.snapshot(page)).notes.find((n: any) => n.content_html.includes('第三条')).starred).toBe(true)
  })

  test('搜索过滤与 rail 视图筛选', async ({ page }) => {
    await gotoNotes(page)
    const search = page.locator('.stream-bar .search-box input')
    await search.fill('采购')
    await expect(page.locator('.memo')).toHaveCount(1)
    await expect(page.locator('.bar-count')).toHaveText('1 / 3 条')
    await page.locator('button[title="清空搜索"]').click()
    await expect(page.locator('.memo')).toHaveCount(3)

    // 窄栏默认收起，视图筛选要先展开它
    await tipButton(page, '展开侧栏').click()
    await page.locator('.rail button.rail-item', { hasText: '收藏' }).click()
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配的小记')
    await page.locator('.rail button.rail-item.danger', { hasText: '清空筛选' }).click()
    await expect(page.locator('.memo')).toHaveCount(3)
  })

  test('批量删除小记', async ({ page }) => {
    await gotoNotes(page)
    await tipButton(page, '批量选择').click()
    await expect(page.locator('.batch-dock')).toBeVisible()

    await memo(page, '第一条小记').click()
    await memo(page, '第二条小记').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 2 条')
    await expect(memo(page, '第一条小记')).toHaveClass(/is-sel/)

    await page.locator('button.dock-btn:text-is("删除")').click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('确定删除选中的 2 条小记吗？')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已删除 2 条小记')
    await expect(page.locator('.memo')).toHaveCount(1)
    // 删除后退出批量模式
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    expect((await e2e.snapshot(page)).notes).toHaveLength(1)
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
    await fs.locator('.fs-foot button.eb.primary', { hasText: '发布' }).click()
    await expect(fs).toHaveCount(0)
    await expect(memo(page, '全屏书写的内容')).toBeVisible()
    await expect(page.locator('.memo')).toHaveCount(4)
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
    await boxes.first().dblclick()
    await expect(page.locator('.memo.editing')).toHaveCount(0)
    expect(await checked(0)).toBe(false)

    await boxes.first().click()
    await expect.poll(() => e2e.count(page, 'update_note')).toBe(3)
    expect(await stored()).toContain('data-checked="true"')

    // 双击正文进编辑态，勾选状态要跟着带进去
    await page.locator('.memo .memo-body p').first().dblclick()
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
})
