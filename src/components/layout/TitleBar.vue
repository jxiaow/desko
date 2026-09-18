<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { suppressHover } from '../../utils/hoverGuard'

defineProps<{
  isLocked?: boolean
}>()

const emit = defineEmits<{
  toggleSidebar: []
  openSettings: []
  lock: []
}>()

const appWindow = getCurrentWindow()
const isMaximized = ref(false)

const updateMaximizedState = async () => {
  isMaximized.value = await appWindow.isMaximized()
}

// 先盖遮罩并等两帧，让 WebView 基于遮罩重算 hover，再真正隐藏窗口，
// 避免残留的 :hover 态被带进下次显示
const withHoverGuard = (action: () => void) => {
  suppressHover()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      suppressHover()
      action()
    })
  })
}

const minimize = () => {
  withHoverGuard(() => appWindow.minimize())
}

const toggleMaximize = async () => {
  await appWindow.toggleMaximize()
  await updateMaximizedState()
}

const close = () => {
  withHoverGuard(() => appWindow.close())
}

const startDrag = () => {
  appWindow.startDragging()
}

let unlisten: (() => void) | null = null
let unlistenFocus: (() => void) | null = null

onMounted(async () => {
  await updateMaximizedState()
  unlisten = await appWindow.onResized(async () => {
    await updateMaximizedState()
  })
  unlistenFocus = await appWindow.onFocusChanged(() => {
    // 失焦时冻结；重新获得焦点（托盘恢复）时再冻结一次，防止隐藏前被假移动解除
    suppressHover()
  })
})

onUnmounted(() => {
  if (unlisten) unlisten()
  if (unlistenFocus) unlistenFocus()
})
</script>

<template>
  <div class="titlebar" :class="{ 'titlebar-locked': isLocked }">
    <div class="titlebar-drag" @mousedown="startDrag" @dblclick="toggleMaximize"></div>

    <div v-if="!isLocked" class="titlebar-left">
      <button  class="titlebar-btn" @click="emit('toggleSidebar')" title="切换侧边栏">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>
    </div>

    <div class="titlebar-buttons">
      <template v-if="!isLocked">
        <button  class="titlebar-btn" @click="emit('openSettings')" title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button  class="titlebar-btn" @click="emit('lock')" title="锁定">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </button>
        <div class="titlebar-divider"></div>
      </template>
      <button  class="titlebar-btn" @click="minimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="1" y="5.5" width="10" height="1" fill="currentColor"/>
        </svg>
      </button>
      <button  class="titlebar-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <rect x="3" y="0.5" width="8.5" height="8.5" fill="none" stroke="currentColor" stroke-width="1"/>
          <rect x="0.5" y="3" width="8.5" height="8.5" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
      <button  class="titlebar-btn titlebar-btn-close" @click="close" title="关闭">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 1 L11 11 M1 11 L11 1" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 40px;
  background: var(--chrome-bg);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}

.titlebar.titlebar-locked {
  background: transparent;
  border-bottom: none;
}

.titlebar-drag {
  position: absolute;
  top: 0;
  left: 40px;
  right: 230px;
  bottom: 0;
}

.titlebar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: 0;
  z-index: 1;
}

.titlebar-buttons {
  display: flex;
  height: 100%;
  margin-left: auto;
  z-index: 1;
}

.titlebar-btn {
  width: 40px;
  align-self: stretch;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition);
  flex-shrink: 0;
}

.titlebar-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.titlebar-btn-close:hover {
  background: var(--danger);
  color: #fff;
}

.titlebar-divider {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 var(--space-1);
  align-self: center;
}
</style>
