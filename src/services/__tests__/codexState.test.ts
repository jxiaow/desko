import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '../../stores/toast'
import type { CodexAccount } from '../api/codex'

const mockInvoke = vi.mocked(invoke)

describe('Codex 锁屏与异步请求', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('锁屏清掉账号、会话、token 统计、留底与用量，重新进入需要重新读取', async () => {
    const s = await loadState()
    s.accounts.value = [account()]
    s.sessions.value = [sessionRec('a')]
    s.sessionTotalCount.value = 1
    s.sessionTokens.value = { a: { sessionId: 'a', totalTokens: 1 } as any }
    s.sessionsLoaded.value = true
    s.trashLoaded.value = true
    s.recycledLoaded.value = true
    s.sessionQuery.value = '内容'
    s.sessionSearchMode.value = 'content'
    s.usageReport.value = usageReportFixture()
    s.clearCodexSession()
    expect(s.accounts.value).toEqual([])
    expect(s.sessions.value).toEqual([])
    expect(s.sessionTotalCount.value).toBe(0)
    expect(s.sessionTokens.value).toEqual({})
    expect(s.usageReport.value).toBeNull()
    expect(s.sessionsLoaded.value || s.trashLoaded.value || s.recycledLoaded.value).toBe(false)
    expect(s.sessionQuery.value).toBe('')
    expect(s.sessionSearchMode.value).toBe('title')
  })

  for (const method of ['loadSessions', 'loadTrash', 'loadRecycled', 'loadUsage'] as const) {
    it(`${method} 在锁屏后返回，不得重新填回旧会话数据`, async () => {
      const s = await loadState()
      let finish!: (result: any) => void
      mockInvoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
      const request = s[method]()
      s.clearCodexSession()
      finish(method === 'loadUsage' ? usageReportFixture() : [sessionRec('old')])
      await request
      expect(s.sessions.value).toEqual([])
      expect(s.trashSessions.value).toEqual([])
      expect(s.recycledAccounts.value).toEqual([])
      expect(s.usageReport.value).toBeNull()
    })
  }

  for (const method of ['restoreTrashedSession', 'restoreRecycledAccount'] as const) {
    it(`${method} 在锁屏后完成，不再发起读取或重新填回账号会话`, async () => {
      const s = await loadState()
      let finish!: (value: any) => void
      mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const request = s[method]('synthetic-id')
      s.clearCodexSession()
      mockInvoke.mockResolvedValue([sessionRec('old')])
      finish({ message: 'restored' })
      expect(await request).toBe('')
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(s.accounts.value).toEqual([])
      expect(s.sessions.value).toEqual([])
      expect(s.sessionsLoaded.value).toBe(false)
    })
  }

  it('普通账号操作只占忙碌状态，不创建切号事务', async () => {
    const s = await loadState()
    let finish!: () => void
    const request = s.runOn('a', () => new Promise<void>(resolve => { finish = resolve }), '')
    expect(s.busyId.value).toBe('a')
    expect(s.switchingId.value).toBe('')
    expect(mockInvoke).not.toHaveBeenCalledWith('codex_cancel_account_switch', expect.anything())
    mockInvoke.mockImplementation(async cmd => cmd === 'list_codex_accounts' ? [] : null)
    finish()
    await request
  })

  it('正文搜索传 contentQuery，标题搜索保持原来的 titleQuery 契约', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValue([])
    s.sessionQuery.value = '  修复记录  '
    s.sessionSearchMode.value = 'content'
    await s.loadSessions()
    expect(mockInvoke).toHaveBeenCalledWith('codex_list_sessions_across_instances', { titleQuery: null, contentQuery: '修复记录' })
  })

  it('配额刷新在锁屏后完成，不弹提示、不重读账号', async () => {
    const s = await loadState()
    let finish!: (value: number) => void
    mockInvoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const request = s.refreshQuotas(['a'])
    s.clearCodexSession()
    finish(1)
    await request
    expect(useToastStore().toast.show).toBe(false)
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'list_codex_accounts')).toBe(false)
  })

  it('锁屏之后返回的路径不能重新写回缓存', async () => {
    const s = await loadState()
    let finish!: (value: unknown) => void
    mockInvoke.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const request = s.loadStoragePaths()
    s.clearCodexSession()
    finish({ authPath: 'old-profile/auth.json' })
    await request
    expect(s.storagePaths.value).toBeNull()
  })

  it('切号第二次 provider 读取期间锁屏，不能继续刷新列表或显示修复提示', async () => {
    const s = await loadState()
    let finish!: (value: string) => void
    let reads = 0
    mockInvoke.mockImplementation(async cmd => {
      if (cmd === 'get_codex_history_visibility_provider') {
        if (++reads === 1) return 'openai'
        return new Promise(resolve => { finish = resolve })
      }
      return account()
    })
    const request = s.switchTo('a', { restartWindows: false, applyToWsl: false })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    s.clearCodexSession()
    finish('openai_api_key')
    await request
    expect(useToastStore().toast.show).toBe(false)
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'list_codex_accounts' || cmd === 'codex_repair_session_visibility_for_launch_target')).toBe(false)
  })
})

/** codexState 是模块级单例（列表、阈值、定时器都挂在模块上），每条用例重新加载 */
async function loadState() {
  vi.resetModules()
  return await import('../codexState')
}

/** 后端按 key 答复设置项；表里没有的键回空串，等同于「这个键从没写过」 */
function answerSettings(map: Record<string, string>) {
  mockInvoke.mockImplementation(async (cmd: string, args: any) => {
    if (cmd === 'get_setting') return map[args.key] ?? ''
    if (cmd === 'list_codex_accounts') return []
    if (cmd === 'get_current_codex_account') return null
    if (cmd === 'storage_paths') return {}
    return undefined
  })
}

function settingWrites(): Array<[string, string]> {
  return mockInvoke.mock.calls
    .filter(([cmd]) => cmd === 'set_setting')
    .map(([, args]: any) => [args.key, args.value])
}

function account(over: Partial<CodexAccount> = {}): CodexAccount {
  return {
    id: 'a1',
    email: 'low@e2e.dev',
    auth_mode: 'oauth',
    requires_reauth: false,
    created_at: 0,
    last_used: 0,
    quota: { hourly_percentage: 18, hourly_reset_time: null, weekly_percentage: 90, weekly_reset_time: null },
    ...over,
  } as CodexAccount
}

