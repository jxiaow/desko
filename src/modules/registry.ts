import type { Component } from 'vue'
import type { IconName } from '../utils/icons'
import { useEntriesStore } from '../stores/entries'
import { useFileShortcutsStore } from '../stores/fileShortcuts'
import { useNotesStore } from '../stores/notes'
import { useToastStore } from '../stores/toast'
import { fileshareApi } from '../services/api/fileshare'
import { tunnelApi } from '../services/api/tunnel'
import { fsRefresh } from '../services/fileshareSettings'
import { loadStoragePaths, clearCodexSession } from '../services/codexState'

/** 页面模块的标识，与路由名、侧栏项一一对应 */
export type ModuleId =
  | 'notes'
  | 'entries'
  | 'files'
  | 'mfa'
  | 'fileshare'
  | 'tunnel'
  | 'bypass'
  | 'codex'

/** 设置弹窗左导航的页签 id：固定页签 + 带配置页签的模块 id */
export type SettingsTabId =
  | 'profiles'
  | 'modules'
  | 'appearance'
  | 'backup'
  | 'security'
  | 'about'
  | ModuleId

export interface ModuleDef {
  id: ModuleId
  /** SQLite meta 里的开关键，必须同时存在于 Rust 与 e2e mock 的 ALLOWED_KEYS */
  settingKey: string
  /** 侧栏文字、标题栏面包屑与设置页行名 */
  title: string
  /** 设置「模块」页签里那句功能差异说明 */
  desc: string
  icon: IconName
  /** 读不到键时的缺省值。true 走 `!== 'false'`，false 走 `=== 'true'` */
  defaultEnabled: boolean
  /** 默认就开着的三块主页面；只影响文案，不影响能不能关 */
  core: boolean
  view: () => Promise<Component>
  /** 侧栏计数位；不声明就没有计数 */
  count?: () => number
  /** 解锁后要让计数和页面就位所需的那一次取数 */
  boot?: () => Promise<void>
  /** 收回密钥前必须完成的写入 */
  beforeLock?: () => Promise<void>
  /** 锁定时必须跟着收口的会话态 */
  onLock?: () => void
  /** 关闭时要收口的常驻副作用：入口消失而进程还活着，是最难查的一种残留 */
  onDisable?: () => Promise<void>
  /** 模块自带配置页签；有 settings 才会在设置左导航出现 */
  settings?: {
    /** 页签名 */
    label: string
    /** 页签图标 */
    icon: IconName
    /** 懒加载配置面板 */
    pane: () => Promise<Component>
    /** 打开弹窗时预热数据 */
    load?: () => Promise<void> | void
  }
}

/** 数组顺序即侧栏顺序 */
export const MODULES: ModuleDef[] = [
  {
    id: 'notes',
    settingKey: 'notes_enabled',
    title: '小记',
    desc: '随手记文本与图片，可给单条上口令',
    icon: 'navNotes',
    defaultEnabled: true,
    core: true,
    count: () => useNotesStore().notes.length,
    boot: () => useNotesStore().fetchNotes(),
    beforeLock: () => useNotesStore().flushNoteSave(),
    onLock: () => useNotesStore().clearUnlockedNotes(),
    view: async () => (await import('../views/NotesView.vue')).default,
    settings: {
      label: '小记',
      icon: 'navNotes',
      pane: async () => (await import('./settings/NotesSettings.vue')).default,
      load: () => useNotesStore().refreshNoteKey(),
    },
  },
  {
    id: 'entries',
    settingKey: 'entries_enabled',
    title: '网址收藏',
    desc: '网址与随行的账号口令，按标签分组',
    icon: 'navEntries',
    defaultEnabled: true,
    core: true,
    count: () => useEntriesStore().entries.length,
    boot: () =>
      useEntriesStore().fetchEntries((msg) => useToastStore().showToast(msg, 'error')),
    onLock: () => {
      const store = useEntriesStore()
      store.searchKeyword = ''
      store.activeTab = 'all'
    },
    view: async () => (await import('../views/EntriesView.vue')).default,
  },
  {
    id: 'files',
    settingKey: 'files_enabled',
    title: '文件快捷',
    desc: '本机文件与目录的快捷入口，一键打开或进终端',
    icon: 'navFiles',
    defaultEnabled: true,
    core: true,
    count: () => useFileShortcutsStore().shortcuts.length,
    boot: () => useFileShortcutsStore().fetchShortcuts(),
    view: async () => (await import('../views/FilesView.vue')).default,
    settings: {
      label: '文件快捷',
      icon: 'navFiles',
      pane: async () => (await import('./settings/FilesSettings.vue')).default,
    },
  },
  {
    id: 'mfa',
    settingKey: 'mfa_enabled',
    title: '验证码',
    desc: '管理 TOTP 动态码',
    icon: 'navMfa',
    defaultEnabled: false,
    core: false,
    view: async () => (await import('../views/MfaView.vue')).default,
  },
  {
    id: 'fileshare',
    settingKey: 'fileshare_enabled',
    title: '局域网传输',
    desc: '同网段设备用浏览器互传文件',
    icon: 'navLan',
    defaultEnabled: false,
    core: false,
    onDisable: () => fileshareApi.stop(),
    view: async () => (await import('../views/FileshareView.vue')).default,
    settings: {
      label: '局域网传输',
      icon: 'navLan',
      pane: async () => (await import('./settings/FileshareSettings.vue')).default,
      load: () => fsRefresh(),
    },
  },
  {
    id: 'tunnel',
    settingKey: 'tunnel_enabled',
    title: '内网穿透',
    desc: '把本机服务经 Cloudflare 隧道暴露到公网',
    icon: 'navTunnel',
    defaultEnabled: false,
    core: false,
    onDisable: () => tunnelApi.stop(),
    view: async () => (await import('../views/TunnelView.vue')).default,
  },
  {
    id: 'bypass',
    settingKey: 'bypass_enabled',
    title: '直连清单',
    desc: '探测指定域名应固定 hosts 记录还是添加系统路由',
    icon: 'navBypass',
    defaultEnabled: false,
    core: false,
    view: async () => (await import('../views/BypassView.vue')).default,
  },
  {
    id: 'codex',
    onLock: clearCodexSession,
    settingKey: 'codex_enabled',
    title: 'Codex',
    desc: '管理多个 Codex 账号并切换官方凭据',
    icon: 'navCodex',
    defaultEnabled: false,
    core: false,
    view: async () => (await import('../views/CodexView.vue')).default,
    settings: {
      label: 'Codex',
      icon: 'navCodex',
      pane: async () => (await import('./settings/CodexSettings.vue')).default,
      load: loadStoragePaths,
    },
  },
]

const BY_ID = new Map(MODULES.map((m) => [m.id, m]))

export function moduleById(id: ModuleId): ModuleDef {
  const m = BY_ID.get(id)
  if (!m) throw new Error(`unknown module: ${id}`)
  return m
}

/** 模块页的路径就是它的 id，注册表和路由不必各存一份 */
export const modulePath = (id: ModuleId): string => '/' + id
