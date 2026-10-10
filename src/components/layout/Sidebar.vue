<script setup lang="ts">
import { useRoute } from 'vue-router'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { enabledModules } from '../../modules/state'
import { modulePath } from '../../modules/registry'
import BrandLogo from '../shared/BrandLogo.vue'
import AppIcon from '../shared/AppIcon.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  'update:collapsed': [value: boolean]
}>()

const route = useRoute()

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
          <span v-if="!collapsed" class="nav-text">{{ m.title }}</span>
        </Transition>
        <Transition name="nav-text">
          <span v-if="!collapsed && m.count && m.count() > 0" class="nav-count">{{ m.count() }}</span>
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
  /* 激活只改字色与字重，不铺底：V5.2 那版"同材质白块 + 抬影"在展开档读作一块
     浮起的卡，到图标轨档就成了压在图标底下的白底——那颗白块被判定为异物，去掉。
     整列只有一项是 accent 色 + 600 字重，重音够点得出来。 */
  color: var(--accent);
  font-weight: 600;
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
