<script setup lang="ts">
import { useRoute } from 'vue-router'
import { isWebRuntime } from '../../services/runtime'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { enabledModules } from '../../modules/state'
import { modulePath } from '../../modules/registry'
import AppIcon from '../shared/AppIcon.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  'update:collapsed': [value: boolean]
}>()

const route = useRoute()
const webRuntime = isWebRuntime()

const startDrag = (e: MouseEvent) => {
  if (isWebRuntime()) return
  if ((e.target as HTMLElement).closest('button')) return
  getCurrentWindow().startDragging()
}

const onDragDblclick = (e: MouseEvent) => {
  if (isWebRuntime()) return
  if ((e.target as HTMLElement).closest('button')) return
  getCurrentWindow().toggleMaximize()
}
</script>

<template>
  <div class="sidebar" :class="{ collapsed }">
    <!-- 顶部品牌行：全高骨架里侧栏自己承担窗口拖拽 -->
    <div class="sidebar-top" @mousedown="startDrag" @dblclick="onDragDblclick">
      <span v-if="!collapsed" class="sidebar-name">Desko</span>
      <button class="sidebar-toggle" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="$emit('update:collapsed', !collapsed)">
        <AppIcon name="panel" :size="collapsed ? 20 : 18" />
      </button>
    </div>

    <div v-if="!collapsed" class="sidebar-sec">模块</div>

    <nav class="sidebar-nav" aria-label="模块导航">
      <router-link
        v-for="m in enabledModules"
        :key="m.id"
        :to="modulePath(m.id)"
        class="nav-item"
        :class="{ active: route.path === modulePath(m.id) }"
        :aria-label="m.title"
        :data-tip="collapsed ? m.title : undefined"
      >
        <div class="nav-icon">
          <AppIcon :name="m.icon" :size="collapsed ? 22 : 18" />
        </div>
        <Transition name="nav-text">
          <span v-if="!collapsed || webRuntime" class="nav-text">{{ m.title }}</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && m.count && m.count() > 0" class="nav-count">{{ m.count() }}</span>
        </Transition>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  /* Things 式暖灰目录列：体积感靠这一档底色，右界只留发丝线 */
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-navigation);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  position: relative;
  transition: width var(--transition-slow);
  height: 100%;
  padding: 0 12px;
}

.sidebar.collapsed {
  width: var(--sidebar-rail-w);
  padding: 0;
}

/* 顶部品牌行：比右列标题栏略高，给品牌名一点呼吸 */
.sidebar-top {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 2px;
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

/* 折叠档两侧预留等宽的滚动条槽（见 .sidebar-nav），模块图标与顶部按钮共用中线。 */

.sidebar-name {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
  padding-left: 10px;
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

/* 段标：模块分组的小字眉题 */
.sidebar-sec {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-nav-section);
  letter-spacing: 0.06em;
  padding: 0 10px 6px;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  /* 两侧等宽留槽：滚动条出现或消失都不把行往一边推 */
  scrollbar-gutter: stable both-edges;
  padding: 0 0 var(--space-2);
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 展开档把两侧那两道空槽抵掉：行的左右内缩回到 .sidebar 的 12px，图标与「Desko」
   同轴，行右缘不再凭空比左缘多出一条滚动条宽 */
.sidebar:not(.collapsed) .sidebar-nav {
  margin-inline: calc(var(--scrollbar-track) * -1);
}

.nav-item {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--sidebar-text);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
  font-size: 13.5px;
  font-weight: 500;
  gap: 9px;
  white-space: nowrap;
  text-decoration: none;
  position: relative;
}

.nav-item:hover {
  background: var(--sidebar-hover);
  color: var(--text);
}

/* 激活=淡染行：accent-soft 底 + brand 字 + 600，图标转 accent */
.nav-item.active {
  background: var(--accent-soft);
  color: var(--text-brand);
  font-weight: 600;
}

.nav-icon {
  color: var(--text-faint);
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

.nav-item:hover .nav-icon { color: var(--text-secondary); }
.nav-item.active .nav-icon { color: var(--accent); }

.sidebar.collapsed .nav-item {
  justify-content: center;
  padding: 0;
}
.sidebar.collapsed .nav-text { display: none; }

/* 图标分两档：展开档文字打头，图标退到 18px 当锚点；图标轨档 22px，
   那里图标是唯一线索，缩到 18 会显得空。AppIcon 的 size 决定实笔反算，
   CSS 只负责盒子，两处必须同档 */
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

/* 计数：右对齐中性数字，不做胶囊——目录行保持安静 */
.nav-count {
  flex-shrink: 0;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-faint);
}

.nav-item.active .nav-count {
  color: var(--text-brand);
}
</style>
