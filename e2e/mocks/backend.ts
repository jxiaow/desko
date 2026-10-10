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
  /** 预置加密小记：口令在全库级（notePassphrase），不再逐条挂 */
  encrypted?: boolean
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
  /** 全库小记口令：给了就等于口令已设过，加密小记存在但锁着 */
  notePassphrase?: string
  /** 配合 notePassphrase：本会话是否已用口令解开 */
  noteOpen?: boolean
  /** 附件目录里"已落盘"的文件名，用来演未引用扫描 */
  staged?: string[]
  fileshare?: {
    port?: number
    shareDirs?: string[]
    localOnly?: boolean
    running?: boolean
    boundPort?: number
    hasPassword?: boolean
    /** 共享目录里"已存在"的文件名，用来演拖入同名避让 */
    imported?: string[]
  }
  /** 内网穿透：绑定态、进程态、二进制态各自独立，页面三格要能分别演 */
  tunnel?: {
    bound?: boolean
    alive?: boolean
    registered?: boolean
    pid?: number
    installed?: boolean
    /** 校验不符时的实际哈希；'network' 则演下载失败 */
    sha?: string
    fetchFail?: 'network' | 'content'
    /** 接入进度：每一格的初始态都要能单独摆，页面才演得出「中断后重进」 */
    authorized?: boolean
    tunnelId?: string
    tunnelName?: string
    /** 一条隧道挂着的 N 条服务：子域、本机端口、指没指过来、端口在不在听，各自能单独摆 */
    services?: { hostname: string; port: number; label?: string; preset?: string; routed?: boolean; listening?: boolean; hasPassword?: boolean; readOnly?: boolean }[]
    /** 本机凭据文件缺失：演「隧道在、凭据不在」 */
    credsMissing?: boolean
    /** 同名隧道存在但本机没记录 */
    nameTaken?: boolean
    /** 登记子域时账号里没有那个 zone */
    applyFail?: string
    /** 别处在跑的 connector 处数 */
    external?: number
  }
  /**
   * 直连清单：真探测要联网，E2E 只演判定形状。
   * verdict 决定「探测」出哪一份结论，targets 是清单里的预置行。
   */
  bypass?: {
    verdict?: 'directOk' | 'hostsOnly' | 'needRoute' | 'unreachable' | 'egressUnknown'
    /** 演 DoH 与探活全挂：命令面抛错，页面走 toast */
    probeFail?: boolean
    probe?: E2EBypassProbeSeed
    targets?: E2EBypassTargetSeed[]
    /** hosts 直连托管区的小账：不给就演成「区还没写过」 */
    hosts?: { managed?: number; error?: string }
  }
  codex?: {
    accounts?: {
      email: string
      account_name?: string
      plan_type?: string
      auth_mode?: 'oauth' | 'apikey'
      reauth?: boolean
      hourly?: number
      weekly?: number
      current?: boolean
      /** 行内三行事实的素材：用户 ID / 组织 / personal·team / 订阅到期 / 标签 */
      user_id?: string
      organization_id?: string
      account_structure?: string
      /** ISO 串或 unix 秒串都能给，覆盖两种解析分支 */
      subscription_until?: string
      tags?: string[]
      /** API Key 账号的供应商名与接口地址 */
      api_provider_name?: string
      api_base_url?: string
      /** 造一个带 auth_provider 的 id_token，验「使用 X 登录」的解码回显 */
      login_provider?: string
    }[]
    /** true 视为 OAuth 回调端口被占，演「先退出别的登录」那条提示 */
    portBusy?: boolean
    /** 会话可见性修复演练：fail 抛错走红色 toast，delayMs 让「正在修复」那档停住可截，rows 决定修了几处 */
    repairFail?: boolean
    repairDelayMs?: number
    repairRows?: number
  }
  /** 档案注册表：不给就用单个 default 档；activeId 缺省取列表首项 */
  profiles?: {
    activeId?: string
    list?: { id: string; name: string; cloudNs?: string }[]
  }
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
  /** 假加密：cipher 存原文，口令在全库那一份上，只为复刻命令面的行为 */
  cipher: string
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

/** 给定一次探测的判定输入：只给得出结论的形状，文案仍由下面的复刻函数拼 */
export interface E2EBypassTargetSeed {
  host: string
  input?: string
  kind?: 'domain' | 'ip' | 'cidr'
  port?: number
  path?: string
  scheme?: string
  address?: string
  interfaceName?: string
  nextHop?: string
  verdict?: 'directOk' | 'hostsOnly' | 'needRoute' | 'unreachable' | 'egressUnknown'
  stale?: boolean
  note?: string
}

/** 场景给的探测细节：不给就按 verdict 落一组通用值 */
export interface E2EBypassProbeSeed {
  host?: string
  kind?: 'domain' | 'ip' | 'cidr'
  port?: number
  path?: string
  scheme?: string
  address?: string
  interfaceName?: string
  source?: string
  nextHop?: string
  ifIndex?: number
  httpStatus?: number | null
  probeMs?: number | null
  pinned?: string | null
  realIps?: string[]
  cdn?: boolean
  localAnswers?: string[]
}

/** 与 Rust models::BypassTarget（camelCase）同形，mock 直接存线上形状 */
interface BypassTargetRecord {
  id: string
  host: string
  input: string
  kind: string
  port: number
  path: string
  scheme: string
  address: string
  interfaceName: string
  nextHop: string
  verdict: string
  stale: boolean
  note: string
  createdAt: number
  updatedAt: number
  checkedAt: number
}

/** 与 Rust bypass_service::ProbeReport（camelCase）同形 */
interface BypassReport {
  input: string
  target: { kind: string; host: string; port: number; path: string; scheme: string }
  pinned: string | null
  localAnswers: string[]
  hijacked: boolean
  realIps: string[]
  cdnLike: boolean
  chosen: string | null
  httpStatus: number | null
  probeMs: number | null
  egress: { ifIndex: number; interface: string; source: string; nextHop: string; isTaker: boolean } | null
  verdict: string
  recommend: boolean
  stale: boolean
  headline: string
  detail: string
  pending: string[]
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
  backup: { hasPassword: boolean; files: BackupPackageRecord[]; exports: string[]; busy: boolean }
  cloud: { configured: boolean; server: string; account: string; lastSyncAt: number; packages: BackupPackageRecord[]; attachments: string[] }
  fileshare: { running: boolean; port: number; boundPort: number | null; shareDirs: string[]; localOnly: boolean; hasPassword: boolean; imported: string[] }
  tunnel: {
    bound: boolean
    alive: boolean
    registered: boolean
    pid: number | null
    installed: boolean
    sha: string | null
    fetchFail: string | null
    authorized: boolean
    tunnelId: string | null
    tunnelName: string | null
    creds: boolean
    services: { id: string; hostname: string; port: number; label: string; preset: string; routed: boolean; listening: boolean; hasPassword: boolean; readOnly: boolean }[]
    nameTaken: boolean
    applyFail: string | null
    external: number
    loginState: 'idle' | 'waiting' | 'authorized' | 'timeout'
    loginUrl: string | null
    loginSecondsLeft: number
  }
  /** currentId 是显式指针，与后端 index.current_account_id 同构：导入/新增不动它，只有切号与登录落库才改 */
  codex: { accounts: CodexAccountRecord[]; portBusy: boolean; loginId: string; currentId: string; repairFail: boolean; repairDelayMs: number; repairRows: number }
  bypass: { targets: BypassTargetRecord[]; verdict: string; probeFail: boolean; probe: E2EBypassProbeSeed | null; hostsManaged: number; hostsError: string }
  profiles: { activeId: string; list: ProfileRecord[] }
}

