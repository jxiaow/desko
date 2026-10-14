import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane, waitForToastGone } from '../helpers'

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
      .locator('.setting-item')
      .filter({ has: page.getByText('Codex', { exact: true }) })
      .locator('.switch-slider')
      .click()
    await expectToast(page, 'Codex已开启')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/codex"]')).toHaveAccessibleName('Codex')
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.empty-title')).toHaveText('还没有 Codex 账号')
    expect(await e2e.count(page, 'list_codex_accounts')).toBeGreaterThan(0)
  })

  test('列表显示配额与当前标记，切换先过确认再落 switch 命令', async ({ page }) => {
    await gotoCodex(page)
    await expect(page.locator('.acc-row')).toHaveCount(2)
    const cur = accountRow(page, 'main@e2e.dev')
    await expect(cur.locator('.badge', { hasText: '当前' })).toBeVisible()
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
    await expect(accountRow(page, 'back@e2e.dev').locator('.badge', { hasText: '当前' })).toBeVisible()
    // 同一种凭据形态之间切号，官方侧边栏的过滤键没变，修复一次都不该跑
    expect(await e2e.count(page, 'codex_repair_session_visibility_for_launch_target')).toBe(0)
  })

  test('账号身份区显示等级和属性，使用记录与标签位于页脚', async ({ page }) => {
    await gotoCodex(page)
    const main = accountRow(page, 'main@e2e.dev')
    await expect(main.locator('.tier')).toHaveText('PRO 200')
    await expect(main.locator('.acc-l2')).toContainText('工作区：个人账户')
    await expect(main.locator('.acc-l2')).toContainText('登录方式：Google')
    await expect(main).not.toContainText('用户 ID')
    await expect(main).not.toContainText('9f6305d7')
    await expect(main.locator('.acc-l2')).toContainText('有效期至 2027-01-01 10:18')
    await expect(main.locator('.acc-l3')).toContainText('标签：工作')

    // 另一条：无 login_provider 时登录方式退回 OAuth；到期走 unix 秒串也解得出来
    const back = accountRow(page, 'back@e2e.dev')
    await expect(back.locator('.tier')).toHaveText('PLUS')
    await expect(back.locator('.acc-l2')).toContainText('登录方式：OAuth')
    await expect(back.locator('.acc-l2')).toContainText(/有效期至 202\d-/)
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
    await expect(accountRow(page, 'key@e2e.dev').locator('.badge', { hasText: '当前' })).toBeVisible()
  })

  test('批量：勾一行才出dock，删除走的是作业面而不是整把命令', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await page.locator('.acc-row').first().locator('.acc-main').click()
    await page.locator('.batch-dock button', { hasText: '全选' }).click()
    await page.locator('.batch-dock button', { hasText: '删除选中' }).click()
    await page.locator('.dialog-footer button', { hasText: '确定' }).click()
    // 单通道：老的一把梭 delete_codex_accounts 不再被点，jobId 一族接手
    expect(await e2e.count(page, 'delete_codex_accounts')).toBe(0)
    expect(await e2e.count(page, 'start_codex_batch_delete')).toBe(1)
    const dialog = page.locator('.batch-delete-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.bd-done')).toHaveText('2')
    await expect(dialog.locator('.bd-total')).toHaveText('2')
    await expect(dialog).toHaveAttribute('data-status', 'completed')
    await dialog.locator('.dialog-footer button', { hasText: '关闭' }).click()
    await expect(page.locator('.acc-row')).toHaveCount(0)
    // 终态收窗顺手 clear：作业入口随任务一起消失
    await expect(page.locator('.batch-dock')).toHaveCount(0)
  })

  test('⋯ 菜单改名走 update 命令，行内即时回显', async ({ page }) => {
    await gotoCodex(page)
    await rowMenu(page, 'back@e2e.dev', /名称与备注/)
    const dialog = page.locator('.edit-dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('#cx-name').fill('备用二号')
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

    await dialog.locator('.cb-row input').fill('http://localhost:1455/callback?state=x')
    await dialog.locator('.cb-row button', { hasText: '提交' }).click()
    await expectToast(page, /回调地址里没有授权码/)

    await dialog.locator('.cb-row input').fill('http://localhost:1455/callback?code=abc&state=x')
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
    await dialog.locator('#cx-key').fill('sk-e2e-0001')
    await dialog.locator('button', { hasText: '添加' }).click()
    await expectToast(page, /已添加 key@e2e.dev/)
    expect(await e2e.count(page, 'add_codex_account_with_api_key')).toBe(1)
    await expect(accountRow(page, 'key@e2e.dev').locator('.tier', { hasText: 'API Key' })).toBeVisible()
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
    await page.getByRole('button', { name: '确认重置', exact: true }).click()
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
    await expect(dialog.locator('.nav-tab.on')).toHaveText('Codex')
    await expect(dialog.locator('.settings-head h3')).toHaveText('Codex')
    const item = visiblePane(dialog).locator('.setting-item', { hasText: '官方凭据路径' })
    await expect(item.locator('.codex-path code')).toContainText(/\.codex\\auth\.json/)
    await expect(item.locator('.codex-path code')).toHaveCSS('font-family', /Consolas/)
    await item.locator('.codex-path button', { hasText: '打开 config.toml' }).click()
    expect(await e2e.count(page, 'open_codex_config_toml')).toBe(1)
  })

  test('切号在途可取消：取消命令落一次，提示不谎称凭据没动过', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: {
        accounts: [{ email: 'main@e2e.dev', current: true }, { email: 'back@e2e.dev' }],
        switchDelayMs: 1500,
      },
    })
    await accountRow(page, 'back@e2e.dev').locator('.action-btn.primary').click()
    await page.locator('.confirm-dialog .dialog-footer button', { hasText: '确定' }).click()

    // 在途这几秒：切换钮换成取消，进度字挂上；别的行动作此刻点不动
    const cancel = accountRow(page, 'back@e2e.dev').locator('.action-btn', { hasText: '取消' })
    await expect(cancel).toBeVisible()
    await expect(page.locator('.switch-line')).toContainText(/读取凭据|写入官方凭据/)
    await cancel.click()
    await expectToast(page, /已取消切换，以列表里的「当前」为准/)
    expect(await e2e.count(page, 'codex_cancel_account_switch')).toBe(1)
    // 取消点不确定在写凭据前还是后，界面不承诺「什么都没动」，只把当前指针交回列表
    await expect(accountRow(page, 'main@e2e.dev').locator('.badge', { hasText: '当前' })).toBeVisible()
    await expect(page.locator('.switch-line')).toHaveCount(0)
  })

  test('待授权、需重新登录的原因、配额失败原因与上次使用都落在行内', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: {
        accounts: [
          { email: 'main@e2e.dev', current: true },
          { email: 'pend@e2e.dev', auth_status: 'Pending' },
          { email: 'old@e2e.dev', reauth: true, reauth_reason: '令牌已被撤销，请重新登录' },
          { email: 'bare@e2e.dev', reauth: true },
          { email: 'bad@e2e.dev', quota_error: '上游限流，稍后再试', used_days_ago: 3 },
        ],
      },
    })
    const pend = accountRow(page, 'pend@e2e.dev')
    await expect(pend.locator('.badge.warn', { hasText: '待授权' })).toBeVisible()
    await expect(pend.locator('.badge.warn', { hasText: '需重新登录' })).toHaveCount(0)

    // 后端把切号失败的原因写进 reauth_reason，徽标只多一个悬停说明，行面不加字
    const reauth = accountRow(page, 'old@e2e.dev')
    await expect(reauth.locator('.badge.warn', { hasText: '需重新登录' })).toHaveAttribute('title', /令牌已被撤销/)
    // 没有原因串就不挂属性，别留 title="" 那种空悬停
    await expect(accountRow(page, 'bare@e2e.dev').locator('.badge.warn', { hasText: '需重新登录' })).not.toHaveAttribute('title')

    const bad = accountRow(page, 'bad@e2e.dev')
    await expect(bad.locator('.q-when.bad')).toHaveText('配额拉取失败')
    await expect(bad.locator('.q-when.bad')).toHaveAttribute('title', /上游限流/)
    await expect(bad.locator('.acc-l3')).toContainText(/上次使用 \d{2}-\d{2} \d{2}:\d{2}/)

    // 当前那条也在底行给出上次使用时间，字段来自 unix 秒
    await expect(accountRow(page, 'main@e2e.dev').locator('.acc-l3')).toContainText(/上次使用/)
  })

  test('⋯ 菜单的详情刷新按凭据形态分档', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: { accounts: [{ email: 'main@e2e.dev', current: true }, { email: 'key@e2e.dev', auth_mode: 'apikey' }] },
    })
    await rowMenu(page, 'main@e2e.dev', /刷新订阅信息/)
    expect(await e2e.count(page, 'refresh_codex_subscription_info')).toBe(1)
    expect(await e2e.count(page, 'refresh_codex_account_profile')).toBe(0)

    // API Key 没有订阅可查，后端会直接拒，菜单只给 profile 那一档
    await accountRow(page, 'key@e2e.dev').locator('.acc-more').click()
    await expect(page.locator('.popover .pop-item', { hasText: '刷新订阅信息' })).toHaveCount(0)
    await page.locator('.popover .pop-item', { hasText: '刷新账号信息' }).click()
    expect(await e2e.count(page, 'refresh_codex_account_profile')).toBe(1)
  })

  test('API Key 账号能改凭据：留空不动，填了新密钥后续写操作跟新 ID', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: { accounts: [{ email: 'key@e2e.dev', auth_mode: 'apikey', api_base_url: 'https://api.e2e.dev/v1' }] },
    })
    const row = accountRow(page, 'key@e2e.dev')
    await expect(row.locator('.acc-l2')).toContainText('Base URL：https://api.e2e.dev/v1')

    await row.locator('.acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '账号与密钥' }).click()
    const dlg = page.locator('.edit-dialog')
    await expect(dlg.locator('.key-box')).toBeVisible()
    // Base URL 预填当前值：留空提交会把它清掉，真实后端按 None 重建供应商配置
    await expect(dlg.locator('#cx-baseurl')).toHaveValue('https://api.e2e.dev/v1')

    await dlg.locator('#cx-name').fill('托管密钥')
    await dlg.locator('.dialog-footer button', { hasText: '保存' }).click()
    await expectToast(page, '账号信息已保存')
    expect(await e2e.count(page, 'update_codex_api_key_credentials')).toBe(0)

    await accountRow(page, 'key@e2e.dev').locator('.acc-more').click()
    await page.locator('.popover .pop-item', { hasText: '账号与密钥' }).click()
    await page.locator('.edit-dialog #cx-newkey').fill('sk-e2e-9999')
    await page.locator('.edit-dialog #cx-name').fill('换过密钥的')
    await page.locator('.edit-dialog .dialog-footer button', { hasText: '保存' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toContainText('还会改写官方凭据文件')
    await expect(confirm).not.toContainText('sk-e2e-9999')
    expect(await e2e.count(page, 'update_codex_api_key_credentials')).toBe(0)
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    expect(await e2e.count(page, 'update_codex_api_key_credentials')).toBe(0)
    await expect(page.locator('.edit-dialog #cx-newkey')).toHaveValue('sk-e2e-9999')
    await page.locator('.edit-dialog .dialog-footer button', { hasText: '保存' }).click()
    await confirm.getByRole('button', { name: '确定', exact: true }).click()
    await expectToast(page, /凭据与档案已按新密钥重建/)
    expect(await e2e.count(page, 'update_codex_api_key_credentials')).toBe(1)

    const calls = await page.evaluate(() =>
      (window as any).__E2E__.invocations.map((c: { cmd: string }) => c)
    )
    const rename = calls.filter((c: any) => c.cmd === 'update_codex_account_name').pop()
    // 密钥哈希决定 ID，改名这类后续写操作必须落在新 ID 上，否则「账号不存在」
    expect(String(rename.args.accountId)).toMatch(/^codex_apikey_/)
    await expect(page.locator('.acc-row .mail', { hasText: '换过密钥的' })).toBeVisible()
  })

  test('导入 tab 能粘贴 JSON：整段导出与裸密钥都收', async ({ page }) => {
    await gotoCodex(page)
    await page.locator('.add-btn').click()
    const dialog = page.locator('.auth-dialog')
    await dialog.locator('.seg-btn', { hasText: '导入' }).click()
    await expect(dialog.locator('.paste-act button')).toBeDisabled()

    await dialog.locator('#cx-paste').fill('{"accounts":[{"email":"paste@e2e.dev"}]}')
    await dialog.locator('.paste-act button').click()
    await expectToast(page, /已导入 1 条账号/)
    expect(await e2e.count(page, 'import_codex_from_json')).toBe(1)
    await expect(accountRow(page, 'paste@e2e.dev')).toBeVisible()
    await expect(dialog).toHaveCount(0)
  })

  test('进页那一轮自动补配额：静默取数并把预警报出来，手动刷新不再重复报', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true' },
      codex: { accounts: [{ email: 'low@e2e.dev', hourly: 18, weekly: 90, current: true }] },
    })
    // 库里可能是几小时前的数：不必等人点「刷新配额」，进页的静默一轮就该把预警报出来
    await expectToast(page, /low@e2e.dev 剩余 18%，低于 20% 阈值/)
    await expect.poll(() => e2e.count(page, 'refresh_codex_quotas_batch')).toBe(1)

    // toast 是单例：等进页那一轮彻底收口后再手动刷，只剩「配额已刷新」，说明预警没有再来一遍
    await waitForToastGone(page)
    await page.locator('.page-bar .bar-btn', { hasText: '刷新配额' }).click()
    await expectToast(page, '配额已刷新')
    expect(await e2e.count(page, 'refresh_codex_quotas_batch')).toBe(2)
  })

  test('60 s 内在页签间来回切，不为配额再打一次网络', async ({ page }) => {
    await gotoCodex(page)
    await expect.poll(() => e2e.count(page, 'refresh_codex_quotas_batch')).toBe(1)

    await page.locator('a.nav-item[href="/notes"]').click()
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    expect(await e2e.count(page, 'refresh_codex_quotas_batch')).toBe(1)
  })

  test('自动刷新关掉：进页零网络，手动仍然取数', async ({ page }) => {
    await gotoCodex(page, {
      settings: { codex_enabled: 'true', codex_quota_auto_refresh_minutes: '0' },
      codex: { accounts: [{ email: 'off@e2e.dev', hourly: 55, weekly: 66, current: true }] },
    })
    expect(await e2e.count(page, 'refresh_codex_quotas_batch')).toBe(0)

    await page.locator('.page-bar .bar-btn', { hasText: '刷新配额' }).click()
    await expectToast(page, '配额已刷新')
    expect(await e2e.count(page, 'refresh_codex_quotas_batch')).toBe(1)
  })

  test('设置·Codex：自动刷新与预警阈值写进 settings KV', async ({ page }) => {
    await bootUnlocked(page, { settings: { codex_enabled: 'true' } })
    const dialog = await openSettings(page, 'codex')
    const pane = visiblePane(dialog)
    const auto = pane.locator('.setting-item', { hasText: '配额自动刷新' })
    await expect(auto.locator('.setting-desc')).toContainText('每 10 分钟静默取一次数')
    await auto.locator('.opt-trigger').click()
    await page.locator('.popover .opt-item', { hasText: '不自动' }).click()
    await expect(auto.locator('.setting-desc')).toContainText('已关闭')

    const alert = pane.locator('.setting-item', { hasText: '配额预警' })
    await alert.locator('.opt-trigger').click()
    await page.locator('.popover .opt-item', { hasText: '剩余 10%' }).click()

    const writes = await page.evaluate(() =>
      (window as any).__E2E__.invocations
        .filter((c: { cmd: string }) => c.cmd === 'set_setting')
        .map((c: { args: Record<string, string> }) => [c.args.key, c.args.value])
    )
    // 一次保存写两个键（间隔与阈值同进同退），所以每拨一下都是成对落盘
    expect(writes).toEqual([
      ['codex_quota_auto_refresh_minutes', '0'],
      ['codex_quota_alert_threshold', '20'],
      ['codex_quota_auto_refresh_minutes', '0'],
      ['codex_quota_alert_threshold', '10'],
    ])
  })
})


