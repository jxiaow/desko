<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isWebRuntime } from '../../services/runtime'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { releaseHover, suppressHover } from '../../utils/hoverGuard'
import { sidebarCollapsed, setSidebarCollapsed } from '../../services/sidebar'
import AppIcon from '../shared/AppIcon.vue'
import BrandLogo from '../shared/BrandLogo.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import BackupBadge from './BackupBadge.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { webAccessApi, type WebAccessStatus } from '../../services/api/webAccess'

const props = defineProps<{
  isLocked?: boolean
  modulesOpen?: boolean
  sidebarHidden?: boolean
}>()

const emit = defineEmits<{
  lock: []
  showModules: []
}>()

const webRuntime = isWebRuntime()
const route = useRoute()
const pageHead = usePageHeadStore()
/** 页名与条数归标题栏：正文左缘不再铺身份行，页级动作仍留在内容区页头。
    Codex 的会话/用量把视图页签当身份行用，页名照样在这一行报出来，不再另起一处。 */
const crumbLabel = computed(() => {
  if (props.isLocked || route.name === 'start') return ''
  return pageHead.label || (route.meta.title as string) || ''
})
const appWindow = webRuntime ? null : getCurrentWindow()
const isMaximized = ref(false)
const appMenuOpen = ref(false)
const appMenuAnchor = ref<HTMLButtonElement | null>(null)
const titlebarElement = ref<HTMLElement | null>(null)
const windowControls = ref<HTMLElement | null>(null)
let controlsObserver: ResizeObserver | undefined
function openAppPane(tab: 'profiles' | 'about' | 'appearance' | 'modules') {
  appMenuOpen.value = false
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: tab }))
}
const webStatus = ref<WebAccessStatus | null>(null)
const webStatusTitle = computed(() => `Web 运行中 · ${webStatus.value?.lan ? '本机与局域网' : '仅本机'} · ${webStatus.value?.port}`)
let statusGeneration = 0
let active = true
let statusPoll: ReturnType<typeof setInterval> | undefined
async function refreshWebStatus() {
  const generation = ++statusGeneration
  try {
    const status = await webAccessApi.status()
    if (active && generation === statusGeneration) webStatus.value = status
  } catch { /* 下一次轮询补读。 */ }
}
function onWebStatus(event: Event) {
  statusGeneration++
  webStatus.value = (event as CustomEvent<WebAccessStatus>).detail
}
function openWebSettings() {
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: 'web' }))
}

const toggleSidebar = () => {
  void setSidebarCollapsed(!sidebarCollapsed.value)
}

const updateMaximizedState = async () => {
  if (appWindow) isMaximized.value = await appWindow.isMaximized()
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
  if (appWindow) withHoverGuard(() => { void appWindow.minimize() })
}

const toggleMaximize = async () => {
  if (!appWindow) return
  await appWindow.toggleMaximize()
  await updateMaximizedState()
}

const close = () => {
  if (appWindow) withHoverGuard(() => { void appWindow.close() })
}

// 品牌区没有交互控件，自己接管拖拽，与空白拖拽区行为一致
const startDrag = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button')) return
  void appWindow?.startDragging()
}

let unlisten: (() => void) | null = null
let unlistenFocus: (() => void) | null = null

onMounted(async () => {
  if (!props.isLocked && windowControls.value) {
    const updateControlsSpace = () => {
      const width = windowControls.value?.getBoundingClientRect().width ?? 0
      titlebarElement.value?.style.setProperty('--workspace-window-space', `${Math.ceil(width) + 12}px`)
    }
    updateControlsSpace()
    controlsObserver = new ResizeObserver(updateControlsSpace)
    controlsObserver.observe(windowControls.value)
  }
  if (!appWindow) return
  window.addEventListener('desko:web-access-status', onWebStatus)
  void refreshWebStatus()
  statusPoll = setInterval(() => void refreshWebStatus(), 3000)
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
  controlsObserver?.disconnect()
  active = false
  clearInterval(statusPoll)
  window.removeEventListener('desko:web-access-status', onWebStatus)
  if (unlisten) unlisten()
  if (unlistenFocus) unlistenFocus()
})
</script>

