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
  await expect(page.locator('.transfer-workspace')).toBeVisible()
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

/** 目录全路径：title 有时被工具层挪成 data-tip，两种都认 */
async function dirPath(page: Page): Promise<string | null> {
  return page.locator('.chat-dir').evaluate((el) => el.getAttribute('title') ?? el.getAttribute('data-tip'))
}

test.describe('局域网文件传输', () => {
  test('空记录且无共享目录时显示设置入口，配置后恢复文件操作', async ({ page }) => {
    await gotoFileshare(page, { ...ON, fileshare: { running: false, shareDirs: [] } })
    await expect(page.getByText('暂无传输记录', { exact: true })).toBeVisible()
    await expect(page.locator('.panel-meta, #lan-target, .send-file')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '启动服务', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '要发送的文字' })).toBeVisible()
    await page.getByRole('button', { name: '添加共享目录', exact: true }).click()
    const dialog = page.locator('.settings-dialog')
    await expect(visiblePane(dialog).locator('.fs-dir-empty')).toBeVisible()
    await e2e.queueDialog(page, 'D:\\share\\docs')
    await visiblePane(dialog).getByRole('button', { name: '添加文件夹', exact: true }).click()
    await expect(visiblePane(dialog).locator('.fs-dir-item')).toHaveCount(1)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('#lan-target')).toContainText('docs')
    await page.getByRole('button', { name: '启动服务', exact: true }).click()
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeEnabled()
  })

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
    await expect(page.locator('.chat-head .chip')).toContainText('已停止')
    await expect(page.locator('.head-addr')).toHaveCount(0)
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toHaveCount(0)
    await page.locator('.service-toggle').click()
    await expectToast(page, '服务已启动')
    await expect(page.locator('.chat-head .chip')).toContainText('监听中')
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeEnabled()
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toBeVisible()
  })

  test('启动失败（端口全被占）：提示原因、保持已停止', async ({ page }) => {
    await bootUnlocked(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { port: 9999, shareDirs: ON.fileshare.shareDirs },
    })
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.transfer-workspace')).toBeVisible()
    await expect(page.locator('.chat-head .chip')).toContainText('已停止')
    await page.locator('.service-toggle').click()
    await expectToast(page, '被占用')
    await expect(page.locator('.chat-head .chip')).toContainText('已停止')
    await expect(page.getByRole('button', { name: '启动服务', exact: true })).toBeVisible()
    // 停止后输入条上的「文件」按钮跟着不可点（拖入也不再收）
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeDisabled()
  })

  test('管理页渲染运行状态与地址', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.locator('.chat-head .chip')).toContainText('监听中')
    // 地址就摆在卡头，点一下即复制；同网段/本机两种地址在二维码浮层里
    await expect(page.locator('.head-addr .banner-url')).toHaveText('http://10.0.0.9:8000')
    await page.locator('.qr-btn').click()
    await expect(page.locator('.banner-title')).toHaveText('同网段设备可访问')
    await expect(page.locator('.local-address')).toContainText('http://127.0.0.1:8000')
    await expect(page.locator('.connection-qr')).toBeVisible()
    await page.screenshot({ path: '.tmp/fileshare-implementation/qr-pop.png' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.qr-pop')).toHaveCount(0)
    await expect(page.locator('.service-toggle')).toHaveText('停止服务')
    await expect(page.locator('.manage-btn')).toHaveAttribute('aria-label', '共享设置')
    await expect(page.locator('#lan-target')).toContainText('shared')
    expect(await dirPath(page)).toBe('C:\\desko-e2e\\shared')
  })

  for (const theme of ['paper', 'ink']) {
    test(`${theme} 主题的二维码可解码为实际监听地址`, async ({ page }) => {
      await bootUnlocked(page, {
        settings: { fileshare_enabled: 'true', theme },
        fileshare: { ...ON.fileshare, port: 8000, boundPort: 8012, hasPassword: true },
      }, '/fileshare')
      await page.locator('.qr-btn').click()
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
      await expect(page.locator('.chat-head .chip')).toContainText('已停止')
      await expect(page.locator('.qr-pop')).toHaveCount(0)
    })
  }

  test('文件选择器投递到所选目录，取消选择不发导入命令', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared', 'D:\\share\\docs'] },
    })
    await page.locator('#lan-target').click()
    await page.getByRole('menuitemradio', { name: 'docs', exact: true }).click()
    await page.getByRole('button', { name: '发送文件', exact: true }).click()
    expect(await e2e.count(page, 'fileshare_import_files')).toBe(0)
    await e2e.queueDialog(page, ['D:\\tmp\\会议记录.pdf'])
    await page.getByRole('button', { name: '发送文件', exact: true }).click()
    await expect(page.locator('.msg[data-kind="file"] .mname')).toHaveText('会议记录.pdf')
    const sent = (await e2e.snapshot(page)).fileshare.messages[0]
    expect(sent.share).toBe(1)
    expect(sent.name).toBe('会议记录.pdf')
  })

  test('设置里用文件夹选择器添加目录，移除当前目录后投递目标回退', async ({ page }) => {
    await gotoFileshare(page)
    let dialog = await openSettings(page, 'fileshare')
    await e2e.queueDialog(page, 'D:\\share\\docs')
    await visiblePane(dialog).getByRole('button', { name: '添加文件夹', exact: true }).click()
    await expectToast(page, '共享目录已更新')
    await expect(visiblePane(dialog).locator('.fs-dir-item')).toHaveCount(2)
    await dialog.locator('.dialog-close').click()
    await page.locator('#lan-target').click()
    await page.getByRole('menuitemradio', { name: 'docs', exact: true }).click()
    expect(await dirPath(page)).toBe('D:\\share\\docs')

    dialog = await openSettings(page, 'fileshare')
    await visiblePane(dialog).getByRole('button', { name: '移除共享文件夹 docs', exact: true }).click()
    await expectToast(page, '共享目录已更新')
    await expect(visiblePane(dialog).locator('.fs-dir-item')).toHaveCount(1)
    expect((await e2e.snapshot(page)).fileshare.shareDirs).toEqual(['C:\\desko-e2e\\shared'])
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('#lan-target')).toContainText('shared')
    expect(await dirPath(page)).toBe('C:\\desko-e2e\\shared')
  })

  test('设置里删掉排在前面的目录，投递目标按路径保持不变', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\a\\one', 'C:\\b\\two', 'C:\\c\\three'] },
    })
    await page.locator('#lan-target').click()
    await page.getByRole('menuitemradio', { name: 'three', exact: true }).click()
    expect(await dirPath(page)).toBe('C:\\c\\three')
    const dialog = await openSettings(page, 'fileshare')
    const pane = visiblePane(dialog)
    await expect(pane.locator('.fs-dir-item')).toHaveCount(3)
    await pane.getByRole('button', { name: '移除共享文件夹 one', exact: true }).click()
    await expectToast(page, '共享目录已更新')
    await expect(pane.locator('.fs-dir-item')).toHaveCount(2)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('#lan-target')).toContainText('three')
    expect(await dirPath(page)).toBe('C:\\c\\three')
  })

  test('手动输入共享目录即时保存并出现在列表', async ({ page }) => {
    await gotoFileshare(page)
    const dialog = await openSettings(page, 'fileshare')
    const pane = visiblePane(dialog)
    await pane.getByRole('button', { name: '手动输入路径', exact: true }).click()
    await pane.locator('.fs-dir-input').fill('D:\\share\\docs')
    await pane.locator('.fs-dir-add').getByRole('button', { name: '添加', exact: true }).click()
    await expectToast(page, '共享目录已更新')
    await expect(pane.locator('.fs-dir-item')).toHaveCount(2)
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.shareDirs).toEqual(['C:\\desko-e2e\\shared', 'D:\\share\\docs'])
  })

  test('删除最后一个目录被拦下，不发保存', async ({ page }) => {
    await gotoFileshare(page)
    const dialog = await openSettings(page, 'fileshare')
    await expect(visiblePane(dialog).locator('.fs-dir-item')).toHaveCount(1)
    await visiblePane(dialog).getByRole('button', { name: '移除共享文件夹 shared', exact: true }).click()
    await expectToast(page, '至少保留一个共享目录')
    expect(await e2e.count(page, 'fileshare_save_config')).toBe(0)
    await expect(visiblePane(dialog).locator('.fs-dir-item')).toHaveCount(1)
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
    await expect(page.locator('.chat-warn')).toHaveCount(0)
    dialog = await openSettings(page, 'fileshare')
    pwItem = visiblePane(dialog).locator('.setting-item', { hasText: '访问口令' })
    await pwItem.locator('button', { hasText: '清除口令' }).click()
    await expectToast(page, '已清除访问口令')
    await expect(pwItem.locator('.setting-desc')).toContainText('未设置，访问时无需验证')
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.chat-warn', { hasText: '未设访问口令' })).toBeVisible()
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
    await expect(page.locator('.chat-warn')).toHaveText('端口 8000 被占用，实际监听在 8012')
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
    await expect(page.locator('.head-addr .banner-url')).toHaveText('http://10.0.0.9:8000')
    const dialog = await openSettings(page, 'fileshare')
    await visiblePane(dialog)
      .locator('.setting-item', { hasText: '仅本机访问' })
      .locator('.switch-slider')
      .click()
    await expectToast(page, '已切到仅本机访问')
    const snap = await e2e.snapshot(page)
    expect(snap.fileshare.localOnly).toBe(true)
    await dialog.locator('.dialog-close').click()
    await expect(page.locator('.head-addr .banner-url')).toHaveText('http://127.0.0.1:8000')
    // 其他设备连不上了：提示条说清楚，二维码也没有可扫的地址
    await expect(page.locator('.chat-warn')).toContainText('仅本机可访问，其他设备连不上')
    await expect(page.locator('.qr-btn')).toBeDisabled()
  })

  test('停止服务按钮：状态条变已停止', async ({ page }) => {
    await gotoFileshare(page)
    await page.locator('.service-toggle').click()
    await expectToast(page, '已停止监听')
    await expect(page.locator('.chat-head .chip')).toContainText('已停止')
    await expect(page.locator('a.nav-item[href="/fileshare"] .nav-live')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '启动服务', exact: true })).toBeVisible()
    // 停止后输入条上的「文件」按钮跟着不可点（拖入也不再收）
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeDisabled()
  })

  test('拖入落盘：文件作为消息进流，服务停了记录也还在', async ({ page }) => {
    await gotoFileshare(page)
    await drop(page, ['C:\\Users\\me\\Desktop\\报告 v1.pdf', 'D:\\tmp\\photo.jpg'])
    await expectToast(page, '已接收 2 个文件')
    await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(2)
    await expect(page.locator('.msg[data-kind="file"] .mname').last()).toHaveText('报告 v1.pdf')
    await page.locator('.msg[data-kind="file"] .mget').last().click()
    expect(await e2e.count(page, 'fileshare_reveal_file')).toBe(1)
    expect((await e2e.snapshot(page)).fileshare.imported).toEqual(['报告 v1.pdf', 'photo.jpg'])
    await page.locator('.service-toggle').click()
    await expect(page.getByRole('button', { name: '启动服务', exact: true })).toBeVisible()
    // 服务停了：发文件不可用，但已经发出去的记录照常读得出来
    await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(2)
    await page.locator('.service-toggle').click()
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeEnabled()
    await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(2)
  })

  test('同名不覆盖：目录里已有 photo.jpg，拖入的落为 photo (1).jpg', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared'], imported: ['photo.jpg'] },
    })
    await drop(page, ['D:\\tmp\\photo.jpg'])
    await expect(page.locator('.msg[data-kind="file"] .mname').first()).toHaveText('photo (1).jpg')
  })

  test('服务未启动时拖入：拒收并发出提示，命令一次都不发', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { shareDirs: ['C:\\desko-e2e\\shared'] },
    })
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeDisabled()
    await drop(page, ['D:\\tmp\\photo.jpg'])
    await expectToast(page, '先启动服务')
    expect(await e2e.count(page, 'fileshare_import_files')).toBe(0)
    await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(0)
  })

  test('拖投：整张对话卡是落点，拖入中画提示', async ({ page }) => {
    await gotoFileshare(page)
    await expect(page.getByRole('button', { name: '发送文件', exact: true })).toBeVisible()

    await dragPhase(page, 'enter')
    await expect(page.locator('.transfer-workspace')).toHaveClass(/active/)
    await expect(page.locator('.fs-drop-hint b')).toHaveText('松手即投进 shared')
    await dragPhase(page, 'leave')
    await expect(page.locator('.fs-drop-hint')).toHaveCount(0)
  })

  test('停止态只展示连接操作，配置在共享设置中可查看', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { port: 8123, localOnly: true, hasPassword: true, shareDirs: ['C:\\desko-e2e\\shared'] },
    })
    const connection = page.locator('.connection-panel')
    await expect(connection.getByRole('status')).toHaveText('已停止')
    await expect(connection.getByRole('button', { name: '启动服务', exact: true })).toBeVisible()
    await expect(connection.getByRole('button', { name: '二维码', exact: true })).toHaveCount(0)
    await expect(connection).not.toContainText(/访问范围|访问口令|8123|同网段设备/)
    await expect(page.locator('#lan-target')).toContainText('shared')
    const dialog = await openSettings(page, 'fileshare')
    const pane = visiblePane(dialog)
    await expect(pane.locator('.fs-dir-item')).toHaveCount(1)
    await expect(pane.locator('.fs-port-input')).toHaveValue('8123')
    await expect(pane.locator('.setting-item').filter({ hasText: '仅本机访问' }).locator('input')).toBeChecked()
    await expect(pane.getByRole('button', { name: '修改口令' })).toBeVisible()
    await dialog.locator('.dialog-close').click()
    // 服务没起：落点提示不出现，拖入也不接收
    await dragPhase(page, 'enter')
    await expect(page.locator('.fs-drop-hint')).toHaveCount(0)
    expect(await e2e.count(page, 'fileshare_start')).toBe(0)
  })

  test('文件夹与超限逐条给原因，成功的照常入库', async ({ page }) => {
    await gotoFileshare(page)
    await drop(page, ['C:\\tmp\\big_pack.zip', 'C:\\tmp\\notes\\', 'C:\\tmp\\ok.txt'])
    await expectToast(page, /已接收 1 个，2 个保存失败/)
    // 只有真正落盘的那一个进流，别让人以为失败的也发出去了
    await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(1)
    await expect(page.locator('.msg[data-kind="file"] .mname')).toHaveText('ok.txt')
    expect((await e2e.snapshot(page)).fileshare.imported).toEqual(['ok.txt'])
  })

  test('多共享目录：选择投递目标，链接里的 share 跟着变', async ({ page }) => {
    await gotoFileshare(page, {
      settings: { fileshare_enabled: 'true' },
      fileshare: { running: true, shareDirs: ['C:\\desko-e2e\\shared', 'D:\\share\\docs'] },
    })
    await expect(page.locator('#lan-target')).toContainText('shared')
    expect(await page.locator('#lan-target').evaluate(element => element.tagName)).toBe('BUTTON')
    await page.locator('#lan-target').click()
    await expect(page.getByRole('menuitemradio')).toHaveCount(2)
    await page.getByRole('menuitemradio', { name: 'docs', exact: true }).click()
    expect(await dirPath(page)).toBe('D:\\share\\docs')
    await drop(page, ['C:\\tmp\\ok.txt'])
    // 选中的目录要跟着消息一起记：后端拿 share=1 才能定位到那份文件
    const msg = (await e2e.snapshot(page)).fileshare.messages[0]
    expect(msg.share).toBe(1)
    expect(msg.name).toBe('ok.txt')
  })
})

