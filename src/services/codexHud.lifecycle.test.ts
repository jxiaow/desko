import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { emitTo } from '@tauri-apps/api/event'
import { settingsApi } from './api/settings'
import { invoke } from './transport'
import { moduleFlags } from '../modules/state'
import { usageToday, loadQuotaSettings, refreshAccounts, acquireQuotaTicker, quotaRefreshMinutes } from './codexState'
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
    usageToday: ref(null), quotaRefreshMinutes: ref(10),
    loadQuotaSettings: vi.fn(), loadTodayUsage: vi.fn(async () => {}),
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
function lockedRefreshes(): number {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === 'desko_hud_refresh_locked').length
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  moduleFlags.codex = true
  hudEnabled.value = true
  hudPinned.value = false
  usageToday.value = null
  quotaRefreshMinutes.value = 10
  vi.mocked(settingsApi.getSetting).mockResolvedValue('')
  vi.mocked(settingsApi.setSetting).mockResolvedValue()
  vi.mocked(invoke).mockImplementation(async cmd => {
    if (cmd === 'desko_hud_show') return true
    if (cmd === 'desko_hud_refresh_locked') return { account: null, today: null }
  })
})
afterEach(async () => {
  await deactivateCodexHudBridge()
  vi.useRealTimers()
})

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

it('冷启动锁定态也显示角色，只走只读刷新，不取账号列表', async () => {
  await activateCodexHudBridge(false)
  await ready()
  await flushPromises()
  expect(invoke).toHaveBeenCalledWith('desko_hud_show')
  expect(loadQuotaSettings).toHaveBeenCalled()
  expect(refreshAccounts).not.toHaveBeenCalled()
  expect(invoke).toHaveBeenCalledWith('desko_hud_refresh_locked')
  const payloads = vi.mocked(emitTo).mock.calls.map(call => call[2] as CodexHudEventPayload)
  expect(payloads[0]).toMatchObject({ reveal: true })
  expect(payloads.every(item => !('locked' in item))).toBe(true)
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
  expect(payload()).toMatchObject({ reveal: true })
  expect(payload()).not.toHaveProperty('locked')
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
  expect(payload()).toMatchObject({ pinned: true, state: { today: { tokens: 321, costUsd: 1.25 } } })
  expect(payload()).not.toHaveProperty('locked')
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_hide')
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_destroy')
  vi.mocked(acquireQuotaTicker).mockClear()
  await activateCodexHudBridge()
  expect(acquireQuotaTicker).toHaveBeenCalledWith('codex-hud')
  expect(payload()).not.toHaveProperty('locked')
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
  expect(payload()).toMatchObject({ pinned: true })
  expect(payload()).not.toHaveProperty('locked')
})

it('锁定后立即用只读命令刷新当前账号与今日用量', async () => {
  vi.mocked(invoke).mockImplementation(async cmd => {
    if (cmd === 'desko_hud_show') return true
    if (cmd === 'desko_hud_refresh_locked') {
      return {
        account: {
          auth_mode: 'oauth',
          quota: {
            hourly_percentage: 41,
            hourly_reset_time: null,
            weekly_percentage: 77,
            weekly_reset_time: null,
            hourly_window_present: true,
            weekly_window_present: true,
          },
        },
        today: { tokens: 999, costUsd: 2.5 },
      }
    }
  })
  await activateCodexHudBridge()
  await ready()
  suspendCodexHudData()
  await flushPromises()
  expect(lockedRefreshes()).toBe(1)
  expect(payload().state.primary).toMatchObject({ label: '5h', percentage: 41 })
  expect(payload().state.secondary).toMatchObject({ label: 'w', percentage: 77 })
  expect(payload().state.today).toEqual({ tokens: 999, costUsd: 2.5 })
})

it('锁定期间按配额自动刷新间隔轮询，解锁后停止', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  await activateCodexHudBridge()
  await ready()
  suspendCodexHudData()
  await flushPromises()
  expect(lockedRefreshes()).toBe(1)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(lockedRefreshes()).toBe(2)
  await activateCodexHudBridge()
  await flushPromises()
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(lockedRefreshes()).toBe(2)
})

it('配额自动刷新设为 0 时锁定不联网', async () => {
  quotaRefreshMinutes.value = 0
  await activateCodexHudBridge()
  await ready()
  suspendCodexHudData()
  await flushPromises()
  expect(lockedRefreshes()).toBe(0)
})

it('锁定刷新失败保留上一份快照', async () => {
  await activateCodexHudBridge()
  await ready()
  usageToday.value = { totalTokens: 321, estimatedCostUsd: 1.25 } as NonNullable<typeof usageToday.value>
  await nextTick()
  await flushPromises()
  vi.mocked(invoke).mockImplementation(async cmd => {
    if (cmd === 'desko_hud_refresh_locked') throw new Error('offline')
    if (cmd === 'desko_hud_show') return true
  })
  suspendCodexHudData()
  await flushPromises()
  expect(lockedRefreshes()).toBe(1)
  expect(payload().state.today).toEqual({ tokens: 321, costUsd: 1.25 })
  expect(invoke).not.toHaveBeenCalledWith('desko_hud_hide')
})

it('跨天后先清掉昨天的今日用量', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 26, 23, 59, 0))
  let attempt = 0
  vi.mocked(invoke).mockImplementation(async cmd => {
    if (cmd === 'desko_hud_show') return true
    if (cmd === 'desko_hud_refresh_locked') {
      attempt += 1
      if (attempt === 1) return { account: null, today: { tokens: 111, costUsd: 1 } }
      throw new Error('offline')
    }
  })
  await activateCodexHudBridge()
  await ready()
  suspendCodexHudData()
  await flushPromises()
  expect(payload().state.today).toEqual({ tokens: 111, costUsd: 1 })
  vi.setSystemTime(new Date(2026, 9, 27, 0, 1, 0))
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect(attempt).toBe(2)
  expect(payload().state.today).toBeNull()
})
