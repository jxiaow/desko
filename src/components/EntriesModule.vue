<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import type { Entry, Tab } from '../types'

defineProps<{
  searchKeyword: string
  tabs: Tab[]
  activeTab: string
  loading: boolean
  filteredEntries: Entry[]
  isBatchMode: boolean
  selectedIds: Set<string>
  visiblePasswords: Record<string, boolean>
  passwordCache: Record<string, { value: string; ts: number }>
}>()

const emit = defineEmits<{
  'update:searchKeyword': [value: string]
  'update:activeTab': [value: string]
  openAdd: []
  toggleBatchMode: []
  selectAll: []
  deselectAll: []
  batchDelete: []
  openDetail: [entry: Entry]
  openEdit: [entry: Entry]
  delete: [entry: Entry]
  toggleSelect: [id: string]
  togglePassword: [id: string]
  copyPassword: [id: string]
  copyText: [text: string, label: string]
  openUrl: [url: string]
}>()

const tabsExpanded = ref(false)
const tabsOverflow = ref(false)
const tabsRef = ref<HTMLElement | null>(null)

let tabsObserver: ResizeObserver | null = null


const pathVisibleCount = ref<Map<string, number>>(new Map())
const pathContainers = ref<Map<string, HTMLElement>>(new Map())
let pathObserver: ResizeObserver | null = null

const calcPathVisible = (entryId: string) => {
  const container = pathContainers.value.get(entryId)
  if (!container) return
  
  const children = Array.from(container.children) as HTMLElement[]
  const links = children.filter(c => c.classList.contains('card-path-link'))
  const moreEl = children.find(c => c.classList.contains('card-paths-more'))
  
  if (links.length === 0) return
  
  const containerWidth = container.clientWidth
  const moreWidth = moreEl ? moreEl.offsetWidth : 40
  
  let totalWidth = 0
  let visibleCount = links.length
  
  for (let i = 0; i < links.length; i++) {
    totalWidth += links[i].offsetWidth + 4
    if (i < links.length - 1 && totalWidth + moreWidth > containerWidth) {
      visibleCount = i
      break
    }
  }
  
  if (totalWidth > containerWidth && visibleCount === links.length) {
    visibleCount = links.length - 1
  }
  
  const newCount = Math.max(0, visibleCount)
  const oldCount = pathVisibleCount.value.get(entryId)
  if (oldCount !== newCount) {
    pathVisibleCount.value.set(entryId, newCount)
  }
}

const registerPathContainer = (entryId: string, el: HTMLElement | null) => {
  if (el) {
    const old = pathContainers.value.get(entryId)
    if (old !== el) {
      pathContainers.value.set(entryId, el)
      if (!pathObserver) {
        pathObserver = new ResizeObserver(() => {
          pathContainers.value.forEach((_, id) => calcPathVisible(id))
        })
      }
      if (old) pathObserver.unobserve(old)
      pathObserver.observe(el)
      nextTick(() => calcPathVisible(entryId))
    }
  } else {
    const old = pathContainers.value.get(entryId)
    if (old && pathObserver) pathObserver.unobserve(old)
    pathContainers.value.delete(entryId)
    pathVisibleCount.value.delete(entryId)
  }
}
const getAvatarClass = (id: string) => {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `c${Math.abs(hash) % 6}`
}

onMounted(() => {
  if (tabsRef.value) {
    tabsObserver = new ResizeObserver(() => {
      if (tabsRef.value) {
        tabsOverflow.value = tabsRef.value.scrollHeight > 40
      }
    })
    tabsObserver.observe(tabsRef.value)
  }
})

onUnmounted(() => {
  if (tabsObserver) tabsObserver.disconnect()
  if (pathObserver) pathObserver.disconnect()
})
</script>

