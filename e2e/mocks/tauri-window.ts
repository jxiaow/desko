// vite alias: '@tauri-apps/api/window' -> 本文件（仅 E2E 模式）
import { getBackend } from './backend'

interface MockWindow {
  label: string
  isMaximized(): Promise<boolean>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  startDragging(): Promise<void>
  onResized(handler: () => void): Promise<() => void>
}

export function getCurrentWindow(): MockWindow {
  const backend = getBackend()
  return {
    label: 'main',
    isMaximized: async () => false,
    minimize: async () => backend.logInvocation('window:minimize'),
    toggleMaximize: async () => backend.logInvocation('window:toggleMaximize'),
    close: async () => backend.logInvocation('window:close'),
    startDragging: async () => backend.logInvocation('window:startDragging'),
    onResized: async (handler: () => void) => backend.onEvent('window-resized', handler),
  }
}

export async function getAllWindows(): Promise<MockWindow[]> {
  return [getCurrentWindow()]
}
