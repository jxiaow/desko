import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { notesApi } from '../services/api/notes'
import { settingsApi } from '../services/api/settings'
import { useNotesStore } from './notes'
import { useConfirmStore } from './confirm'
import { useToastStore } from './toast'
import type { Note } from '../types'

vi.mock('../services/api/notes', () => ({ notesApi: {
  createNote: vi.fn(), bindAttachments: vi.fn(), lockNote: vi.fn(),
  deleteNote: vi.fn(), batchDeleteNotes: vi.fn(),
} }))
vi.mock('../services/api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))

const note = (id: string, over: Partial<Note> = {}): Note => ({
  id, title: id, content_html: `<p>${id}</p>`, category: null, created_at: 1, updated_at: 1,
  pinned: false, starred: false, encrypted: false, archived: false, archived_at: null, ...over,
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(notesApi.createNote).mockImplementation(async input => note('merged', input))
  vi.mocked(notesApi.bindAttachments).mockResolvedValue([])
  vi.mocked(notesApi.batchDeleteNotes).mockResolvedValue(2)
})

function selected(encrypted = false) {
  const store = useNotesStore()
  store.notes = [note('new', { created_at: 2, encrypted }), note('old', { encrypted })]
  store.selectedNoteIds = new Set(['new', 'old'])
  store.notePickMode = true
  if (encrypted) {
    store.noteKey = { is_set: true, is_open: true }
    store.notePlains = { old: '<p>old</p>', new: '<p>new</p>' }
  }
  return store
}

async function confirmMerge(store: ReturnType<typeof useNotesStore>) {
  store.mergeSelectedNotes()
  expect(useConfirmStore().confirmDialog.show).toBe(true)
  await useConfirmStore().confirmDialog.onConfirm()
}

describe('merge selected notes', () => {
  it('confirms deletion, concatenates old to new, derives metadata and exits selection', async () => {
    const store = selected()
    store.notes[0].content_html = '<p>new #工作</p>'
    store.notes[0].pinned = true
    store.notes[0].starred = true
    store.mergeSelectedNotes()
    expect(notesApi.createNote).not.toHaveBeenCalled()
    expect(useConfirmStore().confirmDialog).toMatchObject({ title: '合并小记', actionLabel: '合并', message: '2 条小记将合成一条，原条目将被删除，此操作不可撤销。' })
    await useConfirmStore().confirmDialog.onConfirm()
    expect(notesApi.createNote).toHaveBeenCalledWith({ title: 'old', content_html: '<p>old</p><p>new #工作</p>', category: '工作' })
    expect(store.notes).toHaveLength(1)
    expect(store.notes[0]).toMatchObject({ id: 'merged', pinned: false, starred: false, archived: false })
    expect(store.isBatchMode).toBe(false)
    expect(useToastStore().toast.message).toBe('已合并 2 条小记')
  })

  it('rejects mixed encryption without confirmation or API calls', () => {
    const store = selected()
    store.notes[0].encrypted = true
    store.mergeSelectedNotes()
    expect(useConfirmStore().confirmDialog.show).toBe(false)
    expect(notesApi.createNote).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('加密与未加密小记不能混合合并')
  })

  it('counts locked notes and rechecks unlocking after confirmation', async () => {
    const store = selected(true)
    store.noteKey.is_open = false
    store.mergeSelectedNotes()
    expect(useToastStore().toast.message).toBe('未合并：2 条小记未解锁')
    expect(useConfirmStore().confirmDialog.show).toBe(false)
    store.noteKey.is_open = true
    store.mergeSelectedNotes()
    delete store.notePlains.old
    await useConfirmStore().confirmDialog.onConfirm()
    expect(useToastStore().toast.message).toBe('未合并：1 条小记未解锁')
    expect(notesApi.createNote).not.toHaveBeenCalled()
  })

  it('encrypts using the session plaintext before deleting sources', async () => {
    const store = selected(true)
    store.notes.forEach(n => { n.content_html = '' })
    await confirmMerge(store)
    expect(notesApi.createNote).toHaveBeenCalledWith(expect.objectContaining({ content_html: '<p>old</p><p>new</p>' }))
    expect(vi.mocked(notesApi.lockNote).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notesApi.batchDeleteNotes).mock.invocationCallOrder[0])
    expect(store.notes[0].encrypted).toBe(true)
    expect(store.notePlains).toEqual({ merged: '<p>old</p><p>new</p>' })
  })

  it('leaves sources untouched when creating the result fails', async () => {
    const store = selected()
    vi.mocked(notesApi.createNote).mockRejectedValue('磁盘已满')
    await confirmMerge(store)
    expect(notesApi.batchDeleteNotes).not.toHaveBeenCalled()
    expect(notesApi.deleteNote).not.toHaveBeenCalled()
    expect(store.notes).toHaveLength(2)
    expect(useToastStore().toast.message).toBe('合并失败：磁盘已满')
  })

  it.each(['reject', 'partial'] as const)('compensates failed attachment registration (%s) without deleting sources', async mode => {
    const store = selected(true)
    store.notePlains.old = '<p><img src="attachments/x__a.png"></p>'
    if (mode === 'reject') vi.mocked(notesApi.bindAttachments).mockRejectedValue(new Error('登记失败'))
    await confirmMerge(store)
    expect(notesApi.bindAttachments).toHaveBeenCalledWith('merged', ['x__a.png'])
    expect(notesApi.deleteNote).toHaveBeenCalledWith('merged')
    expect(notesApi.lockNote).not.toHaveBeenCalled()
    expect(notesApi.batchDeleteNotes).not.toHaveBeenCalled()
    expect(store.notes.map(n => n.id)).toEqual(['new', 'old'])
    expect(store.selectedNoteIds.size).toBe(2)
    expect(useToastStore().toast.message).toContain('附件登记失败')
  })

  it('binds shared images before encryption and deletion', async () => {
    const store = selected(true)
    store.notePlains.old = '<img src="attachments/x__a.png">'
    vi.mocked(notesApi.bindAttachments).mockResolvedValue([{ id: 'a', note_id: 'merged', file_name: 'a.png', file_path: 'x__a.png', file_size: 1, mime_type: 'image/png', created_at: 1 }])
    await confirmMerge(store)
    expect(vi.mocked(notesApi.bindAttachments).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notesApi.lockNote).mock.invocationCallOrder[0])
    expect(vi.mocked(notesApi.lockNote).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(notesApi.batchDeleteNotes).mock.invocationCallOrder[0])
    expect(store.noteAttachments.merged).toHaveLength(1)
  })

  it('compensates encryption failure and explicitly reports failed compensation', async () => {
    const store = selected(true)
    vi.mocked(notesApi.lockNote).mockRejectedValue(new Error('口令已锁定'))
    vi.mocked(notesApi.deleteNote).mockRejectedValue(new Error('撤销失败'))
    await confirmMerge(store)
    expect(notesApi.batchDeleteNotes).not.toHaveBeenCalled()
    expect(notesApi.deleteNote).toHaveBeenCalledWith('merged')
    expect(store.notes).toHaveLength(3)
    expect(store.selectedNoteIds.size).toBe(2)
    expect(useToastStore().toast.message).toContain('新条目加密失败：口令已锁定；新条目撤销失败')
  })

  it('removes the temporary result after encryption fails', async () => {
    const store = selected(true)
    vi.mocked(notesApi.lockNote).mockRejectedValue('加密失败')
    await confirmMerge(store)
    expect(notesApi.deleteNote).toHaveBeenCalledWith('merged')
    expect(notesApi.batchDeleteNotes).not.toHaveBeenCalled()
    expect(store.notes.map(n => n.id)).toEqual(['new', 'old'])
    expect(store.notePlains.merged).toBeUndefined()
  })

  it('keeps the complete result and the selection when source deletion fails', async () => {
    const store = selected(true)
    vi.mocked(notesApi.batchDeleteNotes).mockRejectedValue(new Error('删除失败'))
    await confirmMerge(store)
    expect(store.notes).toHaveLength(3)
    expect(store.notes[0].encrypted).toBe(true)
    expect(store.selectedNoteIds.size).toBe(2)
    expect(notesApi.deleteNote).not.toHaveBeenCalled()
    expect(useToastStore().toast.message).toContain('新条目已生成，原条目删除失败')
  })

  it('does not delete sources or restore plaintext after application lock', async () => {
    const store = selected(true)
    vi.mocked(notesApi.bindAttachments).mockImplementation(async () => { store.clearUnlockedNotes(); return [] })
    store.notePlains.old = '<img src="attachments/x__a.png">'
    await confirmMerge(store)
    expect(notesApi.batchDeleteNotes).not.toHaveBeenCalled()
    expect(store.notes).toEqual([])
    expect(store.notePlains).toEqual({})
  })

  it('does not offer merging in the archived view or with one selected note', () => {
    const store = selected()
    store.noteView = 'archived'
    store.mergeSelectedNotes()
    expect(useConfirmStore().confirmDialog.show).toBe(false)
    store.noteView = 'all'
    store.selectedNoteIds = new Set(['old'])
    store.mergeSelectedNotes()
    expect(useConfirmStore().confirmDialog.show).toBe(false)
  })
})

