import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, waitForToastGone, E2E_PASSWORD } from '../helpers'
import { AuthPage } from '../pages/auth-page'

const SEED = {
  settings: { auto_lock_timeout: '10', lock_on_close: 'false' },
}

async function openSettings(page: import('@playwright/test').Page) {
  await page.locator('button[title="设置"]').click()
  const dialog = page.locator('.settings-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Settings 设置', () => {
  test('打开设置：加载数据库路径与已有配置', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await expect(dialog.locator('h2')).toHaveText('设置')
    // getDbPath 的 mock 值渲染在「数据库路径」描述里
    await expect(dialog.locator('.setting-item', { hasText: '数据库路径' }).locator('.setting-desc')).toContainText('desko.db')
    await expect(dialog.locator('.number-input')).toHaveValue('10')
    await expect(dialog.locator('.settings-about .about-name')).toHaveText('案头 Desko')
    expect(await e2e.count(page, 'get_db_path')).toBe(1)
    expect(await e2e.count(page, 'get_setting')).toBeGreaterThanOrEqual(2)
  })

  test('修改自动锁定时间', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await dialog.locator('.number-input').fill('15')
    await dialog.locator('h2').click() // 触发 change
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.auto_lock_timeout).toBe('15')
  })

  test('切换关闭窗口时锁定', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await dialog.locator('label.switch').click()
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.lock_on_close).toBe('true')
  })

  test('导出 SQL', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await dialog.locator('button.action-btn', { hasText: '导出' }).click()
    await expect.poll(() => e2e.count(page, 'export_sql')).toBe(1)
    await expectToast(page, '导出成功')
  })

  test('导入 SQL：确认后覆盖数据并刷新条目', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)

    const chooserPromise = page.waitForEvent('filechooser')
    await dialog.locator('button.action-btn', { hasText: '导入' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: 'backup.sql',
      mimeType: 'application/sql',
      buffer: Buffer.from('-- e2e import\nSELECT 1;'),
    })

    const confirm = page.locator('.confirm-dialog')
    await expect(confirm.locator('.dialog-body p')).toHaveText('导入将覆盖现有数据，确定继续吗？')
    await confirm.locator('button.btn-danger').click()
    await expect.poll(() => e2e.count(page, 'import_sql')).toBe(1)
    await expectToast(page, '导入成功')
    // entriesRefreshed -> App 重新拉取条目
    await expect.poll(() => e2e.count(page, 'list_entries_with_paths')).toBeGreaterThanOrEqual(2)
  })

  test('修改主密码：校验与成功路径，新口令生效', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await dialog.locator('.setting-item.clickable').click()

    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '修改主密码' }) })
    await expect(pwdDialog.locator('h3')).toHaveText('修改主密码')

    // 空当前密码
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(pwdDialog.locator('.auth-error')).toHaveText('请输入当前密码')

    // 新密码过短
    await pwdDialog.locator('input[placeholder="请输入当前密码"]').fill(E2E_PASSWORD)
    await pwdDialog.locator('input[placeholder="至少 6 位"]').fill('12345')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(pwdDialog.locator('.auth-error')).toHaveText('新密码至少需要 6 位')

    // 两次不一致
    await pwdDialog.locator('input[placeholder="至少 6 位"]').fill('brandnew1')
    await pwdDialog.locator('input[placeholder="再次输入新密码"]').fill('brandnew2')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(pwdDialog.locator('.auth-error')).toHaveText('两次输入的新密码不一致')

    // 成功
    await pwdDialog.locator('input[placeholder="再次输入新密码"]').fill('brandnew1')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '密码修改成功')
    expect((await e2e.snapshot(page)).masterPassword).toBe('brandnew1')

    // 修改成功后 SettingsDialog 仍在层叠顶部，先关闭它才能点标题栏锁定
    await page.locator('.settings-dialog button[title="关闭"]').click()
    await expect(page.locator('.settings-dialog')).toBeHidden()
    await page.locator('button[title="锁定"]').click()
    const auth = new AuthPage(page)
    await auth.unlock(E2E_PASSWORD)
    await expect(auth.unlockError).toHaveText('主密码错误，请重试')
    await auth.unlock('brandnew1')
    await auth.expectUnlocked()
  })
})
