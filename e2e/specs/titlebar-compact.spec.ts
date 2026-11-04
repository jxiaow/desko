import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, openNoteRead, tipButton } from '../helpers'

async function expectToolbarFits(page: Page) {
  // 页级动作住内容区页头，全屏首栏寄在标题栏那一行：两处的可用性分开验。
  await expect.poll(() => page.locator('#workspace-page-toolbar').evaluate(toolbar => {
    const bounds = toolbar.getBoundingClientRect()
    const fields = toolbar.querySelectorAll<HTMLElement>('.cx-header-tabs > button, .search-box, .page-actions > button, .session-search-mode, .usage-ranges, .page-bar > .chip')
    const issues = [...fields].filter(element => element.getClientRects().length).flatMap(element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const fits = rect.x >= bounds.x && rect.right <= bounds.right + 0.5 && rect.y >= bounds.y - 0.5 && rect.bottom <= bounds.bottom + 0.5
      return fits && hit && element.contains(hit) ? [] : [element.getAttribute('aria-label') || element.textContent?.trim() || element.className]
    })
    const search = toolbar.querySelector('input')
    if (search?.getClientRects().length && search.getBoundingClientRect().width < 80) issues.push('搜索输入区域不足 80px')
    return issues
  })).toEqual([])
  await expect.poll(() => page.locator('#workspace-fs-slot').evaluate(slot => {
    const bounds = slot.getBoundingClientRect()
    const controls = document.querySelector('.titlebar-buttons')!.getBoundingClientRect()
    const fields = slot.querySelectorAll<HTMLElement>('button')
    return [...fields].filter(element => element.getClientRects().length).flatMap(element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const fits = rect.x >= bounds.x && rect.right <= Math.min(bounds.right, controls.x - 11) + 0.5 && rect.y >= bounds.y - 0.5 && rect.bottom <= bounds.bottom + 0.5
      return fits && hit && element.contains(hit) ? [] : [element.getAttribute('aria-label') || element.textContent?.trim() || element.className]
    })
  })).toEqual([])
}

