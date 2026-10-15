import { isWebRuntime } from '../services/runtime'

export async function openExternal(url: string): Promise<void> {
  if (isWebRuntime()) {
    const target = new URL(url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('Only HTTP links can be opened in the browser')
    }
    window.open(target.href, '_blank', 'noopener,noreferrer')
    return
  }
  const { open } = await import('@tauri-apps/plugin-shell')
  await open(url)
}
