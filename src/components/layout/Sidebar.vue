<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { moduleGroups } from '../../modules/state'
import { modulePath, type ModuleDef } from '../../modules/registry'
import { isWebRuntime } from '../../services/runtime'
import { sidebarCollapsed } from '../../services/sidebar'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ openSettings: []; lock: [] }>()
const route = useRoute()
const webWorkspace = isWebRuntime()
const groups = computed(() => moduleGroups.value)
const supportsMedia = typeof window.matchMedia === 'function'
const narrow = ref(supportsMedia && window.matchMedia('(max-width: 899px)').matches)
const labelsVisible = computed(() => webWorkspace || (!sidebarCollapsed.value && !narrow.value))
let narrowQuery: MediaQueryList | undefined
const syncNarrow = (event: MediaQueryListEvent) => { narrow.value = event.matches }
onMounted(() => {
  if (!supportsMedia) return
  narrowQuery = window.matchMedia('(max-width: 899px)')
  narrowQuery.addEventListener('change', syncNarrow)
})
onUnmounted(() => narrowQuery?.removeEventListener('change', syncNarrow))

/** 常驻服务的运行状态同时提供给 tooltip 和读屏。 */
const navLabel = (m: ModuleDef) => (m.live?.() ? `${m.title} · 服务运行中` : m.title)
</script>

<template>
  <div id="app-sidebar" class="sidebar" :class="{ 'web-workspace-sidebar': webWorkspace }">
    <nav class="sidebar-nav" aria-label="模块导航">
      <div v-for="group in groups" :key="group.label" class="sidebar-group" role="group" :aria-label="group.label || undefined">
        <span v-if="group.label && labelsVisible" class="sidebar-group-title">{{ group.label }}</span>
        <router-link
          v-for="m in group.modules"
          :key="m.id"
          :to="modulePath(m.id)"
          class="nav-item"
          :class="{ active: route.path === modulePath(m.id) }"
          :aria-label="navLabel(m)"
          :data-tip="labelsVisible ? undefined : navLabel(m)"
        >
          <div class="nav-icon">
            <AppIcon :name="m.icon" :size="18" />
            <span v-if="m.live?.()" class="nav-live" aria-hidden="true"></span>
          </div>
          <template v-if="labelsVisible">
            <span class="nav-text">{{ m.title }}</span>
            <span v-if="m.count?.()" class="nav-count" aria-hidden="true">{{ m.count() }}</span>
          </template>
        </router-link>
      </div>
    </nav>

    <div class="sidebar-foot">
      <button class="foot-item" type="button" title="设置" aria-label="设置" @click="emit('openSettings')">
        <span class="foot-icon"><AppIcon name="gear" :size="20" /></span>
        <span v-if="labelsVisible" class="foot-text">设置</span>
      </button>
      <button v-if="webWorkspace" class="foot-item web-sidebar-logout" type="button" aria-label="退出浏览器访问" @click="emit('lock')">
        <span class="foot-icon"><AppIcon name="lock" :size="20" /></span><span class="foot-text">退出浏览器访问</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 桌面默认展开：模块名与分组承担信息架构；收起后回到纯图标轨。 */
.sidebar {
  width: var(--sidebar-rail-w);
  height: 100%;
  padding: 8px 10px 10px;
  background: var(--bg-workspace-rail);
  background-attachment: fixed;
  /* 光锚在视口左上角，和整窗尺寸的图对齐；侧栏本身从视口 (0,0) 起，两者重合。 */
  background-size: 100vw 100vh;
  background-position: 0 0;
  background-repeat: no-repeat;
  border-right: 0;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
}
/* 桌面端侧栏是一块实底导轨：与正文同属一个应用，分层只由深一档的底色承担。
   右缘原先还有一根比导轨本身更深的 1px 竖线，接触处叠成三刀，已撤。
   不再透窗框光场——那样侧栏和正文会读成两个独立面板拼在一起。 */
