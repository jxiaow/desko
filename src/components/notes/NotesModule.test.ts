import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import NotesModule from './NotesModule.vue'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import NoteLockDialog from './NoteLockDialog.vue'
import { useNotesStore } from '../../stores/notes'
import { notesApi } from '../../services/api/notes'
import type { Note } from '../../types'

// Tiptap/ProseMirror 在 jsdom 里不是被测对象，换成轻量替身，只保留父子契约
vi.mock('./NoteEditor.vue', () => ({
  default: {
    name: 'NoteEditor',
    props: { variant: String, initialContent: String, placeholder: String },
    emits: ['update', 'submit'],
    template: '<div class="editor-stub"></div>',
    methods: {
      focusEnd() {},
      insertText() {},
    },
  },
}))

vi.mock('../../services/api/notes', () => ({
  notesApi: {
    listNotes: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    deleteNote: vi.fn(),
    batchDeleteNotes: vi.fn(),
    togglePinNote: vi.fn(),
    toggleStarNote: vi.fn(),
    lockNote: vi.fn(),
    unlockNote: vi.fn(),
    unlockNoteByMaster: vi.fn(),
    relockNote: vi.fn(),
    removeNoteLock: vi.fn(),
    revealNote: vi.fn(),
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}))

vi.mock('../../stores/confirm', () => ({
  useConfirmStore: () => ({
    showConfirm: vi.fn((_title: string, _msg: string, cb?: () => unknown) => {
      void cb?.()
      return true
    }),
  }),
}))

const NOW = new Date(2026, 8, 18, 12, 0, 0).getTime()

const makeNote = (over: Partial<Note> = {}): Note => ({
  id: 'a',
  title: '甲',
  content_html: '<p>甲内容 #工作</p>',
  category: null,
  created_at: NOW,
  updated_at: NOW,
  pinned: false,
  starred: false,
  encrypted: false,
  ...over,
})

const stageNotes = (notes: Note[]) => {
  vi.mocked(notesApi.listNotes).mockResolvedValue(notes)
}

let observers: Array<{ cb: (entries: any[]) => void }> = []

const mountModule = async () => {
  const wrapper = mount(NotesModule, {
    attachTo: document.createElement('div'),
  })
  await flushPromises()
  return wrapper
}

/** 正文单击不再进编辑，测试统一走只读卡片上的编辑按钮 */
const openCard = async (wrapper: Awaited<ReturnType<typeof mountModule>>, i = 0) => {
  await wrapper.findAll('.memo:not(.editing) .memo-edit')[i].trigger('click')
}

describe('NotesModule', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers({ now: NOW })
    observers = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: (entries: any[]) => void) {
        observers.push({ cb })
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    vi.mocked(notesApi.listAttachments).mockResolvedValue([])
    vi.mocked(notesApi.updateNote).mockResolvedValue(undefined)
    vi.mocked(notesApi.togglePinNote).mockResolvedValue(true)
    vi.mocked(notesApi.batchDeleteNotes).mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads notes on mount and groups them under today', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙内容</p>' })])
    const wrapper = await mountModule()

    expect(notesApi.listNotes).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.memo')).toHaveLength(2)
    expect(wrapper.find('.day-head').text()).toContain('今天')
    wrapper.unmount()
  })

  it('publishes a draft and hands the caret back to the composer', async () => {
    stageNotes([])
    const created = makeNote({ id: 'new', title: '新小记', content_html: '<p>新小记 #灵感</p>' })
    vi.mocked(notesApi.createNote).mockResolvedValue(created)
    const wrapper = await mountModule()

    const composer = wrapper.findComponent(NoteComposer)
    composer.vm.$emit('update', '<p>新小记 #灵感</p>')
    composer.vm.$emit('publish')
    await flushPromises()

    expect(notesApi.createNote).toHaveBeenCalledWith({
      title: '新小记 #灵感',
      content_html: '<p>新小记 #灵感</p>',
      category: '灵感',
    })
    expect(composer.props('html')).toBe('')
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    expect(wrapper.find('.memo.newborn').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens a card in place and autosaves edits with one debounced write', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()

    await openCard(wrapper)
    expect(wrapper.findAll('.memo.editing')).toHaveLength(1)
    expect(notesApi.listAttachments).toHaveBeenCalledWith('a')

    const card = wrapper.findComponent(NoteCard)
    card.vm.$emit('update', '<p>改成这样 #工作</p>')
    await flushPromises()
    expect(useNotesStore().notes[0].content_html).toBe('<p>改成这样 #工作</p>')

    await vi.advanceTimersByTimeAsync(600)
    expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notesApi.updateNote).mock.calls[0][1]).toMatchObject({
      content_html: '<p>改成这样 #工作</p>',
    })
    wrapper.unmount()
  })

  it('单击正文不进编辑，编辑只走悬停按钮', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()

    await wrapper.find('.memo').trigger('click')
    await vi.advanceTimersByTimeAsync(300)
    expect(wrapper.find('.memo.editing').exists()).toBe(false)

    await openCard(wrapper)
    expect(wrapper.find('.memo.editing').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps exactly one writing surface when switching cards', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙内容</p>' })])
    const wrapper = await mountModule()

    await openCard(wrapper, 0)
    wrapper.findComponent(NoteCard).vm.$emit('update', '<p>未保存的改动</p>')
    await flushPromises()

    await openCard(wrapper)
    expect(wrapper.findAll('.memo.editing')).toHaveLength(1)
    expect(wrapper.find('.memo:not(.editing)').text()).toContain('未保存的改动')

    await vi.advanceTimersByTimeAsync(600)
    expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notesApi.updateNote).mock.calls[0][0]).toBe('a')
    wrapper.unmount()
  })

  it('单条加密：上锁→重锁变锁卡→错口令拦下→对口令还原', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    vi.mocked(notesApi.lockNote).mockResolvedValue(undefined)
    vi.mocked(notesApi.unlockNote).mockImplementation(async (_id: string, pass: string) => {
      if (pass !== 'pw-1234') throw new Error('密码错误')
      return '<p>甲内容 #工作</p>'
    })
    vi.mocked(notesApi.relockNote).mockResolvedValue(undefined)

    // ⋯ 菜单发起加密：弹窗里填两遍口令
    wrapper.findComponent(NoteCard).vm.$emit('encrypt')
    await flushPromises()
    let dialog = wrapper.findComponent(NoteLockDialog)
    expect(dialog.exists()).toBe(true)
    const inputs = dialog.findAll('input[type="password"]')
    await inputs[0].setValue('pw-1234')
    await inputs[1].setValue('pw-1234')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(notesApi.lockNote).toHaveBeenCalledWith('a', 'pw-1234')
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    // 锁完本会话仍可读：有加密标、没有锁卡
    expect(wrapper.find('.state-enc').exists()).toBe(true)
    expect(wrapper.find('.memo-locked').exists()).toBe(false)

    // 重新锁定：卡片退化成锁标识，正文从 DOM 消失
    wrapper.findComponent(NoteCard).vm.$emit('relock')
    await flushPromises()
    expect(wrapper.find('.memo-locked').exists()).toBe(true)
    expect(wrapper.find('.memo-body').exists()).toBe(false)

    // 解锁：错口令留在弹窗里报，对口令还原正文
    wrapper.findComponent(NoteCard).vm.$emit('unlock')
    await flushPromises()
    dialog = wrapper.findComponent(NoteLockDialog)
    await dialog.find('input[type="password"]').setValue('错的')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(dialog.find('.lock-error').text()).toContain('密码错误')

    await dialog.find('input[type="password"]').setValue('pw-1234')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    expect(wrapper.find('.memo-locked').exists()).toBe(false)
    expect(wrapper.find('.memo-body').text()).toContain('甲内容')
    wrapper.unmount()
  })

  it('flushes a pending edit when the page unmounts', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    await openCard(wrapper)
    wrapper.findComponent(NoteCard).vm.$emit('update', '<p>切换模块前最后一笔</p>')
    await flushPromises()

    wrapper.unmount()
    expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notesApi.updateNote).mock.calls[0][1]).toMatchObject({
      content_html: '<p>切换模块前最后一笔</p>',
    })
  })

  it('closes the open card on Escape', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    await openCard(wrapper)
    expect(wrapper.find('.memo.editing').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.memo.editing').exists()).toBe(false)
    wrapper.unmount()
  })

  it('filters by keyword, view and tags from the rail', async () => {
    stageNotes([
      makeNote({ id: 'a', content_html: '<p>甲内容 #工作</p>' }),
      makeNote({ id: 'b', title: '乙', content_html: '<p>乙别的 #生活 #工作</p>' }),
      makeNote({ id: 'c', title: '丙', content_html: '<p>丙 #生活</p>', pinned: true }),
    ])
    const wrapper = await mountModule()
    const store = useNotesStore()
    await wrapper.find('.bar-btn[aria-label="展开侧栏"]').trigger('click')
    await flushPromises()

    await wrapper.find('input[aria-label="搜索小记"]').setValue('甲')
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    await wrapper.find('.search-clear').trigger('click')
    expect(store.noteSearchKeyword).toBe('')

    const clickRail = async (label: string) => {
      const item = wrapper.findAll('.rail .rail-item').find(i => i.text().includes(label))
      await item!.trigger('click')
    }

    await clickRail('置顶')
    expect(store.noteView).toBe('pinned')
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    await clickRail('全部')

    await clickRail('#工作')
    expect(store.activeTags.has('工作')).toBe(true)
    expect(wrapper.findAll('.memo')).toHaveLength(2)

    await clickRail('#生活') // OR 语义
    expect(wrapper.findAll('.memo')).toHaveLength(3)

    await wrapper.find('.rail-item.danger').trigger('click')
    expect(store.hasActiveFilters).toBe(false)
    expect(wrapper.findAll('.memo')).toHaveLength(3)
    wrapper.unmount()
  })

  it('filters by clicking an inline tag in a card', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙 #生活</p>' })])
    const wrapper = await mountModule()

    await wrapper.findAll('.tag-inline')[0].trigger('click')
    expect(useNotesStore().activeTags.has('工作')).toBe(true)
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    wrapper.unmount()
  })

  it('runs batch mode: select all, pin, then delete', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙</p>' })])
    const wrapper = await mountModule()
    const store = useNotesStore()

    const batchPill = () => wrapper.find('.bar-btn[aria-label="批量选择"]')
    await batchPill().trigger('click')
    await flushPromises()
    expect(store.isBatchMode).toBe(true)
    expect(wrapper.find('.batch-dock').exists()).toBe(true)
    expect(wrapper.find('.bar-btn[aria-label="退出批量"]').exists()).toBe(true)

    await wrapper.find('.dock-btn').trigger('click') // 全选
    expect(store.selectedNoteIds.size).toBe(2)
    expect(wrapper.findAll('.memo.is-sel')).toHaveLength(2)

    await wrapper.findAll('.dock-btn')[2].trigger('click') // 置顶
    await flushPromises()
    expect(store.notes.every(n => n.pinned)).toBe(true)

    await wrapper.find('.dock-btn.danger').trigger('click')
    await flushPromises()
    expect(store.notes).toHaveLength(0)
    wrapper.unmount()
  })

  it('hides the rail below the min room and shows the filter pill', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    await wrapper.find('.bar-btn[aria-label="展开侧栏"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('.rail').exists()).toBe(true)

    const fire = (width: number) => {
      observers[0].cb([{ contentRect: { width } }])
      return flushPromises()
    }

    await fire(700)
    expect(wrapper.find('.rail').exists()).toBe(false)
    expect(wrapper.find('[aria-label="筛选视图与标签"]').exists()).toBe(true)

    await fire(720) // 未跨越阈值不再改状态
    expect(wrapper.find('.rail').exists()).toBe(false)

    await fire(1200)
    expect(wrapper.find('.rail').exists()).toBe(true)
    wrapper.unmount()
  })

  it('starts with the rail collapsed and keeps the opened state across remounts', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    const store = useNotesStore()
    const pill = (w: typeof wrapper, label: string) =>
      w.find(`.bar-btn[aria-label="${label}侧栏"]`)

    // 默认收起，筛选入口回到顶栏
    expect(store.noteRailCollapsed).toBe(true)
    expect(wrapper.find('.rail').exists()).toBe(false)
    expect(wrapper.find('[aria-label="筛选视图与标签"]').exists()).toBe(true)

    await pill(wrapper, '展开').trigger('click')
    await flushPromises()
    expect(store.noteRailCollapsed).toBe(false)
    expect(wrapper.find('.rail').exists()).toBe(true)
    wrapper.unmount()

    // 展开是会话级的：切走再回来仍是展开的
    const again = await mountModule()
    expect(again.find('.rail').exists()).toBe(true)

    await pill(again, '收起').trigger('click')
    await flushPromises()
    expect(store.noteRailCollapsed).toBe(true)
    expect(again.find('.rail').exists()).toBe(false)
    again.unmount()
  })

  it('opens fullscreen for a note and routes its edits to autosave', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()

    wrapper.findComponent(NoteCard).vm.$emit('fullscreen')
    await flushPromises()
    expect(wrapper.find('.fs').exists()).toBe(true)

    wrapper.findComponent(NoteFullscreen).vm.$emit('update', '<p>全屏里改的</p>')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(600)
    expect(useNotesStore().notes[0].content_html).toBe('<p>全屏里改的</p>')
    expect(notesApi.updateNote).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
