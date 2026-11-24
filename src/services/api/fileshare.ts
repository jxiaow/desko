import { invoke } from '../transport'

export interface FileShareStatus {
  running: boolean
  configuredPort: number
  boundPort: number | null
  localUrl: string
  lanUrl: string
  shareCount: number
  localOnly: boolean
}

export interface FileShareConfig {
  port: number
  shareDirs: string[]
  localOnly: boolean
  hasPassword: boolean
}

export interface StoredFile {
  name: string
}

export interface ImportOutcome {
  stored: StoredFile[]
  /** 每个未落盘的文件一条中文原因 */
  failed: string[]
}

/** 一条消息。文字和文件是同一层的东西：都带方向和时间，都排在一条时间线上 */
export interface MessageEntry {
  id: string
  /** `app` = 这台电脑发出；`web` = 网页（任意设备上的浏览器）发来 */
  dir: string
  /** `text` | `file` */
  kind: string
  /** kind=text 的正文 */
  text: string
  /** kind=file：落盘后的实际名字 */
  name: string
  /** kind=file：字节数 */
  size: number
  /** kind=file：所在共享目录的下标 */
  share: number
  dirHint?: string
  createdMs: number
  /** 今天只给时分的短串：两端不必各自再算一次时区 */
  time: string
  /** kind=file：展示用的大小（"2.4 MB"） */
  sizeText: string
}

export const fileshareApi = {
  status: (): Promise<FileShareStatus> =>
    invoke('fileshare_status'),
  start: (): Promise<FileShareStatus> =>
    invoke('fileshare_start'),
  stop: (): Promise<void> =>
    invoke('fileshare_stop'),
  getConfig: (): Promise<FileShareConfig> =>
    invoke('fileshare_get_config'),
  saveConfig: (port: number, shareDirs: string[], localOnly: boolean): Promise<FileShareStatus> =>
    invoke('fileshare_save_config', { port, shareDirs, localOnly }),
  /** 空串 = 清除口令 */
  setPassword: (password: string): Promise<void> =>
    invoke('fileshare_set_password', { password }),
  /** 主题戳：四值写进 fileshare.json，网页端下一次请求就换成这套外观。配置文件不在位时服务端直接跳过 */
  setTheme: (theme: string, base: string, accent: string, atmosphere: 'on' | 'off'): Promise<void> =>
    invoke('fileshare_set_theme', { theme, base, accent, atmosphere }),
  /** 桌面拖入落盘。网页端 /upload 有跨站门，WebView 到不了，本地投递走命令层 */
  importFiles: (shareIndex: number, paths: string[]): Promise<ImportOutcome> =>
    invoke('fileshare_import_files', { shareIndex, paths }),
  /** 最近 200 条消息，新的在前。文字与文件同一条流 */
  messages: (): Promise<MessageEntry[]> =>
    invoke('fileshare_messages'),
  /** 发一条文字到网页。服务没启动也能记，网页那一侧启动后可见 */
  pushText: (content: string): Promise<MessageEntry> =>
    invoke('fileshare_message_push', { content }),
  /** 删一条消息。只删记录，共享目录里的文件不动 */
  deleteMessage: (id: string): Promise<void> =>
    invoke('fileshare_message_delete', { id }),
  /** 在资源管理器里定位收到的文件：比"打开"稳妥，不会顺手执行未知内容 */
  revealFile: (shareIndex: number, name: string): Promise<void> =>
    invoke('fileshare_reveal_file', { shareIndex, name }),
}
