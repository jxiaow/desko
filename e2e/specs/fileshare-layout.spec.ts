import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
import { webApp } from '../web-helpers'

const shareDirs = ['C:\\Work\\shared', 'D:\\Projects\\产品设计与开发文档']
for (const theme of ['paper', 'ink']) {
  for (const width of [800, 1440]) {
    test(`投递布局 ${theme} ${width}px：百个文件限制高度、保留名称与链接`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 800 ? 600 : 900 })
      await bootUnlocked(page, { settings: { fileshare_enabled: 'true', theme }, fileshare: { running: true, hasPassword: true, shareDirs } }, '/fileshare')
      await expect(page.locator('.directory-list .rcard')).toHaveCount(2)
      await expect(page.locator('#workspace-page-toolbar .service-toggle')).toHaveCount(1)
      await expect(page.locator('.upload-card .session-files')).toHaveCount(1)
      await expect(page.locator('.session-empty')).toBeVisible()
      const connection = (await page.locator('.connection-panel').boundingBox())!
      const upload = (await page.locator('.upload-card').boundingBox())!
      const directory = (await page.locator('.directory-list .rcard').first().boundingBox())!
      expect(Math.abs(connection.x - upload.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(connection.x + connection.width - directory.x - directory.width)).toBeLessThanOrEqual(1)
      await expect.poll(() => e2e.hasListener(page, 'tauri://drag-drop')).toBe(true)
      const longName = '产品设计与开发交付文档'.repeat(8) + '.pdf'
      let firstHeight = 0, firstDirectoryTop = 0
      for (const [start, end] of [[0, 40], [40, 100]]) {
        const names = Array.from({ length: end - start }, (_, index) => start + index === 0 ? longName : `交付文档-${String(start + index + 1).padStart(3, '0')}.pdf`)
        await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths: names.map(name => `C:\\tmp\\${name}`), position: { x: 300, y: 300 } })
        await expect(page.locator('.received-name')).toHaveCount(end)
        const list = await page.locator('.recv-list').evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, width: element.clientWidth, scrollWidth: element.scrollWidth }))
        const top = (await page.locator('.directories-panel').boundingBox())!.y
        expect(list.height).toBeLessThanOrEqual(102)
        expect(list.scrollHeight).toBeGreaterThan(list.height)
        expect(list.scrollWidth).toBeLessThanOrEqual(list.width)
        if (start === 0) { firstHeight = list.height; firstDirectoryTop = top }
        else { expect(list.height).toBe(firstHeight); expect(top).toBe(firstDirectoryTop) }
      }
      await expect(page.locator('.recv').first()).toHaveAttribute('title', `${longName} · 点击复制提取链接`)
      expect(await page.locator('.received-name').first().evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      await expect.poll(async () => {
        const list = (await page.locator('.recv-list').boundingBox())!
        const last = (await page.locator('.recv').last().boundingBox())!
        return last.y + last.height <= list.y + list.height + 1
      }).toBe(true)
      await page.screenshot({ path: `.tmp/fileshare-implementation/many-${theme}-${width}.png` })
      await page.locator('.recv').last().click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('http://10.0.0.9:8000/download?share=0&name=' + encodeURIComponent('交付文档-100.pdf'))
      await page.locator('.service-toggle').click()
      await expect(page.locator('.drop-card')).toHaveCount(0)
      await expect(page.locator('.recv')).toHaveCount(100)
      expect(await page.locator('.lan-page').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }
}

test('投递布局 Web 390px：上传文件、展开路径输入和更换目录可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page, { settings: { fileshare_enabled: 'true' }, fileshare: { running: true, hasPassword: true, shareDirs } }, '/fileshare')
  await app.login('.lan-page')
  await expect(page.locator('.directory-list .rcard')).toHaveCount(2)
  await page.locator('#lan-target').selectOption('1')
  await expect(page.locator('.target-path')).toHaveText(shareDirs[1])
  await page.getByLabel('上传到共享目录').setInputFiles([
    { name: '手机文件.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
    { name: '项目记录.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
  ])
  await expect(page.locator('.received-name')).toHaveText(['手机文件.txt', '项目记录.txt'])
  await page.getByRole('button', { name: '添加共享目录', exact: true }).click()
  await page.locator('.dir-add').fill('C:/Work/新共享')
  await page.locator('.dir-add-row button[type="submit"]').click()
  await expect(page.locator('.directory-list .rcard')).toHaveCount(3)
  await expect(page.locator('.dir-add')).toHaveCount(0)
  await page.screenshot({ path: '.tmp/fileshare-implementation/web-390.png' })
  expect(await page.locator('.lan-page').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(app.invocations).not.toContain('fileshare_import_files')
  expect(app.errors).toEqual([])
})
