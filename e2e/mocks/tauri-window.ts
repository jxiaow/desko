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
  onFocusChanged(handler: (e: { payload: boolean }) => void): Promise<() => void>
}

// 最大化态要真翻转：TitleBar 靠 isMaximized() 换「最大化/还原」两颗 glyph，
// 恒返回 false 会让还原态在 E2E 与截图工具里永远拍不到
let maximized = false

export function getCurrentWindow(): MockWindow {
  const backend = getBackend()
  return {
    label: 'main',
    isMaximized: async () => maximized,
    minimize: async () => backend.logInvocation('window:minimize'),
    toggleMaximize: async () => {
      maximized = !maximized
      return backend.logInvocation('window:toggleMaximize')
    },
    close: async () => backend.logInvocation('window:close'),
    startDragging: async () => backend.logInvocation('window:startDragging'),
    onResized: async (handler: () => void) => backend.onEvent('window-resized', handler),
    // 焦点：payload 即 hasFocus，测试用 emitEvent('window-focus', true/false) 拨
    onFocusChanged: async (handler) =>
      backend.onEvent('window-focus', (hasFocus) => handler({ payload: !!hasFocus })),
  }
}

export async function getAllWindows(): Promise<MockWindow[]> {
  return [getCurrentWindow()]
}