describe('codexState 配额自动刷新', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('读回来的非法值退回默认档，不认的间隔一律当默认', async () => {
    answerSettings({ codex_quota_auto_refresh_minutes: '7', codex_quota_alert_threshold: '10' })
    const s = await loadState()
    await s.loadQuotaSettings()
    expect(s.quotaRefreshMinutes.value).toBe(10)
    expect(s.quotaAlertThreshold.value).toBe(10)
  })

  it('保存写的是这两个键，值为字符串', async () => {
    answerSettings({})
    const s = await loadState()
    await s.saveQuotaSettings(30, 30)
    expect(settingWrites()).toEqual([
      ['codex_quota_auto_refresh_minutes', '30'],
      ['codex_quota_alert_threshold', '30'],
    ])
    expect(s.quotaRefreshMinutes.value).toBe(30)
  })

  it('预警只盯当前账号，同一档只报一次', async () => {
    answerSettings({})
    const s = await loadState()
    const toast = useToastStore()
    s.accounts.value = [account({ id: 'other', email: 'other@e2e.dev' }), account()]
    s.currentId.value = 'a1'

    s.checkQuotaAlert()
    expect(toast.toast.message).toMatch(/low@e2e.dev 剩余 18%/)

    // 同一档位再来一轮刷新不该重复轰炸
    s.checkQuotaAlert()
    expect(toast.toast.message).toMatch(/low@e2e.dev 剩余 18%/)
    const before = mockInvoke.mock.calls.length
    s.checkQuotaAlert()
    expect(mockInvoke.mock.calls.length).toBe(before)

    // 没设当前账号时无从判断，一条都不报
    s.currentId.value = ''
    s.checkQuotaAlert()
    expect(toast.toast.message).toMatch(/剩余 18%/)
  })

  it('预警忽略不存在的窗口，Credits 耗尽时仍提示', async () => {
    const s = await loadState()
    const toast = useToastStore()
    s.currentId.value = 'a1'
    const show = vi.spyOn(toast, 'showToast')
    s.accounts.value = [account({ quota: {
      hourly_percentage: 0, weekly_percentage: 80, hourly_reset_time: null, weekly_reset_time: null,
      hourly_window_present: false, weekly_window_present: true,
    } })]
    s.checkQuotaAlert()
    expect(show).not.toHaveBeenCalled()
    s.accounts.value[0]!.quota = {
      hourly_percentage: 100, weekly_percentage: 100, hourly_reset_time: null, weekly_reset_time: null,
      hourly_window_present: false, weekly_window_present: false,
      raw_data: { spend_control: { individual_limit: { limit: 100, remaining: 0 } } },
    }
    s.checkQuotaAlert()
    expect(show).toHaveBeenCalledWith(expect.stringContaining('剩余 0%'), 'error')
  })

  it('进页那一轮静默补一次配额，60 s 内再进不重复打网络', async () => {
    answerSettings({})
    const s = await loadState()
    await s.loadQuotaSettings()
    const toast = useToastStore()
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'refresh_codex_quotas_batch') return 1
      if (cmd === 'list_codex_accounts') return [account()]
      if (cmd === 'get_current_codex_account') return account()
      return undefined
    })
    s.accounts.value = [account()]

    const batchCalls = () => callsOf('refresh_codex_quotas_batch').length
    await s.refreshQuotasOnEnter()
    expect(batchCalls()).toBe(1)
    // 静默：不进页不该播「配额已刷新」，但低额度的事实仍然要说出来
    expect(toast.toast.message).toMatch(/low@e2e.dev 剩余 18%/)

    // 在页签间来回切会重新挂载，闸门得把第二次拦住
    await s.refreshQuotasOnEnter()
    expect(batchCalls()).toBe(1)
  })

  it('自动刷新关掉时进页不打网络，没有账号也不打', async () => {
    answerSettings({ codex_quota_auto_refresh_minutes: '0' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]
    await s.refreshQuotasOnEnter()
    expect(callsOf('refresh_codex_quotas_batch')).toHaveLength(0)

    const t = await loadState()
    t.accounts.value = []
    await t.refreshQuotasOnEnter()
    expect(callsOf('refresh_codex_quotas_batch')).toHaveLength(0)
  })

  it('定时器按间隔跑批量刷新，最后一个持有者释放即停', async () => {
    vi.useFakeTimers()
    answerSettings({ codex_quota_auto_refresh_minutes: '5' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]

    const batchCalls = () =>
      mockInvoke.mock.calls.filter(([cmd]) => cmd === 'refresh_codex_quotas_batch').length
    s.acquireQuotaTicker('codex-page')
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(batchCalls()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(batchCalls()).toBe(1)

    s.releaseQuotaTicker('codex-page')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(batchCalls()).toBe(1)
  })

  it('挂件还持有定时器时，Codex 页离开不停表', async () => {
    vi.useFakeTimers()
    answerSettings({ codex_quota_auto_refresh_minutes: '5' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]

    const batchCalls = () =>
      mockInvoke.mock.calls.filter(([cmd]) => cmd === 'refresh_codex_quotas_batch').length
    s.acquireQuotaTicker('codex-page')
    s.acquireQuotaTicker('codex-hud')
    s.releaseQuotaTicker('codex-page')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(batchCalls()).toBe(1)

    s.releaseQuotaTicker('codex-hud')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(batchCalls()).toBe(1)
  })

  it('间隔为 0 不起定时器，有持有者时改成正数当场按新值重启', async () => {
    vi.useFakeTimers()
    answerSettings({ codex_quota_auto_refresh_minutes: '0' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]

    const batchCalls = () =>
      mockInvoke.mock.calls.filter(([cmd]) => cmd === 'refresh_codex_quotas_batch').length
    s.syncQuotaTicker()
    s.acquireQuotaTicker('codex-page')
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(batchCalls()).toBe(0)

    await s.saveQuotaSettings(5, 20)
    s.syncQuotaTicker()
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(batchCalls()).toBe(1)
  })
})

const LIST_CMD = 'codex_list_sessions_across_instances'
const STATS_CMD = 'codex_get_session_token_stats_across_instances'

const sessionRec = (id: string) => ({
  sessionId: id,
  title: id,
  cwd: 'C:\\ws\\demo',
  projectName: 'demo',
  updatedAt: 1,
  locationCount: 1,
  locations: [],
  sessionKind: 'conversation',
})

const callsOf = (cmd: string) => mockInvoke.mock.calls.filter(([c]) => c === cmd)

describe('codexState 会话档', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('保留未搜索的会话总数，迟到的搜索结果不覆盖总数，清空搜索后重新更新', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a'), sessionRec('b')] : [])
    await s.loadSessions()
    expect(s.sessionTotalCount.value).toBe(2)
    s.sessionQuery.value = 'a'
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a')] : [])
    await s.loadSessions()
    expect(s.sessionTotalCount.value).toBe(2)
    let finish!: (result: unknown) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = s.loadSessions()
    s.sessionQuery.value = ''
    finish([])
    await request
    expect(s.sessions.value).toEqual([])
    expect(s.sessionTotalCount.value).toBe(2)
    await s.loadSessions()
    expect(s.sessionTotalCount.value).toBe(1)
  })

  it('删除搜索命中的会话时，总数同步减少，其他未命中的会话仍计入总数', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a'), sessionRec('b')] : [])
    await s.loadSessions()
    s.sessionQuery.value = 'a'
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a')] : cmd === STATS_CMD ? [] : { message: '已删除' })
    await s.loadSessions()
    await s.moveSessionToTrash('a')
    expect(s.sessions.value).toEqual([])
    expect(s.sessionTotalCount.value).toBe(1)
  })

  it('首次按更新时间展开最近项目，手动收起后刷新保留，锁屏后重新选择最近项目', async () => {
    const s = await loadState()
    const list = [
      { ...sessionRec('old-a'), cwd: 'C:\\a', updatedAt: 1 },
      { ...sessionRec('recent-b'), cwd: 'C:\\b', updatedAt: 10 },
      { ...sessionRec('recent-a'), cwd: 'C:\\a', updatedAt: 10 },
    ]
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? list : [])
    await s.loadSessions()
    expect([...s.sessionOpenGroups.value]).toEqual(['C:\\b'])
    s.sessionOpenGroups.value = new Set()
    await s.loadSessions({ background: true })
    expect(s.sessionOpenGroups.value.size).toBe(0)
    s.clearCodexSession()
    await s.loadSessions()
    expect([...s.sessionOpenGroups.value]).toEqual(['C:\\b'])
  })

  it('空列表或读取失败后恢复目录，首次展开最近的未知目录组', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValueOnce([])
    await s.loadSessions()
    mockInvoke.mockRejectedValueOnce('目录暂不可读')
    await s.loadSessions()
    expect(s.sessionOpenGroups.value.size).toBe(0)
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [
      { ...sessionRec('older'), cwd: 'C:\\older', updatedAt: 1 },
      { ...sessionRec('newer'), cwd: '  ', updatedAt: 2 },
    ] : [])
    await s.loadSessions()
    expect([...s.sessionOpenGroups.value]).toEqual(['∅'])
  })

  it('搜索和迟到的搜索结果不初始化展开态，清空后按全量目录选择最近项目', async () => {
    const s = await loadState()
    s.sessionQuery.value = '命中'
    let finish!: (value: unknown) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const request = s.loadSessions()
    s.sessionQuery.value = ''
    mockInvoke.mockResolvedValue([])
    finish([{ ...sessionRec('matched'), cwd: 'C:\\matched' }])
    await request
    expect(s.sessionOpenGroups.value.size).toBe(0)
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [
      { ...sessionRec('recent'), cwd: 'C:\\recent', updatedAt: 2 },
      { ...sessionRec('matched'), cwd: 'C:\\matched' },
    ] : [])
    await s.loadSessions()
    expect([...s.sessionOpenGroups.value]).toEqual(['C:\\recent'])
  })

  it('后台刷新保留旧读数直到新统计到手，目录暂不可读也不清空现有会话', async () => {
    const s = await loadState()
    s.sessions.value = [sessionRec('a')]
    s.sessionsLoaded.value = true
    s.sessionTokens.value = { a: { sessionId: 'a', totalTokens: 11 } as any }
    let finish!: (result: any) => void
    mockInvoke.mockImplementation(cmd => cmd === LIST_CMD ? Promise.resolve([sessionRec('a')]) : new Promise(resolve => { finish = resolve }))
    await s.loadSessions({ background: true })
    expect(s.sessionTokens.value.a.totalTokens).toBe(11)
    finish([{ sessionId: 'a', totalTokens: 22 }])
    await vi.waitFor(() => expect(s.sessionTokens.value.a.totalTokens).toBe(22))
    mockInvoke.mockRejectedValue('目录暂不可读')
    await s.loadSessions({ background: true })
    expect(s.sessions.value.map(item => item.sessionId)).toEqual(['a'])
    expect(s.sessionsLoaded.value).toBe(true)
    expect(s.sessionsError.value).toBe('目录暂不可读')
    expect(s.sessionTokens.value.a.totalTokens).toBe(22)
  })

  it('刷新前发出的旧统计请求不能覆盖新一轮数字', async () => {
    const s = await loadState()
    let finishOld!: (result: any) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const old = s.loadSessionTokens(['a'])
    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a')] : [{ sessionId: 'a', totalTokens: 22 }])
    await s.loadSessions({ background: true })
    await Promise.resolve()
    finishOld([{ sessionId: 'a', totalTokens: 11 }])
    await old
    expect(s.sessionTokens.value.a.totalTokens).toBe(22)
  })

  it('后台扫描期间删除会话，迟到的列表不能重新显示已删除会话', async () => {
    const s = await loadState()
    s.sessions.value = [sessionRec('a')]
    s.sessionsLoaded.value = true
    let finishOld!: (result: any) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    const old = s.loadSessions({ background: true })
    mockInvoke.mockResolvedValueOnce({ message: '已删除' })
    await s.moveSessionToTrash('a')
    expect(s.sessions.value).toEqual([])
    mockInvoke.mockResolvedValue([])
    finishOld([sessionRec('a')])
    await old
    expect(s.sessions.value).toEqual([])
    expect(callsOf(LIST_CMD)).toHaveLength(2)
  })

  it('读不到目录：清空列表、留错误、标记没扫过；重试成功即复位', async () => {
    const s = await loadState()
    mockInvoke.mockRejectedValueOnce('官方会话目录不可读')
    await s.loadSessions()
    expect(s.sessions.value).toEqual([])
    expect(s.sessionsError.value).toBe('官方会话目录不可读')
    expect(s.sessionsLoaded.value).toBe(false)

    mockInvoke.mockImplementation(async cmd => cmd === LIST_CMD ? [sessionRec('a')] : [])
    await s.loadSessions()
    expect(s.sessionsError.value).toBe('')
    expect(s.sessionsLoaded.value).toBe(true)
    expect(s.sessions.value.map((r: any) => r.sessionId)).toEqual(['a'])
  })

  it('全扫在途时又改搜索词：本轮结束立刻按最新词补扫，新词不被吞掉', async () => {
    const s = await loadState()
    const gates: Array<(v: unknown) => void> = []
    mockInvoke.mockImplementation(() => new Promise((res) => gates.push(res)))

    const first = s.loadSessions()
    s.sessionQuery.value = '查配额'
    const queued = s.loadSessions()
    expect(callsOf(LIST_CMD)).toHaveLength(1)

    gates[0]([])
    // 补扫是在首轮 finally 之后同步发起的，等一个宏任务让它排队
    while (gates.length < 2) await new Promise((r) => setTimeout(r, 0))
    gates[1]([])
    await Promise.all([first, queued])

    expect(callsOf(LIST_CMD).map(([, a]: any) => a.titleQuery)).toEqual([null, '查配额'])
    expect(s.sessionsBusy.value).toBe(false)
  })

  it('列表一到手就按全部 id 预取 token，不等展开；扫失败不预取', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === LIST_CMD ? [sessionRec('a'), sessionRec('b')] : [])
    await s.loadSessions()
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b']])

    const f = await loadState()
    f.sessionsLoaded.value = false
    const before = callsOf(STATS_CMD).length
    mockInvoke.mockRejectedValueOnce('官方会话目录不可读')
    await f.loadSessions()
    expect(callsOf(STATS_CMD)).toHaveLength(before)
  })

  it('展开期间共享在途统计，失败可重试且空记录有完成状态', async () => {
    const s = await loadState()
    let reject!: (error: unknown) => void
    mockInvoke.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const request = s.loadSessionTokens(['a', 'b'])
    await s.loadSessionTokens(['a'])
    expect(callsOf(STATS_CMD)).toHaveLength(1)
    expect([...s.sessionTokensPending.value]).toEqual(['a', 'b'])
    reject('目录不可读')
    await request
    expect(s.sessionTokensError.value).toBe('目录不可读')
    expect(s.sessionTokensLoaded.value.size).toBe(0)
    expect(s.sessionTokensPending.value.size).toBe(0)
    mockInvoke.mockResolvedValueOnce([])
    await s.loadSessionTokens(['a', 'b'])
    expect(s.sessionTokensError.value).toBe('')
    expect([...s.sessionTokensLoaded.value]).toEqual(['a', 'b'])
  })

  it('token 统计记住没有记录的会话，刷新时全量更新并保留旧读数', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === STATS_CMD
        ? [{ sessionId: 'a', inputTokens: 10, cachedInputTokens: 6, cacheWriteInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 11 }]
        : [sessionRec('a'), sessionRec('b')],
    )

    await s.loadSessionTokens(['a', 'b'])
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b']])

    await s.loadSessionTokens(['a'])
    expect(callsOf(STATS_CMD)).toHaveLength(1)
    await s.loadSessionTokens(['a', 'b'])
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b']])

    await s.reloadSessions()
    // 刷新主动更新全部会话，负缓存也会重新读取。
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b'], ['a', 'b']])
    // 预取不 await（别拿数字拖慢首屏），落库要等一个宏任务
    await new Promise((r) => setTimeout(r, 0))
    expect(s.sessionTokens.value.a.totalTokens).toBe(11)
    expect(s.sessionTokens.value.a.cachedInputTokens).toBe(6)
  })
})

