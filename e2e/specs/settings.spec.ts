import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, settingsTab, visiblePane, E2E_PASSWORD } from '../helpers'
import { AuthPage } from '../pages/auth-page'

const SEED = {
  settings: { auto_lock_timeout: '10', lock_on_close: 'false' },
}

test.describe('Settings 设置', () => {
  test('打开设置：加载数据库路径与已有配置', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await expect(dialog.locator('h2')).toHaveText('设置')
    // 数据存储已并入「数据与备份」页
    await expect(dialog.locator('.nav-tab', { hasText: '数据存储' })).toHaveCount(0)
    await settingsTab(dialog, 'backup')
    await expect(dialog.locator('.setting-item', { hasText: '数据库路径' }).locator('.setting-desc')).toContainText('desko.db')
    await settingsTab(dialog, 'security')
    await expect(visiblePane(dialog).locator('.number-input')).toHaveValue('10')
    await settingsTab(dialog, 'about')
    await expect(dialog.locator('.settings-about .about-name')).toHaveText('案头 Desko')
    expect(await e2e.count(page, 'get_db_path')).toBe(1)
    expect(await e2e.count(page, 'get_setting')).toBeGreaterThanOrEqual(2)
  })

  test('点遮罩不关窗，Esc 只关最上面那层', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    // 打在遮罩左上角，落在弹窗之外
    await page.locator('.dialog-overlay').click({ position: { x: 4, y: 4 } })
    await expect(dialog).toBeVisible()

    await visiblePane(dialog).locator('.setting-item.clickable').click()
    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '修改主密码' }) })
    await expect(pwdDialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(pwdDialog).toBeHidden()
    await expect(dialog).toBeVisible() // 设置弹窗不该被同一次按键带走

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('弹窗内的 hover 提示压在遮罩之上', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await dialog.locator('.close-btn').hover()
    await expect(page.locator('.app-tip')).toHaveText('关闭')
    // 气泡是挂在 body 上的单例，层级一旦低于弹窗遮罩，在弹窗里就永远看不见
    const [tipZ, overlayZ] = await page.evaluate(() => {
      const z = (sel: string) => Number(getComputedStyle(document.querySelector(sel)!).zIndex)
      return [z('.app-tip'), z('.dialog-overlay')]
    })
    expect(tipZ).toBeGreaterThan(overlayZ)
  })

  test('自动锁定：开关关掉后分钟数不再落盘为正数', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    const control = dialog.locator('.setting-item', { hasText: '自动锁定' }).locator('.setting-control')

    await control.locator('label.switch').click()
    await expectToast(page, '已关闭自动锁定')
    expect((await e2e.snapshot(page)).settings.auto_lock_timeout).toBe('0')
    // 关掉之后数字只作展示，重新打开还是刚才的 10 分钟
    await expect(control.locator('.number-input')).toBeDisabled()
    await expect(control.locator('.number-input')).toHaveValue('10')

    await control.locator('label.switch').click()
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.auto_lock_timeout).toBe('10')
  })

  test('修改自动锁定时间', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    await visiblePane(dialog).locator('.number-input').fill('15')
    await dialog.locator('h2').click() // 触发 change
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.auto_lock_timeout).toBe('15')
  })

  test('切换关闭窗口时锁定', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    await dialog.locator('.setting-item', { hasText: '关闭窗口时锁定' }).locator('label.switch').click()
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.lock_on_close).toBe('true')
  })

  test('导出 SQL 入口已移除，数据与备份页取代', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await expect(pane).toBeVisible()
    // 旧的 SQL 导出入口没了；现在的「导出」是单文件迁移包
    await expect(dialog.locator('button', { hasText: /SQL/i })).toHaveCount(0)
    await expect(pane.locator('.section-label', { hasText: '数据' })).toBeVisible()
    await expect(pane.locator('.section-label', { hasText: '本地备份' })).toBeVisible()
    await expect(pane.locator('.section-label', { hasText: '迁移' })).toBeVisible()
    await expect(pane.locator('.section-label', { hasText: '云端同步' })).toBeVisible()
    // 备份文件段带目录路径 + 打开文件夹动作
    await expect(pane.locator('.label-path')).toContainText('backups')
    await expect(pane.locator('.section-head button.row-btn', { hasText: '打开文件夹' })).toBeVisible()
  })

  test('定时备份与停笔即备：设置改动落盘', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const select = pane.locator('.setting-item', { hasText: '定时备份' }).locator('select.select-input')
    // 与立即备份同一道闸：没设备份密码时调度无从谈起
    await expect(select).toBeDisabled()

    await pane.locator('.setting-item', { hasText: '备份密码' }).locator('button.action-btn').click()
    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '设置备份密码' }) })
    await pwdDialog.locator('input[type="password"]').first().fill('backup-pass-1')
    await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-1')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '备份密码已设置')

    // 默认按 5 分钟显示（Rust 侧默认值，seed 未写）
    await expect(select).toHaveValue('5')
    await select.selectOption('15')
    expect((await e2e.snapshot(page))).toMatchObject({
      settings: { auto_backup_interval: '15' },
    })
    // 选「关闭」写 0，不是空串
    await select.selectOption('0')
    expect((await e2e.snapshot(page))).toMatchObject({
      settings: { auto_backup_interval: '0' },
    })

    const realtime = pane.locator('.setting-item', { hasText: '停笔即备' }).locator('input[type="checkbox"]')
    await expect(realtime).not.toBeChecked()
    // 复选框本身是隐藏的，点的是 label.switch 那层壳
    await pane.locator('.setting-item', { hasText: '停笔即备' }).locator('label.switch').click()
    await expect(realtime).toBeChecked()
    expect((await e2e.snapshot(page))).toMatchObject({
      settings: { auto_backup_realtime: 'true' },
    })
  })

  test('备份密码弹窗：短密码被拦，成功后状态行更新', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await pane.locator('.setting-item', { hasText: '备份密码' }).locator('button.action-btn').click()

    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '设置备份密码' }) })
    await expect(pwdDialog).toBeVisible()
    await pwdDialog.locator('input[type="password"]').first().fill('123')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(pwdDialog.locator('.modal-error')).toContainText('至少 8 位')

    await pwdDialog.locator('input[type="password"]').first().fill('backup-pass-1')
    await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-2')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(pwdDialog.locator('.modal-error')).toContainText('不一致')

    await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-1')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '备份密码已设置')
    await expect(pane.locator('.setting-item', { hasText: '备份密码' }).locator('.setting-desc')).toContainText('已设置')
    // Esc 关掉密码弹窗后，设置弹窗仍在
    await expect(dialog).toBeVisible()
  })

  test('备份 → 列表出现 → 恢复要输备份密码', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')

    // 未设密码时备份按钮直接禁用，不会点了静默失败
    await expect(pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn')).toBeDisabled()

    // 设密码
    await pane.locator('.setting-item', { hasText: '备份密码' }).locator('button.action-btn').click()
    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '设置备份密码' }) })
    await pwdDialog.locator('input[type="password"]').first().fill('backup-pass-1')
    await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-1')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '备份密码已设置')

    // 备份：进度走行内条，完成后列表出现一行
    await pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn').click()
    await expect(pane.locator('.row-progress')).toBeVisible()
    await expect(pane.locator('.file-row')).toHaveCount(1, { timeout: 10_000 })
    await expectToast(page, '备份完成')

    // 恢复：先弹密码框，空密码被拦
    await pane.locator('.file-row button.row-btn', { hasText: '恢复' }).click()
    const restoreDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '恢复备份' }) })
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(restoreDialog.locator('.modal-error')).toHaveText('请输入备份密码')
    await restoreDialog.locator('input[type="password"]').fill('backup-pass-1')
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '恢复完成')
    expect((await e2e.snapshot(page)).backup.files).toHaveLength(1)
  })

  test('迁移：导出单文件包 → 从任意路径的文件恢复', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const invocations = () =>
      page.evaluate(() => (window as any).__E2E__.invocations.map((c: { cmd: string; args: unknown }) => c))

    // 和立即备份同一道闸：没备份密码不给导出
    const exportBtn = pane.locator('.setting-item', { hasText: '导出迁移包' }).locator('button.action-btn')
    await expect(exportBtn).toBeDisabled()

    await pane.locator('.setting-item', { hasText: '备份密码' }).locator('button.action-btn').click()
    const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '设置备份密码' }) })
    await pwdDialog.locator('input[type="password"]').first().fill('backup-pass-1')
    await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-1')
    await pwdDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '备份密码已设置')

    // 导出：保存对话框给的路径原样传给 backup_export，且不进本地备份列表
    const dest = 'C:/Users/e2e/Desktop/desko-迁移-20260921-1011.dsbk'
    await e2e.queueDialog(page, dest)
    await exportBtn.click()
    await expectToast(page, '迁移包已导出')
    expect((await invocations()).filter((c: { cmd: string }) => c.cmd === 'backup_export')).toEqual([
      { cmd: 'backup_export', args: { path: dest } },
    ])
    await expect(pane.locator('.file-row')).toHaveCount(0)

    // 取消保存对话框：不该发起导出，也不该报错
    await e2e.queueDialog(page, null)
    await exportBtn.click()
    expect((await invocations()).filter((c: { cmd: string }) => c.cmd === 'backup_export')).toHaveLength(1)

    // 从文件恢复：选完文件走同一个密码弹窗，标题换成「从文件恢复」
    await e2e.queueDialog(page, dest)
    await pane.locator('.setting-item', { hasText: '从文件恢复' }).locator('button.action-btn').click()
    const restoreDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '从文件恢复' }) })
    await expect(restoreDialog.locator('.modal-help b')).toHaveText(dest)
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(restoreDialog.locator('.modal-error')).toHaveText('请输入备份密码')
    await restoreDialog.locator('input[type="password"]').fill('backup-pass-1')
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '恢复完成')
    expect((await invocations()).some((c: { cmd: string }) => c.cmd === 'backup_restore_file')).toBe(true)
  })

  test('未引用附件：扫出来能清掉，正文引用的不动', async ({ page }) => {
    await bootUnlocked(page, {
      ...SEED,
      staged: ['junk__a.png', 'kept__b.png'],
      notes: [{ title: '带图', content_html: '<img src="asset://localhost/kept__b.png">' }],
    })
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const row = pane.locator('.setting-item', { hasText: '未引用附件' })

    // kept__b.png 被正文引用，只有 junk 算垃圾
    await expect(row.locator('.setting-desc')).toHaveText('1 个文件 · 2 KB 不被任何小记引用')
    const btn = row.locator('button.action-btn')
    await expect(btn).toBeEnabled()

    await btn.click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.locator('.dialog-body')).toContainText('junk__a.png')
    await confirm.locator('.btn-danger').click()

    await expectToast(page, '已清理 1 个未引用附件')
    await expect(row.locator('.setting-desc')).toHaveText('没有未被引用的附件')
    await expect(btn).toBeDisabled()
    const state = await e2e.snapshot(page)
    expect(state.staged.map((f: { file_path: string }) => f.file_path))
      .toEqual(['C:/e2e/attachments/kept__b.png'])
  })

  test('云同步：配置校验 → 保存 → 同步进度 → 状态汇总', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await expect(pane.locator('button.action-btn', { hasText: '云端列表' })).toBeDisabled()

    await pane.locator('.setting-item', { hasText: '连接' }).locator('button.action-btn', { hasText: '配置' }).click()
    const modal = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '连接坚果云' }) })
    await modal.locator('.dialog-footer button.btn-secondary', { hasText: '测试连接' }).click()
    await expect(modal.locator('.modal-error')).toContainText('账号与应用密码')

    await modal.locator('input[placeholder="坚果云登录邮箱"]').fill('me@example.com')
    await modal.locator('input[type="password"]').fill('app-pass')
    await modal.locator('.dialog-footer button.btn-secondary', { hasText: '测试连接' }).click()
    await expect(modal.locator('.modal-ok')).toHaveText('连接成功')
    await modal.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '已连接坚果云')
    await expect(pane.locator('.setting-desc', { hasText: '已连接' })).toBeVisible()

    await pane.locator('button.action-btn', { hasText: '同步' }).click()
    await expect(pane.locator('.row-progress')).toBeVisible()
    await expectToast(page, '同步完成')
    await expect(pane.locator('.setting-desc', { hasText: '已传 2 附件' })).toBeVisible()

    // 本地还没有备份包时，云端列表是空态
    await pane.locator('button.action-btn', { hasText: '云端列表' }).click()
    const listDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '云端备份' }) })
    await expect(listDialog.locator('.empty-line')).toContainText('云端还没有备份')
    await listDialog.locator('.dialog-header button.dialog-close').click()
  })

  test('修改主密码：校验与成功路径，新口令生效', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    await visiblePane(dialog).locator('.setting-item.clickable').click()

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
