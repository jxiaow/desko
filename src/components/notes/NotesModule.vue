<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import { useToastStore } from '../../stores/toast'
import { useClipboard } from '../../composables/useClipboard'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import AppIcon from '../shared/AppIcon.vue'
import { htmlToText } from '../../utils/format'
import type { IconName } from '../../utils/icons'
import type { Note } from '../../types'
import type { NoteSort, NoteView } from '../../stores/notes'

const VIEWS: { key: NoteView; label: string; icon: IconName }[] = [
  { key: 'all', label: '全部', icon: 'all' },
  { key: 'pinned', label: '置顶', icon: 'pin' },
  { key: 'starred', label: '收藏', icon: 'star' },
]
const SORTS: { key: NoteSort; label: string }[] = [
  { key: 'new', label: '最新' },
  { key: 'old', label: '最早' },
  { key: 'updated', label: '最近更新' },
]
const NEWBORN_MS = 400
const RAIL_FALLBACK_ROOM = 900

const notesStore = useNotesStore()
const toastStore = useToastStore()
const { copyToClipboard } = useClipboard()
const {
  notes, notesLoading, noteSearchKeyword, noteView, activeTags, noteSort, hasActiveFilters,
  noteRailCollapsed,
  isBatchMode, selectedNoteIds, noteAttachments, noteSaveState,
  tagCounts, viewCounts, filteredNotes, groupedNotes,
} = storeToRefs(notesStore)
const {
  fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
  doDeleteNote, togglePin, toggleStar,
  toggleBatchMode, toggleSelectNote, selectAllNotes, clearSelection,
  batchDelete, batchSetPinned, batchSetStarred,
  loadAttachments, uploadAttachment, deleteAttachment,
} = notesStore

const pageEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const composerRef = ref<InstanceType<typeof NoteComposer> | null>(null)

/** 任何时刻只有一个书写面：草稿正文、就地展开的 note id、全屏层目标 */
const draftHtml = ref('')
const editingId = ref<string | null>(null)
const fsTarget = ref<'new' | string | null>(null)
const newbornId = ref<string | null>(null)

const railRoom = ref(true)
const filterAnchor = ref<HTMLElement | null>(null)
const sortAnchor = ref<HTMLElement | null>(null)

/** 侧栏真正可见 = 放得下 且 用户没收起 */
const railOpen = computed(() => railRoom.value && !noteRailCollapsed.value)
const toggleRail = () => { noteRailCollapsed.value = !noteRailCollapsed.value }
watch(railOpen, (open) => { if (open) filterAnchor.value = null })

const draftText = computed(() => htmlToText(draftHtml.value))
const draftEmpty = computed(() => !draftText.value.trim())
const fsNote = computed(() =>
  typeof fsTarget.value === 'string' ? findNote(fsTarget.value) : null)
const sortLabel = computed(() =>
  SORTS.find(s => s.key === noteSort.value)?.label ?? '最新')

const pickFilter = (e: MouseEvent) => {
  const el = e.currentTarget as HTMLElement
  filterAnchor.value = filterAnchor.value === el ? null : el
  sortAnchor.value = null
}
const pickSort = (e: MouseEvent) => {
  const el = e.currentTarget as HTMLElement
  sortAnchor.value = sortAnchor.value === el ? null : el
  filterAnchor.value = null
}
const chooseView = (view: NoteView) => {
  noteView.value = view
  filterAnchor.value = null
}
const chooseSort = (sort: NoteSort) => {
  noteSort.value = sort
  sortAnchor.value = null
}
const resetFilters = () => {
  clearFilters()
  filterAnchor.value = null
}

/** 落库成功后清空书写面，光标回到顶部输入框 */
const afterPublish = async (note: Note) => {
  draftHtml.value = ''
  fsTarget.value = null
  newbornId.value = note.id
  setTimeout(() => { if (newbornId.value === note.id) newbornId.value = null }, NEWBORN_MS)
  await nextTick()
  composerRef.value?.focus()
}

const publishDraft = async () => {
  const note = await publishNote(draftHtml.value)
  if (note) await afterPublish(note)
}

