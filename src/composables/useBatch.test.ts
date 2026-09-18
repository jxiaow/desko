import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBatch } from './useBatch'
import { useEntriesStore } from '../stores/entries'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'
import { entriesApi } from '../services/api/entries'

// Mock dependencies
vi.mock('../stores/entries', () => ({
  useEntriesStore: vi.fn(),
}))

vi.mock('../stores/toast', () => ({
  useToastStore: vi.fn(),
}))

vi.mock('../stores/confirm', () => ({
  useConfirmStore: vi.fn(),
}))

vi.mock('../services/api/entries', () => ({
  entriesApi: {
    batchDeleteEntries: vi.fn(),
  },
}))

describe('useBatch', () => {
  let mockEntriesStore: any
  let mockToastStore: any
  let mockConfirmStore: any

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    mockEntriesStore = {
      filteredEntries: [],
      fetchEntries: vi.fn(),
    }
    mockToastStore = {
      showToast: vi.fn(),
    }
    mockConfirmStore = {
      showConfirm: vi.fn(),
    }

    vi.mocked(useEntriesStore).mockReturnValue(mockEntriesStore)
    vi.mocked(useToastStore).mockReturnValue(mockToastStore)
    vi.mocked(useConfirmStore).mockReturnValue(mockConfirmStore)
  })

  describe('toggleBatchMode', () => {
    it('should toggle batch mode on', () => {
      const { isBatchMode, toggleBatchMode } = useBatch()

      expect(isBatchMode.value).toBe(false)
      toggleBatchMode()
      expect(isBatchMode.value).toBe(true)
    })

    it('should toggle batch mode off and clear selection', () => {
      const { isBatchMode, selectedIds, toggleBatchMode, toggleSelect } = useBatch()

      toggleBatchMode()
      toggleSelect('1')
      expect(selectedIds.value.size).toBe(1)

      toggleBatchMode()
      expect(isBatchMode.value).toBe(false)
      expect(selectedIds.value.size).toBe(0)
    })
  })

  describe('toggleSelect', () => {
    it('should add id to selection', () => {
      const { selectedIds, toggleSelect } = useBatch()

      toggleSelect('1')
      expect(selectedIds.value.has('1')).toBe(true)
    })

    it('should remove id from selection if already selected', () => {
      const { selectedIds, toggleSelect } = useBatch()

      toggleSelect('1')
      toggleSelect('1')
      expect(selectedIds.value.has('1')).toBe(false)
    })

    it('should handle multiple selections', () => {
      const { selectedIds, toggleSelect } = useBatch()

      toggleSelect('1')
      toggleSelect('2')
      toggleSelect('3')
      expect(selectedIds.value.size).toBe(3)
    })
  })

  describe('selectAll', () => {
    it('should select all filtered entries', () => {
      const { selectedIds, selectAll } = useBatch()
      mockEntriesStore.filteredEntries = [
        { id: '1', name: 'Entry 1' },
        { id: '2', name: 'Entry 2' },
        { id: '3', name: 'Entry 3' },
      ]

      selectAll()

      expect(selectedIds.value.size).toBe(3)
      expect(selectedIds.value.has('1')).toBe(true)
      expect(selectedIds.value.has('2')).toBe(true)
      expect(selectedIds.value.has('3')).toBe(true)
    })
  })

  describe('deselectAll', () => {
    it('should clear all selections', () => {
      const { selectedIds, toggleSelect, deselectAll } = useBatch()

      toggleSelect('1')
      toggleSelect('2')
      deselectAll()

      expect(selectedIds.value.size).toBe(0)
    })
  })

  describe('doBatchDelete', () => {
    it('should show confirm dialog with correct message', () => {
      const { toggleSelect, doBatchDelete } = useBatch()

      toggleSelect('1')
      toggleSelect('2')
      doBatchDelete()

      expect(mockConfirmStore.showConfirm).toHaveBeenCalledWith(
        '确认删除',
        '确定删除选中的 2 条记录吗？',
        expect.any(Function)
      )
    })

    it('should not show confirm if no items selected', () => {
      const { doBatchDelete } = useBatch()

      doBatchDelete()

      expect(mockConfirmStore.showConfirm).not.toHaveBeenCalled()
    })

    it('should delete selected entries and refresh list', async () => {
      const { isBatchMode, selectedIds, toggleSelect, doBatchDelete } = useBatch()
      vi.mocked(entriesApi.batchDeleteEntries).mockResolvedValue(2)

      toggleSelect('1')
      toggleSelect('2')
      doBatchDelete()

      // Execute the confirm callback
      const confirmCallback = mockConfirmStore.showConfirm.mock.calls[0][2]
      await confirmCallback()

      expect(entriesApi.batchDeleteEntries).toHaveBeenCalledWith(['1', '2'])
      expect(mockEntriesStore.fetchEntries).toHaveBeenCalled()
      expect(selectedIds.value.size).toBe(0)
      expect(isBatchMode.value).toBe(false)
      expect(mockToastStore.showToast).toHaveBeenCalledWith('已删除 2 条记录')
    })

    it('should show error toast on delete failure', async () => {
      const { toggleSelect, doBatchDelete } = useBatch()
      vi.mocked(entriesApi.batchDeleteEntries).mockRejectedValue(new Error('Delete failed'))

      toggleSelect('1')
      doBatchDelete()

      const confirmCallback = mockConfirmStore.showConfirm.mock.calls[0][2]
      await confirmCallback()

      expect(mockToastStore.showToast).toHaveBeenCalledWith('删除失败: Delete failed', 'error')
    })
  })
})
