<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import { useEntriesStore } from './stores/entries'
import { useFileShortcutsStore } from './stores/fileShortcuts'
import { useNotesStore } from './stores/notes'
import { useToastStore } from './stores/toast'
import { useConfirmStore } from './stores/confirm'
import { usePasswordStore } from './stores/password'
import { useAutoLock } from './composables/useAutoLock'
import { installHoverGuard } from './utils/hoverGuard'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import SetupPage from './components/auth/SetupPage.vue'
import UnlockPage from './components/auth/UnlockPage.vue'
import SettingsDialog from './components/settings/SettingsDialog.vue'
import ChangePasswordDialog from './components/settings/ChangePasswordDialog.vue'
import NoteLockDialog from './components/notes/NoteLockDialog.vue'
import ToastNotification from './components/shared/ToastNotification.vue'
import ConfirmDialog from './components/shared/ConfirmDialog.vue'

const authStore = useAuthStore()
const { appState } = storeToRefs(authStore)
const { checkInitialized, lock } = authStore
const toastStore = useToastStore()
const { toast } = storeToRefs(toastStore)
const { showToast } = toastStore
const confirmStore = useConfirmStore()
const { confirmDialog } = storeToRefs(confirmStore)
const { handleConfirm } = confirmStore
const entriesStore = useEntriesStore()
const { fetchEntries } = entriesStore
const fileShortcutsStore = useFileShortcutsStore()
const { fetchShortcuts } = fileShortcutsStore

const passwordStore = usePasswordStore()
const { evictExpiredPasswords, clearSensitiveState } = passwordStore

const isSidebarCollapsed = ref(true)
const showSettings = ref(false)
const settingsInitialTab = ref<'general' | 'fileshare'>('general')
const showChangePassword = ref(false)
/** 小记口令没在手时，设置页那一步得先解锁再改，mode 就是当前该问哪一句 */
const noteKeyMode = ref<'unlock' | 'change' | null>(null)

const openChangeNoteKey = () => {
  const store = useNotesStore()
  noteKeyMode.value = store.noteKey.is_open ? 'change' : 'unlock'
}

const onNoteKeyDone = () => {
  if (noteKeyMode.value === 'unlock') {
    noteKeyMode.value = 'change'
    return
  }
  noteKeyMode.value = null
}

const openSettingsGeneral = () => {
  settingsInitialTab.value = 'general'
  showSettings.value = true
}
// 模块页摘要行等处请求直达设置弹窗的某个页签
const onOpenSettingsTab = (e: Event) => {
  settingsInitialTab.value = ((e as CustomEvent).detail === 'fileshare' ? 'fileshare' : 'general')
  showSettings.value = true
}

const doLock = async () => {
  await lock()
  clearSensitiveState()
  // 加密小记的会话明文跟着锁回去
  useNotesStore().clearUnlockedNotes()
  try { await navigator.clipboard.writeText('') } catch {}
  entriesStore.searchKeyword = ''
  entriesStore.activeTab = 'all'
}

useAutoLock(doLock, evictExpiredPasswords)

const onSetupComplete = async () => { await fetchEntries((msg) => showToast(msg, 'error')) }
const onUnlockComplete = async () => { await fetchEntries((msg) => showToast(msg, 'error')) }

const route = useRoute()
watch(route, (newRoute) => {
  if (newRoute.name === 'files') {
    fetchShortcuts()
  }
})

onMounted(async () => {
  await checkInitialized()
  if (appState.value === 'unlocked') {
    await fetchEntries((msg) => showToast(msg, 'error'))
  }

  // WebView 收不到窗口隐藏/最小化时的 mouseleave，:hover 与 tooltip 会残留到下次打开
  installHoverGuard()
  window.addEventListener('desko:open-settings-tab', onOpenSettingsTab)
})

onUnmounted(() => {
  window.removeEventListener('desko:open-settings-tab', onOpenSettingsTab)
})
</script>

<template>
  <div class="app-root" :class="{ 'locked-bg': appState === 'locked' }">
    <TitleBar
      :is-locked="appState === 'locked'"
      @toggle-sidebar="isSidebarCollapsed = !isSidebarCollapsed"
      @open-settings="openSettingsGeneral"
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="onSetupComplete" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="onUnlockComplete" />

    <div v-else class="app-layout">
      <Sidebar
        :collapsed="isSidebarCollapsed"
        @update:collapsed="isSidebarCollapsed = $event"
      />

      <div class="main-area">
        <div class="main-content">
          <router-view />
        </div>
      </div>
    </div>

    <SettingsDialog
      v-if="showSettings"
      :initial-tab="settingsInitialTab"
      @close="showSettings = false"
      @open-change-password="showChangePassword = true"
      @open-change-note-key="openChangeNoteKey"
      @entries-refreshed="fetchEntries"
    />

    <ChangePasswordDialog
      v-if="showChangePassword"
      @close="showChangePassword = false"
    />

    <NoteLockDialog
      v-if="noteKeyMode"
      :mode="noteKeyMode"
      @close="noteKeyMode = null"
      @done="onNoteKeyDone"
    />

    <ToastNotification :toast="toast" />
    <ConfirmDialog :dialog="confirmDialog" @confirm="handleConfirm" @cancel="confirmDialog.show = false" />
  </div>
</template>
