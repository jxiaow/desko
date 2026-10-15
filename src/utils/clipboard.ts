import { isWebRuntime } from '../services/runtime'

/** HTTP LAN pages cannot use the async Clipboard API; a user click can still copy plain text. */
export async function writeClipboardText(text: string): Promise<'native' | 'fallback'> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(text)
    return 'native'
  } catch (error) {
    if (!isWebRuntime()) throw error
  }

  const previousFocus = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : []
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(field)
  try {
    field.focus()
    field.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard copy failed')
    return 'fallback'
  } finally {
    field.remove()
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
    previousFocus?.focus({ preventScroll: true })
  }
}
