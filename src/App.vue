<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from './stores/auth'
import { useToastStore } from './stores/toast'
import { useConfirmStore } from './stores/confirm'
import { usePasswordStore } from './stores/password'
import { useEntriesStore } from './stores/entries'
import { useFileShortcutsStore } from './stores/fileShortcuts'
import { useNotesStore } from './stores/notes'
import { useAutoLock, type LockRequest } from './composables/useAutoLock'
import { useClipboard } from './composables/useClipboard'
import { useWorkspaceDirectory } from './composables/useWorkspaceDirectory'
import { installHoverGuard } from './utils/hoverGuard'
import { isPageShortcutBlocked } from './utils/pageShortcuts'
import { bootEnabledModules, flushModulesBeforeLock, lockEnabledModules } from './modules/state'
import { stopModuleSync } from './modules/runtime'
import { requestCodexAccountsView } from './services/codexState'
import {
  activateCodexHudBridge,
  deactivateCodexHudBridge,
  suspendCodexHudData,
  setCodexHudOpenHandler,
} from './services/codexHud'
import type { SettingsTabId } from './modules/registry'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import CodexWorkspace from './components/layout/CodexWorkspace.vue'
import ModuleRouterView from './components/layout/ModuleRouterView.vue'
import WebModuleDrawer from './components/layout/WebModuleDrawer.vue'
import SetupPage from './components/auth/SetupPage.vue'
import UnlockPage from './components/auth/UnlockPage.vue'
import { authApi } from './services/api/auth'
import { isWebRuntime, isCodexWebRuntime } from './services/runtime'
import { sidebarCollapsed } from './services/sidebar'
import WebSettingsDialog from './components/settings/WebSettingsDialog.vue'
import SettingsDialog from './components/settings/SettingsDialog.vue'
import ChangePasswordDialog from './components/settings/ChangePasswordDialog.vue'
import NoteLockDialog from './components/notes/NoteLockDialog.vue'
import ToastNotification from './components/shared/ToastNotification.vue'
import ConfirmDialog from './components/shared/ConfirmDialog.vue'
import QuitDialog from './components/shared/QuitDialog.vue'

const router = useRouter()
const {
  directoryAvailable, directoryVisible, directoryCompact, directoryPinned,
  toggleDirectoryPin, toggleDirectory, closeDirectory, restoreDirectory,
} = useWorkspaceDirectory()
const authStore = useAuthStore()
const { appState } = storeToRefs(authStore)
const { checkInitialized, lock } = authStore
const toastStore = useToastStore()
const { toast } = storeToRefs(toastStore)
const confirmStore = useConfirmStore()
const { confirmDialog } = storeToRefs(confirmStore)
const { handleConfirm, clearConfirm } = confirmStore
const passwordStore = usePasswordStore()
const { evictExpiredPasswords, clearSensitiveState } = passwordStore
const { clearClipboardTimer } = useClipboard()

const toastRight = computed(() => directoryVisible.value ? 'var(--workspace-directory-width)' : '0px')
const showSettings = ref(false)
const showWebModules = ref(false)
const settingsInitialTab = ref<SettingsTabId>('appearance')
const showChangePassword = ref(false)
const compactSidebarQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 899px)') : null
const compactSidebar = ref(compactSidebarQuery?.matches ?? false)
const syncCompactSidebar = (event: MediaQueryListEvent) => { compactSidebar.value = event.matches }
const sidebarIsCompact = computed(() => !isWebRuntime() && (sidebarCollapsed.value || compactSidebar.value))
/** 小记口令没在手时，设置页那一步得先解锁再改，mode 就是当前该问哪一句 */
const noteKeyMode = ref<'unlock' | 'change' | null>(null)

const onNoteKeyDone = () => {
  if (noteKeyMode.value === 'unlock') {
    noteKeyMode.value = 'change'
    return
  }
  noteKeyMode.value = null
}

