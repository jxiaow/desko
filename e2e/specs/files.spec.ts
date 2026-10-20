import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, tipButton } from '../helpers'

const SEED = {
  fileShortcuts: [
    { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' as const },
    { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' as const },
  ],
}

function shortcutRow(page: Page, name: string) {
  return page.locator('.shortcut-row').filter({ has: page.locator(`.row-name:text-is("${name}")`) })
}

async function gotoFiles(page: Page) {
    await bootUnlocked(page, SEED)
  // Files 数据只在路由切换时拉取（App watch 非 immediate），必须走导航而非直接 goto
  await page.locator('a.nav-item[href="/files"]').click()
  await expect(page.locator('.shortcut-row')).toHaveCount(2)
}

test.describe('Files 文件快捷', () => {
  test('导航进入后渲染 seed 快捷方式', async ({ page }) => {
    await gotoFiles(page)
    const pdf = shortcutRow(page, '月度报告')
    // 路径列只留尾部两段，完整路径挂在 title 上
    await expect(shortcutRow(page, '项目资料').locator('.path-chip')).toHaveText('…/e2e/project')
    await expect(pdf.locator('.path-chip')).toHaveText('…/e2e/report.pdf')
    await expect(pdf.locator('.ft-ico')).toHaveText('pdf')
    expect(await e2e.count(page, 'list_file_shortcuts')).toBe(1)
  })

  test('点击行调用 open_file', async ({ page }) => {
    await gotoFiles(page)
    await shortcutRow(page, '月度报告').click()
    await expect
      .poll(() => e2e.count(page, 'open_file'))
      .toBe(1)
  })

  test('⋯ 菜单：在终端中打开', async ({ page }) => {
    await gotoFiles(page)
    const row = shortcutRow(page, '项目资料')
    await row.hover()
    await tipButton(row, '更多操作').click()
    await page.locator('.popover .pop-item', { hasText: '在终端中打开' }).click()
    const calls = await page.evaluate(() =>
      (window as any).__E2E__.invocations
        .filter((i: any) => i.cmd === 'open_terminal')
        .map((i: any) => i.args),
    )
    expect(calls).toEqual([{ path: 'C:/e2e/project' }])
  })

  test('最小窗口下动作列仍可点击，长名称省略', async ({ page }) => {
    // 正式桌面的最小窗口尺寸，检查长文本不会把动作列顶出内容面。
    await gotoFiles(page)
    await page.setViewportSize({ width: 800, height: 600 })
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.locator('#workspace-directory-toggle')).toHaveCount(0)

    const row = shortcutRow(page, '项目资料')
    await row.hover()
    const box = await row.locator('.row-acts').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x + box!.width).toBeLessThanOrEqual(800)
    await tipButton(row, '复制地址 (C)').click()
    await expectToast(page, '地址已复制')
    // 名字列只是省略，不换行也不撑高
    await expect(row.locator('.row-name')).toHaveCSS('text-overflow', 'ellipsis')
  })

  test('搜索过滤', async ({ page }) => {
    await gotoFiles(page)
    await expect(page.locator('.shortcut-row')).toHaveCount(2)
    await page.locator('.search-box input').fill('报告')
    await expect(page.locator('.shortcut-row')).toHaveCount(1)
    await page.locator('.search-box input').fill('xxx')
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配结果')
  })

  test('行内动作：复制地址', async ({ page }) => {
    await gotoFiles(page)
    const row = shortcutRow(page, '项目资料')
    await row.hover()
    // 钮面 title 带着键盘提示（C = 复制当前卡路径）
    await tipButton(row, '复制地址 (C)').click()
    await expectToast(page, '地址已复制')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('C:/e2e/project')
  })

  test('浏览按钮回填路径（mock dialog）', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.page-bar button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')
    await expect(dialog.locator('h3')).toHaveText('添加快捷方式')

    await e2e.queueDialog(page, 'C:/e2e/queued-folder')
    await tipButton(dialog, '选择文件夹').click()
    await expect(dialog.locator('input[placeholder="粘贴文件/文件夹路径，或点击右侧浏览"]')).toHaveValue('C:/e2e/queued-folder')
    // 选中文件夹后类型自动切到文件夹
    await expect(dialog.locator('button.seg-btn.on')).toHaveText('文件夹')
  })

  test('从剪贴板粘贴路径并自动判型', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.page-bar button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')

    await page.evaluate(() => navigator.clipboard.writeText('C:/e2e/pasted/archive'))
    await tipButton(dialog, '从剪贴板粘贴').click()
    await expect(dialog.locator('input[placeholder="粘贴文件/文件夹路径，或点击右侧浏览"]')).toHaveValue('C:/e2e/pasted/archive')
    // 无扩展名 → 自动判为文件夹；段控件的选中块落在「文件夹」
    await expect(dialog.locator('button.seg-btn.on')).toHaveText('文件夹')
  })

  test('新增快捷方式', async ({ page }) => {
    await gotoFiles(page)
    await page.locator('.page-bar button.btn-primary').click()
    const dialog = page.locator('.dialog-overlay .dialog')

    // 名称为空 -> toast 校验
    await dialog.locator('button.btn-primary:text-is("添加")').click()
    await expectToast(page, '请填写名称和路径')
    await waitForToastGone(page)

    // 先填名称再填路径：路径输入框 @blur 的 onPathInput 只在名称为空时用文件名覆盖，反序会竞态
    await dialog.locator('input[placeholder="快捷方式名称"]').fill('E2E 笔记')
    await dialog.locator('input[placeholder="粘贴文件/文件夹路径，或点击右侧浏览"]').fill('C:/e2e/notes.txt')
    await dialog.locator('button.seg-btn:text-is("文件")').click()
    await dialog.locator('button.btn-primary:text-is("添加")').click()

    await expect(page.locator('.shortcut-row')).toHaveCount(3)
    await expect(shortcutRow(page, 'E2E 笔记')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const created = snap.fileShortcuts.find((f: any) => f.name === 'E2E 笔记')
    expect(created.path).toBe('C:/e2e/notes.txt')
    expect(created.shortcut_type).toBe('file')
  })

  test('行内编辑改路径', async ({ page }) => {
    await gotoFiles(page)
    const row = shortcutRow(page, '月度报告')
    await row.hover()
    await tipButton(row, '编辑').click()
    const dialog = page.locator('.dialog-overlay .dialog')
    await expect(dialog.locator('h3')).toHaveText('编辑快捷方式')
    await dialog.locator('input[placeholder="快捷方式名称"]').fill('月度报告 v2')
    await dialog.locator('button.btn-primary:text-is("保存")').click()
    await expect(shortcutRow(page, '月度报告 v2')).toBeVisible()
    const snap = await e2e.snapshot(page)
    expect(snap.fileShortcuts.find((f: any) => f.name === '月度报告 v2')).toBeTruthy()
  })

  test('右键菜单删除', async ({ page }) => {
    await gotoFiles(page)
    await shortcutRow(page, '项目资料').click({ button: 'right' })
    const menu = page.locator('.popover')
    await expect(menu).toBeVisible()
    await menu.locator('.pop-item', { hasText: '删除' }).click()

    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('「项目资料」将被移除，本机文件不受影响。')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已删除')
    await expect(page.locator('.shortcut-row')).toHaveCount(1)
    expect((await e2e.snapshot(page)).fileShortcuts).toHaveLength(1)
  })

  test('底部行右键：菜单不越出视口，删除项可见', async ({ page }) => {
    await bootUnlocked(page, {
      fileShortcuts: [
        { name: '项目资料', path: 'C:/e2e/project', shortcut_type: 'folder' as const },
        { name: '月度报告', path: 'C:/e2e/report.pdf', shortcut_type: 'file' as const },
        ...Array.from({ length: 12 }, (_, i) => ({
          name: `S${i}`, path: `C:/e2e/f${i}.txt`, shortcut_type: 'file' as const,
        })),
      ],
    })
    await page.locator('a.nav-item[href="/files"]').click()
    await expect(page.locator('.shortcut-row')).toHaveCount(14)
    const last = page.locator('.shortcut-row').last()
    await last.scrollIntoViewIfNeeded()
    await last.click({ button: 'right', position: { x: 150, y: 40 } })
    const menu = page.locator('.popover')
    await expect(menu).toBeVisible()
    const del = menu.locator('.pop-item', { hasText: '删除' })
    await expect(del).toBeInViewport()
  })

  test('⋯ 更多菜单删除', async ({ page }) => {
    await gotoFiles(page)
    const row = shortcutRow(page, '项目资料')
    await row.hover()
    await tipButton(row, '更多操作').click()
    const menu = page.locator('.popover')
    await expect(menu).toBeVisible()
    // 菜单收低频动作 + 删除，不与 hover 钮重复
    await expect(menu.locator('.pop-item')).toHaveCount(3)
    await menu.locator('.pop-item', { hasText: '删除' }).click()

    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('「项目资料」将被移除，本机文件不受影响。')
    await confirm.locator('button.btn-danger').click()
    await expectToast(page, '已删除')
    await expect(page.locator('.shortcut-row')).toHaveCount(1)
  })
})
