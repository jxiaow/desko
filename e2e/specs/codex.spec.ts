import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane } from '../helpers'

const TWO = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [
      {
        email: 'main@e2e.dev', account_name: '主力', plan_type: 'pro', hourly: 82, weekly: 60, current: true,
        user_id: '9f6305d7-1111-2222-3333-444455556666', account_structure: 'personal',
        subscription_until: '2027-01-01T10:18:00', tags: ['工作'], login_provider: 'google',
      },
      // 到期字段走 unix 秒串这一支，覆盖两种解析形状
      { email: 'back@e2e.dev', plan_type: 'plus', hourly: 18, weekly: 90, subscription_until: '1798761600' },
    ],
  },
}

async function gotoCodex(page: Page, config = TWO) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/codex"]').click()
  await expect(page.locator('.acc-row').first()).toBeVisible()
}

/** 行按邮箱定位：L1 显示名称，邮箱只活在 data-email 上 */
const accountRow = (page: Page, email: string) => page.locator(`.acc-row[data-email="${email}"]`)

/** ⋯ 菜单按文字点项：菜单项是 .popover .pop-item */
async function rowMenu(page: Page, email: string, label: string | RegExp) {
  const row = accountRow(page, email)
  await row.locator('.acc-more').click()
  await page.locator('.popover .pop-item', { hasText: label }).click()
}

