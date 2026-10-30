import { ref } from 'vue'
import { settingsApi } from '../../services/api/settings'
import { hasWorkspaceDirectory } from './workspaceLayout'

const SETTING_KEY = 'workspace_directory_open'
const PIN_SETTING_KEY = 'workspace_directory_pinned'

function readModules(raw: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([id, flag]) => hasWorkspaceDirectory(id) && typeof flag === 'boolean'))
  } catch { return {} }
}

export function useWorkspaceDirectoryPreferences() {
  const open = ref<Record<string, boolean>>({})
  const pinned = ref<Record<string, boolean>>({})
  let pendingSave: Promise<void> = Promise.resolve()

  async function restore() {
    const values = await Promise.all([SETTING_KEY, PIN_SETTING_KEY].map(async key => {
      try { return await settingsApi.getSetting(key) }
      catch { return '' }
    }))
    open.value = readModules(values[0])
    pinned.value = readModules(values[1])
  }

  function save(key: string, modules: Record<string, boolean>): Promise<void> {
    const value = JSON.stringify(modules)
    // 连续开关按操作顺序落盘，前一次失败不阻止后续保存。
    pendingSave = pendingSave.catch(() => {}).then(() => settingsApi.setSetting(key, value))
    return pendingSave
  }

  function setVisible(id: string, visible: boolean): Promise<void> {
    if (!hasWorkspaceDirectory(id)) return Promise.resolve()
    open.value = { ...open.value, [id]: visible }
    return save(SETTING_KEY, open.value)
  }

  function setPinned(id: string, value: boolean): Promise<void> {
    if (!hasWorkspaceDirectory(id)) return Promise.resolve()
    pinned.value = { ...pinned.value, [id]: value }
    return save(PIN_SETTING_KEY, pinned.value)
  }

  return { open, pinned, restore, setVisible, setPinned }
}
