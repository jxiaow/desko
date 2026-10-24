import { computed, ref } from 'vue'
import type { CodexSessionUsageReport } from './api/codex'
import {
  codexApi,
  type CodexAccount,
  type CodexBatchDeleteError,
  type CodexBatchDeleteJobStatus,
  type CodexRecycledAccount,
  type CodexSessionRecord,
  type CodexSessionTokenStats,
  type CodexTrashedSessionRecord,
  type CodexWslAssignment,
  type CodexSwitchPolicy,
  type CodexSwitchOutcome,
  type CodexWslOutcome,
} from './api/codex'
import { errText } from './api/backup'
import { settingsApi } from './api/settings'
import { isWebRuntime } from './runtime'
import { useToastStore } from '../stores/toast'
import { codexQuotaRemaining } from '../utils/codexAccounts'
import { localDayKey, usageWindowFrom, type UsageRange } from '../utils/codexUsage'
export type { UsageRange } from '../utils/codexUsage'

/** Codex 官方凭据路径：模块页与设置页共用，设置弹窗打开时预热 */
export const storagePaths = ref<{
  providerStorePath: string
  configPath: string
  authPath: string
} | null>(null)

export async function loadStoragePaths(): Promise<void> {
  const epoch = accountEpoch
  try {
    const paths = await codexApi.storagePaths()
    if (epoch === accountEpoch) storagePaths.value = paths
  } catch {
    if (epoch === accountEpoch) storagePaths.value = null
  }
}

/** 账号列表单例：模块页与添加/编辑弹窗共用，一次落盘全站即时刷新 */
export const accounts = ref<CodexAccount[]>([])
export const currentId = ref('')
export const loaded = ref(false)
export const accountsError = ref('')
export const busyId = ref('')
export const switchingId = ref('')
/** 切号进度（后端 codex:switch-progress 事件），只在切号那几秒非空 */
export const switchStep = ref('')

/** 后端 emit_codex_switch_step 的步名，翻成人话再上界面 */
const SWITCH_STEPS: Record<string, string> = {
  credentials: '读取账号信息',
  accessToken: '验证登录状态',
  refreshTokens: '刷新令牌',
  writeCredentials: '更新登录信息',
  syncSettings: '同步配置',
  closeWindows: '关闭 Windows Codex',
  reopenWindows: '重新打开 Windows Codex',
  applyWsl: '切换 WSL 账号',
}

/** 这个事件是三套形状混发的：步进带 step/stepStatus，收口带 type */
export interface SwitchProgress {
  accountId?: string
  step?: string
  stepStatus?: string
  type?: string
}

export function applySwitchProgress(p: SwitchProgress): void {
  if (!switchingId.value || (p.accountId && p.accountId !== switchingId.value)) return
  if (p.type === 'complete' || p.type === 'error') {
    switchStep.value = ''
    return
  }
  if (!p.step) return
  const label = SWITCH_STEPS[p.step] ?? p.step
  switchStep.value = p.stepStatus === 'skipped' ? `${label} · 跳过` : label
}

export const currentAccount = computed(
  () => accounts.value.find((a) => a.id === currentId.value) ?? null
)

/** 桌面挂件点击后请求 Codex 页切回账号档；页面没挂载时走默认视图，无需消费 */
export const codexAccountsViewRequests = ref(0)
export function requestCodexAccountsView(): void {
  codexAccountsViewRequests.value++
}

let accountEpoch = 0

export async function refreshAccounts(): Promise<void> {
  const epoch = accountEpoch
  const toast = useToastStore()
  accountsError.value = ''
  try {
    const [list, cur] = await Promise.all([codexApi.list(), codexApi.current()])
    if (epoch !== accountEpoch) return
    accounts.value = list
    currentId.value = cur?.id ?? ''
  } catch (e) {
    if (epoch !== accountEpoch) return
    accountsError.value = errText(e)
    toast.showToast(errText(e), 'error')
  } finally {
    if (epoch === accountEpoch) loaded.value = true
  }
}

/** 应用锁定时收回账号凭据与后台轮询。 */
export function clearCodexSession(): void {
  accountEpoch++
  stopQuotaTicker()
  stopDeleteTicker()
  usageToday.value = null
  usageTodayUpdatedAt.value = null
  deleteGeneration++
  batchDeleteErrorsBeforeRetry.value = []
  lastQuotaAt = 0
  alerted.clear()
  accounts.value = []
  currentId.value = ''
  loaded.value = false
  accountsError.value = ''
  busyId.value = ''
  switchingId.value = ''
  switchStep.value = ''
  storagePaths.value = null
  wslAssignmentEpoch++
  wslAssignment.value = null
  switchRestartReady.value = false
  switchRestartWindows.value = false
  recycledAccounts.value = []
  recycledLoaded.value = false
  batchDeleteDialogOpen.value = false
  batchDeleteEmails.clear()
  sessions.value = []
  sessionTotalCount.value = 0
  sessionsLoaded.value = false
  sessionsBusy.value = false
  sessionsError.value = ''
  sessionQuery.value = ''
  sessionSearchMode.value = 'title'
  sessionTokens.value = {}
  sessionTokensLoaded.value = new Set()
  sessionTokensPending.value = new Set()
  sessionTokensError.value = ''
  sessionOpenGroups.value = new Set()
  sessionGroupsInitialized = false
  sessionOpenId.value = ''
  rescanQueued = false
  trashSessions.value = []
  trashLoaded.value = false
  trashBusy.value = false
  trashError.value = ''
  recycledBusy.value = false
  recycledError.value = ''
  usageReport.value = null
  usageWindowCache.clear()
  usageReportRange.value = usageRange.value
  usageUpdatedAt.value = null
  usageBusy.value = false
  usageError.value = ''
}

/** 配额刷新走后台批量：一次点击不该把整页冻在网络请求上。
 *  silent 给定时器与进页那一轮用——每轮都播「配额已刷新」是噪音，失败也不刷屏（行内已有 quota_error 事实位） */
