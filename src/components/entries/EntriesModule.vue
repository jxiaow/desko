<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { Entry, Tab } from '../../types'
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

/* ── Ctrl/Cmd+K 聚焦搜索：与小记页同一条快捷键，各自只在本页挂载期间监听 ── */
const searchRef = ref<HTMLInputElement | null>(null)
const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const kbdHint = computed(() => (isMac ? '⌘K' : 'Ctrl K'))

const onGlobalKey = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
  }
}

/** 首字母块取词首两枚（LX/WQ 式），中文取前两字 */
const initials = (name: string) => {
  const words = name.trim().split(/[\s._\-/]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.trim().slice(0, 2).toUpperCase()
}

/** 分类名哈希到四组既有语义令牌，同分类恒定同色；不引入任何硬编码色值 */
const tileTone = (cat?: string | null) => {
  if (!cat) return 'tone-accent'
  let h = 0
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0
  return ['tone-accent', 'tone-warm', 'tone-cool', 'tone-neutral'][Math.abs(h) % 4] as string
}

/* ── 行内路径区按可用宽度截断，溢出的收进「+N」浮层 ── */
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

/** 一次只开一张行的动作菜单 */
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

/** 批量态下整行就是选择热区，非批量态才落到详情 */
const onRowClick = (item: Entry, isBatchMode: boolean) => {
  if (isBatchMode) emit('toggleSelect', item.id)
  else emit('openDetail', item)
}

/** 上下键只搬焦点：焦点落到哪一行，:focus-visible 的微环就长在哪一行上 */
const onListKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  const from = event.target instanceof HTMLElement ? event.target : null
  if (!from || from.closest('input, textarea, [contenteditable="true"]')) return
  const cards = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.entry-card'))
  const current = from.closest('.entry-card')
  const at = cards.indexOf(current as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  cards[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
}

const openPath = (entry: Entry, path: string) => {
  emit('openUrl', entry.url
    ? entry.url.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
    : path)
}

onMounted(() => { window.addEventListener('keydown', onGlobalKey) })
onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  if (pathObserver) pathObserver.disconnect()
})
</script>

<template>
  <div class="content-inner">
    <!-- 一块工具栏装下搜索、分类、计数和两个动作；分类超出宽度改为横向滚动 -->
    <div class="page-bar">
      <div class="search-box">
        <span class="search-icon">
          <AppIcon name="search" :size="15" />
        </span>
        <input ref="searchRef" :value="searchKeyword" placeholder="搜索名称或网址…" @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
        <kbd v-if="!searchKeyword" class="search-kbd">{{ kbdHint }}</kbd>
        <button v-if="searchKeyword" class="search-clear" @click="emit('update:searchKeyword', '')" title="清除搜索">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
      <nav class="tabs">
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
      </nav>
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

    <div v-if="loading" class="loading">
      <div class="skeleton-row" v-for="n in 8" :key="n">
        <div class="skeleton-avatar"></div>
        <div class="skeleton-id">
          <div class="skeleton-line name"></div>
          <div class="skeleton-line note"></div>
        </div>
        <div class="skeleton-line url"></div>
        <div class="skeleton-line tag"></div>
      </div>
    </div>
    <div v-else-if="filteredEntries.length" class="entry-list" @keydown="onListKeydown">
      <article
        v-for="item in filteredEntries"
        :key="item.id"
        class="entry-card"
        :class="{ selected: selectedIds.has(item.id), batching: isBatchMode }"
        tabindex="0"
        role="button"
        :aria-label="`条目：${item.name}`"
        @click="onRowClick(item, isBatchMode)"
        @keydown.enter.prevent="onRowClick(item, isBatchMode)"
      >
        <span v-if="isBatchMode" class="card-check" :class="{ checked: selectedIds.has(item.id) }" aria-hidden="true">
          <AppIcon v-if="selectedIds.has(item.id)" name="check" :size="11" />
        </span>

        <!-- 第一段：实体信息。渐变首字母块 + 标题/备注两行 -->
        <div class="ec-id">
          <span class="ec-tile" :class="tileTone(item.category)" aria-hidden="true">{{ initials(item.name) }}</span>
          <div class="ec-text">
            <span class="ec-name">{{ item.name }}</span>
            <span v-if="item.notes" class="ec-note" :title="item.notes">{{ item.notes }}</span>
          </div>
        </div>

        <!-- 第二段：目标地址。URL 等宽截断，路径药丸溢出时另起一行 -->
        <div class="ec-target">
          <a
            v-if="item.url"
            class="ec-domain"
            :title="item.url"
            @click.prevent.stop="emit('openUrl', item.url!)"
            @contextmenu.prevent="emit('copyText', item.url!, '网址')"
          >{{ formatUrlDisplay(item.url) }}</a>
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

        <!-- 第三段：分类与凭证标识 -->
        <div class="ec-tags">
          <span v-if="item.username || passwordCache[item.id]?.value" class="ec-cred" title="已存登录凭证">
            <AppIcon name="lock" :size="11" />
          </span>
          <span class="ec-cat">{{ item.category || '未分类' }}</span>
        </div>

        <!-- 高频四件套平时藏起，行被指针或键盘点亮时淡入；低频项仍在 ⋯ 里 -->
        <span class="ec-actions">
          <button v-if="item.url" class="ib ec-act" type="button" title="复制网址" @click.stop="emit('copyText', item.url!, '网址')">
            <AppIcon name="copy" :size="14" />
          </button>
          <button v-if="item.url" class="ib ec-act" type="button" title="在浏览器打开" @click.stop="emit('openUrl', item.url!)">
            <AppIcon name="external" :size="14" />
          </button>
          <button class="ib ec-act" type="button" title="编辑" @click.stop="emit('openEdit', item)">
            <AppIcon name="edit" :size="14" />
          </button>
          <button class="ib ec-act danger" type="button" title="删除" @click.stop="emit('delete', item)">
            <AppIcon name="trash" :size="14" />
          </button>
          <button
            class="ib ec-act ec-more"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            @click.stop="openMenu($event.currentTarget as HTMLElement, item)"
          >
            <AppIcon name="dots" :size="14" />
          </button>
        </span>

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
          @detail="closeMenu(); emit('openDetail', item)"
          @duplicate="closeMenu(); emit('duplicateEntry', item)"
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
/* 底部留 96px：批量底栏浮在它上面，不压住最后一行。
   顶部不留内边距：滚动容器带 padding-top 时 sticky 的 top:0 会贴在它下面，露出一条能看见内容的缝 */
