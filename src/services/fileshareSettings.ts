import { ref, computed } from 'vue'
import { fileshareApi, type FileShareConfig, type FileShareStatus } from './api/fileshare'
import { errText } from './api/backup'
import { useToastStore } from '../stores/toast'

/** 局域网传输状态单例：模块页与设置弹窗共用，一处改动另一处即时可见 */
export const fsStatus = ref<FileShareStatus | null>(null)
export const fsConfig = ref<FileShareConfig | null>(null)
export const fsLoaded = ref(false)
export const fsBusy = ref(false)

export const fsRunning = computed(() => fsStatus.value?.running ?? false)
export const fsPortDrifted = computed(
  () => fsRunning.value && !!fsStatus.value && fsStatus.value.boundPort !== fsStatus.value.configuredPort
)
export const fsHasPassword = computed(() => fsConfig.value?.hasPassword ?? false)
export const fsLocalOnly = computed(() => fsConfig.value?.localOnly ?? false)

export async function fsRefresh(): Promise<void> {
  const toastStore = useToastStore()
  try {
    const [st, cfg] = await Promise.all([fileshareApi.status(), fileshareApi.getConfig()])
    fsStatus.value = st
    fsConfig.value = cfg
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    fsLoaded.value = true
  }
}

/** 一次改动一次落盘；失败抛给调用方提示，成功后回读刷新显示 */
export async function fsSaveConfig(
  nextDirs: string[],
  nextPort: number,
  nextLocalOnly: boolean
): Promise<void> {
  fsBusy.value = true
  try {
    fsStatus.value = await fileshareApi.saveConfig(nextPort, nextDirs, nextLocalOnly)
  } finally {
    fsBusy.value = false
    await fsRefresh()
  }
}

/** 空串 = 清除口令 */
export async function fsSetPassword(password: string): Promise<void> {
  fsBusy.value = true
  try {
    await fileshareApi.setPassword(password)
  } finally {
    fsBusy.value = false
    await fsRefresh()
  }
}

/** 跨组件请求打开设置弹窗的指定页签（模块页摘要行 → 设置「局域网传输」） */
export function requestOpenSettingsTab(tab: string): void {
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: tab }))
}