let lastQuotaAt = 0

export async function refreshQuotas(ids: string[], opts: { silent?: boolean } = {}): Promise<void> {
  const epoch = accountEpoch
  const toast = useToastStore()
  if (!ids.length) return
  lastQuotaAt = Date.now()
  try {
    await codexApi.refreshAllQuotas(ids)
    if (epoch !== accountEpoch) return
    if (!opts.silent) toast.showToast('配额已刷新')
    await refreshAccounts()
    if (epoch === accountEpoch) checkQuotaAlert()
  } catch (e) {
    if (epoch === accountEpoch && !opts.silent) toast.showToast(errText(e), 'error')
  }
}

/** 进页那一轮：库里存的可能是几小时前的数，定时器又至少要等一个间隔才响，
 *  所以先摆缓存值、再静默补一轮。60 s 闸门挡住「在别的页签间来回切就打一次网络」。 */
export async function refreshQuotasOnEnter(): Promise<void> {
  if (quotaRefreshMinutes.value <= 0) return
  if (Date.now() - lastQuotaAt < 60_000) return
  await refreshQuotas(accounts.value.map((a) => a.id), { silent: true })
}

/** 读官方 config.toml 生效的 model_provider；读不到就返回空串，绝不让它拖垮切号 */
async function readVisibilityProvider(): Promise<string> {
  try {
    return await codexApi.historyProvider()
  } catch {
    return ''
  }
}

/** 切号收尾：凭据形态变了（OAuth ↔ API Key）会改写 config.toml 的 model_provider，
 *  官方客户端侧栏按它过滤 threads，旧会话会集体消失。值变了就补一次 quick 修复把旧会话挂回来；
 *  修复带改前备份、不联网。文案要留够读完的时间，故走 info/error 档。 */
async function finishSwitch(providerBefore: string, providerAfter: string, epoch: number): Promise<{ warning?: string; repaired?: number } | undefined> {
  if (epoch !== accountEpoch || !providerBefore || !providerAfter || providerBefore === providerAfter) return
  switchStep.value = '同步会话列表'
  try {
    const result = await codexApi.repairSessionVisibility()
    if (epoch === accountEpoch) return { repaired: result.updatedSqliteRowCount + result.changedRolloutFileCount }
  } catch (e) {
    if (epoch === accountEpoch) return { warning: `会话列表同步失败：${errText(e)}` }
  }
}

export function switchOutcomeText(outcome: CodexSwitchOutcome): string {
  const parts = [`已切换到 ${outcome.account.email}`]
  const windows = []
  if (outcome.windows.reopenedApp) windows.push(`${outcome.windows.reopenedApp} 个应用`)
  if (outcome.windows.reopenedCli) windows.push(`${outcome.windows.reopenedCli} 个 CLI`)
  if (windows.length) parts.push(`Windows 重开 ${windows.join('、')}`)
  if (outcome.windows.reopenFailures) parts.push(`${outcome.windows.reopenFailures} 个 Windows Codex 未能重开`)
  const wsl = outcome.wsl
  if (wsl?.status === 'skipped') parts.push('未检测到 WSL 目标')
  else if (wsl?.status === 'aborted') parts.push('WSL 未跟随，请手动退出后重试')
  else if (wsl?.failures.length) parts.push(`WSL ${wsl.written} 个目标成功、${wsl.failures.length} 个失败`)
  else if (wsl?.written) parts.push(`WSL ${wsl.written} 个目标已切换`)
  if (outcome.warnings?.length) parts.push(...outcome.warnings)
  return parts.join('；')
}
export async function switchTo(id: string, policy: CodexSwitchPolicy): Promise<CodexSwitchOutcome | null> {
  if (busyId.value) throw new Error('正在处理账号，请稍后重试')
  const epoch = accountEpoch
  busyId.value = id; switchingId.value = id
  try {
    const providerBefore = await readVisibilityProvider()
    if (epoch !== accountEpoch) return null
    const result = await codexApi.switchCodexAccount(id, policy)
    if (epoch !== accountEpoch) return null
    const providerAfter = await readVisibilityProvider()
    if (epoch !== accountEpoch) return null
    await refreshAccounts()
    if (epoch !== accountEpoch) return null
    const repair = await finishSwitch(providerBefore, providerAfter, epoch)
    if (repair?.warning) result.warnings = [...result.warnings ?? [], repair.warning]
    if (epoch !== accountEpoch) return null
    void loadWslAssignment()
    const partial = result.windows.reopenFailures > 0 || !!result.wsl?.failures.length || !!result.warnings?.length
    const repairText = (repair?.repaired ?? 0) > 0 ? '；已同步会话列表' : ''
    useToastStore().showToast(switchOutcomeText(result) + repairText, partial ? 'error' : 'success')
    return result
  } catch (e) {
    if (epoch !== accountEpoch) return null
    await refreshAccounts()
    if (epoch !== accountEpoch) return null
    throw e
  } finally {
    if (epoch === accountEpoch) { busyId.value = ''; switchingId.value = ''; switchStep.value = '' }
  }
}

export async function runOn<T>(id: string, fn: () => Promise<T>, okToast: string): Promise<T | null> {
  if (busyId.value) return null
  const epoch = accountEpoch
  const toast = useToastStore()
  busyId.value = id
  try {
    const r = await fn()
    if (epoch !== accountEpoch) return null
    if (okToast) toast.showToast(okToast)
    await refreshAccounts()
    return r
  } catch (e) {
    if (epoch !== accountEpoch) return null
    toast.showToast(errText(e), 'error')
    return null
  } finally {
    if (epoch === accountEpoch) busyId.value = ''
  }
}

export function remaining(a: CodexAccount): number | null {
  return codexQuotaRemaining(a)
}