<template>
  <div class="content-inner">
    <div class="toolbar">
      <div class="search-box">
        <span class="search-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input :value="searchKeyword" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" placeholder="搜索名称或网址..." />
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="toolbar-actions">
        <button class="btn-primary" @click="emit('openAdd')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          新增条目
        </button>
        <button class="btn-secondary" :class="{ active: isBatchMode }" @click="emit('toggleBatchMode')">
          {{ isBatchMode ? '取消选择' : '批量选择' }}
        </button>
      </div>
    </div>

    <div v-if="isBatchMode" class="batch-bar">
      <span class="batch-info">已选择 {{ selectedIds.size }} 项</span>
      <div class="batch-actions">
        <button class="batch-btn" @click="emit('selectAll')">全选</button>
        <button class="batch-btn" @click="emit('deselectAll')">取消全选</button>
        <button class="batch-btn danger" @click="emit('batchDelete')" :disabled="selectedIds.size === 0">
          删除选中
        </button>
      </div>
    </div>

    <div class="tabs" :class="{ expanded: tabsExpanded }" ref="tabsRef">
      <div
        v-for="t in tabs"
        :key="t.id"
        class="tab"
        :class="{ active: activeTab === t.id }"
        @click="emit('update:activeTab', t.id)"
      >
        {{ t.name }}
        <span class="tab-count">{{ t.count }}</span>
      </div>
      <button v-if="tabsOverflow" class="tabs-toggle" @click="tabsExpanded = !tabsExpanded">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline v-if="!tabsExpanded" points="6 9 12 15 18 9"/>
          <polyline v-else points="18 15 12 9 6 15"/>
        </svg>
        {{ tabsExpanded ? '收起' : '展开' }}
      </button>
    </div>

    <div v-if="loading" class="loading">
      <div class="skeleton-grid">
        <div class="skeleton-card" v-for="n in 6" :key="n">
          <div class="skeleton-header">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-title-area">
              <div class="skeleton-line short"></div>
              <div class="skeleton-line shorter"></div>
            </div>
          </div>
          <div class="skeleton-body">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="filteredEntries.length" class="cards-grid">
      <div
        v-for="item in filteredEntries"
        :key="item.id"
        class="entry-card"
        :class="{ selected: selectedIds.has(item.id) }"
      >
        <div v-if="isBatchMode" class="card-checkbox" @click.stop="emit('toggleSelect', item.id)">
          <span class="checkbox" :class="{ checked: selectedIds.has(item.id) }">
            {{ selectedIds.has(item.id) ? '✓' : '' }}
          </span>
        </div>
        <div class="card-header">
          <div class="card-header-main">
            <div class="card-avatar" :class="getAvatarClass(item.id)">
              {{ item.name.charAt(0) }}
            </div>
            <div class="card-title-area">
              <div class="card-title-row">
                <span class="card-name">{{ item.name }}</span>
                <span class="card-category">{{ item.category || '未分类' }}</span>
              </div>
              <a
                v-if="item.url"
                class="card-url"
                @click.prevent="emit('openUrl', item.url!)"
              >{{ item.url }}</a>
            </div>
          </div>
          <div class="card-header-actions">
            <button class="card-icon-btn" @click.stop="emit('openDetail', item)" title="查看详情">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="card-icon-btn" @click.stop="emit('openEdit', item)" title="编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="card-icon-btn danger" @click.stop="emit('delete', item)" title="删除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
        <div class="card-body" @click="emit('openDetail', item)">
          <div class="card-info-row">
            <span class="card-info-label">用户</span>
            <span class="card-info-value">{{ item.username || '-' }}</span>
            <button class="card-action-btn" @click.stop="emit('copyText', item.username || '', '用户名')" title="复制用户名">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <span class="card-action-spacer"></span>
          </div>
          <div class="card-info-row">
            <span class="card-info-label">密码</span>
            <span class="card-info-value" :class="{ masked: !visiblePasswords[item.id] }">
              {{ visiblePasswords[item.id] ? (passwordCache[item.id]?.value || '••••••••') : '••••••••' }}
            </span>
            <button class="card-action-btn toggle" @click.stop="emit('togglePassword', item.id)" :title="visiblePasswords[item.id] ? '隐藏密码' : '显示密码'">
              <svg v-if="!visiblePasswords[item.id]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
            <button class="card-action-btn" @click.stop="emit('copyPassword', item.id)" title="复制密码">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
          <div v-if="item.notes" class="card-notes">
            <span class="card-notes-icon"></span>
            <span class="card-notes-text">{{ item.notes }}</span>
          </div>
          <div v-if="item.paths && item.paths.length > 0" class="card-paths" :ref="(el) => registerPathContainer(item.id, el as HTMLElement)">
            <a
              v-for="path in item.paths.slice(0, pathVisibleCount.get(item.id) ?? item.paths.length)"
              :key="path.id"
              class="card-path-link"
              @click.stop.prevent="emit('openUrl', item.url ? item.url.replace(/\/$/, '') + (path.path.startsWith('/') ? path.path : '/' + path.path) : path.path)"
              :title="path.label || path.path"
            >
              <span v-if="path.label" class="card-path-label">{{ path.label }}</span>
              <span class="card-path-path">{{ path.path }}</span>
            </a>
            <div v-if="(pathVisibleCount.get(item.id) ?? item.paths.length) < item.paths.length" class="card-paths-more" @click.stop>
              <span class="card-paths-count">+{{ item.paths.length - (pathVisibleCount.get(item.id) ?? item.paths.length) }}</span>
              <div class="card-paths-popover">
                <a
                  v-for="path in item.paths.slice(pathVisibleCount.get(item.id) ?? item.paths.length)"
                  :key="path.id"
                  class="card-paths-popover-item"
                  @click.stop.prevent="emit('openUrl', item.url ? item.url.replace(/\/$/, '') + (path.path.startsWith('/') ? path.path : '/' + path.path) : path.path)"
                >
                  <span v-if="path.label" class="card-path-label">{{ path.label }}</span>
                  <span class="card-path-path">{{ path.path }}</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg v-if="searchKeyword" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        <svg v-else width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无记录' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「新增条目」添加' }}</div>
    </div>
  </div>
