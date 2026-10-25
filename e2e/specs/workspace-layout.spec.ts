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

test('桌面默认启用新布局，旧主题归并后恢复目录和新外观设置', async ({ page, context }) => {
  await boot(page, { ...seed, settings: { ...seed.settings, theme: 'midnight', accent: 'forest', background_atmosphere: 'true' } })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink')
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'olive')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  await navigate(page, '网址收藏')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect.poll(async () => (await e2e.snapshot(page)).settings.workspace_directory_open).toBe('{"notes":true}')
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
  await expect(restarted.locator('.workspace-directory')).toBeVisible()
  await navigate(restarted, '网址收藏')
  await expect(restarted.locator('.workspace-directory')).toBeHidden()
  await restarted.close()
})

for (const width of [800, 1280]) {
  test(`${width}px 的全部现有模块可进入，目录和外层按钮不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', msg => { if (msg.type() === 'warning' && msg.text().includes('[Vue warn]')) errors.push(msg.text()) })
    await boot(page)
    for (const [label, directory] of [['小记', true], ['网址收藏', true], ['文件快捷', false], ['验证码', false], ['局域网传输', false], ['内网穿透', false], ['网络直连', false], ['Codex', false]] as const) {
      await navigate(page, label)
      if (label === 'Codex') await expect(page.locator('.titlebar-outer .cx-header-tabs')).toBeVisible()
      else await expect(page.locator('.titlebar-outer .titlebar-brand')).toContainText(label)
      const aside = page.locator('.workspace-directory')
      await expect(aside).toBeHidden()
      await expect(page.locator('#workspace-directory-toggle')).toHaveCount(directory ? 1 : 0)
      if (directory) {
        const button = (await page.locator('#workspace-directory-toggle').boundingBox())!
        const toolbar = (await page.locator('#workspace-page-toolbar').boundingBox())!
        expect(button.x).toBeGreaterThan(width / 2)
        expect(button.y).toBeGreaterThanOrEqual(toolbar.y)
        expect(button.y + button.height).toBeLessThanOrEqual(toolbar.y + toolbar.height)
        await expect(page.locator('.titlebar #workspace-directory-toggle')).toHaveCount(1)
      }
      const overflow = await page.locator('.workspace-main').evaluate(el => el.scrollWidth > el.clientWidth)
      expect(overflow, label).toBe(false)
      const surface = (await page.locator('.workspace-surface').boundingBox())!
      expect(width - (surface.x + surface.width), `${label} 的内容面通栏到右缘`).toBe(0)
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
    expect(settings.x + settings.width).toBeLessThanOrEqual(56)
    // 轨顶那格与模块方块同档：两种尺寸的方框上下相挨会读作「缺一块」
    const cells = await page.evaluate(() => {
      const box = (el: Element) => {
        const b = el.getBoundingClientRect()
        return { w: Math.round(b.width), h: Math.round(b.height), r: getComputedStyle(el).borderRadius }
      }
      return { brand: box(document.querySelector('.titlebar-app')!), nav: box(document.querySelector('.sidebar-nav .nav-item')!) }
    })
    expect(cells.brand).toEqual(cells.nav)
    expect(await page.locator('.sidebar-nav .nav-item').first().evaluate((el) => getComputedStyle(el).width)).toBe('36px')
    await expect(page.locator('.sidebar .sidebar-toggle')).toHaveCount(0)
    await expect(page.locator('.workspace-page-heading')).toHaveCount(0)
    expect((await page.locator('.workspace-main').boundingBox())!.y).toBe(48)
    expect(errors).toEqual([])
  })
}

test('收起目录保留模块图标和正在编辑的小记，Todo 勾选与筛选仍可保存', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  await page.locator('.workspace-directory .rail-item').filter({ hasText: '置顶' }).click()
  await expect(page.locator('.memo')).toHaveCount(1)
  await page.locator('.memo-body input[type=checkbox]').check()
  await expect.poll(async () => (await e2e.snapshot(page)).notes[0].content_html).toContain('data-checked="true"')
  const editor = page.locator('.composer .ProseMirror')
  await editor.fill('布局预览草稿')
  await page.getByRole('button', { name: '收起目录', exact: true }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(editor).toHaveText('布局预览草稿')
  await page.keyboard.press('Control+b')
  await expect(page.locator('.workspace-directory')).toBeVisible()
  await expect(editor).toHaveText('布局预览草稿')
  await page.locator('.workspace-directory .rail-item').filter({ hasText: /^全部/ }).click()
  await editor.press('Control+Enter')
  await expect.poll(async () => (await e2e.snapshot(page)).notes.length).toBe(4)
  await expect(page.locator('.memo')).toHaveCount(3)
  await page.locator('.workspace-directory .rail-item').filter({ hasText: '归档' }).click()
  await expect(page.locator('.composer')).toHaveCount(0)
  await expect(page.locator('.memo')).toHaveCount(1)
})

test('收藏全部分类在目录中可选，搜索与详情仍可操作', async ({ page }) => {
  await boot(page)
  await navigate(page, '网址收藏')
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  const category = page.locator('.workspace-directory .tab').filter({ hasText: '设备' })
  await category.focus()
  await page.keyboard.press('Enter')
  await expect(category).toHaveClass(/active/)
  await expect(category).not.toHaveCSS('background-color', /transparent|rgba\(0, 0, 0, 0\)/)
  await expect(page.locator('.entry-card')).toHaveCount(1)
  await expect(page.locator('.entry-card')).toContainText('收藏 5')
  await page.locator('.entry-card').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.workspace-directory .tab').filter({ hasText: '全部' }).click()
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

test('800px 目录与正文并排停靠，收起后恢复两列收藏且模块可直接切换', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await boot(page)
  await expect(page.locator('.workspace-directory')).toBeHidden()
  const mainWidth = (await page.locator('.workspace-main').boundingBox())!.width
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await expect(page.locator('.directory-docked .workspace-directory')).toBeVisible()
  const panel = (await page.locator('.workspace-directory').boundingBox())!
  const surface = (await page.locator('.workspace-surface').boundingBox())!
  const main = (await page.locator('.workspace-main').boundingBox())!
  const content = (await page.locator('.workspace-body > .main-content').boundingBox())!
  expect(panel.x).toBe(content.x + content.width)
  expect(panel.x).toBe(main.x + main.width)
  expect(panel.x + panel.width).toBe(surface.x + surface.width)
  expect(panel.y).toBe(surface.y)
  expect(panel.height).toBe(surface.height)
  expect(content.width).toBeLessThan(mainWidth)
  expect(main.width).toBe(mainWidth - panel.width)
  await page.getByRole('button', { name: '收起目录', exact: true }).click()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.locator('.workspace-directory .rail-item').filter({ hasText: '置顶' }).click()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(page.locator('.memo')).toHaveCount(1)
  await page.locator('.memo').hover()
  await tipButton(page.locator('.memo'), '编辑').click()
  await expect(page.locator('.memo.editing')).toBeVisible()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.memo.editing')).toBeVisible()
  await expect(page.getByRole('button', { name: '展开目录', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.locator('.page-bar .search-box input').click()
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await navigate(page, '文件快捷')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await navigate(page, '网址收藏')
  const cards = page.locator('.entry-card')
  await expect(cards).toHaveCount(5)
  expect((await cards.nth(1).boundingBox())!.x).toBeGreaterThan((await cards.first().boundingBox())!.x)
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.locator('.workspace-directory .tab').filter({ hasText: '设备' }).press('Enter')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await expect(cards).toHaveCount(1)
  await navigate(page, 'Codex')
  expect((await page.locator('.workspace-main').boundingBox())!.width).toBe(mainWidth)
})

test('宽窗目录贴合内容面顶部与底部，缩放和切换保留手动偏好', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await boot(page)
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  const panel = (await page.locator('.workspace-directory').boundingBox())!
  const surface = (await page.locator('.workspace-surface').boundingBox())!
  const main = (await page.locator('.workspace-main').boundingBox())!
  const content = (await page.locator('.workspace-body > .main-content').boundingBox())!
  expect(panel.x).toBe(content.x + content.width)
  expect(panel.x).toBe(main.x + main.width)
  expect(panel.x + panel.width).toBe(surface.x + surface.width)
  expect(panel.y).toBe(surface.y)
  expect(panel.height).toBe(surface.height)
  expect((await page.locator('.workspace-directory-heading').boundingBox())!.height).toBe(48)
  await expect(page.locator('.workspace-surface > #workspace-directory')).toBeVisible()
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(page.locator('.directory-docked .workspace-directory')).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('.workspace-directory')).toBeVisible()
  await expect(page.locator('.workspace-directory-backdrop')).toHaveCount(0)
  await page.getByRole('button', { name: '收起目录', exact: true }).click()
  await navigate(page, '网址收藏')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await page.getByRole('button', { name: '展开目录', exact: true }).click()
  await page.getByRole('button', { name: '固定目录', exact: true }).click()
  await navigate(page, '小记')
  await expect(page.locator('.workspace-directory')).toBeHidden()
  await navigate(page, '网址收藏')
  await expect(page.locator('.workspace-directory')).toBeVisible()
})

for (const theme of ['paper', 'ink']) {
  test(`${theme} 下目录收起时画布仍有柔光，卡片保持实底，暗色画布保持中性`, async ({ page }) => {
    await boot(page, { ...seed, settings: { ...seed.settings, theme, accent: 'plum', background_atmosphere: 'true' } })
    // 比较稳态材质，不采样切换强调色时的过渡帧。
    await page.addStyleTag({ content: 'html.theme-anim,html.theme-anim *{transition:none!important}' })
    const background = (selector: string) => page.locator(selector).evaluate(el => {
      const cs = getComputedStyle(el)
      return { image: cs.backgroundImage, color: cs.backgroundColor }
    })
    await expect(page.locator('.workspace-directory')).toBeHidden()
    const workspace = await background('.workspace-main')
    expect(workspace.image).toContain('radial-gradient')
    await page.getByRole('button', { name: '展开目录', exact: true }).click()
    await page.getByRole('button', { name: '固定目录', exact: true }).click()
    const panel = await background('.workspace-directory')
    const card = await background('.memo:not(.editing) >> nth=0')
    expect(panel.image).toContain('gradient')
    expect(panel.color).not.toMatch(/rgba|transparent|\//)
    expect(panel).toEqual(workspace)
    await expect(page.locator('.workspace-directory')).toHaveCSS('background-attachment', /^fixed(?:,\s*fixed)*$/)
    const band = await background('#workspace-page-toolbar .page-bar')
    expect(band.image).toBe('none')
    expect(band.color).toBe('rgba(0, 0, 0, 0)')
    expect(card.image).toBe('none')
    if (theme === 'ink') expect(workspace.color).not.toBe(card.color)
    await tipButton(page, '设置').click()
    const dialog = page.locator('.settings-dialog')
    await dialog.getByRole('radio', { name: '橙', exact: true }).click()
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'clay')
    await expect(page.locator('html')).not.toHaveClass(/theme-anim/)
    expect((await background('.workspace-main')).image).not.toBe(workspace.image)
    await expect.poll(() => background('.workspace-directory')).not.toEqual(panel)
    const recoloredPanel = await background('.workspace-directory')
    const control = dialog.locator('.setting-item', { hasText: '背景氛围' })
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await expect(page.locator('.workspace-main')).toHaveCSS('background-image', 'none')
    await expect(page.locator('.workspace-directory')).toHaveCSS('background-image', 'none')
    expect((await background('.workspace-main')).color).toBe(workspace.color)
    expect((await background('.workspace-directory')).color).toBe(workspace.color)
    expect(await background('.memo:not(.editing) >> nth=0')).toEqual(card)
    await control.locator('label.switch').click()
    await expect(control.getByRole('switch')).toBeEnabled()
    await expect(page.locator('.workspace-directory')).toHaveCSS('background-image', /gradient/)
    expect((await e2e.snapshot(page)).settings.background_atmosphere).toBe('true')
    await page.keyboard.press('Escape')
    await page.locator('.workspace-directory .rail-item').filter({ hasText: '置顶' }).click()
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
