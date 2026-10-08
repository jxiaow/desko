import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, tipButton, visiblePane } from '../helpers'

const SEED = {
  // 验证码模块默认关，进页面 specs 得先把它打开
  settings: { mfa_enabled: 'true' },
  mfaTokens: [
    { issuer: 'GitHub', label: 'alice@example.com', secret: 'JBSWY3DPEHPK3PXP' },
    { issuer: 'Google', label: 'bob', digits: 8 },
  ],
}

function card(page: Page, issuer: string) {
  return page.locator('.mfa-card').filter({ has: page.locator(`.card-issuer:text-is("${issuer}")`) })
}

async function gotoMfa(page: Page, seed = SEED) {
  await bootUnlocked(page, seed)
  await page.locator('a.nav-item[href="/mfa"]').click()
  await expect(page.locator('.mfa-card')).toHaveCount(2)
}

test.describe('MFA 验证码', () => {
  test('开关默认关：没有侧栏入口，直达 /mfa 被带回条目页', async ({ page }) => {
    await bootUnlocked(page, {}, '/mfa')
    await expect(page).toHaveURL(/\/entries$/)
    await expect(page.locator('a.nav-item[href="/mfa"]')).toHaveCount(0)
    expect(await e2e.count(page, 'mfa_codes')).toBe(0)
  })

  test('设置里打开开关后侧栏立刻出现入口', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/mfa"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'general')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '验证码模块' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '设置已保存')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/mfa"]')).toHaveCount(1)
  })

  test('导航进入后渲染 seed 令牌，码按位分组', async ({ page }) => {
    await gotoMfa(page)
    // seed 时间倒序：Google（8 位）在前
    await expect(card(page, 'Google').locator('.card-code')).toHaveText('1234 5678')
    await expect(card(page, 'GitHub').locator('.card-code')).toHaveText('123 456')
    await expect(card(page, 'GitHub').locator('.card-label')).toHaveText('alice@example.com')
    await expect(card(page, 'GitHub').locator('.timer-text')).toHaveText(/\d+s/)
    expect(await e2e.count(page, 'mfa_codes')).toBeGreaterThanOrEqual(1)
  })

  test('点击卡片复制验证码', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (t: string) => {
            ;(window as any).__COPIED__ = t
            return Promise.resolve()
          },
        },
      })
    })
    await gotoMfa(page)
    await card(page, 'GitHub').click()
    await expect.poll(() => page.evaluate(() => (window as any).__COPIED__)).toBe('123456')
    await expectToast(page, '验证码已复制')
  })

  test('otpauth 链接添加成功后列表刷新', async ({ page }) => {
    await gotoMfa(page)
    await page.locator('.page-bar .btn-primary').click()
    await page.locator('.uri-box').fill(
      'otpauth://totp/Notion%3Acarol?secret=JBSWY3DPEHPK3PXP&issuer=Notion',
    )
    await page.locator('.dialog-footer .btn-primary').click()
    await expectToast(page, '已添加')
    await expect(page.locator('.mfa-card')).toHaveCount(3)
    const calls = await page.evaluate(() =>
      (window as any).__E2E__.invocations
        .filter((i: any) => i.cmd === 'mfa_add_uri')
        .map((i: any) => i.args.uri),
    )
    expect(calls).toHaveLength(1)
    expect(String(calls[0])).toContain('otpauth://totp/')
  })

  test('手输非法密钥：报后端文案且弹窗不关', async ({ page }) => {
    await gotoMfa(page)
    await page.locator('.page-bar .btn-primary').click()
    await page.locator('.add-tab', { hasText: '手动密钥' }).click()
    await page.locator('.form-group input[placeholder="如 alice@example.com"]').fill('dave')
    await page.locator('.form-group input[placeholder*="JBSWY3DPEHPK3PXP"]').fill('0000!!')
    await page.locator('.dialog-footer .btn-primary').click()
    await expectToast(page, '密钥不是有效的 Base32 字符串')
    await expect(page.locator('.dialog .add-tabs')).toBeVisible()
    expect(await e2e.count(page, 'mfa_codes')).toBeGreaterThanOrEqual(1)
  })

  test('删除走确认弹窗，确认后调 mfa_remove', async ({ page }) => {
    await gotoMfa(page)
    const gh = card(page, 'GitHub')
    const id = await page.evaluate(() =>
      (window as any).__E2E__.snapshot().mfa.find((t: any) => t.issuer === 'GitHub').id,
    )
    await gh.hover()
    await tipButton(gh, '删除').click()
    await expect(page.locator('.confirm-dialog')).toBeVisible()
    await page.locator('.confirm-dialog .btn-danger').click()
    await expect(page.locator('.mfa-card')).toHaveCount(1)
    const removed = await page.evaluate(() =>
      (window as any).__E2E__.invocations
        .filter((i: any) => i.cmd === 'mfa_remove')
        .map((i: any) => i.args.id),
    )
    expect(removed).toEqual([id])
  })

  test('识别图片按钮走文件选择并调 mfa_read_image', async ({ page }) => {
    await gotoMfa(page)
    await page.locator('.page-bar .btn-primary').click()
    await e2e.queueDialog(page, 'C:/e2e/qr.png')
    await page.locator('button', { hasText: '识别图片' }).click()
    await expect
      .poll(() => e2e.count(page, 'mfa_read_image'))
      .toBe(1)
    const args = await page.evaluate(() =>
      (window as any).__E2E__.invocations
        .filter((i: any) => i.cmd === 'mfa_read_image')
        .map((i: any) => i.args.path),
    )
    expect(args).toEqual(['C:/e2e/qr.png'])
  })
})
