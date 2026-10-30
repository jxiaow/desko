import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, tipButton, E2E_PASSWORD } from '../helpers'
import type { E2EConfig } from '../mocks/backend'

const seed: E2EConfig = {
  settings: Object.fromEntries(['notes', 'entries', 'files', 'mfa', 'fileshare', 'tunnel', 'bypass', 'codex'].map(id => [`${id}_enabled`, 'true'])),
  notes: [
    { title: '待办', pinned: true, content_html: '<p>发布清单 #工作</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>检查布局</p></div></li></ul>' },
    { title: '记录', content_html: '<p>普通记录 #生活</p>' },
    { title: '旧记录', archived: true, content_html: '<p>归档记录</p>' },
  ],
  entries: ['开发', '邮箱', '办公', '金融', '设备'].map((category, i) => ({ name: `收藏 ${i + 1}`, url: `https://example.com/${i}`, password: 'demo', category })),
  fileShortcuts: [{ name: '项目目录', path: 'C:/demo', shortcut_type: 'folder' }],
  mfaTokens: [{ issuer: 'GitHub', label: 'demo@example.com', secret: 'JBSWY3DPEHPK3PXP' }],
  codex: {
    accounts: [{ email: 'demo@e2e.dev', current: true }],
    sessions: [{ sessionId: 'layout', title: '布局验证', cwd: 'C:\\demo', projectName: 'demo', model: 'gpt-5.4', daysAgo: 0, input: 1000, output: 100 }],
  },
}

async function boot(page: Page, config: E2EConfig = seed) {
  await bootUnlocked(page, config, '/')
  await expect(page.locator('html')).toHaveAttribute('data-layout', 'workspace')
  await expect(page.locator('.workspace-main')).toBeVisible()
  await expect(page.locator('.workspace-directory .rail')).toHaveCount(1)
}

const navigate = (page: Page, label: string) => page.getByRole('navigation', { name: '模块导航' }).getByRole('link', { name: label, exact: true }).click()

test('桌面默认启用宽导航，外观和侧栏状态可持久化', async ({ page, context }) => {
  await boot(page, { ...seed, settings: { ...seed.settings, theme: 'midnight', accent: 'forest', background_atmosphere: 'true' } })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'olive')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(page.locator('.titlebar-outer .sidebar-toggle')).toHaveAttribute('aria-expanded', 'true')
  const expanded = (await page.locator('.workspace-main').boundingBox())!.width
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '60px')
  await expect.poll(async () => (await page.locator('.workspace-main').boundingBox())!.width).toBeGreaterThan(expanded)
  await expect.poll(async () => (await e2e.snapshot(page)).settings.sidebar_collapsed).toBe('true')
  await tipButton(page, '设置').click()
  await page.getByRole('radio', { name: '靛', exact: true }).click()
  await page.locator('.setting-item', { hasText: '背景氛围' }).locator('label.switch').click()
  await expect.poll(async () => (await e2e.snapshot(page)).settings.background_atmosphere).toBe('false')
  const saved = (await e2e.snapshot(page)).settings
  const restarted = await context.newPage()
  await boot(restarted, { ...seed, settings: saved })
  await expect(restarted.locator('html')).toHaveAttribute('data-theme', 'ink')
  await expect(restarted.locator('html')).toHaveAttribute('data-accent', 'indigo')
  await expect(restarted.locator('html')).toHaveAttribute('data-atmosphere', 'off')
  await expect(restarted.locator('.app-root')).toHaveClass(/sidebar-collapsed/)
  await expect(restarted.locator('.sidebar')).toHaveCSS('width', '60px')
  await restarted.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await expect(restarted.locator('.sidebar')).toHaveCSS('width', '208px')
  await restarted.close()
})

