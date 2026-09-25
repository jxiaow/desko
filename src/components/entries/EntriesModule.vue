<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Entry, Tab } from '../../types'
import { formatUrlDisplay } from '../../utils/format'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import EntryActionMenu from './EntryActionMenu.vue'

const props = defineProps<{
  searchKeyword: string
  tabs: Tab[]
  activeTab: string
  loading: boolean
  /** 上一次加载的失败原因；非空时优先显示「加载失败 · 重试」而不是空态 */
  loadError?: string | null
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
  retryLoad: []
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

/** 模块色相身份：本页图块统一取 cat-1 色相，分类哈希只分浓淡三档，未分类走中性灰 */
const tileTone = (cat?: string | null) => {
  if (!cat) return 'tone-neutral'
  let h = 0
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) | 0
  return ['tone-1', 'tone-2', 'tone-3'][Math.abs(h) % 3] as string
}

/* ── 分类标签：全部 + 前 2 枚高频常驻，其余收进「更多」下拉（面板内可搜索） ── */
const visibleTabs = computed(() => props.tabs.slice(0, 3))
const hiddenTabs = computed(() => props.tabs.slice(3))
/** 选中的分类藏在「更多」里时，触发器要顶出激活态 */
const activeHiddenTab = computed(() =>
  hiddenTabs.value.find(t => t.id === props.activeTab) ?? null)
const moreOpen = ref(false)
const moreAnchor = ref<HTMLElement | null>(null)
const tabQuery = ref('')
const filteredHidden = computed(() => {
  const q = tabQuery.value.trim().toLowerCase()
  if (!q) return hiddenTabs.value
  return hiddenTabs.value.filter(t => t.name.toLowerCase().includes(q))
})

const toggleMore = (el: HTMLElement) => {
  if (moreOpen.value) { moreOpen.value = false; return }
  moreAnchor.value = el
  tabQuery.value = ''
  moreOpen.value = true
}

const pickTab = (id: string) => {
  emit('update:activeTab', id)
  moreOpen.value = false
}

/* ── 分类滑轨：一枚浮白滑块跟住当前分类，切换是"滑过去"不是"跳过去"。
   与 type-seg 分段凹槽同一套语言；「更多」顶出激活态时滑块也滑到触发钮上。 ── */
const tabsRef = ref<HTMLElement | null>(null)
const thumb = ref({ left: 0, width: 0, show: false })
const thumbStyle = computed(() =>
  thumb.value.show
    ? { left: `${thumb.value.left}px`, width: `${thumb.value.width}px`, opacity: '1' }
    : { opacity: '0' })
