<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { suppressHover } from '../../utils/hoverGuard'
import BackupBadge from './BackupBadge.vue'

defineProps<{
  isLocked?: boolean
}>()

const emit = defineEmits<{
  openSettings: []
  lock: []
}>()

const appWindow = getCurrentWindow()
const isMaximized = ref(false)
const route = useRoute()
const crumb = computed(() => (route.meta.title as string) ?? 'Desko')

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

// 品牌区没有交互控件，自己接管拖拽，与空白拖拽区行为一致
const startDrag = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button')) return
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

    <div v-if="!isLocked" class="titlebar-left" @mousedown="startDrag" @dblclick="toggleMaximize">
      <div class="titlebar-brand">
        <span class="titlebar-crumb">{{ crumb }}</span>
        <BackupBadge />
      </div>
    </div>

    <div class="titlebar-buttons">
      <template v-if="!isLocked">
        <button  class="titlebar-btn tb-util" @click="emit('openSettings')" title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button  class="titlebar-btn tb-util" @click="emit('lock')" title="锁定">
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
  height: 42px;
  background: var(--chrome-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}

/* 锁定态：顶栏脱离文档流，浮在锁页画布上（z-30 控制层），
   整窗底色由 UnlockPage 的光晕层铺满，保证沉浸感；高度按方案 B 收到 36px */
.titlebar.titlebar-locked {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
  height: 36px;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: none;
}

/* 锁定页顶栏悬浮在光晕上，控制键按锁页规格放宽到 44px 命中区 */
.titlebar-locked .titlebar-btn { width: 44px; }

.titlebar-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 230px;
  bottom: 0;
}

.titlebar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: var(--space-5);
  z-index: 1;
}

/* 模块名锚点：13.5px 半粗，与侧栏应用名同档 */
.titlebar-brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 100%;
}

.titlebar-crumb {
  display: inline-flex;
  align-items: center;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-title);
  user-select: none;
  -webkit-user-select: none;
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

/* 设置/锁定 32×28：圆角方块档，别吃满 36px 栏高 */
.titlebar-btn.tb-util {
  width: 32px;
  height: 28px;
  align-self: center;
  border-radius: var(--radius-sm);
}

.titlebar-btn:hover {
  background: var(--hover);
  color: var(--text);
}

.titlebar-btn-close:hover {
  background: var(--danger);
  color: var(--danger-on);
}

.titlebar-divider {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 var(--space-1);
  align-self: center;
}
</style>
