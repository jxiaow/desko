import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane } from '../helpers'

const ON = {
  settings: { fileshare_enabled: 'true' },
  fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared'] },
}

async function gotoFileshare(page: Page, config = ON) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/fileshare"]').click()
  await expect(page.locator('.dir-add')).toBeVisible()
}

test.describe('局域网文件传输', () => {
  test('开关默认关：没有侧栏入口，直达 /fileshare 被带回条目页', async ({ page }) => {
    await bootUnlocked(page, {}, '/fileshare')
    await expect(page).toHaveURL(/\/entries$/)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
    expect(await e2e.count(page, 'fileshare_status')).toBe(0)
  })

  test('开关只开入口不自动起服务，模块页手动启动才监听', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'general')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '局域网文件传输' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '局域网传输已开启')
    expect(await e2e.count(page, 'fileshare_start')).toBe(0)
    await dialog.locator('.close-btn').click()
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.bar-count')).toContainText('已停止')
    await expect(page.locator('.group-row.dim')).toContainText('服务停止中')
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '服务已启动')
    await expect(page.locator('.bar-count')).toContainText('监听中')
  })

  test('启动失败（端口全被占）：提示原因、保持已停止', async ({ page }) => {
    await bootUnlocked(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { port: 9999 },
    })
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.dir-add')).toBeVisible()
    await expect(page.locator('.bar-count')).toContainText('已停止')
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '被占用')
    await expect(page.locator('.bar-count')).toContainText('已停止')
  })

  test('管理页渲染运行状态与地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.bar-count')).toContainText('监听中')
    await expect(page.locator('.url-row.lan').locator('code')).toContainText('http://10.0.0.9:8000')
    await expect(page.locator('.url-row.local').locator('code')).toContainText('http://127.0.0.1:8000')
    await expect(page.locator('.page-bar .btn-primary')).toHaveText('停止服务')
    await expect(page.locator('.cfg-summary')).toContainText('端口 8000 · 对局域网开放 · 口令未设')
    await expect(page.locator('.dir-row')).toHaveCount(1)
  })

  test('添加共享目录即时保存并出现在列表', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.dir-add').fill('D:\\share\\docs')
    await page.locator('.dir-add-row button', { hasText: '添加' }).click()
    await expectToast(page, '共享目录已更新')
    await expect(page.locator('.dir-row')).toHaveCount(2)
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.shareDirs).toEqual(['C:\\desko-e2e\\shared', 'D:\\share\\docs'])
  })

  test('删除最后一个目录被拦下，不发保存', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.dir-row')).toHaveCount(1)
    await page.locator('.dir-row').first().locator('.dir-del').click({ force: true })
    await expectToast(page, '至少保留一个共享目录')
    expect(await e2e.count(page, 'fileshare_save_config')).toBe(0)
    await expect(page.locator('.dir-row')).toHaveCount(1)
  })

  test('口令：设置弹窗「局域网传输」页签里启用，模块页摘要同步，可清除', async ({ page }) => {
    await gotoFileshare(page)
    let dialog = await openSettings(page, 'fileshare')
    let pwItem = visiblePane(dialog).locator('.setting-item', { hasText: '访问口令' })
    await expect(pwItem.locator('.fs-tag')).toHaveText('未启用')
    await pwItem.locator('button', { hasText: '设置口令' }).click()
    await pwItem.locator('.fs-pw-input').fill('sesame')
    await pwItem.locator('.fs-pw-row .action-btn.primary').click()
    await expectToast(page, '访问口令已更新')
    await expect(pwItem.locator('.fs-tag')).toHaveText('已启用')
    await dialog.locator('.close-btn').click()
    await expect(page.locator('.cfg-summary')).toContainText('口令已设')
    // 口令已设 → 模块页不再显示「去设置」警告
    await expect(page.locator('.group-note.chip-warn')).toHaveCount(0)
    dialog = await openSettings(page, 'fileshare')
    pwItem = visiblePane(dialog).locator('.setting-item', { hasText: '访问口令' })
    await pwItem.locator('button', { hasText: '清除口令' }).click()
    await expectToast(page, '已清除访问口令')
    await expect(pwItem.locator('.fs-tag')).toHaveText('未启用')
    await dialog.locator('.close-btn').click()
    await expect(page.locator('.group-note.chip-warn', { hasText: '未设访问口令' })).toBeVisible()
  })

  test('关闭开关：停服并从不一致的当前页带回条目页', async ({ page }) => {
    await gotoFileshare(page)
    const dialog = await openSettings(page, 'general')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '局域网文件传输' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '设置已保存')
    expect(await e2e.count(page, 'fileshare_stop')).toBe(1)
    await expect(page).toHaveURL(/\/entries$/)
  })

  test('端口漂移：黄色胶囊显示实际端口与被占的配置端口', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, port: 8000, boundPort: 8012, shareDirs: ['C:\\desko-e2e\\shared'], hasPassword: true },
    })
    await expect(page.locator('.group-note.chip-warn')).toHaveText('端口 8012 · 配置 8000 被占')
  })

  test('运行中改端口：设置弹窗里回车即发保存', async ({ page }) => {
    await gotoFileshare(page)
    const dialog = await openSettings(page, 'fileshare')
    const portInput = visiblePane(dialog).locator('.fs-port-input')
    await portInput.fill('8123')
    await portInput.press('Enter')
    await expectToast(page, '端口已更新')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.port).toBe(8123)
    await dialog.locator('.close-btn').click()
    await expect(page.locator('.cfg-summary')).toContainText('端口 8123')
  })

  test('仅本机开关：即时保存并收起局域网地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.url-row')).toHaveCount(2)
    const dialog = await openSettings(page, 'fileshare')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '仅本机访问' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '已切到仅本机访问')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.localOnly).toBe(true)
    await dialog.locator('.close-btn').click()
    await expect(page.locator('.url-row')).toHaveCount(1)
    await expect(page.locator('.cfg-summary')).toContainText('仅本机访问')
  })

  test('停止服务按钮：状态条变已停止', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '已停止监听')
    await expect(page.locator('.bar-count')).toContainText('已停止')
  })
})
