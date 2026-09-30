<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Entry, Tab } from '../../types'
import { splitUrlHostPath } from '../../utils/format'
import { joinEntryUrl } from '../../utils/urlPath'
import { faviconSrcFor } from '../../services/favicon'
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
  hasSelection: boolean
  selectedIds: Set<string>
  visiblePasswords: Record<string, boolean>
  passwordCache: Record<string, { value: string; ts: number }>
}>()

const emit = defineEmits<{
  'update:searchKeyword': [value: string]
  'update:activeTab': [value: string]
  openAdd: []
  togglePick: []
  exitBatch: []
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

/** 行首 24px 档：中性字母块（favicon 抓取失败/未到货时的兜底面），
    色彩留给图标本身，字母块只吃字色淡染 */
const favLetter = (cat?: string | null) => {
  const c = (cat || '').trim()
  return c ? c[0].toUpperCase() : '#'
}
/** 行首档面：host 命中缓存/抓取到货后返回图标 URL，否则 null 走字母块 */
const favOf = (item: Entry) => faviconSrcFor(item.url)

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
  emit('openUrl', joinEntryUrl(entry.url, path))
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
        type="button"
        :title="isBatchMode ? '退出选择' : '选择条目'"
        :aria-label="isBatchMode ? '退出选择' : '选择条目'"
        @click="emit('togglePick')"
      >
        <AppIcon name="checkall" :size="16" />
      </button>
      <button class="btn-primary" @click="emit('openAdd')">
        <AppIcon name="plus" :size="14" />
        新增条目
      </button>
    </div>

    <div v-if="loading" class="loading rowlist">
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
    <div v-else-if="filteredEntries.length" class="entry-list rowlist" @keydown="onListKeydown">
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
        @keydown.space.prevent="onRowClick(item, isBatchMode)"
      >
        <span class="card-check" :class="{ checked: selectedIds.has(item.id) }" aria-hidden="true"
          @click.stop="emit('toggleSelect', item.id)">
          <AppIcon v-if="selectedIds.has(item.id)" name="check" :size="12" />
        </span>

        <!-- inset 行：行首 24px 档垂直居中（favicon 到货前/抓不到落字母块），
             右侧两行——名+凭证 / 主机+路径+备注；分类定住行尾，hover 让位给动作钮列 -->
        <span class="ec-fav" :class="{ 'ec-fav--icon': !!favOf(item) }" aria-hidden="true">
          <img v-if="favOf(item)" :src="favOf(item)!" alt="" />
          <template v-else>{{ favLetter(item.category) }}</template>
        </span>
        <div class="ec-id">
          <div class="ec-text">
            <div class="ec-name-row">
              <span class="ec-name">{{ item.name }}</span>
              <span v-if="item.username || passwordCache[item.id]?.value" class="ec-cred" title="已存登录凭证">
                <AppIcon name="lock" :size="12" />
              </span>
              <span class="ec-cat">{{ item.category || '未分类' }}</span>
            </div>
            <div class="ec-meta">
              <a
                v-if="item.url"
                class="ec-domain"
                :title="item.url"
                @click.prevent.stop="emit('openUrl', item.url!)"
                @contextmenu.prevent="emit('copyText', item.url!, '网址')"
              ><span class="u-host">{{ splitUrlHostPath(item.url).host }}</span><span v-if="splitUrlHostPath(item.url).path"
                class="u-path">{{ splitUrlHostPath(item.url).path }}</span></a>
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
      <div v-if="!searchKeyword" class="empty-motto" aria-hidden="true">
        <span class="d"></span><span class="w">收一处 · 启一窗</span><span class="d mid"></span><span class="w">开一页</span><span class="d"></span>
      </div>
    </div>

    <div v-if="hasSelection" class="batch-dock">
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
      <button class="dock-btn" type="button" @click="emit('exitBatch')">
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
.tabs .tab { position: relative; z-index: 1; height: 30px; display: inline-flex; align-items: center; padding: 0 10px; font-size: var(--text-xs); color: var(--text-muted); border-radius: var(--radius-tag); }
/* 滑块：减重轮起胶囊底，改 2px accent 下划线，切换时仍沿弹簧曲线滑到位 */
.tab-thumb {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: left var(--transition-spring), width var(--transition-spring), opacity var(--transition);
}
.tabs .tab.active { background: transparent; box-shadow: none; color: var(--text); font-weight: 600; }
.tab-more { font-family: inherit; font-size: var(--text-xs); }
.tab-count { display: inline-block; background: none; color: var(--text-muted); font-size: var(--text-xs); padding: 0; margin-left: 4px; font-weight: 500; line-height: 14px; }
.tab.active .tab-count { background: none; color: var(--accent); }

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
.tab-pop-empty { padding: var(--space-2) 8px; font-size: var(--text-sm); color: var(--text-muted); text-align: center; }

/* inset 轮：行落在白色面板里（global.css .rowlist），行间发丝线由面板承托；
   行不再有卡皮，hover/选中只换底色 */
.entry-card {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 var(--space-4);
  cursor: pointer;
  position: relative;
  transition: background-color 0.15s ease, padding-left 0.15s ease;
}
/* 骨架行跟本页 60px 行同档，加载完成时行高不跳 */
.rowlist .skeleton-row { height: 60px; }
/* 白面板上的 hover：比画布档轻一色的 sunken，看得见但不抢字 */
.entry-card:hover { background: var(--sunken); }
.entry-card:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-light); background: var(--sunken); }
/* 选中态：浸润底 + 1px 内描边，白卡里不外扩 */
.entry-card.selected {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.entry-card.selected .ec-name { color: var(--text-brand); }
.entry-card.selected .ec-cat { color: var(--text-brand); }

/* 勾选位不常驻：hover 时浮到行首圆点上（点让位，钮居点心），
   进批量态才让出左栏位。钮随整卡 hover 显形（可见才可点，杜绝隐形吞点击误入批量） */
.card-check {
  position: absolute;
  left: 19px; /* 压住行首 24px 档中心：padding 16 + 24/2 − 18/2 */
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-on);
  transition: opacity var(--transition), border-color var(--transition), left var(--transition);
  opacity: 0;
  pointer-events: none;
}
.entry-card:hover .card-check,
.entry-card:focus-visible .card-check,
.entry-card.batching .card-check { opacity: 1; pointer-events: auto; }
.card-check:hover { border-color: var(--accent); }
.card-check.checked { background: var(--accent); border-color: var(--accent); }
/* 批量态：整卡让出 18px + 16px 间隙的左栏位，勾选框从图标块上挪进栏位 */
.entry-card.batching { padding-left: calc(var(--space-4) * 2 + 18px); }
.entry-card.batching .card-check { left: var(--space-4); }

