import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  show: boolean
  message: string
  type: ToastType
}

export const useToastStore = defineStore('toast', () => {
  const toast = ref<Toast>({ show: false, message: '', type: 'success' })
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  /* 成功/提示一眼读完即走；失败原因要留够读完一句的时间 */
  const DWELL_MS: Record<ToastType, number> = { success: 800, info: 800, error: 2400 }

  const showToast = (message: string, type: ToastType = 'success') => {
    if (toastTimer) clearTimeout(toastTimer)
    toast.value = { show: true, message, type }
    toastTimer = setTimeout(() => {
      toast.value.show = false
    }, DWELL_MS[type])
  }

  return { toast, showToast }
})
