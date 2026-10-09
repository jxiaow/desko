import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useEntriesStore } from './entries'
import { useToastStore } from './toast'

const PASSWORD_CACHE_TTL = 2 * 60 * 1000

export const usePasswordStore = defineStore('password', () => {
  const entriesStore = useEntriesStore()
  const toastStore = useToastStore()

  const visiblePasswords = ref<Record<string, boolean>>({})
  const passwordCache = ref<Record<string, { value: string; ts: number }>>({})

  const togglePassword = async (id: string) => {
    if (visiblePasswords.value[id]) {
      visiblePasswords.value[id] = false
    } else {
      const cached = passwordCache.value[id]
      if (!cached || Date.now() - cached.ts > PASSWORD_CACHE_TTL) {
        try {
          const pwd = await entriesStore.getPassword(id)
          passwordCache.value[id] = { value: pwd, ts: Date.now() }
        } catch (e: any) {
          toastStore.showToast('获取密码失败', 'error')
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

  /**
   * 详情弹窗打开时预热一次。密码不在列表负载里（EntryResponse 不带），而详情那行
   * 只在缓存有值时才渲染，不主动取就永远不出现——存了密码也看不到。
   * 取失败/空密码都当作"没有密码"，让那行继续缺席。
   */
  const primePassword = async (id: string) => {
    const cached = passwordCache.value[id]
    if (cached && Date.now() - cached.ts <= PASSWORD_CACHE_TTL) return
    try {
      const pwd = await entriesStore.getPassword(id)
      passwordCache.value[id] = { value: pwd, ts: Date.now() }
    } catch {
      delete passwordCache.value[id]
    }
  }

  const getPassword = async (id: string): Promise<string> => {
    return await entriesStore.getPassword(id)
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
  }

  return {
    visiblePasswords,
    passwordCache,
    togglePassword,
    primePassword,
    getPasswordDisplay,
    getPassword,
    evictExpiredPasswords,
    clearSensitiveState,
  }
})