/** 会话档读的是官方目录，与 desko 的账号档案无关：种子只需 cwd 与标题 */
const SEED_SESSIONS = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [{ email: 'main@e2e.dev', plan_type: 'pro', current: true }],
    sessions: [
      // cached 是 input 里缓存命中的部分：官方把它整块算进 input，界面要拆开报
      { sessionId: 'sess-a1b2c3d4e5', title: '修全屏小记的排版', cwd: 'C:\ws\demo-notes', projectName: 'demo-notes', daysAgo: 0, input: 12300, cached: 11000, output: 1400, reasoning: 400, sizeBytes: 1536 },
      { sessionId: 'sess-f6g7h8i9j0', title: '查配额刷新链路', cwd: 'C:\ws\demo-notes', projectName: 'demo-notes', daysAgo: 2, input: 800, output: 120 },
      { sessionId: 'sess-k1l2m3n4o5', title: 'desko 侧栏图标盘点', cwd: 'C:\ws\demo-icons', daysAgo: 5, input: 45000, cached: 40000, output: 3200, reasoning: 900 },
      // 没标题的一条 + 子代理：完整 ID 与徽标同时可见。
      { sessionId: 'sess-p6q7r8s9t0', title: 'sess-p6q7r8s9t0', cwd: 'C:\ws\demo-notes', projectName: 'demo-notes', kind: 'subagent', daysAgo: 9, input: 2000, cached: 300, output: 300 },
    ],
  },
}

