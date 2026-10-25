import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { createDraftCipherKey, sealDraft, openDraft, type DraftCipherKey, type SealedDraft } from '../services/draftCipher'
import { notesApi as api } from '../services/api/notes'
import { settingsApi } from '../services/api/settings'
import { mergeNoteHtml } from '../utils/noteMerge'
import { hiddenCount, minusVisible, prune, unionVisible } from '../utils/selection'
import { useToastStore } from './toast'
import { useConfirmStore } from './confirm'
import { extractTags, getDateGroupLabel, deriveTitleFromHtml, headingTitle, htmlToTagText, htmlToText } from '../utils/format'
import { collectAttachmentNames, ensureAttachmentBase, nameOf, normalizeAssetHtml } from '../services/attachmentSrc'
import type { Note, Attachment, UpdateNoteInput } from '../types'
import type { NoteDraft, NoteKeyStatus, NotePlain } from '../services/api/notes'

export type NoteView = 'all' | 'pinned' | 'starred' | 'archived'
export type NoteSaveState = '' | 'saving' | 'saved'

export interface NoteGroup {
  label: string
  pinned: boolean
  notes: Note[]
}

const AUTOSAVE_DELAY = 600
const SAVED_HINT_DELAY = 1500
const RAIL_PIN_KEY = 'desko.notes.rail-pinned'

function readRailPinned(): boolean {
  try { return localStorage.getItem(RAIL_PIN_KEY) === 'true' } catch { return false }
}

/** content_html -> 派生的纯文本与标签，避免每次筛选都重新解析 */
const META_CACHE_LIMIT = 400
const metaCache = new Map<string, { text: string; tags: string[] }>()

export function noteMeta(html: string) {
  let meta = metaCache.get(html)
  if (!meta) {
    const text = htmlToText(html)
    meta = { text, tags: extractTags(htmlToTagText(html)) }
    if (metaCache.size >= META_CACHE_LIMIT) metaCache.clear()
    metaCache.set(html, meta)
  }
  return meta
}

