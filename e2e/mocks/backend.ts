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
  /** 预置加密小记：passphrase 是它的解锁口令 */
  encrypted?: boolean
  passphrase?: string
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

export interface E2EMfaSeed {
  issuer?: string
  label: string
  secret?: string
  digits?: number
  period?: number
}

export interface E2EConfig {
  /** true 时视为已初始化（设置过主密码），默认 true */
  initialized?: boolean
  masterPassword?: string
  entries?: E2EEntrySeed[]
  notes?: E2ENoteSeed[]
  fileShortcuts?: E2EFileShortcutSeed[]
  urlPaths?: E2EUrlPathSeed[]
  mfaTokens?: E2EMfaSeed[]
  settings?: Record<string, string>
  /** 附件目录里"已落盘"的文件名，用来演未引用扫描 */
  staged?: string[]
  fileshare?: { port?: number; shareDirs?: string[]; localOnly?: boolean; running?: boolean; boundPort?: number }
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
  encrypted: boolean
  /** 假加密：cipher 存原文，pass 存口令明文，只为复刻命令面的行为 */
  cipher: string
  pass: string
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

interface MfaRecord {
  id: string
  issuer: string
  label: string
  secret: string
  algorithm: string
  digits: number
  period: number
  createdAt: number
}

export interface Invocation {
  cmd: string
  args: Record<string, unknown>
}

interface BackupPackageRecord {
  name: string
  time: number
  size: number
  attachments: number | null
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
  mfa: MfaRecord[]
  attachments: AttachmentRecord[]
  /** 附件目录里"已落盘"的文件，用来演未引用扫描 */
  staged: { file_path: string; file_size: number }[]
  settings: Record<string, string>
  backup: { hasPassword: boolean; files: BackupPackageRecord[]; exports: string[] }
  cloud: { configured: boolean; server: string; account: string; lastSyncAt: number; packages: BackupPackageRecord[]; attachments: string[] }
  fileshare: { running: boolean; port: number; boundPort: number | null; shareDirs: string[]; localOnly: boolean; hasPassword: boolean }
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
// 与 src-tauri/src/commands/settings.rs 的 ALLOWED_KEYS 保持一致
const SETTINGS_ALLOWED_KEYS = ['auto_lock_timeout', 'lock_on_close', 'lock_on_system_lock', 'theme', 'auto_backup_interval', 'auto_backup_realtime', 'keep_remote', 'terminal', 'mfa_enabled', 'fileshare_enabled']

/** 与 Rust 端 backup::LOCAL_FLOOR 对齐：传上云的包本地只留这么几份兜底 */
const LOCAL_FLOOR = 3

// 错误以纯字符串 reject —— 与 Tauri v2 中 AppError(serialize 为 user_message) 一致
const ERR_NOT_INITIALIZED = '应用未初始化'
const ERR_ALREADY_INITIALIZED = '应用已初始化'
const ERR_WRONG_PASSWORD = '密码错误'
const ERR_NOT_UNLOCKED = '应用已锁定'
const ERR_ENTRY_NOT_FOUND = '记录不存在'
const ERR_DB = '操作失败'

/** 与 src/services/attachmentSrc.ts 的 nameOf 同形：任何写法都归成附件目录下的文件名 */
const nameOf = (p: unknown) => String(p).split(/[\\/]/).pop() || String(p)

/** 与 Rust attachment_service::mime_of 同表 */
function mimeOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain',
  }
  return map[ext] ?? 'application/octet-stream'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 与 Rust backup::package_name 同规则：desko-YYYYMMDD-HHMMSS */
function backupStamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function nextId(): string {  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
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
  /** 加密小记的会话解锁集：对齐 Rust 侧 AppState.note_keys，应用锁定即清 */
  private noteUnlocked = new Set<string>()

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
      mfa: [],
      attachments: [],
      staged: (config.staged ?? []).map((n) => ({
        // 与真实后端一致：库里只存附件目录下的文件名，绝对路径不进数据
        file_path: n,
        file_size: 2048,
      })),
      settings: { ...(config.settings ?? {}) },
      backup: { hasPassword: false, files: [], exports: [] },
      cloud: { configured: false, server: '', account: '', lastSyncAt: 0, packages: [], attachments: [] },
      fileshare: { running: false, port: 8000, boundPort: null, shareDirs: [], localOnly: false, hasPassword: false },
    }
    if (config.fileshare) {
      if (config.fileshare.port) state.fileshare.port = config.fileshare.port
      if (config.fileshare.shareDirs) state.fileshare.shareDirs = config.fileshare.shareDirs.slice()
      state.fileshare.localOnly = config.fileshare.localOnly ?? false
      state.fileshare.hasPassword = config.fileshare.hasPassword ?? false
      if (config.fileshare.running) {
        state.fileshare.running = true
        state.fileshare.boundPort = config.fileshare.boundPort ?? state.fileshare.port
      }
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
      const enc = !!n.encrypted
      state.notes.push({
        id: nextId(),
        title: enc ? '' : n.title,
        content_html: enc ? '' : n.content_html,
        category: enc ? null : (n.category ?? null),
        pinned: n.pinned ?? false,
        starred: n.starred ?? false,
        created_at: ts,
        updated_at: ts,
        encrypted: enc,
        cipher: enc ? n.content_html : '',
        pass: n.passphrase ?? '',
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
    ;(config.mfaTokens ?? []).forEach((t, i) => {
      state.mfa.push({
        id: nextId(),
        issuer: t.issuer ?? '',
        label: t.label,
        secret: t.secret ?? 'JBSWY3DPEHPK3PXP',
        algorithm: 'SHA1',
        digits: t.digits ?? 6,
        period: t.period ?? 30,
        createdAt: now - (config.mfaTokens!.length - i) * 1000,
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
        merged.mfa = [...merged.mfa, ...this.state.mfa]
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

  /** 命令内部主动推事件（backup-progress 等） */
  private emit(event: string, payload: unknown) {
    this.eventListeners.get(event)?.forEach((h) => h(payload))
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

  // ---- MFA：otpauth 解析逻辑与 mfa_service.rs 同形 ----
  private normalizeB32(raw: string): string {
    return raw.replace(/[\s-=]/g, '').toUpperCase()
  }

  private checkB32(s: string) {
    if (!s) throw '密钥不能为空'
    if (!/^[A-Z2-7]+$/.test(s)) throw '密钥不是有效的 Base32 字符串'
  }

  private mfaAddFromUri(uri: string) {
    const trimmed = uri.trim()
    if (!trimmed.startsWith('otpauth://totp/')) throw '只支持 TOTP 链接（otpauth://totp/…）'
    const tail = trimmed.slice('otpauth://totp/'.length)
    const qIdx = tail.indexOf('?')
    const labelPart = qIdx >= 0 ? tail.slice(0, qIdx) : tail
    const params = new Map<string, string>()
    if (qIdx >= 0) {
      for (const pair of tail.slice(qIdx + 1).split('&').filter(Boolean)) {
        const eq = pair.indexOf('=')
        const k = (eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase()
        const v = eq >= 0 ? pair.slice(eq + 1) : ''
        params.set(k, this.pctDecode(v))
      }
    }
    const decoded = this.pctDecode(labelPart)
    const colon = decoded.lastIndexOf(':')
    let issuer = colon >= 0 ? decoded.slice(0, colon).trim() : ''
    let label = colon >= 0 ? decoded.slice(colon + 1).trim() : decoded.trim()
    const issParam = (params.get('issuer') ?? '').trim()
    if (issParam) issuer = issParam
    if (!label) label = issuer
    if (!label) throw '链接里既没有账号名也没有站点名'
    const secret = this.normalizeB32(params.get('secret') ?? '')
    this.checkB32(secret)
    let digits = 6
    if (params.has('digits')) {
      const d = params.get('digits')!
      if (d !== '6' && d !== '7' && d !== '8') throw 'digits 只支持 6/7/8'
      digits = Number(d)
    }
    let period = 30
    if (params.has('period')) {
      period = Number(params.get('period'))
      if (!Number.isInteger(period) || period < 1 || period > 300) throw 'period 超出合理范围（1~300 秒）'
    }
    let algorithm = 'SHA1'
    if (params.has('algorithm')) {
      algorithm = params.get('algorithm')!.toUpperCase()
      if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm)) throw 'algorithm 只支持 SHA1/SHA256/SHA512'
    }
    return this.mfaPush(label, issuer, secret, algorithm, digits, period)
  }

  private pctDecode(s: string): string {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '))
    } catch {
      return s
    }
  }

  /** 入库并返回 MfaTokenInfo（camelCase，与 Rust serde 一致） */
  private mfaPush(label: string, issuer: string, secret: string, algorithm: string, digits: number, period: number) {
    const rec: MfaRecord = {
      id: nextId(),
      issuer,
      label,
      secret,
      algorithm,
      digits,
      period,
      createdAt: Date.now(),
    }
    this.state.mfa.push(rec)
    return {
      id: rec.id,
      issuer: rec.issuer,
      label: rec.label,
      algorithm: rec.algorithm,
      digits: rec.digits,
      period: rec.period,
      createdAt: rec.createdAt,
    }
  }

  /**
   * 把本地 spool 里还没传的推上云，然后收拾本地 —— 与真实后端同形：
   * 待传清单为空就一个请求都不发、也不刷新「最近同步」；传成功的包本地只留最近 3 份兜底。
   */
  private async uploadAndSettle(op: string) {
    const allAtt = ['u1__a.png', 'u2__b.png']
    const atts = allAtt.filter((a) => !this.state.cloud.attachments.includes(a))
    const pend = this.state.backup.files.filter((f) => !this.state.cloud.packages.some((p) => p.name === f.name))
    if (!atts.length && !pend.length) return
    for (let i = 0; i < atts.length; i++) {
      await sleep(40)
      this.emit('backup-progress', { op, text: `上传附件 ${i + 1}/${atts.length}`, pct: Math.round(((i + 1) / atts.length) * (pend.length ? 70 : 100)) })
    }
    this.state.cloud.attachments = allAtt
    for (let i = 0; i < pend.length; i++) {
      await sleep(40)
      this.emit('backup-progress', { op, text: `上传备份包 ${i + 1}/${pend.length}`, pct: 70 + Math.round(((i + 1) / pend.length) * 20) })
    }
    await sleep(40)
    this.emit('backup-progress', { op, text: '云端轮转', pct: 92 })
    await sleep(40)
    this.emit('backup-progress', { op, text: '完成', pct: 100 })
    // 远端只增不减（除了轮转）：本地清掉的那几份在云上还在
    const keepRemote = parseInt(this.state.settings.keep_remote || '20') || 20
    this.state.cloud.packages = [...pend, ...this.state.cloud.packages]
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, keepRemote)
    this.state.cloud.lastSyncAt = Date.now()
    // 本地只当中转用：确认躺在云端的那几份才删，超出兜底份数但没传上的留着
    const uploaded = new Set(this.state.cloud.packages.map((p) => p.name))
    this.state.backup.files = this.state.backup.files.filter((f, i) => i < LOCAL_FLOOR || !uploaded.has(f.name))
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
      this.noteUnlocked.clear()
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
      // 加密行只出锁标识：明文与标题一律不外泄
      return this.state.notes
        .slice()
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at - a.created_at)
        .map((n) => (n.encrypted ? { ...n, title: '', content_html: '', category: null } : { ...n }))
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
        encrypted: false,
        cipher: '',
        pass: '',
      }
      this.state.notes.push(note)
      return { ...note }
    },

    update_note: ({ id, input }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (note.encrypted) {
        // 加密行：没有会话解锁就不许改；改的只进密文，明文列保持空
        if (!this.noteUnlocked.has(id)) throw '小记未解锁'
        note.cipher = input.content_html
        note.updated_at = Date.now()
        return
      }
      note.title = input.title
      note.content_html = input.content_html
      note.category = input.category ?? null
      note.updated_at = Date.now()
    },

    delete_note: ({ id }) => {
      this.requireUnlocked()
      const paths = this.state.attachments.filter((a) => a.note_id === id).map((a) => a.file_path)
      this.state.notes = this.state.notes.filter((n) => n.id !== id)
      this.state.attachments = this.state.attachments.filter((a) => a.note_id !== id)
      this.state.staged = this.state.staged.filter((f) => !paths.includes(f.file_path))
      this.noteUnlocked.delete(id)
    },

    batch_delete_notes: ({ ids }) => {
      this.requireUnlocked()
      const set = new Set<string>(ids)
      const before = this.state.notes.length
      const paths = this.state.attachments.filter((a) => set.has(a.note_id)).map((a) => a.file_path)
      this.state.notes = this.state.notes.filter((n) => !set.has(n.id))
      this.state.attachments = this.state.attachments.filter((a) => !set.has(a.note_id))
      this.state.staged = this.state.staged.filter((f) => !paths.includes(f.file_path))
      ids.forEach((id: string) => this.noteUnlocked.delete(id))
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

    // ===== note_lock.rs 单条加密（假加密：只复刻命令面行为） =====
    lock_note: ({ id, passphrase }: { id: string; passphrase: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!passphrase) throw '加密口令不能为空'
      if (note.encrypted) throw '这条小记已加密'
      if (!note.content_html) throw '空内容不用加密'
      note.encrypted = true
      note.cipher = note.content_html
      note.pass = passphrase
      note.title = ''
      note.content_html = ''
      note.category = null
      note.updated_at = Date.now()
      this.noteUnlocked.add(id)
    },

    unlock_note: ({ id, passphrase }: { id: string; passphrase: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!note.encrypted) throw '这条小记没有加密'
      if (passphrase !== note.pass) throw ERR_WRONG_PASSWORD
      this.noteUnlocked.add(id)
      return note.cipher
    },

    unlock_note_by_master: ({ id, masterPassword }: { id: string; masterPassword: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!note.encrypted) throw '这条小记没有加密'
      if (masterPassword !== this.state.masterPassword) throw ERR_WRONG_PASSWORD
      this.noteUnlocked.add(id)
      return note.cipher
    },

    relock_note: ({ id }: { id: string }) => {
      this.noteUnlocked.delete(id)
    },

    remove_note_lock: ({ id, input }: { id: string; input: { title: string; content_html: string; category?: string | null } }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!this.noteUnlocked.has(id)) throw '小记未解锁'
      note.encrypted = false
      note.cipher = ''
      note.pass = ''
      note.title = input.title
      note.content_html = input.content_html
      note.category = input.category ?? null
      note.updated_at = Date.now()
      this.noteUnlocked.delete(id)
    },

    reveal_note: ({ id }: { id: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!note.encrypted || !this.noteUnlocked.has(id)) throw '小记未解锁'
      return note.cipher
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
      // 真实后端把文件收进附件目录，库里只留目录下的文件名
      const fileName = String(filePath).split(/[\\/]/).pop() || String(filePath)
      const att: AttachmentRecord = {
        id: nextId(),
        note_id: noteId,
        file_name: fileName,
        file_path: fileName,
        file_size: 0,
        mime_type: mimeOf(fileName),
        created_at: Date.now(),
      }
      this.state.attachments.push(att)
      return { ...att }
    },

    delete_attachment: ({ id }) => {
      this.requireUnlocked()
      this.state.attachments = this.state.attachments.filter((a) => a.id !== id)
    },

    // 真实后端会把文件拷进附件目录；mock 只记下文件名（库里存的就是它）
    stage_attachment: ({ filePath }) => {
      this.requireUnlocked()
      const p = String(filePath)
      const fileName = p.split(/[\\/]/).pop() || p
      this.state.staged.push({ file_path: fileName, file_size: 2048 })
      return {
        id: nextId(),
        note_id: '',
        file_name: fileName,
        file_path: fileName,
        file_size: 0,
        mime_type: 'image/png',
        created_at: Date.now(),
      }
    },

    // 无存活登记、也不被任何正文引用的落盘文件
    attachment_orphans: () => {
      this.requireUnlocked()
      const live = new Set(this.state.attachments.map((a) => nameOf(a.file_path)))
      const html = this.state.notes.map((n) => String(n.content_html || '')).join(' ')
      for (const f of this.state.staged) {
        const name = nameOf(f.file_path)
        // 规范形态是 attachments/<名>；老数据里那张整条路径 encode 的 src 也认
        if (name && (html.includes(name) || html.includes(encodeURIComponent(name)))) live.add(name)
      }
      return this.state.staged
        .filter((f) => !live.has(nameOf(f.file_path)))
        .map((f) => ({ name: nameOf(f.file_path), size: f.file_size }))
    },

    attachment_cleanup: ({ names }) => {
      this.requireUnlocked()
      const want = new Set(names as string[])
      const before = this.state.staged.length
      this.state.staged = this.state.staged.filter((f) => !want.has(nameOf(f.file_path)))
      this.state.attachments = this.state.attachments.filter((a) => !want.has(nameOf(a.file_path)))
      return before - this.state.staged.length
    },

    bind_attachments: ({ noteId, paths }) => {
      this.requireUnlocked()
      this.findNote(noteId)
      const bound: AttachmentRecord[] = []
      for (const raw of paths as string[]) {
        const name = nameOf(String(raw))
        if (this.state.attachments.some((a) => nameOf(a.file_path) === name)) continue
        const att: AttachmentRecord = {
          id: nextId(),
          note_id: noteId,
          file_name: name,
          file_path: name,
          file_size: 0,
          mime_type: 'image/png',
          created_at: Date.now(),
        }
        this.state.attachments.push(att)
        bound.push(att)
      }
      return bound.map((a) => ({ ...a }))
    },

    // ===== settings.rs =====
    get_setting: ({ key }) => this.state.settings[key] ?? '',

    set_setting: ({ key, value }) => {
      if (!SETTINGS_ALLOWED_KEYS.includes(key)) throw ERR_DB
      this.state.settings[key] = value
    },

    // ===== backup.rs =====
    backup_status: () => {
      this.requireUnlocked()
      const files = this.state.backup.files
      return {
        hasPassword: this.state.backup.hasPassword,
        intervalMin: parseInt(this.state.settings.auto_backup_interval ?? '5') || 0,
        realtime: this.state.settings.auto_backup_realtime === 'true',
        pending: files.filter((f) => !this.state.cloud.packages.some((p) => p.name === f.name)).length,
        lastRoundAt: files[0]?.time ?? 0,
        cloudConfigured: this.state.cloud.configured,
        // mock 的命令是同步跑的，没有后台线程这一档
        busy: false,
      }
    },

    backup_set_password: async ({ password }) => {
      this.requireUnlocked()
      if (!password || [...password].length < 8) throw '备份密码至少 8 位'
      await sleep(60)
      this.state.backup.hasPassword = true
      // 真实后端返回换头失败的文件名，mock 恒为空
      return []
    },

    /** 一轮 = 打包 + 上云 + 收拾本地，跟定时器跑的是同一件事。没连云端这个动作没有意义 */
    backup_run: async () => {
      this.requireUnlocked()
      if (!this.state.cloud.configured) throw '还没连接云端，备份无处可传'
      if (!this.state.backup.hasPassword) throw '请先设置备份密码'
      for (const [text, pct] of [['导出库快照', 8], ['镜像附件 3/3', 60], ['打包并加密（AES-256-GCM）', 88], ['完成', 100]] as const) {
        await sleep(40)
        this.emit('backup-progress', { op: 'pack', text, pct })
      }
      const now = Date.now()
      // 包名只到秒：连点两次会撞名，往后挪一秒（真实后端同样处理）
      let ts = now
      while (this.state.backup.files.some((f) => f.name === `desko-${backupStamp(ts)}.dsbk`)) ts += 1000
      const file: BackupPackageRecord = {
        name: `desko-${backupStamp(ts)}.dsbk`,
        time: ts,
        size: 262_144,
        attachments: 3,
      }
      this.state.backup.files.unshift(file)
      // 手动这一档不看自动开关：配了云端就传（force）
      await this.uploadAndSettle('upload')
      return { package: { ...file }, uploaded: true, error: null }
    },

    // 迁移导出：附件本体一起装进单个 .dsbk，写到用户选的路径，不进本地备份列表
    backup_export: async ({ path }) => {
      this.requireUnlocked()
      if (!this.state.backup.hasPassword) throw '请先设置备份密码'
      if (!String(path ?? '').endsWith('.dsbk')) throw '导出路径必须以 .dsbk 结尾'
      for (const [text, pct] of [['导出库快照', 8], ['装附件 3/3', 60], ['打包并加密（AES-256-GCM）', 88], ['完成', 100]] as const) {
        await sleep(40)
        this.emit('backup-progress', { op: 'export', text, pct })
      }
      this.state.backup.exports.push(String(path))
      return { name: String(path).replace(/^.*[\\/]/, ''), time: Date.now(), size: 5_242_880, attachments: 3 }
    },

    backup_restore_file: async ({ path, password }) => {
      this.requireUnlocked()
      if (!this.state.backup.hasPassword) throw '尚未设置备份密码'
      if (!String(path ?? '').endsWith('.dsbk')) throw '只能恢复 .dsbk 备份文件'
      if (!password) throw '备份密码错误'
      // 迁移包通常不在本机列表里（U 盘/新机器），所以不按 files 校验存在性
      for (const [text, pct] of [['解密备份包', 20], ['还原附件 3/3', 55], ['校验数据库完整性', 60], ['替换数据库', 92], ['完成', 100]] as const) {
        await sleep(40)
        this.emit('backup-progress', { op: 'restore', text, pct })
      }
    },

    // ===== cloud.rs（WebDAV 语义同形，网络部分为内存模拟）=====
    cloud_status: () => {
      this.requireUnlocked()
      const c = this.state.cloud
      return {
        configured: c.configured,
        server: c.server,
        account: c.account,
        keepRemote: parseInt(this.state.settings.keep_remote || '20') || 20,
        lastSyncAt: c.lastSyncAt,
        syncedPackages: c.packages.length,
        syncedAttachments: c.attachments.length,
      }
    },

    cloud_test_config: async ({ server, account, appPassword }) => {
      this.requireUnlocked()
      await sleep(80)
      if (!/^https:\/\/.+/.test(String(server ?? ''))) throw '服务器地址需为 https 开头'
      if (!account) throw '账号与应用密码不能为空'
      if (!appPassword && !this.state.cloud.configured) throw '账号与应用密码不能为空'
    },

    cloud_save_config: async ({ server, account, appPassword }) => {
      await this.commands.cloud_test_config({ server, account, appPassword })
      this.state.cloud.configured = true
      this.state.cloud.server = String(server).replace(/\/+$/, '')
      this.state.cloud.account = String(account)
    },

    cloud_disconnect: () => {
      this.requireUnlocked()
      this.state.cloud = { configured: false, server: '', account: '', lastSyncAt: 0, packages: [], attachments: [] }
    },

    cloud_list: () => {
      this.requireUnlocked()
      if (!this.state.cloud.configured) throw '尚未配置坚果云'
      return this.state.cloud.packages.map((f) => ({ name: f.name, size: f.size }))
    },

    cloud_restore: async ({ name, password }) => {
      this.requireUnlocked()
      if (!this.state.cloud.configured) throw '尚未配置坚果云'
      if (!this.state.cloud.packages.some((p) => p.name === name)) throw '备份文件不存在'
      if (!password) throw '备份密码错误'
      for (const [text, pct] of [['下载备份包', 8], ['解密备份包', 20], ['还原附件 3/3', 55], ['校验数据库完整性', 60], ['替换数据库', 92], ['完成', 100]] as const) {
        await sleep(40)
        this.emit('backup-progress', { op: 'restore', text, pct })
      }
    },

    get_db_path: () => 'C:/Users/e2e/AppData/Roaming/desko/desko.db',

    // 前端渲染图片时用来把 attachments/<名> 拼成 asset URL；库里永远不存它
    get_attachment_dir: () => 'C:/e2e/attachments',

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

    open_terminal: ({ path }) => {
      // 真实实现拉起终端进程；mock 仅记录
      void path
    },

    // ===== mfa.rs（错误文案与 services/mfa_service.rs 对齐）=====
    mfa_add_uri: ({ uri }) => {
      this.requireUnlocked()
      return this.mfaAddFromUri(String(uri ?? ''))
    },

    mfa_add_manual: ({ label, secret, issuer }) => {
      this.requireUnlocked()
      const norm = this.normalizeB32(String(secret ?? ''))
      this.checkB32(norm)
      const lab = String(label ?? '').trim()
      if (!lab) throw '账号名不能为空'
      return this.mfaPush(lab, String(issuer ?? '').trim(), norm, 'SHA1', 6, 30)
    },

    mfa_codes: () => {
      this.requireUnlocked()
      const now = Math.floor(Date.now() / 1000)
      return this.state.mfa
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => ({
          id: t.id,
          issuer: t.issuer,
          label: t.label,
          // mock 不做真 TOTP 计算，码只按位数给固定样式
          code: '12345678'.slice(0, t.digits),
          digits: t.digits,
          period: t.period,
          remaining: t.period - (now % t.period),
        }))
    },

    mfa_remove: ({ id }) => {
      this.requireUnlocked()
      const before = this.state.mfa.length
      this.state.mfa = this.state.mfa.filter((t) => t.id !== id)
      if (this.state.mfa.length === before) throw '账号已不存在'
    },

    // ===== fileshare.rs（端口 9999 专演"全部被占用"的失败路径）=====
    fileshare_status: () => {
      const f = this.state.fileshare
      const port = f.boundPort ?? f.port
      return {
        running: f.running,
        configuredPort: f.port,
        boundPort: f.running ? port : null,
        localUrl: `http://127.0.0.1:${port}`,
        lanUrl: f.localOnly ? `http://127.0.0.1:${port}` : `http://10.0.0.9:${port}`,
        shareCount: f.shareDirs.length,
        localOnly: f.localOnly,
      }
    },

    fileshare_start: () => {
      const f = this.state.fileshare
      if (!f.running && !f.shareDirs.length) f.shareDirs = ['C:\desko-e2e\shared']
      if (f.port === 9999) throw '端口 9999 起连续 11 个都被占用：Address already in use'
      f.running = true
      f.boundPort = f.port
      return this.commands!.fileshare_status()
    },

    fileshare_stop: () => {
      this.state.fileshare.running = false
      this.state.fileshare.boundPort = null
    },

    fileshare_get_config: () => {
      const f = this.state.fileshare
      return { port: f.port, shareDirs: f.shareDirs.slice(), localOnly: f.localOnly, hasPassword: f.hasPassword }
    },

    fileshare_save_config: ({ port, shareDirs, localOnly }) => {
      const f = this.state.fileshare
      const dirs = (shareDirs as string[] ?? []).map((d) => String(d).trim()).filter((d) => d)
      if (!dirs.length) throw '请至少添加一个共享目录'
      const p = Number(port)
      if (!Number.isInteger(p) || p < 1 || p > 65535) throw '端口要在 1-65535 之间'
      // 9999 演"端口全被占"：抛错必须发生在改状态之前，与真实命令层语义一致
      if (p === 9999) throw '端口 9999 起连续 11 个都被占用：Address already in use'
      const wasRunning = f.running
      f.port = p
      f.shareDirs = dirs
      f.localOnly = !!localOnly
      f.boundPort = wasRunning ? p : null
      return this.commands!.fileshare_status()
    },

    fileshare_set_password: ({ password }) => {
      this.state.fileshare.hasPassword = !!String(password ?? '')
    },

    mfa_read_image: ({ path }) => {
      this.requireUnlocked()
      const p = String(path ?? '').toLowerCase()
      if (!/\.(png|jpe?g|webp|bmp)$/.test(p)) throw '不支持的图片格式，请选择 png / jpg / jpeg / webp / bmp'
      // 真实后端回文件字节 base64；mock 回 3 个零字节，前端解析必然失败（测试只断言调用）
      return 'AAAA'
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
