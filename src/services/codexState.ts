import { computed, ref } from 'vue'
import { codexApi, type CodexAccount } from './api/codex'
import { errText } from './api/backup'
import { useToastStore } from '../stores/toast'

/** Codex 官方凭据路径：模块页与设置页共用，设置弹窗打开时预热 */
export const storagePaths = ref<{
  providerStorePath: string
  configPath: string
  authPath: string
} | null>(null)

export async function loadStoragePaths(): Promise<void> {
  try {
    storagePaths.value = await codexApi.storagePaths()
  } catch {
    storagePaths.value = null
  }
}

/** 账号列表单例：模块页与添加/编辑弹窗共用，一次落盘全站即时刷新 */
export const accounts = ref<CodexAccount[]>([])
export const currentId = ref('')
export const loaded = ref(false)
export const busyId = ref('')
/** 切号进度（后端 codex:switch-progress 事件），只在切号那几秒非空 */
export const switchStep = ref('')

/** 后端 emit_codex_switch_step 的步名，翻成人话再上界面 */
const SWITCH_STEPS: Record<string, string> = {
  credentials: '读取凭据',
  accessToken: '校验访问令牌',
  refreshTokens: '刷新令牌',
  writeCredentials: '写入官方凭据',
  syncSettings: '同步配置',
}

/** 这个事件是三套形状混发的：步进带 step/stepStatus，收口带 type */
export interface SwitchProgress {
  accountId?: string
  step?: string
  stepStatus?: string
  type?: string
}

export function applySwitchProgress(p: SwitchProgress): void {
  if (p.type === 'complete' || p.type === 'error') {
    switchStep.value = ''
    return
  }
  if (!p.step) return
  const label = SWITCH_STEPS[p.step] ?? p.step
  switchStep.value = p.stepStatus === 'skipped' ? `${label} · 跳过` : label
}

export const currentAccount = computed(
  () => accounts.value.find((a) => a.id === currentId.value) ?? null
)

export async function refreshAccounts(): Promise<void> {
  const toast = useToastStore()
  try {
    const [list, cur] = await Promise.all([codexApi.list(), codexApi.current()])
    accounts.value = list
    currentId.value = cur?.id ?? ''
  } catch (e) {
    toast.showToast(errText(e), 'error')
  } finally {
    loaded.value = true
  }
}

/** 配额刷新走后台批量：一次点击不该把整页冻在网络请求上 */
export async function refreshQuotas(ids: string[]): Promise<void> {
  const toast = useToastStore()
  if (!ids.length) return
  try {
    await codexApi.refreshAllQuotas(ids)
    toast.showToast('配额已刷新')
    await refreshAccounts()
  } catch (e) {
    toast.showToast(errText(e), 'error')
  }
}

/** 读官方 config.toml 生效的 model_provider；读不到就返回空串，绝不让它拖垮切号 */
async function readVisibilityProvider(): Promise<string> {
  try {
    return await codexApi.historyProvider()
  } catch {
    return ''
  }
}

/** 切号收尾：凭据形态变了（OAuth ↔ API Key）会改写 config.toml 的 model_provider，
 *  官方客户端侧栏按它过滤 threads，旧会话会集体消失。值变了就补一次 quick 修复把旧会话挂回来；
 *  修复带改前备份、不联网。文案要留够读完的时间，故走 info/error 档。 */
async function finishSwitch(providerBefore: string, providerAfter: string): Promise<void> {
  const toast = useToastStore()
  if (!providerBefore || !providerAfter || providerBefore === providerAfter) {
    toast.showToast('已切换账号')
    return
  }
  toast.showToast('凭据形态已变，正在修复会话可见性…', 'info')
  try {
    const s = await codexApi.repairSessionVisibility()
    const n = s.updatedSqliteRowCount + s.changedRolloutFileCount
    toast.showToast(n > 0 ? `已切换账号，并修复 ${n} 处会话可见性` : '已切换账号，会话可见性无需修复')
  } catch (e) {
    toast.showToast(`已切换账号，但会话可见性修复失败：${errText(e)}`, 'error')
  }
}

export async function switchTo(id: string): Promise<boolean> {
  const toast = useToastStore()
  busyId.value = id
  try {
    const providerBefore = await readVisibilityProvider()
    await codexApi.switch(id)
    const providerAfter = await readVisibilityProvider()
    await refreshAccounts()
    await finishSwitch(providerBefore, providerAfter)
    return true
  } catch (e) {
    toast.showToast(errText(e), 'error')
    return false
  } finally {
    busyId.value = ''
    // 收口事件偶尔抢跑或漏发都不该把进度字留在页面上
    switchStep.value = ''
  }
}

export async function runOn<T>(id: string, fn: () => Promise<T>, okToast: string): Promise<T | null> {
  const toast = useToastStore()
  busyId.value = id
  try {
    const r = await fn()
    if (okToast) toast.showToast(okToast)
    await refreshAccounts()
    return r
  } catch (e) {
    toast.showToast(errText(e), 'error')
    return null
  } finally {
    busyId.value = ''
  }
}

export function remaining(a: CodexAccount): number | null {
  const q = a.quota
  if (!q) return null
  return Math.min(q.hourly_percentage, q.weekly_percentage)
}

/** 官方重置时间只到分钟，直接给人话「x 小时 y 分后重置」，不摆 ISO 串 */
export function resetsIn(ts: number | null | undefined): string {
  if (!ts) return ''
  const mins = Math.round((ts * 1000 - Date.now()) / 60000)
  if (mins <= 0) return '即将重置'
  if (mins < 60) return `${mins} 分钟后重置`
  const h = Math.floor(mins / 60)
  if (h < 48) {
    const m = mins % 60
    return m ? `${h} 小时 ${m} 分后重置` : `${h} 小时后重置`
  }
  return `${Math.floor(h / 24)} 天后重置`
}
