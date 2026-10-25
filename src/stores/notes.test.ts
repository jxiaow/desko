import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
// @ts-expect-error The app tsconfig intentionally excludes Node types; Vitest runs on Node.
import { webcrypto } from 'node:crypto'
import { useNotesStore } from './notes'
import { notesApi } from '../services/api/notes'
import type { Note } from '../types'

vi.mock('../services/api/notes', () => ({
  notesApi: {
    listNotes: vi.fn(),
    noteKeyStatus: vi.fn(),
    noteKeySetup: vi.fn(),
    noteKeyUnlock: vi.fn(),
    noteKeyRecover: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    stageDrafts: vi.fn(),
    recoverDrafts: vi.fn(),
    deleteNote: vi.fn(),
    batchDeleteNotes: vi.fn(),
    togglePinNote: vi.fn(),
    toggleStarNote: vi.fn(),
    setNoteArchived: vi.fn(),
    batchSetArchived: vi.fn(),
    lockNote: vi.fn(),
    unlockNote: vi.fn(),
    unlockNoteByMaster: vi.fn(),
    relockNote: vi.fn(),
    noteKeyRelock: vi.fn(),
    removeNoteLock: vi.fn(),
    revealNote: vi.fn(),
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    stageAttachment: vi.fn(),
    bindAttachments: vi.fn(),
    orphans: vi.fn(),
    cleanupOrphans: vi.fn(),
  },
}))

// toast 与 confirm 各共享一份：批量口径的用例要读它们收到的那句话
const toastMock = vi.hoisted(() => ({ showToast: vi.fn() }))
vi.mock('./toast', () => ({
  useToastStore: () => toastMock,
}))

// 共享一份 confirm mock：批量口径的用例要读它收到的那句话
const confirmMock = vi.hoisted(() => ({ showConfirm: vi.fn() }))
vi.mock('./confirm', () => ({
  useConfirmStore: () => confirmMock,
}))

