// URL Path for entries with multiple paths sharing the same credentials
export interface UrlPath {
  id: string
  entry_id: string
  path: string
  label: string | null
  notes: string | null
  created_at: number
}

/** 编辑弹窗里的子路径草稿：未落库的带临时 id，删除只打标记，随「保存条目」一并提交 */
export interface LocalPath {
  id: string
  path: string
  label: string
  notes: string
  isNew: boolean
  isDeleted: boolean
  /** 库里存的是旧格式（整条地址），保存时改写回库 */
  dirty: boolean
}

// Entry response from backend (no encrypted password)// Note: Backend uses snake_case, so we match that here
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
  /** 单条加密：true 且本会话未解锁时 content_html 恒为空 */
  encrypted: boolean
  /** 归档：只在归档视图出现，不进「全部/置顶/收藏」与搜索 */
  archived: boolean
  archived_at: number | null
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
