import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, tipButton } from '../helpers'

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

  test('一键复制正文：快捷按钮出纯文本', async ({ page }) => {
    await gotoNotes(page)
    const m = memo(page, '第一条小记')
    await m.hover()
    await tipButton(m, '复制正文').click()
    await expectToast(page, '小记已复制')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('第一条小记：周会纪要与待办')
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

  test('composer 展开粘滞：失焦不收起，空内容按 Esc 才收起', async ({ page }) => {
    await gotoNotes(page)
    const pm = page.locator('.composer .ProseMirror')
    const minHeight = () => pm.evaluate((el) => getComputedStyle(el).minHeight)

    // 默认单行胶囊
    await expect(minHeight).resolves.toBe('22px')
    await expect(page.locator('.composer button.btn-primary')).toBeHidden()

    // 点开后展开成书写面
    await pm.click()
    await expect.poll(minHeight, { timeout: 3000 }).toBe('148px')
    await expect(page.locator('.composer button.btn-primary')).toBeVisible()

    // 点击页面别处（空内容失焦）：不许收回
    await page.locator('.memo').first().click()
    await page.waitForTimeout(500)
    await expect(minHeight).resolves.toBe('148px')

    // 空内容按 Esc：收回胶囊
    await pm.click()
    await page.keyboard.press('Escape')
    await expect.poll(minHeight, { timeout: 3000 }).toBe('22px')
  })

  test('就地编辑：悬停按钮进入、自动保存、完成退出', async ({ page }) => {
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
    await page.locator('.memo.editing button.eb.primary', { hasText: '完成' }).click()
    await expect(page.locator('.memo.editing')).toHaveCount(0)
    await expect(memo(page, '改写后的第一条内容')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const changed = snap.notes.find((n: any) => n.content_html.includes('改写后的第一条内容'))
    expect(changed).toBeTruthy()
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

  test('已有小记配图：上传后图片块插进编辑正文', async ({ page }) => {
    await gotoNotes(page)
    const target = memo(page, '第一条小记')
    await target.hover()
    await tipButton(target, '编辑').click()
    const editor = page.locator('.memo.editing .ProseMirror')
    await expect(editor).toBeVisible()

    // 光标放到开头再插图：图块应落在光标处而不是文末
    await editor.click()
    await page.keyboard.press('Control+Home')
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

    await page.locator('.memo.editing button.eb.primary', { hasText: '完成' }).click()
    await expect(memo(page, '第一条小记').locator('img[data-note-image]')).toHaveCount(1)
    const snap = await e2e.snapshot(page)
    const saved = snap.notes.find((n: any) => n.content_html.includes('pic.png'))
    expect(saved).toBeTruthy()
    expect(saved.content_html).toMatch(/style="width: \d+(\.\d+)?%/)
    expect(snap.attachments.some((a: any) => a.file_path.includes('pic.png'))).toBe(true)
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
    // opacity 带过渡动画，单次采样会读到中间值，轮询到收敛
    await expect
      .poll(() => target.locator('.memo-state').evaluate((el) => getComputedStyle(el).opacity))
      .toBe('0')
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
    // 选中态：浸润底 + 1px 全包裹微环
    await expect(memo(page, '第一条小记')).toHaveCSS('box-shadow', 'rgb(91, 87, 217) 0px 0px 0px 1px, rgba(26, 27, 32, 0.05) 0px 1px 2px 0px')
    // 上下键换焦点，微环跟着走
    await page.locator('.memo').first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.memo').nth(1)).toBeFocused()

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

  test('全屏查看：只读渲染、转编辑、Esc 关闭', async ({ page }) => {
    await gotoNotes(page)
    const m = memo(page, '第一条小记')
    await m.hover()
    await tipButton(m, '全屏查看').click()
    const fs = page.locator('section.fs')
    await expect(fs).toBeVisible()
    await expect(fs.locator('.fs-view')).toContainText('第一条小记：周会纪要与待办')
    // 只读层没有编辑器，底栏换成「编辑」主按钮
    await expect(fs.locator('.ProseMirror')).toHaveCount(0)
    await expect(fs.locator('.save-hint')).toHaveText('只读浏览')
    await expect(fs.locator('.fs-hint')).toHaveCount(0)

    // 查看转编辑：书写面接管同一条正文
    await fs.locator('.fs-foot button.eb.primary').click()
    await expect(fs.locator('.fs-view')).toHaveCount(0)
    await expect(fs.locator('.ProseMirror')).toContainText('第一条小记')

    await page.keyboard.press('Escape')
    await expect(fs).toHaveCount(0)
  })

  test('小记口令：一把开全库，行操作全平铺', async ({ page }) => {
    await bootUnlocked(page, {
      notes: [
        { title: '机密事', content_html: '<p>要加密的正文</p>' },
        { title: '封存', content_html: '<p>封存的正文</p>', encrypted: true },
      ],
    }, '/notes')
    const cards = page.locator('.memo')
    await expect(cards).toHaveCount(2)
    const sealed = cards.nth(0) // seed 里更新的那条，开局就锁着
    const plain = cards.nth(1)
    // 锁着的正文根本不进 DOM
    await expect(page.locator('.memo-body')).not.toContainText('封存的正文')
    await expect(page.locator('.memo-locked')).toHaveCount(1)
    // 动作全平铺：⋯ 入口彻底没了
    await expect(page.locator('.memo-acts button[title="更多"], .memo-acts button[data-tip="更多"]')).toHaveCount(0)

    // 首次加密就是立全库口令，只有这一次要输两格
    await plain.hover()
    await tipButton(plain, '加密').click()
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
    await expect(plain.locator('.state-enc')).toBeVisible()

    // 悬停时状态徽标淡出，锁由动作排补上：加密过的那条 hover 必须有「重新锁定」
    await plain.hover()
    await expect(tipButton(plain, '重新锁定')).toHaveCount(1)
    await tipButton(plain, '重新锁定').click()
    await expectToast(page, '已重新锁定')
    // 只收回这一条：另一条明文还在手
    await expect(page.locator('.memo-locked')).toHaveCount(1)
    // 锁回的正文不进搜索
    await page.locator('.stream-bar .search-box input').fill('要加密的正文')
    await expect(page.locator('.memo')).toHaveCount(0)
    await page.locator('.stream-bar .search-box input').fill('')
    await expect(page.locator('.memo')).toHaveCount(2)

    // 口令还在手：单条再开不再问一次
    await plain.click()
    await expect(dialog).toHaveCount(0)
    await expect(plain.locator('.memo-body')).toContainText('要加密的正文')

    // 整库锁回 → 错口令拦在弹窗里 → 对的一次开全部
    await page.locator('.stream-bar button[aria-label="锁回全部加密小记"]').click()
    await expectToast(page, '加密小记已全部锁回')
    await expect(page.locator('.memo-locked')).toHaveCount(2)
    await sealed.click()
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('input[type="password"]')).toHaveCount(1)
    await dialog.locator('input[type="password"]').fill('错的口令')
    await dialog.locator('button.btn-primary').click()
    await expect(dialog.locator('.lock-error')).toContainText('密码错误')
    await dialog.locator('input[type="password"]').fill(NOTE_PASS)
    await dialog.locator('button.btn-primary').click()
    await expect(dialog).toHaveCount(0)
    // 一次解锁 = 全库开：两条锁着的都回来了
    await expect(memo(page, '封存的正文')).toBeVisible()
    await expect(memo(page, '要加密的正文')).toBeVisible()

    // 忘口令兜底：应用已解锁，零输入直接开
    await page.locator('.stream-bar button[aria-label="锁回全部加密小记"]').click()
    await sealed.click()
    await dialog.locator('.link-btn').click()
    await expectToast(page, '已用主密码解开小记')
    await expect(dialog).toHaveCount(0)
    await expect(memo(page, '封存的正文')).toBeVisible()
    expect(await e2e.count(page, 'note_key_recover')).toBe(1)
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
})
