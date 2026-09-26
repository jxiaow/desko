import { ref, computed } from 'vue'
import { entriesApi as api } from '../services/api/entries'
import { useEntriesStore } from '../stores/entries'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'

export function useBatch() {
  const entriesStore = useEntriesStore()
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()

  const selectedIds = ref<Set<string>>(new Set())
  /** 待选态：工具栏「选择」钮开合。勾选即进仍成立——有选中就等于在批量里。 */
  const pickMode = ref(false)
  const hasSelection = computed(() => selectedIds.value.size > 0)
  const isBatchMode = computed(() => pickMode.value || hasSelection.value)

  /** 钮的语义是开/合：批量中（无论怎么进的）再点一次整体退出并清空 */
  const togglePick = () => {
    if (isBatchMode.value) exitBatch()
    else pickMode.value = true
  }

  const exitBatch = () => {
    pickMode.value = false
    selectedIds.value.clear()
  }

  const toggleSelect = (id: string) => {
    if (selectedIds.value.has(id)) {
      selectedIds.value.delete(id)
    } else {
      selectedIds.value.add(id)
    }
  }

  const selectAll = () => {
    entriesStore.filteredEntries.forEach(item => {
      selectedIds.value.add(item.id)
    })
  }

  const deselectAll = () => {
    selectedIds.value.clear()
  }

  const doBatchDelete = () => {
    if (selectedIds.value.size === 0) return
    confirmStore.showConfirm('确认删除', `确定删除选中的 ${selectedIds.value.size} 条记录吗？`, async () => {
      try {
        const ids = Array.from(selectedIds.value)
        const count = await api.batchDeleteEntries(ids)
        await entriesStore.fetchEntries()
        selectedIds.value.clear()
        toastStore.showToast(`已删除 ${count} 条记录`)
      } catch (e: any) {
        toastStore.showToast('删除失败: ' + e.message, 'error')
      }
    })
  }

  return {
    isBatchMode,
    hasSelection,
    pickMode,
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    togglePick,
    exitBatch,
    doBatchDelete,
  }
}
