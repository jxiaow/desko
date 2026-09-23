import { invoke } from '@tauri-apps/api/core'

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
}
