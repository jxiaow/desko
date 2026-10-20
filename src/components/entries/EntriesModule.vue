<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import type { Entry, Tab } from '../../types'
import { splitUrlHostPath } from '../../utils/format'
import { avatarLetter } from '../../utils/avatar'
import { isPageShortcutBlocked } from '../../utils/pageShortcuts'
import { faviconSrcFor } from '../../services/favicon'
import { useGridKeys } from '../../composables/useGridKeys'
import AppIcon from '../shared/AppIcon.vue'
import CreateAction from '../shared/CreateAction.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import EntryActionMenu from './EntryActionMenu.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { isWebRuntime } from '../../services/runtime'
import { useWorkspaceLayout, workspaceDirectoryTarget, workspaceToolbarTarget } from '../layout/workspaceLayout'
import WorkspaceDirectoryToggle from '../layout/WorkspaceDirectoryToggle.vue'

const webRuntime = isWebRuntime()
const workspaceLayout = useWorkspaceLayout()

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
  if (isPageShortcutBlocked(e)) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
  }
}

/** 行首 34px 档面：host 命中缓存/抓取到货后返回图标 URL，否则 null 走中性字母块
    （取字规则与详情弹窗共用 utils/avatar 的 avatarLetter） */
const favOf = (item: Entry) => faviconSrcFor(item.url)

/** 分类淡染：把 category 稳定哈希到六桶 hue（--cat-1..6），字母兜底档与分类点共用同一色，
   同分类卡片一眼归堆。favicon 到货时档面改走中性亮底，此色只喂给分类点。 */
const CAT_HUES = ['--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6']
const hasCat = (item: Entry) => !!(item.category || '').trim()
const hueOf = (category?: string | null): string => {
  const c = (category || '').trim()
  if (!c) return 'var(--text-faint)'
  let h = 0
  for (const ch of c) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return `var(${CAT_HUES[h % CAT_HUES.length]})`
}
/** 未分类没有色相可表，压成灰淡染底反而把字母吃掉，落回中性字母档 */
const slotClass = (item: Entry) => (favOf(item) ? 'grid-slot--icon' : hasCat(item) ? 'grid-slot--hue' : undefined)
const slotStyle = (item: Entry) => (!favOf(item) && hasCat(item) ? { '--gc-hue': hueOf(item.category) } : undefined)

/* ── 分类标签：全部 + 前 2 枚高频常驻，其余收进「更多」下拉（面板内可搜索） ── */
const visibleTabs = computed(() => workspaceLayout ? props.tabs : props.tabs.slice(0, 3))
const hiddenTabs = computed(() => workspaceLayout ? [] : props.tabs.slice(3))
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

