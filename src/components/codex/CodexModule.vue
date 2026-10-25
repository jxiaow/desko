<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch, watchEffect } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { listen } from '../../services/events'
import { writeClipboardText } from '../../utils/clipboard'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  accounts,
  currentId,
  loaded,
  accountsError,
  busyId,
  switchingId,
  switchStep,
  applySwitchProgress,
  batchDeleteDialogOpen,
  batchDeleteJob,
  sessions,
  sessionTotalCount,
  sessionsBusy,
  sessionQuery,
  sessionSearchMode,
  reloadSessions,
  loadRecycled,
  loadTrash,
  loadUsage,
  recycledAccounts,
  recycledBusy,
  recycledLoaded,
  setUsageRange,
  startBatchDelete,
  trashBusy,
  trashSessions,
  usageBusy,
  usageRange,
  usageReport,
  usageError,
  usageReportRange,
  usageUpdatedAt,
  type UsageRange,
  type SwitchProgress,
  refreshAccounts,
  refreshQuotas,
  refreshQuotasOnEnter,
  runOn,
  loadQuotaSettings,
  loadWslAssignment,
  wslAssignment,
  acquireQuotaTicker,
  releaseQuotaTicker,
  codexAccountsViewRequests,
  syncDeleteTicker,
} from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'
import CreateAction from '../shared/CreateAction.vue'
import OptionSelect from '../shared/OptionSelect.vue'
import {
  filterCodexAccounts,
  codexNeedsAttention,
  codexSubscriptionExpired,
  type CodexAccountAuthFilter,
  type CodexAccountStatusFilter,
  type CodexAccountSort,
} from '../../utils/codexAccounts'
import { hiddenCount, prune } from '../../utils/selection'
import PopoverMenu from '../shared/PopoverMenu.vue'
import CodexAuthDialog from './CodexAuthDialog.vue'
import CodexBatchDeleteDialog from './CodexBatchDeleteDialog.vue'
import CodexEditDialog from './CodexEditDialog.vue'
import CodexSessionsPanel from './CodexSessionsPanel.vue'
import CodexTrashPanel from './CodexTrashPanel.vue'
import CodexUsagePanel from './CodexUsagePanel.vue'
import { isWebRuntime, isCodexWebRuntime } from '../../services/runtime'
import CodexSwitchDialog from './CodexSwitchDialog.vue'
import CodexWslAssignDialog from './CodexWslAssignDialog.vue'
import CodexWebEntry from './CodexWebEntry.vue'
import CodexPlanBadge from './CodexPlanBadge.vue'
import CodexQuotaPanel from './CodexQuotaPanel.vue'
import ResetCreditDialog from './ResetCreditDialog.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { usePageActive } from '../../composables/usePageActive'
import { useWorkspaceLayout, workspaceToolbarTarget } from '../layout/workspaceLayout'
import { codexPlan } from '../../utils/codexPlan'
import { usagePosterData, type UsagePosterData } from '../../utils/codexUsagePoster'

const CodexUsageShareDialog = defineAsyncComponent(() => import('./CodexUsageShareDialog.vue'))
const CodexDialogPanel = defineAsyncComponent(() => import('./CodexDialogPanel.vue'))

const pageActive = usePageActive()
const workspaceLayout = useWorkspaceLayout()
const toastStore = useToastStore()
const confirmStore = useConfirmStore()

/** 同一份官方数据的四档视图：账号（desko 的档案）、会话（官方目录）、回收站（desko 留底）、用量（现扫官方 rollout） */
const codexWeb = isCodexWebRuntime()
const view = ref<'accounts' | 'sessions' | 'usage' | 'trash' | 'dialog'>(codexWeb ? 'dialog' : 'accounts')
const poster = shallowRef<UsagePosterData | null>(null)
const canShareUsage = computed(() => !!usageReport.value && usageUpdatedAt.value != null && usageReportRange.value === usageRange.value)
function shareUsage() {
  if (!canShareUsage.value) return
  poster.value = usagePosterData(usageReport.value!, usageReportRange.value, usageUpdatedAt.value!)
}
watch(pageActive, active => { if (!active) poster.value = null })
const locateSessionId = ref('')
function openUsageSession(sessionId: string) {
  sessionQuery.value = ''
  sessionSearchMode.value = 'title'
  locateSessionId.value = sessionId
  view.value = 'sessions'
}

const USAGE_RANGES: Array<{ key: UsageRange; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '近 7 天' },
  { key: 'month', label: '近 30 天' },
  { key: 'all', label: '全部' },
]

const pickMode = ref(false)
const selected = ref<Set<string>>(new Set())
const menuAnchor = ref<HTMLElement | null>(null)
const menuAccount = ref<CodexAccount | null>(null)
const showAuth = ref(false)
/** 非空表示这轮登录是「重新授权」而不是新增 */
const reauthAccountId = ref<string | null>(null)
const editAccount = ref<CodexAccount | null>(null)
const resetAccount = ref<CodexAccount | null>(null)

const openAddAuth = () => {
  reauthAccountId.value = null
  showAuth.value = true
}

const openReauth = (a: CodexAccount) => {
  reauthAccountId.value = a.id
  showAuth.value = true
}

const isBatchMode = computed(() => pickMode.value || selected.value.size > 0)