<template>
  <div ref="titlebarElement" class="titlebar" :class="{ 'titlebar-locked': isLocked, 'titlebar-outer': !isLocked }">
    <div class="titlebar-drag" @mousedown="startDrag" @dblclick="toggleMaximize"></div>

    <div v-if="webRuntime && !isLocked" class="web-mobile-header">
      <span class="web-mobile-brand"><BrandLogo />Desko</span>
      <button class="web-mobile-modules" type="button" aria-label="打开模块导航" aria-haspopup="dialog" aria-controls="web-module-navigation" :aria-expanded="props.modulesOpen ?? false" @click="emit('showModules')">
        <AppIcon name="panel" :size="16" /><span>模块</span><AppIcon name="chevDown" :size="14" />
      </button>
    </div>

    <div v-if="!isLocked" class="titlebar-brandcell">
      <button ref="appMenuAnchor" class="titlebar-app" type="button" aria-label="Desko 菜单" title="Desko" aria-haspopup="menu" :aria-expanded="appMenuOpen" @click="appMenuOpen = !appMenuOpen" @dblclick.stop><BrandLogo /><span class="titlebar-wordmark">Desko</span></button>
      <PopoverMenu v-if="appMenuOpen" :anchor="appMenuAnchor" align="start" :width="176" @close="appMenuOpen = false">
        <div class="app-menu-title">Desko</div>
        <template v-if="webRuntime">
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('appearance')"><AppIcon name="gear" :size="15" />外观设置</button>
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('modules')"><AppIcon name="panel" :size="15" />模块管理</button>
        </template>
        <template v-else>
          <button v-if="sidebarHidden" class="pop-item" type="button" role="menuitem" @click="openAppPane('appearance')"><AppIcon name="gear" :size="15" />设置</button>
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('profiles')"><AppIcon name="user" :size="15" />档案管理</button>
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('about')"><AppIcon name="info" :size="15" />关于 Desko</button>
        </template>
      </PopoverMenu>
    </div>

    <div class="titlebar-page">
      <span v-if="crumbLabel" class="titlebar-crumb" :title="[crumbLabel, pageHead.count].filter(Boolean).join(' · ')">{{ crumbLabel }}</span>
      <span v-if="crumbLabel && pageHead.count" class="titlebar-count">{{ pageHead.count }}</span>
      <div v-if="!isLocked" id="workspace-fs-slot" class="titlebar-fs-slot"></div>
      <button
        v-if="!isLocked && !webRuntime && !sidebarHidden"
        class="sidebar-toggle"
        type="button"
        :aria-label="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :title="sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :aria-expanded="!sidebarCollapsed"
        aria-controls="app-sidebar"
        @click="toggleSidebar"
      >
        <AppIcon name="panel" :size="16" />
      </button>
      <button
        v-if="!isLocked && webRuntime"
        class="titlebar-btn tb-util web-modules-toggle"
        title="打开模块导航"
        aria-label="打开模块导航"
        aria-haspopup="dialog"
        :aria-expanded="props.modulesOpen ?? false"
        aria-controls="web-module-navigation"
        @click="emit('showModules')"
      >
        <AppIcon name="panel" :size="18" />
      </button>
    </div>

    <div ref="windowControls" class="titlebar-buttons">
      <div id="workspace-fixed-tools" class="titlebar-fixed-tools"></div>
      <button v-if="!webRuntime && webStatus?.running" class="web-running" :title="webStatusTitle" :aria-label="webStatusTitle" :disabled="isLocked" @click="openWebSettings">
        <span class="web-running-dot" aria-hidden="true"></span>Web
      </button>
      <BackupBadge v-if="!isLocked && !webRuntime" v-show="!sidebarHidden" />
      <!-- 锁定与窗口操作同组，设置入口位于轨底。 -->
      <button v-if="!isLocked" class="titlebar-btn titlebar-lock" type="button" @click="emit('lock')" :title="webRuntime ? '退出浏览器访问' : '锁定'" :aria-label="webRuntime ? '退出浏览器访问' : '锁定'">
        <AppIcon name="lock" :size="14" />
      </button>
      <button v-if="!webRuntime" class="titlebar-btn" @click="minimize" title="最小化">
        <svg width="14" height="14" viewBox="0 0 12 12">
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor"/>
        </svg>
      </button>
      <button v-if="!webRuntime" class="titlebar-btn" @click="toggleMaximize" :title="isMaximized ? '还原' : '最大化'">
        <svg v-if="!isMaximized" width="14" height="14" viewBox="0 0 12 12">
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 12 12">
          <path d="M5.5 2.2H8.8a1.2 1.2 0 0 1 1.2 1.2v3.3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
          <rect x="2" y="4.2" width="6" height="6" rx="1.2" fill="none" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
      <button v-if="!webRuntime" class="titlebar-btn titlebar-btn-close" @click="close" title="关闭">
        <!-- 窗口图标共用 14px 画布与同一档笔画。 -->
        <svg width="14" height="14" viewBox="0 0 12 12">
          <path d="M2 2 10 10M10 2 2 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.web-mobile-header { display: none; }
