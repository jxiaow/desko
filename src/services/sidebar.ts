import { readonly, ref } from 'vue'
import { settingsApi } from './api/settings'
import { isWebRuntime } from './runtime'
import { useToastStore } from '../stores/toast'

const SETTING_KEY = 'sidebar_collapsed'
const collapsed = ref(false)
let pendingSave: Promise<void> = Promise.resolve()

/** 桌面导航缺省展开；Web 使用自己的响应式侧栏，不读写这个偏好。 */
export const sidebarCollapsed = readonly(collapsed)

export async function initializeSidebar(): Promise<void> {
  if (isWebRuntime()) return
  try {
    collapsed.value = await settingsApi.getSetting(SETTING_KEY) === 'true'
  } catch {
    collapsed.value = false
  }
}

export function setSidebarCollapsed(value: boolean): Promise<void> {
  collapsed.value = value
  if (isWebRuntime()) return Promise.resolve()
  // 连续切换按操作顺序保存；失败不回滚当前交互，下一次操作仍可继续。
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => settingsApi.setSetting(SETTING_KEY, String(value)))
    .catch(() => {
      useToastStore().showToast('侧栏状态保存失败，重启后可能恢复上次状态', 'error')
    })
  return pendingSave
}
