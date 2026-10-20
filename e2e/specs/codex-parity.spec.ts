import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast } from '../helpers'

const seed = {
  settings: { codex_enabled: 'true' },
  codex: { accounts: [
    { email: 'main@e2e.dev', account_name: '主力', plan_type: 'pro', current: true, hourly: 80, weekly: 60, tags: ['工作'] },
    { email: 'need@e2e.dev', reauth: true, plan_type: 'plus', hourly: 10, weekly: 80, tags: ['工作'] },
    { email: 'key@e2e.dev', auth_mode: 'apikey' as const, api_base_url: 'https://api.example.com/v1' },
  ] },
}

async function boot(page: Page) {
  await bootUnlocked(page, seed, '/codex')
  await expect(page.locator('.acc-row')).toHaveCount(3)
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitemradio', { name: option, exact: true }).click()
}

test('账号可以用邮箱搜索，并叠加类型、状态和标签筛选', async ({ page }) => {
  await boot(page)
  await page.getByRole('textbox', { name: '搜索 Codex 账号' }).fill(' MAIN@ ')
  await expect(page.locator('.acc-row')).toHaveCount(1)
  await expect(page.locator('.acc-row .mail')).toHaveText('主力')
  await expect(page.locator('.account-summary')).toContainText('1 / 3')
  await page.getByRole('button', { name: '清除账号搜索' }).click()
  await pick(page, '账号类型', 'OAuth')
  await pick(page, '账号标签', '#工作')
  await pick(page, '账号状态', '需处理')
  await expect(page.locator('.acc-row')).toHaveCount(1)
  await expect(page.locator('.acc-row')).toHaveAttribute('data-email', 'need@e2e.dev')
  await page.locator('.filter-reset').click()
  await expect(page.locator('.acc-row')).toHaveCount(3)
  await pick(page, '账号排序', '可用配额优先')
  await expect(page.locator('.acc-row').first()).toHaveAttribute('data-email', 'key@e2e.dev')
  await expect(page.locator('.acc-row').last()).toHaveAttribute('data-email', 'need@e2e.dev')
})

test('筛选结果的全选只增加当前可见账号，导出不夹带其他账号', async ({ page }) => {
  await boot(page)
  await page.getByRole('textbox', { name: '搜索 Codex 账号' }).fill('工作')
  await page.getByRole('button', { name: '选择', exact: true }).click()
  await page.locator('.acc-row .pick-box').first().click()
  await page.getByRole('button', { name: '全选筛选结果', exact: true }).click()
  await expect(page.locator('.dock-count')).toHaveText('已选 2 条')
  await page.getByRole('button', { name: '导出所选 JSON', exact: true }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  const accounts = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())).accounts
  expect(accounts.map((a: { email: string }) => a.email).sort()).toEqual(['main@e2e.dev', 'need@e2e.dev'])
})

test('会话正文搜索接入本地正文查询，切换搜索范围保留关键词', async ({ page }) => {
  await bootUnlocked(page, {
    ...seed,
    codex: { ...seed.codex, sessions: [
      { sessionId: 'one', title: '更新侧栏', cwd: 'C:\\demo', content: '变更记录：修复布局' },
      { sessionId: 'two', title: '其他会话', cwd: 'C:\\other', content: '无关正文' },
    ] },
  }, '/codex')
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索会话标题' }).fill('变更记录')
  await expect(page.locator('.empty-title')).toHaveText('没有标题匹配的会话')
  await page.getByRole('group', { name: '会话搜索范围' }).getByRole('button', { name: '正文' }).click()
  await expect(page.getByRole('textbox', { name: '搜索会话正文' })).toHaveValue('变更记录')
  await expect(page.locator('.grp-head')).toHaveCount(1)
  const calls = await page.evaluate(() => (window as any).__E2E__.invocations.filter((c: any) => c.cmd === 'codex_list_sessions_across_instances'))
  expect(calls.at(-1).args).toEqual({ titleQuery: null, contentQuery: '变更记录' })
})