/** 配额自动刷新：0=关，间隔只在这页开着的时候跑，离开即停（desko 是小窗常驻型工作台） */
export const QUOTA_REFRESH_CHOICES = [0, 5, 10, 30]
/** 预警阈值：盯的是「当前」那条账号里更紧的那扇窗口 */
export const QUOTA_ALERT_CHOICES = [10, 20, 30]
const KEY_REFRESH_MINUTES = 'codex_quota_auto_refresh_minutes'
const KEY_ALERT_THRESHOLD = 'codex_quota_alert_threshold'
const DEFAULT_REFRESH_MINUTES = 10
const DEFAULT_ALERT_THRESHOLD = 20

export const quotaRefreshMinutes = ref(DEFAULT_REFRESH_MINUTES)
export const quotaAlertThreshold = ref(DEFAULT_ALERT_THRESHOLD)

const clampChoice = (raw: string, choices: number[], fallback: number) => {
  const n = Number.parseInt(raw, 10)
  return choices.includes(n) ? n : fallback
}

export async function loadQuotaSettings(): Promise<void> {
  try {
    const [minutes, threshold] = await Promise.all([
      settingsApi.getSetting(KEY_REFRESH_MINUTES),
      settingsApi.getSetting(KEY_ALERT_THRESHOLD),
    ])
    quotaRefreshMinutes.value = clampChoice(minutes, QUOTA_REFRESH_CHOICES, DEFAULT_REFRESH_MINUTES)
    quotaAlertThreshold.value = clampChoice(threshold, QUOTA_ALERT_CHOICES, DEFAULT_ALERT_THRESHOLD)
  } catch {
    quotaRefreshMinutes.value = DEFAULT_REFRESH_MINUTES
    quotaAlertThreshold.value = DEFAULT_ALERT_THRESHOLD
  }
}

export async function saveQuotaSettings(minutes: number, threshold: number): Promise<void> {
  quotaRefreshMinutes.value = minutes
  quotaAlertThreshold.value = threshold
  // 阈值改了要允许重新报一次，否则调低阈值永远静默
  alerted.clear()
  try {
    await Promise.all([
      settingsApi.setSetting(KEY_REFRESH_MINUTES, String(minutes)),
      settingsApi.setSetting(KEY_ALERT_THRESHOLD, String(threshold)),
    ])
  } catch (e) {
    useToastStore().showToast(errText(e), 'error')
  }
}

/** 同一档位只报一次：每轮自动刷新都弹一次会把人训练成忽略 toast */
const alerted = new Set<string>()

/** 预警只有一条通道：刷新完在前端算。后端 quota:alert 由 codex_quota_alert_enabled 把关，
 *  desko 从不写那个配置（默认 false），监听它等于挂个哑事件 */
export function checkQuotaAlert(): void {
  const cur = accounts.value.find((a) => a.id === currentId.value)
  if (!cur) return
  const left = codexQuotaRemaining(cur)
  if (left === null || left > quotaAlertThreshold.value) return
  const key = `${cur.id}:${left <= 5 ? 'critical' : 'low'}`
  if (alerted.has(key)) return
  alerted.add(key)
  useToastStore().showToast(
    `${cur.email} 剩余 ${left}%，低于 ${quotaAlertThreshold.value}% 阈值`,
    'error',
  )
}

let ticker: ReturnType<typeof setInterval> | null = null
const tickerOwners = new Set<string>()

/** 定时器按 owner 引用计数：Codex 页与桌面挂件各持一份，谁还需要谁就让它继续跑 */
function startTickerLoop(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
  const minutes = quotaRefreshMinutes.value
  if (minutes <= 0 || !tickerOwners.size) return
  ticker = setInterval(() => {
    if (!accounts.value.length) return
    void refreshQuotas(accounts.value.map((a) => a.id), { silent: true })
  }, minutes * 60_000)
}

export function acquireQuotaTicker(owner: string): void {
  const hadOwner = tickerOwners.size > 0
  tickerOwners.add(owner)
  if (!hadOwner) startTickerLoop()
}

export function releaseQuotaTicker(owner: string): void {
  tickerOwners.delete(owner)
  if (!tickerOwners.size && ticker) {
    clearInterval(ticker)
    ticker = null
  }
}

