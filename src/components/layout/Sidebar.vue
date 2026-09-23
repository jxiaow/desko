<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { mfaEnabled, readMfaFeature } from '../../services/mfaFeature'
import { fileshareEnabled, readFileshareFeature } from '../../services/fileshareFeature'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  'update:collapsed': [value: boolean]
}>()

const route = useRoute()

// 侧栏只在解锁态挂载，这里读一次正好跟上锁/解锁的重挂节奏
onMounted(() => { readMfaFeature(); readFileshareFeature() })
</script>

<template>
  <div class="sidebar" :class="{ collapsed }">
    <div class="sidebar-nav">
      <router-link to="/entries" class="nav-item" :class="{ active: route.path === '/entries' }">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
        <span v-if="!collapsed" class="nav-text">网址收藏</span>
      </router-link>
      <router-link to="/notes" class="nav-item" :class="{ active: route.path === '/notes' }">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        </div>
        <span v-if="!collapsed" class="nav-text">小记</span>
      </router-link>
      <router-link to="/files" class="nav-item" :class="{ active: route.path === '/files' }">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
        </div>
        <span v-if="!collapsed" class="nav-text">文件快捷</span>
      </router-link>
      <router-link v-if="mfaEnabled" to="/mfa" class="nav-item" :class="{ active: route.path === '/mfa' }">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9.5 11.5l2 2 3.5-3.5"/></svg>
        </div>
        <span v-if="!collapsed" class="nav-text">验证码</span>
      </router-link>
      <router-link v-if="fileshareEnabled" to="/fileshare" class="nav-item" :class="{ active: route.path === '/fileshare' }">
        <div class="nav-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/></svg>
        </div>
        <span v-if="!collapsed" class="nav-text">局域网传输</span>
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
  width: 64px;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-2) var(--space-2);
  min-height: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  margin-bottom: var(--space-1);
  border-radius: var(--radius);
  color: var(--sidebar-text);
  cursor: pointer;
  transition: all var(--transition);
  font-size: 13px;
  font-weight: 500;
  gap: var(--space-3);
  white-space: nowrap;
  text-decoration: none;
  position: relative;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.nav-item.active {
  background: var(--sidebar-active);
  color: var(--sidebar-text-active);
  font-weight: 600;
}
/* 选中靠左侧竖条读出，不再额外挂一个圆点 */
.nav-item.active::before {
  content: '';
  position: absolute;
  left: calc(var(--space-2) * -1);
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 99px;
  background: var(--accent);
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: var(--space-3);
}

.sidebar.collapsed .nav-item.active::before {
  left: calc(var(--space-3) * -1);
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
</style>
