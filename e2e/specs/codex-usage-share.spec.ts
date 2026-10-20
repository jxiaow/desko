import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast } from '../helpers'
import { mkdir, writeFile } from 'node:fs/promises'

test.use({ timezoneId: 'Asia/Shanghai' })
const seed = {
  settings: { codex_enabled: 'true' },
  codex: { accounts: [{ email: 'private@example.com' }], sessions: [
    { sessionId: 'private-today', title: '不应公开的会话标题', cwd: 'C:\\private-project', daysAgo: 0, input: 1_000_000, cached: 800_000, output: 100_000, model: 'gpt-5.4', turns: 3 },
    { sessionId: 'private-history', cwd: 'C:\\private-project', daysAgo: 1, input: 500_000, cached: 400_000, output: 50_000, model: 'gpt-5.4-mini', turns: 2 },
  ] },
}

async function boot(page: Page) {
  await page.clock.install({ time: new Date('2026-10-20T04:30:00Z') })
  await bootUnlocked(page, seed, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('110万')
}
async function openPoster(page: Page) {
  await page.getByRole('button', { name: '分享', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分享', exact: true })
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  await expect(dialog.locator('.poster-preview img')).toBeVisible()
  return dialog
}
async function png(page: Page) {
  return page.locator('.poster-preview img').evaluate(async (image: HTMLImageElement) => {
    const blob = await (await fetch(image.src)).blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const result = { width: bitmap.width, height: bitmap.height, bytes: bytes.length, signature: [...bytes.slice(0, 8)], background: [...ctx.getImageData(0, 0, 1, 1).data] }
    bitmap.close()
    return result
  })
}

async function saveSample(page: Page, name: string) {
  const bytes = await page.locator('.poster-preview img').evaluate(async (image: HTMLImageElement) => [...new Uint8Array(await (await fetch(image.src)).arrayBuffer())])
  await mkdir('.tmp/codex-poster', { recursive: true })
  await writeFile(`.tmp/codex-poster/${name}.png`, Buffer.from(bytes))
}

test('四种范围均能生成当前统计的 PNG，分享不重复查询用量', async ({ page }) => {
  await boot(page)
  for (const [range, summary] of [['今天', '110万'], ['近 7 天', '165万'], ['近 30 天', '165万'], ['全部', '165万']]) {
    await page.getByRole('button', { name: range, exact: true }).click()
    const dialog = await openPoster(page)
    await expect(dialog.locator('.poster-summary')).toContainText(summary)
    expect(await png(page)).toMatchObject({ width: 1080, height: 1440, signature: [137, 80, 78, 71, 13, 10, 26, 10] })
    await expect(dialog).not.toContainText('private@example.com')
    await expect(dialog).not.toContainText('不应公开的会话标题')
    await expect(dialog).not.toContainText('private-project')
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  }
  expect(await e2e.count(page, 'codex_query_session_usage')).toBe(1)
})

test('桌面保存预览中的 PNG，取消保存可继续预览和重试', async ({ page }) => {
  await boot(page)
  const dialog = await openPoster(page)
  await dialog.getByRole('button', { name: '保存图片', exact: true }).click()
  expect(await e2e.count(page, 'fs:writeFile')).toBe(0)
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  const preview = await png(page)
  await e2e.queueDialog(page, 'C:\\exports\\Codex-今日用量.png')
  await dialog.getByRole('button', { name: '保存图片', exact: true }).click()
  await expectToast(page, '图片已保存')
  const saved = await page.evaluate(() => {
    const call = window.__E2E__!.invocations.find(call => call.cmd === 'fs:writeFile')!
    const bytes = call.args.bytes as number[]
    return { path: call.args.path, bytes: bytes.length, signature: bytes.slice(0, 8) }
  })
  expect(saved).toEqual({ path: 'C:\\exports\\Codex-今日用量.png', bytes: preview.bytes, signature: preview.signature })
  const descriptor = await page.evaluate(() => window.__E2E__!.invocations.find(call => call.cmd === 'dialog:save')!.args.descriptor)
  expect(descriptor).toMatchObject({ defaultPath: 'Codex-今日用量-2026-10-20.png', filters: [{ extensions: ['png'] }] })
})

test('配色和隐藏金额会生成新的图片，快速切换以最后一次选择为准', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 800 })
  await boot(page)
  const dialog = await openPoster(page)
  const initial = await dialog.locator('img').getAttribute('src')
  expect((await png(page)).background).toEqual([246, 247, 243, 255])
  await dialog.getByRole('button', { name: '深色', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  expect((await png(page)).background).toEqual([23, 37, 34, 255])
  await saveSample(page, 'today-dark')
  await page.screenshot({ path: '.tmp/codex-poster/dialog-dark.png' })
  await dialog.getByRole('checkbox', { name: '展示估算金额' }).uncheck()
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  await expect(dialog.locator('img')).not.toHaveAttribute('src', initial!)
  await dialog.getByRole('button', { name: '浅色', exact: true }).click()
  await dialog.getByRole('button', { name: '深色', exact: true }).click()
  await dialog.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  expect((await png(page)).background).toEqual([246, 247, 243, 255])
  await saveSample(page, 'today-light')
  await page.screenshot({ path: '.tmp/codex-poster/dialog-light.png' })
})

test('复制以 PNG 写入剪贴板，失败后仍能保存或再次复制', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async (items: ClipboardItem[]) => {
        if ((window as any).__failImageCopy) throw new Error('denied')
        const blob = await items[0].getType('image/png')
        ;(window as any).__copiedPng = { type: blob.type, bytes: blob.size }
      },
    } })
  })
  await boot(page)
  const dialog = await openPoster(page)
  await page.evaluate(() => { (window as any).__failImageCopy = true })
  await dialog.getByRole('button', { name: '复制图片', exact: true }).click()
  await expectToast(page, '复制失败，可先保存图片再分享')
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  await page.evaluate(() => { (window as any).__failImageCopy = false })
  await dialog.getByRole('button', { name: '复制图片', exact: true }).click()
  await expectToast(page, '图片已复制，可直接粘贴分享')
  const copy = await page.evaluate(() => (window as any).__copiedPng)
  expect(copy).toEqual({ type: 'image/png', bytes: (await png(page)).bytes })
})