const TRASH_CMD = 'codex_list_trashed_sessions_across_instances'
const MOVE_CMD = 'codex_move_sessions_to_trash_across_instances'
const RESTORE_CMD = 'codex_restore_sessions_from_trash_across_instances'
const DELETE_CMD = 'codex_delete_trashed_sessions_across_instances'
const EMPTY_CMD = 'codex_empty_session_trash_across_instances'

const trashRec = (id: string) => ({
  sessionId: id,
  title: `留底 ${id}`,
  cwd: 'C:\ws\demo',
  deletedAt: 1_730_000_000,
  sizeBytes: 2048,
  locationCount: 1,
  locations: [],
})

describe('codexState 会话回收站', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('移进回收站：列表与 token 缓存当场摘掉这条，留底清单作废待重扫', async () => {
    const s = await loadState()
    s.sessions.value = [sessionRec('a'), sessionRec('b')] as any
    s.sessionTokens.value = { a: { totalTokens: 1 } as any, b: { totalTokens: 2 } as any }
    s.trashLoaded.value = true
    mockInvoke.mockImplementation(async (cmd: string) =>
      cmd === MOVE_CMD ? { requestedSessionCount: 1, trashedSessionCount: 1, trashedInstanceCount: 1, trashDirs: [], message: '已将 1 条会话移到回收站' } : [],
    )

    expect(await s.moveSessionToTrash('a')).toBe('已将 1 条会话移到回收站')
    expect(s.sessions.value.map((r: any) => r.sessionId)).toEqual(['b'])
    expect(Object.keys(s.sessionTokens.value)).toEqual(['b'])
    expect(s.trashLoaded.value).toBe(false)
    expect(callsOf(MOVE_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a']])
  })

  it('读不到留底清单：错误块与重试复位，不读成「回收站是空的」', async () => {
    const s = await loadState()
    s.trashSessions.value = [trashRec('a')] as any
    mockInvoke.mockRejectedValueOnce('回收站目录不可读')
    await s.loadTrash()
    expect(s.trashSessions.value).toEqual([])
    expect(s.trashError.value).toBe('回收站目录不可读')
    expect(s.trashLoaded.value).toBe(false)

    mockInvoke.mockResolvedValueOnce([trashRec('a')])
    await s.loadTrash()
    expect(s.trashError.value).toBe('')
    expect(s.trashLoaded.value).toBe(true)
    expect(s.trashSessions.value.map((r: any) => r.sessionId)).toEqual(['a'])
  })

  it('在途时再点刷新不并发扫目录', async () => {
    const s = await loadState()
    let release: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(
      () => new Promise((res) => { release = res }),
    )
    const first = s.loadTrash()
    await s.loadTrash()
    expect(callsOf(TRASH_CMD)).toHaveLength(1)
    release([])
    await first
  })

  it('恢复：留底行消失并按全量重扫官方目录', async () => {
    const s = await loadState()
    s.trashSessions.value = [trashRec('a'), trashRec('b')] as any
    s.sessions.value = [sessionRec('c')] as any
    s.sessionTokens.value = { c: { totalTokens: 3 } as any }
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === RESTORE_CMD) return { requestedSessionCount: 1, restoredSessionCount: 1, restoredInstanceCount: 1, message: '已恢复 1 条会话' }
      if (cmd === LIST_CMD) return [sessionRec('a')]
      return []
    })

    expect(await s.restoreTrashedSession('a')).toBe('已恢复 1 条会话')
    expect(s.trashSessions.value.map((r: any) => r.sessionId)).toEqual(['b'])
    // 重扫是「刷新」口径：token 缓存丢掉，列表出来后按新全量预取
    expect(callsOf(LIST_CMD)).toHaveLength(1)
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a']])
    expect(Object.keys(s.sessionTokens.value)).toEqual([])
  })

  it('彻底删除与清空都只动留底，不碰官方目录', async () => {
    const s = await loadState()
    s.trashSessions.value = [trashRec('a'), trashRec('b')] as any
    const listCalls = callsOf(LIST_CMD).length
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === DELETE_CMD) return { requestedSessionCount: 1, deletedSessionCount: 1, deletedEntryCount: 1, freedSizeBytes: 2048, message: '已永久删除 1 条回收站会话' }
      if (cmd === EMPTY_CMD) return { requestedSessionCount: 1, deletedSessionCount: 1, deletedEntryCount: 1, freedSizeBytes: 4096, message: '已清空 Codex 会话回收站' }
      return []
    })

    expect(await s.deleteTrashedSession('a')).toBe('已永久删除 1 条回收站会话')
    expect(s.trashSessions.value.map((r: any) => r.sessionId)).toEqual(['b'])
    expect(await s.emptySessionTrash()).toBe('已清空 Codex 会话回收站')
    expect(s.trashSessions.value).toEqual([])
    expect(callsOf(LIST_CMD)).toHaveLength(listCalls)
  })
})

