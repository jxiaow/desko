import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, tipButton } from '../helpers'

async function expectToolbarFits(page: Page) {
  await expect.poll(() => page.locator('#workspace-page-toolbar').evaluate(toolbar => {
    const bounds = toolbar.getBoundingClientRect()
    const controls = document.querySelector('.titlebar-buttons')!.getBoundingClientRect()
    const fields = toolbar.querySelectorAll<HTMLElement>('.cx-header-tabs > button, .fs-head > button, .search-box, .page-actions > button, .session-search-mode, .usage-ranges, .page-bar > .chip')
    const issues = [...fields].filter(element => element.getClientRects().length).flatMap(element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      const fits = rect.x >= bounds.x && rect.right <= bounds.right + 0.5 && rect.right <= controls.x - 11 && rect.y >= 0 && rect.bottom <= 48
      return fits && hit && element.contains(hit) ? [] : [element.getAttribute('aria-label') || element.textContent?.trim() || element.className]
    })
    const search = toolbar.querySelector('input')
    if (search?.getClientRects().length && search.getBoundingClientRect().width < 80) issues.push('搜索输入区域不足 80px')
    return issues
  })).toEqual([])
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
        await expect(page.locator('#workspace-page-toolbar .search-kbd')).toBeHidden()
        await page.locator('#workspace-directory-toggle').click()
        await page.getByRole('button', { name: '固定目录', exact: true }).click()
        await expectToolbarFits(page)
        await page.locator('#workspace-directory-toggle').click()
      }
      if (route === 'notes') {
        await page.locator('.memo').hover()
        await page.getByRole('button', { name: '全屏查看', exact: true }).click()
        const header = page.locator('#workspace-page-toolbar > .fs-head')
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
        expect(navigation.y).toBe(0)
        expect(navigation.height).toBe(48)
        for (const view of ['会话', '用量', '回收站', '账号']) {
          await views.getByRole('button', { name: view, exact: true }).click()
          await expect(views.getByRole('button', { name: view, exact: true })).toHaveAttribute('aria-pressed', 'true')
          await expectToolbarFits(page)
          await expect(page.locator('#workspace-page-toolbar .search-box, #workspace-page-toolbar .session-search-mode, #workspace-page-toolbar .usage-ranges')).toHaveCount(0)
          const filters = page.locator('#codex-view-filters')
          if (view !== '用量') await expect(filters).toBeHidden()
          else {
            await expect(filters).toBeVisible()
            expect((await filters.boundingBox())!.y).toBeGreaterThanOrEqual(48)
          }
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
        await expect.poll(async () => (await page.locator('#workspace-page-toolbar .search-box').boundingBox())!.width).toBe(300)
      }
    }
    const dragCount = await e2e.count(page, 'window:startDragging')
    await page.locator('.titlebar-brand').click()
    expect(await e2e.count(page, 'window:startDragging')).toBe(dragCount + 1)
    await page.locator('.titlebar-buttons').getByRole('button', { name: '最大化', exact: true }).click()
    await expect(tipButton(page.locator('.titlebar-buttons'), '还原')).toBeVisible()
  })
}
