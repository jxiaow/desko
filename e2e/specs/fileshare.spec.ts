import { test, expect, Page } from '@playwright/test'
import { bootUnlocked, e2e, expectToast, openSettings, visiblePane } from '../helpers'
import jsQR from 'jsqr'

const ON = {
  settings: { fileshare_enabled: 'true' },
  fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared'] },
}

async function gotoFileshare(page: Page, config = ON) {
  await bootUnlocked(page, config)
  await page.locator('a.nav-item[href="/fileshare"]').click()
  await expect(page.locator('.directory-list')).toBeVisible()
}

/** 外部文件的路径只有原生拖放事件给得出；测试经 mock 事件桥伪造同一次拖入 */
async function drop(page: Page, paths: string[]) {
  await expect
    .poll(() => e2e.hasListener(page, 'tauri://drag-drop'), { timeout: 10_000 })
    .toBe(true)
  await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths, position: { x: 40, y: 40 } })
}

/** 指针进出窗口那一段：原生层先给 enter/over，路径要等 drop 才拿出来 */
async function dragPhase(page: Page, type: 'enter' | 'leave') {
  await expect
    .poll(() => e2e.hasListener(page, 'tauri://drag-drop'), { timeout: 10_000 })
    .toBe(true)
  await e2e.emitEvent(page, 'tauri://drag-drop', { type, paths: [], position: { x: 40, y: 40 } })
}