const accountQuery = ref('')
const accountAuth = ref<CodexAccountAuthFilter>('all')
const accountStatus = ref<CodexAccountStatusFilter>('all')
const accountTag = ref('')
const accountSort = ref<CodexAccountSort>('default')
const showAccountFilters = computed(() => accounts.value.length > 1)
const showSessionFilters = computed(() => sessionTotalCount.value > 1)
const showUsageFilters = computed(() => !!usageReport.value?.totals.fileCount || !!usageError.value || usageRange.value !== 'today')
const visibleAccounts = computed(() => filterCodexAccounts(accounts.value, {
  query: accountQuery.value, auth: accountAuth.value, status: accountStatus.value,
  tag: accountTag.value, sort: accountSort.value,
}))
const accountTags = computed(() => [...new Set(accounts.value.flatMap(a => a.tags ?? []))].sort())
const tagOptions = computed(() => [
  { value: '', label: '全部标签' }, ...accountTags.value.map(tag => ({ value: tag, label: `#${tag}` })),
])
const attentionCount = computed(() => accounts.value.filter(codexNeedsAttention).length)
const accountFiltersActive = computed(() => !!accountQuery.value || accountAuth.value !== 'all' || accountStatus.value !== 'all' || !!accountTag.value)
/** V：此刻排在账号列表里的 id。批量钮的范围就是它；K 只用于披露。 */
const visibleAccountIds = computed(() => visibleAccounts.value.map(a => a.id))
const hiddenSelected = computed(() => hiddenCount(selected.value, visibleAccountIds.value))
/** 藏起来的条数：>0 才说一句，量词按 Codex 的「个」 */
const offScreenSentence = (ids: readonly string[]) => {
  const k = hiddenCount(new Set(ids), visibleAccountIds.value)
  return k > 0 ? `其中 ${k} 个不在当前筛选结果里。` : ''
}

// 账号删掉或回收后，残 id 不能混进下一次批量入参；筛选变化不剪枝——跨筛选攒批是有意保留的。
watch(accounts, list => {
  const next = prune(selected.value, list.map(a => a.id))
  if (next !== selected.value) selected.value = next
}, { flush: 'post' })

function clearAccountFilters() {
  accountQuery.value = ''
  accountAuth.value = 'all'
  accountStatus.value = 'all'
  accountTag.value = ''
}

// 删到只剩一条时清掉隐藏的条件，避免剩余数据被挡住。
watch(showAccountFilters, show => { if (!show) clearAccountFilters() })
watch(showSessionFilters, show => { if (!show) sessionQuery.value = '' })

const initial = (a: CodexAccount) => (a.account_name || a.email || '?').trim().charAt(0).toUpperCase()
const picked = (id: string) => selected.value.has(id)

/** 订阅到期字段两种形状都会出现：ISO 串，或 unix 秒的字符串 */
function parseWhen(raw?: string | null): number | null {
  const v = (raw || '').trim()
  if (!v) return null
  if (/^\d+$/.test(v)) return Number(v) * 1000
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const dateTimeOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const shortId = (v?: string | null) => {
  const s = (v || '').trim()
  if (!s) return ''
  return s.length > 9 ? `${s.slice(0, 8)}…` : s
}

/** Team Name：personal 或非 team 计划一律「个人账户」，team 计划退到组织 ID */
function teamName(a: CodexAccount): string {
  const structure = (a.account_structure || '').trim().toLowerCase()
  const plan = codexPlan(a).kind
  const teamLike = plan === 'team' || plan === 'business' || plan === 'enterprise'
  if (structure.includes('personal') || (!structure && !teamLike)) return '个人账户'
  return shortId(a.organization_id) || '团队账户'
}

/** 官方 id_token 根部的 auth_provider 才说明当初是用什么登进去的（Password/Google/…） */
function decodeAuthProvider(idToken?: string | null): string {
  if (!idToken) return ''
  try {
    const seg = idToken.split('.')[1]
    if (!seg) return ''
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
    const raw = String(json?.auth_provider ?? '').trim()
    if (!raw) return ''
    const known: Record<string, string> = {
      google: 'Google', github: 'GitHub', microsoft: 'Microsoft', apple: 'Apple', password: 'Password',
    }
    return known[raw.toLowerCase()] ?? raw
  } catch {
    return ''
  }
}

const loginWith = (a: CodexAccount) =>
  a.auth_mode === 'apikey' ? 'API Key' : decodeAuthProvider(a.tokens?.id_token) || 'OAuth'

const expiryAt = (a: CodexAccount) => (a.auth_mode === 'apikey' ? null : parseWhen(a.subscription_active_until))
const expiryText = (a: CodexAccount) => {
  const at = expiryAt(a)
  if (!at) return ''
  return at <= Date.now() ? '订阅已过期' : `有效期至 ${dateTimeOf(at)}`
}
const expiryBad = codexSubscriptionExpired

const updatedText = (a: CodexAccount) =>
  a.usage_updated_at ? `额度更新 ${clockOf(a.usage_updated_at * 1000)}` : ''

/** 后端 pending 常量只有这一种取值，仍按不区分大小写读，免得上游换写法就漏 */
const pendingAuth = (a: CodexAccount) =>
  (a.authorization_status || '').trim().toLowerCase() === 'pending'

/** last_used 与 created_at 都是 unix 秒；0 表示字段没落地过，宁可不显示也别摆 1970 */
function lastUsedText(a: CodexAccount): string {
  if (a.last_used > 0) return `上次使用 ${clockOf(a.last_used * 1000)}`
  if (a.created_at > 0) return `添加于 ${clockOf(a.created_at * 1000)}`
  return ''
}

function toggleSelect(id: string) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}

function togglePick() {
  if (isBatchMode.value) {
    pickMode.value = false
    selected.value = new Set()
  } else {
    pickMode.value = true
  }
}

function openMenu(el: HTMLElement, a: CodexAccount) {
  menuAnchor.value = el
  menuAccount.value = a
}

function closeMenu() {
  menuAnchor.value = null
  menuAccount.value = null
}

/** 行点击只在批量态有意义；非批量态点行不做核心动作，避免误触切号 */
function onRowClick(a: CodexAccount) {
  if (isBatchMode.value) toggleSelect(a.id)
}

const switchAccount = shallowRef<CodexAccount | null>(null)
const wslAccount = shallowRef<CodexAccount | null>(null)
const hasWslTargets = computed(() => !!wslAssignment.value?.targets.length)
const wslCurrentId = computed(() => wslAssignment.value?.consistent ? wslAssignment.value.current?.id : null)
function doSwitch(account: CodexAccount) {
  if (!busyId.value) switchAccount.value = account
}
function useInWsl(account: CodexAccount) {
  if (!busyId.value) wslAccount.value = account
  closeMenu()
}

