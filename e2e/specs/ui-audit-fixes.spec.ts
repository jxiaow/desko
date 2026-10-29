import { test, expect, type Locator } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, tipButton } from '../helpers'

async function palette(button: Locator, background: string, foreground: string) {
  return button.evaluate((element, tokens) => {
    const probe = document.createElement('span')
    probe.style.background = `var(${tokens[0]})`
    probe.style.color = `var(${tokens[1]})`
    element.appendChild(probe)
    const actual = getComputedStyle(element)
    const expected = getComputedStyle(probe)
    const colors = { background: actual.backgroundColor, color: actual.color, expectedBackground: expected.backgroundColor, expectedColor: expected.color }
    probe.remove()
    return colors
  }, [background, foreground])
}

async function expectPalette(button: Locator, background: string, foreground: string) {
  await expect.poll(async () => {
    const colors = await palette(button, background, foreground)
    return colors.background === colors.expectedBackground && colors.color === colors.expectedColor
  }).toBe(true)
}

for (const theme of ['paper', 'ink']) {
  test(`${theme} 主题：禁用主按钮悬停和按下不变色，弹窗主按钮使用淡染档`, async ({ page }) => {
    await bootUnlocked(page, { settings: { theme, accent: 'celadon', tunnel_enabled: 'true', codex_enabled: 'true' } }, '/tunnel')
    const disabled = page.locator('.toggle-btn.btn-primary')
    await expect(disabled).toBeDisabled()
    for (const state of ['default', 'hover', 'pressed']) {
      if (state !== 'default') await disabled.hover()
      if (state === 'pressed') await page.mouse.down()
      await expectPalette(disabled, '--fill', '--text-secondary')
      await expect(disabled).toHaveCSS('box-shadow', 'none')
    }
    await page.mouse.up()
    await page.screenshot({ path: `.tmp/audit-20261020/fixed/${theme}-disabled-tunnel.png`, animations: 'disabled' })
    await page.locator('a.nav-item[href="/codex"]').click()
    const add = page.getByRole('button', { name: '添加账号', exact: true })
    await page.mouse.move(0, 0)
    await expectPalette(add, '--bg-workspace-primary', '--text-workspace-primary')
    await add.click()
    const dialog = page.getByRole('dialog', { name: '添加 Codex 账号', exact: true })
    await page.mouse.move(0, 0)
    const primary = dialog.locator('.btn-primary')
    await expectPalette(primary, '--accent-soft', '--text-brand')
    await dialog.getByRole('tab', { name: 'API Key', exact: true }).click()
    await expect(primary).toBeDisabled()
    await expectPalette(primary, '--fill', '--text-secondary')
    await page.screenshot({ path: `.tmp/audit-20261020/fixed/${theme}-disabled-api-key.png`, animations: 'disabled' })
  })
}

