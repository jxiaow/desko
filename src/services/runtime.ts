/** Only the browser shell injected by the web server opts into web runtime. */
export function isWebRuntime(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector('meta[name="desko-runtime"]')?.getAttribute('content') === 'web'
}

/** E2E 的 Tauri mock 有 API 但没有原生桥；需要真窗口时用它把关 */
export function isTauriRuntime(): boolean {
  return !isWebRuntime()
    && typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
}