async function copyEmail(a: CodexAccount) {
  try {
    await writeClipboardText(a.email)
    toastStore.showToast('邮箱已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

function exportJson(ids: string[]) {
  if (!ids.length) return
  const selectedIds = [...ids]
  const scope = offScreenSentence(selectedIds)
  confirmStore.showConfirm(
    '导出账号凭据',
    `将 ${selectedIds.length} 个账号的凭据复制到剪贴板，可能含令牌、API Key 和私密资料。其他应用可能读取，请勿分享。${scope}继续导出？`,
    async () => {
      if (!active) return
      try {
        const json = await codexApi.exportJson(selectedIds)
        if (!active) return
        await writeClipboardText(json)
        if (active) toastStore.showToast(`已复制 ${selectedIds.length} 个账号的 JSON`)
      } catch (e) {
        if (active) toastStore.showToast(errText(e), 'error')
      }
    },
  )
}

/** 详情刷新分两条路：OAuth 走订阅接口拿档位与到期，API Key 账号后端会直接拒订阅，只走 profile */
const refreshDetail = (a: CodexAccount) =>
  a.auth_mode === 'apikey' ? codexApi.refreshProfile(a.id) : codexApi.refreshSubscription(a.id)
const refreshDetailLabel = (a: CodexAccount) =>
  a.auth_mode === 'apikey' ? '刷新账号信息' : '刷新订阅信息'

function askResetCredit(a: CodexAccount) {
  // 额度重置一按即扣且不可撤销，先开弹窗把可用次数与明细摆出来看清楚
  resetAccount.value = a
}

function askRefreshTokens(a: CodexAccount) {
  confirmStore.showConfirm(
    '强制刷新令牌',
    `为「${a.email}」获取新令牌并更新已保存的凭据？`,
    () => void runOn(a.id, () => codexApi.forceRefreshTokens(a.id), '令牌已刷新'),
  )
}

function askDelete(a: CodexAccount) {
  confirmStore.showConfirm(
    '删除账号',
    `将 ${a.email} 移入回收站？可恢复，当前 Codex 登录不受影响。`,
    async () => {
      await runOn(a.id, () => codexApi.remove(a.id), '已移进回收站')
      recycledLoaded.value = false
    },
  )
}

function askBatchDelete() {
  const ids = Array.from(selected.value)
  if (!ids.length) return
  const scope = offScreenSentence(ids)
  confirmStore.showConfirm(
    '删除账号',
    `将选中的 ${ids.length} 个账号移入回收站？${scope}可恢复，当前 Codex 登录不受影响。删除过程可暂停。`,
    async () => {
      // 单选与批量共用同一句话术，走的是同一套「先留底再移走」
      selected.value = new Set()
      pickMode.value = false
      recycledLoaded.value = false
      await startBatchDelete(ids)
    },
  )
}

/** dock 上那条作业入口的文案：completed 含失败，所以只有跑完才敢说条数 */
const deleteJobLabel = computed(() => {
  const j = batchDeleteJob.value
  if (!j) return ''
  if (j.status === 'running') return `删除中 ${j.completed} / ${j.total}`
  if (j.status === 'paused') return `删除已暂停 ${j.completed} / ${j.total}`
  if (j.status === 'failed') return `删除结束 · ${j.failed} 条失败`
  return `删除完成 ${j.total} 条`
})

/** 回收站这一档的刷新：两份留底各自一次本地扫描，一起重读 */
function reloadTrashBin() {
  void loadRecycled()
  void loadTrash()
}

let unlisten: UnlistenFn[] = []
let active = true

async function refreshOnEnter() {
  if (codexWeb) return
  // 自动刷新的间隔与阈值先落进 state，定时器才能按上一次的选择起
  await loadQuotaSettings()
  if (!active || !pageActive.value) return
  if (view.value === 'accounts') void loadWslAssignment()
  syncDeleteTicker()
  void refreshAccounts().then(() => {
    if (!active || !pageActive.value) return
    acquireQuotaTicker('codex-page')
    void refreshQuotasOnEnter()
  })
}

onMounted(async () => {
  if (codexWeb) return
  await refreshOnEnter()
  const stop = await listen<SwitchProgress>('codex:switch-progress', (e) => applySwitchProgress(e.payload))
  if (active) unlisten.push(stop)
  else stop()
})

watch(pageActive, visible => {
  if (visible) void refreshOnEnter()
  else releaseQuotaTicker('codex-page')
})

watch(view, value => { if (value === 'accounts' && pageActive.value && !codexWeb) void loadWslAssignment() })

watch(codexAccountsViewRequests, () => {
  if (codexWeb) return
  view.value = 'accounts'
})

onUnmounted(() => {
  active = false
  unlisten.forEach((f) => f())
  releaseQuotaTicker('codex-page')
})

const pageHead = usePageHeadStore()
watchEffect(() => {
  if (!pageActive.value) return
  if (view.value === 'accounts') {
    pageHead.setHead('Codex', `${accounts.value.length} 个`)
  } else if (view.value === 'sessions') {
    pageHead.setHead('Codex 会话', `${sessions.value.length} 条`, '', true)
  } else if (view.value === 'usage') {
    pageHead.setHead('Codex 用量', `${usageReport.value?.totals.requestCount ?? 0} 次请求`, '', true)
  } else if (view.value === 'dialog') {
    pageHead.setHead('Codex 对话', '', codexWeb || !isWebRuntime() ? '工作区改动' : '', true)
  } else {
    pageHead.setHead('Codex 回收站', `${recycledAccounts.value.length} 个账号 · ${trashSessions.value.length} 条会话`)
  }
})
</script>

<template>
  <div class="content-inner" :class="{ 'codex-dialog-view': codexWeb || (loaded && view === 'dialog' && !isWebRuntime()) }">
    <CodexDialogPanel v-if="codexWeb" />
    <div v-else-if="!loaded" class="rcard-list" aria-hidden="true">
      <div class="rcard rcard-row acc-sk" v-for="n in 3" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <template v-else>
      <div :id="workspaceLayout ? 'codex-view-filters' : undefined" class="page-bar" :class="{ 'cx-tabs-row': workspaceLayout }">
        <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
        <nav class="cx-tabs" data-workspace-heading="replace" :class="{ 'cx-header-tabs': workspaceLayout }" aria-label="Codex 视图">
          <button class="cx-tab" :class="{ active: view === 'accounts' }" :aria-pressed="view === 'accounts'" type="button" @click="view = 'accounts'">
            账号
          </button>
          <button class="cx-tab" :class="{ active: view === 'sessions' }" :aria-pressed="view === 'sessions'" type="button" @click="view = 'sessions'">
            会话
          </button>
          <button class="cx-tab" :class="{ active: view === 'usage' }" :aria-pressed="view === 'usage'" type="button" @click="view = 'usage'">
            用量
          </button>
          <button class="cx-tab" :class="{ active: view === 'trash' }" :aria-pressed="view === 'trash'" type="button" @click="view = 'trash'">
            回收站
          </button>
          <button class="cx-tab" :class="{ active: view === 'dialog' }" :aria-pressed="view === 'dialog'" type="button" @click="view = 'dialog'">对话</button>
          <span v-if="workspaceLayout" class="cx-view-count" :title="pageHead.count">{{ pageHead.count }}</span>
        </nav>
        </Teleport>

        <div v-if="workspaceLayout && view === 'accounts' && showAccountFilters" class="account-filters cx-tabs-filters">
          <OptionSelect :model-value="accountAuth" aria-label="账号类型" :options="[
            { value: 'all', label: '全部类型' }, { value: 'oauth', label: 'OAuth' }, { value: 'apikey', label: 'API Key' },
          ]" @update:model-value="accountAuth = String($event) as CodexAccountAuthFilter" />
          <OptionSelect :model-value="accountStatus" aria-label="账号状态" :options="[
            { value: 'all', label: '全部状态' }, { value: 'attention', label: '需处理' },
            { value: 'low', label: '低配额 ≤20%' }, { value: 'expired', label: '订阅已过期' },
          ]" @update:model-value="accountStatus = String($event) as CodexAccountStatusFilter" />
          <OptionSelect v-if="accountTags.length" :model-value="accountTag" aria-label="账号标签" :options="tagOptions" @update:model-value="accountTag = String($event)" />
          <OptionSelect :model-value="accountSort" aria-label="账号排序" :options="[
            { value: 'default', label: '默认排序' }, { value: 'quota', label: '可用配额优先' },
            { value: 'recent', label: '最近使用优先' }, { value: 'name', label: '按名称排序' },
          ]" @update:model-value="accountSort = String($event) as CodexAccountSort" />
        </div>

        <Teleport :to="workspaceToolbarTarget" :disabled="!workspaceLayout || !pageActive" defer>
        <div v-if="view !== 'dialog'" class="cx-band-controls">
        <template v-if="view === 'accounts'">
          <Teleport v-if="showAccountFilters" to="#codex-view-filters" :disabled="!workspaceLayout || !pageActive" defer>
          <div class="search-box">
            <span class="search-icon"><AppIcon name="search" :size="15" /></span>
            <input v-model="accountQuery" type="text" placeholder="搜索邮箱、名称、标签…" aria-label="搜索 Codex 账号" />
            <button v-if="accountQuery" class="search-clear" type="button" aria-label="清除账号搜索" @click="accountQuery = ''"><AppIcon name="x" :size="13" /></button>
          </div>
          </Teleport>
          <div class="page-actions">
            <button class="btn-secondary bar-btn cx-compact-action" type="button" title="刷新配额" aria-label="刷新配额" :disabled="!accounts.length" @click="refreshQuotas(accounts.map((a) => a.id))">
              <AppIcon name="refresh" :size="13" />
              <span class="cx-action-label">刷新配额</span>
            </button>
            <button class="btn-secondary bar-btn cx-compact-action" type="button" :title="isBatchMode ? '退出选择' : '选择'" :aria-label="isBatchMode ? '退出选择' : '选择'" :disabled="!accounts.length" @click="togglePick">
              <AppIcon :name="isBatchMode ? 'check' : 'checkall'" :size="13" />
              <span class="cx-action-label">{{ isBatchMode ? '退出选择' : '选择' }}</span>
            </button>
            <CreateAction class="add-btn" label="添加账号" @click="openAddAuth" />
          </div>
        </template>

        <template v-else-if="view === 'sessions'">
          <Teleport v-if="showSessionFilters" to="#codex-view-filters" :disabled="!workspaceLayout || !pageActive" defer>
          <div class="session-search-mode seg" role="group" aria-label="会话搜索范围">
            <button class="seg-btn" :class="{ on: sessionSearchMode === 'title' }" type="button" :aria-pressed="sessionSearchMode === 'title'" @click="sessionSearchMode = 'title'">标题</button>
            <button class="seg-btn" :class="{ on: sessionSearchMode === 'content' }" type="button" :aria-pressed="sessionSearchMode === 'content'" @click="sessionSearchMode = 'content'">正文</button>
          </div>
          <div class="search-box">
            <span class="search-icon">
              <AppIcon name="search" :size="15" />
            </span>
            <input v-model="sessionQuery" type="text" :placeholder="sessionSearchMode === 'title' ? '搜索会话标题…' : '搜索会话正文…'" :aria-label="sessionSearchMode === 'title' ? '搜索会话标题' : '搜索会话正文'" />
            <button v-if="sessionQuery" class="search-clear" type="button" title="清除搜索" @click="sessionQuery = ''">
              <AppIcon name="x" :size="13" />
            </button>
          </div>
          </Teleport>
          <div class="page-actions">
            <button class="btn-secondary bar-btn cx-refresh" type="button" aria-label="刷新" title="每 30 秒自动刷新" :disabled="sessionsBusy" @click="reloadSessions()">
              <AppIcon name="refresh" :size="13" />
              <span class="cx-action-label">刷新</span>
            </button>
          </div>
        </template>

        <template v-else-if="view === 'usage'">
          <Teleport v-if="showUsageFilters" to="#codex-view-filters" :disabled="!workspaceLayout || !pageActive" defer>
          <nav class="usage-ranges seg" aria-label="统计窗口" :style="{ '--range-index': USAGE_RANGES.findIndex(option => option.key === usageRange) }">
            <span class="usage-range-thumb" aria-hidden="true" />
            <button
              v-for="option in USAGE_RANGES"
              :key="option.key"
              class="seg-btn"
              :class="{ on: usageRange === option.key }"
              :aria-pressed="usageRange === option.key"
              type="button"
              @click="setUsageRange(option.key)"
            >
              {{ option.label }}
            </button>
          </nav>
          </Teleport>
          <div class="page-actions">
            <button class="btn-secondary bar-btn" type="button" title="分享" aria-label="分享" :disabled="!canShareUsage" @click="shareUsage">
              <AppIcon name="image" :size="13" /><span class="cx-action-label">分享</span>
            </button>
            <button class="btn-secondary bar-btn cx-refresh" type="button" aria-label="重新统计" title="每 30 秒自动刷新" :disabled="usageBusy" @click="loadUsage()">
              <AppIcon name="refresh" :size="13" />
              <span class="cx-action-label">重新统计</span>
            </button>
          </div>
        </template>

        <template v-else-if="view === 'trash'">
          <div class="page-actions">
            <button class="btn-secondary bar-btn cx-refresh" type="button" :disabled="trashBusy || recycledBusy" @click="reloadTrashBin">
              <AppIcon name="refresh" :size="13" />
              刷新
            </button>
          </div>
        </template>
        </div>
        </Teleport>
      </div>

      <CodexSessionsPanel v-if="view === 'sessions'" :locate-session-id="locateSessionId" @located="locateSessionId = ''" />
      <CodexUsagePanel v-else-if="view === 'usage'" @open-session="openUsageSession" />
      <CodexTrashPanel v-else-if="view === 'trash'" />
      <template v-else-if="view === 'dialog'">
        <CodexDialogPanel v-if="!isWebRuntime()" />
        <CodexWebEntry v-else />
      </template>

      <p v-if="view === 'accounts' && switchStep" class="switch-line">
        <AppIcon name="refresh" :size="12" />
        {{ switchStep }}
      </p>

      <div v-if="view === 'accounts' && accounts.length && ((!workspaceLayout && showAccountFilters) || accountFiltersActive || attentionCount)" class="account-filters" :class="{ 'account-summary-only': workspaceLayout }">
        <template v-if="!workspaceLayout && showAccountFilters">
          <OptionSelect :model-value="accountAuth" aria-label="账号类型" :options="[
            { value: 'all', label: '全部类型' }, { value: 'oauth', label: 'OAuth' }, { value: 'apikey', label: 'API Key' },
          ]" @update:model-value="accountAuth = String($event) as CodexAccountAuthFilter" />
          <OptionSelect :model-value="accountStatus" aria-label="账号状态" :options="[
            { value: 'all', label: '全部状态' }, { value: 'attention', label: '需处理' },
            { value: 'low', label: '低配额 ≤20%' }, { value: 'expired', label: '订阅已过期' },
          ]" @update:model-value="accountStatus = String($event) as CodexAccountStatusFilter" />
          <OptionSelect v-if="accountTags.length" :model-value="accountTag" aria-label="账号标签" :options="tagOptions" @update:model-value="accountTag = String($event)" />
          <OptionSelect :model-value="accountSort" aria-label="账号排序" :options="[
            { value: 'default', label: '默认排序' }, { value: 'quota', label: '可用配额优先' },
            { value: 'recent', label: '最近使用优先' }, { value: 'name', label: '按名称排序' },
          ]" @update:model-value="accountSort = String($event) as CodexAccountSort" />
        </template>
        <p v-if="accountFiltersActive || attentionCount" class="account-summary">
          <span v-if="accountFiltersActive">{{ visibleAccounts.length }} / {{ accounts.length }} 个账号</span>
          <span v-if="attentionCount">{{ accountFiltersActive ? '· ' : '' }}{{ attentionCount }} 个需处理</span>
          <button v-if="accountFiltersActive" type="button" class="filter-reset" @click="clearAccountFilters">清除筛选</button>
        </p>
      </div>

      <div v-if="view === 'accounts' && !accounts.length" class="rcard empty-state">
        <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
        <div class="empty-title">{{ accountsError ? '无法加载 Codex 账号' : '还没有 Codex 账号' }}</div>
        <div class="empty-desc">{{ accountsError || '添加账号登录，或导入已有凭据' }}</div>
        <button v-if="accountsError" class="action-btn" type="button" @click="refreshAccounts">重试</button>
      </div>

      <div v-else-if="view === 'accounts' && !visibleAccounts.length" class="empty-state">
        <div class="empty-icon"><AppIcon name="searchEmpty" :size="24" /></div>
        <div class="empty-title">没有匹配的账号</div>
        <button class="action-btn" type="button" @click="clearAccountFilters">清除筛选</button>
      </div>

      <div v-else-if="view === 'accounts'" class="rcard-list">
        <div
          v-for="a in visibleAccounts"
          :key="a.id"
          class="rcard rcard-row acc-row"
          :class="{ picked: picked(a.id) }"
          :data-email="a.email"
          @click="onRowClick(a)"
        >
          <button v-if="isBatchMode" class="pick-box" :class="{ on: picked(a.id) }" type="button" :aria-label="`选择 ${a.account_name || a.email}`" :aria-pressed="picked(a.id)" @click.stop="toggleSelect(a.id)">
            <AppIcon v-if="picked(a.id)" name="check" :size="12" />
          </button>
          <span class="grid-slot acc-ico" :class="{ on: a.id === currentId }">{{ initial(a) }}</span>

          <div class="acc-main">
            <div class="acc-l1">
              <span class="mail" :title="[a.account_name, a.email].filter(Boolean).join('\n')">{{ a.account_name || a.email }}</span>
              <span class="acc-badges">
                <span v-if="a.id === currentId" class="badge own">当前</span>
                <span v-if="a.id === wslCurrentId" class="badge wsl"><AppIcon name="terminal" :size="11" />WSL 使用中</span>
                <span v-if="a.requires_reauth" class="badge warn" :title="a.reauth_reason || undefined">需重新登录</span>
                <span v-else-if="pendingAuth(a)" class="badge warn" :title="`授权状态：${a.authorization_status}`">待授权</span>
                <CodexPlanBadge :account="a" />
              </span>
            </div>

            <p v-if="a.account_name && a.account_name !== a.email" class="acc-email" :title="a.email">{{ a.email }}</p>
            <div class="acc-l2">
              <span v-if="a.auth_mode !== 'apikey'" class="acc-fact"><span class="fact-label">工作区：</span><span :title="a.organization_id || undefined">{{ teamName(a) }}</span></span>
              <span v-if="a.auth_mode === 'apikey' && a.api_provider_name" class="acc-fact"><span class="fact-label">供应商：</span><span :title="a.api_provider_name">{{ a.api_provider_name }}</span></span>
              <span class="acc-fact"><span class="fact-label">登录方式：</span><span>{{ loginWith(a) }}</span></span>
              <span v-if="a.auth_mode === 'apikey' && a.api_base_url" class="acc-endpoint">
                <span class="fact-label">Base URL：</span><b class="mono" :title="a.api_base_url">{{ a.api_base_url }}</b>
              </span>
              <span v-if="expiryText(a)" class="acc-fact acc-expiry" :class="{ bad: expiryBad(a) }"><span class="fact-label">订阅：</span><span>{{ expiryText(a) }}</span></span>
            </div>
          </div>

          <CodexQuotaPanel :account="a" />

          <div class="acc-l3">
            <span v-if="lastUsedText(a)">{{ lastUsedText(a) }}</span>
            <span v-if="updatedText(a)">{{ updatedText(a) }}</span>
            <span v-if="a.tags?.length" class="acc-tags" :title="a.tags.join(' / ')">标签：{{ a.tags.join(' / ') }}</span>
          </div>

          <span class="acc-acts">
            <span v-if="!isBatchMode && switchingId === a.id" class="switch-row-status">正在处理…</span>
            <button
              v-else-if="!isBatchMode && a.id !== currentId"
              class="action-btn primary"
              type="button"
              :disabled="!!busyId"
              @click.stop="doSwitch(a)"
            >
              切换
            </button>
            <button class="ib acc-more" type="button" title="更多操作" aria-label="更多操作" @click.stop="openMenu($event.currentTarget as HTMLElement, a)">
              <AppIcon name="dots" :size="15" />
            </button>
          </span>
        </div>
      </div>

      <PopoverMenu v-if="view === 'accounts' && menuAccount" :anchor="menuAnchor" :width="176" @close="closeMenu">
        <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.refreshQuota(menuAccount!.id), '配额已刷新'); closeMenu()">
          <AppIcon name="refresh" :size="14" />刷新配额
        </button>
        <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => refreshDetail(menuAccount!), '信息已刷新'); closeMenu()">
          <AppIcon name="user" :size="14" />{{ refreshDetailLabel(menuAccount!) }}
        </button>
        <button v-if="menuAccount.auth_mode !== 'apikey'" class="pop-item" type="button" @click="askRefreshTokens(menuAccount!); closeMenu()">
          <AppIcon name="shield" :size="14" />强制刷新令牌
        </button>
        <button v-if="hasWslTargets" class="pop-item" type="button" :disabled="!!busyId || menuAccount.auth_mode === 'apikey' || menuAccount.id === wslCurrentId" @click="useInWsl(menuAccount!)">
          <AppIcon :name="menuAccount.id === wslCurrentId ? 'check' : 'terminal'" :size="14" />{{ menuAccount.id === wslCurrentId ? 'WSL 已使用此账号' : '在 WSL 中使用' }}
        </button>
        <button
          v-if="menuAccount.auth_mode !== 'apikey'"
          class="pop-item"
          type="button"
          @click="openReauth(menuAccount!); closeMenu()"
        >
          <AppIcon name="user" :size="14" />重新登录
        </button>
        <button
          v-if="(menuAccount.quota?.reset_credits_available ?? 0) > 0"
          class="pop-item"
          type="button"
          @click="askResetCredit(menuAccount!); closeMenu()"
        >
          <AppIcon name="undo" :size="14" />重置 5 小时额度
        </button>
        <span class="pop-sep"></span>
        <button class="pop-item" type="button" @click="editAccount = menuAccount; closeMenu()">
          <AppIcon name="edit" :size="14" />{{ menuAccount.auth_mode === 'apikey' ? '账号与密钥' : '名称与备注' }}
        </button>
        <button class="pop-item" type="button" @click="copyEmail(menuAccount!); closeMenu()">
          <AppIcon name="copy" :size="14" />复制邮箱
        </button>
        <button class="pop-item" type="button" @click="exportJson([menuAccount!.id]); closeMenu()">
          <AppIcon name="download" :size="14" />导出 JSON
        </button>
        <span class="pop-sep"></span>
        <button class="pop-item danger" type="button" @click="askDelete(menuAccount!); closeMenu()">
          <AppIcon name="trash" :size="14" />删除
        </button>
        <p v-if="hasWslTargets && menuAccount.auth_mode === 'apikey'" class="pop-note">API Key 账号不支持用于 WSL。</p>
      </PopoverMenu>

      <div v-if="view === 'accounts' && (selected.size || batchDeleteJob)" class="batch-dock">
        <template v-if="selected.size">
          <span class="dock-count" :data-tip="hiddenSelected ? `其中 ${hiddenSelected} 个不在当前筛选结果里` : undefined">已选 {{ selected.size }} 条</span>
          <button class="dock-btn" type="button" @click="selected = new Set([...selected, ...visibleAccountIds])">
            <AppIcon name="checkall" :size="12" />{{ accountFiltersActive ? '全选筛选结果' : '全选' }}
          </button>
          <button class="dock-btn" type="button" @click="refreshQuotas(Array.from(selected))">
            <AppIcon name="refresh" :size="12" />刷新配额
          </button>
          <button class="dock-btn" type="button" @click="exportJson(Array.from(selected))">
            <AppIcon name="download" :size="12" />导出所选 JSON
          </button>
          <span class="dock-sep"></span>
          <button class="dock-btn danger" type="button" @click="askBatchDelete">
            <AppIcon name="trash" :size="12" />删除选中
          </button>
          <button class="dock-btn" type="button" @click="togglePick">
            <AppIcon name="check" :size="12" />完成
          </button>
        </template>
        <!-- 作业活过弹窗：收窗只是看不见，这条入口就是重新打开它的把手 -->
        <template v-if="batchDeleteJob">
          <span v-if="selected.size" class="dock-sep"></span>
          <button class="dock-btn job" type="button" @click="batchDeleteDialogOpen = true">
            <AppIcon name="trash" :size="12" />{{ deleteJobLabel }}
          </button>
        </template>
      </div>
    </template>

    <CodexAuthDialog v-if="showAuth" :reauth-account-id="reauthAccountId" @close="showAuth = false; reauthAccountId = null" />
    <CodexSwitchDialog v-if="switchAccount" :account="switchAccount" @close="switchAccount = null" />
    <CodexWslAssignDialog v-if="wslAccount" :account="wslAccount" @close="wslAccount = null" />
    <CodexUsageShareDialog v-if="poster && pageActive && view === 'usage'" :data="poster" @close="poster = null" />
    <CodexEditDialog v-if="editAccount" :account="editAccount" @close="editAccount = null" />
    <ResetCreditDialog v-if="resetAccount" :account="resetAccount" @close="resetAccount = null" />
    <CodexBatchDeleteDialog v-if="batchDeleteDialogOpen && batchDeleteJob" />
  </div>
