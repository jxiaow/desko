import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useNotesStore } from './notes'
import { notesApi } from '../services/api/notes'
import type { Note } from '../types'

vi.mock('../services/api/notes', () => ({
  notesApi: {
    listNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    batchDeleteNotes: vi.fn(),
    togglePinNote: vi.fn(),
    toggleStarNote: vi.fn(),
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    stageAttachment: vi.fn(),
    bindAttachments: vi.fn(),
    orphans: vi.fn(),
    cleanupOrphans: vi.fn(),
  },
}))

vi.mock('./toast', () => ({
  useToastStore: () => ({ showToast: vi.fn() }),
}))

vi.mock('./confirm', () => ({
  useConfirmStore: () => ({ showConfirm: vi.fn() }),
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
  ...overrides,
})

describe('Notes Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
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

    it('排序：最新 / 最早 / 最近更新', async () => {
      const store = useNotesStore()
      seed(store)

      expect(store.filteredNotes.map(n => n.id)).toEqual(['b', 'c', 'a'])
      store.noteSort = 'old'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['a', 'c', 'b'])
      store.noteSort = 'updated'
      expect(store.filteredNotes.map(n => n.id)).toEqual(['c', 'b', 'a'])
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
      expect(store.viewCounts).toEqual({ all: 3, pinned: 0, starred: 0 })
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
