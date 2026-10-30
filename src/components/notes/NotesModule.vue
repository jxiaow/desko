<script setup lang="ts">
import { isWebRuntime } from '../../services/runtime'
import { pickBrowserImage } from '../../services/browserImage'
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch, watchEffect } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotesStore } from '../../stores/notes'
import { useToastStore } from '../../stores/toast'
import { useClipboard } from '../../composables/useClipboard'
import { usePageActive } from '../../composables/usePageActive'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import NoteLockDialog from './NoteLockDialog.vue'
import NoteExportController from './NoteExportController.vue'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import CreateAction from '../shared/CreateAction.vue'
import { htmlToLinkText, htmlToText } from '../../utils/format'
import { isPageShortcutBlocked } from '../../utils/pageShortcuts'
import { attachmentSrc, collectAttachmentNames, type SaveImage } from '../../services/attachmentSrc'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { IconName } from '../../utils/icons'
import type { Note } from '../../types'
import type { NoteView } from '../../stores/notes'
import { usePageHeadStore } from '../../stores/pageHead'
import type { NoteExportFormat } from '../../utils/noteExport'
import { useWorkspaceLayout, workspaceDirectoryTarget, workspaceToolbarTarget, workspaceSurfaceTarget } from '../layout/workspaceLayout'
import WorkspaceDirectoryToggle from '../layout/WorkspaceDirectoryToggle.vue'

const workspaceLayout = useWorkspaceLayout()
const pageActive = usePageActive()

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
  noteRailCollapsed, noteRailPinned, noteDraftHtml: draftHtml,
  isBatchMode, hasNoteSelection, selectedNoteIds, hiddenSelectedNotes, isMergingNotes, noteAttachments, noteSaveState, notePlains, noteKey,
  tagCounts, viewCounts, filteredNotes, archivedNotes, archiveSummary,
} = storeToRefs(notesStore)
const {
  fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
  doDeleteNote, togglePin, toggleStar, setArchived, batchSetArchived, unarchiveAllFiltered,
  lockNote, unlockNote, relockNote, removeNoteLock, relockNoteDomain,
  toggleSelectNote, selectAllNotes, clearSelection, toggleNotePick, exitNoteBatch,
  batchDelete, mergeSelectedNotes, batchSetPinned, batchSetStarred,  loadAttachments, uploadAttachment, deleteAttachment, stageImage,
} = notesStore

const pageEl = ref<HTMLElement | null>(null)
const railEl = ref<HTMLElement | null>(null)
const railToggleEl = ref<HTMLButtonElement | null>(null)
const searchEl = ref<HTMLInputElement | null>(null)
const viewportWidth = ref(window.innerWidth)
const moreTagsOpen = ref(false)
const moreTagsAnchor = ref<HTMLElement | null>(null)
const tagQuery = ref('')
const kbdHint = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
const composerRef = ref<InstanceType<typeof NoteComposer> | null>(null)
const fsRef = ref<InstanceType<typeof NoteFullscreen> | null>(null)
const cardRefs = ref<InstanceType<typeof NoteCard>[]>([])
const batchMoreAnchor = ref<HTMLButtonElement | null>(null)
const batchMoreOpen = ref(false)
watch([isBatchMode, hasNoteSelection], ([batch, selected]) => {
  if (!batch || !selected) batchMoreOpen.value = false
})

/** 任何时刻只有一个书写面：草稿正文、就地展开的 note id、全屏层目标与其模式 */
const editingId = ref<string | null>(null)
const fsTarget = ref<'new' | string | null>(null)
const fsMode = ref<'edit' | 'view'>('edit')
let fullscreenReturnFocus: HTMLElement | null = null
/** 全库小记口令弹窗：mode 决定要输什么，thenLock 是口令到手后要补做的那次加密 */
const keyDialog = ref<{ mode: 'setup' | 'unlock' | 'change'; thenLock?: string } | null>(null)
const exportRequest = ref<{ ids: string[]; scopeLabel: string; format?: NoteExportFormat; hidden?: number } | null>(null)
const exportAllCount = computed(() => notes.value.filter(note => note.archived === (noteView.value === 'archived')).length)
/** hidden：点了「导出」这一刻攒在 S 里、但不在本屏的条数，结果 toast 要说清口径 */
const exportNotes = (ids: string[], scopeLabel: string, format?: NoteExportFormat, hidden = 0) => {
  if (!exportRequest.value && ids.length) exportRequest.value = { ids, scopeLabel, format, hidden }
}
const exportAll = () => exportNotes(notes.value.filter(note => note.archived === (noteView.value === 'archived')).map(note => note.id), noteView.value === 'archived' ? '全部归档小记' : '全部未归档小记')

