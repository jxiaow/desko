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

/**
 * 启动默认落点自 10-09 起是小记，收藏页要自己点过去。
 * 不走 bootUnlocked 的 path 参数：那是解锁前 goto 子路由，视图会在锁定态挂载并发 fetch。
 */
async function bootEntries(page: Page, config: Parameters<typeof bootUnlocked>[1] = {}) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/entries"]').click()
  await expect(page).toHaveURL(/\/entries$/)
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
    await bootEntries(page, SEED)
    await expect(page.locator('.entry-card')).toHaveCount(3)
    await expect(entryCard(page, 'GitHub').locator('.ec-name')).toBeVisible()
    await expect(entryCard(page, 'GitHub').locator('.ec-cat')).toHaveText('开发')
    // 域名行剥掉协议，只剩 host
    await expect(entryCard(page, 'GitHub').locator('.ec-domain')).toHaveText('github.com')
    // 未设分类才有未分类；这里 3 条各有分类。tabs：全部 + 分类，按聚合顺序
    const allTab = page.locator('.workspace-workbar .wb-tab', { hasText: '全部' })
    await expect(allTab.locator('.wb-count')).toHaveText('3')
    await expect(allTab).toHaveClass(/active/)
  })

  test('搜索过滤与清除', async ({ page }) => {
    await bootEntries(page, SEED)
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

  test('页级工作栏按分类筛选并返回全部', async ({ page }) => {
    await bootEntries(page, SEED)
    const workbar = page.locator('.workspace-workbar')
    await workbar.locator('.wb-tab', { hasText: '邮箱' }).click()
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, 'Gmail')).toBeVisible()
    await workbar.locator('.wb-tab', { hasText: '全部' }).click()
    await expect(page.locator('.entry-card')).toHaveCount(3)
  })

  test('新增网址收藏：必填警示 + 创建成功', async ({ page }) => {
    await bootEntries(page, SEED)
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
    await expect(paths.locator('.dialog-header .sub')).toHaveText('0 个 · Notion')
    await paths.locator('.add-label').fill('首页')
    await paths.locator('.add-path').fill('/web')
    await paths.locator('.add-path').press('Enter')
    await expect(paths.locator('.path-value')).toHaveCount(1)
    await expect(paths.locator('.dialog-header .sub')).toHaveText('1 个 · Notion')
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
    await bootEntries(page, SEED)
    await entryCard(page, 'GitHub').click()
    const detail = page.locator('.detail-dialog')
    await expect(detail).toBeVisible()
    await expect(detail.locator('.dialog-header h3')).toHaveText('网址详情')
    await expect(detail.locator('.detail-identity h4')).toHaveText('GitHub')

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

  test('详情标题在窄窗口完整换行，关闭和底栏操作保持可见', async ({ page }) => {
    const name = '一个很长的网址收藏标题，包含项目名称、环境说明和一段不应被弹窗头部截断的附加信息'
    await bootEntries(page, { entries: [{ name, category: '开发工具', url: 'https://example.com/path', password: '' }] })
    await entryCard(page, name).click()
    const detail = page.locator('.detail-dialog')

    for (const width of [800, 400, 320]) {
      await page.setViewportSize({ width, height: 620 })
      await expect(detail.locator('.detail-identity h4')).toHaveText(name)
      await expect(detail.locator('.dialog-close')).toBeVisible()
      await expect(detail.locator('.dialog-footer .btn-secondary.danger')).toBeVisible()
      await expect(detail.locator('.dialog-footer .btn-primary')).toBeVisible()
      const layout = await detail.evaluate(el => {
        const box = el.getBoundingClientRect()
        const title = el.querySelector('.detail-identity h4')!
        const actions = [...el.querySelectorAll<HTMLButtonElement>('.dialog-footer button')]
        return {
          left: box.left,
          right: box.right,
          titleFits: title.scrollWidth <= title.clientWidth,
          actionsFit: actions.every(button => {
            const rect = button.getBoundingClientRect()
            return rect.left >= box.left && rect.right <= box.right && button.scrollHeight <= button.clientHeight
          }),
        }
      })
      expect(layout.left).toBeGreaterThanOrEqual(15)
      expect(layout.right).toBeLessThanOrEqual(width - 15)
      expect(layout.titleFits).toBe(true)
      expect(layout.actionsFit).toBe(true)
    }
  })

  test('单条删除收在 ⋯ 菜单里，走确认对话框', async ({ page }) => {
    await bootEntries(page, SEED)
    await cardAction(page, '钉钉', '删除')
    await confirmDialog(page, '「钉钉」的账号与密码将一并删除。')
    await expectToast(page, '已删除')
    await expect(page.locator('.entry-card')).toHaveCount(2)
    const snap = await e2e.snapshot(page)
    expect(snap.entries.find((e: any) => e.name === '钉钉')).toBeUndefined()
  })

  test('批量选择与删除', async ({ page }) => {
    await bootEntries(page, SEED)
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
    // 待选态常驻：选中归零 dock 不收，只改口成 0 选并把动作钮关掉
    await expect(page.locator('.dock-count')).toHaveText('已选 0 项')
    await expect(page.locator('.dock-hint')).toHaveText('点收藏选择')
    await expect(page.locator('.dock-btn.danger')).toBeDisabled()

    await entryCard(page, 'GitHub').click() // 二次进入
    await page.locator('.dock-btn:text-is("全选")').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 3 项')
    await entryCard(page, '钉钉').click() // 反选一个
    await expect(page.locator('.dock-count')).toHaveText('已选 2 项')

    await page.locator('.dock-btn.danger').click()
    await confirmDialog(page, '2 条记录将被删除，此操作不可撤销。')
    await expectToast(page, '已删除 2 条记录')
    // 删除清空选中，待选态仍在：dock 收进 0 选态，「完成」才真正退出
    await expect(page.locator('.dock-count')).toHaveText('已选 0 项')
    await page.locator('.dock-btn:text-is("完成")').click()
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, '钉钉')).toBeVisible()
  })

  test('跨筛选攒批：全选只并本屏，确认框说清藏了几条', async ({ page }) => {
    await bootEntries(page, SEED)
    await page.locator('.page-bar .bar-btn[aria-label="选择条目"]').click()
    await entryCard(page, 'GitHub').click()
    // 搜索生效：GitHub 被筛出屏幕，但不许被抹掉
    await page.locator('.search-box input').fill('mail')
    await expect(entryCard(page, 'Gmail')).toBeVisible()
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(page.locator('.dock-count')).toHaveText('已选 1 项')
    await expect(page.locator('.dock-count')).toHaveAttribute('data-tip', '其中 1 项不在当前筛选结果里')
    await page.locator('.dock-btn', { hasText: '全选筛选结果' }).click()
    await expect(page.locator('.dock-count')).toHaveText('已选 2 项')
    // 取消本屏：只摘 Gmail，先前攒的 GitHub 仍在
    await page.locator('.dock-btn', { hasText: '取消本屏' }).click()
    await expect(page.locator('.dock-count')).toHaveText('已选 1 项')
    await page.locator('.dock-btn', { hasText: '全选筛选结果' }).click()

    await page.locator('.dock-btn.danger').click()
    await confirmDialog(page, '2 条记录将被删除，其中 1 条不在当前筛选结果里，此操作不可撤销。')
    await expectToast(page, '已删除 2 条记录')
    // 本屏那条也删了，清掉搜索才看见没被选中的钉钉
    await expect(page.locator('.entry-card')).toHaveCount(0)
    await tipButton(page, '清除搜索').click()
    await expect(page.locator('.entry-card')).toHaveCount(1)
    await expect(entryCard(page, '钉钉')).toBeVisible()
    const snap = await e2e.snapshot(page)
    expect(snap.entries.find((e: any) => e.name === 'GitHub')).toBeUndefined()
    expect(snap.entries.find((e: any) => e.name === 'Gmail')).toBeUndefined()
  })

  test('工具栏「选择」钮：开待选即出 0 选 dock，再点整体退出', async ({ page }) => {
    await bootEntries(page, SEED)
    // title 会被全局 tooltip 机制摘走，锚 aria-label
    const pickBtn = page.locator('.page-bar .bar-btn[aria-label="选择条目"]')
    await pickBtn.click()
    // 待选态：全部行显形勾选框，dock 常驻 0 选态，动作钮 disabled
    await expect(page.locator('.entry-card.batching')).toHaveCount(3)
    await expect(page.locator('.batch-dock')).toBeVisible()
    await expect(page.locator('.dock-count')).toHaveText('已选 0 项')
    await expect(page.locator('.dock-hint')).toHaveText('点收藏选择')
    await expect(page.locator('.dock-btn.danger')).toBeDisabled()
    // 待选态下点行即勾选
    await entryCard(page, 'GitHub').click()
    await expect(page.locator('.dock-count')).toHaveText('已选 1 项')
    await page.locator('.page-bar .bar-btn[aria-label="完成选择"]').click()
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
    await bootEntries(page, SEED)
    const gh = entryCard(page, 'GitHub')
    await page.locator('.page-bar .bar-btn[aria-label="选择条目"]').click()
    await gh.click()

    // 浮岛网格轮：选中直接使用当前主题的浸润底、强调描边和品牌字色。
    const selectedColors = await gh.evaluate(el => {
      const probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;background:var(--accent-soft);border:1px solid var(--accent);color:var(--text-brand)'
      el.append(probe)
      const style = getComputedStyle(probe)
      const colors = { bg: style.backgroundColor, border: style.borderTopColor, text: style.color }
      probe.remove()
      return colors
    })
    await expect(gh).toHaveCSS('background-color', selectedColors.bg)
    await expect(gh).toHaveCSS('border-top-color', selectedColors.border)
    await expect(gh.locator('.ec-name')).toHaveCSS('color', selectedColors.text)

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

  test('toast 是内容区顶沿居中的反色胶囊', async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 670 })
    await bootEntries(page, SEED)
    await page.locator('.entry-card').first().focus()
    await page.keyboard.press('c')
    const toast = page.locator('.toast')
    await expect(toast).toBeVisible()
    // 等 0.18s 入场过渡落定，仍在 0.8s 驻留窗口内
    await page.waitForTimeout(220)

    // 顶沿：标题栏 48 + 页级工作栏 42 + 两段呼吸 = 118；横向：侧栏以右那一片的正中
    const box = await toast.boundingBox()
    expect(box.y).toBe(118)
    const main = (await page.locator('.workspace-body > .main-content').boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1)

    const style = await toast.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { radius: cs.borderRadius, bg: cs.backgroundColor, size: cs.fontSize }
    })
    expect(style).toEqual({ radius: '16px', bg: 'rgb(38, 36, 31)', size: '12px' })
  })

  test('详情一打开就有密码行：默认掩码，点显示才露明文', async ({ page }) => {
    await bootEntries(page, {
      entries: [
        { name: 'GitHub', url: 'https://github.com', username: 'user@example.com', password: 'Gh!tHub2024', category: '开发' },
        { name: '空密码站', url: 'https://empty.example.com', username: 'guest', password: '', category: '开发' },
      ],
    })
    await entryCard(page, 'GitHub').click()
    const detail = page.locator('.detail-dialog')
    await expect(detail.locator('.detail-pwd')).toHaveText('••••••••••')
    // 密码不在列表负载里：打开详情取一次，那行才渲染得出来
    expect(await e2e.count(page, 'get_password')).toBe(1)

    await tipButton(detail, '显示密码').click()
    await expect(detail.locator('.detail-pwd')).toHaveText('Gh!tHub2024')

    // 关掉再开：2 分钟 TTL 内不重复请求
    await detail.locator('.dialog-close').click()
    await entryCard(page, 'GitHub').click()
    await expect(detail.locator('.detail-pwd')).toBeVisible()
    expect(await e2e.count(page, 'get_password')).toBe(1)

    // 没存密码的条目不出这行
    await detail.locator('.dialog-close').click()
    await entryCard(page, '空密码站').click()
    await expect(detail.locator('.detail-pwd')).toHaveCount(0)
  })

  test('复制卡片并查看/复制密码', async ({ page }) => {
    await bootEntries(page, SEED)
    const card = entryCard(page, 'GitHub')
    await cardAction(page, 'GitHub', '创建副本')
    await expectToast(page, '已创建副本')
    await expect(entryCard(page, 'GitHub 副本')).toBeVisible()
    expect((await e2e.snapshot(page)).entries).toHaveLength(4)

    // 复制卡片本身取一次密码；随后打开详情的预热撞上 2 分钟 TTL，不再多打一次
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
    await bootEntries(page, SEED)
    await entryCard(page, 'Gmail').locator('a.ec-domain').click()
    await expect.poll(() => e2e.count(page, 'shell:open')).toBe(1)
  })

  test('工具条粘顶时贴住滚动容器上沿，不留能看见卡片的缝', async ({ page }) => {
    await bootEntries(page, {
      entries: Array.from({ length: 40 }, (_, i) => ({
        name: `条目 ${i}`,
        url: `http://10.0.0.65/builds/private/item_${i}`,
        notes: `备注 ${i}`,
        category: 'XYLink App',
      })),
    })
    await expect(page.locator('.entry-card')).toHaveCount(40)
    const bar = page.locator('#workspace-page-toolbar')
    const before = await bar.boundingBox()
    await page.locator('.content-inner').evaluate(el => el.scrollTo({ top: 400, behavior: 'instant' }))
    await expect.poll(() => page.locator('.content-inner').evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    expect(await bar.boundingBox()).toEqual(before)
    const content = (await page.locator('.content-inner').boundingBox())!
    expect(content.y).toBe(before!.y + before!.height)
    await page.locator('.search-box input').fill('条目 12')
    await expect(page.locator('.entry-card')).toHaveCount(1)
  })
})
