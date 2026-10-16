<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import {
  bypassApi,
  needsApply,
  type ApplyOutcome,
  type ApplyPlan,
  type BypassStatus,
  type BypassTarget,
  type ProbeReport,
  type RouteOverride,
} from '../../services/api/bypass'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import BypassProbeDialog from './BypassProbeDialog.vue'
import BypassApplyDialogs from './BypassApplyDialogs.vue'
import BypassChipDialog from './BypassChipDialog.vue'
import BypassTargetDetail from './BypassTargetDetail.vue'
import BypassToolbar from './BypassToolbar.vue'
import { usePageHeadStore } from '../../stores/pageHead'
import { useBypassProbe } from './useBypassProbe'
import {
  clockOf,
  faceNote,
  flagsOf,
  hostOf,
  rowNote,
  verdictClass,
  verdictLabel,
  zoneOf,
  type Zone,
} from './bypassView'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const input = ref('')
/** 两档忙分别闸门：页栏探测、行内动作。混用一个 busy 会让页栏在行重探时报「正在探测」 */
const probeTask = useBypassProbe()
const activeProbe = probeTask.active
const probeSeconds = probeTask.elapsed
const saving = ref(false)
const busyProbe = computed(() => saving.value || activeProbe.value?.kind === 'probe')
const busyRowId = computed(() => activeProbe.value?.rowId ?? null)
/** 弹窗里那份结论对应哪份输入：加入按钮只认探过的那个值 */
const probedInput = ref('')
/** 这份结论是否已在清单里（加入、重探都会置上） */
const recorded = ref(false)

const targets = ref<BypassTarget[]>([])
const status = ref<BypassStatus | null>(null)
const loading = ref(true)
const loadError = ref('')
const busyDelete = ref(false)
let mounted = true
onUnmounted(() => {
  mounted = false
  stopRequested.value = true
})
const openRowId = ref<string | null>(null)

/* 筛选只作用于「直连可用」那排 chip：异常卡常驻可见，不参与收拢 */
const filter = ref('')
const matches = (t: BypassTarget, q: string) =>
  !q || t.host.toLowerCase().includes(q) || t.input.toLowerCase().includes(q)

/* ---------- 分区：正常的不配占行，异常才升格成卡 ---------- */
const ZONE_RANK: Record<Zone, number> = { check: 0, write: 1, ok: 2 }
const byName = (a: BypassTarget, b: BypassTarget) => hostOf(a).localeCompare(hostOf(b))

const todoTargets = computed(() =>
  targets.value
    .filter((t) => zoneOf(t) !== 'ok')
    .sort((a, b) => ZONE_RANK[zoneOf(a)] - ZONE_RANK[zoneOf(b)] || byName(a, b)),
)
const okTargets = computed(() =>
  targets.value.filter((t) => zoneOf(t) === 'ok').sort(byName),
)
const okShown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? okTargets.value.filter((t) => matches(t, q)) : okTargets.value
})
const lastOkCheck = computed(() => okTargets.value.reduce((max, t) => Math.max(max, t.checkedAt), 0))

