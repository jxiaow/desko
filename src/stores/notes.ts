import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { notesApi as api } from '../services/api/notes'
import { useToastStore } from './toast'
import { useConfirmStore } from './confirm'
import { extractTags, getDateGroupLabel, deriveTitleFromHtml, htmlToText } from '../utils/format'
import { collectAttachmentPaths } from '../services/attachmentSrc'
import type { Note, Attachment } from '../types'

export type NoteView = 'all' | 'pinned' | 'starred'
export type NoteSort = 'new' | 'old' | 'updated'
export type NoteSaveState = '' | 'saving' | 'saved'

export interface NoteGroup {
  label: string
  pinned: boolean
  notes: Note[]
}

const AUTOSAVE_DELAY = 600
const SAVED_HINT_DELAY = 1500

/** content_html -> 派生的纯文本与标签，避免每次筛选都重新解析 */
const META_CACHE_LIMIT = 400
const metaCache = new Map<string, { text: string; tags: string[] }>()

function noteMeta(html: string) {
  let meta = metaCache.get(html)
  if (!meta) {
    const text = htmlToText(html)
    meta = { text, tags: extractTags(text) }
    if (metaCache.size >= META_CACHE_LIMIT) metaCache.clear()
    metaCache.set(html, meta)
  }
  return meta
}