const LIST_CMD = 'codex_list_sessions_across_instances'
const STATS_CMD = 'codex_get_session_token_stats_across_instances'

async function argOf(page: Page, cmd: string, key: string) {
  const calls = await page.evaluate(
    (c) => (window as any).__E2E__.invocations.filter((x: { cmd: string }) => x.cmd === c),
    cmd,
  )
  return calls[calls.length - 1]?.args[key]
}

/** 进档会播种最近那一组：要点开别的组，先看清它是不是已经开着，别把展开点成折叠 */
async function expandGroup(page: Page, name: string) {
  const head = page.locator('.grp-head', { hasText: name })
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
}

test.describe('Codex 会话档', () => {
  /** 失败态下不会出现分组头，最后一等的东西由调用方给 */
  async function gotoSessions(page: Page, config = SEED_SESSIONS, until = '.grp-head') {
    await bootUnlocked(page, config)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator(until).first()).toBeVisible()
  }

  test('停在账号档不发会话命令，切过去取一次，切回不重取', async ({ page }) => {
    await bootUnlocked(page, SEED_SESSIONS)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    expect(await e2e.count(page, LIST_CMD)).toBe(0)

    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.grp-head').first()).toBeVisible()
    expect(await e2e.count(page, LIST_CMD)).toBe(1)

    await page.locator('.cx-tab', { hasText: '账号' }).click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.grp-head').first()).toBeVisible()
    expect(await e2e.count(page, LIST_CMD)).toBe(1)
  })

  test('首屏播种最近一组，进档即按全量 id 预取 token，展开不再补取', async ({ page }) => {
    await gotoSessions(page)
    await expect(page.locator('.grp-head')).toHaveCount(2)
    // 一排壳不算内容：最近活动那组进档即摊开，另一组仍归用户自己翻
    const notes = page.locator('.grp-head', { hasText: 'demo-notes' })
    await expect(notes).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.grp-head', { hasText: 'demo-icons' })).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.sess-row')).toHaveCount(3)
    // 本机实测 67 个 rollout 全量尾扫 218 ms：等展开才取会让合计量沉在水下
    await expect.poll(() => e2e.count(page, STATS_CMD)).toBe(1)
    expect((await argOf(page, STATS_CMD, 'sessionIds')).slice().sort()).toEqual([
      'sess-a1b2c3d4e5',
      'sess-f6g7h8i9j0',
      'sess-k1l2m3n4o5',
      'sess-p6q7r8s9t0',
    ])

    await notes.click()
    await expect(page.locator('.sess-row')).toHaveCount(0)
    await notes.click()
    await expect(page.locator('.sess-row')).toHaveCount(3)
    expect(await e2e.count(page, STATS_CMD)).toBe(1)
    // 净输入：官方累计的 12.3K 输入里 11K 是缓存重发；行上不摆数，整行悬停给五口径
    await expect(page.locator('.sess-row').first()).toHaveAttribute(
      'title',
      '修全屏小记的排版\n净输入 1,300 · 缓存命中 11,000 · 输出 1,400（含推理 400）· 官方累计 13,700',
    )
    // 无标题那条：完整 ID 上屏，悬停保留用量明细。
    const idRow = page.locator('.sess-row').last()
    await expect(idRow.locator('.sess-title')).toHaveText('sess-p6q7r8s9t0')
    await expect(idRow).toHaveAttribute('title', /^sess-p6q7r8s9t0\n净输入 1,700/)
    await expect(idRow.locator('.badge')).toHaveText('子代理')
  })

  test('搜索命中即展开：折叠的组不把结果藏在水下，清空回到用户态', async ({ page }) => {
    await gotoSessions(page)
    const icons = page.locator('.grp-head', { hasText: 'demo-icons' })
    await expect(icons).toHaveAttribute('aria-expanded', 'false')

    await page.locator('.page-bar .search-box input').fill('图标')
    await expect(icons).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.sess-row[data-sid="sess-k1l2m3n4o5"]')).toBeVisible()

    await page.locator('.search-clear').click()
    await expect(page.locator('.grp-head')).toHaveCount(2)
    await expect(icons).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.sess-row')).toHaveCount(3)
  })

  test('切到别的档再回来：翻开的组不丢', async ({ page }) => {
    await gotoSessions(page)
    const icons = page.locator('.grp-head', { hasText: 'demo-icons' })
    await icons.click()
    await expect(page.locator('.sess-row[data-sid="sess-k1l2m3n4o5"]')).toBeVisible()

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.grp-head')).toHaveCount(2)
    await expect(icons).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.sess-row[data-sid="sess-k1l2m3n4o5"]')).toBeVisible()
    // 面板卸挂重挂不该重扫目录，也不该重新播种把用户翻开的组抢走
    expect(await e2e.count(page, LIST_CMD)).toBe(1)
  })

  test('合计量上屏：hero 一笔、组头一位，展开行给六个口径', async ({ page }) => {
    await gotoSessions(page)
    await expect(page.locator('.hero-num')).toHaveText('65.1K')
    await expect(page.locator('.hero-sub')).toHaveText('2 个项目 · 4 条会话 · 净输入 8.8K · 输出 5K · 缓存命中 51.3K')
    await expect(page.locator('.grp-head').first().locator('.grp-tok > span')).toHaveText(['累计 16.9K Token', '净输入 3.8K', '输出 1.8K'])

    await expandGroup(page, 'demo-notes')
    const row = page.locator('.sess-row').first()
    // 行上只有标题与时间，用量进悬停；展开档才逐位铺开
    await expect(row.locator('.sess-time')).toBeVisible()
    await row.click()
    const facts = page.locator('.sess-card .sess-facts')
    await expect(facts.locator('dt')).toHaveText(['净输入', '缓存命中', '缓存写入', '输出', '其中推理', '官方累计'])
    await expect(facts.locator('dd')).toHaveText(['1,300', '11,000', '0', '1,400', '400', '13,700'])
  })

  test('标题搜索走后端：只填 trim 后的 titleQuery，contentQuery 恒 null', async ({ page }) => {
    await gotoSessions(page)
    await expect(page.locator('.grp-head')).toHaveCount(2)

    await page.locator('.page-bar .search-box input').fill('  查配额  ')
    await expect(page.locator('.grp-head')).toHaveCount(1)
    await expect(page.locator('.grp-head', { hasText: 'demo-notes' })).toBeVisible()
    expect(await e2e.count(page, LIST_CMD)).toBe(2)
    expect(await argOf(page, LIST_CMD, 'titleQuery')).toBe('查配额')
    expect(await argOf(page, LIST_CMD, 'contentQuery')).toBeNull()

    await expect(page.locator('.sess-title')).toHaveCount(1)
    await expect(page.locator('.sess-title')).toHaveText('查配额刷新链路')

    await page.locator('.search-clear').click()
    await expect(page.locator('.grp-head')).toHaveCount(2)
    expect(await argOf(page, LIST_CMD, 'titleQuery')).toBeNull()
  })

  test('读不到官方目录：整页错误块与重试，不静默出空列表', async ({ page }) => {
    await gotoSessions(page, {
      ...SEED_SESSIONS,
      codex: { ...SEED_SESSIONS.codex, sessionsFail: true },
    }, '.empty-state')
    await expect(page.locator('.empty-title')).toHaveText('读不到官方会话目录')
    await expect(page.locator('.grp-head')).toHaveCount(0)
    await expect(page.locator('.empty-desc')).toHaveAttribute('title', /官方会话目录不可读/)
    await page.locator('.empty-state .action-btn').click()
    expect(await e2e.count(page, LIST_CMD)).toBe(2)
  })
})

