// URL Path for entries with multiple paths sharing the same credentials
export interface UrlPath {
  id: string
  entry_id: string
  path: string
  label: string | null
  notes: string | null
  created_at: number
}

// Entry response from backend (no encrypted password)
// Note: Backend uses snake_case, so we match that here
export interface Entry {
  id: string
  name: string
  url: string | null
  username: string | null
  notes: string | null
  category: string | null
  paths?: UrlPath[]
  created_at: number
  updated_at: number
}

// Input for creating a new entry
export interface CreateEntryInput {
  name: string
  url?: string
  username?: string
  password: string
  notes?: string
  category?: string
}

// Input for updating an entry
export interface UpdateEntryInput {
  name: string
  url?: string
  username?: string
  password?: string // if provided, will be re-encrypted
  notes?: string
  category?: string
}

// App state
export type AppState = 'setup' | 'locked' | 'unlocked'

// Tab for filtering entries
export interface Tab {
  id: string
  name: string
  count: number
}

// Note
export interface Note {
  id: string
  title: string
  content_html: string
  category: string | null
  created_at: number
  updated_at: number
  pinned: boolean
  starred: boolean
}

export interface Attachment {
  id: string
  note_id: string
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  created_at: number
}

export interface CreateNoteInput {
  title: string
  content_html: string
  category?: string
}

export interface UpdateNoteInput {
  title: string
  content_html: string
  category?: string
}

// URL Path inputs
export interface CreateUrlPathInput {
  entry_id: string
  path: string
  label?: string
  notes?: string
}

export interface UpdateUrlPathInput {
  path: string
  label?: string
  notes?: string
}

// File Shortcut
export interface FileShortcut {
  id: string
  name: string
  path: string
  shortcut_type: 'file' | 'folder'
  created_at: number
}

export interface CreateFileShortcutInput {
  name: string
  path: string
  shortcut_type: 'file' | 'folder'
}

export interface UpdateFileShortcutInput {
  name?: string
  path?: string
  shortcut_type?: 'file' | 'folder'
}
