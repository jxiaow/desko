<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from './stores/auth'
import { useToastStore } from './stores/toast'
import { useConfirmStore } from './stores/confirm'
import { usePasswordStore } from './stores/password'
import { useAutoLock } from './composables/useAutoLock'
import { useClipboard } from './composables/useClipboard'
import { installHoverGuard } from './utils/hoverGuard'
import { bootEnabledModules, lockEnabledModules } from './modules/state'
import type { SettingsTabId } from './modules/registry'
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
const confirmStore = useConfirmStore()
const { confirmDialog } = storeToRefs(confirmStore)
const { handleConfirm } = confirmStore
const passwordStore = usePasswordStore()
const { evictExpiredPasswords, clearSensitiveState } = passwordStore
const { clearClipboardTimer } = useClipboard()

/** 侧栏三态（V5.2 收编轮 P2）：展开 208 / 图标轨 56 / 收起 0。
    缺省仍是图标轨——和旧的两态时代一致，小窗开局不把内容挤窄。 */
const sidebarMode = ref<'expanded' | 'rail' | 'hidden'>('rail')
const showSettings = ref(false)
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

const doLock = async () => {
  await lock()
  clearSensitiveState()
  // 加密小记的会话明文、收藏的筛选态——各模块自己那份跟着锁回去
  lockEnabledModules()
  // 这里已直接把剪贴板清空，撤销待执行的密码延迟清除，否则解锁后复制的
  // 新内容会在原定时点被误删。
  clearClipboardTimer()
  try { await navigator.clipboard.writeText('') } catch {}
}

useAutoLock(doLock, evictExpiredPasswords)

const bootModules = () => bootEnabledModules()

onMounted(async () => {
  await checkInitialized()
  if (appState.value === 'unlocked') {
    await bootEnabledModules()
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
      @open-settings="openSettingsAppearance"
      @lock="doLock"
    />

    <SetupPage v-if="appState === 'setup'" @setup-complete="bootModules" />
    <UnlockPage v-else-if="appState === 'locked'" @unlock-complete="bootModules" />

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
      @open-change-note-key="noteKeyMode = $event"
      @entries-refreshed="bootModules"
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