describe('note paste preference', () => {
  it.each(['', 'true', 'false'])('loads %j, with a missing key defaulting to enabled', async value => {
    vi.mocked(settingsApi.getSetting).mockResolvedValue(value)
    const store = useNotesStore()
    await flushPromises()
    expect(store.notePasteCleanup).toBe(value !== 'false')
  })

  it('rolls back a failed setting write and persists the next successful change', async () => {
    const store = useNotesStore()
    await flushPromises()
    vi.mocked(settingsApi.setSetting).mockRejectedValueOnce(new Error('只读'))
    expect(await store.setNotePasteCleanup(false)).toBe(false)
    expect(store.notePasteCleanup).toBe(true)
    expect(await store.setNotePasteCleanup(false)).toBe(true)
    expect(store.notePasteCleanup).toBe(false)
    expect(settingsApi.setSetting).toHaveBeenLastCalledWith('note_paste_cleanup', 'false')
  })

  it('does not let an old startup read overwrite a newer setting change', async () => {
    let resolve!: (value: string) => void
    vi.mocked(settingsApi.getSetting).mockReturnValue(new Promise<string>(done => { resolve = done }))
    const store = useNotesStore()
    await store.setNotePasteCleanup(false)
    resolve('true')
    await flushPromises()
    expect(store.notePasteCleanup).toBe(false)
  })
})