for (const theme of ['paper', 'ink']) {
  for (const width of [800, 1280]) {
    test(`${theme} ${width}px 会话搜索范围保持分段样式与选中态`, async ({ page }) => {
      await page.setViewportSize({ width, height: 760 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await bootUnlocked(page, { settings: { codex_enabled: 'true', theme } }, '/codex')
      await page.getByRole('button', { name: '会话', exact: true }).click()
      const group = page.getByRole('group', { name: '会话搜索范围' })
      const title = group.getByRole('button', { name: '标题', exact: true })
      const content = group.getByRole('button', { name: '正文', exact: true })
      const font = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily)
      for (const button of [title, content]) {
        await expect(button).toHaveCSS('height', '30px')
        await expect(button).toHaveCSS('border-top-width', '0px')
        await expect(button).toHaveCSS('font-family', font)
        expect(await button.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeGreaterThanOrEqual(4)
      }
      await expect(title).toHaveAttribute('aria-pressed', 'true')
      await expect(title).toHaveCSS('font-weight', '600')
      const selected = await title.evaluate(element => getComputedStyle(element).backgroundColor)
      expect(selected).not.toBe('rgba(0, 0, 0, 0)')
      await expect(content).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await content.click()
      await expect(content).toHaveAttribute('aria-pressed', 'true')
      await expect(content).toHaveCSS('background-color', selected)
      await expect(content).toHaveCSS('font-weight', '600')
      await expect(title).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.getByRole('textbox', { name: '搜索会话正文' })).toBeVisible()
      await page.screenshot({ path: `.tmp/codex-search-style/${theme}-${width}.png`, animations: 'disabled' })
    })
  }
}

for (const mode of ['access', 'tokens'] as const) {
  test(`已有 Token 可以从导入面导入：${mode}`, async ({ page }) => {
    await boot(page)
    await page.locator('.add-btn').click()
    await page.getByRole('button', { name: '导入已有凭据', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '导入 Codex 账号', exact: true })
    await dialog.getByRole('tab', { name: 'Token', exact: true }).click()
    if (mode === 'access') await dialog.getByLabel(/^账号名称/).fill('导入的 Token 账号')
    else {
      await dialog.getByRole('button', { name: 'Token 组合', exact: true }).click()
      await dialog.getByLabel(/^ID Token/).fill('synthetic-id-token')
      await dialog.getByLabel('Refresh Token（可选）', { exact: true }).fill('synthetic-refresh-token')
    }
    await dialog.getByLabel(/^Access Token/).fill('at-synthetic-token')
    await dialog.getByRole('button', { name: '导入 Token', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('.acc-row')).toHaveCount(4)
    expect(await e2e.count(page, mode === 'access' ? 'import_codex_access_token_account' : 'add_codex_account_with_token')).toBe(1)
    expect(await e2e.count(page, 'get_codex_quick_config')).toBe(0)
  })
}

test('只修改 API 地址而没有新密钥时明确提示，不能显示假保存成功', async ({ page }) => {
  await boot(page)
  await page.locator('.acc-row[data-email="key@e2e.dev"] .acc-more').click()
  await page.locator('.popover button', { hasText: '账号与密钥' }).click()
  const dialog = page.locator('.edit-dialog')
  await dialog.getByLabel('接口地址', { exact: true }).fill('https://other.example.com/v1')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expectToast(page, '修改接口地址时请重新填写 API Key')
  await expect(dialog).toBeVisible()
  expect(await e2e.count(page, 'update_codex_api_key_credentials')).toBe(0)
  expect(await e2e.count(page, 'update_codex_account_name')).toBe(0)
})

test('800px 窗口下账号筛选与配额不超出内容区域', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 680 })
  await boot(page)
  const overflow = await page.locator('.content-inner').evaluate(el => el.scrollWidth > el.clientWidth)
  expect(overflow).toBe(false)
  await expect(page.getByRole('button', { name: '账号排序', exact: true })).toBeVisible()
  const positions = await page.locator('.acc-row').first().evaluate(el => {
    const main = el.querySelector('.acc-main')!.getBoundingClientRect()
    const quota = el.querySelector('.acc-quota')!.getBoundingClientRect()
    return { quotaTop: quota.top, mainBottom: main.bottom }
  })
  expect(positions.quotaTop).toBeGreaterThanOrEqual(positions.mainBottom)
})
