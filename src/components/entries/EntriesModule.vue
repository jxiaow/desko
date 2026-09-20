<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { Entry, Tab } from '../../types'
import { avatarClass } from '../../utils/avatar'
import { formatUrlDisplay } from '../../utils/format'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import EntryActionMenu from './EntryActionMenu.vue'

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
  duplicateEntry: [entry: Entry]
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

  const links = (Array.from(container.children) as HTMLElement[])
    .filter(c => c.classList.contains('card-path-link'))
  const moreEl = (Array.from(container.children) as HTMLElement[])
    .find(c => c.classList.contains('card-paths-more'))
  if (!links.length) return

  const width = container.clientWidth
  const moreWidth = moreEl?.offsetWidth ?? 40
  const gap = 4
  let used = 0
  let count = 0
  for (let i = 0; i < links.length; i++) {
    const w = links[i].offsetWidth + (i ? gap : 0)
    // 只有还会剩下未显示项时才预留 +N 的位置，最后一枚不需要
    const reserve = i < links.length - 1 ? moreWidth + gap : 0
    if (used + w + reserve > width) break
    used += w
    count++
  }
  // 一枚都不留比截断更糟：整行只剩个 "+N"，看不出这里有什么可点
  if (count === 0) count = 1

  const oldCount = pathVisibleCount.value.get(entryId)
  if (oldCount !== count) pathVisibleCount.value.set(entryId, count)
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

/** 一次只开一张卡片的动作菜单 */
const menuAnchor = ref<HTMLElement | null>(null)
const menuEntry = ref<Entry | null>(null)

const openMenu = (el: HTMLElement, item: Entry) => {
  if (menuEntry.value?.id === item.id) {
    menuAnchor.value = null
    menuEntry.value = null
    return
  }
  menuAnchor.value = el
  menuEntry.value = item
}

const closeMenu = () => {
  menuAnchor.value = null
  menuEntry.value = null
}

/** 路径溢出的「+N」浮层：点击开合，条目可跳转（hover 浮层跨不过间隙，点不到就消失） */
const pathsAnchor = ref<HTMLElement | null>(null)
const pathsEntry = ref<Entry | null>(null)

const openPathsMenu = (el: HTMLElement, item: Entry) => {
  if (pathsEntry.value?.id === item.id) {
    pathsAnchor.value = null
    pathsEntry.value = null
    return
  }
  pathsAnchor.value = el
  pathsEntry.value = item
}

const closePathsMenu = () => {
  pathsAnchor.value = null
  pathsEntry.value = null
}

/** 批量态下整张卡就是选择热区，非批量态才落到详情 */
const onCardClick = (item: Entry, isBatchMode: boolean) => {
  if (isBatchMode) emit('toggleSelect', item.id)
  else emit('openDetail', item)
}

