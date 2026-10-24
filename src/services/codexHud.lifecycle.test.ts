import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { emitTo } from '@tauri-apps/api/event'
import { settingsApi } from './api/settings'
import { invoke } from './transport'
import { moduleFlags } from '../modules/state'
import { usageToday, loadQuotaSettings, refreshAccounts, acquireQuotaTicker } from './codexState'
import {
  activateCodexHudBridge, deactivateCodexHudBridge, suspendCodexHudData,
  hudEnabled, hudPinned, saveHudEnabled,
} from './codexHud'
import type { CodexHudEventPayload } from '../utils/codexHud'

const handlers = vi.hoisted(() => new Map<string, () => void>())
vi.mock('./runtime', () => ({ isTauriRuntime: () => true }))
vi.mock('./api/settings', () => ({ settingsApi: { getSetting: vi.fn(), setSetting: vi.fn() } }))
vi.mock('./transport', () => ({ invoke: vi.fn() }))
vi.mock('./events', () => ({ listen: vi.fn(async (name, handler) => {
  handlers.set(name, handler)
  return () => handlers.delete(name)
}) }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn() }))
vi.mock('../modules/state', async () => {
  const { reactive } = await import('vue')
  return { moduleFlags: reactive({ codex: true }) }
})
vi.mock('./codexState', async () => {
  const { ref } = await import('vue')
  return {
    accounts: ref([]), currentAccount: ref(null), currentId: ref(''), loaded: ref(false),
    usageToday: ref(null), loadQuotaSettings: vi.fn(), loadTodayUsage: vi.fn(async () => {}),
    refreshAccounts: vi.fn(), refreshQuotasOnEnter: vi.fn(async () => {}),
    acquireQuotaTicker: vi.fn(), releaseQuotaTicker: vi.fn(),
  }
})
vi.mock('./theme', () => ({
  appearance: { theme: 'paper', accent: 'ink', backgroundAtmosphere: false },
  polarityOf: () => 'light',
}))

function payload(): CodexHudEventPayload {
  const calls = vi.mocked(emitTo).mock.calls
  return calls[calls.length - 1][2] as CodexHudEventPayload
}
async function ready(): Promise<void> {
  handlers.get('codex-hud:ready')?.()
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  moduleFlags.codex = true
  hudEnabled.value = true
  hudPinned.value = false
  usageToday.value = null
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(settingsApi.setSetting).mockResolvedValue()
  vi.mocked(invoke).mockImplementation(async cmd => cmd === 'desko_hud_show' ? true : undefined)
})
afterEach(async () => { await deactivateCodexHudBridge() })

it('添加 Codex 模块后自动显示挂件；移除模块会销毁窗口', async () => {
  moduleFlags.codex = false
  await activateCodexHudBridge()
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_show')
  moduleFlags.codex = true
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('desko_hud_show')
  moduleFlags.codex = false
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('desko_hud_destroy')
})

it('冷启动锁定态也显示角色，不取账号数据', async () => {
  await activateCodexHudBridge(false)
  await ready()
  expect(invoke).toHaveBeenCalledWith('desko_hud_show')
  expect(loadQuotaSettings).not.toHaveBeenCalled()
  expect(refreshAccounts).not.toHaveBeenCalled()
  expect(payload()).toMatchObject({ reveal: true, locked: true })
})

it('启动读设置期间解锁，仍先装好监听再创建窗口', async () => {
  let finish!: (enabled: string) => void
  vi.mocked(settingsApi.getSetting).mockImplementation(async key => key === 'codex_hud_enabled'
    ? new Promise<string>(resolve => { finish = resolve }) : '')
  const startup = activateCodexHudBridge(false)
  await flushPromises()
  const unlock = activateCodexHudBridge()
  await flushPromises()
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_show')
  finish('')
  await Promise.all([startup, unlock])
  await ready()
  expect(payload()).toMatchObject({ reveal: true, locked: false })
})

it('锁定保留最近快照和固定设置，解锁恢复刷新而不重建窗口', async () => {
  await activateCodexHudBridge()
  await ready()
  usageToday.value = { totalTokens: 321, estimatedCostUsd: 1.25 } as NonNullable<typeof usageToday.value>
  hudPinned.value = true
  await nextTick()
  await flushPromises()
  suspendCodexHudData()
  usageToday.value = null
  await nextTick()
  await flushPromises()
  expect(payload()).toMatchObject({ locked: true, pinned: true, state: { today: { tokens: 321, costUsd: 1.25 } } })
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_hide')
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_destroy')
  vi.mocked(acquireQuotaTicker).mockClear()
  await activateCodexHudBridge()
  expect(acquireQuotaTicker).toHaveBeenCalledWith('codex-hud')
  expect(payload()).toMatchObject({ locked: false })
  expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'desko_hud_show')).toHaveLength(1)
})

it('窗口创建期间关闭显示，不会在创建完成后重新亮起', async () => {
  let finish!: (created: boolean) => void
  vi.mocked(invoke).mockImplementation(async cmd => cmd === 'desko_hud_show'
    ? new Promise<boolean>(resolve => { finish = resolve }) : undefined)
  const activation = activateCodexHudBridge(false)
  await flushPromises()
  await saveHudEnabled(false)
  await flushPromises()
  vi.mocked(invoke).mockClear()
  finish(true)
  await activation
  await ready()
  expect(invoke).toHaveBeenCalledWith('desko_hud_hide')
  expect(emitTo).not.toHaveBeenCalled()
})

it('窗口先发 ready、创建命令后返回时，后续快照仍能送达', async () => {
  vi.mocked(invoke).mockImplementation(async cmd => {
    if (cmd === 'desko_hud_show') {
      handlers.get('codex-hud:ready')?.()
      await flushPromises()
      return true
    }
  })
  await activateCodexHudBridge(false)
  vi.mocked(emitTo).mockClear()
  hudPinned.value = true
  await nextTick()
  await flushPromises()
  expect(payload()).toMatchObject({ pinned: true, locked: true })
})