/** 锁定/退出时硬清：owner 集合一起作废，解锁后由各入口重新 acquire */
export function stopQuotaTicker(): void {
  tickerOwners.clear()
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** 设置页改了间隔：有 owner 就按新值重启（含 0 → 正数），没有 owner 就等下次 acquire */
export function syncQuotaTicker(): void {
  if (tickerOwners.size) startTickerLoop()
}

/** 官方重置时间只到分钟，直接给人话「x 小时 y 分后重置」，不摆 ISO 串 */
export function resetsIn(ts: number | null | undefined): string {
  if (!ts) return ''
  const mins = Math.round((ts * 1000 - Date.now()) / 60000)
  if (mins <= 0) return '即将重置'
  if (mins < 60) return `${mins} 分钟后重置`
  const h = Math.floor(mins / 60)
  if (h < 48) {
    const m = mins % 60
    return m ? `${h} 小时 ${m} 分后重置` : `${h} 小时后重置`
  }
  return `${Math.floor(h / 24)} 天后重置`
}

/** 会话视图的共享状态：官方目录的一次全扫是重 I/O，扫完留在内存——
 *  页头计数与会话面板读同一份，切档、离页再进都不重扫，只有「刷新」才重取 */
export const sessions = ref<CodexSessionRecord[]>([])
/** 未搜索时的总数，搜索结果变少不应收起搜索入口。 */
export const sessionTotalCount = ref(0)
export const sessionsLoaded = ref(false)
export const sessionsBusy = ref(false)
/** 非空表示整页读数失败：界面出错误块，不能让它读成「你没有会话」 */
export const sessionsError = ref('')
export const sessionQuery = ref('')
export const sessionSearchMode = ref<'title' | 'content'>('title')
/** 会话 ID → 官方 token 累计；进这一档一次全量预取，展开只补缺 */
export const sessionTokens = ref<Record<string, CodexSessionTokenStats>>({})
/** 已读取但没有用量的会话也算完成；与读取失败严格区分。 */
export const sessionTokensLoaded = ref<Set<string>>(new Set())
export const sessionTokensPending = ref<Set<string>>(new Set())
export const sessionTokensError = ref('')
/** 组展开态住在这一档而不是面板里：组件被 v-if 卸挂不该把用户翻开的组一起带走 */
export const sessionOpenGroups = ref<Set<string>>(new Set())
export const sessionOpenId = ref('')

/** 全扫期间又来一次（边扫边改搜索词）：先记下，本轮结束立刻补一次，别让新词被吞掉 */
let rescanQueued = false
let sessionTokensVersion = 0
let sessionSourcesVersion = 0
let sessionGroupsInitialized = false

export async function loadSessions({ background = false }: { background?: boolean } = {}): Promise<void> {
  if (sessionsBusy.value) {
    rescanQueued = true
    return
  }
  sessionsBusy.value = true
  sessionsError.value = ''
  const epoch = accountEpoch
  const sourcesVersion = sessionSourcesVersion
  const query = sessionQuery.value.trim()
  let refreshed = false
  try {
    const list = await codexApi.listSessions(
      sessionSearchMode.value === 'title' ? query : undefined,
      sessionSearchMode.value === 'content' ? query : undefined,
    )
    if (epoch !== accountEpoch) return
    if (sourcesVersion !== sessionSourcesVersion) {
      rescanQueued = true
    } else {
      sessions.value = list
      if (!query && list.length && !sessionGroupsInitialized) {
        const recent = list.reduce((latest, session) => (session.updatedAt ?? 0) > (latest.updatedAt ?? 0) ? session : latest)
        if (!sessionOpenGroups.value.size) sessionOpenGroups.value = new Set([recent.cwd.trim() || '∅'])
        sessionGroupsInitialized = true
      }
      if (!query) sessionTotalCount.value = list.length
      sessionsLoaded.value = true
      refreshed = true
      // 刷新沿用旧数字直到新统计返回；旧请求不能覆盖这一轮的结果。
      sessionTokensVersion++
      sessionTokensPending.value = new Set()
      sessionTokensError.value = ''
      const ids = new Set(list.map(s => s.sessionId))
      sessionTokens.value = Object.fromEntries(Object.entries(sessionTokens.value).filter(([id]) => ids.has(id)))
      sessionTokensLoaded.value = new Set([...sessionTokensLoaded.value].filter(id => ids.has(id)))
    }
  } catch (e) {
    if (epoch !== accountEpoch) return
    if (sourcesVersion !== sessionSourcesVersion) {
      rescanQueued = true
    } else if (!background || !sessionsLoaded.value) {
      sessions.value = []
      sessionsLoaded.value = false
      sessionsError.value = errText(e)
    } else {
      sessionsError.value = errText(e)
    }
  } finally {
    if (epoch === accountEpoch) sessionsBusy.value = false
  }
  if (epoch !== accountEpoch) return
  // 列表先呈现，统计独立加载；展开项目复用同一批在途请求。
  if (refreshed && !rescanQueued) void loadSessionTokens(sessions.value.map((s) => s.sessionId), true)
  if (rescanQueued) {
    rescanQueued = false
    await loadSessions()
  }
}

/** 刷新期间保留已有读数，新统计返回后整体替换。 */
export async function reloadSessions(): Promise<void> {
  await loadSessions({ background: sessionsLoaded.value })
}

/** 缺数才补取，合并展开期间的重复请求；失败保留旧数并允许重试。 */
export async function loadSessionTokens(ids: string[], force = false): Promise<void> {
  const missing = [...new Set(ids)].filter(id => !sessionTokensPending.value.has(id)
    && (force || (!sessionTokens.value[id] && !sessionTokensLoaded.value.has(id))))
  if (!missing.length) return
  const epoch = accountEpoch
  const version = sessionTokensVersion
  sessionTokensPending.value = new Set([...sessionTokensPending.value, ...missing])
  sessionTokensError.value = ''
  try {
    const records = await codexApi.sessionTokenStats(missing)
    if (epoch !== accountEpoch || version !== sessionTokensVersion) return
    const next = { ...sessionTokens.value }
    for (const id of missing) delete next[id]
    for (const r of records) next[r.sessionId] = r
    sessionTokens.value = next
    sessionTokensLoaded.value = new Set([...sessionTokensLoaded.value, ...missing])
  } catch (e) {
    if (epoch === accountEpoch && version === sessionTokensVersion) sessionTokensError.value = errText(e)
  } finally {
    if (epoch === accountEpoch && version === sessionTokensVersion) {
      sessionTokensPending.value = new Set([...sessionTokensPending.value].filter(id => !missing.includes(id)))
    }
  }
}

/** desko 回收站：留底清单的一次扫描，口径同会话列表——进档才扫，扫过留在内存 */
export const trashSessions = ref<CodexTrashedSessionRecord[]>([])
export const trashLoaded = ref(false)
export const trashBusy = ref(false)
export const trashError = ref('')

export async function loadTrash(): Promise<void> {
  if (trashBusy.value) return
  trashBusy.value = true
  trashError.value = ''
  const epoch = accountEpoch
  try {
    const list = await codexApi.listTrash()
    if (epoch !== accountEpoch) return
    trashSessions.value = list
    trashLoaded.value = true
  } catch (e) {
    if (epoch !== accountEpoch) return
    trashSessions.value = []
    trashLoaded.value = false
    trashError.value = errText(e)
  } finally {
    if (epoch === accountEpoch) trashBusy.value = false
  }
}

/** 移进回收站。成功后立刻把这条从列表与 token 缓存里摘掉：合计量不能拿着已删的数 */
export async function moveSessionToTrash(sessionId: string): Promise<string> {
  const epoch = accountEpoch
  const summary = await codexApi.moveToTrash([sessionId])
  if (epoch !== accountEpoch) return ''
  sessionSourcesVersion++
  sessionTokensVersion++
  sessionTokensPending.value = new Set()
  sessionTokensLoaded.value = new Set([...sessionTokensLoaded.value].filter(id => id !== sessionId))
  if (sessions.value.some(s => s.sessionId === sessionId)) {
    sessionTotalCount.value = Math.max(0, sessionTotalCount.value - 1)
  }
  sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId)
  const next = { ...sessionTokens.value }
  delete next[sessionId]
  sessionTokens.value = next
  trashLoaded.value = false
  invalidateUsage()
  return summary.message
}