const RECYCLED_LIST_CMD = 'list_codex_recycled_accounts'
const RECYCLED_RESTORE_CMD = 'restore_codex_recycled_account'
const RECYCLED_DELETE_CMD = 'delete_codex_recycled_account'
const RECYCLED_EMPTY_CMD = 'empty_codex_recycle_bin'

/** 留底摘要就是磁盘快照的字段，snake_case 与账号 DTO 同口径，前端不做二次改名 */
const recycledRec = (id: string) => ({
  id,
  account_id: `acct-${id}`,
  email: `${id}@e2e.dev`,
  account_name: `留底 ${id}`,
  plan_type: 'plus',
  deleted_at: 1_730_000_000,
})

describe('codexState 账号留底', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('读不到留底清单：清空、留错、标记没扫过；重试成功即复位', async () => {
    const s = await loadState()
    s.recycledAccounts.value = [recycledRec('a')] as any
    mockInvoke.mockRejectedValueOnce('账号留底目录不可读')
    await s.loadRecycled()
    expect(s.recycledAccounts.value).toEqual([])
    expect(s.recycledError.value).toBe('账号留底目录不可读')
    expect(s.recycledLoaded.value).toBe(false)

    // 在途时连点重试只扫一次目录
    const scanned = callsOf(RECYCLED_LIST_CMD).length
    let release: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(() => new Promise((res) => { release = res }))
    const first = s.loadRecycled()
    await s.loadRecycled()
    expect(callsOf(RECYCLED_LIST_CMD)).toHaveLength(scanned + 1)
    release([recycledRec('a')])
    await first
    expect(s.recycledError.value).toBe('')
    expect(s.recycledLoaded.value).toBe(true)
    expect(s.recycledAccounts.value.map((r: any) => r.id)).toEqual(['a'])
  })

  it('恢复：留底行当场摘掉，账号页按全量重读——不然只是看着像恢复了', async () => {
    const s = await loadState()
    s.recycledAccounts.value = [recycledRec('a'), recycledRec('b')] as any
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_codex_accounts') return [account({ id: 'a' })]
      if (cmd === 'get_current_codex_account') return null
      return undefined
    })

    expect(await s.restoreRecycledAccount('a')).toBe('已恢复到账号列表')
    expect(callsOf(RECYCLED_RESTORE_CMD).map(([, x]: any) => x.recycleId)).toEqual(['a'])
    expect(s.recycledAccounts.value.map((r: any) => r.id)).toEqual(['b'])
    expect(callsOf('list_codex_accounts')).toHaveLength(1)
    expect(s.accounts.value.map((x: any) => x.id)).toEqual(['a'])
  })

  it('彻底删除只动行、不重读账号；清空删的是刚看到的那批', async () => {
    const s = await loadState()
    s.recycledAccounts.value = [recycledRec('a'), recycledRec('b')] as any
    const listCalls = callsOf('list_codex_accounts').length
    mockInvoke.mockResolvedValue(undefined)

    expect(await s.deleteRecycledAccount('a')).toBe('账号已彻底删除')
    expect(callsOf(RECYCLED_DELETE_CMD).map(([, x]: any) => x.recycleId)).toEqual(['a'])
    expect(s.recycledAccounts.value.map((r: any) => r.id)).toEqual(['b'])
    expect(callsOf('list_codex_accounts')).toHaveLength(listCalls)

    expect(await s.emptyRecycledAccounts()).toBe('已彻底删除 1 个账号')
    expect(callsOf(RECYCLED_EMPTY_CMD).map(([, x]: any) => x.recycleIds)).toEqual([['b']])
    expect(s.recycledAccounts.value).toEqual([])

    // 清单已空还点清空：不该发网络，话也要说清楚
    expect(await s.emptyRecycledAccounts()).toBe('没有已删除的账号')
    expect(callsOf(RECYCLED_EMPTY_CMD)).toHaveLength(1)
  })
})

