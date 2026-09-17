import { invoke } from '@tauri-apps/api/core'
import type { Note, CreateNoteInput, UpdateNoteInput } from '../../types'

export const notesApi = {
  listNotes: (): Promise<Note[]> =>
    invoke('list_notes'),
  createNote: (input: CreateNoteInput): Promise<Note> =>
    invoke('create_note', { input }),
  updateNote: (id: string, input: UpdateNoteInput): Promise<void> =>
    invoke('update_note', { id, input }),
  deleteNote: (id: string): Promise<void> =>
    invoke('delete_note', { id }),
  batchDeleteNotes: (ids: string[]): Promise<number> =>
    invoke('batch_delete_notes', { ids }),
}
