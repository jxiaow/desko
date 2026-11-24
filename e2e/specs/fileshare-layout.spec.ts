import { test, expect } from '@playwright/test'
import { bootUnlocked, e2e } from '../helpers'
import { webApp } from '../web-helpers'

const shareDirs = ['C:\\Work\\shared', 'D:\\Projects\\产品设计与开发文档']

/** 目录全路径：title 有时被工具层挪成 data-tip，两种都认 */
async function dirPath(page: import('@playwright/test').Page): Promise<string | null> {
  return page.locator('.chat-dir').evaluate((el) => el.getAttribute('title') ?? el.getAttribute('data-tip'))
}

/** 一段真往来：两边各一句、各一个文件，长的那句默认折起来。
    后端（`messages.rs::list`）给的是新的在前，这里照同一个口径写，页面再翻成时间正序 */
const conversation = [
  { id: 'w2', dir: 'web', kind: 'file', name: '假期照片 093.jpg', size: 5033165, share: 1, createdMs: 1_700_000_360_000, time: '10:41', sizeText: '4.8 MB' },
  { id: 'a2', dir: 'app', kind: 'text', text: '收到，我下午把对账单一起传过去。', createdMs: 1_700_000_240_000, time: '10:36' },
  { id: 'a1', dir: 'app', kind: 'file', name: '项目周报-2026W42.pdf', size: 2488320, share: 0, createdMs: 1_700_000_120_000, time: '10:31', sizeText: '2.4 MB' },
  { id: 'w1', dir: 'web', kind: 'text', text: 'wifi 密码 desko-2026\n客厅那台路由器 5G 频段还没改名，别连错。'.repeat(6), createdMs: 1_700_000_000_000, time: '10:24' },
]

for (const theme of ['paper', 'ink']) {
  test(`对话流 ${theme}：两边各一句各一个文件，长文默认折起`, async ({ page }) => {
    await page.setViewportSize({ width: 1040, height: 670 })
    await bootUnlocked(
      page,
      { settings: { fileshare_enabled: 'true', theme }, fileshare: { running: true, hasPassword: true, shareDirs, messages: conversation } },
      '/fileshare',
    )
    await expect(page.locator('.msg')).toHaveCount(4)
    await expect(page.locator('.msg[data-dir="peer"]')).toHaveCount(2)
    await expect(page.locator('.msg[data-dir="me"]')).toHaveCount(2)
    // 长文默认折到 3 行，点「展开全文」才摊开
    const long = page.locator('.msg[data-kind="text"] .mtext.clamp')
    await expect(long).toHaveCount(1)
    expect(await long.evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe('3')
    // 文件卡：App 侧是「定位」，点它才碰资源管理器
    await expect(page.locator('.msg[data-dir="me"][data-kind="file"] .mget')).toHaveText('定位')
    await expect(page.locator('.msg[data-dir="peer"][data-kind="file"] .mic')).toHaveText('JPG')
    // 拍一张从第一条开始的：纸/墨两档的往来长什么样。
    // 窗口临时抬高，四段往来才落在同一屏（默认窗 1040×670 的卡高只够露两条）
    await page.setViewportSize({ width: 1180, height: 940 })
    await page.waitForTimeout(1000)
    await expect.poll(() => page.locator('.stream').evaluate(el => { el.scrollTop = 0; return el.scrollTop })).toBe(0)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `.tmp/fileshare-implementation/chat-${theme}.png` })

    await page.getByRole('button', { name: '展开全文', exact: true }).click()
    await expect(page.locator('.msg[data-kind="text"] .mtext.clamp')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '收起', exact: true })).toBeVisible()
    const directions = page.getByRole('group', { name: '筛选传输方向' })
    await directions.getByRole('button', { name: '收到', exact: true }).click()
    await expect(page.locator('.msg')).toHaveCount(2)
    await expect(page.locator('.msg[data-dir="me"]')).toHaveCount(0)
    const search = page.getByRole('button', { name: '搜索传输记录' })
    await search.click()
    const query = page.getByRole('searchbox', { name: '按文件名或文字内容搜索' })
    await expect(query).toBeFocused()
    await query.fill('.JPG')
    await expect(page.locator('.msg')).toHaveCount(1)
    await directions.getByRole('button', { name: '发出', exact: true }).click()
    await expect(page.getByText('没有匹配的记录')).toBeVisible()
    await directions.getByRole('button', { name: '全部', exact: true }).click()
    await query.fill('wifi')
    await expect(page.locator('.msg[data-kind="text"]')).toHaveCount(1)
    await query.press('Escape')
    await expect(search).toBeFocused()
    await expect(page.locator('.msg')).toHaveCount(4)
  })
}

