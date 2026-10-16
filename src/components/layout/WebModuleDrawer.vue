<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { enabledModules } from '../../modules/state'
import { modulePath } from '../../modules/registry'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ close: [] }>()
const drawer = ref<HTMLDialogElement | null>(null)
const route = useRoute()
const compactScreen = window.matchMedia('(max-width: 640px), (hover: none) and (max-width: 1024px)')
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
watch(() => route.fullPath, close)
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
  <dialog ref="drawer" class="web-module-drawer" aria-label="模块" @cancel.prevent="close" @click.self="close" @keydown.tab="onTab">
    <div class="web-drawer-panel">
      <header class="web-drawer-header">
        <span class="web-drawer-brand">Desko</span>
        <button class="web-drawer-close" aria-label="关闭模块导航" autofocus @click="close"><AppIcon name="x" :size="20" /></button>
      </header>
      <div class="web-drawer-label">模块</div>
      <nav class="web-drawer-nav" aria-label="模块导航">
        <router-link
          v-for="module in enabledModules" :key="module.id" :to="modulePath(module.id)"
          class="web-drawer-item" :class="{ active: route.path === modulePath(module.id) }"
          :aria-label="module.title" @click="close"
        >
          <AppIcon :name="module.icon" :size="20" />
          <span>{{ module.title }}</span>
          <AppIcon v-if="route.path === modulePath(module.id)" class="web-drawer-current" name="check" :size="16" />
        </router-link>
      </nav>
    </div>
  </dialog>
</template>

<style scoped>
.web-module-drawer { position:fixed; inset:0; width:100%; max-width:none; height:100dvh; max-height:none; margin:0; padding:0; border:0; overflow:hidden; background:transparent; color:var(--text); }
.web-module-drawer::backdrop { background:var(--overlay); animation:web-drawer-fade 180ms ease-out; }
.web-drawer-panel { display:flex; flex-direction:column; width:min(304px, calc(100% - 48px)); height:100%; padding:env(safe-area-inset-top) 16px env(safe-area-inset-bottom) max(16px, env(safe-area-inset-left)); background:var(--bg-nav-overlay); box-shadow:var(--shadow-pop); animation:web-drawer-slide 200ms cubic-bezier(.2,.7,.2,1); }
.web-drawer-header { display:flex; flex-shrink:0; align-items:center; justify-content:space-between; min-height:64px; padding-left:12px; }
.web-drawer-brand { font-size:var(--text-lg); font-weight:650; letter-spacing:-.02em; }
.web-drawer-close { display:flex; align-items:center; justify-content:center; width:44px; height:44px; border:0; border-radius:var(--radius); background:transparent; color:var(--text-secondary); cursor:pointer; }
.web-drawer-close:hover { background:var(--fill); color:var(--text); }
.web-drawer-label { flex-shrink:0; padding:12px 12px 10px; color:var(--text-muted); font-size:var(--text-xs); }
.web-drawer-nav { display:flex; flex-direction:column; gap:4px; min-height:0; padding-bottom:16px; overflow-y:auto; overscroll-behavior:contain; }
.web-drawer-item { display:flex; flex-shrink:0; align-items:center; gap:12px; min-height:48px; padding:10px 12px; border-radius:var(--radius); color:var(--text-secondary); font-size:var(--text-base); font-weight:500; text-decoration:none; transition:background var(--transition), color var(--transition); }
.web-drawer-item > svg { flex-shrink:0; color:var(--text-muted); }
.web-drawer-item:hover { background:var(--fill); color:var(--text); }
.web-drawer-item.active { background:var(--accent-soft); color:var(--text-brand); font-weight:600; }
.web-drawer-item.active > svg { color:var(--accent); }
.web-drawer-current { margin-left:auto; }
@keyframes web-drawer-slide { from { transform:translateX(-100%); } to { transform:translateX(0); } }
@keyframes web-drawer-fade { from { opacity:0; } to { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .web-drawer-panel, .web-module-drawer::backdrop { animation:none; } }
</style>