/** 便签流：置顶只换一条 18px 小标，不再按日期切章；置顶条仍按时间排在最前 */
const pinnedNotes = computed(() => filteredNotes.value.filter(note => note.pinned))
const streamNotes = computed(() => pinnedNotes.value.concat(filteredNotes.value.filter(note => !note.pinned)))

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
const railFloatingOpen = ref(false)

/** 侧栏真正在流内可见 = 放得下 且 用户没收起 */
const showFilters = computed(() => notes.value.length > 0 || hasActiveFilters.value)
const railOpen = computed(() => showFilters.value && railRoom.value && !noteRailCollapsed.value)
const railOverlay = computed(() => showFilters.value && !workspaceLayout && !railRoom.value && railFloatingOpen.value)
const railVisible = computed(() => showFilters.value && (workspaceLayout || railOpen.value || railOverlay.value))
const closeRail = () => {
  noteRailCollapsed.value = true
  railFloatingOpen.value = false
}
const toggleRail = () => {
  if (railVisible.value) return closeRail()
  noteRailCollapsed.value = false
  railFloatingOpen.value = !railRoom.value
}
/** 收侧栏会抽走一整列宽（--rail-w）：按下去就收，同一次点击的 mousedown/mouseup 会落到不同元素上，
    行尾那颗动作钮（以及它下面的卡头）就成了被吞掉的第一击。改在 click 之后收，钮自己先吃完这次点击 */
const onRailOutsideClick = (event: MouseEvent) => {
  if (!pageActive.value) return
  if (workspaceLayout || !railVisible.value || noteRailPinned.value || !(event.target instanceof Node)) return
  if (railEl.value?.contains(event.target) || railToggleEl.value?.contains(event.target)) return
  closeRail()
}
const selectView = (view: NoteView) => {
  // 标签计数不含归档条目，带着旧标签进归档只会得到没有可见原因的空列表。
  if (view === 'archived' && activeTags.value.size) activeTags.value = new Set()
  noteView.value = view
  if (isWebRuntime() && railOverlay.value && !noteRailPinned.value) closeRail()
}
watch(railRoom, (room) => {
  if (room) railFloatingOpen.value = false
  else if (noteRailPinned.value && !noteRailCollapsed.value) railFloatingOpen.value = true
})

const draftText = computed(() => htmlToText(draftHtml.value))
const draftEmpty = computed(() => !draftText.value.trim() && !collectAttachmentNames(draftHtml.value).length)
/** 归档视图只读不回书写面：书写框收掉，页栏搜索改口径 */
const isArchivedView = computed(() => noteView.value === 'archived')
const tagLimit = computed(() => viewportWidth.value <= 1100 ? 4 : viewportWidth.value <= 1400 ? 5 : 6)
/** 已选标签优先占位，其余按使用频次补满；超出的进「更多标签」。 */
const visibleTagCounts = computed<[string, number][]>(() => {
  if (tagCounts.value.length <= tagLimit.value) return tagCounts.value
  const selected = tagCounts.value.filter(([tag]) => activeTags.value.has(tag))
  const rest = tagCounts.value.filter(([tag]) => !activeTags.value.has(tag))
  const visible = new Set([...selected, ...rest].slice(0, tagLimit.value).map(([tag]) => tag))
  return tagCounts.value.filter(([tag]) => visible.has(tag))
})
const hiddenTagCounts = computed(() => tagCounts.value.filter(([tag]) => !visibleTagCounts.value.some(([visible]) => visible === tag)))
const filteredMoreTags = computed(() => {
  const query = tagQuery.value.trim().toLowerCase()
  return query ? hiddenTagCounts.value.filter(([tag]) => tag.toLowerCase().includes(query)) : hiddenTagCounts.value
})
const toggleMoreTags = (el: HTMLElement) => {
  if (moreTagsOpen.value) { moreTagsOpen.value = false; return }
  moreTagsAnchor.value = el
  tagQuery.value = ''
  moreTagsOpen.value = true
}
/** 顶栏那个总数跟着视图走：归档行不该计进「全部」的条数里 */
const headTotal = computed(() => (isArchivedView.value ? viewCounts.value.archived : viewCounts.value.all))
/** 空态分「没搜到」还是「这个视图本来就空」：光切视图不算无果，各视图自己说清内容从哪来 */
const hasQueryFilter = computed(() => !!noteSearchKeyword.value.trim() || activeTags.value.size > 0)
const emptyState = computed<{ icon: IconName; title: string; desc: string }>(() => {
  if (hasQueryFilter.value) return { icon: 'searchEmpty', title: '未找到匹配的小记', desc: '试试清空筛选或其他关键词' }
  if (isArchivedView.value) return { icon: 'archive', title: '还没有归档的小记', desc: '在小记菜单中选择「归档」' }
  if (noteView.value === 'pinned') return { icon: 'pin', title: '还没有置顶的小记', desc: '在小记菜单中选择「置顶」' }
  if (noteView.value === 'starred') return { icon: 'star', title: '还没有收藏的小记', desc: '在小记菜单中选择「收藏」' }
  return { icon: 'navNotes', title: '还没有小记', desc: '在上方写第一条' }
})
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