const USAGE_CMD = 'codex_query_session_usage'

const usageReportFixture = (totalTokens = 1000) => ({
  totals: {
    inputTokens: 700,
    cachedInputTokens: 200,
    cacheWriteInputTokens: 0,
    outputTokens: 300,
    reasoningOutputTokens: 40,
    totalTokens,
    requestCount: 3,
    estimatedCostUsd: 0.01,
    sessionCount: 2,
    fileCount: 2,
  },
  byDay: [
    {
      key: '2026-10-11',
      label: '2026-10-11',
      inputTokens: 700,
      cachedInputTokens: 200,
      outputTokens: 300,
      totalTokens,
      requestCount: 3,
      estimatedCostUsd: 0.01,
    },
  ],
  byHour: [],
  byModel: [],
  modelSessions: {},
  fromTimestamp: null,
  toTimestamp: null,
  scanMillis: 1681,
})

function usageBatchFixture(rawArgs: unknown, multiplier = 1) {
  const args = rawArgs as { fromTimestamp: number | null; toTimestamp: number; windows: Record<string, number | null> }
  const amounts: Record<string, number> = { today: 1000, week: 7000, month: 30000, all: 50000 }
  const windows = Object.fromEntries(Object.entries(args.windows).map(([key, fromTimestamp]) => [key, {
    ...usageReportFixture(amounts[key] * multiplier), fromTimestamp, toTimestamp: args.toTimestamp,
  }]))
  return { ...Object.values(windows).find(report => report.fromTimestamp === args.fromTimestamp)!, windows }
}

