import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, openSettings, visiblePane, expectToast } from '../helpers'
import type { E2EConfig } from '../mocks/backend'
import { webApp, selectModule } from '../web-helpers'
const emails = ['main@example.invalid', 'team@example.invalid', 'key@example.invalid']
const accounts = emails.map((email, i) => ({ email, current: i === 0, auth_mode: i === 2 ? 'apikey' as const : 'oauth' as const }))
const targets = [{ distro: 'Ubuntu', user: 'alice', email: emails[0], daemonCount: 1, cliCount: 2 }, { distro: 'Debian', user: 'bob', email: emails[0] }]
const row = (page: Page, i: number) => page.locator(`.acc-row[data-email="${emails[i]}"]`)
const modal = (page: Page) => page.locator('.codex-account-confirm')
async function boot(page: Page, switchUx: NonNullable<E2EConfig['codex']>['switchUx'] = {}, restart = true, width = 1040) {
  await page.setViewportSize({ width, height: 780 })
  await bootUnlocked(page, { settings: { codex_enabled: 'true', codex_switch_restart_codex: String(restart) }, codex: { accounts, switchUx } }, '/codex')
  await expect(row(page, 0)).toBeVisible()
}
async function switchDialog(page: Page, i = 1) {
  await row(page, i).locator('.action-btn.primary').click()
  await expect(modal(page)).toBeVisible()
  await expect(modal(page).getByRole('button', { name: /^切换/ })).toBeEnabled()
  return modal(page)
}
async function menu(page: Page, i: number) { await row(page, i).locator('.acc-more').click(); return page.locator('.popover') }
const operations = (page: Page) => page.evaluate(() => (window as any).__E2E__.snapshot().codex.switchUx.operations as string[])
const shot = (page: Page, name: string) => page.screenshot({ path: `.tmp/account-switch-20261023/screens/${name}.png` })

