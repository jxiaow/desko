<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CodexUsageBucket } from '../../services/api/codex'
import { loadUsage, usageBusy, usageError, usageRange, usageReportRange, usageReport, usageUpdatedAt } from '../../services/codexState'
import { formatTokenCount as compact, formatUsageCost, formatUsageCostDetail, localDayKey } from '../../utils/codexUsage'
import { writeClipboardText } from '../../utils/clipboard'
import { useToastStore } from '../../stores/toast'
import { errText } from '../../services/api/backup'
import AppIcon from '../shared/AppIcon.vue'
import CodexUsageNotes from './CodexUsageNotes.vue'
import CodexLoadingSkeleton from './CodexLoadingSkeleton.vue'
import CodexDailyUsageChart from './CodexDailyUsageChart.vue'
import CodexTodayUsageChart from './CodexTodayUsageChart.vue'
import { usePageAutoRefresh } from '../../composables/usePageAutoRefresh'

const emit = defineEmits<{ openSession: [sessionId: string] }>()
const toast = useToastStore()
async function copySessionId(id: string) {
  try {
    await writeClipboardText(id)
    toast.showToast('会话 ID 已复制')
  } catch (error) { toast.showToast(errText(error), 'error') }
}
const shortSessionId = (id: string) => id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id

onMounted(() => {
  scheduleDayRefresh()
})

let dayTimer: ReturnType<typeof setTimeout>
function scheduleDayRefresh() {
  const now = new Date()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  dayTimer = setTimeout(() => {
    void loadUsage()
    scheduleDayRefresh()
  }, next.getTime() - now.getTime() + 100)
}
onUnmounted(() => clearTimeout(dayTimer))
usePageAutoRefresh(loadUsage, () => usageBusy.value, { immediate: true })

const num = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const days = computed(() => usageReport.value?.byDay.slice(-30) ?? [])
const dailyRows = computed(() => [...days.value].reverse())
const models = computed(() => usageReport.value?.byModel ?? [])
const openModel = ref('')
const modelSessions = (model: string) => usageReport.value?.modelSessions?.[model] ?? []
const sessionTime = (timestamp: number) => new Date(timestamp * 1000).toLocaleString('zh-CN', { hour12: false })
const totals = computed(() => usageReport.value?.totals ?? null)
const parts = computed(() => totals.value ? [
  { key: 'fresh', label: '净输入', value: freshInput(totals.value) },
  { key: 'cached', label: '缓存命中', value: totals.value.cachedInputTokens },
  { key: 'output', label: '输出', value: totals.value.outputTokens },
] : [])
const partsTotal = computed(() => parts.value.reduce((sum, part) => sum + part.value, 0))
const share = (value: number) => partsTotal.value > 0 ? value / partsTotal.value * 100 : 0
const ranges = { today: '今日用量', week: '近 7 天用量', month: '近 30 天用量', all: '全部用量' }
const scope = computed(() => ranges[usageReportRange.value])
const updatedDay = computed(() => localDayKey(new Date(usageUpdatedAt.value ?? Date.now())))
const period = computed(() => {
  const from = usageReport.value?.fromTimestamp
  if (usageReportRange.value === 'all') return '全部本地会话记录'
  const start = from == null ? updatedDay.value : localDayKey(new Date(from * 1000))
  const startClock = from == null ? '00:00' : new Date(from * 1000).toTimeString().slice(0, 5)
  return usageReportRange.value === 'today' ? `${start} · 本地时间 ${startClock} 起` : `${start} 至 ${updatedDay.value} · 本地时间`
})
const updatedTime = computed(() => {
  const date = new Date(usageUpdatedAt.value ?? Date.now())
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
})
const scanSeconds = computed(() => ((usageReport.value?.scanMillis ?? 0) / 1000).toFixed(1))

