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

/** 侧栏三态（V5.2 收编轮 P2）：展开 208 / 图标轨 56 / 收起 0。
    缺省仍是图标轨——和旧的两态时代一致，小窗开局不把内容挤窄。 */
const sidebarMode = ref<'expanded' | 'rail' | 'hidden'>('rail')
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
  window.addEventListener('keydown', onGlobalKey)
})

onUnmounted(() => {
  window.removeEventListener('desko:open-settings-tab', onOpenSettingsTab)
  window.removeEventListener('keydown', onGlobalKey)
})

/* Ctrl/Cmd+B 按 rail → expanded → hidden 的顺序循环：缺省是图标轨，
   所以第一下必须先展开（旧两态时代就是这个手感），第三下才收干净 */
const SIDEBAR_MODES = ['rail', 'expanded', 'hidden'] as const
function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault()
    const i = SIDEBAR_MODES.indexOf(sidebarMode.value)
    sidebarMode.value = SIDEBAR_MODES[(i + 1) % SIDEBAR_MODES.length]
  }
}
</script>

<template>
  <div class="app-root" :class="{ 'locked-bg': appState === 'locked' }">
    <!-- 锁定/初始化态：顶栏浮在页面上；解锁态：顶栏进右列，侧栏全高贯通 -->
    <TitleBar
      v-if="appState !== 'unlocked'"
      :is-locked="appState === 'locked'"
      @open-settings="openSettingsGeneral"
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="onSetupComplete" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="onUnlockComplete" />

    <div v-else class="app-layout">
      <Sidebar
        v-if="sidebarMode !== 'hidden'"
        :collapsed="sidebarMode === 'rail'"
        @update:collapsed="sidebarMode = $event ? 'rail' : 'expanded'"
      />

      <div class="main-area">
        <TitleBar
          :sidebar-hidden="sidebarMode === 'hidden'"
          @open-settings="openSettingsGeneral"
          @lock="doLock"
          @show-sidebar="sidebarMode = 'expanded'"
        />

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