for (const width of [800, 1280]) {
  test(`${width}px 的全部现有模块可进入，目录和外层按钮不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (msg.type() === 'warning' && msg.text().includes('[Vue warn]')) errors.push(msg.text()) })
    await boot(page)
    for (const label of ['小记', '网址收藏', '文件快捷', '验证码', '局域网传输', '内网穿透', '网络直连', 'Codex']) {
      await navigate(page, label)
      if (label === 'Codex') await expect(page.locator('.titlebar-outer .cx-header-tabs')).toBeVisible()
      else await expect(page.locator('.titlebar-outer .titlebar-brand')).toContainText(label)
      await expect(page.locator('.workspace-directory')).toBeHidden()
      await expect(page.locator('#workspace-directory-toggle')).toHaveCount(0)
      const overflow = await page.locator('.workspace-main').evaluate(el => el.scrollWidth > el.clientWidth)
      expect(overflow, label).toBe(false)
      if (['小记', '网址收藏'].includes(label)) {
        await expect(page.locator('.workspace-workbar')).toBeVisible()
        const workbar = (await page.locator('.workspace-workbar').boundingBox())!
        expect(workbar.height).toBe(42)
        expect(workbar.width).toBeLessThanOrEqual(width - (width < 900 ? 60 : 208) - 24)
      }
      const surface = (await page.locator('.workspace-surface').boundingBox())!
      expect(width - (surface.x + surface.width), `${label} 的浮片右侧留出窗框`).toBe(10)
    }
    for (const button of [tipButton(page, '锁定'), tipButton(page, '最小化'), tipButton(page, '最大化'), tipButton(page, '关闭')]) {
      const r = await button.boundingBox()
      expect(r!.y + r!.height).toBeLessThanOrEqual(48)
      expect(r!.x + r!.width).toBeLessThanOrEqual(width)
    }
    // 设置留在图标轨底部，锁定与窗口按钮同组且只有一个入口。
    await expect(page.locator('.titlebar-outer .tb-util')).toHaveCount(0)
    await expect(page.locator('.sidebar-foot .foot-item')).toHaveCount(1)
    await expect(page.locator('.sidebar-foot').getByRole('button', { name: '锁定', exact: true })).toHaveCount(0)
    await expect(page.locator('.titlebar-buttons').getByRole('button', { name: '锁定', exact: true })).toHaveCount(1)
    // 模块动作与窗口控制之间靠一根细线分群
    const hair = await page.locator('.titlebar-outer .titlebar-buttons').evaluate((el) => {
      const s = getComputedStyle(el, '::before')
      return { width: s.width, height: s.height, background: s.backgroundColor }
    })
    expect(hair).toEqual({ width: '1px', height: '20px', background: expect.not.stringMatching(/transparent|rgba\(0, 0, 0, 0\)/) })
    const settings = (await tipButton(page, '设置').boundingBox())!
    expect(settings.y).toBeGreaterThanOrEqual(48)
    expect(settings.y + settings.height).toBeLessThanOrEqual(720)
    expect(settings.x + settings.width).toBeLessThanOrEqual(width < 900 ? 60 : 208)
    if (width < 900) {
      // 最小桌面窗回到图标轨，把宽度让给搜索和页内动作。
      await expect(page.locator('.sidebar')).toHaveCSS('width', '60px')
      await expect(page.locator('.sidebar .nav-text').first()).toBeHidden()
      await expect(page.locator('.titlebar-outer .sidebar-toggle')).toBeHidden()
      expect(parseFloat(await page.locator('.sidebar-nav .nav-item').first().evaluate((el) => getComputedStyle(el).width))).toBe(36)
    } else {
      // 展开态：品牌锁标与导航行同处 208px 轨道，模块名称和分组常驻。
      expect(parseFloat(await page.locator('.sidebar-nav .nav-item').first().evaluate((el) => getComputedStyle(el).width))).toBeGreaterThan(120)
      await expect(page.locator('.sidebar-group-title').first()).toBeVisible()
      await expect(page.locator('.sidebar .nav-text').first()).toBeVisible()
      await expect(page.locator('.titlebar-outer .titlebar-wordmark')).toBeVisible()
    }
    await expect(page.locator('.sidebar .sidebar-toggle')).toHaveCount(0)
    await expect(page.locator('.workspace-page-heading')).toHaveCount(0)
expect((await page.locator('.workspace-main').boundingBox())!.y).toBe(48)
    expect(errors).toEqual([])
  })
}

test('页级工作栏筛选小记时保留草稿，Todo 勾选与归档仍可保存', async ({ page }) => {
  await boot(page)
  const workbar = page.locator('.workspace-workbar')
  await workbar.getByRole('button', { name: /^置顶/ }).click()
  await expect(page.locator('.memo')).toHaveCount(1)
  await page.locator('.memo-body input[type=checkbox]').check()
  await expect.poll(async () => (await e2e.snapshot(page)).notes[0].content_html).toContain('data-checked="true"')
  const editor = page.locator('.composer .ProseMirror')
  await editor.fill('布局预览草稿')
  await workbar.getByRole('button', { name: /^全部/ }).click()
  await expect(editor).toHaveText('布局预览草稿')
  await editor.press('Control+Enter')
  await expect.poll(async () => (await e2e.snapshot(page)).notes.length).toBe(4)
  await expect(page.locator('.memo')).toHaveCount(3)
  await workbar.getByRole('button', { name: /^归档/ }).click()
  await expect(page.locator('.composer')).toHaveCount(0)
  await expect(page.locator('.memo')).toHaveCount(1)
})

test('收藏分类在页级工作栏可选，搜索与详情仍可操作', async ({ page }) => {
  await boot(page)
  await navigate(page, '网址收藏')
  const category = page.locator('.workspace-workbar .wb-tab').filter({ hasText: '设备' })
  await category.focus()
  await page.keyboard.press('Enter')
  await expect(category).toHaveClass(/active/)
  await expect(category).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.entry-card')).toHaveCount(1)
  await expect(page.locator('.entry-card')).toContainText('收藏 5')
  await page.locator('.entry-card').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.workspace-workbar .wb-tab').filter({ hasText: /^全部/ }).click()
  await expect(page.locator('.entry-card')).toHaveCount(5)
  await page.keyboard.press('Control+k')
  await expect(page.getByPlaceholder('搜索名称或网址…')).toBeFocused()
  await page.keyboard.insertText('收藏 2')
  await expect(page.locator('.entry-card')).toHaveCount(1)
  await page.locator('.entry-card').focus()
  await page.keyboard.press('c')
  await expect(page.locator('.toast')).toBeVisible()
  const toast = (await page.locator('.toast').boundingBox())!
  const main = (await page.locator('.workspace-body > .main-content').boundingBox())!
  expect(Math.abs(toast.x + toast.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(2)
})

test('Codex 横向页签切换会话、用量、回收站，保留模型明细和手动刷新', async ({ page }) => {
  await boot(page)
  await navigate(page, 'Codex')
  const views = page.getByRole('navigation', { name: 'Codex 视图' })
  await views.getByRole('button', { name: '会话', exact: true }).click()
  await expect(page.locator('.grp-head')).toHaveCount(1)
  // 首次进入展开最近活动的项目，这里先收起再展开，验证组头交互仍然可用。
  await expect(page.locator('.sess-row')).toHaveCount(1)
  await page.locator('.grp-head').click()
  await expect(page.locator('.sess-row')).toHaveCount(0)
  await page.locator('.grp-head').click()
  await expect(page.locator('.sess-row')).toHaveCount(1)
  await views.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.getByRole('region', { name: '今日用量', exact: true })).toBeVisible()
  await page.locator('.usg-model-row[data-model="gpt-5.4"]').click()
  await expect(page.getByRole('region', { name: 'gpt-5.4 会话用量', exact: true })).toContainText('布局验证')
  const before = await e2e.count(page, 'codex_query_session_usage')
  await page.locator('.cx-band-controls .cx-refresh').click()
  await expect.poll(() => e2e.count(page, 'codex_query_session_usage')).toBeGreaterThan(before)
  await views.getByRole('button', { name: '回收站', exact: true }).click()
  await expect(views.getByRole('button', { name: '回收站', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await views.getByRole('button', { name: '账号', exact: true }).click()
  await expect(views.getByRole('button', { name: '账号', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(views).toBeVisible()
  expect((await views.boundingBox())!.width).toBeGreaterThan((await views.boundingBox())!.height)
})

test('800px 最小桌面窗自动使用图标轨，页级筛选不挤压布局', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await boot(page)
  await expect(page.locator('.workspace-directory')).toBeHidden()
  // 800 窗：图标轨 60 + 浮片四周 18 = 722。
  expect((await page.locator('.workspace-main').boundingBox())!.width).toBe(722)
  await expect(page.locator('.sidebar')).toHaveCSS('width', '60px')
  await expect(page.locator('.titlebar-outer .sidebar-toggle')).toBeHidden()
  await navigate(page, '网址收藏')
  const workbar = page.locator('.workspace-workbar')
  await expect(workbar).toBeVisible()
  expect(await workbar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  const cards = page.locator('.entry-card')
  await expect(cards).toHaveCount(5)
  expect((await cards.nth(1).boundingBox())!.x).toBeGreaterThan((await cards.first().boundingBox())!.x)
  await workbar.locator('.wb-tab').filter({ hasText: '设备' }).click()
  await expect(cards).toHaveCount(1)
  await navigate(page, 'Codex')
  expect((await page.locator('.workspace-main').boundingBox())!.width).toBe(722)
})

test('工作栏与正文同轴，宽窄窗切换不产生横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await boot(page)
  await navigate(page, '网址收藏')
  const workbar = page.locator('.workspace-workbar')
  await expect(workbar).toBeVisible()
  await expect(page.locator('.entry-card').first()).toBeVisible()
  const axis = async () => {
    const bar = (await workbar.boundingBox())!
    const card = (await page.locator('.entry-card').first().boundingBox())!
    return { x: bar.x, cardX: card.x, h: bar.height, y: bar.y }
  }
  let box = await axis()
  expect(box.cardX).toBe(box.x)
  expect(box.h).toBe(42)
  for (const [width, height] of [[800, 600], [1440, 900]]) {
    await page.setViewportSize({ width, height })
    await expect(workbar).toBeVisible()
    expect(await workbar.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
    box = await axis()
    expect(box.cardX).toBe(box.x)
    expect(box.h).toBe(42)
    await expect(page.locator('.workspace-directory')).toBeHidden()
  }
  await page.setViewportSize({ width: 1280, height: 720 })
  const beforeCollapse = (await workbar.boundingBox())!.x
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await expect(workbar).toBeVisible()
  await expect.poll(async () => (await workbar.boundingBox())!.x).toBeLessThan(beforeCollapse)
  await navigate(page, '小记')
  await expect(page.locator('.workspace-workbar')).toBeVisible()
  await expect(page.locator('.workspace-directory')).toBeHidden()
})

for (const theme of ['paper', 'ink']) {
  test(`${theme} 下目录收起时柔光只染窗框，浮片与卡片保持实底`, async ({ page }) => {
    await boot(page, { ...seed, settings: { ...seed.settings, theme, accent: 'plum', background_atmosphere: 'true' } })
    // 比较稳态材质，不采样切换强调色时的过渡帧。
    await page.addStyleTag({ content: 'html.theme-anim,html.theme-anim *{transition:none!important}' })
    const background = (selector: string) => page.locator(selector).evaluate(el => {
      const cs = getComputedStyle(el)
      return { image: cs.backgroundImage, color: cs.backgroundColor }
    })
    await expect(page.locator('.workspace-directory')).toBeHidden()
    // 柔光只在窗框：整窗那一层是光场，内容面是一块实底浮片。
    const workspace = await background('.app-root')
    expect(workspace.image).toMatch(/gradient/)
    const sheet = await background('.workspace-surface')
    const card = await background('.memo:not(.editing) >> nth=0')
    expect(sheet.image).toBe('none')
    expect(card.image).toBe('none')
    // 卡片比浮片再亮一档，三层明度靠明度本身分层。
    expect(card.color).not.toBe(sheet.color)
    const band = await background('#workspace-page-toolbar .page-bar')
    expect(band.image).toBe('none')
    expect(band.color).toBe('rgba(0, 0, 0, 0)')
    await tipButton(page, '设置').click()
    const dialog = page.locator('.settings-dialog')
    await dialog.getByRole('radio', { name: '橙', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clay')
    await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
    // 两种底色的光都由强调色推导，换色必须换光。
    expect((await background('.app-root')).image, '换强调色后光场跟着换').not.toBe(workspace.image)
    // 关灯后的底色仍由当前强调色推导，先记下换色后的纯色基准。
    const clayFrame = await background('.app-root')
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await expect(page.locator('.app-root')).toHaveCSS('background-image', 'none')
    expect((await background('.app-root')).color).toBe(clayFrame.color)
    const cardOff = await background('.memo:not(.editing) >> nth=0')
    expect(cardOff.image).toBe('none')
    expect(cardOff.color).toBe(card.color)
    expect((await background('.workspace-surface')).color).toBe(sheet.color)
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await expect(page.locator('.app-root')).toHaveCSS('background-image', /gradient/)
    expect((await e2e.snapshot(page)).settings.background_atmosphere).toBe('true')
    await page.keyboard.press('Escape')
    await page.locator('.workspace-workbar').getByRole('button', { name: /^置顶/ }).click()
    await expect(page.locator('.memo')).toHaveCount(1)
  })
}

test('主题缩略图展示纸/墨两套中性底色，独立于工作区强调色与氛围', async ({ page }) => {
  await boot(page, { ...seed, settings: { ...seed.settings, theme: 'paper', accent: 'celadon', background_atmosphere: 'true' } })
  await tipButton(page, '设置').click()
  const dialog = page.locator('.settings-dialog')
  await expect(dialog.locator('.workspace-theme-prev .tp-workspace-context')).toHaveCount(2)
  await expect(dialog.getByRole('radio')).toHaveCount(12)
  const preview = dialog.locator('.workspace-theme-prev[data-theme="paper"]')
  await expect(preview).toHaveAttribute('data-accent', 'graphite')
  await expect(preview).toHaveAttribute('data-atmosphere', 'off')
  const rendered = () => preview.evaluate(el => ({ image: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).backgroundColor, accent: getComputedStyle(el).getPropertyValue('--accent') }))
  const before = await rendered()
  for (const [name, id] of [['橙', 'clay'], ['玫瑰', 'rose'], ['琥珀', 'amber'], ['靛', 'indigo'], ['砖红', 'brick'], ['橄榄', 'olive'], ['青', 'teal'], ['砂', 'sand']]) {
    await dialog.getByRole('radio', { name, exact: true }).click()
    await expect(dialog.getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true')
    expect(await rendered()).toEqual(before)
    expect((await e2e.snapshot(page)).settings.accent).toBe(id)
  }
  await dialog.locator('.setting-item', { hasText: '背景氛围' }).locator('label.switch').click()
  expect(await rendered()).toEqual(before)
  await expect(dialog.locator('.tp-workspace-context').first()).toHaveCSS('background-image', 'none')
})

test('外层设置、主题、窗口按钮和锁定恢复均可操作', async ({ page }) => {
  await boot(page)
  await tipButton(page, '设置').click()
  await expect(page.locator('.settings-dialog')).toBeVisible()
  await page.locator('.theme-chip').filter({ hasText: /^墨$/ }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink')
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
  await tipButton(page, '最大化').click()
  await expect.poll(() => e2e.count(page, 'window:toggleMaximize')).toBe(1)
  await tipButton(page, '还原').click()
  await tipButton(page, '最小化').click()
  await expect.poll(() => e2e.count(page, 'window:minimize')).toBe(1)
  await e2e.emitEvent(page, 'window-focus', false)
  await e2e.emitEvent(page, 'window-focus', true)
  await tipButton(page, '关闭').click()
  await expect.poll(() => e2e.count(page, 'window:close')).toBe(1)
  await e2e.emitEvent(page, 'window-focus', false)
  await e2e.emitEvent(page, 'window-focus', true)
  await page.locator('.titlebar-buttons').getByRole('button', { name: '锁定', exact: true }).click()
  await expect(page.locator('.unlock-input')).toBeVisible()
  await expect(page.getByRole('button', { name: '锁定', exact: true })).toHaveCount(0)
  await expect(page.locator('#workspace-directory-content')).toHaveCount(0)
  await page.locator('.unlock-input').fill(E2E_PASSWORD)
  await page.locator('.unlock-btn').click()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(page.locator('#workspace-directory-content > *')).toHaveCount(1)
})