const syncThumb = () => {
  const nav = tabsRef.value
  const el = nav?.querySelector('.tab.active') as HTMLElement | null
  if (!nav || !el) { thumb.value = { ...thumb.value, show: false }; return }
  thumb.value = { left: el.offsetLeft, width: el.offsetWidth, show: true }
}
watch(
  () => [props.activeTab, props.tabs, visibleTabs.value.length] as const,
  () => { nextTick(syncThumb) }
)
onMounted(() => {
  nextTick(syncThumb)
  window.addEventListener('resize', syncThumb)
})

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
/* ── 复制 morph：钮面图标短暂翻成对勾做回执，toast 仍由父层统一弹 ── */
const copiedId = ref<string | null>(null)
let copiedTimer: number | undefined
const copyUrl = (item: Entry) => {
  emit('copyText', item.url!, '网址')
  copiedId.value = item.id
  if (copiedTimer) window.clearTimeout(copiedTimer)
  copiedTimer = window.setTimeout(() => { copiedId.value = null }, 1200)
}

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('resize', syncThumb)
  if (copiedTimer) window.clearTimeout(copiedTimer)
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
      <nav ref="tabsRef" class="tabs">
        <span class="tab-thumb" :style="thumbStyle" aria-hidden="true"></span>
        <div
          v-for="t in visibleTabs"
          :key="t.id"
          class="tab"
          :class="{ active: activeTab === t.id }"
          @click="pickTab(t.id)"
        >
          {{ t.name }}
          <span class="tab-count">{{ t.count }}</span>
        </div>
        <button
          v-if="hiddenTabs.length"
          class="tab tab-more"
          :class="{ active: !!activeHiddenTab }"
          type="button"
          @click="toggleMore($event.currentTarget as HTMLElement)"
        >{{ activeHiddenTab ? activeHiddenTab.name : '更多' }} ({{ hiddenTabs.length }}) ▾</button>
      </nav>
      <PopoverMenu v-if="moreOpen && moreAnchor" :anchor="moreAnchor" align="start" @close="moreOpen = false">
        <div class="tab-pop">
          <div class="tab-pop-search">
            <AppIcon name="search" :size="13" />
            <input v-model="tabQuery" placeholder="搜索分类…" />
          </div>
          <div class="tab-pop-list">
            <button
              v-for="t in filteredHidden"
              :key="t.id"
              class="pop-item"
              :class="{ on: activeTab === t.id }"
              type="button"
              @click="pickTab(t.id)"
            >
              {{ t.name }}
              <span class="tab-count">{{ t.count }}</span>
            </button>
            <div v-if="!filteredHidden.length" class="tab-pop-empty">无匹配分类</div>
          </div>
        </div>
      </PopoverMenu>
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
        <div class="skeleton-block"></div>
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
          <AppIcon v-if="selectedIds.has(item.id)" name="check" :size="12" />
        </span>

        <!-- 第一段：实体信息靠左聚拢成两行——名字一行，域名/路径/备注并进 meta 行，
             中间空白被主列吃掉；定宽五栏对齐作废（大方化轮） -->
        <div class="ec-id">
          <span class="ec-tile" :class="tileTone(item.category)" aria-hidden="true">{{ initials(item.name) }}</span>
          <div class="ec-text">
            <span class="ec-name">{{ item.name }}</span>
            <div class="ec-meta">
              <a
                v-if="item.url"
                class="ec-domain"
                :title="item.url"
                @click.prevent.stop="emit('openUrl', item.url!)"
                @contextmenu.prevent="emit('copyText', item.url!, '网址')"
              >{{ formatUrlDisplay(item.url) }}</a>
              <template v-if="item.paths && item.paths.length">
                <span v-if="item.url" class="meta-dot" aria-hidden="true">·</span>
                <a
                  class="ec-path"
                  :title="item.paths[0].label || item.paths[0].path"
                  @click.stop.prevent="openPath(item, item.paths[0].path)"
                >{{ item.paths[0].label || item.paths[0].path }}</a>
                <button
                  v-if="item.paths.length > 1"
                  class="card-paths-more"
                  type="button"
                  :title="`还有 ${item.paths.length - 1} 个路径`"
                  @click.stop="openPathsMenu($event.currentTarget as HTMLElement, item)"
                >+{{ item.paths.length - 1 }} 路径</button>
              </template>
              <template v-if="item.notes">
                <span v-if="item.url || (item.paths && item.paths.length)" class="meta-dot" aria-hidden="true">·</span>
                <span class="ec-note" :title="item.notes">{{ item.notes }}</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 第二段：分类与凭证标识 -->
        <div class="ec-tags">
          <span v-if="item.username || passwordCache[item.id]?.value" class="ec-cred" title="已存登录凭证">
            <AppIcon name="lock" :size="12" />
          </span>
          <span class="ec-cat">{{ item.category || '未分类' }}</span>
        </div>

        <!-- 常驻只留两枚高频钮；编辑/详情/复制/删除收进 ⋯ 菜单 -->
        <span class="ec-actions">
          <button v-if="item.url" class="ib ec-act" :class="{ copied: copiedId === item.id }" type="button" :title="copiedId === item.id ? '已复制' : '复制网址'" @click.stop="copyUrl(item)">
            <AppIcon :name="copiedId === item.id ? 'check' : 'copy'" :size="16" />
          </button>
          <button v-if="item.url" class="ib ec-act" type="button" title="在浏览器打开" @click.stop="emit('openUrl', item.url!)">
            <AppIcon name="external" :size="16" />
          </button>
          <button
            class="ib ec-act ec-more"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            @click.stop="openMenu($event.currentTarget as HTMLElement, item)"
          >
            <AppIcon name="dots" :size="16" />
          </button>
        </span>

        <PopoverMenu
          v-if="pathsEntry?.id === item.id && pathsAnchor"
          :anchor="pathsAnchor"
          align="start"
          @close="closePathsMenu"
        >
          <div class="pop-sec path-pop">
            <div class="pop-label">路径 · {{ item.paths?.length ?? 0 }}</div>
            <div v-for="path in item.paths ?? []" :key="path.id" class="path-pop-row">
              <button class="pop-item" type="button" :title="path.path" @click="closePathsMenu(); openPath(item, path.path)">
                <AppIcon name="external" :size="13" />
                <span class="pop-path-label">{{ path.label || path.path }}</span>
              </button>
              <button class="ib path-pop-copy" type="button" title="复制此路径" @click.stop="emit('copyText', path.path, '路径')">
                <AppIcon name="copy" :size="12" />
              </button>
            </div>
          </div>
        </PopoverMenu>

        <EntryActionMenu
          v-if="menuEntry?.id === item.id"
          :anchor="menuAnchor"
          @detail="closeMenu(); emit('openDetail', item)"
          @edit="closeMenu(); emit('openEdit', item)"
          @duplicate="closeMenu(); emit('duplicateEntry', item)"
          @delete="closeMenu(); emit('delete', item)"
          @close="closeMenu"
        />
      </article>
    </div>
    <div v-else-if="loadError" class="error-state">
      <div class="empty-icon">
        <AppIcon name="alert" :size="24" />
      </div>
      <div class="empty-title">加载失败</div>
      <div class="empty-desc">{{ loadError }}</div>
      <button class="btn-secondary retry-btn" @click="emit('retryLoad')">重试</button>
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
/* .content-inner / .page-bar / 搜索框 / 主按钮 / 骨架行形全部走 global.css 的页面骨架，
   此处只留本页特有的东西 */

