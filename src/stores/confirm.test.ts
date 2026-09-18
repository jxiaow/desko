import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConfirmStore } from './confirm'

describe('Confirm Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('showConfirm', () => {
    it('should show confirm dialog with title and message', () => {
      const store = useConfirmStore()
      const onConfirm = vi.fn()

      store.showConfirm('Confirm Title', 'Confirm Message', onConfirm)

      expect(store.confirmDialog.show).toBe(true)
      expect(store.confirmDialog.title).toBe('Confirm Title')
      expect(store.confirmDialog.message).toBe('Confirm Message')
      expect(store.confirmDialog.onConfirm).toBe(onConfirm)
    })
  })

  describe('handleConfirm', () => {
    it('should call onConfirm callback and hide dialog', () => {
      const store = useConfirmStore()
      const onConfirm = vi.fn()

      store.showConfirm('Title', 'Message', onConfirm)
      store.handleConfirm()

      expect(onConfirm).toHaveBeenCalled()
      expect(store.confirmDialog.show).toBe(false)
    })

    it('should execute onConfirm with correct context', () => {
      const store = useConfirmStore()
      let executed = false
      const onConfirm = () => {
        executed = true
      }

      store.showConfirm('Title', 'Message', onConfirm)
      store.handleConfirm()

      expect(executed).toBe(true)
    })
  })

  describe('dialog state', () => {
    it('should initialize with hidden dialog', () => {
      const store = useConfirmStore()

      expect(store.confirmDialog.show).toBe(false)
      expect(store.confirmDialog.title).toBe('')
      expect(store.confirmDialog.message).toBe('')
    })

    it('should replace previous dialog when showing new one', () => {
      const store = useConfirmStore()
      const onConfirm1 = vi.fn()
      const onConfirm2 = vi.fn()

      store.showConfirm('First', 'First message', onConfirm1)
      store.showConfirm('Second', 'Second message', onConfirm2)

      expect(store.confirmDialog.title).toBe('Second')
      expect(store.confirmDialog.message).toBe('Second message')
      expect(store.confirmDialog.onConfirm).toBe(onConfirm2)
    })
  })
})
