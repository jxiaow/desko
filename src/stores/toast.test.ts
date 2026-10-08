import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useToastStore } from './toast'

describe('Toast Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('showToast', () => {
    it('should show toast with message and type', () => {
      const store = useToastStore()

      store.showToast('Success message', 'success')

      expect(store.toast.show).toBe(true)
      expect(store.toast.message).toBe('Success message')
      expect(store.toast.type).toBe('success')
    })

    it('should default to success type', () => {
      const store = useToastStore()

      store.showToast('Message')

      expect(store.toast.type).toBe('success')
    })

    it('should show error toast', () => {
      const store = useToastStore()

      store.showToast('Error message', 'error')

      expect(store.toast.type).toBe('error')
    })

    it('should show info toast', () => {
      const store = useToastStore()

      store.showToast('Info message', 'info')

      expect(store.toast.type).toBe('info')
    })

    it('should hide success toast after 800ms', () => {
      const store = useToastStore()

      store.showToast('Message')
      expect(store.toast.show).toBe(true)

      vi.advanceTimersByTime(799)
      expect(store.toast.show).toBe(true)

      vi.advanceTimersByTime(1)
      expect(store.toast.show).toBe(false)
    })

    it('should keep error toast 2400ms so the reason stays readable', () => {
      const store = useToastStore()

      store.showToast('端口被占用', 'error')
      vi.advanceTimersByTime(800)
      expect(store.toast.show).toBe(true)

      vi.advanceTimersByTime(1600)
      expect(store.toast.show).toBe(false)
    })

    it('should reset timer on subsequent calls', () => {
      const store = useToastStore()

      store.showToast('First message')
      vi.advanceTimersByTime(500)

      store.showToast('Second message')
      vi.advanceTimersByTime(799)
      expect(store.toast.show).toBe(true)
      expect(store.toast.message).toBe('Second message')

      vi.advanceTimersByTime(800)
      expect(store.toast.show).toBe(false)
    })
  })
})
