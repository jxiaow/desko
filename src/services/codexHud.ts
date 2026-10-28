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
  quotaRefreshMinutes,
  loadTodayUsage,
  refreshAccounts,
  refreshQuotasOnEnter,
  acquireQuotaTicker,
  releaseQuotaTicker,
  USAGE_REFRESH_MS,
} from './codexState'
import {
  DEFAULT_HUD_SKIN,
  buildCodexHudSnapshot,
  isHudSkin,
  type CodexHudEventPayload,
  type CodexHudSkin,
  type CodexHudState,
} from '../utils/codexHud'
import type { CodexQuotaAccount } from '../utils/codexQuota'
import { localDayKey } from '../utils/codexUsage'
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

function hudTheme(): CodexHudState['theme'] {
  return {
    theme: appearance.theme,
    base: polarityOf(appearance.theme),
    accent: appearance.accent,
    atmosphere: appearance.backgroundAtmosphere,
  }
}

export function buildCodexHudState(): CodexHudState {
  return buildCodexHudSnapshot({
    account: currentAccount.value,
    skin: hudSkin.value,
    theme: hudTheme(),
    today: usageToday.value
      ? { tokens: usageToday.value.totalTokens, costUsd: usageToday.value.estimatedCostUsd }
      : null,
  })
}

interface LockedHudPayload {
  account: CodexQuotaAccount | null
  today: { tokens: number; costUsd: number | null } | null
}

let active = false
let bridgeReady: Promise<void> | null = null
let dataActive = false
let lockedSnapshot: CodexHudState | null = null
let lockedTodayDay = ''
let lockedTimer: ReturnType<typeof setInterval> | null = null
let lockedTask: Promise<void> | null = null
let lockedStarting = false
/** 解锁、隐藏时递增，晚到的锁定刷新结果不得盖到新快照上。 */
let lockedEpoch = 0
let hudWanted = false
let hudReady = false
let dataTask: Promise<void> | null = null
let usageTimer: ReturnType<typeof setInterval> | null = null
let unlisten: UnlistenFn[] = []
let stopWantWatch: WatchStopHandle | null = null
let stopStateWatch: WatchStopHandle | null = null
let hudOpenHandler: (() => void) | null = null
let windowSync: Promise<void> = Promise.resolve()

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
        theme: hudTheme(),
      },
      reveal,
      ambient: hudAmbient.value,
      pinned: hudPinned.value,
    } satisfies CodexHudEventPayload)
  } catch {
    // 一次 IPC 失败不能撤销 ready 握手；下一轮数据更新继续重试。
  }
}

/** 跨过零点先扔掉昨天的今日用量：新数字没回来之前宁可不显示。 */
function rollLockedToday(): void {
  const day = localDayKey(new Date())
  if (lockedTodayDay === day) return
  lockedTodayDay = day
  if (lockedSnapshot) lockedSnapshot = { ...lockedSnapshot, today: null }
}

async function refreshLockedData(): Promise<void> {
  if (lockedTask || dataActive) return
  if (!active || !hudWanted || !hudReady) return
  const epoch = lockedEpoch
  const task = (async () => {
    rollLockedToday()
    try {
      const payload = await invoke<LockedHudPayload>('desko_hud_refresh_locked')
      if (epoch !== lockedEpoch || dataActive || !active) return
      lockedSnapshot = buildCodexHudSnapshot({
        account: payload.account,
        skin: hudSkin.value,
        theme: hudTheme(),
        today: payload.today ?? lockedSnapshot?.today ?? null,
      })
      if (payload.today) lockedTodayDay = localDayKey(new Date())
      await pushState()
    } catch {
      // 一次网络失败保留上一份快照；额度错误已经落在 quota_error 里。
      if (epoch === lockedEpoch && !dataActive) await pushState()
    }
  })()
  lockedTask = task
  try {
    await task
  } finally {
    if (lockedTask === task) lockedTask = null
  }
}