const TRASH_LIST_CMD = 'codex_list_trashed_sessions_across_instances'
const MOVE_CMD = 'codex_move_sessions_to_trash_across_instances'
const RESTORE_CMD = 'codex_restore_sessions_from_trash_across_instances'
const DELETE_CMD = 'codex_delete_trashed_sessions_across_instances'
const EMPTY_CMD = 'codex_empty_session_trash_across_instances'
const OPEN_DIR_CMD = 'codex_open_session_location'
const OPEN_FILE_CMD = 'codex_open_session_rollout'

/** 回收站与「打开」两族命令读的是 desko 自己的留底目录：种子只需标题、cwd、体积 */
const SEED_TRASH = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [{ email: 'main@e2e.dev', plan_type: 'pro', current: true }],
    sessions: [
      { sessionId: 'sess-a1b2c3d4e5', title: '修全屏小记的排版', cwd: 'C:\\ws\\demo-notes', projectName: 'demo-notes', daysAgo: 0, input: 12300, cached: 11000, output: 1400, sizeBytes: 1536 },
      { sessionId: 'sess-k1l2m3n4o5', title: 'desko 侧栏图标盘点', cwd: 'C:\\ws\\demo-icons', daysAgo: 5, input: 45000, cached: 40000, output: 3200 },
    ],
    trash: [
      { sessionId: 'sess-t1t2t3t4t5', title: '查配额刷新链路', cwd: 'C:\\ws\\demo-notes', daysAgo: 1, sizeBytes: 2048 },
      // 没标题的一条：回收站行上同样要收成短 ID
      { sessionId: 'sess-u6u7u8u9u0', title: 'sess-u6u7u8u9u0', cwd: 'C:\\ws\\demo-icons', daysAgo: 3, sizeBytes: 3 * 1024 * 1024 },
    ],
  },
}

const CONFIRM_OK = '.confirm-dialog .dialog-footer button'