/** 批量态下整张卡就是选择热区，非批量态才落到详情 */
const onCardClick = (item: Entry, isBatchMode: boolean) => {
  if (isBatchMode) emit('toggleSelect', item.id)
  else emit('openDetail', item)
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

/* 二维游走 + C 复制：列数按网格实测，Enter/Space 的开启动作留在卡片自身 */
const { onGridKeydown } = useGridKeys({
  cardSelector: '.entry-card',
  onCopy: (id) => {
    const item = props.filteredEntries.find(e => e.id === id)
    if (item?.url) copyUrl(item)
  },
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('resize', syncThumb)
  if (copiedTimer) window.clearTimeout(copiedTimer)
})

const pageHead = usePageHeadStore()
watchEffect(() => pageHead.setHead('网址收藏', props.filteredEntries.length ? `${props.filteredEntries.length} 条` : ''))
</script>

<template>
  <div class="content-inner" :class="{ 'web-runtime': webRuntime }">
    <!-- 身份行 + 工具栏：搜索、分类、计数和两个动作；分类超出宽度改为横向滚动 -->
    <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout" defer>
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
      <Teleport :to="workspaceDirectoryTarget" :disabled="!workspaceLayout" defer>
      <nav ref="tabsRef" class="tabs" :class="{ 'directory-list': workspaceLayout }" aria-label="收藏分类">
        <span class="tab-thumb" :style="thumbStyle" aria-hidden="true"></span>
        <button
          v-for="t in visibleTabs"
          :key="t.id"
          class="tab"
          :class="{ active: activeTab === t.id, 'directory-link': workspaceLayout }"
          type="button"
          :aria-pressed="activeTab === t.id"
          @click="pickTab(t.id)"
        >
          <AppIcon v-if="workspaceLayout" :name="t.id === 'all' ? 'all' : 'tag'" :size="14" />
          <span class="directory-label">{{ t.name }}</span>
          <span class="tab-count">{{ t.count }}</span>
        </button>
        <button
          v-if="hiddenTabs.length"
          class="tab tab-more"
          :class="{ active: !!activeHiddenTab }"
          type="button"
          @click="toggleMore($event.currentTarget as HTMLElement)"
        >{{ activeHiddenTab ? activeHiddenTab.name : '更多' }} ({{ hiddenTabs.length }}) ▾</button>
      </nav>
      </Teleport>
      <PopoverMenu v-if="moreOpen && moreAnchor" :anchor="moreAnchor" align="start" @close="moreOpen = false">
        <div class="tab-pop">
          <div class="search-box tab-pop-search">
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
      <CreateAction label="新增条目" @click="emit('openAdd')" />
      <WorkspaceDirectoryToggle v-if="workspaceLayout" />
    </div>
    </Teleport>

    <div v-if="loading" class="card-grid">
      <div class="skeleton-card" v-for="n in 6" :key="n">
        <div class="row1">
          <span class="skeleton-slot"></span>
          <div class="skeleton-line name"></div>
        </div>
        <div class="row2">
          <div class="skeleton-line foot"></div>
        </div>
      </div>
    </div>

    <!-- 浮岛网格：卡直接落在画布上，靠抬影与描边分层，不再包白色行面板 -->
    <div v-else-if="filteredEntries.length" class="entry-list card-grid" @keydown="onGridKeydown">
      <article
        v-for="item in filteredEntries"
        :key="item.id"
        class="entry-card grid-card"
        :class="{ selected: selectedIds.has(item.id), batching: isBatchMode }"
        :data-id="item.id"
        tabindex="0"
        role="button"
        :aria-label="`条目：${item.name}`"
        @click="onCardClick(item, isBatchMode)"
        @keydown.enter.prevent="onCardClick(item, isBatchMode)"
        @keydown.space.prevent="onCardClick(item, isBatchMode)"
      >
        <span class="card-check" :class="{ checked: selectedIds.has(item.id) }" aria-hidden="true"
          @click.stop="emit('toggleSelect', item.id)">
          <AppIcon v-if="selectedIds.has(item.id)" name="check" :size="12" />
        </span>

        <!-- 一行身份：24px 档（favicon 到货 → 分类淡染字母 → 未分类中性字母）+ 名称 + 右对齐分类点 -->
        <div class="row1">
          <span
            class="grid-slot"
            :class="slotClass(item)"
            :style="slotStyle(item)"
            aria-hidden="true"
          >
            <img v-if="favOf(item)" :src="favOf(item)!" alt="" />
            <template v-else>{{ avatarLetter(item.category) }}</template>
          </span>
          <span class="ec-name">{{ item.name }}</span>
          <span class="ec-cat"><i :style="{ background: hueOf(item.category) }"></i>{{ item.category || '未分类' }}</span>
        </div>

        <!-- 二行副址：等宽地址缩进到名称起笔；凭证锁标顶右，hover 让给动作浮岛 -->
        <div class="row2">
          <a
            v-if="item.url"
            class="ec-domain"
            :title="item.url"
            @click.prevent.stop="isBatchMode ? emit('toggleSelect', item.id) : emit('openUrl', item.url!)"
            @contextmenu.prevent="emit('copyText', item.url!, '网址')"
          ><span class="u-host">{{ splitUrlHostPath(item.url).host }}</span><span v-if="splitUrlHostPath(item.url).path"
            class="u-path">{{ splitUrlHostPath(item.url).path }}</span></a>
          <span v-if="item.username || passwordCache[item.id]?.value" class="ec-cred" title="已存登录凭据">
            <AppIcon name="lock" :size="13" />
          </span>
        </div>

        <!-- 右下动作浮岛：hover 才显形，与锁标同格交错 -->
        <span class="ec-actions grid-acts">
          <button v-if="item.url" class="ib ec-act" :class="{ copied: copiedId === item.id }" type="button" :title="copiedId === item.id ? '已复制' : '复制网址 (C)'" @click.stop="copyUrl(item)">
            <AppIcon :name="copiedId === item.id ? 'check' : 'copy'" :size="15" />
          </button>
          <button v-if="item.url" class="ib ec-act" type="button" title="在浏览器打开" @click.stop="emit('openUrl', item.url!)">
            <AppIcon name="external" :size="15" />
          </button>
          <button
            class="ib ec-act ec-more"
            type="button"
            title="更多操作"
            aria-label="更多操作"
            @click.stop="openMenu($event.currentTarget as HTMLElement, item)"
          >
            <AppIcon name="dots" :size="15" />
          </button>
        </span>

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
        <AppIcon :name="searchKeyword ? 'searchEmpty' : 'navEntries'" :size="24" />
      </div>
      <div class="empty-title">{{ searchKeyword ? '未找到匹配结果' : '暂无条目' }}</div>
      <div class="empty-desc">{{ searchKeyword ? '试试其他关键词' : '点击右上角 + 添加条目' }}</div>
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
@media (max-width: 600px) {
  .web-runtime .page-bar { flex-wrap: wrap; min-height: 0; }
  .web-runtime .page-bar .search-box { flex: 1 0 100%; width: 100%; margin-right: 0; }
  .web-runtime .page-bar .tabs { flex: 1 1 0; min-width: 0; }
  .web-runtime .page-bar .bar-btn,
  .web-runtime .page-bar .btn-primary { flex: none; white-space: nowrap; }
}
/* .content-inner / .page-bar / 搜索框 / 主按钮 / 骨架行形全部走 global.css 的页面骨架，
   此处只留本页特有的东西 */

/* 分类在行内横向滚动，不换行：换行会把工具栏顶出第二种高度。
   行宽有上限（常驻 3 枚 + 「更多」那颗），所以这里不参与收缩：窄窗先由搜索框让位
   （global 的 .page-bar .search-box 可缩到 120），别让隐藏滚动条把「更多」裁成半个字。 */
.tabs {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 0 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  padding: 2px 0;
}
.tabs::-webkit-scrollbar { display: none; }
.tabs .tab { position: relative; z-index: 1; height: 30px; display: inline-flex; align-items: center; padding: 0 10px; font-family: inherit; font-size: var(--text-xs); color: var(--text-muted); border-radius: var(--radius-tag); }
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
.tab-more { font-family: inherit; font-size: var(--text-xs); flex-shrink: 0; }
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
.tab-pop-list { max-height: 192px; overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: thin; }
.tab-pop-list .pop-item.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.tab-pop-empty { padding: var(--space-2) 8px; font-size: var(--text-sm); color: var(--text-muted); text-align: center; }

/* 卡皮、双行壳（.row1/.row2）、24px 档、右下动作浮岛与勾选全在 global.css 的 .grid-card 一节；
   这里只留收藏卡自己的字档与配色 */
.entry-card.selected .ec-name,
.entry-card.selected .ec-cat { color: var(--text-brand); }

/* 名字：14/600 单行截断，吃掉行宽；分类点靠右 */
.ec-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition);
}
/* 分类：右对齐 12px 淡字 + 7px hue 点（点色与字母兜底档同源） */
.ec-cat {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  transition: color var(--transition);
}
.ec-cat i { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

/* 副址行：等宽 12px，缩进由 global .row2 给，尾部省略（整条地址留在 title 与详情弹窗） */
.ec-domain {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.35;
  color: var(--text-url);
  text-decoration: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: color var(--transition);
}
.ec-domain:hover { color: var(--accent); }
.ec-domain:hover .u-path { color: var(--accent-light); }
/* 凭证锁标顶右、hover 让位给动作浮岛（同格交错，不叠字） */
.ec-cred {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  color: var(--text-faint);
  transition: opacity var(--transition);
}
.entry-card:hover .ec-cred,
.entry-card:focus-within .ec-cred { opacity: 0; }

/* 动作浮岛的定位/尺寸/显隐在 global.css .grid-acts；这里只留复制回执态 */
.ib.ec-act.copied { color: var(--success); }

/* .empty-state/.empty-icon/.empty-title/.empty-desc 走 global.css 的统一规范，
   此处不再重复声明，避免局部副本和全局定义漂移 */

/* 骨架行的宽度分配（皮与呼吸在 global.css） */
.skeleton-line.name { width: 132px; }
.skeleton-line.foot { width: 168px; }

</style>