const openPath = (entry: Entry, path: string) => {
  emit('openUrl', entry.url
    ? entry.url.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
    : path)
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
    <div class="page-bar">
      <div class="search-box">
        <span class="search-icon">
          <AppIcon name="search" :size="15" />
        </span>
        <input :value="searchKeyword" placeholder="搜索名称或网址…" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <span class="bar-count">{{ filteredEntries.length }} / {{ tabs.find(t => t.id === 'all')?.count ?? 0 }}</span>
      <button
        class="bar-btn"
        :class="{ active: isBatchMode }"
        :title="isBatchMode ? '退出批量' : '批量选择'"
        @click="emit('toggleBatchMode')"
      >
        <AppIcon name="checkall" :size="14" />
      </button>
      <button class="btn-primary" @click="emit('openAdd')">
        <AppIcon name="plus" :size="14" />
        新增条目
      </button>
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
      <article
        v-for="item in filteredEntries"
        :key="item.id"
        class="entry-card"
        :class="{ selected: selectedIds.has(item.id), batching: isBatchMode }"
        tabindex="0"
        role="button"
        :aria-label="`条目：${item.name}`"
        @click="onCardClick(item, isBatchMode)"
        @keydown.enter.prevent="onCardClick(item, isBatchMode)"
      >
        <span v-if="isBatchMode" class="card-check" :class="{ checked: selectedIds.has(item.id) }" aria-hidden="true">
          <AppIcon v-if="selectedIds.has(item.id)" name="check" :size="11" />
        </span>

        <div class="ec-top">
          <div class="card-avatar" :class="avatarClass(item.category)">{{ item.name.charAt(0) }}</div>
          <div class="ec-id">
            <div class="ec-name-row">
              <span class="ec-name">{{ item.name }}</span>
              <span class="ec-cat">{{ item.category || '未分类' }}</span>
            </div>
            <a
              v-if="item.url"
              class="ec-domain"
              :title="item.url"
              @click.prevent.stop="emit('openUrl', item.url!)"
              @contextmenu.prevent="emit('copyText', item.url!, '网址')"
            >{{ formatUrlDisplay(item.url) }}</a>
          </div>
          <button
            class="ib ec-more"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            @click.stop="openMenu($event.currentTarget as HTMLElement, item)"
          >
            <AppIcon name="dots" :size="14" />
          </button>
        </div>

        <p v-if="item.notes" class="ec-note" :title="item.notes">{{ item.notes }}</p>

        <!-- 底栏整条留给多路径快捷访问，分类不占这里。没有路径也占一行，网格才只有一种卡高 -->
        <div class="ec-foot">
          <span v-if="item.username || passwordCache[item.id]?.value" class="ec-cred" title="已存登录凭证">
            <AppIcon name="lock" :size="11" />
            凭证
          </span>
          <div
            v-if="item.paths && item.paths.length"
            class="ec-paths"
            :ref="(el) => registerPathContainer(item.id, el as HTMLElement)"
          >
            <a
              v-for="path in item.paths.slice(0, pathVisibleCount.get(item.id) ?? item.paths.length)"
              :key="path.id"
              class="card-path-link"
              :title="path.label || path.path"
              @click.stop.prevent="openPath(item, path.path)"
            >{{ path.label || path.path }}</a>
            <button
              v-if="(pathVisibleCount.get(item.id) ?? item.paths.length) < item.paths.length"
              class="card-paths-more"
              type="button"
              :title="`还有 ${item.paths.length - (pathVisibleCount.get(item.id) ?? item.paths.length)} 个路径`"
              @click.stop="openPathsMenu($event.currentTarget as HTMLElement, item)"
            >+{{ item.paths.length - (pathVisibleCount.get(item.id) ?? item.paths.length) }}</button>
          </div>
        </div>

        <PopoverMenu
          v-if="pathsEntry?.id === item.id && pathsAnchor"
          :anchor="pathsAnchor"
          align="start"
          wide
          @close="closePathsMenu"
        >
          <div class="pop-sec">
            <div class="pop-label">路径 · {{ item.paths?.length ?? 0 }}</div>
            <button
              v-for="path in item.paths ?? []"
              :key="path.id"
              class="pop-item"
              type="button"
              @click="closePathsMenu(); openPath(item, path.path)"
            >
              <AppIcon name="external" :size="13" />
              <span class="pop-path-label">{{ path.label || path.path }}</span>
              <span v-if="path.label" class="pop-path-value">{{ path.path }}</span>
            </button>
          </div>
        </PopoverMenu>

        <EntryActionMenu
          v-if="menuEntry?.id === item.id"
          :anchor="menuAnchor"
          :entry="item"
          @detail="closeMenu(); emit('openDetail', item)"
          @edit="closeMenu(); emit('openEdit', item)"
          @duplicate="closeMenu(); emit('duplicateEntry', item)"
          @open-url="closeMenu(); emit('openUrl', $event)"
          @delete="closeMenu(); emit('delete', item)"
          @close="closeMenu"
        />
      </article>
    </div>
    <div v-else class="empty-state">
      <div class="empty-icon">
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'folder'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无记录' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击「新增条目」添加' }}</div>
    </div>

    <div v-if="isBatchMode" class="batch-dock">
      <span class="dock-count">已选 {{ selectedIds.size }} 项</span>
      <button class="dock-btn" type="button" @click="emit('selectAll')">
        <AppIcon name="checkall" :size="12" />全选
      </button>
      <button class="dock-btn" type="button" :disabled="!selectedIds.size" @click="emit('deselectAll')">
        <AppIcon name="x" :size="12" />取消全选
      </button>
      <span class="dock-sep"></span>
      <button class="dock-btn danger" type="button" :disabled="!selectedIds.size" @click="emit('batchDelete')">
        <AppIcon name="trash" :size="12" />删除选中
      </button>
      <button class="dock-btn" type="button" @click="emit('toggleBatchMode')">
        <AppIcon name="check" :size="12" />完成
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 底部留 96px：批量底栏浮在它上面，不压住最后一行卡片。
   顶部不留内边距：滚动容器带 padding-top 时 sticky 的 top:0 会贴在它下面，露出一条能看见内容的缝 */
.content-inner { flex: 1; overflow-y: auto; padding: 0 var(--space-5) 96px; }

/* 与小记页同一条工具条：粘顶、无分隔线，靠底色遮住滚动内容 */
.page-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: calc(var(--space-5) + var(--space-1)) 0 var(--space-3);
}
.page-bar .search-box { flex: 1; min-width: 80px; max-width: 440px; }

