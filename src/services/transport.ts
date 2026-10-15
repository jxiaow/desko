import { invoke as nativeInvoke } from '@tauri-apps/api/core'
import { isWebRuntime } from './runtime'

const WEB_PREFERENCES = new Set(['theme', 'accent', 'background_atmosphere', 'auto_lock_timeout', 'lock_on_close', 'lock_on_system_lock'])
const SESSION_EXPIRED = 'Web 会话已失效，请重新登录'
let generation = 0
let authenticated = false
let heartbeat: ReturnType<typeof setInterval> | undefined
// Cookie-changing responses must finish in order: a late logout must never
// clear the cookie of a newer login, nor may a late login undo logout.
let authQueue: Promise<unknown> = Promise.resolve()
function queueAuth<T>(action: () => Promise<T>): Promise<T> {
  const result = authQueue.then(action)
  authQueue = result.catch(() => {})
  return result
}

export function webSessionGeneration(): number { return generation }

export function expireWebSession(): void {
  if (!authenticated) return
  authenticated = false
  generation++
  clearInterval(heartbeat)
  window.dispatchEvent(new Event('desko:web-session-expired'))
}
async function request<T>(path: string, body?: object, invalidate = true, epoch = generation): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    if (invalidate && epoch === generation) expireWebSession()
    throw new Error('无法连接 Desko，请确认桌面端和 Web 服务仍在运行')
  }
  if (epoch !== generation) throw new Error(SESSION_EXPIRED)
  let value: { error?: string }
  try { value = await response.json() } catch {
    if (invalidate && epoch === generation) expireWebSession()
    throw new Error('Desko 返回了无效响应，请重新登录')
  }
  if (epoch !== generation) throw new Error(SESSION_EXPIRED)
  if (!response.ok) {
    if (response.status === 401 && invalidate) expireWebSession()
    throw new Error(value?.error ?? '请求失败')
  }
  return value as T
}
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isWebRuntime()) return args === undefined ? nativeInvoke<T>(command) : nativeInvoke<T>(command, args)
  const parameters = args ?? {}
  if (command === 'is_initialized') return true as T
  if (command === 'unlock') {
    const epoch = ++generation
    authenticated = false
    clearInterval(heartbeat)
    return queueAuth(async () => {
      if (epoch !== generation) throw new Error(SESSION_EXPIRED)
      await request('/api/login', { password: parameters.password }, false, epoch)
      if (epoch !== generation) throw new Error(SESSION_EXPIRED)
      authenticated = true
      heartbeat = setInterval(() => {
        if (authenticated && epoch === generation) void request('/api/session', undefined, true, epoch).catch(() => {})
      }, 15_000)
      return undefined as T
    })
  }
  if (command === 'lock') {
    const epoch = ++generation
    authenticated = false
    clearInterval(heartbeat)
    return queueAuth(async () => {
      try { await request('/api/logout', {}, false, epoch) } catch { /* Local revocation also works offline. */ }
      return undefined as T
    })
  }
  if (command === 'get_setting' || command === 'set_setting') {
    const key = String(parameters.key)
    if (!WEB_PREFERENCES.has(key)) throw new Error('请在桌面端修改此设置')
    if (command === 'set_setting') {
      localStorage.setItem(`desko.web.${key}`, String(parameters.value))
      return undefined as T
    }
    const defaults: Record<string, string> = { auto_lock_timeout: '5', lock_on_close: 'false', lock_on_system_lock: 'false' }
    return (localStorage.getItem(`desko.web.${key}`) ?? defaults[key] ?? '') as T
  }
  if (command === 'get_attachment_dir') return '/api/attachments' as T
  if (!authenticated) throw new Error(SESSION_EXPIRED)
  const epoch = generation
  const value = await request<T>('/api/invoke', { command, args: parameters }, true, epoch)
  if (epoch !== generation || !authenticated) throw new Error(SESSION_EXPIRED)
  return value
}
