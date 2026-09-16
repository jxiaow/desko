<script setup lang="ts">
defineProps<{
  collapsed: boolean
  currentModule: 'entries' | 'notes' | 'files'
}>()

const emit = defineEmits<{
  'update:collapsed': [value: boolean]
  'update:currentModule': [value: 'entries' | 'notes' | 'files']
}>()
</script>

<template>
  <div class="sidebar" :class="{ collapsed }">
    <div class="sidebar-nav">
      <div class="nav-item" :class="{ active: currentModule === 'entries' }" @click="emit('update:currentModule', 'entries')">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
        <span class="nav-text">网址导航</span>
      </div>
      <div class="nav-item" :class="{ active: currentModule === 'notes' }" @click="emit('update:currentModule', 'notes')">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <span class="nav-text">笔记</span>
      </div>
      <div class="nav-item" :class="{ active: currentModule === 'files' }" @click="emit('update:currentModule', 'files')">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        </div>
        <span class="nav-text">文件</span>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="version-tag">v1.0</div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w); background: var(--sidebar-bg); border-right: 1px solid var(--sidebar-border);
  display: flex; flex-direction: column; flex-shrink: 0; position: relative;
  transition: width 0.2s cubic-bezier(0.22, 1, 0.36, 1); height: 100%;
}
.sidebar.collapsed { width: 48px; }
.sidebar-nav { flex: 1; overflow-y: auto; padding: 6px 0; min-height: 0; }

.nav-item {
  display: flex; align-items: center; padding: 7px 12px; margin: 1px 6px;
  border-radius: var(--radius-sm); color: var(--sidebar-text); cursor: pointer;
  transition: all 0.12s; font-size: 13px; font-weight: 500; gap: 10px; white-space: nowrap;
}
.nav-item:hover { background: var(--sidebar-hover); color: var(--text); }
.nav-item.active { background: var(--sidebar-active); color: var(--sidebar-text-active); font-weight: 600; }
.sidebar.collapsed .nav-item { margin: 1px 4px; padding: 9px 0; justify-content: center; }

.nav-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 4px; flex-shrink: 0; }
.nav-icon svg { width: 16px; height: 16px; }
.nav-text { overflow: hidden; transition: opacity 0.15s; }
.sidebar.collapsed .nav-text { display: none; }

.sidebar-footer { padding: 8px 12px; border-top: 1px solid var(--border); display: flex; justify-content: center; }
.version-tag { font-size: 10px; color: var(--text-muted); opacity: 0.7; }
.sidebar.collapsed .version-tag { display: none; }
.sidebar.collapsed .sidebar-footer { padding: 4px 0; }
</style>
