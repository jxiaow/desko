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
import AppIcon from '../shared/AppIcon.vue'

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
        <AppIcon name="panel" :size="collapsed ? 20 : 18" />
      </button>
    </div>

    <div class="sidebar-nav">
      <router-link to="/entries" class="nav-item m-ent" :class="{ active: route.path === '/entries' }" aria-label="网址收藏">
        <div class="nav-icon">
          <AppIcon name="navEntries" :size="collapsed ? 22 : 18" />
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">网址收藏</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/entries']!.value > 0" class="nav-count">{{ counts['/entries']!.value }}</span>
        </Transition>
      </router-link>
      <router-link to="/notes" class="nav-item m-not" :class="{ active: route.path === '/notes' }" aria-label="小记">
        <div class="nav-icon">
          <AppIcon name="navNotes" :size="collapsed ? 22 : 18" />
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">小记</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/notes']!.value > 0" class="nav-count">{{ counts['/notes']!.value }}</span>
        </Transition>
      </router-link>
      <router-link to="/files" class="nav-item m-fil" :class="{ active: route.path === '/files' }" aria-label="文件快捷">
        <div class="nav-icon">
          <AppIcon name="navFiles" :size="collapsed ? 22 : 18" />
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">文件快捷</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && counts['/files']!.value > 0" class="nav-count">{{ counts['/files']!.value }}</span>
        </Transition>
      </router-link>
      <router-link v-if="mfaEnabled" to="/mfa" class="nav-item m-mfa" :class="{ active: route.path === '/mfa' }" aria-label="验证码">
        <div class="nav-icon">
          <AppIcon name="navMfa" :size="collapsed ? 22 : 18" />
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed" class="nav-text">验证码</span>
        </Transition>
      </router-link>
      <router-link v-if="fileshareEnabled" to="/fileshare" class="nav-item m-lan" :class="{ active: route.path === '/fileshare' }" aria-label="局域网传输">
        <div class="nav-icon">
          <AppIcon name="navLan" :size="collapsed ? 22 : 18" />
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
  /* V5.2 侧栏轮：恢复独立面（推翻拆面轮的"并入画布"）——列的体积感靠这一档底色，
     只留发丝右界时它和画布同色，五枚导航像浮在页面上而不是站成一列 */
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width var(--transition-slow);
  height: 100%;
}

.sidebar.collapsed {
  width: var(--sidebar-rail-w);
}

/* 顶部品牌行：与右列标题栏同高（42px）；拆面轮后画布贯通，不再补分割线 */
.sidebar-top {
  height: 42px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-1);
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

/* 折叠档：.sidebar-nav 的 9px scrollbar-gutter 会把图标整体左推，
   用等量左内衬补回来，图标与 toggle 同落中线 */
.sidebar.collapsed .sidebar-nav {
  padding-left: calc(var(--space-2) + 9px);
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
  font-size: var(--text-md);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-title);
  min-width: 0;
}

.sidebar-toggle {
  width: 24px;
  height: 24px;
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-ib);
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
  height: 36px;
  padding: 0 var(--space-2);
  margin-bottom: var(--space-1);
  border-radius: var(--radius);
  color: var(--sidebar-text);
  cursor: pointer;
  transition: all var(--transition);
  font-size: var(--text-base);
  font-weight: 500;
  gap: var(--space-3);
  white-space: nowrap;
  text-decoration: none;
  position: relative;
  --h: var(--text-muted);
}

/* v2：模块不再各钉色相——导航退到中性灰阶，激活态统一吃 accent。
   分类色只留在内容侧（头像/徽章/行内色相钉）。 */
.nav-item.active { --h: var(--accent); }

.nav-icon { color: inherit; }

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

.nav-item.active {
  /* V5.2 侧栏轮：激活=同材质白块 + 抬影，重音给整条（文字也转 accent），
     只让图标变色的话在一列灰字里点不出来。
     图标一律用描边母版：22px 的实心母版在白块里糊成色块，状态已由容器说尽。 */
  background: var(--panel-bg);
  color: var(--accent);
  font-weight: 600;
  box-shadow: var(--shadow-card);
}
.nav-item.active .nav-icon { color: var(--h); }

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}

/* 图标分两档：展开档文字打头，图标退到 18px 当锚点；图标轨档 22px，
   那里图标是唯一线索，缩到 18 会显得空。AppIcon 的 size 决定实笔反算，
   CSS 只负责盒子，两处必须同档 */
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

.sidebar.collapsed .nav-icon {
  width: 22px;
  height: 22px;
}

.sidebar.collapsed .nav-icon svg {
  width: 22px;
  height: 22px;
}

.nav-text {
  flex: 1;
  overflow: hidden;
}

/* 计数胶囊：圆形等宽数字，非激活走中性档，激活跟着整条转 accent */
.nav-count {
  flex-shrink: 0;
  height: 18px;
  min-width: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  border-radius: var(--radius-pill);
  background: var(--fill);
  color: var(--text-muted);
}

.nav-item.active .nav-count {
  background: color-mix(in srgb, var(--h) 14%, transparent);
  color: var(--h);
}
</style>
