import { ref, watch, type WatchStopHandle } from 'vue'
import { emitTo, type UnlistenFn } from '@tauri-apps/api/event'
import { errText } from './api/backup'
import { settingsApi } from './api/settings'
import { listen } from './events'
import { requestOpenSettingsTab } from './fileshareSettings'
import { invoke } from './transport'
import { isTauriRuntime } from './runtime'
import { appearance, polarityOf } from './theme'
import {
  accounts,
  currentAccount,
  currentId,
  loaded,
  usageToday,
  loadQuotaSettings,
  loadTodayUsage,
  refreshAccounts,
  refreshQuotasOnEnter,
  acquireQuotaTicker,
  releaseQuotaTicker,
} from './codexState'
import {
  DEFAULT_HUD_SKIN,
  buildCodexHudSnapshot,
  isHudSkin,
  type CodexHudEventPayload,
  type CodexHudSkin,
  type CodexHudState,
} from '../utils/codexHud'
import { moduleFlags } from '../modules/state'
import { useToastStore } from '../stores/toast'

export type { CodexHudSkin, CodexHudState, CodexHudWindow } from '../utils/codexHud'

const KEY_HUD_ENABLED = 'codex_hud_enabled'
const KEY_HUD_SKIN = 'codex_hud_skin'
const KEY_HUD_AMBIENT = 'codex_hud_ambient'
const KEY_HUD_PINNED = 'codex_hud_pinned'
const HUD_LABEL = 'codex-hud'

export const hudEnabled = ref(true)
export const hudSkin = ref<CodexHudSkin>(DEFAULT_HUD_SKIN)
export const hudAmbient = ref(true)
export const hudPinned = ref(false)

/** 落盘写入推进版本：慢一步的读回不得盖掉用户刚点的开关 */
let hudRevision = 0

export async function loadHudSettings(): Promise<void> {
  const revision = hudRevision
  const [enabled, skin, ambient, pinned] = await Promise.all([
    settingsApi.getSetting(KEY_HUD_ENABLED).catch(() => null),
    settingsApi.getSetting(KEY_HUD_SKIN).catch(() => null),
    settingsApi.getSetting(KEY_HUD_AMBIENT).catch(() => null),
    settingsApi.getSetting(KEY_HUD_PINNED).catch(() => null),
  ])
  if (revision !== hudRevision) return
  if (enabled !== null) hudEnabled.value = enabled !== 'false'
  if (skin !== null) hudSkin.value = isHudSkin(skin) ? skin : DEFAULT_HUD_SKIN
  if (ambient !== null) hudAmbient.value = ambient !== 'false'
  if (pinned !== null) hudPinned.value = pinned === 'true'
}

export async function saveHudPinned(pinned: boolean): Promise<void> {
  hudRevision++
  const previous = hudPinned.value
  hudPinned.value = pinned
  try {
    await settingsApi.setSetting(KEY_HUD_PINNED, String(pinned))
  } catch (e) {
    hudPinned.value = previous
    throw e
  }
}

export async function saveHudEnabled(enabled: boolean): Promise<void> {
  hudRevision++
  const previous = hudEnabled.value
  hudEnabled.value = enabled
  try {
    await settingsApi.setSetting(KEY_HUD_ENABLED, String(enabled))
  } catch (e) {
    hudEnabled.value = previous
    throw e
  }
}

export async function saveHudAmbient(ambient: boolean): Promise<void> {
  hudRevision++
  const previous = hudAmbient.value
  hudAmbient.value = ambient
  try {
    await settingsApi.setSetting(KEY_HUD_AMBIENT, String(ambient))
  } catch (e) {
    hudAmbient.value = previous
    throw e
  }
}

export async function saveHudSkin(skin: CodexHudSkin): Promise<void> {
  if (skin === hudSkin.value) return
  hudRevision++
  const previous = hudSkin.value
  hudSkin.value = skin
  try {
    await settingsApi.setSetting(KEY_HUD_SKIN, skin)
  } catch (e) {
    hudSkin.value = previous
    throw e
  }
}

export function buildCodexHudState(): CodexHudState {
  return buildCodexHudSnapshot({
    account: currentAccount.value,
    skin: hudSkin.value,
    theme: {
      theme: appearance.theme,
      base: polarityOf(appearance.theme),
      accent: appearance.accent,
      atmosphere: appearance.backgroundAtmosphere,
    },
    today: usageToday.value
      ? { tokens: usageToday.value.totalTokens, costUsd: usageToday.value.estimatedCostUsd }
      : null,
  })
}

let active = false
let bridgeReady: Promise<void> | null = null
let dataActive = false
let lockedSnapshot: CodexHudState | null = null
let hudWanted = false
let hudReady = false
let dataTask: Promise<void> | null = null
let unlisten: UnlistenFn[] = []
let stopWantWatch: WatchStopHandle | null = null
let stopStateWatch: WatchStopHandle | null = null
let hudOpenHandler: (() => void) | null = null

export function setCodexHudOpenHandler(handler: (() => void) | null): void {
  hudOpenHandler = handler
}

async function pushState(reveal = false): Promise<void> {
  if (!active || !hudWanted) return
  if (!hudReady) return
  try {
    await emitTo(HUD_LABEL, 'codex-hud:state', {
      state: dataActive ? buildCodexHudState() : {
        ...(lockedSnapshot ?? { ...buildCodexHudState(), placeholder: '应用已锁定' }),
        skin: hudSkin.value,
        theme: buildCodexHudState().theme,
      },
      reveal,
      ambient: hudAmbient.value,
      pinned: hudPinned.value,
      locked: !dataActive,
    } satisfies CodexHudEventPayload)
  } catch {
    hudReady = false
  }
}

