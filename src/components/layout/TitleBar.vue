<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { isWebRuntime, isCodexWebRuntime } from '../../services/runtime'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { releaseHover, suppressHover } from '../../utils/hoverGuard'
import AppIcon from '../shared/AppIcon.vue'
import BrandLogo from '../shared/BrandLogo.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import BackupBadge from './BackupBadge.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { webAccessApi, type WebAccessStatus } from '../../services/api/webAccess'

const props = defineProps<{
  isLocked?: boolean
  modulesOpen?: boolean
}>()

const emit = defineEmits<{
  lock: []
  showModules: []
}>()

const webRuntime = isWebRuntime()
const codexWebRuntime = isCodexWebRuntime()
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
const route = useRoute()
const pageHead = usePageHeadStore()
const crumb = computed(() => pageHead.label || (route.meta.title as string) || 'Desko')

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

    <div v-if="webRuntime && !codexWebRuntime && !isLocked" class="web-mobile-header">
      <span class="web-mobile-brand"><BrandLogo />Desko</span>
      <button class="web-mobile-modules" type="button" aria-label="打开模块导航" aria-haspopup="dialog" aria-controls="web-module-navigation" :aria-expanded="props.modulesOpen ?? false" @click="emit('showModules')">
        <AppIcon name="panel" :size="16" /><span>模块</span><AppIcon name="chevDown" :size="14" />
      </button>
    </div>

    <div v-if="!isLocked" class="titlebar-brandcell">
      <button ref="appMenuAnchor" class="titlebar-app" type="button" aria-label="Desko 菜单" title="Desko" aria-haspopup="menu" :aria-expanded="appMenuOpen" @click="appMenuOpen = !appMenuOpen" @dblclick.stop><BrandLogo /><span v-if="webRuntime && !codexWebRuntime" class="titlebar-wordmark">Desko</span></button>
      <PopoverMenu v-if="appMenuOpen" :anchor="appMenuAnchor" align="start" :width="176" @close="appMenuOpen = false">
        <div class="app-menu-title">Desko</div>
        <template v-if="webRuntime">
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('appearance')"><AppIcon name="gear" :size="15" />外观设置</button>
          <button v-if="!codexWebRuntime" class="pop-item" type="button" role="menuitem" @click="openAppPane('modules')"><AppIcon name="panel" :size="15" />模块管理</button>
        </template>
        <template v-else>
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('profiles')"><AppIcon name="user" :size="15" />档案管理</button>
          <button class="pop-item" type="button" role="menuitem" @click="openAppPane('about')"><AppIcon name="info" :size="15" />关于 Desko</button>
        </template>
      </PopoverMenu>
    </div>

    <div class="titlebar-page">
      <div v-if="!isLocked" class="titlebar-left" @mousedown="startDrag" @dblclick="toggleMaximize">
        <button
          v-if="webRuntime"
          class="titlebar-btn tb-util web-modules-toggle"
          title="打开模块导航"
          aria-label="打开模块导航"
          aria-haspopup="dialog"
          :aria-expanded="props.modulesOpen ?? false"
          aria-controls="web-module-navigation"
          @click="emit('showModules')"
        >
          <AppIcon name="panel" :size="20" />
        </button>
        <div class="titlebar-brand" :title="[crumb, pageHead.count].filter(Boolean).join(' · ')">
          <component :is="pageHead.headingInContent ? 'span' : 'h1'" class="titlebar-crumb">{{ crumb }}</component>
          <span v-if="pageHead.count" class="titlebar-count">{{ pageHead.count }}</span>
        </div>
      </div>

      <div v-if="!isLocked" id="workspace-page-toolbar" class="workspace-page-toolbar"></div>
    </div>

    <div ref="windowControls" class="titlebar-buttons">
      <button v-if="!webRuntime && webStatus?.running" class="web-running" :title="webStatusTitle" :aria-label="webStatusTitle" :disabled="isLocked" @click="openWebSettings">
        <span class="web-running-dot" aria-hidden="true"></span>Web
      </button>
      <BackupBadge v-if="!isLocked && !webRuntime" />
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
.titlebar.titlebar-outer { height: var(--workspace-toolbar-height, 48px); flex: 0 0 var(--workspace-toolbar-height, 48px); overflow: hidden; }
.titlebar-brandcell { width: var(--sidebar-rail-w, 56px); flex: 0 0 var(--sidebar-rail-w, 56px); align-self: stretch; display: flex; align-items: center; justify-content: center; z-index: 2; }
.titlebar-brandcell { background: var(--bg-workspace-rail); background-attachment: fixed; }
.titlebar-page { display: contents; }
.titlebar-outer .titlebar-page { position: absolute; left: var(--workspace-toolbar-left); right: max(var(--workspace-toolbar-right), var(--workspace-window-space, 122px)); height: 100%; display: flex; align-items: center; z-index: 1; pointer-events: none; }
.titlebar-outer .titlebar-left { flex: 0 0 var(--workspace-heading-width); width: var(--workspace-heading-width); min-width: 0; padding-left: 0; overflow: hidden; pointer-events: auto; }
/* 服务状态紧随页名，按文字宽度成组，不占用搜索页的固定标题列。 */
.titlebar-outer .titlebar-page:has([data-workspace-heading="inline"]) { --workspace-heading-width: auto; --workspace-heading-gap: 12px; }
.titlebar-outer .titlebar-page:has([data-workspace-heading="replace"]) { --workspace-heading-gap: 0px; }
.titlebar-outer .titlebar-page:has([data-workspace-heading="replace"]) .titlebar-left { display: none; }
.titlebar-outer .titlebar-brand { min-width: 0; width: 100%; }
.titlebar-outer .titlebar-crumb { display: block; flex-shrink: 0; max-width: 100%; margin: 0; font-size: var(--text-lg); line-height: 24px; font-weight: 600; letter-spacing: 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titlebar-outer .titlebar-count { font-size: var(--text-xs); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.titlebar-outer .workspace-page-toolbar { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; container: workspace-toolbar / inline-size; pointer-events: none; }
/* 品牌标占的是轨的第一格：盒子与下面的模块方块同档（36px / 10px 圆角 / 同一条中线），
   里面那颗 22px 实标不变，改的是外框——不同尺寸的方框挨在一起才读作「空了一块」。 */
.titlebar-app { width: 36px; height: 36px; padding: 7px; border: 0; border-radius: 10px; background: transparent; cursor: pointer; }
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
  /* 顶栏透明并入画布，页名与窗口操作用留白分组。 */
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

.titlebar-left {
  display: flex;
  align-items: center;
  height: 100%;
  padding-left: var(--page-gutter);
  z-index: 1;
}

/* 模块名锚点沿用共享字号与半粗字重。 */
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
  letter-spacing: normal;
  color: var(--text);
  user-select: none;
  -webkit-user-select: none;
}

/* 条数是要读的信息，不是装饰：--text-faint 在标题栏带上只有 2.7:1，走 muted 档 */
.titlebar-count {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-muted);
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
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

@media (max-width: 900px) {
  .titlebar-outer .titlebar-crumb { font-size: var(--text-base); }
}
</style>
