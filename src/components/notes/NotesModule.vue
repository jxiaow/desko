<script setup lang="ts">
import { isWebRuntime } from '../../services/runtime'
import { pickBrowserImage } from '../../services/browserImage'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import { useToastStore } from '../../stores/toast'
import { useClipboard } from '../../composables/useClipboard'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import NoteLockDialog from './NoteLockDialog.vue'
import NoteExportController from './NoteExportController.vue'
import AppIcon from '../shared/AppIcon.vue'
import { htmlToLinkText, htmlToText } from '../../utils/format'
import { attachmentSrc, collectAttachmentNames } from '../../services/attachmentSrc'
import type { IconName } from '../../utils/icons'
import type { Note } from '../../types'
import type { NoteView } from '../../stores/notes'
import { usePageHeadStore } from '../../stores/pageHead'
import type { NoteExportFormat } from '../../utils/noteExport'

const VIEWS: { key: NoteView; label: string; icon: IconName }[] = [
  { key: 'all', label: '全部', icon: 'all' },
  { key: 'pinned', label: '置顶', icon: 'pin' },
  { key: 'starred', label: '收藏', icon: 'star' },
  { key: 'archived', label: '归档', icon: 'archive' },
]
const RAIL_FALLBACK_ROOM = 900

const notesStore = useNotesStore()

