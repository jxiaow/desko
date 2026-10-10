<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  bypassApi,
  VERDICT_LABEL,
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

const askDelete = (t: BypassTarget) => {
  confirmStore.showConfirm('确认删除', `确定将「${hostOf(t)}」移出清单？`, async () => {
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
const verdictClass = (v: string) =>
  v === 'directOk'
    ? 'live'
    : v === 'unreachable'
      ? 'bad'
      : v === 'needRoute' || v === 'egressUnknown'
        ? 'warn'
        : 'key'

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

/* 行展开只念库里存的那句结论，不再跑一次网络；要新结论走行首的重新探测 */
function rowNote(t: BypassTarget) {
  const head = t.note || '暂无探测结论'
  // 「需要写入 hosts 或系统路由」只对缺固定/缺路由两态成立；不可达、出口未确定不给出写入建议
  if (t.verdict === 'hostsOnly' || t.verdict === 'needRoute') {
    return `${head}。该条目需要写入 hosts 文件或系统路由，当前版本仅登记目标，不代为写入。`
  }
  return head
}
</script>

<template>
  <div class="content-inner">
    <div class="page-bar">
      <label class="probe-box">
        <AppIcon name="search" :size="14" />
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
    </div>

    <!-- 小账：本模块只登记目标，写入 hosts 与系统路由的链路尚未实现，所以「待写入」指清单里仍需人工处理的条数 -->
    <div v-if="status" class="bp-status" :class="{ bad: !!status.hostsError }">
      <span v-if="status.hostsError">hosts 托管区无法读取</span>
      <span v-else>hosts 托管区 {{ status.managedHosts }} 条</span>
      <span class="sep">·</span>
      <span>清单 {{ status.total }} 条</span>
      <span class="sep">·</span>
      <span>待写入 {{ status.pending }} 条</span>
      <span class="sep">·</span>
      <span>固定地址失效 {{ status.stale }} 条</span>
      <span v-if="status.hostsError" class="bp-status-err">{{ status.hostsError }}</span>
      <label v-if="targets.length" class="bp-filter">
        <AppIcon name="search" :size="13" />
        <input v-model="filter" type="text" spellcheck="false" placeholder="筛选" aria-label="按名称筛选清单" />
      </label>
    </div>

    <!-- 清单 -->
    <div v-if="loading" class="rowlist" aria-hidden="true">
      <div class="skeleton-row" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <div v-else-if="targets.length" class="rowlist">
      <template v-for="t in shown" :key="t.id">
        <div class="bp-row" :class="{ on: openRowId === t.id }">
          <button class="row-main" type="button" :aria-expanded="openRowId === t.id" @click="toggleRow(t)">
            <span class="row-host mono" :title="t.host">{{ hostOf(t) }}</span>
            <span class="chip" :class="verdictClass(t.verdict)">
              <span class="dot" aria-hidden="true"></span>
              {{ verdictLabel(t.verdict) }}
            </span>
            <span class="row-meta mono" :title="`上次探测 ${fmtTime(t.checkedAt)}`">
              {{ t.address || '—' }}
              <span v-if="t.interfaceName">· 出口 {{ t.interfaceName }}</span>
              <span v-if="t.stale" class="row-stale">· 固定地址已失效</span>
            </span>
          </button>
          <div class="row-acts">
            <button class="ib" type="button" title="重新探测" :disabled="busyRowId !== null" @click="recheckRow(t)">
              <AppIcon name="refresh" :size="14" />
            </button>
            <button class="ib" type="button" title="更多操作" @click="openMenu(t, $event)">
              <AppIcon name="dots" :size="14" />
            </button>
          </div>
        </div>

        <!-- 就地展开：判定依据跟在行后，动作只留「改原文重探」，重探的快捷位已在行首 -->
        <div v-if="openRowId === t.id" class="row-card">
          <p class="row-note">{{ rowNote(t) }}</p>
          <div class="row-facts">
            <span class="mono">实际地址 {{ t.address || '—' }}</span>
            <span>出口接口 {{ t.interfaceName || '—' }}</span>
            <span>网关 {{ t.nextHop || '—' }}</span>
            <span :title="fmtTime(t.checkedAt)">探测时间 {{ fmtTime(t.checkedAt) }}</span>
          </div>
          <div class="row-edit">
            <span class="row-edit-label">原始输入</span>
            <input
              v-model="draftInput"
              class="mono"
              type="text"
              spellcheck="false"
              aria-label="该条目的原始输入"
              @keyup.enter="applyEdit(t)"
            />
            <button
              class="action-btn"
              type="button"
              :disabled="busyRowId !== null || !draftInput.trim() || draftInput.trim() === t.input"
              @click="applyEdit(t)"
            >
              <AppIcon name="refresh" :size="13" />
              保存并重新探测
            </button>
          </div>
        </div>
      </template>

      <div v-if="!shown.length" class="bp-nohit">
        没有名称包含「{{ filter }}」的条目
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-icon"><AppIcon name="navBypass" :size="24" /></div>
      <div class="empty-title">清单为空</div>
      <div class="empty-desc">本模块用于让指定域名绕过代理直连。先输入目标进行探测，确认判定后再加入清单。</div>
    </div>

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
            <span class="chip" :class="verdictClass(report.verdict)">
              <span class="dot" aria-hidden="true"></span>
              {{ verdictLabel(report.verdict) }}
            </span>
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
              <span>该操作需要修改 hosts 文件或系统路由，当前版本仅登记目标，不代为写入。</span>
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

    <PopoverMenu v-if="menuId" :anchor="menuAnchor" :width="136" @close="closeMenu">
      <button class="pop-item danger" type="button" @click="deleteFromMenu">
        <AppIcon name="trash" :size="14" />
        删除
      </button>
    </PopoverMenu>
  </div>
</template>

<style scoped>
/* 页栏控件走 30px 栏内档；探测框与搜索框同形，宽度随窗口走 */
.probe-box {
  flex: 1 1 320px;
  min-width: 160px;
  height: 30px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
  transition: all var(--transition);
}
.probe-box:focus-within {
  border-color: var(--accent);
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

/* 小账行：一行细字，右侧挂筛选 */
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
.bp-filter {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 24px;
  padding: 0 var(--space-2);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-muted);
}
.bp-filter input {
  width: 96px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-family: inherit;
  font-size: var(--text-2xs);
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

/* 行：52px 一行档，点开合与 ⋯ 同一排；发丝线由 .rowlist 骨架给 */
.bp-row {
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-4);
  transition: background var(--transition);
}
.bp-row:hover { background: var(--bg-surface-hover); }
.bp-row.on { background: var(--bg-surface-hover); }
.row-main {
  flex: 1;
  min-width: 0;
  display: flex;
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
.row-host {
  flex: 0 1 40%;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta {
  flex: 1;
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-meta span { margin-left: 6px; }
.row-stale { color: var(--warning); }
.row-acts { display: flex; align-items: center; gap: var(--space-1); flex-shrink: 0; }
.bp-row .ib { opacity: 0; transition: opacity var(--transition); }
.bp-row:hover .ib,
.bp-row:focus-within .ib,
.bp-row.on .ib { opacity: 1; }
html.hover-suppressed .bp-row:hover .ib { opacity: 0; }

/* 就地展开的那一档：与行同一面板内，靠浅底和内缩区分，不再套一层卡 */
.row-card {
  padding: var(--space-2) var(--space-4) var(--space-4);
  background: var(--sunken);
}
.row-note {
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
  padding: var(--space-5) var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mono { font-family: var(--font-mono); }

/* 判定配色：可用=绿、要钉 hosts=主色、要加路由=警色、不可达=红 */
.chip.key { background: var(--accent-soft); color: var(--accent); }
.chip.key .dot { background: var(--accent); }
.chip.warn { background: var(--warning-soft); color: var(--warning); }
.chip.warn .dot { background: var(--warning); }
.chip.bad { background: var(--danger-soft); color: var(--danger); }
.chip.bad .dot { background: var(--danger); }
</style>