test.describe('局域网文件传输', () => {
  test('开关默认关：没有侧栏入口，直达 /fileshare 被带回小记页', async ({ page }) => {
    await bootUnlocked(page, {}, '/fileshare')
    await expect(page).toHaveURL(/\/notes$/)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
    expect(await e2e.count(page, 'fileshare_status')).toBe(0)
  })

  test('侧栏标识：入口开着但服务没起，图标上不点', async ({ page }) => {
    await bootUnlocked(page, { settings: { fileshare_enabled: 'true' } }, '/notes')
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toHaveCount(0)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveAccessibleName('局域网传输')
  })

  test('侧栏标识：服务在跑就在图标右上角点一下，不必先进模块页', async ({ page }) => {
    await bootUnlocked(page, ON, '/notes')
    const item = page.locator('a.nav-item[href="/fileshare"]')
    await expect(item.locator('.nav-live')).toBeVisible()
    await expect(item).toHaveAccessibleName('局域网传输 · 服务运行中')
  })

  test('开关只开入口不自动起服务，模块页手动启动才监听', async ({ page }) => {
    await bootUnlocked(page)
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(0)
    const dialog = await openSettings(page, 'modules')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '局域网传输' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '局域网传输已开启')
    expect(await e2e.count(page, 'fileshare_start')).toBe(0)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('a.nav-item[href="/fileshare"]')).toHaveCount(1)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.page-bar .chip')).toContainText('已停止')
    await expect(page.locator('.fs-idle-title')).toHaveText('服务未启动')
    await expect(page.locator('.fs-idle-config')).toContainText('同网段设备')
    await expect(page.locator('.drop-card, .fs-banner')).toHaveCount(0)
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toHaveCount(0)
    await page.locator('.service-toggle').click()
    await expectToast(page, '服务已启动')
    await expect(page.locator('.page-bar .chip')).toContainText('监听中')
    await expect(page.locator('.fs-idle')).toHaveCount(0)
    await expect(page.locator('.drop-card .well-body')).toBeVisible()
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toBeVisible()
  })

  test('启动失败（端口全被占）：提示原因、保持已停止', async ({ page }) => {
    await bootUnlocked(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { port: 9999 },
    })
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.directory-list')).toBeVisible()
    await expect(page.locator('.page-bar .chip')).toContainText('已停止')
    await page.locator('.service-toggle').click()
    await expectToast(page, '被占用')
    await expect(page.locator('.page-bar .chip')).toContainText('已停止')
    await expect(page.locator('.fs-idle')).toBeVisible()
    await expect(page.locator('.fs-banner, .drop-card')).toHaveCount(0)
  })

  test('管理页渲染运行状态与地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.page-bar .chip')).toContainText('监听中')
    await expect(page.locator('.banner-title')).toHaveText('同网段设备可访问')
    await expect(page.locator('.banner-url')).toHaveText('http://10.0.0.9:8000')
    await expect(page.locator('.local-address')).toContainText('http://127.0.0.1:8000')
    await expect(page.locator('.service-toggle')).toHaveText('停止服务')
    await expect(page.locator('.manage-btn')).toHaveAttribute('aria-label', '管理共享')
    await expect(page.locator('.dir-row')).toHaveCount(1)
  })

  for (const theme of ['paper', 'ink']) {
    test(`${theme} 主题的二维码可解码为实际监听地址`, async ({ page }) => {
      await bootUnlocked(page, {
        settings: { fileshare_enabled: 'true', theme },
        fileshare: { ...ON.fileshare, port: 8000, boundPort: 8012, hasPassword: true },
      }, '/fileshare')
      const pixels = await page.locator('.connection-qr').evaluate(async (element) => {
        const image = element as HTMLImageElement
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 296
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0, 296, 296)
        return Array.from(context.getImageData(0, 0, 296, 296).data)
      })
      expect(jsQR(new Uint8ClampedArray(pixels), 296, 296)?.data).toBe('http://10.0.0.9:8012')
      await page.locator('.service-toggle').click()
      await expect(page.locator('.connection-qr')).toHaveCount(0)
    })
  }

  test('文件选择器投递到所选目录，取消选择不发导入命令', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared', 'D:\\share\\docs'] },
    })
    await page.locator('#lan-target').selectOption('1')
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    expect(await e2e.count(page, 'fileshare_import_files')).toBe(0)
    await e2e.queueDialog(page, ['D:\\tmp\\会议记录.pdf'])
    await page.getByRole('button', { name: '选择文件', exact: true }).click()
    await expect(page.locator('.received-name')).toHaveText('会议记录.pdf')
    await page.locator('.recv').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'http://10.0.0.9:8000/download?share=1&name=%E4%BC%9A%E8%AE%AE%E8%AE%B0%E5%BD%95.pdf',
    )
  })

  test('原生文件夹选择器添加目录，移除当前目录后投递目标回退', async ({ page }) => {
    await gotoFileshare(page)
    await e2e.queueDialog(page, 'D:\\share\\docs')
    await page.getByRole('button', { name: '选择文件夹', exact: true }).click()
    await expect(page.locator('.dir-row')).toHaveCount(2)
    await page.locator('#lan-target').selectOption('1')
    await page.getByRole('button', { name: '移除共享文件夹 docs', exact: true }).click()
    await expect(page.locator('.dir-row')).toHaveCount(1)
    await expect(page.locator('#lan-target')).toHaveValue('0')
    expect((await e2e.snapshot(page)).fileshare.shareDirs).toEqual(['C:\\desko-e2e\\shared'])
  })

  test('添加共享目录即时保存并出现在列表', async ({ page }) => {
    await gotoFileshare(page)
    await page.getByRole('button', { name: '手动输入路径', exact: true }).click()
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
    await expect(pwItem.locator('.setting-desc')).toContainText('未设置，访问时无需验证')
    await pwItem.locator('button', { hasText: '设置口令' }).click()
    await pwItem.locator('.fs-pw-input').fill('sesame')
    await pwItem.locator('.fs-pw-row .action-btn.primary').click()
    await expectToast(page, '访问口令已更新')
    await expect(pwItem.locator('.setting-desc')).toContainText('访问共享文件需验证口令')
    await dialog.locator('.dialog-close').click()
    // 口令已设 → 模块页不再显示「去设置」警告
    await expect(page.locator('.group-note.chip-warn')).toHaveCount(0)
    dialog = await openSettings(page, 'fileshare')
    pwItem = visiblePane(dialog).locator('.setting-item', { hasText: '访问口令' })
    await pwItem.locator('button', { hasText: '清除口令' }).click()
    await expectToast(page, '已清除访问口令')
    await expect(pwItem.locator('.setting-desc')).toContainText('未设置，访问时无需验证')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.group-note.chip-warn', { hasText: '未设访问口令' })).toBeVisible()
  })

  test('关闭开关：停服并从不一致的当前页带回小记页', async ({ page }) => {
    await gotoFileshare(page)
    const dialog = await openSettings(page, 'modules')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '局域网传输' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '设置已保存')
    expect(await e2e.count(page, 'fileshare_stop')).toBe(1)
    await expect(page).toHaveURL(/\/notes$/)
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
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.banner-url')).toHaveText('http://10.0.0.9:8123')
  })

  test('仅本机开关：即时保存并收起局域网地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.local-address')).toHaveCount(1)
    const dialog = await openSettings(page, 'fileshare')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '仅本机访问' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '已切到仅本机访问')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.localOnly).toBe(true)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.banner-title')).toHaveText('仅本机可访问')
    await expect(page.locator('.banner-url')).toHaveText('http://127.0.0.1:8000')
    // 局域网行没了，本机地址升进横幅，不再单列一行
    await expect(page.locator('.local-address')).toHaveCount(0)
  })

  test('停止服务按钮：状态条变已停止', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.service-toggle').click()
    await expectToast(page, '已停止监听')
    await expect(page.locator('.page-bar .chip')).toContainText('已停止')
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toHaveCount(0)
    await expect(page.locator('.fs-idle')).toBeVisible()
    await expect(page.locator('.fs-banner, .drop-card')).toHaveCount(0)
  })

  test('拖入落盘：页内追加提取链接行', async ({ page }) => {
    await gotoFileshare(page)
    await drop(page, ['C:\\Users\\me\\Desktop\\报告 v1.pdf', 'D:\\tmp\\photo.jpg'])
    await expectToast(page, '已接收 2 个文件')
    await expect(page.locator('.recv')).toHaveCount(2)
    await page.locator('.recv').first().click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'http://10.0.0.9:8000/download?share=0&name=%E6%8A%A5%E5%91%8A%20v1.pdf',
    )
    expect((await e2e.snapshot(page)).fileshare.imported).toEqual(['报告 v1.pdf', 'photo.jpg'])
    await page.locator('.service-toggle').click()
    await expect(page.locator('.fs-idle')).toBeVisible()
    await expect(page.locator('.well-body')).toHaveCount(0)
    await expect(page.locator('.recv')).toHaveCount(2)
    await page.locator('.service-toggle').click()
    await expect(page.locator('.well-body')).toBeVisible()
    await expect(page.locator('.recv')).toHaveCount(2)
  })

  test('同名不覆盖：目录里已有 photo.jpg，拖入的落为 photo (1).jpg', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared'], imported: ['photo.jpg'] },
    })
    await drop(page, ['D:\\tmp\\photo.jpg'])
    await page.locator('.recv').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'http://10.0.0.9:8000/download?share=0&name=photo%20(1).jpg',
    )
  })

  test('服务未启动时拖入：拒收并发出提示，命令一次都不发', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { shareDirs: ['C:\\desko-e2e\\shared'] },
    })
    await expect(page.locator('.drop-card')).toHaveCount(0)
    await drop(page, ['D:\\tmp\\photo.jpg'])
    await expectToast(page, '先启动服务')
    expect(await e2e.count(page, 'fileshare_import_files')).toBe(0)
    await expect(page.locator('.recv')).toHaveCount(0)
  })

  test('拖投区：显示文件选择入口，拖入中整页画落点提示', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.getByRole('button', { name: '选择文件', exact: true })).toBeVisible()

    await dragPhase(page, 'enter')
    await expect(page.locator('.drop-card')).toHaveClass(/active/)
    await expect(page.locator('.fs-drop-hint b')).toHaveText('松手即投进 shared')
    await dragPhase(page, 'leave')
    await expect(page.locator('.fs-drop-hint')).toHaveCount(0)
  })

  test('停止态展示启动配置并保留目录，隐藏拖投入口和落点提示', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { port: 8123, localOnly: true, hasPassword: true, shareDirs: ['C:\\desko-e2e\\shared'] },
    })
    await expect(page.locator('.fs-idle-title')).toHaveText('服务未启动')
    await expect(page.locator('.fs-idle-desc')).toContainText('本机浏览器')
    await expect(page.locator('.fs-idle-config dd')).toHaveText(['仅本机', '8123', '已设置'])
    await page.getByRole('button', { name: '手动输入路径', exact: true }).click()
    await expect(page.locator('.dir-add')).toBeVisible()
    await expect(page.locator('.dir-row')).toHaveCount(1)
    await expect(page.locator('.directory-list')).toBeVisible()
    await expect(page.locator('.drop-card, .fs-banner')).toHaveCount(0)
    await dragPhase(page, 'enter')
    await expect(page.locator('.drop-card')).toHaveCount(0)
    await expect(page.locator('.fs-drop-hint')).toHaveCount(0)
    expect(await e2e.count(page, 'fileshare_start')).toBe(0)
  })

  test('文件夹与超限逐条给原因，成功的照常入库', async ({ page }) => {
    await gotoFileshare(page)
    await drop(page, ['C:\\tmp\\big_pack.zip', 'C:\\tmp\\notes\\', 'C:\\tmp\\ok.txt'])
    await expectToast(page, /已接收 1 个，2 个保存失败/)
    await expect(page.locator('.recv')).toHaveCount(1)
    expect((await e2e.snapshot(page)).fileshare.imported).toEqual(['ok.txt'])
  })

  test('多共享目录：选择投递目标，链接里的 share 跟着变', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared', 'D:\\share\\docs'] },
    })
    await expect(page.locator('#lan-target option')).toHaveCount(2)
    await expect(page.locator('#lan-target')).toHaveValue('0')
    await page.locator('#lan-target').selectOption('1')
    await drop(page, ['C:\\tmp\\ok.txt'])
    await page.locator('.recv').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'http://10.0.0.9:8000/download?share=1&name=ok.txt',
    )
  })
})
