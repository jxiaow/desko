import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, settingsTab, waitForToastGone } from '../helpers'

const TWO = {
  profiles: {
    activeId: 'default',
    list: [
      { id: 'default', name: '默认' },
      { id: 'p-work', name: '工作', cloudNs: 'work' },
    ],
  },
}

const pane = (dialog: any) => dialog.locator('.profiles-pane')
const row = (dialog: any, name: string) =>
  pane(dialog).locator('.prow').filter({ has: dialog.page().locator('.pname', { hasText: name }) })

test.describe('Settings · 档案', () => {
  test('单档：使用中徽标 + 唯一档不可删 + 无切换钮', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page, 'profiles')
    const p = pane(dialog)
    await expect(p.locator('.prow')).toHaveCount(1)
    await expect(p.locator('.pname', { hasText: '默认' })).toBeVisible()
    await expect(p.locator('.badge')).toHaveText('使用中')
    await expect(p.locator('.pns code')).toHaveText('desko')
    // 只剩一个档案：删除钮禁用，且当前档没有切换钮
    await expect(p.locator('button.action-btn.danger')).toBeDisabled()
    await expect(p.locator('button', { hasText: '切换' })).toHaveCount(0)
  })

  test('新建档案：填名与云命名空间 → 落列表并自动拼 desko-<ns>', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page, 'profiles')
    await pane(dialog).locator('.add-row').click()
    const dlg = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '新建档案' }) })
    await dlg.locator('input[placeholder="如：工作"]').fill('临时')
    await dlg.locator('input[placeholder="留空则自动生成"]').fill('tmp')
    await dlg.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '档案已创建')
    await waitForToastGone(page)
    const r = pane(dialog).locator('.prow').filter({ hasText: '临时' })
    await expect(r).toHaveCount(1)
    await expect(r.locator('.pns code')).toHaveText('desko-tmp')
    expect((await e2e.snapshot(page)).profiles.list.map((p: any) => p.name)).toEqual(['默认', '临时'])
  })

  test('新建校验：空名前端拦、非法命名空间后端拒', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page, 'profiles')
    await pane(dialog).locator('.add-row').click()
    const dlg = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '新建档案' }) })

    await dlg.locator('.dialog-footer button.btn-primary').click()
    await expect(dlg.locator('.dialog-err')).toHaveText('请输入档案名')

    await dlg.locator('input[placeholder="如：工作"]').fill('坏档')
    await dlg.locator('input[placeholder="留空则自动生成"]').fill('Bad NS')
    await dlg.locator('.dialog-footer button.btn-primary').click()
    await expect(dlg.locator('.dialog-err')).toContainText('小写字母')
    await expect(dlg).toBeVisible()
  })

  test('重命名当前档：只改显示名，云目录不动', async ({ page }) => {
    await bootUnlocked(page, TWO)
    const dialog = await openSettings(page, 'profiles')
    await row(dialog, '默认').locator('button.action-btn', { hasText: '重命名' }).click()
    const dlg = page.locator('.dialog').filter({ has: page.locator('h3', { hasText: '重命名档案' }) })
    await expect(dlg.locator('input[placeholder="如：工作"]')).toHaveValue('默认')
    // 重命名不给改云命名空间
    await expect(dlg.locator('input[placeholder="留空则自动生成"]')).toHaveCount(0)
    await dlg.locator('input[placeholder="如：工作"]').fill('我的档')
    await dlg.locator('.dialog-footer button.btn-primary').click()
    await expectToast(page, '已重命名')
    await expect(pane(dialog).locator('.pname', { hasText: '我的档' })).toBeVisible()
  })

  test('删除非当前档：确认后从列表消失', async ({ page }) => {
    await bootUnlocked(page, TWO)
    const dialog = await openSettings(page, 'profiles')
    // 当前档（默认）的删除钮禁用；非当前档（工作）可删
    await expect(row(dialog, '默认').locator('button.action-btn.danger')).toBeDisabled()
    await row(dialog, '工作').locator('button.icon-btn.danger').click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.locator('.dialog-body')).toContainText('工作')
    await confirm.locator('.btn-danger').click()
    await expectToast(page, '档案已删除')
    await expect(pane(dialog).locator('.prow')).toHaveCount(1)
    expect((await e2e.snapshot(page)).profiles.list.map((p: any) => p.id)).toEqual(['default'])
  })

  test('切换档案：确认后下发 profiles_switch 并挂起切换遮罩', async ({ page }) => {
    await bootUnlocked(page, TWO)
    const dialog = await openSettings(page, 'profiles')
    await row(dialog, '工作').locator('button.action-btn.primary', { hasText: '切换' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await confirm.locator('.btn-danger').click()
    expect(await e2e.count(page, 'profiles_switch')).toBe(1)
    expect((await e2e.snapshot(page)).profiles.activeId).toBe('p-work')
    await expect(dialog.locator('.switch-guard')).toBeVisible()
  })
})