</template>

<style scoped>
.badge.wsl { display: inline-flex; align-items: center; gap: 3px; color: var(--text-secondary); border: 1px solid var(--border); background: transparent; }
.switch-row-status { color: var(--text-muted); font-size: var(--text-xs); }
.pop-note { padding: 8px; margin: 4px 0 0; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: var(--text-xs); line-height: 1.55; }
.pop-item:disabled { opacity: 1; color: var(--text-muted); cursor: default; }

.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }

.account-filters { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-3); }
.account-summary { flex-basis: 100%; display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-muted); }
.filter-reset { margin-left: auto; border: none; background: transparent; color: var(--accent); cursor: pointer; font: inherit; }
.account-filters :deep(.opt-trigger) { min-width: 100px; max-width: 160px; background: var(--bg-canvas-input); border: none; border-radius: var(--radius-ib); }
.account-filters :deep(.opt-value) { min-width: 0; white-space: nowrap; }
.session-search-mode, .usage-ranges { display: flex; align-items: center; flex-shrink: 0; gap: 2px; }
.usage-ranges { position:relative; display:grid; grid-template-columns:repeat(4,1fr); gap:0; margin-left:8px; padding:2px; border-radius:var(--radius-sm); background:var(--fill); isolation:isolate; }
.usage-range-thumb { position:absolute; z-index:-1; top:2px; bottom:2px; left:2px; width:calc((100% - 4px) / 4); border-radius:var(--radius-sm); background:var(--hover-chrome); transform:translateX(calc(var(--range-index) * 100%)); transition:transform 180ms cubic-bezier(.2,.7,.2,1); }
/* 工具栏不在 .dialog 内，需显式使用与弹窗分段选择一致的样式。 */
.session-search-mode > button, .usage-ranges > button {
  display: inline-flex;
  align-items: center;
  height: 30px;
  padding: 0 11px;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-muted);
  font-family: inherit;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.session-search-mode > button:hover:not(.on), .usage-ranges > button:hover:not(.on) { color: var(--text-secondary); }
