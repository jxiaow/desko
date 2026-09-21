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
  /** 停笔即备：写入平息 8 秒后补一轮 */
  realtime: boolean
  /** 还没传上云的份数（包 + 附件密文） */
  pending: number
  /** 最近一轮打包的时刻，0 = 还没有 */
  lastRoundAt: number
}

/** 手动一轮的回报：包 + 有没有真的传上去 */
export interface BackupRunResult {
  package: BackupPackage
  uploaded: boolean
  error: string | null
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
  status: () => invoke<BackupStatus>('backup_status'),
  /** 返回换头失败（仍是旧密码）的文件名，正常为空 */
  setPassword: (password: string) => invoke<string[]>('backup_set_password', { password }),
  /** 一轮 = 打包 + 传云端 + 收拾本地中转副本。没连云端直接报错 */
  run: () => invoke<BackupRunResult>('backup_run'),
  /** 单文件迁移包：附件本体一起打包，拷这一个文件就能换机恢复 */
  exportPackage: (path: string) => invoke<BackupPackage>('backup_export', { path }),
  restoreFile: (path: string, password: string) => invoke<void>('backup_restore_file', { path, password }),
  onProgress: (cb: (p: BackupProgress) => void): Promise<UnlistenFn> =>
    listen<BackupProgress>('backup-progress', (e) => cb(e.payload)),
}
