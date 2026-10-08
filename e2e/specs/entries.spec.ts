import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, cardByName, tipButton, openCardMenu } from '../helpers'

const SEED = {
  entries: [
    { name: 'GitHub', url: 'https://github.com', username: 'user@example.com', password: 'Gh!tHub2024', notes: '代码托管平台', category: '开发' },
    { name: 'Gmail', url: 'https://mail.google.com', username: 'user@gmail.com', password: 'Gm@il#Secure', notes: '个人邮箱', category: '邮箱' },
    { name: '钉钉', url: 'https://www.dingtalk.com', username: 'user@company.com', password: 'Ding!Talk88', category: '办公' },
  ],
}

function entryCard(page: Page, name: string) {
  return page.locator(cardByName(name))
}

async function confirmDialog(page: Page, expectedMessage?: string) {
  const dialog = page.locator('.confirm-dialog')
  await expect(dialog).toBeVisible()
  if (expectedMessage) {
    await expect(dialog.locator('.dialog-body p')).toHaveText(expectedMessage)
  }
  await dialog.locator('button.btn-danger').click()
}

/** 卡片动作都收在 ⋯ 里：露出菜单后按文字点 */
async function cardAction(page: Page, name: string, label: string) {
  const items = await openCardMenu(page, name)
  await items.filter({ hasText: label }).first().click()
}