/* 概览：出口按接口分组数一遍，网段单独一档（它不过出口接口） */
const egressText = computed(() => {
  const byIface = new Map<string, number>()
  let cidr = 0
  for (const t of targets.value) {
    if (t.kind === 'cidr') {
      cidr += 1
      continue
    }
    const name = t.interfaceName || '出口未确定'
    byIface.set(name, (byIface.get(name) ?? 0) + 1)
  }
  const buckets = [...byIface.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name} ${n}`)
  if (cidr) buckets.push(`按网段路由 ${cidr}`)
  return buckets.length ? `出口：${buckets.join(' · ')}` : ''
})
const hostsText = computed(() => {
  const s = status.value
  if (!s) return ''
  return s.hostsError ? `无法读取本功能管理的 hosts 记录：${s.hostsError}` : `hosts 管理记录 ${s.managedHosts} 条`
})
const showHero = computed(
  () =>
    targets.value.length > 0 ||
    !!rollbackBatch.value ||
    (!!status.value && (status.value.managedHosts > 0 || !!status.value.hostsError)),
)

/* 探测结论走弹窗：这页的主体是要处理的事，结论不许长期占页面 */
const report = ref<ProbeReport | null>(null)
const existingTarget = computed(() => targets.value.find((t) => t.host === report.value?.target.host))
const operationBusy = computed(() => loading.value || !!loadError.value || saving.value || !!activeProbe.value || busyApply.value || busyPlan.value || busyDelete.value || !!revalidating.value)

const canRecord = computed(
  () =>
    !!report.value &&
    !recorded.value &&
    // 不可达的不给加入：清单里留死地址，之后每次写入都白试一遍
    report.value.verdict !== 'unreachable' &&
    probedInput.value === input.value.trim(),
)
const canConfigureReport = computed(() => recorded.value && !!existingTarget.value
  && !!report.value && ['hostsOnly', 'needRoute'].includes(report.value.verdict)
  && needsApply(existingTarget.value))

function closeReport() {
  if (busyProbe.value || busyPlan.value) return
  report.value = null
  probedInput.value = ''
}


async function loadTargets() {
  try {
    targets.value = await bypassApi.list()
    loadError.value = ''
  } catch (e) {
    loadError.value = errText(e)
  } finally {
    loading.value = false
  }
}

async function retryLoad() {
  loading.value = true
  await Promise.all([loadTargets(), loadStatus(), loadRollback()])
}

async function loadStatus() {
  try {
    status.value = await bypassApi.status()
  } catch {
    // 托管区读不出来只在概览那行改口并给原因，不值得打断清单
    status.value = null
  }
}

onMounted(async () => {
  loadTargets()
  loadStatus()
  loadRollback()
})

/* 探测只出结论，不写库：加入清单是弹窗里的下一步，先看清判定 */
async function probeOnly() {
  const value = input.value.trim()
  if (!value || operationBusy.value) return
  try {
    const next = await probeTask.run('probe', value, (requestId) => bypassApi.probe(value, requestId))
    if (!next || !mounted) return
    report.value = next
    probedInput.value = value
    recorded.value = false
  } catch (e) {
    report.value = null
    probedInput.value = ''
    toastStore.showToast(errText(e), 'error')
  }
}

async function cancelProbe() {
  const batch = activeProbe.value?.kind === 'revalidate'
  if (batch) stopRequested.value = true
  try {
    if (await probeTask.cancel()) {
      if (!batch) toastStore.showToast('已取消探测')
      await Promise.all([loadTargets(), loadStatus()])
    }
  } catch (e) {
    toastStore.showToast(`取消失败：${errText(e)}`, 'error')
  }
}

async function recordCurrent() {
  if (!canRecord.value || operationBusy.value) return
  const updating = !!existingTarget.value
  saving.value = true
  try {
    report.value = await bypassApi.save(probedInput.value)
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
    toastStore.showToast(updating ? '已更新清单' : '已加入清单')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    saving.value = false
  }
}

/* 重探走的也是那一只弹窗：页面上不留结论位，那张卡保持原样 */
async function recheckRow(t: BypassTarget) {
  if (operationBusy.value) return
  try {
    const next = await probeTask.run('row', t.input || t.host, (requestId) => bypassApi.recheck(t.id, requestId), t.id)
    if (!next || !mounted) return
    report.value = next
    probedInput.value = next.input
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

/* 改原文（域名写错、URL 要换端口）→ 按新原文重探，覆盖回这一条 */
async function applyEdit(t: BypassTarget, value: string) {
  const next = value.trim()
  if (operationBusy.value || !next || next === (t.input || t.host)) return
  try {
    const result = await probeTask.run('edit', next, (requestId) => bypassApi.edit(t.id, next, requestId), t.id)
    if (!result || !mounted) return
    report.value = result
    probedInput.value = next
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

function toggleRow(t: BypassTarget) {
  openRowId.value = openRowId.value === t.id ? null : t.id
}

/* ---------- chip 详情弹窗：直连可用的目标不占行，动作全在这只弹窗里 ---------- */
const detailId = ref<string | null>(null)
const detailTarget = computed(() => targets.value.find((t) => t.id === detailId.value) ?? null)
const openDetail = (t: BypassTarget) => {
  if (operationBusy.value) return
  closeMenu()
  detailId.value = t.id
}
const closeDetail = () => {
  detailId.value = null
}
const recheckFromDetail = (t: BypassTarget) => {
  closeDetail()
  void recheckRow(t)
}
const removeFromDetail = (t: BypassTarget) => {
  closeDetail()
  askDelete(t)
}

/* ---------- 落盘：判定已在清单里，写系统攒成一批、共用一次 UAC ---------- */
const plan = ref<ApplyPlan | null>(null)
const planOpen = ref(false)
const busyApply = ref(false)
const busyPlan = ref(false)
let planRequest = 0
/** helper 起来到用户答完 UAC 之间没有进度可报，只能明说在等授权 */
const awaitingAuth = ref(false)
const applyResult = ref<ApplyOutcome | null>(null)
/** 有回滚点的那一批；空 = 没有可撤销的写入 */
const rollbackBatch = ref('')
/** 用户在确认弹窗里坚持要钉的 CDN 条目；改了要向后端重算一次账 */
const allowCdn = ref<string[]>([])
const routeOverrides = ref<RouteOverride[]>([])

const pendingCount = computed(() => targets.value.filter(needsApply).length)

function closePlan() {
  planRequest += 1
  busyPlan.value = false
  planOpen.value = false
  plan.value = null
  allowCdn.value = []
  routeOverrides.value = []
}

async function loadRollback() {
  try {
    rollbackBatch.value = await bypassApi.rollbackBatch()
  } catch {
    rollbackBatch.value = ''
  }
}

async function openApplyPlan() {
  if (operationBusy.value || !pendingCount.value) return
  allowCdn.value = []
  routeOverrides.value = []
  const request = ++planRequest
  busyPlan.value = true
  try {
    const next = await bypassApi.plan([], [])
    if (request !== planRequest || !mounted) return
    plan.value = next
    planOpen.value = true
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    if (request === planRequest) busyPlan.value = false
  }
}

async function configureFromReport() {
  if (!canConfigureReport.value || operationBusy.value) return
  await openApplyPlan()
  if (planOpen.value) closeReport()
}

function retryReport() {
  if (operationBusy.value) return
  const target = recorded.value ? existingTarget.value : undefined
  closeReport()
  if (target) void recheckRow(target)
  else void probeOnly()
}

/** CDN 授权和出口选择共同重算方案；失败时恢复已确认的选项。 */
async function updatePlan(nextAllow: string[], nextRoutes: RouteOverride[]) {
  if (busyPlan.value) return
  const previousAllow = allowCdn.value
  const previousRoutes = routeOverrides.value
  const request = ++planRequest
  allowCdn.value = nextAllow
  routeOverrides.value = nextRoutes
  busyPlan.value = true
  try {
    const next = await bypassApi.plan(nextAllow, nextRoutes)
    if (request !== planRequest || !mounted) return
    allowCdn.value = nextAllow
    routeOverrides.value = nextRoutes
    plan.value = next
  } catch (e) {
    if (request === planRequest && mounted) {
      allowCdn.value = previousAllow
      routeOverrides.value = previousRoutes
      toastStore.showToast(errText(e), 'error')
    }
  } finally {
    if (request === planRequest) busyPlan.value = false
  }
}

function toggleCdn(id: string) {
  const next = allowCdn.value.includes(id) ? allowCdn.value.filter((v) => v !== id) : [...allowCdn.value, id]
  void updatePlan(next, routeOverrides.value)
}

function changeRoute(id: string, value: string) {
  const option = plan.value?.rows.filter((r) => r.id === id).flatMap((r) => r.routeOptions ?? [])
    .find((r) => `${r.interfaceIndex}|${r.gateway}` === value)
  if (value && !option) return
  const next = routeOverrides.value.filter((r) => r.id !== id)
  if (option) next.push({ id, interfaceIndex: option.interfaceIndex, gateway: option.gateway })
  void updatePlan(allowCdn.value, next)
}

async function runApply() {
  if (operationBusy.value || !plan.value || plan.value.ready === 0) return
  busyApply.value = true
  planOpen.value = false
  awaitingAuth.value = true
  let written: string[] = []
  let verifySuccessfulBatch = false
  try {
    const outcome = await bypassApi.apply(allowCdn.value, routeOverrides.value, plan.value.planKey)
    written = outcome.cancelled ? [] : [...new Set(outcome.items.map((i) => i.id))]
    if (outcome.cancelled) {
      toastStore.showToast('已取消授权，系统未改动')
    } else if (!outcome.items.length) {
      toastStore.showToast(outcome.error || '没有需要配置的目标', outcome.error ? 'error' : undefined)
    } else if (outcome.items.every((i) => i.ok) && !outcome.rolledBack && !outcome.error) {
      verifySuccessfulBatch = true
      // 全批干净落盘不值得拦一只弹窗，一行 toast 就是完整的账
      // 单位跟概览对齐，按清单条目数：一条域名可能落两个动作，数动作会和「本批写入 N 项」打架
      const anyChanged = new Map<string, boolean>()
      for (const i of outcome.items) anyChanged.set(i.id, (anyChanged.get(i.id) ?? false) || i.changed)
      const changed = [...anyChanged.values()].filter(Boolean).length
      const idle = anyChanged.size - changed
      toastStore.showToast(`已配置 ${changed} 项${idle ? `，${idle} 项无需更改` : ''}，正在检查连接`)
    } else {
      applyResult.value = outcome
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    awaitingAuth.value = false
    plan.value = null
    allowCdn.value = []
    routeOverrides.value = []
    await Promise.all([loadTargets(), loadStatus(), loadRollback()])
    // 写完不靠回执自证：这一批逐条重探一遍，判定变了才算真落定
    if (written.length) {
      const failed = await revalidateIds(written, true)
      const unresolved = targets.value.filter((t) => written.includes(t.id) && t.verdict !== 'directOk').length
      if (mounted && verifySuccessfulBatch && !stopRequested.value && (failed || unresolved)) {
        toastStore.showToast(`配置已写入，${Math.max(failed, unresolved)} 项尚未确认直连，请重新探测查看原因`, 'error')
      }
    }
    busyApply.value = false
  }
}

async function runRevert(batch: string) {
  if (operationBusy.value || !batch) return
  busyApply.value = true
  awaitingAuth.value = true
  closeMenu()
  // 还原托管区或覆盖网段路由会影响其他条目；成功撤销后复验当前清单。
  const ids = targets.value.map((t) => t.id)
  let reverted = false
  try {
    const outcome = await bypassApi.revert(batch)
    if (outcome.cancelled) toastStore.showToast('已取消授权，系统未改动')
    else if (outcome.error || !outcome.rolledBack || outcome.items.some((i) => !i.ok)) {
      toastStore.showToast(`撤销未完成：${outcome.error || outcome.items.find((i) => !i.ok)?.error || '系统状态未知'}`, 'error')
    } else {
      applyResult.value = null
      toastStore.showToast('已撤销上次配置')
      reverted = true
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    awaitingAuth.value = false
    await Promise.all([loadTargets(), loadStatus(), loadRollback()])
    // 退回原样以后判定该重新算一遍：不重探就会停在「已写入」那半句
    if (reverted && ids.length) await revalidateIds(ids, true)
    busyApply.value = false
  }
}

const askRevert = () => {
  const batch = rollbackBatch.value
  closeMenu()
  if (!batch || operationBusy.value) return
  confirmStore.showConfirm(
    '撤销上次配置',
    '将恢复本功能管理的 hosts 记录，并移除该次新增的持久路由。需要管理员权限，系统将请求一次确认。',
    () => runRevert(batch),
  )
}

/* 包含已配置的目标，便于在写入后同步代理客户端的直连名单。 */
async function copyTargetList() {
  closeMenu()
  const list = targets.value
  if (!list.length) {
    toastStore.showToast('清单为空')
    return
  }
  try {
    const hosts = [...new Set(list.map((t) => t.host))]
    await navigator.clipboard.writeText(hosts.join('\n'))
    toastStore.showToast(`已复制 ${hosts.length} 条目标`)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

/* ---------- 重验：逐条串行复用单条重探，出口漂移要整轮才看得出来 ---------- */
const revalidating = ref<{ total: number; done: number } | null>(null)
const stopRequested = ref(false)

async function revalidateIds(ids: string[], quiet = false) {
  if (revalidating.value) {
    return 0
  }
  if (!ids.length) return 0
  revalidating.value = { total: ids.length, done: 0 }
  stopRequested.value = false
  let failed = 0
  for (const id of ids) {
    if (stopRequested.value || !mounted) break
    try {
      const t = targets.value.find((t) => t.id === id)
      const next = await probeTask.run('revalidate', t?.input || t?.host || id, (requestId) => bypassApi.recheck(id, requestId), id)
      if (!next) { stopRequested.value = true; break }
    } catch {
      // 单条探测失败不停整轮：一条挂了不代表其余目标也验不了
      failed += 1
    }
    if (revalidating.value) revalidating.value.done += 1
  }
  const done = revalidating.value?.done ?? 0
  await Promise.all([loadTargets(), loadStatus()])
  revalidating.value = null
  // 写完的那一批就地重验是收尾，不再念一遍「重验完成」压掉落盘那行账
  if (mounted && (stopRequested.value || !quiet)) toastStore.showToast(stopRequested.value ? `已停止检查，完成 ${done}/${ids.length} 项${failed ? `，${failed} 项探测失败` : ''}` : failed ? `检查结束，${failed} 项探测失败` : '检查完成')
  return failed
}

const revalidateAll = () => {
  if (revalidating.value) { stopRequested.value = true; void cancelProbe(); return }
  if (!operationBusy.value) void revalidateIds(targets.value.map((t) => t.id))
}

const askDelete = (t: BypassTarget) => {
  if (operationBusy.value) return
  const detail = '此操作只移除清单记录，已配置的 hosts 和路由会保留。' + (t.applyBatch ? '需要清理时，请先撤销相关配置。' : '')
  confirmStore.showConfirm('移出清单', `「${hostOf(t)}」将从网络直连清单移除。${detail}`, async () => {
    if (operationBusy.value) return
    busyDelete.value = true
    try {
      await bypassApi.remove(t.id)
      if (openRowId.value === t.id) openRowId.value = null
      await Promise.all([loadTargets(), loadStatus(), loadRollback()])
      toastStore.showToast('已移出清单')
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    } finally {
      busyDelete.value = false
    }
  })
}

/* ---------- 浮层菜单：卡上的 ⋯ 只装移出，概览的 ⋯ 装整页低频动作 ---------- */
const menuId = ref<string | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)
const menuTarget = ref<BypassTarget | null>(null)
const heroMenuAnchor = ref<HTMLElement | null>(null)

function openMenu(t: BypassTarget, e: MouseEvent) {
  if (menuId.value === t.id) {
    closeMenu()
    return
  }
  menuId.value = t.id
  menuTarget.value = t
  heroMenuAnchor.value = null
  menuAnchor.value = e.currentTarget as HTMLElement
}
function openHeroMenu(e: MouseEvent) {
  if (heroMenuAnchor.value) {
    closeMenu()
    return
  }
  menuId.value = null
  menuAnchor.value = null
  heroMenuAnchor.value = e.currentTarget as HTMLElement
}
function closeMenu() {
  menuId.value = null
  menuAnchor.value = null
  heroMenuAnchor.value = null
}
function deleteFromMenu() {
  const t = menuTarget.value
  closeMenu()
  if (t) askDelete(t)
}

const pageHead = usePageHeadStore()
watchEffect(() => pageHead.setHead('网络直连', targets.value.length ? `${targets.value.length} 项` : ''))
</script>

<template>
  <div class="content-inner network-direct">
    <BypassToolbar
      v-model:input="input"
      :busy="operationBusy"
      :saving="saving"
      :active-probe="activeProbe"
      :seconds="probeSeconds"
      @probe="probeOnly"
      @cancel="cancelProbe"
    />

    <div v-if="loading" class="hero" aria-hidden="true">
      <span class="skeleton-block"></span>
      <span class="skeleton-line w40"></span>
    </div>

    <div v-else-if="loadError" class="rcard empty-state" role="alert">
      <div class="empty-title">清单加载失败</div>
      <div class="empty-desc">{{ loadError }}</div>
      <button class="btn-secondary" type="button" @click="retryLoad">重新加载</button>
    </div>

    <template v-else>
      <!-- 概览：可用数打底，出口分布与托管区账目收成细字，批动作住右端 -->
      <div v-if="showHero" class="hero">
        <div class="hero-num">
          <div v-if="targets.length" class="big">
            <span class="n">{{ okTargets.length }}</span>
            <span class="of">/ <b>{{ targets.length }}</b> 直连可用</span>
          </div>
          <div v-if="egressText || hostsText" class="sub" :class="{ bad: !!status?.hostsError }">
            <span>{{ egressText }}</span>
            <span v-if="egressText && hostsText" class="sep">·</span>
            <span>{{ hostsText }}</span>
          </div>
        </div>
        <div class="hero-acts">
          <button v-if="pendingCount" class="btn-primary" type="button" :disabled="operationBusy" @click="openApplyPlan">
            <AppIcon name="download" :size="14" />
            {{ awaitingAuth ? '正在配置' : busyPlan ? '正在准备' : `配置直连 ${pendingCount}` }}
          </button>
          <button
            v-if="targets.length"
            class="btn-secondary"
            type="button"
            :disabled="revalidating ? busyApply || stopRequested : operationBusy"
            :aria-label="revalidating ? '停止检查' : '检查全部'"
            @click="revalidateAll"
          >
            <AppIcon name="refresh" :size="14" />
            {{ revalidating ? (stopRequested ? '正在停止' : `停止检查 ${revalidating.done}/${revalidating.total}`) : '检查全部' }}
          </button>
          <button
            v-if="targets.length || rollbackBatch"
            class="btn-secondary hero-more"
            type="button"
            title="更多操作"
            :disabled="operationBusy"
            @click="openHeroMenu"
          >
            <AppIcon name="dots" :size="14" />
          </button>
        </div>
      </div>

      <!-- 需要处理：只有异常才配展开成卡 -->
      <template v-if="todoTargets.length">
        <div class="sec-head"><h3>需要处理</h3><span>{{ todoTargets.length }} 项</span></div>
        <div class="rcard-list">
          <div
            v-for="t in todoTargets"
            :key="t.id"
            class="rcard bp-card"
            :class="{ on: openRowId === t.id, probing: busyRowId === t.id }"
          >
            <div class="rcard-row">
              <button class="card-main" type="button" :aria-expanded="openRowId === t.id" @click="toggleRow(t)">
                <span class="l1">
                  <span class="row-host" :title="t.host">{{ hostOf(t) }}</span>
                  <span class="badge" :class="verdictClass(t.verdict)">{{ verdictLabel(t.verdict) }}</span>
                  <span v-for="f in flagsOf(t)" :key="f.label" class="badge" :class="f.cls" :title="f.tip">{{ f.label }}</span>
                </span>
                <span class="l2">
                  <span v-if="t.kind === 'cidr'" class="l2-note">按网段路由，无需 DNS 解析</span>
                  <span v-else class="mono">{{ t.address || '尚未确认实际地址' }}</span>
                  <span v-if="t.interfaceName">出口 {{ t.interfaceName }}</span>
                  <span v-if="faceNote(t)" class="l2-note">{{ faceNote(t) }}</span>
                </span>
              </button>
              <div class="card-acts">
                <button class="action-btn" type="button" title="重新探测" :disabled="operationBusy" @click="recheckRow(t)">
                  <AppIcon name="refresh" :size="13" />
                  重新探测
                </button>
                <button class="action-btn" type="button" title="更多操作" :disabled="operationBusy" @click="openMenu(t, $event)">
                  <AppIcon name="dots" :size="13" />
                </button>
              </div>
            </div>

            <!-- 就地展开：同一颗岛下面接凹底，念库里那句结论，不跑网络 -->
            <div v-if="openRowId === t.id" class="row-card">
              <BypassTargetDetail
                :target="t"
                :note="rowNote(t)"
                :busy="operationBusy"
                @edit="applyEdit(t, $event)"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- 直连可用：收成 chip 一行，动作全在详情弹窗里。一条都没有就不占这段头 -->
      <template v-if="okTargets.length">
        <div class="sec-head">
          <h3>直连可用</h3>
          <span>{{ filter.trim() ? `${okShown.length} / ${okTargets.length}` : `${okTargets.length}` }} 项</span>
          <span class="sec-when" :title="`上次检查 ${clockOf(lastOkCheck)}`">上次检查 {{ clockOf(lastOkCheck) }}</span>
          <label class="bp-filter">
            <AppIcon name="search" :size="14" />
            <input v-model="filter" type="text" spellcheck="false" placeholder="筛选目标" aria-label="按名称筛选清单" />
          </label>
        </div>
        <div v-if="okShown.length" class="chips">
          <button
            v-for="t in okShown"
            :key="t.id"
            class="chip"
            type="button"
            :disabled="operationBusy"
            :title="`${t.address || t.host} · 点击查看结论`"
            @click="openDetail(t)"
          >
            <i class="dot"></i>
            <span>{{ hostOf(t) }}</span>
          </button>
        </div>
        <p v-else class="bp-nohit">没有与「{{ filter }}」匹配的目标</p>
      </template>

      <div v-if="!targets.length" class="rcard empty-state">
        <div class="empty-icon"><AppIcon name="navBypass" :size="24" /></div>
        <div class="empty-title">清单为空</div>
        <div class="empty-desc">管理域名、IPv4 地址和网段的直连配置。先探测并加入清单，再确认配置；探测和加入清单不会修改系统。</div>
      </div>
    </template>

    <p v-if="!loading && targets.length" class="page-note">
      <AppIcon name="info" :size="13" />
      清单显示上次探测结果。网络变化后请重新检查；使用代理时，还需将目标同步到其直连规则。
    </p>

    <BypassProbeDialog
      v-if="report"
      :report="report"
      :recorded="recorded"
      :can-record="canRecord"
      :busy="busyProbe || busyPlan"
      :existing="!!existingTarget"
      :can-configure="canConfigureReport"
      :configure-count="pendingCount"
      @close="closeReport"
      @record="recordCurrent"
      @configure="configureFromReport"
      @retry="retryReport"
    />

    <BypassChipDialog
      v-if="detailTarget"
      :target="detailTarget"
      :note="rowNote(detailTarget)"
      :busy="operationBusy"
      @close="closeDetail"
      @edit="applyEdit(detailTarget, $event)"
      @recheck="recheckFromDetail(detailTarget)"
      @remove="removeFromDetail(detailTarget)"
    />

    <BypassApplyDialogs
      :plan="plan"
      :plan-open="planOpen"
      :busy-plan="busyPlan"
      :busy="operationBusy"
      :apply-result="applyResult"
      :rollback-batch="rollbackBatch"
      :targets="targets"
      :allow-cdn="allowCdn"
      :route-overrides="routeOverrides"
      @close-plan="closePlan"
      @close-result="applyResult = null"
      @apply="runApply"
      @cdn="toggleCdn"
      @route="changeRoute"
      @revert="askRevert"
    />

    <PopoverMenu v-if="menuId" :anchor="menuAnchor" :width="152" @close="closeMenu">
      <button class="pop-item danger" type="button" :disabled="operationBusy" @click="deleteFromMenu">
        <AppIcon name="trash" :size="14" />
        移出清单
      </button>
    </PopoverMenu>

    <PopoverMenu v-if="heroMenuAnchor" :anchor="heroMenuAnchor" :width="160" @close="closeMenu">
      <button v-if="targets.length" class="pop-item" type="button" :disabled="operationBusy" @click="copyTargetList">
        <AppIcon name="copy" :size="14" />
        复制直连清单
      </button>
      <button v-if="rollbackBatch" class="pop-item" type="button" :disabled="operationBusy" @click="askRevert">
        <AppIcon name="undo" :size="14" />
        撤销上次配置
      </button>
    </PopoverMenu>
  </div>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
.page-note { font-size: var(--text-xs); }

/* ---------- 概览 ---------- */
.hero {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
}
.hero-num { min-width: 0; }
.big { display: flex; align-items: baseline; gap: 6px; }
.big .n {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--success);
}
.big .of { font-size: var(--text-md); color: var(--text-muted); }
.big .of b { font-weight: 600; color: var(--text-secondary); }
.sub {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.sub .sep { opacity: 0.6; }
.sub.bad { color: var(--warning); }
.hero-acts { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); flex-shrink: 0; }
.hero-acts button { flex-shrink: 0; }
.hero-more { width: 36px; padding: 0; }

/* ---------- 分区头 ---------- */
.sec-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-4) 2px var(--space-2);
}
.sec-head h3 { margin: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.sec-head span { font-size: var(--text-xs); color: var(--text-muted); }
.sec-head .bp-filter { margin-left: auto; }

/* ---------- 需要处理：一行一颗浮岛，64px 档 ---------- */
.bp-card.on,
.bp-card.probing { border-color: var(--border-hover); }
.bp-card.probing { box-shadow: var(--shadow-card), inset 2px 0 0 var(--accent); }
.card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.l1 { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.row-host {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 320px;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.l2 {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.l2 > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.l2 .mono { color: var(--text-secondary); flex-shrink: 0; }
.card-acts { display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }

/* 展开的那一段：同一颗岛里的凹底，靠发丝顶线与卡面分开 */
.row-card {
  padding: var(--space-3) 14px var(--space-4);
  background: var(--sunken);
  border-top: 1px solid var(--border);
}
/* 面板里的卡不是浮岛行，主钮的淡染档要在这一层重给一次 */
.row-card .action-btn.primary {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--text-brand);
  font-weight: 600;
}
.row-card .action-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: transparent;
  color: var(--text-brand);
}
.row-card .action-btn.primary:active:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}

/* ---------- 直连可用：chip 一行 ---------- */
.chips { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 0 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  font-family: inherit;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.chip:hover:not(:disabled) { border-color: var(--border-hover); }
.chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.bp-filter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 140px;
  height: 32px;
  padding: 0 var(--space-3);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border-radius: var(--radius-ib);
  color: var(--text-muted);
}
.bp-filter:focus-within { box-shadow: 0 0 0 3px var(--accent-ring); }
.bp-filter input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-xs);
}

.bp-nohit { margin: var(--space-2) 2px 0; font-size: var(--text-xs); color: var(--text-muted); }

@media (max-width: 920px) {
  .hero { align-items: flex-start; flex-direction: column; gap: var(--space-3); }
  .hero-acts { margin-left: 0; }
  .card-acts .action-btn { padding: 0 8px; }
}
@media (max-width: 620px) {
  .l2 { flex-wrap: wrap; }
  .card-acts { flex-direction: column; }
}
</style>
