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
import { ref } from 'vue'
import { useToastStore } from '../stores/toast'
import { useConfirmStore } from '../stores/confirm'

const entriesStore = useEntriesStore()
const toastStore = useToastStore()
const passwordStore = usePasswordStore()
const { searchKeyword, activeTab, tabs, loading, filteredEntries } = storeToRefs(entriesStore)
const { visiblePasswords, passwordCache } = storeToRefs(passwordStore)
const { togglePassword } = passwordStore
const { fetchEntries } = entriesStore

const { copyToClipboard, copyPassword } = useClipboard()

const {
  isBatchMode, selectedIds,
  toggleBatchMode, toggleSelect, selectAll, deselectAll, doBatchDelete
} = useBatch()

const showForm = ref(false)
const editEntry = ref<Entry | null>(null)
const showDetail = ref(false)
const detailEntry = ref<Entry | null>(null)

const openAdd = () => {
  editEntry.value = null
  showForm.value = true
}

const openEdit = (entry: Entry) => {
  editEntry.value = entry
  showForm.value = true
}

const openDetail = (entry: Entry) => {
  detailEntry.value = entry
  showDetail.value = true
}

const onFormSaved = () => {
  if (editEntry.value) {
    delete passwordCache.value[editEntry.value.id]
    delete visiblePasswords.value[editEntry.value.id]
  }
  fetchEntries((msg) => toastStore.showToast(msg, 'error'))
}

const doDelete = (entry: Entry) => {
  const { showConfirm } = useConfirmStore()
  showConfirm('确认删除', `确定删除「${entry.name}」？`, async () => {
    try {
      await entriesStore.deleteEntry(entry.id)
      toastStore.showToast('已删除')
    } catch (e: any) {
      toastStore.showToast(e.message || '删除失败', 'error')
    }
  })
}

const openUrl = async (url: string) => {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    toastStore.showToast('无法打开浏览器', 'error')
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
  />

  <EntryFormDialog
    v-if="showForm"
    :edit-entry="editEntry"
    :categories="tabs.filter(t => t.id !== 'all').map(t => t.name)"
    @close="showForm = false"
    @saved="onFormSaved"
  />

  <DetailDialog
    v-if="showDetail && detailEntry"
    :entry="detailEntry"
    :visible-passwords="visiblePasswords"
    :password-cache="passwordCache"
    @close="showDetail = false"
    @edit="openEdit"
    @delete="doDelete"
    @toggle-password="togglePassword"
    @copy-password="copyPassword"
    @copy-text="copyToClipboard"
    @open-url="openUrl"
  />
</template>
