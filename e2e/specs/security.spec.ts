import { test, expect } from '@playwright/test'
import { bootUnlocked, startApp, e2e, openSettings, tipButton } from '../helpers'

test('口令保护升级未完成时提示旧格式解锁但不阻断操作', async ({ page }) => {
  await bootUnlocked(page, {}, '/notes')
  await e2e.emitEvent(page, 'auth-kdf-upgrade-warning', {})
  await expect(page.locator('.toast')).toContainText('口令保护升级未完成，已按原格式解锁')
  await expect(page.locator('.notes-page')).toBeVisible()
})

test('锁定会关闭加密小记的正文预览，重新解锁也不恢复旧确认框', async ({ page }) => {
  const auth = await bootUnlocked(page, {
    notes: [{ title: '私密', content_html: '<p>这段正文应随锁定收回</p>', encrypted: true }],
    notePassphrase: 'note-pass-123', noteOpen: true,
  }, '/notes')
  const memo = page.locator('.memo').first()
  await expect(memo).toContainText('这段正文应随锁定收回')
  await memo.hover()
  await tipButton(memo, '更多操作').click()
  await page.locator('.popover .pop-item:text-is("删除")').click()
  await expect(page.locator('.confirm-dialog')).toContainText('这段正文应随锁定收回')
  await e2e.emitEvent(page, 'tray-lock')
  await auth.expectUnlockPage()
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('这段正文应随锁定收回')
  await auth.unlock('e2e-master-123')
  await auth.expectUnlocked()
  await expect(page.locator('.confirm-dialog')).toHaveCount(0)
})

test('锁定会关闭设置弹窗，重新解锁也不会恢复旧弹窗', async ({ page }) => {
  const auth = await bootUnlocked(page)
  await openSettings(page, 'modules')
  await e2e.emitEvent(page, 'tray-lock')
  await auth.expectUnlockPage()
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
  await auth.unlock('e2e-master-123')
  await auth.expectUnlocked()
  await expect(page.locator('.settings-dialog')).toHaveCount(0)
})

test('Codex 开关已开启时，锁屏仍拒绝直接 IPC 读取账号', async ({ page }) => {
  await startApp(page, { config: { settings: { codex_enabled: 'true' } } })
  await expect(page.locator('.unlock-page')).toBeVisible()
  const error = await page.evaluate(async () => {
    const path = '/src/services/api/codex.ts'
    const { codexApi } = await import(path)
    try { await codexApi.list(); return '' } catch (e) { return String(e) }
  })
  expect(error).toBe('应用已锁定')
})

const tasks = '<p>清单</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>待办</p></div></li></ul>'

test('快速勾选两条小记，两条任务状态都会保存', async ({ page }) => {
  await bootUnlocked(page, { notes: [{ title: '甲', content_html: tasks }, { title: '乙', content_html: tasks }] }, '/notes')
  await expect(page.locator('.memo input[type="checkbox"]')).toHaveCount(2)
  await page.evaluate(() => {
    document.querySelectorAll('.memo input[type="checkbox"]').forEach(el => (el as HTMLInputElement).click())
  })
  await expect.poll(() => e2e.count(page, 'update_note')).toBe(2)
  const snapshot = await e2e.snapshot(page)
  expect(snapshot.notes.filter((n: { content_html: string }) => n.content_html.includes('data-checked="true"'))).toHaveLength(2)
})

test('编辑加密小记后立即锁定，待保存内容先写入再收回密钥', async ({ page }) => {
  const auth = await bootUnlocked(page, {
    notes: [{ title: '清单', content_html: tasks, encrypted: true }],
    notePassphrase: 'note-pass-123', noteOpen: true,
  }, '/notes')
  await expect(page.locator('.memo input[type="checkbox"]')).toHaveCount(1)
  await page.evaluate(() => {
    ;(document.querySelector('.memo input[type="checkbox"]') as HTMLInputElement).click()
    ;(window as any).__E2E__.emitEvent('tray-lock')
  })
  await auth.expectUnlockPage()
  const snapshot = await e2e.snapshot(page)
  expect(snapshot.notes[0].cipher).toContain('data-checked="true"')
  expect(snapshot.unlocked).toBe(false)
  await expect(page.locator('.memo')).toHaveCount(0)
})
