import { test, expect } from '@playwright/test'
import { openNoteRead, tipButton } from '../helpers'
import { webApp, selectModule } from '../web-helpers'

for (const width of [360, 390, 768, 1040, 1440]) {
  test(`shared Web workspace remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const app = await webApp(page, { settings: { codex_enabled: 'true', fileshare_enabled: 'true', tunnel_enabled: 'true' } })
    await app.login()
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'workspace')
    await expect(page.locator('#workspace-page-toolbar')).toBeVisible()
    const toggle = page.getByRole('button', { name: /^(展开|收起)目录$/ })
    const before = await toggle.boundingBox()
    await toggle.click()
    expect(Math.abs((await toggle.boundingBox())!.x - before!.x)).toBeLessThan(1)
    if (width <= 760) {
      await expect(page.locator('.sidebar')).toBeHidden()
      if (await page.locator('#workspace-directory').isVisible()) {
        await expect(page.locator('#workspace-directory')).toBeInViewport()
        await page.getByRole('button', { name: '关闭辅助侧栏', exact: true }).click()
      }
    }
    await openNoteRead(page.locator('.memo').first())
    await expect(page.getByRole('dialog', { name: '全屏查看小记' })).toBeVisible()
    const toolbar = page.locator('#note-fullscreen-toolbar')
    await expect(toolbar.getByRole('button', { name: '复制正文', exact: true })).toBeInViewport()
    await expect(toolbar.getByRole('button', { name: '编辑', exact: true })).toBeInViewport()
    await toolbar.getByRole('button', { name: /退出全屏/ }).click()
    for (const name of ['网址收藏', '文件快捷', '验证码', 'Codex', '局域网传输', '内网穿透', '小记']) {
      await selectModule(page, name)
      await expect(page.locator('.titlebar-outer')).toBeVisible()
      const overflow = await page.locator('.app-root').evaluate(el => el.scrollWidth > el.clientWidth + 1)
      expect(overflow, name).toBe(false)
    }
    if (width <= 760) {
      await page.getByRole('button', { name: '打开模块导航', exact: true }).click()
      await page.locator('.web-module-drawer').getByRole('button', { name: '设置', exact: true }).click()
    } else await tipButton(page, '设置').click()
    const settings = page.getByRole('dialog', { name: '浏览器设置' })
    await settings.getByRole('button', { name: '小记', exact: true }).click()
    const cleanup = settings.getByRole('checkbox', { name: '粘贴时整理格式' })
    await expect(cleanup).toBeVisible()
    await cleanup.uncheck()
    await expect(cleanup).not.toBeChecked()
    expect(await page.evaluate(() => localStorage.getItem('desko.web.note_paste_cleanup'))).toBe('false')
    await settings.getByRole('button', { name: '外观', exact: true }).click()
    await expect(settings.getByRole('group', { name: '底色', exact: true }).getByRole('button')).toHaveCount(2)
    await settings.getByRole('button', { name: '墨', exact: true }).click()
    await page.screenshot({ path: `.tmp/web-workspace/settings-${width}-ink.png`, animations: 'disabled' })
    await settings.getByRole('button', { name: '完成', exact: true }).click()
    await page.screenshot({ path: `.tmp/web-workspace/notes-${width}-ink.png`, animations: 'disabled' })
    expect(app.errors).toEqual([])
  })
}
