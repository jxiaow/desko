import { ref } from 'vue'
import { tunnelApi } from './api/tunnel'
import type { TunnelBinary, TunnelLogin, TunnelProvision, TunnelServiceRow, TunnelStatus } from './api/tunnel'
import { errText } from './api/backup'

/** 隧道状态单例：跨页面挂载存活。重进页面首帧直接沿用上次的回读值，
 *  不等五个 invoke 回来——每次切换都闪一帧骨架再蹦出内容，读起来就是闪烁 */
export const tnLoaded = ref(false)
export const tnStatus = ref<TunnelStatus | null>(null)
export const tnBinary = ref<TunnelBinary | null>(null)
export const tnProvision = ref<TunnelProvision | null>(null)
export const tnLogin = ref<TunnelLogin>({ state: 'idle', url: null, secondsLeft: 0, note: null })
export const tnServices = ref<TunnelServiceRow[]>([])
/** 某一格回读失败：其余格照常更新，这一句留在页面上说清是哪格坏了。
 *  整批 Promise.all 的写法会让一个失败把全页冻在上一次的快照上，还不报错——
 *  「浏览器里授权完了，desko 一动不动」就是这么来的 */
export const tnPollError = ref('')

export async function tnRefresh(): Promise<void> {
  const settled = await Promise.allSettled([
    tunnelApi.status(),
    tunnelApi.binaryStatus(),
    tunnelApi.provisionStatus(),
    tunnelApi.loginStatus(),
    tunnelApi.listServices(),
  ])
  const [s, b, p, l, sv] = settled
  if (s.status === 'fulfilled') tnStatus.value = s.value
  if (b.status === 'fulfilled') tnBinary.value = b.value
  if (p.status === 'fulfilled') tnProvision.value = p.value
  if (l.status === 'fulfilled') tnLogin.value = l.value
  if (sv.status === 'fulfilled') tnServices.value = sv.value
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  tnPollError.value = failed ? errText(failed.reason) : ''
  tnLoaded.value = true
}
