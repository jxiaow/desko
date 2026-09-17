import { defineStore } from 'pinia'
import { ref, onBeforeUnmount } from 'vue'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  show: boolean
  message: string
  type: ToastType
}

export const useToastStore = defineStore('toast', () => {
  const toast = ref<Toast>({ show: false, message: '', type: 'success' })
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  const showToast = (message: string, type: ToastType = 'success') => {
    if (toastTimer) clearTimeout(toastTimer)
    toast.value = { show: true, message, type }
    toastTimer = setTimeout(() => {
      toast.value.show = false
    }, 2500)
  }

  onBeforeUnmount(() => {
    if (toastTimer) clearTimeout(toastTimer)
  })

  return { toast, showToast }
})