const openCard = (note: Note) => {
  if (fsTarget.value) return
  editingId.value = note.id
  loadAttachments(note.id)
}
const closeCard = async () => {
  await flushNoteSave()
  editingId.value = null
}

const openFullscreen = async (target: 'new' | string) => {
  await flushNoteSave()
  if (target !== 'new') loadAttachments(target)
  editingId.value = null
  filterAnchor.value = null
  sortAnchor.value = null
  fsTarget.value = target
}
const closeFullscreen = async () => {
  if (!fsTarget.value) return
  await flushNoteSave()
  const wasNew = fsTarget.value === 'new'
  fsTarget.value = null
  if (wasNew) {
    await nextTick()
    composerRef.value?.focus()
  }
}

const onFsUpdate = (html: string) => {
  if (fsTarget.value === 'new') draftHtml.value = html
  else if (typeof fsTarget.value === 'string') saveNoteContent(fsTarget.value, html)
}

const pickImagePath = async (): Promise<string | null> => {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    return typeof selected === 'string' ? selected : null
  } catch (e: any) {
    toastStore.showToast('选择文件失败：' + e.message, 'error')
    return null
  }
}

const addImageToNote = async (noteId: string) => {
  const path = await pickImagePath()
  if (path) await uploadAttachment(noteId, path)
}

/** 上传附件要有 note id：先选文件（取消就什么都不动），再发布，最后挂上去 */
const addImageToDraft = async () => {
  if (draftEmpty.value) {
    toastStore.showToast('先写点内容，再配图', 'info')
    return
  }
  const path = await pickImagePath()
  if (!path) return
  const note = await publishNote(draftHtml.value)
  if (!note) return
  await uploadAttachment(note.id, path)
  await afterPublish(note)
}

const copyNote = (note: Note) => copyToClipboard(htmlToText(note.content_html), '小记')

const toggleBatch = async () => {
  await flushNoteSave()
  editingId.value = null
  clearSelection()
  toggleBatchMode()
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.defaultPrevented) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (fsTarget.value) return
    e.preventDefault()
    searchEl.value?.focus()
    return
  }
  if (e.key !== 'Escape' || fsTarget.value) return
  if (editingId.value) closeCard()
  else if (isBatchMode.value) toggleBatch()
}

// 全屏里删掉当前这条之后，书写面要跟着收掉
watch(notes, () => {
  if (typeof fsTarget.value === 'string' && !findNote(fsTarget.value)) fsTarget.value = null
})