.app-root:not(.web-runtime) .sidebar {
  background: var(--bg-rail, var(--bg-sheet));
}
.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
}
.sidebar-nav::-webkit-scrollbar { display: none; }
.sidebar-group { display: flex; flex-direction: column; align-items: stretch; gap: 2px; width: 100%; }
.sidebar-group-title {
  display: block;
  padding: 12px 10px 5px;
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 18px;
  letter-spacing: .04em;
  white-space: nowrap;
}
.sidebar-group:first-child .sidebar-group-title { padding-top: 4px; }
.nav-item, .foot-item {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  width: 100%;
  height: 32px;
  flex: 0 0 32px;
  padding: 0 8px 0 12px;
  border-radius: 8px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background-color var(--transition), color var(--transition);
}
.nav-item { position: relative; text-decoration: none; font: inherit; }
.nav-text, .foot-text {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  font-weight: 400;
  line-height: 20px;
}
.nav-text { flex: 1 1 auto; }
/* 计数挂在模块名右端：导航行同时说清「这是什么」和「里面有多少」。
   等宽数字，不跟着条目数变化抖动。 */
.nav-count {
  flex: 0 0 auto;
  color: var(--text-faint);
  font-size: var(--text-xs);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
}
.nav-item:hover:not(.active), .foot-item:hover { background: var(--hover-chrome); color: var(--text); }
/* 激活项不再铺一片白底：白片会和主浮片抢「浮起」的语义，一列六行看下来
   像六个按钮。改成左端一根 2px 竖条 + 字重抬一档，读作「目录里的当前位置」。 */
.nav-item.active {
  background: transparent;
  color: var(--text);
  box-shadow: none;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 7px;
  bottom: 7px;
  width: 2px;
  border-radius: 1px;
  background: var(--accent);
}
.nav-item.active .nav-text { font-weight: 600; }
.nav-item.active .nav-count { color: var(--text-muted); }
.nav-item.active .nav-icon { color: var(--text-brand); }
.nav-item:focus-visible, .foot-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: none; }
.nav-icon, .foot-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  transition: color var(--transition);
}
.nav-icon { position: relative; }
.nav-item:hover .nav-icon, .foot-item:hover .foot-icon { color: var(--text-secondary); }
.nav-icon svg, .foot-icon svg { width: 18px; height: 18px; }
.nav-live {
  position: absolute;
  top: 0;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg-workspace-rail);
}
.sidebar-foot {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: stretch;
  gap: 2px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.foot-item { border: none; background: transparent; font: inherit; }
.web-sidebar-logout { display: none; }

/* 收起态：仍保留完整导航，只把名称让给内容。 */
.app-root.sidebar-collapsed .sidebar {
  padding: 6px 0 10px;
}
.app-root.sidebar-collapsed .sidebar-nav {
  align-items: center;
  gap: 12px;
}
.app-root.sidebar-collapsed .sidebar-group {
  align-items: center;
  gap: 6px;
}
.app-root.sidebar-collapsed .nav-item,
.app-root.sidebar-collapsed .foot-item {
  justify-content: center;
  gap: 0;
  width: 36px;
  height: 36px;
  flex-basis: 36px;
  padding: 0;
  border-radius: 10px;
}
.app-root.sidebar-collapsed .sidebar-foot {
  align-items: center;
  margin-top: 10px;
  padding-top: 10px;
  margin-inline: 10px;
}
.app-root.sidebar-collapsed .nav-live { box-shadow: 0 0 0 2px var(--bg-workspace-rail); }
.app-root.sidebar-collapsed .web-sidebar-logout { display: none; }

@media (max-width: 899px) {
  .app-root:not(.web-runtime) .sidebar { padding: 6px 0 10px; }
  .app-root:not(.web-runtime) .sidebar-nav { align-items: center; gap: 12px; }
  .app-root:not(.web-runtime) .sidebar-group { align-items: center; gap: 6px; }
  .app-root:not(.web-runtime) .nav-item,
  .app-root:not(.web-runtime) .foot-item {
    justify-content: center;
    gap: 0;
    width: 36px;
    height: 36px;
    flex-basis: 36px;
    padding: 0;
    border-radius: 10px;
  }
  .app-root:not(.web-runtime) .sidebar-foot {
    align-items: center;
    margin-top: 10px;
    padding-top: 10px;
    margin-inline: 10px;
  }
}
</style>
