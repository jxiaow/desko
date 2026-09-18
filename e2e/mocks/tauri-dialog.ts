// vite alias: '@tauri-apps/plugin-dialog' -> 本文件（仅 E2E 模式）
// 返回值默认 null（用户取消），测试可通过 window.__E2E__.queueDialog(...) 预置。
import { getBackend } from './backend'

export async function open(_descriptor?: unknown, _options?: unknown): Promise<string | string[] | null> {
  const backend = getBackend()
  backend.logInvocation('dialog:open', { descriptor: _descriptor, options: _options })
  return (backend.nextDialogResult() as string | string[] | null) ?? null
}

export async function save(_descriptor?: unknown, _options?: unknown): Promise<string | null> {
  getBackend().logInvocation('dialog:save', { descriptor: _descriptor, options: _options })
  return (getBackend().nextDialogResult() as string | null) ?? null
}

export async function message(_message: string, _options?: unknown): Promise<null> {
  getBackend().logInvocation('dialog:message', { message: _message })
  return null
}

export async function ask(_message: string, _options?: unknown): Promise<boolean> {
  getBackend().logInvocation('dialog:ask', { message: _message })
  return (getBackend().nextDialogResult() as boolean) ?? false
}

export async function confirm(_message: string, _options?: unknown): Promise<boolean> {
  getBackend().logInvocation('dialog:confirm', { message: _message })
  return (getBackend().nextDialogResult() as boolean) ?? false
}
