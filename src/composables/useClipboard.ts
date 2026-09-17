import { useToastStore } from '../stores/toast'
import { usePasswordStore } from '../stores/password'

const CLIPBOARD_CLEAR_DELAY = 30 * 1000
const PASSWORD_CACHE_TTL = 2 * 60 * 1000

let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null

export function useClipboard() {
  const toastStore = useToastStore()
  const passwordStore = usePasswordStore()

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toastStore.showToast(`${label}已复制`)
    } catch {
      toastStore.showToast('复制失败', 'error')
    }
  }

  const copyPassword = async (id: string) => {
    try {
      const cached = passwordStore.passwordCache[id]
      if (!cached || Date.now() - cached.ts > PASSWORD_CACHE_TTL) {
        const pwd = await passwordStore.getPassword(id)
        passwordStore.passwordCache[id] = { value: pwd, ts: Date.now() }
      }
      await navigator.clipboard.writeText(passwordStore.passwordCache[id].value)
      toastStore.showToast('密码已复制，30秒后自动清除')
      if (clipboardClearTimer) clearTimeout(clipboardClearTimer)
      clipboardClearTimer = setTimeout(async () => {
        try { await navigator.clipboard.writeText('') } catch {}
        clipboardClearTimer = null
      }, CLIPBOARD_CLEAR_DELAY)
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
    copyPassword,
    clearClipboardTimer,
  }
}
