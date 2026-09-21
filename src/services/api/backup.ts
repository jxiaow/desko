import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface BackupPackage {
  name: string
  time: number
  size: number
  attachments: number | null
}

export interface BackupStatus {
  hasPassword: boolean
  /** 定时备份间隔（分钟），0 = 关 */
  intervalMin: number
  /** 实时备份：写入平息 8 秒后补一轮 */
  realtime: boolean
  keepLocal: number
  files: BackupPackage[]
}

export interface BackupProgress {
  op: string
  text: string
  pct: number
}

/** invoke 的失败值是字符串（AppError 序列化成 user_message），统一取成人话 */
export function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return '操作失败'
}

export const backupApi = {
  dir: () => invoke<string>('backup_dir'),
  status: () => invoke<BackupStatus>('backup_status'),
  /** 返回换头失败（仍是旧密码）的文件名，正常为空 */
  setPassword: (password: string) => invoke<string[]>('backup_set_password', { password }),
  run: () => invoke<BackupPackage>('backup_run'),
  remove: (name: string) => invoke<void>('backup_delete', { name }),
  restore: (name: string, password: string) => invoke<void>('backup_restore', { name, password }),
  /** 单文件迁移包：附件本体一起打包，拷这一个文件就能换机恢复 */
  exportPackage: (path: string) => invoke<BackupPackage>('backup_export', { path }),
  restoreFile: (path: string, password: string) => invoke<void>('backup_restore_file', { path, password }),
  openPath: (path: string) => invoke<void>('open_file', { path }),
  onProgress: (cb: (p: BackupProgress) => void): Promise<UnlistenFn> =>
    listen<BackupProgress>('backup-progress', (e) => cb(e.payload)),
}
