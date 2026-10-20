import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const [width, height] of [[800, 600], [1280, 800]]) {
  test(`${width}px 账号导入切换页签时弹窗和导航保持原位，长表单只在正文滚动`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
    await page.getByRole('button', { name: '添加账号', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加 Codex 账号', exact: true })
    const initial = (await dialog.boundingBox())!
    const tabs = (await dialog.getByRole('tablist').boundingBox())!
    for (const name of ['导入', 'API Key', '设备码', '浏览器登录', '导入']) {
      await dialog.getByRole('tab', { name, exact: true }).click()
      const box = (await dialog.boundingBox())!
      expect(Math.abs(box.y - initial.y), `${name} 不改变弹窗位置`).toBeLessThanOrEqual(.5)
      expect(Math.abs(box.height - initial.height), `${name} 不改变弹窗高度`).toBeLessThanOrEqual(.5)
      expect((await dialog.getByRole('tablist').boundingBox())!.y).toBe(tabs.y)
    }
    await dialog.locator('.token-import summary').click()
    await dialog.getByRole('button', { name: 'Token 组合', exact: true }).click()
    await dialog.getByLabel('Refresh Token（可选）', { exact: true }).fill('test-refresh-token')
    await expect(dialog.getByRole('tab', { name: 'API Key', exact: true })).toBeInViewport()
    expect((await dialog.boundingBox())!.y).toBe(initial.y)
    await dialog.getByRole('tab', { name: 'API Key', exact: true }).click()
    await expect(dialog.locator('#cx-key')).toBeVisible()
    await dialog.getByRole('tab', { name: '导入', exact: true }).click()
    await expect(dialog.getByLabel('Refresh Token（可选）', { exact: true })).toHaveValue('test-refresh-token')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
}
