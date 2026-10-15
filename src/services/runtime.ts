/** Only the browser shell injected by the web server opts into web runtime. */
export function isWebRuntime(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector('meta[name="desko-runtime"]')?.getAttribute('content') === 'web'
}
