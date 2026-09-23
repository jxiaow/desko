import { ref } from 'vue'
import { settingsApi } from './api/settings'
import { fileshareApi } from './api/fileshare'

/** 局域网文件传输总开关：默认关，开了才有侧栏入口。与验证码先例的差别是它联动真实服务生命周期 */
export const fileshareEnabled = ref(false)
let loaded = false

export async function readFileshareFeature(): Promise<boolean> {
  if (loaded) return fileshareEnabled.value
  try {
    fileshareEnabled.value = (await settingsApi.getSetting('fileshare_enabled')) === 'true'
  } catch {
    /* 读不到就保持关闭 */
  }
  loaded = true
  return fileshareEnabled.value
}

/** 开 → 只出现侧栏入口，服务起不起由模块页按钮定；关 → 停监听（模块本身保留在设置里） */
export async function saveFileshareFeature(on: boolean): Promise<void> {
  const prev = fileshareEnabled.value
  fileshareEnabled.value = on
  loaded = true
  try {
    await settingsApi.setSetting('fileshare_enabled', on.toString())
  } catch (e) {
    // 写设置本身失败：界面回滚，别让侧栏出现一个没落库的入口
    fileshareEnabled.value = prev
    throw e
  }
  if (!on) {
    try {
      await fileshareApi.stop()
    } catch {
      /* 停不掉也只是端口多占一会，不打断关开关这个动作 */
    }
  }
}