describe('codexState 用量档', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('今日用量直接借用用量页刚扫过的今日窗口，不再单独扫盘', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args))
    await s.loadUsage()
    expect(s.usageToday.value?.totalTokens).toBe(1000)

    await s.loadTodayUsage()
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
    expect(s.usageToday.value?.totalTokens).toBe(1000)
  })

  it('没有缓存时只查今日窗口，10 分钟内再要只读旧值', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (cmd) => cmd === USAGE_CMD ? usageReportFixture(1234) : undefined)
    await s.loadTodayUsage()
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
    expect(mockInvoke.mock.calls[0]![1]).toMatchObject({ windows: { today: expect.any(Number) } })
    expect(s.usageToday.value).toEqual({ totalTokens: 1234, estimatedCostUsd: 0.01 })

    await s.loadTodayUsage()
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
  })

  it('今日用量跨零点立即作废，不能沿用十分钟缓存', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 22, 23, 59))
      const s = await loadState()
      mockInvoke.mockResolvedValueOnce(usageReportFixture(1234))
      await s.loadTodayUsage()
      vi.setSystemTime(new Date(2026, 9, 23, 0, 1))
      let finish!: (value: unknown) => void
      mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const request = s.loadTodayUsage()
      expect(s.usageToday.value).toBeNull()
      finish(usageReportFixture(12))
      await request
      expect(callsOf(USAGE_CMD)).toHaveLength(2)
      expect(s.usageToday.value?.totalTokens).toBe(12)
    } finally { vi.useRealTimers() }
  })

  it('用量页等待挂件的在途扫描完成，不并发读取日志', async () => {
    const s = await loadState()
    let finish!: (value: unknown) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const today = s.loadTodayUsage()
    mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args))
    const usage = s.loadUsage()
    expect(s.usageBusy.value).toBe(true)
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
    finish(usageReportFixture(1234))
    await Promise.all([today, usage])
    expect(callsOf(USAGE_CMD)).toHaveLength(2)
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)
  })

  it('会话来源变化后今日汇总一起作废', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (cmd) => cmd === USAGE_CMD ? usageReportFixture(1234) : undefined)
    await s.loadTodayUsage()
    expect(s.usageToday.value?.totalTokens).toBe(1234)
    s.invalidateUsage()
    expect(s.usageToday.value).toBeNull()
    expect(s.usageTodayUpdatedAt.value).toBeNull()
  })

  it('用量扫描期间删除会话，旧报告作废并补扫最新目录', async () => {
    const s = await loadState()
    let finish!: (result: any) => void
    mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const old = s.loadUsage()
    mockInvoke.mockResolvedValueOnce({ message: '已删除' })
    await s.moveSessionToTrash('a')
    const latest = usageReportFixture()
    latest.totals.totalTokens = 0
    mockInvoke.mockResolvedValue(latest)
    finish(usageReportFixture())
    await old
    expect(s.usageReport.value!.totals.totalTokens).toBe(0)
    expect(callsOf('codex_query_session_usage')).toHaveLength(2)
  })

  const localMidnightSec = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }

  it('一次取得四个范围的同一快照，来回切换直接读缓存', async () => {
    const s = await loadState()
    mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args))
    await s.loadUsage()
    const updatedAt = s.usageUpdatedAt.value
    for (const [range, amount] of [['month', 30000], ['week', 7000], ['all', 50000], ['today', 1000], ['week', 7000]] as const) {
      await s.setUsageRange(range)
      expect(s.usageReport.value?.totals.totalTokens).toBe(amount)
      expect(s.usageReportRange.value).toBe(range)
      expect(s.usageUpdatedAt.value).toBe(updatedAt)
      expect(s.usageBusy.value).toBe(false)
    }
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
  })

  it('刷新保留报告并允许即时切换，完成后所有范围一起更新', async () => {
    const s = await loadState()
    mockInvoke.mockImplementationOnce(async (_cmd, args) => usageBatchFixture(args))
    await s.loadUsage()
    let finish!: (result: unknown) => void
    let refreshArgs: any
    mockInvoke.mockImplementationOnce((_cmd, args) => {
      refreshArgs = args
      return new Promise(resolve => { finish = resolve })
    })
    const pending = s.loadUsage()
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)
    await s.setUsageRange('week')
    expect(s.usageReport.value?.totals.totalTokens).toBe(7000)
    await s.setUsageRange('month')
    expect(s.usageReport.value?.totals.totalTokens).toBe(30000)
    expect(s.usageBusy.value).toBe(true)
    finish(usageBatchFixture(refreshArgs, 2))
    await pending
    expect(s.usageReport.value?.totals.totalTokens).toBe(60000)
    await s.setUsageRange('all')
    expect(s.usageReport.value?.totals.totalTokens).toBe(100000)
    expect(callsOf(USAGE_CMD)).toHaveLength(2)
  })

  it('首轮扫描中切换范围，直接展示批量结果中的最终范围，无需补扫', async () => {
    const s = await loadState()
    let finish!: (result: unknown) => void
    let queryArgs: any
    mockInvoke.mockImplementationOnce((_cmd, args) => {
      queryArgs = args
      return new Promise(resolve => { finish = resolve })
    })
    const pending = s.loadUsage()
    await s.setUsageRange('week')
    await s.setUsageRange('month')
    finish(usageBatchFixture(queryArgs))
    await pending
    expect(s.usageReport.value?.totals.totalTokens).toBe(30000)
    await s.setUsageRange('today')
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
  })

  it('来源变化时旧批量结果不能写入任何范围的缓存', async () => {
    const s = await loadState()
    let finish!: (result: unknown) => void
    let oldArgs: any
    mockInvoke.mockImplementationOnce((_cmd, args) => {
      oldArgs = args
      return new Promise(resolve => { finish = resolve })
    })
    mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args, 2))
    const pending = s.loadUsage()
    s.invalidateUsage()
    await s.setUsageRange('all')
    finish(usageBatchFixture(oldArgs))
    await pending
    expect(s.usageReport.value?.totals.totalTokens).toBe(100000)
    await s.setUsageRange('week')
    expect(s.usageReport.value?.totals.totalTokens).toBe(14000)
    expect(callsOf(USAGE_CMD)).toHaveLength(2)
  })

  it('锁定会清空所有缓存，锁定前的在途批量扫描也不能重新填入', async () => {
    const s = await loadState()
    mockInvoke.mockImplementationOnce(async (_cmd, args) => usageBatchFixture(args))
    await s.loadUsage()
    let finish!: (result: unknown) => void
    let oldArgs: any
    mockInvoke.mockImplementationOnce((_cmd, args) => {
      oldArgs = args
      return new Promise(resolve => { finish = resolve })
    })
    const pending = s.loadUsage()
    s.clearCodexSession()
    finish(usageBatchFixture(oldArgs))
    await pending
    expect(s.usageReport.value).toBeNull()
    mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args, 2))
    await s.setUsageRange('week')
    expect(s.usageReport.value?.totals.totalTokens).toBe(14000)
    expect(callsOf(USAGE_CMD)).toHaveLength(3)
  })

  it('跨天后全部范围也必须更新，不能复用起点未变的旧缓存', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 13, 23, 59, 59))
      const s = await loadState()
      mockInvoke.mockImplementationOnce(async (_cmd, args) => usageBatchFixture(args))
      await s.loadUsage()
      vi.setSystemTime(new Date(2026, 9, 14, 0, 0, 2))
      mockInvoke.mockImplementation(async (_cmd, args) => usageBatchFixture(args, 2))
      await s.setUsageRange('all')
      expect(s.usageReport.value?.totals.totalTokens).toBe(100000)
      await s.setUsageRange('week')
      expect(s.usageReport.value?.totals.totalTokens).toBe(14000)
      expect(callsOf(USAGE_CMD)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('WSL 自动统计在旧配置中默认开启，关闭状态可读取，修改后刷新已有用量', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValueOnce('')
    expect(await s.loadUsageAutoWsl()).toBe(true)
    mockInvoke.mockResolvedValueOnce('false')
    expect(await s.loadUsageAutoWsl()).toBe(false)
    s.usageReport.value = usageReportFixture()
    mockInvoke.mockImplementation(async cmd => cmd === USAGE_CMD ? usageReportFixture(50) : undefined)
    await s.saveUsageAutoWsl(false)
    await vi.waitFor(() => expect(s.usageReport.value?.totals.totalTokens).toBe(50))
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'codex_usage_auto_wsl', value: 'false' })
    await s.saveUsageAutoWsl(true)
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'codex_usage_auto_wsl', value: 'true' })
  })

  it('额外统计目录可读取、去重保存和清空，保存成功后刷新已有用量', async () => {
    const s = await loadState()
    const wsl = String.raw`\\wsl.localhost\Ubuntu\home\user\.codex`
    mockInvoke.mockResolvedValueOnce(JSON.stringify([wsl]))
    expect(await s.loadUsageExtraDirs()).toEqual([wsl])
    s.usageReport.value = usageReportFixture()
    mockInvoke.mockImplementation(async cmd => cmd === USAGE_CMD ? usageReportFixture(50) : undefined)
    await s.saveUsageExtraDirs([` ${wsl} `, '', wsl])
    await vi.waitFor(() => expect(s.usageReport.value?.totals.totalTokens).toBe(50))
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'codex_usage_extra_dirs', value: JSON.stringify([wsl]) })
    expect(callsOf(USAGE_CMD)).toHaveLength(1)
    await s.saveUsageExtraDirs([])
    expect(mockInvoke).toHaveBeenCalledWith('set_setting', { key: 'codex_usage_extra_dirs', value: '[]' })
  })

  it('额外目录保存失败时保留当前统计和错误，不发起重扫', async () => {
    const s = await loadState()
    s.usageReport.value = usageReportFixture()
    mockInvoke.mockRejectedValueOnce('保存失败')
    await expect(s.saveUsageExtraDirs(['/extra/.codex'])).rejects.toBe('保存失败')
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)
    expect(callsOf(USAGE_CMD)).toHaveLength(0)
  })

  for (const failed of [false, true]) {
    for (const source of ['目录', 'WSL 开关']) {
      it(`扫描期间修改${source}会补扫，旧扫描${failed ? '失败' : '成功'}均不覆盖`, async () => {
        const s = await loadState()
        let finish!: (value: unknown) => void
        let fail!: (reason: unknown) => void
        mockInvoke.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
        mockInvoke.mockImplementation(async cmd => cmd === USAGE_CMD ? usageReportFixture(50) : undefined)
        const pending = s.loadUsage()
        if (source === '目录') await s.saveUsageExtraDirs(['/extra/.codex'])
        else await s.saveUsageAutoWsl(false)
        expect(s.usageReport.value).toBeNull()
        if (failed) fail('旧目录不可访问')
        else finish(usageReportFixture())
        await pending
        expect(callsOf(USAGE_CMD)).toHaveLength(2)
        expect(s.usageReport.value?.totals.totalTokens).toBe(50)
        expect(s.usageError.value).toBe('')
      })
    }
  }

  it('默认当天零点，近 7/30 天包含今天且同档重复点不重扫，全部不带起点', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValue(usageReportFixture())

    await s.loadUsage()
    const [, firstArgs] = callsOf(USAGE_CMD)[0] as any
    expect(s.usageRange.value).toBe('today')
    expect(firstArgs.fromTimestamp).toBe(localMidnightSec())
    expect(Math.abs(firstArgs.toTimestamp - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1)

    await s.setUsageRange('month')
    expect((callsOf(USAGE_CMD)[1][1] as any).fromTimestamp).toBe(localMidnightSec() - 29 * 86_400)

    await s.setUsageRange('week')
    expect(callsOf(USAGE_CMD)).toHaveLength(3)
    const [, weekArgs] = callsOf(USAGE_CMD)[2] as any
    expect(weekArgs.fromTimestamp).toBe(localMidnightSec() - 6 * 86_400)

    // 再点同一档：账没变，不该重扫那几百 MB
    await s.setUsageRange('week')
    expect(callsOf(USAGE_CMD)).toHaveLength(3)

    await s.setUsageRange('all')
    const [, allArgs] = callsOf(USAGE_CMD)[3] as any
    expect(allArgs.fromTimestamp).toBe(null)
  })

  it('扫失败只留错误行，上一轮的数不被吞；在途时不并发重扫', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValue(usageReportFixture())
    await s.loadUsage()
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)

    mockInvoke.mockRejectedValueOnce('用量统计失败')
    await s.loadUsage()
    expect(s.usageError.value).toBe('用量统计失败')
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)

    // 错误块上的重试：成功即复位
    mockInvoke.mockResolvedValueOnce(usageReportFixture(50))
    await s.loadUsage()
    expect(s.usageError.value).toBe('')
    expect(s.usageReport.value?.totals.totalTokens).toBe(50)

    let release: (v: unknown) => void = () => {}
    mockInvoke.mockImplementation(() => new Promise((res) => { release = res }))
    s.usageBusy.value = false
    const first = s.loadUsage()
    await s.loadUsage()
    expect(callsOf(USAGE_CMD).filter(([c]) => c === USAGE_CMD)).toHaveLength(4)
    release(usageReportFixture())
    await first
  })

  for (const failed of [false, true]) {
    it(`扫描在途改范围只发布最后选中的账，旧请求${failed ? '失败' : '成功'}也不覆盖新范围`, async () => {
      const s = await loadState()
      let finish!: (value: unknown) => void
      let fail!: (reason: unknown) => void
      mockInvoke.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject }))
      mockInvoke.mockResolvedValue(usageReportFixture(50))
      const pending = s.loadUsage()
      await s.setUsageRange('week')
      await s.setUsageRange('month')
      expect(s.usageReport.value).toBeNull()
      expect(callsOf(USAGE_CMD)).toHaveLength(1)
      if (failed) fail('过时请求的错误')
      else finish(usageReportFixture(1000))
      await pending
      expect(callsOf(USAGE_CMD)).toHaveLength(2)
      expect((callsOf(USAGE_CMD)[1][1] as any).fromTimestamp).toBe(localMidnightSec() - 29 * 86_400)
      expect(s.usageReport.value?.totals.totalTokens).toBe(50)
      expect(s.usageError.value).toBe('')
      expect(s.usageBusy.value).toBe(false)
    })
  }

  it('扫描跨过本地午夜时丢弃昨天的起点，补查当天再发布', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 13, 23, 59, 59))
      const s = await loadState()
      let finish!: (value: unknown) => void
      mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      mockInvoke.mockResolvedValue(usageReportFixture(50))
      const pending = s.loadUsage()
      vi.setSystemTime(new Date(2026, 9, 14, 0, 0, 2))
      finish(usageReportFixture(1000))
      await pending
      expect(callsOf(USAGE_CMD)).toHaveLength(2)
      expect((callsOf(USAGE_CMD)[1][1] as any).fromTimestamp).toBe(localMidnightSec())
      expect(s.usageReport.value?.totals.totalTokens).toBe(50)
      expect(s.usageUpdatedAt.value).toBe(Date.now())
    } finally {
      vi.useRealTimers()
    }
  })

  it('统计截止与显示时间固定在请求开始，扫描期间的新时间不冒充数据截止', async () => {
    vi.useFakeTimers()
    try {
      const queryAt = new Date(2026, 9, 13, 12, 30, 0, 250).getTime()
      vi.setSystemTime(queryAt)
      const s = await loadState()
      let finish!: (value: unknown) => void
      mockInvoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const pending = s.loadUsage()
      expect((callsOf(USAGE_CMD)[0][1] as any).toTimestamp).toBe(Math.floor(queryAt / 1000) + 1)
      vi.setSystemTime(new Date(2026, 9, 13, 12, 45))
      finish(usageReportFixture())
      await pending
      expect(s.usageUpdatedAt.value).toBe(queryAt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('动过官方目录的两条路把图作废，只动留底的两条路不碰图', async () => {
    const s = await loadState()
    s.usageReport.value = usageReportFixture() as any
    s.sessions.value = [sessionRec('a'), sessionRec('b')] as any
    s.trashSessions.value = [trashRec('a'), trashRec('b')] as any
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === MOVE_CMD) return { requestedSessionCount: 1, trashedSessionCount: 1, trashedInstanceCount: 1, trashDirs: [], message: 'ok' }
      if (cmd === RESTORE_CMD) return { requestedSessionCount: 1, restoredSessionCount: 1, restoredInstanceCount: 1, message: 'ok' }
      if (cmd === DELETE_CMD) return { requestedSessionCount: 1, deletedSessionCount: 1, deletedEntryCount: 1, freedSizeBytes: 1, message: 'ok' }
      if (cmd === EMPTY_CMD) return { requestedSessionCount: 1, deletedSessionCount: 1, deletedEntryCount: 1, freedSizeBytes: 1, message: 'ok' }
      if (cmd === LIST_CMD) return []
      return []
    })

    await s.deleteTrashedSession('a')
    await s.emptySessionTrash()
    expect(s.usageReport.value).not.toBeNull()

    await s.moveSessionToTrash('b')
    expect(s.usageReport.value).toBeNull()
  })

  it('恢复回官方目录同样作废图，下一次进档才重扫', async () => {
    const s = await loadState()
    s.usageReport.value = usageReportFixture() as any
    s.trashSessions.value = [trashRec('a')] as any
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === RESTORE_CMD) return { requestedSessionCount: 1, restoredSessionCount: 1, restoredInstanceCount: 1, message: 'ok' }
      if (cmd === LIST_CMD) return [sessionRec('a')]
      return []
    })
    await s.restoreTrashedSession('a')
    expect(s.usageReport.value).toBeNull()
    expect(callsOf(USAGE_CMD)).toHaveLength(0)
  })
})

