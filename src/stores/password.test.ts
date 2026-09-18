import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePasswordStore } from './password'
import { useEntriesStore } from './entries'
import { useToastStore } from './toast'

// Mock dependencies
vi.mock('./entries', () => ({
  useEntriesStore: vi.fn(),
}))

vi.mock('./toast', () => ({
  useToastStore: vi.fn(),
}))

describe('Password Store', () => {
  let mockEntriesStore: any
  let mockToastStore: any

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    mockEntriesStore = {
      getPassword: vi.fn(),
    }
    mockToastStore = {
      showToast: vi.fn(),
    }

    vi.mocked(useEntriesStore).mockReturnValue(mockEntriesStore)
    vi.mocked(useToastStore).mockReturnValue(mockToastStore)
  })

  describe('togglePassword', () => {
    it('should fetch and show password when not visible', async () => {
      const store = usePasswordStore()
      mockEntriesStore.getPassword.mockResolvedValue('secret123')

      await store.togglePassword('1')

      expect(mockEntriesStore.getPassword).toHaveBeenCalledWith('1')
      expect(store.visiblePasswords['1']).toBe(true)
      expect(store.passwordCache['1'].value).toBe('secret123')
    })

    it('should hide password when already visible', async () => {
      const store = usePasswordStore()
      store.visiblePasswords['1'] = true

      await store.togglePassword('1')

      expect(store.visiblePasswords['1']).toBe(false)
      expect(mockEntriesStore.getPassword).not.toHaveBeenCalled()
    })

    it('should use cached password if not expired', async () => {
      const store = usePasswordStore()
      store.passwordCache['1'] = {
        value: 'cached-password',
        ts: Date.now(),
      }

      await store.togglePassword('1')

      expect(mockEntriesStore.getPassword).not.toHaveBeenCalled()
      expect(store.visiblePasswords['1']).toBe(true)
    })

    it('should fetch new password if cache expired', async () => {
      const store = usePasswordStore()
      store.passwordCache['1'] = {
        value: 'old-password',
        ts: Date.now() - 3 * 60 * 1000, // 3 minutes ago
      }
      mockEntriesStore.getPassword.mockResolvedValue('new-password')

      await store.togglePassword('1')

      expect(mockEntriesStore.getPassword).toHaveBeenCalledWith('1')
      expect(store.passwordCache['1'].value).toBe('new-password')
    })

    it('should show error toast on fetch failure', async () => {
      const store = usePasswordStore()
      mockEntriesStore.getPassword.mockRejectedValue(new Error('API Error'))

      await store.togglePassword('1')

      expect(mockToastStore.showToast).toHaveBeenCalledWith('获取密码失败', 'error')
      expect(store.visiblePasswords['1']).toBeUndefined()
    })
  })

  describe('getPasswordDisplay', () => {
    it('should return cached password value', () => {
      const store = usePasswordStore()
      store.passwordCache['1'] = {
        value: 'secret',
        ts: Date.now(),
      }

      expect(store.getPasswordDisplay('1')).toBe('secret')
    })

    it('should return masked value when no cache', () => {
      const store = usePasswordStore()

      expect(store.getPasswordDisplay('1')).toBe('••••••••')
    })
  })

  describe('getPassword', () => {
    it('should return password from entries store', async () => {
      const store = usePasswordStore()
      mockEntriesStore.getPassword.mockResolvedValue('my-password')

      const password = await store.getPassword('1')

      expect(password).toBe('my-password')
      expect(mockEntriesStore.getPassword).toHaveBeenCalledWith('1')
    })
  })

  describe('evictExpiredPasswords', () => {
    it('should remove expired passwords from cache', () => {
      const store = usePasswordStore()
      const now = Date.now()
      store.passwordCache = {
        '1': { value: 'valid', ts: now },
        '2': { value: 'expired', ts: now - 3 * 60 * 1000 },
        '3': { value: 'also-valid', ts: now - 60 * 1000 },
      }

      store.evictExpiredPasswords()

      expect(Object.keys(store.passwordCache).length).toBe(2)
      expect(store.passwordCache['1']).toBeDefined()
      expect(store.passwordCache['2']).toBeUndefined()
      expect(store.passwordCache['3']).toBeDefined()
    })

    it('should not remove passwords within TTL', () => {
      const store = usePasswordStore()
      const now = Date.now()
      store.passwordCache = {
        '1': { value: 'password', ts: now - 1 * 60 * 1000 }, // 1 minute ago
      }

      store.evictExpiredPasswords()

      expect(store.passwordCache['1']).toBeDefined()
    })
  })

  describe('clearSensitiveState', () => {
    it('should clear all visible passwords and cache', () => {
      const store = usePasswordStore()
      store.visiblePasswords = { '1': true, '2': true }
      store.passwordCache = {
        '1': { value: 'pass1', ts: Date.now() },
        '2': { value: 'pass2', ts: Date.now() },
      }

      store.clearSensitiveState()

      expect(store.visiblePasswords).toEqual({})
      expect(store.passwordCache).toEqual({})
    })
  })
})
