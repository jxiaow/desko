// vite alias: '@tauri-apps/plugin-shell' -> 本文件（仅 E2E 模式）
// src 仅动态 import { open }（打开外部链接）
import { getBackend } from './backend'

export async function open(path: string): Promise<void> {
  getBackend().logInvocation('shell:open', { path })
}
