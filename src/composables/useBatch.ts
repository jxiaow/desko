import { ref, type ComputedRef } from 'vue'
import { api } from '../services/api'
import type { Entry } from '../types'

export function useBatch(
  filteredEntries: ComputedRef<Entry[]>,
  fetchEntries: () => Promise<void>,
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void,
  showConfirm: (title: string, msg: string, cb: () => void) => void,
) {
  const isBatchMode = ref(false)
  const selectedIds = ref<Set<string>>(new Set())

  const toggleBatchMode = () => {
    isBatchMode.value = !isBatchMode.value
    if (!isBatchMode.value) {
      selectedIds.value.clear()
    }
  }

  const toggleSelect = (id: string) => {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }
  }

  const selectAll = () => {
    filteredEntries.value.forEach(item => {
      selectedIds.value.add(item.id)
    })
  }

  const deselectAll = () => {
    selectedIds.value.clear()
  }

  const doBatchDelete = () => {
    if (selectedIds.value.size === 0) return
    showConfirm('确认删除', `确定删除选中的 ${selectedIds.value.size} 条记录吗？`, async () => {
      try {
        const ids = Array.from(selectedIds.value)
        const count = await api.batchDeleteEntries(ids)
        await fetchEntries()
        selectedIds.value.clear()
        isBatchMode.value = false
        showToast(`已删除 ${count} 条记录`)
      } catch (e: any) {
        showToast('删除失败: ' + e.message, 'error')
      }
    })
  }

  return {
    isBatchMode,
    selectedIds,
    toggleBatchMode,
    toggleSelect,
    selectAll,
    deselectAll,
    doBatchDelete,
  }
}
