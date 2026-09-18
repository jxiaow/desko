import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast } from '../helpers'

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
    // 默认视口下 rail 可见（主区 >= 900px）
    await expect(page.locator('.rail')).toBeVisible()
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
    await expect(page.locator('.state-pin[title="已置顶"]')).toBeVisible()
    expect((await e2e.snapshot(page)).notes.find((n: any) => n.content_html.includes('第三条')).pinned).toBe(true)

    await target.hover()
    await target.locator('button.ib[title="收藏"]').click()
    await expect(target.locator('.state-star[title="已收藏"]')).toBeVisible()
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

    // rail 视图切到「收藏」：无收藏 -> 空态
    await page.locator('.rail button.rail-item', { hasText: '收藏' }).click()
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配的小记')
    await page.locator('.rail button.rail-item.danger', { hasText: '清空筛选' }).click()
    await expect(page.locator('.memo')).toHaveCount(3)
  })

  test('批量删除小记', async ({ page }) => {
    await gotoNotes(page)
    await page.locator('.stream-bar button.bar-btn', { hasText: '批量' }).click()
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
    await page.locator('.composer button[title="全屏书写"]').click()
    const fs = page.locator('section.fs')
    await expect(fs).toBeVisible()

    await fs.locator('.ProseMirror').click()
    await page.keyboard.type('全屏书写的内容')
    await fs.locator('.fs-foot button.eb.primary', { hasText: '发布' }).click()
    await expect(fs).toHaveCount(0)
    await expect(memo(page, '全屏书写的内容')).toBeVisible()
    await expect(page.locator('.memo')).toHaveCount(4)
  })
})
