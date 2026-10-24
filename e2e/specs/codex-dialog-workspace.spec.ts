import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
import { webApp } from '../web-helpers'

const histories = [
  { id: 'cli-existing', cwd: 'C:\\Code\\fixture', title: 'CLI 中的项目检查', source: 'cli', text: 'CLI 历史消息已完整载入。' },
  { id: 'client-existing', cwd: 'C:\\Code\\fixture', title: 'Codex 中的界面调整', source: 'vscode' },
  { id: 'other-repo', cwd: 'C:\\Code\\other', title: '其他仓库的会话', source: 'cli' },
  { id: 'worker', cwd: 'C:\\Code\\fixture', title: '后台子任务', source: 'subAgent' },
]
async function connect(page: Page, web = false) {
  if (web) {
    const app = await webApp(page, { settings: { codex_enabled: 'true' }, codexDialogHistories: histories }, '/codex', 'codex')
    await app.login('.codex-dialog')
    await page.getByRole('textbox', { name: '服务器工作目录' }).fill('C:\\Code\\fixture')
    await page.getByRole('button', { name: '连接工作目录', exact: true }).click()
  } else {
    await bootUnlocked(page, { settings: { codex_enabled: 'true' }, codexDialogHistories: histories }, '/codex')
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await e2e.queueDialog(page, 'C:\\Code\\fixture')
    await page.getByRole('button', { name: '选择工作目录', exact: true }).click()
  }
  await expect(page.getByRole('textbox', { name: '发给 Codex 的消息' })).toBeEnabled()
}

test('repository history is imported automatically and refresh keeps the unsent draft', async ({ page }) => {
  await connect(page)
  const input = page.getByRole('textbox', { name: '发给 Codex 的消息' })
  await input.fill('未发送的内容')
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await expect(page.locator('.dialog-thread')).toHaveCount(3) // two imported histories plus this new draft
  await expect(page.getByRole('dialog', { name: '当前项目历史' })).toContainText('CLI')
  await expect(page.getByRole('dialog', { name: '当前项目历史' })).toContainText('Codex')
  await expect(page.getByRole('dialog', { name: '当前项目历史' })).not.toContainText('其他仓库的会话')
  await page.getByRole('button', { name: '同步 CLI 和 Codex 历史' }).click()
  await expect(page.locator('.dialog-thread')).toHaveCount(3)
  await expect(input).toHaveValue('未发送的内容')
  await page.locator('.dialog-thread').filter({ hasText: 'CLI 中的项目检查' }).click()
  await expect(page.locator('.dialog-markdown')).toContainText('CLI 历史消息已完整载入。')
  await expect(input).toHaveValue('')
  const calls = await page.evaluate(() => (window as any).__E2E__.invocations)
  expect(calls.filter((c: any) => c.cmd === 'codex_dialog_action' && ['send', 'createThread'].includes(c.args.action))).toHaveLength(0)
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 800, height: 600 }, { width: 390, height: 844 }]) {
  test(`project settings stay on demand and preserve drafts at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await connect(page, viewport.width < 800)
    const input = page.getByRole('textbox', { name: '发给 Codex 的消息' })
    await input.fill('保留这条草稿')
    await page.getByRole('button', { name: '选择项目', exact: true }).click()
    await page.getByRole('button', { name: '添加项目 / 运行环境', exact: true }).click()
    await expect(page.getByRole('textbox', { name: viewport.width < 800 ? '服务器工作目录' : '工作目录', exact: true })).toHaveValue('C:\\Code\\fixture')
    await expect(page.getByRole('button', { name: '连接工作目录', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: '运行环境', exact: true }).click()
    const trigger = (await page.getByRole('button', { name: '运行环境', exact: true }).boundingBox())!
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(Math.abs(trigger.x - menu.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(trigger.width - menu.width)).toBeLessThanOrEqual(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '选择项目', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(input).toHaveValue('保留这条草稿')
    await expect(input).toBeInViewport(); await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    expect(await page.locator('.codex-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  })
}
