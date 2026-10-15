import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import NotesModule from './NotesModule.vue'
import NoteCard from './NoteCard.vue'
import NoteComposer from './NoteComposer.vue'
import NoteFullscreen from './NoteFullscreen.vue'
import NoteLockDialog from './NoteLockDialog.vue'
import { useNotesStore } from '../../stores/notes'
import * as attachmentFiles from '../../services/attachmentSrc'
import { pickBrowserImage } from '../../services/browserImage'
import { notesApi } from '../../services/api/notes'
import type { Note } from '../../types'

vi.mock('../../services/browserImage', () => ({ pickBrowserImage: vi.fn() }))

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
    stageDrafts: vi.fn(),
    recoverDrafts: vi.fn(),
    deleteNote: vi.fn(),
    batchDeleteNotes: vi.fn(),
    togglePinNote: vi.fn(),
    toggleStarNote: vi.fn(),
    setNoteArchived: vi.fn(),
    batchSetArchived: vi.fn(),
    noteKeyStatus: vi.fn(),
    noteKeySetup: vi.fn(),
    noteKeyUnlock: vi.fn(),
    noteKeyRecover: vi.fn(),
    noteKeyRelock: vi.fn(),
    noteKeyChange: vi.fn(),
    lockNote: vi.fn(),
    unlockNote: vi.fn(),
    relockNote: vi.fn(),
    removeNoteLock: vi.fn(),
    revealNote: vi.fn(),
    listAttachments: vi.fn(),
    uploadAttachment: vi.fn(),
    stageAttachment: vi.fn(),
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
  archived: false,
  archived_at: null,
  ...over,
})

const stageNotes = (notes: Note[]) => {
  vi.mocked(notesApi.listNotes).mockResolvedValue(notes)
}

let observers: Array<{ cb: (entries: any[]) => void }> = []

