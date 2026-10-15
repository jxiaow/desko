import { isWebRuntime } from './runtime'
import { reactive } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { faviconsApi } from './api/favicons'

/** 行首 favicon 档面：按 host 去重向 Rust 侧要缓存文件。
 *  srcs 值域：string=图标 asset URL / null=拿不到（字母块兜底）/ 缺失=在途或未发起。 */
const srcs = reactive(new Map<string, string | null>())
const inFlight = new Set<string>()

export const faviconHostOf = (url: string): string | null => {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.host.toLowerCase()
  } catch {
    return null
  }
}

export function faviconSrcFor(url?: string | null): string | null {
  if (!url) return null
  const host = faviconHostOf(url)
  if (!host) return null
  if (!srcs.has(host) && !inFlight.has(host)) {
    inFlight.add(host)
    faviconsApi.faviconGet(url)
      .then((path) => { srcs.set(host, path ? (isWebRuntime() ? `/api/favicons/${encodeURIComponent(path.split(/[\\/]/).pop() ?? path)}` : convertFileSrc(path)) : null) })
      .catch(() => { srcs.set(host, null) })
      .finally(() => { inFlight.delete(host) })
  }
  return srcs.get(host) ?? null
}
