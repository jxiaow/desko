import { test, expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, settingsTab, visiblePane, waitForToastGone, E2E_PASSWORD } from '../helpers'
import { AuthPage } from '../pages/auth-page'

const SEED = {
  settings: { auto_lock_timeout: '10', lock_on_close: 'false' },
}

/** 备份密码弹窗走成功路径 */
async function setBackupPwd(page: Page, pane: Locator) {
  await pane.locator('.setting-item', { hasText: '备份密码' }).locator('button.action-btn').click()
  const pwdDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '设置备份密码' }) })
  await pwdDialog.locator('input[type="password"]').first().fill('backup-pass-1')
  await pwdDialog.locator('input[type="password"]').nth(1).fill('backup-pass-1')
  await pwdDialog.locator('.dialog-footer button.btn-primary').click()
  await expectToast(page, '备份密码已设置')
  await waitForToastGone(page)
}

/** 坚果云配置弹窗走成功路径（备份的一切前提） */
async function connectCloud(page: Page, pane: Locator) {
  await pane.locator('.setting-item', { hasText: '连接' }).locator('button.action-btn', { hasText: '配置' }).click()
  const modal = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '连接坚果云' }) })
  await modal.locator('input[placeholder="坚果云登录邮箱"]').fill('me@example.com')
  await modal.locator('input[type="password"]').fill('app-pass')
  await modal.locator('.dialog-footer button.btn-primary').click()
  await expectToast(page, '已连接坚果云')
  await waitForToastGone(page)
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

  test('设置行组：内嵌凹槽 + 28px 控制轴 + 动作分三级', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page)
    await settingsTab(dialog, 'backup')
    const pane = visiblePane(dialog)

    // 行组吃内嵌凹槽底色（paper 的 --sunken），条目之间只留 1px 细线
    await expect(pane.locator('.group-content').first()).toHaveCSS('background-color', 'rgb(239, 237, 232)')
    // 控制轴一档高：按钮与输入件同 28px，右缘成线
    await expect(pane.locator('.setting-item', { hasText: '数据库路径' }).locator('button.action-btn')).toHaveCSS('height', '28px')
    await expect(pane.locator('.setting-item', { hasText: '云端保留份数' }).locator('.number-input')).toHaveCSS('height', '28px')

    // 路径走等宽体，并且能一键复制
    expect(await pane.locator('.db-path').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Consolas')
    await pane.locator('.setting-item', { hasText: '数据库路径' }).locator('button.action-btn').click()
    await expectToast(page, '路径已复制')
    await waitForToastGone(page)

    // 未连接：指示灯灰、不呼吸；连上后转绿，断开键显形走幽灵红
    const conn = pane.locator('.setting-item', { hasText: '连接' })
    await expect(conn.locator('.live-dot.idle')).toHaveCount(1)
    await connectCloud(page, pane)
    await expect(conn.locator('.live-dot')).not.toHaveClass(/idle/)
    const danger = conn.locator('button.action-btn.danger')
    await expect(danger).toHaveCount(1)
    await expect(danger).toHaveCSS('color', 'rgb(169, 68, 60)')
    await expect(danger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

    // 关键主操作品牌实底，一栏只这一颗
    const backup = pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn.primary')
    await expect(backup).toHaveCSS('background-color', 'rgb(61, 90, 128)')
    await expect(backup).toHaveCSS('color', 'rgb(255, 255, 255)')
  })

  test('终端偏好：通用页可选，改动落盘', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'general')
    const pane = visiblePane(dialog)
    const trigger = pane.locator('.setting-item', { hasText: '在终端中打开' }).locator('button.opt-trigger')
    await expect(trigger).toHaveCount(1)
    await expect(trigger).toHaveText('自动')
    const before = await e2e.count(page, 'set_setting')
    await trigger.click()
    await page.locator('.popover.modal .opt-item', { hasText: '命令提示符' }).click()
    await expectToast(page, '已保存终端偏好')
    await expect.poll(() => e2e.count(page, 'set_setting')).toBeGreaterThan(before)
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

  test('系统锁屏后锁定：默认关，打开即落盘', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'security')
    const item = dialog.locator('.setting-item', { hasText: '系统锁屏后锁定' })
    await expect(item.locator('input[type="checkbox"]')).not.toBeChecked()
    await item.locator('label.switch').click()
    await expectToast(page, '设置已保存')
    expect((await e2e.snapshot(page)).settings.lock_on_system_lock).toBe('true')
  })

  test('导出 SQL 入口已移除，未连云端时整档置灰而不是消失', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await expect(pane).toBeVisible()
    // 旧的 SQL 导出入口没了；现在的「导出」是单文件迁移包
    await expect(dialog.locator('button', { hasText: /SQL/i })).toHaveCount(0)
    await expect(pane.locator('.section-label', { hasText: '数据' })).toBeVisible()
    await expect(pane.locator('.section-label', { hasText: '云端备份' })).toBeVisible()
    await expect(pane.locator('.section-label', { hasText: '迁移' })).toBeVisible()
    // 只有一把闸：既没有第二个"自动同步"开关，也没有单独的"定时备份"行了
    await expect(pane.locator('.setting-item', { hasText: '自动备份到云' })).toHaveCount(0)
    await expect(pane.locator('.setting-item', { hasText: '定时备份' })).toHaveCount(0)
    // WebDAV 没配置时，备份这一档每个控件都摆着看但点不动
    await expect(pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn')).toBeDisabled()
    await expect(pane.locator('.setting-item', { hasText: '自动备份' }).locator('button.opt-trigger')).toBeDisabled()
    await expect(pane.locator('.setting-item', { hasText: '停笔即备' }).locator('input[type="checkbox"]')).toBeDisabled()
    await expect(pane.locator('.setting-item', { hasText: '云端保留份数' }).locator('.number-input')).toBeDisabled()
    await expect(pane.locator('button', { hasText: '云端列表' })).toBeDisabled()
    // 本地包只是中转：不列文件、不让用户配本地保留份数
    await expect(pane.locator('.file-row')).toHaveCount(0)
    await expect(pane.locator('.setting-item', { hasText: '本地保留份数' })).toHaveCount(0)
    await expect(pane.locator('button', { hasText: '打开文件夹' })).toHaveCount(0)
    await expect(pane.locator('.setting-item')).toHaveCount(11)
  })

  test('自动备份：一把闸管到底，未连接置灰、连上后可选、改动落盘', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const trigger = pane.locator('.setting-item', { hasText: '自动备份' }).locator('button.opt-trigger')
    await expect(trigger).toBeDisabled()

    await setBackupPwd(page, pane)
    // 光有备份密码不够，没云端照样灰着
    await expect(trigger).toBeDisabled()
    await connectCloud(page, pane)
    await expect(trigger).toBeEnabled()

    // 默认按 5 分钟显示（Rust 侧默认值，seed 未写）
    await expect(trigger).toHaveText('每 5 分钟')
    await trigger.click()
    await page.locator('.popover.modal .opt-item', { hasText: '每 15 分钟' }).click()
    expect((await e2e.snapshot(page))).toMatchObject({
      settings: { auto_backup_interval: '15' },
    })
    // 选「关闭」写 0，不是空串 —— 这一档关掉就等于自动备份全关
    await trigger.click()
    await page.locator('.popover.modal .opt-item', { hasText: '关闭 · 只留手动' }).click()
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

  test('未连云端时备份按钮点不动；连上之后一轮打完随即上传', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const row = pane.locator('.setting-item', { hasText: '立即备份' })
    await setBackupPwd(page, pane)
    // 密码只是前置，没云端这个动作毫无意义
    await expect(row.locator('button.action-btn')).toBeDisabled()
    await expect(row.locator('.setting-desc')).toContainText('请先配置上方')

    await connectCloud(page, pane)
    await expect(row.locator('button.action-btn')).toBeEnabled()
    await expect(row.locator('.setting-desc')).toHaveText('尚无备份')

    // 行内进度条一闪而过，别去断言它，只看结果
    await row.locator('button.action-btn').click()
    await expectToast(page, '已传云端')
    await expect(row.locator('.setting-desc')).toContainText('最近一轮：')
    await expect(row.locator('.setting-desc')).toContainText('已全部上传')
    const state = await e2e.snapshot(page)
    expect(state.backup.files).toHaveLength(1)
    expect(state.cloud.packages).toHaveLength(1)
  })

  test('标题栏备份徽标：配齐才现身，一轮打完回到静默态', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const badge = page.locator('.backup-badge')
    // 没设备份密码、没连云端：标题栏不带它
    await expect(badge).toHaveCount(0)

    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await setBackupPwd(page, pane)
    await connectCloud(page, pane)
    const row = pane.locator('.setting-item', { hasText: '立即备份' })
    await row.locator('button.action-btn').click()
    await expectToast(page, '已传云端')

    // 上传收尾的进度事件会顺手拉一次状态，徽标不必等 30 秒轮询
    await expect(badge).toBeVisible({ timeout: 10_000 })
    await expect(badge).toHaveAttribute('title', /云端备份已开启 · 最近一轮/)
    await expect(badge.locator('.bb-text')).toHaveCount(0)
  })

  test('传上云的包本地随即清掉，只留兜底几份', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await setBackupPwd(page, pane)
    await connectCloud(page, pane)

    // 连打 5 轮，每轮都传上云：云端 5 份都在，本地只剩最近 3 份兜底
    const row = pane.locator('.setting-item', { hasText: '立即备份' })
    for (let i = 0; i < 5; i++) {
      await row.locator('button.action-btn').click()
      await expectToast(page, '已传云端')
      await waitForToastGone(page)
    }
    const state = await e2e.snapshot(page)
    expect(state.cloud.packages).toHaveLength(5)
    expect(state.backup.files).toHaveLength(3)
    expect(state.backup.files.map((f: { name: string }) => f.name)).toEqual(
      state.cloud.packages.slice(0, 3).map((f: { name: string }) => f.name),
      '留下的必须是最新的三份',
    )
    await expect(row.locator('.setting-desc')).toContainText('已全部上传')

    // 云端列表里 5 份都能恢复，恢复入口只剩这一条 + 「从文件恢复」
    await pane.locator('button.action-btn', { hasText: '云端列表' }).click()
    const listDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '云端备份' }) })
    await expect(listDialog.locator('.file-row')).toHaveCount(5)
    await listDialog.locator('.file-row button.row-btn', { hasText: '恢复' }).first().click()
    const restoreDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '从云端恢复' }) })
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expect(restoreDialog.locator('.modal-error')).toHaveText('请输入备份密码')
    await restoreDialog.locator('input[type="password"]').fill('backup-pass-1')
    await restoreDialog.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '恢复完成')
    expect((await e2e.snapshot(page)).cloud.packages).toHaveLength(5)
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

    // 导出：保存对话框给的路径原样传给 backup_export，且不进本地那几份中转副本
    const dest = 'C:/Users/e2e/Desktop/desko-迁移-20260921-1011.dsbk'
    await e2e.queueDialog(page, dest)
    await exportBtn.click()
    await expectToast(page, '迁移包已导出')
    expect((await invocations()).filter((c: { cmd: string }) => c.cmd === 'backup_export')).toEqual([
      { cmd: 'backup_export', args: { path: dest } },
    ])
    const afterExport = await e2e.snapshot(page)
    expect(afterExport.backup.files).toHaveLength(0)
    expect(afterExport.backup.exports).toEqual([dest])

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
      notes: [{ title: '带图', content_html: '<img src="attachments/kept__b.png">' }],
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
    // 库里存的就是附件目录下的文件名，不带任何本机绝对路径
    expect(state.staged.map((f: { file_path: string }) => f.file_path)).toEqual(['kept__b.png'])
  })

  test('云端连接：配置校验 → 保存 → 打完即传 → 断开重新置灰', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    const connRow = pane.locator('.setting-item', { hasText: '连接' })
    await expect(connRow.locator('.setting-desc')).toContainText('未配置')

    await connRow.locator('button.action-btn', { hasText: '配置' }).click()
    const modal = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '连接坚果云' }) })
    await modal.locator('.dialog-footer button.btn-secondary', { hasText: '测试连接' }).click()
    await expect(modal.locator('.modal-error')).toContainText('账号与应用密码')

    await modal.locator('input[placeholder="坚果云登录邮箱"]').fill('me@example.com')
    await modal.locator('input[type="password"]').fill('app-pass')
    await modal.locator('.dialog-footer button.btn-secondary', { hasText: '测试连接' }).click()
    await expect(modal.locator('.modal-ok')).toHaveText('连接成功')
    await modal.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '已连接坚果云')
    await waitForToastGone(page)
    await expect(connRow.locator('.setting-desc')).toContainText('已连接 · dav.jianguoyun.com/dav（me@example.com）')
    await expect(connRow.locator('.setting-desc')).toContainText('尚未上传')

    await setBackupPwd(page, pane)
    // 云端还没有包时，列表是空态
    await pane.locator('button.action-btn', { hasText: '云端列表' }).click()
    const listDialog = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '云端备份' }) })
    await expect(listDialog.locator('.empty-line')).toContainText('云端还没有备份')
    await listDialog.locator('.dialog-header button.dialog-close').click()

    // 一轮打完即传，连接行跟着报上次上传的时刻
    await pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn').click()
    await expectToast(page, '已传云端')
    await expect(connRow.locator('.setting-desc')).toContainText('上次上传')
    expect((await e2e.snapshot(page)).cloud.packages).toHaveLength(1)

    // 断开 = 这一档整体收起，只留密码和连接
    await connRow.locator('button.action-btn', { hasText: '断开' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await confirm.locator('.btn-danger').click()
    await expectToast(page, '已断开')
    await expect(pane.locator('.setting-item', { hasText: '立即备份' }).locator('button.action-btn')).toBeDisabled()
    // 断开 = 同步记录一起清掉（重连时全量重传），本地那一份没人家的份数规则可管，原样留着
    const off = await e2e.snapshot(page)
    expect(off.cloud.packages).toHaveLength(0)
    expect(off.backup.files).toHaveLength(1)
  })

  test('已连接后重开配置弹窗：应用密码留空点测试走已存密码，不误报', async ({ page }) => {
    await bootUnlocked(page, SEED)
    const dialog = await openSettings(page, 'backup')
    const pane = dialog.locator('.backup-pane')
    await connectCloud(page, pane)
    // 密码不回显：重开必是空框，此时「测试连接」应复用库里已存的
    await pane.locator('.setting-item', { hasText: '连接' }).locator('button.action-btn', { hasText: '配置' }).click()
    const modal = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '连接坚果云' }) })
    await expect(modal.locator('input[type="password"]')).toHaveValue('')
    await modal.locator('.dialog-footer button.btn-secondary', { hasText: '测试连接' }).click()
    await expect(modal.locator('.modal-ok')).toHaveText('连接成功')
    await expect(modal.locator('.modal-error')).toHaveCount(0)
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