const DELETE_START_CMD = 'start_codex_batch_delete'
const DELETE_GET_CMD = 'get_codex_batch_delete'
const DELETE_PAUSE_CMD = 'pause_codex_batch_delete'
const DELETE_RETRY_CMD = 'retry_failed_codex_batch_delete'
const DELETE_CLEAR_CMD = 'clear_codex_batch_delete'
const JOB_ID = 'codex-delete-abc'

/** 后端那份 DTO 逐字照 commands/codex_account_commands.rs：completed 是「已处理」计数 */
const jobDto = (over: Record<string, unknown> = {}) => ({
  jobId: JOB_ID,
  status: 'running',
  total: 2,
  completed: 0,
  failed: 0,
  errors: [],
  ...over,
})

/** 作业每推进一次 store 会顺手重读账号页，这两条不给形状就把列表刷成 undefined */
function deleteAnswers(poll: unknown[]) {
  let i = 0
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === DELETE_START_CMD) return jobDto()
    if (cmd === DELETE_GET_CMD) return poll[Math.min(i++, poll.length - 1)]
    if (cmd === DELETE_PAUSE_CMD) return jobDto({ status: 'paused' })
    if (cmd === DELETE_RETRY_CMD) return jobDto({ total: 1, completed: 0, status: 'running' })
    if (cmd === 'list_codex_accounts') return []
    if (cmd === 'get_current_codex_account') return null
    return []
  })
}