test('刷新用量不会改写已打开的图片，关闭后重新分享才使用新统计', async ({ page }) => {
  await boot(page)
  const dialog = await openPoster(page)
  const original = await dialog.locator('img').getAttribute('src')
  await page.evaluate(config => window.__E2E__!.seed({ ...config, codex: { ...config.codex, sessions: [
    { ...config.codex.sessions[0], input: 2_000_000, output: 200_000 },
  ] } }), seed)
  await page.clock.fastForward(30_000)
  await expect(page.locator('.usg-num')).toHaveText('220万')
  await expect(dialog.locator('.poster-summary')).toContainText('110万')
  await expect(dialog.locator('img')).toHaveAttribute('src', original!)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '分享', exact: true })).toBeFocused()
  expect(await page.evaluate(async url => { try { await fetch(url!); return false } catch { return true } }, original)).toBe(true)
  const reopened = await openPoster(page)
  await expect(reopened.locator('.poster-summary')).toContainText('220万')
})

test('生成图片失败时保留重试入口，恢复后可导出零用量图片', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    ;(window as any).__failPoster = true
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if ((window as any).__failPoster) { callback(null); return }
      return original.call(this, callback, ...args)
    }
  })
  await page.clock.setFixedTime(new Date('2026-10-20T04:30:00Z'))
  await bootUnlocked(page, { ...seed, codex: { ...seed.codex, sessions: [] } }, '/codex')
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-num')).toHaveText('0')
  await page.getByRole('button', { name: '分享', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分享', exact: true })
  await expect(dialog.getByRole('alert')).toContainText('无法生成 PNG')
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeDisabled()
  await page.evaluate(() => { (window as any).__failPoster = false })
  await dialog.getByRole('button', { name: '重试', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '保存图片', exact: true })).toBeEnabled()
  await expect(dialog.locator('.poster-summary')).toContainText('总量 0 Token')
  expect((await png(page)).width).toBe(1080)
})

test('锁定会关闭图片并释放预览图片', async ({ page }) => {
  await boot(page)
  const dialog = await openPoster(page)
  const url = await dialog.locator('img').getAttribute('src')
  await e2e.emitEvent(page, 'tray-lock', { resetDrafts: true })
  await expect(dialog).toHaveCount(0)
  expect(await page.evaluate(async url => { try { await fetch(url!); return false } catch { return true } }, url)).toBe(true)
  await expect(page.locator('.poster-preview img')).toHaveCount(0)
})
