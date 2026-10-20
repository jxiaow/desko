import { test, expect } from '@playwright/test'
import { bootUnlocked } from '../helpers'

for (const [width, height] of [[800, 600], [1280, 800]]) {
  test(`${width}px 登录与导入各自定高，切换方式不跳动，提交始终在底栏`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
    await page.getByRole('button', { name: '添加账号', exact: true }).click()
    const auth = page.getByRole('dialog', { name: '添加 Codex 账号', exact: true })
    const initial = (await auth.boundingBox())!
    expect(initial.height).toBe(480)
    for (const name of ['API Key', '设备码', '浏览器登录']) {
      await auth.getByRole('tab', { name, exact: true }).click()
      expect((await auth.boundingBox())!.y).toBe(initial.y)
      expect((await auth.boundingBox())!.height).toBe(initial.height)
      await expect(auth.locator('.dialog-footer button').first()).toHaveText('取消')
    }
    await page.screenshot({ path: `.tmp/audit-20261020/fixed/auth-initial-${width}.png`, animations: 'disabled' })
    await auth.getByRole('button', { name: '导入已有凭据', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 Codex 账号', exact: true })
    const box = (await dialog.boundingBox())!
    for (const name of ['auth.json 文件', '粘贴 JSON', 'Token', '本机凭据', 'Token']) {
      await dialog.getByRole('tab', { name, exact: true }).click()
      expect((await dialog.boundingBox())!.y).toBe(box.y)
      expect((await dialog.boundingBox())!.height).toBe(480)
    }
    await dialog.getByRole('button', { name: 'Token 组合', exact: true }).click()
    await dialog.getByLabel('Refresh Token（可选）', { exact: true }).fill('synthetic-refresh')
    await expect(dialog.getByRole('button', { name: '导入 Token', exact: true })).toBeInViewport()
    const footer = (await dialog.locator('.dialog-footer').boundingBox())!
    const button = (await dialog.getByRole('button', { name: '导入 Token', exact: true }).boundingBox())!
    expect(button.y).toBeGreaterThanOrEqual(footer.y)
    await page.screenshot({ path: `.tmp/audit-20261020/fixed/import-token-${width}.png`, animations: 'disabled' })
    await dialog.getByRole('tab', { name: '粘贴 JSON', exact: true }).click()
    await dialog.getByRole('tab', { name: 'Token', exact: true }).click()
    await expect(dialog.getByLabel('Refresh Token（可选）', { exact: true })).toHaveValue('synthetic-refresh')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(auth).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(auth).toHaveCount(0)
  })
}