</template>

<style scoped>
.content-inner { flex: 1; overflow-y: auto; padding: 20px; }

.toolbar { display: flex; gap: 8px; margin-bottom: 14px; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
.toolbar-actions { display: flex; gap: 8px; margin-left: auto; flex-shrink: 0; }

.search-box { flex: 1; max-width: 440px; min-width: 160px; }

.tabs { display: flex; flex-wrap: wrap; gap: 2px; margin-bottom: 14px; max-height: 36px; overflow: hidden; transition: max-height 0.2s ease; align-items: center; }
.tabs.expanded { max-height: 200px; }
.tab-count { display: inline-block; background: var(--hover); color: var(--text-muted); font-size: 10px; padding: 0 4px; border-radius: 3px; margin-left: 3px; font-weight: 600; line-height: 14px; }
.tab.active .tab-count { background: rgba(79,70,229,0.1); color: var(--accent); }
.tabs-toggle { display: flex; align-items: center; gap: 3px; padding: 3px 8px; font-size: 11px; font-weight: 500; color: var(--text-muted); background: transparent; border: 1px solid var(--border); border-radius: 4px; cursor: pointer; transition: all 0.12s; font-family: inherit; }
.tabs-toggle:hover { color: var(--text-secondary); border-color: var(--border-strong); background: var(--hover); }

.batch-bar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--accent-soft); border: 1px solid rgba(79,70,229,0.12); border-radius: var(--radius-sm); margin-bottom: 14px; }
.batch-info { font-size: 12px; color: var(--accent); font-weight: 600; }
.batch-actions { display: flex; gap: 6px; }
.batch-btn { padding: 5px 12px; border: 1px solid rgba(79,70,229,0.2); background: var(--panel-bg); border-radius: var(--radius-sm); font-size: 11px; color: var(--accent); cursor: pointer; transition: all 0.12s; font-family: inherit; font-weight: 500; }
.batch-btn:hover { background: var(--accent-soft); border-color: rgba(79,70,229,0.3); }
.batch-btn:active { transform: scale(0.95); }
.batch-btn.danger { color: var(--danger); border-color: rgba(239,68,68,0.2); }
.batch-btn.danger:hover { background: var(--danger-soft); border-color: rgba(239,68,68,0.3); }
.batch-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; margin-bottom: 14px; }

.entry-card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius); transition: all 0.15s ease; overflow: hidden; position: relative; box-shadow: var(--shadow-xs); }
.entry-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow); transform: translateY(-1px); }
.entry-card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); background: var(--accent-light); }

.card-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 12px 12px 8px; gap: 8px; border-bottom: 1px solid var(--border); }
.card-header-main { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; }
.card-header-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity 0.12s; }
.entry-card:hover .card-header-actions { opacity: 1; }