/** 页头主钮：长列表滚下去后一键回到书写面（聚焦本身会把它带回视口） */
const startWriting = () => composerRef.value?.focus()

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
// 页栏与卡片勾选共用保存边界；保存失败时保留编辑面，不进入批量操作。
const toggleBatchMode = async () => {
  if (isBatchMode.value) { exitNoteBatch(); return }
  try { await closeCard() } catch { return }
  toggleNotePick()
}
const selectNote = async (id: string) => {
  if (editingId.value) {
    try { await closeCard() } catch { return }
  }
  toggleSelectNote(id)
}
const openFullscreen = async (target: 'new' | string, mode: 'edit' | 'view' = 'edit') => {
  fullscreenReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
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
  // 阅读切编辑会重建全屏组件，返回位置由页面保存，等原页重新可见再恢复。
  await nextTick()
  if (wasNew) composerRef.value?.focus()
  else if (fullscreenReturnFocus?.isConnected) fullscreenReturnFocus.focus({ preventScroll: true })
  fullscreenReturnFocus = null
}
const filterFullscreenTag = async (tag: string) => {
  await closeFullscreen()
  toggleTagFilter(tag)
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

/** 一张图的三条来路（选图按钮、Ctrl+V、拖进来的文件）都收口到这一颗：落盘 → 正文该用的 src */
const saveImage: SaveImage = async (source, noteId) => {
  // 页面已经收掉就不能再落盘：迟到的选图/拖放会写进下一段会话
  if (!active) return null
  const att = noteId ? await uploadAttachment(noteId, source) : await stageImage(source)
  if (!active || !att?.mime_type.startsWith('image/')) return null
  return attachmentSrc(att.file_path)
}

/** 图落好盘，补进当前那张书写面：全屏优先，其次就地展开的卡，最后胶囊草稿 */
const applyImage = (target: 'new' | string, src: string) => {
  if (fsTarget.value === target) fsRef.value?.insertImage(src)
  else if (target === 'new') composerRef.value?.insertImage(src)
  else cardRefs.value?.find((c) => c.noteId === target)?.insertImage(src)
}

/** 现在该往哪张面写：全屏 → 就地展开的卡 → 胶囊草稿；归档视图里没有书写面 */
const imageTarget = (): 'new' | string | null => {
  if (fsTarget.value) return fsTarget.value
  if (editingId.value) return editingId.value
  return isArchivedView.value ? null : 'new'
}

/** 已有小记配图：落盘即登记附件，再把图片块补进当前打开的书写面 */
const addImageToNote = async (noteId: string) => {
  const path = await pickImagePath()
  if (!path) return
  const src = await saveImage(path, noteId)
  if (src) applyImage(noteId, src)
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
  const src = await saveImage(path, null)
  if (src) applyImage('new', src)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i

/** 拖进小记页只收图片：别的文件该走局域网传输那条。
 *  桌面侧路径来自窗口级原生事件（HTML5 的 dataTransfer 在这里给不出真实路径），
 *  只有浏览器那侧才拿得到 File，走 DOM 事件 */
const dropImages = async (sources: (File | string)[]) => {
  const images = sources.filter((source) =>
    typeof source === 'string' ? IMAGE_EXT.test(source) : source.type.startsWith('image/'))
  if (!images.length) return
  const target = imageTarget()
  if (!target) {
    toastStore.showToast('归档视图里不能写，先退出归档', 'error')
    return
  }
  for (const source of images) {
    const src = await saveImage(source, target === 'new' ? null : target)
    if (src) applyImage(target, src)
  }
}

const onDomDragOver = (event: DragEvent) => { if (isWebRuntime()) event.preventDefault() }
const onDomDrop = (event: DragEvent) => {
  if (!isWebRuntime()) return
  event.preventDefault()
  void dropImages(Array.from(event.dataTransfer?.files ?? []))
}

const copyNote = (note: Note) =>
  copyRichToClipboard(note.content_html, htmlToLinkText(note.content_html), '小记')

const onKeyDown = (e: KeyboardEvent) => {
  if (!pageActive.value) return
  if (isPageShortcutBlocked(e)) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (fsTarget.value) return
    e.preventDefault()
    searchEl.value?.focus()
    return
  }
  if (e.key !== 'Escape' || fsTarget.value) return
  if (editingId.value) closeCard()
  else if (isBatchMode.value) exitNoteBatch()
  else if (!workspaceLayout && railVisible.value && !noteRailPinned.value) closeRail()
}

// 全屏里删掉当前这条之后，书写面要跟着收掉
watch(notes, () => {
  if (typeof fsTarget.value === 'string' && !findNote(fsTarget.value)) fsTarget.value = null
})

let observer: ResizeObserver | null = null
let unlistenDrag: (() => void) | undefined
const onResize = () => { viewportWidth.value = window.innerWidth }
onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', onResize)
  if (!workspaceLayout) document.addEventListener('click', onRailOutsideClick, true)
  if (!isWebRuntime()) {
    // 桌面侧拖进来的文件只有原生层知道路径，与局域网传输吃同一窗口级事件；
    // 落点坐标在这套事件里不可靠，所以只看"当前哪张书写面开着"
    void getCurrentWebview().onDragDropEvent((event) => {
      if (!pageActive.value) return
      if (event.payload.type === 'drop') void dropImages(event.payload.paths)
    }).then((unlisten) => {
      if (active) unlistenDrag = unlisten
      else unlisten()
    })
  }
  const root = pageEl.value
  if (!root || workspaceLayout) return
  const minRoom = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--rail-min-room'))
    || RAIL_FALLBACK_ROOM
  observer = new ResizeObserver((entries) => {
    if (!pageActive.value) return
    const next = entries[0].contentRect.width >= minRoom
    // 只在真正跨越阈值时改状态：回调里换实例会让 ResizeObserver 无限循环
    if (next !== railRoom.value) railRoom.value = next
  })
  observer.observe(root)
})
onDeactivated(() => { void flushNoteSave().catch(() => {}) })
onBeforeUnmount(() => {
  active = false
  void flushNoteSave().catch(() => {})
  document.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onRailOutsideClick, true)
  unlistenDrag?.()
  observer?.disconnect()
  observer = null
})