test('登录方式切换会取消旧会话，超时和设备失败可在原窗重试', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' } }, '/codex')
  const add = page.getByRole('button', { name: '添加账号', exact: true })
  await add.click()
  const dialog = page.getByRole('dialog', { name: '添加 Codex 账号', exact: true })
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: '开始登录', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('.url')).toContainText('https://auth.openai.com/')
  expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  const oldId = (await e2e.snapshot(page)).codex.loginId
  await dialog.getByRole('tab', { name: '设备码', exact: true }).click()
  expect(await e2e.count(page, 'codex_oauth_login_cancel')).toBe(1)
  await expect(dialog.locator('.code-label')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '取设备码', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '取设备码', exact: true }).click()
  await expect(dialog.locator('.code-label')).toHaveText('WXYZ-ABCD')
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/device-waiting.png', animations: 'disabled' })
  await expect.poll(() => e2e.hasListener(page, 'codex-device-auth-error')).toBe(true)
  const deviceId = (await e2e.snapshot(page)).codex.loginId
  await e2e.emitEvent(page, 'codex-oauth-login-completed', { loginId: oldId })
  expect(await e2e.count(page, 'codex_oauth_login_completed')).toBe(0)
  await e2e.emitEvent(page, 'codex-device-auth-error', { loginId: deviceId, error: '测试授权被拒绝' })
  await expect(dialog.getByRole('alert')).toContainText('测试授权被拒绝')
  await expect(dialog.getByRole('button', { name: '复制码', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '重新取码', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('tab', { name: '浏览器登录', exact: true }).click()
  await dialog.getByRole('button', { name: '开始登录', exact: true }).click()
  await expect.poll(() => e2e.hasListener(page, 'codex-oauth-login-timeout')).toBe(true)
  await e2e.emitEvent(page, 'codex-oauth-login-timeout', { loginId: (await e2e.snapshot(page)).codex.loginId })
  await expect(dialog.getByRole('alert')).toHaveText('授权超时，请重新发起登录。')
  await expect(dialog.getByRole('button', { name: '重新发起', exact: true })).toBeEnabled()
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/oauth-timeout.png', animations: 'disabled' })
  await dialog.getByRole('button', { name: '重新发起', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
})

test('重新登录显示目标账号，只有两种官方授权方式', async ({ page }) => {
  await bootUnlocked(page, { settings: { codex_enabled: 'true' }, codex: { accounts: [{ email: 'reauth@e2e.dev', account_name: '待重登账号', reauth: true }] } }, '/codex')
  await page.locator('.acc-row .acc-more').click()
  await page.locator('.popover').getByRole('button', { name: '重新登录', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重新登录 Codex 账号', exact: true })
  await expect(dialog.locator('.reauth-identity')).toContainText('待重登账号 · reauth@e2e.dev')
  await expect(dialog.getByRole('tab')).toHaveCount(2)
  await expect(dialog.getByRole('button', { name: '导入已有凭据', exact: true })).toHaveCount(0)
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/reauth-identity.png', animations: 'disabled' })
})

test('分类下拉按完整行显示，键盘可滚动到最后一项并先关闭下拉', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await bootUnlocked(page, { entries: Array.from({ length: 12 }, (_, i) => ({ name: `条目 ${i}`, url: 'https://example.com', category: `分类 ${String(i).padStart(2, '0')}` })) })
  await page.locator('a.nav-item[href="/entries"]').click()
  await page.locator('.page-bar .btn-primary').click()
  const dialog = page.locator('.entry-form-dialog')
  const input = dialog.getByPlaceholder('选择或输入新分类')
  await input.focus()
  const list = page.getByRole('listbox', { name: '所属分类', exact: true })
  const height = (await list.boundingBox())!.height
  expect((height - 10) % 32).toBe(0)
  await input.press('ArrowUp')
  const last = list.getByRole('option').last()
  await expect(last).toHaveClass(/highlighted/)
  const bounds = (await list.boundingBox())!
  const lastBounds = (await last.boundingBox())!
  expect(lastBounds.y).toBeGreaterThanOrEqual(bounds.y)
  expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(bounds.y + bounds.height)
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/category-complete-rows.png', animations: 'disabled' })
  const value = await last.innerText()
  await input.press('Enter')
  await expect(input).toHaveValue(value)
  await input.press('ArrowDown')
  await input.press('Escape')
  await expect(list).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await input.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('Web 设置使用紧凑输入与开关，运行中显示当前端口和修改方式', async ({ page }) => {
  await bootUnlocked(page)
  const settings = await openSettings(page)
  await settings.getByRole('button', { name: 'Web 访问', exact: true }).click()
  const port = settings.getByLabel('端口', { exact: true })
  await expect(port).toHaveCSS('width', '84px')
  const lan = settings.getByRole('switch', { name: '允许局域网设备访问' })
  await expect(lan).not.toBeChecked()
  await lan.focus()
  await lan.press('Space')
  await expect(lan).toBeChecked()
  await lan.press('Space')
  await expect(lan).not.toBeChecked()
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/web-settings-stopped.png', animations: 'disabled' })
  await port.fill('9345')
  await settings.getByRole('button', { name: '启动 Web 服务', exact: true }).click()
  await expect(settings.getByText('当前端口', { exact: true })).toBeVisible()
  await expect(settings.locator('.web-access-pane code')).toHaveText('9345')
  await expect(settings.getByText('停止服务后可修改端口与访问范围。', { exact: true })).toBeVisible()
  await expect(settings.locator('.settings-pane:visible')).toHaveCSS('overflow-y', 'scroll')
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/web-settings-running.png', animations: 'disabled' })
})

test('验证码常驻复制图标、删除动作标签和侧栏折叠入口可见', async ({ page }) => {
  await bootUnlocked(page, { settings: { mfa_enabled: 'true' }, mfaTokens: [{ issuer: 'GitHub', label: 'synthetic', secret: 'JBSWY3DPEHPK3PXP' }] }, '/mfa')
  const card = page.locator('.mfa-card')
  await expect(card.locator('.card-copy')).toBeVisible()
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/mfa-copy.png', animations: 'disabled' })
  await card.hover()
  await tipButton(card, '删除').click()
  await expect(page.getByRole('dialog', { name: '删除验证码', exact: true }).getByRole('button', { name: '删除', exact: true })).toBeVisible()
  await page.screenshot({ path: '.tmp/audit-20261020/fixed/mfa-delete.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  const toggle = page.getByRole('button', { name: '收起侧栏', exact: true })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(page.getByRole('button', { name: '展开侧栏', exact: true })).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCSS('width', '56px')
})