test.describe('Codex 账号', () => {
  test('开关默认关：没有侧栏入口，直达 /codex 被带回小记页', async ({ page }) => {
    await bootUnlocked(page, {}, '/codex')
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('a.nav-item[href="/codex"]')).toHaveCount(0)
    expect(await e2e.count(page, 'list_codex_accounts')).toBe(0)
  })

  test('设置里开启才出现入口，并拉一次账号列表', async ({ page }) => {
    await bootUnlocked(page)
    const dialog = await openSettings(page, 'modules')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: 'Codex 账号' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, 'Codex 账号已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/codex"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.empty-title')).toHaveText('还没有 Codex 账号')
    expect(await e2e.count(page, 'list_codex_accounts')).toBeGreaterThan(0)
  })

  test('列表显示配额与当前标记，切换先过确认再落 switch 命令', async ({ page }) => {
    await gotoCodex(page)
    await expect(page.locator('.acc-row')).toHaveCount(2)
    const cur = accountRow(page, 'main@e2e.dev')
    await expect(cur.locator('.chip', { hasText: '当前' })).toBeVisible()
    await expect(cur.locator('.action-btn.primary')).toHaveCount(0)
    await expect(accountRow(page, 'back@e2e.dev').locator('.q.low')).toBeVisible()

    await accountRow(page, 'back@e2e.dev').locator('.action-btn.primary').click()
    // 切号覆写 ~/.codex 官方凭据，先确认；取消则命令面一次都不动
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toContainText('写入官方凭据文件 ~/.codex')
    await confirm.locator('button', { hasText: '取消' }).click()
    expect(await e2e.count(page, 'switch_codex_account')).toBe(0)

    await accountRow(page, 'back@e2e.dev').locator('.action-btn.primary').click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, '已切换账号')
    expect(await e2e.count(page, 'switch_codex_account')).toBe(1)
    await expect(accountRow(page, 'back@e2e.dev').locator('.chip', { hasText: '当前' })).toBeVisible()
    // 同一种凭据形态之间切号，官方侧边栏的过滤键没变，修复一次都不该跑
    expect(await e2e.count(page, 'codex_repair_session_visibility_for_launch_target')).toBe(0)
  })

  test('行内三行事实：等级、Team Name、登录方式、用户 ID、有效期与标签都看得见', async ({ page }) => {
    await gotoCodex(page)
    const main = accountRow(page, 'main@e2e.dev')
    await expect(main.locator('.tier')).toHaveText('PRO')
    await expect(main.locator('.acc-l2')).toContainText('Team Name：个人账户')
    await expect(main.locator('.acc-l2')).toContainText('使用 Google 登录')
    await expect(main.locator('.acc-l2')).toContainText('用户 ID：9f6305d7…')
    await expect(main.locator('.acc-l3')).toContainText('有效期至 2027-01-01 10:18')
    await expect(main.locator('.acc-l3')).toContainText('标签：工作')

    // 另一条：无 login_provider 时登录方式退回 OAuth；到期走 unix 秒串也解得出来
    const back = accountRow(page, 'back@e2e.dev')
    await expect(back.locator('.tier')).toHaveText('PLUS')
    await expect(back.locator('.acc-l2')).toContainText('使用 OAuth 登录')
    await expect(back.locator('.acc-l3')).toContainText(/有效期至 202\d-/)
  })

  test('换凭据形态切号：写完凭据顺手把侧栏会话修回来', async ({ page }) => {    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: {
        accounts: [
          { email: 'main@e2e.dev', account_name: '主力', current: true },
          { email: 'key@e2e.dev', auth_mode: 'apikey' },
        ],
        repairRows: 4,
      },
    })
    // OAuth → API Key 会改写 config.toml 的 model_provider，官方侧栏按它过滤 threads
    await accountRow(page, 'key@e2e.dev').locator('.action-btn.primary').click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, /已切换账号，并修复 4 处会话可见性/)
    expect(await e2e.count(page, 'get_codex_history_visibility_provider')).toBe(2)
    expect(await e2e.count(page, 'codex_repair_session_visibility_for_launch_target')).toBe(1)
  })

  test('修复失败只降级成提示，切号本身已经生效', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: {
        accounts: [
          { email: 'main@e2e.dev', current: true },
          { email: 'key@e2e.dev', auth_mode: 'apikey' },
        ],
        repairFail: true,
      },
    })
    await accountRow(page, 'key@e2e.dev').locator('.action-btn.primary').click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()
    await expectToast(page, /已切换账号，但会话可见性修复失败/)
    expect(await e2e.count(page, 'switch_codex_account')).toBe(1)
    await expect(accountRow(page, 'key@e2e.dev').locator('.chip', { hasText: '当前' })).toBeVisible()
  })

  test('批量：勾一行才出dock，全选后一次命令带走两条', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await page.locator('.acc-row').first().locator('.acc-main').click()
    await page.locator('.batch-dock button', { hasText: '全选' }).click()
    await page.locator('.batch-dock button', { hasText: '删除选中' }).click()
    await page.locator('.dialog-footer button', { hasText: '确定' }).click()
    expect(await e2e.count(page, 'delete_codex_accounts')).toBe(1)
    await expect(page.locator('.acc-row')).toHaveCount(0)
  })

  test('⋯ 菜单改名走 update 命令，行内即时回显', async ({ page }) => {
    await gotoCodex(page)
    await rowMenu(page, 'back@e2e.dev', /名称与备注/)
    const dialog = page.locator('.edit-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('.input').first().fill('备用二号')
    await dialog.locator('.dialog-footer button', { hasText: '保存' }).click()
    await expectToast(page, '账号信息已保存')
    expect(await e2e.count(page, 'update_codex_account_name')).toBe(1)
    await expect(page.locator('.acc-row .mail', { hasText: '备用二号' })).toBeVisible()
  })

  test('浏览器登录：发起后粘贴回调，收到完成事件即落库并收口弹窗', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('button', { hasText: '开始登录' }).click()
    expect(await e2e.count(page, 'codex_oauth_login_start')).toBe(1)
    await expect(dialog.locator('.url')).toBeVisible()

    await dialog.locator('.cb-row .input').fill('http://localhost:1455/callback?state=x')
    await dialog.locator('.cb-row button', { hasText: '提交' }).click()
    await expectToast(page, /回调地址里没有授权码/)

    await dialog.locator('.cb-row .input').fill('http://localhost:1455/callback?code=abc&state=x')
    await dialog.locator('.cb-row button', { hasText: '提交' }).click()
    await expectToast(page, /已登录 browser@e2e.dev/)
    await expect(dialog).toHaveCount(0)
    await expect(accountRow(page, 'browser@e2e.dev')).toBeVisible()
  })

  test('设备码：取到码就展示 8 位码与验证页', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.locator('.seg-btn', { hasText: '设备码' }).click()
    await dialog.locator('button', { hasText: '取设备码' }).click()
    await expect(dialog.locator('.code-label')).toHaveText('WXYZ-ABCD')
    expect(await e2e.count(page, 'codex_oauth_device_auth_start')).toBe(1)
  })

  test('API Key：空 Key 时按钮禁用，填了才落账号并在行上标出来', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.locator('.seg-btn', { hasText: 'API Key' }).click()
    await expect(dialog.locator('button', { hasText: '添加' })).toBeDisabled()
    await dialog.locator('.field .input').first().fill('sk-e2e-0001')
    await dialog.locator('button', { hasText: '添加' }).click()
    await expectToast(page, /已添加 key@e2e.dev/)
    expect(await e2e.count(page, 'add_codex_account_with_api_key')).toBe(1)
    await expect(accountRow(page, 'key@e2e.dev').locator('.chip', { hasText: 'API Key' })).toBeVisible()
  })

  test('回调端口被占：给出可执行的提示', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: { accounts: [{ email: 'main@e2e.dev', current: true }], portBusy: true },
    })
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await expect(dialog.locator('.note.warn')).toHaveText(/回调端口已被占用/)
    await dialog.locator('button', { hasText: '开始登录' }).click()
    await expectToast(page, /CODEX_OAUTH_PORT_IN_USE/)
  })

  test('删除单条要过确认框，取消不动数据', async ({ page }) => {
    await gotoCodex(page)
    await rowMenu(page, 'back@e2e.dev', /删除/)
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toBeVisible()
    await confirm.locator('button', { hasText: '取消' }).click()
    await expect(confirm).toHaveCount(0)
    expect(await e2e.count(page, 'delete_codex_account')).toBe(0)
    await expect(page.locator('.acc-row')).toHaveCount(2)
  })

  test('重置 5 小时额度：弹窗先列明细，取消不动命令面，确定才扣一次', async ({ page }) => {
    await gotoCodex(page)
    // 只有配额还宽松的 back 号有可用重置次数（fixture 里 hourly 18），菜单项才出得来
    await rowMenu(page, 'back@e2e.dev', /重置 5 小时额度/)
    const dlg = page.locator('.reset-credit-dialog')
    await expect(dlg).toBeVisible()
    await expect(dlg).toContainText('back@e2e.dev')
    await expect(dlg).toContainText('还剩 1 次')
    await expect(dlg).toContainText('最近到期')
    await expect(dlg.locator('.rc-row')).toHaveCount(3)
    await expect(dlg.locator('.rc-status', { hasText: '可用' })).toHaveCount(1)
    await expect(dlg.locator('.rc-status', { hasText: '已使用' })).toHaveCount(1)
    await expect(dlg.locator('.rc-status', { hasText: '已过期' })).toHaveCount(1)
    // 已用掉那条给「使用」而不给「到期」
    await expect(dlg.locator('.rc-row').nth(1)).toContainText('使用：')

    await dlg.locator('.dialog-footer button', { hasText: '取消' }).click()
    await expect(dlg).toHaveCount(0)
    expect(await e2e.count(page, 'consume_codex_reset_credit')).toBe(0)

    await rowMenu(page, 'back@e2e.dev', /重置 5 小时额度/)
    await page.locator('.reset-credit-dialog .dialog-footer button', { hasText: '重置' }).click()
    await expectToast(page, '已使用一次额度重置')
    expect(await e2e.count(page, 'consume_codex_reset_credit')).toBe(1)
  })

  test('导入 tab：展示本机凭据路径，导入本机与导出所选都打到命令面', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.locator('.seg-btn', { hasText: '导入' }).click()
    await expect(dialog.locator('.pathline .v')).toContainText(/\.codex\\auth\.json/)
    await dialog.locator('button', { hasText: '导入本机账号' }).click()
    await expectToast(page, /已导入 local@e2e.dev/)
    expect(await e2e.count(page, 'import_codex_from_local')).toBe(1)

    await dialog.locator('.dialog-close').click()
    await page.locator('.acc-row').first().locator('.acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '导出这一条 JSON' }).click()
    expect(await e2e.count(page, 'export_codex_accounts')).toBe(1)
  })

  test('设置·Codex 面板：展示官方凭据路径并能打开 config.toml', async ({ page }) => {
    await bootUnlocked(page, { settings: { codex_enabled: 'true' } })
    const dialog = await openSettings(page, 'codex')
    const item = visiblePane(dialog).locator('.setting-item', { hasText: '官方凭据路径' })
    await expect(item.locator('.codex-path code')).toContainText(/\.codex\\auth\.json/)
    await item.locator('.codex-path button', { hasText: '打开 config.toml' }).click()
    expect(await e2e.count(page, 'open_codex_config_toml')).toBe(1)
  })
})
