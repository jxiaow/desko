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
}
