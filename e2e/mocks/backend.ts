// E2E 内存版 fake backend —— 镜像 src-tauri/src/commands/*.rs 的行为契约。
// 仅通过 vite alias 在 E2E 模式下注入，不进入生产构建。

export interface E2EEntrySeed {
  name: string
  url?: string
  username?: string
  password: string
  notes?: string
  category?: string
}

export interface E2ENoteSeed {
  title: string
  content_html: string
  category?: string
  pinned?: boolean
  starred?: boolean
}

export interface E2EFileShortcutSeed {
  name: string
  path: string
  shortcut_type: 'file' | 'folder'
}

export interface E2EUrlPathSeed {
  entry_index: number
  path: string
  label?: string
  notes?: string
}

export interface E2EConfig {
  /** true 时视为已初始化（设置过主密码），默认 true */
  initialized?: boolean
  masterPassword?: string
  entries?: E2EEntrySeed[]
  notes?: E2ENoteSeed[]
  fileShortcuts?: E2EFileShortcutSeed[]
  urlPaths?: E2EUrlPathSeed[]
  settings?: Record<string, string>
}

interface EntryRecord {
  id: string
  name: string
  url: string | null
  username: string | null
  notes: string | null
  category: string | null
  password: string
  created_at: number
  updated_at: number
}

interface NoteRecord {
  id: string
  title: string
  content_html: string
  category: string | null
  pinned: boolean
  starred: boolean
  created_at: number
  updated_at: number
}

interface UrlPathRecord {
  id: string
  entry_id: string
  path: string
  label: string | null
  notes: string | null
  created_at: number
}

interface FileShortcutRecord {
  id: string
  name: string
  path: string
  shortcut_type: 'file' | 'folder'
  created_at: number
}

interface AttachmentRecord {
  id: string
  note_id: string
  file_name: string
  file_path: string
  file_size: number
  mime_type: string
  created_at: number
}

export interface Invocation {
  cmd: string
  args: Record<string, unknown>
}

interface BackendState {
  initialized: boolean
  masterPassword: string
  unlocked: boolean
  unlockAttempts: number
  entries: EntryRecord[]
  notes: NoteRecord[]
  urlPaths: UrlPathRecord[]
  fileShortcuts: FileShortcutRecord[]
  attachments: AttachmentRecord[]
  settings: Record<string, string>
  sqlImport: string | null
}

declare global {
  interface Window {
    __E2E_CONFIG__?: E2EConfig
    __E2E__?: E2EBridge
  }
}

export interface E2EBridge {
  invocations: Invocation[]
  snapshot(): Record<string, unknown>
  reset(config?: E2EConfig): void
  seed(config: E2EConfig): void
  queueDialog(value: unknown): void
  emitEvent(event: string, payload?: unknown): void
  hasListener(event: string): boolean
  count(cmd: string): number
}

const DEFAULT_MASTER_PASSWORD = 'e2e-master-123'
const SETTINGS_ALLOWED_KEYS = ['auto_lock_timeout', 'lock_on_close']

// 错误以纯字符串 reject —— 与 Tauri v2 中 AppError(serialize 为 user_message) 一致
const ERR_NOT_INITIALIZED = '应用未初始化'
const ERR_ALREADY_INITIALIZED = '应用已初始化'
const ERR_WRONG_PASSWORD = '密码错误'
const ERR_NOT_UNLOCKED = '应用已锁定'
const ERR_ENTRY_NOT_FOUND = '记录不存在'
const ERR_DB = '操作失败'

function nextId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

class MockBackend {
  private state: BackendState
  readonly invocations: Invocation[] = []
  private dialogQueue: unknown[] = []
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>()

  constructor(config: E2EConfig = {}) {
    this.state = this.freshState(config)
    this.install()
  }