.session-search-mode > button.on, .usage-ranges > button.on { background: var(--hover-chrome); color: var(--text); font-weight: 600; }
.usage-ranges > button { justify-content:center; min-width:60px; padding:0 8px; font-size:var(--text-xs); }
.usage-ranges > button.on { background:transparent; font-weight:500; }
@media (prefers-reduced-motion: reduce) { .usage-range-thumb { transition:none; } }
/* 搜索框随工具栏伸缩，桌面使用共享上限，浏览器保留原有宽度。控制带行与页栏同族，一起认领。 */
:is(.page-bar, .cx-band-controls) .search-box { flex: 1; min-width: 140px; max-width: var(--page-search-max, 320px); }

/* 页内第二档的切换件：照收藏页分类 tab 的下划线档，去掉滑块——页级换档不是滑动语义 */
.cx-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 2px 0;
  margin-right: var(--space-2);
}
/* 工作区顶栏承载视图切换与操作，搜索和周期回到当前内容的筛选区。 */
.cx-band-controls { display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; }
.page-bar > .cx-band-controls { display: contents; }
.account-filters.cx-tabs-filters { order: 1; flex: 0 0 auto; max-width: 100%; margin: 0; padding: 0; }
.cx-band-controls > .usage-ranges { margin-left: 0; }
@container codex-controls (max-width: 300px) {
  .cx-compact-action { --toolbar-action-padding: 0px; width: 32px; justify-content: center; }
  .cx-compact-action .cx-action-label { display: none; }
  #workspace-page-toolbar .page-actions { gap: 4px; }
  #workspace-page-toolbar .create-action { padding-inline: 10px; gap: 6px; }
}
.account-summary-only { margin-bottom: var(--space-2); }
.cx-tab {
  position: relative;
  height: 30px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-tag);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: 1.5;
  color: var(--text-muted);
  cursor: pointer;
}
.cx-tab:hover { color: var(--text-secondary); background: var(--hover-chrome); }
.cx-tab.active { color: var(--text); font-weight: 600; }
.cx-tab.active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}