async function settledWidth(page: Page, selector: string) {
  // 等几何落定再取值：连续两帧同宽才算稳。
  return page.locator(selector).evaluate(async (el) => {
    let prev = -1
    for (let i = 0; i < 60; i++) {
      const width = el.getBoundingClientRect().width
      if (width === prev) return width
      prev = width
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
    return prev
  })
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 最小窗口同时显示 Web 与云同步时，标题栏不重叠且操作可用`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 })
    await bootUnlocked(page, {
      settings: { theme, mfa_enabled: 'true', codex_enabled: 'true', fileshare_enabled: 'true', tunnel_enabled: 'true' },
      notes: [{ title: '布局检查', content_html: '<p>最小窗口</p>' }],
      notePassphrase: 'notes-passphrase',
      entries: [{ name: '布局检查', password: 'demo' }],
      fileShortcuts: [{ name: '布局检查', path: 'C:/demo', shortcut_type: 'folder' }],
      codex: {
        accounts: [{ email: 'demo@example.invalid', current: true }],
        sessions: [{ sessionId: 'layout', title: '布局检查', cwd: 'C:/demo' }],
      },
      tunnel: {
        bound: true, installed: true,
        services: Array.from({ length: 12 }, (_, i) => ({ hostname: `service${i}.example.com`, port: 8000 + i, routed: false })),
      },
    })
    await page.evaluate(async () => {
      const transportPath = '/src/services/transport.ts'
      const webAccessPath = '/src/services/api/webAccess.ts'
      const { invoke } = await import(transportPath)
      const { webAccessApi } = await import(webAccessPath)
      await invoke('backup_set_password', { password: 'backup-passphrase' })
      await invoke('cloud_save_config', { server: 'https://cloud.example.invalid', account: 'demo', appPassword: 'demo' })
      window.__E2E__!.emitEvent('auto-backup')
      await webAccessApi.start({ port: 8420, lan: true })
    })
    await expect(page.locator('.backup-badge')).toBeVisible()
    await expect(page.locator('.web-running')).toBeVisible()

    for (const [route, label] of [['notes', '小记'], ['entries', '网址收藏'], ['files', '文件快捷'], ['mfa', '验证码'], ['codex', 'Codex'], ['fileshare', '局域网传输'], ['tunnel', '内网穿透']]) {
      await page.locator(`a.nav-item[href="/${route}"]`).click()
      await expect(page.locator('.titlebar-crumb')).toHaveText(label)
      await expect(page.locator('#workspace-page-toolbar > *').first()).toBeVisible()
      await expectToolbarFits(page)
      if (route === 'notes' || route === 'entries') {
        // 最小窗口这一排要同时装视图页签、搜索和徽标带来的动作钮：搜索框先收到 200px，
        // 「Ctrl K」字样随之让位（加速键照用），视图页签仍要整排可见。
        await expect(page.locator('#workspace-page-toolbar .search-kbd')).toBeHidden()
        await expect(page.locator('.workspace-workbar')).toBeVisible()
        await expectToolbarFits(page)
      }
      if (route === 'notes') {
        await openNoteRead(page.locator('.memo'))
        const header = page.locator('#workspace-fs-slot > .fs-head')
        await expect(header).toBeVisible()
        await expectToolbarFits(page)
        await header.getByRole('button', { name: '编辑', exact: true }).click()
        await expectToolbarFits(page)
        await header.getByRole('button', { name: /退出全屏/ }).click()
        await expect(page.locator('.fs')).toHaveCount(0)
      }
      if (route === 'codex') {
        const views = page.getByRole('navigation', { name: 'Codex 视图' })
        const navigation = (await views.boundingBox())!
        const head = (await page.locator('.workspace-head').boundingBox())!
        // 视图页签是页级身份行，随动作一起住内容区页头，不再压在 34px 窗口带里。
        expect(navigation.y).toBeGreaterThanOrEqual(head.y)
        expect(navigation.y + navigation.height).toBeLessThanOrEqual(head.y + head.height)
        for (const view of ['会话', '用量', '回收站', '账号']) {
          await views.getByRole('button', { name: view, exact: true }).click()
          await expect(views.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true')
          await expectToolbarFits(page)
          // 页头只有一条带子：当前视图的搜索与筛选折在它的第二排，用量的统计窗口在第一排。
          // 本用例只有一颗账号与一条会话，账号页／会话页的筛选整排收起，正文上方也就没有第二排。
          await expect(page.locator('#codex-view-filters')).toHaveCount(0)
          await expect(page.locator('#workspace-page-toolbar .search-box, #workspace-page-toolbar .session-search-mode')).toHaveCount(0)
          const ranges = page.locator('#workspace-page-toolbar .usage-ranges')
          if (view === '用量') await expect(ranges).toBeVisible()
          else await expect(ranges).toHaveCount(0)
        }
        await page.getByRole('button', { name: '添加账号', exact: true }).click()
        await expect(page.getByRole('dialog', { name: '添加 Codex 账号', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }
    }

    await page.locator('a.nav-item[href="/files"]').click()
    await expect(page.locator('.titlebar-crumb')).toHaveText('文件快捷')
    for (const width of [1040, 1280, 800]) {
      await page.setViewportSize({ width, height: 600 })
      await expectToolbarFits(page)
      if (width >= 1040) {
        await expect(page.locator('#workspace-page-toolbar .search-kbd')).toBeVisible()
        // 页头带 768 时搜索框钉在 240 档（放不下由左轴那组吸收，不回头压搜索）。
        // 搜索框的宽由页头带的容器查询档位定，而 .search-box 吃全局 `transition: all`：
        // 刚改完视口就量，读到的是档位切换过渡途中的值（800→1040 实测在 200~240 之间飘）。
        // 所以量到连续两帧同值才算落定。
        const searchWidth = await settledWidth(page, '#workspace-page-toolbar .search-box')
        expect(searchWidth).toBeGreaterThanOrEqual(240)
        expect(searchWidth).toBeLessThanOrEqual(360)
      }
    }
    const dragCount = await e2e.count(page, 'window:startDragging')
    await page.locator('.titlebar-drag').click()
    expect(await e2e.count(page, 'window:startDragging')).toBe(dragCount + 1)
    await page.locator('.titlebar-buttons').getByRole('button', { name: '最大化', exact: true }).click()
    await expect(tipButton(page.locator('.titlebar-buttons'), '还原')).toBeVisible()
  })
}
