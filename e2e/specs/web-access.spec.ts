import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'

async function webApp(page: Page) {
  let authorized = false
  let expired = false
  const invocations: string[] = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    ;(window as any).__E2E_CONFIG__ = {
      notes: [{ title: 'Web 小记', content_html: '<p>浏览器中的原有小记</p>' }],
      entries: [{ name: 'Web 收藏', url: 'https://example.com', password: 'secret' }],
      fileShortcuts: [{ name: 'demo.txt', path: 'C:/Work/demo.txt', shortcut_type: 'file' }, { name: 'Web 目录', path: 'C:/Work', shortcut_type: 'folder' }],
      mfaTokens: [{ label: 'Web 验证码', secret: 'JBSWY3DPEHPK3PXP' }],
    }
  })
  await page.route(/^http:\/\/127\.0\.0\.1:1437\/api\//, async route => {
    const path = new URL(route.request().url()).pathname
    const send = (status: number, value: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/login') {
      if (route.request().postDataJSON()?.password !== 'web-password') return send(401, { error: 'Web 访问密码不正确' })
      if (expired) return send(423, { error: '请先在桌面端解锁 Desko，再登录 Web' })
      await page.evaluate(async () => {
        const { getBackend } = await import('/e2e/mocks/backend.ts' as string)
        await getBackend().invoke('unlock', { password: 'e2e-master-123' })
      })
      authorized = true
      return send(200, null)
    }
    if (path === '/api/logout') { authorized = false; return send(200, null) }
    if (!authorized || expired) return send(401, { error: 'Web 会话已失效' })
    if (path === '/api/session') return send(200, { unlocked: true })
    if (path.startsWith('/api/attachments/')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQQAAAABJRU5ErkJggg==', 'base64') })
    if (path.startsWith('/api/files/')) {
      const url = new URL(route.request().url())
      const relative = url.searchParams.get('path') ?? ''
      if (path.endsWith('/file-0') || relative === 'demo.txt') return route.fulfill({ contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment' }, body: 'download fixture' })
      return send(200, { name: 'Web 目录', path: relative, entries: relative ? [] : [{ name: '子目录', path: '子目录', directory: true, size: 0 }, { name: 'demo.txt', path: 'demo.txt', directory: false, size: 16 }] })
    }
    if (path === '/api/invoke') {
      const body = route.request().postDataJSON()
      invocations.push(body.command)
      if (body.command === 'web_seal_draft') return send(200, { iv: 'fixture-draft-iv', ciphertext: Buffer.from(body.args.plaintext).toString('base64') })
      if (body.command === 'web_open_draft') return send(200, Buffer.from(body.args.sealed.ciphertext, 'base64').toString())
      try {
        const value = await page.evaluate(async ({ command, args }) => {
          const { getBackend } = await import('/e2e/mocks/backend.ts' as string)
          if (command === 'web_upload_attachment') return getBackend().invoke(args.noteId ? 'upload_attachment' : 'stage_attachment', { noteId: args.noteId, filePath: `C:/web-upload/${args.name}` })
          return getBackend().invoke(command, args)
        }, body)
        return send(200, value ?? null)
      } catch (e) { return send(400, { error: String(e) }) }
    }
    return send(404, { error: '资源不存在' })
  })
  await page.route(/http:\/\/127\.0\.0\.1:1437\/(?:notes)?$/, async route => {
    const response = await route.fetch()
    const html = (await response.text()).replace('<head>', '<head><meta name="desko-runtime" content="web">')
    await route.fulfill({ response, body: html })
  })
  await page.goto('/notes')
  await expect(page.getByRole('heading', { name: 'Desko 浏览器访问' })).toBeVisible()
  const login = async () => {
    await page.locator('input[type="password"]').fill('web-password')
    await page.locator('input[type="password"]').press('Enter')
    await expect(page.locator('.notes-page')).toBeVisible()
  }
  return { login, errors, invocations, expire: () => { expired = true } }
}

test('Web 登录、四个入口、发布小记和独立外观设置', async ({ page }) => {
  const app = await webApp(page)
  await page.locator('input[type="password"]').fill('bad-password')
  await page.locator('input[type="password"]').press('Enter')
  await expect(page.locator('.unlock-page')).toContainText('Web 访问密码不正确')
  await app.login()
  await expect(page.locator('.sidebar .nav-item')).toHaveCount(4)
  await expect(page.locator('.memo')).toContainText('浏览器中的原有小记')
  const editor = page.locator('.composer .ProseMirror')
  await editor.fill('通过 Web 新建的小记')
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect(page.locator('.memo').filter({ hasText: '通过 Web 新建的小记' })).toBeVisible()
  await page.getByRole('link', { name: '网址收藏' }).click()
  await expect(page.locator('.entry-card')).toContainText('Web 收藏')
  await page.getByRole('link', { name: '验证码' }).click()
  await expect(page.getByText('Web 验证码', { exact: true })).toBeVisible()
  await tipButton(page, '设置').click()
  const settings = page.getByRole('dialog', { name: '浏览器设置' })
  await expect(settings).toBeVisible()
  await expect(settings.getByText('数据与备份')).toHaveCount(0)
  await settings.getByRole('button', { name: '雪', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'snow')
  await settings.getByRole('button', { name: '退出浏览器访问' }).click()
  await expect(page.locator('.unlock-page')).toBeVisible()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect(app.invocations).not.toContain('lock')
  expect(app.invocations).toContain('create_note')
  expect(app.errors).toEqual([])
})

test('Web 会话失效会清空正文并回到登录', async ({ page }) => {
  const app = await webApp(page)
  await app.login()
  app.expire()
  await page.evaluate(async () => {
    const { invoke } = await import('/src/services/transport.ts' as string)
    try { await invoke('mfa_codes') } catch { /* 401 must clear the page. */ }
  })
  await expect(page.locator('.unlock-page')).toBeVisible()
  await expect(page.locator('.memo')).toHaveCount(0)
  await expect(page.locator('.sidebar')).toHaveCount(0)
  expect(app.errors).toEqual([])
})

test('桌面 Web 设置默认仅本机，开放局域网需确认并可停止', async ({ page }) => {
  await bootUnlocked(page)
  await tipButton(page, '设置').click()
  const settings = page.locator('.settings-dialog')
  await settings.getByRole('button', { name: 'Web 访问', exact: true }).click()
  await expect(settings.getByLabel('允许局域网设备访问')).not.toBeChecked()
  await settings.getByLabel('Web 访问密码').fill('web-password')
  await settings.getByLabel('允许局域网设备访问').check()
  await settings.getByRole('button', { name: '启动 Web 服务', exact: true }).click()
  await expect(page.getByText('开启局域网访问？', { exact: true })).toBeVisible()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  await expect(settings.getByText('服务运行中', { exact: true })).toBeVisible()
  await expect(settings.getByText('http://192.168.1.2:8420', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '停止服务', exact: true }).click()
  await page.getByRole('dialog', { name: '停止 Web 服务？' }).getByRole('button', { name: '确定', exact: true }).click()
  await expect(settings.getByText('服务未启动', { exact: true })).toBeVisible()
})


test('Web 文件目录浏览与流式下载、图片选择不调用本机对话框', async ({ page }) => {
  const app = await webApp(page)
  await app.login()
  await expect(page.locator('.memo')).toContainText('浏览器中的原有小记')
  await page.locator('.composer .ProseMirror').click()
  const chooserWait = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '添加图片', exact: true }).click()
  await (await chooserWait).setFiles({ name: '中文 配图.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQQAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.locator('.composer img')).toHaveAttribute('src', /\/api\/attachments\//)
  await page.getByRole('button', { name: '发布', exact: true }).click()
  await expect(page.locator('.memo img')).toHaveCount(1)
  await page.getByRole('link', { name: '文件快捷' }).click()
  await expect(page.getByRole('button', { name: '添加快捷方式' })).toHaveCount(0)
  await page.getByRole('button', { name: '浏览 Web 目录' }).click()
  const directory = page.getByRole('dialog', { name: '浏览文件：Web 目录' })
  await expect(directory.getByRole('button', { name: /子目录/ })).toBeVisible()
  const downloadWait = page.waitForEvent('download')
  await directory.getByRole('button', { name: /demo.txt/ }).click()
  expect((await downloadWait).suggestedFilename()).toBe('demo.txt')
  await directory.getByRole('button', { name: /子目录/ }).click()
  await expect(directory.getByText('目录为空', { exact: true })).toBeVisible()
  await directory.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('link', { name: '验证码' }).click()
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(page.getByLabel('选择二维码图片')).toHaveAttribute('type', 'file')
  expect(app.invocations).not.toContain('mfa_read_image')
  expect(app.invocations).toContain('web_upload_attachment')
  expect(app.errors).toEqual([])
})

test('Web 窄屏可读取小记与收藏', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const app = await webApp(page)
  await app.login()
  await expect(page.locator('.memo')).toContainText('浏览器中的原有小记')
  await page.screenshot({ path: '.tmp/app-review/app-web-audit/web-notes-390.png' })
  await page.getByRole('link', { name: '网址收藏' }).click()
  await expect(page.locator('.entry-card')).toContainText('Web 收藏')
  const add = page.getByRole('button', { name: '新增条目', exact: true })
  await expect(add).toBeVisible()
  const addBox = await add.boundingBox()
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(390)
  await add.click()
  const form = page.getByRole('dialog', { name: '新增网址收藏' })
  await expect(form).toBeVisible()
  const formBox = await form.boundingBox()
  expect(formBox!.x).toBeGreaterThanOrEqual(15)
  expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(375)
  await page.keyboard.press('Escape')
  await page.screenshot({ path: '.tmp/app-review/app-web-audit/web-entries-390.png' })
  const width = await page.evaluate(() => ({ content: document.querySelector('.main-area')!.getBoundingClientRect().right, viewport: innerWidth }))
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1)
  expect(app.errors).toEqual([])
})


test('HTTP 浏览器没有 WebCrypto 时仍可退出并恢复当前页草稿', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true }))
  const app = await webApp(page)
  await app.login()
  await page.locator('.composer .ProseMirror').fill('局域网未发布草稿')
  await tipButton(page, '退出浏览器访问').click()
  await expect(page.locator('.unlock-page')).toBeVisible()
  await app.login()
  await expect(page.locator('.composer .ProseMirror')).toContainText('局域网未发布草稿')
  expect(app.invocations).toContain('web_seal_draft')
  expect(app.invocations).toContain('web_open_draft')
  expect(app.errors).toEqual([])
})