.tabs { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-bottom: var(--space-4); max-height: 36px; overflow: hidden; transition: max-height var(--transition-slow); align-items: center; }
.tabs.expanded { max-height: 200px; }
.tab-count { display: inline-block; background: var(--hover); color: var(--text-muted); font-size: 10px; padding: 0 var(--space-1); border-radius: 4px; margin-left: var(--space-1); font-weight: 600; line-height: 14px; }
.tab.active .tab-count { background: var(--accent-soft); color: var(--accent); }
.tabs-toggle { display: flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-2); font-size: 11px; font-weight: 500; color: var(--text-muted); background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; transition: all var(--transition); font-family: inherit; }
.tabs-toggle:hover { color: var(--text-secondary); border-color: var(--border-strong); background: var(--hover); }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-3); }

.entry-card {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-xs);
  transition: all var(--transition);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
}
.entry-card:hover { border-color: var(--border-strong); box-shadow: var(--shadow); transform: translateY(-2px); }
.entry-card:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.entry-card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-ring); background: var(--accent-soft); }
/* 批量态整张卡变成选择热区，动作入口先让位 */
.entry-card.batching { padding-left: calc(var(--space-8) + var(--space-3)); }
.entry-card.batching .ec-more { display: none; }

.card-check {
  position: absolute;
  left: var(--space-3);
  top: var(--space-4);
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  background: var(--panel-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-on);
  transition: all var(--transition);
}
.card-check:hover { border-color: var(--accent); }
.card-check.checked { background: var(--accent); border-color: var(--accent); }

.ec-top { display: flex; align-items: center; gap: var(--space-3); }
.card-avatar { width: 36px; height: 36px; border-radius: 9px; font-size: 14px; }
.ec-id { flex: 1; min-width: 0; }
.ec-name-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ec-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.35;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ec-cat { font-size: 11px; font-weight: 500; color: var(--text-muted); background: var(--fill); padding: 1px 7px; border-radius: 99px; flex-shrink: 0; }
.ec-domain {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.ec-domain:hover { color: var(--accent); }
/* 动作收进一个 ⋯：四个并排的 hover 按钮把卡片顶成一排工具 */
.ec-more { opacity: 0; pointer-events: none; transition: opacity var(--transition); flex-shrink: 0; }
.entry-card:hover .ec-more, .entry-card:focus-within .ec-more { opacity: 1; pointer-events: auto; }
html.hover-suppressed .entry-card:hover .ec-more { opacity: 0; pointer-events: none; }

/* 备注只占一行：两行会让同一网格出现两种卡高，空白从中间挪到卡片末尾 */
.ec-note {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 不换行：路径药丸本来就按可用宽度截断，换行会把卡片顶出第二种高度 */
.ec-foot { display: flex; align-items: center; gap: var(--space-2); margin-top: auto; min-width: 0; min-height: 23px; }
.ec-cred {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 var(--space-2);
  border-radius: 99px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  flex-shrink: 0;
}
/* 弹性项是路径区本身，不是占位符：否则容器被挤到几十像素，药丸全塌成 +N */
.ec-paths { display: flex; align-items: center; gap: var(--space-1); flex: 1; min-width: 0; overflow: hidden; }
.card-path-link {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-soft);
  border-radius: 6px;
  cursor: pointer;
  text-decoration: none;
  transition: all var(--transition);
  white-space: nowrap;
  flex-shrink: 0;
}
.card-path-link:hover { background: var(--accent); color: var(--accent-on); }
.card-paths-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  font-size: 11.5px;
  font-weight: 600;
  font-family: inherit;
  color: var(--accent);
  background: var(--accent-soft);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition);
}
.card-paths-more:hover, .card-paths-more[aria-expanded] { background: var(--accent); color: var(--accent-on); }

.pop-path-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pop-path-value {
  font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace;
  font-size: 11.5px;
  color: var(--text-muted);
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state { text-align: center; padding: var(--space-12) var(--space-5); color: var(--text-muted); }
.empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: var(--radius-lg); background: var(--panel-bg); border: 1px solid var(--border); color: var(--text-muted); opacity: 0.4; margin-bottom: var(--space-4); }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: var(--space-1); }
.empty-desc { font-size: 13px; color: var(--text-muted); }

.loading { padding: var(--space-4) 0; }
.skeleton-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-3); }
.skeleton-card { background: var(--panel-bg); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-3); animation: skeleton-pulse 1.5s ease-in-out infinite; }
.skeleton-header { display: flex; gap: var(--space-3); margin-bottom: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--border); }
.skeleton-avatar { width: 36px; height: 36px; border-radius: 9px; background: var(--hover); flex-shrink: 0; }
.skeleton-title-area { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); }
.skeleton-line { height: 8px; background: var(--hover); border-radius: 4px; width: 100%; }
.skeleton-line.short { width: 55%; }
.skeleton-line.shorter { width: 35%; }
.skeleton-body { display: flex; flex-direction: column; gap: var(--space-2); }
@keyframes skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