/* 实体信息主列：两行文本（名+分类 / URL+备注），flex:1 吃满行宽 */
.ec-id { flex: 1 1 auto; min-width: 0; }
/* 行首 24px 档：中性字母块（字色 7% 淡染），favicon 到货后换成图标面 */
.ec-fav {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
  transition: opacity var(--transition);
}
.ec-fav img {
  width: 16px;
  height: 16px;
  object-fit: contain;
  display: block;
}
/* 深色底上多数 favicon 是深标（GitHub 黑猫），垫一片暖白亮底才不隐身 */
:root[data-theme='ink'] .ec-fav--icon {
  background: #ddd9d2;
}
.ec-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
/* 名字行：名 + 凭证靠左，分类定住行尾（hover 时让位给动作钮列） */
.ec-name-row { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ec-name {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-secondary);
  flex: 0 1 auto;
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
.meta-dot { color: var(--text-faint); flex-shrink: 0; }
.ec-note {
  font-size: var(--text-sm);
  color: var(--text-muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ec-domain {
  /* 按内容收缩：拉满会把行卡中心点的点击吃掉（anchor 上挂 stop 的开链动作） */
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-url);
  text-decoration: none;
  overflow: hidden;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--transition);
}
/* 两色显示：主机实色定住，路径整段淡出、尾部截断 */
.u-host { flex: 0 0 auto; }
.u-path { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); }
.ec-domain:hover { color: var(--accent); }
.ec-domain:hover .u-path { color: var(--accent-light); }
.ec-cat {
  display: inline-flex;
  align-items: center;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-muted);
  flex-shrink: 0;
  white-space: nowrap;
  margin-left: auto;
  padding-left: var(--space-2);
  transition: color var(--transition), opacity var(--transition);
}

.ec-cred {
  display: inline-flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
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
  font-size: var(--text-xs);
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

/* 渐进披露：动作钮脱流浮在行尾右缘，hover 才显形；
   左缘一条向 --sunken 的渐隐垫底，压住其下的分类/长 URL（hover 时分类同步淡出） */
.ec-actions {
  position: absolute;
  right: calc(var(--space-4) - 4px);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding-left: 28px;
  background: linear-gradient(90deg, transparent, var(--sunken) 40%);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.entry-card:hover .ec-actions,
.entry-card:focus-within .ec-actions { opacity: 1; }
.entry-card:hover .ec-cat,
.entry-card:focus-within .ec-cat { opacity: 0; }
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
.loading { padding: 0; }
.skeleton-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.skeleton-line.name { width: 140px; }
.skeleton-line.note { width: 220px; height: 6px; }
.skeleton-line.url { display: none; }
.skeleton-line.tag { width: 52px; margin-left: auto; }
</style>
