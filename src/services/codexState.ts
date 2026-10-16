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
} from './api/codex'
import { errText } from './api/backup'
import { settingsApi } from './api/settings'
import { useToastStore } from '../stores/toast'
import { codexQuotaRemaining } from '../utils/codexAccounts'
import { usageWindowFrom, type UsageRange } from '../utils/codexUsage'
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
  credentials: '读取凭据',
  accessToken: '校验访问令牌',
  refreshTokens: '刷新令牌',
  writeCredentials: '写入官方凭据',
  syncSettings: '同步配置',
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
  if (p.type === 'complete' || p.type === 'error' || p.type === 'cancelled') {
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
  recycledAccounts.value = []
  recycledLoaded.value = false
  batchDeleteDialogOpen.value = false
  batchDeleteEmails.clear()
  sessions.value = []
  sessionsLoaded.value = false
  sessionsBusy.value = false
  sessionsError.value = ''
  sessionQuery.value = ''
  sessionSearchMode.value = 'title'
  sessionTokens.value = {}
  sessionOpenGroups.value = new Set()
  sessionOpenId.value = ''
  rescanQueued = false
  trashSessions.value = []
  trashLoaded.value = false
  trashBusy.value = false
  trashError.value = ''
  recycledBusy.value = false
  recycledError.value = ''
  usageReport.value = null
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
async function finishSwitch(providerBefore: string, providerAfter: string, epoch: number): Promise<void> {
  if (epoch !== accountEpoch) return
  const toast = useToastStore()
  if (!providerBefore || !providerAfter || providerBefore === providerAfter) {
    toast.showToast('已切换账号')
    return
  }
  toast.showToast('凭据形态已变，正在修复会话可见性…', 'info')
  try {
    const s = await codexApi.repairSessionVisibility()
    if (epoch !== accountEpoch) return
    const n = s.updatedSqliteRowCount + s.changedRolloutFileCount
    toast.showToast(n > 0 ? `已切换账号，并修复 ${n} 处会话可见性` : '已切换账号，会话可见性无需修复')
  } catch (e) {
    if (epoch !== accountEpoch) return
    toast.showToast(`已切换账号，但会话可见性修复失败：${errText(e)}`, 'error')
  }
}

export async function switchTo(id: string): Promise<boolean> {
  if (busyId.value) return false
  const epoch = accountEpoch
  const toast = useToastStore()
  busyId.value = id
  switchingId.value = id
  try {
    const providerBefore = await readVisibilityProvider()
    if (epoch !== accountEpoch) return false
    await codexApi.switch(id)
    if (epoch !== accountEpoch) return false
    const providerAfter = await readVisibilityProvider()
    if (epoch !== accountEpoch) return false
    await refreshAccounts()
    if (epoch !== accountEpoch) return false
    await finishSwitch(providerBefore, providerAfter, epoch)
    return true
  } catch (e) {
    if (epoch !== accountEpoch) return false
    const text = errText(e)
    if (text.includes('CODEX_START_CANCELLED')) {
      // 取消点有两处：写凭据前=没动过，写完之后=已经改完才报取消，所以只重读列表、不谎称未改动
      await refreshAccounts()
      if (epoch === accountEpoch) toast.showToast('已取消切换，以列表里的「当前」为准')
    } else {
      toast.showToast(text, 'error')
    }
    return false
  } finally {
    if (epoch === accountEpoch) {
      busyId.value = ''
      switchingId.value = ''
      // 收口事件偶尔抢跑或漏发都不该把进度字留在页面上
      switchStep.value = ''
    }
  }
}

/** 切号中点「取消」：只发消歧信号，收口仍由 switchTo 的 catch 做，避免两处各报一次 */
export async function cancelSwitch(id: string): Promise<void> {
  const toast = useToastStore()
  if (switchingId.value !== id) return
  const epoch = accountEpoch
  try {
    await codexApi.cancelSwitch(id)
    if (epoch === accountEpoch && switchingId.value === id) switchStep.value = '正在取消…'
  } catch (e) {
    if (epoch === accountEpoch) toast.showToast(errText(e), 'error')
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

/** 定时器和页同命：进 Codex 页起、离开即清；间隔为 0 或没有账号就不跑 */
export function startQuotaTicker(): void {
  stopQuotaTicker()
  const minutes = quotaRefreshMinutes.value
  if (minutes <= 0) return
  ticker = setInterval(() => {
    if (!accounts.value.length) return
    void refreshQuotas(accounts.value.map((a) => a.id), { silent: true })
  }, minutes * 60_000)
}

export function stopQuotaTicker(): void {
  if (ticker) clearInterval(ticker)
  ticker = null
}

/** 设置页改了间隔：只在定时器本来就在跑的时候按新值重启，否则等下次进 Codex 页起 */
export function syncQuotaTicker(): void {
  if (ticker) startQuotaTicker()
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
export const sessionsLoaded = ref(false)
export const sessionsBusy = ref(false)
/** 非空表示整页读数失败：界面出错误块，不能让它读成「你没有会话」 */
export const sessionsError = ref('')
export const sessionQuery = ref('')
export const sessionSearchMode = ref<'title' | 'content'>('title')
/** 会话 ID → 官方 token 累计；进这一档一次全量预取，展开只补缺 */
export const sessionTokens = ref<Record<string, CodexSessionTokenStats>>({})
/** 组展开态住在这一档而不是面板里：组件被 v-if 卸挂不该把用户翻开的组一起带走 */
export const sessionOpenGroups = ref<Set<string>>(new Set())
export const sessionOpenId = ref('')

/** 全扫期间又来一次（边扫边改搜索词）：先记下，本轮结束立刻补一次，别让新词被吞掉 */
let rescanQueued = false

export async function loadSessions(): Promise<void> {
  if (sessionsBusy.value) {
    rescanQueued = true
    return
  }
  sessionsBusy.value = true
  sessionsError.value = ''
  const epoch = accountEpoch
  try {
    const list = await codexApi.listSessions(
      sessionSearchMode.value === 'title' ? sessionQuery.value : undefined,
      sessionSearchMode.value === 'content' ? sessionQuery.value : undefined,
    )
    if (epoch !== accountEpoch) return
    sessions.value = list
    sessionsLoaded.value = true
  } catch (e) {
    if (epoch !== accountEpoch) return
    sessions.value = []
    sessionsLoaded.value = false
    sessionsError.value = errText(e)
  } finally {
    if (epoch === accountEpoch) sessionsBusy.value = false
  }
  if (epoch !== accountEpoch) return
  // 列表一出来就把全部会话的 token 一次带走：本机实测 67 个 rollout 尾扫 218 ms，
  // 等展开才取等于把合计量永远藏在水下。不 await，别让数字拖慢首屏的目录名。
  if (sessionsLoaded.value) void loadSessionTokens(sessions.value.map((s) => s.sessionId))
  if (rescanQueued) {
    rescanQueued = false
    await loadSessions()
  }
}

/** 顶栏「刷新」：丢掉 token 缓存再重扫，取数由 loadSessions 的全量预取接手 */
export async function reloadSessions(): Promise<void> {
  sessionTokens.value = {}
  await loadSessions()
}

/** 按 id 批量取 token，只问缺的那几条。列表已经出来了，所以失败只留空与 console.warn，不播 toast */
export async function loadSessionTokens(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !sessionTokens.value[id])
  if (!missing.length) return
  const epoch = accountEpoch
  try {
    const records = await codexApi.sessionTokenStats(missing)
    if (epoch !== accountEpoch) return
    const next = { ...sessionTokens.value }
    for (const r of records) next[r.sessionId] = r
    sessionTokens.value = next
  } catch (e) {
    console.warn('会话 token 统计取数失败', e)
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
  return '已彻底删除这条留底'
}

/** 清空的范围等于刚看到的那份清单，别处新删的号不在里面 */
export async function emptyRecycledAccounts(): Promise<string> {
  const epoch = accountEpoch
  const ids = recycledAccounts.value.map((r) => r.id)
  if (!ids.length) return '账号留底已经是空的'
  await codexApi.emptyRecycled(ids)
  if (epoch !== accountEpoch) return ''
  recycledAccounts.value = []
  return `已彻底删除 ${ids.length} 条留底`
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
  return '已放弃这个删除任务，删掉的账号在回收站里可以还原'
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
 * 统计默认目录与配置的额外目录；后端按 (len, mtime) 缓存事件，切窗口只重算不重扫。
 */
export const usageRange = ref<UsageRange>('today')
export const usageReport = ref<CodexSessionUsageReport | null>(null)
export const usageUpdatedAt = ref<number | null>(null)
export const usageBusy = ref(false)
export const usageError = ref('')
let usageSourcesVersion = 0

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
  usageSourcesVersion++
  invalidateUsage()
  usageError.value = ''
  if (refresh) void loadUsage()
}

export async function loadUsage(): Promise<void> {
  if (usageBusy.value) return
  usageBusy.value = true
  usageError.value = ''
  const epoch = accountEpoch
  try {
    // 扫描期间可继续选范围，串行补读最后选中的范围，旧结果不冒充新范围的数据。
    while (epoch === accountEpoch) {
      const range = usageRange.value
      const sourcesVersion = usageSourcesVersion
      const fromTimestamp = usageWindowFrom(range)
      const queryAt = Date.now()
      const toTimestamp = Math.floor(queryAt / 1000) + 1
      try {
        const report = await codexApi.querySessionUsage(fromTimestamp, toTimestamp)
        if (epoch !== accountEpoch) return
        if (range !== usageRange.value || fromTimestamp !== usageWindowFrom(range) || sourcesVersion !== usageSourcesVersion) continue
        usageReport.value = report
        usageUpdatedAt.value = queryAt
        return
      } catch (e) {
        if (epoch !== accountEpoch) return
        if (range !== usageRange.value || fromTimestamp !== usageWindowFrom(range) || sourcesVersion !== usageSourcesVersion) continue
        usageError.value = errText(e)
        return
      }
    }
  } finally {
    if (epoch === accountEpoch) usageBusy.value = false
  }
}

/** 切窗口只换过滤条件：后端的事件缓存还在，不该重读那几百 MB */
export async function setUsageRange(range: UsageRange): Promise<void> {
  if (usageRange.value === range) return
  usageRange.value = range
  usageReport.value = null
  usageUpdatedAt.value = null
  usageError.value = ''
  await loadUsage()
}

/** 会话被移走或恢复，官方目录少了一份或多一份文件，图的账随之变；标脏后下次进档重扫 */
export function invalidateUsage(): void {
  usageReport.value = null
  usageUpdatedAt.value = null
}

