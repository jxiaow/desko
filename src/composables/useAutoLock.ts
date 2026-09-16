import { onMounted, onUnmounted, type Ref } from 'vue'
import { api } from '../services/api'

export function useAutoLock(
  appState: Ref<string>,
  doLock: () => Promise<void>,
  evictExpiredPasswords: () => void,
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
) {
  let autoLockInterval: ReturnType<typeof setInterval> | null = null
  let unlistenTray: (() => void) | null = null
  let lastActivityTime = Date.now()

  const updateActivity = () => {
    lastActivityTime = Date.now()
  }

  const setup = () => {
    onMounted(async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenTray = await listen('tray-lock', () => {
        doLock()
      })

      const checkAutoLock = async () => {
        if (appState.value !== 'unlocked') return
        evictExpiredPasswords()
        const timeout = await api.getSetting('auto_lock_timeout')
        const timeoutMinutes = parseInt(timeout) || 0
        if (timeoutMinutes <= 0) return
        const elapsed = (Date.now() - lastActivityTime) / 1000 / 60
        if (elapsed >= timeoutMinutes) {
          doLock()
          showToast('已自动锁定', 'info')
        }
      }

      document.addEventListener('mousemove', updateActivity)
      document.addEventListener('keypress', updateActivity)
      document.addEventListener('click', updateActivity)
      document.addEventListener('scroll', updateActivity)

      autoLockInterval = setInterval(checkAutoLock, 30000)
    })

    onUnmounted(() => {
      if (autoLockInterval) clearInterval(autoLockInterval)
      if (unlistenTray) unlistenTray()
      document.removeEventListener('mousemove', updateActivity)
      document.removeEventListener('keypress', updateActivity)
      document.removeEventListener('click', updateActivity)
      document.removeEventListener('scroll', updateActivity)
    })
  }

  return { setup }
}