/** 恢复：留底这一行当场摘掉，官方目录多了一条要整页重扫才看得见；顺手丢掉 token 缓存 */
export async function restoreTrashedSession(sessionId: string): Promise<string> {
  const epoch = accountEpoch
  const summary = await codexApi.restoreFromTrash([sessionId])
  if (epoch !== accountEpoch) return ''
  sessionSourcesVersion++
  dropTrashRow(sessionId)
  await reloadSessions()
  if (epoch !== accountEpoch) return ''
  // 文件回到官方目录，图上那一天就多这一笔；彻底删除/清空不动目录，无须标脏
  invalidateUsage()
  return summary.message
}

/** 彻底删除与清空动的都是留底自己，行上当场消失，不必回读目录 */
export async function deleteTrashedSession(sessionId: string): Promise<string> {
  const epoch = accountEpoch
  const summary = await codexApi.deleteFromTrash([sessionId])
  if (epoch !== accountEpoch) return ''
  dropTrashRow(sessionId)
  return summary.message
}

export async function emptySessionTrash(): Promise<string> {
  const epoch = accountEpoch
  const summary = await codexApi.emptyTrash()
  if (epoch !== accountEpoch) return ''
  trashSessions.value = []
  return summary.message
}

function dropTrashRow(sessionId: string): void {
  trashSessions.value = trashSessions.value.filter((t) => t.sessionId !== sessionId)
}

/**
 * 账号留底。删除那一步后端早就在写密文快照（`remove_accounts` 先 archive 再剔索引），
 * 这一族只是把已经在磁盘上的那份读回来——口径同会话留底：进档才扫，扫过留在内存。
 */
export const recycledAccounts = ref<CodexRecycledAccount[]>([])
export const recycledLoaded = ref(false)
export const recycledBusy = ref(false)
export const recycledError = ref('')

export async function loadRecycled(): Promise<void> {
  if (recycledBusy.value) return
  recycledBusy.value = true
  recycledError.value = ''
  const epoch = accountEpoch
  try {
    const list = await codexApi.listRecycled()
    if (epoch !== accountEpoch) return
    recycledAccounts.value = list
    recycledLoaded.value = true
  } catch (e) {
    if (epoch !== accountEpoch) return
    recycledAccounts.value = []
    recycledLoaded.value = false
    recycledError.value = errText(e)
  } finally {
    if (epoch === accountEpoch) recycledBusy.value = false
  }
}

/** 恢复成功要把账号页重读一遍：那条号已经回到索引里，不重读就是假象 */
export async function restoreRecycledAccount(recycleId: string): Promise<string> {
  const epoch = accountEpoch
  await codexApi.restoreRecycled(recycleId)
  if (epoch !== accountEpoch) return ''
  dropRecycledRow(recycleId)
  await refreshAccounts()
  if (epoch !== accountEpoch) return ''
  return '已恢复到账号列表'
}

export async function deleteRecycledAccount(recycleId: string): Promise<string> {
  const epoch = accountEpoch
  await codexApi.deleteRecycled(recycleId)
  if (epoch !== accountEpoch) return ''
  dropRecycledRow(recycleId)
  return '账号已彻底删除'
}

/** 清空的范围等于刚看到的那份清单，别处新删的号不在里面 */
export async function emptyRecycledAccounts(): Promise<string> {
  const epoch = accountEpoch
  const ids = recycledAccounts.value.map((r) => r.id)
  if (!ids.length) return '没有已删除的账号'
  await codexApi.emptyRecycled(ids)
  if (epoch !== accountEpoch) return ''
  recycledAccounts.value = []
  return `已彻底删除 ${ids.length} 个账号`
}

function dropRecycledRow(recycleId: string): void {
  recycledAccounts.value = recycledAccounts.value.filter((r) => r.id !== recycleId)
}

/**
 * 批量删除作业。这一族后端没有事件，`get` 是唯一的进度来源，所以只能在 running 时轮询。
 * jobId 住模块级 store 而不是弹窗里：关窗作业继续跑、切页面回来还接得上。应用重启作业随
 * 进程一起没了——后端没有「列作业」的命令，不假装能恢复。
 */
export const batchDeleteJob = ref<CodexBatchDeleteJobStatus | null>(null)
export const batchDeleteDialogOpen = ref(false)

/** 后端失败明细只带 accountId，而删成功的号已不在列表里、反查必 miss：开局抄一份 id→邮箱 */
const batchDeleteEmails = new Map<string, string>()

/** retry_failed 会把上一轮 errors 抹掉，点下去之前先留一份，重试期间明细不至于凭空消失 */
const batchDeleteErrorsBeforeRetry = ref<CodexBatchDeleteError[]>([])

let deleteTicker: ReturnType<typeof setInterval> | null = null
let deleteGeneration = 0
let pollInFlightGeneration: number | null = null
const DELETE_POLL_MS = 500

/** 抄不到邮箱（作业不是本 store 起的）就退回 id，至少那一行认得出来是哪条号 */
export function batchDeleteEmailOf(accountId: string): string {
  return batchDeleteEmails.get(accountId) ?? accountId
}