export const useNotesStore = defineStore('notes', () => {
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()

  const notes = ref<Note[]>([])
  const notesLoading = ref(false)

  // 筛选状态
  const noteSearchKeyword = ref('')
  const noteView = ref<NoteView>('all')
  const activeTags = ref<Set<string>>(new Set())
  const noteSort = ref<NoteSort>('new')
  // 右窄栏默认收起，列表占满宽度；顶栏按钮展开后跟着会话走，宽度不够时另有浮层侧栏
  const noteRailCollapsed = ref(true)

  // 批量操作状态
  const isBatchMode = ref(false)
  const selectedNoteIds = ref<Set<string>>(new Set())

  // 附件按需在打开小记时加载：12 个命令共用一把锁，列表里逐条取会放大成 N+1
  const noteAttachments = ref<Record<string, Attachment[]>>({})

  const noteSaveState = ref<NoteSaveState>('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let hintTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSaveId: string | null = null

  const clearSaveTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  const tagCounts = computed<[string, number][]>(() => {
    const counts = new Map<string, number>()
    notes.value.forEach(n => {
      noteMeta(n.content_html).tags.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1))
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  const allTags = computed(() => tagCounts.value.map(([tag]) => tag))

  const viewCounts = computed<Record<NoteView, number>>(() => ({
    all: notes.value.length,
    pinned: notes.value.filter(n => n.pinned).length,
    starred: notes.value.filter(n => n.starred).length,
  }))

  const hasActiveFilters = computed(
    () => !!noteSearchKeyword.value || noteView.value !== 'all' || activeTags.value.size > 0,
  )

  const filteredNotes = computed(() => {
    let result = notes.value.slice()

    const kw = noteSearchKeyword.value.trim().toLowerCase()
    if (kw) {
      result = result.filter(n =>
        n.title.toLowerCase().includes(kw) || noteMeta(n.content_html).text.toLowerCase().includes(kw))
    }

    if (noteView.value === 'pinned') result = result.filter(n => n.pinned)
    else if (noteView.value === 'starred') result = result.filter(n => n.starred)

    if (activeTags.value.size > 0) {
      result = result.filter(n => noteMeta(n.content_html).tags.some(t => activeTags.value.has(t)))
    }

    const sort = noteSort.value
    result.sort((a, b) => {
      if (sort === 'old') return a.created_at - b.created_at
      if (sort === 'updated') return b.updated_at - a.updated_at
      return b.created_at - a.created_at
    })
    return result
  })

  const groupedNotes = computed<NoteGroup[]>(() => {
    const groups: NoteGroup[] = []
    const list = filteredNotes.value
    const pinned = list.filter(n => n.pinned)
    if (pinned.length > 0) groups.push({ label: '置顶', pinned: true, notes: pinned })

    const buckets = new Map<string, Note[]>()
    list.forEach(note => {
      if (note.pinned) return
      const label = getDateGroupLabel(note.created_at)
      const bucket = buckets.get(label)
      if (bucket) bucket.push(note)
      else buckets.set(label, [note])
    })

    const ordered = [...buckets.entries()]
    if (noteSort.value === 'old') ordered.reverse()
    ordered.forEach(([label, items]) => groups.push({ label, pinned: false, notes: items }))
    return groups
  })

  const findNote = (id: string) => notes.value.find(n => n.id === id) ?? null

  const fetchNotes = async () => {
    notesLoading.value = true
    try {
      notes.value = await api.listNotes()
    } catch (e: any) {
      toastStore.showToast('加载小记失败: ' + e.message, 'error')
    } finally {
      notesLoading.value = false
    }
  }

  /** 发布一条小记；正文既无文字也无图片时不做任何事，返回新记录供调用方接续操作 */
  const publishNote = async (html: string): Promise<Note | null> => {
    const imagePaths = collectAttachmentPaths(html)
    if (!noteMeta(html).text.trim() && !imagePaths.length) return null
    const category = noteMeta(html).tags[0]
    try {
      const note = await api.createNote({
        title: deriveTitleFromHtml(html),
        content_html: html,
        category,
      })
      // 正文引用的 staged 图片此刻才登记成附件，删小记才能连带清文件
      if (imagePaths.length) {
        try {
          const bound = await api.bindAttachments(note.id, imagePaths)
          noteAttachments.value[note.id] = [...bound, ...(noteAttachments.value[note.id] ?? [])]
        } catch (e: any) {
          toastStore.showToast('附件登记失败：' + e.message, 'error')
        }
      }
      notes.value = [note, ...notes.value]
      return note
    } catch (e: any) {
      toastStore.showToast('创建失败：' + e.message, 'error')
      return null
    }
  }

  const commitSave = async () => {
    const id = pendingSaveId
    if (!id) return
    clearSaveTimer()
    pendingSaveId = null

    const note = findNote(id)
    if (!note) return
    noteSaveState.value = 'saving'
    try {
      await api.updateNote(note.id, {
        title: note.title,
        content_html: note.content_html,
        category: note.category ?? undefined,
      })
      // 编辑态新贴的图也要登记，否则文件没人认领（发布路径做了，保存路径漏了）
      const paths = collectAttachmentPaths(note.content_html)
      if (paths.length) {
        const known = new Set((noteAttachments.value[note.id] ?? []).map(a => a.file_path))
        const fresh = paths.filter(p => !known.has(p))
        if (fresh.length) {
          try {
            const bound = await api.bindAttachments(note.id, fresh)
            if (bound.length) {
              noteAttachments.value[note.id] = [...bound, ...(noteAttachments.value[note.id] ?? [])]
            }
          } catch (e: any) {
            toastStore.showToast('附件登记失败：' + e.message, 'error')
          }
        }
      }
      noteSaveState.value = 'saved'
      if (hintTimer) clearTimeout(hintTimer)
      hintTimer = setTimeout(() => { noteSaveState.value = '' }, SAVED_HINT_DELAY)
    } catch (e: any) {
      noteSaveState.value = ''
      toastStore.showToast('保存失败：' + e.message, 'error')
    }
  }

  /** 正文改动立即写回列表（保持列表与书写面一致），再防抖落盘 */
  const saveNoteContent = (id: string, html: string) => {
    const idx = notes.value.findIndex(n => n.id === id)
    if (idx < 0) return
    const meta = noteMeta(html)
    notes.value[idx] = {
      ...notes.value[idx],
      content_html: html,
      title: deriveTitleFromHtml(html),
      category: meta.tags[0] ?? null,
      updated_at: Date.now(),
    }
    pendingSaveId = id
    noteSaveState.value = 'saving'
    clearSaveTimer()
    saveTimer = setTimeout(commitSave, AUTOSAVE_DELAY)
  }

  /** 切换书写面或卸载前调用，避免防抖窗口内的最后一次编辑丢失 */
  const flushNoteSave = async () => {
    if (!saveTimer) return
    await commitSave()
  }

  const clearFilters = () => {
    noteSearchKeyword.value = ''
    noteView.value = 'all'
    activeTags.value = new Set()
  }

  const toggleTagFilter = (tag: string) => {
    const next = new Set(activeTags.value)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    activeTags.value = next
  }

  const doDeleteNote = (note: Note) => {
    const preview = noteMeta(note.content_html).text.slice(0, 20) || '无内容'
    confirmStore.showConfirm('确认删除', `确定删除这条小记吗？\n\n“${preview}”`, async () => {
      try {
        await api.deleteNote(note.id)
        notes.value = notes.value.filter(n => n.id !== note.id)
        selectedNoteIds.value.delete(note.id)
        toastStore.showToast('小记已删除')
      } catch (e: any) {
        toastStore.showToast('删除失败：' + e.message, 'error')
      }
    })
  }

  const togglePin = async (note: Note) => {
    try {
      const newPinned = await api.togglePinNote(note.id)
      const idx = notes.value.findIndex(n => n.id === note.id)
      if (idx >= 0) notes.value[idx] = { ...notes.value[idx], pinned: newPinned }
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
    }
  }

  const toggleStar = async (note: Note) => {
    try {
      const newStarred = await api.toggleStarNote(note.id)
      const idx = notes.value.findIndex(n => n.id === note.id)
      if (idx >= 0) notes.value[idx] = { ...notes.value[idx], starred: newStarred }
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
    }
  }

  const toggleBatchMode = () => {
    isBatchMode.value = !isBatchMode.value
    if (!isBatchMode.value) selectedNoteIds.value = new Set()
  }

  const toggleSelectNote = (id: string) => {
    const next = new Set(selectedNoteIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedNoteIds.value = next
  }

  const selectAllNotes = () => {
    selectedNoteIds.value = new Set(filteredNotes.value.map(n => n.id))
  }

  const clearSelection = () => {
    selectedNoteIds.value = new Set()
  }

  const batchDelete = () => {
    const ids = Array.from(selectedNoteIds.value)
    if (ids.length === 0) return
    confirmStore.showConfirm('确认删除', `确定删除选中的 ${ids.length} 条小记吗？`, async () => {
      try {
        await api.batchDeleteNotes(ids)
        notes.value = notes.value.filter(n => !ids.includes(n.id))
        selectedNoteIds.value = new Set()
        isBatchMode.value = false
        toastStore.showToast(`已删除 ${ids.length} 条小记`)
      } catch (e: any) {
        toastStore.showToast('删除失败：' + e.message, 'error')
      }
    })
  }

  const batchSetPinned = async (pinned: boolean) => {
    const ids = Array.from(selectedNoteIds.value)
      .filter(id => findNote(id)?.pinned !== pinned)
    for (const id of ids) {
      try {
        await api.togglePinNote(id)
        const note = findNote(id)
        if (note) note.pinned = pinned
      } catch (e: any) {
        toastStore.showToast('操作失败：' + e.message, 'error')
      }
    }
    toastStore.showToast(ids.length ? `已${pinned ? '置顶' : '取消置顶'} ${ids.length} 条小记` : '没有需要变更的小记')
  }

  const batchSetStarred = async (starred: boolean) => {
    const ids = Array.from(selectedNoteIds.value)
      .filter(id => findNote(id)?.starred !== starred)
    for (const id of ids) {
      try {
        await api.toggleStarNote(id)
        const note = findNote(id)
        if (note) note.starred = starred
      } catch (e: any) {
        toastStore.showToast('操作失败：' + e.message, 'error')
      }
    }
    toastStore.showToast(ids.length ? `已${starred ? '收藏' : '取消收藏'} ${ids.length} 条小记` : '没有需要变更的小记')
  }

  const loadAttachments = async (noteId: string) => {
    if (noteAttachments.value[noteId]) return
    try {
      noteAttachments.value[noteId] = await api.listAttachments(noteId)
    } catch (e: any) {
      toastStore.showToast('加载附件失败：' + e.message, 'error')
    }
  }

  const uploadAttachment = async (noteId: string, filePath: string) => {
    try {
      const attachment = await api.uploadAttachment(noteId, filePath)
      noteAttachments.value[noteId] = [attachment, ...(noteAttachments.value[noteId] ?? [])]
      toastStore.showToast('附件已上传')
      return attachment
    } catch (e: any) {
      toastStore.showToast('上传失败：' + e.message, 'error')
      return null
    }
  }

  /** 草稿阶段用：文件收进附件目录但不入库，发布时按正文补记录 */
  const stageImage = async (filePath: string): Promise<Attachment | null> => {
    try {
      return await api.stageAttachment(filePath)
    } catch (e: any) {
      toastStore.showToast('图片读取失败：' + e.message, 'error')
      return null
    }
  }

  const deleteAttachment = async (noteId: string, attachmentId: string) => {
    try {
      await api.deleteAttachment(attachmentId)
      noteAttachments.value[noteId] = (noteAttachments.value[noteId] ?? []).filter(a => a.id !== attachmentId)
      toastStore.showToast('附件已删除')
    } catch (e: any) {
      toastStore.showToast('删除失败：' + e.message, 'error')
    }
  }

  return {
    notes, notesLoading,
    noteSearchKeyword, noteView, activeTags, noteSort, hasActiveFilters,
    noteRailCollapsed,
    isBatchMode, selectedNoteIds,
    noteAttachments, noteSaveState,
    tagCounts, allTags, viewCounts, filteredNotes, groupedNotes,
    fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
    doDeleteNote, togglePin, toggleStar,
    toggleBatchMode, toggleSelectNote, selectAllNotes, clearSelection,
    batchDelete, batchSetPinned, batchSetStarred,
    loadAttachments, uploadAttachment, deleteAttachment, stageImage,
  }
})
