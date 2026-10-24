<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { enabledModules, webModuleGroups } from '../../modules/state'
import { modulePath } from '../../modules/registry'
import AppIcon from '../shared/AppIcon.vue'
import BrandLogo from '../shared/BrandLogo.vue'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const drawer = ref<HTMLDialogElement | null>(null)
const route = useRoute()
const compactScreen = window.matchMedia('(max-width: 760px), (hover: none) and (max-width: 1024px)')
const close = () => emit('close')
const onScreenChange = () => { if (!compactScreen.matches) close() }
function onTab(event: KeyboardEvent) {
  const controls = drawer.value?.querySelectorAll<HTMLElement>('button, a[href]')
  if (!controls?.length) return
  const first = controls[0]!
  const last = controls[controls.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

useEscapeClose(close)
// 菜单项在点击时关闭；上一轮异步导航落定时不能关闭刚重新打开的抽屉。
onMounted(() => {
  drawer.value?.showModal()
  compactScreen.addEventListener('change', onScreenChange)
})
onBeforeUnmount(() => {
  drawer.value?.close()
  compactScreen.removeEventListener('change', onScreenChange)
})
</script>

<template>
  <dialog id="web-module-navigation" ref="drawer" class="web-module-drawer" aria-label="模块" @cancel.prevent="close" @click.self="close" @keydown.tab="onTab">
    <div class="web-drawer-panel">
      <header class="web-drawer-header">
        <span class="web-drawer-brand"><BrandLogo />Desko</span>
        <button class="web-drawer-close" type="button" aria-label="关闭模块导航" autofocus @click="close"><span>收起</span><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="web-drawer-body">
      <div class="web-drawer-title"><h2>切换模块</h2><p>我的工作台 · {{ enabledModules.length }} 个已启用模块</p></div>
      <nav class="web-drawer-nav" aria-label="模块导航">
        <section v-for="group in webModuleGroups" :key="group.label" class="web-drawer-group" :aria-label="group.label">
        <h3>{{ group.label }}</h3>
        <div class="web-drawer-list">
        <router-link
          v-for="module in group.modules" :key="module.id" :to="modulePath(module.id)"
          class="web-drawer-item" :class="{ active: route.path === modulePath(module.id) }"
          :aria-label="module.title" @click="close"
          :aria-current="route.path === modulePath(module.id) ? 'page' : undefined"
        >
          <AppIcon :name="module.icon" :size="20" />
          <span class="web-drawer-copy"><span>{{ module.title }}</span><span class="web-drawer-description">{{ module.id === 'files' ? '浏览和下载电脑上的文件' : module.brief }}</span></span>
          <AppIcon v-if="route.path === modulePath(module.id)" class="web-drawer-current" name="check" :size="16" />
        </router-link>
        </div>
        </section>
      </nav>
      <button class="web-drawer-item web-drawer-settings" type="button" aria-label="设置" @click="emit('openSettings')"><AppIcon name="gear" :size="20" /><span>设置</span><span class="web-drawer-device">当前浏览器</span><AppIcon name="chevRight" :size="14" /></button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.web-module-drawer { position:fixed; inset:0; width:100%; max-width:none; height:100dvh; max-height:none; margin:0; padding:0; border:0; overflow:hidden; background:var(--bg); color:var(--text); }
.web-module-drawer::backdrop { background:var(--bg); }
.web-drawer-panel { display:flex; flex-direction:column; width:100%; height:100%; background:var(--bg); }
.web-drawer-header { display:flex; flex-shrink:0; align-items:center; justify-content:space-between; min-height:calc(56px + env(safe-area-inset-top)); padding:env(safe-area-inset-top) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left)); }
.web-drawer-brand { display:flex; align-items:center; gap:5px; font-size:var(--text-lg); font-weight:600; letter-spacing:-.025em; }
.web-drawer-brand :deep(.brand-logo) { width:28px; height:28px; }
.web-drawer-close { display:flex; align-items:center; justify-content:center; gap:7px; min-width:44px; height:44px; padding:0 10px; border:0; border-radius:var(--radius-ib); background:var(--active); color:var(--text-secondary); font:inherit; font-size:var(--text-sm); cursor:pointer; }
.web-drawer-close:hover { background:var(--fill); color:var(--text); }
.web-drawer-body { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:12px max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.web-drawer-title { margin-bottom:22px; }
.web-drawer-title h2 { margin:0; font-size:var(--text-xl); line-height:28px; font-weight:600; letter-spacing:-.02em; }
.web-drawer-title p { margin:6px 0 0; color:var(--text-muted); font-size:var(--text-sm); }
.web-drawer-nav { display:flex; flex-direction:column; gap:22px; }
.web-drawer-group h3 { margin:0 0 9px; padding-left:3px; color:var(--text-muted); font-size:var(--text-sm); font-weight:400; }
.web-drawer-list { display:flex; flex-direction:column; gap:2px; padding:6px; border-radius:12px; background:var(--bg-surface); }
.web-drawer-item { display:flex; flex-shrink:0; align-items:center; gap:12px; min-height:64px; padding:9px 12px; border-radius:var(--radius-ib); color:var(--text); font-size:var(--text-base); font-weight:400; text-decoration:none; transition:background-color var(--transition), color var(--transition); }
.web-drawer-item > svg { flex-shrink:0; color:var(--text-muted); }
.web-drawer-item:hover { background:var(--hover); }
.web-drawer-item.active { background:var(--hover-chrome); font-weight:500; }
.web-drawer-item.active > svg { color:var(--accent); }
.web-drawer-copy { display:flex; flex:1; min-width:0; flex-direction:column; gap:3px; }
.web-drawer-description { color:var(--text-muted); font-size:var(--text-sm); font-weight:400; }
.web-drawer-current { margin-left:auto; }
.web-drawer-settings { width:100%; min-height:60px; margin-top:22px; border:0; border-radius:12px; background:var(--bg-surface); text-align:left; cursor:pointer; padding-inline:18px; }
.web-drawer-device { margin-left:auto; color:var(--text-muted); font-size:var(--text-xs); }
.web-drawer-settings > svg:last-child { width:14px; }
.web-drawer-item:focus-visible, .web-drawer-close:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
</style>
