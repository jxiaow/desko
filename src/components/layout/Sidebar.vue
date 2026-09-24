<script setup lang="ts">
import { computed, onMounted, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { mfaEnabled, readMfaFeature } from '../../services/mfaFeature'
import { fileshareEnabled, readFileshareFeature } from '../../services/fileshareFeature'
import { useEntriesStore } from '../../stores/entries'
import { useNotesStore } from '../../stores/notes'
import { useFileShortcutsStore } from '../../stores/fileShortcuts'
import BrandLogo from '../shared/BrandLogo.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  'update:collapsed': [value: boolean]
}>()

const route = useRoute()

const { entries } = storeToRefs(useEntriesStore())
const { notes } = storeToRefs(useNotesStore())
const { shortcuts } = storeToRefs(useFileShortcutsStore())

const counts: Record<string, ComputedRef<number>> = {
  '/entries': computed(() => entries.value.length),
  '/notes': computed(() => notes.value.length),
  '/files': computed(() => shortcuts.value.length),
}

// 侧栏只在解锁态挂载，这里读一次正好跟上锁/解锁的重挂节奏
onMounted(() => { readMfaFeature(); readFileshareFeature() })

const startDrag = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button')) return
  getCurrentWindow().startDragging()
}

const onDragDblclick = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button')) return
  getCurrentWindow().toggleMaximize()
}
</script>

<template>
  <div class="sidebar" :class="{ collapsed }">
    <!-- 顶部品牌行：全高骨架里侧栏自己承担窗口拖拽 -->
    <div class="sidebar-top" @mousedown="startDrag" @dblclick="onDragDblclick">
      <template v-if="!collapsed">
        <span class="sidebar-brand"><BrandLogo /></span>
        <span class="sidebar-name">Desko</span>
      </template>
      <button class="sidebar-toggle" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="$emit('update:collapsed', !collapsed)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="9" y1="3" x2="9" y2="21"/>
        </svg>
      </button>
    </div>

    <div class="sidebar-nav">
      <router-link to="/entries" class="nav-item" :class="{ active: route.path === '/entries' }" title="网址收藏">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">网址收藏</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/entries']!.value > 0" class="nav-count">{{ counts['/entries']!.value }}</span>
        </Transition>
      </router-link>
      <router-link to="/notes" class="nav-item" :class="{ active: route.path === '/notes' }" title="小记">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">小记</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/notes']!.value > 0" class="nav-count">{{ counts['/notes']!.value }}</span>
        </Transition>
      </router-link>
      <router-link to="/files" class="nav-item" :class="{ active: route.path === '/files' }" title="文件快捷">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">文件快捷</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/files']!.value > 0" class="nav-count">{{ counts['/files']!.value }}</span>
        </Transition>
      </router-link>
      <router-link v-if="mfaEnabled" to="/mfa" class="nav-item" :class="{ active: route.path === '/mfa' }" title="验证码">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 11.5l2 2 3.5-3.5"/></svg>
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">验证码</span>
        </Transition>
      </router-link>
      <router-link v-if="fileshareEnabled" to="/fileshare" class="nav-item" :class="{ active: route.path === '/fileshare' }" title="局域网传输">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">局域网传输</span>
        </Transition>
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width var(--transition-slow);
  height: 100%;
}

.sidebar.collapsed {
  width: 56px;
}

/* 顶部品牌行：与右列 40px 标题栏同高；侧栏底色转微灰后补一条分割线收口 */
.sidebar-top {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1);
  border-bottom: 1px solid var(--sidebar-border);
  user-select: none;
  -webkit-user-select: none;
}

.sidebar.collapsed .sidebar-top {
  justify-content: center;
  padding: 0;
}

/* 双侧 auto 压过展开档的 margin-left:auto，让 toggle 回到中线 */
.sidebar.collapsed .sidebar-toggle {
  margin: 0 auto;
}

/* 折叠档：.sidebar-nav 的 6px scrollbar-gutter 会把图标整体左推，
   用等量左内衬补回来，图标与 toggle 同落中线 */
.sidebar.collapsed .sidebar-nav {
  padding-left: calc(var(--space-2) + 6px);
}

.sidebar-brand {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: var(--space-2);
  border-radius: var(--radius-badge);
  background: var(--accent-soft);
}

.sidebar-brand svg { width: 20px; height: 20px; }

.sidebar-name {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-title);
  min-width: 0;
}

.sidebar-toggle {
  width: 26px;
  height: 26px;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  transition: all var(--transition);
}

.sidebar-toggle:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 6px var(--space-2) var(--space-2);
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 var(--space-2);
  margin-bottom: var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--sidebar-text);
  cursor: pointer;
  transition: all var(--transition);
  font-size: 13px;
  font-weight: 500;
  gap: var(--space-2);
  white-space: nowrap;
  text-decoration: none;
  position: relative;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.nav-item.active {
  /* 去油减重：8% 极淡水洗取代厚色块，左侧胶囊柱做唯一重音 */
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--sidebar-text-active);
  font-weight: 600;
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 14px;
  border-radius: 999px;
  background: var(--accent);
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

.nav-icon {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-icon svg {
  width: 18px;
  height: 18px;
}

.nav-text {
  flex: 1;
  overflow: hidden;
}

/* 计数胶囊：收纳模块体量，激活态随 accent 走 */
.nav-count {
  flex-shrink: 0;
  height: 18px;
  min-width: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-badge);
  background: var(--fill);
  color: var(--text-muted);
}

.nav-item.active .nav-count {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
}
</style>
