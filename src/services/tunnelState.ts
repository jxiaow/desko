import { ref } from 'vue'
import { tunnelApi } from './api/tunnel'
import type { TunnelBinary, TunnelLogin, TunnelProvision, TunnelServiceRow, TunnelStatus } from './api/tunnel'

/** 隧道状态单例：跨页面挂载存活。重进页面首帧直接沿用上次的回读值，
 *  不等五个 invoke 回来——每次切换都闪一帧骨架再蹦出内容，读起来就是闪烁 */
export const tnLoaded = ref(false)
export const tnStatus = ref<TunnelStatus | null>(null)
export const tnBinary = ref<TunnelBinary | null>(null)
export const tnProvision = ref<TunnelProvision | null>(null)
export const tnLogin = ref<TunnelLogin>({ state: 'idle', url: null, secondsLeft: 0 })
export const tnServices = ref<TunnelServiceRow[]>([])

export async function tnRefresh(): Promise<void> {
  try {
    const [s, b, p, l, sv] = await Promise.all([
      tunnelApi.status(),
      tunnelApi.binaryStatus(),
      tunnelApi.provisionStatus(),
      tunnelApi.loginStatus(),
      tunnelApi.listServices(),
    ])
    tnStatus.value = s
    tnBinary.value = b
    tnProvision.value = p
    tnLogin.value = l
    tnServices.value = sv
  } finally {
    tnLoaded.value = true
  }
}