.content-inner { flex: 1; overflow-y: auto; padding: 0 var(--space-4) 96px; }

/* 粘顶工具栏：搜索 + 分类 + 计数 + 动作排成一行，靠底色遮住滚动内容 */
.page-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg-app);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: calc(var(--space-5) + var(--space-1)) 0 var(--space-3);
}
.page-bar .search-box { flex: 0 1 300px; min-width: 140px; margin-right: var(--space-2); }
.search-kbd {
  flex-shrink: 0;
  margin-right: 2px;
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--sunken);
}

/* 分类在行内横向滚动，不换行：换行会把工具栏顶出第二种高度 */
.tabs {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.tabs::-webkit-scrollbar { display: none; }
.tab-count { display: inline-block; background: var(--hover); color: var(--text-muted); font-size: 10px; padding: 0 var(--space-1); border-radius: 4px; margin-left: var(--space-1); font-weight: 600; line-height: 14px; }
.tab.active .tab-count { background: var(--accent-soft); color: var(--accent); }

/* 单列行卡列表：行间 8px，每行是一张独立卡片，hover 才浮起；首行与吸顶栏拉开一点距离 */
.entry-list { display: flex; flex-direction: column; gap: 9px; padding-top: var(--space-2); }

.entry-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  padding: 13px 20px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  position: relative;
  transition: all var(--transition);
}
.entry-card:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}
.entry-card:focus-visible { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-ring); }
/* 选中态：浸润底吃掉整卡，1px 实环贴在边框外沿把"选中"包成一圈，
   左侧贴粗线的做法会在圆角处断开，整体感不够 */
.entry-card.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), var(--shadow);
  transform: translateY(-1px);
}
.entry-card.selected .ec-name { color: var(--text-brand); }
.entry-card.selected .ec-cat { color: var(--text-brand); background: var(--accent-light); border-color: var(--accent); }
.entry-card.selected .ec-cred { background: var(--accent-light); border-color: var(--accent); }

.card-check {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-on);
  flex-shrink: 0;
  transition: all var(--transition);
}
.card-check:hover { border-color: var(--accent); }
.card-check.checked { background: var(--accent); border-color: var(--accent); }

/* 第一段：实体信息。首字母块取两枚（LX/WQ 式），渐变底只吃 accent 族。
   不可伸缩：跨行列宽一致，URL 起点才在一条竖线上 */
