import { ref } from 'vue'
import { settingsApi } from './api/settings'

/** 验证码模块总开关：默认关，开了才有侧栏入口 */
export const mfaEnabled = ref(false)
let loaded = false

export async function readMfaFeature(): Promise<boolean> {
  if (loaded) return mfaEnabled.value
  try {
    mfaEnabled.value = (await settingsApi.getSetting('mfa_enabled')) === 'true'
  } catch {
    /* 读不到就保持关闭 */
  }
  loaded = true
  return mfaEnabled.value
}

export async function saveMfaFeature(on: boolean): Promise<void> {
  mfaEnabled.value = on
  loaded = true
  await settingsApi.setSetting('mfa_enabled', on.toString())
}
