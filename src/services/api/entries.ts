import { invoke } from '@tauri-apps/api/core'
import type { Entry, CreateEntryInput, UpdateEntryInput } from '../../types'

export const entriesApi = {
  listEntries: (): Promise<Entry[]> =>
    invoke('list_entries'),
  listEntriesWithPaths: (): Promise<Entry[]> =>
    invoke('list_entries_with_paths'),
  createEntry: (input: CreateEntryInput): Promise<Entry> =>
    invoke('create_entry', { input }),
  updateEntry: (id: string, input: UpdateEntryInput): Promise<Entry> =>
    invoke('update_entry', { id, input }),
  deleteEntry: (id: string): Promise<void> =>
    invoke('delete_entry', { id }),
  batchDeleteEntries: (ids: string[]): Promise<number> =>
    invoke('batch_delete_entries', { ids }),
  getPassword: (id: string): Promise<string> =>
    invoke('get_password', { id }),
}