.ec-id { display: flex; align-items: center; gap: 10px; flex: 0 0 290px; }
.ec-tile {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(135deg, var(--accent-soft), var(--accent-light));
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* 分类哈希分桶：四组都是既有语义令牌，主题切换自动跟色 */
.ec-tile.tone-warm { background: var(--warning-soft); color: var(--warning); }
.ec-tile.tone-cool { background: var(--success-soft); color: var(--success); }
.ec-tile.tone-neutral { background: var(--badge-cat-bg); color: var(--badge-cat-text); border-color: var(--badge-cat-border); }
.ec-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ec-name {
  font-size: 13.5px;
  /* 600 在 YaHei 上落到真 Bold，中文笔画会在深色底上糊连；500 取常规字重才清晰 */
  font-weight: 500;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
.ec-note {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 第二段：目标地址。URL 是 inline-block：空白区留在段容器里，点击仍归"行"。
   align-items 必须 flex-start：默认的 stretch 会把 <a> 拉满整段，行中心点击会误触 openUrl */
.ec-target { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; }
.ec-domain {
  display: inline-block;
  max-width: 100%;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-url);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition);
}
.ec-domain:hover { color: var(--accent); }

/* 第三段：分类与凭证标识，右靠齐。定宽让四段栅格跨行对齐 */
.ec-tags { flex: 0 0 180px; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.ec-cat {
  font-size: 11px;
  font-weight: 500;
  color: var(--badge-cat-text);
  background: var(--badge-cat-bg);
  border: 1px solid var(--badge-cat-border);
  padding: 1px 7px;
  border-radius: 99px;
  flex-shrink: 0;
  white-space: nowrap;
  transition: color var(--transition), background-color var(--transition), border-color var(--transition);
}

.ec-cred {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  color: var(--badge-ver-text);
  background: var(--badge-ver-bg);
  border: 1px solid var(--accent-soft);
  border-radius: 99px;
  flex-shrink: 0;
  transition: background-color var(--transition), border-color var(--transition);
}

/* 路径区在 URL 下方按可用宽度重新截断药丸；stretch 占满段宽，窄了才会出 +N */
.ec-paths { display: flex; align-items: center; gap: var(--space-1); align-self: stretch; min-width: 0; overflow: hidden; }
.card-path-link {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
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
  padding: 2px 8px;
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

/* 渐进披露：操作栏平时完全不可见，指针或键盘点亮该行才淡入 */
.ec-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  /* 五枚 28px 动作钮 + 间隙：定宽到能装下最满的一档，跨行右缘才对齐 */
  flex: 0 0 148px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition);
}
.entry-card:hover .ec-actions,
.entry-card:focus-within .ec-actions { opacity: 1; pointer-events: auto; }
html.hover-suppressed .entry-card:hover .ec-actions { opacity: 0; pointer-events: none; }
/* 批量态整行是选择热区，动作入口先让位 */
.entry-card.batching .ec-actions { display: none; }
.ib.ec-act { width: 28px; height: 28px; }
/* 删除是唯一的破坏性动作：hover 给红底红框的警戒反馈 */
.ib.ec-act.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--danger-border);
}

.pop-path-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pop-path-value {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-muted);
  margin-left: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state { text-align: center; padding: var(--space-12) var(--space-5); color: var(--text-muted); }
.empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: var(--radius-lg); background: var(--bg-surface); border: 1px solid var(--border); color: var(--text-muted); opacity: 0.4; margin-bottom: var(--space-4); }
.empty-icon svg { width: 24px; height: 24px; }
.empty-title { font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: var(--space-1); }
.empty-desc { font-size: 13px; color: var(--text-muted); }

/* 骨架屏与行卡同形：34px 首字母块 + 两行文字 + URL + Pill */
.loading { padding: var(--space-2) 0; }
.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 60px;
  padding: 13px 20px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.skeleton-avatar { width: 34px; height: 34px; border-radius: var(--radius); background: var(--hover); flex-shrink: 0; }
.skeleton-id { flex: 0 1 290px; min-width: 150px; display: flex; flex-direction: column; gap: 6px; }
.skeleton-line { height: 8px; background: var(--hover); border-radius: 4px; }
.skeleton-line.name { width: 120px; }
.skeleton-line.note { width: 84px; height: 6px; }
.skeleton-line.url { flex: 1; max-width: 320px; }
.skeleton-line.tag { width: 44px; flex-shrink: 0; margin-left: auto; }
@keyframes skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
