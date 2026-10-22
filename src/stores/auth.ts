import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authApi as api } from '../services/api/auth'
import type { AppState } from '../types'
import { isWebRuntime } from '../services/runtime'

export const useAuthStore = defineStore('auth', () => {
  const appState = ref<AppState>('locked')
  const isInitialized = ref(false)

  const checkInitialized = async () => {
    try {
      isInitialized.value = await api.isInitialized()
      appState.value = isInitialized.value ? 'locked' : 'setup'
    } catch (e) {
      console.error('Failed to check initialization:', e)
      appState.value = 'setup'
    }
  }

  /** onSetup 必须早于 appState 翻转：SetupPage 一旦随状态卸载，它发出的事件就没人接了 */
  const setupMasterPassword = async (password: string, onSetup?: () => void) => {
    await api.setupMasterPassword(password)
    isInitialized.value = true
    if (onSetup) onSetup()
    appState.value = 'unlocked'
  }

  const unlock = async (password: string, onUnlock?: () => void) => {
    await api.unlock(password)
    if (isWebRuntime()) {
      try {
        const { prepareWebModules } = await import('../modules/runtime')
        await prepareWebModules()
      } catch (error) {
        try { await api.lock() } catch { /* Keep the login page visible if initialization fails. */ }
        throw error
      }
    }
    if (onUnlock) onUnlock()
    appState.value = 'unlocked'
  }

  const lock = async () => {
    await api.lock()
    appState.value = 'locked'
  }

  return {
    appState,
    isInitialized,
    checkInitialized,
    setupMasterPassword,
    unlock,
    lock,
  }
})