/* 分类在行内横向滚动，不换行：换行会把工具栏顶出第二种高度 */
.tabs {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.tabs::-webkit-scrollbar { display: none; }
.tabs .tab { position: relative; z-index: 1; height: 34px; display: inline-flex; align-items: center; padding: 0 12px; font-size: var(--text-sm); border-radius: var(--radius-tag); }
/* 滑块：浮白块压在字下，切换时沿弹簧曲线滑到位；激活 tab 自身让出底色，只留字色/字重 */
.tab-thumb {
  position: absolute;
  top: 2px;
  left: 0;
  height: 34px;
  border-radius: var(--radius-tag);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
  opacity: 0;
  pointer-events: none;
  transition: left var(--transition-spring), width var(--transition-spring), opacity var(--transition);
}
.tabs .tab.active { background: transparent; box-shadow: none; }
.tab-more { font-family: inherit; font-size: var(--text-sm); }
.tab-count { display: inline-block; background: var(--hover); color: var(--text-muted); font-size: var(--text-xs); padding: 0 var(--space-1); border-radius: 4px; margin-left: var(--space-1); font-weight: 600; line-height: 14px; }
.tab.active .tab-count { background: var(--accent-soft); color: var(--accent); }

/* 「更多」下拉：224px 面板，内置分类搜索，列表最高 192px 再滚动 */
.tab-pop { width: 224px; display: flex; flex-direction: column; gap: var(--space-1); }
.tab-pop-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  color: var(--text-muted);
  background: var(--bg-mono-chip);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-tag);
}
.tab-pop-search input {
  flex: 1;
  min-width: 0;
  border: none;
  background: none;
  padding: 0;
  outline: none;
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text);
}
.tab-pop-list { max-height: 192px; overflow-y: auto; scrollbar-width: thin; }
.tab-pop-list .pop-item.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.tab-pop-empty { padding: var(--space-2) 8px; font-size: var(--text-sm); color: var(--text-faint); text-align: center; }

/* 单列行卡列表：行间 10px，每行是一张独立卡片，hover 才浮起；首行与吸顶栏拉开一点距离 */
.entry-list { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-2); }

.entry-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 64px;
  padding: 0 var(--space-4);
  background: var(--bg-surface);
  /* 发丝线退役：灰底浮白卡靠 --shadow-card 分层，
     border 留透明位给 focus/selected 的描边通路 */
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  position: relative;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}
.entry-card:hover {
  border-color: var(--border-card-hover);
  box-shadow: var(--shadow-card-hover);
}
.entry-card:focus-visible { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-ring); }
/* 选中态：浸润底吃掉整卡，1px 实环贴在边框外沿把"选中"包成一圈，
   左侧贴粗线的做法会在圆角处断开，整体感不够 */
.entry-card.selected {
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), var(--shadow);
}
.entry-card.selected .ec-name { color: var(--text-brand); }
.entry-card.selected .ec-cat { color: var(--text-brand); background: var(--accent-light); border-color: var(--accent); }
.entry-card.selected .ec-cred { background: var(--accent-light); border-color: var(--accent); }

