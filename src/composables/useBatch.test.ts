import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useBatch } from './useBatch'
import { useEntriesStore } from '../stores/entries'
import { usePasswordStore } from '../stores/password'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'
import { entriesApi } from '../services/api/entries'

// Mock dependencies
vi.mock('../stores/entries', () => ({
  useEntriesStore: vi.fn(),
}))

vi.mock('../stores/password', () => ({
  usePasswordStore: vi.fn(),
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
  let mockPasswordStore: any
  let mockToastStore: any
  let mockConfirmStore: any

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // reactive：S 剪枝靠 watch store 的 entries，纯对象 mock 永远不触发
    mockEntriesStore = reactive({
      entries: [] as any[],
      filteredEntries: [] as any[],
      fetchEntries: vi.fn(),
    })
    mockPasswordStore = {
      evictPasswords: vi.fn(),
    }
    mockToastStore = {
      showToast: vi.fn(),
    }
    mockConfirmStore = {
      showConfirm: vi.fn(),
    }

    vi.mocked(useEntriesStore).mockReturnValue(mockEntriesStore)
    vi.mocked(usePasswordStore).mockReturnValue(mockPasswordStore)
    vi.mocked(useToastStore).mockReturnValue(mockToastStore)
    vi.mocked(useConfirmStore).mockReturnValue(mockConfirmStore)
  })

  /** V：当前筛选可见的 id */
  const setVisible = (...ids: string[]) => {
    mockEntriesStore.filteredEntries = ids.map(id => ({ id }))
  }
  /** 库里的条目全集：剪枝只看它 */
  const setEntries = (...ids: string[]) => {
    mockEntriesStore.entries = ids.map(id => ({ id }))
  }

  describe('勾选即进 / 清空即收', () => {
    it('should enter batch mode on first check without any toggle', () => {
      const { isBatchMode, selectedIds, toggleSelect } = useBatch()

      expect(isBatchMode.value).toBe(false)
      toggleSelect('1')
      expect(isBatchMode.value).toBe(true)
      expect(selectedIds.value.size).toBe(1)
    })

    it('should leave batch mode when the last selection is unchecked', () => {
      const { isBatchMode, selectedIds, toggleSelect } = useBatch()

      toggleSelect('1')
      toggleSelect('2')
      toggleSelect('1')
      expect(isBatchMode.value).toBe(true)
      toggleSelect('2')
      expect(isBatchMode.value).toBe(false)
      expect(selectedIds.value.size).toBe(0)
    })

    it('should leave batch mode after deselectAll', async () => {
      const { isBatchMode, toggleSelect, deselectAll } = useBatch()
      setVisible('1')

      toggleSelect('1')
      deselectAll()
      await nextTick()
      expect(isBatchMode.value).toBe(false)
    })
  })

  describe('工具栏「选择」钮：待选态开合', () => {
    it('空选中也能开：钮开待选，dock 不出', () => {
      const { isBatchMode, hasSelection, togglePick } = useBatch()

      togglePick()
      expect(isBatchMode.value).toBe(true)
      expect(hasSelection.value).toBe(false)
    })

    it('批量中再点一次整体退出并清空', () => {
      const { isBatchMode, selectedIds, toggleSelect, togglePick } = useBatch()

      toggleSelect('1')
      togglePick()
      expect(isBatchMode.value).toBe(false)
      expect(selectedIds.value.size).toBe(0)
    })

    it('exitBatch 收待选也清选中', () => {
      const { isBatchMode, selectedIds, togglePick, toggleSelect, exitBatch } = useBatch()

      togglePick()
      toggleSelect('1')
      exitBatch()
      expect(isBatchMode.value).toBe(false)
      expect(selectedIds.value.size).toBe(0)
    })

    it('exitBatch 连别的分类里攒的也一起清', () => {
      const { isBatchMode, selectedIds, toggleSelect, exitBatch } = useBatch()

      setVisible('1')
      toggleSelect('1')
      setVisible('2')
      toggleSelect('2')
      expect(selectedIds.value.size).toBe(2)
      exitBatch()
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

  describe('全选：并入本屏，不替换', () => {
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

    it('换分类后全选：别的分类里攒的那条不丢（S = 2 + 本屏）', () => {
      const { selectedIds, toggleSelect, selectAll } = useBatch()

      setVisible('1', '2')
      toggleSelect('1')
      toggleSelect('2')
      setVisible('3', '4', '5')
      selectAll()

      expect(selectedIds.value.size).toBe(5)
      expect([...selectedIds.value].sort()).toEqual(['1', '2', '3', '4', '5'])
    })

    it('重复全选幂等', () => {
      const { selectedIds, selectAll } = useBatch()
      setVisible('1', '2')

      selectAll()
      selectAll()

      expect(selectedIds.value.size).toBe(2)
    })
  })

  describe('取消本屏：只摘 V，隐藏的留着', () => {
    it('should clear all selections', () => {
      const { selectedIds, toggleSelect, deselectAll } = useBatch()
      setVisible('1', '2')

      toggleSelect('1')
      toggleSelect('2')
      deselectAll()

      expect(selectedIds.value.size).toBe(0)
    })

    it('跨分类攒批后取消本屏，非本屏的选中仍在且批量态不退', () => {
      const { isBatchMode, selectedIds, hiddenSelected, selectAll, deselectAll } = useBatch()

      setVisible('1', '2')
      selectAll()
      setVisible('3')
      selectAll()
      expect(selectedIds.value.size).toBe(3)
      expect(hiddenSelected.value).toBe(2)

      // 剩下的两条正好都是被筛掉的：K = |S| = 2，钮管不着它们
      deselectAll()

      expect(selectedIds.value.size).toBe(2)
      expect(hiddenSelected.value).toBe(2)
      expect(isBatchMode.value).toBe(true)
    })

    it('筛选为空时取消本屏不动集合', () => {
      const { selectedIds, toggleSelect, deselectAll } = useBatch()

      toggleSelect('1')
      setVisible()
      deselectAll()

      expect(selectedIds.value.size).toBe(1)
    })
  })

  describe('hiddenSelected：K 只算不显示', () => {
    it('全部可见时 K = 0', () => {
      const { hiddenSelected, toggleSelect } = useBatch()
      setVisible('1', '2')

      toggleSelect('1')
      toggleSelect('2')

      expect(hiddenSelected.value).toBe(0)
    })

    it('一条被筛掉时 K = 1', () => {
      const { hiddenSelected, toggleSelect } = useBatch()
      setVisible('1')

      toggleSelect('1')
      toggleSelect('9')

      expect(hiddenSelected.value).toBe(1)
    })
  })

  describe('S 剪枝：条目从库里消失才摘', () => {
    it('单条删除后残 id 不留在集合里', async () => {
      const { selectedIds, toggleSelect } = useBatch()
      setEntries('1', '2', '3')
      setVisible('1', '2', '3')

      toggleSelect('1')
      toggleSelect('2')
      setEntries('1', '3')
      await nextTick()

      expect(selectedIds.value.size).toBe(1)
      expect(selectedIds.value.has('2')).toBe(false)
    })

    it('筛选变化不剪枝', async () => {
      const { selectedIds, toggleSelect } = useBatch()
      setEntries('1', '2', '3')
      setVisible('1', '2', '3')

      toggleSelect('1')
      setVisible('2')
      await nextTick()

      expect(selectedIds.value.has('1')).toBe(true)
    })
  })

  describe('doBatchDelete', () => {
    it('should show confirm dialog with correct message', () => {
      const { toggleSelect, doBatchDelete } = useBatch()
      setVisible('1', '2')

      toggleSelect('1')
      toggleSelect('2')
      doBatchDelete()

      expect(mockConfirmStore.showConfirm).toHaveBeenCalledWith(
        '删除所选',
        '2 条记录将被删除，此操作不可撤销。',
        expect.any(Function)
      )
    })

    it('K > 0 时确认框把隐藏部分说全', () => {
      const { toggleSelect, selectAll, doBatchDelete } = useBatch()

      setVisible('7', '8')
      selectAll()
      setVisible('1')
      toggleSelect('1')
      doBatchDelete()

      expect(mockConfirmStore.showConfirm).toHaveBeenCalledWith(
        '删除所选',
        '3 条记录将被删除，其中 2 条不在当前筛选结果里，此操作不可撤销。',
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
      setVisible('1', '2')

      toggleSelect('1')
      toggleSelect('2')
      doBatchDelete()

      // Execute the confirm callback
      const confirmCallback = mockConfirmStore.showConfirm.mock.calls[0][2]
      await confirmCallback()

      expect(entriesApi.batchDeleteEntries).toHaveBeenCalledWith(['1', '2'])
      expect(mockPasswordStore.evictPasswords).toHaveBeenCalledWith(['1', '2'])
      expect(mockEntriesStore.fetchEntries).toHaveBeenCalled()
      expect(selectedIds.value.size).toBe(0)
      expect(isBatchMode.value).toBe(false)
      expect(mockToastStore.showToast).toHaveBeenCalledWith('已删除 2 条记录')
    })

    it('should show error toast on delete failure', async () => {
      const { toggleSelect, doBatchDelete } = useBatch()
      vi.mocked(entriesApi.batchDeleteEntries).mockRejectedValue(new Error('Delete failed'))
      setVisible('1')

      toggleSelect('1')
      doBatchDelete()

      const confirmCallback = mockConfirmStore.showConfirm.mock.calls[0][2]
      await confirmCallback()

      expect(mockToastStore.showToast).toHaveBeenCalledWith('删除失败: Delete failed', 'error')
    })

    it('删除失败保留选中，可原地重试', async () => {
      const { isBatchMode, selectedIds, toggleSelect, doBatchDelete } = useBatch()
      vi.mocked(entriesApi.batchDeleteEntries).mockRejectedValue(new Error('boom'))
      setVisible('1')

      toggleSelect('1')
      doBatchDelete()
      await mockConfirmStore.showConfirm.mock.calls[0][2]()

      expect(selectedIds.value.size).toBe(1)
      expect(isBatchMode.value).toBe(true)
    })
  })
})
