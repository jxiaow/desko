<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuth } from './composables/useAuth'
import { useEntries } from './composables/useEntries'
import { useToast } from './composables/useToast'
import { useConfirm } from './composables/useConfirm'
import { useNotes } from './composables/useNotes'
import { usePassword } from './composables/usePassword'
import { useBatch } from './composables/useBatch'
import { useAutoLock } from './composables/useAutoLock'
import { useFileShortcuts } from './composables/useFileShortcuts'
import type { Entry } from './types'
import TitleBar from './components/TitleBar.vue'
import SetupPage from './components/SetupPage.vue'
import UnlockPage from './components/UnlockPage.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ChangePasswordDialog from './components/ChangePasswordDialog.vue'
import ToastNotification from './components/ToastNotification.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import EntryFormDialog from './components/EntryFormDialog.vue'
import DetailDialog from './components/DetailDialog.vue'
import EntriesModule from './components/EntriesModule.vue'
import NotesModule from './components/NotesModule.vue'
import FileShortcutsModule from './components/FileShortcutsModule.vue'
import Sidebar from './components/Sidebar.vue'

const { appState, checkInitialized, lock } = useAuth()
const { toast, showToast } = useToast()
const { confirmDialog, showConfirm, handleConfirm } = useConfirm()
const {
  notes, notesLoading, noteSearchKeyword, activeNoteTab, selectedNote,
  noteCategories, filteredNotes,
  fetchNotes, selectNote, openNewNote, onNoteTitleChange, onNoteContentChange,
  doDeleteNote
} = useNotes(showToast, showConfirm)
const {
  loading, searchKeyword, activeTab, tabs, filteredEntries,
  fetchEntries, deleteEntry, getPassword
} = useEntries()

const {
  visiblePasswords, passwordCache,
  togglePassword, copyToClipboard, copyPassword,
  evictExpiredPasswords, clearSensitiveState
} = usePassword(getPassword, showToast)

const {
  isBatchMode, selectedIds,
  toggleBatchMode, toggleSelect, selectAll, deselectAll, doBatchDelete
} = useBatch(filteredEntries, fetchEntries, showToast, showConfirm)

const {
  loading: filesLoading, searchKeyword: fileSearchKeyword,
  filteredShortcuts, fetchShortcuts, addShortcut, updateShortcut, removeShortcut
} = useFileShortcuts()

const showForm = ref(false)
const editEntry = ref<Entry | null>(null)

const showDetail = ref(false)
const detailEntry = ref<Entry | null>(null)
const openDetail = (entry: Entry) => {
  detailEntry.value = entry
  showDetail.value = true
}

const isSidebarCollapsed = ref(true)
const currentModule = ref<'entries' | 'notes' | 'files'>('entries')
const showSettings = ref(false)
const showChangePassword = ref(false)
const noteFullscreen = ref(false)

const onNoteToggleFullscreen = (isFullscreen: boolean) => {
  noteFullscreen.value = isFullscreen
  if (isFullscreen) {
    isSidebarCollapsed.value = true
  }
}

const doLock = async () => {
  await lock()
  clearSensitiveState()
  try { await navigator.clipboard.writeText('') } catch {}
  searchKeyword.value = ''
  activeTab.value = 'all'
}

const { setup: setupAutoLock } = useAutoLock(appState, doLock, evictExpiredPasswords, showToast)
setupAutoLock()

const openAdd = () => {
  editEntry.value = null
  showForm.value = true
}

const openEdit = (entry: Entry) => {
  editEntry.value = entry
  showForm.value = true
}

const onFormSaved = () => {
  if (editEntry.value) {
    delete passwordCache.value[editEntry.value.id]
    delete visiblePasswords.value[editEntry.value.id]
  }
  fetchEntries((msg) => showToast(msg, 'error'))
}

const doDelete = (entry: Entry) => {
  showConfirm('确认删除', `确定删除「${entry.name}」？`, async () => {
    try {
      await deleteEntry(entry.id)
      showToast('已删除')
    } catch (e: any) {
      showToast(e.message || '删除失败', 'error')
    }
  })
}

const openUrl = async (url: string) => {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    showToast('无法打开浏览器', 'error')
  }
}

const onSetupComplete = async () => { await fetchEntries((msg) => showToast(msg, 'error')) }
const onUnlockComplete = async () => { await fetchEntries((msg) => showToast(msg, 'error')) }

onMounted(async () => {
  await checkInitialized()
  if (appState.value === 'unlocked') {
    await fetchEntries((msg) => showToast(msg, 'error'))
  }

  watch(currentModule, async (newModule) => {
    if (newModule === 'notes' && notes.value.length === 0) {
      await fetchNotes()
    }
    if (newModule === 'files') {
      await fetchShortcuts()
    }
  })
})
</script>

<template>
  <div class="app-root" :class="{ 'locked-bg': appState === 'locked' }">
    <TitleBar
      :is-locked="appState === 'locked'"
      @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
      @open-settings="showSettings = true"
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="onSetupComplete" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="onUnlockComplete" />

    <div v-else class="app-layout">
      <Sidebar
        :collapsed="isSidebarCollapsed"
        :current-module="currentModule"
        @update:collapsed="isSidebarCollapsed = $event"
        @update:current-module="currentModule = $event"
      />

      <div class="main-area">
        <div class="main-content">
          <EntriesModule
            v-if="currentModule === 'entries'"
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

          <NotesModule
            v-else-if="currentModule === 'notes'"
            :notes="notes"
            :notes-loading="notesLoading"
            :note-search-keyword="noteSearchKeyword"
            :active-note-tab="activeNoteTab"
            :selected-note="selectedNote"
            :note-categories="noteCategories"
            :filtered-notes="filteredNotes"
            @update:note-search-keyword="noteSearchKeyword = $event"
            @update:active-note-tab="activeNoteTab = $event"
            @update:selected-note="selectedNote = $event"
            @select-note="selectNote"
            @open-new-note="openNewNote"
            @note-title-change="onNoteTitleChange"
            @note-content-change="onNoteContentChange"
            @delete-note="doDeleteNote"
            @toggle-fullscreen="onNoteToggleFullscreen"
          />

          <FileShortcutsModule
            v-else-if="currentModule === 'files'"
            :search-keyword="fileSearchKeyword"
            :loading="filesLoading"
            :filtered-shortcuts="filteredShortcuts"
            @update:search-keyword="fileSearchKeyword = $event"
            @add-shortcut="addShortcut"
            @update-shortcut="updateShortcut"
            @remove-shortcut="removeShortcut"
            @show-toast="showToast"
            @show-confirm="showConfirm"
          />
        </div>
      </div>
    </div>

    <EntryFormDialog
      v-if="showForm"
      :edit-entry="editEntry"
      :categories="tabs.filter(t => t.id !== 'all').map(t => t.name)"
      @close="showForm = false"
      @saved="onFormSaved"
      @show-toast="showToast"
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

    <SettingsDialog
      v-if="showSettings"
      @close="showSettings = false"
      @open-change-password="showChangePassword = true"
      @show-toast="showToast"
      @show-confirm="showConfirm"
      @entries-refreshed="fetchEntries"
    />

    <ChangePasswordDialog
      v-if="showChangePassword"
      @close="showChangePassword = false"
      @show-toast="showToast"
    />

    <ToastNotification :toast="toast" />
    <ConfirmDialog :dialog="confirmDialog" @confirm="handleConfirm" @cancel="confirmDialog.show = false" />
  </div>
</template>
