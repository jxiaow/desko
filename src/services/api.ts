import { invoke } from '@tauri-apps/api/core'
import type { Entry, CreateEntryInput, UpdateEntryInput, Note, CreateNoteInput, UpdateNoteInput, UrlPath, CreateUrlPathInput, UpdateUrlPathInput, FileShortcut, CreateFileShortcutInput } from '../types'

export const api = {
  // Auth
  isInitialized: (): Promise<boolean> => invoke('is_initialized'),
  
  setupMasterPassword: (password: string): Promise<void> => 
    invoke('setup_master_password', { password }),
  
  unlock: (password: string): Promise<void> => 
    invoke('unlock', { password }),
  
  lock: (): Promise<void> => invoke('lock'),
  
  changeMasterPassword: (oldPassword: string, newPassword: string): Promise<void> =>
    invoke('change_master_password', { oldPassword, newPassword }),
  
  // Entries
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
  
  // Data
  exportSql: (): Promise<string> => invoke('export_sql'),
  
  getDbPath: (): Promise<string> => invoke('get_db_path'),
  
  importSql: (sql: string): Promise<void> => 
    invoke('import_sql', { sql }),
  
  createTestData: (): Promise<void> => 
    invoke('create_test_data'),

  // Notes
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

  // Settings
  getSetting: (key: string): Promise<string> =>
    invoke('get_setting', { key }),

  setSetting: (key: string, value: string): Promise<void> =>
    invoke('set_setting', { key, value }),

  // URL Paths
  listUrlPaths: (entryId: string): Promise<UrlPath[]> =>
    invoke('list_url_paths', { entryId }),

  createUrlPath: (input: CreateUrlPathInput): Promise<UrlPath> =>
    invoke('create_url_path', { input }),

  updateUrlPath: (id: string, input: UpdateUrlPathInput): Promise<void> =>
    invoke('update_url_path', { id, input }),

  deleteUrlPath: (id: string): Promise<void> =>
    invoke('delete_url_path', { id }),

  // File Shortcuts
  listFileShortcuts: (): Promise<FileShortcut[]> =>
    invoke('list_file_shortcuts'),

  createFileShortcut: (input: CreateFileShortcutInput): Promise<FileShortcut> =>
    invoke('create_file_shortcut', { input }),

  deleteFileShortcut: (id: string): Promise<void> =>
    invoke('delete_file_shortcut', { id }),
}
