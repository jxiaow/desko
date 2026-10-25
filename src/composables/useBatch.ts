import { ref, computed, watch } from 'vue'
import { entriesApi as api } from '../services/api/entries'
import { useEntriesStore } from '../stores/entries'
import { usePasswordStore } from '../stores/password'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'
import { hiddenCount, minusVisible, prune, unionVisible } from '../utils/selection'

export function useBatch() {
  const entriesStore = useEntriesStore()
  const passwordStore = usePasswordStore()
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()

  const selectedIds = ref<Set<string>>(new Set())
  /** 待选态：工具栏「选择」钮开合。收藏卡的勾选框只在批量态显形，这颗钮就是唯一入口。 */
  const pickMode = ref(false)
  const hasSelection = computed(() => selectedIds.value.size > 0)
  const isBatchMode = computed(() => pickMode.value || hasSelection.value)

  /** V：此刻真正渲染在网格里的行。批量钮的作用范围就是它。 */
  const visibleIds = computed(() => entriesStore.filteredEntries.map(item => item.id))
  /** K：攒在 S 里、但被当前分类/搜索挡住的条数。只用于披露，不参与执行。 */
  const hiddenSelected = computed(() => hiddenCount(selectedIds.value, visibleIds.value))

  // 条目从库里消失（单条删除、外部同步）就把残 id 摘掉，免得混进下一次批量入参。
  // 筛选变化不剪枝——跨分类攒批是有意保留的能力。
  watch(() => entriesStore.entries, list => {
    const next = prune(selectedIds.value, list.map(item => item.id))
    if (next !== selectedIds.value) selectedIds.value = next
  }, { flush: 'post' })

  /** 钮的语义是开/合：批量中（无论怎么进的）再点一次整体退出并清空 */
  const togglePick = () => {
    if (isBatchMode.value) exitBatch()
    else pickMode.value = true
  }

  const exitBatch = () => {
    pickMode.value = false
    selectedIds.value = new Set()
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  /** 并入本屏，先前在别的分类里攒的选中一条不丢 */
  const selectAll = () => {
    selectedIds.value = unionVisible(selectedIds.value, visibleIds.value)
  }

  /** 与「全选」对称：只摘掉本屏的，隐藏的留在集合里，退批量才清空 */
  const deselectAll = () => {
    selectedIds.value = minusVisible(selectedIds.value, visibleIds.value)
  }

  const doBatchDelete = () => {
    const ids = Array.from(selectedIds.value)
    if (ids.length === 0) return
    const hidden = hiddenSelected.value
    const scope = hidden > 0 ? `，其中 ${hidden} 条不在当前筛选结果里` : ''
    confirmStore.showConfirm('删除所选', `${ids.length} 条记录将被删除${scope}，此操作不可撤销。`, async () => {
      try {
        const count = await api.batchDeleteEntries(ids)
        passwordStore.evictPasswords(ids)
        await entriesStore.fetchEntries()
        selectedIds.value = new Set()
        toastStore.showToast(`已删除 ${count} 条记录`)
      } catch (e: any) {
        // 失败保留选中，人可以原地重试；清空反而会让人以为已经删了
        toastStore.showToast('删除失败: ' + e.message, 'error')
      }
    })
  }

  return {
    isBatchMode,
    hasSelection,
    pickMode,
    selectedIds,
    hiddenSelected,
    toggleSelect,
    selectAll,
    deselectAll,
    togglePick,
    exitBatch,
    doBatchDelete,
  }
}
