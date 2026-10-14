import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e, expectToast } from '../helpers'

test('强制刷新令牌需要确认，取消不刷新，确认只刷新一次', async ({ page }) => {
  await bootUnlocked(page, {
    settings: { codex_enabled: 'true' },
    codex: { accounts: [{ email: 'main@e2e.dev' }] },
  }, '/codex')
  const openRefresh = async () => {
    await page.locator('.acc-more').click()
    await page.getByRole('button', { name: '强制刷新令牌', exact: true }).click()
  }
  await openRefresh()
  const confirm = page.locator('.confirm-dialog')
  await expect(confirm).toContainText('main@e2e.dev')
  expect(await e2e.count(page, 'force_refresh_codex_tokens')).toBe(0)
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  expect(await e2e.count(page, 'force_refresh_codex_tokens')).toBe(0)
  await openRefresh()
  await confirm.getByRole('button', { name: '确定', exact: true }).click()
  await expectToast(page, '令牌已刷新')
  expect(await e2e.count(page, 'force_refresh_codex_tokens')).toBe(1)
})

test('API Key 账号没有不适用的刷新登录令牌入口', async ({ page }) => {
  await bootUnlocked(page, {
    settings: { codex_enabled: 'true' },
    codex: { accounts: [{ email: 'key@e2e.dev', auth_mode: 'apikey' }] },
  }, '/codex')
  await page.locator('.acc-more').click()
  await expect(page.getByRole('button', { name: '强制刷新令牌', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新账号信息', exact: true })).toBeVisible()
})
