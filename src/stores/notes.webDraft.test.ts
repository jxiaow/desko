import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '../services/transport'
import { notesApi } from '../services/api/notes'
import { useToastStore } from './toast'
import { useNotesStore } from './notes'
import type { Note } from '../types'

vi.mock('../services/transport', () => ({ invoke: vi.fn() }))
vi.mock('../services/api/settings', () => ({ settingsApi: { getSetting: vi.fn(async () => '') } }))
vi.mock('../services/api/notes', () => ({ notesApi: { recoverDrafts: vi.fn(async () => []), stageDrafts: vi.fn(async () => {}) } }))
const sealed = { iv: 'c3ludGhldGljLW5vbmNl', ciphertext: 'c3ludGhldGljLWNpcGhlcnRleHQ=' }
const html = '<p>局域网浏览器未发布草稿</p>'
let meta: HTMLMetaElement
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // Plain HTTP LAN browsers do not expose SubtleCrypto.
  vi.stubGlobal('crypto', {})
  meta = document.createElement('meta'); meta.name = 'desko-runtime'; meta.content = 'web'; document.head.append(meta)
  vi.mocked(invoke).mockImplementation(async command => command === 'web_seal_draft' ? sealed : command === 'web_open_draft' ? html : undefined)
})
afterEach(() => { meta.remove(); vi.unstubAllGlobals() })

describe('HTTP LAN unpublished drafts', () => {
  it('manual exit seals before clearing plaintext, and a new login recovers through the dedicated cipher RPC', async () => {
    const store = useNotesStore()
    store.noteDraftHtml = html
    await store.prepareNoteLock()
    expect(invoke).toHaveBeenCalledExactlyOnceWith('web_seal_draft', { plaintext: html })
    store.clearUnlockedNotes()
    expect(store.noteDraftHtml).toBe('')
    await store.recoverDrafts()
    expect(invoke).toHaveBeenCalledWith('web_open_draft', { sealed })
    expect(store.noteDraftHtml).toBe(html)
    expect(typeof crypto.subtle).toBe('undefined')
  })

  it('server expiration discards retained ciphertext and cannot replay an old draft after login', async () => {
    const store = useNotesStore()
    store.noteDraftHtml = html
    await store.prepareNoteLock()
    store.clearUnlockedNotes()
    store.discardDraftsForRestore()
    vi.mocked(invoke).mockClear()
    await store.recoverDrafts()
    expect(store.noteDraftHtml).toBe('')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('a stale service cipher is dropped with a readable message and cannot block the notes list', async () => {
    const store = useNotesStore()
    store.noteDraftHtml = html
    await store.prepareNoteLock()
    store.clearUnlockedNotes()
    vi.mocked(invoke).mockRejectedValueOnce(new Error('service key changed'))
    await expect(store.recoverDrafts()).resolves.toBeUndefined()
    expect(store.noteDraftHtml).toBe('')
    expect(useToastStore().toast.message).toContain('未保存草稿无法恢复')
    expect(notesApi.recoverDrafts).toHaveBeenCalledTimes(1)
    vi.mocked(invoke).mockClear()
    await store.recoverDrafts()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('401 during open clears old drafts without a late toast or further recovery request', async () => {
    const store = useNotesStore()
    store.noteDraftHtml = html
    await store.prepareNoteLock()
    store.clearUnlockedNotes()
    vi.mocked(invoke).mockImplementationOnce(async () => {
      store.discardDraftsForRestore()
      throw new Error('Web session expired')
    })
    await store.recoverDrafts()
    expect(store.noteDraftHtml).toBe('')
    expect(useToastStore().toast.show).toBe(false)
    expect(notesApi.recoverDrafts).not.toHaveBeenCalled()
  })

  it('drops only a bad pending-edit batch while preserving the valid composer and loaded notes', async () => {
    const batch = { ...sealed, ciphertext: 'invalid-batch' }
    const note: Note = {
      id: 'draft-note', title: 'Existing note', content_html: '<p>Saved content</p>',
      category: null, created_at: 1, updated_at: 1, pinned: false,
      starred: false, encrypted: false, archived: false, archived_at: null,
    }
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'web_seal_draft') return args?.plaintext === html ? sealed : batch
      if (command === 'web_open_draft') {
        if ((args?.sealed as typeof sealed).ciphertext === batch.ciphertext) throw new Error('invalid batch')
        return html
      }
    })
    const store = useNotesStore()
    store.notes = [note]
    store.saveNoteContent(note.id, '<p>Unsaved edit</p>')
    store.noteDraftHtml = html
    await store.forceSealDrafts()
    store.clearUnlockedNotes()
    store.notes = [note]
    await expect(store.recoverDrafts()).resolves.toBeUndefined()
    expect(store.noteDraftHtml).toBe(html)
    expect(store.notes[0].content_html).toBe('<p>Saved content</p>')
    expect(useToastStore().toast.message).toContain('一份暂存草稿无法恢复')
    vi.mocked(invoke).mockClear()
    await store.recoverDrafts()
    expect(invoke).not.toHaveBeenCalled()
  })

})
