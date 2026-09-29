import { invoke } from '@tauri-apps/api/core'

export const faviconsApi = {
  /** 给条目 URL，拿本机 favicon 缓存文件的绝对路径；抓不到返回 null，行首落字母块 */
  faviconGet: (url: string): Promise<string | null> =>
    invoke('favicon_get', { url }),
}
