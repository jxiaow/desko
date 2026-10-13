<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import {
  bypassApi,
  inApplyBatch,
  needsApply,
  VERDICT_LABEL,
  type ApplyOutcome,
  type ApplyPlan,
  type BypassStatus,
  type BypassTarget,
  type ProbeReport,
  type Verdict,
} from '../../services/api/bypass'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'
import PopoverMenu from '../shared/PopoverMenu.vue'
import { usePageHeadStore } from '../../stores/pageHead'

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const input = ref('')
/** 两档忙分别闸门：页栏探测、行内动作。混用一个 busy 会让页栏在行重探时报「正在探测」 */
const busyProbe = ref(false)
const busyRowId = ref<string | null>(null)
/** 弹窗里那份结论对应哪份输入：加入按钮只认探过的那个值 */
const probedInput = ref('')
/** 这份结论是否已在清单里（加入、重探都会置上） */
const recorded = ref(false)

const targets = ref<BypassTarget[]>([])
const status = ref<BypassStatus | null>(null)
const loading = ref(true)
const openRowId = ref<string | null>(null)
/** 展开行里那份可编辑的原文，默认从这条已存的原文起写 */
const draftInput = ref('')

const filter = ref('')
const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return targets.value
  return targets.value.filter(
    (t) => t.host.toLowerCase().includes(q) || t.input.toLowerCase().includes(q),
  )
})

/* 行上只留一颗状态旗，按优先级取最高的一颗，其余收进 title 与展开明细：
   四颗信号并排会把名称列顶成一面旗墙，读不出「这一行是谁」。 */
type RowFlag = { label: string; cls: string; tip: string }

function flagsOf(t: BypassTarget): RowFlag[] {
  const flags: RowFlag[] = []
  if (t.applyState === 'failed') flags.push({ label: '写入失败', cls: 'warn', tip: '上次写入未通过校验，原因见结果弹窗' })
  if (t.stale) flags.push({ label: '固定地址已失效', cls: 'warn', tip: 'hosts 里钉的地址已不在实际解析结果里' })
  if (t.cdnLike) flags.push({ label: 'CDN 轮换', cls: 'off', tip: '真址带 CNAME 或多地址轮换，固定后会随节点变化失效' })
  if (t.applyState === 'applied') flags.push({ label: '已写入', cls: 'ok', tip: '已写入 hosts 或系统路由' })
  return flags
}

const rows = computed(() =>
  shown.value.map((t) => {
    const flags = flagsOf(t)
    return {
      t,
      flag: flags[0] ?? null,
      tip: flags.length > 1 ? flags.map((f) => f.label).join(' · ') : (flags[0]?.tip ?? ''),
    }
  }),
)

/* 探测结论走弹窗：这页的主体是清单，结论不许长期占页面 */
const report = ref<ProbeReport | null>(null)

const canRecord = computed(
  () =>
    !!report.value &&
    !recorded.value &&
    // 不可达的不给加入：清单里留死地址，之后每次写入都白试一遍
    report.value.verdict !== 'unreachable' &&
    probedInput.value === input.value.trim(),
)

function closeReport() {
  report.value = null
  probedInput.value = ''
}

useEscapeClose(closeReport, () => !!report.value)

async function loadTargets() {
  try {
    targets.value = await bypassApi.list()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    loading.value = false
  }
}