/** 锁定态只轮询当前账号额度与本机今日用量；节奏沿用配额自动刷新设置，0=不联网。 */
async function startLockedRefresh(): Promise<void> {
  if (lockedStarting || lockedTimer) return
  if (!active || !hudWanted || !hudReady || dataActive || !isTauriRuntime()) return
  lockedStarting = true
  try {
    await loadQuotaSettings()
  } finally {
    lockedStarting = false
  }
  if (!active || !hudWanted || !hudReady || dataActive || lockedTimer) return
  const minutes = quotaRefreshMinutes.value
  if (minutes <= 0) return
  void refreshLockedData()
  lockedTimer = setInterval(() => { void refreshLockedData() }, minutes * 60_000)
}

function stopLockedRefresh(): void {
  lockedEpoch++
  if (lockedTimer) clearInterval(lockedTimer)
  lockedTimer = null
  lockedTask = null
}

async function refreshHudUsage(): Promise<void> {
  if (!active || !hudWanted || !dataActive) return
  await loadTodayUsage()
  await pushState()
}

function stopUsageRefresh(): void {
  if (usageTimer) clearInterval(usageTimer)
  usageTimer = null
}

function refreshOnResume(): void {
  if (!active || !hudWanted || document.visibilityState === 'hidden') return
  if (dataActive) {
    void refreshAccounts({ silent: true })
    void refreshHudUsage()
    void refreshQuotasOnEnter()
  } else if (quotaRefreshMinutes.value > 0) {
    void refreshLockedData()
  }
}

async function ensureHudData(): Promise<void> {
  if (!dataActive) return
  await loadQuotaSettings()
  if (!active || !hudWanted || !dataActive) return
  if (!loaded.value) await refreshAccounts()
  if (!active || !hudWanted || !dataActive) return
  acquireQuotaTicker('codex-hud')
  // 主窗口收进托盘时挂件仍可见，本地用量不随主窗口可见性或联网开关停更。
  if (!usageTimer) usageTimer = setInterval(() => { void refreshHudUsage() }, USAGE_REFRESH_MS)
  void refreshQuotasOnEnter().then(() => pushState())
  void refreshHudUsage()
}

async function showHud(): Promise<void> {
  hudWanted = true
  dataTask = ensureHudData()
  let created: boolean
  try {
    created = await invoke<boolean>('desko_hud_show')
  } catch (e) {
    hudWanted = false
    stopUsageRefresh()
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
  if (!dataActive) void startLockedRefresh()
}

async function hideHud(force = false): Promise<void> {
  stopLockedRefresh()
  stopUsageRefresh()
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

function syncHudWindow(): Promise<void> {
  // Native hide/destroy/show must finish in order. A slow destroy from a
  // previous toggle must not remove the window just enabled by the next one.
  const task = windowSync.catch(() => {}).then(async () => {
    if (!active) return
    const want = hudEnabled.value && moduleFlags.codex && isTauriRuntime()
    if (!want) await hideHud(true)
    else if (!hudWanted) await showHud()
  })
  windowSync = task
  return task
}

async function onHudReady(): Promise<void> {
  if (!active || !hudWanted) return
  hudReady = true
  if (dataTask) await dataTask.catch(() => {})
  await pushState(true)
  if (!dataActive) void startLockedRefresh()
}

/** 收回账号会话前保留展示快照；锁定期间只走只读聚合命令继续刷新。 */
export function suspendCodexHudData(): void {
  if (dataActive) {
    lockedSnapshot = buildCodexHudState()
    lockedTodayDay = localDayKey(new Date())
  }
  dataActive = false
  stopUsageRefresh()
  releaseQuotaTicker('codex-hud')
  void pushState()
  void startLockedRefresh()
}

async function closeFromHud(): Promise<void> {
  stopLockedRefresh()
  stopUsageRefresh()
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
  if (unlocked) {
    stopLockedRefresh()
    lockedSnapshot = null
    lockedTodayDay = ''
  }
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
  window.addEventListener('focus', refreshOnResume)
  document.addEventListener('visibilitychange', refreshOnResume)
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
  stopLockedRefresh()
  stopUsageRefresh()
  window.removeEventListener('focus', refreshOnResume)
  document.removeEventListener('visibilitychange', refreshOnResume)
  lockedSnapshot = null
  lockedTodayDay = ''
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
    windowSync = windowSync.catch(() => {}).then(async () => {
      try { await invoke('desko_hud_hide') } catch { /* 锁定收尾不能卡在窗口命令上 */ }
    })
    await windowSync
  }
}
