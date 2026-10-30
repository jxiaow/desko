import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('./runtime', () => ({ isWebRuntime: vi.fn(() => true) }))
vi.mock('./transport', () => ({ invoke: vi.fn(), webSessionGeneration: vi.fn(() => 1) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('Web subscriptions share a cursor, deliver the right events, and stop polling after unsubscribe', async () => {
  const { invoke } = await import('./transport')
  vi.mocked(invoke).mockResolvedValueOnce({ cursor: 10, events: [] }).mockResolvedValueOnce({ cursor: 12, events: [
    { id: 11, event: 'codex-oauth-login-completed', payload: { loginId: 'fixture' } },
    { id: 12, event: 'desko:module-changed', payload: { id: 'codex', enabled: true } },
  ] })
  const { listen } = await import('./events')
  const auth = vi.fn()
  const modules = vi.fn()
  const stops = await Promise.all([listen('codex-oauth-login-completed', auth), listen('desko:module-changed', modules)])
  expect(invoke).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1000)
  expect(invoke).toHaveBeenLastCalledWith('web_poll_events', { after: 10 })
  expect(auth).toHaveBeenCalledWith({ id: 11, event: 'codex-oauth-login-completed', payload: { loginId: 'fixture' } })
  expect(modules).toHaveBeenCalledTimes(1)
  stops.forEach(stop => stop())
  await vi.advanceTimersByTimeAsync(3000)
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('an expired session cannot replay delayed notifications into a replacement session', async () => {
  const { invoke } = await import('./transport')
  let resolve!: (value: unknown) => void
  vi.mocked(invoke).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const { listen } = await import('./events')
  const oldListener = vi.fn()
  const old = listen('codex-oauth-login-completed', oldListener)
  window.dispatchEvent(new Event('desko:web-session-expired'))
  vi.mocked(invoke).mockResolvedValueOnce({ cursor: 100, events: [] })
  const currentListener = vi.fn()
  const stopCurrent = await listen('codex-oauth-login-completed', currentListener)
  resolve({ cursor: 20, events: [{ id: 20, event: 'codex-oauth-login-completed', payload: { loginId: 'old' } }] })
  const stopOld = await old
  stopOld()
  await flushPromises()
  expect(oldListener).not.toHaveBeenCalled()
  expect(currentListener).not.toHaveBeenCalled()
  vi.mocked(invoke).mockResolvedValueOnce({ cursor: 101, events: [{ id: 101, event: 'codex-oauth-login-completed', payload: { loginId: 'current' } }] })
  await vi.advanceTimersByTimeAsync(1000)
  expect(invoke).toHaveBeenLastCalledWith('web_poll_events', { after: 100 })
  expect(currentListener).toHaveBeenCalledTimes(1)
  stopCurrent()
})

it('desktop listeners keep native events, while Web rejects events outside the progress list', async () => {
  const { listen } = await import('./events')
  await expect(listen('arbitrary-native-event', vi.fn())).rejects.toThrow('浏览器不支持此事件')
  const { isWebRuntime } = await import('./runtime')
  const { listen: nativeListen } = await import('@tauri-apps/api/event')
  vi.mocked(isWebRuntime).mockReturnValueOnce(false)
  const stop = vi.fn()
  vi.mocked(nativeListen).mockResolvedValueOnce(stop)
  const callback = vi.fn()
  expect(await listen('codex:switch-progress', callback)).toBe(stop)
  expect(nativeListen).toHaveBeenCalledWith('codex:switch-progress', callback)
})

it('Web signals a snapshot reset after queue truncation', async () => {
  const { invoke } = await import('./transport')
  vi.mocked(invoke).mockResolvedValueOnce({ cursor: 1, events: [] }).mockResolvedValueOnce({ cursor: 5000, truncated: true, events: [
    { id: 5000, event: 'desko:module-changed', payload: { id: 'codex', enabled: true } },
  ] })
  const reset = vi.fn()
  const callback = vi.fn()
  window.addEventListener('desko:web-events-reset', reset)
  const { listen } = await import('./events')
  const stop = await listen('desko:module-changed', callback)
  try {
    await vi.advanceTimersByTimeAsync(1000)
    expect(invoke).toHaveBeenLastCalledWith('web_poll_events', { after: 1 })
    expect(reset).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({ id: 5000, event: 'desko:module-changed', payload: { id: 'codex', enabled: true } })
  } finally { stop(); window.removeEventListener('desko:web-events-reset', reset) }
})