let observer: ResizeObserver | null = null
onMounted(() => {
  fetchNotes()
  document.addEventListener('keydown', onKeyDown)
  const root = pageEl.value
  if (!root) return
  const minRoom = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--rail-min-room'))
    || RAIL_FALLBACK_ROOM
  observer = new ResizeObserver((entries) => {
    const next = entries[0].contentRect.width >= minRoom
    // 只在真正跨越阈值时改状态：回调里换实例会让 ResizeObserver 无限循环
    if (next !== railRoom.value) railRoom.value = next
  })
  observer.observe(root)
})
onBeforeUnmount(() => {
  flushNoteSave()
  document.removeEventListener('keydown', onKeyDown)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="pageEl" class="notes-page">
    <div class="stream">
      <div class="stream-inner">
        <div class="stream-bar">
          <div class="search-box">
            <span class="search-icon"><AppIcon name="search" :size="15" /></span>
            <input
              ref="searchEl"
              v-model="noteSearchKeyword"
              type="text"
              placeholder="搜索小记…"
              aria-label="搜索小记"
            />
            <button
              v-if="noteSearchKeyword"
              class="search-clear"
              type="button"
              title="清空搜索"
              aria-label="清空搜索"
              @click="noteSearchKeyword = ''"
            >
              <AppIcon name="x" :size="13" />
            </button>
          </div>

          <span class="bar-count">{{ filteredNotes.length }} / {{ notes.length }} 条</span>

          <button
            v-if="!railOpen"
            class="bar-btn"
            :class="{ active: hasActiveFilters }"
            type="button"
            @click="pickFilter"
          >
            <AppIcon name="filter" :size="13" />
            筛选
          </button>
          <button
            class="bar-btn"
            :class="{ active: noteSort !== 'new' }"
            type="button"
            @click="pickSort"
          >
            <AppIcon name="clock" :size="13" />
            {{ sortLabel }}
          </button>
          <button class="bar-btn" :class="{ active: isBatchMode }" type="button" @click="toggleBatch">
            <AppIcon name="checkall" :size="13" />
            {{ isBatchMode ? '退出' : '批量' }}
          </button>
          <button
            v-if="railRoom"
            class="bar-btn"
            :class="{ active: noteRailCollapsed }"
            type="button"
            :title="noteRailCollapsed ? '展开侧栏' : '收起侧栏'"
            @click="toggleRail"
          >
            <AppIcon name="panel" :size="13" />
            {{ noteRailCollapsed ? '展开' : '收起' }}
          </button>
        </div>

        <NoteComposer
          ref="composerRef"
          :html="draftHtml"
          :empty="draftEmpty"
          @update="draftHtml = $event"
          @publish="publishDraft"
          @add-image="addImageToDraft"
          @fullscreen="openFullscreen('new')"
        />

        <div v-if="notesLoading && !notes.length" class="day-list">
          <div v-for="n in 3" :key="n" class="memo-skeleton">
            <span class="sl sl-1"></span>
            <span class="sl sl-2"></span>
            <span class="sl sl-3"></span>
          </div>
        </div>

        <template v-else>
          <div v-for="group in groupedNotes" :key="group.label" class="day">
            <div class="day-head" :class="{ pinned: group.pinned }">
              <AppIcon v-if="group.pinned" name="pin" :size="11" />
              {{ group.label }}
              <span class="day-count">· {{ group.notes.length }}</span>
            </div>
            <div class="day-list">
              <NoteCard
                v-for="note in group.notes"
                :key="note.id"
                :note="note"
                :editing="editingId === note.id"
                :is-batch-mode="isBatchMode"
                :is-selected="selectedNoteIds.has(note.id)"
                :just-published="newbornId === note.id"
                :attachments="noteAttachments[note.id] ?? []"
                :save-state="editingId === note.id ? noteSaveState : ''"
                @open="openCard(note)"
                @update="saveNoteContent(note.id, $event)"
                @close="closeCard"
                @fullscreen="openFullscreen(note.id)"
                @add-image="addImageToNote(note.id)"
                @toggle-pin="togglePin(note)"
                @toggle-star="toggleStar(note)"
                @copy="copyNote(note)"
                @delete="doDeleteNote(note)"
                @select="toggleSelectNote(note.id)"
                @tag-click="toggleTagFilter($event)"
                @remove-attachment="deleteAttachment(note.id, $event)"
              />
            </div>
          </div>

          <div v-if="!filteredNotes.length" class="empty-state">
            <div class="empty-icon">
              <AppIcon :name="hasActiveFilters ? 'searchEmpty' : 'doc'" :size="24" />
            </div>
            <div class="empty-title">{{ hasActiveFilters ? '未找到匹配的小记' : '还没有小记' }}</div>
            <div class="empty-desc">{{ hasActiveFilters ? '试试清空筛选或其他关键词' : '在上方写第一条' }}</div>
          </div>
        </template>
      </div>
    </div>

    <aside v-if="railOpen" class="rail">
      <div class="rail-title">视图</div>
      <button
        v-for="v in VIEWS"
        :key="v.key"
        class="rail-item"
        :class="{ active: noteView === v.key }"
        type="button"
        @click="noteView = v.key"
      >
        <AppIcon :name="v.icon" :size="14" />
        <span class="nm">{{ v.label }}</span>
        <span class="tab-count">{{ viewCounts[v.key] }}</span>
      </button>

      <div class="rail-sep"></div>
      <div class="rail-title">标签 · {{ tagCounts.length }}</div>
      <button
        v-for="[tag, count] in tagCounts"
        :key="tag"
        class="rail-item"
        :class="{ active: activeTags.has(tag) }"
        type="button"
        @click="toggleTagFilter(tag)"
      >
        <span class="nm">#{{ tag }}</span>
        <span class="tab-count">{{ count }}</span>
      </button>
      <div v-if="!tagCounts.length" class="rail-empty">还没有标签</div>

      <template v-if="hasActiveFilters">
        <div class="rail-sep"></div>
        <button class="rail-item danger" type="button" @click="clearFilters">
          <AppIcon name="x" :size="14" />
          <span class="nm">清空筛选</span>
        </button>
      </template>
    </aside>

    <div v-if="isBatchMode && !fsTarget" class="batch-dock">
      <span class="dock-count">已选 {{ selectedNoteIds.size }} 条</span>
      <button class="dock-btn" type="button" @click="selectAllNotes">
        <AppIcon name="checkall" :size="12" />全选
      </button>
      <button class="dock-btn" type="button" :disabled="!selectedNoteIds.size" @click="clearSelection">
        <AppIcon name="x" :size="12" />取消全选
      </button>
      <span class="dock-sep"></span>
      <button class="dock-btn" type="button" @click="batchSetPinned(true)">
        <AppIcon name="pin" :size="12" />置顶
      </button>
      <button class="dock-btn" type="button" @click="batchSetPinned(false)">
        <AppIcon name="unpin" :size="12" />取消置顶
      </button>
      <button class="dock-btn" type="button" @click="batchSetStarred(true)">
        <AppIcon name="star" :size="12" />收藏
      </button>
      <button class="dock-btn" type="button" @click="batchSetStarred(false)">
        <AppIcon name="star" :size="12" />取消收藏
      </button>
      <span class="dock-sep"></span>
      <button class="dock-btn danger" type="button" :disabled="!selectedNoteIds.size" @click="batchDelete">
        <AppIcon name="trash" :size="12" />删除
      </button>
      <button class="dock-btn" type="button" @click="toggleBatch">
        <AppIcon name="check" :size="12" />完成
      </button>
    </div>

    <NoteFullscreen
      v-if="fsTarget"
      :key="fsTarget"
      :note="fsNote"
      :initial-html="fsTarget === 'new' ? draftHtml : fsNote?.content_html ?? ''"
      :attachments="fsNote ? noteAttachments[fsNote.id] ?? [] : []"
      :save-state="fsNote ? noteSaveState : ''"
      @update="onFsUpdate"
      @close="closeFullscreen"
      @publish="publishDraft"
      @add-image="fsNote ? addImageToNote(fsNote.id) : addImageToDraft()"
      @toggle-pin="fsNote && togglePin(fsNote)"
      @toggle-star="fsNote && toggleStar(fsNote)"
      @delete="fsNote && doDeleteNote(fsNote)"
      @remove-attachment="fsNote && deleteAttachment(fsNote.id, $event)"
    />

    <PopoverMenu v-if="filterAnchor" :anchor="filterAnchor" wide align="end" @close="filterAnchor = null">
      <div class="pop-sec">
        <div class="pop-label">视图</div>
        <div class="pop-tabs">
          <button
            v-for="v in VIEWS"
            :key="v.key"
            class="tab"
            :class="{ active: noteView === v.key }"
            type="button"
            @click="chooseView(v.key)"
          >{{ v.label }}<span class="tab-count">{{ viewCounts[v.key] }}</span></button>
        </div>
      </div>
      <div class="pop-sec">
        <div class="pop-label">标签 · {{ activeTags.size ? `已选 ${activeTags.size}` : '可多选' }}</div>
        <div class="pop-tabs">
          <button
            v-for="[tag, count] in tagCounts"
            :key="tag"
            class="tab"
            :class="{ active: activeTags.has(tag) }"
            type="button"
            @click="toggleTagFilter(tag)"
          >#{{ tag }}<span class="tab-count">{{ count }}</span></button>
        </div>
        <div v-if="!tagCounts.length" class="rail-empty">还没有标签</div>
      </div>
      <div v-if="hasActiveFilters" class="pop-sec tight">
        <button class="tab danger" type="button" @click="resetFilters">清空筛选</button>
      </div>
    </PopoverMenu>

    <PopoverMenu v-if="sortAnchor" :anchor="sortAnchor" align="end" @close="sortAnchor = null">
      <div class="pop-sec">
        <div class="pop-label">排序</div>
        <div class="pop-tabs">
          <button
            v-for="s in SORTS"
            :key="s.key"
            class="tab"
            :class="{ active: noteSort === s.key }"
            type="button"
            @click="chooseSort(s.key)"
          >{{ s.label }}</button>
        </div>
      </div>
    </PopoverMenu>
  </div>
</template>

<style scoped>
.notes-page {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.stream {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
}
/* 一行一张：正常窗口铺满，最大化时收在 --stream-max 内居中 */
.stream-inner {
  width: 100%;
  max-width: var(--stream-max);
  margin-inline: auto;
  padding: var(--space-5) var(--space-5) 96px;
}

/* ---------- 顶部工具条：整页唯一一条 chrome ---------- */
.stream-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0 var(--space-3);
  margin-bottom: var(--space-1);
}
.stream-bar .search-box { flex: 1; min-width: 80px; max-width: 320px; }
.bar-count {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-right: auto;
  padding-left: var(--space-1);
}
.bar-btn {
  height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all var(--transition);
  white-space: nowrap;
  font-family: inherit;
}
.bar-btn:hover { background: var(--hover); }
.bar-btn.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }

/* ---------- 日期分组 ---------- */
.day { margin-bottom: var(--space-4); }
.day-head {
  position: sticky;
  top: calc(36px + var(--space-2) * 2);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-faint);
  letter-spacing: 0.02em;
  padding: var(--space-2) 0 var(--space-2) var(--space-1);
  background: var(--bg);
}
.day-head.pinned { color: var(--accent); }
.day-head::after { content: ''; flex: 1; height: 1px; background: var(--border); opacity: 0.7; }
.day-count { font-variant-numeric: tabular-nums; font-weight: 500; }
.day-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.memo-skeleton {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  animation: pulse 1.5s ease-in-out infinite;
}
.sl { display: block; height: 11px; border-radius: 4px; background: var(--hover); }
.sl-1 { width: 72%; }
.sl-2 { width: 94%; margin-top: var(--space-2); }
.sl-3 { width: 40%; margin-top: var(--space-3); }
@keyframes pulse { 50% { opacity: 0.5; } }

