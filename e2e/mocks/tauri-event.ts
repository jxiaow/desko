// vite alias: '@tauri-apps/api/event' -> 本文件（仅 E2E 模式）
// useAutoLock 通过 listen('tray-lock') 订阅托盘锁定；测试用 __E2E__.emitEvent 触发。
import { getBackend } from './backend'

interface TauriEvent<T = unknown> {
  event: string
  payload: T
}

export async function listen<T = unknown>(
  event: string,
  handler: (e: TauriEvent<T>) => void,
): Promise<() => void> {
  return getBackend().onEvent(event, (payload) => handler({ event, payload }))
}

export async function once<T = unknown>(
  event: string,
  handler: (e: TauriEvent<T>) => void,
): Promise<() => void> {
  const backend = getBackend()
  let off: () => void = () => {}
  off = backend.onEvent(event, (payload) => {
    off()
    handler({ event, payload })
  })
  return () => off()
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  getBackend().emitEvent(event, payload)
}
