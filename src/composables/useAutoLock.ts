import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { settingsApi as api } from '../services/api/settings'

export interface LockRequest {
  forced?: boolean
  resetDrafts?: boolean
}

export function useAutoLock(
  doLock: (request?: LockRequest) => Promise<void>,
  evictExpiredPasswords: () => void,
) {
  const authStore = useAuthStore()
  const toastStore = useToastStore()
  const isLocked = () => authStore.appState === 'locked'

  let autoLockInterval: ReturnType<typeof setInterval> | null = null
  let unlistenTray: (() => void) | null = null
  let lastActivityTime = Date.now()

  const updateActivity = () => {
    lastActivityTime = Date.now()
  }

  onMounted(async () => {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenTray = await listen<LockRequest>('tray-lock', (event) => {
      void doLock(event.payload ?? {})
    })

    const checkAutoLock = async () => {
      if (authStore.appState !== 'unlocked') return
      evictExpiredPasswords()
      const timeout = await api.getSetting('auto_lock_timeout')
      const timeoutMinutes = parseInt(timeout) || 0
      if (timeoutMinutes <= 0) return
      const elapsed = (Date.now() - lastActivityTime) / 1000 / 60
      if (elapsed >= timeoutMinutes) {
        await doLock({ forced: true })
        if (isLocked()) toastStore.showToast('已自动锁定', 'info')
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