test('A/B 设置只有 Windows 重启开关，默认关闭，保留 WSL 用量统计', async ({ page }) => {
  await boot(page, {}, false, 800)
  const settings = await openSettings(page, 'codex')
  const pane = visiblePane(settings), toggle = settings.getByRole('switch', { name: '切换账号时重启 Codex', exact: true })
  await expect(toggle).not.toBeChecked()
  await expect(pane.locator('.codex-restart-warning')).toHaveCount(0)
  await expect(settings.getByRole('switch', { name: '自动统计 WSL 会话', exact: true }).locator('..')).toBeVisible()
  await expect(settings).not.toContainText('自动同步 WSL 登录态')
  await toggle.scrollIntoViewIfNeeded(); await shot(page, 'A-settings-off')
  await toggle.click(); await expect(toggle).toBeChecked()
  await expect(pane.locator('.codex-restart-warning')).toContainText('任务会中断')
  expect(await pane.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  await shot(page, 'B-settings-on')
  expect(await e2e.count(page, 'get_codex_wsl_assignment')).toBeGreaterThan(0)
})

test('C/H WSL 徽标来自探测，当前项禁用，API Key 有禁用原因', async ({ page }) => {
  await boot(page, { wsl: { targets } })
  await expect(row(page, 0).locator('.badge.wsl')).toHaveText('WSL 使用中')
  await shot(page, 'C-accounts')
  let pop = await menu(page, 0)
  await expect(pop.getByRole('button', { name: 'WSL 已使用此账号', exact: true })).toBeDisabled()
  await shot(page, 'H-already-assigned')
  await page.keyboard.press('Escape')
  pop = await menu(page, 2)
  await expect(pop.getByRole('button', { name: '在 WSL 中使用', exact: true })).toBeDisabled()
  await expect(pop).toContainText('API Key 账号不支持用于 WSL')
  expect(await operations(page)).toEqual([])
})

test('D1/D2 默认不勾 WSL，取消无写入，勾选后显示真实范围并按顺序执行', async ({ page }) => {
  await boot(page, { windows: { appCount: 1, cliCount: 2 }, wsl: { targets } })
  let dialog = await switchDialog(page)
  await expect(dialog).toHaveAccessibleName('切换账号并重启 Codex')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await expect(dialog).toContainText('WSL 继续使用 main@example.invalid')
  await expect(dialog.locator('.switch-scopes')).not.toContainText('后台')
  expect(Math.round((await dialog.boundingBox())!.width)).toBe(360)
  await shot(page, 'D1-switch-windows')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(await e2e.count(page, 'switch_codex_account')).toBe(0)
  dialog = await switchDialog(page)
  await dialog.getByRole('checkbox').check()
  await expect(dialog).toContainText('1 个后台、2 个 CLI，不重开')
  await shot(page, 'D2-switch-both')
  await dialog.getByRole('button', { name: '切换并重启', exact: true }).click()
  await expectToast(page, /已切换到 team@example.invalid；Windows 重开 1 个应用、2 个 CLI；WSL 2 个目标已切换/)
  expect(await operations(page)).toEqual(['credentials', 'closeWindows', 'writeCredentials', 'reopenWindows', 'stopWsl:alice', 'stopWsl:bob', 'writeWsl:alice', 'writeWsl:bob'])
  await expect(row(page, 1).locator('.badge.wsl')).toBeVisible()
})

test('E WSL 独立设置保持 Windows 当前账号，目标展示上限三条', async ({ page }) => {
  await boot(page, { wsl: { targets: [...targets, { distro: 'Ubuntu', user: 'c' }, { distro: 'Ubuntu', user: 'd' }] } })
  await (await menu(page, 1)).getByRole('button', { name: '在 WSL 中使用', exact: true }).click()
  const dialog = modal(page)
  await expect(dialog.getByRole('button', { name: '用于 WSL', exact: true })).toBeEnabled()
  await expect(dialog).toContainText('等 4 个')
  await expect(dialog).toContainText('Windows 账号与运行中的 Codex 不受影响')
  await shot(page, 'E-wsl-only')
  await dialog.getByRole('button', { name: '用于 WSL', exact: true }).click()
  await expect(row(page, 1).locator('.badge.wsl')).toBeVisible()
  await expect(row(page, 0).locator('.badge').filter({ hasText: '当前' })).toBeVisible()
  expect(await e2e.count(page, 'switch_codex_account')).toBe(0)
  expect(await operations(page)).not.toContain('writeCredentials')
})

for (const config of [{}, { wsl: { probeError: 'probe unavailable', targets: [] } }]) {
  test(`无 WSL 或探测失败隐藏所有 WSL 操作 ${JSON.stringify(config)}`, async ({ page }) => {
    await boot(page, config, false, 800)
    await expect(row(page, 0).locator('.badge.wsl')).toHaveCount(0)
    const pop = await menu(page, 1)
    await expect(pop.getByRole('button', { name: '在 WSL 中使用', exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    const dialog = await switchDialog(page)
    await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    await expect(dialog).not.toContainText('WSL')
    await expect(dialog).toHaveAccessibleName('切换账号')
    await shot(page, 'F-no-wsl')
    await dialog.getByRole('button', { name: '切换', exact: true }).click()
    expect(await operations(page)).toEqual(['credentials', 'writeCredentials'])
  })
}

test('G 总开关关闭仍可单独勾 WSL，不触碰 Windows 客户端', async ({ page }) => {
  await boot(page, { windows: { appCount: 1, cliCount: 2 }, wsl: { targets } }, false)
  const dialog = await switchDialog(page)
  await expect(dialog).toHaveAccessibleName('切换账号')
  await expect(dialog).not.toContainText('回原目录')
  await dialog.getByRole('checkbox').check()
  await shot(page, 'G-restart-off-with-wsl')
  await dialog.getByRole('button', { name: '切换', exact: true }).click()
  await expect(row(page, 1).locator('.badge.wsl')).toBeVisible()
  expect(await operations(page)).not.toContain('closeWindows')
})

test('目标已在 WSL 使用时复选框禁用且不重复停止写入', async ({ page }) => {
  await boot(page, { wsl: { targets: targets.map(t => ({ ...t, email: emails[1] })) } })
  const dialog = await switchDialog(page)
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(dialog.getByRole('checkbox')).toBeDisabled()
  await dialog.getByRole('button', { name: '切换', exact: true }).click()
  await expect(modal(page)).toHaveCount(0)
  expect((await operations(page)).some(op => op.includes('Wsl'))).toBe(false)
})

test('API Key 的 WSL 复选框禁用并显示原因', async ({ page }) => {
  await boot(page, { wsl: { targets } })
  const dialog = await switchDialog(page, 2)
  await expect(dialog.getByRole('checkbox')).toBeDisabled()
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await expect(dialog).toContainText('API Key 账号不支持用于 WSL')
})

test('Windows 预览失败阻止确认', async ({ page }) => {
  await boot(page, { windows: { previewError: 'Windows 预览失败' } })
  await row(page, 1).locator('.action-btn.primary').click()
  const dialog = modal(page)
  await expect(dialog.getByRole('alert')).toHaveText('Windows 预览失败')
  await expect(dialog.getByRole('button', { name: '切换', exact: true })).toBeDisabled()
  expect(await operations(page)).toEqual([])
})

for (const failure of ['credentials', 'close'] as const) {
  test(`${failure} 失败不提交、不碰 WSL，弹窗可重试`, async ({ page }) => {
    await boot(page, { windows: { cliCount: 1, closeError: failure === 'close' ? '无法关闭 Codex' : undefined }, credentialsError: failure === 'credentials' ? '凭据准备失败' : undefined, wsl: { targets } })
    const dialog = await switchDialog(page); await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '切换并重启', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText(failure === 'credentials' ? '凭据准备失败' : '无法关闭 Codex')
    expect(await operations(page)).not.toContain('writeCredentials')
    expect((await operations(page)).some(op => op.includes('Wsl'))).toBe(false)
    await expect(row(page, 0).locator('.badge').filter({ hasText: '当前' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: '重试', exact: true })).toBeEnabled()
  })
}

for (const mode of ['stop', 'write', 'mismatch'] as const) {
  test(`WSL ${mode} 失败保留 Windows 成功，徽标不误报`, async ({ page }) => {
    await boot(page, { wsl: { stopError: mode === 'stop' ? 'cannot stop WSL' : undefined, targets: targets.map((t,i) => ({ ...t, writeFails: mode === 'write' && i === 1, identityMismatch: mode === 'mismatch' && i === 1 })) } })
    const dialog = await switchDialog(page); await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '切换', exact: true }).click()
    await expectToast(page, mode === 'stop' ? /已切换到.*WSL 未跟随/ : /已切换到.*WSL 1 个目标成功、1 个失败/)
    await expect(row(page, 1).locator('.badge').filter({ hasText: '当前' })).toBeVisible()
    await expect(page.locator('.badge.wsl')).toHaveCount(mode === 'stop' ? 1 : 0)
    if (mode === 'stop') expect((await operations(page)).some(op => op.startsWith('writeWsl'))).toBe(false)
  })
}

for (const expired of [false, true]) {
  test(`重开失败只拿计划 id 重试${expired ? '，过期提示手动打开' : '成功后关闭'}`, async ({ page }) => {
    await boot(page, { windows: { appCount: 1, cliCount: 2, reopenFailures: 1, planExpired: expired }, wsl: { targets } })
    const dialog = await switchDialog(page); await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: '切换并重启', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('账号已切换')
    await expect(row(page, 1).locator('.badge.wsl')).toBeVisible()
    await dialog.getByRole('button', { name: '重新打开 Codex', exact: true }).click()
    if (expired) { await expect(dialog.getByRole('alert')).toContainText('重开计划已过期，请手动打开 Codex'); await expect(dialog.getByRole('button', { name: '请手动打开 Codex', exact: true })).toBeDisabled() }
    else await expect(dialog).toHaveCount(0)
    expect(await e2e.count(page, 'switch_codex_account')).toBe(1)
    expect(await e2e.count(page, 'relaunch_codex_clients')).toBe(1)
  })
}

test('Web 手机端保持凭据切换，不暴露桌面和 WSL 进程控制', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page, { settings: { codex_enabled: 'true', codex_switch_restart_codex: 'true' }, codex: { accounts, switchUx: { windows: { cliCount: 2 }, wsl: { targets } } } })
  await app.login(); await selectModule(page, 'Codex')
  const dialog = await switchDialog(page)
  await expect(dialog).toHaveAccessibleName('切换账号')
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  expect(await dialog.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false)
  await shot(page, 'mobile-web')
  await dialog.getByRole('button', { name: '切换', exact: true }).click()
  await expect(row(page, 1).locator('.badge').filter({ hasText: '当前' })).toBeVisible()
  expect(await operations(page)).toEqual(['credentials','writeCredentials'])
  expect(app.errors).toEqual([])
})