async function loadStatus() {
  try {
    status.value = await bypassApi.status()
  } catch {
    // 小账读不出来只少一行提示，不值得打断清单
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
  if (!value || busyProbe.value) return
  busyProbe.value = true
  try {
    report.value = await bypassApi.probe(value)
    probedInput.value = value
    recorded.value = false
  } catch (e) {
    report.value = null
    probedInput.value = ''
    toastStore.showToast(errText(e), 'error')
  } finally {
    busyProbe.value = false
  }
}

async function recordCurrent() {
  if (!canRecord.value || busyProbe.value) return
  busyProbe.value = true
  try {
    report.value = await bypassApi.save(probedInput.value)
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
    toastStore.showToast('已加入清单')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busyProbe.value = false
  }
}

/* 重探走的也是那一只弹窗：页面上不留结论位，行本身保持原样 */
async function recheckRow(t: BypassTarget) {
  if (busyRowId.value) return
  busyRowId.value = t.id
  try {
    report.value = await bypassApi.recheck(t.id)
    probedInput.value = report.value.input
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busyRowId.value = null
  }
}

/* 改原文（域名写错、URL 要换端口）→ 按新原文重探，覆盖回这一行 */
async function applyEdit(t: BypassTarget) {
  const value = draftInput.value.trim()
  if (busyRowId.value || !value || value === t.input) return
  busyRowId.value = t.id
  try {
    report.value = await bypassApi.edit(t.id, value)
    probedInput.value = value
    recorded.value = true
    await Promise.all([loadTargets(), loadStatus()])
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busyRowId.value = null
  }
}

function toggleRow(t: BypassTarget) {
  openRowId.value = openRowId.value === t.id ? null : t.id
  draftInput.value = t.input || t.host
}

/* ---------- 落盘：判定已在清单里，写系统攒成一批、共用一次 UAC ---------- */
const plan = ref<ApplyPlan | null>(null)
const planOpen = ref(false)
const busyApply = ref(false)
/** helper 起来到用户答完 UAC 之间没有进度可报，只能明说在等授权 */
const awaitingAuth = ref(false)
const applyResult = ref<ApplyOutcome | null>(null)
/** 有回滚点的那一批；空 = 没有可撤销的写入 */
const rollbackBatch = ref('')
/** 用户在确认弹窗里坚持要钉的 CDN 条目；改了要向后端重算一次账 */
const allowCdn = ref<string[]>([])

const pendingCount = computed(() => targets.value.filter(needsApply).length)
/** 真会进批次的那部分：CDN 轮换的默认不钉，所以按钮不能念「待写入」那个更大的数 */
const batchCount = computed(() => targets.value.filter(inApplyBatch).length)

const resultSummary = computed(() => {
  const items = applyResult.value?.items ?? []
  return {
    ok: items.filter((i) => i.ok && i.changed).length,
    skip: items.filter((i) => i.ok && !i.changed).length,
    bad: items.filter((i) => !i.ok).length,
  }
})

const opLabel = (op: string) => (op === 'pin' ? 'hosts 固定' : '系统路由')

/** 回滚自己没成时写进去的东西还在原地，批次留着让人再撤；回滚成了这些行就不算写过 */
const rolledBackClean = computed(
  () => !!applyResult.value?.rolledBack && !applyResult.value.error,
)

function rowLabelOf(id: string) {
  const t = targets.value.find((x) => x.id === id)
  return t ? hostOf(t) : id
}

/** 确认弹窗里哪一条带 CDN 轮换特征：只有这一种行给「仍要固定」的勾选位 */
function isCdnRow(id: string) {
  return !!targets.value.find((x) => x.id === id)?.cdnLike
}

function closePlan() {
  planOpen.value = false
  plan.value = null
}

useEscapeClose(closePlan, () => planOpen.value)
useEscapeClose(() => {
  applyResult.value = null
}, () => !!applyResult.value)

async function loadRollback() {
  try {
    rollbackBatch.value = await bypassApi.rollbackBatch()
  } catch {
    rollbackBatch.value = ''
  }
}

async function openApplyPlan() {
  if (busyApply.value || busyProbe.value || !pendingCount.value) return
  try {
    plan.value = await bypassApi.plan(allowCdn.value)
    planOpen.value = true
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

const cdnPinned = (id: string) => allowCdn.value.includes(id)

/** 勾选「仍要固定」只影响这一条：批次账目由后端重算，界面不自己加减 */
async function toggleCdn(id: string) {
  allowCdn.value = cdnPinned(id)
    ? allowCdn.value.filter((v) => v !== id)
    : [...allowCdn.value, id]
  try {
    plan.value = await bypassApi.plan(allowCdn.value)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

async function runApply() {
  if (busyApply.value || !plan.value || plan.value.ready === 0) return
  busyApply.value = true
  planOpen.value = false
  awaitingAuth.value = true
  let written: string[] = []
  try {
    const outcome = await bypassApi.apply(allowCdn.value)
    written = [...new Set(outcome.items.map((i) => i.id))]
    if (outcome.cancelled) {
      toastStore.showToast('已取消授权，系统未改动')
    } else if (!outcome.items.length) {
      toastStore.showToast(outcome.error || '没有需要写入的条目', outcome.error ? 'error' : undefined)
    } else if (outcome.items.every((i) => i.ok) && !outcome.rolledBack && !outcome.error) {
      // 全批干净落盘不值得拦一只弹窗，一行 toast 就是完整的账
      // 单位跟页栏和小账对齐，按清单条目数：一条域名可能落两个动作，数动作会和「本批写入 N 项」打架
      const anyChanged = new Map<string, boolean>()
      for (const i of outcome.items) anyChanged.set(i.id, (anyChanged.get(i.id) ?? false) || i.changed)
      const changed = [...anyChanged.values()].filter(Boolean).length
      const idle = anyChanged.size - changed
      toastStore.showToast(`写入完成 ${changed} 项${idle ? `，${idle} 项原本已就位` : ''}`)
    } else {
      applyResult.value = outcome
    }
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    awaitingAuth.value = false
    busyApply.value = false
    await Promise.all([loadTargets(), loadStatus(), loadRollback()])
    // 写完不靠回执自证：这一批逐条重探一遍，判定变了才算真落定
    if (written.length) await revalidateIds(written, true)
  }
}

async function runRevert(batch: string) {
  if (busyApply.value || !batch) return
  busyApply.value = true
  awaitingAuth.value = true
  closeMenu()
  // 撤销之前先记下这一批动了哪些行：撤销会把 applyBatch 抹掉，之后就问不着了
  const ids = targets.value.filter((t) => t.applyBatch === batch).map((t) => t.id)
  try {
    const outcome = await bypassApi.revert(batch)
    if (outcome.cancelled) toastStore.showToast('已取消授权，系统未改动')
    else if (outcome.error) toastStore.showToast(`撤销未完成：${outcome.error}`, 'error')
    else toastStore.showToast('已撤销上次写入')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    awaitingAuth.value = false
    busyApply.value = false
    await Promise.all([loadTargets(), loadStatus(), loadRollback()])
    // 退回原样以后判定该重新算一遍：不重探就会停在「已写入」那半句
    if (ids.length) await revalidateIds(ids, true)
  }
}

const askRevert = () => {
  const batch = rollbackBatch.value
  closeMenu()
  if (!batch) return
  confirmStore.showConfirm(
    '撤销上次写入',
    '将把 hosts 托管区还原到写入前的备份，并删掉那一批加过的持久路由。该操作需要管理员权限，将弹出一次系统确认。',
    () => runRevert(batch),
  )
}

/* 接管方那边的直连名单不归 desko 改：把待写入的目标连行给出去，粘过去就对齐了 */
async function copyPendingList() {
  closeMenu()
  const list = targets.value.filter(needsApply)
  if (!list.length) {
    toastStore.showToast('当前没有待写入的条目')
    return
  }
  try {
    await navigator.clipboard.writeText(list.map((t) => t.host).join('\n'))
    toastStore.showToast(`已复制 ${list.length} 条目标`)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

/* ---------- 重验：逐条串行复用单条重探，出口漂移要整轮才看得出来 ---------- */
const revalidating = ref<{ total: number; done: number } | null>(null)
const stopRequested = ref(false)

async function revalidateIds(ids: string[], quiet = false) {
  if (revalidating.value) {
    stopRequested.value = true
    return
  }
  if (!ids.length) return
  revalidating.value = { total: ids.length, done: 0 }
  stopRequested.value = false
  let failed = 0
  for (const id of ids) {
    if (stopRequested.value) break
    try {
      await bypassApi.recheck(id)
    } catch {
      // 单条探测失败不停整轮：一条挂了不代表其余目标也验不了
      failed += 1
    }
    if (revalidating.value) revalidating.value.done += 1
  }
  revalidating.value = null
  await Promise.all([loadTargets(), loadStatus()])
  // 写完的那一批就地重验是收尾，不再念一遍「重验完成」压掉落盘那行账
  if (!quiet) toastStore.showToast(failed ? `重验结束，${failed} 条探测失败` : '重验完成')
}

const revalidateAll = () => revalidateIds(targets.value.map((t) => t.id))

const askDelete = (t: BypassTarget) => {
  confirmStore.showConfirm('移出清单', `「${hostOf(t)}」将从直连清单移除。`, async () => {
    try {
      await bypassApi.remove(t.id)
      if (openRowId.value === t.id) openRowId.value = null
      await Promise.all([loadTargets(), loadStatus()])
      toastStore.showToast('已删除')
    } catch (e) {
      toastStore.showToast(errText(e), 'error')
    }
  })
}

/* ---------- ⋯ 菜单：快捷位给了行开合，菜单只装低频的删除 ---------- */
const menuId = ref<string | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)
const menuTarget = ref<BypassTarget | null>(null)

function openMenu(t: BypassTarget, e: MouseEvent) {
  if (menuId.value === t.id) {
    closeMenu()
    return
  }
  menuId.value = t.id
  menuTarget.value = t
  menuAnchor.value = e.currentTarget as HTMLElement
}
function closeMenu() {
  menuId.value = null
  menuAnchor.value = null
}
function deleteFromMenu() {
  const t = menuTarget.value
  closeMenu()
  if (t) askDelete(t)
}

/* ---------- 结论读法 ---------- */
/* 判定档只有三张脸：直连已可用（绿）、还差一步（警）、根本连不上（红） */
const verdictClass = (v: string) => (v === 'directOk' ? 'ok' : v === 'unreachable' ? 'bad' : 'warn')

const verdictLabel = (v: string) => VERDICT_LABEL[v as Verdict] ?? v

const addrOf = (r: ProbeReport) => {
  if (r.target.kind === 'cidr') return r.input
  const suffix = r.target.path && r.target.path !== '/' ? r.target.path : ''
  return `${r.target.host}:${r.target.port}${suffix}`
}

const answersOf = (r: ProbeReport) =>
  r.localAnswers.length
    ? r.localAnswers.join('  ') + (r.hijacked ? '（落在接管地址段）' : '')
    : '未解析到地址'

const realOf = (r: ProbeReport) =>
  r.realIps.length
    ? r.realIps.join('  ') + (r.cdnLike ? '（带 CDN 轮换特征）' : '')
    : '未解析到实际地址'

const pinnedOf = (r: ProbeReport) =>
  r.pinned ? r.pinned + (r.stale ? '（固定地址已失效）' : '') : '无记录'

const egressOf = (r: ProbeReport) => {
  const e = r.egress
  if (!e) return '未查询到出口路由'
  return `${e.interface}${e.isTaker ? '（接管方网卡）' : ''} · 源地址 ${e.source} · 网关 ${e.nextHop}`
}

const probeOf = (r: ProbeReport) => {
  if (r.probeMs == null) return '连接失败'
  return r.httpStatus ? `HTTP ${r.httpStatus} · ${r.probeMs}ms` : `TCP 连接成功 · ${r.probeMs}ms`
}

const hostOf = (t: BypassTarget) => {
  if (t.kind !== 'domain' || !t.input) return t.host
  const authority = t.input.startsWith('http') ? t.input.split('://')[1] : t.input
  return authority.split('/')[0]
}

async function copyConclusion() {
  const r = report.value
  if (!r) return
  const text = [
    `${addrOf(r)}　${r.headline}`,
    r.detail,
    `系统解析：${answersOf(r)}`,
    `实际地址：${realOf(r)}`,
    `hosts 记录：${pinnedOf(r)}`,
    `出口路由：${egressOf(r)}`,
    `连通性：${probeOf(r)}`,
    ...r.pending.map((p) => `注意：${p}`),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toastStore.showToast('结论已复制到剪贴板')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : '—')
/* 行内只放得起「月/日 时:分」，完整时间留在 title 上 */
const clockOf = (ms: number) => {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 行展开只念库里存的那句结论，不再跑一次网络；要新结论走行首的重新探测 */
function rowNote(t: BypassTarget) {
  const head = t.note || '暂无探测结论'
  if (t.verdict === 'hostsOnly' || t.verdict === 'needRoute') {
    // 写过的行不能再念「需要写入」：那条判定已被这一批落盘了
    if (t.applyState === 'applied') return `${head}。已写入 hosts 或系统路由。`
    if (t.applyState === 'failed') return `${head}。上次写入未通过校验，原因见结果弹窗，可修正后重新写入。`
    return `${head}。该条目需要写入 hosts 文件或系统路由，可在页栏「写入落盘批次」一并落盘。`
  }
  return head
}

const pageHead = usePageHeadStore()
watchEffect(() => pageHead.setHead('直连清单', targets.value.length ? `${targets.value.length} 项` : ''))
</script>

<template>
  <div class="content-inner">
    <div class="page-bar">
      <label class="probe-box">
        <AppIcon name="link" :size="15" />
        <input
          v-model="input"
          type="text"
          spellcheck="false"
          placeholder="输入域名、URL、IP 或网段"
          aria-label="待探测目标"
          @keyup.enter="probeOnly"
        />
      </label>
      <button class="btn-primary" type="button" :disabled="busyProbe || !input.trim()" @click="probeOnly">
        <AppIcon name="globe" :size="13" />
        {{ busyProbe ? '正在探测' : '开始探测' }}
      </button>
      <!-- 写入是这一页唯一改系统的动作：只有真有账要还时才出这颗钮 -->
      <button
        v-if="pendingCount"
        class="btn-secondary"
        type="button"
        :disabled="busyApply || busyProbe || !!revalidating"
        @click="openApplyPlan"
      >
        <AppIcon name="download" :size="13" />
        {{ awaitingAuth ? '等待授权' : `写入落盘批次 ${batchCount}` }}
      </button>
      <button
        v-if="targets.length"
        class="btn-secondary"
        type="button"
        :disabled="busyApply || busyProbe || (busyRowId !== null && !revalidating)"
        @click="revalidateAll"
      >
        <AppIcon name="refresh" :size="13" />
        {{ revalidating ? (stopRequested ? '正在停止' : `重验 ${revalidating.done}/${revalidating.total}`) : '全量重验' }}
      </button>
      <!-- 筛选是清单的动作，跟着清单的控件档走（32px），不挂在下面那行小账的尾巴上 -->
      <label v-if="targets.length" class="bp-filter">
        <AppIcon name="search" :size="13" />
        <input v-model="filter" type="text" spellcheck="false" placeholder="筛选" aria-label="按名称筛选清单" />
      </label>
    </div>

    <!-- 小账：「待写入」= 判定指向写 hosts/路由且这批还没写成的条数，写过的从这里摘出去，
         否则这个数字永远降不下来。待写入与失效是异常计数，为 0 就不占位；三项全空且清单也空时整条不出，别压着空态念零。 -->
    <div v-if="status && (targets.length || status.managedHosts || status.hostsError)" class="bp-status" :class="{ bad: !!status.hostsError }">
      <span v-if="status.hostsError">hosts 托管区无法读取</span>
      <span v-else>hosts 托管区 {{ status.managedHosts }} 条</span>
      <template v-if="status.pending">
        <span class="sep">·</span>
        <span>待写入 {{ status.pending }} 条</span>
      </template>
      <template v-if="status.stale">
        <span class="sep">·</span>
        <span>固定地址失效 {{ status.stale }} 条</span>
      </template>
      <span v-if="status.hostsError" class="bp-status-err">{{ status.hostsError }}</span>
    </div>

    <!-- 清单：一层面板卡 + 发丝线分行，行按列对齐（名称／地址／出口／判定） -->
    <div v-if="loading" class="bp-panel" aria-hidden="true">
      <div class="bp-row" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <div v-else-if="targets.length" class="bp-panel">
      <template v-for="row in rows" :key="row.t.id">
        <div class="bp-row" :class="{ on: openRowId === row.t.id }">
          <button class="row-main" type="button" :aria-expanded="openRowId === row.t.id" @click="toggleRow(row.t)">
            <span class="bp-name">
              <span class="row-host mono" :title="row.t.host">{{ hostOf(row.t) }}</span>
              <span v-if="row.flag" class="badge bp-flag" :class="row.flag.cls" :title="row.tip">{{ row.flag.label }}</span>
            </span>
            <span class="bp-cell mono" :title="row.t.address || '未解析到实际地址'">{{ row.t.address || '—' }}</span>
            <span
              class="bp-cell"
              :title="`${row.t.interfaceName ? '出口 ' + row.t.interfaceName : '未查询到出口接口'} · 上次探测 ${fmtTime(row.t.checkedAt)}`"
            >
              {{ row.t.interfaceName || '—' }}
            </span>
            <span class="badge" :class="verdictClass(row.t.verdict)">{{ verdictLabel(row.t.verdict) }}</span>
          </button>
          <div class="row-acts">
            <button class="ib" type="button" title="重新探测" :disabled="busyRowId !== null" @click="recheckRow(row.t)">
              <AppIcon name="refresh" :size="14" />
            </button>
            <button class="ib pin" type="button" title="更多操作" @click="openMenu(row.t, $event)">
              <AppIcon name="dots" :size="14" />
            </button>
          </div>
        </div>

        <!-- 就地展开：判定依据跟在行后，动作只留「改原文重探」，重探的快捷位已在行首 -->
        <div v-if="openRowId === row.t.id" class="row-card">
          <div class="row-note-line">
            <p class="row-note">{{ rowNote(row.t) }}</p>
            <span v-for="f in flagsOf(row.t)" :key="f.label" class="badge" :class="f.cls" :title="f.tip">{{ f.label }}</span>
          </div>
          <div class="row-facts">
            <span>网关 {{ row.t.nextHop || '—' }}</span>
            <span :title="fmtTime(row.t.checkedAt)">探测时间 {{ clockOf(row.t.checkedAt) }}</span>
          </div>
          <div class="row-edit">
            <span class="row-edit-label">原始输入</span>
            <input
              v-model="draftInput"
              class="mono"
              type="text"
              spellcheck="false"
              aria-label="该条目的原始输入"
              @keyup.enter="applyEdit(row.t)"
            />
            <button
              class="action-btn primary"
              type="button"
              :disabled="busyRowId !== null || !draftInput.trim() || draftInput.trim() === row.t.input"
              @click="applyEdit(row.t)"
            >
              <AppIcon name="refresh" :size="13" />
              保存并重新探测
            </button>
          </div>
        </div>
      </template>

      <div v-if="!rows.length" class="bp-nohit">
        没有名称包含「{{ filter }}」的条目
      </div>
    </div>

    <div v-else class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="navBypass" :size="24" /></div>
      <div class="empty-title">清单为空</div>
      <div class="empty-desc">让指定域名绕过代理直连。先在上方输入目标探测，确认后再加入清单。</div>
    </div>

    <p v-if="!loading && targets.length" class="page-note">
      <AppIcon name="info" :size="13" />
      写入只改本机 hosts 与持久路由；接管方自己的直连名单需另行同步，行菜单可复制待写入清单。
    </p>

    <!-- 探测结论：新开一只弹窗，页面上不留常驻结论位 -->
    <div v-if="report" class="dialog-overlay" @click.self="closeReport">
      <div class="dialog concl-dialog" role="dialog" aria-modal="true" aria-label="探测结论">
        <div class="dialog-header">
          <h3>探测结论</h3>
          <button class="dialog-close" type="button" title="关闭" @click="closeReport">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <div class="concl-head">
            <span class="badge" :class="verdictClass(report.verdict)">{{ verdictLabel(report.verdict) }}</span>
            <span class="concl-title">{{ report.headline }}</span>
          </div>
          <p class="concl-target mono">{{ addrOf(report) }}</p>
          <p class="concl-detail">{{ report.detail }}</p>
          <dl class="concl-facts">
            <div><dt>系统解析</dt><dd class="mono">{{ answersOf(report) }}</dd></div>
            <div><dt>实际地址</dt><dd class="mono">{{ realOf(report) }}</dd></div>
            <div><dt>hosts 记录</dt><dd class="mono">{{ pinnedOf(report) }}</dd></div>
            <div><dt>出口路由</dt><dd>{{ egressOf(report) }}</dd></div>
            <div><dt>连通性</dt><dd class="mono">{{ probeOf(report) }}</dd></div>
          </dl>
          <ul v-if="report.pending.length || report.recommend" class="concl-pending">
            <li v-for="(p, i) in report.pending" :key="i">
              <AppIcon name="alert" :size="13" />
              <span>{{ p }}</span>
            </li>
            <li v-if="report.recommend">
              <AppIcon name="alert" :size="13" />
              <span>该操作需要修改 hosts 文件或系统路由，加入清单后可在页栏一并写入。</span>
            </li>
          </ul>
        </div>
        <div class="dialog-footer">
          <div class="footer-hints">
            <span class="kbd">Esc</span><span>关闭</span>
          </div>
          <button class="btn-secondary" type="button" @click="copyConclusion">
            <AppIcon name="copy" :size="13" />
            复制结论
          </button>
          <button
            v-if="!recorded"
            class="btn-primary"
            type="button"
            :disabled="!canRecord || busyProbe"
            @click="recordCurrent"
          >
            加入清单
          </button>
        </div>
      </div>
    </div>

    <!-- 写入确认：逐条念「要往系统里动什么」，账对得上才提权，一批共用一次 UAC -->
    <div v-if="planOpen && plan" class="dialog-overlay" @click.self="closePlan">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="写入确认">
        <div class="dialog-header">
          <h3>写入前确认</h3>
          <span v-if="plan.blocked" class="plan-blocked">{{ plan.blocked }} 条不写入</span>
          <button class="dialog-close" type="button" title="关闭" @click="closePlan">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <p class="lead">本批写入 {{ plan.ready }} 项，一次管理员授权落完。</p>
          <ul class="plan-list">
            <li v-for="(r, i) in plan.rows" :key="`${r.id}-${i}`" :class="{ blocked: !!r.blocked }">
              <span class="plan-host mono">{{ r.label }}</span>
              <span class="plan-action mono">{{ r.blocked || r.action }}</span>
              <label v-if="isCdnRow(r.id)" class="plan-cdn">
                <input type="checkbox" :checked="cdnPinned(r.id)" @change="toggleCdn(r.id)" />
                <span>仍要固定</span>
              </label>
            </li>
          </ul>
        </div>
        <div class="dialog-footer">
          <div class="footer-hints">
            <AppIcon name="lock" :size="12" />
            <span>需要管理员权限，将弹出一次系统确认</span>
          </div>
          <button class="btn-secondary" type="button" @click="closePlan">取消</button>
          <button class="btn-primary" type="button" :disabled="plan.ready === 0" @click="runApply">
            确认并写入
          </button>
        </div>
      </div>
    </div>

    <!-- 结果弹窗只在有账要交的时候出：全成功走 toast，不拦人 -->
    <div v-if="applyResult" class="dialog-overlay" @click.self="applyResult = null">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="写入结果">
        <div class="dialog-header">
          <h3>写入结果</h3>
          <button class="dialog-close" type="button" title="关闭" @click="applyResult = null">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <p class="lead">
            成功 {{ resultSummary.ok }} · 跳过 {{ resultSummary.skip }} · 失败 {{ resultSummary.bad }}
          </p>
          <p v-if="applyResult.rolledBack" class="dialog-err">
            <template v-if="rolledBackClean">本批有条目未通过校验，已回滚到写入前的状态。</template>
            <template v-else
              >本批有条目未通过校验，回滚未完成，已写入的部分仍在系统里，可点「撤销本批」重试。备注：{{
                applyResult.error
              }}</template
            >
          </p>
          <p v-else-if="applyResult.error" class="dialog-err">{{ applyResult.error }}</p>
          <ul class="plan-list">
            <li v-for="i in applyResult.items" :key="`${i.op}-${i.id}`" :class="{ blocked: !i.ok }">
              <span class="plan-host mono">{{ rowLabelOf(i.id) }}</span>
              <span class="plan-action mono">
                {{ opLabel(i.op) }}{{ i.ok ? (i.changed ? (rolledBackClean ? ' · 已回滚' : ' · 已写入') : ' · 系统里原本已就位') : ` · ${i.error}` }}
              </span>
            </li>
          </ul>
        </div>
        <div class="dialog-footer">
          <div class="footer-hints">
            <span class="kbd">Esc</span><span>关闭</span>
          </div>
          <button
            v-if="rollbackBatch"
            class="btn-secondary"
            type="button"
            :disabled="busyApply"
            @click="askRevert"
          >
            撤销本批
          </button>
          <button class="btn-primary" type="button" @click="applyResult = null">完成</button>
        </div>
      </div>
    </div>

    <PopoverMenu v-if="menuId" :anchor="menuAnchor" :width="152" @close="closeMenu">
      <button v-if="rollbackBatch" class="pop-item" type="button" @click="askRevert">
        <AppIcon name="undo" :size="14" />
        撤销上次写入
      </button>
      <button class="pop-item" type="button" @click="copyPendingList">
        <AppIcon name="copy" :size="14" />
        复制待写入清单
      </button>
      <button class="pop-item danger" type="button" @click="deleteFromMenu">
        <AppIcon name="trash" :size="14" />
        删除
      </button>
    </PopoverMenu>
  </div>
</template>

<style scoped>
/* 探测框走栏内灰底 inset 档（与 .page-bar .search-box 同配方）。
   它是一页的主入口而不是筛选器，所以吃弹性宽、不设 220px 上限。 */
.probe-box {
  flex: 1 1 320px;
  min-width: 160px;
  height: 32px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border: 0;
  border-radius: var(--radius-ib);
  color: var(--text-muted);
  transition: box-shadow var(--transition);
}
.probe-box:focus-within {
  box-shadow: 0 0 0 3px var(--accent-ring);
}
.probe-box input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-xs);
}
.page-bar .btn-primary { flex-shrink: 0; }

/* 小账行：一行细字 */
.bp-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 var(--space-4) var(--space-2);
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.bp-status .sep { opacity: 0.6; }
.bp-status.bad { color: var(--warning); }
.bp-status-err {
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}
/* 筛选吃页栏的 32px 控件档，与探测框同配方，只是不成长 */
.bp-filter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
  height: 32px;
  padding: 0 var(--space-3);
  background: color-mix(in srgb, var(--text) 7%, transparent);
  border: none;
  border-radius: var(--radius-ib);
  color: var(--text-muted);
}
.bp-filter input {
  width: 88px;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-xs);
}

/* 结论走全站统一弹窗壳：弹窗本身就是那张卡，里面不再套一层 */
.concl-dialog { width: 520px; }
.concl-head { display: flex; align-items: center; gap: var(--space-3); }
.concl-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text);
}
.concl-target {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.concl-detail {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  line-height: 1.65;
  color: var(--text-secondary);
}

.concl-facts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: var(--space-4) 0 0;
  padding: var(--space-3) 0 0;
  border-top: 1px solid var(--border);
}
.concl-facts > div { display: flex; align-items: baseline; gap: var(--space-3); }
.concl-facts dt { flex: 0 0 64px; font-size: var(--text-xs); color: var(--text-muted); }
.concl-facts dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.concl-pending {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: var(--space-3) 0 0;
  padding: var(--space-3) 0 0;
  border-top: 1px dashed var(--border-subtle);
  list-style: none;
}
.concl-pending li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--warning);
}
.concl-pending li svg { flex-shrink: 0; margin-top: 2px; }

