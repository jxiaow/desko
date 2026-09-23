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

  test('设置里打开开关后拉起服务，侧栏出现入口', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'general')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '局域网文件传输' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '局域网传输已开启')
    expect(await e2e.count(page, 'fileshare_start')).toBe(1)
    await dialog.locator('.close-btn').click()
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(1)
  })

  test('开启失败（端口全被占）：提示原因、开关回弹、无入口', async ({ page }) => {
    await bootUnlocked(page, { fileshare: { port: 9999 } })
    const dialog = await openSettings(page, 'general')
    const item = visiblePane(dialog).locator('.setting-item', { hasText: '局域网文件传输' })
    const slider = item.locator('.switch-slider')
    await slider.click()
    await expectToast(page, '开启失败')
    await expect(item.locator('input[type="checkbox"]')).not.toBeChecked()
    await dialog.locator('.close-btn').click()
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
  })

  test('管理页渲染运行状态与地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.bar-count')).toContainText('监听中')
    await expect(page.locator('.url-row.lan').locator('code')).toContainText('http://10.0.0.9:8000')
    await expect(page.locator('.url-row.local').locator('code')).toContainText('http://127.0.0.1:8000')
    await expect(page.locator('.page-bar .btn-primary')).toHaveText('停止服务')
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

  test('口令：设置后显示已启用，可清除', async ({ page }) => {
    await gotoFileshare(page)
    const pwCard = page.locator('.setting-card')
    await expect(pwCard.locator('.tag')).toHaveText('未启用')
    await pwCard.locator('button', { hasText: '设置口令' }).click()
    await pwCard.locator('.pw-input').fill('sesame')
    await pwCard.locator('.pw-row .btn-primary').click()
    await expectToast(page, '访问口令已更新')
    await expect(pwCard.locator('.tag')).toHaveText('已启用')
    await pwCard.locator('button', { hasText: '清除口令' }).click()
    await expectToast(page, '已清除访问口令')
    await expect(pwCard.locator('.tag')).toHaveText('未启用')
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
      fileshare: { running: true, port: 8000, boundPort: 8012, shareDirs: ['C:\\desko-e2e\\shared'] },
    })
    await expect(page.locator('.chip-warn')).toHaveText('端口 8012 · 配置 8000 被占')
  })

  test('运行中改端口：回车即发保存', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.port-input').fill('8123')
    await page.locator('.port-input').press('Enter')
    await expectToast(page, '端口已更新')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.port).toBe(8123)
  })

  test('仅本机开关：即时保存并收起局域网地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.url-row')).toHaveCount(2)
    await page.locator('.setting-item', { hasText: '仅本机访问' }).locator('.switch-slider').click()
    await expectToast(page, '已切到仅本机访问')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.localOnly).toBe(true)
    await expect(page.locator('.url-row')).toHaveCount(1)
    await expect(page.locator('.page-bar .chip-meta', { hasText: '仅本机' })).toBeVisible()
  })

  test('停止服务按钮：状态条变已停止', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.page-bar .btn-primary').click()
    await expectToast(page, '已停止监听')
    await expect(page.locator('.bar-count')).toContainText('已停止')
  })
})
