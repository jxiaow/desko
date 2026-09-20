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
import { ref, computed } from 'vue'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'

const entriesStore = useEntriesStore()
const toastStore = useToastStore()
const passwordStore = usePasswordStore()
const { entries, searchKeyword, activeTab, tabs, loading, filteredEntries } = storeToRefs(entriesStore)
const { visiblePasswords, passwordCache } = storeToRefs(passwordStore)
const { togglePassword } = passwordStore
const { fetchEntries } = entriesStore

const { copyToClipboard, copyPassword } = useClipboard()

const {
  isBatchMode, selectedIds,
  toggleBatchMode, toggleSelect, selectAll, deselectAll, doBatchDelete
} = useBatch()

const showForm = ref(false)
const detailId = ref<string | null>(null)
const detailEditing = ref(false)
/** 从 store 取当前对象：编辑保存后弹窗内容跟着刷新，不会停在旧快照上 */
const detailEntry = computed(() => entries.value.find(e => e.id === detailId.value) ?? null)

const openAdd = () => { showForm.value = true }

const openDetail = (entry: Entry) => {
  detailEditing.value = false
  detailId.value = entry.id
}

const openEdit = (entry: Entry) => {
  detailEditing.value = true
  detailId.value = entry.id
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
  showConfirm('确认删除', `确定删除「${entry.name}」？`, async () => {
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
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
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
    toastStore.showToast('已复制卡片')
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
    :filtered-entries="filteredEntries"
    :is-batch-mode="isBatchMode"
    :selected-ids="selectedIds"
    :visible-passwords="visiblePasswords"
    :password-cache="passwordCache"
    @update:search-keyword="searchKeyword = $event"
    @update:active-tab="activeTab = $event"
    @open-add="openAdd"
    @toggle-batch-mode="toggleBatchMode"
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
  />

  <EntryFormDialog
    v-if="showForm"
    :categories="categoryNames"
    @close="showForm = false"
    @saved="onFormSaved"
  />

  <DetailDialog
    v-if="detailEntry"
    :key="detailEntry.id"
    :entry="detailEntry"
    :categories="categoryNames"
    :initial-editing="detailEditing"
    :visible-passwords="visiblePasswords"
    :password-cache="passwordCache"
    @close="closeDetail"
    @delete="doDelete($event, closeDetail)"
    @saved="onFormSaved"
    @toggle-password="togglePassword"
    @copy-password="copyPassword"
    @copy-text="copyToClipboard"
    @open-url="openUrl"
  />
</template>