const mountModule = async () => {
  // 域口令状态是 fetchNotes 的第一步，缺了就往下传 undefined
  vi.mocked(notesApi.noteKeyStatus).mockResolvedValue({ is_set: false, is_open: false })
  const wrapper = mount(NotesModule, {
    attachTo: document.createElement('div'),
  })
  await flushPromises()
  // 取数走注册表 boot（解锁时一次），组件挂载不再自取；测试按同一时序补这一刀
  await useNotesStore().fetchNotes()
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
    vi.mocked(notesApi.stageDrafts).mockResolvedValue(undefined)
    vi.mocked(notesApi.recoverDrafts).mockResolvedValue([])
    vi.mocked(notesApi.togglePinNote).mockResolvedValue(true)
    vi.mocked(notesApi.setNoteArchived).mockResolvedValue(true)
    vi.mocked(notesApi.batchSetArchived).mockResolvedValue(0)
    vi.mocked(notesApi.batchDeleteNotes).mockResolvedValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('浏览器选图期间卸载，迟到选择不能上传到后续页面', async () => {
    const meta = document.createElement('meta')
    meta.name = 'desko-runtime'; meta.content = 'web'; document.head.append(meta)
    let finish!: (file: File) => void
    vi.mocked(pickBrowserImage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    stageNotes([])
    const base = vi.spyOn(attachmentFiles, 'ensureAttachmentBase').mockResolvedValue(undefined)
    const wrapper = await mountModule()
    try {
      wrapper.findComponent(NoteComposer).vm.$emit('addImage')
      wrapper.unmount()
      finish(new File(['synthetic'], 'image.png', { type: 'image/png' }))
      await flushPromises()
      expect(notesApi.stageAttachment).not.toHaveBeenCalled()
    } finally { base.mockRestore(); meta.remove() }
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
    expect(useNotesStore().noteDraftHtml).toBe('')
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps unpublished fullscreen content when the module is unmounted and reopened', async () => {
    stageNotes([])
    let wrapper = await mountModule()
    wrapper.findComponent(NoteComposer).vm.$emit('fullscreen')
    await flushPromises()
    expect(wrapper.find('.save-hint').text()).toBe('未发布')
    wrapper.findComponent(NoteFullscreen).vm.$emit('update', '<p>切换页面后继续写 #工作</p>')
    await flushPromises()
    wrapper.unmount()

    wrapper = await mountModule()
    expect(wrapper.findComponent(NoteComposer).props('html')).toBe('<p>切换页面后继续写 #工作</p>')
    expect(notesApi.createNote).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('discarding unpublished content also clears it after reopening the module', async () => {
    stageNotes([])
    let wrapper = await mountModule()
    wrapper.findComponent(NoteComposer).vm.$emit('update', '<p>决定放弃的内容</p>')
    await flushPromises()
    const discard = wrapper.findComponent(NoteComposer).findAll('button').find(button => button.text() === '放弃')!
    await discard.trigger('click')
    expect(useNotesStore().noteDraftHtml).toBe('')
    wrapper.unmount()

    wrapper = await mountModule()
    expect(wrapper.findComponent(NoteComposer).props('html')).toBe('')
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

  it('小记口令：只设一次，锁回全部后才再问，错口令拦在弹窗里', async () => {
    stageNotes([makeNote()])
    vi.mocked(notesApi.noteKeySetup).mockImplementation(async (pass: string) => {
      if (pass !== 'note-pw-1234') throw new Error('口令太短')
      return [{ id: 'a', html: '<p>甲内容 #工作</p>' }]
    })
    vi.mocked(notesApi.noteKeyUnlock).mockImplementation(async (pass: string) => {
      if (pass !== 'note-pw-1234') throw new Error('密码错误')
      return [{ id: 'a', html: '<p>甲内容 #工作</p>' }]
    })
    vi.mocked(notesApi.noteKeyRelock).mockResolvedValue(undefined)
    vi.mocked(notesApi.lockNote).mockResolvedValue(undefined)
    vi.mocked(notesApi.unlockNote).mockResolvedValue('<p>甲内容 #工作</p>')
    vi.mocked(notesApi.relockNote).mockResolvedValue(undefined)

    const wrapper = await mountModule()

    // 口令没设过：加密动作先要一把全库口令（设的时候才要确认），设好当场补上这条加密
    wrapper.findComponent(NoteCard).vm.$emit('encrypt')
    await flushPromises()
    let dialog = wrapper.findComponent(NoteLockDialog)
    expect(dialog.exists()).toBe(true)
    const inputs = dialog.findAll('input[type="password"]')
    expect(inputs).toHaveLength(2)
    await inputs[0].setValue('note-pw-1234')
    await inputs[1].setValue('note-pw-1234')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(notesApi.noteKeySetup).toHaveBeenCalledWith('note-pw-1234')
    expect(notesApi.lockNote).toHaveBeenCalledWith('a')
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    // 锁完本会话仍可读：没有锁卡，也没有多余的角标（移出鼠标后不再亮一把闭锁）
    expect(wrapper.find('.memo-locked').exists()).toBe(false)
    expect(wrapper.find('.memo-state').text()).toBe('')

    // 单条重锁：卡片退化成锁标识，正文从 DOM 消失
    wrapper.findComponent(NoteCard).vm.$emit('relock')
    await flushPromises()
    expect(wrapper.find('.memo-locked').exists()).toBe(true)
    expect(wrapper.find('.memo-body').exists()).toBe(false)

    // 口令已在手：再开这一条不必再问
    wrapper.findComponent(NoteCard).vm.$emit('unlock')
    await flushPromises()
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    expect(notesApi.unlockNote).toHaveBeenCalledWith('a')
    expect(wrapper.find('.memo-body').text()).toContain('甲内容')

    // 锁回全部：整库重新上锁，之后再要口令
    await wrapper.find('.page-bar button[aria-label="锁回全部加密小记"]').trigger('click')
    await flushPromises()
    expect(notesApi.noteKeyRelock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.memo-locked').exists()).toBe(true)

    wrapper.findComponent(NoteCard).vm.$emit('unlock')
    await flushPromises()
    dialog = wrapper.findComponent(NoteLockDialog)
    expect(dialog.exists()).toBe(true)
    // 一把口令开全库：只有一格输入，没有确认格
    expect(dialog.findAll('input[type="password"]')).toHaveLength(1)
    await dialog.find('input[type="password"]').setValue('错的')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(dialog.find('.dialog-err').text()).toContain('密码错误')

    await dialog.find('input[type="password"]').setValue('note-pw-1234')
    await dialog.find('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    expect(wrapper.find('.memo-body').text()).toContain('甲内容')

    // 兜底：格子空着也能走「用主密码解开」，一键开全库
    await wrapper.find('.page-bar button[aria-label="锁回全部加密小记"]').trigger('click')
    await flushPromises()
    wrapper.findComponent(NoteCard).vm.$emit('unlock')
    await flushPromises()
    dialog = wrapper.findComponent(NoteLockDialog)
    vi.mocked(notesApi.noteKeyRecover).mockResolvedValue([{ id: 'a', html: '<p>甲内容 #工作</p>' }])
    await dialog.find('.link-btn').trigger('click')
    await flushPromises()
    expect(notesApi.noteKeyRecover).toHaveBeenCalledTimes(1)
    expect(wrapper.findComponent(NoteLockDialog).exists()).toBe(false)
    expect(wrapper.find('.memo-body').text()).toContain('甲内容')
    wrapper.unmount()
  })

  it('锁着的加密小记：真标题露出来认条，没标题只留提示', async () => {
    stageNotes([
      makeNote({ id: 'a', encrypted: true, title: '三月调档', content_html: '' }),
      makeNote({ id: 'b', encrypted: true, title: '', content_html: '' }),
    ])
    const wrapper = await mountModule()
    const cards = wrapper.findAllComponents(NoteCard)

    // 标题是 Rust 在锁的时候留下的明文（正文首行不外泄），锁卡上照样认得出是哪条
    expect(cards[0].find('.memo-locked').text()).toContain('三月调档')
    expect(cards[0].find('.memo-body').exists()).toBe(false)
    expect(cards[1].find('.locked-title').exists()).toBe(false)
    expect(cards[1].find('.memo-locked').text()).toContain('已加密 · 单击解锁')
    wrapper.unmount()
  })

  it('renders imported note markup without executable attributes or tags', async () => {
    stageNotes([makeNote({
      content_html: '<p>safe<script>evil()</script></p><img src="attachments/p.png" onerror="evil()"><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>task</p></div></li></ul>',
    })])
    const wrapper = await mountModule()
    expect(wrapper.find('.memo-body script').exists()).toBe(false)
    expect(wrapper.find('.memo-body img').attributes('onerror')).toBeUndefined()
    expect((wrapper.find('.memo-body input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })

  it('flushes a pending edit when the page unmounts', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()
    await openCard(wrapper)
    wrapper.findComponent(NoteCard).vm.$emit('update', '<p>切换模块前最后一笔</p>')
    await flushPromises()

    wrapper.unmount()
    await flushPromises()
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

  it('filters by clicking a footer tag in a card', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙 #生活</p>' })])
    const wrapper = await mountModule()

    await wrapper.findAll('.tag-pill')[0].trigger('click')
    expect(useNotesStore().activeTags.has('工作')).toBe(true)
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    wrapper.unmount()
  })

  it('runs batch mode: 勾选即进, select all, pin, then delete', async () => {
    stageNotes([makeNote(), makeNote({ id: 'b', title: '乙', content_html: '<p>乙</p>' })])
    const wrapper = await mountModule()
    const store = useNotesStore()

    // 勾选即进：点第一条卡的勾选位即入批量态，没有工具栏开关
    expect(store.isBatchMode).toBe(false)
    await wrapper.findAll('.memo-check')[0].trigger('click')
    await flushPromises()
    expect(store.isBatchMode).toBe(true)
    expect(wrapper.find('.batch-dock').exists()).toBe(true)

    await wrapper.find('.dock-btn').trigger('click') // 全选
    expect(store.selectedNoteIds.size).toBe(2)
    expect(wrapper.findAll('.memo.is-sel')).toHaveLength(2)

    await wrapper.findAll('.dock-btn')[2].trigger('click') // 置顶
    await flushPromises()
    expect(store.notes.every(n => n.pinned)).toBe(true)

    await wrapper.find('.dock-btn.danger').trigger('click')
    await flushPromises()
    expect(store.notes).toHaveLength(0)
    // 清空即收：删除后选中归零，批量态自动退出
    expect(store.isBatchMode).toBe(false)
    wrapper.unmount()
  })

  it('hides the rail below the min room but keeps the rail toggle', async () => {
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
    // 窄窗里侧栏只能叫成浮层，开关必须还在——否则视图与标签再没有入口
    expect(wrapper.find('.bar-btn[aria-label="展开侧栏"]').exists()).toBe(true)

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

    // 默认收起：右栏不出现，顶栏只剩选择与侧栏开关
    expect(store.noteRailCollapsed).toBe(true)
    expect(wrapper.find('.rail').exists()).toBe(false)
    expect(wrapper.find('.bar-btn[aria-label="展开侧栏"]').exists()).toBe(true)

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

  it('归档视图收掉草稿箱，只列归档行并给出一次性恢复', async () => {
    stageNotes([
      makeNote(),
      makeNote({ id: 'c', title: '丙', content_html: '<p>丙</p>', archived: true, archived_at: NOW }),
    ])
    const wrapper = await mountModule()
    expect(wrapper.find('.archive-bar').exists()).toBe(false)
    expect(wrapper.findComponent(NoteComposer).exists()).toBe(true)

    const store = useNotesStore()
    store.noteView = 'archived'
    await flushPromises()

    expect(wrapper.findComponent(NoteComposer).exists()).toBe(false)
    expect(wrapper.findAll('.memo')).toHaveLength(1)
    expect(wrapper.find('.archive-bar').text()).toContain('归档中 1 条')
    expect(wrapper.find('.ab-btn').text()).toContain('全部取消归档')

    vi.mocked(notesApi.batchSetArchived).mockResolvedValue(1)
    await wrapper.find('.ab-btn').trigger('click')
    await flushPromises()

    expect(notesApi.batchSetArchived).toHaveBeenCalledWith(['c'], false)
    wrapper.unmount()
  })

  it('卡片上的归档钮只翻归档位', async () => {
    stageNotes([makeNote()])
    const wrapper = await mountModule()

    wrapper.findComponent(NoteCard).vm.$emit('toggleArchive')
    await flushPromises()

    expect(notesApi.setNoteArchived).toHaveBeenCalledWith('a', true)
    expect(useNotesStore().notes[0].archived).toBe(true)
    wrapper.unmount()
  })
})