test.describe('局域网消息流', () => {
  const STREAM_ON = {
    settings: { fileshare_enabled: 'true' },
    fileshare: {
      running: true,
      shareDirs: ['C://desko-e2e//shared'],
      messages: [
        { id: 'w1', dir: 'web', kind: 'text', text: '网页发来的一段\n第二行也在', createdMs: 1_700_000_000_000, time: '10:24' },
        { id: 'a1', dir: 'app', kind: 'file', name: '报告.pdf', size: 2488320, share: 0, createdMs: 1_700_000_060_000, time: '10:25', sizeText: '2.4 MB' },
      ],
    },
  }

  test('流里一条文字一条文件，方向靠位置区分', async ({ page }) => {
    await bootUnlocked(page, STREAM_ON)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    // 不再有「文件 / 文字」两档：发什么不用先判断自己属于哪一类
    await expect(page.locator('.send-tab')).toHaveCount(0)
    await expect(page.locator('.msg')).toHaveCount(2)

    // 网页发来的在左（peer）、自己发的在右（me）：位置本身就说清了方向
    const peer = page.locator('.msg[data-dir="peer"]')
    const me = page.locator('.msg[data-dir="me"]')
    await expect(peer).toHaveCount(1)
    await expect(me).toHaveCount(1)
    await expect(peer.locator('.mtext')).toHaveText('网页发来的一段\n第二行也在')
    // 文件消息：扩展名小方块 + 名字 + 大小
    await expect(me.locator('.mic')).toHaveText('PDF')
    await expect(me.locator('.mname')).toHaveText('报告.pdf')
    await expect(me.locator('.msize')).toHaveText('2.4 MB')
    // 换行是内容的一部分
    expect(await peer.locator('.mtext').evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-wrap')
  })

  test('发一条文字：只记消息，不碰共享目录也不走导入命令', async ({ page }) => {
    await bootUnlocked(page, STREAM_ON)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await page.locator('#lan-message').fill('一段要发到网页的话')
    await expect(page.locator('.text-hint')).toContainText('27 B / 64 KB')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expectToast(page, '已发到网页')
    await expect(page.locator('.msg')).toHaveCount(3)
    const mine = page.locator('.msg[data-dir="me"][data-kind="text"]')
    await expect(mine.locator('.mtext')).toHaveText('一段要发到网页的话')
    // 发完清空，按钮回到不可点
    await expect(page.locator('#lan-message')).toHaveValue('')
    await expect(page.locator('#lan-message')).toBeVisible()
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    expect(await e2e.count(page, 'fileshare_message_push')).toBe(1)
    expect(await e2e.count(page, 'fileshare_import_files')).toBe(0)
    expect((await e2e.snapshot(page)).fileshare.messages[0].text).toBe('一段要发到网页的话')
  })

  test('收到的能复制能删，删的是消息不是文件', async ({ page }) => {
    await bootUnlocked(page, STREAM_ON)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    const peer = page.locator('.msg[data-dir="peer"]')
    await peer.getByRole('button', { name: '复制' }).click()
    await expectToast(page, '已复制')
    // Windows 剪贴板把 \n 归一成 \r\n：读回来先抹平再比
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.replace(/\r\n/g, '\n')).toBe('网页发来的一段\n第二行也在')

    // 文件消息没有"复制"（复制一串名字没意义），但有"定位"
    const file = page.locator('.msg[data-kind="file"]')
    await expect(file.getByRole('button', { name: '复制' })).toHaveCount(0)
    await file.getByRole('button', { name: '定位', exact: true }).click()
    expect(await e2e.count(page, 'fileshare_reveal_file')).toBe(1)

    await peer.getByRole('button', { name: '删除' }).click()
    await expect(page.locator('.msg')).toHaveCount(1)
    expect((await e2e.snapshot(page)).fileshare.messages.map((m) => m.id)).toEqual(['a1'])
  })

  test('网页发来新条目：轮询报到', async ({ page }) => {
    await bootUnlocked(page, { settings: { fileshare_enabled: 'true' }, fileshare: { running: true, shareDirs: ['C://desko-e2e//shared'] } })
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await expect(page.locator('.stream-empty')).toContainText('等候接收')
    await e2e.setFileshareMessages(page, [
      { id: 'w9', dir: 'web', kind: 'text', text: '刚在网页上粘的', createdMs: 1_700_000_100_000, time: '10:31' },
    ])
    // 3 秒一轮：靠这一轮把"新来的"认出来，不另开推送通道
    await expectToast(page, '网页发来一条消息')
    await expect(page.locator('.msg[data-dir="peer"] .mtext')).toHaveText('刚在网页上粘的')
  })

  test('超长文字当场拦住，不发命令也不留半截', async ({ page }) => {
    await bootUnlocked(page, STREAM_ON)
    await page.locator('a.nav-item[href="/fileshare"]').click()
    await page.locator('#lan-message').fill('长'.repeat(22_000))
    await expect(page.locator('.text-hint')).toContainText('超过 64 KB')
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
    expect(await e2e.count(page, 'fileshare_message_push')).toBe(0)
  })
})
