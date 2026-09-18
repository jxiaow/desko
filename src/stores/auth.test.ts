import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './auth'
import { authApi } from '../services/api/auth'

// Mock API
vi.mock('../services/api/auth', () => ({
  authApi: {
    isInitialized: vi.fn(),
    setupMasterPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
  },
}))

describe('Auth Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('checkInitialized', () => {
    it('should set appState to locked when initialized', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.isInitialized).mockResolvedValue(true)

      await store.checkInitialized()

      expect(store.isInitialized).toBe(true)
      expect(store.appState).toBe('locked')
    })

    it('should set appState to setup when not initialized', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.isInitialized).mockResolvedValue(false)

      await store.checkInitialized()

      expect(store.isInitialized).toBe(false)
      expect(store.appState).toBe('setup')
    })

    it('should set appState to setup on error', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.isInitialized).mockRejectedValue(new Error('API Error'))

      await store.checkInitialized()

      expect(store.appState).toBe('setup')
    })
  })

  describe('setupMasterPassword', () => {
    it('should setup password and unlock app', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.setupMasterPassword).mockResolvedValue()

      await store.setupMasterPassword('test-password')

      expect(authApi.setupMasterPassword).toHaveBeenCalledWith('test-password')
      expect(store.isInitialized).toBe(true)
      expect(store.appState).toBe('unlocked')
    })
  })

  describe('unlock', () => {
    it('should unlock app with correct password', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.unlock).mockResolvedValue()

      await store.unlock('correct-password')

      expect(authApi.unlock).toHaveBeenCalledWith('correct-password')
      expect(store.appState).toBe('unlocked')
    })

    it('should call onUnlock callback after unlock', async () => {
      const store = useAuthStore()
      const onUnlock = vi.fn()
      vi.mocked(authApi.unlock).mockResolvedValue()

      await store.unlock('password', onUnlock)

      expect(onUnlock).toHaveBeenCalled()
    })

    it('should throw error on wrong password', async () => {
      const store = useAuthStore()
      vi.mocked(authApi.unlock).mockRejectedValue(new Error('Wrong password'))

      await expect(store.unlock('wrong-password')).rejects.toThrow('Wrong password')
      expect(store.appState).toBe('locked')
    })
  })

  describe('lock', () => {
    it('should lock app', async () => {
      const store = useAuthStore()
      store.appState = 'unlocked'
      vi.mocked(authApi.lock).mockResolvedValue()

      await store.lock()

      expect(authApi.lock).toHaveBeenCalled()
      expect(store.appState).toBe('locked')
    })
  })
})