/** 界面展示的失败明细：以后端为准，后端抹掉了才顶一份重试前的快照 */
export const batchDeleteErrors = computed<CodexBatchDeleteError[]>(() => {
  const job = batchDeleteJob.value
  if (!job) return []
  if (job.errors.length) return job.errors
  return job.status === 'running' ? batchDeleteErrorsBeforeRetry.value : []
})

/** 只有 running 值得问：停在 paused 是等用户按继续，终态再问一遍纯属白问 */
export function syncDeleteTicker(): void {
  if (batchDeleteJob.value?.status === 'running') {
    if (!deleteTicker) deleteTicker = setInterval(() => void pollBatchDelete(), DELETE_POLL_MS)
    return
  }
  stopDeleteTicker()
}

export function stopDeleteTicker(): void {
  if (deleteTicker) clearInterval(deleteTicker)
  deleteTicker = null
}

async function pollBatchDelete(): Promise<void> {
  const jobId = batchDeleteJob.value?.jobId
  const generation = deleteGeneration
  if (!jobId || batchDeleteJob.value?.status !== 'running') {
    stopDeleteTicker()
    return
  }
  if (pollInFlightGeneration === generation) return
  pollInFlightGeneration = generation
  try {
    const next = await codexApi.getBatchDelete(jobId)
    if (generation === deleteGeneration && batchDeleteJob.value?.jobId === jobId && next.jobId === jobId) {
      applyBatchDeleteJob(next)
    }
  } catch {
    if (generation !== deleteGeneration || batchDeleteJob.value?.jobId !== jobId) return
    // 读不回就是任务已经没了（clear 过 / 后端重启过），不能挂成永久「删除中」
    stopDeleteTicker()
    batchDeleteJob.value = null
  } finally {
    if (pollInFlightGeneration === generation) pollInFlightGeneration = null
  }
}

function applyBatchDeleteJob(next: CodexBatchDeleteJobStatus): void {
  const moved = next.completed !== batchDeleteJob.value?.completed
  batchDeleteJob.value = next
  // 每处理一条账号页少一条、回收站多一份留底，不重读就是「进度走了、列表没动」的假象
  if (moved) void refreshAccounts()
  recycledLoaded.value = false
  if (next.status !== 'running') batchDeleteErrorsBeforeRetry.value = []
  syncDeleteTicker()
}

/**
 * 起作业。空选择挡在前面：后端会把它吞成 `status:"completed"` + 空 jobId，
 * 拿那个空 id 去轮询只会撞上「批量删除任务不存在」。
 */
export async function startBatchDelete(ids: string[]): Promise<void> {
  const targets = ids.map((id) => id.trim()).filter(Boolean)
  if (!targets.length) return
  if (batchDeleteJob.value) {
    batchDeleteDialogOpen.value = true
    useToastStore().showToast('请先完成或放弃当前删除任务', 'error')
    return
  }
  const generation = ++deleteGeneration
  stopDeleteTicker()
  const wanted = new Set(targets)
  batchDeleteEmails.clear()
  for (const a of accounts.value) {
    if (wanted.has(a.id)) batchDeleteEmails.set(a.id, a.email)
  }
  batchDeleteErrorsBeforeRetry.value = []
  try {
    const job = await codexApi.startBatchDelete(targets)
    if (generation !== deleteGeneration) return
    // 后端把空集合吞成 completed + 空 jobId：不轮询、不弹窗，留着也是清不掉的幽灵任务
    if (!job.jobId) return
    batchDeleteDialogOpen.value = true
    applyBatchDeleteJob(job)
  } catch (e) {
    if (generation === deleteGeneration) useToastStore().showToast(errText(e), 'error')
  }
}

async function runBatchDeleteJobOp(
  jobId: string,
  op: () => Promise<CodexBatchDeleteJobStatus>,
): Promise<void> {
  const generation = ++deleteGeneration
  stopDeleteTicker()
  try {
    const next = await op()
    if (generation === deleteGeneration && batchDeleteJob.value?.jobId === jobId && next.jobId === jobId) {
      applyBatchDeleteJob(next)
    }
  } catch (e) {
    if (generation === deleteGeneration) useToastStore().showToast(errText(e), 'error')
  } finally {
    if (generation === deleteGeneration) syncDeleteTicker()
  }
}

/** 暂停不是中断：正在跑的那一条会跑完，循环下一轮才看闸，所以文案不写「立即停止」 */
export async function pauseBatchDelete(): Promise<void> {
  const jobId = batchDeleteJob.value?.jobId
  if (!jobId) return
  await runBatchDeleteJobOp(jobId, () => codexApi.pauseBatchDelete(jobId))
}

/** 后端对 running/终态的任务是原样返回、不报错，所以这里不用防重复点 */
export async function resumeBatchDelete(): Promise<void> {
  const jobId = batchDeleteJob.value?.jobId
  if (!jobId) return
  await runBatchDeleteJobOp(jobId, () => codexApi.resumeBatchDelete(jobId))
}

export async function retryFailedBatchDelete(): Promise<void> {
  const job = batchDeleteJob.value
  if (!job?.jobId) return
  batchDeleteErrorsBeforeRetry.value = job.errors
  await runBatchDeleteJobOp(job.jobId, () => codexApi.retryFailedBatchDelete(job.jobId))
}

/** 收窗不等于收作业：只有终态才把 jobId 与盘快照一起清掉，dock 上那条入口随之消失 */
export async function closeBatchDeleteDialog(): Promise<void> {
  batchDeleteDialogOpen.value = false
  const status = batchDeleteJob.value?.status
  if (status === 'completed' || status === 'failed') await clearBatchDeleteJob()
}

/** 删除作业没有 cancel，暂停中的任务只能放弃；已删掉的那几条不会回来，它们在回收站里 */
export async function abandonBatchDelete(): Promise<string> {
  await clearBatchDeleteJob()
  return '任务已放弃，已删除账号可在回收站恢复'
}

