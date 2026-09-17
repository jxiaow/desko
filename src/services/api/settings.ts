import { invoke } from '@tauri-apps/api/core'

export const settingsApi = {
  getSetting: (key: string): Promise<string> =>
    invoke('get_setting', { key }),
  setSetting: (key: string, value: string): Promise<void> =>
    invoke('set_setting', { key, value }),
}