const pageHead = usePageHeadStore()
watchEffect(() => {
  if (!pageActive.value) return
  const filtered = isArchivedView.value ? hasQueryFilter.value : hasActiveFilters.value
  const total = filtered ? `${filteredNotes.value.length} / ${headTotal.value}` : `${headTotal.value}`
  // 条数跟着视图换口径，顶栏就得把视图名一起报出来，否则「0 条」看着像总数算错
  const view = noteView.value === 'all' ? '' : `${VIEWS.find(v => v.key === noteView.value)?.label} · `
  pageHead.setHead('小记', `${view}${total} 条`)
})
</script>

<template>
  <div ref="pageEl" class="notes-page" :class="{ 'rail-over': railOverlay }" @dragover="onDomDragOver" @drop="onDomDrop">
    <div class="stream">
      <div class="stream-inner" @keydown="onStreamKeydown">
        <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
        <div class="page-bar">
          <div v-if="showFilters" class="search-box">
            <span class="search-icon"><AppIcon name="search" :size="16" /></span>
            <input
              ref="searchEl"
              v-model="noteSearchKeyword"
              type="text"
              :placeholder="isArchivedView ? '搜索归档小记…' : '搜索小记…'"
              :aria-label="isArchivedView ? '搜索归档小记' : '搜索小记'"
            />
            <kbd v-if="!noteSearchKeyword" class="search-kbd">{{ kbdHint }}</kbd>
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

          <div class="page-actions">
            <button
              class="bar-btn"
              :class="{ active: isBatchMode }"
              type="button"
              :title="isBatchMode ? '完成选择' : '选择小记'"
              :aria-label="isBatchMode ? '完成选择' : '选择小记'"
              @click="toggleBatchMode"
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
                :title="noteKey.is_open ? '锁定全部加密小记' : '解锁全部加密小记'"
                :aria-label="noteKey.is_open ? '锁定全部加密小记' : '解锁全部加密小记'"
                @click="toggleNoteDomain"
              >
                <AppIcon :name="noteKey.is_open ? 'lock' : 'unlock'" :size="16" />
              </button>
            </template>
            <button
              v-if="!workspaceLayout && showFilters"
              ref="railToggleEl"
              class="bar-btn"
              :class="{ active: railVisible }"
              type="button"
              :title="railVisible ? '收起侧栏' : '展开侧栏'"
              :aria-label="railVisible ? '收起侧栏' : '展开侧栏'"
              @click="toggleRail"
            >
              <AppIcon name="panel" :size="16" />
            </button>
            <WorkspaceDirectoryToggle v-if="isWebRuntime() && showFilters" />
            <CreateAction v-if="showFilters" class="notes-create" label="写小记" @click="startWriting" />
          </div>
        </div>
        </Teleport>

        <div v-if="workspaceLayout && !isWebRuntime() && showFilters" class="workspace-workbar notes-workbar">
          <nav class="workspace-workbar-tabs" aria-label="小记视图">
            <button
              v-for="v in VIEWS"
              :key="v.key"
              class="wb-tab"
              :class="{ active: noteView === v.key }"
              type="button"
              :aria-pressed="noteView === v.key"
              @click="selectView(v.key)"
            >
              <span>{{ v.label }}</span>
              <span class="wb-count">{{ viewCounts[v.key] }}</span>
            </button>
          </nav>
          <template v-if="!isArchivedView && tagCounts.length">
            <span class="wb-divider" aria-hidden="true"></span>
            <div class="wb-tags" aria-label="小记标签">
              <button
                v-for="[tag, count] in visibleTagCounts"
                :key="tag"
                class="wb-tab"
                :class="{ active: activeTags.has(tag) }"
                type="button"
                :aria-pressed="activeTags.has(tag)"
                @click="toggleTagFilter(tag)"
              >
                <span>#{{ tag }}</span>
                <span class="wb-count">{{ count }}</span>
              </button>
              <button
                v-if="hiddenTagCounts.length"
                class="wb-tab wb-more"
                type="button"
                :aria-label="`更多标签，已收起 ${hiddenTagCounts.length} 项`"
                :aria-expanded="moreTagsOpen"
                @click="toggleMoreTags($event.currentTarget as HTMLElement)"
              >更多 <span class="wb-count">{{ hiddenTagCounts.length }}</span> <AppIcon name="chevDown" :size="13" /></button>
            </div>
          </template>
        </div>
        <PopoverMenu v-if="moreTagsOpen && moreTagsAnchor" :anchor="moreTagsAnchor" align="start" :width="224" @close="moreTagsOpen = false">
          <div class="tag-pop">
            <div class="search-box flat tag-pop-search">
              <AppIcon name="search" :size="13" />
              <input v-model="tagQuery" placeholder="搜索标签…" aria-label="搜索标签" />
            </div>
            <div class="tag-pop-list">
              <button
                v-for="[tag, count] in filteredMoreTags"
                :key="tag"
                class="pop-item"
                :class="{ on: activeTags.has(tag) }"
                type="button"
                :aria-pressed="activeTags.has(tag)"
                @click="toggleTagFilter(tag)"
              >
                <span class="tag-pop-name">#{{ tag }}</span>
                <span class="tag-pop-count">{{ count }}</span>
                <AppIcon v-if="activeTags.has(tag)" name="check" :size="14" />
              </button>
              <div v-if="!filteredMoreTags.length" class="tag-pop-empty">无匹配标签</div>
            </div>
          </div>
        </PopoverMenu>

        <div v-if="isArchivedView" class="archive-bar">
          <span class="ab-lead"><b>已归档</b> · 不出现在「全部」列表，可在本视图搜索</span>
          <span v-if="archiveSummary" class="ab-sub">{{ archiveSummary }}</span>
          <span class="ab-sp"></span>
          <button class="ab-btn" type="button" :disabled="!viewCounts.archived" @click="unarchiveAllFiltered">
            <AppIcon name="unarchive" :size="14" />全部取消归档
          </button>
        </div>

        <NoteComposer
          v-if="!isArchivedView && !isBatchMode"
          ref="composerRef"
          :html="draftHtml"
          :empty="draftEmpty"
          :save-image="saveImage"
          @update="draftHtml = $event"
          @publish="publishDraft"
          @add-image="addImageToDraft"
          @fullscreen="openFullscreen('new')"
        />

        <div v-if="notesLoading && !notes.length" class="slip-stream">
          <div v-for="n in 3" :key="n" class="memo-skeleton">
            <span class="sl sl-1"></span>
            <span class="sl sl-2"></span>
            <span class="sl sl-3"></span>
          </div>
        </div>

        <template v-else>
          <div class="slip-stream">
            <div v-if="pinnedNotes.length" class="slip-label">
              <AppIcon name="pin" :size="12" />
              <span>置顶</span>
              <span class="slip-label-count">{{ pinnedNotes.length }}</span>
            </div>
            <NoteCard
              v-for="note in streamNotes"
              :key="note.id"
              ref="cardRefs"
              :note="note"
              :editing="editingId === note.id"
              :save-image="saveImage"
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
              @select="selectNote(note.id)"
              @tag-click="toggleTagFilter($event)"
              @remove-attachment="deleteAttachment(note.id, $event)"
            />
          </div>
          <div v-if="!filteredNotes.length && notesLoadError" class="error-state">
            <div class="empty-icon">
              <AppIcon name="alert" :size="24" />
            </div>
            <div class="empty-title">加载失败</div>
            <div class="empty-desc">{{ notesLoadError }}</div>
            <button class="btn-secondary retry-btn" @click="fetchNotes()">重试</button>
          </div>

          <div v-else-if="!filteredNotes.length" class="empty-state" :class="{ 'is-filter': hasQueryFilter }">
            <div class="empty-icon">
              <AppIcon :name="emptyState.icon" :size="24" />
            </div>
            <div class="empty-title">{{ emptyState.title }}</div>
            <div class="empty-desc">{{ emptyState.desc }}</div>
            <!-- 空态明说「试试清空筛选」，清空入口却只长在导轨里——导轨在工作台布局下
                 是折起来的目录面板，用户得先去开一个面板才能执行一句话里提到的动作。
                 把动作放到句子下面，说到哪按到哪。 -->
            <button v-if="hasQueryFilter" class="btn-secondary empty-action" type="button" @click="clearFilters">清空筛选</button>
          </div>
        </template>
      </div>
    </div>

    <Teleport :to="workspaceDirectoryTarget" :disabled="!workspaceLayout || !pageActive" defer>
    <aside v-if="railVisible" ref="railEl" class="rail" :class="{ overlay: railOverlay, 'directory-notes': workspaceLayout }">
      <div v-if="!workspaceLayout" class="rail-title rail-heading">
        <span>视图</span>
        <div v-if="!workspaceLayout" class="rail-heading-actions">
          <button class="ib" :class="{ on: noteRailPinned }" type="button" :title="noteRailPinned ? '取消固定侧栏' : '固定侧栏'" :aria-label="noteRailPinned ? '取消固定侧栏' : '固定侧栏'" :aria-pressed="noteRailPinned" @click="noteRailPinned = !noteRailPinned">
            <AppIcon :name="noteRailPinned ? 'unpin' : 'pin'" :size="16" />
          </button>
          <button v-if="railOverlay && isWebRuntime()" class="ib" type="button" aria-label="关闭小记筛选" @click="closeRail"><AppIcon name="x" :size="16" /></button>
        </div>
      </div>
      <button
        v-for="v in VIEWS"
        :key="v.key"
        class="rail-item"
        :class="{ active: noteView === v.key, 'directory-link': workspaceLayout }"
        type="button"
        :aria-pressed="noteView === v.key"
        @click="selectView(v.key)"
      >
        <AppIcon :name="v.icon" :size="16" />
        <span class="nm">{{ v.label }}</span>
        <span class="tab-count">{{ viewCounts[v.key] }}</span>
      </button>

      <div v-if="!workspaceLayout" class="rail-sep"></div>
      <div class="rail-title" :class="{ 'directory-section-heading': workspaceLayout }"><span>标签</span><span v-if="workspaceLayout" class="directory-count">{{ tagCounts.length }}</span><template v-else> · {{ tagCounts.length }}</template></div>
      <button
        v-for="[tag, count] in tagCounts"
        :key="tag"
        class="rail-item"
        :class="{ active: activeTags.has(tag), 'directory-link': workspaceLayout }"
        type="button"
        :aria-pressed="activeTags.has(tag)"
        @click="toggleTagFilter(tag)"
      >
        <AppIcon v-if="workspaceLayout" name="tag" :size="16" />
        <span class="nm">{{ workspaceLayout ? tag : `#${tag}` }}</span>
        <span class="tab-count">{{ count }}</span>
      </button>
      <div v-if="!tagCounts.length" class="rail-empty">还没有标签</div>

      <!-- 红字只留给真清得掉的关键词/标签；切视图是轨道自己的事，不该长得像删东西 -->
      <template v-if="hasQueryFilter">
        <div v-if="!workspaceLayout" class="rail-sep"></div>
        <button class="rail-item danger" :class="{ 'directory-link directory-reset': workspaceLayout }" type="button" @click="clearFilters">
          <AppIcon name="x" :size="16" />
          <span class="nm">清空筛选</span>
        </button>
      </template>

      <div class="rail-foot">{{ railSummary }}</div>
    </aside>
    </Teleport>

    <div v-if="isBatchMode && !fsTarget" class="batch-dock">
      <span class="dock-count" :data-tip="hiddenSelectedNotes ? `其中 ${hiddenSelectedNotes} 条不在当前筛选结果里` : undefined">已选 {{ selectedNoteIds.size }} 条</span>
      <span v-if="!hasNoteSelection" class="dock-hint">点小记选择</span>
      <button class="dock-btn" type="button" :disabled="!filteredNotes.length" @click="selectAllNotes">
        <AppIcon name="checkall" :size="12" />{{ hasActiveFilters ? '全选筛选结果' : '全选' }}
      </button>
      <button class="dock-btn" type="button" :disabled="!selectedNoteIds.size" @click="clearSelection">
        <AppIcon name="x" :size="12" />{{ hasActiveFilters ? '取消本屏' : '取消全选' }}
      </button>
      <span class="dock-sep"></span>
      <button v-if="!isWebRuntime()" class="dock-btn" type="button" :disabled="!selectedNoteIds.size || !!exportRequest" @click="exportNotes([...selectedNoteIds], '已选小记', undefined, hiddenSelectedNotes)">
        <AppIcon name="download" :size="12" />导出
      </button>
      <button v-if="isArchivedView" class="dock-btn" type="button" :disabled="!hasNoteSelection" @click="batchSetArchived(false)">
        <AppIcon name="unarchive" :size="12" />取消归档
      </button>
      <template v-else>
      <button class="dock-btn" type="button" :disabled="!hasNoteSelection" @click="batchSetArchived(true)">
        <AppIcon name="archive" :size="12" />归档
      </button>
      <button ref="batchMoreAnchor" class="dock-btn" type="button" :disabled="!hasNoteSelection" aria-haspopup="menu" :aria-expanded="batchMoreOpen" @click="batchMoreOpen = !batchMoreOpen">
        更多<AppIcon name="chevDown" :size="12" />
      </button>
      <PopoverMenu v-if="batchMoreOpen" :anchor="batchMoreAnchor" :width="148" @close="batchMoreOpen = false">
        <button class="pop-item" type="button" @click="batchMoreOpen = false; batchSetPinned(true)"><AppIcon name="pin" :size="14" />置顶</button>
        <button class="pop-item" type="button" @click="batchMoreOpen = false; batchSetPinned(false)"><AppIcon name="unpin" :size="14" />取消置顶</button>
        <button class="pop-item" type="button" @click="batchMoreOpen = false; batchSetStarred(true)"><AppIcon name="star" :size="14" />收藏</button>
        <button class="pop-item" type="button" @click="batchMoreOpen = false; batchSetStarred(false)"><AppIcon name="star" :size="14" />取消收藏</button>
      </PopoverMenu>
      <button class="dock-btn" type="button" :disabled="selectedNoteIds.size < 2 || isMergingNotes" @click="mergeSelectedNotes">
        合并
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

    <Teleport :to="workspaceSurfaceTarget" :disabled="!workspaceLayout || !pageActive" defer>
    <NoteFullscreen
      v-if="fsTarget"
      :key="`${fsTarget}:${fsMode}`"
      ref="fsRef"
      :note="fsNote"
      :mode="fsMode"
      :save-image="saveImage"
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
      @toggle-archive="fsNote && setArchived(fsNote, !fsNote.archived)"
      @copy="fsNote && copyNote(fsNote)"
      @export="fsNote && exportNotes([fsNote.id], '单条小记', $event)"
      @encrypt="fsNote && requestEncrypt(fsNote.id)"
      @relock="fsNote && relockNote(fsNote.id)"
      @remove-lock="fsNote && requestRemoveLock(fsNote.id)"
      @delete="fsNote && doDeleteNote(fsNote)"
      @remove-attachment="fsNote && deleteAttachment(fsNote.id, $event)"
      @tag-click="filterFullscreenTag"
    />
    </Teleport>

    <NoteExportController v-if="exportRequest" :ids="exportRequest.ids" :format="exportRequest.format" :scope-label="exportRequest.scopeLabel" :hidden="exportRequest.hidden" @close="exportRequest = null" />

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
  /* 便签流：卡面只留三行给扫读，读全文去阅读层 */
  --memo-max-h: 72px;
}
.rail-heading { display: flex; align-items: center; justify-content: space-between; }
.rail-heading-actions { display: flex; align-items: center; gap: var(--space-1); }

