<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { releaseHover, suppressHover } from '../../utils/hoverGuard'
import AppIcon from '../shared/AppIcon.vue'
import BackupBadge from './BackupBadge.vue'

defineProps<{
  isLocked?: boolean
  /** 侧栏收到 0 宽时，恢复入口挪到这里 */
  sidebarHidden?: boolean
}>()

const emit = defineEmits<{
  openSettings: []
  lock: []
  showSidebar: []
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
  unlistenFocus = await appWindow.onFocusChanged(({ payload: hasFocus }) => {
    // 失焦才冻结；重新获得焦点必须当场解除。遮罩是整窗 fixed，留着它，
    // 用户回来后的第一下点击会打在遮罩上被吞掉（标题栏那颗同步钮实测点了没反应）。
    // 而恢复时 WebView2 在旧坐标重放的那次 pointermove 按坐标差规则解不开，等不来自动解除。
    if (hasFocus) releaseHover()
    else suppressHover()
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
      <button
        v-if="sidebarHidden"
        class="titlebar-btn tb-util sidebar-restore"
        title="显示侧栏 (Ctrl+B)"
        @click="emit('showSidebar')"
      >
        <AppIcon name="panel" :size="16" />
      </button>
      <div class="titlebar-brand">
        <span class="titlebar-crumb">{{ crumb }}</span>
      </div>
    </div>

    <div class="titlebar-buttons">
      <template v-if="!isLocked">
        <BackupBadge />
        <button  class="titlebar-btn tb-util" @click="emit('openSettings')" title="设置">
          <AppIcon name="gear" :size="16" />
        </button>
        <button  class="titlebar-btn tb-util" @click="emit('lock')" title="锁定">
          <AppIcon name="lock" :size="16" />
        </button>
        <div class="titlebar-divider"></div>
      </template>
      <button  class="titlebar-btn" @click="minimize" title="最小化">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor"/>
        </svg>
      </button>
      <button  class="titlebar-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
        <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12">
          <path d="M5.5 2.2H8.8a1.2 1.2 0 0 1 1.2 1.2v3.3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          <rect x="2" y="4.2" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
      <button  class="titlebar-btn titlebar-btn-close" @click="close" title="关闭">
        <!-- 三钮同一档：同 2–10 光学盒、同 1px 实笔（原先关闭是 1.2px 的 10×10，比另两颗又粗又大） -->
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 2 10 10M10 2 2 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.titlebar {
  height: 42px;
  /* 拆面轮：顶栏不再另起一层板——透明并入整窗微光画布，无底色无分割线 */
  background: transparent;
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

/* 整条都是拖拽区，右端那一排靠 z-index 压在它上面：
   这样同步钮在不在（要配齐备份密码 + 云端才现身）都不用回来改这里的魔法数 */
.titlebar-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.titlebar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: var(--space-5);
  z-index: 1;
}

/* 侧栏收进 0 宽后唯一的恢复入口：与右端设置/锁定同档（32×28 圆角方块） */
.sidebar-restore { margin-right: var(--space-1); }

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
  font-size: var(--text-sm);
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
  border-radius: var(--radius-ib);
}

/* 顶栏底色本身就比 --hover 更暗（浅色主题 chrome≈#f7f6f4、--hover=#faf9f7），
   用 --hover 等于没有反馈；按文字色反推半透填充，深浅两套自适应 */
.titlebar-btn:hover {
  background: color-mix(in srgb, var(--text) 9%, transparent);
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