test.describe('Codex 会话回收站', () => {
  async function gotoTab(page: Page, tab: string, until: string) {
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    await page.locator('.cx-tab', { hasText: tab }).click()
    await expect(page.locator(until).first()).toBeVisible()
  }

  test('移到回收站：先确认，官方列表与合计量同时收掉这条', async ({ page }) => {
    await bootUnlocked(page, SEED_SESSIONS)
    await gotoTab(page, '会话', '.grp-head')
    await expandGroup(page, 'demo-notes')
    await expect(page.locator('.hero-num')).toHaveText('65.1K')
    await expect(page.locator('.hero-sub')).toHaveText('2 个项目 · 4 条会话 · 净输入 8.8K · 输出 5K · 缓存命中 51.3K')

    const row = page.locator('.sess-row[data-sid="sess-a1b2c3d4e5"]')
    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.sess-acts .action-btn')).toHaveCount(3)

    await page.locator('.sess-card .trash-btn').click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toContainText('删除「修全屏小记的排版」？desko 先把会话文件留底进回收站（可还原）')
    await confirm.locator('button', { hasText: '取消' }).click()
    await expect(page.locator('.sess-row[data-sid="sess-a1b2c3d4e5"]')).toBeVisible()
    expect(await e2e.count(page, MOVE_CMD)).toBe(0)

    await page.locator('.sess-card .trash-btn').click()
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已将 1 条会话移到回收站')
    expect(await argOf(page, MOVE_CMD, 'sessionIds')).toEqual(['sess-a1b2c3d4e5'])
    await expect(page.locator('.sess-row[data-sid="sess-a1b2c3d4e5"]')).toHaveCount(0)
    // 合计量不能拿着已删的那条：65.1K 掉到 51.4K，缓存命中同步少 11K
    await expect(page.locator('.hero-num')).toHaveText('51.4K')
    await expect(page.locator('.hero-sub')).toHaveText('2 个项目 · 3 条会话 · 净输入 7.5K · 输出 3.6K · 缓存命中 40.3K')
    await expect(page.locator('.titlebar-count')).toHaveText('3 条')

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row')).toHaveCount(1)
    await expect(page.locator('.thr-title').first()).toHaveText('修全屏小记的排版')
    await expect(page.locator('.thr-l2').first()).toContainText('1.5 KB')
    await expect(page.locator('.thr-l2').first()).toContainText('删除')

    await page.locator('.thr-acts .action-btn').first().click()
    await expect(confirm).toContainText('把「修全屏小记的排版」的会话文件写回官方 Codex 目录')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已恢复 1 条会话')
    expect(await argOf(page, RESTORE_CMD, 'sessionIds')).toEqual(['sess-a1b2c3d4e5'])
    await expect(page.locator('.thr-row')).toHaveCount(0)
    await expect(page.locator('.empty-title')).toHaveText('回收站是空的')

    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.titlebar-count')).toHaveText('4 条')
    await expandGroup(page, 'demo-notes')
    await expect(page.locator('.sess-row[data-sid="sess-a1b2c3d4e5"]')).toBeVisible()
  })

  test('留底清单：时间倒序、体积分档、短 ID，删除与清空只动留底', async ({ page }) => {
    await bootUnlocked(page, SEED_TRASH)
    await gotoTab(page, '回收站', '.thr-row')
    await expect(page.locator('.thr-row')).toHaveCount(2)
    await expect(page.locator('.titlebar-count')).toHaveText('0 个账号 · 2 条会话')
    // 停在账号档与回收站档都不该去扫官方会话目录
    expect(await e2e.count(page, LIST_CMD)).toBe(0)

    const first = page.locator('.thr-row').first()
    await expect(first.locator('.thr-title')).toHaveText('查配额刷新链路')
    await expect(first.locator('.thr-l2')).toContainText(/删除/)
    await expect(first.locator('.thr-l2')).toContainText('2.0 KB')
    await expect(first.locator('.badge')).toHaveText('demo-notes')
    const second = page.locator('.thr-row').nth(1)
    await expect(second.locator('.thr-title')).toHaveText('sess-u6u…')
    await expect(second.locator('.thr-l2')).toContainText('3.0 MB')

    await second.locator('.action-btn.danger').click()
    await expect(page.locator('.confirm-dialog')).toContainText('这一步之后无法再恢复')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已永久删除 1 条回收站会话，释放约 3.0 MB')
    expect(await argOf(page, DELETE_CMD, 'sessionIds')).toEqual(['sess-u6u7u8u9u0'])
    await expect(page.locator('.thr-row')).toHaveCount(1)

    // 「清空」住在自己那一节的头上：两份留底各清各的
    const sessSec = page.locator('.thr-sec', { hasText: '会话留底' })
    await sessSec.locator('.thr-sec-act').click()
    await expect(page.locator('.confirm-dialog')).toContainText('彻底删除回收站里的 1 条会话留底？')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已清空 Codex 会话回收站，永久删除 1 条会话，释放约 2.0 KB')
    await expect(page.locator('.empty-title')).toHaveText('回收站是空的')
    // 两份留底都空了，节头连同「清空」一起退场
    await expect(page.locator('.thr-sec-act')).toHaveCount(0)
    expect(await e2e.count(page, LIST_CMD)).toBe(0)
  })

  test('进回收站档不扫官方目录，切回会话档才重扫', async ({ page }) => {
    await bootUnlocked(page, SEED_TRASH)
    await gotoTab(page, '会话', '.grp-head')
    expect(await e2e.count(page, LIST_CMD)).toBe(1)
    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row')).toHaveCount(2)
    expect(await e2e.count(page, LIST_CMD)).toBe(1)
    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.grp-head')).toHaveCount(2)
    expect(await e2e.count(page, LIST_CMD)).toBe(1)
  })

  test('打开位置与打开会话文件：按 sessionId 调用，成功不播 toast', async ({ page }) => {
    await bootUnlocked(page, SEED_SESSIONS)
    await gotoTab(page, '会话', '.grp-head')
    await expandGroup(page, 'demo-icons')
    await page.locator('.sess-row[data-sid="sess-k1l2m3n4o5"]').click()

    await page.locator('.sess-acts .action-btn').first().click()
    expect(await e2e.count(page, OPEN_DIR_CMD)).toBe(1)
    expect(await argOf(page, OPEN_DIR_CMD, 'sessionId')).toBe('sess-k1l2m3n4o5')
    await page.locator('.sess-acts .action-btn').nth(1).click()
    expect(await e2e.count(page, OPEN_FILE_CMD)).toBe(1)
    expect(await argOf(page, OPEN_FILE_CMD, 'sessionId')).toBe('sess-k1l2m3n4o5')
    await expect(page.locator('.toast')).toHaveCount(0)
    // 展开详情不取数：进档那一轮已经预取过
    expect(await e2e.count(page, STATS_CMD)).toBe(1)
  })

  test('系统程序打不开：一条红色 toast，列表一条不少', async ({ page }) => {
    await bootUnlocked(page, { ...SEED_TRASH, codex: { ...SEED_TRASH.codex, openFail: true } })
    await gotoTab(page, '会话', '.grp-head')
    await expandGroup(page, 'demo-notes')
    await page.locator('.sess-row').first().click()
    await page.locator('.sess-acts .action-btn').first().click()
    await expectToast(page, '打开系统程序失败（e2e）')
    await expect(page.locator('.sess-row')).toHaveCount(1)
  })

  test('回收站读不到：整页错误块与重试，不读成「回收站是空的」', async ({ page }) => {
    await bootUnlocked(page, { ...SEED_TRASH, codex: { ...SEED_TRASH.codex, trashFail: true } })
    await gotoTab(page, '回收站', '.empty-state')
    await expect(page.locator('.empty-title')).toHaveText('读不到回收站清单')
    await expect(page.locator('.empty-desc')).toHaveAttribute('title', /回收站清单不可读/)
    await page.locator('.empty-state .action-btn').click()
    expect(await e2e.count(page, TRASH_LIST_CMD)).toBe(2)
  })

  test('移到回收站失败：红色 toast，官方列表与留底都不动', async ({ page }) => {
    await bootUnlocked(page, { ...SEED_SESSIONS, codex: { ...SEED_SESSIONS.codex, trashFail: true } })
    await gotoTab(page, '会话', '.grp-head')
    await expandGroup(page, 'demo-notes')
    await page.locator('.sess-row').first().click()
    await page.locator('.sess-card .trash-btn').click()
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '会话移入回收站失败（e2e）')
    await expect(page.locator('.sess-row')).toHaveCount(3)
    expect(await e2e.count(page, TRASH_LIST_CMD)).toBe(0)
  })
})

const RECYCLED_LIST_CMD = 'list_codex_recycled_accounts'
const RECYCLED_RESTORE_CMD = 'restore_codex_recycled_account'
const RECYCLED_DELETE_CMD = 'delete_codex_recycled_account'
const RECYCLED_EMPTY_CMD = 'empty_codex_recycle_bin'

/** 两份留底同时在档：分区顺序、各自小计与「清空只管自己那一节」都要拍得到 */
const SEED_BOTH = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [{ email: 'main@e2e.dev', plan_type: 'pro', current: true }],
    sessions: [
      { sessionId: 'sess-a1b2c3d4e5', title: '修全屏小记的排版', cwd: 'C:\\ws\\demo-notes', daysAgo: 0, input: 12300, output: 1400 },
    ],
    trash: [
      { sessionId: 'sess-t1t2t3t4t5', title: '查配额刷新链路', cwd: 'C:\\ws\\demo-notes', daysAgo: 1, sizeBytes: 2048 },
    ],
    recycled: [
      { email: 'old@e2e.dev', account_name: '旧手机上的号', plan_type: 'plus', hoursAgo: 6 },
      // 没名字的留底：行上必须退回邮箱，不能摆个空白标题
      { email: 'gone@e2e.dev', plan_type: 'pro', hoursAgo: 30 },
    ],
  },
}

/** 只剩账号留底的一档：错误块要在两份清单都读不出东西时才拍得到 */
const SEED_ACC_ONLY = {
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [{ email: 'main@e2e.dev', plan_type: 'pro', current: true }],
    recycled: SEED_BOTH.codex.recycled,
  },
}

