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

const EXTERNAL_HREF = /^(https?:|mailto:)/i

/**
 * 阅读面（卡片正文 / 全屏只读）的正文链接点击。
 * WebView2 没有新窗口处理器，`<a target=_blank>` 点了不会自己开，必须显式交给本机。
 * 只认绝对地址：`#锚点` 与 `/相对` 经 `anchor.href` 会被补成本机 localhost，
 * 那等于把内部片段送到外部浏览器，所以取原始属性并按前缀放行。
 */
export function openLinkFromClick(e: MouseEvent): boolean {
  const anchor = (e.target as Element | null)?.closest?.('a[href]')
  if (!anchor) return false
  const href = (anchor.getAttribute('href') || '').trim()
  if (!EXTERNAL_HREF.test(href)) return false
  e.preventDefault()
  void openExternal(href)
  return true
}
