<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { codexApi, type CodexAccount } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import {
  accounts,
  currentId,
  loaded,
  busyId,
  switchStep,
  applySwitchProgress,
  batchDeleteDialogOpen,
  batchDeleteJob,
  sessions,
  sessionsBusy,
  sessionQuery,
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
  type UsageRange,
  type SwitchProgress,
  refreshAccounts,
  refreshQuotas,
  refreshQuotasOnEnter,
  runOn,
  switchTo,
  cancelSwitch,
  loadQuotaSettings,
  startQuotaTicker,
  stopQuotaTicker,
} from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import CodexAuthDialog from './CodexAuthDialog.vue'
import CodexBatchDeleteDialog from './CodexBatchDeleteDialog.vue'
import CodexEditDialog from './CodexEditDialog.vue'
import CodexSessionsPanel from './CodexSessionsPanel.vue'
import CodexTrashPanel from './CodexTrashPanel.vue'
import CodexUsagePanel from './CodexUsagePanel.vue'
import ResetCreditDialog from './ResetCreditDialog.vue'
import { usePageHeadStore } from '../../stores/pageHead'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

/** 同一份官方数据的四档视图：账号（desko 的档案）、会话（官方目录）、回收站（desko 留底）、用量（现扫官方 rollout） */
const view = ref<'accounts' | 'sessions' | 'usage' | 'trash'>('accounts')