for (const theme of ['paper', 'ink']) for (const width of [800, 1040]) {
  test(`九帧布局 ${theme} ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    await bootUnlocked(page, { settings: { codex_enabled:'true', codex_switch_restart_codex:'true', theme, accent:'celadon' }, codex: { accounts, switchUx: { windows: { appCount:1, cliCount:2 }, wsl:{targets} } } }, '/codex')
    const prefix=`${theme}-${width}`
    await expect(row(page,0).locator('.badge.wsl')).toBeVisible()
    const before = await e2e.count(page,'get_codex_wsl_assignment')
    const settings=await openSettings(page,'codex')
    const toggle=settings.getByRole('switch',{name:'切换账号时重启 Codex',exact:true})
    await toggle.scrollIntoViewIfNeeded()
    await shot(page,`${prefix}-A-settings-on`)
    await toggle.click();await expect(toggle).not.toBeChecked()
    await shot(page,`${prefix}-F-settings-off`)
    await toggle.click();await expect(toggle).toBeChecked()
    expect(await e2e.count(page,'get_codex_wsl_assignment')).toBe(before)
    const box=(await settings.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(width-32)
    if(width===1040){expect(box.width).toBe(760);expect(box.height).toBe(560)}
    await settings.getByRole('button',{name:'关闭',exact:true}).click()
    await shot(page,`${prefix}-B-accounts`)
    let pop=await menu(page,1)
    await expect(pop.getByRole('button',{name:'在 WSL 中使用',exact:true})).toBeEnabled()
    const trigger=(await row(page,1).locator('.acc-more').boundingBox())!, menuBox=(await pop.boundingBox())!
    expect(menuBox.y).toBeGreaterThanOrEqual(trigger.y+trigger.height-1)
    await shot(page,`${prefix}-C-menu`);await page.keyboard.press('Escape')
    await menu(page,0);await shot(page,`${prefix}-H-current-menu`);await page.keyboard.press('Escape')
    await menu(page,2);await shot(page,`${prefix}-G-api-key-menu`);await page.keyboard.press('Escape')
    let dialog=await switchDialog(page)
    await shot(page,`${prefix}-D1-unchecked`)
    const height=(await dialog.boundingBox())!.height
    await dialog.getByRole('checkbox').check();await shot(page,`${prefix}-D2-checked`)
    const grown=(await dialog.boundingBox())!
    expect(grown.height).toBeGreaterThan(height)
    expect(grown.y+grown.height).toBeLessThanOrEqual(780-16)
    expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false)
    await page.keyboard.press('Escape')
    await (await menu(page,1)).getByRole('button',{name:'在 WSL 中使用',exact:true}).click()
    dialog=modal(page);await expect(dialog.getByRole('button',{name:'用于 WSL',exact:true})).toBeEnabled()
    await shot(page,`${prefix}-E-wsl-only`)
    expect(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false)
    expect(await operations(page)).toEqual([])
  })
}