const openSettingsAppearance = () => {
  settingsInitialTab.value = 'appearance'
  showSettings.value = true
}
// 模块页摘要行等处请求直达设置弹窗的某个页签
const onOpenSettingsTab = (e: Event) => {
  settingsInitialTab.value = (e as CustomEvent).detail as SettingsTabId
  showSettings.value = true
}

let lockInFlight: Promise<void> | null = null
let lockGeneration = 0
let lockIsForced = false
let lockResetsDrafts = false
const finishLock = async () => {
  // 挂件保留最近一次额度；账号与会话仍随应用锁定清除。
  suspendCodexHudData()
  showWebModules.value = false
  showSettings.value = false
  showChangePassword.value = false
  noteKeyMode.value = null
  clearConfirm()
  // Browser logout may wait for an offline server. Hide private UI and clear
  // local state immediately; transport serializes the cookie-changing requests.
  const webLogout = isWebRuntime() ? authApi.lock() : null
  if (webLogout) stopModuleSync()
  if (webLogout) appState.value = 'locked'
  else await lock()
  clearSensitiveState()
  if (webLogout) {
    useEntriesStore().entries = []
    useFileShortcutsStore().shortcuts = []
    toastStore.toast = { show: false, message: '', type: 'info' }
  }
  // 会话明文随密钥一起收回，禁用过的模块也清理。
  lockEnabledModules()
  // 撤销旧密码清除定时器，避免解锁后的新剪贴板被误删。
  clearClipboardTimer()
  try { await navigator.clipboard.writeText('') } catch {}
  if (webLogout) await webLogout
}

const doLock = (request: LockRequest = {}): Promise<void> => {
  const { resetDrafts = false } = request
  const forced = request.forced === true || resetDrafts
  if (lockInFlight && (!resetDrafts || lockResetsDrafts) && (!forced || lockIsForced)) return lockInFlight
  const generation = ++lockGeneration
  lockIsForced = forced
  lockResetsDrafts = resetDrafts
  const run = async () => {
    if (forced) {
      if (resetDrafts) {
        // Restore replaced the database: old edits must never replay into it.
        useNotesStore().discardDraftsForRestore()
      } else {
        // Native has already revoked the key at its deadline; bypass a stalled save RPC.
        try { await useNotesStore().forceSealDrafts() } catch (e: any) {
          useNotesStore().dropUnsealedDrafts()
          toastStore.showToast('强制锁定时草稿保留失败：' + (e.message ?? e), 'error')
        }
      }
    } else {
      try { await flushModulesBeforeLock() } catch (e: any) {
        if (generation === lockGeneration) toastStore.showToast('锁定已取消：' + (e.message ?? e), 'error')
        return
      }
    }
    if (generation === lockGeneration) await finishLock()
  }
  const task = run().finally(() => {
    if (generation === lockGeneration) { lockInFlight = null; lockIsForced = false; lockResetsDrafts = false }
  })
  lockInFlight = task
  return task
}

useAutoLock(doLock, evictExpiredPasswords)

const openCodexFromHud = () => {
  void router.push('/codex')
  requestCodexAccountsView()
}

const bootModules = async () => {
  await bootEnabledModules()
  setCodexHudOpenHandler(openCodexFromHud)
  await activateCodexHudBridge()
}
const onWebSessionExpired = () => {
  if (isWebRuntime()) void doLock({ forced: true, resetDrafts: true })
}
let unlistenKdfWarning: (() => void) | null = null

onMounted(async () => {
  await restoreDirectory()
  if (!isWebRuntime()) {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenKdfWarning = await listen('auth-kdf-upgrade-warning', () => {
      toastStore.showToast('口令保护升级未完成，已按原格式解锁', 'error')
    })
  }
  await checkInitialized()
  setCodexHudOpenHandler(openCodexFromHud)
  if (appState.value === 'unlocked') {
    await bootModules()
  } else {
    await activateCodexHudBridge(false)
  }

  if (compactSidebarQuery) {
    compactSidebar.value = compactSidebarQuery.matches
    compactSidebarQuery.addEventListener('change', syncCompactSidebar)
  }
  // WebView 收不到窗口隐藏/最小化时的 mouseleave，:hover 与 tooltip 会残留到下次打开
  installHoverGuard()
  window.addEventListener('desko:open-settings-tab', onOpenSettingsTab)
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('desko:web-session-expired', onWebSessionExpired)
})

