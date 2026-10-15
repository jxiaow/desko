import { listen as nativeListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event'
import { isWebRuntime } from './runtime'
import { invoke, webSessionGeneration } from './transport'

interface ProgressEvent { id: number; event: string; payload: unknown }
const subscriptions = new Map<string, Set<EventCallback<unknown>>>()
let cursor: number | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> | null = null
let epoch = 0

function stop() {
  epoch++
  clearTimeout(timer)
  cursor = null
  pending = null
  subscriptions.clear()
}
if (isWebRuntime()) window.addEventListener('desko:web-session-expired', stop)

async function poll() {
  if (pending) return pending
  const generation = epoch
  const session = webSessionGeneration()
  pending = (async () => {
    try {
      const result = await invoke<{ cursor: number; events: ProgressEvent[] }>('web_poll_events', { after: cursor })
      if (generation !== epoch || session !== webSessionGeneration()) return
      cursor = result.cursor
      for (const event of result.events) {
        for (const callback of subscriptions.get(event.event) ?? []) {
          try {
            void Promise.resolve(callback({ event: event.event, id: event.id, payload: event.payload })).catch(() => {})
          } catch { /* 一个监听器失败不能吞掉同批其他事件。 */ }
        }
      }
    } catch { /* 会话过期由 transport 统一退出，临时失败留到下一次补读。 */ }
    finally {
      if (generation === epoch) {
        pending = null
        if (subscriptions.size) timer = setTimeout(() => void poll(), 1000)
      }
    }
  })()
  return pending
}

export async function listen<T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn> {
  if (!isWebRuntime()) return nativeListen(event, callback)
  if (!['desko:module-changed', 'codex:switch-progress', 'codex-oauth-login-completed', 'codex-oauth-login-timeout', 'codex-device-auth-error'].includes(event)) {
    throw new Error('浏览器不支持此事件')
  }
  const listener = callback as EventCallback<unknown>
  let group = subscriptions.get(event)
  if (!group) { group = new Set(); subscriptions.set(event, group) }
  group.add(listener)
  clearTimeout(timer)
  await poll()
  return () => {
    group.delete(listener)
    if (!group.size && subscriptions.get(event) === group) subscriptions.delete(event)
    if (!subscriptions.size) stop()
  }
}