async function clearBatchDeleteJob(): Promise<void> {
  const jobId = batchDeleteJob.value?.jobId
  deleteGeneration++
  stopDeleteTicker()
  batchDeleteJob.value = null
  batchDeleteEmails.clear()
  batchDeleteErrorsBeforeRetry.value = []
  if (!jobId) return
  try {
    await codexApi.clearBatchDelete(jobId)
  } catch {
    // 清不掉也不能把入口卡在界面上：这一路只剩「任务已经不存在」
  }
}

/**
 * 用量图。图的数据来自官方 rollout 里逐轮累计快照的差值，
 * 统计默认目录与配置的额外目录；一次查询缓存四个范围，切换无需重新统计。
 */
export const usageRange = ref<UsageRange>('today')
export const usageReport = ref<CodexSessionUsageReport | null>(null)
export const usageReportRange = ref<UsageRange>('today')
export const usageUpdatedAt = ref<number | null>(null)
export const usageBusy = ref(false)
export const usageError = ref('')
/** 桌面挂件要的今日汇总；与用量页共用同一份扫描缓存，失败不打扰主界面 */
export const usageToday = ref<{ totalTokens: number; estimatedCostUsd: number | null } | null>(null)
export const usageTodayUpdatedAt = ref<number | null>(null)
let usageSourcesVersion = 0
const USAGE_TODAY_TTL = 10 * 60_000
let usageTodayRequest: Promise<void> | null = null
const USAGE_RANGES: UsageRange[] = ['today', 'week', 'month', 'all']
const usageWindowCache = new Map<UsageRange, {
  report: CodexSessionUsageReport; updatedAt: number; fromTimestamp: number | null
}>()

function showCachedUsage(range: UsageRange): boolean {
  const cached = usageWindowCache.get(range)
  if (!cached || localDayKey(new Date(cached.updatedAt)) !== localDayKey(new Date())
    || cached.fromTimestamp !== usageWindowFrom(range)) return false
  usageReport.value = cached.report
  usageReportRange.value = range
  usageUpdatedAt.value = cached.updatedAt
  return true
}

const KEY_USAGE_EXTRA_DIRS = 'codex_usage_extra_dirs'
const KEY_USAGE_AUTO_WSL = 'codex_usage_auto_wsl'

export async function loadUsageAutoWsl(): Promise<boolean> {
  const raw = await settingsApi.getSetting(KEY_USAGE_AUTO_WSL)
  if (!raw || raw === 'true') return true
  if (raw === 'false') return false
  throw new Error('WSL 自动统计开关无效')
}

export async function saveUsageAutoWsl(enabled: boolean): Promise<void> {
  await saveUsageSetting(KEY_USAGE_AUTO_WSL, String(enabled))
}

export async function loadUsageExtraDirs(): Promise<string[]> {
  const raw = await settingsApi.getSetting(KEY_USAGE_EXTRA_DIRS)
  if (!raw) return []
  const dirs: unknown = JSON.parse(raw)
  if (!Array.isArray(dirs) || !dirs.every(dir => typeof dir === 'string')) {
    throw new Error('额外统计目录格式无效')
  }
  return dirs
}

export async function saveUsageExtraDirs(dirs: string[]): Promise<void> {
  const normalized = [...new Set(dirs.map(dir => dir.trim()).filter(Boolean))]
  await saveUsageSetting(KEY_USAGE_EXTRA_DIRS, JSON.stringify(normalized))
}

async function saveUsageSetting(key: string, value: string): Promise<void> {
  const epoch = accountEpoch
  await settingsApi.setSetting(key, value)
  if (epoch !== accountEpoch) return
  const refresh = usageReport.value !== null || usageBusy.value
  invalidateUsage()
  usageError.value = ''
  if (refresh) void loadUsage()
}

/** WSL 身份只读探测；进入账号页及显式写入后刷新，不挂定时同步。 */
export const wslAssignment = ref<CodexWslAssignment | null>(null)
let wslAssignmentEpoch = 0
export async function loadWslAssignment(): Promise<void> {
  if (isWebRuntime()) return
  const session = accountEpoch
  const epoch = ++wslAssignmentEpoch
  try {
    const result = await codexApi.getCodexWslAssignment()
    if (session === accountEpoch && epoch === wslAssignmentEpoch) wslAssignment.value = result.error ? null : result
  } catch { if (session === accountEpoch && epoch === wslAssignmentEpoch) wslAssignment.value = null }
}
export const switchRestartWindows = ref(false)
export const switchRestartReady = ref(false)
export const switchRestartSaving = ref(false)
const KEY_SWITCH_RESTART = 'codex_switch_restart_codex'
export async function loadSwitchRestart(): Promise<void> {
  const epoch = accountEpoch
  const value = isWebRuntime() ? 'false' : await settingsApi.getSetting(KEY_SWITCH_RESTART)
  if (epoch === accountEpoch) { switchRestartWindows.value = value === 'true'; switchRestartReady.value = true }
}
export async function saveSwitchRestart(value: boolean): Promise<void> {
  if (switchingId.value || switchRestartSaving.value) throw new Error('正在切换账号，请稍后修改')
  const epoch = accountEpoch
  switchRestartSaving.value = true
  try {
    await settingsApi.setSetting(KEY_SWITCH_RESTART, String(value))
    if (epoch === accountEpoch) switchRestartWindows.value = value
  } finally { switchRestartSaving.value = false }
}
export function wslOutcomeText(email: string, result: CodexWslOutcome): string {
  if (result.status === 'aborted') return 'WSL 未切换，请手动退出 Codex 后重试'
  if (result.status === 'skipped') return '未检测到运行中的 WSL 目标'
  if (result.failures.length) return `WSL ${result.written} 个目标成功、${result.failures.length} 个失败`
  if (!result.written) return `${email} 已用于 WSL，无需重复写入`
  const closed = result.daemonsStopped + result.clisStopped
  return `${email} 已用于 WSL；${result.written} 个目标${closed ? `，${closed} 个 Codex 已关闭` : ''}`
}
export async function assignToWsl(account: CodexAccount): Promise<CodexWslOutcome | null> {
  if (busyId.value) throw new Error('正在处理账号，请稍后重试')
  const epoch = accountEpoch
  busyId.value = account.id; switchingId.value = account.id; switchStep.value = '切换 WSL 账号'
  try {
    const result = await codexApi.assignCodexAccountToWsl(account.id)
    if (epoch !== accountEpoch) return null
    await loadWslAssignment()
    if (epoch !== accountEpoch) return null
    useToastStore().showToast(wslOutcomeText(account.email, result), result.failures.length ? 'error' : 'success')
    return result
  } finally { if (epoch === accountEpoch) { busyId.value = ''; switchingId.value = ''; switchStep.value = '' } }
}

