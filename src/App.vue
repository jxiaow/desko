<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
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
import { useEscapeClose } from './composables/useEscapeClose'
import { installHoverGuard } from './utils/hoverGuard'
import { isPageShortcutBlocked } from './utils/pageShortcuts'
import { bootEnabledModules, flushModulesBeforeLock, lockEnabledModules } from './modules/state'
import { stopModuleSync } from './modules/runtime'
import type { SettingsTabId } from './modules/registry'
import TitleBar from './components/layout/TitleBar.vue'
import Sidebar from './components/layout/Sidebar.vue'
import CodexWorkspace from './components/layout/CodexWorkspace.vue'
import ModuleRouterView from './components/layout/ModuleRouterView.vue'
import { hasWorkspaceDirectory, workspaceDirectoryMediaQuery } from './components/layout/workspaceLayout'
import { useWorkspaceDirectoryPreferences } from './components/layout/useWorkspaceDirectoryPreferences'
import WebModuleDrawer from './components/layout/WebModuleDrawer.vue'
import SetupPage from './components/auth/SetupPage.vue'
import UnlockPage from './components/auth/UnlockPage.vue'
import { authApi } from './services/api/auth'
import { isWebRuntime } from './services/runtime'
import WebSettingsDialog from './components/settings/WebSettingsDialog.vue'
import SettingsDialog from './components/settings/SettingsDialog.vue'
import ChangePasswordDialog from './components/settings/ChangePasswordDialog.vue'
import NoteLockDialog from './components/notes/NoteLockDialog.vue'
import ToastNotification from './components/shared/ToastNotification.vue'
import ConfirmDialog from './components/shared/ConfirmDialog.vue'
import QuitDialog from './components/shared/QuitDialog.vue'

const props = defineProps<{ workspaceLayout?: boolean }>()
const route = props.workspaceLayout ? useRoute() : null
const directoryMedia = props.workspaceLayout ? window.matchMedia(workspaceDirectoryMediaQuery) : null
const directoryWide = ref(directoryMedia?.matches ?? false)
const directoryPreferences = useWorkspaceDirectoryPreferences()
const directoryAvailable = computed(() => hasWorkspaceDirectory(String(route?.name)))
const directoryVisible = computed(() => directoryAvailable.value &&
  (directoryPreferences.open.value[String(route?.name)] ?? false))
const directoryCompact = computed(() => !directoryWide.value)
const directoryPinned = computed(() => directoryPreferences.pinned.value[String(route?.name)] ?? false)
const toggleDirectoryPin = () => {
  if (!directoryAvailable.value) return
  void directoryPreferences.setPinned(String(route?.name), !directoryPinned.value).catch(() => {
    toastStore.showToast('固定状态未能保存，下次启动将使用原设置', 'error')
  })
}
const setDirectoryVisible = (visible: boolean) => {
  if (directoryAvailable.value) {
    void directoryPreferences.setVisible(String(route?.name), visible).catch(() => {
      toastStore.showToast('目录状态未能保存，下次启动将使用原设置', 'error')
    })
  }
}
const toggleDirectory = () => setDirectoryVisible(!directoryVisible.value)
const closeDirectory = () => {
  setDirectoryVisible(false)
  document.getElementById('workspace-directory-toggle')?.focus()
}
const onDirectoryMediaChange = (event: MediaQueryListEvent) => { directoryWide.value = event.matches }
function onDirectoryOutsideClick(event: MouseEvent) {
  if (!directoryVisible.value || directoryPinned.value || !(event.target instanceof Element)) return
  if (event.target.closest('#workspace-directory, #workspace-directory-toggle, [role="dialog"], .dialog-overlay')) return
  // click 后收起，保留本次点击的编辑、搜索或导航动作及其焦点。
  setDirectoryVisible(false)
}
const authStore = useAuthStore()
const { appState } = storeToRefs(authStore)
const { checkInitialized, lock } = authStore
useEscapeClose(closeDirectory, () => props.workspaceLayout === true && appState.value === 'unlocked' && directoryVisible.value && !directoryPinned.value)
const toastStore = useToastStore()
const { toast } = storeToRefs(toastStore)
const confirmStore = useConfirmStore()
const { confirmDialog } = storeToRefs(confirmStore)
const { handleConfirm, clearConfirm } = confirmStore
const passwordStore = usePasswordStore()
const { evictExpiredPasswords, clearSensitiveState } = passwordStore
const { clearClipboardTimer } = useClipboard()

/** 侧栏三态（V5.2 收编轮 P2）：展开 208 / 图标轨 56 / 收起 0。
    缺省仍是图标轨——和旧的两态时代一致，小窗开局不把内容挤窄。 */
