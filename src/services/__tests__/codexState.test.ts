import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '../../stores/toast'
import type { CodexAccount } from '../api/codex'

const mockInvoke = vi.mocked(invoke)

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

  it('定时器按间隔跑批量刷新，离开页面即停', async () => {
    vi.useFakeTimers()
    answerSettings({ codex_quota_auto_refresh_minutes: '5' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]

    const batchCalls = () =>
      mockInvoke.mock.calls.filter(([cmd]) => cmd === 'refresh_codex_quotas_batch').length
    s.startQuotaTicker()
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    expect(batchCalls()).toBe(0)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(batchCalls()).toBe(1)

    s.stopQuotaTicker()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(batchCalls()).toBe(1)
  })

  it('间隔为 0 不起定时器，设置页改动只影响在跑的定时器', async () => {
    vi.useFakeTimers()
    answerSettings({ codex_quota_auto_refresh_minutes: '0' })
    const s = await loadState()
    await s.loadQuotaSettings()
    s.accounts.value = [account()]

    s.syncQuotaTicker()
    s.startQuotaTicker()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'refresh_codex_quotas_batch')).toBe(false)

    // 关掉的状态下改了间隔：没有定时器可重启，等下次进页才起
    await s.saveQuotaSettings(5, 20)
    s.syncQuotaTicker()
    await vi.advanceTimersByTimeAsync(6 * 60_000)
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'refresh_codex_quotas_batch')).toBe(false)
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

  it('读不到目录：清空列表、留错误、标记没扫过；重试成功即复位', async () => {
    const s = await loadState()
    mockInvoke.mockRejectedValueOnce('官方会话目录不可读')
    await s.loadSessions()
    expect(s.sessions.value).toEqual([])
    expect(s.sessionsError.value).toBe('官方会话目录不可读')
    expect(s.sessionsLoaded.value).toBe(false)

    mockInvoke.mockResolvedValueOnce([sessionRec('a')])
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

  it('token 统计只问缺的那几条；刷新清缓存后按全量重新预取', async () => {
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
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b'], ['b']])

    await s.reloadSessions()
    // 清缓存后列表里每条都算缺，预取那一轮一次带走，面板不必再按组补
    expect(callsOf(STATS_CMD).map(([, a]: any) => a.sessionIds)).toEqual([['a', 'b'], ['b'], ['a', 'b']])
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

    expect(await s.deleteRecycledAccount('a')).toBe('已彻底删除这条留底')
    expect(callsOf(RECYCLED_DELETE_CMD).map(([, x]: any) => x.recycleId)).toEqual(['a'])
    expect(s.recycledAccounts.value.map((r: any) => r.id)).toEqual(['b'])
    expect(callsOf('list_codex_accounts')).toHaveLength(listCalls)

    expect(await s.emptyRecycledAccounts()).toBe('已彻底删除 1 条留底')
    expect(callsOf(RECYCLED_EMPTY_CMD).map(([, x]: any) => x.recycleIds)).toEqual([['b']])
    expect(s.recycledAccounts.value).toEqual([])

    // 清单已空还点清空：不该发网络，话也要说清楚
    expect(await s.emptyRecycledAccounts()).toBe('账号留底已经是空的')
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
    },
  ],
  byModel: [],
  fromTimestamp: null,
  toTimestamp: null,
  scanMillis: 1681,
})

describe('codexState 用量档', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  const localMidnightSec = () => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return Math.floor(d.getTime() / 1000)
  }

  it('切窗口只换起点：默认 30 天、周档 7 天、同档重复点不发网络、全部不带窗口', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValue(usageReportFixture())

    await s.loadUsage()
    const [, firstArgs] = callsOf(USAGE_CMD)[0] as any
    expect(firstArgs.fromTimestamp).toBe(localMidnightSec() - 30 * 86_400)
    expect(firstArgs.toTimestamp).toBe(null)

    await s.setUsageRange('week')
    expect(callsOf(USAGE_CMD)).toHaveLength(2)
    const [, weekArgs] = callsOf(USAGE_CMD)[1] as any
    expect(weekArgs.fromTimestamp).toBe(localMidnightSec() - 7 * 86_400)

    // 再点同一档：账没变，不该重扫那几百 MB
    await s.setUsageRange('week')
    expect(callsOf(USAGE_CMD)).toHaveLength(2)

    await s.setUsageRange('all')
    const [, allArgs] = callsOf(USAGE_CMD)[2] as any
    expect(allArgs.fromTimestamp).toBe(null)
  })

  it('扫失败只留错误行，上一轮的数不被吞；在途时不并发重扫', async () => {
    const s = await loadState()
    mockInvoke.mockResolvedValue(usageReportFixture())
    await s.loadUsage()
    expect(s.usageReport.value?.totals.totalTokens).toBe(1000)

    mockInvoke.mockRejectedValueOnce('用量统计失败')
    await s.setUsageRange('all')
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