const toastStore = useToastStore()
const { copyRichToClipboard } = useClipboard()
const {
  notes, notesLoading, notesLoadError, noteSearchKeyword, noteView, activeTags, hasActiveFilters,
  noteRailCollapsed, noteDraftHtml: draftHtml,
  isBatchMode, hasNoteSelection, selectedNoteIds, noteAttachments, noteSaveState, notePlains, noteKey,
  tagCounts, viewCounts, filteredNotes, groupedNotes, archivedNotes, archiveSummary,
} = storeToRefs(notesStore)
const {
  fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
  doDeleteNote, togglePin, toggleStar, setArchived, batchSetArchived, unarchiveAllFiltered,
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
const editingId = ref<string | null>(null)
const fsTarget = ref<'new' | string | null>(null)
const fsMode = ref<'edit' | 'view'>('edit')
/** 全库小记口令弹窗：mode 决定要输什么，thenLock 是口令到手后要补做的那次加密 */
const keyDialog = ref<{ mode: 'setup' | 'unlock' | 'change'; thenLock?: string } | null>(null)
const exportRequest = ref<{ ids: string[]; scopeLabel: string; format?: NoteExportFormat } | null>(null)
const exportAllCount = computed(() => notes.value.filter(note => note.archived === (noteView.value === 'archived')).length)
const exportNotes = (ids: string[], scopeLabel: string, format?: NoteExportFormat) => {
  if (!exportRequest.value && ids.length) exportRequest.value = { ids, scopeLabel, format }
}
const exportAll = () => exportNotes(notes.value.filter(note => note.archived === (noteView.value === 'archived')).map(note => note.id), noteView.value === 'archived' ? '全部归档小记' : '全部未归档小记')

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
const selectView = (view: NoteView) => {
  noteView.value = view
  if (isWebRuntime() && railOverlay.value) railPinned.value = false
}
watch(railRoom, (room) => {
  if (room) railPinned.value = false
})

const draftText = computed(() => htmlToText(draftHtml.value))
const draftEmpty = computed(() => !draftText.value.trim() && !collectAttachmentNames(draftHtml.value).length)
/** 归档视图只读不回书写面：书写框收掉，页栏搜索改口径 */
const isArchivedView = computed(() => noteView.value === 'archived')
/** 顶栏那个总数跟着视图走：归档行不该计进「全部」的条数里 */
const headTotal = computed(() => (isArchivedView.value ? viewCounts.value.archived : viewCounts.value.all))
/** 空态分「没搜到」还是「这个视图本来就空」：归档视图只认关键词/标签，光切视图不算无果 */
const hasQueryFilter = computed(() => !!noteSearchKeyword.value.trim() || activeTags.value.size > 0)
const emptyNoMatch = computed(() => (isArchivedView.value ? hasQueryFilter.value : hasActiveFilters.value))
const fsNote = computed(() =>
  typeof fsTarget.value === 'string' ? findNote(fsTarget.value) : null)

/** 侧栏脚注：全库口径，不受筛选影响，和顶栏那条「筛后 / 总数」分开表意 */
const railSummary = computed(() => {
  const lockedN = notes.value.filter((n) => n.encrypted).length
  const archivedN = archivedNotes.value.length
  return `共 ${notes.value.length} 条小记`
    + (lockedN ? ` · ${lockedN} 条已加密` : '')
    + (archivedN ? ` · ${archivedN} 条归档` : '')
})

/** 落库成功后清空书写面，光标回到顶部输入框 */
const afterPublish = async () => {
  draftHtml.value = ''
  fsTarget.value = null
  await nextTick()
  composerRef.value?.focus()
}

const publishDraft = async () => {
  const note = await publishNote(draftHtml.value)
  if (note) await afterPublish()
}

const openCard = (note: Note) => {
  if (fsTarget.value) return
  // 锁着的没有明文，编辑无从谈起
  if (note.encrypted && notePlains.value[note.id] == null) return
  editingId.value = note.id
  loadAttachments(note.id)
}
const closeCard = async () => {
  await flushNoteSave()
  editingId.value = null
}
const openFullscreen = async (target: 'new' | string, mode: 'edit' | 'view' = 'edit') => {
  await flushNoteSave()
  if (target !== 'new') loadAttachments(target)
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
/** 放弃只针对尚未发布的内容；已有小记的修改通过编辑器历史回退。 */
const discardFullscreen = () => {
  if (fsTarget.value !== 'new') return
  draftHtml.value = ''
  fsTarget.value = null
}

const onFsUpdate = (html: string) => {
  if (fsTarget.value === 'new') draftHtml.value = html
  else if (typeof fsTarget.value === 'string') saveNoteContent(fsTarget.value, html)
}

let active = true

const pickImagePath = async (): Promise<string | File | null> => {
  try {
    if (isWebRuntime()) return await pickBrowserImage()
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
  if (!active || !path) return
  const att = await uploadAttachment(noteId, path)
  if (!active || !att?.mime_type.startsWith('image/')) return
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
  if (!active || !path) return
  const att = await stageImage(path)
  if (!active || !att) return
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
  active = false
  void flushNoteSave().catch(() => {})
  document.removeEventListener('keydown', onKeyDown)
  observer?.disconnect()
  observer = null
})

const pageHead = usePageHeadStore()
watchEffect(() => pageHead.setHead('小记', `${hasActiveFilters.value ? `${filteredNotes.value.length} / ${headTotal.value}` : headTotal.value} 条`))
</script>

<template>
  <div ref="pageEl" class="notes-page" :class="{ 'rail-over': railOverlay }">
    <div class="stream">
      <div class="stream-inner" @keydown="onStreamKeydown">
        <div class="page-bar">
          <div class="search-box">
            <span class="search-icon"><AppIcon name="search" :size="16" /></span>
            <input
              ref="searchEl"
              v-model="noteSearchKeyword"
              type="text"
              :placeholder="isArchivedView ? '搜索归档小记…' : '搜索小记…'"
              :aria-label="isArchivedView ? '搜索归档小记' : '搜索小记'"
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
          <button v-if="!isWebRuntime()" class="bar-btn" type="button" :title="isArchivedView ? '导出全部归档' : '导出全部小记'" :aria-label="isArchivedView ? '导出全部归档' : '导出全部小记'" :disabled="!exportAllCount || !!exportRequest" @click="exportAll">
            <AppIcon name="download" :size="16" />
          </button>
          <!-- 口令只管加密小记，没加密过就不出现在顶栏；归档视图不做批量加解密 -->
          <template v-if="noteKey.is_set && !isArchivedView">
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

        <div v-if="isArchivedView" class="archive-bar">
          <span class="ab-lead"><b>归档中 {{ viewCounts.archived }} 条</b> · 不再出现在「全部」与搜索里</span>
          <span v-if="archiveSummary" class="ab-sub">{{ archiveSummary }}</span>
          <span class="ab-sp"></span>
          <button class="ab-btn" type="button" :disabled="!viewCounts.archived" @click="unarchiveAllFiltered">
            <AppIcon name="unarchive" :size="14" />全部取消归档
          </button>
        </div>

        <NoteComposer
          v-if="!isArchivedView"
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
                :attachments="noteAttachments[note.id] ?? []"
                :save-state="editingId === note.id ? noteSaveState : ''"
                :unlocked="notePlains[note.id] != null"
                :active-tags="activeTags"
                :archived-view="isArchivedView"
                :export-disabled="!!exportRequest"
                @open="openCard(note)"
                @update="saveNoteContent(note.id, $event)"
                @close="closeCard"
                @fullscreen="openFullscreen(note.id)"
                @view="openFullscreen(note.id, 'view')"
                @encrypt="requestEncrypt(note.id)"
                @unlock="requestOpenNote(note.id)"
                @relock="relockNote(note.id)"
                @remove-lock="requestRemoveLock(note.id)"
                @add-image="addImageToNote(note.id)"
                @toggle-pin="togglePin(note)"
                @toggle-star="toggleStar(note)"
                @toggle-archive="setArchived(note, !note.archived)"
                @export="exportNotes([note.id], '单条小记', $event)"
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
              <AppIcon :name="emptyNoMatch ? 'searchEmpty' : isArchivedView ? 'archive' : 'navNotes'" :size="24" />
            </div>
            <div class="empty-title">{{ emptyNoMatch ? '未找到匹配的小记' : isArchivedView ? '还没有归档的小记' : '还没有小记' }}</div>
            <div class="empty-desc">{{ emptyNoMatch ? '试试清空筛选或其他关键词' : isArchivedView ? '在小记卡上点「归档」就会收进这里' : '在上方写第一条' }}</div>
          </div>
        </template>
      </div>
    </div>

    <aside v-if="railVisible" class="rail" :class="{ overlay: railOverlay }">
      <div class="rail-title rail-heading"><span>视图</span><button v-if="railOverlay && isWebRuntime()" class="ib" type="button" aria-label="关闭小记筛选" @click="railPinned = false"><AppIcon name="x" :size="16" /></button></div>
      <button
        v-for="v in VIEWS"
        :key="v.key"
        class="rail-item"
        :class="{ active: noteView === v.key }"
        type="button"
        @click="selectView(v.key)"
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
      <button v-if="!isWebRuntime()" class="dock-btn" type="button" :disabled="!selectedNoteIds.size || !!exportRequest" @click="exportNotes([...selectedNoteIds], '已选小记')">
        <AppIcon name="download" :size="12" />导出
      </button>
      <button v-if="isArchivedView" class="dock-btn" type="button" @click="batchSetArchived(false)">
        <AppIcon name="unarchive" :size="12" />取消归档
      </button>
      <template v-else>
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
      <button class="dock-btn" type="button" @click="batchSetArchived(true)">
        <AppIcon name="archive" :size="12" />归档
      </button>
      </template>
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
      @discard="discardFullscreen"
      @publish="publishDraft"
      @edit="fsMode = 'edit'"
      @add-image="fsNote ? addImageToNote(fsNote.id) : addImageToDraft()"
      @toggle-pin="fsNote && togglePin(fsNote)"
      @toggle-star="fsNote && toggleStar(fsNote)"
      @delete="fsNote && doDeleteNote(fsNote)"
      @remove-attachment="fsNote && deleteAttachment(fsNote.id, $event)"
    />

    <NoteExportController v-if="exportRequest" :ids="exportRequest.ids" :format="exportRequest.format" :scope-label="exportRequest.scopeLabel" @close="exportRequest = null" />

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
.rail-heading { display: flex; align-items: center; justify-content: space-between; }

.stream {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overflow-x: hidden;
  scroll-behavior: smooth;
  /* 拆面轮：微光画布已上移到 .app-root，本页不再自铺 */
}
/* 一行一张：正常窗口铺满，宽窗把正文收在 --stream-max 内。
   顶部不留内边距：首行是吸顶的 .page-bar，呼吸在它自己栏内出。
   左右内距吃 .content-inner 同一条 gutter 契约（贴侧栏起算，余量落右侧），
   否则换页时侧栏边上的空带会跳宽 */
.stream-inner {
  width: 100%;
  padding: 0 var(--page-gutter) var(--dock-clearance);
  padding-inline-end: max(var(--page-gutter), calc(100% - var(--page-gutter) - var(--stream-max)));
}
/* 书写框与吸顶栏拉开一档间距（列表页首行同款） */
.stream-inner .composer { margin-top: var(--space-2); }

/* ---------- 顶部工具条：吃 global.css 的 .page-bar 骨架（64px 吸顶画布），
   本页只有一处与全宽页不同：搜索框随流伸缩（上限 320）。
   栏内没有撑满剩余空间的左组，动作键得自己认领，否则全贴在搜索框右边、右端空一片 ---------- */
.page-bar .search-box { flex: 1; min-width: 80px; max-width: 320px; }
.page-bar .search-box + .bar-btn { margin-left: auto; }
/* 右段动作键之间的分组线收成分居的短细线——通高的竖线在 54px 页栏里像表格线。
   margin 归零：.page-bar 本身已有 8px gap，global 那条又自带 4px，两侧各叠成 12px，
   分组线两侧净距 25px、邻钮之间只有 8px，读起来像断成了两截。 */
.page-bar .bar-div { align-self: center; height: 16px; opacity: 0.55; margin: 0; }

/* ---------- 归档视图上下文条：一句话交代「这里的东西为什么不在全部里」+ 一次性恢复 ---------- */
.archive-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 38px;
  margin-bottom: var(--space-2);
  padding: 0 var(--space-3);
  background: var(--sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.archive-bar .ab-lead b { font-weight: 650; color: var(--text); }
.archive-bar .ab-sub { font-size: var(--text-xs); color: var(--text-muted); }
.archive-bar .ab-sp { flex: 1; }
.archive-bar .ab-btn {
  height: 26px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.archive-bar .ab-btn:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.archive-bar .ab-btn:disabled { color: var(--text-faint); }

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
  font-weight: 650;
  color: var(--text-canvas-meta);
  letter-spacing: 0.02em;
  padding: var(--space-2) 0 var(--space-2) var(--space-1);
  /* 与 .page-bar 同一条画布配方（materials.css --bg-app）：吸顶件若铺平色（原先 var(--bg)）
     会把画布光晕压掉一档，静止时就显出一条亮带。fixed 附着让它取到身后那一小条视口切片 */
  background: var(--bg-app);
  background-attachment: fixed;
}
.day-head.pinned { color: var(--accent); }
.day-count { font-weight: 400; color: var(--text-canvas-meta); }
.day-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.memo-skeleton {
  background: var(--bg-surface);
  border: 1px solid var(--border);
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
  border-left: 1px solid var(--border-navigation);
  background: var(--bg-sidebar);
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: var(--space-4) var(--space-2) var(--space-4);
  display: flex;
  flex-direction: column;
}
.rail-title {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-nav-label);
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
/* 右栏激活态比左导航更安静：吃 chrome hover 灰、正文色、加粗，不染主色
   （左导航才是主色淡染行；两栏同为「选中」但层级不同，见 mock .rail-right a.on） */
.rail-item.active { background: var(--hover-chrome); color: var(--text); font-weight: 600; }
.rail-item.danger { color: var(--danger); }
.rail-item.danger:hover { background: var(--danger-soft); }
.rail-item .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 窄窗口下侧栏浮在流的上方，而不是把书写流挤扁。
   通高从内容顶开始：与宽窗的停靠态同一口径，搜索行让到侧栏左沿（见 .rail-over .page-bar），
   「展开侧栏」那颗钮不会被盖住，开了关得掉 */
.rail.overlay {
  background: var(--bg-nav-overlay);
  background-attachment: var(--nav-overlay-background-attachment);
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  box-shadow: var(--shadow-pop);
  border-left: 1px solid var(--border-navigation);
}
/* .page-bar 的右沿本来停在 .stream-inner 的内距处，侧栏左沿比它再往左 var(--page-gutter) */
.notes-page.rail-over .page-bar { padding-right: calc(var(--rail-w) - var(--page-gutter)); }
.rail-sep { height: 1px; flex-shrink: 0; background: var(--border); margin: var(--space-3) var(--space-2); }
.rail-empty { font-size: var(--text-sm); color: var(--text-nav-label); padding: 0 var(--space-2); }
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
