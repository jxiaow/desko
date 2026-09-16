import { ref } from 'vue'
import { api } from '../services/api'
import type { AppState } from '../types'

const appState = ref<AppState>('locked')
const isInitialized = ref(false)

export function useAuth() {
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

  const unlock = async (password: string) => {
    await api.unlock(password)
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
}
