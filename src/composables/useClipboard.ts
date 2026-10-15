import { useToastStore } from '../stores/toast'
import { usePasswordStore } from '../stores/password'
import { writeClipboardText } from '../utils/clipboard'

const CLIPBOARD_CLEAR_DELAY = 30 * 1000
const PASSWORD_CACHE_TTL = 2 * 60 * 1000

let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null

export function useClipboard() {
  const toastStore = useToastStore()
  const passwordStore = usePasswordStore()

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await writeClipboardText(text)
      // 用户已把新内容复制进剪贴板，撤销待执行的密码清除定时器，
      // 否则 30 秒后会误删这次复制的内容（定时器无法区分当前剪贴板归属）。
      clearClipboardTimer()
      toastStore.showToast(`${label}已复制`)
    } catch {
      toastStore.showToast('复制失败', 'error')
    }
  }

  /** 富文本复制：先连 HTML 一起写，粘到富文本目标时链接和格式能保住；写不进就退回纯文本 */
  const copyRichToClipboard = async (html: string, text: string, label: string) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      clearClipboardTimer()
      toastStore.showToast(`${label}已复制`)
      return
    } catch {
      // 环境不支持 ClipboardItem（无焦点/无用户激活）时走 writeText
    }
    await copyToClipboard(text, label)
  }

  const copyPassword = async (id: string) => {
    try {
      const cached = passwordStore.passwordCache[id]
      if (!cached || Date.now() - cached.ts > PASSWORD_CACHE_TTL) {
        const pwd = await passwordStore.getPassword(id)
        passwordStore.passwordCache[id] = { value: pwd, ts: Date.now() }
      }
      const mode = await writeClipboardText(passwordStore.passwordCache[id].value)
      if (clipboardClearTimer) clearTimeout(clipboardClearTimer)
      clipboardClearTimer = null
      if (mode === 'native') {
        toastStore.showToast('密码已复制，30秒后自动清除')
        clipboardClearTimer = setTimeout(async () => {
          try { await navigator.clipboard.writeText('') } catch {}
          clipboardClearTimer = null
        }, CLIPBOARD_CLEAR_DELAY)
      } else {
        toastStore.showToast('密码已复制，请使用后手动清除剪贴板')
      }
    } catch {
      toastStore.showToast('复制失败', 'error')
    }
  }

  const clearClipboardTimer = () => {
    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer)
      clipboardClearTimer = null
    }
  }

  return {
    copyToClipboard,
    copyRichToClipboard,
    copyPassword,
    clearClipboardTimer,
  }
}