  private freshState(config: E2EConfig): BackendState {
    const now = Date.now()
    const state: BackendState = {
      initialized: config.initialized ?? true,
      masterPassword: config.masterPassword ?? DEFAULT_MASTER_PASSWORD,
      // 真实 app 启动时始终处于锁定态，需 unlock 命令解锁
      unlocked: false,
      unlockAttempts: 0,
      entries: [],
      notes: [],
      urlPaths: [],
      fileShortcuts: [],
      attachments: [],
      settings: { ...(config.settings ?? {}) },
      sqlImport: null,
    }

    // seed 数据按倒序时间戳，保证列表顺序确定（最新在前）
    ;(config.entries ?? []).forEach((e, i) => {
      const ts = now - (config.entries!.length - i) * 1000
      state.entries.push({
        id: nextId(),
        name: e.name,
        url: e.url ?? null,
        username: e.username ?? null,
        notes: e.notes ?? null,
        category: e.category ?? null,
        password: e.password,
        created_at: ts,
        updated_at: ts,
      })
    })
    ;(config.notes ?? []).forEach((n, i) => {
      const ts = now - (config.notes!.length - i) * 1000
      state.notes.push({
        id: nextId(),
        title: n.title,
        content_html: n.content_html,
        category: n.category ?? null,
        pinned: n.pinned ?? false,
        starred: n.starred ?? false,
        created_at: ts,
        updated_at: ts,
      })
    })
    ;(config.fileShortcuts ?? []).forEach((f, i) => {
      state.fileShortcuts.push({
        id: nextId(),
        name: f.name,
        path: f.path,
        shortcut_type: f.shortcut_type,
        created_at: now - (config.fileShortcuts!.length - i) * 1000,
      })
    })
    ;(config.urlPaths ?? []).forEach((p) => {
      const entry = state.entries[p.entry_index]
      if (!entry) return
      state.urlPaths.push({
        id: nextId(),
        entry_id: entry.id,
        path: p.path,
        label: p.label ?? null,
        notes: p.notes ?? null,
        created_at: now,
      })
    })
    return state
  }

  private install() {
    window.__E2E__ = {
      invocations: this.invocations,
      snapshot: () => JSON.parse(JSON.stringify(this.state)),
      reset: (config?: E2EConfig) => {
        this.state = this.freshState(config ?? {})
        this.invocations.length = 0
        this.dialogQueue.length = 0
      },
      seed: (config: E2EConfig) => {
        // 在现有 state 上追加 seed（不重置），时间戳同样倒序保证顺序
        const merged = this.freshState({
          ...config,
          initialized: this.state.initialized,
          masterPassword: this.state.masterPassword,
        })
        merged.unlocked = this.state.unlocked
        merged.unlockAttempts = this.state.unlockAttempts
        merged.entries = [...merged.entries, ...this.state.entries]
        merged.notes = [...merged.notes, ...this.state.notes]
        merged.urlPaths = [...merged.urlPaths, ...this.state.urlPaths]
        merged.fileShortcuts = [...merged.fileShortcuts, ...this.state.fileShortcuts]
        merged.settings = { ...this.state.settings, ...merged.settings }
        this.state = merged
      },
      queueDialog: (value: unknown) => this.dialogQueue.push(value),
      emitEvent: (event: string, payload?: unknown) => {
        this.eventListeners.get(event)?.forEach((h) => h(payload))
      },
      hasListener: (event: string) => (this.eventListeners.get(event)?.size ?? 0) > 0,
      count: (cmd: string) => this.invocations.filter((i) => i.cmd === cmd).length,
    }
  }

  // ---- 非 invoke 通道的记录（window / dialog / event 模块使用）----
  logInvocation(cmd: string, args: Record<string, unknown> = {}) {
    this.invocations.push({ cmd, args })
  }

  nextDialogResult(): unknown {
    return this.dialogQueue.length > 0 ? this.dialogQueue.shift() : null
  }