/* 内容区只承载当前视图的筛选条件，搜索与账号筛选同行，空间不足时换行。 */
.cx-tabs-row { position: static; min-height: 56px; padding: 12px 0; margin: 0; flex-wrap: wrap; justify-content: flex-start; gap: 8px; background: transparent; }
.cx-tabs-row:empty { display: none; }
.cx-tabs-row > .search-box { flex: 1 1 180px; min-width: 180px; max-width: var(--page-search-max); margin: 0; }
.cx-tabs-row > .usage-ranges { margin-left: 0; }
.cx-tabs-row:not(:empty) + :is(.rcard-list, .empty-state, .usg-view, .sess-view, .thr-view) { margin-top: var(--space-3); }

/* 页签统一点击区域与字距，保留下划线选中态，与顶栏的 32px 控件同高。 */
#workspace-page-toolbar > .cx-header-tabs { height: 100%; gap: 4px; padding: 0; margin: 0 16px 0 0; pointer-events: none; }
.cx-header-tabs .cx-tab { height: 32px; padding: 0 12px; border-radius: var(--radius-ib); font-size: var(--text-sm); pointer-events: auto; }
.cx-header-tabs .cx-tab:hover:not(.active) { background: var(--hover-chrome); }
.cx-header-tabs .cx-tab.active { font-weight: 600; }
.cx-header-tabs .cx-tab.active::after { left: 12px; right: 12px; }
.cx-view-count { max-width: 100px; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: var(--text-xs); }
#workspace-page-toolbar > .cx-band-controls { container: codex-controls / inline-size; }
/* 800px 窗口里顶栏只剩 440 左右，五个视图页签按常规字距会把新建入口挤出右缘。 */
@container workspace-toolbar (max-width: 520px) {
  #workspace-page-toolbar > .cx-header-tabs { gap: 2px; margin-right: 8px; }
  .cx-header-tabs .cx-tab { padding: 0 8px; }
  .cx-header-tabs .cx-tab.active::after { left: 8px; right: 8px; }
}
@container workspace-toolbar (max-width: 880px) {
  .cx-view-count { display: none; }
}

