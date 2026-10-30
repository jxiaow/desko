/** Only the browser shell injected by the web server opts into web runtime. */
export function isWebRuntime(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector('meta[name="desko-runtime"]')?.getAttribute('content') === 'web'
}

/** 在 <html> 落 Web 标记，供 CSS 把内置中文字体留在桌面端。返回是否已标记。 */
export function markWebRuntimeRoot(): boolean {
  if (!isWebRuntime() || typeof document === 'undefined') return false
  document.documentElement.classList.add('desko-web')
  return true
}

/** E2E 的 Tauri mock 有 API 但没有原生桥；需要真窗口时用它把关 */
export function isTauriRuntime(): boolean {
  return !isWebRuntime()
    && typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
}
