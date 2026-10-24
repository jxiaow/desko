import { ref, computed } from 'vue'
import { fileshareApi, type FileShareConfig, type FileShareStatus } from './api/fileshare'
import { errText } from './api/backup'
import { syncThemeStamp } from './theme'
import { useToastStore } from '../stores/toast'

/** 局域网传输状态单例：模块页与设置弹窗共用，一处改动另一处即时可见 */
export const fsStatus = ref<FileShareStatus | null>(null)
export const fsConfig = ref<FileShareConfig | null>(null)
export const fsLoaded = ref(false)
export const fsBusy = ref(false)
let generation = 0
export function clearFileshareSession(): void {
  generation++
  fsStatus.value = null
  fsConfig.value = null
  fsLoaded.value = false
  fsBusy.value = false
}

export const fsRunning = computed(() => fsStatus.value?.running ?? false)
export const fsPortDrifted = computed(
  () => fsRunning.value && !!fsStatus.value && fsStatus.value.boundPort !== fsStatus.value.configuredPort
)
export const fsHasPassword = computed(() => fsConfig.value?.hasPassword ?? false)
export const fsLocalOnly = computed(() => fsConfig.value?.localOnly ?? false)

/** quiet：解锁预热那一类后台取数，读不到不该在页面上喊一声 */
export async function fsRefresh(quiet = false): Promise<void> {
  const epoch = generation
  const toastStore = useToastStore()
  try {
    const [st, cfg] = await Promise.all([fileshareApi.status(), fileshareApi.getConfig()])
    if (epoch !== generation) return
    fsStatus.value = st
    fsConfig.value = cfg
    // getConfig 可能刚刚才把 fileshare.json 创建出来，那份新件里四个戳键还空着——
    // 补抄一次，网页不至于因为"服务刚配好"就一路纸·蓝
    syncThemeStamp()
  } catch (e) {
    if (epoch === generation && !quiet) toastStore.showToast(errText(e), 'error')
  } finally {
    if (epoch === generation) fsLoaded.value = true
  }
}

/** 一次改动一次落盘；失败抛给调用方提示，成功后回读刷新显示 */
export async function fsSaveConfig(
  nextDirs: string[],
  nextPort: number,
  nextLocalOnly: boolean
): Promise<void> {
  const epoch = generation
  fsBusy.value = true
  try {
    const status = await fileshareApi.saveConfig(nextPort, nextDirs, nextLocalOnly)
    if (epoch === generation) fsStatus.value = status
  } finally {
    if (epoch === generation) {
      fsBusy.value = false
      await fsRefresh()
    }
  }
}

/** 空串 = 清除口令 */
export async function fsSetPassword(password: string): Promise<void> {
  const epoch = generation
  fsBusy.value = true
  try {
    await fileshareApi.setPassword(password)
  } finally {
    if (epoch === generation) {
      fsBusy.value = false
      await fsRefresh()
    }
  }
}

/** 跨组件请求打开设置弹窗的指定页签（模块页摘要行 → 设置「局域网传输」） */
export function requestOpenSettingsTab(tab: string): void {
  window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: tab }))
}