const sidebarMode = ref<'expanded' | 'rail' | 'hidden'>('rail')
/* toast 居中的参考系：侧栏以右的内容区域。 */
const toastSide = computed(() => {
  if (props.workspaceLayout) {
    return 'var(--sidebar-rail-w)'
  }
  if (sidebarMode.value === 'hidden') return '0px'
  return sidebarMode.value === 'rail' ? 'var(--sidebar-rail-w)' : 'var(--sidebar-w)'
})
const toastRight = computed(() => {
  if (!props.workspaceLayout) return '0px'
  return directoryVisible.value
    ? 'calc(var(--workspace-frame-right) + var(--workspace-directory-width))'
    : 'var(--workspace-frame-right)'
})
const showSettings = ref(false)
const showWebModules = ref(false)
const settingsInitialTab = ref<SettingsTabId>('appearance')
const showChangePassword = ref(false)
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

const bootModules = () => bootEnabledModules()
const onWebSessionExpired = () => {
  if (isWebRuntime()) void doLock({ forced: true, resetDrafts: true })
}
let unlistenKdfWarning: (() => void) | null = null

onMounted(async () => {
  directoryMedia?.addEventListener('change', onDirectoryMediaChange)
  if (props.workspaceLayout) {
    await directoryPreferences.restore()
    document.addEventListener('click', onDirectoryOutsideClick)
  }
  if (!isWebRuntime()) {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenKdfWarning = await listen('auth-kdf-upgrade-warning', () => {
      toastStore.showToast('口令保护升级未完成，已按原格式解锁', 'error')
    })
  }
  await checkInitialized()
  if (appState.value === 'unlocked') {
    await bootEnabledModules()
  }

  // WebView 收不到窗口隐藏/最小化时的 mouseleave，:hover 与 tooltip 会残留到下次打开
  installHoverGuard()
  window.addEventListener('desko:open-settings-tab', onOpenSettingsTab)
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('desko:web-session-expired', onWebSessionExpired)
})

onUnmounted(() => {
  directoryMedia?.removeEventListener('change', onDirectoryMediaChange)
  document.removeEventListener('click', onDirectoryOutsideClick)
  unlistenKdfWarning?.()
  window.removeEventListener('desko:open-settings-tab', onOpenSettingsTab)
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('desko:web-session-expired', onWebSessionExpired)
})

/* Ctrl/Cmd+B 按 rail → expanded → hidden 的顺序循环：缺省是图标轨，
   所以第一下必须先展开（旧两态时代就是这个手感），第三下才收干净 */
const SIDEBAR_MODES = ['rail', 'expanded', 'hidden'] as const
function onGlobalKey(e: KeyboardEvent) {
  if (isPageShortcutBlocked(e)) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
    if (props.workspaceLayout) {
      if (directoryAvailable.value) {
        e.preventDefault()
        toggleDirectory()
      }
      return
    }
    e.preventDefault()
    const i = SIDEBAR_MODES.indexOf(sidebarMode.value)
    sidebarMode.value = SIDEBAR_MODES[(i + 1) % SIDEBAR_MODES.length]
  }
}
</script>

<template>
  <div class="app-root" :class="{ 'locked-bg': appState === 'locked', 'web-runtime': isWebRuntime(), 'codex-layout': workspaceLayout }" :style="{ '--toast-side': toastSide, '--toast-right': toastRight }">
    <!-- 锁定/初始化态：顶栏浮在页面上；解锁态：顶栏进右列，侧栏全高贯通 -->
    <TitleBar
      v-if="appState !== 'unlocked'"
      is-locked
      @open-settings="openSettingsAppearance"
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="bootModules" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="bootModules" />

    <template v-else-if="workspaceLayout">
      <TitleBar outer @open-settings="openSettingsAppearance" @lock="doLock" />
      <div class="app-layout">
        <Sidebar collapsed :show-toggle="false" />
        <CodexWorkspace :directory-visible="directoryVisible" :directory-compact="directoryCompact" :directory-pinned="directoryPinned" @close-directory="closeDirectory" @toggle-directory="toggleDirectory" @toggle-directory-pin="toggleDirectoryPin"><ModuleRouterView /></CodexWorkspace>
      </div>
    </template>

    <div v-else class="app-layout">
      <Sidebar
        v-if="sidebarMode !== 'hidden'"
        :collapsed="sidebarMode === 'rail'"
        @update:collapsed="sidebarMode = $event ? 'rail' : 'expanded'"
      />

      <div class="main-area">
        <TitleBar
          :sidebar-hidden="sidebarMode === 'hidden'"
          @open-settings="openSettingsAppearance"
          @lock="doLock"
          @show-sidebar="sidebarMode = 'expanded'"
          @show-modules="showWebModules = true"
        />

        <div class="main-content">
          <ModuleRouterView />
        </div>
      </div>
    </div>

    <WebModuleDrawer
      v-if="showWebModules && appState === 'unlocked' && isWebRuntime()"
      @close="showWebModules = false"
    />

    <SettingsDialog
      v-if="showSettings && appState === 'unlocked' && !isWebRuntime()"
      :initial-tab="settingsInitialTab"
      :workspace-layout="workspaceLayout"
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
</style>