test.describe('Entries 网址收藏', () => {
  test('解锁后展示 seed 条目与分类 tabs', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await expect(page.locator('.entry-card')).toHaveCount(3)
    await expect(entryCard(page, 'GitHub').locator('.ec-name')).toBeVisible()
    await expect(entryCard(page, 'GitHub').locator('.ec-cat')).toHaveText('开发')
    // 域名行剥掉协议，只剩 host
    await expect(entryCard(page, 'GitHub').locator('.ec-domain')).toHaveText('github.com')
    // 未设分类才有未分类；这里 3 条各有分类。tabs：全部 + 分类，按聚合顺序
    const allTab = page.locator('.tabs .tab', { hasText: '全部' })
    await expect(allTab.locator('.tab-count')).toHaveText('3')
    await expect(allTab).toHaveClass(/active/)
  })

  test('搜索过滤与清除', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const search = page.locator('.search-box input')
    await search.fill('git')
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, 'GitHub')).toBeVisible()

    await search.fill('不存在的关键字')
    await expect(page.locator('.empty-title')).toHaveText('未找到匹配结果')
    await expect(page.locator('.empty-desc')).toHaveText('试试其他关键词')

    await tipButton(page, '清除搜索').click()
    await expect(page.locator('.entry-card')).toHaveCount(3)
  })

  test('按分类 tab 过滤：常驻钮直点，收进「更多」的走下拉', async ({ page }) => {
    await bootUnlocked(page, SEED)
    // 分类聚合顺序不保证等于 seed 声明顺序：可见就直点，否则开「更多」面板点
    const tab = page.locator('.tabs .tab:not(.tab-more)', { hasText: '邮箱' })
    if (await tab.count()) {
      await tab.click()
    } else {
      await page.locator('.tab-more').click()
      await page.locator('.popover .pop-item', { hasText: '邮箱' }).click()
    }
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, 'Gmail')).toBeVisible()
    await page.locator('.tabs .tab', { hasText: '全部' }).click()
    await expect(page.locator('.entry-card')).toHaveCount(3)
  })

  test('新增网址收藏：必填警示 + 创建成功', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await page.locator('.page-bar button.btn-primary').click()
    const dialog = page.locator('.dialog.entry-form-dialog')
    await expect(dialog.locator('h3')).toHaveText('新增网址收藏')

    // 名称/分类/主机全空点保存 -> 首个缺项红框警示并聚焦，不再走 toast
    const nameInput = dialog.locator('input[placeholder="例如：OA系统"]')
    await dialog.locator('.dialog-footer button.btn-primary').click()
    await expect(nameInput).toHaveClass(/field-invalid/)
    await expect(nameInput).toBeFocused()

    await nameInput.fill('Notion')
    await dialog.locator('input[placeholder="选择或输入新分类"]').fill('工具')
    await dialog.locator('input[placeholder="https://..."]').fill('https://www.notion.so')
    await dialog.locator('input[placeholder="登录用户名"]').fill('user@notion.so')
    await dialog.locator('input[placeholder="登录密码"]').fill('No@tion2024')
    await dialog.locator('textarea[placeholder="可选"]').fill('文档与笔记')

    // 子路径住独立弹窗：增删只写回草稿，摘要行回显，落库等「保存条目」
    await dialog.locator('.paths-manage').click()
    const paths = page.locator('.paths-dialog')
    await expect(paths.locator('h3')).toHaveText('子路径')
    await expect(paths.locator('.path-row:not(.path-add)')).toHaveCount(0)
    await expect(paths.locator('.paths-count')).toHaveText('0 个 · Notion')
    await paths.locator('.add-label').fill('首页')
    await paths.locator('.add-path').fill('/web')
    await paths.locator('.add-path').press('Enter')
    await expect(paths.locator('.path-value')).toHaveCount(1)
    await expect(paths.locator('.paths-count')).toHaveText('1 个 · Notion')
    await paths.locator('.dialog-footer button.btn-primary').click()
    await expect(paths).toHaveCount(0)
    await expect(dialog.locator('.pm-sum')).toHaveText('首页 / web')
    // 草稿阶段库里还没有这条路径
    expect((await e2e.snapshot(page)).urlPaths).toHaveLength(0)

    await dialog.locator('.dialog-footer button.btn-primary').click()

    await expectToast(page, '已添加')
    await expect(page.locator('.entry-card')).toHaveCount(4)
    // 分类现为必填：直接吃用户键入值，新条目在最前（created_at 倒序）
    await expect(entryCard(page, 'Notion').locator('.ec-cat')).toHaveText('工具')
    const snap = await e2e.snapshot(page)
    expect(snap.entries).toHaveLength(4)
    const created = snap.entries.find((e: any) => e.name === 'Notion')
    expect(created.category).toBe('工具')
    expect(created.url).toBe('https://www.notion.so')
    expect(snap.urlPaths).toHaveLength(1)
    expect(snap.urlPaths[0]).toMatchObject({ entry_id: created.id, path: '/web', label: '首页' })
  })

  test('详情点编辑：弹统一编辑弹窗改名', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await entryCard(page, 'GitHub').click()
    const detail = page.locator('.detail-dialog')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.detail-head-id h3')).toHaveText('GitHub')

    await detail.locator('.dialog-footer button.btn-secondary', { hasText: '编辑' }).click()
    // 详情收起，弹出与新增同款的编辑弹窗，预填原值
    const dialog = page.locator('.dialog.entry-form-dialog')
    await expect(dialog.locator('h3')).toHaveText('编辑网址收藏')
    await expect(detail).toHaveCount(0)
    await expect(dialog.locator('input[placeholder="例如：OA系统"]')).toHaveValue('GitHub')
    await dialog.locator('input[placeholder="例如：OA系统"]').fill('GitHub-Repo')
    await dialog.locator('.dialog-footer button.btn-primary').click()

    await expectToast(page, '已更新')
    await expect(entryCard(page, 'GitHub-Repo')).toBeVisible()
    const snap = await e2e.snapshot(page)
    const edited = snap.entries.find((e: any) => e.name === 'GitHub-Repo')
    expect(edited).toBeTruthy()
    // 密码留空则保持原值
    expect(edited.password).toBe('Gh!tHub2024')
  })

  test('单条删除收在 ⋯ 菜单里，走确认对话框', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await cardAction(page, '钉钉', '删除')
    await confirmDialog(page, '确定删除「钉钉」？')
    await expectToast(page, '已删除')
    await expect(page.locator('.entry-card')).toHaveCount(2)
    const snap = await e2e.snapshot(page)
    expect(snap.entries.find((e: any) => e.name === '钉钉')).toBeUndefined()
  })

  test('批量选择与删除', async ({ page }) => {
    await bootUnlocked(page, SEED)
    // 勾选框只在批量态显形：hover 不再抛框，入口是页条「选择」
    const pickBtn = page.locator('.page-bar .bar-btn[aria-label="选择条目"]')
    await pickBtn.click()
    await entryCard(page, 'GitHub').click()
    await expect(page.locator('.batch-dock')).toBeVisible()

    // 批量态下整张卡就是选择热区
    await entryCard(page, 'Gmail').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 2 项')
    await expect(entryCard(page, 'GitHub')).toHaveClass(/selected/)

    // 网址链接也让位给勾选，不把浏览器带起来
    await entryCard(page, '钉钉').locator('a.ec-domain').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 3 项')
    expect(await e2e.count(page, 'shell:open')).toBe(0)

    await page.locator('.dock-btn', { hasText: '取消全选' }).click()
    // 清空即收：选中归零，底坞自动退出，待选态还在
    await expect(page.locator('.batch-dock')).toHaveCount(0)

    await entryCard(page, 'GitHub').click() // 二次进入
    await page.locator('.dock-btn:text-is("全选")').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 3 项')
    await entryCard(page, '钉钉').click() // 反选一个
    await expect(page.locator('.dock-count')).toHaveText('已选 2 项')

    await page.locator('.dock-btn.danger').click()
    await confirmDialog(page, '确定删除选中的 2 条记录吗？')
    await expectToast(page, '已删除 2 条记录')
    // 清空即收：删除后选中归零，批量条自动消失
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, '钉钉')).toBeVisible()
  })

  test('工具栏「选择」钮：开待选显形勾选框，再点整体退出', async ({ page }) => {
    await bootUnlocked(page, SEED)
    // title 会被全局 tooltip 机制摘走，锚 aria-label
    const pickBtn = page.locator('.page-bar .bar-btn[aria-label="选择条目"]')
    await pickBtn.click()
    // 待选态：全部行显形勾选框，但没有选中就没有 dock
    await expect(page.locator('.entry-card.batching')).toHaveCount(3)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    // 待选态下点行即勾选
    await entryCard(page, 'GitHub').click()
    await expect(page.locator('.batch-dock')).toBeVisible()
    await page.locator('.page-bar .bar-btn[aria-label="退出选择"]').click()
    await expect(page.locator('.entry-card.batching')).toHaveCount(0)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    // Escape 同样整体退出：再开一轮，选一项后按 Esc
    await pickBtn.click()
    await entryCard(page, 'GitHub').click()
    await expect(page.locator('.batch-dock')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await expect(page.locator('.entry-card.batching')).toHaveCount(0)
  })

  test('选中态浸润 + 网格二维游走与 C 复制', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const gh = entryCard(page, 'GitHub')
    await page.locator('.page-bar .bar-btn[aria-label="选择条目"]').click()
    await gh.click()

    // 浮岛网格轮：选中 = 浸润底 + accent 实描边（白面板里的 1px 内环随 .rowlist 一起退了）
    await expect(gh).toHaveCSS('background-color', 'rgb(232, 238, 244)')
    await expect(gh).toHaveCSS('border-top-color', 'rgb(61, 90, 128)')
    await expect(gh.locator('.ec-name')).toHaveCSS('color', 'rgb(49, 73, 106)')

    // 900px 窗（侧栏轨 56 + 内距 48）落 2 列，3 张卡排成两行，跨行步进才是 2
    await page.setViewportSize({ width: 900, height: 700 })
    const grid = page.locator('.card-grid')
    expect(await grid.evaluate(el =>
      getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length)).toBe(2)

    const cards = page.locator('.entry-card')
    await cards.first().focus()
    await page.keyboard.press('ArrowRight')
    await expect(cards.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(cards.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(cards.nth(2)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(cards.nth(0)).toBeFocused()

    // C = 复制当前卡网址（列表渲染顺序不保证等于 seed 顺序，只验协议头）
    await page.keyboard.press('c')
    await expectToast(page, '网址已复制')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https?:\/\//)
  })

  test('toast 是贴右下的反色胶囊', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 670 })
    await bootUnlocked(page, SEED)
    await page.locator('.entry-card').first().focus()
    await page.keyboard.press('c')
    const toast = page.locator('.toast')
    await expect(toast).toBeVisible()
    // 等 0.18s 入场过渡落定，仍在 0.8s 驻留窗口内
    await page.waitForTimeout(220)

    const box = await toast.boundingBox()
    expect(1040 - (box.x + box.width)).toBeLessThanOrEqual(21)
    expect(1040 - (box.x + box.width)).toBeGreaterThanOrEqual(19)
    expect(670 - (box.y + box.height)).toBeLessThanOrEqual(21)
    expect(670 - (box.y + box.height)).toBeGreaterThanOrEqual(19)

    const style = await toast.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { radius: cs.borderRadius, bg: cs.backgroundColor, size: cs.fontSize }
    })
    expect(style).toEqual({ radius: '99px', bg: 'rgb(38, 36, 31)', size: '12px' })
  })

  test('复制卡片并查看/复制密码', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const card = entryCard(page, 'GitHub')
    await cardAction(page, 'GitHub', '复制副本')
    await expectToast(page, '已复制卡片')
    await expect(entryCard(page, 'GitHub 副本')).toBeVisible()
    expect((await e2e.snapshot(page)).entries).toHaveLength(4)

    // 复制卡片会用 getPassword 填充原条目密码缓存，此后详情页才有显示/复制密码按钮
    await expect.poll(() => e2e.count(page, 'get_password')).toBe(1)
    await card.click()
    const detail = page.locator('.detail-dialog')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.detail-pwd')).toHaveText('••••••••••')

    await tipButton(detail, '显示密码').click()
    await expect(detail.locator('.detail-pwd')).toHaveText('Gh!tHub2024')
    // 已缓存，不再请求 getPassword
    expect(await e2e.count(page, 'get_password')).toBe(1)

    await tipButton(detail, '复制密码').click()
    await expectToast(page, '密码已复制，30秒后自动清除')
  })

  test('点击卡片网址走 shell open', async ({ page }) => {
    await bootUnlocked(page, SEED)
    await entryCard(page, 'Gmail').locator('a.ec-domain').click()
    await expect.poll(() => e2e.count(page, 'shell:open')).toBe(1)
  })

  test('工具条粘顶时贴住滚动容器上沿，不留能看见卡片的缝', async ({ page }) => {
    await bootUnlocked(page, {
      entries: Array.from({ length: 9 }, (_, i) => ({
        name: `条目 ${i}`,
        url: `http://10.0.0.65/builds/private/item_${i}`,
        notes: `备注 ${i}`,
        category: 'XYLink App',
      })),
    })
    await expect(page.locator('.entry-card')).toHaveCount(9)
    const gap = () =>
      page.evaluate(() => {
        const bar = document.querySelector('.page-bar') as HTMLElement
        const scroller = bar.closest('.content-inner') as HTMLElement
        scroller.scrollTop = 240
        return new Promise<number>((res) =>
          setTimeout(() => res(Math.round(bar.getBoundingClientRect().top - scroller.getBoundingClientRect().top)), 150),
        )
      })
    expect(await gap()).toBe(0)
  })
})
