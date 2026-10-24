import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { invoke as nativeInvoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const reply = (value: unknown = {}, status = 200) => ({ ok: status < 400, status, json: async () => value }) as Response
const http = vi.fn<typeof fetch>()
let meta: HTMLMetaElement
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubGlobal('fetch', http)
  http.mockReset().mockResolvedValue(reply())
  meta = document.createElement('meta'); meta.name = 'desko-runtime'; meta.content = 'web'; document.head.append(meta)
})
afterEach(() => { meta.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Web transport session boundaries', () => {
  it('stores the note paste preference in the browser and defaults to enabled', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const { invoke } = await import('./transport')
    expect(await invoke('get_setting', { key: 'note_paste_cleanup' })).toBe('true')
    await invoke('set_setting', { key: 'note_paste_cleanup', value: 'false' })
    expect(values.get('desko.web.note_paste_cleanup')).toBe('false')
    expect(await invoke('get_setting', { key: 'note_paste_cleanup' })).toBe('false')
    expect(http).not.toHaveBeenCalled()
  })

  it('all seven module switches read the desktop settings instead of browser storage', async () => {
    const { invoke } = await import('./transport')
    await invoke('unlock', { password: 'synthetic' })
    for (const id of ['notes', 'entries', 'files', 'mfa', 'codex', 'fileshare', 'tunnel']) {
      const key = `${id}_enabled`
      http.mockResolvedValueOnce(reply('false'))
      expect(await invoke('get_setting', { key })).toBe('false')
      expect(http).toHaveBeenLastCalledWith('/api/invoke', expect.objectContaining({ body: JSON.stringify({ command: 'get_setting', args: { key } }) }))
    }
    await expect(invoke('get_setting', { key: 'bypass_enabled' })).rejects.toThrow('请在桌面端修改此设置')
  })

  it('desktop keeps native IPC and does not fetch', async () => {
    meta.remove()
    vi.mocked(nativeInvoke).mockResolvedValue('native')
    const { invoke } = await import('./transport')
    expect(await invoke('list_notes')).toBe('native')
    expect(nativeInvoke).toHaveBeenCalledWith('list_notes')
    expect(http).not.toHaveBeenCalled()
  })

  it.each(['unauthorized', 'offline'] as const)('late %s from an old request cannot expire a newer login', async failure => {
    const { invoke } = await import('./transport')
    await invoke('unlock', { password: 'synthetic' })
    let resolve!: (value: Response) => void
    let reject!: (error: Error) => void
    http.mockImplementationOnce(() => new Promise((ok, fail) => { resolve = ok; reject = fail }))
    const old = invoke('list_notes').catch(error => error)
    const expired = vi.fn()
    window.addEventListener('desko:web-session-expired', expired)
    try {
      await invoke('unlock', { password: 'new-synthetic' })
      if (failure === 'unauthorized') resolve(reply({ error: 'expired' }, 401))
      else reject(new Error('offline'))
      expect(await old).toBeInstanceOf(Error)
      expect(expired).not.toHaveBeenCalled()
      await expect(invoke('list_notes')).resolves.toEqual({})
    } finally { window.removeEventListener('desko:web-session-expired', expired) }
  })

  it('logout invalidates pending login immediately and cookie requests finish in order', async () => {
    const { invoke } = await import('./transport')
    let finish!: (value: Response) => void
    http.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const login = invoke('unlock', { password: 'synthetic' }).catch(error => error)
    await flushPromises()
    const logout = invoke('lock')
    await expect(invoke('list_notes')).rejects.toThrow('会话已失效')
    expect(http).toHaveBeenCalledTimes(1)
    finish(reply())
    expect(await login).toBeInstanceOf(Error)
    await logout
    expect(http.mock.calls.map(([url]) => url)).toEqual(['/api/login', '/api/logout'])
  })

  it('new login waits for previous logout cookie to finish', async () => {
    const { invoke } = await import('./transport')
    await invoke('unlock', { password: 'synthetic' })
    let finish!: (value: Response) => void
    http.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const logout = invoke('lock')
    await flushPromises()
    const login = invoke('unlock', { password: 'new-synthetic' })
    await flushPromises()
    expect(http).toHaveBeenCalledTimes(2)
    finish(reply())
    await Promise.all([logout, login])
    expect(http.mock.calls.map(([url]) => url)).toEqual(['/api/login', '/api/logout', '/api/login'])
    await expect(invoke('list_notes')).resolves.toEqual({})
  })

  it('current session 401 dispatches expiration once and blocks further private requests', async () => {
    const { invoke } = await import('./transport')
    await invoke('unlock', { password: 'synthetic' })
    const expired = vi.fn()
    window.addEventListener('desko:web-session-expired', expired)
    try {
      http.mockResolvedValueOnce(reply({ error: 'expired' }, 401))
      await expect(invoke('list_notes')).rejects.toThrow('expired')
      const count = http.mock.calls.length
      await expect(invoke('list_notes')).rejects.toThrow('会话已失效')
      expect(http).toHaveBeenCalledTimes(count)
      expect(expired).toHaveBeenCalledTimes(1)
    } finally { window.removeEventListener('desko:web-session-expired', expired) }
  })
})
