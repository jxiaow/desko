import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
import { webApp } from '../web-helpers'
import { CODEX_DIALOG_ENABLED } from '../../src/services/featureFlags'

test.skip(!CODEX_DIALOG_ENABLED, 'Codex 对话入口已屏蔽，见 src/services/featureFlags.ts')

async function openDialog(page: Page) {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await e2e.queueDialog(page, 'C:\\Code\\desko')
  await page.getByRole('button', { name: '选择工作目录', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '发给 Codex 的消息' })).toBeEnabled()
}
async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: '发给 Codex 的消息' }).fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}
async function history(page: Page, title: string) {
  await page.getByRole('button', { name: '历史对话', exact: true }).click()
  await page.locator('.dialog-thread').filter({ hasText: title }).click()
}

for (const [width, height] of [[800, 600], [1440, 900], [1920, 1080]]) {
  test(`single column chat and aligned model choices fit native ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await openDialog(page)
    await expect(page.locator('.dialog-history')).toHaveCount(0)
    await expect(page.locator('.codex-dialog-popover')).toHaveCount(0)
    const main = (await page.locator('.workspace-main').boundingBox())!
    const card = (await page.locator('.dialog-composer').boundingBox())!
    const expectedWidth = Math.min(1120, main.width - 64 - 8)
    expect(Math.abs(card.width - expectedWidth)).toBeLessThanOrEqual(1)
    if (height === 600) expect((await page.locator('.dialog-bottom').boundingBox())!.height).toBeLessThan(145)
    await page.getByRole('button', { name: '对话模型', exact: true }).click()
    const trigger = (await page.getByRole('button', { name: '对话模型', exact: true }).boundingBox())!
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x).toBeCloseTo(trigger.x, 0); expect(menu.width).toBeCloseTo(trigger.width, 0)
    expect(menu.y + menu.height).toBeLessThan(trigger.y)
    await page.keyboard.press('Escape')
    await send(page, '检查对话布局'); await expect(page.locator('.dialog-markdown')).toContainText('检查完成')
    await expect(page.getByRole('button', { name: '对话模型', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '复制回复', exact: true }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('检查完成')
    await page.screenshot({ path: `.taste-skill/codex-chat-implementation/native-${width}.png` })
    await page.getByRole('button', { name: '历史对话', exact: true }).click()
    await expect(page.locator('.dialog-thread')).toHaveCount(1)
    await page.keyboard.press('Escape'); await expect(page.locator('.codex-dialog-popover')).toHaveCount(0)
    expect(await page.locator('.app-root').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  })
}

for (const [width, height] of [[800, 600], [1440, 900], [1920, 1080]]) {
  test(`Codex 对话目录在 ${width}px 并排停靠，页签与对话列对齐`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await openDialog(page)
    const mainBefore = (await page.locator('.workspace-main').boundingBox())!
    await page.keyboard.press('Control+b')
    await expect(page.locator('.workspace-directory')).toBeVisible()
    await expect(page.locator('#workspace-directory-content .codex-directory')).toBeVisible()
    const main = (await page.locator('.workspace-main').boundingBox())!
    const panel = (await page.locator('.workspace-directory').boundingBox())!
    expect(main.x + main.width).toBe(panel.x)
    expect(panel.width).toBeGreaterThanOrEqual(200)
    expect(panel.width).toBeLessThanOrEqual(248)
    expect(main.width).toBe(mainBefore.width - panel.width)
    const column = (await page.locator('.dialog-composer').boundingBox())!
    const tabs = (await page.locator('.cx-header-tabs').boundingBox())!
    expect(Math.abs(tabs.x - column.x)).toBeLessThanOrEqual(1)
    expect(column.x + column.width).toBeLessThanOrEqual(panel.x - 31)
    await page.getByRole('button', { name: '关闭辅助侧栏', exact: true }).click()
    await expect(page.locator('.workspace-directory')).toBeHidden()
    expect((await page.locator('.workspace-main').boundingBox())!).toEqual(mainBefore)
  })
}

test('history drafts and new unsent drafts stay separate and recover after remount', async ({ page }) => {
  await openDialog(page); await send(page, '第一段对话'); await expect(page.locator('.dialog-markdown')).toContainText('检查完成')
  const input = page.getByRole('textbox', { name: '发给 Codex 的消息' })
  await input.fill('A 的草稿'); await page.getByRole('button', { name: '新对话', exact: true }).click()
  await expect(input).toHaveValue(''); await send(page, '第二段对话'); await expect(page.locator('.dialog-markdown')).toContainText('检查完成')
  await input.fill('B 的草稿'); await history(page, '第一段对话'); await expect(input).toHaveValue('A 的草稿')
  await history(page, '第二段对话'); await expect(input).toHaveValue('B 的草稿')
  await page.getByRole('button', { name: '新对话', exact: true }).click(); await input.fill('尚未发送的新对话草稿')
  await page.getByRole('button', { name: '新对话', exact: true }).click(); await expect(input).toHaveValue('')
  await history(page, '尚未发送的新对话草稿'); await expect(input).toHaveValue('尚未发送的新对话草稿')
  await expect(page.locator('.dialog-user')).toHaveCount(0)
  await page.locator('a.nav-item[href="/notes"]').click(); await page.locator('a.nav-item[href="/codex"]').click()
  await page.getByRole('button', { name: '对话', exact: true }).click(); await expect(input).toHaveValue('尚未发送的新对话草稿')
})

test('in-flight model choices apply only to the next turn in the same thread', async ({ page }) => {
  await openDialog(page); await send(page, '暂停以检查参数')
  await expect(page.locator('.response-parameters')).toContainText('测试模型 · 标准思考')
  await page.getByRole('button', { name: '对话模型', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '快速模型', exact: true }).click()
  await page.getByRole('button', { name: '思考度', exact: true }).click()
  await expect(page.getByRole('menuitemradio', { name: '标准思考', exact: true })).toHaveCount(0)
  await page.getByRole('menuitemradio', { name: '深入思考', exact: true }).click()
  await expect(page.locator('.response-parameters')).toContainText('测试模型 · 标准思考')
  await expect(page.locator('.next-message-hint')).toHaveText('下一条：快速模型 · 深入思考')
  await page.getByRole('button', { name: '停止任务', exact: true }).click()
  await expect(page.getByText('任务已停止', { exact: true })).toBeVisible()
  await send(page, '继续检查'); await expect(page.locator('.dialog-markdown').last()).toContainText('检查完成')
  await expect(page.locator('.response-parameters').last()).toContainText('快速模型 · 深入思考')
  const calls = await page.evaluate(() => (window as any).__E2E__.invocations.filter((c: any) => c.cmd === 'codex_dialog_action'))
  expect(calls.filter((c: any) => c.args.action === 'createThread')).toHaveLength(1)
  const sends = calls.filter((c: any) => c.args.action === 'send')
  expect(sends[0].args.params).toMatchObject({ model: 'fixture-model', effort: 'medium' })
  expect(sends[1].args.params).toMatchObject({ threadId: sends[0].args.params.threadId, model: 'fixture-fast', effort: 'high' })
})

test('streaming and completion preserve reading position until latest is requested', async ({ page }) => {
  await openDialog(page); await send(page, '暂停阅读测试')
  await expect(page.locator('.dialog-markdown')).toBeVisible()
  const emit = async (seq: number, method: string, params: Record<string, unknown>) => page.evaluate(({ seq, method, params }) => {
    const calls = (window as any).__E2E__.invocations
    const threadId = calls.find((c: any) => c.args?.action === 'send').args.params.threadId
    ;(window as any).__E2E__.emitEvent('codex:dialog', { type: 'event', runtimeId: 'dialog-fixture', seq, method, params: { ...params, threadId } })
  }, { seq, method, params })
  const turnId = await page.evaluate(async () => {
    const { dialogAction } = await import('/src/services/api/codexDialog.ts' as string)
    const result = await dialogAction('selectThread', { runtimeId: 'dialog-fixture', threadId: 'dialog-1' }) as any
    return result.turns[0].id
  })
  await emit(100, 'item/agentMessage/delta', { turnId, itemId: 'reply', delta: '\n\n' + '这是一段用于验证长对话阅读位置的内容。\n\n'.repeat(65) })
  const scroll = page.locator('.dialog-conversation')
  await scroll.evaluate(el => el.scrollTop = 0); await expect(page.getByRole('button', { name: '回到最新消息' })).toBeVisible()
  await emit(101, 'item/agentMessage/delta', { turnId, itemId: 'reply', delta: '\n\n后续生成内容。'.repeat(20) })
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0)
  await emit(102, 'turn/completed', { turn: { id: turnId, status: 'completed', items: [] } })
  await expect.poll(() => scroll.evaluate(el => el.scrollTop)).toBe(0)
  await page.getByRole('button', { name: '回到最新消息' }).click()
  await expect.poll(() => scroll.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(2)
})

for (const width of [390, 768, 1440]) {
  test(`Web approvals, history and composer remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    const app = await webApp(page, { settings: { codex_enabled: 'true' } }, '/codex', 'codex')
    await app.login('.codex-dialog')
    await page.getByRole('textbox', { name: '服务器工作目录' }).fill('C:\\Code\\desko')
    await page.getByRole('button', { name: '连接工作目录', exact: true }).click()
    const input = page.getByRole('textbox', { name: '发给 Codex 的消息' })
    await expect(input).toBeInViewport(); await send(page, '测试审批')
    await expect(page.getByRole('button', { name: '允许一次', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: '停止任务', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: '拒绝', exact: true }).click()
    await expect(page.getByRole('region', { name: '待处理的 Codex 请求' })).toHaveCount(0)
    await expect(input).toBeInViewport()
    await page.screenshot({ path: `.taste-skill/codex-chat-implementation/web-${width}.png` })
    await page.getByRole('button', { name: '历史对话', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '搜索历史对话' })).toBeInViewport()
    await page.locator('.dialog-thread').first().click(); await expect(input).toBeInViewport()
    expect(await page.locator('.app-root').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    expect(app.errors).toEqual([])
  })
}
