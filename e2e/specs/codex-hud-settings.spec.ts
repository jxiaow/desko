import { expect, test, type Locator, type Page } from '@playwright/test'
import { bootUnlocked, openSettings, visiblePane } from '../helpers'

const seed = {
  settings: {
    codex_enabled: 'true',
    codex_quota_auto_refresh_minutes: '0',
  },
  codex: { accounts: [] },
}

async function openHudGroup(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1040, height: 900 })
  const dialog = await openSettings(page, 'codex')
  const group = visiblePane(dialog).locator('.codex-hud-group')
  await group.scrollIntoViewIfNeeded()
  await expect(group).toBeVisible()
  return group
}

test('桌面挂件默认开，三款皮肤按 1× 实际大小排开，兔子默认选中', async ({ page }) => {
  await bootUnlocked(page, seed)
  const group = await openHudGroup(page)

  const toggle = group.getByRole('switch', { name: '桌面额度挂件' })
  await expect(toggle).toBeChecked()
  await expect(group.getByRole('switch', { name: '桌面小动作' })).toBeChecked()

  const skins = group.getByRole('radio')
  await expect(skins).toHaveCount(3)
  await expect(group.getByRole('radio', { name: /兔子/ })).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('radio', { name: /企鹅/ })).toHaveAttribute('aria-checked', 'false')
  await expect(group.getByRole('radio', { name: /蜗牛/ })).toHaveAttribute('aria-checked', 'false')

  const frames = group.locator('.hud-skin-frame')
  await expect(frames).toHaveCount(3)
  for (const frame of await frames.all()) {
    const box = await frame.boundingBox()
    expect(box?.width).toBe(136)
    expect(box?.height).toBe(144)
    const sprite = frame.locator('.sprite')
    const spriteBox = await sprite.boundingBox()
    expect(spriteBox?.width).toBe(128)
    expect(spriteBox?.height).toBe(136)
    await expect(frame.locator('.tag')).toBeVisible()
    await expect(frame.locator('.hud-row1')).toContainText('68%')
    expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
  }

  const picker = group.locator('.hud-skin-picker')
  expect(await picker.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(group.locator('.hud-note')).toContainText('预览使用示例数据')
  await expect(group.locator('.hud-warning')).toHaveText('配额自动刷新已关闭，挂件额度不会自动更新。')

  await group.screenshot({ path: '.tmp/codex-hud-20261021/settings-preview.png' })
})

test('选企鹅后写入设置，关掉再开设置仍是企鹅；开关同理', async ({ page }) => {
  await bootUnlocked(page, seed)
  let group = await openHudGroup(page)

  await group.getByRole('radio', { name: /企鹅/ }).click()
  await expect(group.getByRole('radio', { name: /企鹅/ })).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('radio', { name: /兔子/ })).toHaveAttribute('aria-checked', 'false')

  const toggle = group.getByRole('switch', { name: '桌面额度挂件' })
  await toggle.locator('xpath=../span[@class="switch-slider"]').click()
  await expect(toggle).not.toBeChecked()

  const pinned = group.getByRole('switch', { name: '固定展开面板' })
  await pinned.locator('xpath=../span[@class="switch-slider"]').click()
  await expect(pinned).toBeChecked()

  const ambient = group.getByRole('switch', { name: '桌面小动作' })
  await ambient.locator('xpath=../span[@class="switch-slider"]').click()
  await expect(ambient).not.toBeChecked()

  const snapshot = await page.evaluate(() => (window as any).__E2E__.snapshot())
  expect(snapshot.settings.codex_hud_skin).toBe('penguin')
  expect(snapshot.settings.codex_hud_enabled).toBe('false')
  expect(snapshot.settings.codex_hud_pinned).toBe('true')
  expect(snapshot.settings.codex_hud_ambient).toBe('false')

  await page.locator('.settings-dialog .dialog-close').click()
  group = await openHudGroup(page)
  await expect(group.getByRole('radio', { name: /企鹅/ })).toHaveAttribute('aria-checked', 'true')
  await expect(group.getByRole('switch', { name: '桌面额度挂件' })).not.toBeChecked()
  await expect(group.getByRole('switch', { name: '固定展开面板' })).toBeChecked()
  await expect(group.getByRole('switch', { name: '桌面小动作' })).not.toBeChecked()
})

test('小动作开关默认开；读回的 false 会保留', async ({ page }) => {
  await bootUnlocked(page, { ...seed, settings: { ...seed.settings, codex_hud_ambient: 'false' } })
  const group = await openHudGroup(page)
  await expect(group.getByRole('switch', { name: '桌面小动作' })).not.toBeChecked()
})

test('启动时读回已保存的皮肤；正常刷新间隔不显示停更警告', async ({ page }) => {
  await bootUnlocked(page, {
    ...seed,
    settings: { ...seed.settings, codex_hud_skin: 'snail', codex_quota_auto_refresh_minutes: '5' },
  })
  const group = await openHudGroup(page)
  await expect(group.getByRole('radio', { name: /蜗牛/ })).toHaveAttribute('aria-checked', 'true')
  await expect(group.locator('.hud-warning')).toHaveCount(0)
})

test('已保存的隐藏选择会保留', async ({ page }) => {
  await bootUnlocked(page, { ...seed, settings: { ...seed.settings, codex_hud_enabled: 'false' } })
  const group = await openHudGroup(page)
  await expect(group.getByRole('switch', { name: '桌面额度挂件' })).not.toBeChecked()
})
