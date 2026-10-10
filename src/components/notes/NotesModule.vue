<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import { useToastStore } from '../../stores/toast'
import { useClipboard } from '../../composables/useClipboard'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import NoteLockDialog from './NoteLockDialog.vue'
import AppIcon from '../shared/AppIcon.vue'
import { htmlToLinkText, htmlToText } from '../../utils/format'
import { attachmentSrc, collectAttachmentNames } from '../../services/attachmentSrc'
import type { IconName } from '../../utils/icons'
import type { Note } from '../../types'
import type { NoteView } from '../../stores/notes'

const VIEWS: { key: NoteView; label: string; icon: IconName }[] = [
  { key: 'all', label: '全部', icon: 'all' },
  { key: 'pinned', label: '置顶', icon: 'pin' },
  { key: 'starred', label: '收藏', icon: 'star' },
]
const NEWBORN_MS = 400
const RAIL_FALLBACK_ROOM = 900

const notesStore = useNotesStore()

const toastStore = useToastStore()
const { copyRichToClipboard } = useClipboard()
const {
  notes, notesLoading, notesLoadError, noteSearchKeyword, noteView, activeTags, hasActiveFilters,
  noteRailCollapsed,
  isBatchMode, hasNoteSelection, selectedNoteIds, noteAttachments, noteSaveState, notePlains, noteKey,
  tagCounts, viewCounts, filteredNotes, groupedNotes,
} = storeToRefs(notesStore)
const {
  fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
  doDeleteNote, togglePin, toggleStar,
  lockNote, unlockNote, relockNote, removeNoteLock, relockNoteDomain,
  toggleSelectNote, selectAllNotes, clearSelection, toggleNotePick, exitNoteBatch,
  batchDelete, batchSetPinned, batchSetStarred,  loadAttachments, uploadAttachment, deleteAttachment, stageImage,
} = notesStore

const pageEl = ref<HTMLElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const composerRef = ref<InstanceType<typeof NoteComposer> | null>(null)
const fsRef = ref<InstanceType<typeof NoteFullscreen> | null>(null)
const cardRefs = ref<InstanceType<typeof NoteCard>[]>([])

/** 任何时刻只有一个书写面：草稿正文、就地展开的 note id、全屏层目标与其模式 */
const draftHtml = ref('')
const editingId = ref<string | null>(null)
const fsTarget = ref<'new' | string | null>(null)
const fsMode = ref<'edit' | 'view'>('edit')
const newbornId = ref<string | null>(null)
/** 打开编辑那一刻的正文快照：自动保存下「取消」靠它把这条写回原样 */
const editSnapshot = ref('')
/** 全库小记口令弹窗：mode 决定要输什么，thenLock 是口令到手后要补做的那次加密 */
const keyDialog = ref<{ mode: 'setup' | 'unlock' | 'change'; thenLock?: string } | null>(null)

const requestRemoveLock = async (id: string) => {
  const err = await removeNoteLock(id)
  if (err) toastStore.showToast(err, 'error')
}

const applyLock = async (id: string) => {
  const err = await lockNote(id)
  if (err) toastStore.showToast(err, 'error')
}

/** 加密一条：口令不在手就先要口令，设好当场把这条补上 */
const requestEncrypt = (id: string) => {
  if (noteKey.value.is_open) return applyLock(id)
  keyDialog.value = { mode: noteKey.value.is_set ? 'unlock' : 'setup', thenLock: id }
}

/** 打开一条锁着的：整库已开就是单条免密再开，否则先要口令 */
const requestOpenNote = async (id: string) => {
  if (!noteKey.value.is_open) {
    keyDialog.value = { mode: noteKey.value.is_set ? 'unlock' : 'setup' }
    return
  }
  const err = await unlockNote(id)
  if (err) toastStore.showToast(err, 'error')
}

const onKeyDialogDone = async () => {
  const pending = keyDialog.value?.thenLock
  keyDialog.value = null
  if (pending) await applyLock(pending)
}

const toggleNoteDomain = () => {
  if (noteKey.value.is_open) void relockNoteDomain()
  else keyDialog.value = { mode: 'unlock' }
}

const railRoom = ref(true)
/** 窄窗口下用户手动叫出来的浮层侧栏。放不下的时候开关也不能消失，否则侧栏就再也回不来了 */
const railPinned = ref(false)

/** 侧栏真正在流内可见 = 放得下 且 用户没收起 */
const railOpen = computed(() => railRoom.value && !noteRailCollapsed.value)
const railOverlay = computed(() => !railRoom.value && railPinned.value)
const railVisible = computed(() => railOpen.value || railOverlay.value)
const toggleRail = () => {
  if (railRoom.value) {
    noteRailCollapsed.value = !noteRailCollapsed.value
    railPinned.value = false
  } else {
    railPinned.value = !railPinned.value
  }
}
watch(railRoom, (room) => {
  if (room) railPinned.value = false
})