/* 切号进度：只在切的那几秒出现，一行字，不遮罩整页 */
.switch-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--accent);
}

/* 身份、周期额度各占一列；使用记录与标签在独立页脚。 */
.acc-row {
  display: grid;
  grid-template-columns: 34px minmax(0, .85fr) minmax(0, 1.15fr) 78px;
  align-items: start;
  gap: var(--space-3);
  min-height: 138px;
  padding: 14px 16px;
  cursor: default;
}
.acc-row:has(.pick-box) { grid-template-columns: 18px 34px minmax(0, .85fr) minmax(0, 1.15fr) 78px; }
.rcard.acc-sk { min-height: 138px }
.acc-row.picked { background: var(--fill) }

.pick-box {
  width: 18px; height: 18px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 5px; color: var(--accent-on);
  background: transparent; cursor: pointer;
  margin-top: 8px;
}
.pick-box.on { background: var(--accent); border-color: var(--accent) }

.acc-ico { margin-top: 2px; }
.acc-ico.on { background: var(--accent); color: var(--accent-on) }
.acc-main { min-width: 0 }
.acc-quota { grid-column: 3 / -1; grid-row: 1; }
.acc-row:has(.pick-box) .acc-quota { grid-column: 4 / -1; }

/* 邮箱独立成行；属性与时间使用间距分隔，换行后不留悬空分隔点。 */
.acc-l1 { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px; min-width: 0 }
.acc-l1 .mail {
  min-width: 0; max-width: 100%;
  font-size: var(--text-md); font-weight: var(--weight-card-title); color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-badges { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.acc-badges:empty { display: none; }
.acc-email {
  margin: 3px 0 0;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acc-l2 { display: grid; gap: 4px; margin-top: 9px; min-width: 0; font-size: var(--text-xs); line-height: 1.5; color: var(--text-secondary); }
.acc-fact, .acc-endpoint { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 3px; min-width: 0; }
.acc-fact > span, .acc-fact b, .acc-endpoint b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fact-label { color: var(--text-muted); }
.acc-l2 b { font-weight: 400; }
.acc-expiry.bad, .acc-expiry.bad .fact-label { color: var(--warning); }
.acc-expiry > span:last-child { overflow: visible; white-space: normal; }
.acc-l3 { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-width: 0; padding-top: 9px; border-top: 1px solid var(--border); font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted); }
.acc-l3 > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acc-tags { margin-left: auto; max-width: 45%; }
.acc-row:has(.pick-box) .acc-l3 { grid-column: 3 / -1; }

/* 行尾动作：不给 .grid-acts（那是条目卡的 hover 才显影的一档），这里必须常显 */
.acc-acts { grid-column: 4; grid-row: 1; display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-height: 28px; }
.acc-row:has(.pick-box) .acc-acts { grid-column: 5; }

/* 作业进行中那一条：读的是计数不是动作，所以吃 accent 而不是 danger（删除已经发生了） */
.dock-btn.job { color: var(--accent) }

@media (max-width: 850px) {
  .page-bar { flex-wrap: wrap; }
  .acc-row { grid-template-columns: 34px minmax(0, 1fr) 78px; row-gap: 12px; }
  .acc-main { grid-column: 2; }
  .acc-l2 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 20px; }
  .acc-expiry, .acc-endpoint { grid-column: 1 / -1; }
  .acc-acts { grid-column: 3; grid-row: 1; }
  .acc-quota { grid-column: 2 / -1; grid-row: 2; }
  .acc-l3 { grid-row: 3; }
  .acc-tags { max-width: 100%; margin-left: 0; }
  .acc-row:has(.pick-box) { grid-template-columns: 18px 34px minmax(0, 1fr) 78px; }
  .acc-row:has(.pick-box) .acc-main { grid-column: 3; }
  .acc-row:has(.pick-box) .acc-acts { grid-column: 4; }
  .acc-row:has(.pick-box) .acc-quota { grid-column: 3 / -1; }
}
</style>