async function ensureHudData(): Promise<void> {
  if (!dataActive) return
  await loadQuotaSettings()
  if (!active || !hudWanted || !dataActive) return
  if (!loaded.value) await refreshAccounts()
  if (!active || !hudWanted || !dataActive) return
  acquireQuotaTicker('codex-hud')
  void refreshQuotasOnEnter().then(() => pushState())
  void loadTodayUsage().then(() => pushState())
}

async function showHud(): Promise<void> {
  hudWanted = true
  dataTask = ensureHudData()
  let created: boolean
  try {
    created = await invoke<boolean>('desko_hud_show')
  } catch (e) {
    hudWanted = false
    releaseQuotaTicker('codex-hud')
    useToastStore().showToast(`桌面挂件窗口创建失败：${errText(e)}`, 'error')
    return
  }
  if (!active || !hudEnabled.value || !moduleFlags.codex) {
    await hideHud(true)
    return
  }
  hudReady = hudReady || !created
  if (!created) {
    await dataTask.catch(() => {})
    await pushState(true)
  }
}

async function hideHud(force = false): Promise<void> {
  releaseQuotaTicker('codex-hud')
  if (!hudWanted && !force) return
  hudWanted = false
  hudReady = false
  try {
    await invoke('desko_hud_hide')
    await invoke('desko_hud_destroy')
  } catch {
    /* 窗口可能已经被关闭手势销毁；设置里重新打开会再建 */
  }
}

async function syncHudWindow(): Promise<void> {
  if (!active) return
  const want = hudEnabled.value && moduleFlags.codex && isTauriRuntime()
  if (!want) {
    await hideHud(true)
    return
  }
  if (!hudWanted) await showHud()
}

async function onHudReady(): Promise<void> {
  if (!active || !hudWanted) return
  hudReady = true
  if (dataTask) await dataTask.catch(() => {})
  await pushState(true)
}

/** 收回账号会话前保留展示快照；锁定期间不读取账号或启动配额轮询。 */
export function suspendCodexHudData(): void {
  if (dataActive) lockedSnapshot = buildCodexHudState()
  dataActive = false
  releaseQuotaTicker('codex-hud')
  void pushState()
}

async function closeFromHud(): Promise<void> {
  hudRevision++
  hudEnabled.value = false
  try {
    await settingsApi.setSetting(KEY_HUD_ENABLED, 'false')
  } catch (e) {
    useToastStore().showToast(`挂件已隐藏，但设置未保存：${errText(e)}`, 'error')
  }
}

/** 托盘勾选态与模块启用、挂件显示设置保持一致。 */
async function syncTrayItem(): Promise<void> {
  try {
    await invoke('desko_hud_set_tray', { checked: hudEnabled.value && moduleFlags.codex })
  } catch {
    /* 托盘还没建起来时命令会报错，下一次开关变化会再报 */
  }
}

async function toggleHudFromTray(): Promise<void> {
  try {
    await saveHudEnabled(!hudEnabled.value)
  } catch (e) {
    useToastStore().showToast(`桌面挂件开关未保存：${errText(e)}`, 'error')
  }
}

export async function activateCodexHudBridge(unlocked = true): Promise<void> {
  if (!isTauriRuntime()) return
  dataActive = unlocked
  if (unlocked) lockedSnapshot = null
  if (active) {
    await bridgeReady
    if (!active) return
    await syncHudWindow()
    if (hudWanted && unlocked) await ensureHudData()
    await pushState()
    return
  }
  active = true
  bridgeReady = initializeHudBridge()
  try {
    await bridgeReady
  } finally {
    bridgeReady = null
  }
  await syncHudWindow()
}

async function initializeHudBridge(): Promise<void> {
  await loadHudSettings()
  await syncTrayItem()
  unlisten = [
    await listen('codex-hud:ready', () => { void onHudReady() }),
    await listen('codex-hud:request-close', () => { void closeFromHud() }),
    await listen('codex-hud:open', () => hudOpenHandler?.()),
    await listen('codex-hud:open-settings', () => requestOpenSettingsTab('codex')),
    await listen('tray-hud-toggle', () => { void toggleHudFromTray() }),
  ]
  stopWantWatch = watch(
    [hudEnabled, () => moduleFlags.codex],
    () => {
      void syncTrayItem()
      void syncHudWindow()
    },
  )
  stopStateWatch = watch(
    [accounts, currentId, usageToday, hudSkin, hudAmbient, hudPinned,
      () => appearance.theme, () => appearance.accent, () => appearance.backgroundAtmosphere],
    () => { void pushState() },
    { deep: true },
  )
}

export async function deactivateCodexHudBridge(): Promise<void> {
  if (!active) return
  active = false
  dataActive = false
  lockedSnapshot = null
  stopWantWatch?.()
  stopWantWatch = null
  stopStateWatch?.()
  stopStateWatch = null
  unlisten.forEach((stop) => stop())
  unlisten = []
  releaseQuotaTicker('codex-hud')
  hudWanted = false
  dataTask = null
  if (isTauriRuntime()) {
    try { await invoke('desko_hud_hide') } catch { /* 锁定收尾不能卡在窗口命令上 */ }
  }
}