.stream {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  overflow-x: hidden;
  scroll-behavior: smooth;
  /* 拆面轮：微光画布已上移到 .app-root，本页不再自铺 */
}
/* 一行一张：正常窗口铺满，宽窗跟壳层同一条阅读列（--workspace-content-max），
   非工作台布局（Web / 手机）退回 --stream-max。
   顶部不留内边距：首行是吸顶的 .page-bar，呼吸在它自己栏内出。
   工具栏、书写框与小记共用居中阅读列，窄窗口保留最小内距。 */
.stream-inner {
  width: 100%;
  padding: 0 var(--page-gutter) 22px;
  padding-inline: max(var(--page-gutter), calc((100% - var(--workspace-content-max, var(--stream-max))) / 2));
}
/* 96px 净空只服务批选底栏；没开批选时不留死白 */
.notes-page:has(.batch-dock) .stream-inner { padding-bottom: var(--dock-clearance); }
/* 书写框与吸顶栏拉开一档间距（列表页首行同款） */
.stream-inner .composer { margin-top: var(--space-2); }
.notes-workbar + .composer { margin-top: 0; }
/* 最小桌面窗让位给搜索：书写面就在首屏，页头不必再放一颗「写小记」。 */
@media (max-width: 899px) {
  .notes-create { display: none; }
}