describe('codexState 批量删除作业', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('空选择不发请求：后端把它吞成空 jobId，拿那个 id 轮询必撞「任务不存在」', async () => {
    vi.useFakeTimers()
    deleteAnswers([])
    const s = await loadState()
    await s.startBatchDelete([])
    await s.startBatchDelete(['  ', ''])
    expect(callsOf(DELETE_START_CMD)).toHaveLength(0)
    expect(s.batchDeleteDialogOpen.value).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(0)
    expect(s.batchDeleteJob.value).toBeNull()
  })

  it('只在 running 轮询：终态那一拍即停，账号页随计数重读', async () => {
    vi.useFakeTimers()
    deleteAnswers([jobDto({ completed: 1 }), jobDto({ completed: 2, status: 'completed' })])
    const s = await loadState()
    await s.startBatchDelete(['a1', 'a2'])
    expect(s.batchDeleteDialogOpen.value).toBe(true)
    expect(s.batchDeleteJob.value?.status).toBe('running')
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(500)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(1)
    expect(s.batchDeleteJob.value?.completed).toBe(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(s.batchDeleteJob.value?.status).toBe('completed')

    const gets = callsOf(DELETE_GET_CMD).length
    await vi.advanceTimersByTimeAsync(3000)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(gets)
    // 开局一次 + 每推进一次，账号页少的那条要当场不见
    expect(callsOf('list_codex_accounts')).toHaveLength(3)
  })

  it('暂停即停轮：停在 paused 上继续问只是白问', async () => {
    vi.useFakeTimers()
    deleteAnswers([jobDto({ completed: 1 })])
    const s = await loadState()
    await s.startBatchDelete(['a1', 'a2'])
    await vi.advanceTimersByTimeAsync(500)
    await s.pauseBatchDelete()
    expect(s.batchDeleteJob.value?.status).toBe('paused')

    const gets = callsOf(DELETE_GET_CMD).length
    await vi.advanceTimersByTimeAsync(3000)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(gets)
  })

  it('slow poll is single-flight and cannot overwrite a job while the app is locked', async () => {
    vi.useFakeTimers()
    const s = await loadState()
    let finishPoll!: (value: unknown) => void
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === DELETE_START_CMD) return jobDto()
      if (cmd === DELETE_GET_CMD) return new Promise(resolve => { finishPoll = resolve })
      return []
    })
    await s.startBatchDelete(['a1'])
    await vi.advanceTimersByTimeAsync(1500)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(1)
    s.clearCodexSession()
    finishPoll(jobDto({ completed: 1, status: 'completed' }))
    await Promise.resolve()
    expect(s.batchDeleteJob.value?.status).toBe('running')
    expect(s.batchDeleteJob.value?.completed).toBe(0)
    expect(s.batchDeleteDialogOpen.value).toBe(false)
  })

  it('rejects a second delete job without stopping the active job poller', async () => {
    vi.useFakeTimers()
    deleteAnswers([jobDto({ completed: 1 })])
    const s = await loadState()
    await s.startBatchDelete(['a1'])
    await s.startBatchDelete(['a2'])
    expect(callsOf(DELETE_START_CMD)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(callsOf(DELETE_GET_CMD)).toHaveLength(1)
    expect(s.batchDeleteJob.value?.completed).toBe(1)
  })

  it('poll started before pause cannot overwrite paused status', async () => {
    vi.useFakeTimers()
    const s = await loadState()
    let finishPoll!: (value: unknown) => void
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === DELETE_START_CMD) return jobDto()
      if (cmd === DELETE_GET_CMD) return new Promise(resolve => { finishPoll = resolve })
      if (cmd === DELETE_PAUSE_CMD) return jobDto({ status: 'paused' })
      return []
    })
    await s.startBatchDelete(['a1'])
    await vi.advanceTimersByTimeAsync(500)
    await s.pauseBatchDelete()
    finishPoll(jobDto({ status: 'running' }))
    await Promise.resolve()
    expect(s.batchDeleteJob.value?.status).toBe('paused')
  })

  it('poll resolving after abandon cannot recreate the discarded job', async () => {
    vi.useFakeTimers()
    const s = await loadState()
    let finishPoll!: (value: unknown) => void
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === DELETE_START_CMD) return jobDto()
      if (cmd === DELETE_GET_CMD) return new Promise(resolve => { finishPoll = resolve })
      return []
    })
    await s.startBatchDelete(['a1'])
    await vi.advanceTimersByTimeAsync(500)
    await s.abandonBatchDelete()
    finishPoll(jobDto({ completed: 1 }))
    await Promise.resolve()
    expect(s.batchDeleteJob.value).toBeNull()
  })

  it('收窗不停作业，终态收窗才 clear：jobId 一清，dock 入口随之消失', async () => {
    vi.useFakeTimers()
    deleteAnswers([jobDto({ completed: 2, status: 'completed' })])
    const s = await loadState()
    await s.startBatchDelete(['a1', 'a2'])

    await s.closeBatchDeleteDialog()
    expect(s.batchDeleteDialogOpen.value).toBe(false)
    expect(s.batchDeleteJob.value?.jobId).toBe(JOB_ID)
    expect(callsOf(DELETE_CLEAR_CMD)).toHaveLength(0)

    // 弹窗关了，轮询照旧把作业跑到终态
    await vi.advanceTimersByTimeAsync(500)
    expect(s.batchDeleteJob.value?.status).toBe('completed')

    await s.closeBatchDeleteDialog()
    expect(callsOf(DELETE_CLEAR_CMD).map(([, a]: any) => a.jobId)).toEqual([JOB_ID])
    expect(s.batchDeleteJob.value).toBeNull()

    // 没有 jobId 可清时不该再发第二次
    await s.closeBatchDeleteDialog()
    expect(callsOf(DELETE_CLEAR_CMD)).toHaveLength(1)
  })

  it('失败明细的邮箱取自开局快照：后端只给 id，retry 抹掉明细后还认得是谁', async () => {
    const s = await loadState()
    s.accounts.value = [account({ id: 'a1', email: 'one@e2e.dev' }), account({ id: 'a2', email: 'two@e2e.dev' })]
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === DELETE_START_CMD) return jobDto({ total: 2 })
      if (cmd === DELETE_RETRY_CMD) return jobDto({ total: 1, completed: 0, status: 'running', errors: [] })
      return []
    })
    await s.startBatchDelete(['a1', 'a2'])
    expect(callsOf(DELETE_START_CMD).map(([, a]: any) => a.accountIds)).toEqual([['a1', 'a2']])

    s.batchDeleteJob.value = jobDto({
      total: 2,
      completed: 2,
      failed: 1,
      status: 'failed',
      errors: [{ accountId: 'a2', error: '令牌已失效' }],
    }) as any
    expect(s.batchDeleteErrors.value).toEqual([{ accountId: 'a2', error: '令牌已失效' }])
    expect(s.batchDeleteEmailOf('a2')).toBe('two@e2e.dev')
    // 抄不到的 id 退回 id，明细行不会显示成空白
    expect(s.batchDeleteEmailOf('zzz')).toBe('zzz')

    await s.retryFailedBatchDelete()
    expect(s.batchDeleteJob.value?.errors).toEqual([])
    // 后端把这一轮抹干净了，界面顶着的仍是按下去之前那一份
    expect(s.batchDeleteErrors.value).toEqual([{ accountId: 'a2', error: '令牌已失效' }])
  })
})

it('锁定清理后，旧账号请求的回包不能重新填回凭据', async () => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  const s = await loadState()
  let finish!: (value: CodexAccount[]) => void
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'list_codex_accounts') return new Promise<CodexAccount[]>(r => { finish = r })
    return null
  })
  s.accounts.value = [account()]
  const refresh = s.refreshAccounts()
  s.clearCodexSession()
  finish([account()])
  await refresh
  expect(s.accounts.value).toEqual([])
  expect(s.loaded.value).toBe(false)
})
