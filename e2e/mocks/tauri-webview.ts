// vite alias: '@tauri-apps/api/webview' -> 本文件（仅 E2E 模式）
// 真机上外部文件路径由 WebView 原生层经 tauri://drag-drop 事件给出（HTML5 dataTransfer 拿不到路径）；
// 测试用 __E2E__.emitEvent('tauri://drag-drop', { type: 'drop', paths: [...] }) 伪造同形载荷。
import { getBackend } from './backend'

export function getCurrentWebview() {
  return {
    async onDragDropEvent(handler: (event: { payload: unknown }) => void): Promise<() => void> {
      return getBackend().onEvent('tauri://drag-drop', (payload) => handler({ payload }))
    },
  }
}