export const useNotesStore = defineStore('notes', () => {
  const toastStore = useToastStore()
  const confirmStore = useConfirmStore()

  const notePasteCleanup = ref(true)
  let pasteSettingRevision = 0
  const loadNotePasteCleanup = async () => {
    const revision = pasteSettingRevision
    try {
      const value = await settingsApi.getSetting('note_paste_cleanup')
      if (revision === pasteSettingRevision) notePasteCleanup.value = value !== 'false'
    } catch { /* 缺键或暂时读不到设置时沿用现有粘贴行为 */ }
  }
  const setNotePasteCleanup = async (enabled: boolean): Promise<boolean> => {
    pasteSettingRevision++
    const previous = notePasteCleanup.value
    notePasteCleanup.value = enabled
    try {
      await settingsApi.setSetting('note_paste_cleanup', String(enabled))
      return true
    } catch (e: any) {
      notePasteCleanup.value = previous
      toastStore.showToast('保存设置失败：' + (e.message ?? e), 'error')
      return false
    }
  }
  void loadNotePasteCleanup()

  const notes = ref<Note[]>([])
  const notesLoading = ref(false)
  /** 上一次 fetchNotes 的失败原因；视图据此把"加载失败"和"还没有小记"分开 */
  const notesLoadError = ref<string | null>(null)

  /** 未发布正文跟随当前会话，页面卸载后仍可继续写；发布或放弃时清空。 */
  const noteDraftHtml = ref('')

  // 筛选状态
  const noteSearchKeyword = ref('')
  const noteView = ref<NoteView>('all')
  const activeTags = ref<Set<string>>(new Set())
  // 右窄栏默认收起，列表占满宽度；顶栏按钮展开后跟着会话走，宽度不够时另有浮层侧栏
  const noteRailCollapsed = ref(true)
  const noteRailPinned = ref(readRailPinned())
  // 只保存界面偏好，桌面与浏览器各自记住；存储不可用时仍可在本次会话切换。
  watch(noteRailPinned, pinned => {
    try { localStorage.setItem(RAIL_PIN_KEY, String(pinned)) } catch { /* 保留内存状态 */ }
  }, { flush: 'sync' })

  // 批量操作状态：勾选即进、清空即收；工具栏「选择」钮另开一层待选态（显形全部勾选框）
  const selectedNoteIds = ref<Set<string>>(new Set())
  const isMergingNotes = ref(false)
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
  // 按小记保存独立快照，共用防抖计时器；提交期间的新编辑也不会被覆盖。
  const pendingSaves = new Map<string, UpdateNoteInput>()
  const mustRestageIds = new Set<string>()
  let saveInFlight: Promise<void> | null = null
  // Staging and DB writes share one queue: an old save must not clear a newer staged draft.
  let persistenceTail: Promise<void> = Promise.resolve()
  let stageQueued = false
  let clearPendingOnLock = true
  let noteEpoch = 0
  let fallbackKey: DraftCipherKey | null = null
  let fallbackKeyPromise: Promise<DraftCipherKey> | null = null
  const fallbackDrafts: (SealedDraft & { recovered: Set<string> })[] = []
  let fallbackComposer: SealedDraft | null = null

  const localKey = async (): Promise<DraftCipherKey> => {
    if (fallbackKey) return fallbackKey
    if (!fallbackKeyPromise) {
      const epoch = noteEpoch
      fallbackKeyPromise = createDraftCipherKey()
        .then(key => {
          if (epoch === noteEpoch) fallbackKey = key
          return key
        })
    }
    return fallbackKeyPromise
  }

  const sealUnpublishedDraft = async (): Promise<void> => {
    if (!noteDraftHtml.value) return
    const epoch = noteEpoch
    const html = noteDraftHtml.value
    const key = await localKey()
    if (epoch !== noteEpoch) return
    const sealed = await sealDraft(key, html)
    if (epoch !== noteEpoch) return
    fallbackComposer = sealed
  }

  const sealLocalDrafts = async (): Promise<void> => {
    const epoch = noteEpoch
    const drafts: NoteDraft[] = [...pendingSaves].map(([id, input]) => ({ id, input }))
    const key = await localKey()
    if (epoch !== noteEpoch) return
    const sealed = await sealDraft(key, JSON.stringify(drafts))
    if (epoch !== noteEpoch) return
    fallbackDrafts.push({ ...sealed, recovered: new Set() })
  }

  const discardInvalidBatch = (sealed: typeof fallbackDrafts[number]) => {
    const index = fallbackDrafts.indexOf(sealed)
    if (index >= 0) fallbackDrafts.splice(index, 1)
    toastStore.showToast('一份暂存草稿无法恢复，已丢弃无效草稿；其他小记不受影响', 'error')
  }

  const recoverLocalDrafts = async (): Promise<NoteDraft[]> => {
    if (!fallbackKey) return []
    const epoch = noteEpoch
    const drafts: NoteDraft[] = []
    const seen = new Set<string>()
    for (const sealed of [...fallbackDrafts].reverse()) {
      try {
        const plaintext = await openDraft(fallbackKey, sealed)
        if (epoch !== noteEpoch) return []
        for (const draft of JSON.parse(plaintext) as NoteDraft[]) {
          if (!sealed.recovered.has(draft.id) && !seen.has(draft.id)) {
            drafts.push(draft)
            seen.add(draft.id)
          }
        }
      } catch {
        if (epoch !== noteEpoch) return []
        discardInvalidBatch(sealed)
      }
    }
    return drafts
  }

  const enqueuePersistence = (work: () => Promise<void>): Promise<void> => {
    const epoch = noteEpoch
    const task = persistenceTail.then(() => epoch === noteEpoch ? work() : undefined)
    persistenceTail = task.catch(() => {})
    return task
  }

  const stagePendingDrafts = (): Promise<void> => enqueuePersistence(async () => {
    const drafts: NoteDraft[] = [...pendingSaves].map(([id, input]) => ({ id, input }))
    if (drafts.length) await api.stageDrafts(drafts)
  })

  const scheduleDraftStage = () => {
    if (stageQueued) return
    stageQueued = true
    void enqueuePersistence(async () => {
      stageQueued = false
      const drafts: NoteDraft[] = [...pendingSaves].map(([id, input]) => ({ id, input }))
      if (drafts.length) await api.stageDrafts(drafts)
    }).catch((e: any) => {
      toastStore.showToast('草稿暂存失败：' + (e.message ?? e), 'error')
    })
  }

  const clearSaveTimer = () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
  }

  const tagCounts = computed<[string, number][]>(() => {
    const counts = new Map<string, number>()
    // 归档条目不贡献标签计数：侧栏那串数字是「在库」的口径
    notes.value.filter(n => !n.archived).forEach(n => {
      noteMeta(n.content_html).tags.forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1))
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  })

  const allTags = computed(() => tagCounts.value.map(([tag]) => tag))

  const archivedNotes = computed(() => notes.value.filter(n => n.archived))

  const viewCounts = computed<Record<NoteView, number>>(() => ({
    all: notes.value.filter(n => !n.archived).length,
    pinned: notes.value.filter(n => n.pinned && !n.archived).length,
    starred: notes.value.filter(n => n.starred && !n.archived).length,
    archived: archivedNotes.value.length,
  }))

  /** 归档页头一句话：条数 + 最近一次归档距今多久 */
  const archiveSummary = computed(() => {
    const latest = archivedNotes.value.reduce((m, n) => Math.max(m, n.archived_at ?? 0), 0)
    if (!latest) return null
    const today = new Date()
    const archivedDay = new Date(latest)
    today.setHours(0, 0, 0, 0)
    archivedDay.setHours(0, 0, 0, 0)
    const days = Math.round((today.getTime() - archivedDay.getTime()) / 86400000)
    if (days <= 0) return '最近一次归档：今天'
    if (days === 1) return '最近一次归档：昨天'
    return `最近一次归档：${days} 天前`
  })

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

    if (noteView.value === 'archived') result = result.filter(n => n.archived)
    else if (noteView.value === 'pinned') result = result.filter(n => n.pinned && !n.archived)
    else if (noteView.value === 'starred') result = result.filter(n => n.starred && !n.archived)
    else result = result.filter(n => !n.archived)

    if (activeTags.value.size > 0) {
      result = result.filter(n => noteMeta(n.content_html).tags.some(t => activeTags.value.has(t)))
    }

    result.sort((a, b) => b.created_at - a.created_at)
    return result
  })

  /** V：此刻真正排在流里的小记。批量钮的作用范围就是它。 */
  const visibleNoteIds = computed(() => filteredNotes.value.map(n => n.id))
  /** K：攒在 S 里、但被视图/搜索/标签挡住的条数。只用于披露，不参与执行。 */
  const hiddenSelectedNotes = computed(() => hiddenCount(selectedNoteIds.value, visibleNoteIds.value))
  /** 非破坏性批量的结果口径：只多这半句，不另加第二颗钮。必须在改数据之前取，
   *  否则「归档 5 条」会让这 5 条反过来被判成非本屏。 */
  const offScreenSuffix = (ids: readonly string[]) => {
    const k = hiddenCount(new Set(ids), visibleNoteIds.value)
    return k > 0 ? ` · 含 ${k} 条非本屏` : ''
  }

  // 小记从库里消失（单条删除、批量删除、合并吞掉源条目）就把残 id 摘掉。
  // 视图/搜索/标签变化不剪枝——跨视图攒批是有意保留的能力。
  watch(notes, list => {
    const next = prune(selectedNoteIds.value, list.map(n => n.id))
    if (next !== selectedNoteIds.value) selectedNoteIds.value = next
  }, { flush: 'post' })

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

    // Map 的插入序就是 filteredNotes 的进入序，倒序建桶即天然最新一天在前
    buckets.forEach((items, label) => groups.push({ label, pinned: false, notes: items }))
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
    const epoch = noteEpoch
    notesLoading.value = true
    try {
      // 图片 src 存的是相对形态，渲染要先有本机附件目录
      await ensureAttachmentBase()
      if (epoch !== noteEpoch) return
      const status = await api.noteKeyStatus()
      if (epoch !== noteEpoch) return
      noteKey.value = status
      const rows = await api.listNotes()
      if (epoch !== noteEpoch) return
      // 页面刷新后 Rust 侧域密钥还在（应用没锁），把已解锁的明文找回来
      if (status.is_open) {
        for (const r of rows) {
          if (r.encrypted && notePlains.value[r.id] == null) {
            try {
              const plain = await api.revealNote(r.id)
              if (epoch !== noteEpoch) return
              notePlains.value[r.id] = plain
            } catch {
              if (epoch !== noteEpoch) return
              /* 单条重锁过就是锁着 */
            }
          }
        }
      }
      if (epoch !== noteEpoch) return
      notes.value = rows.map(withPlain)
      await recoverDrafts()
      if (epoch !== noteEpoch) return
      notesLoadError.value = null
    } catch (e: any) {
      if (epoch !== noteEpoch) return
      notesLoadError.value = e?.message || '加载小记失败'
      toastStore.showToast('加载小记失败: ' + e.message, 'error')
    } finally {
      if (epoch === noteEpoch) notesLoading.value = false
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

  const commitSave = async (): Promise<void> => {
    clearSaveTimer()
    if (saveInFlight) {
      await saveInFlight
      if (pendingSaves.size) return commitSave()
      return
    }
    if (!pendingSaves.size) return
    const epoch = noteEpoch
    const drain = async () => {
      noteSaveState.value = 'saving'
      try {
        // Fixed snapshot: edits arriving during update wait behind this write in the queue.
        for (const [id, input] of [...pendingSaves]) {
          if (epoch !== noteEpoch) return
          if (!findNote(id)) {
            pendingSaves.delete(id)
            mustRestageIds.delete(id)
            continue
          }
          if (mustRestageIds.has(id)) {
            await api.stageDrafts([{ id, input }])
            if (epoch !== noteEpoch) return
            mustRestageIds.delete(id)
          }
          await api.updateNote(id, input)
          if (epoch !== noteEpoch) return
          const names = collectAttachmentNames(input.content_html)
          const known = new Set((noteAttachments.value[id] ?? []).map(a => nameOf(a.file_path)))
          const fresh = names.filter(n => !known.has(n))
          if (fresh.length) {
            try {
              const bound = await api.bindAttachments(id, fresh)
              if (epoch !== noteEpoch) return
              if (bound.length) noteAttachments.value[id] = [...bound, ...(noteAttachments.value[id] ?? [])]
            } catch (e: any) {
              toastStore.showToast('附件登记失败：' + (e.message ?? e), 'error')
            }
          }
          if (epoch !== noteEpoch) return
          // 写入途中同一条又改过：旧请求成功不能抹掉新快照。
          if (pendingSaves.get(id) === input) pendingSaves.delete(id)
        }
        noteSaveState.value = 'saved'
        if (hintTimer) clearTimeout(hintTimer)
        hintTimer = setTimeout(() => { noteSaveState.value = '' }, SAVED_HINT_DELAY)
      } catch (e: any) {
        if (epoch !== noteEpoch) return
        noteSaveState.value = ''
        toastStore.showToast('保存失败：' + (e.message ?? e), 'error')
        throw e
      }
    }
    const flight = enqueuePersistence(drain)
    saveInFlight = flight
    try { await flight } finally { if (saveInFlight === flight) saveInFlight = null }
    if (epoch === noteEpoch && pendingSaves.size) await commitSave()
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
    pendingSaves.set(id, {
      title: notes.value[idx].title,
      content_html: html,
      category: meta.tags[0] ?? undefined,
    })
    scheduleDraftStage()
    noteSaveState.value = 'saving'
    clearSaveTimer()
    saveTimer = setTimeout(() => { void commitSave().catch(() => {}) }, AUTOSAVE_DELAY)
  }

  /** 切换书写面或卸载前调用，避免防抖窗口内的最后一次编辑丢失 */
  const flushNoteSave = async () => {
    await commitSave()
  }

  /** Lock may continue after a failed DB write only when the latest drafts are staged. */
  const prepareNoteLock = async (forced = false): Promise<void> => {
    clearPendingOnLock = false
    let saveError: unknown
    try { await flushNoteSave() } catch (e) { saveError = e }
    if (!pendingSaves.size) {
      await sealUnpublishedDraft()
      clearPendingOnLock = true
      return
    }
    try {
      await stagePendingDrafts()
      await sealUnpublishedDraft()
      clearPendingOnLock = true
      toastStore.showToast('保存失败，草稿已加密暂存，解锁后将重试', 'error')
    } catch (e: any) {
      if (forced) {
        await sealLocalDrafts()
        await sealUnpublishedDraft()
        clearPendingOnLock = true
        toastStore.showToast('草稿已在本进程加密保留，解锁后将重试；退出程序前请先保存', 'error')
        return
      }
      throw new Error(`保存或草稿加密暂存失败：${e.message ?? e}${saveError ? `（保存错误：${String(saveError)}）` : ''}`)
    }
  }

  /** Native timeout already revoked the master key; never wait for an in-flight IPC here. */
  const forceSealDrafts = async (): Promise<void> => {
    const epoch = noteEpoch
    clearSaveTimer()
    if (pendingSaves.size) await sealLocalDrafts()
    await sealUnpublishedDraft()
    if (epoch === noteEpoch) clearPendingOnLock = true
  }

  /** Backend only returns drafts whose note key is currently unlocked. */
  const recoverDrafts = async (): Promise<void> => {
    const epoch = noteEpoch
    if (fallbackComposer && fallbackKey && !noteDraftHtml.value) {
      try {
        const plaintext = await openDraft(fallbackKey, fallbackComposer)
        if (epoch !== noteEpoch) return
        noteDraftHtml.value = plaintext
        fallbackComposer = null
      } catch {
        if (epoch !== noteEpoch) return
        fallbackComposer = null
        toastStore.showToast('未保存草稿无法恢复，已丢弃无效草稿；其他小记不受影响', 'error')
      }
    }
    const localDrafts = await recoverLocalDrafts()
    if (epoch !== noteEpoch) return
    const localIds = new Set(localDrafts.map(d => d.id))
    let backendDrafts: NoteDraft[] = []
    try { backendDrafts = await api.recoverDrafts() } catch (e: any) {
      if (epoch !== noteEpoch) return
      toastStore.showToast('读取加密暂存草稿失败：' + (e.message ?? e), 'error')
    }
    if (epoch !== noteEpoch) return
    const drafts = [...localDrafts, ...backendDrafts]
    let recovered = false
    for (const { id, input } of drafts) {
      if (pendingSaves.has(id)) {
        for (const sealed of fallbackDrafts) sealed.recovered.add(id)
        continue
      }
      const index = notes.value.findIndex(n => n.id === id)
      if (index < 0 || (notes.value[index].encrypted && notePlains.value[id] == null)) continue
      pendingSaves.set(id, input)
      if (localIds.has(id)) mustRestageIds.add(id)
      notes.value[index] = {
        ...notes.value[index],
        title: input.title,
        content_html: input.content_html,
        category: input.category ?? null,
      }
      if (notes.value[index].encrypted) notePlains.value[id] = input.content_html
      for (const sealed of fallbackDrafts) sealed.recovered.add(id)
      recovered = true
    }
    for (let i = fallbackDrafts.length - 1; i >= 0; i--) {
      // Keep encrypted batches for notes that still need their separate note key.
      const sealed = fallbackDrafts[i]
      try {
        const plaintext = await openDraft(fallbackKey!, sealed)
        if (epoch !== noteEpoch) return
        const ids = (JSON.parse(plaintext) as NoteDraft[]).map(d => d.id)
        if (ids.every(id => sealed.recovered.has(id))) fallbackDrafts.splice(i, 1)
      } catch {
        if (epoch !== noteEpoch) return
        discardInvalidBatch(sealed)
      }
    }
    if (!fallbackDrafts.length && !fallbackComposer) { fallbackKey = null; fallbackKeyPromise = null }
    if (recovered) {
      noteSaveState.value = 'saving'
      clearSaveTimer()
      saveTimer = setTimeout(() => { void commitSave().catch(() => {}) }, AUTOSAVE_DELAY)
      toastStore.showToast('已找回未保存的小记草稿，正在重试保存', 'info')
    }
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

  /** 归档/取消归档：归档行只是换个视图，属性（置顶/收藏/加密）一律不动 */
  const setArchived = async (note: Note, archived: boolean) => {
    try {
      await api.setNoteArchived(note.id, archived)
      const idx = notes.value.findIndex(n => n.id === note.id)
      if (idx >= 0) {
        notes.value[idx] = {
          ...notes.value[idx],
          archived,
          archived_at: archived ? Date.now() : null,
        }
      }
      toastStore.showToast(archived ? '已归档，可在「归档」视图找回' : '已取消归档，回到「全部」')
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
    }
  }

  const batchSetArchived = async (archived: boolean) => {
    const ids = Array.from(selectedNoteIds.value)
      .filter(id => findNote(id)?.archived !== archived)
    const off = offScreenSuffix(ids)
    if (!ids.length) {
      toastStore.showToast('没有需要变更的小记')
      return
    }
    try {
      await api.batchSetArchived(ids, archived)
      const now = Date.now()
      notes.value = notes.value.map(n =>
        ids.includes(n.id) ? { ...n, archived, archived_at: archived ? now : null } : n)
      selectedNoteIds.value = new Set()
      toastStore.showToast(`已${archived ? '归档' : '取消归档'} ${ids.length} 条小记${off}`)
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
    }
  }

  /** 归档视图头部的一次性恢复：把当前筛出来的（含关键词/标签过滤）全部放回库里 */
  const unarchiveAllFiltered = async () => {
    const ids = filteredNotes.value.map(n => n.id)
    if (!ids.length) return
    confirmStore.showConfirm('全部取消归档', `${ids.length} 条小记将回到「全部」列表。`, async () => {
      try {
        await api.batchSetArchived(ids, false)
        notes.value = notes.value.map(n =>
          ids.includes(n.id) ? { ...n, archived: false, archived_at: null } : n)
        toastStore.showToast(`已取消归档 ${ids.length} 条小记`)
      } catch (e: any) {
        toastStore.showToast('操作失败：' + e.message, 'error')
      }
    })
  }

  /** 口令到手：一次带回的明文全部填进会话，列表跟着换显示 */
  const applyPlains = (plains: NotePlain[]) => {
    plains.forEach(p => { notePlains.value[p.id] = p.html })
    notes.value = notes.value.map(withPlain)
  }

  /** 设置页在列表之外也要知道口令设过没有 */
  const refreshNoteKey = async () => {
    const epoch = noteEpoch
    try {
      const status = await api.noteKeyStatus()
      if (epoch === noteEpoch) noteKey.value = status
    } catch {
      /* 未解锁时本来就问不到，保持原样 */
    }
  }

  const setupNoteKey = async (passphrase: string): Promise<string | null> => {
    const epoch = noteEpoch
    try {
      const plains = await api.noteKeySetup(passphrase)
      if (epoch !== noteEpoch) return '应用已锁定'
      applyPlains(plains)
      noteKey.value = { is_set: true, is_open: true }
      await recoverDrafts()
      if (epoch !== noteEpoch) return '应用已锁定'
      toastStore.showToast('小记口令已设好，加密小记全部解锁')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  const unlockNoteDomain = async (passphrase: string): Promise<string | null> => {
    const epoch = noteEpoch
    try {
      const plains = await api.noteKeyUnlock(passphrase)
      if (epoch !== noteEpoch) return '应用已锁定'
      applyPlains(plains)
      noteKey.value = { ...noteKey.value, is_open: true }
      await recoverDrafts()
      if (epoch !== noteEpoch) return '应用已锁定'
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  /** 兜底：应用会话已解锁，域密钥用主密钥封条直接取回，一个字都不用输 */
  const recoverNoteDomain = async (): Promise<string | null> => {
    const epoch = noteEpoch
    try {
      const plains = await api.noteKeyRecover()
      if (epoch !== noteEpoch) return '应用已锁定'
      applyPlains(plains)
      noteKey.value = { ...noteKey.value, is_open: true }
      await recoverDrafts()
      if (epoch !== noteEpoch) return '应用已锁定'
      toastStore.showToast('已用主密码解锁全部加密小记')
      return null
    } catch (e: any) {
      return String(e.message ?? e)
    }
  }

  const relockNoteDomain = async () => {
    try {
      await flushNoteSave()
      await api.noteKeyRelock()
    } catch (e: any) {
      toastStore.showToast('操作失败：' + e.message, 'error')
      return
    }
    noteKey.value = { ...noteKey.value, is_open: false }
    hideAllPlains()
    toastStore.showToast('已锁定全部加密小记')
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
      await flushNoteSave()
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
    const epoch = noteEpoch
    try {
      const plain = await api.unlockNote(id)
      if (epoch !== noteEpoch) return '应用已锁定'
      notePlains.value[id] = plain
      syncUnlocked(id)
      await recoverDrafts()
      if (epoch !== noteEpoch) return '应用已锁定'
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
      await flushNoteSave()
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
      await flushNoteSave()
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
    noteEpoch++
    persistenceTail = Promise.resolve()
    saveInFlight = null
    stageQueued = false
    clearSaveTimer()
    if (clearPendingOnLock) pendingSaves.clear()
    mustRestageIds.clear()
    clearPendingOnLock = true
    metaCache.clear()
    notesLoading.value = false
    notesLoadError.value = null
    noteKey.value = { ...noteKey.value, is_open: false }
    notePlains.value = {}
    noteDraftHtml.value = ''
    notes.value = []
    noteAttachments.value = {}
  }

  /** A restored database is a new timeline; neither backend nor local drafts may replay into it. */
  const discardDraftsForRestore = () => {
    clearPendingOnLock = true
    pendingSaves.clear()
    mustRestageIds.clear()
    fallbackDrafts.length = 0
    fallbackComposer = null
    fallbackKey = null
    fallbackKeyPromise = null
    clearUnlockedNotes()
  }

  /** Last-resort security boundary when both backend staging and local encryption fail. */
  const dropUnsealedDrafts = () => {
    pendingSaves.clear()
    mustRestageIds.clear()
    clearPendingOnLock = true
  }

  const toggleSelectNote = (id: string) => {
    const next = new Set(selectedNoteIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedNoteIds.value = next
  }

  const selectAllNotes = () => {
    selectedNoteIds.value = unionVisible(selectedNoteIds.value, visibleNoteIds.value)
  }

  /** 与「全选」对称：只摘本屏，别的视图里攒的留着，退批量才清空 */
  const clearSelection = () => {
    selectedNoteIds.value = minusVisible(selectedNoteIds.value, visibleNoteIds.value)
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
    const hidden = hiddenSelectedNotes.value
    const scope = hidden > 0 ? `，其中 ${hidden} 条不在当前筛选结果里` : ''
    confirmStore.showConfirm('删除所选', `${ids.length} 条小记将被删除${scope}，此操作不可撤销。`, async () => {
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

  const mergeSelectedNotes = () => {
    if (isMergingNotes.value || noteView.value === 'archived') return
    const ids = [...selectedNoteIds.value]
    // 合并是破坏性的：藏着的条数既进确认句，也进结果 toast，两处同一个数
    const hidden = hiddenCount(new Set(ids), visibleNoteIds.value)
    const off = hidden > 0 ? ` · 含 ${hidden} 条非本屏` : ''
    const scope = hidden > 0 ? `，其中 ${hidden} 条不在当前筛选结果里` : ''
    const sourcesForMerge = (): Note[] | null => {
      const rows = ids.map(findNote).filter((n): n is Note => n != null)
      if (rows.length < 2 || rows.length !== ids.length || rows.some(n => n.archived)) return null
      const encrypted = rows.filter(n => n.encrypted).length
      if (encrypted && encrypted !== rows.length) {
        toastStore.showToast('加密与未加密小记不能混合合并', 'error')
        return null
      }
      const locked = rows.filter(n => n.encrypted && (!noteKey.value.is_open || !isUnlocked(n.id))).length
      if (locked) {
        toastStore.showToast(`未合并：${locked} 条小记未解锁`, 'error')
        return null
      }
      return rows.sort((a, b) => a.created_at - b.created_at)
    }
    if (!sourcesForMerge()) return
    const epoch = noteEpoch
    confirmStore.showConfirm('合并小记', `${ids.length} 条小记将合成一条${scope}，原条目将被删除，此操作不可撤销。`, async () => {
      if (isMergingNotes.value || epoch !== noteEpoch || !sourcesForMerge()) return
      isMergingNotes.value = true
      let merged: Note | null = null
      let bound: Attachment[] = []
      let step: 'create' | 'bind' | 'encrypt' | 'delete' = 'create'
      const assertActive = () => {
        if (epoch !== noteEpoch) throw new Error('应用已锁定')
      }
      const showMerged = () => {
        if (!merged || epoch !== noteEpoch) return
        notes.value = [merged, ...notes.value]
        noteAttachments.value[merged.id] = bound
        if (merged.encrypted) notePlains.value[merged.id] = merged.content_html
      }
      try {
        await flushNoteSave()
        assertActive()
        const sources = sourcesForMerge()
        if (!sources) return
        const html = mergeNoteHtml(sources.map(n => n.encrypted ? notePlains.value[n.id] : n.content_html))
        merged = await api.createNote({
          title: deriveTitleFromHtml(html),
          content_html: html,
          category: noteMeta(html).tags[0],
        })
        assertActive()
        step = 'bind'
        const names = collectAttachmentNames(html)
        if (names.length) {
          bound = await api.bindAttachments(merged.id, names)
          assertActive()
          // bind 会跳过缺失文件；没有登记齐就不能删除任何源条目。
          const claimed = new Set(bound.map(a => nameOf(a.file_path)))
          if (names.some(name => !claimed.has(name))) throw new Error('部分图片未能登记')
        }
        if (sources[0].encrypted) {
          step = 'encrypt'
          // 直接用同一加密命令，避免临时明文条目先进入可见列表。
          await api.lockNote(merged.id)
          assertActive()
          merged = { ...merged, encrypted: true, title: headingTitle(html) }
        }
        step = 'delete'
        await api.batchDeleteNotes(ids)
        assertActive()
        showMerged()
        notes.value = notes.value.filter(n => !ids.includes(n.id))
        ids.forEach(id => {
          delete notePlains.value[id]
          delete noteAttachments.value[id]
        })
        exitNoteBatch()
        toastStore.showToast(`已合并 ${ids.length} 条小记${off}`)
      } catch (e: any) {
        const message = String(e.message ?? e)
        if (step === 'delete') {
          showMerged()
          if (epoch === noteEpoch) toastStore.showToast('合并未完成：新条目已生成，原条目删除失败：' + message, 'error')
          return
        }
        let cleanupError = ''
        if (merged) {
          try { await api.deleteNote(merged.id) } catch (cleanup: any) {
            showMerged()
            cleanupError = '；新条目撤销失败，请检查并删除：' + (cleanup.message ?? cleanup)
          }
        }
        if (epoch !== noteEpoch) return
        const prefix = step === 'bind' ? '合并中止：附件登记失败：'
          : step === 'encrypt' ? '合并中止：新条目加密失败：' : '合并失败：'
        toastStore.showToast(prefix + message + cleanupError, 'error')
      } finally {
        isMergingNotes.value = false
      }
    }, '合并')
  }

  const batchSetPinned = async (pinned: boolean) => {
    const ids = Array.from(selectedNoteIds.value)
      .filter(id => findNote(id)?.pinned !== pinned)
    const off = offScreenSuffix(ids)
    for (const id of ids) {
      try {
        await api.togglePinNote(id)
        const note = findNote(id)
        if (note) note.pinned = pinned
      } catch (e: any) {
        toastStore.showToast('操作失败：' + e.message, 'error')
      }
    }
    toastStore.showToast(ids.length ? `已${pinned ? '置顶' : '取消置顶'} ${ids.length} 条小记${off}` : '没有需要变更的小记')
  }

  const batchSetStarred = async (starred: boolean) => {
    const ids = Array.from(selectedNoteIds.value)
      .filter(id => findNote(id)?.starred !== starred)
    const off = offScreenSuffix(ids)
    for (const id of ids) {
      try {
        await api.toggleStarNote(id)
        const note = findNote(id)
        if (note) note.starred = starred
      } catch (e: any) {
        toastStore.showToast('操作失败：' + e.message, 'error')
      }
    }
    toastStore.showToast(ids.length ? `已${starred ? '收藏' : '取消收藏'} ${ids.length} 条小记${off}` : '没有需要变更的小记')
  }

  const loadAttachments = async (noteId: string) => {
    if (noteAttachments.value[noteId]) return
    try {
      noteAttachments.value[noteId] = await api.listAttachments(noteId)
    } catch (e: any) {
      toastStore.showToast('加载附件失败：' + e.message, 'error')
    }
  }

  const uploadAttachment = async (noteId: string, filePath: string | File) => {
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
  const stageImage = async (filePath: string | File): Promise<Attachment | null> => {
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
    notePasteCleanup, loadNotePasteCleanup, setNotePasteCleanup, isMergingNotes,
    notes, notesLoading, notesLoadError, noteDraftHtml,
    noteSearchKeyword, noteView, activeTags, hasActiveFilters,
    noteRailCollapsed, noteRailPinned,
    isBatchMode, hasNoteSelection, notePickMode, selectedNoteIds, hiddenSelectedNotes,
    noteAttachments, noteSaveState,
    notePlains, isUnlocked, noteKey,
    tagCounts, allTags, archivedNotes, archiveSummary, viewCounts, filteredNotes, groupedNotes,
    fetchNotes, findNote, publishNote, saveNoteContent, flushNoteSave, prepareNoteLock, forceSealDrafts, recoverDrafts, clearFilters, toggleTagFilter,
    doDeleteNote, togglePin, toggleStar, setArchived, batchSetArchived, unarchiveAllFiltered,
    setupNoteKey, unlockNoteDomain, recoverNoteDomain, relockNoteDomain, changeNoteKey, refreshNoteKey,
    lockNote, unlockNote, relockNote, removeNoteLock, clearUnlockedNotes, discardDraftsForRestore, dropUnsealedDrafts,
    toggleSelectNote, selectAllNotes, clearSelection, toggleNotePick, exitNoteBatch,
    batchDelete, mergeSelectedNotes, batchSetPinned, batchSetStarred,
    loadAttachments, uploadAttachment, deleteAttachment, stageImage,
  }
})