.card-check {
  width: 18px;
  height: 18px;
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

/* 第一段：实体信息靠左聚拢。图标块 + 两行文本（名 / meta），
   主列 flex:1 吃掉原先悬在行中间的 URL/路径空白 */
.ec-id { display: flex; align-items: center; gap: 14px; flex: 1 1 auto; min-width: 0; }
.ec-tile {
  --h: var(--cat-1);
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: var(--radius-badge);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* 同页一色、分类分浓淡：色相钉 cat-1 槽，切主题跟各主题的槽走 */
.ec-tile.tone-1 { background: color-mix(in srgb, var(--h) 8%, var(--panel-bg)); color: var(--h); border-color: color-mix(in srgb, var(--h) 16%, var(--panel-bg)); }
.ec-tile.tone-2 { background: color-mix(in srgb, var(--h) 15%, var(--panel-bg)); color: var(--h); border-color: color-mix(in srgb, var(--h) 28%, var(--panel-bg)); }
.ec-tile.tone-3 { background: color-mix(in srgb, var(--h) 26%, var(--panel-bg)); color: var(--h); border-color: color-mix(in srgb, var(--h) 42%, var(--panel-bg)); }
.ec-tile.tone-neutral { background: var(--badge-cat-bg); color: var(--badge-cat-text); border-color: var(--badge-cat-border); }
.ec-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ec-name {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
/* meta 行：域名 · 路径 · 备注，一行读完，按宽度依次截断 */
.ec-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
}
.meta-dot { color: var(--text-faint); opacity: 0.6; flex-shrink: 0; }
.ec-note {
  font-size: var(--text-sm);
  color: var(--text-faint);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ec-domain {
  /* 按内容收缩：拉满会把行卡中心点的点击吃掉（anchor 上挂 stop 的开链动作） */
  flex: 0 1 auto;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-url);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition);
}
.ec-domain:hover { color: var(--accent); }

/* 分类与凭证标识，右靠齐 */
.ec-tags { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.ec-cat {
  display: inline-flex;
  align-items: center;
  height: 24px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--badge-cat-text);
  background: var(--bg-tag-default);
  border: 1px solid var(--badge-cat-border);
  padding: 0 10px;
  border-radius: var(--radius-tag);
  flex-shrink: 0;
  white-space: nowrap;
  transition: color var(--transition), background-color var(--transition), border-color var(--transition);
}

.ec-cred {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 7px;
  color: var(--badge-ver-text);
  background: var(--badge-ver-bg);
  border: 1px solid var(--accent-soft);
  border-radius: var(--radius-pill);
  flex-shrink: 0;
  transition: background-color var(--transition), border-color var(--transition);
}

/* meta 行里的路径：纯文本链接，不再是胶囊 */
.ec-path {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition);
}
.ec-path:hover { color: var(--accent); }
.card-paths-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 500;
  font-family: inherit;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  white-space: nowrap;
  transition: color var(--transition);
}
.card-paths-more:hover, .card-paths-more[aria-expanded] { color: var(--accent-hover); text-decoration: underline; }

/* 渐进披露：动作钮平时以五成透明常驻（位置稳定、可点），行被点亮才升到全不透明 */
.ec-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  /* 三枚钮共 98px：定宽让跨行右缘对齐 */
  flex: 0 0 98px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.entry-card:hover .ec-actions,
.entry-card:focus-within .ec-actions { opacity: 1; }
/* 批量态整行是选择热区，动作入口先让位 */
.entry-card.batching .ec-actions { display: none; }
.ib.ec-act { width: 30px; height: 30px; flex-shrink: 0; }
/* 复制回执态：对勾 + 成功色，1.2s 后转回 */
.ib.ec-act.copied { color: var(--success); }

/* 路径浮层：208px，每行「跳转钮 + 复制钮」成对 */
.path-pop { width: 208px; }
.path-pop-row { display: flex; align-items: center; gap: 2px; }
.path-pop-row .pop-item { flex: 1; min-width: 0; }
.path-pop-copy { width: 24px; height: 24px; flex-shrink: 0; color: var(--text-muted); }
.path-pop-copy:hover { color: var(--accent); }

.pop-path-label { flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.4; }

/* .empty-state/.empty-icon/.empty-title/.empty-desc 走 global.css 的统一规范，
   此处不再重复声明，避免局部副本和全局定义漂移 */

/* 骨架屏行形/方块/呼吸在 global.css，此处只留本行的宽度分配 */
.loading { padding: var(--space-2) 0; }
.skeleton-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.skeleton-line.name { width: 140px; }
.skeleton-line.note { width: 220px; height: 6px; }
.skeleton-line.url { display: none; }
.skeleton-line.tag { width: 52px; margin-left: auto; }
</style>
