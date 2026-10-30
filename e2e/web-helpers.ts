import { expect, type Page } from '@playwright/test'
import type { E2EConfig } from './mocks/backend'

export async function webApp(page: Page, config: E2EConfig = {}, initialPath = '/notes') {
  let authorized = false
  let expired = false
  const invocations: string[] = []
  const errors: string[] = []
  const events: { id: number; event: string; payload: unknown }[] = []
  await page.exposeFunction('__pushWebEvent', (event: string, payload: unknown) => events.push({ id: events.length + 1, event, payload }))
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(config => {
    ;(window as any).__E2E_CONFIG__ = {
      notes: [{ title: 'Web 小记', content_html: '<p>浏览器中的原有小记</p>' }],
      entries: [{ name: 'Web 收藏', url: 'https://example.com', password: 'secret' }],
      fileShortcuts: [{ name: 'demo.txt', path: 'C:/Work/demo.txt', shortcut_type: 'file' }, { name: 'Web 目录', path: 'C:/Work', shortcut_type: 'folder' }],
      mfaTokens: [{ label: 'Web 验证码', secret: 'JBSWY3DPEHPK3PXP' }],
      ...config,
      settings: { mfa_enabled: 'true', ...config.settings },
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
      if (body.command === 'preview_codex_switch') return send(200, { windows: { appCount: 0, cliCount: 0 }, wsl: null })
      if (body.command === 'switch_codex_account') body.args.clientPolicy = { restartWindows: false, applyToWsl: false }
      if (['get_codex_wsl_assignment', 'preview_codex_wsl_assignment', 'assign_codex_account_to_wsl', 'relaunch_codex_clients'].includes(body.command)) return send(403, { error: '需要桌面端操作' })
      if (body.command === 'web_poll_events') return send(200, { cursor: events.length, events: events.filter(event => body.args.after != null && event.id > body.args.after) })
      if (body.command === 'web_codex_read_session') return send(200, '{\"type\":\"message\",\"content\":\"Web 会话正文\"}')
      if (body.command === 'web_seal_draft') return send(200, { iv: 'fixture-draft-iv', ciphertext: Buffer.from(body.args.plaintext).toString('base64') })
      if (body.command === 'web_open_draft') return send(200, Buffer.from(body.args.sealed.ciphertext, 'base64').toString())
      try {
        const value = await page.evaluate(async ({ command, args }) => {
          const { getBackend } = await import('/e2e/mocks/backend.ts' as string)
          return getBackend().invoke(command, args)
        }, body)
        return send(200, value ?? null)
      } catch (e) { return send(400, { error: String(e) }) }
    }
    return send(404, { error: '资源不存在' })
  })
  await page.route(/http:\/\/127\.0\.0\.1:\d+\/(?:start|notes|entries|files|mfa|codex|fileshare|tunnel)?$/, async route => {
    const response = await route.fetch()
    const html = (await response.text()).replace('<head>', '<head><meta name="desko-runtime" content="web">')
    await route.fulfill({ response, body: html })
  })
  await page.goto(initialPath)
  await expect(page.getByRole('heading', { name: 'Desko', exact: true })).toBeVisible()
  const login = async (selector = '.notes-page') => {
    await page.locator('input[type="password"]').fill('e2e-master-123')
    await page.locator('input[type="password"]').press('Enter')
    await expect(page.locator(selector)).toBeVisible()
  }
  const desktopModuleChange = async (id: string, enabled: boolean) => {
    await page.evaluate(async ({ id, enabled }) => {
      const { getBackend } = await import('/e2e/mocks/backend.ts' as string)
      await getBackend().invoke('set_setting', { key: `${id}_enabled`, value: String(enabled) })
    }, { id, enabled })
    events.push({ id: events.length + 1, event: 'desko:module-changed', payload: { id, enabled } })
  }
  return { login, events, errors, invocations, desktopModuleChange, expire: () => { expired = true } }
}

export async function selectModule(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: '打开模块导航', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByRole('navigation', { name: '模块导航' }).getByRole('link', { name, exact: true }).click()
}