const mockNote = (overrides: Partial<Note> = {}): Note => ({
  id: '1',
  title: '测试小记',
  content_html: '<p>测试内容</p>',
  category: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  pinned: false,
  starred: false,
  encrypted: false,
  archived: false,
  archived_at: null,
  ...overrides,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

describe('Notes Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.mocked(notesApi.stageDrafts).mockResolvedValue(undefined)
    vi.mocked(notesApi.recoverDrafts).mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('归档摘要按本地日历区分昨天，旧条目编辑不改变创建日期分组', () => {
    vi.setSystemTime(new Date(2026, 9, 20, 0, 10))
    const store = useNotesStore()
    const created = new Date(2025, 9, 19, 23, 55).getTime()
    store.notes = [mockNote({ created_at: created, archived: true, archived_at: new Date(2026, 9, 19, 23, 55).getTime() })]
    expect(store.archiveSummary).toBe('最近一次归档：昨天')
    store.noteView = 'archived'
    const label = store.groupedNotes[0].label
    store.saveNoteContent('1', '<p>改写的旧记录</p>')
    expect(store.groupedNotes[0].label).toBe(label)
    expect(store.notes[0].created_at).toBe(created)
  })

  describe('批量作用域：钮只管本屏，S 跨视图攒', () => {
    /** 「全部」屏只有甲，「归档」屏只有乙：视图切换就是最省事的筛选切换 */
    const seed = () => {
      const store = useNotesStore()
      store.notes = [
        mockNote({ id: 'a', title: '甲' }),
        mockNote({ id: 'b', title: '乙', archived: true, archived_at: Date.now() }),
      ]
      return store
    }

    it('全选并入本屏、取消本屏只摘本屏，先前攒的不丢', async () => {
      const store = seed()
      store.toggleSelectNote('a')

      store.noteView = 'archived'
      await flushPromises()
      // 换视图既不清 S 也不剪枝（乙此刻才可见）
      expect(store.selectedNoteIds.has('a')).toBe(true)

      store.selectAllNotes()
      expect([...store.selectedNoteIds].sort()).toEqual(['a', 'b'])
      expect(store.hiddenSelectedNotes).toBe(1)

      store.clearSelection()
      expect([...store.selectedNoteIds]).toEqual(['a'])
      expect(store.isBatchMode).toBe(true)
    })

    it('K=0 的删除确认逐字不变，K>0 才补口径短句', () => {
      const store = seed()
      store.toggleSelectNote('a')
      store.batchDelete()
      expect(confirmMock.showConfirm).toHaveBeenLastCalledWith(
        '删除所选', '1 条小记将被删除，此操作不可撤销。', expect.any(Function))

      confirmMock.showConfirm.mockClear()
      store.noteView = 'archived'
      store.selectAllNotes()
      store.batchDelete()
      expect(confirmMock.showConfirm).toHaveBeenLastCalledWith(
        '删除所选', '2 条小记将被删除，其中 1 条不在当前筛选结果里，此操作不可撤销。', expect.any(Function))
    })

    it('小记从库里消失即剪枝 S，视图变化不剪枝', async () => {
      const store = seed()
      store.selectAllNotes()
      expect([...store.selectedNoteIds]).toEqual(['a'])

      store.noteView = 'archived'
      await flushPromises()
      expect(store.selectedNoteIds.has('a')).toBe(true)

      store.notes = store.notes.filter(n => n.id !== 'a')
      await flushPromises()
      expect(store.selectedNoteIds.size).toBe(0)
    })

    it('结果 toast 带上非本屏的条数', async () => {
      const store = seed()
      store.toggleSelectNote('a')
      store.noteView = 'archived'
      store.toggleSelectNote('b')

      await store.batchSetStarred(true)

      expect(notesApi.toggleStarNote).toHaveBeenCalledWith('a')
      expect(toastMock.showToast).toHaveBeenLastCalledWith('已收藏 2 条小记 · 含 1 条非本屏')
    })
  })

  describe('lock boundary for asynchronous reads', () => {
    it('ignores a list returned after lock, including its loading state', async () => {
      const store = useNotesStore()
      const list = deferred<Note[]>()
      vi.mocked(notesApi.noteKeyStatus).mockResolvedValue({ is_set: true, is_open: true })
      vi.mocked(notesApi.listNotes).mockReturnValue(list.promise)
      const loading = store.fetchNotes()
      await flushPromises()
      expect(notesApi.listNotes).toHaveBeenCalledTimes(1)
      store.clearUnlockedNotes()
      list.resolve([mockNote({ content_html: '<p>private after lock</p>' })])
      await loading
      expect(store.notes).toEqual([])
      expect(store.notePlains).toEqual({})
      expect(store.noteKey.is_open).toBe(false)
      expect(store.notesLoading).toBe(false)
      expect(store.notesLoadError).toBeNull()
    })

    it('ignores plaintext revealed after lock', async () => {
      const store = useNotesStore()
      const reveal = deferred<string>()
      vi.mocked(notesApi.noteKeyStatus).mockResolvedValue({ is_set: true, is_open: true })
      vi.mocked(notesApi.listNotes).mockResolvedValue([mockNote({ encrypted: true, content_html: '' })])
      vi.mocked(notesApi.revealNote).mockReturnValue(reveal.promise)
      const loading = store.fetchNotes()
      await flushPromises()
      expect(notesApi.revealNote).toHaveBeenCalledWith('1')
      store.clearUnlockedNotes()
      reveal.resolve('<p>private after lock</p>')
      await loading
      expect(store.notes).toEqual([])
      expect(store.notePlains).toEqual({})
      expect(store.noteKey.is_open).toBe(false)
    })

    it('does not let an old failed fetch clear a new fetch state', async () => {
      const store = useNotesStore()
      const oldList = deferred<Note[]>()
      const newList = deferred<Note[]>()
      vi.mocked(notesApi.noteKeyStatus).mockResolvedValue({ is_set: false, is_open: false })
      vi.mocked(notesApi.listNotes).mockReturnValueOnce(oldList.promise).mockReturnValueOnce(newList.promise)
      const oldFetch = store.fetchNotes()
      await flushPromises()
      store.clearUnlockedNotes()
      const newFetch = store.fetchNotes()
      await flushPromises()
      oldList.reject(new Error('old session failed'))
      await oldFetch
      expect(store.notesLoading).toBe(true)
      expect(store.notesLoadError).toBeNull()
      newList.resolve([mockNote({ content_html: '<p>new session</p>' })])
      await newFetch
      expect(store.notes[0].content_html).toBe('<p>new session</p>')
      expect(store.notesLoading).toBe(false)
    })

    it.each(['setup', 'unlock', 'recover'] as const)('ignores late note-domain %s plaintext', async (operation) => {
      const store = useNotesStore()
      store.notes = [mockNote({ encrypted: true, content_html: '' })]
      const plains = deferred<{ id: string; html: string }[]>()
      vi.mocked(notesApi.noteKeySetup).mockReturnValue(plains.promise)
      vi.mocked(notesApi.noteKeyUnlock).mockReturnValue(plains.promise)
      vi.mocked(notesApi.noteKeyRecover).mockReturnValue(plains.promise)
      const pending = operation === 'setup' ? store.setupNoteKey('note-password')
        : operation === 'unlock' ? store.unlockNoteDomain('note-password')
          : store.recoverNoteDomain()
      store.clearUnlockedNotes()
      plains.resolve([{ id: '1', html: '<p>private after lock</p>' }])
      expect(await pending).toBe('应用已锁定')
      expect(store.notes).toEqual([])
      expect(store.notePlains).toEqual({})
      expect(store.noteKey.is_open).toBe(false)
    })

    it('ignores a single-note unlock returned after lock', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ encrypted: true, content_html: '' })]
      const plain = deferred<string>()
      vi.mocked(notesApi.unlockNote).mockReturnValue(plain.promise)
      const pending = store.unlockNote('1')
      store.clearUnlockedNotes()
      plain.resolve('<p>private after lock</p>')
      expect(await pending).toBe('应用已锁定')
      expect(store.notes).toEqual([])
      expect(store.notePlains).toEqual({})
    })
  })

  describe('publishNote', () => {
    it('从正文首行截取标题，取第一个标签作为分类', async () => {
      const store = useNotesStore()
      vi.mocked(notesApi.createNote).mockResolvedValue(mockNote({ category: '重要' }))

      await store.publishNote('<p>这是一条测试小记 #重要</p><p>第二行</p>')

      expect(notesApi.createNote).toHaveBeenCalledWith({
        title: '这是一条测试小记 #重要',
        content_html: '<p>这是一条测试小记 #重要</p><p>第二行</p>',
        category: '重要',
      })
      expect(store.notes[0].category).toBe('重要')
    })

    it('正文为空时不落库', async () => {
      const store = useNotesStore()

      expect(await store.publishNote('   ')).toBeNull()
      expect(await store.publishNote('<p></p>')).toBeNull()
      expect(notesApi.createNote).not.toHaveBeenCalled()
    })
  })

  describe('saveNoteContent', () => {
    it('stages each latest edit before saving so a successful update cannot be followed by stale staging', async () => {
      const store = useNotesStore()
      store.notes = [mockNote()]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      store.saveNoteContent('1', '<p>first</p>')
      await flushPromises()
      store.saveNoteContent('1', '<p>second</p>')
      await store.flushNoteSave()
      const stages = vi.mocked(notesApi.stageDrafts).mock.calls
      expect(stages[stages.length - 1]?.[0]).toEqual([{ id: '1', input: expect.objectContaining({ content_html: '<p>second</p>' }) }])
      const stageCalls = vi.mocked(notesApi.stageDrafts).mock.invocationCallOrder
      expect(stageCalls[stageCalls.length - 1]).toBeLessThan(vi.mocked(notesApi.updateNote).mock.invocationCallOrder[0])
    })

    it('permits lock after disk failure only once encrypted staging succeeds', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ encrypted: true })]
      store.notePlains = { '1': '<p>old</p>' }
      vi.mocked(notesApi.updateNote).mockRejectedValue(new Error('disk full'))
      store.saveNoteContent('1', '<p>private draft</p>')
      await store.prepareNoteLock()
      expect(notesApi.stageDrafts).toHaveBeenLastCalledWith([{ id: '1', input: expect.objectContaining({ content_html: '<p>private draft</p>' }) }])
      store.clearUnlockedNotes()
      expect(store.notePlains).toEqual({})
      expect(store.notes).toEqual([])
    })

    it('blocks manual lock when both disk save and staging fail', async () => {
      const store = useNotesStore()
      store.notes = [mockNote()]
      vi.mocked(notesApi.updateNote).mockRejectedValue(new Error('disk full'))
      vi.mocked(notesApi.stageDrafts).mockRejectedValue(new Error('stage failed'))
      store.saveNoteContent('1', '<p>keep me</p>')
      await expect(store.prepareNoteLock()).rejects.toThrow('stage failed')
      expect(store.notes[0].content_html).toBe('<p>keep me</p>')
    })

    it('encrypts failed drafts in process memory on forced lock and restores after unlock', async () => {
      vi.stubGlobal('crypto', webcrypto)
      try {
        const store = useNotesStore()
        store.notes = [mockNote({ encrypted: true })]
        store.notePlains = { '1': '<p>old</p>' }
        vi.mocked(notesApi.updateNote).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
        vi.mocked(notesApi.stageDrafts).mockRejectedValue(new Error('stage failed'))
        store.saveNoteContent('1', '<p>secret draft</p>')
        await store.prepareNoteLock(true)
        store.clearUnlockedNotes()
        expect(store.notePlains).toEqual({})
        expect(store.notes).toEqual([])
        vi.mocked(notesApi.stageDrafts).mockResolvedValue(undefined)
        store.notes = [mockNote({ encrypted: true, content_html: '' })]
        store.notePlains = { '1': '<p>old</p>' }
        await store.recoverDrafts()
        expect(store.notes[0].content_html).toBe('<p>secret draft</p>')
        await store.flushNoteSave()
        expect(notesApi.stageDrafts).toHaveBeenLastCalledWith([{ id: '1', input: expect.objectContaining({ content_html: '<p>secret draft</p>' }) }])
        expect(notesApi.updateNote).toHaveBeenLastCalledWith('1', expect.objectContaining({ content_html: '<p>secret draft</p>' }))
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('seals unpublished composer text before lock and restores it after unlock', async () => {
      vi.stubGlobal('crypto', webcrypto)
      try {
        const store = useNotesStore()
        store.noteDraftHtml = '<p>unpublished private note</p>'
        await store.prepareNoteLock()
        store.clearUnlockedNotes()
        expect(store.noteDraftHtml).toBe('')
        await store.recoverDrafts()
        expect(store.noteDraftHtml).toBe('<p>unpublished private note</p>')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('discards old pending edits and sealed drafts when a backup replaces the database', async () => {
      vi.stubGlobal('crypto', webcrypto)
      try {
        const store = useNotesStore()
        store.notes = [mockNote()]
        store.noteDraftHtml = '<p>old composer</p>'
        vi.mocked(notesApi.updateNote).mockRejectedValue(new Error('disk full'))
        store.saveNoteContent('1', '<p>old edit</p>')
        await store.forceSealDrafts()
        store.discardDraftsForRestore()
        expect(store.noteDraftHtml).toBe('')
        expect(store.notes).toEqual([])

        store.notes = [mockNote({ content_html: '<p>restored database</p>' })]
        await store.recoverDrafts()
        await store.flushNoteSave()
        expect(store.notes[0].content_html).toBe('<p>restored database</p>')
        expect(store.noteDraftHtml).toBe('')
        expect(notesApi.updateNote).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('does not let an old asynchronous seal repopulate drafts after restore', async () => {
      let resolveOldKey!: (key: CryptoKey) => void
      let keyCalls = 0
      vi.stubGlobal('crypto', {
        getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        subtle: {
          generateKey: (...args: Parameters<typeof webcrypto.subtle.generateKey>) => {
            keyCalls++
            if (keyCalls === 1) return new Promise<CryptoKey>(resolve => { resolveOldKey = resolve })
            return webcrypto.subtle.generateKey(...args)
          },
          encrypt: webcrypto.subtle.encrypt.bind(webcrypto.subtle),
          decrypt: webcrypto.subtle.decrypt.bind(webcrypto.subtle),
        },
      })
      try {
        const store = useNotesStore()
        store.noteDraftHtml = '<p>before restore</p>'
        const staleSeal = store.forceSealDrafts()
        store.discardDraftsForRestore()
        store.noteDraftHtml = '<p>after restore</p>'
        await store.forceSealDrafts()
        resolveOldKey(await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']))
        await staleSeal
        store.clearUnlockedNotes()
        await store.recoverDrafts()
        expect(store.noteDraftHtml).toBe('<p>after restore</p>')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('forced sealing bypasses a hung update and ignores its late failure after lock', async () => {
      vi.stubGlobal('crypto', webcrypto)
      try {
        const store = useNotesStore()
        store.notes = [mockNote()]
        let failOldWrite!: (error: Error) => void
        vi.mocked(notesApi.updateNote).mockImplementationOnce(() => new Promise<void>((_, reject) => { failOldWrite = reject }))
          .mockResolvedValue(undefined)
        store.saveNoteContent('1', '<p>last edit</p>')
        const blockedFlush = store.flushNoteSave()
        await flushPromises()
        expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
        await store.forceSealDrafts()
        store.clearUnlockedNotes()
        expect(store.notes).toEqual([])
        failOldWrite(new Error('backend already locked'))
        await blockedFlush
        store.notes = [mockNote()]
        await store.recoverDrafts()
        await store.flushNoteSave()
        expect(notesApi.updateNote).toHaveBeenLastCalledWith('1', expect.objectContaining({ content_html: '<p>last edit</p>' }))
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('recovers backend drafts only after the encrypted note has been unlocked', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ encrypted: true, content_html: '' })]
      vi.mocked(notesApi.recoverDrafts).mockResolvedValue([{
        id: '1', input: { title: 'draft', content_html: '<p>private</p>' },
      }])
      await store.recoverDrafts()
      expect(store.notes[0].content_html).toBe('')
      store.notePlains = { '1': '<p>old</p>' }
      await store.recoverDrafts()
      expect(store.notes[0].content_html).toBe('<p>private</p>')
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      await store.flushNoteSave()
      expect(notesApi.updateNote).toHaveBeenCalledWith('1', expect.objectContaining({ content_html: '<p>private</p>' }))
    })

    it('先乐观更新列表，防抖后再落库', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', title: '旧标题', content_html: '<p>旧标题</p>' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)

      store.saveNoteContent('1', '<p>新标题 #灵感</p>')

      expect(store.notes[0].title).toBe('新标题 #灵感')
      expect(store.notes[0].category).toBe('灵感')
      expect(notesApi.updateNote).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(600)
      expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
      expect(notesApi.updateNote).toHaveBeenCalledWith('1', {
        title: '新标题 #灵感',
        content_html: '<p>新标题 #灵感</p>',
        category: '灵感',
      })
    })

    it('flushNoteSave 立刻落库，切走书写面不丢最后一次编辑', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', content_html: '<p>旧</p>' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)

      store.saveNoteContent('1', '<p>新</p>')
      await store.flushNoteSave()

      expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
    })

    it('连续编辑只落库一次', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', content_html: '<p>旧</p>' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)

      store.saveNoteContent('1', '<p>新</p>')
      await vi.advanceTimersByTimeAsync(400)
      store.saveNoteContent('1', '<p>更新</p>')
      await vi.advanceTimersByTimeAsync(600)
      expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
      expect(notesApi.updateNote).toHaveBeenCalledWith('1',
        expect.objectContaining({ content_html: '<p>更新</p>' }))
    })

    it('防抖窗口内编辑两条小记，两条都会落库', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: 'a' }), mockNote({ id: 'b' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      store.saveNoteContent('a', '<p>A</p>')
      store.saveNoteContent('b', '<p>B</p>')
      await vi.advanceTimersByTimeAsync(600)
      expect(notesApi.updateNote).toHaveBeenCalledWith('a', expect.objectContaining({ content_html: '<p>A</p>' }))
      expect(notesApi.updateNote).toHaveBeenCalledWith('b', expect.objectContaining({ content_html: '<p>B</p>' }))
    })

    it('保存尚未返回时再次编辑，flush 等到最新内容写完', async () => {
      const store = useNotesStore()
      store.notes = [mockNote()]
      let finish!: () => void
      vi.mocked(notesApi.updateNote).mockImplementationOnce(() => new Promise<void>(r => { finish = r }))
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      store.saveNoteContent('1', '<p>第一版</p>')
      const first = store.flushNoteSave()
      await flushPromises()
      store.saveNoteContent('1', '<p>第二版</p>')
      let flushed = false
      const second = store.flushNoteSave().then(() => { flushed = true })
      expect(flushed).toBe(false)
      finish()
      await Promise.all([first, second])
      expect(notesApi.updateNote).toHaveBeenLastCalledWith('1', expect.objectContaining({ content_html: '<p>第二版</p>' }))
    })

    it('保存失败保留待提交内容，下次 flush 可以重试', async () => {
      const store = useNotesStore()
      store.notes = [mockNote()]
      vi.mocked(notesApi.updateNote).mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
      store.saveNoteContent('1', '<p>需要保住的内容</p>')
      await expect(store.flushNoteSave()).rejects.toThrow('disk full')
      await store.flushNoteSave()
      expect(notesApi.updateNote).toHaveBeenCalledTimes(2)
    })

    it('加密小记重锁前先保存正文，不能用清空后的正文提交', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ encrypted: true })]
      store.notePlains = { '1': '<p>旧内容</p>' }
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      store.saveNoteContent('1', '<p>新内容</p>')
      await store.relockNote('1')
      expect(notesApi.updateNote).toHaveBeenCalledWith('1', expect.objectContaining({ content_html: '<p>新内容</p>' }))
      expect(vi.mocked(notesApi.updateNote).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notesApi.relockNote).mock.invocationCallOrder[0])
      expect(store.notes[0].content_html).toBe('')
    })

    /** 正文里的图片 src 只有相对形态：换机器、换账号都不会让图片失效 */
    const bodyWithImg = (name: string) => `<img src="attachments/${name}">`

    it('编辑时新贴的图片会补登记，不然文件没人认领', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', content_html: '<p>旧</p>' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      vi.mocked(notesApi.bindAttachments).mockResolvedValue([])

      store.saveNoteContent('1', bodyWithImg('u9__a.png'))
      await store.flushNoteSave()

      expect(notesApi.bindAttachments).toHaveBeenCalledTimes(1)
      expect(notesApi.bindAttachments).toHaveBeenCalledWith('1', ['u9__a.png'])
    })

    /** 库里还没归一的旧数据（绝对路径 encode 成 URL）也要认，且落库时洗成相对 */
    it('旧机器的绝对路径 src 洗成相对形态再落库', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', content_html: '<p>旧</p>' })]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
      vi.mocked(notesApi.bindAttachments).mockResolvedValue([])
      const abs = 'C:\\Users\\jiang\\AppData\\Roaming\\desko\\attachments\\u9__a.png'
      const legacy = `<img src="http://asset.localhost/${encodeURIComponent(abs)}">`

      store.saveNoteContent('1', legacy)
      await store.flushNoteSave()

      expect(vi.mocked(notesApi.updateNote).mock.calls[0][1]).toMatchObject({
        content_html: bodyWithImg('u9__a.png'),
      })
      expect(notesApi.bindAttachments).toHaveBeenCalledWith('1', ['u9__a.png'])
    })

    it('已登记过的图片不重复补登记', async () => {
      const store = useNotesStore()
      store.notes = [mockNote({ id: '1', content_html: bodyWithImg('u9__a.png') })]
      store.noteAttachments['1'] = [{
        id: 'a1', note_id: '1', file_name: 'a.png', file_path: 'u9__a.png',
        file_size: 1, mime_type: 'image/png', created_at: 1,
      } as any]
      vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)

      store.saveNoteContent('1', bodyWithImg('u9__a.png') + '<p>加行字</p>')
      await store.flushNoteSave()

      expect(notesApi.bindAttachments).not.toHaveBeenCalled()
    })
  })

  describe('filteredNotes', () => {
    const seed = (store: ReturnType<typeof useNotesStore>) => {
      store.notes = [
        mockNote({ id: 'a', title: '甲', content_html: '<p>关键词 在正文 #工作</p>', pinned: true, created_at: 100, updated_at: 100 }),
        mockNote({ id: 'b', title: '乙', content_html: '<p>另一条 #灵感</p>', starred: true, created_at: 300, updated_at: 300 }),
        mockNote({ id: 'c', title: '丙', content_html: '<p>第三条</p>', created_at: 200, updated_at: 9999 }),
      ]
    }

    it('按纯文本匹配，不会命中 HTML 标签', async () => {
      const store = useNotesStore()
      seed(store)

      store.noteSearchKeyword = 'p>'
      expect(store.filteredNotes.length).toBe(0)

      store.noteSearchKeyword = '关键词'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['a'])
    })

    it('视图筛选：置顶 / 收藏', async () => {
      const store = useNotesStore()
      seed(store)

      store.noteView = 'pinned'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['a'])
      store.noteView = 'starred'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['b'])
    })

    it('标签是或关系', async () => {
      const store = useNotesStore()
      seed(store)

      store.toggleTagFilter('工作')
      expect(store.filteredNotes.map(n => n.id)).toEqual(['a'])
      store.toggleTagFilter('灵感')
      expect(store.filteredNotes.map(n => n.id).sort()).toEqual(['a', 'b'])
      store.toggleTagFilter('灵感')
      expect(store.filteredNotes.map(n => n.id)).toEqual(['a'])
    })

    it('排序：一律最新在前', async () => {
      const store = useNotesStore()
      seed(store)

      expect(store.filteredNotes.map(n => n.id)).toEqual(['b', 'c', 'a'])
    })

    it('清空筛选后恢复全量', async () => {
      const store = useNotesStore()
      seed(store)
      store.noteSearchKeyword = '关键词'
      store.toggleTagFilter('灵感')
      expect(store.hasActiveFilters).toBe(true)

      store.clearFilters()

      expect(store.hasActiveFilters).toBe(false)
      expect(store.filteredNotes.length).toBe(3)
    })
  })

  describe('groupedNotes', () => {
    it('置顶单独成组并排在最前', async () => {
      const store = useNotesStore()
      const now = Date.now()
      store.notes = [
        mockNote({ id: 'a', created_at: now }),
        mockNote({ id: 'b', created_at: now - 2 * 86400000 }),
        mockNote({ id: 'c', created_at: now, pinned: true }),
      ]

      const groups = store.groupedNotes

      expect(groups[0].pinned).toBe(true)
      expect(groups[0].notes.map(n => n.id)).toEqual(['c'])
      expect(groups[1].label).toBe('今天')
      expect(groups[1].notes.map(n => n.id)).toEqual(['a'])
    })
  })

  describe('tagCounts', () => {
    it('按出现次数从多到少排列', async () => {
      const store = useNotesStore()
      store.notes = [
        mockNote({ id: 'a', content_html: '<p>#少 #多</p>' }),
        mockNote({ id: 'b', content_html: '<p>#多</p>' }),
        mockNote({ id: 'c', content_html: '<p>#多</p>' }),
      ]

      expect(store.tagCounts).toEqual([['多', 3], ['少', 1]])
      expect(store.allTags).toEqual(['多', '少'])
      expect(store.viewCounts).toEqual({ all: 3, pinned: 0, starred: 0, archived: 0 })
    })
  })

  describe('归档', () => {
    const seed = () => [
      mockNote({ id: 'a', title: '甲', content_html: '<p>甲 #工作</p>' }),
      mockNote({ id: 'b', title: '乙', content_html: '<p>乙</p>', pinned: true, starred: true }),
      mockNote({ id: 'c', title: '丙', content_html: '<p>丙</p>', archived: true, archived_at: Date.now() }),
    ]

    it('归档行不进「全部/置顶/收藏」，只在归档视图出现', async () => {
      const store = useNotesStore()
      store.notes = seed()

      expect(store.filteredNotes.map(n => n.id)).toEqual(['a', 'b'])
      store.noteView = 'pinned'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['b'])
      store.noteView = 'starred'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['b'])
      store.noteView = 'archived'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['c'])
      expect(store.viewCounts).toEqual({ all: 2, pinned: 1, starred: 1, archived: 1 })
    })

    it('归档行不算进标签统计', async () => {
      const store = useNotesStore()
      store.notes = [
        mockNote({ content_html: '<p>#活</p>' }),
        mockNote({ id: 'c', content_html: '<p>#活</p>', archived: true }),
      ]

      expect(store.tagCounts).toEqual([['活', 1]])
    })

    it('归档视图里的关键词筛选照常生效', async () => {
      const store = useNotesStore()
      store.notes = seed()
      store.noteView = 'archived'
      store.noteSearchKeyword = '搜不到的词'

      expect(store.filteredNotes.length).toBe(0)
    })

    it('setArchived 只换归档位，不动置顶与收藏', async () => {
      const store = useNotesStore()
      store.notes = seed()
      vi.mocked(notesApi.setNoteArchived).mockResolvedValue(true)

      await store.setArchived(store.notes[1], true)

      expect(notesApi.setNoteArchived).toHaveBeenCalledWith('b', true)
      const b = store.notes.find(n => n.id === 'b')!
      expect(b.archived && b.pinned && b.starred && b.archived_at).toBeTruthy()
    })
  })

  describe('batchSetPinned', () => {
    it('只变更状态不符的那些', async () => {
      const store = useNotesStore()
      store.notes = [
        mockNote({ id: 'a', pinned: false }),
        mockNote({ id: 'b', pinned: true }),
      ]
      vi.mocked(notesApi.togglePinNote).mockResolvedValue(true)
      store.toggleSelectNote('a')
      store.toggleSelectNote('b')

      await store.batchSetPinned(true)

      expect(notesApi.togglePinNote).toHaveBeenCalledTimes(1)
      expect(notesApi.togglePinNote).toHaveBeenCalledWith('a')
      expect(store.notes.every(n => n.pinned)).toBe(true)
    })
  })

  describe('loadAttachments', () => {
    it('同一篇只取一次，避免 N+1', async () => {
      const store = useNotesStore()
      vi.mocked(notesApi.listAttachments).mockResolvedValue([])

      await store.loadAttachments('1')
      await store.loadAttachments('1')

      expect(notesApi.listAttachments).toHaveBeenCalledTimes(1)
    })
  })
})
