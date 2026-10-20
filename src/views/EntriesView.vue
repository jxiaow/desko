<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useEntriesStore } from '../stores/entries'
import { usePasswordStore } from '../stores/password'
import { useClipboard } from '../composables/useClipboard'
import { useBatch } from '../composables/useBatch'
import type { Entry } from '../types'
import EntriesModule from '../components/entries/EntriesModule.vue'
import EntryFormDialog from '../components/entries/EntryFormDialog.vue'
import DetailDialog from '../components/entries/DetailDialog.vue'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'
import { openExternal } from '../utils/openExternal'
import { usePageActive } from '../composables/usePageActive'

defineOptions({ name: 'entries' })
const pageActive = usePageActive()

const entriesStore = useEntriesStore()
const toastStore = useToastStore()
const passwordStore = usePasswordStore()
const { entries, searchKeyword, activeTab, tabs, loading, loadError, filteredEntries } = storeToRefs(entriesStore)
const { visiblePasswords, passwordCache } = storeToRefs(passwordStore)
const { togglePassword } = passwordStore
const { fetchEntries } = entriesStore

const { copyToClipboard, copyPassword } = useClipboard()

const {
  isBatchMode, hasSelection, selectedIds,
  toggleSelect, selectAll, deselectAll, togglePick, exitBatch, doBatchDelete
} = useBatch()

const showForm = ref(false)
const formEntry = ref<Entry | null>(null)
const detailId = ref<string | null>(null)
/** 从 store 取当前对象：编辑保存后弹窗内容跟着刷新，不会停在旧快照上 */
const detailEntry = computed(() => entries.value.find(e => e.id === detailId.value) ?? null)

/* Escape 退批量：弹窗/确认框开着时不归批量管，让位给它们的 useEscapeClose */
const confirmStore = useConfirmStore()
const onEscape = (e: KeyboardEvent) => {
  if (!pageActive.value) return
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (showForm.value || detailEntry.value || confirmStore.confirmDialog.show) return
  if (isBatchMode.value) exitBatch()
}
onMounted(() => window.addEventListener('keydown', onEscape))
onBeforeUnmount(() => window.removeEventListener('keydown', onEscape))

const openAdd = () => {
  formEntry.value = null
  showForm.value = true
}

const openDetail = (entry: Entry) => {
  detailId.value = entry.id
  /* 不等 await：取到就出那行，取不到（没存密码/解密失败）那行继续缺席 */
  passwordStore.primePassword(entry.id)
}

/** 新增/编辑共用同一个表单弹窗；从详情进来时先收起详情，不叠第二层遮罩 */
const openEdit = (entry: Entry) => {
  detailId.value = null
  formEntry.value = entry
  showForm.value = true
}

const closeDetail = () => { detailId.value = null }

const evictPassword = (id: string) => {
  delete passwordCache.value[id]
  delete visiblePasswords.value[id]
}

const onFormSaved = (id: string) => {
  evictPassword(id)
  fetchEntries((msg) => toastStore.showToast(msg, 'error'))
}

const doDelete = (entry: Entry, after?: () => void) => {
  const { showConfirm } = useConfirmStore()
  showConfirm('删除条目', `「${entry.name}」的账号与密码将一并删除。`, async () => {
    try {
      await entriesStore.deleteEntry(entry.id)
      toastStore.showToast('已删除')
      after?.()
    } catch (e: any) {
      toastStore.showToast(e.message || '删除失败', 'error')
    }
  })
}

const categoryNames = computed(() => tabs.value.filter(t => t.id !== 'all').map(t => t.name))

const openUrl = async (url: string) => {
  try {
    await openExternal(url)
  } catch {
    toastStore.showToast('无法打开浏览器', 'error')
  }
}

const duplicateEntry = async (entry: Entry) => {
  try {
    let password = passwordCache.value[entry.id]?.value
    if (!password) {
      password = await passwordStore.getPassword(entry.id)
      passwordCache.value[entry.id] = { value: password, ts: Date.now() }
    }
    await entriesStore.createEntry({
      name: `${entry.name} 副本`,
      url: entry.url || undefined,
      username: entry.username || undefined,
      password,
      notes: entry.notes || undefined,
      category: entry.category || undefined,
    })
    toastStore.showToast('已创建副本')
  } catch (e: any) {
    toastStore.showToast(e.message || '复制失败', 'error')
  }
}
</script>

<template>
  <EntriesModule
    :search-keyword="searchKeyword"
    :tabs="tabs"
    :active-tab="activeTab"
    :loading="loading"
    :load-error="loadError"
    :filtered-entries="filteredEntries"
    :is-batch-mode="isBatchMode"
    :has-selection="hasSelection"
    :selected-ids="selectedIds"
    :visible-passwords="visiblePasswords"
    :password-cache="passwordCache"
    @update:search-keyword="searchKeyword = $event"
    @update:active-tab="activeTab = $event"
    @open-add="openAdd"
    @toggle-pick="togglePick"
    @exit-batch="exitBatch"
    @select-all="selectAll"
    @deselect-all="deselectAll"
    @batch-delete="doBatchDelete"
    @open-detail="openDetail"
    @open-edit="openEdit"
    @delete="doDelete"
    @toggle-select="toggleSelect"
    @toggle-password="togglePassword"
    @copy-password="copyPassword"
    @copy-text="copyToClipboard"
    @open-url="openUrl"
    @duplicate-entry="duplicateEntry"
    @retry-load="fetchEntries((msg) => toastStore.showToast(msg, 'error'))"
  />

  <EntryFormDialog
    v-if="showForm"
    :key="formEntry?.id ?? 'new'"
    :categories="categoryNames"
    :entry="formEntry"
    @close="showForm = false"
    @saved="onFormSaved"
    @open-url="openUrl"
  />

  <DetailDialog
    v-if="detailEntry"
    :key="detailEntry.id"
    :entry="detailEntry"
    :visible-passwords="visiblePasswords"
    :password-cache="passwordCache"
    @close="closeDetail"
    @edit="openEdit"
    @delete="doDelete($event, closeDetail)"
    @toggle-password="togglePassword"
    @copy-password="copyPassword"
    @copy-text="copyToClipboard"
    @open-url="openUrl"
  />
</template>
