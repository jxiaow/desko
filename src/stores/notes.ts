import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { notesApi as api } from '../services/api/notes'
import { useToastStore } from './toast'
import { useConfirmStore } from './confirm'
import { extractTags, getDateGroupLabel, deriveTitleFromHtml, headingTitle, htmlToText } from '../utils/format'
import { collectAttachmentNames, ensureAttachmentBase, nameOf, normalizeAssetHtml } from '../services/attachmentSrc'
import type { Note, Attachment } from '../types'
import type { NoteKeyStatus, NotePlain } from '../services/api/notes'

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

export function noteMeta(html: string) {
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
  /** 上一次 fetchNotes 的失败原因；视图据此把"加载失败"和"还没有小记"分开 */
  const notesLoadError = ref<string | null>(null)

  // 筛选状态
  const noteSearchKeyword = ref('')
  const noteView = ref<NoteView>('all')
  const activeTags = ref<Set<string>>(new Set())
  const noteSort = ref<NoteSort>('new')
  // 右窄栏默认收起，列表占满宽度；顶栏按钮展开后跟着会话走，宽度不够时另有浮层侧栏
  const noteRailCollapsed = ref(true)

  // 批量操作状态：勾选即进、清空即收；工具栏「选择」钮另开一层待选态（显形全部勾选框）
  const selectedNoteIds = ref<Set<string>>(new Set())
  const notePickMode = ref(false)
  const hasNoteSelection = computed(() => selectedNoteIds.value.size > 0)
  const isBatchMode = computed(() => notePickMode.value || hasNoteSelection.value)

  // 附件按需在打开小记时加载：12 个命令共用一把锁，列表里逐条取会放大成 N+1
  const noteAttachments = ref<Record<string, Attachment[]>>({})

  /** 本会话已解锁的加密小记明文：唯一一份内存副本，应用锁定即清 */
  const notePlains = ref<Record<string, string>>({})
  const isUnlocked = (id: string) => notePlains.value[id] != null
  /** 全库一把小记口令的状态：设过没有、本会话解开没有 */
  const noteKey = ref<NoteKeyStatus>({ is_set: false, is_open: false })

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

  /** 只换正文：title 一律用库里的值（加密行存的是 Rust 按真标题规则算出来的那份），锁回时不必再清 */
  const withPlain = (n: Note): Note => {
    const plain = notePlains.value[n.id]
    if (!n.encrypted || plain == null) return n
    return { ...n, content_html: plain }
  }

  const fetchNotes = async () => {
    notesLoading.value = true
    try {
      // 图片 src 存的是相对形态，渲染要先有本机附件目录
      await ensureAttachmentBase()
      noteKey.value = await api.noteKeyStatus()
      const rows = await api.listNotes()
      // 页面刷新后 Rust 侧域密钥还在（应用没锁），把已解锁的明文找回来
      if (noteKey.value.is_open) {
        for (const r of rows) {
          if (r.encrypted && notePlains.value[r.id] == null) {
            try { notePlains.value[r.id] = await api.revealNote(r.id) } catch { /* 单条重锁过就是锁着 */ }
          }
        }
      }
      notes.value = rows.map(withPlain)
      notesLoadError.value = null
    } catch (e: any) {
      notesLoadError.value = e?.message || '加载小记失败'
      toastStore.showToast('加载小记失败: ' + e.message, 'error')
    } finally {
      notesLoading.value = false
    }
  }

  /** 发布一条小记；正文既无文字也无图片时不做任何事，返回新记录供调用方接续操作 */
  const publishNote = async (rawHtml: string): Promise<Note | null> => {
    // 编辑器给的是能直接显示的形态，落库前洗回相对写法
    const html = normalizeAssetHtml(rawHtml)
    const imageNames = collectAttachmentNames(html)
    if (!noteMeta(html).text.trim() && !imageNames.length) return null
    const category = noteMeta(html).tags[0]
    try {
      const note = await api.createNote({
        title: deriveTitleFromHtml(html),
        content_html: html,
        category,
      })
      // 正文引用的 staged 图片此刻才登记成附件，删小记才能连带清文件
      if (imageNames.length) {
        try {
          const bound = await api.bindAttachments(note.id, imageNames)
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
      const names = collectAttachmentNames(note.content_html)
      if (names.length) {
        const known = new Set((noteAttachments.value[note.id] ?? []).map(a => nameOf(a.file_path)))
        const fresh = names.filter(n => !known.has(n))
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
  const saveNoteContent = (id: string, rawHtml: string) => {
    const idx = notes.value.findIndex(n => n.id === id)
    if (idx < 0) return
    // 落库的永远是相对形态
    const html = normalizeAssetHtml(rawHtml)
    const meta = noteMeta(html)
    notes.value[idx] = {
      ...notes.value[idx],
      content_html: html,
      title: deriveTitleFromHtml(html),
      category: meta.tags[0] ?? null,
      updated_at: Date.now(),
    }
    // 加密行改的每个字都要跟着明文副本走，落盘时由 Rust 重新封进密文
    if (notes.value[idx].encrypted) notePlains.value[id] = html
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
    confirmStore.showConfirm('删除小记', `“${preview}”将被删除，此操作不可撤销。`, async () => {
      try {
        await api.deleteNote(note.id)
        notes.value = notes.value.filter(n => n.id !== note.id)
        delete notePlains.value[note.id]
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

  /** 口令到手：一次带回的明文全部填进会话，列表跟着换显示 */
  const applyPlains = (plains: NotePlain[]) => {
    plains.forEach(p => { notePlains.value[p.id] = p.html })
    notes.value = notes.value.map(withPlain)
  }

  /** 设置页在列表之外也要知道口令设过没有 */
  const refreshNoteKey = async () => {
    try {
      noteKey.value = await api.noteKeyStatus()
    } catch {
      /* 未解锁时本来就问不到，保持原样 */
    }
  }

  const setupNoteKey = async (passphrase: string): Promise<string | null> => {
    try {
      applyPlains(await api.noteKeySetup(passphrase))
      noteKey.value = { is_set: true, is_open: true }
      toastStore.showToast('小记口令已设好，加密小记全部解锁')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  const unlockNoteDomain = async (passphrase: string): Promise<string | null> => {
    try {
      applyPlains(await api.noteKeyUnlock(passphrase))
      noteKey.value = { ...noteKey.value, is_open: true }
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  /** 兜底：应用会话已解锁，域密钥用主密钥封条直接取回，一个字都不用输 */
  const recoverNoteDomain = async (): Promise<string | null> => {
    try {
      applyPlains(await api.noteKeyRecover())
      noteKey.value = { ...noteKey.value, is_open: true }
      toastStore.showToast('已用主密码解开小记')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  const relockNoteDomain = async () => {
    try {
      await api.noteKeyRelock()
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
      return
    }
    noteKey.value = { ...noteKey.value, is_open: false }
    hideAllPlains()
    toastStore.showToast('加密小记已全部锁回')
  }

  const changeNoteKey = async (passphrase: string): Promise<string | null> => {
    try {
      await api.noteKeyChange(passphrase)
      toastStore.showToast('小记口令已修改')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  /** 上锁：成功后本会话仍可读（DEK 留着），重锁走 relockNote */
  const lockNote = async (id: string): Promise<string | null> => {
    const idx = notes.value.findIndex(n => n.id === id)
    if (idx < 0) return '小记不存在'
    try {
      await api.lockNote(id)
      notePlains.value[id] = notes.value[idx].content_html
      notes.value[idx] = {
        ...notes.value[idx],
        encrypted: true,
        title: headingTitle(notes.value[idx].content_html),
      }
      toastStore.showToast('已加密，本会话内仍可读')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  /** 单条再开：口令已在手就不用再输，只有整库锁着时才要 */
  const unlockNote = async (id: string): Promise<string | null> => {
    try {
      notePlains.value[id] = await api.unlockNote(id)
      syncUnlocked(id)
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  const syncUnlocked = (id: string) => {
    const idx = notes.value.findIndex(n => n.id === id)
    if (idx >= 0) notes.value[idx] = withPlain(notes.value[idx])
  }

  /** 只收回会话明文，库里的密文不动 */
  const relockNote = async (id: string) => {
    try {
      await api.relockNote(id)
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
      return
    }
    const plain = notePlains.value[id]
    delete notePlains.value[id]
    const idx = notes.value.findIndex(n => n.id === id)
    if (idx >= 0) notes.value[idx] = {
      ...notes.value[idx],
      content_html: '',
      title: plain == null ? notes.value[idx].title : headingTitle(plain),
    }
    toastStore.showToast('已重新锁定')
  }

  /** 解除加密：明文写回普通列，密文与封条抹掉 */
  const removeNoteLock = async (id: string): Promise<string | null> => {
    const note = findNote(id)
    const plain = notePlains.value[id]
    if (!note || plain == null) return '请先解锁'
    try {
      clearSaveTimer()
      pendingSaveId = null
      await api.removeNoteLock(id, {
        title: deriveTitleFromHtml(plain),
        content_html: plain,
        category: note.category ?? undefined,
      })
      delete notePlains.value[id]
      const idx = notes.value.findIndex(n => n.id === id)
      if (idx >= 0) notes.value[idx] = {
        ...notes.value[idx],
        encrypted: false,
        title: deriveTitleFromHtml(plain),
      }
      toastStore.showToast('已解除加密')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  /** 会话明文一律收回，加密小记回到锁上状态（库里的密文不动） */
  const hideAllPlains = () => {
    const plains = notePlains.value
    notePlains.value = {}
    notes.value = notes.value.map(n => {
      if (!n.encrypted) return n
      const plain = plains[n.id]
      return { ...n, content_html: '', title: plain == null ? n.title : headingTitle(plain) }
    })
  }

  /** 应用锁定：口令解出来的东西一律收回，加密小记重新锁上 */
  const clearUnlockedNotes = () => {
    noteKey.value = { ...noteKey.value, is_open: false }
    hideAllPlains()
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

  /** 整体退出批量：收待选态 + 清空选中（钮再点一次 / Escape / dock 完成） */
  const exitNoteBatch = () => {
    notePickMode.value = false
    selectedNoteIds.value = new Set()
  }

  const toggleNotePick = () => {
    if (isBatchMode.value) exitNoteBatch()
    else notePickMode.value = true
  }

  const batchDelete = () => {
    const ids = Array.from(selectedNoteIds.value)
    if (ids.length === 0) return
    confirmStore.showConfirm('删除所选', `${ids.length} 条小记将被删除，此操作不可撤销。`, async () => {
      try {
        await api.batchDeleteNotes(ids)
        notes.value = notes.value.filter(n => !ids.includes(n.id))
        ids.forEach(id => { delete notePlains.value[id] })
        selectedNoteIds.value = new Set()
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
    notes, notesLoading, notesLoadError,
    noteSearchKeyword, noteView, activeTags, noteSort, hasActiveFilters,
    noteRailCollapsed,
    isBatchMode, hasNoteSelection, notePickMode, selectedNoteIds,
    noteAttachments, noteSaveState,
    notePlains, isUnlocked, noteKey,
    tagCounts, allTags, viewCounts, filteredNotes, groupedNotes,
    fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, clearFilters, toggleTagFilter,
    doDeleteNote, togglePin, toggleStar,
    setupNoteKey, unlockNoteDomain, recoverNoteDomain, relockNoteDomain, changeNoteKey, refreshNoteKey,
    lockNote, unlockNote, relockNote, removeNoteLock, clearUnlockedNotes,
    toggleSelectNote, selectAllNotes, clearSelection, toggleNotePick, exitNoteBatch,
    batchDelete, batchSetPinned, batchSetStarred,
    loadAttachments, uploadAttachment, deleteAttachment, stageImage,
  }
})