/* ---------- 右窄栏：纯导航，不是书写面 ---------- */
.rail {
  width: var(--rail-w);
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--sidebar-bg);
  overflow-y: auto;
  padding: var(--space-4) var(--space-2) var(--space-5);
}
.rail-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  padding: 0 var(--space-2) var(--space-2);
}
.rail-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: 5px var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
  font-family: inherit;
}
.rail-item:hover { background: var(--sidebar-hover); color: var(--text); }
.rail-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.rail-item.danger { color: var(--danger); }
.rail-item.danger:hover { background: var(--danger-soft); }
.rail-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-sep { height: 1px; background: var(--border); margin: var(--space-3) var(--space-2); }
.rail-empty { font-size: 12px; color: var(--text-muted); padding: 0 var(--space-2); }

/* ---------- 批量底栏 ---------- */
.batch-dock {
  position: fixed;
  bottom: var(--space-5);
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-pop);
  padding: var(--space-2);
  animation: dock-in var(--transition-slow) cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes dock-in { from { opacity: 0; transform: translate(-50%, 10px); } }
.dock-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  padding: 0 var(--space-2);
  white-space: nowrap;
}
.dock-sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 var(--space-1); }
.dock-btn {
  height: 28px;
  padding: 0 var(--space-2);
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all var(--transition);
  white-space: nowrap;
  font-family: inherit;
}
.dock-btn:hover { background: var(--hover); border-color: var(--border); color: var(--text); }
.dock-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.dock-btn.danger { color: var(--danger); }
.dock-btn.danger:hover { background: var(--danger-soft); border-color: #fecaca; }

.pop-sec.tight { padding-top: 0; }
.tab.danger { color: var(--danger); }
.tab.danger:hover { background: var(--danger-soft); }
</style>