function publishToday(report: CodexSessionUsageReport, updatedAt: number): void {
  usageToday.value = {
    totalTokens: report.totals.totalTokens,
    estimatedCostUsd: report.totals.estimatedCostUsd,
  }
  usageTodayUpdatedAt.value = updatedAt
}

/** 用量页刚全扫过就直接借它的今日窗口，挂件不再单独跑一遍磁盘 */
function adoptCachedToday(): boolean {
  const cached = usageWindowCache.get('today')
  if (!cached) return false
  if (localDayKey(new Date(cached.updatedAt)) !== localDayKey(new Date())) return false
  if (cached.fromTimestamp !== usageWindowFrom('today')) return false
  publishToday(cached.report, cached.updatedAt)
  return true
}

/** 10 分钟缓存；用量页正在全扫时只认缓存，绝不并发起第二份扫描 */
export async function loadTodayUsage(): Promise<void> {
  adoptCachedToday()
  const updatedAt = usageTodayUpdatedAt.value
  if (updatedAt != null && localDayKey(new Date(updatedAt)) !== localDayKey(new Date())) {
    usageToday.value = null
    usageTodayUpdatedAt.value = null
  }
  if (usageToday.value && Date.now() - (usageTodayUpdatedAt.value ?? 0) < USAGE_TODAY_TTL) return
  if (usageTodayRequest) return usageTodayRequest
  if (usageBusy.value) return
  const epoch = accountEpoch
  const sourcesVersion = usageSourcesVersion
  const queryAt = Date.now()
  const fromTimestamp = usageWindowFrom('today', new Date(queryAt))
  const toTimestamp = Math.floor(queryAt / 1000) + 1
  const request = (async () => {
    try {
      const report = await codexApi.querySessionUsage(fromTimestamp, toTimestamp, { today: fromTimestamp })
      if (epoch !== accountEpoch || sourcesVersion !== usageSourcesVersion) return
      if (localDayKey(new Date(queryAt)) !== localDayKey(new Date())
        || fromTimestamp !== usageWindowFrom('today')) return
      publishToday(report, queryAt)
    } catch {
      // 今日用量只是挂件的第二行；失败保留同一天的旧值，不弹 toast。
    }
  })()
  usageTodayRequest = request
  try { await request } finally {
    if (usageTodayRequest === request) usageTodayRequest = null
  }
}

export async function loadUsage(): Promise<void> {
  if (usageBusy.value) return
  usageBusy.value = true
  usageError.value = ''
  const epoch = accountEpoch
  try {
    // 挂件先发起的扫描也要等待，避免同时争抢磁盘与 WSL 通道。
    if (usageTodayRequest) await usageTodayRequest
    // 一次扫描产出四个范围；扫描期间可继续切换，完成后只展示当前选择。
    while (epoch === accountEpoch) {
      const range = usageRange.value
      const sourcesVersion = usageSourcesVersion
      const queryAt = Date.now()
      const fromTimestamp = usageWindowFrom(range, new Date(queryAt))
      const toTimestamp = Math.floor(queryAt / 1000) + 1
      const windows = Object.fromEntries(USAGE_RANGES.map(key => [key, usageWindowFrom(key, new Date(queryAt))]))
      try {
        const report = await codexApi.querySessionUsage(fromTimestamp, toTimestamp, windows)
        if (epoch !== accountEpoch) return
        if (localDayKey(new Date(queryAt)) !== localDayKey(new Date())
          || USAGE_RANGES.some(key => windows[key] !== usageWindowFrom(key))
          || sourcesVersion !== usageSourcesVersion) continue
        for (const key of USAGE_RANGES) {
          const snapshot = key === range ? report : report.windows?.[key]
          if (!snapshot) continue
          const cachedReport = { ...snapshot }
          delete cachedReport.windows
          usageWindowCache.set(key, { report: cachedReport, updatedAt: queryAt, fromTimestamp: windows[key] })
        }
        adoptCachedToday()
        if (showCachedUsage(usageRange.value)) return
      } catch (e) {
        if (epoch !== accountEpoch) return
        if (range !== usageRange.value || localDayKey(new Date(queryAt)) !== localDayKey(new Date())
          || fromTimestamp !== usageWindowFrom(range) || sourcesVersion !== usageSourcesVersion) continue
        usageError.value = errText(e)
        return
      }
    }
  } finally {
    if (epoch === accountEpoch) usageBusy.value = false
  }
}

/** 四个窗口共享同一截止快照，切换直接显示；手动及定时刷新才重新统计。 */
export async function setUsageRange(range: UsageRange): Promise<void> {
  if (usageRange.value === range) return
  usageRange.value = range
  usageError.value = ''
  if (showCachedUsage(range)) return
  await loadUsage()
}

/** 会话被移走或恢复，官方目录少了一份或多一份文件，图的账随之变；标脏后下次进档重扫 */
export function invalidateUsage(): void {
  usageSourcesVersion++
  usageWindowCache.clear()
  usageReport.value = null
  usageUpdatedAt.value = null
  usageToday.value = null
  usageTodayUpdatedAt.value = null
}

