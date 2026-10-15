import { test, expect, type Page } from '@playwright/test'
import { bootUnlocked, tipButton } from '../helpers'
import type { E2EConfig } from '../mocks/backend'

async function webApp(page: Page, config: E2EConfig = {}) {
  let authorized = false
  let expired = false
  const invocations: string[] = []
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(config => {
    ;(window as any).__E2E_CONFIG__ = {
      notes: [{ title: 'Web 小记', content_html: '<p>浏览器中的原有小记</p>' }],
      entries: [{ name: 'Web 收藏', url: 'https://example.com', password: 'secret' }],
      fileShortcuts: [{ name: 'demo.txt', path: 'C:/Work/demo.txt', shortcut_type: 'file' }, { name: 'Web 目录', path: 'C:/Work', shortcut_type: 'folder' }],
      mfaTokens: [{ label: 'Web 验证码', secret: 'JBSWY3DPEHPK3PXP' }],
      ...config,
    }
  }, config)
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname
    const send = (status: number, value: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })
    if (path === '/api/login') {
      if (route.request().postDataJSON()?.password !== 'e2e-master-123') return send(401, { error: '密码错误' })
      if (expired) return send(423, { error: '请先在桌面端解锁 Desko，再登录 Web' })
      await page.evaluate(async () => {
        const { getBackend } = await import('/e2e/mocks/backend.ts' as string)
        await getBackend().invoke('unlock', { password: 'e2e-master-123' })
        await getBackend().invoke('note_key_relock', {})
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
    if (path === '/api/share-upload') return send(200, { name: new URL(route.request().url()).searchParams.get('name') })
    if (path === '/api/invoke') {
      const body = route.request().postDataJSON()
      invocations.push(body.command)
      if (body.command === 'web_poll_events') return send(200, { cursor: 0, events: [] })
      if (body.command === 'web_codex_read_session') return send(200, '{\"type\":\"message\",\"content\":\"Web 会话正文\"}')
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
  await page.route(/http:\/\/127\.0\.0\.1:\d+\/(?:notes|entries|files|mfa|codex|fileshare|tunnel)?$/, async route => {
    const response = await route.fetch()
    const html = (await response.text()).replace('<head>', '<head><meta name="desko-runtime" content="web">')
    await route.fulfill({ response, body: html })
  })
  await page.goto('/notes')
  await expect(page.getByRole('heading', { name: 'Desko 浏览器访问' })).toBeVisible()
  const login = async () => {
    await page.locator('input[type="password"]').fill('e2e-master-123')
    await page.locator('input[type="password"]').press('Enter')
    await expect(page.locator('.notes-page')).toBeVisible()
  }
  return { login, errors, invocations, expire: () => { expired = true } }
}

test('Web 登录、四个入口、发布小记和独立外观设置', async ({ page }) => {
  const app = await webApp(page)
  await page.locator('input[type="password"]').fill('bad-password')
  await page.locator('input[type="password"]').press('Enter')
  await expect(page.locator('.unlock-page')).toContainText('主密码错误')
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
  await expect(settings.getByLabel('Web 访问密码', { exact: true })).toHaveCount(0)
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

test('Web 与桌面共用主密码和小记口令，支持找回且重新登录仍锁定', async ({ page }) => {
  const app = await webApp(page, {
    notePassphrase: 'separate-note-password',
    notes: [{ title: '加密小记', content_html: '<p>输入小记口令后才能查看</p>', encrypted: true }],
  })
  await app.login()
  await expect(page.locator('.memo-locked')).toHaveCount(1)
  await page.getByRole('button', { name: '解锁全部加密小记', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '解锁加密小记', exact: true })
  await expect(dialog.getByRole('button', { name: /主密码找回/ })).toBeVisible()
  await dialog.locator('input[type=password]').fill('e2e-master-123')
  await dialog.getByRole('button', { name: '解锁', exact: true }).click()
  await expect(dialog.locator('.dialog-err')).toBeVisible()
  await expect(page.locator('.memo-body')).toHaveCount(0)
  await dialog.locator('input[type=password]').fill('separate-note-password')
  await dialog.getByRole('button', { name: '解锁', exact: true }).click()
  await expect(page.locator('.memo-body')).toContainText('输入小记口令后才能查看')
  await page.getByRole('button', { name: '锁回全部加密小记', exact: true }).click()
  await page.getByRole('button', { name: '解锁全部加密小记', exact: true }).click()
  await dialog.getByRole('button', { name: /主密码找回/ }).click()
  await expect(page.locator('.memo-body')).toContainText('输入小记口令后才能查看')
  expect(app.invocations).toContain('note_key_recover')
  await tipButton(page, '退出浏览器访问').click()
  await app.login()
  await expect(page.locator('.memo-locked')).toHaveCount(1)
  expect(app.errors).toEqual([])
})

for (const width of [320, 390, 768, 1440, 1920]) {
  test(`Web ${width}px：四个模块可操作，阅读列居中且不溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const app = await webApp(page)
    await app.login()
    const mobile = width <= 640
    const navigation = page.getByRole('navigation', { name: '模块导航' })
    await expect(navigation.getByRole('link')).toHaveCount(4)
    if (mobile) {
      const navBox = await navigation.boundingBox()
      expect(navBox!.y).toBeGreaterThan(750)
      await expect(navigation.getByText('小记', { exact: true })).toBeVisible()
      await expect(page.locator('.memo-acts')).toHaveCSS('opacity', '1')
      await page.locator('.memo-edit').click()
      await expect(page.locator('.memo.editing .ProseMirror')).toBeVisible()
      await page.getByRole('button', { name: '退出编辑', exact: true }).click()
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
      await expect(page.getByRole('button', { name: '关闭小记筛选', exact: true })).toBeVisible()
      await page.locator('.rail .rail-item', { hasText: '归档' }).click()
      await expect(page.locator('.archive-bar')).toBeVisible()
      await expect(page.locator('.rail.overlay')).toHaveCount(0)
      await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
      await page.locator('.rail .rail-item', { hasText: '全部' }).click()
    } else if (width >= 1440) {
      const centered = await page.locator('.stream').evaluate(stream => {
        const reading = stream.querySelector('.memo')!.getBoundingClientRect()
        const box = stream.getBoundingClientRect()
        return Math.abs(reading.x + reading.width / 2 - (box.x + stream.clientWidth / 2))
      })
      expect(centered).toBeLessThanOrEqual(1)
    }
    for (const [label, selector] of [['小记', '.memo'], ['网址收藏', '.entry-card'], ['文件快捷', '.shortcut-row'], ['验证码', '.mfa-card']]) {
      await navigation.getByRole('link', { name: label, exact: true }).click()
      await expect(page.locator(selector).first()).toBeVisible()
      const layout = await page.locator(selector).first().evaluate(element => {
        const box = element.getBoundingClientRect()
        const main = document.querySelector('.main-area')!
        const scroll = document.querySelector('.content-inner') ?? document.querySelector('.stream')!
        return { left: box.left, right: box.right, viewport: innerWidth, overflow: scroll.scrollWidth - scroll.clientWidth, mainOverflow: main.scrollWidth - main.clientWidth }
      })
      expect(layout.left).toBeGreaterThanOrEqual(0)
      expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1)
      expect(layout.overflow).toBeLessThanOrEqual(1)
      expect(layout.mainOverflow).toBeLessThanOrEqual(1)
      if (mobile && label === '网址收藏') {
        await page.getByRole('button', { name: '新增条目', exact: true }).click()
        const form = page.getByRole('dialog', { name: '新增网址收藏', exact: true })
        await expect(form).toBeVisible()
        const bounds = await form.boundingBox()
        expect(bounds!.x).toBeGreaterThanOrEqual(12)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 12)
        await page.keyboard.press('Escape')
      }
      await page.screenshot({ path: `.tmp/web-stat-fixes/web-${width}-${selector.slice(1)}.png` })
    }
    expect(app.errors).toEqual([])
  })
}

test.describe('手机横屏', () => {
  test.use({ isMobile: true, hasTouch: true })
  test('844px 触屏保留底部导航和常显操作', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    const app = await webApp(page)
    await app.login()
    const navigation = page.getByRole('navigation', { name: '模块导航' })
    await expect(navigation.getByText('小记', { exact: true })).toBeVisible()
    await expect(page.locator('.memo-acts')).toHaveCSS('opacity', '1')
    const box = await navigation.boundingBox()
    expect(box!.y).toBeGreaterThan(320)
    await navigation.getByRole('link', { name: '网址收藏', exact: true }).tap()
    await expect(page.locator('.entry-card')).toBeVisible()
    expect(app.errors).toEqual([])
  })
})

const expandedWeb: E2EConfig = {
  settings: { codex_enabled: 'true', fileshare_enabled: 'true', tunnel_enabled: 'true' },
  codex: {
    accounts: [{ email: 'web@example.com', current: true, hourly: 80, weekly: 60 }, { email: 'backup@example.com' }],
    sessions: [{ sessionId: 'web-session', title: 'Web 会话', cwd: 'C:/Work/web', projectName: 'Web 项目', content: '检索正文', input: 25000, output: 1500, cached: 12000, turns: 3 }],
  },
  fileshare: { shareDirs: ['C:/Work/shared'] },
  tunnel: { bound: true, installed: true, authorized: true, tunnelId: 'web-tunnel', services: [{ hostname: 'files.example.com', port: 8000, label: '文件服务', preset: 'fileshare', routed: true, hasPublicPassword: true }] },
}

test('Web 小记首次设置与修改口令沿用桌面流程', async ({ page }) => {
  const app = await webApp(page)
  await app.login()
  await page.locator('.memo').hover()
  await page.getByRole('button', { name: '更多操作', exact: true }).click()
  await page.locator('.popover .pop-item:text-is("加密")').click()
  const setup = page.getByRole('dialog', { name: '设置小记口令', exact: true })
  await setup.locator('input').nth(0).fill('first-note-password')
  await setup.locator('input').nth(1).fill('first-note-password')
  await setup.getByRole('button', { name: '设置口令', exact: true }).click()
  await expect(setup).toHaveCount(0)
  expect(app.invocations).toContain('note_key_setup')
  expect(app.invocations).toContain('lock_note')
  await tipButton(page, '设置').click()
  const settings = page.getByRole('dialog', { name: '浏览器设置' })
  await settings.getByRole('button', { name: '小记', exact: true }).click()
  await settings.getByRole('button', { name: '修改小记口令', exact: true }).click()
  const change = page.getByRole('dialog', { name: '修改小记口令', exact: true })
  await change.locator('input').nth(0).fill('next-note-password')
  await change.locator('input').nth(1).fill('next-note-password')
  await change.getByRole('button', { name: '修改口令', exact: true }).click()
  await expect(change).toHaveCount(0)
  expect(app.invocations).toContain('note_key_change')
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '锁回全部加密小记', exact: true }).click()
  await page.getByRole('button', { name: '解锁全部加密小记', exact: true }).click()
  const unlock = page.getByRole('dialog', { name: '解锁加密小记', exact: true })
  await unlock.locator('input').fill('next-note-password')
  await unlock.getByRole('button', { name: '解锁', exact: true }).click()
  await expect(page.locator('.memo-body')).toContainText('浏览器中的原有小记')
  expect(app.errors).toEqual([])
})

test('Web 七个模块：Codex 账号切换、会话搜索、文件查看、用量和回收站恢复', async ({ page }) => {
  const app = await webApp(page, expandedWeb)
  await app.login()
  await expect(page.locator('.sidebar .nav-item')).toHaveCount(7)
  await page.getByRole('link', { name: 'Codex', exact: true }).click()
  await expect(page.locator('.acc-row')).toHaveCount(2)
  const backup = page.locator('.acc-row[data-email="backup@example.com"]')
  await backup.locator('.action-btn.primary').click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  await expect(backup.locator('.badge', { hasText: '当前' })).toBeVisible()
  await page.getByRole('button', { name: '会话', exact: true }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('textbox', { name: '搜索会话正文', exact: true }).fill('检索正文')
  await expect(page.locator('.sess-row')).toHaveCount(1)
  await page.locator('.sess-row').click()
  await page.getByRole('button', { name: '查看会话文件', exact: true }).click()
  const file = page.getByRole('dialog', { name: '会话文件', exact: true })
  await expect(file).toContainText('Web 会话正文')
  const download = page.waitForEvent('download')
  await file.getByRole('button', { name: '下载 JSONL', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('codex-session.jsonl')
  await file.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '移到回收站', exact: true }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  await expect(page.locator('.sess-row')).toHaveCount(0)
  await page.getByRole('button', { name: '回收站', exact: true }).click()
  const trashed = page.locator('.thr-row[data-sid="web-session"]')
  await trashed.getByRole('button', { name: '恢复', exact: true }).click()
  await page.locator('.confirm-dialog').getByRole('button', { name: '确定', exact: true }).click()
  await expect(trashed).toHaveCount(0)
  await page.getByRole('button', { name: '用量', exact: true }).click()
  await expect(page.locator('.usg-sum')).toBeVisible()
  expect(app.invocations).toContain('codex_query_session_usage')
  expect(app.errors).toEqual([])
})

test('Web 局域网传输上传、设置与隧道启停均可在浏览器完成', async ({ page }) => {
  const app = await webApp(page, expandedWeb)
  await app.login()
  await page.getByRole('link', { name: '局域网传输', exact: true }).click()
  await page.getByRole('button', { name: '启动服务', exact: true }).click()
  await expect(page.locator('.banner-title')).toContainText('同网段设备可访问')
  await page.getByLabel('上传到共享目录').setInputFiles({ name: '手机文件.txt', mimeType: 'text/plain', buffer: Buffer.from('browser upload') })
  await expect(page.locator('.recv-list code')).toContainText(encodeURIComponent('手机文件.txt'))
  await page.getByRole('button', { name: '管理共享', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '浏览器设置', exact: true })
  await expect(settings.getByText('仅本机访问', { exact: true })).toBeVisible()
  await settings.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('link', { name: '内网穿透', exact: true }).click()
  await expect(page.locator('.svc-row')).toContainText('files.example.com')
  await page.getByRole('button', { name: '启动隧道', exact: true }).click()
  await expect(page.locator('.page-bar .chip').first()).toContainText('已连上边缘')
  await page.getByRole('button', { name: '停止隧道', exact: true }).click()
  await expect(page.locator('.page-bar .chip').first()).toContainText('已停止')
  expect(app.invocations).toContain('fileshare_start')
  expect(app.invocations).toContain('tunnel_start')
  expect(app.invocations).toContain('tunnel_stop')
  expect(app.errors).toEqual([])
})

test('Web 可开启桌面共用模块开关，关闭后入口消失并停止服务', async ({ page }) => {
  const app = await webApp(page)
  await app.login()
  await tipButton(page, '设置').click()
  const settings = page.getByRole('dialog', { name: '浏览器设置' })
  await settings.getByRole('button', { name: '模块', exact: true }).click()
  await settings.getByRole('switch', { name: '局域网传输', exact: true }).check()
  await expect(page.getByRole('link', { name: '局域网传输', exact: true })).toBeAttached()
  await settings.getByRole('switch', { name: '局域网传输', exact: true }).uncheck()
  await expect(page.getByRole('link', { name: '局域网传输', exact: true })).toHaveCount(0)
  await expect.poll(() => app.invocations).toContain('fileshare_stop')
  expect(app.errors).toEqual([])
})

for (const width of [320, 390, 768, 1440]) {
  test(`Web 新模块 ${width}px 可访问且内容不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const app = await webApp(page, expandedWeb)
    await app.login()
    for (const name of ['Codex', '局域网传输', '内网穿透']) {
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.locator('.content-inner')).toBeVisible()
      const overflow = await page.locator('.content-inner').evaluate(el => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      if (name === 'Codex') {
        await expect(page.locator('.acc-row')).toHaveCount(2)
        await page.getByRole('button', { name: '用量', exact: true }).click()
        await expect(page.locator('.usg-sum')).toBeVisible()
        expect(await page.locator('.content-inner').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
      }
      await page.screenshot({ path: `.tmp/web-parity/web-${width}-${name}.png` })
    }
    expect(app.errors).toEqual([])
  })
}