  onEvent(event: string, handler: (payload: unknown) => void): () => void {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set())
    this.eventListeners.get(event)!.add(handler)
    return () => this.eventListeners.get(event)?.delete(handler)
  }

  // ---- 命令路由 ----
  async invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    this.invocations.push({ cmd, args })
    const handler = this.commands[cmd]
    if (!handler) throw ERR_DB
    // 模拟异步 IPC
    await Promise.resolve()
    return handler(args)
  }

  private requireUnlocked() {
    if (!this.state.unlocked) throw ERR_NOT_UNLOCKED
  }

  private entryResponse(e: EntryRecord, withPaths = false) {
    const res: Record<string, unknown> = {
      id: e.id,
      name: e.name,
      url: e.url,
      username: e.username,
      notes: e.notes,
      category: e.category,
      created_at: e.created_at,
      updated_at: e.updated_at,
    }
    if (withPaths) {
      res.paths = this.listUrlPathsFor(e.id)
    }
    return res
  }

  private listUrlPathsFor(entryId: string) {
    return this.state.urlPaths
      .filter((p) => p.entry_id === entryId)
      .sort((a, b) => a.created_at - b.created_at)
      .map((p) => ({ ...p }))
  }

  private findEntry(id: string): EntryRecord {
    const e = this.state.entries.find((x) => x.id === id)
    if (!e) throw ERR_ENTRY_NOT_FOUND
    return e
  }

  private findNote(id: string): NoteRecord {
    const n = this.state.notes.find((x) => x.id === id)
    if (!n) throw ERR_ENTRY_NOT_FOUND
    return n
  }

  private findShortcut(id: string): FileShortcutRecord {
    const f = this.state.fileShortcuts.find((x) => x.id === id)
    if (!f) throw ERR_ENTRY_NOT_FOUND
    return f
  }

  private findUrlPath(id: string): UrlPathRecord {
    const p = this.state.urlPaths.find((x) => x.id === id)
    if (!p) throw ERR_DB
    return p
  }

  // handler 的 args 键名与 src/services/api/*.ts 中 JS 侧发送的一致
  // （Tauri v2 的 camelCase → snake_case 转换发生在 IPC 层，本 mock 在其之上）
  private commands: Record<string, (args: Record<string, any>) => unknown> = {
    // ===== auth.rs =====
    is_initialized: () => this.state.initialized,

    setup_master_password: ({ password }) => {
      if (this.state.initialized) throw ERR_ALREADY_INITIALIZED
      this.state.masterPassword = password
      this.state.initialized = true
      this.state.unlocked = true
      this.state.unlockAttempts = 0
    },

    unlock: ({ password }) => {
      if (this.state.unlockAttempts >= 5) {
        const delaySecs = (this.state.unlockAttempts - 4) * 5
        throw `尝试次数过多，请 ${delaySecs} 秒后重试`
      }
      if (password !== this.state.masterPassword) {
        this.state.unlockAttempts += 1
        throw ERR_WRONG_PASSWORD
      }
      this.state.unlocked = true
      this.state.unlockAttempts = 0
    },

    lock: () => {
      this.state.unlocked = false
      this.state.unlockAttempts = 0
    },

    change_master_password: ({ oldPassword, newPassword }) => {
      this.requireUnlocked()
      if (oldPassword !== this.state.masterPassword) throw ERR_WRONG_PASSWORD
      this.state.masterPassword = newPassword
    },

    // ===== entries.rs =====
    list_entries: () => {
      this.requireUnlocked()
      return this.state.entries
        .sort((a, b) => b.created_at - a.created_at)
        .map((e) => this.entryResponse(e))
    },

    list_entries_with_paths: () => {
      this.requireUnlocked()
      return this.state.entries
        .sort((a, b) => b.created_at - a.created_at)
        .map((e) => this.entryResponse(e, true))
    },

    create_entry: ({ input }) => {
      this.requireUnlocked()
      const now = Date.now()
      const entry: EntryRecord = {
        id: nextId(),
        name: input.name,
        url: input.url ?? null,
        username: input.username ?? null,
        notes: input.notes ?? null,
        category: input.category ?? null,
        password: input.password ?? '',
        created_at: now,
        updated_at: now,
      }
      this.state.entries.push(entry)
      return this.entryResponse(entry)
    },

    update_entry: ({ id, input }) => {
      this.requireUnlocked()
      const entry = this.findEntry(id)
      entry.name = input.name
      entry.url = input.url ?? null
      entry.username = input.username ?? null
      entry.notes = input.notes ?? null
      entry.category = input.category ?? null
      if (input.password !== undefined) entry.password = input.password
      entry.updated_at = Date.now()
      return this.entryResponse(entry)
    },

    delete_entry: ({ id }) => {
      this.requireUnlocked()
      this.state.urlPaths = this.state.urlPaths.filter((p) => p.entry_id !== id)
      this.state.entries = this.state.entries.filter((e) => e.id !== id)
    },

    batch_delete_entries: ({ ids }) => {
      this.requireUnlocked()
      const set = new Set<string>(ids)
      const before = this.state.entries.length
      this.state.urlPaths = this.state.urlPaths.filter((p) => !set.has(p.entry_id))
      this.state.entries = this.state.entries.filter((e) => !set.has(e.id))
      return before - this.state.entries.length
    },

    get_password: ({ id }) => {
      this.requireUnlocked()
      return this.findEntry(id).password
    },

    create_test_data: () => {
      this.requireUnlocked()
      const samples: Array<[string, string, string, string, string]> = [
        ['GitHub', 'https://github.com', 'user@example.com', 'Gh!tHub2024', '开发'],
        ['Gmail', 'https://mail.google.com', 'user@gmail.com', 'Gm@il#Secure', '邮箱'],
        ['钉钉', 'https://www.dingtalk.com', 'user@company.com', 'Ding!Talk88', '办公'],
        ['阿里云', 'https://www.aliyun.com', 'admin', 'Ali#Cloud2024', '开发'],
        ['腾讯文档', 'https://docs.qq.com', 'user@company.com', 'QQ@Docs66', '办公'],
        ['知乎', 'https://www.zhihu.com', 'zhangsan', 'Zhihu!2024', '社交'],
        ['Outlook', 'https://outlook.office.com', 'user@company.com', 'Out@look99', '邮箱'],
        ['Jira', 'https://jira.company.com', 'user', 'J!ra#Board', '办公'],
        ['Stack Overflow', 'https://stackoverflow.com', 'dev_user', 'St@ck#2024', '开发'],
        ['微信', 'https://weixin.qq.com', 'zhangsan', 'Wx!Chat88', '社交'],
      ]
      const base = Date.now()
      samples.forEach(([name, url, username, password, category], i) => {
        const ts = base - (samples.length - i) * 1000
        this.state.entries.push({
          id: nextId(), name, url, username, notes: null, category,
          password, created_at: ts, updated_at: ts,
        })
      })
    },

    // ===== notes.rs =====
    list_notes: () => {
      this.requireUnlocked()
      return this.state.notes
        .slice()
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at - a.created_at)
        .map((n) => ({ ...n }))
    },

    create_note: ({ input }) => {
      this.requireUnlocked()
      const now = Date.now()
      const note: NoteRecord = {
        id: nextId(),
        title: input.title,
        content_html: input.content_html,
        category: input.category ?? null,
        pinned: false,
        starred: false,
        created_at: now,
        updated_at: now,
      }
      this.state.notes.push(note)
      return { ...note }
    },

    update_note: ({ id, input }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      note.title = input.title
      note.content_html = input.content_html
      note.category = input.category ?? null
      note.updated_at = Date.now()
    },

    delete_note: ({ id }) => {
      this.requireUnlocked()
      this.state.notes = this.state.notes.filter((n) => n.id !== id)
      this.state.attachments = this.state.attachments.filter((a) => a.note_id !== id)
    },

    batch_delete_notes: ({ ids }) => {
      this.requireUnlocked()
      const set = new Set<string>(ids)
      const before = this.state.notes.length
      this.state.notes = this.state.notes.filter((n) => !set.has(n.id))
      this.state.attachments = this.state.attachments.filter((a) => !set.has(a.note_id))
      return before - this.state.notes.length
    },

    toggle_pin_note: ({ id }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      note.pinned = !note.pinned
      return note.pinned
    },

    toggle_star_note: ({ id }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      note.starred = !note.starred
      return note.starred
    },

    list_attachments: ({ noteId }) => {
      this.requireUnlocked()
      return this.state.attachments
        .filter((a) => a.note_id === noteId)
        .sort((a, b) => b.created_at - a.created_at)
        .map((a) => ({ ...a }))
    },

    upload_attachment: ({ noteId, filePath }) => {
      this.requireUnlocked()
      this.findNote(noteId)
      const fileName = String(filePath).split(/[\\/]/).pop() || String(filePath)
      const att: AttachmentRecord = {
        id: nextId(),
        note_id: noteId,
        file_name: fileName,
        file_path: filePath,
        file_size: 0,
        mime_type: 'application/octet-stream',
        created_at: Date.now(),
      }
      this.state.attachments.push(att)
      return { ...att }
    },

    delete_attachment: ({ id }) => {
      this.requireUnlocked()
      this.state.attachments = this.state.attachments.filter((a) => a.id !== id)
    },

    // ===== settings.rs =====
    get_setting: ({ key }) => this.state.settings[key] ?? '',

    set_setting: ({ key, value }) => {
      if (!SETTINGS_ALLOWED_KEYS.includes(key)) throw ERR_DB
      this.state.settings[key] = value
    },

    // ===== data.rs =====
    export_sql: () => {
      this.requireUnlocked()
      return `-- e2e mock sql dump\n${JSON.stringify(this.state)}`
    },

    import_sql: ({ sql }) => {
      this.requireUnlocked()
      this.state.sqlImport = sql
    },

    get_db_path: () => 'C:/Users/e2e/AppData/Roaming/desko/desko.db',

    // ===== url_paths.rs =====
    list_url_paths: ({ entryId }) => {
      this.requireUnlocked()
      return this.listUrlPathsFor(entryId)
    },

    create_url_path: ({ input }) => {
      this.requireUnlocked()
      const rec: UrlPathRecord = {
        id: nextId(),
        entry_id: input.entry_id,
        path: input.path,
        label: input.label ?? null,
        notes: input.notes ?? null,
        created_at: Date.now(),
      }
      this.state.urlPaths.push(rec)
      return { ...rec }
    },

    update_url_path: ({ id, input }) => {
      this.requireUnlocked()
      const rec = this.findUrlPath(id)
      rec.path = input.path
      rec.label = input.label ?? null
      rec.notes = input.notes ?? null
    },

    delete_url_path: ({ id }) => {
      this.requireUnlocked()
      this.state.urlPaths = this.state.urlPaths.filter((p) => p.id !== id)
    },

    // ===== file_shortcuts.rs =====
    // 注意：update_file_shortcut 的 JS 侧是扁平参数 { id, ...input }
    list_file_shortcuts: () => {
      this.requireUnlocked()
      return this.state.fileShortcuts
        .slice()
        .sort((a, b) => b.created_at - a.created_at)
        .map((f) => ({ ...f }))
    },

    create_file_shortcut: ({ input }) => {
      this.requireUnlocked()
      const rec: FileShortcutRecord = {
        id: nextId(),
        name: input.name,
        path: input.path,
        shortcut_type: input.shortcut_type,
        created_at: Date.now(),
      }
      this.state.fileShortcuts.push(rec)
      return { ...rec }
    },

    update_file_shortcut: ({ id, name, path, shortcut_type }) => {
      this.requireUnlocked()
      const rec = this.findShortcut(id)
      if (name !== undefined && name !== null) rec.name = name
      if (path !== undefined && path !== null) rec.path = path
      if (shortcut_type !== undefined && shortcut_type !== null) rec.shortcut_type = shortcut_type
    },

    delete_file_shortcut: ({ id }) => {
      this.requireUnlocked()
      this.state.fileShortcuts = this.state.fileShortcuts.filter((f) => f.id !== id)
    },

    open_file: ({ path }) => {
      // 真实实现调用 OS open；mock 仅记录（已由 invoke 统一记录）
      void path
    },
  }
}

let instance: MockBackend | null = null

export function getBackend(): MockBackend {
  if (!instance) {
    instance = new MockBackend(window.__E2E_CONFIG__ ?? {})
  }
  return instance
}
