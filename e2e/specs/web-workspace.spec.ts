import { test, expect } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'
import { webApp, selectModule } from '../web-helpers'

test('desktop manages two independent Web services and exposes the Codex entry', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await page.getByRole('button', { name: '选择项目', exact: true }).click()
  await page.getByRole('button', { name: '设置 Web 访问', exact: true }).click()
  const settings = page.locator('.settings-dialog')
  await expect(settings.getByRole('heading', { name: 'Web 访问', exact: true })).toBeVisible()
  const app = settings.locator('.web-access-pane').filter({ has: page.getByRole('heading', { name: 'Desko Web', exact: true }) })
  const codex = settings.locator('.web-access-pane').filter({ has: page.getByRole('heading', { name: 'Codex Web UI', exact: true }) })
  await expect(app.getByLabel('端口', { exact: true })).toHaveValue('8420')
  await expect(codex.getByLabel('端口', { exact: true })).toHaveValue('8421')
  await app.getByRole('button', { name: '启动 Web 服务', exact: true }).click()
  await codex.getByRole('button', { name: '启动 Web 服务', exact: true }).click()
  await expect(app.getByRole('link')).toHaveAttribute('href', 'http://127.0.0.1:8420')
  await expect(codex.getByRole('link')).toHaveAttribute('href', 'http://127.0.0.1:8421')
  await codex.getByRole('button', { name: '停止服务', exact: true }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  await expect(codex.getByText('服务未启动', { exact: true })).toBeVisible()
  await expect(app.getByText('服务运行中', { exact: true })).toBeVisible()
})

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
    await page.locator('.memo').first().hover()
    if (width <= 760) await page.locator('.memo').first().getByRole('button', { name: '更多操作', exact: true }).click()
    await page.getByRole('button', { name: '全屏查看', exact: true }).first().click()
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

for (const { width, height } of [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 1040, height: 844 }, { width: 844, height: 390 }]) {
  test.describe(`Codex Web ${width}×${height}`, () => {
    test.use({ hasTouch: width === 844, isMobile: width === 844 })
    test(`dedicated Codex Web connects, streams and handles approval at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      const app = await webApp(page, { settings: { codex_enabled: 'true' } }, '/codex', 'codex')
      await app.login('.codex-dialog')
      if (width <= 760 || height === 390) {
        expect((await page.locator('.titlebar-outer').boundingBox())!.height).toBeLessThan(60)
        expect((await page.locator('.codex-dialog').boundingBox())!.y).toBeLessThan(80)
      }
      await expect(page.getByRole('button', { name: '账号', exact: true })).toHaveCount(0)
      await page.getByRole('textbox', { name: '服务器工作目录', exact: true }).fill('C:\\Code\\fixture')
      await page.getByRole('button', { name: '连接工作目录', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: '已连接' })).toBeVisible()
      const message = page.getByRole('textbox', { name: '发给 Codex 的消息' })
      await message.fill('测试审批')
      await page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(page.getByRole('region', { name: '待处理的 Codex 请求' })).toContainText('git status --short')
      await page.getByRole('button', { name: '拒绝', exact: true }).click()
      await expect(page.getByRole('region', { name: '待处理的 Codex 请求' })).toHaveCount(0)
      await expect(page.locator('.dialog-user')).toHaveCount(1)
      await expect(message).toBeInViewport()
      await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
      if (width <= 760 || height === 390) {
        await page.getByRole('button', { name: '历史对话', exact: true }).click()
        await expect(page.getByRole('dialog', { name: '当前项目历史' })).toBeVisible()
        await page.locator('.dialog-thread').first().click()
        await expect(page.getByRole('dialog', { name: '当前项目历史' })).toHaveCount(0)
        await expect(page.getByText('正在恢复对话…', { exact: true })).toHaveCount(0)
      }
      expect(await page.locator('.codex-dialog').evaluate(el => el.scrollWidth > el.clientWidth + 1)).toBe(false)
      await page.screenshot({ path: `.tmp/web-workspace/codex-${width}-paper.png`, animations: 'disabled' })
      await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'ink'); document.documentElement.setAttribute('data-base', 'dark') })
      await page.screenshot({ path: `.tmp/web-workspace/codex-${width}-ink.png`, animations: 'disabled' })
      expect(app.invocations).not.toContain('list_notes')
      expect(app.invocations).not.toContain('get_codex_accounts')
      expect(app.errors).toEqual([])
    })
  })
}
