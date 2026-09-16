import { ref } from 'vue'

const PASSWORD_CACHE_TTL = 2 * 60 * 1000
const CLIPBOARD_CLEAR_DELAY = 30 * 1000

export function usePassword(
  getPassword: (id: string) => Promise<string>,
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
) {
  const visiblePasswords = ref<Record<string, boolean>>({})
  const passwordCache = ref<Record<string, { value: string; ts: number }>>({})
  let clipboardClearTimer: ReturnType<typeof setTimeout> | null = null

  const togglePassword = async (id: string) => {
    if (visiblePasswords.value[id]) {
      visiblePasswords.value[id] = false
    } else {
      const cached = passwordCache.value[id]
      if (!cached || Date.now() - cached.ts > PASSWORD_CACHE_TTL) {
        try {
          const pwd = await getPassword(id)
          passwordCache.value[id] = { value: pwd, ts: Date.now() }
        } catch (e: any) {
          showToast('获取密码失败', 'error')
          console.error('getPassword error:', e)
          return
        }
      }
      visiblePasswords.value[id] = true
    }
  }

  const getPasswordDisplay = (id: string) => {
    return passwordCache.value[id]?.value || '••••••••'
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`${label}已复制`)
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const copyPassword = async (id: string) => {
    try {
      const cached = passwordCache.value[id]
      if (!cached || Date.now() - cached.ts > PASSWORD_CACHE_TTL) {
        passwordCache.value[id] = { value: await getPassword(id), ts: Date.now() }
      }
      await navigator.clipboard.writeText(passwordCache.value[id].value)
      showToast('密码已复制，30秒后自动清除')
      if (clipboardClearTimer) clearTimeout(clipboardClearTimer)
      clipboardClearTimer = setTimeout(async () => {
        try { await navigator.clipboard.writeText('') } catch {}
        clipboardClearTimer = null
      }, CLIPBOARD_CLEAR_DELAY)
    } catch {
      showToast('复制失败', 'error')
    }
  }

  const evictExpiredPasswords = () => {
    const now = Date.now()
    for (const id of Object.keys(passwordCache.value)) {
      if (now - passwordCache.value[id].ts > PASSWORD_CACHE_TTL) {
        delete passwordCache.value[id]
      }
    }
  }

  const clearSensitiveState = () => {
    visiblePasswords.value = {}
    passwordCache.value = {}
    if (clipboardClearTimer) { clearTimeout(clipboardClearTimer); clipboardClearTimer = null }
  }

  return {
    visiblePasswords,
    passwordCache,
    togglePassword,
    getPasswordDisplay,
    copyToClipboard,
    copyPassword,
    evictExpiredPasswords,
    clearSensitiveState,
  }
}
