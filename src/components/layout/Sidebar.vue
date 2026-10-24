<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { enabledModules, webModuleGroups } from '../../modules/state'
import { modulePath, type ModuleDef } from '../../modules/registry'
import { isWebRuntime, isCodexWebRuntime } from '../../services/runtime'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ openSettings: []; lock: [] }>()
const route = useRoute()
const webWorkspace = isWebRuntime() && !isCodexWebRuntime()
const groups = computed(() => webWorkspace ? webModuleGroups.value : [{ label: '', modules: enabledModules.value }])

/** 常驻服务的运行状态同时提供给 tooltip 和读屏。 */
const navLabel = (m: ModuleDef) => (m.live?.() ? `${m.title} · 服务运行中` : m.title)
</script>

<template>
  <div class="sidebar" :class="{ 'web-workspace-sidebar': webWorkspace }">
    <nav class="sidebar-nav" aria-label="模块导航">
      <div v-for="group in groups" :key="group.label" class="sidebar-group" role="group" :aria-label="group.label || undefined">
      <span v-if="group.label" class="sidebar-group-title">{{ group.label }}</span>
      <router-link
        v-for="m in group.modules"
        :key="m.id"
        :to="modulePath(m.id)"
        class="nav-item"
        :class="{ active: route.path === modulePath(m.id) }"
        :aria-label="navLabel(m)"
        :data-tip="navLabel(m)"
      >
        <div class="nav-icon">
          <AppIcon :name="m.icon" :size="20" />
          <span v-if="m.live?.()" class="nav-live" aria-hidden="true"></span>
        </div>
        <span v-if="webWorkspace" class="nav-text">{{ m.title }}</span>
      </router-link>
      </div>
    </nav>

    <div class="sidebar-foot">
      <button class="foot-item" type="button" title="设置" aria-label="设置" @click="emit('openSettings')">
        <span class="foot-icon"><AppIcon name="gear" :size="20" /></span>
        <span v-if="webWorkspace" class="foot-text">设置</span>
      </button>
      <button v-if="webWorkspace" class="foot-item web-sidebar-logout" type="button" aria-label="退出浏览器访问" @click="emit('lock')">
        <span class="foot-icon"><AppIcon name="lock" :size="20" /></span><span class="foot-text">退出浏览器访问</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 56px 侧轨只放图标，名称交给悬停气泡与读屏标签。 */
.sidebar {
  width: var(--sidebar-rail-w);
  height: 100%;
  padding: 6px 0 10px;
  background: var(--bg-workspace-rail);
  background-attachment: fixed;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
}
.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 窄轨不预留滚动条槽，让模块图标与 Logo、底部设置共用中心线。 */
  scrollbar-gutter: auto;
  scrollbar-width: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.sidebar-nav::-webkit-scrollbar { display: none; }
.sidebar-group { display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; }
.sidebar-group-title, .nav-text, .foot-text { display: none; }
.nav-item, .foot-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  padding: 0;
  border-radius: 10px;
  color: var(--sidebar-text);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.nav-item { position: relative; text-decoration: none; }
.nav-item:hover:not(.active), .foot-item:hover { background: var(--hover-chrome); color: var(--text); }
.nav-item:hover:not(.active) .nav-icon, .foot-item:hover .foot-icon { color: var(--text-secondary); }
.nav-item.active { background: var(--hover-chrome); color: var(--text); }
.nav-item.active .nav-icon { color: var(--accent); }
.nav-item:focus-visible, .foot-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; box-shadow: none; }
.nav-icon, .foot-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  color: var(--text-muted);
}
.nav-icon { position: relative; }
.nav-icon svg, .foot-icon svg { width: 20px; height: 20px; }
.nav-live {
  position: absolute;
  top: 0;
  right: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 0 2px var(--bg);
}
.sidebar-foot { display: flex; flex-direction: column; flex-shrink: 0; align-items: center; gap: 4px; padding-top: 12px; }
.foot-item { border: none; background: transparent; }
.web-sidebar-logout { display: none; }
</style>