/** 落盘档案元数据（snake→camel 由命令层做，这里存内部形状）；cloudBase/isActive 派生 */
interface ProfileRecord {
  id: string
  name: string
  cloudNs: string
  createdAt: number
  lastUsedAt: number
}

/** 与 models/codex.rs 的线上形状对齐（serde 保持 snake_case） */
interface CodexAccountRecord {
  id: string
  email: string
  auth_mode: 'oauth' | 'apikey'
  account_name: string | null
  account_note: string | null
  tags: string[]
  plan_type: string | null
  auth_file_plan_type: string | null
  account_id: string | null
  user_id: string | null
  organization_id: string | null
  account_structure: string | null
  subscription_active_until: string | null
  api_provider_name: string | null
  api_base_url: string | null
  requires_reauth: boolean
  /** 只为解 id_token 的 auth_provider，行内「使用 X 登录」用 */
  tokens: { id_token: string | null } | null
  quota: {
    hourly_percentage: number
    hourly_reset_time: number | null
    weekly_percentage: number
    weekly_reset_time: number | null
    reset_credits_available: number
  } | null
  usage_updated_at: number | null
  created_at: number
  last_used: number
}

/** 造一个只有根部 auth_provider 有用的假 id_token（base64url 分段） */
function fakeIdToken(authProvider: string): string {
  const seg = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${seg({ alg: 'none' })}.${seg({ auth_provider: authProvider, sub: 'sub-e2e' })}.sig`
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
  /** 演「后台正有一轮在跑」：真实后端的 busy 是原子闸门，mock 的命令是同步跑的，只能由测试拨 */
  setBackupBusy(busy: boolean): void
  hasListener(event: string): boolean
  count(cmd: string): number
}

const DEFAULT_MASTER_PASSWORD = 'e2e-master-123'
// 与 src-tauri/src/commands/settings.rs 的 ALLOWED_KEYS 保持一致
const SETTINGS_ALLOWED_KEYS = ['auto_lock_timeout', 'lock_on_close', 'lock_on_system_lock', 'theme', 'accent', 'auto_backup_interval', 'auto_backup_realtime', 'keep_remote', 'terminal', 'notes_enabled', 'entries_enabled', 'files_enabled', 'mfa_enabled', 'fileshare_enabled', 'tunnel_enabled', 'codex_enabled', 'bypass_enabled']

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

/** 与 Rust profile_service::base_for 同规则：ns 空 → desko，其余 desko-<ns> */
function baseFor(ns: string): string {
  return ns ? `desko-${ns}` : 'desko'
}

/** 与 bypass_service::parse_target 同档的粗解析：E2E 只要 host、端口与路径，真解析在 Rust 侧 */
function bypassAuthority(raw: string): string {
  return raw.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]
}

function bypassPort(raw: string, authority: string): number {
  const explicit = Number(authority.split(':')[1])
  if (Number.isInteger(explicit) && explicit > 0) return explicit
  return raw.toLowerCase().startsWith('http://') ? 80 : 443
}

function bypassPath(raw: string): string {
  if (!raw.includes('://')) return ''
  const rest = raw.replace(/^[a-z]+:\/\//i, '')
  const slash = rest.search(/[/?#]/)
  if (slash < 0) return ''
  return rest.slice(slash).split('#')[0].split('?')[0]
}

/** 与 Rust gen_id 同形：p- + 8 位十六进制 */
function genProfileId(): string {
  return 'p-' + nextId().replace(/-/g, '').slice(0, 8)
}

/** 镜像 Rust 的 note_service::heading_title：锁着也只露真标题（h1–h3），正文首行不外泄 */
const HTML_ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }

function headingTitle(html: string): string {
  const rest = html.replace(/^\s+/, '')
  const lower = rest.toLowerCase()
  const tag = ['h1', 'h2', 'h3'].find((t) => lower.startsWith(`<${t}`))
  if (!tag) return ''
  const openEnd = lower.indexOf('>')
  if (openEnd < 0) return ''
  const closeAt = lower.slice(openEnd).indexOf(`</${tag}>`)
  if (closeAt < 0) return ''
  const inner = rest.slice(openEnd + 1, openEnd + closeAt)
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39);/g, (m, k: string) => HTML_ENTITY[k] ?? m)
    .trim()
    .slice(0, 20)
}

class MockBackend {
  private state: BackendState
  readonly invocations: Invocation[] = []
  private dialogQueue: unknown[] = []
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>()
  /** 加密小记的会话解锁集：对齐 Rust 侧 AppState.note_keys，应用锁定即清 */
  private noteUnlocked = new Set<string>()
  /** 全库一把小记口令：空串表示还没设过；noteOpen 对齐 AppState.note_key */
  private notePass = ''
  private noteOpen = false

  constructor(config: E2EConfig = {}) {
    this.state = this.freshState(config)
    this.install()
  }

  private freshState(config: E2EConfig): BackendState {
    const now = Date.now()
    // 域口令跟着 state 一起重建：config 给了口令才算设过，noteOpen 才顺带解开
    this.noteUnlocked.clear()
    this.notePass = config.notePassphrase ?? ''
    this.noteOpen = !!config.noteOpen && !!this.notePass
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
      backup: { hasPassword: false, files: [], exports: [], busy: false },
      cloud: { configured: false, server: '', account: '', lastSyncAt: 0, packages: [], attachments: [] },
      fileshare: { running: false, port: 8000, boundPort: null, shareDirs: [], localOnly: false, hasPassword: false, imported: [] },
      tunnel: {
        bound: false,
        alive: false,
        registered: false,
        pid: null,
        installed: false,
        sha: null,
        fetchFail: null,
        authorized: false,
        tunnelId: null,
        tunnelName: null,
        creds: false,
        services: [],
        nameTaken: false,
        applyFail: null,
        external: 0,
        loginState: 'idle',
        loginUrl: null,
        loginSecondsLeft: 0,
      },
      bypass: {
        targets: (config.bypass?.targets ?? []).map((t, i, all) =>
          this.bypassRowFromSeed(t, now - (all.length - i) * 1000),
        ),
        verdict: config.bypass?.verdict ?? 'needRoute',
        probeFail: config.bypass?.probeFail ?? false,
        probe: config.bypass?.probe ?? null,
        hostsManaged: config.bypass?.hosts?.managed ?? 0,
        hostsError: config.bypass?.hosts?.error ?? '',
      },
      codex: { accounts: [], portBusy: false, loginId: '', currentId: '', repairFail: false, repairDelayMs: 0, repairRows: 3 },
      profiles: { activeId: 'default', list: [{ id: 'default', name: '默认', cloudNs: '', createdAt: now, lastUsedAt: now }] },
    }
    if (config.profiles) {
      const seed = config.profiles.list
      if (seed && seed.length) {
        state.profiles.list = seed.map((p, i) => ({
          id: p.id,
          name: p.name,
          cloudNs: p.cloudNs ?? '',
          createdAt: now - (seed.length - i) * 1000,
          lastUsedAt: now - (seed.length - i) * 1000,
        }))
        state.profiles.activeId = config.profiles.activeId ?? seed[0].id
      }
    }
    if (config.fileshare) {
      if (config.fileshare.port) state.fileshare.port = config.fileshare.port
      if (config.fileshare.shareDirs) state.fileshare.shareDirs = config.fileshare.shareDirs.slice()
      state.fileshare.localOnly = config.fileshare.localOnly ?? false
      state.fileshare.hasPassword = config.fileshare.hasPassword ?? false
      state.fileshare.imported = (config.fileshare.imported ?? []).slice()
      if (config.fileshare.running) {
        state.fileshare.running = true
        state.fileshare.boundPort = config.fileshare.boundPort ?? state.fileshare.port
      }
    }

    if (config.tunnel) {
      const t = config.tunnel
      const tn = state.tunnel
      tn.tunnelId = t.tunnelId ?? (t.bound ? 'e2e-tunnel-0001' : null)
      tn.tunnelName = tn.tunnelId ? t.tunnelName ?? 'e2e-desko' : null
      tn.bound = t.bound ?? Boolean(tn.tunnelId)
      tn.alive = t.alive ?? false
      tn.registered = t.registered ?? false
      tn.pid = t.pid ?? (t.alive ? 424242 : null)
      tn.installed = t.installed ?? false
      tn.sha = t.sha ?? null
      tn.fetchFail = t.fetchFail ?? null
      tn.authorized = t.authorized ?? Boolean(tn.tunnelId)
      tn.creds = tn.tunnelId ? !(t.credsMissing ?? false) : false
      tn.services = (t.services ?? []).map((s, i) => ({
        id: `e2e-svc-${i + 1}`,
        hostname: s.hostname,
        port: s.port,
        label: s.label ?? s.hostname,
        preset: s.preset ?? '',
        routed: s.routed ?? false,
        listening: s.listening ?? true,
        hasPassword: s.hasPassword ?? false,
        readOnly: s.readOnly ?? true,
      }))
      tn.nameTaken = t.nameTaken ?? false
      tn.applyFail = t.applyFail ?? null
      tn.external = t.external ?? 0
    }

    if (config.codex) {
      state.codex.portBusy = config.codex.portBusy ?? false
      state.codex.repairFail = config.codex.repairFail ?? false
      state.codex.repairDelayMs = config.codex.repairDelayMs ?? 0
      state.codex.repairRows = config.codex.repairRows ?? 3
      const seed = config.codex.accounts ?? []
      state.codex.accounts = seed.map((a, i) => {
        const ts = now - (seed.length - i) * 1000
        const hourly = a.hourly ?? 100
        const weekly = a.weekly ?? 100
        return {
          id: nextId(),
          email: a.email,
          auth_mode: a.auth_mode ?? 'oauth',
          account_name: a.account_name ?? null,
          account_note: null,
          tags: a.tags ?? [],
          plan_type: a.plan_type ?? null,
          auth_file_plan_type: a.plan_type ?? null,
          account_id: null,
          user_id: a.user_id ?? null,
          organization_id: a.organization_id ?? null,
          account_structure: a.account_structure ?? null,
          subscription_active_until: a.subscription_until ?? null,
          api_provider_name: a.api_provider_name ?? null,
          api_base_url: a.api_base_url ?? null,
          requires_reauth: a.reauth ?? false,
          tokens: a.login_provider ? { id_token: fakeIdToken(a.login_provider) } : null,
          quota: {
            hourly_percentage: hourly,
            hourly_reset_time: hourly >= 100 ? null : now / 1000 + 3600,
            weekly_percentage: weekly,
            weekly_reset_time: weekly >= 100 ? null : now / 1000 + 7 * 86400,
            reset_credits_available: hourly <= 20 ? 1 : 0,
          },
          usage_updated_at: now / 1000,
          created_at: ts,
          last_used: a.current ? now : ts,
        }
      })
      state.codex.currentId = state.codex.accounts.find((x) => x.last_used === now)?.id ?? ''
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
      const rec: NoteRecord = {
        id: nextId(),
        // seed 的加密行按"露标题上线前锁的"建模：标题要等本会话第一次解锁才回填
        title: enc ? '' : n.title,
        content_html: enc ? '' : n.content_html,
        category: enc ? null : (n.category ?? null),
        pinned: n.pinned ?? false,
        starred: n.starred ?? false,
        created_at: ts,
        updated_at: ts,
        encrypted: enc,
        cipher: enc ? n.content_html : '',
      }
      state.notes.push(rec)
      if (enc && this.noteOpen) this.noteUnlocked.add(rec.id)
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
      setBackupBusy: (busy: boolean) => { this.state.backup.busy = busy },
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

  /** 与 commands/tunnel.rs 的 provision_inner 同构：进度只由本机特征推导，最早的空缺说了算 */
  private tunnelProvisionDto(nameTaken = false) {
    const t = this.state.tunnel
    let step = 'ready'
    let message = '已就绪：指向哪台本地服务在下一步里配。'
    if (!t.installed) {
      step = 'no-binary'
      message = '还没有取到穿透程序：先点「获取程序」。'
    } else if (!t.authorized) {
      step = 'not-authorized'
      message = '还没授权：授权会在浏览器里完成 Cloudflare 登录，选好要用的域名即算通过。'
    } else if (!t.tunnelId) {
      step = 'no-tunnel'
      message = '已授权，还没有本机自己的隧道：建一条，不复用任何现存隧道。'
    } else if (!t.creds) {
      step = 'missing-credentials'
      message = '隧道在，本机凭据却不在：找回凭据即可，不要重建隧道。'
    } else if (!t.services.length) {
      step = 'no-services'
      message = '凭据已就位，还没有登记要挂出去的本地服务。'
    } else if (t.services.some((s) => !s.routed)) {
      step = 'not-routed'
      message = '服务已登记，但有的子域本机记录显示没指过来：再点一次「应用」。'
    } else {
      message = '已就绪：启动后每一条登记过的服务都会从公网可达。'
    }
    if (nameTaken) {
      message = `账号里已有一条同名隧道（e2e-stranger-9f2c），本机没有它的记录。不复用别处建的隧道：换个名字新建；确认那条就是本机时，选接管。`
    }
    return {
      step,
      message,
      tunnelName: t.tunnelName,
      tunnelId: t.tunnelId,
      serviceCount: t.services.length,
      unroutedCount: t.services.filter((s) => !s.routed).length,
      authorized: t.authorized,
      nameTaken,
    }
  }

  /** 与 commands/tunnel.rs 的 ServiceDto 同构：列表回读时现算在不在听 */
  private tunnelServiceDto(s: { id: string; hostname: string; port: number; label: string; preset: string; routed: boolean; listening: boolean; hasPassword: boolean; readOnly: boolean }) {
    return {
      id: s.id,
      hostname: s.hostname,
      port: s.port,
      label: s.label,
      preset: s.preset,
      routed: s.routed,
      listening: s.listening,
      hasPublicPassword: s.hasPassword,
      publicReadOnly: s.readOnly,
    }
  }

  private tunnelLoginDto() {
    const t = this.state.tunnel
    return { state: t.loginState, url: t.loginUrl, secondsLeft: t.loginSecondsLeft }
  }

  /** 与 services::split_report 同式：本机注册了才把自己那一条扣掉 */
  private tunnelSplitDto() {
    const t = this.state.tunnel
    const expected = t.registered ? 1 : 0
    const live = t.external + expected
    const external = Math.max(0, live - expected)
    const message = external > 0
      ? `另有 ${external} 处也在跑这条隧道，同一个公网地址会被分到不同出口；这条隧道要只用这一台。`
      : t.registered
        ? '只有本机这一条链路在服役。'
        : '当前没有链路在服役：本机启动后即成为唯一的出口。'
    return { liveCount: live, externalCount: external, conflict: external > 0, message }
  }

  private codexFind(id: string): CodexAccountRecord {
    const a = this.state.codex.accounts.find((x) => x.id === id)
    if (!a) throw `账号不存在: ${id}`
    return a
  }

  /** 官方 config.toml 里生效的 model_provider：OAuth 走 openai，API Key 走托管供应商 id。
   *  切号改的是凭据形态，这个值跟着变，官方侧栏就会把旧会话过滤掉。 */
  private codexProviderFor(accountId: string): string {
    const a = this.state.codex.accounts.find((x) => x.id === accountId)
    return a?.auth_mode === 'apikey' ? 'cockpit_api' : 'openai'
  }

  /** 与 Rust ProfileDto 同形（camelCase + 派生 cloudBase/isActive） */
  private profileDto(p: ProfileRecord) {
    return {
      id: p.id,
      name: p.name,
      cloudNs: p.cloudNs,
      cloudBase: baseFor(p.cloudNs),
      isActive: p.id === this.state.profiles.activeId,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    }
  }

  /** 新导入/新登录的账号：配额满格，与后端刚落库时的空配额同形 */
  private codexPush(email: string, opts: { plan_type?: string; auth_mode?: 'oauth' | 'apikey'; activate?: boolean } = {}): CodexAccountRecord {
    const now = Date.now()
    const rec: CodexAccountRecord = {
      id: nextId(),
      email,
      auth_mode: opts.auth_mode ?? 'oauth',
      account_name: null,
      account_note: null,
      tags: [],
      plan_type: opts.plan_type ?? null,
      auth_file_plan_type: opts.plan_type ?? null,
      account_id: null,
      user_id: null,
      organization_id: null,
      account_structure: null,
      subscription_active_until: null,
      api_provider_name: null,
      api_base_url: null,
      requires_reauth: false,
      tokens: null,
      quota: {
        hourly_percentage: 100,
        hourly_reset_time: null,
        weekly_percentage: 100,
        weekly_reset_time: null,
        reset_credits_available: 0,
      },
      usage_updated_at: Math.floor(now / 1000),
      created_at: now,
      last_used: now,
    }
    this.state.codex.accounts.unshift(rec)
    if (opts.activate) this.state.codex.currentId = rec.id
    return rec
  }

  /** 与 Rust target_from 同形：note 存的就是那句 headline，行卡展开不再跑网络 */
  private bypassRowFromSeed(seed: E2EBypassTargetSeed, ts: number): BypassTargetRecord {
    const kind = seed.kind ?? (seed.host.includes('/') ? 'cidr' : /^\d+\.\d+\.\d+\.\d+$/.test(seed.host) ? 'ip' : 'domain')
    const verdict = seed.verdict ?? 'needRoute'
    return {
      id: nextId(),
      host: seed.host,
      input: seed.input ?? seed.host,
      kind,
      port: seed.port ?? (seed.scheme === 'http' ? 80 : 443),
      path: seed.path ?? '',
      scheme: seed.scheme ?? 'https',
      address: seed.address ?? '',
      interfaceName: seed.interfaceName ?? '',
      nextHop: seed.nextHop ?? '',
      verdict,
      stale: seed.stale ?? false,
      note: seed.note ?? this.bypassCopy(verdict, kind, {
        host: seed.host,
        address: seed.address ?? '',
        iface: seed.interfaceName ?? '',
        source: '',
        pinned: seed.address || null,
        ips: seed.address ? [seed.address] : [],
        err: '',
      })[0],
      createdAt: ts,
      updatedAt: ts,
      checkedAt: ts,
    }
  }

  /** 判定文案与 bypass_service.rs 的 match 分支逐字同形 */
  private bypassCopy(
    verdict: string,
    kind: string,
    o: { host: string; address: string; iface: string; source: string; pinned: string | null; ips: string[]; err: string },
  ): [string, string] {
    if (verdict === 'directOk') {
      return kind === 'domain'
        ? ['直连已可用', `${o.host} 已固定到 ${o.pinned ?? '本机 DNS 解析结果'}，出口为 ${o.iface}，本模块无需处理。`]
        : ['路由已通，无需处理', `${o.host} 的出口为 ${o.iface}，无需处理。`]
    }
    if (verdict === 'hostsOnly') {
      return ['仅缺 DNS 固定', `实际地址 ${o.address} 可由 ${o.iface} 直达，路由不缺，只需将域名固定到 hosts。`]
    }
    if (verdict === 'needRoute') {
      return ['缺少绑定的路由', `实际地址 ${o.address} 仍从接管方网卡 ${o.iface} 发出（源地址 ${o.source}）。仅固定 hosts 不足，需添加绑定该接口的持久路由。`]
    }
    if (verdict === 'egressUnknown') {
      return ['出口路由无法判定', `${o.host} 连通性正常，但出口路由查询无结果（系统瞬时故障或探测接口不可用）。本轮不给出写入建议，请稍后重新探测。`]
    }
    return o.ips.length
      ? ['目标不可达，暂不添加', `候选地址 ${o.ips.join(' / ')} 均连接失败：${o.err}。若服务不在默认端口，请以 URL 形式写明端口，例如 http://${o.host}:8080/`]
      : ['目标不可达，暂不添加', '没有可用的候选地址']
  }

  /** DoH 全挂时三个入口（探测、加入、重探）都该抛，与 Rust 一样没有结论可落 */
  private bypassProbeOrThrow(raw: string): BypassReport {
    if (this.state.bypass.probeFail) throw '无法获取实际地址：DoH 解析全部失败'
    return this.bypassReport(raw)
  }

  /** 复刻一次探测的结论形状：判定规则照 Rust，网络部分由场景给定 */
  private bypassReport(rawInput: string): BypassReport {
    const raw = rawInput.trim()
    const seed = this.state.bypass.probe ?? {}
    // 网段写法（10.0.0.0/8）不带 scheme，掩码得留在 host 里，否则重探按原文探不回同一段
    const cidr = !raw.includes('://') && raw.includes('/')
    const host = seed.host ?? (cidr ? raw : bypassAuthority(raw).split(':')[0])
    const kind = seed.kind ?? (cidr ? 'cidr' : /^\d+\.\d+\.\d+\.\d+$/.test(host) ? 'ip' : 'domain')
    const port = seed.port ?? bypassPort(raw, bypassAuthority(raw))
    const scheme = seed.scheme ?? (raw.toLowerCase().startsWith('http://') ? 'http' : 'https')
    // 路由型条目（裸 IP / 网段）与 Rust decide() 同规则：内网机器多半不在 443 上监听，
    // 探活失败不等于不可达，判据只看这段流量从哪块卡出
    const routeKind = kind === 'ip' || kind === 'cidr'
    const verdict = routeKind
      ? this.state.bypass.verdict === 'egressUnknown'
        ? 'egressUnknown'
        : this.state.bypass.verdict === 'needRoute'
          ? 'needRoute'
          : 'directOk'
      : this.state.bypass.verdict
    const taker = verdict === 'needRoute'
    const address = seed.address ?? '172.30.2.109'
    const iface = seed.interfaceName ?? (taker ? 'vEthernet (TUN)' : '以太网')
    const source = seed.source ?? (taker ? '198.18.0.55' : '192.168.1.23')
    const nextHop = seed.nextHop ?? (taker ? '169.254.99.99' : '192.168.1.1')
    const unreachable = verdict === 'unreachable'
    const realIps = seed.realIps ?? (unreachable ? ['172.30.2.109', '172.30.2.110'] : [address])
    const cdnLike = seed.cdn ?? false
    const pinned = seed.pinned ?? (verdict === 'directOk' ? address : null)
    const chosen = unreachable ? null : address
    const localAnswers = seed.localAnswers ?? (taker || unreachable ? ['198.18.0.136'] : realIps)
    const [headline, detail] = this.bypassCopy(verdict, kind, {
      host,
      address,
      iface,
      source,
      pinned,
      ips: realIps,
      err: '连接被重置（os error 10054）',
    })
    const recommend =
      !cdnLike && (verdict === 'hostsOnly' || verdict === 'needRoute')
    const pending: string[] = []
    if (recommend) {
      pending.push('写入后仍需将该域名加入代理客户端的直连名单，本模块不修改代理配置。')
    }
    if (cdnLike) {
      pending.push('该域名带 CDN 轮换特征，固定后会锁定在会失效的节点上，不建议写入。')
    }
    return {
      input: raw,
      target: { kind, host, port, path: seed.path ?? bypassPath(raw), scheme },
      pinned,
      localAnswers,
      hijacked: localAnswers.some((a) => a.startsWith('198.18.')),
      realIps,
      cdnLike,
      chosen,
      httpStatus: unreachable ? null : seed.httpStatus ?? 200,
      probeMs: unreachable ? null : seed.probeMs ?? 230,
      egress: unreachable || verdict === 'egressUnknown'
        ? null
        : { ifIndex: seed.ifIndex ?? 27, interface: iface, source, nextHop, isTaker: taker },
      verdict,
      recommend,
      // Rust 的失效判定还要再探一次钉住地址；E2E 不联网，认定这一条腿必然失败
      stale: !!pinned && !realIps.includes(pinned),
      pending,
      headline,
      detail,
    }
  }

  /** 与 Rust upsert_bypass_target 同形：同 host 覆盖回原行，建档时间不动 */
  private bypassPush(report: BypassReport, existing?: BypassTargetRecord) {
    const cur = existing ?? this.state.bypass.targets.find((t) => t.host === report.target.host)
    const now = Date.now()
    const row: BypassTargetRecord = {
      id: cur?.id ?? nextId(),
      host: report.target.host,
      input: report.input,
      kind: report.target.kind,
      port: report.target.port,
      path: report.target.path,
      scheme: report.target.scheme,
      address: report.chosen ?? '',
      interfaceName: report.egress?.interface ?? '',
      nextHop: report.egress?.nextHop ?? '',
      verdict: report.verdict,
      stale: report.stale,
      note: report.headline,
      createdAt: cur?.createdAt ?? now,
      updatedAt: now,
      checkedAt: now,
    }
    // 同 id 覆盖回原行（重探、改原文），同 host 的其它行让位——Rust 那边 host 是唯一键
    this.state.bypass.targets = [
      row,
      ...this.state.bypass.targets.filter((t) => t.id !== row.id && t.host !== row.host),
    ]
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

  /** 口令到手：整库解开，一次带回全部明文（对齐 note_key_unlock 的返回） */
  private openNoteDomain() {
    this.noteOpen = true
    const plains: { id: string; html: string }[] = []
    this.state.notes.forEach((n) => {
      if (!n.encrypted) return
      this.noteUnlocked.add(n.id)
      // 明文在手，给升级前锁的小记补上露出标题（对齐 Rust 的 backfill_note_titles）
      if (!n.title) n.title = headingTitle(n.cipher)
      plains.push({ id: n.id, html: n.cipher })
    })
    return plains
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
      this.noteOpen = false
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

    // ===== favicons.rs =====
    // e2e 不碰网络：恒返回「没抓到」，行首落字母块
    favicon_get: () => null,

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
      // 加密行只出密文：正文与分类不外泄，标题按 Rust 的规则单独留明文（无真标题则为空）
      return this.state.notes
        .slice()
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at - a.created_at)
        .map((n) => (n.encrypted ? { ...n, content_html: '', category: null } : { ...n }))
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
      }
      this.state.notes.push(note)
      return { ...note }
    },

    update_note: ({ id, input }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (note.encrypted) {
        // 加密行：没有会话解锁就不许改；改的只进密文，正文列保持空，标题按新正文重算
        if (!this.noteUnlocked.has(id)) throw '小记未解锁'
        note.cipher = input.content_html
        note.title = headingTitle(input.content_html)
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

    // ===== note_lock.rs 全库口令（假加密：只复刻命令面行为） =====
    note_key_status: () => {
      this.requireUnlocked()
      return { is_set: !!this.notePass, is_open: this.noteOpen }
    },

    note_key_setup: ({ passphrase }: { passphrase: string }) => {
      this.requireUnlocked()
      if (!passphrase) throw '小记口令不能为空'
      if (this.notePass) throw '小记口令已经设过'
      this.notePass = passphrase
      return this.openNoteDomain()
    },

    note_key_unlock: ({ passphrase }: { passphrase: string }) => {
      this.requireUnlocked()
      if (!this.notePass) throw '还没设过小记口令'
      if (passphrase !== this.notePass) throw ERR_WRONG_PASSWORD
      return this.openNoteDomain()
    },

    note_key_recover: () => {
      this.requireUnlocked()
      if (!this.notePass) throw '还没设过小记口令'
      return this.openNoteDomain()
    },

    note_key_relock: () => {
      this.requireUnlocked()
      this.noteOpen = false
      this.noteUnlocked.clear()
    },

    note_key_change: ({ passphrase }: { passphrase: string }) => {
      this.requireUnlocked()
      if (!passphrase) throw '小记口令不能为空'
      if (!this.noteOpen) throw '请先输入小记口令'
      this.notePass = passphrase
    },

    lock_note: ({ id }: { id: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!this.noteOpen) throw '请先输入小记口令'
      if (note.encrypted) throw '这条小记已加密'
      if (!note.content_html) throw '空内容不用加密'
      note.encrypted = true
      note.cipher = note.content_html
      note.title = headingTitle(note.content_html)
      note.content_html = ''
      note.category = null
      note.updated_at = Date.now()
      this.noteUnlocked.add(id)
    },

    unlock_note: ({ id }: { id: string }) => {
      this.requireUnlocked()
      const note = this.findNote(id)
      if (!note.encrypted) throw '这条小记没有加密'
      if (!this.noteOpen) throw '请先输入小记口令'
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
        // 闸门：真实后端是 AtomicBool，这里跟着 backup_run 的在跑与否走，测试也能用 setBackupBusy 拨
        busy: this.state.backup.busy,
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
      // 与 Rust 的 BusyGuard 同形：闸门只掐这一轮，跑完必还
      if (this.state.backup.busy) throw '已有备份任务在进行中'
      this.state.backup.busy = true
      try {
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
      } finally {
        this.state.backup.busy = false
      }
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

    // 桌面拖入落盘：与 Rust 侧同一套语义（清洗、同名加 (n)、文件夹与超限逐条拒绝）
    fileshare_import_files: ({ shareIndex, paths }) => {
      const f = this.state.fileshare
      if (!f.shareDirs[Number(shareIndex)]) throw '共享目录已不在列表里，请重新选择'
      const stored: { name: string }[] = []
      const failed: string[] = []
      for (const raw of (paths as string[]) ?? []) {
        const s = String(raw)
        const base = s.split(/[\\/]/).filter(Boolean).pop() ?? s
        if (/[/\\]$/.test(s)) {
          failed.push(`${base}：只收文件，文件夹请先压缩`)
          continue
        }
        if (base.startsWith('big')) {
          failed.push(`${base}：超过单文件 4 GiB 上限`)
          continue
        }
        const name = base.replace(/[<>:"/\\|?*]/g, '').trim()
        if (!name) {
          failed.push(`${base}：文件名不合法`)
          continue
        }
        const stem = name.replace(/\.[^.]+$/, '')
        const ext = name.slice(stem.length)
        let final = name
        for (let i = 1; f.imported.includes(final); i += 1) final = `${stem} (${i})${ext}`
        f.imported.push(final)
        stored.push({ name: final })
      }
      return { stored, failed }
    },

    // ===== tunnel.rs：三格各自独立（绑定 / 进程 / 注册），页面的状态机全靠它们组合 =====
    tunnel_binary_status: () => {
      const t = this.state.tunnel
      const expected = '86aee4017b26'
      const verified = t.installed && (t.sha === null || t.sha === expected)
      return {
        expectedVersion: '2026.10.0',
        installed: t.installed,
        path: t.installed ? 'C:\\desko-e2e\\tunnel\\bin\\2026.10.0\\cloudflared.exe' : null,
        verified,
        actualSha256: verified ? expected : null,
      }
    },

    tunnel_fetch_binary: () => {
      const t = this.state.tunnel
      // 网络失败与内容不符是两句话：后者要显式报可疑，不能被洗成一次普通重试
      if (t.fetchFail === 'network') throw '下载失败（网络）：连接被重置（os error 10054）'
      if (t.fetchFail === 'content') throw '产物校验不符（可疑，已丢弃）：期望 86aee4017b26，实际 deadbeef0000'
      t.installed = true
      t.sha = t.sha ?? '86aee4017b26'
      return this.commands!.tunnel_binary_status()
    },

    tunnel_provision_status: () => this.tunnelProvisionDto(),

    tunnel_login_start: () => {
      const t = this.state.tunnel
      if (t.loginState !== 'waiting') {
        t.loginState = 'waiting'
        t.loginUrl = 'https://dash.cloudflare.com/argotunnel?e2e=authorize'
        t.loginSecondsLeft = 300
      }
      return this.tunnelLoginDto()
    },

    tunnel_login_status: () => this.tunnelLoginDto(),

    tunnel_login_cancel: () => {
      const t = this.state.tunnel
      if (t.loginState === 'waiting') {
        t.loginState = 'idle'
        t.loginUrl = null
        t.loginSecondsLeft = 0
      }
    },

    /** 建隧道：本机已有 ID 时只补本机那一格，同名而无记录时默认不认 */
    tunnel_ensure_tunnel: ({ name, adopt }: { name: string; adopt?: boolean }) => {
      const t = this.state.tunnel
      if (!t.authorized) throw '还没有完成 Cloudflare 授权：本机没有可用的账号凭据'
      if (t.tunnelId) {
        t.creds = true
        return this.tunnelProvisionDto()
      }
      const trimmed = String(name ?? '').trim()
      if (!trimmed || trimmed.length > 64) throw '隧道名不能为空，且不超过 64 个字符'
      if (t.nameTaken && !adopt) return this.tunnelProvisionDto(true)
      t.tunnelId = adopt ? 'e2e-adopted-9f2c' : 'e2e-tunnel-0001'
      t.tunnelName = trimmed
      t.creds = true
      t.bound = true
      t.nameTaken = false
      return this.tunnelProvisionDto()
    },

    tunnel_list_services: () => this.state.tunnel.services.map((s) => this.tunnelServiceDto(s)),

    /** 登记一条服务：与命令层同一套拒法（子域形态、端口范围、同名子域） */
    tunnel_add_service: ({ hostname, port, label, preset }: { hostname: string; port: number; label?: string; preset?: string }) => {
      const t = this.state.tunnel
      const host = String(hostname ?? '').trim().toLowerCase()
      if (!host.includes('.') || host.startsWith('.') || host.endsWith('.')) {
        throw '公网子域要写成完整主机名（例如 tunnel.example.com），不要带协议和路径'
      }
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw '本机端口要写 1 到 65535 之间的数字'
      if (t.services.some((s) => s.hostname === host)) {
        throw `${host} 已经挂在别的服务上了，一个子域只能指一个端口`
      }
      t.services.push({
        id: `e2e-svc-${t.services.length + 1}`,
        hostname: host,
        port,
        label: String(label ?? '').trim() || host,
        preset: preset ?? '',
        routed: false,
        listening: true,
        // 与后端同：新建即「无口令 + 只读」，口令得显式设
        hasPassword: false,
        readOnly: true,
      })
      return this.commands!.tunnel_list_services()
    },

    tunnel_update_service: ({ id, hostname, port, label }: { id: string; hostname: string; port: number; label?: string }) => {
      const t = this.state.tunnel
      const row = t.services.find((s) => s.id === id)
      if (!row) throw '这条服务已经不在了'
      const host = String(hostname ?? '').trim().toLowerCase()
      if (!host.includes('.')) throw '公网子域要写成完整主机名（例如 tunnel.example.com），不要带协议和路径'
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw '本机端口要写 1 到 65535 之间的数字'
      if (t.services.some((s) => s.hostname === host && s.id !== id)) {
        throw `${host} 已经挂在别的服务上了，一个子域只能指一个端口`
      }
      // 换了子域或端口，旧的「已指过来」记录就不能再算
      if (row.hostname !== host || row.port !== port) row.routed = false
      row.hostname = host
      row.port = port
      const trimmed = String(label ?? '').trim()
      if (trimmed) row.label = trimmed
      return this.commands!.tunnel_list_services()
    },

    tunnel_remove_service: ({ id }: { id: string }) => {
      const t = this.state.tunnel
      t.services = t.services.filter((s) => s.id !== id)
      return this.commands!.tunnel_list_services()
    },

    /** 与 set_service_policy_inner 同一套拒法：只有 desko 的服务能设；口令留空 = 只动只读位，从没设过则拒绝 */
    tunnel_set_service_policy: ({ id, password, readOnly }: { id: string; password: string; readOnly: boolean }) => {
      const row = this.state.tunnel.services.find((s) => s.id === id)
      if (!row) throw '这条服务已经不在了'
      if (row.preset !== 'fileshare') {
        throw `「${row.label}」是本机别的服务，desko 不在它的请求链路上，设不了公网策略`
      }
      const pw = String(password ?? '').trim()
      if (pw) {
        if (pw.length < 8 || pw.length > 64) throw `公网口令要 8 到 64 个字符，当前 ${pw.length} 个`
        row.hasPassword = true
      } else if (!row.hasPassword) {
        throw '公网侧必须有口令：这条门直接对着外面'
      }
      row.readOnly = Boolean(readOnly)
      return this.commands!.tunnel_list_services()
    },

    /** 应用：逐条指过来，撞到失败就停在那条上，已成的保留 */
    tunnel_apply: () => {
      const t = this.state.tunnel
      if (!t.authorized) throw '还没有完成 Cloudflare 授权：本机没有可用的账号凭据'
      if (!t.tunnelId) throw '还没有隧道：先建一条，再挂服务'
      if (!t.services.length) throw '还没有登记要挂出去的本地服务：先添加一项'
      for (const s of t.services) {
        if (s.routed) continue
        if (t.applyFail) throw `${s.hostname} 没能指到这条隧道：error validating remote DNS: ${s.hostname} ${t.applyFail}`
        s.routed = true
      }
      return this.tunnelProvisionDto()
    },

    tunnel_probe_connectors: () => {
      const t = this.state.tunnel
      if (!t.authorized) throw '还没有完成 Cloudflare 授权：本机没有可用的账号凭据'
      if (!t.tunnelId) throw '还没有隧道可查'
      return this.tunnelSplitDto()
    },

    tunnel_status: () => {
      const t = this.state.tunnel
      return {
        bound: t.bound,
        alive: t.alive,
        registered: t.registered,
        running: t.alive && t.registered,
        pid: t.alive ? t.pid ?? 424242 : null,
        note: t.alive && !t.registered
          ? '进程在跑，尚未连上 Cloudflare 边缘'
          : !t.alive && t.registered
            ? '残留的运行痕迹来自已退出的进程'
            : null,
      }
    },

    tunnel_start: () => {
      const t = this.state.tunnel
      if (!t.bound) throw '还没有可启动的隧道：需要先完成授权与创建'
      if (!t.authorized) throw '本机还没有授权凭据，无法启动隧道'
      if (!t.installed) throw '穿透程序未获取：先点「获取程序」'
      if (!t.services.length) throw '这条隧道还没有挂任何本地服务：先登记一项，再启动'
      t.alive = true
      t.registered = true
      t.pid = 424242
      return this.commands!.tunnel_status()
    },

    tunnel_stop: () => {
      this.state.tunnel.alive = false
      this.state.tunnel.registered = false
      this.state.tunnel.pid = null
    },

    tunnel_revoke: () => {
      const t = this.state.tunnel
      t.authorized = false
      t.creds = false
      t.alive = false
      t.registered = false
      t.pid = null
      return this.tunnelProvisionDto()
    },

    // ===== bypass.rs：探测结论按场景给定，清单走 Rust 的 upsert-by-host =====
    bypass_probe: ({ input }) => this.bypassProbeOrThrow(String(input ?? '')),

    /** 探一次即判定又登记，回的是整份结论 —— 与 Rust bypass_save 同形 */
    bypass_save: ({ input }) => {
      const report = this.bypassProbeOrThrow(String(input ?? ''))
      this.bypassPush(report)
      return report
    },

    bypass_list: () =>
      this.state.bypass.targets
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((t) => ({ ...t })),

    bypass_recheck: ({ id }) => {
      const found = this.state.bypass.targets.find((t) => t.id === id)
      if (!found) throw '条目不存在，可能已被删除'
      // 按原文重探：只有 host 会把带端口/路径/掩码的目标探成默认 443
      const report = this.bypassProbeOrThrow(found.input || found.host)
      this.bypassPush(report, found)
      return report
    },

    /** 与 Rust bypass_status 同形：托管块读不出来时 managed 归 0、原因进 hostsError */
    bypass_status: () => ({
      managedHosts: this.state.bypass.hostsError ? 0 : this.state.bypass.hostsManaged,
      hostsError: this.state.bypass.hostsError,
      total: this.state.bypass.targets.length,
      pending: this.state.bypass.targets.filter(
        (t) => t.verdict === 'hostsOnly' || t.verdict === 'needRoute',
      ).length,
      stale: this.state.bypass.targets.filter((t) => t.stale).length,
    }),

    bypass_delete: ({ id }) => {
      this.state.bypass.targets = this.state.bypass.targets.filter((t) => t.id !== id)
    },

    /** 与 Rust bypass_edit 同形：按新原文重探、覆盖回原行；host 变了就删掉旧行 */
    bypass_edit: ({ id, input }) => {
      const found = this.state.bypass.targets.find((t) => t.id === String(id))
      if (!found) throw '条目不存在，可能已被删除'
      const report = this.bypassProbeOrThrow(String(input ?? ''))
      // 与 Rust 同序：先摘旧行再按新 host 归档，建档时间与 id 都跟着这条走
      if (found.host !== report.target.host) {
        this.state.bypass.targets = this.state.bypass.targets.filter((t) => t.id !== found.id)
      }
      this.bypassPush(report, found)
      return report
    },

    mfa_read_image: ({ path }) => {
      this.requireUnlocked()
      const p = String(path ?? '').toLowerCase()
      if (!/\.(png|jpe?g|webp|bmp)$/.test(p)) throw '不支持的图片格式，请选择 png / jpg / jpeg / webp / bmp'
      // 真实后端回文件字节 base64；mock 回 3 个零字节，前端解析必然失败（测试只断言调用）
      return 'AAAA'
    },

    // ===== codex-core::commands::codex（账号管理与切换）=====
    list_codex_accounts: () => this.state.codex.accounts.map((a) => ({ ...a })),

    get_current_codex_account: () => {
      const cur = this.state.codex.accounts.find((a) => a.id === this.state.codex.currentId)
      return cur ? { ...cur } : null
    },

    switch_codex_account: ({ accountId }) => {
      const a = this.codexFind(String(accountId))
      this.state.codex.currentId = a.id
      this.state.codex.accounts.forEach((x) => (x.last_used = x.id === a.id ? Date.now() : x.last_used - 1000))
      return { ...a }
    },

    codex_cancel_account_switch: () => undefined,

    refresh_codex_quota: ({ accountId }) => ({ ...(this.codexFind(String(accountId)).quota as CodexAccountRecord['quota']) }),

    refresh_codex_quotas_batch: ({ accountIds }) => {
      const ids = (accountIds as string[]) ?? []
      this.state.codex.accounts.forEach((a) => {
        if (ids.includes(a.id)) a.usage_updated_at = Math.floor(Date.now() / 1000)
      })
      return ids.length
    },

    refresh_codex_account_profile: ({ accountId }) => ({ ...this.codexFind(String(accountId)) }),
    force_refresh_codex_tokens: ({ accountId }) => ({ ...this.codexFind(String(accountId)) }),

    get_codex_history_visibility_provider: () => this.codexProviderFor(this.state.codex.currentId),

    codex_repair_session_visibility_for_launch_target: async () => {
      const { repairDelayMs, repairFail, repairRows } = this.state.codex
      if (repairDelayMs > 0) await new Promise((r) => setTimeout(r, repairDelayMs))
      if (repairFail) throw '会话可见性修复失败（e2e）'
      return {
        mutatedInstanceCount: repairRows > 0 ? 1 : 0,
        updatedSqliteRowCount: repairRows,
        changedRolloutFileCount: 0,
        skippedSqliteFileCount: 0,
        message: `已修复 ${repairRows} 行`,
      }
    },

    update_codex_account_name: ({ accountId, name }) => {
      const a = this.codexFind(String(accountId))
      a.account_name = String(name).trim() || null
      return { ...a }
    },

    update_codex_account_note: ({ accountId, note }) => {
      const a = this.codexFind(String(accountId))
      a.account_note = note === null || note === undefined ? a.account_note : String(note).trim() || null
      return { ...a }
    },

    update_codex_account_tags: ({ accountId, tags }) => {
      const a = this.codexFind(String(accountId))
      a.tags = ((tags as string[]) ?? []).slice()
      return { ...a }
    },

    delete_codex_account: ({ accountId }) => {
      this.state.codex.accounts = this.state.codex.accounts.filter((x) => x.id !== accountId)
      if (this.state.codex.currentId === accountId) this.state.codex.currentId = ''
    },

    delete_codex_accounts: ({ accountIds }) => {
      const ids = new Set((accountIds as string[]) ?? [])
      this.state.codex.accounts = this.state.codex.accounts.filter((x) => !ids.has(x.id))
      if (ids.has(this.state.codex.currentId)) this.state.codex.currentId = ''
    },

    export_codex_accounts: ({ accountIds }) =>
      JSON.stringify({
        accounts: this.state.codex.accounts.filter((a) => (accountIds as string[]).includes(a.id)).map((a) => ({ email: a.email, tokens: { access_token: 'at-e2e' } })),
      }),

    import_codex_from_local: () => {
      const rec = this.codexPush('local@e2e.dev', { plan_type: 'plus' })
      return { ...rec }
    },

    import_codex_from_files: ({ filePaths }) => {
      const paths = (filePaths as string[]) ?? []
      const imported = paths.map((p) => this.codexPush(`${p.split(/[\\/]/).pop()?.replace(/\.json$/, '') || 'file'}@e2e.dev`))
      return { imported, failed: [] }
    },

    is_codex_oauth_port_in_use: () => this.state.codex.portBusy,

    add_codex_account_with_api_key: ({ apiKey, apiBaseUrl }) => {
      if (!String(apiKey ?? '').trim()) throw 'API Key 不能为空'
      const label = apiBaseUrl ? `key@${String(apiBaseUrl).replace(/^https?:\/\//, '')}` : 'key@e2e.dev'
      const rec = this.codexPush(label, { auth_mode: 'apikey' })
      rec.api_provider_name = 'cockpit_api'
      rec.api_base_url = apiBaseUrl ? String(apiBaseUrl) : null
      return { ...rec }
    },

    get_codex_reset_credits: ({ accountId }) => {
      const a = this.codexFind(String(accountId))
      const left = a.quota?.reset_credits_available ?? 0
      const now = Math.floor(Date.now() / 1000)
      if (left <= 0) return { available_count: 0, credits: [], next_expires_at: null }
      // 三态各一条：可用 / 已使用（带 redeemed_at）/ 已过期
      return {
        available_count: left,
        credits: [
          { id: 'cr-avail', status: 'available', granted_at: now - 3 * 86400, expires_at: now + 4 * 86400 },
          {
            id: 'cr-used',
            status: 'redeemed',
            granted_at: now - 20 * 86400,
            expires_at: now - 10 * 86400,
            redeemed_at: now - 18 * 86400,
          },
          { id: 'cr-exp', status: 'expired', granted_at: now - 70 * 86400, expires_at: now - 60 * 86400 },
        ],
        next_expires_at: now + 4 * 86400,
      }
    },

    consume_codex_reset_credit: ({ accountId }) => {
      const a = this.codexFind(String(accountId))
      if (!a.quota || a.quota.reset_credits_available <= 0) throw '没有可用的额度重置次数'
      a.quota.reset_credits_available -= 1
      a.quota.hourly_percentage = 100
      a.quota.hourly_reset_time = Math.floor(Date.now() / 1000) + 5 * 3600
    },

    codex_oauth_login_start: () => {
      if (this.state.codex.portBusy) throw 'CODEX_OAUTH_PORT_IN_USE'
      const id = nextId()
      this.state.codex.loginId = id
      return { loginId: id, authUrl: 'https://auth.openai.com/oauth/authorize?e2e=1' }
    },

    codex_oauth_device_auth_start: () => {
      const id = nextId()
      this.state.codex.loginId = id
      return { loginId: id, userCode: 'WXYZ-ABCD', verificationUrl: 'https://auth.openai.com/activate', pollIntervalSeconds: 5 }
    },

    /** 回调地址必须带 code，后端收到才落账号，并推 completed 事件 */
    codex_oauth_submit_callback_url: ({ loginId, callbackUrl }) => {
      if (!String(callbackUrl).includes('code=')) throw '回调地址里没有授权码，请粘贴浏览器地址栏的完整链接'
      if (String(loginId) !== this.state.codex.loginId) throw '登录会话已结束'
      this.codexPush(`browser@e2e.dev`, { plan_type: 'pro', activate: true })
      this.emit('codex-oauth-login-completed', { loginId: String(loginId) })
    },

    codex_oauth_login_completed: ({ loginId }) => {
      if (String(loginId) !== this.state.codex.loginId) throw '登录会话已结束'
      const mine = this.state.codex.accounts.find((a) => a.email === 'browser@e2e.dev' || a.email === 'device@e2e.dev')
      if (!mine) throw '还没拿到授权，先在浏览器里完成登录'
      this.state.codex.loginId = ''
      return { ...mine }
    },

    codex_oauth_login_cancel: () => {
      this.state.codex.loginId = ''
    },

    get_codex_storage_paths: () => ({
      providerStorePath: 'C:\\e2e\\codex\\accounts',
      configPath: 'C:\\e2e\\.codex\\config.toml',
      authPath: 'C:\\e2e\\.codex\\auth.json',
    }),

    open_codex_config_toml: () => undefined,

    // ===== profiles.rs（F2 六命令，F3 UI 用）=====
    profiles_list: () => ({
      activeId: this.state.profiles.activeId,
      profiles: this.state.profiles.list.map((p) => this.profileDto(p)),
    }),

    profiles_active: () => {
      const p = this.state.profiles.list.find((x) => x.id === this.state.profiles.activeId)
      return p ? this.profileDto(p) : null
    },

    profiles_create: ({ name, cloudNs }) => {
      const t = String(name ?? '').trim()
      if (!t) throw '档案名不能为空'
      if ([...t].length > 32) throw '档案名最多 32 个字符'
      let id = genProfileId()
      while (this.state.profiles.list.some((p) => p.id === id)) id = genProfileId()
      const explicit = cloudNs == null ? '' : String(cloudNs).trim()
      let ns: string
      if (explicit) {
        if (explicit.length > 32) throw '云命名空间需为 1–32 个字符'
        if (!/^[a-z0-9-]+$/.test(explicit)) throw '云命名空间只能用小写字母、数字和连字符'
        if (this.state.profiles.list.some((p) => p.cloudNs === explicit))
          throw `云命名空间「${explicit}」已被其他档案占用`
        ns = explicit
      } else {
        ns = id
      }
      const ts = Date.now()
      const rec: ProfileRecord = { id, name: t, cloudNs: ns, createdAt: ts, lastUsedAt: ts }
      this.state.profiles.list.push(rec)
      return this.profileDto(rec)
    },

    profiles_rename: ({ id, name }) => {
      const t = String(name ?? '').trim()
      if (!t) throw '档案名不能为空'
      if ([...t].length > 32) throw '档案名最多 32 个字符'
      const p = this.state.profiles.list.find((x) => x.id === id)
      if (!p) throw '档案不存在'
      p.name = t
    },

    profiles_delete: ({ id }) => {
      if (this.state.profiles.list.length <= 1) throw '至少保留一个档案，无法删除最后一个'
      if (this.state.profiles.activeId === id) throw '不能删除当前使用的档案，请先切换到其他档案'
      const i = this.state.profiles.list.findIndex((x) => x.id === id)
      if (i < 0) throw '档案不存在'
      this.state.profiles.list.splice(i, 1)
    },

    profiles_switch: ({ id }) => {
      const p = this.state.profiles.list.find((x) => x.id === id)
      if (!p) throw '档案不存在'
      p.lastUsedAt = Date.now()
      this.state.profiles.activeId = id
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