onUnmounted(() => {
  compactSidebarQuery?.removeEventListener('change', syncCompactSidebar)
  setCodexHudOpenHandler(null)
  void deactivateCodexHudBridge()
  unlistenKdfWarning?.()
  window.removeEventListener('desko:open-settings-tab', onOpenSettingsTab)
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('desko:web-session-expired', onWebSessionExpired)
})

// Ctrl/Cmd+B 只切换当前模块的辅助目录。
function onGlobalKey(e: KeyboardEvent) {
  if (isPageShortcutBlocked(e)) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b' && directoryAvailable.value) {
    e.preventDefault()
    toggleDirectory()
  }
}
</script>

<template>
  <div class="app-root codex-layout" :class="{ 'locked-bg': appState === 'locked', 'sidebar-collapsed': sidebarIsCompact, 'web-runtime': isWebRuntime(), 'codex-web-runtime': isCodexWebRuntime() }" :style="{ '--toast-side': 'var(--sidebar-rail-w)', '--toast-right': toastRight }">
    <!-- 锁定/初始化态：顶栏浮在页面上；解锁态：顶栏横跨工作区。 -->
    <TitleBar
      v-if="appState !== 'unlocked'"
      is-locked
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="bootModules" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="bootModules" />

    <template v-else>
      <TitleBar :modules-open="showWebModules" @lock="doLock" @show-modules="showWebModules = true" />
      <div class="app-layout">
        <Sidebar @open-settings="openSettingsAppearance" @lock="doLock" />
        <CodexWorkspace :directory-visible="directoryVisible" :directory-compact="directoryCompact" :directory-pinned="directoryPinned" @close-directory="closeDirectory" @toggle-directory="toggleDirectory" @toggle-directory-pin="toggleDirectoryPin"><ModuleRouterView /></CodexWorkspace>
      </div>
    </template>

    <WebModuleDrawer
      v-if="showWebModules && appState === 'unlocked' && isWebRuntime()"
      @close="showWebModules = false"
      @open-settings="showWebModules = false; openSettingsAppearance()"
    />

    <SettingsDialog
      v-if="showSettings && appState === 'unlocked' && !isWebRuntime()"
      :initial-tab="settingsInitialTab"
      workspace-layout
      @close="showSettings = false"
      @open-change-password="showChangePassword = true"
      @open-change-note-key="noteKeyMode = $event"
      @entries-refreshed="bootModules"
    />

    <WebSettingsDialog
      v-if="showSettings && appState === 'unlocked' && isWebRuntime()"
      :initial-tab="settingsInitialTab"
      @close="showSettings = false" @lock="doLock"
      @open-change-note-key="noteKeyMode = $event"
    />

    <ChangePasswordDialog
      v-if="showChangePassword && appState === 'unlocked'"
      @close="showChangePassword = false"
    />

    <NoteLockDialog
      v-if="noteKeyMode && appState === 'unlocked'"
      :mode="noteKeyMode"
      @close="noteKeyMode = null"
      @done="onNoteKeyDone"
    />

    <ToastNotification :toast="toast" />
    <ConfirmDialog v-if="appState === 'unlocked'" :dialog="confirmDialog" @confirm="handleConfirm" @cancel="clearConfirm" />
    <QuitDialog v-if="!isWebRuntime()" />
  </div>
</template>

<style scoped>
.app-root.web-runtime { height: 100dvh; }
.web-runtime :deep(.dialog) { max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); }
@media (max-width: 760px) {
  .web-runtime :deep(.web-settings) { max-width: 100vw; max-height: 100dvh; }
}
</style>
