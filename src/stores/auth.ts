import { defineStore } from 'pinia'
import { ref } from 'vue'
import { authApi as api } from '../services/api/auth'
import type { AppState } from '../types'

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

  const setupMasterPassword = async (password: string) => {
    await api.setupMasterPassword(password)
    isInitialized.value = true
    appState.value = 'unlocked'
  }

  const unlock = async (password: string, onUnlock?: () => void) => {
    await api.unlock(password)
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