function freshInput(bucket: Pick<CodexUsageBucket, 'inputTokens' | 'cachedInputTokens'>): number {
  return Math.max(0, bucket.inputTokens - bucket.cachedInputTokens)
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

</script>

<template>
  <div class="usg-view" :aria-busy="usageBusy">
    <div v-if="usageError && !totals" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <h1 class="empty-title">读不到用量</h1>
      <div class="empty-desc" :title="usageError">{{ usageError }}</div>
      <button class="action-btn primary" type="button" @click="loadUsage()">重试</button>
    </div>

    <CodexLoadingSkeleton v-else-if="!totals" variant="usage" />

    <template v-else>
      <p v-if="usageBusy && usageReportRange !== usageRange" class="page-note" role="status">正在读取{{ ranges[usageRange] }}，暂显示{{ scope }}。</p>
      <p v-if="usageError" class="page-note" role="status">刷新失败，显示上次统计：{{ usageError }}</p>
      <section class="rcard usg-sum" :aria-label="scope">
        <div class="usg-heading">
          <h1>{{ scope }}</h1>
          <span class="usg-period">{{ period }}</span>
        </div>
        <div class="usg-overview">
          <div class="usg-sum-main">
            <span class="usg-num" :title="`${num(totals.totalTokens)} Token`">{{ compact(totals.totalTokens) }}</span>
            <span class="usg-sum-label">总 Token</span>
            <span class="usg-cost">估算金额 <b :title="formatUsageCostDetail(totals.estimatedCostUsd)">{{ formatUsageCost(totals.estimatedCostUsd) }}</b></span>
          </div>
          <dl class="usg-metrics composition-legend">
            <div v-for="part in parts" :key="part.key" class="usg-metric" :data-metric="part.key">
              <dt>{{ part.label }} <span class="metric-share">{{ share(part.value).toFixed(1) }}%</span></dt>
              <dd :title="`${num(part.value)} Token`">{{ compact(part.value) }}</dd>
            </div>
          </dl>
        </div>
        <div class="composition-track" role="img" :aria-label="parts.map(part => `${part.label} ${num(part.value)}，${share(part.value).toFixed(1)}%`).join('；')">
          <span v-for="part in parts" :key="part.key" :class="`part-${part.key}`" :data-part="part.key" :style="{ width: `${share(part.value)}%` }" :title="`${part.label} ${compact(part.value)} · ${share(part.value).toFixed(1)}%`"></span>
        </div>
        <div class="usg-facts">
          <span class="usg-count">{{ num(totals.requestCount) }} 次请求 · {{ num(totals.sessionCount) }} 条会话</span>
          <span>其中推理 <b class="mono-ish" :title="`${num(totals.reasoningOutputTokens)} Token`">{{ compact(totals.reasoningOutputTokens) }}</b></span>
          <span class="usg-updated">{{ usageBusy ? '更新中…' : `更新于 ${updatedTime}` }}</span>
        </div>
      </section>

      <!-- 今日的空态由下面那张图表自己说，不再叠一块同样的白板。 -->
      <div v-if="!days.length && usageReportRange !== 'today'" class="rcard empty-state">
        <div class="empty-icon"><AppIcon name="clock" :size="24" /></div>
        <div class="empty-title">这段时间没有用量记录</div>
        <div class="empty-desc">切换时间范围查看其他日期。</div>
      </div>

      <div v-if="usageReportRange === 'today' || days.length" class="usage-chart-stage">
        <Transition name="usage-chart">
          <CodexTodayUsageChart v-if="usageReportRange === 'today' && usageReport" key="today" :report="usageReport" :updated-at="usageUpdatedAt ?? Date.now()" />
          <CodexDailyUsageChart v-else :key="usageReportRange" :buckets="usageReport!.byDay" :range="usageReportRange" :updated-at="usageUpdatedAt ?? Date.now()" />
        </Transition>
      </div>

      <section v-if="models.length" class="rcard usg-models" aria-label="模型用量">
        <div class="usg-heading"><h3>按模型</h3></div>
        <div v-for="m in models" :key="m.key" class="usg-model">
          <button type="button" class="usg-model-row" :data-model="m.key" :aria-expanded="openModel === m.key" :aria-controls="`model-sessions-${m.key}`" :title="`${m.label}：合计 ${compact(m.totalTokens)} · 净输入 ${compact(freshInput(m))} · 缓存 ${compact(m.cachedInputTokens)} · 输出 ${compact(m.outputTokens)}；展开查看会话明细`" @click="openModel = openModel === m.key ? '' : m.key">
            <span class="usg-model-name">{{ m.label }}</span>
            <span class="usg-track"><span class="usg-fill" :style="{ width: `${pct(m.totalTokens, totals.totalTokens)}%` }"></span></span>
            <span class="usg-model-num mono-ish" :title="`${num(m.totalTokens)} Token`">{{ compact(m.totalTokens) }}</span>
            <span class="usg-model-pct mono-ish">{{ pct(m.totalTokens, totals.totalTokens).toFixed(1) }}%</span>
            <span class="usg-model-requests mono-ish">{{ num(m.requestCount) }} 次请求</span>
            <span class="usg-model-cost mono-ish" :title="formatUsageCostDetail(m.estimatedCostUsd)">{{ formatUsageCost(m.estimatedCostUsd) }}</span>
            <AppIcon class="usg-model-caret" name="chevDown" :size="12" />
          </button>
          <div v-if="openModel === m.key" :id="`model-sessions-${m.key}`" class="usg-model-detail" role="region" :aria-label="`${m.label} 会话用量`">
            <p class="usg-period">{{ modelSessions(m.key).length }} 条会话</p>
            <div class="usg-table-scroll">
              <table>
                <thead><tr><th scope="col">会话</th><th scope="col">总 Token</th><th scope="col">净输入</th><th scope="col">缓存命中</th><th scope="col">输出</th><th scope="col">请求数</th><th scope="col">估算金额（USD）</th></tr></thead>
                <tbody>
                  <tr v-for="s in modelSessions(m.key)" :key="s.key" :data-session="s.key">
                    <th scope="row" class="usg-session">
                      <button class="usg-session-title usg-session-open" type="button" :aria-label="`查看会话：${s.label}`" title="查看会话详情" @click="emit('openSession', s.key)">{{ s.label }}</button>
                      <span class="usg-session-meta">{{ s.cwd || '未知目录' }}</span>
                      <span class="usg-session-meta">最近使用 {{ sessionTime(s.lastUsedAt) }}</span>
                      <button v-if="s.label !== s.key" class="usg-session-copy" type="button" :title="s.key" :aria-label="`复制会话 ID：${s.key}`" @click="copySessionId(s.key)">{{ shortSessionId(s.key) }}<AppIcon name="copy" :size="13" /></button>
                    </th>
                    <td data-label="总 Token" :title="num(s.totalTokens)">{{ compact(s.totalTokens) }}</td><td data-label="净输入" :title="num(freshInput(s))">{{ compact(freshInput(s)) }}</td><td data-label="缓存命中" :title="num(s.cachedInputTokens)">{{ compact(s.cachedInputTokens) }}</td><td data-label="输出" :title="num(s.outputTokens)">{{ compact(s.outputTokens) }}</td><td data-label="请求数">{{ num(s.requestCount) }}</td><td data-label="估算金额（USD）" :title="formatUsageCostDetail(s.estimatedCostUsd)">{{ formatUsageCost(s.estimatedCostUsd) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <template v-if="usageReportRange !== 'today' && days.length">
        <section class="rcard usg-daily" aria-label="每日用量明细">
          <div class="usg-heading"><h3>每日明细</h3></div>
          <div class="usg-table-scroll">
            <table>
              <thead><tr><th scope="col">日期</th><th scope="col">总 Token</th><th scope="col">净输入</th><th scope="col">缓存命中</th><th scope="col">输出</th><th scope="col">请求数</th><th scope="col">估算金额（USD）</th></tr></thead>
              <tbody>
                <tr v-for="d in dailyRows" :key="d.key" class="usg-day-row" :data-day="d.key">
                  <th scope="row">{{ d.key }}<span v-if="d.key === updatedDay" class="usg-today-mark">今天</span></th>
                  <td data-label="总 Token" class="usg-day-total" :title="num(d.totalTokens)">{{ compact(d.totalTokens) }}</td><td data-label="净输入" :title="num(freshInput(d))">{{ compact(freshInput(d)) }}</td><td data-label="缓存命中" :title="num(d.cachedInputTokens)">{{ compact(d.cachedInputTokens) }}</td><td data-label="输出" :title="num(d.outputTokens)">{{ compact(d.outputTokens) }}</td><td data-label="请求数">{{ num(d.requestCount) }}</td>
                  <td data-label="估算金额（USD）" class="usg-day-cost" :title="formatUsageCostDetail(d.estimatedCostUsd)">{{ formatUsageCost(d.estimatedCostUsd) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <div class="usg-foot">
        <CodexUsageNotes />
        <span class="usg-scan">{{ num(totals.fileCount) }} 个文件 · {{ scanSeconds }} s</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-note { font-size: var(--text-xs); }
.usg-view .empty-title { margin: 0; }
.usage-chart-stage { position:relative; }
.usage-chart-enter-active { transition:opacity 160ms ease-out, transform 160ms ease-out; }
.usage-chart-leave-active { position:absolute; inset:0 0 auto; width:100%; pointer-events:none; transition:opacity 100ms ease-out; }
.usage-chart-enter-from { opacity:0; transform:translateY(4px); }
.usage-chart-leave-to { opacity:0; }
@media (prefers-reduced-motion: reduce) {
  .usage-chart-enter-active, .usage-chart-leave-active { transition:none; }
  .usage-chart-enter-from { transform:none; }
}
.usg-session-open { display: block; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.usg-session-open:hover { color: var(--text-brand); text-decoration: underline; text-underline-offset: 3px; }
.usg-view { --usage-fresh: #376cb3; --usage-cached: #32856f; --usage-output: #b96b25; display: flex; flex-direction: column; gap: var(--space-3); }
[data-base='dark'] .usg-view { --usage-fresh: #8aadf4; --usage-cached: #6bc5b4; --usage-output: #e8ac68; }
.usg-sum { padding: 12px 18px; }
.usg-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 14px; }
.usg-heading :is(h1, h3) { margin: 0; font-size: var(--text-base); font-weight: 600; color: var(--text); }
.usg-period { font-size: var(--text-xs); color: var(--text-muted); }
.usg-overview { display: flex; align-items: center; gap: 32px; padding: 6px 0; }
.usg-sum-main { display: grid; grid-template-columns: max-content auto; align-items: baseline; flex: 0 0 25%; gap: 4px 8px; }
.usg-num { font-size: var(--text-2xl); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; letter-spacing: normal; color: var(--text); }
.usg-sum-label { font-size: var(--text-xs); color: var(--text-muted); }
.usg-cost { grid-column: 1 / -1; font-size: var(--text-sm); color: var(--text-muted); }
.usg-cost b { font-family: var(--font-ui); font-weight: 500; color: var(--text); }
.usg-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); flex: 1; gap: 12px; margin: 0; }
.usg-metric dt { font-size: var(--text-sm); color: var(--text-muted); }
.metric-share { margin-left: 4px; font-size: var(--text-xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
.usg-metric dt::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; background: var(--usage-fresh); }
.usg-metric[data-metric='cached'] dt::before { background: var(--usage-cached); }
.usg-metric[data-metric='output'] dt::before { background: var(--usage-output); }
.usg-metric dd { margin: 6px 0 0; font-size: var(--text-md); font-family: var(--font-ui); font-variant-numeric: tabular-nums; letter-spacing: normal; color: var(--text-secondary); }
.composition-track { display: flex; height: 6px; overflow: hidden; border-radius: 3px; background: var(--fill); margin: 2px 0 8px; }
.composition-track > span + span { box-shadow: inset 1px 0 0 var(--bg-surface); } /* taste-skill-ignore: 数据分段描线，零值仍保持零宽度 */
.part-fresh { background: var(--usage-fresh); }
.part-cached, .usg-metric[data-metric='cached'] dt::before { background: var(--usage-cached); background-image: repeating-linear-gradient(135deg, transparent 0 3px, #ffffff40 3px 4px); } /* taste-skill-ignore: 缓存数据纹理，与图例保持一致 */
.part-output { background: var(--usage-output); }
.usg-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; padding-top: 10px; border-top: 1px solid var(--border); font-size: var(--text-xs); color: var(--text-muted); }
.usg-facts b { font-weight: 500; color: var(--text-secondary); }
.usg-updated { margin-left: auto; }
.usg-daily, .usg-models { padding: 14px 18px 8px; }
.usg-table-scroll { overflow: auto; max-height: 236px; margin-top: 10px; scrollbar-gutter: stable; }
.usg-table-scroll table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); white-space: nowrap; }
.usg-table-scroll th, .usg-table-scroll td { padding: 9px 8px; text-align: right; border-top: 1px solid var(--border); }
.usg-table-scroll thead th { border-top: 0; font-size: var(--text-xs); font-weight: 500; color: var(--text-muted); }
.usg-table-scroll th:first-child { text-align: left; padding-left: 0; }
.usg-table-scroll tbody th { font-weight: 400; color: var(--text-secondary); }
.usg-table-scroll td { font-family: var(--font-ui); font-variant-numeric: tabular-nums; letter-spacing: normal; color: var(--text-secondary); }
.usg-daily td.usg-day-total { color: var(--text); font-weight: 600; }
.usg-today-mark { margin-left: 6px; font-size: var(--text-xs); color: var(--accent); }
.usg-models .usg-heading { padding-bottom: 8px; }
.usg-model-row { display: flex; width: 100%; padding: 0; background: transparent; color: inherit; text-align: left; border: 0; align-items: center; gap: var(--space-3); min-height: 40px; border-top: 1px solid var(--border); font: inherit; font-size: var(--text-sm); cursor: pointer; }
.usg-model-row:hover { background: var(--hover-chrome); }
.usg-model-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.usg-model-caret { flex-shrink: 0; color: var(--text-muted); transition: transform 150ms; }
.usg-model-row[aria-expanded='true'] .usg-model-caret { transform: rotate(180deg); }
.usg-model-detail { padding: 4px 0 12px; }
.usg-model-detail > p { margin: 4px 0; }
.usg-session { min-width: 160px; max-width: 280px; white-space: normal; overflow-wrap: anywhere; }
.usg-session-title, .usg-session-meta { display: block; }
.usg-session-title { color: var(--text); }
.usg-session-meta { margin-top: 4px; font-size: var(--text-xs); color: var(--text-muted); }
.usg-session-copy { display: inline-flex; align-items: center; gap: 6px; padding: 3px 0; margin-top: 2px; border: 0; background: transparent; color: var(--text-muted); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.usg-session-copy:hover { color: var(--text-brand); }
.usg-model-name { flex: 0 0 26%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.usg-track { flex: 1 1 auto; height: 6px; border-radius: 3px; background: var(--hover-chrome); overflow: hidden; }
.usg-fill { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.usg-model-num { flex-shrink: 0; min-width: 76px; text-align: right; color: var(--text-secondary); }
.usg-model-pct { flex-shrink: 0; min-width: 46px; text-align: right; color: var(--text-muted); }
.usg-model-requests, .usg-model-cost { flex-shrink: 0; min-width: 76px; text-align: right; color: var(--text-secondary); }
.usg-foot { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 4px 14px; }
.usg-scan { padding-top: 4px; font-size: var(--text-xs); line-height: calc(var(--text-description) * var(--leading-ui)); color: var(--text-muted); white-space: nowrap; }
@media (max-width: 600px) {
  .usg-foot { grid-template-columns: minmax(0, 1fr); }
  .usg-scan { padding-top: 0; }
}
.mono-ish { font-family: var(--font-ui); font-variant-numeric: tabular-nums; letter-spacing: normal; }
@media (max-width: 700px) {
  .usg-overview { flex-wrap: wrap; gap: 18px; }
  .usg-sum-main { flex-basis: 100%; }
  .usg-metrics { flex-basis: 100%; }
  .usg-model-row { flex-wrap: wrap; gap: 6px 12px; padding: 8px 0; }
  .usg-model-name { flex-basis: 32%; }
  .usg-model-requests { margin-left: auto; }
}
@media (max-width: 600px) {
  .usg-metric dt { font-size: var(--text-xs); }
  .metric-share { display: block; margin: 4px 0 0 14px; }
  .usg-metric dd { font-size: var(--text-base); }
  .usg-model-name { flex-basis: 30%; }
  .usg-session-copy { min-height: 44px; }
  .usg-table-scroll { max-height: 360px; }
  .usg-table-scroll table, .usg-table-scroll tbody { display: block; }
  .usg-table-scroll thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .usg-table-scroll tbody tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; padding: 12px 0; border-top: 1px solid var(--border); }
  .usg-table-scroll tbody th { grid-column: 1 / -1; min-width: 0; max-width: none; white-space: normal; }
  .usg-table-scroll tbody :is(th, td) { padding: 0; border: 0; text-align: left; }
  .usg-table-scroll td { display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; white-space: normal; }
  .usg-table-scroll tbody td { align-items: flex-end; text-align: right; }
  .usg-table-scroll td::before { content: attr(data-label); font-family: var(--font-ui); font-size: var(--text-xs); color: var(--text-muted); }
}
</style>