.titlebar-wordmark { display: none; }
.titlebar.titlebar-outer { height: var(--window-bar-height, 34px); flex: 0 0 var(--window-bar-height, 34px); overflow: hidden; }
.titlebar-brandcell { width: var(--sidebar-rail-w, 56px); flex: 0 0 var(--sidebar-rail-w, 56px); align-self: stretch; display: flex; align-items: center; justify-content: center; z-index: 2; }
.titlebar-brandcell { background: transparent; }
.app-root:not(.web-runtime):not(.sidebar-hidden) .titlebar-brandcell {
  /* 品牌格与侧栏连成一列：同一块导轨底色，窗口控件那侧继续坐内容色。
     分界只由底色这一档承担，导轨右缘不再画竖线（和下面的侧栏同一配方）。 */
  background: var(--bg-rail, var(--bg-sheet));
  justify-content: flex-start;
  padding-left: 15px;
}
.titlebar-page { display: contents; }
.titlebar-fs-slot { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; }
/* 标题栏这一行：左端整段留给拖窗，页名与条数压在正文那条阅读列的左缘上，
   页级动作仍住内容区页头，不搬上来。 */
.titlebar-crumb { min-width: 0; font-size: var(--text-sm); font-weight: 600; line-height: 20px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titlebar-count { flex: 0 0 auto; margin-left: 8px; font-size: var(--text-xs); line-height: 20px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.titlebar-outer .sidebar-toggle {
  position: absolute;
  left: calc(-1 * var(--workspace-content-padding) - var(--sheet-inset-left) + 4px);
  top: 50%;
  z-index: 2;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
  pointer-events: auto;
  transition: color var(--transition-fast);
}
.titlebar-outer .sidebar-toggle::before {
  content: '';
  position: absolute;
  inset: 1px;
  z-index: 0;
  border-radius: 6px;
  background: transparent;
  transition: background-color var(--transition-fast);
}
.titlebar-outer .sidebar-toggle :deep(svg) { position: relative; z-index: 1; }
.titlebar-outer .sidebar-toggle:hover { color: var(--text); }
.titlebar-outer .sidebar-toggle:hover::before { background: var(--hover-chrome); }
.titlebar-outer .sidebar-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.titlebar-outer .titlebar-page { position: absolute; left: var(--workspace-toolbar-left); right: max(var(--workspace-toolbar-right), var(--workspace-window-space, 122px)); height: 100%; display: flex; align-items: center; z-index: 1; pointer-events: none; }
/* 品牌标占的是轨的第一格：盒子与下面的模块方块同档，里面那颗 22px 实标不变。 */
.titlebar-app { width: 30px; height: 30px; padding: 5px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.titlebar-app :deep(svg) { display: block; width: 100%; height: 100%; }
.titlebar-app:hover, .titlebar-app[aria-expanded="true"] { background: var(--hover-chrome); }
.app-menu-title { padding: 8px 12px 6px; color: var(--text-muted); font-size: var(--text-xs); font-weight: 600; }
/* 窗口按钮使用 34×30 圆角片，hover 时显示填充。 */
/* 带子右端分两群：左边是模块动作，右边是应用/窗口控制。中间一根细线隔开，
   留白左右大致等宽（线左 = 带子 padding + gap，线右 = margin + gap）。 */
.titlebar-outer .titlebar-buttons::before {
  content: '';
  flex: 0 0 1px;
  width: 1px;
  height: 20px;
  align-self: center;
  margin-right: 8px;
  background: var(--border);
}
.web-running { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 8px; margin-right: 4px; border: 1px solid var(--border); border-radius: var(--radius-pill); color: var(--success); background: var(--success-soft); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.web-running:disabled { cursor: default; }
.web-running-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.titlebar {
  /* 顶栏与正文同底：一条 34px 的实底带子，窗口控件坐在内容色上，
     左侧品牌格留给导轨色。锁定态浮在锁页光晕上，单独透明。 */
  background: var(--bg-sheet);
  display: flex;
  align-items: center;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}
.app-root.locked-bg .titlebar { background: transparent; }

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

/* 锁屏页使用紧凑窗控，悬停背景与按钮一起收小。 */
.titlebar-locked .titlebar-btn { width: 30px; height: 26px; border-radius: 6px; }
.titlebar-locked .titlebar-btn > svg { width: 12px; height: 12px; }

/* 整条都是拖拽区，右端那一排靠 z-index 压在它上面：
   这样同步钮在不在（要配齐备份密码 + 云端才现身）都不用回来改这里的魔法数 */
.titlebar-drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.titlebar-buttons {
  display: flex;
  height: 100%;
  margin-left: auto;
  align-items: center;
  gap: 2px;
  padding-right: 6px;
  flex-shrink: 0;
  z-index: 1;
}

/* 目录开关固定在窗口工具位；空槽不占宽，窗口按钮的占位宽度会把它算进去。 */
.titlebar-fixed-tools { order: -1; display: flex; align-items: center; gap: 2px; }
.titlebar-fixed-tools:empty { display: none; }

/* 顶栏按钮统一为 34×30，48px 标题栏内上下各留 9px。 */
.titlebar-btn {
  width: 34px;
  height: 30px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-ib);
  transition: all var(--transition);
  flex-shrink: 0;
}

.titlebar-btn:hover {
  background: var(--hover-chrome);
  color: var(--text);
}

.titlebar-btn-close:hover {
  background: var(--danger);
  color: var(--danger-on);
}

.web-modules-toggle { display: none; }

@media (max-width: 899px) {
  /* 最小桌面窗由布局自动使用图标轨，不再显示无视觉反馈的折叠开关。 */
  .titlebar-outer .sidebar-toggle { display: none; }
  .app-root:not(.web-runtime) .titlebar-brandcell { justify-content: center; padding-left: 0; }
  .app-root:not(.web-runtime) .titlebar-app {
    width: 30px;
    height: 30px;
    justify-content: center;
    padding: 5px;
    gap: 0;
  }
  .app-root:not(.web-runtime) .titlebar-app :deep(svg) { width: 100%; height: 100%; }
  .app-root:not(.web-runtime) .titlebar-wordmark { display: none; }
}

/* 展开态把品牌锁标放回侧栏中轴：Logo 与导航图标同列，字标与模块名同列。 */
.app-root:not(.web-runtime) .titlebar-app {
  display: flex;
  align-items: center;
  gap: 8px;
  width: auto;
  height: 26px;
  padding: 2px 6px;
  border-radius: 7px;
}
.app-root:not(.web-runtime) .titlebar-app :deep(svg) {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.app-root:not(.web-runtime) .titlebar-wordmark {
  display: block;
  color: var(--text);
  font-size: var(--text-sm);
  font-weight: 650;
  line-height: 20px;
  letter-spacing: -.01em;
}
.app-root:not(.web-runtime).sidebar-collapsed .titlebar-brandcell {
  justify-content: center;
  padding-left: 0;
}
.app-root:not(.web-runtime).sidebar-collapsed .titlebar-app {
  width: 30px;
  height: 30px;
  justify-content: center;
  padding: 5px;
  gap: 0;
}
.app-root:not(.web-runtime).sidebar-collapsed .titlebar-app :deep(svg) {
  width: 100%;
  height: 100%;
}
.app-root:not(.web-runtime).sidebar-collapsed .titlebar-wordmark { display: none; }
.app-root.sidebar-hidden .titlebar-brandcell { width: auto; flex: 0 0 auto; padding: 0 12px; }
.app-root.sidebar-hidden .titlebar-outer .titlebar-page { position: relative; left: auto; right: auto; flex: 1; min-width: 0; margin-left: 12px; }
</style>
