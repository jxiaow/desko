import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone } from '../helpers'

const SEED = {
  fileShortcuts: [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' as const },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' as const },
  ],
}

function shortcutCard(page: Page, name: string) {
  return page.locator('.shortcut-card').filter({ has: page.locator(`.shortcut-name:text-is("${name}")`) })
}

async function gotoFiles(page: Page) {
  await bootUnlocked(page, SEED)
  // Files 数据只在路由切换时拉取（App watch 非 immediate），必须走导航而非直接 goto
  await page.locator('a.nav-item[href="/files"]').click()
  await expect(page.locator('.shortcut-card')).toHaveCount(2)
}

test.describe('Files 文件快捷', () => {
  test('导航进入后渲染 seed 快捷方式', async ({ page }) => {
    await gotoFiles(page)
    await expect(shortcutCard(page, '项目资料').locator('.shortcut-path')).toHaveText('C:/e2e/project')
    await expect(shortcutCard(page, '月度报告').locator('.shortcut-icon.file')).toBeVisible()
    expect(await e2e.count(page, 'list_file_shortcuts')).toBe(1)
  })

  test('点击卡片调用 open_file', async ({ page }) => {
    await gotoFiles(page)
    await shortcutCard(page, '月度报告').click()
    await expect
      .poll(() => e2e.count(page, 'open_file'))
      .toBe(1)
  })

  test('搜索过滤', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.search-box input').fill('报告')
    await expect(page.locator('.shortcut-card')).toHaveCount(1)
    await page.locator('.search-box input').fill('xxx')
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配结果')
  })

  test('浏览按钮回填路径（mock dialog）', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.toolbar-actions button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')
    await expect(dialog.locator('h3')).toHaveText('添加快捷方式')

    await e2e.queueDialog(page, 'C:/e2e/queued-folder')
    await dialog.locator('button[title="选择文件夹"]').click()
    await expect(dialog.locator('input[placeholder="粘贴文件/文件夹路径，或点击右侧浏览"]')).toHaveValue('C:/e2e/queued-folder')
    // 选中文件夹后类型自动切到文件夹
    await expect(dialog.locator('button.type-btn.active')).toHaveText('文件夹')
  })

  test('新增快捷方式', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.toolbar-actions button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')

    // 名称为空 -> toast 校验
    await dialog.locator('button.btn-primary:text-is("添 加")').click()
    await expectToast(page, '请填写名称和路径')
    await waitForToastGone(page)

    // 先填名称再填路径：路径输入框 @blur 的 onPathInput 只在名称为空时用文件名覆盖，反序会竞态
    await dialog.locator('input[placeholder="快捷方式名称"]').fill('E2E 笔记')
    await dialog.locator('input[placeholder="粘贴文件/文件夹路径，或点击右侧浏览"]').fill('C:/e2e/notes.txt')
    await dialog.locator('button.type-btn:text-is("文件")').click()
    await dialog.locator('button.btn-primary:text-is("添 加")').click()

    await expect(page.locator('.shortcut-card')).toHaveCount(3)
    await expect(shortcutCard(page, 'E2E 笔记')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const created = snap.fileShortcuts.find((f: any) => f.name === 'E2E 笔记')
    expect(created.path).toBe('C:/e2e/notes.txt')
    expect(created.shortcut_type).toBe('file')
  })

  test('右键菜单删除', async ({ page }) => {
    await gotoFiles(page)
    await shortcutCard(page, '项目资料').click({ button: 'right' })
    const menu = page.locator('.context-menu')
    await expect(menu).toBeVisible()
    await menu.locator('.context-menu-item', { hasText: '删除' }).click()

    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('确定删除「项目资料」快捷方式？')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已删除')
    await expect(page.locator('.shortcut-card')).toHaveCount(1)
    expect((await e2e.snapshot(page)).fileShortcuts).toHaveLength(1)
  })
})