test.describe('Codex 账号回收站', () => {
  async function gotoTrash(page: Page, config = SEED_BOTH, until = '.thr-row') {
    await bootUnlocked(page, config)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator(until).first()).toBeVisible()
  }

  test('两份留底分区显示：账号在上、会话在下，页头各计各的', async ({ page }) => {
    await gotoTrash(page)
    await expect(page.locator('.thr-sec-title')).toHaveText(['账号留底', '会话留底'])
    await expect(page.locator('.titlebar-count')).toHaveText('2 个账号 · 1 条会话')
    const first = page.locator('.thr-row[data-rid]').first()
    await expect(first.locator('.thr-title')).toHaveText('旧手机上的号')
    await expect(first.locator('.badge')).toHaveText('plus')
    await expect(first.locator('.thr-sub')).toHaveText('old@e2e.dev')
    await expect(first.locator('.thr-l2')).toContainText(/删除/)
    await expect(page.locator('.thr-row[data-rid]').nth(1).locator('.thr-title')).toHaveText('gone@e2e.dev')
    // 标题已经是邮箱时，第二行不得再复读一遍
    await expect(page.locator('.thr-row[data-rid]').nth(1).locator('.thr-sub')).toHaveCount(0)
    // 快照只出摘要那几列：行上不得出现凭据字段的形状
    await expect(page.locator('.thr-row').first()).not.toContainText('at-e2e')
    await expect(page.locator('.page-note')).toContainText('账号留底是加密快照')
  })

  test('删除账号真的落进留底：账号页少一条、回收站多一行，恢复后回到列表', async ({ page }) => {
    await gotoCodex(page, TWO)
    await rowMenu(page, 'back@e2e.dev', '删除')
    await expect(page.locator('.confirm-dialog')).toContainText('会移进回收站、留一份加密底')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已移进回收站')
    await expect(page.locator('.acc-row')).toHaveCount(1)

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(1)
    await expect(page.locator('.thr-title').first()).toHaveText('back@e2e.dev')
    expect(await e2e.count(page, RECYCLED_LIST_CMD)).toBe(1)

    await page.locator('.thr-acts .action-btn').first().click()
    await expect(page.locator('.confirm-dialog')).toContainText('官方凭据从头到尾没被动过')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已恢复到账号列表')
    expect(await argOf(page, RECYCLED_RESTORE_CMD, 'recycleId')).toBeTruthy()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(0)
    await expect(page.locator('.empty-title')).toHaveText('回收站是空的')

    // 恢复的判据不是留底行少了，而是那条号真的回到账号页
    await page.locator('.cx-tab', { hasText: '账号' }).click()
    await expect(page.locator('.acc-row')).toHaveCount(2)
    await expect(accountRow(page, 'back@e2e.dev')).toBeVisible()
  })

  test('彻底删除只掉一行；清空发的是刚看到的那批 id', async ({ page }) => {
    await gotoTrash(page)
    const gone = await page.locator('.thr-row[data-rid]').first().getAttribute('data-rid')
    await page.locator('.thr-row[data-rid]').first().locator('.action-btn.danger').click()
    await expect(page.locator('.confirm-dialog')).toContainText('删除「旧手机上的号」在 desko 里的加密留底？')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已彻底删除这条留底')
    expect(await argOf(page, RECYCLED_DELETE_CMD, 'recycleId')).toBe(gone)
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(1)

    const rest = await page.locator('.thr-row[data-rid]').first().getAttribute('data-rid')
    await page.locator('.thr-sec', { hasText: '账号留底' }).locator('.thr-sec-act').click()
    await expect(page.locator('.confirm-dialog')).toContainText('彻底删除回收站里的 1 条账号留底？')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已彻底删除 1 条留底')
    expect(await argOf(page, RECYCLED_EMPTY_CMD, 'recycleIds')).toEqual([rest])
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(0)
    // 账号那一节清空不牵连会话那一节
    await expect(page.locator('.thr-row[data-sid]')).toHaveCount(1)
    await expect(page.locator('.titlebar-count')).toHaveText('0 个账号 · 1 条会话')
  })

  test('批量删除也是逐条留底', async ({ page }) => {
    await gotoCodex(page, TWO)
    await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
    await accountRow(page, 'main@e2e.dev').click()
    await accountRow(page, 'back@e2e.dev').click()
    await page.locator('.batch-dock .dock-btn', { hasText: '删除选中' }).click()
    await expect(page.locator('.confirm-dialog')).toContainText('它们在 Desko 里的记录会移进回收站留加密底')
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    const dialog = page.locator('.batch-delete-dialog')
    await expect(dialog.locator('.bd-done')).toHaveText('2')
    await dialog.locator('.dialog-footer button', { hasText: '关闭' }).click()
    await expect(page.locator('.acc-row')).toHaveCount(0)

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(2)
    await expect(page.locator('.titlebar-count')).toHaveText('2 个账号 · 0 条会话')
  })

  test('留底读不到：错误块与重试，不读成「回收站是空的」', async ({ page }) => {
    await gotoTrash(page, { ...SEED_ACC_ONLY, codex: { ...SEED_ACC_ONLY.codex, recycledFail: true } }, '.empty-state')
    await expect(page.locator('.empty-title')).toHaveText('读不到回收站清单')
    await expect(page.locator('.empty-desc')).toHaveAttribute('title', /账号回收目录不可读/)
    await page.locator('.empty-state .action-btn').click()
    expect(await e2e.count(page, RECYCLED_LIST_CMD)).toBe(2)
  })

  test('两份留底都扫官方目录之外：停在回收站不发会话列表命令', async ({ page }) => {
    await gotoTrash(page)
    expect(await e2e.count(page, LIST_CMD)).toBe(0)
    expect(await e2e.count(page, RECYCLED_LIST_CMD)).toBe(1)
    await page.locator('.page-bar .cx-refresh').click()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(2)
    expect(await e2e.count(page, RECYCLED_LIST_CMD)).toBe(2)
  })
})

const DELETE_START_CMD = 'start_codex_batch_delete'
const DELETE_GET_CMD = 'get_codex_batch_delete'
const DELETE_CLEAR_CMD = 'clear_codex_batch_delete'

/** 四条号 + 逐条延时：删除作业没有中间态就等于没做，暂停与续跑都要有东西可断言 */
const FOUR = (extra: Record<string, unknown> = {}) => ({
  settings: { codex_enabled: 'true' },
  codex: {
    accounts: [
      { email: 'd1@e2e.dev' },
      { email: 'd2@e2e.dev' },
      { email: 'd3@e2e.dev' },
      { email: 'd4@e2e.dev' },
    ],
    ...extra,
  },
})
const FOUR_EMAILS = ['d1@e2e.dev', 'd2@e2e.dev', 'd3@e2e.dev', 'd4@e2e.dev']

