import { ref } from 'vue'
import { tunnelApi } from './api/tunnel'
import type { TunnelBinary, TunnelDomain, TunnelLogin, TunnelProvision, TunnelServiceRow, TunnelStatus } from './api/tunnel'
import { errText } from './api/backup'

/** 隧道状态单例：跨页面挂载存活。重进页面首帧直接沿用上次的回读值，
 *  不等五个 invoke 回来——每次切换都闪一帧骨架再蹦出内容，读起来就是闪烁 */
export const tnLoaded = ref(false)
export const tnStatus = ref<TunnelStatus | null>(null)
export const tnBinary = ref<TunnelBinary | null>(null)
export const tnProvision = ref<TunnelProvision | null>(null)
export const tnLogin = ref<TunnelLogin>({ state: 'idle', url: null, secondsLeft: 0, note: null })
export const tnServices = ref<TunnelServiceRow[]>([])
/** 每格返回即更新；慢请求与失败都不能挡住已经读到的授权状态。 */
export const tnPollError = ref('')
export const tnDomain = ref<TunnelDomain | null>(null)
export const tnDomainLoading = ref(false)
export const tnDomainError = ref('')
let domainVersion = 0

/** 授权后读一次，失败由用户重试；不把外网请求塞进每三秒的本地状态轮询。 */
export async function tnLoadDomain(force = false): Promise<void> {
  if (tnDomainLoading.value || (tnDomain.value && !force)) return
  const version = domainVersion
  tnDomainLoading.value = true
  tnDomainError.value = ''
  try {
    const domain = await tunnelApi.authorizedDomain()
    if (version === domainVersion) tnDomain.value = domain
  } catch (error) {
    if (version === domainVersion) tnDomainError.value = errText(error)
  } finally {
    if (version === domainVersion) tnDomainLoading.value = false
  }
}

export function tnClearDomain(): void {
  domainVersion++
  tnDomain.value = null
  tnDomainLoading.value = false
  tnDomainError.value = ''
}

let refreshVersion = 0
const appliedVersions = { status: 0, binary: 0, provision: 0, login: 0, services: 0, error: 0 }

export async function tnRefresh(): Promise<void> {
  const version = ++refreshVersion
  async function read<T>(field: keyof typeof appliedVersions, request: Promise<T>, apply: (value: T) => void) {
    const value = await request
    if (version < appliedVersions[field]) return
    appliedVersions[field] = version
    apply(value)
    tnLoaded.value = true
  }
  const login = read('login', tunnelApi.loginStatus(), value => { tnLogin.value = value })
  const settled = await Promise.allSettled([
    read('status', tunnelApi.status(), value => { tnStatus.value = value }),
    read('binary', tunnelApi.binaryStatus(), value => { tnBinary.value = value }),
    // loginStatus 会领取登录目录里的 cert.pem；进度须在领取后读取，才能同轮认到授权。
    read('provision', login.catch(() => undefined).then(() => tunnelApi.provisionStatus()), value => { tnProvision.value = value }),
    login,
    read('services', tunnelApi.listServices(), value => { tnServices.value = value }),
  ])
  if (version < appliedVersions.error) return
  appliedVersions.error = version
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  tnPollError.value = failed ? errText(failed.reason) : ''
  tnLoaded.value = true
}