/* 「更多标签」面板：保持打开以支持连续多选，搜索与选中状态都在面板内完成。 */
.tag-pop { width: 224px; display: flex; flex-direction: column; gap: var(--space-1); }
.tag-pop-search { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; }
.tag-pop-search input { flex: 1; min-width: 0; border: 0; background: none; padding: 0; outline: none; font: inherit; font-size: var(--text-sm); color: var(--text); }
.tag-pop-list { max-height: 220px; overflow-y: auto; scrollbar-gutter: stable; scrollbar-width: thin; }
.tag-pop-list .pop-item { display: flex; align-items: center; gap: 8px; }
.tag-pop-list .pop-item.on { background: var(--accent-soft); color: var(--text-brand); font-weight: 600; }
.tag-pop-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-pop-count { color: var(--text-muted); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.tag-pop-empty { padding: var(--space-2) 8px; color: var(--text-muted); font-size: var(--text-sm); text-align: center; }

/* ---------- 顶部工具条：吃 global.css 的 .page-bar 骨架（64px 吸顶画布），
   本页只有一处与全宽页不同：搜索框随流伸缩（上限 320）。
   栏内没有撑满剩余空间的左组，动作键得自己认领，否则全贴在搜索框右边、右端空一片 ---------- */
.page-bar .search-box { flex: 1; min-width: 80px; max-width: var(--page-search-max, 320px); }
/* 右段动作键之间的分组线收成分居的短细线——通高的竖线在 54px 页栏里像表格线。
   margin 归零：.page-bar 本身已有 8px gap，global 那条又自带 4px，两侧各叠成 12px，
   分组线两侧净距 25px、邻钮之间只有 8px，读起来像断成了两截。 */
.page-bar .bar-div { align-self: center; height: 16px; opacity: 0.55; margin: 0; }

/* ---------- 归档视图上下文条：一句话交代「这里的东西为什么不在全部里」+ 一次性恢复 ---------- */
.archive-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 38px;
  flex-wrap: wrap;
  row-gap: 4px;
  margin-bottom: var(--space-2);
  padding: 6px var(--space-3);
  background: var(--sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.archive-bar .ab-lead b { font-weight: 600; color: var(--text); }
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

/* ---------- 便签流：一列连续的纸片，没有日期章节 ---------- */
.slip-stream {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  padding-bottom: 8px;
}
/* 置顶只留一行小标，不吸顶：小记一天没几条，章节把流切得太碎。
   图钉 + 文字 + 计数，字色和字号跟工作栏页签的计数同一档。 */
.slip-label {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 18px;
  margin-top: 8px;
  padding-left: 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}
.slip-label :deep(svg) { color: var(--text-muted); flex: 0 0 auto; }
.slip-label-count { font-weight: 400; color: var(--text-muted); font-variant-numeric: tabular-nums; margin-left: -2px; }
/* 空态里的动作：比页头主钮小一档，和说明句同一条中轴，不抢「写小记」的位置 */
.empty-action {
  height: 30px;
  margin-top: var(--space-4);
  padding: 0 var(--space-4);
  font-size: var(--text-sm);
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