.card-avatar { width: 30px; height: 30px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: #fff; flex-shrink: 0; }
.card-avatar.c0 { background: #6366f1; }
.card-avatar.c1 { background: #8b5cf6; }
.card-avatar.c2 { background: #ec4899; }
.card-avatar.c3 { background: #f59e0b; }
.card-avatar.c4 { background: #10b981; }
.card-avatar.c5 { background: #06b6d4; }

.card-icon-btn { width: 22px; height: 22px; border: none; background: transparent; border-radius: 4px; cursor: pointer; font-size: 11px; display: flex; align-items: center; justify-content: center; transition: all 0.12s; color: var(--text-muted); }
.card-icon-btn:hover { background: var(--hover); color: var(--text-secondary); }
.card-icon-btn:active { transform: scale(0.9); }
.card-icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }

.card-title-area { flex: 1; min-width: 0; }
.card-title-row { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; }
.card-name { font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-category { font-size: 10px; color: var(--text-muted); background: var(--hover); padding: 1px 6px; border-radius: 3px; font-weight: 500; }
.card-url { font-size: 11px; color: var(--accent); text-decoration: none; cursor: pointer; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.card-url:hover { text-decoration: underline; }

.card-body { padding: 0 12px 12px; cursor: pointer; }
.card-info-row { display: flex; align-items: center; padding: 3px 0; gap: 5px; }
.card-info-row + .card-info-row { border-top: 1px solid var(--border); }
.card-info-label { font-size: 11px; color: var(--text-muted); width: 32px; flex-shrink: 0; }
.card-action-spacer { width: 20px; flex-shrink: 0; }
.card-info-value { font-size: 12px; color: var(--text); font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-info-value.masked { letter-spacing: 2px; color: var(--text-muted); }

.card-action-btn { width: 20px; height: 20px; padding: 0; border: none; background: transparent; border-radius: 4px; color: var(--text-muted); cursor: pointer; transition: all 0.12s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.card-action-btn:hover { background: var(--hover); color: var(--text-secondary); }
.card-action-btn:active { transform: scale(0.9); }
.card-action-btn.toggle { color: var(--accent); }
.card-action-btn.toggle:hover { background: var(--accent-soft); }

.card-notes { display: flex; align-items: flex-start; gap: 5px; margin-top: 3px; padding-top: 5px; border-top: 1px solid var(--border); }
.card-notes-icon::before { content: ''; display: block; width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); margin-top: 5px; flex-shrink: 0; }
.card-notes-text { font-size: 11px; color: var(--text-muted); line-height: 1.4; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

.card-paths { display: flex; align-items: center; gap: 4px; margin-top: 3px; padding-top: 5px; border-top: 1px solid var(--border); overflow: hidden; }
.card-path-link { display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 11px; color: var(--accent); background: var(--accent-soft); border-radius: 4px; cursor: pointer; text-decoration: none; transition: all 0.12s; }
.card-path-link:hover { background: var(--accent); color: #fff; }
.card-path-label { font-weight: 500; }
.card-path-path { font-family: monospace; opacity: 0.8; }
.card-paths-more { position: relative; display: inline-flex; }
.card-paths-count { display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-soft); border-radius: 4px; cursor: pointer; min-width: 20px; transition: all 0.12s; }
.card-paths-count:hover { background: var(--accent); color: #fff; }
.card-paths-popover { display: none; position: absolute; bottom: calc(100% + 4px); left: 0; z-index: 20; min-width: 160px; max-width: 280px; padding: 4px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-sm); box-shadow: var(--shadow); flex-direction: column; gap: 2px; }
.card-paths-more:hover .card-paths-popover { display: flex; }
.card-paths-popover-item { display: flex; align-items: center; gap: 4px; padding: 4px 8px; font-size: 11px; color: var(--accent); background: transparent; border-radius: 4px; cursor: pointer; text-decoration: none; transition: all 0.12s; white-space: nowrap; overflow: hidden; }
.card-paths-popover-item:hover { background: var(--accent-soft); }

.card-checkbox { position: absolute; top: 8px; left: 8px; z-index: 10; }
.checkbox { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 2px solid var(--border); border-radius: 3px; background: var(--panel-bg); font-size: 9px; font-weight: 600; color: var(--accent); cursor: pointer; transition: all 0.12s; }
.checkbox.checked { background: var(--accent); border-color: var(--accent); color: #fff; }

.empty-state { text-align: center; padding: 48px 20px; color: var(--text-muted); }
.empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 14px; background: var(--panel-bg); border: 1px solid var(--border); color: var(--text-muted); opacity: 0.4; margin-bottom: 14px; }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 3px; }
.empty-desc { font-size: 12px; color: var(--text-muted); }

.loading { padding: 16px 0; }
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.skeleton-card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; animation: skeleton-pulse 1.5s ease-in-out infinite; }
.skeleton-header { display: flex; gap: 8px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.skeleton-avatar { width: 30px; height: 30px; border-radius: 7px; background: var(--hover); flex-shrink: 0; }
.skeleton-title-area { flex: 1; display: flex; flex-direction: column; gap: 5px; }
.skeleton-line { height: 8px; background: var(--hover); border-radius: 4px; width: 100%; }
.skeleton-line.short { width: 55%; }
.skeleton-line.shorter { width: 35%; }
.skeleton-body { display: flex; flex-direction: column; gap: 6px; }
@keyframes skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
