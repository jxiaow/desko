import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useClipboard } from './useClipboard'
import { useToastStore } from '../stores/toast'
import { usePasswordStore } from '../stores/password'

// Mock navigator.clipboard
const mockClipboard = {
  writeText: vi.fn(),
}
Object.assign(navigator, { clipboard: mockClipboard })

// Mock stores
vi.mock('../stores/toast', () => ({
  useToastStore: vi.fn(),
}))

vi.mock('../stores/password', () => ({
  usePasswordStore: vi.fn(),
}))

describe('useClipboard', () => {
  let mockToastStore: any
  let mockPasswordStore: any

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()

    mockToastStore = {
      showToast: vi.fn(),
    }
    mockPasswordStore = {
      passwordCache: {},
      getPassword: vi.fn(),
    }

    vi.mocked(useToastStore).mockReturnValue(mockToastStore)
    vi.mocked(usePasswordStore).mockReturnValue(mockPasswordStore)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('copyToClipboard', () => {
    it('should copy text and show success toast', async () => {
      const { copyToClipboard } = useClipboard()
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyToClipboard('test text', '用户名')

      expect(mockClipboard.writeText).toHaveBeenCalledWith('test text')
      expect(mockToastStore.showToast).toHaveBeenCalledWith('用户名已复制')
    })

    it('should show error toast on copy failure', async () => {
      const { copyToClipboard } = useClipboard()
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard error'))

      await copyToClipboard('test text', '用户名')

      expect(mockToastStore.showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
  })

  describe('copyPassword', () => {
    it('should use cached password if available', async () => {
      const { copyPassword } = useClipboard()
      mockPasswordStore.passwordCache = {
        '1': { value: 'cached-password', ts: Date.now() },
      }
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyPassword('1')

      expect(mockPasswordStore.getPassword).not.toHaveBeenCalled()
      expect(mockClipboard.writeText).toHaveBeenCalledWith('cached-password')
      expect(mockToastStore.showToast).toHaveBeenCalledWith('密码已复制，30秒后自动清除')
    })

    it('should fetch password if not cached', async () => {
      const { copyPassword } = useClipboard()
      mockPasswordStore.passwordCache = {}
      mockPasswordStore.getPassword.mockResolvedValue('fetched-password')
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyPassword('1')

      expect(mockPasswordStore.getPassword).toHaveBeenCalledWith('1')
      expect(mockClipboard.writeText).toHaveBeenCalledWith('fetched-password')
      expect(mockPasswordStore.passwordCache['1'].value).toBe('fetched-password')
    })

    it('should fetch password if cache expired', async () => {
      const { copyPassword } = useClipboard()
      mockPasswordStore.passwordCache = {
        '1': { value: 'old-password', ts: Date.now() - 3 * 60 * 1000 },
      }
      mockPasswordStore.getPassword.mockResolvedValue('new-password')
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyPassword('1')

      expect(mockPasswordStore.getPassword).toHaveBeenCalledWith('1')
      expect(mockClipboard.writeText).toHaveBeenCalledWith('new-password')
    })

    it('should clear clipboard after 30 seconds', async () => {
      const { copyPassword } = useClipboard()
      mockPasswordStore.passwordCache = {
        '1': { value: 'password', ts: Date.now() },
      }
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyPassword('1')
      expect(mockClipboard.writeText).toHaveBeenCalledWith('password')

      vi.advanceTimersByTime(30 * 1000)
      expect(mockClipboard.writeText).toHaveBeenCalledWith('')
    })

    it('should show error toast on failure', async () => {
      const { copyPassword } = useClipboard()
      mockPasswordStore.passwordCache = {
        '1': { value: 'password', ts: Date.now() },
      }
      mockClipboard.writeText.mockRejectedValue(new Error('Clipboard error'))

      await copyPassword('1')

      expect(mockToastStore.showToast).toHaveBeenCalledWith('复制失败', 'error')
    })
  })

  describe('clearClipboardTimer', () => {
    it('should clear clipboard timer', async () => {
      const { copyPassword, clearClipboardTimer } = useClipboard()
      mockPasswordStore.passwordCache = {
        '1': { value: 'password', ts: Date.now() },
      }
      mockClipboard.writeText.mockResolvedValue(undefined)

      await copyPassword('1')
      clearClipboardTimer()

      vi.advanceTimersByTime(30 * 1000)
      // Should not clear clipboard since timer was cleared
      expect(mockClipboard.writeText).toHaveBeenCalledTimes(1)
    })
  })
})