for (const theme of ['paper', 'ink']) {
  for (const width of [800, 1440]) {
    test(`对话布局 ${theme} ${width}px：百条文件不撑高、长名不撑破、记录常驻`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 800 ? 600 : 900 })
      await bootUnlocked(page, { settings: { fileshare_enabled: 'true', theme }, fileshare: { running: true, hasPassword: true, shareDirs } }, '/fileshare')
      await expect(page.locator('#lan-target')).toContainText('shared')
      await expect(page.locator('#workspace-page-toolbar .service-toggle')).toHaveCount(0)
      await expect(page.locator('.chat-head .service-toggle')).toBeVisible()
      await expect(page.locator('.chat-head .manage-btn')).toBeVisible()
      // 空流先给一句话，而不是一个 168px 的空井
      await expect(page.locator('.stream-empty')).toBeVisible()

      // 工作区使用透明底面，编辑器保持一层卡片。
      const workspace = page.locator('.transfer-workspace')
      await expect(workspace).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(page.locator('.transfer-composer')).toHaveCSS('border-top-width', '1px')
      await expect(page.getByRole('textbox', { name: '要发送的文字' })).toHaveCSS('border-top-width', '0px')
      const workspaceBox = (await workspace.boundingBox())!
      const pageBox = (await page.locator('.lan-page').boundingBox())!
      expect(workspaceBox.width).toBeGreaterThan(pageBox.width - 120)
      expect(Math.abs(workspaceBox.y + workspaceBox.height - (pageBox.y + pageBox.height))).toBeLessThanOrEqual(24)

      await expect.poll(() => e2e.hasListener(page, 'tauri://drag-drop')).toBe(true)
      const longName = '产品设计与开发交付文档'.repeat(8) + '.pdf'
      let firstWorkspaceHeight = 0
      for (const [start, end] of [[0, 40], [40, 100]]) {
        const names = Array.from({ length: end - start }, (_, index) => start + index === 0 ? longName : `交付文档-${String(start + index + 1).padStart(3, '0')}.pdf`)
        await e2e.emitEvent(page, 'tauri://drag-drop', { type: 'drop', paths: names.map(name => `C:\\tmp\\${name}`), position: { x: 300, y: 300 } })
        await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(end)

        // 记录区独立滚动，工作区在 40 条和 100 条时等高。
        const stream = await page.locator('.stream').evaluate(element => ({
          height: element.clientHeight,
          scrollHeight: element.scrollHeight,
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
        expect(stream.scrollHeight).toBeGreaterThan(stream.height)
        expect(stream.scrollWidth).toBeLessThanOrEqual(stream.width)

        const workspaceHeight = (await workspace.boundingBox())!.height
        if (start === 0) firstWorkspaceHeight = workspaceHeight
        else expect(workspaceHeight).toBe(firstWorkspaceHeight)
      }

      // 长文件名用省略号收尾，记录区保持原宽度。
      const name = page.locator('.msg[data-kind="file"] .mname').last()
      expect(await name.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await name.textContent()).toBe(longName)

      await page.screenshot({ path: `.tmp/fileshare-implementation/stream-${theme}-${width}.png` })

      // 停服务：发文件入口不可用，但已经收下的 100 条记录照常读得出来
      await page.locator('.service-toggle').click()
      await expect(page.locator('.msg[data-kind="file"]')).toHaveCount(100)
      expect(await page.locator('.lan-page').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }
}

test('默认窗口 1040×670：发送钮在首屏内，对话流占得住主区', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 670 })
  await bootUnlocked(page, { settings: { fileshare_enabled: 'true' }, fileshare: { running: true, hasPassword: true, shareDirs } }, '/fileshare')
  await expect(page.locator('#lan-target')).toContainText('shared')
  // 默认窗口是布局基准：书写条不能被挤到折线以下，否则"发一句话"要先把页面滚一下
  const send = (await page.getByRole('button', { name: '发送文件', exact: true }).boundingBox())!
  expect(send.y + send.height).toBeLessThanOrEqual(670)
  const composer = page.getByRole('textbox', { name: '要发送的文字' })
  await expect(composer).toBeInViewport()
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  const stream = await page.locator('.stream').evaluate(element => element.clientHeight)
  expect(stream).toBeGreaterThanOrEqual(320)
  await composer.fill('暂未发送的草稿')
  await page.locator('#lan-target').focus()
  await expect(composer).toHaveValue('暂未发送的草稿')
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await page.screenshot({ path: '.tmp/fileshare-implementation/text-composer.png' })
  expect(await page.locator('.lan-page').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  await page.screenshot({ path: '.tmp/fileshare-implementation/stream-default-1040.png' })
})

test('对话布局 Web 390px：换投递目标、传文件与在设置里添加目录都可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page, { settings: { fileshare_enabled: 'true' }, fileshare: { running: true, hasPassword: true, shareDirs } }, '/fileshare')
  await app.login('.lan-page')
  expect(await page.locator('#lan-target').evaluate(element => element.tagName)).toBe('BUTTON')
  await page.locator('#lan-target').click()
  await page.getByRole('menuitemradio', { name: '产品设计与开发文档', exact: true }).click()
  expect(await dirPath(page)).toBe(shareDirs[1])

  await page.getByLabel('选择要发的文件').setInputFiles([
    { name: '手机文件.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
    { name: '项目记录.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
  ])
  await expect(page.locator('.msg[data-kind="file"] .mname')).toHaveText(['项目记录.txt', '手机文件.txt'])

  // 在浏览器这端，自己发的就是「我」；文件给的是下载链接，不是只在别人电脑上生效的「定位」
  const mine = page.locator('.msg[data-kind="file"]').filter({ hasText: '手机文件.txt' })
  await expect(mine).toHaveAttribute('data-dir', 'me')
  await expect(mine.locator('.mget')).toHaveText('下载')
  await expect(mine.locator('.mget')).toHaveAttribute(
    'href',
    /^\/api\/share-download\/[^/]+$/,
  )
  const href = (await mine.locator('.mget').getAttribute('href'))!
  await page.route(url => url.pathname === href, route =>
    route.fulfill({ contentType: 'application/octet-stream', body: 'one' }),
  )
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    mine.getByRole('link', { name: '下载' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('手机文件.txt')

  await expect(page.locator('.msg[data-kind="file"] .mic').first()).toHaveJSProperty('tagName', 'SPAN')

  await page.locator('#lan-message').fill('从手机发一句')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const sent = page.locator('.msg[data-kind="text"]').last()
  await expect(sent).toHaveAttribute('data-dir', 'me')
  await expect(sent.locator('.mmeta')).toContainText('我')
  // 浏览器发出的记成 web：桌面端读回来才显示成「网页」而不是「我」
  expect(await page.evaluate(() => (window as any).__E2E__.snapshot().fileshare.messages[0]))
    .toMatchObject({ dir: 'web', kind: 'text', text: '从手机发一句' })

  await page.getByRole('button', { name: '打开模块导航', exact: true }).click()
  await page.locator('.web-module-drawer').getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '浏览器设置' })
  await settings.getByRole('button', { name: '局域网传输', exact: true }).click()
  await expect(settings.locator('.fs-dir-item')).toHaveCount(2)
  await settings.getByRole('button', { name: '手动添加', exact: true }).click()
  await settings.locator('.fs-dir-input').fill('C:/Work/新共享')
  await settings.locator('.fs-dir-add').getByRole('button', { name: '添加', exact: true }).click()
  await expect(settings.locator('.fs-dir-item')).toHaveCount(3)
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  await page.locator('#lan-target').click()
  await expect(page.getByRole('menuitemradio')).toHaveCount(3)
  await page.getByRole('menuitemradio', { name: '新共享', exact: true }).click()
  expect(await dirPath(page)).toBe('C:/Work/新共享')
  await page.screenshot({ path: '.tmp/fileshare-implementation/web-390.png' })
  expect(await page.locator('.lan-page').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(app.invocations).not.toContain('fileshare_import_files')
  expect(app.errors).toEqual([])
})
