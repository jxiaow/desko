import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { invoke } from '@tauri-apps/api/core'
import type { CodexWslAuthStatus, CodexWslAuthSyncResult } from '../api/codex'
import { useToastStore } from '../../stores/toast'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockInvoke = vi.mocked(invoke)
const STATUS = 'get_codex_wsl_auth_status'
const SYNC = 'sync_codex_auth_to_wsl'
const results: CodexWslAuthSyncResult[] = [
  { distro: 'Ubuntu', user: 'synthetic', status: 'synced', message: null },
]

function status(): CodexWslAuthStatus {
  return {
    autoSync: true,
    source: {
      available: true, path: 'synthetic/auth.json', authMode: 'chatgpt',
      email: 'synthetic@example.invalid', plan: 'pro', accessExpiresAt: 2_000_000_000,
      expired: false, error: null,
    },
    targets: [{
      distro: 'Ubuntu', user: 'synthetic', homePath: 'synthetic/.codex',
      state: 'outdated', email: 'synthetic@example.invalid', accessExpiresAt: 1_999_999_000,
      expired: false,
    }],
    targetError: null,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === command)
}

async function loadState() {
  vi.resetModules()
  return import('../codexState')
}

describe('Codex WSL 登录态同步', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
  })
  afterEach(() => { vi.useRealTimers() })

  for (const initialState of ['expired', 'missing', 'no-targets'] as const) {
    it(`${initialState} 恢复后再次进页会重读状态并同步，十分钟内仍节流`, async () => {
      vi.useFakeTimers()
      const initial = status()
      if (initialState === 'expired') initial.source.expired = true
      if (initialState === 'missing') initial.source.available = false
      if (initialState === 'no-targets') initial.targets = []
      let current = initial
      mockInvoke.mockImplementation(async cmd => cmd === STATUS ? current : results)
      const s = await loadState()
      await s.autoSyncWslAuthOnEnter()
      expect(calls(SYNC)).toHaveLength(0)

      current = status()
      await s.autoSyncWslAuthOnEnter()
      expect(calls(STATUS)).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      await s.autoSyncWslAuthOnEnter()
      expect(calls(SYNC)).toHaveLength(1)
      expect(s.wslAuthStatus.value?.source).toEqual(current.source)
      expect(useToastStore().toast.show).toBe(false)
    })
  }

  for (const oldSyncFails of [false, true]) {
    it(`在途同步${oldSyncFails ? '失败' : '成功'}后合并切号请求，用最新账号补同步`, async () => {
      const first = deferred<CodexWslAuthSyncResult[]>()
      let currentAccount = 'a'
      const writtenAccounts: string[] = []
      mockInvoke.mockImplementation(async cmd => {
        if (cmd === STATUS) return status()
        if (cmd === SYNC) {
          writtenAccounts.push(currentAccount)
          return writtenAccounts.length === 1 ? first.promise : results
        }
      })
      const s = await loadState()
      const pending = s.syncWslAuth({ silent: true })
      currentAccount = 'b'
      await s.autoSyncWslAuthAfterSwitch()
      currentAccount = 'c'
      await s.autoSyncWslAuthAfterSwitch()
      expect(writtenAccounts).toEqual(['a'])
      if (oldSyncFails) first.reject(new Error('synthetic failure'))
      else first.resolve(results)
      await pending
      await vi.waitFor(() => expect(writtenAccounts).toEqual(['a', 'c']))
      await vi.waitFor(() => expect(s.wslAuthSyncing.value).toBe(false))
      expect(useToastStore().toast.show).toBe(false)
    })
  }

  it('切号查询状态期间开始了手动同步，也会在其结束后补跑', async () => {
    const query = deferred<CodexWslAuthStatus>()
    const first = deferred<CodexWslAuthSyncResult[]>()
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === STATUS) return calls(STATUS).length === 1 ? query.promise : status()
      if (cmd === SYNC) return calls(SYNC).length === 1 ? first.promise : results
    })
    const s = await loadState()
    const switched = s.autoSyncWslAuthAfterSwitch()
    const pending = s.syncWslAuth({ silent: true })
    query.resolve(status())
    await switched
    first.resolve(results)
    await pending
    await vi.waitFor(() => expect(calls(SYNC)).toHaveLength(2))
    await vi.waitFor(() => expect(s.wslAuthSyncing.value).toBe(false))
  })

  for (const method of ['autoSyncWslAuthOnEnter', 'autoSyncWslAuthAfterSwitch'] as const) {
    it(`${method} 查询被设置页查询超越时，仍执行本次自动同步`, async () => {
      const automatic = deferred<CodexWslAuthStatus>()
      mockInvoke.mockImplementation(async cmd => {
        if (cmd === STATUS) return calls(STATUS).length === 1 ? automatic.promise : status()
        return results
      })
      const s = await loadState()
      const pending = s[method]()
      await s.loadWslAuthStatus()
      automatic.resolve(status())
      await pending
      expect(calls(SYNC)).toHaveLength(1)
    })
  }

  for (const method of ['loadWslAuthStatus', 'autoSyncWslAuthOnEnter', 'autoSyncWslAuthAfterSwitch'] as const) {
    it(`${method} 查询期间锁屏后，旧状态不回填也不启动同步`, async () => {
      const query = deferred<CodexWslAuthStatus>()
      mockInvoke.mockImplementation(() => query.promise)
      const s = await loadState()
      s.wslAuthStatus.value = status()
      s.wslAuthResults.value = results
      s.wslAuthStatusError.value = 'old error'
      const pending = s[method]()
      s.clearCodexSession()
      query.resolve(status())
      await pending
      expect(s.wslAuthStatus.value).toBeNull()
      expect(s.wslAuthResults.value).toBeNull()
      expect(s.wslAuthStatusError.value).toBe('')
      expect(s.wslAuthStatusBusy.value).toBe(false)
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })
  }

  for (const enabled of [false, true]) {
    it(`保存自动同步为 ${enabled} 后，旧状态回包不会覆盖开关或误触发同步`, async () => {
      const query = deferred<CodexWslAuthStatus>()
      const initial = { ...status(), autoSync: !enabled }
      mockInvoke.mockImplementation(async cmd => cmd === STATUS ? query.promise : undefined)
      const s = await loadState()
      s.wslAuthStatus.value = initial
      const pending = s.autoSyncWslAuthAfterSwitch()
      await s.saveWslAuthAutoSync(enabled)
      mockInvoke.mockImplementation(async cmd => cmd === STATUS ? { ...status(), autoSync: enabled } : results)
      query.resolve(initial)
      await pending
      expect(s.wslAuthStatus.value?.autoSync).toBe(enabled)
      expect(calls(SYNC)).toHaveLength(enabled ? 1 : 0)
    })
  }

  for (const fails of [false, true]) {
    it(`同步${fails ? '失败' : '成功'}回包晚于锁屏，不回填、不弹提示、不执行排队任务`, async () => {
      const first = deferred<CodexWslAuthSyncResult[]>()
      mockInvoke.mockImplementation(() => first.promise)
      const s = await loadState()
      const pending = s.syncWslAuth()
      await s.autoSyncWslAuthAfterSwitch()
      s.clearCodexSession()
      if (fails) first.reject(new Error('synthetic failure'))
      else first.resolve(results)
      await pending
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(s.wslAuthStatus.value).toBeNull()
      expect(s.wslAuthResults.value).toBeNull()
      expect(s.wslAuthStatusError.value).toBe('')
      expect(s.wslAuthSyncing.value).toBe(false)
      expect(useToastStore().toast.show).toBe(false)
    })
  }

  it('同步完成后的状态刷新期间锁屏，不回填缓存或显示完成提示', async () => {
    const query = deferred<CodexWslAuthStatus>()
    mockInvoke.mockImplementation(async cmd => cmd === STATUS ? query.promise : results)
    const s = await loadState()
    const pending = s.syncWslAuth()
    await vi.waitFor(() => expect(calls(STATUS)).toHaveLength(1))
    s.clearCodexSession()
    query.resolve(status())
    await pending
    expect(s.wslAuthStatus.value).toBeNull()
    expect(s.wslAuthResults.value).toBeNull()
    expect(useToastStore().toast.show).toBe(false)
  })

  it('解锁后的切号会等旧同步结束再执行，不与旧会话并发写入', async () => {
    const first = deferred<CodexWslAuthSyncResult[]>()
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === STATUS) return status()
      if (cmd === SYNC) return calls(SYNC).length === 1 ? first.promise : results
    })
    const s = await loadState()
    const pending = s.syncWslAuth({ silent: true })
    s.clearCodexSession()
    await s.autoSyncWslAuthAfterSwitch()
    expect(calls(SYNC)).toHaveLength(1)
    first.resolve(results)
    await pending
    await vi.waitFor(() => expect(calls(SYNC)).toHaveLength(2))
    await vi.waitFor(() => expect(s.wslAuthSyncing.value).toBe(false))
    expect(s.wslAuthResults.value).toEqual(results)
  })

  it('切号修复期间锁屏，不在修复返回后发起 WSL 同步查询', async () => {
    const repair = deferred<unknown>()
    let providerReads = 0
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_codex_history_visibility_provider') return ++providerReads === 1 ? 'openai' : 'openai_api_key'
      if (cmd === 'list_codex_accounts') return []
      if (cmd === 'codex_repair_session_visibility_for_launch_target') return repair.promise
      return null
    })
    const s = await loadState()
    const pending = s.switchTo('synthetic-account')
    await vi.waitFor(() => expect(calls('codex_repair_session_visibility_for_launch_target')).toHaveLength(1))
    s.clearCodexSession()
    repair.resolve({})
    expect(await pending).toBe(false)
    expect(calls(STATUS)).toHaveLength(0)
    expect(calls(SYNC)).toHaveLength(0)
  })
})