/** 勾满四条 → 删除选中 → 确认，回来的是作业弹窗 */
async function startDeleteJob(page: Page, config = FOUR()) {
  await gotoCodex(page, config)
  await page.locator('.page-bar .bar-btn', { hasText: '选择' }).click()
  for (const email of FOUR_EMAILS) await accountRow(page, email).click()
  await page.locator('.batch-dock .dock-btn', { hasText: '删除选中' }).click()
  await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
  const dialog = page.locator('.batch-delete-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Codex 批量删除作业', () => {
  test('弹窗按 jobId 轮询，逐条推进到终态即停', async ({ page }) => {
    const dialog = await startDeleteJob(page, FOUR({ deleteStepMs: 260 }))
    await expect(dialog).toHaveAttribute('data-status', 'completed')
    await expect(dialog.locator('.bd-done')).toHaveText('4')
    await expect(dialog.locator('.bd-total')).toHaveText('4')
    expect(await e2e.count(page, DELETE_START_CMD)).toBe(1)
    expect(await e2e.count(page, DELETE_GET_CMD)).toBeGreaterThan(1)
    // 终态之后不再白问：轮询停在 completed 那一拍
    const after = await e2e.count(page, DELETE_GET_CMD)
    await page.waitForTimeout(900)
    expect(await e2e.count(page, DELETE_GET_CMD)).toBe(after)
  })

  test('暂停停在中间：已删的那几条进回收站，续跑接着删剩下的', async ({ page }) => {
    const dialog = await startDeleteJob(page, FOUR({ deleteStepMs: 260 }))
    await expect(dialog.locator('.bd-done')).not.toHaveText('0')
    await dialog.locator('.dialog-footer button', { hasText: '暂停' }).click()
    await expect(dialog).toHaveAttribute('data-status', 'paused')

    const frozen = await dialog.locator('.bd-done').innerText()
    await page.waitForTimeout(900)
    // 暂停之后计数必须钉住：剩下的没动
    await expect(dialog.locator('.bd-done')).toHaveText(frozen)
    await expect(dialog.locator('.bd-total')).toHaveText('4')
    const done = Number(frozen)
    expect(done).toBeLessThan(4)
    await expect(page.locator('.acc-row')).toHaveCount(4 - done)

    await dialog.locator('.dialog-footer button', { hasText: '继续' }).click()
    await expect(dialog).toHaveAttribute('data-status', 'completed')
    await expect(page.locator('.acc-row')).toHaveCount(0)
    await dialog.locator('.dialog-footer button', { hasText: '关闭' }).click()

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(4)
  })

  test('失败条目进明细并带开局抄下的邮箱，重试只跑那几条', async ({ page }) => {
    const dialog = await startDeleteJob(page, FOUR({ deleteFailEmails: ['d2@e2e.dev'] }))
    await expect(dialog).toHaveAttribute('data-status', 'failed')
    await expect(dialog.locator('.bd-done')).toHaveText('4')
    await expect(dialog.locator('.bd-fail')).toContainText('失败')
    await expect(dialog.locator('.bd-row')).toHaveCount(1)
    await expect(dialog.locator('.bd-mail')).toHaveText('d2@e2e.dev')
    await expect(dialog.locator('.bd-err')).toHaveText('令牌已失效，这一条删不掉（e2e）')
    // 没删掉的那条还留在账号页，明细里的邮箱却早已不在列表里——反查必 miss
    await expect(page.locator('.acc-row')).toHaveCount(1)

    await dialog.locator('.dialog-footer button', { hasText: '重试失败' }).click()
    await expect(dialog).toHaveAttribute('data-status', 'completed')
    // 重试这一轮重新计数：total 是失败的那 1 条，不是原来的 4 条
    await expect(dialog.locator('.bd-total')).toHaveText('1')
    await expect(dialog.locator('.bd-done')).toHaveText('1')
    await expect(dialog.locator('.bd-list')).toHaveCount(0)
    await expect(page.locator('.acc-row')).toHaveCount(0)

    await dialog.locator('.dialog-footer button', { hasText: '关闭' }).click()
    await expect(page.locator('.batch-delete-dialog')).toHaveCount(0)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    expect(await e2e.count(page, DELETE_CLEAR_CMD)).toBe(1)
  })

  test('收窗不停作业：dock 那条入口就是重开的把手，切页面回来还在', async ({ page }) => {
    const dialog = await startDeleteJob(page, FOUR({ deleteStepMs: 260 }))
    await expect(dialog).toHaveAttribute('data-status', 'running')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.batch-delete-dialog')).toHaveCount(0)

    const dockJob = page.locator('.batch-dock .dock-btn.job')
    await expect(dockJob).toBeVisible()
    await expect(dockJob).toContainText('删除中')
    // 换档时 dock 随账号页一起收起，作业本身不因此停一拍
    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    await page.locator('.cx-tab', { hasText: '账号' }).click()
    await expect(dockJob).toBeVisible()

    await dockJob.click()
    const again = page.locator('.batch-delete-dialog')
    await expect(again).toBeVisible()
    await expect(again.locator('.bd-done')).not.toHaveText('0')
    await expect(again).toHaveAttribute('data-status', 'completed')
    await again.locator('.dialog-footer button', { hasText: '关闭' }).click()
    await expect(page.locator('.batch-dock')).toHaveCount(0)
  })

  test('放弃暂停中的任务：走 clear，已删掉的那几条留在回收站', async ({ page }) => {
    const dialog = await startDeleteJob(page, FOUR({ deleteStepMs: 260 }))
    await expect(dialog.locator('.bd-done')).not.toHaveText('0')
    await dialog.locator('.dialog-footer button', { hasText: '暂停' }).click()
    await expect(dialog).toHaveAttribute('data-status', 'paused')
    const done = Number(await dialog.locator('.bd-done').innerText())

    await dialog.locator('.dialog-footer button', { hasText: '放弃任务' }).click()
    const confirm = page.locator('.confirm-dialog')
    await expect(confirm).toContainText('已删掉的账号仍在回收站中')
    expect(await e2e.count(page, DELETE_CLEAR_CMD)).toBe(0)
    await confirm.getByRole('button', { name: '取消', exact: true }).click()
    await expect(dialog).toHaveAttribute('data-status', 'paused')
    expect(await e2e.count(page, DELETE_CLEAR_CMD)).toBe(0)
    await dialog.locator('.dialog-footer button', { hasText: '放弃任务' }).click()
    await confirm.getByRole('button', { name: '确定', exact: true }).click()
    await expectToast(page, '已放弃这个删除任务，删掉的账号在回收站里可以还原')
    await expect(page.locator('.batch-delete-dialog')).toHaveCount(0)
    await expect(page.locator('.batch-dock')).toHaveCount(0)
    expect(await e2e.count(page, DELETE_CLEAR_CMD)).toBe(1)
    // 放弃不回滚：删掉的那几条就是那几条
    await expect(page.locator('.acc-row')).toHaveCount(4 - done)

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.thr-row[data-rid]')).toHaveCount(done)
  })
})

const USAGE_CMD = 'codex_query_session_usage'
/** 用量档读的还是那四条官方会话：图与「会话」档的合计量必须同账，种子因此直接复用 */
test.describe('Codex 用量图', () => {
  async function gotoUsage(page: Page, config = SEED_SESSIONS, until = '.usg-sum') {
    await bootUnlocked(page, config)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    await page.locator('.cx-tab', { hasText: '用量' }).click()
    await page.getByRole('navigation', { name: '统计窗口' }).getByRole('button', { name: '近 30 天', exact: true }).click()
    await expect(page.locator(until).first()).toBeVisible()
  }

  const localMidnightSec = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }

  test('停在别的档不扫目录，切过来扫一次，切回再切来不重扫', async ({ page }) => {
    await bootUnlocked(page, SEED_SESSIONS)
    await page.locator('a.nav-item[href="/codex"]').click()
    await expect(page.locator('.acc-row').first()).toBeVisible()
    expect(await e2e.count(page, USAGE_CMD)).toBe(0)

    await page.locator('.cx-tab', { hasText: '用量' }).click()
    await expect(page.locator('.usg-sum')).toBeVisible()
    expect(await e2e.count(page, USAGE_CMD)).toBe(1)

    await page.locator('.cx-tab', { hasText: '账号' }).click()
    await page.locator('.cx-tab', { hasText: '用量' }).click()
    await expect(page.locator('.usg-sum')).toBeVisible()
    expect(await e2e.count(page, USAGE_CMD)).toBe(1)
  })

  test('总量行与柱子同账：净输入拆开缓存、模型表按量降序、扫描耗时上屏', async ({ page }) => {
    await gotoUsage(page)
    // 会话档那一页报的是 65.1K，图上必须落在同一个数
    await expect(page.locator('.usg-num')).toHaveText('65,120')
    await expect(page.locator('[data-metric="fresh"] dd')).toHaveText('8,800')
    await expect(page.locator('[data-metric="cached"] dd')).toHaveText('51,300')
    await expect(page.locator('[data-metric="output"] dd')).toHaveText('5,020')
    await expect(page.locator('.usg-facts')).toContainText('输出中含推理 1,300')
    await expect(page.locator('.usg-count')).toHaveText('5 轮 · 4 条会话')
    await expect(page.locator('.titlebar-count')).toHaveText('5 轮')

    // 四条会话落在四个本地日上，最满那天按输入 + 输出 = 48.2K 标定。
    await expect(page.locator('.usg-col')).toHaveCount(4)
    await expect(page.locator('.usg-bars')).toHaveAttribute('data-days', '4')
    await expect(page.locator('.usg-bars')).toHaveAttribute('data-max', '48200')
    const seg = async (index: number) =>
      page
        .locator('.usg-col')
        .nth(index)
        .evaluate((el) => ({
          fresh: (el.querySelector('.usg-fresh') as HTMLElement).style.height,
          cached: (el.querySelector('.usg-cached') as HTMLElement).style.height,
        }))
    expect(await seg(1)).toEqual({ fresh: '10.4%', cached: '83%' })
    expect(await seg(0)).toEqual({ fresh: '3.5%', cached: '0.6%' })
    await expect(page.locator('.usg-day-row')).toHaveCount(4)
    await expect(page.locator('.usg-day-total').first()).toHaveText('13,700')
    await expect(page.locator('.usg-scan')).toHaveText('扫了 4 个文件 · 1.7 s')

    await expect(page.locator('.usg-model-row')).toHaveCount(2)
    await expect(page.locator('.usg-model-row').first().locator('.usg-model-name')).toHaveText('gpt-5.1-codex')
    await expect(page.locator('.usg-model-row').first().locator('.usg-model-num')).toHaveText('61,900')
    await expect(page.locator('.usg-model-row').first().locator('.usg-model-pct')).toHaveText('95.1%')
    await expect(page.locator('.usg-model-row').nth(1).locator('.usg-model-pct')).toHaveText('4.9%')
    const fill = await page.locator('.usg-model-row').first().locator('.usg-fill').evaluate((el) => (el as HTMLElement).style.width)
    expect(fill).toBe('95.1%')
  })

  test('切窗口只换起点：周档筛掉 9 天前那条，全部档不带起点', async ({ page }) => {
    await gotoUsage(page)
    expect(await argOf(page, USAGE_CMD, 'fromTimestamp')).toBe(localMidnightSec() - 29 * 86_400)
    expect(Math.abs(await argOf(page, USAGE_CMD, 'toTimestamp') - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1)

    await page.locator('.cx-tab', { hasText: '近 7 天' }).click()
    await expect(page.locator('.usg-num')).toHaveText('62,820')
    expect(await argOf(page, USAGE_CMD, 'fromTimestamp')).toBe(localMidnightSec() - 6 * 86_400)
    await expect(page.locator('.usg-col')).toHaveCount(3)
    // 文件还在那儿：筛掉的是窗口，不是扫过的目录
    await expect(page.locator('.usg-scan')).toHaveText('扫了 4 个文件 · 1.7 s')

    await page.locator('.cx-tab', { hasText: '全部' }).click()
    expect(await argOf(page, USAGE_CMD, 'fromTimestamp')).toBe(null)
    await expect(page.locator('.usg-num')).toHaveText('65,120')

    // 同档再点一次：账没变就不该重扫
    const before = await e2e.count(page, USAGE_CMD)
    await page.locator('.cx-tab', { hasText: '全部' }).click()
    expect(await e2e.count(page, USAGE_CMD)).toBe(before)
  })

  test('读不到用量：整页错误块与重试，不读成「这个窗口没有记录」', async ({ page }) => {
    await gotoUsage(
      page,
      { ...SEED_SESSIONS, codex: { ...SEED_SESSIONS.codex, usageFail: true } },
      '.empty-state',
    )
    await expect(page.locator('.empty-title')).toHaveText('读不到用量')
    await expect(page.locator('.empty-desc')).toHaveAttribute('title', /用量统计失败/)
    await expect(page.locator('.usg-chart')).toHaveCount(0)
    await page.locator('.empty-state .action-btn').click()
    expect(await e2e.count(page, USAGE_CMD)).toBe(3)
  })

  test('范围里没有记录：明确显示零与空态，切换全部可以查看旧记录', async ({ page }) => {
    await gotoUsage(page, {
      ...SEED_SESSIONS,
      codex: {
        ...SEED_SESSIONS.codex,
        sessions: [{ sessionId: 'sess-old12345', title: '一个月前的旧账', cwd: 'C:\\ws\\demo-notes', daysAgo: 40, input: 5000, output: 500 }],
      },
    }, '.empty-state')
    await expect(page.locator('.empty-title')).toHaveText('这段时间没有用量记录')
    await expect(page.locator('.usg-num')).toHaveText('0')
    await expect(page.locator('.usg-chart')).toHaveCount(0)

    await page.locator('.cx-tab', { hasText: '全部' }).click()
    await expect(page.locator('.usg-num')).toHaveText('5,500')
    await expect(page.locator('.usg-col')).toHaveCount(1)
  })

  test('移到回收站后回用量档：那一天少一笔，页头轮数跟着减', async ({ page }) => {
    await gotoUsage(page)
    await expect(page.locator('.usg-num')).toHaveText('65,120')

    await page.locator('.cx-tab', { hasText: '会话' }).click()
    await expandGroup(page, 'demo-notes')
    await page.locator('.sess-row[data-sid="sess-a1b2c3d4e5"]').click()
    await page.locator('.sess-card .trash-btn').click()
    await page.locator(CONFIRM_OK, { hasText: '确定' }).click()
    await expectToast(page, '已将 1 条会话移到回收站')

    await page.locator('.cx-tab', { hasText: '用量' }).click()
    await expect(page.locator('.usg-num')).toHaveText('51,420')
    await expect(page.locator('.usg-col')).toHaveCount(3)
    await expect(page.locator('.titlebar-count')).toHaveText('4 轮')
    // 图是官方目录的镜子：只有这一次移动值得重扫，来回切档不再打第二次
    expect(await e2e.count(page, USAGE_CMD)).toBe(3)
  })

  test('只动留底的彻底删除与清空不碰图：回用量档不发网络', async ({ page }) => {
    await gotoUsage(page)
    expect(await e2e.count(page, USAGE_CMD)).toBe(2)

    await page.locator('.cx-tab', { hasText: '回收站' }).click()
    await expect(page.locator('.empty-title')).toHaveText('回收站是空的')

    await page.locator('.cx-tab', { hasText: '用量' }).click()
    await expect(page.locator('.usg-sum')).toBeVisible()
    expect(await e2e.count(page, USAGE_CMD)).toBe(2)
  })
})