const draftText = computed(() => htmlToText(draftHtml.value))
const draftEmpty = computed(() => !draftText.value.trim() && !collectAttachmentNames(draftHtml.value).length)
const fsNote = computed(() =>
  typeof fsTarget.value === 'string' ? findNote(fsTarget.value) : null)

/** 侧栏脚注：全库口径，不受筛选影响，和顶栏那条「筛后 / 总数」分开表意 */
const railSummary = computed(() => {
  const lockedN = notes.value.filter((n) => n.encrypted).length
  return `共 ${notes.value.length} 条小记${lockedN ? ` · ${lockedN} 条已加密` : ''}`
})

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
  // 锁着的没有明文，编辑无从谈起
  if (note.encrypted && notePlains.value[note.id] == null) return
  editSnapshot.value = note.content_html
  editingId.value = note.id
  loadAttachments(note.id)
}
const closeCard = async () => {
  await flushNoteSave()
  editingId.value = null
}
/** 取消就地编辑：把正文写回打开前的快照，再落盘关闭 */
const cancelCard = async () => {
  if (!editingId.value) return
  saveNoteContent(editingId.value, editSnapshot.value)
  await flushNoteSave()
  editingId.value = null
}

const openFullscreen = async (target: 'new' | string, mode: 'edit' | 'view' = 'edit') => {
  await flushNoteSave()
  if (target !== 'new') {
    loadAttachments(target)
    editSnapshot.value = findNote(target)?.content_html ?? ''
  }
  editingId.value = null
  fsMode.value = mode
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
/** 取消全屏编辑：已有小记写回快照；新草稿直接丢弃（本就没落库） */
const cancelFullscreen = async () => {
  if (!fsTarget.value) return
  if (fsTarget.value === 'new') {
    draftHtml.value = ''
    fsTarget.value = null
    return
  }
  saveNoteContent(fsTarget.value, editSnapshot.value)
  await flushNoteSave()
  fsTarget.value = null
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

/** 已有小记配图：落盘即登记附件，再把图片块补进当前打开的书写面 */
const addImageToNote = async (noteId: string) => {
  const path = await pickImagePath()
  if (!path) return
  const att = await uploadAttachment(noteId, path)
  if (!att?.mime_type.startsWith('image/')) return
  const src = attachmentSrc(att.file_path)
  if (fsTarget.value === noteId) fsRef.value?.insertImage(src)
  else cardRefs.value?.find((c) => c.noteId === noteId)?.insertImage(src)
}

/** 上下键只搬焦点：焦点落到哪张卡，:focus-visible 的微环就长在哪张卡上 */
const onStreamKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  const from = event.target instanceof HTMLElement ? event.target : null
  if (!from || from.closest('input, textarea, [contenteditable="true"]')) return
  const cards = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.memo:not(.editing)'))
  const at = cards.indexOf(from.closest('.memo') as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  cards[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus()
}

/** 新小记配图：文件只收进附件目录（stage），发布时才按正文补附件记录——纯图小记也发得出去 */
const addImageToDraft = async () => {
  const path = await pickImagePath()
  if (!path) return
  const att = await stageImage(path)
  if (!att) return
  const src = attachmentSrc(att.file_path)
  if (fsTarget.value === 'new') fsRef.value?.insertImage(src)
  else composerRef.value?.insertImage(src)
}

const copyNote = (note: Note) =>
  copyRichToClipboard(note.content_html, htmlToLinkText(note.content_html), '小记')

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
  else if (isBatchMode.value) exitNoteBatch()
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
      <div class="stream-inner" @keydown="onStreamKeydown">
        <div class="page-bar">
          <div class="search-box">
            <span class="search-icon"><AppIcon name="search" :size="16" /></span>
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
              <AppIcon name="x" :size="14" />
            </button>
          </div>
          <!-- 计数是栏上的元信息，与收藏页同一位置（搜索框里只放搜索框自己的东西） -->
          <span class="bar-count">{{ filteredNotes.length }} / {{ notes.length }} 条</span>

          <button
            class="bar-btn"
            :class="{ active: isBatchMode }"
            type="button"
            :title="isBatchMode ? '退出选择' : '选择小记'"
            :aria-label="isBatchMode ? '退出选择' : '选择小记'"
            @click="toggleNotePick"
          >
            <AppIcon name="checkall" :size="16" />
          </button>
          <!-- 口令只管加密小记，没加密过就不出现在顶栏 -->
          <template v-if="noteKey.is_set">
            <div class="bar-div"></div>
            <button
              class="bar-btn"
              :class="{ active: noteKey.is_open }"
              type="button"
              :title="noteKey.is_open ? '锁回全部加密小记' : '解锁全部加密小记'"
              :aria-label="noteKey.is_open ? '锁回全部加密小记' : '解锁全部加密小记'"
              @click="toggleNoteDomain"
            >
              <AppIcon :name="noteKey.is_open ? 'lock' : 'unlock'" :size="16" />
            </button>
          </template>
          <button
            class="bar-btn"
            :class="{ active: railVisible }"
            type="button"
            :title="railVisible ? '收起侧栏' : '展开侧栏'"
            :aria-label="railVisible ? '收起侧栏' : '展开侧栏'"
            @click="toggleRail"
          >
            <AppIcon name="panel" :size="16" />
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
              <AppIcon v-if="group.pinned" name="pin" :size="12" />
              {{ group.label }}
              <span class="day-count">· {{ group.notes.length }}</span>
            </div>
            <div class="day-list">
              <NoteCard
                v-for="note in group.notes"
                :key="note.id"
                ref="cardRefs"
                :note="note"
                :editing="editingId === note.id"
                :is-batch-mode="isBatchMode"
                :is-selected="selectedNoteIds.has(note.id)"
                :just-published="newbornId === note.id"
                :attachments="noteAttachments[note.id] ?? []"
                :save-state="editingId === note.id ? noteSaveState : ''"
                :unlocked="notePlains[note.id] != null"
                :active-tags="activeTags"
                @open="openCard(note)"
                @update="saveNoteContent(note.id, $event)"
                @close="closeCard"
                @cancel="cancelCard"
                @fullscreen="openFullscreen(note.id)"
                @view="openFullscreen(note.id, 'view')"
                @encrypt="requestEncrypt(note.id)"
                @unlock="requestOpenNote(note.id)"
                @relock="relockNote(note.id)"
                @remove-lock="requestRemoveLock(note.id)"
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
          <div v-if="!filteredNotes.length && notesLoadError" class="error-state">
            <div class="empty-icon">
              <AppIcon name="alert" :size="24" />
            </div>
            <div class="empty-title">加载失败</div>
            <div class="empty-desc">{{ notesLoadError }}</div>
            <button class="btn-secondary retry-btn" @click="fetchNotes()">重试</button>
          </div>

          <div v-else-if="!filteredNotes.length" class="empty-state">
            <div class="empty-icon">
              <AppIcon :name="hasActiveFilters ? 'searchEmpty' : 'navNotes'" :size="24" />
            </div>
            <div class="empty-title">{{ hasActiveFilters ? '未找到匹配的小记' : '还没有小记' }}</div>
            <div class="empty-desc">{{ hasActiveFilters ? '试试清空筛选或其他关键词' : '在上方写第一条' }}</div>
          </div>
        </template>
      </div>
    </div>

    <aside v-if="railVisible" class="rail" :class="{ overlay: railOverlay }">
      <div class="rail-title">视图</div>
      <button
        v-for="v in VIEWS"
        :key="v.key"
        class="rail-item"
        :class="{ active: noteView === v.key }"
        type="button"
        @click="noteView = v.key"
      >
        <AppIcon :name="v.icon" :size="16" />
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
          <AppIcon name="x" :size="16" />
          <span class="nm">清空筛选</span>
        </button>
      </template>

      <div class="rail-foot">{{ railSummary }}</div>
    </aside>

    <div v-if="hasNoteSelection && !fsTarget" class="batch-dock">
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
      <button class="dock-btn" type="button" @click="exitNoteBatch">
        <AppIcon name="check" :size="12" />完成
      </button>
    </div>

    <NoteFullscreen
      v-if="fsTarget"
      :key="`${fsTarget}:${fsMode}`"
      ref="fsRef"
      :note="fsNote"
      :mode="fsMode"
      :initial-html="fsTarget === 'new' ? draftHtml : fsNote?.content_html ?? ''"
      :attachments="fsNote ? noteAttachments[fsNote.id] ?? [] : []"
      :save-state="fsNote ? noteSaveState : ''"
      @update="onFsUpdate"
      @close="closeFullscreen"
      @cancel="cancelFullscreen"
      @publish="publishDraft"
      @edit="fsMode = 'edit'"
      @add-image="fsNote ? addImageToNote(fsNote.id) : addImageToDraft()"
      @toggle-pin="fsNote && togglePin(fsNote)"
      @toggle-star="fsNote && toggleStar(fsNote)"
      @delete="fsNote && doDeleteNote(fsNote)"
      @remove-attachment="fsNote && deleteAttachment(fsNote.id, $event)"
    />

    <NoteLockDialog
      v-if="keyDialog"
      :mode="keyDialog.mode"
      @close="keyDialog = null"
      @done="onKeyDialogDone"
    />
  </div>
</template>

<style scoped>
.notes-page {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.stream {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scroll-behavior: smooth;
  /* 拆面轮：微光画布已上移到 .app-root，本页不再自铺 */
}
/* 一行一张：正常窗口铺满，最大化时收在 --stream-max 内居中。
   顶部不留内边距：与其余四页同款——顶栏贴顶，滚动行不会从它上面露出来 */
.stream-inner {
  width: 100%;
  max-width: var(--stream-max);
  margin-inline: auto;
  padding: 0 var(--space-5) var(--dock-clearance);
}
/* 书写框与吸顶栏拉开一档间距（列表页首行同款） */
.stream-inner .composer { margin-top: var(--space-2); }

/* ---------- 顶部工具条：吃 global.css 的 .page-bar 骨架（54px 吸顶画布），
   本页只有一处与全宽页不同：搜索框随流伸缩（上限 320）。
   计数用 global 的 .bar-count（margin-right: auto），把动作键推到右端，
   与验证码页同一位置 ---------- */
.page-bar .search-box { flex: 1; min-width: 80px; max-width: 320px; }
/* 右段动作键之间的分组线收成分居的短细线——通高的竖线在 54px 页栏里像表格线。
   margin 归零：.page-bar 本身已有 8px gap，global 那条又自带 4px，两侧各叠成 12px，
   分组线两侧净距 25px、邻钮之间只有 8px，读起来像断成了两截。 */
.page-bar .bar-div { align-self: center; height: 16px; opacity: 0.55; margin: 0; }

/* ---------- 日期分组 ---------- */
.day { margin-bottom: var(--space-4); }
.day-head {
  position: sticky;
  top: var(--stream-bar-h);
  z-index: 10;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  padding: var(--space-2) 0 var(--space-2) var(--space-1);
  /* 与 .page-bar 同一条画布配方（global.css --canvas-bg）：吸顶件若铺平色（原先 var(--bg)）
     会把画布光晕压掉一档，静止时就显出一条亮带。fixed 附着让它取到身后那一小条视口切片 */
  background: var(--canvas-bg);
  background-attachment: fixed;
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
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  padding: var(--space-3) var(--space-4);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.sl { display: block; height: 12px; border-radius: 4px; background: var(--hover); }
.sl-1 { width: 72%; }
.sl-2 { width: 94%; margin-top: var(--space-2); }
.sl-3 { width: 40%; margin-top: var(--space-3); }

/* ---------- 右窄栏：纯导航，不是书写面 ---------- */
.rail {
  width: var(--rail-w);
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--sidebar-bg);
  overflow-y: auto;
  padding: var(--space-4) var(--space-2) var(--space-4);
  display: flex;
  flex-direction: column;
}
.rail-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  padding: 0 var(--space-2) var(--space-2);
}
.rail-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 34px;
  padding: 0 var(--space-2);
  border: none;
  background: transparent;
  border-radius: var(--radius);
  font-size: var(--text-base);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
  text-align: left;
  font-family: inherit;
  flex-shrink: 0;
}
.rail-item:hover { background: var(--sidebar-hover); color: var(--text); }
.rail-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.rail-item.danger { color: var(--danger); }
.rail-item.danger:hover { background: var(--danger-soft); }
.rail-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 窄窗口下侧栏浮在流的上方，而不是把书写流挤扁。
   从顶栏下面开始：盖住顶栏就等于把「收起侧栏」那颗按钮一起盖掉，开了关不上 */
.rail.overlay {
  position: absolute;
  top: var(--stream-bar-h);
  right: 0;
  bottom: 0;
  z-index: 40;
  box-shadow: var(--shadow-pop);
  border-left: 1px solid var(--border);
}
.rail-sep { height: 1px; flex-shrink: 0; background: var(--border); margin: var(--space-3) var(--space-2); }
.rail-empty { font-size: var(--text-sm); color: var(--text-muted); padding: 0 var(--space-2); }
.rail .tab-count { font-size: var(--text-xs); margin-left: 0; }

/* 全库摘要压在侧栏末位：上面的列表再短它也守着底，读的是这一栏的口径 */
.rail-foot {
  flex-shrink: 0;
  margin-top: auto;
  border-top: 1px solid var(--border);
  padding: var(--space-3) var(--space-2) 0;
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-muted);
}

/* ---------- 批量底栏的骨架在 global.css，条目页共用同一套 ---------- */
</style>