const USAGE_RANGES: Array<{ key: UsageRange; label: string }> = [
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

const initial = (a: CodexAccount) => (a.account_name || a.email || '?').trim().charAt(0).toUpperCase()
const picked = (id: string) => selected.value.has(id)

/** 等级徽标：官方凭据里的档位优先，账号档位兜底 */
const tier = (a: CodexAccount) => (a.auth_file_plan_type || a.plan_type || '').trim().toUpperCase()

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
  const plan = (a.plan_type || '').trim().toLowerCase()
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
const expiryBad = (a: CodexAccount) => {
  const at = expiryAt(a)
  return !!at && at <= Date.now()
}

const resetCount = (a: CodexAccount) => a.quota?.reset_credits_available ?? 0
const updatedText = (a: CodexAccount) =>
  a.usage_updated_at ? `更新于 ${clockOf(a.usage_updated_at * 1000)}` : ''

/** 后端 pending 常量只有这一种取值，仍按不区分大小写读，免得上游换写法就漏 */
const pendingAuth = (a: CodexAccount) =>
  (a.authorization_status || '').trim().toLowerCase() === 'pending'

/** last_used 与 created_at 都是 unix 秒；0 表示字段没落地过，宁可不显示也别摆 1970 */
function lastUsedText(a: CodexAccount): string {
  if (a.last_used > 0) return `上次使用 ${clockOf(a.last_used * 1000)}`
  if (a.created_at > 0) return `添加于 ${clockOf(a.created_at * 1000)}`
  return ''
}

/** 配额拉取失败的原因：徽标位放不下长句，挂在「暂无配额」的 title 上 */
const quotaReason = (a: CodexAccount) => a.quota_error?.message?.trim() ?? ''

/** 底行只跟"更紧的那条窗口"走：剩余更少的那个才是用户真正的约束 */
function quotaWhen(a: CodexAccount): string {
  const q = a.quota
  if (!q) return ''
  const hourlyTighter = q.hourly_percentage <= q.weekly_percentage
  const ts = hourlyTighter ? q.hourly_reset_time : q.weekly_reset_time
  if (!ts) return ''
  const ms = ts * 1000 - Date.now()
  if (ms <= 0) return `${hourlyTighter ? '5h' : '周'}即将重置`
  const mins = Math.round(ms / 60000)
  const h = Math.floor(mins / 60)
  const rel =
    h >= 24
      ? h % 24 === 0
        ? `${h / 24}d`
        : `${Math.floor(h / 24)}d ${h % 24}h`
      : h >= 1
        ? mins % 60 === 0
          ? `${h}h`
          : `${h}h ${mins % 60}m`
        : `${mins}m`
  return `${hourlyTighter ? '5h' : '周'}重置 ${rel} · ${clockOf(ts * 1000)}`
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

async function doSwitch(a: CodexAccount) {
  if (busyId.value) return
  // 切号会覆写 ~/.codex 官方凭据文件，属破坏性动作，与档案切换同级先过确认
  confirmStore.showConfirm(
    '切换账号',
    `将把「${a.email}」写入官方凭据文件 ~/.codex。若 Codex 客户端还开着，请先退出它，否则运行中的会话可能继续用旧凭据。`,
    () => switchTo(a.id),
  )
}

async function copyEmail(a: CodexAccount) {
  try {
    await navigator.clipboard.writeText(a.email)
    toastStore.showToast('邮箱已复制')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function exportJson(ids: string[]) {
  if (!ids.length) return
  try {
    const json = await codexApi.exportJson(ids)
    await navigator.clipboard.writeText(json)
    toastStore.showToast(`已导出 ${ids.length} 条账号的 JSON 到剪贴板`)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
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

function askDelete(a: CodexAccount) {
  confirmStore.showConfirm(
    '删除账号',
    `删除 ${a.email}？官方凭据不受影响，Desko 里的这条记录会移进回收站、留一份加密底，之后可以原样恢复。`,
    async () => {
      await runOn(a.id, () => codexApi.remove(a.id), '已移进回收站')
      recycledLoaded.value = false
    },
  )
}

function askBatchDelete() {
  const ids = Array.from(selected.value)
  if (!ids.length) return
  confirmStore.showConfirm(
    '删除账号',
    `删除选中的 ${ids.length} 条账号？官方凭据不受影响，它们在 Desko 里的记录会移进回收站留加密底。这批会作为一条删除任务逐条执行，中途可以暂停。`,
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

onMounted(async () => {
  // 自动刷新的间隔与阈值先落进 state，定时器才能按上一次的选择起
  await loadQuotaSettings()
  if (!active) return
  void refreshAccounts().then(() => {
    if (!active) return
    startQuotaTicker()
    void refreshQuotasOnEnter()
  })
  const stop = await listen<SwitchProgress>('codex:switch-progress', (e) => applySwitchProgress(e.payload))
  if (active) unlisten.push(stop)
  else stop()
})

onUnmounted(() => {
  active = false
  unlisten.forEach((f) => f())
  stopQuotaTicker()
})

const pageHead = usePageHeadStore()
watchEffect(() => {
  if (view.value === 'accounts') {
    pageHead.setHead('Codex', `${accounts.value.length} 个`)
  } else if (view.value === 'sessions') {
    pageHead.setHead('Codex 会话', `${sessions.value.length} 条`)
  } else if (view.value === 'usage') {
    pageHead.setHead('Codex 用量', `${usageReport.value?.totals.requestCount ?? 0} 轮`)
  } else {
    pageHead.setHead('Codex 回收站', `${recycledAccounts.value.length} 个账号 · ${trashSessions.value.length} 条会话`)
  }
})
</script>

<template>
  <div class="content-inner">
    <div v-if="!loaded" class="rcard-list" aria-hidden="true">
      <div class="rcard rcard-row acc-sk" v-for="n in 3" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <template v-else>
      <div class="page-bar">
        <nav class="cx-tabs" aria-label="Codex 视图">
          <button class="cx-tab" :class="{ active: view === 'accounts' }" type="button" @click="view = 'accounts'">
            账号
          </button>
          <button class="cx-tab" :class="{ active: view === 'sessions' }" type="button" @click="view = 'sessions'">
            会话
          </button>
          <button class="cx-tab" :class="{ active: view === 'usage' }" type="button" @click="view = 'usage'">
            用量
          </button>
          <button class="cx-tab" :class="{ active: view === 'trash' }" type="button" @click="view = 'trash'">
            回收站
          </button>
        </nav>

        <template v-if="view === 'accounts'">
          <button class="btn-secondary bar-btn" type="button" :disabled="!accounts.length" @click="refreshQuotas(accounts.map((a) => a.id))">
            <AppIcon name="refresh" :size="13" />
            刷新配额
          </button>
          <button class="btn-secondary bar-btn" type="button" :disabled="!accounts.length" @click="togglePick">
            <AppIcon :name="isBatchMode ? 'check' : 'checkall'" :size="13" />
            {{ isBatchMode ? '退出选择' : '选择' }}
          </button>
          <button class="btn-primary add-btn" type="button" @click="openAddAuth">
            <AppIcon name="plus" :size="13" />
            添加账号
          </button>
        </template>

        <template v-else-if="view === 'sessions'">
          <div class="search-box">
            <span class="search-icon">
              <AppIcon name="search" :size="15" />
            </span>
            <input v-model="sessionQuery" type="text" placeholder="搜索会话标题…" aria-label="搜索会话标题" />
            <button v-if="sessionQuery" class="search-clear" type="button" title="清除搜索" @click="sessionQuery = ''">
              <AppIcon name="x" :size="13" />
            </button>
          </div>
          <button class="btn-secondary bar-btn cx-refresh" type="button" :disabled="sessionsBusy" @click="reloadSessions()">
            <AppIcon name="refresh" :size="13" />
            刷新
          </button>
        </template>

        <template v-else-if="view === 'usage'">
          <nav class="cx-tabs" aria-label="统计窗口">
            <button
              v-for="option in USAGE_RANGES"
              :key="option.key"
              class="cx-tab"
              :class="{ active: usageRange === option.key }"
              type="button"
              @click="setUsageRange(option.key)"
            >
              {{ option.label }}
            </button>
          </nav>
          <button class="btn-secondary bar-btn cx-refresh" type="button" :disabled="usageBusy" @click="loadUsage()">
            <AppIcon name="refresh" :size="13" />
            重新统计
          </button>
        </template>

        <template v-else-if="view === 'trash'">
          <button class="btn-secondary bar-btn cx-refresh" type="button" :disabled="trashBusy || recycledBusy" @click="reloadTrashBin">
            <AppIcon name="refresh" :size="13" />
            刷新
          </button>
        </template>
      </div>

      <CodexSessionsPanel v-if="view === 'sessions'" />
      <CodexUsagePanel v-else-if="view === 'usage'" />
      <CodexTrashPanel v-else-if="view === 'trash'" />

      <p v-if="view === 'accounts' && switchStep" class="switch-line">
        <AppIcon name="refresh" :size="12" />
        {{ switchStep }}
      </p>

      <div v-if="view === 'accounts' && !accounts.length" class="rcard empty-state">
        <div class="empty-icon"><AppIcon name="navCodex" :size="24" /></div>
        <div class="empty-title">还没有 Codex 账号</div>
        <div class="empty-desc">「添加账号」走官方 OAuth；也可以把本机 ~/.codex 里的凭据导进来</div>
      </div>

      <div v-else-if="view === 'accounts'" class="rcard-list">
        <div
          v-for="a in accounts"
          :key="a.id"
          class="rcard rcard-row acc-row"
          :class="{ picked: picked(a.id) }"
          :data-email="a.email"
          @click="onRowClick(a)"
        >
          <span v-if="isBatchMode" class="pick-box" :class="{ on: picked(a.id) }" aria-hidden="true">
            <AppIcon v-if="picked(a.id)" name="check" :size="12" />
          </span>
          <span class="grid-slot acc-ico" :class="{ on: a.id === currentId }">{{ initial(a) }}</span>

          <div class="acc-main">
            <div class="acc-l1">
              <span class="mail" :title="a.email">{{ a.account_name || a.email }}</span>
              <span v-if="a.id === currentId" class="badge own">当前</span>
              <span v-if="a.requires_reauth" class="badge warn" :title="a.reauth_reason || undefined">需重新登录</span>
              <span v-else-if="pendingAuth(a)" class="badge warn" :title="`授权状态：${a.authorization_status}`">待授权</span>
              <span v-if="a.auth_mode === 'apikey'" class="badge off">API Key</span>
              <span v-if="tier(a)" class="tier">{{ tier(a) }}</span>
            </div>

            <div class="acc-l2">
              <span v-if="a.auth_mode !== 'apikey'">团队：{{ teamName(a) }}</span>
              <span v-if="a.auth_mode === 'apikey' && a.api_provider_name">供应商：{{ a.api_provider_name }}</span>
              <span>{{ loginWith(a) }} 登录</span>
              <span v-if="shortId(a.user_id) || shortId(a.account_id)">
                用户 ID：<b class="mono">{{ shortId(a.user_id) || shortId(a.account_id) }}</b>
              </span>
              <span v-if="a.auth_mode === 'apikey' && a.api_base_url">
                Base URL：<b class="mono">{{ a.api_base_url }}</b>
              </span>
            </div>

            <div class="acc-l3">
              <span v-if="expiryText(a)" :class="{ bad: expiryBad(a) }">{{ expiryText(a) }}</span>
              <span v-if="resetCount(a) > 0">可重置 <b class="mono">{{ resetCount(a) }}</b> 次</span>
              <span v-if="lastUsedText(a)">{{ lastUsedText(a) }}</span>
              <span v-if="a.tags?.length">标签：{{ a.tags.join(' / ') }}</span>
              <span v-if="updatedText(a)">{{ updatedText(a) }}</span>
            </div>
          </div>

          <div v-if="a.quota" class="acc-quota">
            <div class="q" :class="{ low: a.quota.hourly_percentage <= 20, mid: a.quota.hourly_percentage <= 40 && a.quota.hourly_percentage > 20 }">
              <span class="q-tag">5h</span>
              <span class="q-bar"><i :style="{ width: Math.max(0, Math.min(100, a.quota.hourly_percentage)) + '%' }"></i></span>
              <span class="q-num">{{ a.quota.hourly_percentage }}%</span>
            </div>
            <div class="q" :class="{ low: a.quota.weekly_percentage <= 20, mid: a.quota.weekly_percentage <= 40 && a.quota.weekly_percentage > 20 }">
              <span class="q-tag">周</span>
              <span class="q-bar"><i :style="{ width: Math.max(0, Math.min(100, a.quota.weekly_percentage)) + '%' }"></i></span>
              <span class="q-num">{{ a.quota.weekly_percentage }}%</span>
            </div>
            <span class="q-when">{{ quotaWhen(a) }}</span>
          </div>
          <div v-else class="acc-quota">
            <span class="q-when" :class="{ bad: a.quota_error }" :title="quotaReason(a)">
              {{ quotaReason(a) ? '配额拉取失败' : '暂无配额' }}
            </span>
          </div>

          <span class="acc-acts">
            <button
              v-if="!isBatchMode && busyId === a.id"
              class="action-btn"
              type="button"
              @click.stop="cancelSwitch(a.id)"
            >
              取消
            </button>
            <button
              v-else-if="!isBatchMode && a.id !== currentId"
              class="action-btn primary"
              type="button"
              :disabled="!!busyId"
              @click.stop="doSwitch(a)"
            >
              切换
            </button>
            <span v-else-if="!isBatchMode" class="cur-mark"><AppIcon name="check" :size="15" /></span>
            <button class="ib acc-more" type="button" title="更多操作" aria-label="更多操作" @click.stop="openMenu($event.currentTarget as HTMLElement, a)">
              <AppIcon name="dots" :size="15" />
            </button>
          </span>
        </div>
      </div>

      <p v-if="view === 'accounts' && accounts.length" class="page-note">
        <AppIcon name="info" :size="13" />
        切号只改写官方凭据文件，Desko 不代你重启 Codex。
      </p>

      <PopoverMenu v-if="view === 'accounts' && menuAccount" :anchor="menuAnchor" :width="176" @close="closeMenu">
        <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.refreshQuota(menuAccount!.id), '配额已刷新'); closeMenu()">
          <AppIcon name="refresh" :size="14" />刷新这一条配额
        </button>
        <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => refreshDetail(menuAccount!), '信息已刷新'); closeMenu()">
          <AppIcon name="user" :size="14" />{{ refreshDetailLabel(menuAccount!) }}
        </button>
        <button class="pop-item" type="button" @click="runOn(menuAccount!.id, () => codexApi.forceRefreshTokens(menuAccount!.id), '令牌已刷新'); closeMenu()">
          <AppIcon name="shield" :size="14" />强制刷新令牌
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
          <AppIcon name="edit" :size="14" />名称与备注
        </button>
        <button class="pop-item" type="button" @click="copyEmail(menuAccount!); closeMenu()">
          <AppIcon name="copy" :size="14" />复制邮箱
        </button>
        <button class="pop-item" type="button" @click="exportJson([menuAccount!.id]); closeMenu()">
          <AppIcon name="download" :size="14" />导出这一条 JSON
        </button>
        <span class="pop-sep"></span>
        <button class="pop-item danger" type="button" @click="askDelete(menuAccount!); closeMenu()">
          <AppIcon name="trash" :size="14" />删除
        </button>
      </PopoverMenu>

      <div v-if="view === 'accounts' && (selected.size || batchDeleteJob)" class="batch-dock">
        <template v-if="selected.size">
          <span class="dock-count">已选 {{ selected.size }} 条</span>
          <button class="dock-btn" type="button" @click="selected = new Set(accounts.map((a) => a.id))">
            <AppIcon name="checkall" :size="12" />全选
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
    <CodexEditDialog v-if="editAccount" :account="editAccount" @close="editAccount = null" />
    <ResetCreditDialog v-if="resetAccount" :account="resetAccount" @close="resetAccount = null" />
    <CodexBatchDeleteDialog v-if="batchDeleteDialogOpen && batchDeleteJob" />
  </div>
</template>

<style scoped>
.content-inner { --font-mono: Consolas, 'Cascadia Mono', monospace; }
.mono { font-family: var(--font-mono); }

.add-btn { margin-left: auto }

/* 页内第二档的切换件：照收藏页分类 tab 的下划线档，去掉滑块——页级换档不是滑动语义 */
.cx-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 2px 0;
  margin-right: var(--space-2);
}
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
/* 会话档的动作只有刷新，推到最右与账号档的「添加账号」同位 */
.cx-refresh { margin-left: auto; }

/* 切号进度：只在切的那几秒出现，一行字，不遮罩整页 */
.switch-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--accent);
}

/* 账号岛：壳（描边/抬影/10px 间隔）由 .rcard 骨架给，这里只给行内配方。
   比 64px 档加高到 88：岛里要放下身份 + 两行事实（归属与登录、时效与标签），
   收成一行会把用户 ID 或有效期挤到省略号后面。 */
.acc-row { min-height: 88px; cursor: default }
.rcard.acc-sk { min-height: 88px }
.acc-row.picked { background: var(--fill) }

.pick-box {
  width: 18px; height: 18px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong, var(--border));
  border-radius: 5px; color: var(--accent-on);
}
.pick-box.on { background: var(--accent); border-color: var(--accent) }

.acc-ico.on { background: var(--accent); color: var(--accent-on) }
.acc-main { flex: 1; min-width: 0 }

/* L1 身份 · L2 身份事实（Team/登录方式/用户 ID） · L3 时效事实（有效期/重置/标签/更新于） */
.acc-l1 { display: flex; align-items: center; gap: 7px; min-width: 0 }
.acc-l1 .mail {
  font-size: var(--text-md); font-weight: 600; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tier {
  flex-shrink: 0;
  font-family: var(--font-mono); font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.06em;
  line-height: 18px; padding: 1px 7px; border-radius: var(--radius-xs);
  background: var(--fill); color: var(--text-secondary);
}
.acc-l2, .acc-l3 { display: flex; align-items: center; gap: 6px; margin-top: 4px; min-width: 0 }
.acc-l2 { font-size: var(--text-xs); color: var(--text-muted) }
.acc-l3 { font-size: var(--text-xs); color: var(--text-secondary) }
.acc-l2 > span, .acc-l3 > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-l2 > span + span::before, .acc-l3 > span + span::before {
  content: '·'; margin-right: 6px; color: var(--text-faint);
}
.acc-l3 .bad { color: var(--warning) }
.acc-l3 b { font-weight: 600; color: var(--text) }

.acc-quota { flex-shrink: 0; width: 152px; display: flex; flex-direction: column; gap: 5px }
.q { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary) }
.q-tag { width: 16px; font-family: var(--font-mono); color: var(--text-faint) }
.q-bar {
  flex: 1; height: 6px; border-radius: 3px; background: var(--fill); overflow: hidden;
}
.q-bar i { display: block; height: 100%; background: var(--success); border-radius: 3px }
.q.mid .q-bar i { background: var(--warning) }
.q.low .q-bar i { background: var(--danger) }
.q-num { width: 34px; text-align: right; font-family: var(--font-mono) }
.q-when { font-size: var(--text-2xs); color: var(--text-faint) }
.q-when.bad { color: var(--warning) }

/* 行尾动作：不给 .grid-acts（那是条目卡的 hover 才显影的一档），这里必须常显 */
.acc-acts { display: flex; align-items: center; gap: 6px; flex-shrink: 0 }
.cur-mark { color: var(--accent); width: 30px; display: flex; justify-content: center }

/* 作业进行中那一条：读的是计数不是动作，所以吃 accent 而不是 danger（删除已经发生了） */
.dock-btn.job { color: var(--accent) }
</style>