/* 面板卡：一层壳 + 发丝线分行，不做卡中卡。行档 48——这一页的行是「一行四列」的表，
   不是「主名 + 一句细字」，64px 档会把单行数据撑成空场。 */
.bp-panel {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  margin-top: var(--space-3);
  padding-top: 2px;
}
.bp-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 48px;
  padding: 0 14px;
}
.bp-panel .bp-row + .bp-row,
.bp-panel .row-card + .bp-row,
.bp-panel .row-card {
  border-top: 1px solid var(--border);
}
.bp-panel .bp-row:hover {
  background: var(--hover);
}

/* 行内表格化：名称+状态旗／地址／出口／判定 四列对齐，判定钉右缘 */
.row-main {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.9fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.bp-name {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  overflow: hidden;
}
.row-host {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 280px;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.row-main > .badge {
  justify-self: end;
}
.bp-flag {
  flex-shrink: 0;
  white-space: nowrap;
}
.row-acts { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; }
/* 行上的快捷钮平时收着，⋯ 那颗常驻——它是这一行唯一的菜单入口 */
.row-acts .ib { opacity: 0; transition: opacity var(--transition); }
.bp-row:hover .ib,
.bp-row:focus-within .ib,
.bp-row.on .ib { opacity: 1; }
.row-acts .ib.pin { opacity: 1; }
html.hover-suppressed .bp-row:hover .ib:not(.pin) { opacity: 0; }

/* 展开的那一段：同一张面板里的凹底，靠发丝顶线与行分开 */
.row-card {
  padding: var(--space-3) 14px var(--space-4);
  background: var(--sunken);
}
.row-note-line {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.row-note {
  flex: 1 1 260px;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-secondary);
}
.row-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: var(--space-3);
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
/* 面板里的行卡不是浮岛，主钮的淡染档要在这一层重给一次 */
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
/* 改原文：输入框走 28px 档，与按钮同高同排 */
.row-edit {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.row-edit-label {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.row-edit input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 var(--space-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: var(--text-xs);
}
.row-edit input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-ring);
}

.bp-nohit {
  padding: var(--space-4) 14px;
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* 写入确认与结果共用同一份两行列法：目标在左、要写的动作或原因在右 */
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}
.plan-list li {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.55;
}
.plan-host {
  flex: 0 1 42%;
  min-width: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.plan-action {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.plan-list li.blocked .plan-action {
  color: var(--warning);
}
/* CDN 那条行的坚持勾选：贴在原因后面，勾上以后同一行改念要写什么 */
.plan-cdn {
  display: inline-flex;
  align-self: center;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  cursor: pointer;
}
/* 头栏右侧那一格计数：说清有几条这轮不写 */
.plan-blocked {
  margin-left: var(--space-2);
  font-size: var(--text-2xs);
  color: var(--warning);
}

.mono { font-family: var(--font-mono); }
</style>
