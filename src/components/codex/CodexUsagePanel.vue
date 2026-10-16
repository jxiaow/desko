<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { CodexUsageBucket } from '../../services/api/codex'
import { loadUsage, usageBusy, usageError, usageRange, usageReport, usageUpdatedAt } from '../../services/codexState'
import { formatTokenCount as compact, formatUsageCost, localDayKey, usageWindowFrom } from '../../utils/codexUsage'
import AppIcon from '../shared/AppIcon.vue'
import CodexDailyUsageChart from './CodexDailyUsageChart.vue'
import CodexTodayUsageChart from './CodexTodayUsageChart.vue'

onMounted(() => {
  const lastDay = usageUpdatedAt.value ? localDayKey(new Date(usageUpdatedAt.value)) : ''
  const wrongWindow = usageReport.value?.fromTimestamp !== usageWindowFrom(usageRange.value)
  if ((!usageReport.value || wrongWindow || lastDay !== localDayKey(new Date())) && !usageBusy.value) void loadUsage()
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

const num = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const days = computed(() => usageReport.value?.byDay.slice(-30) ?? [])
const dailyRows = computed(() => [...days.value].reverse())
const models = computed(() => usageReport.value?.byModel ?? [])
const totals = computed(() => usageReport.value?.totals ?? null)
const scope = computed(() => ({ today: '今日用量', week: '近 7 天用量', month: '近 30 天用量', all: '全部用量' })[usageRange.value])
const updatedDay = computed(() => localDayKey(new Date(usageUpdatedAt.value ?? Date.now())))
const period = computed(() => {
  const from = usageReport.value?.fromTimestamp
  if (usageRange.value === 'all') return '全部本地会话记录'
  const start = from == null ? updatedDay.value : localDayKey(new Date(from * 1000))
  const startClock = from == null ? '00:00' : new Date(from * 1000).toTimeString().slice(0, 5)
  return usageRange.value === 'today' ? `${start} · 本地时间 ${startClock} 起` : `${start} 至 ${updatedDay.value} · 本地时间`
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
    <div v-if="usageError" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <div class="empty-title">读不到用量</div>
      <div class="empty-desc" :title="usageError">{{ usageError }}</div>
      <button class="action-btn primary" type="button" @click="loadUsage()">重试</button>
    </div>

    <div v-else-if="!totals" class="rcard usg-wait">
      <AppIcon name="refresh" :size="13" />正在统计用量…
    </div>

    <template v-else>
      <section class="rcard usg-sum" :aria-label="scope">
        <div class="usg-heading">
          <h3>{{ scope }}</h3>
          <span class="usg-period">{{ period }}</span>
        </div>
        <div class="usg-overview">
          <div class="usg-sum-main">
            <span class="usg-num" :title="`${num(totals.totalTokens)} Token`">{{ compact(totals.totalTokens) }}</span>
            <span class="usg-sum-label">总 Token</span>
            <span class="usg-cost">估算金额 <b>{{ formatUsageCost(totals.estimatedCostUsd) }}</b></span>
          </div>
          <dl class="usg-metrics">
            <div class="usg-metric" data-metric="fresh"><dt>净输入</dt><dd :title="`${num(freshInput(totals))} Token`">{{ compact(freshInput(totals)) }}</dd></div>
            <div class="usg-metric" data-metric="cached"><dt>缓存命中</dt><dd :title="`${num(totals.cachedInputTokens)} Token`">{{ compact(totals.cachedInputTokens) }}</dd></div>
            <div class="usg-metric" data-metric="output"><dt>输出</dt><dd :title="`${num(totals.outputTokens)} Token`">{{ compact(totals.outputTokens) }}</dd></div>
          </dl>
        </div>
        <div class="usg-facts">
          <span class="usg-count">{{ num(totals.requestCount) }} 次请求 · {{ num(totals.sessionCount) }} 条会话</span>
          <span>输出中含推理 <b class="mono-ish" :title="`${num(totals.reasoningOutputTokens)} Token`">{{ compact(totals.reasoningOutputTokens) }}</b></span>
          <span class="usg-updated">{{ usageBusy ? '更新中…' : `更新于 ${updatedTime}` }}</span>
        </div>
      </section>

      <div v-if="!days.length" class="rcard empty-state">
        <div class="empty-icon"><AppIcon name="clock" :size="24" /></div>
        <div class="empty-title">{{ usageRange === 'today' ? '今天还没有用量记录' : '这段时间没有用量记录' }}</div>
        <div class="empty-desc">{{ usageRange === 'today' ? '在 Codex 中使用后点击“重新统计”，或切换范围查看历史用量' : '切换统计范围查看其他日期的用量' }}</div>
      </div>

      <CodexTodayUsageChart v-if="usageRange === 'today' && usageReport" :report="usageReport" :updated-at="usageUpdatedAt ?? Date.now()" />

      <template v-else-if="days.length">
        <CodexDailyUsageChart :buckets="usageReport!.byDay" :range="usageRange" :updated-at="usageUpdatedAt ?? Date.now()" />

        <section class="rcard usg-daily" aria-label="每日用量明细">
          <div class="usg-heading"><h3>每日明细</h3><span class="usg-period">有记录的日期 · 最近在前</span></div>
          <div class="usg-table-scroll">
            <table>
              <thead><tr><th scope="col">日期</th><th scope="col">总 Token</th><th scope="col">净输入</th><th scope="col">缓存命中</th><th scope="col">输出</th><th scope="col">请求数</th><th scope="col">估算金额（USD）</th></tr></thead>
              <tbody>
                <tr v-for="d in dailyRows" :key="d.key" class="usg-day-row" :data-day="d.key">
                  <th scope="row">{{ d.key }}<span v-if="d.key === updatedDay" class="usg-today-mark">今天</span></th>
                  <td class="usg-day-total" :title="num(d.totalTokens)">{{ compact(d.totalTokens) }}</td><td :title="num(freshInput(d))">{{ compact(freshInput(d)) }}</td><td :title="num(d.cachedInputTokens)">{{ compact(d.cachedInputTokens) }}</td><td :title="num(d.outputTokens)">{{ compact(d.outputTokens) }}</td><td>{{ num(d.requestCount) }}</td>
                  <td class="usg-day-cost">{{ formatUsageCost(d.estimatedCostUsd) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <section v-if="models.length" class="rcard usg-models" aria-label="模型用量">
        <div class="usg-heading"><h3>按模型</h3><span class="usg-period">{{ scope }}</span></div>
        <div v-for="m in models" :key="m.key" class="usg-model-row" :data-model="m.key" :title="`${m.label}：合计 ${num(m.totalTokens)} · 净输入 ${num(freshInput(m))} · 缓存 ${num(m.cachedInputTokens)} · 输出 ${num(m.outputTokens)}`">
          <span class="usg-model-name">{{ m.label }}</span>
          <span class="usg-track"><span class="usg-fill" :style="{ width: `${pct(m.totalTokens, totals.totalTokens)}%` }"></span></span>
          <span class="usg-model-num mono-ish" :title="`${num(m.totalTokens)} Token`">{{ compact(m.totalTokens) }}</span>
          <span class="usg-model-pct mono-ish">{{ pct(m.totalTokens, totals.totalTokens).toFixed(1) }}%</span>
          <span class="usg-model-requests mono-ish">{{ num(m.requestCount) }} 次请求</span>
          <span class="usg-model-cost mono-ish" title="估算金额（USD）">{{ formatUsageCost(m.estimatedCostUsd) }}</span>
        </div>
      </section>

      <div class="usg-foot">
        <p class="page-note"><AppIcon name="info" :size="13" />统计包含默认 Codex 目录、开启自动统计时识别的 WSL 目录及「设置 → Codex」中手动补充的目录。输入包含缓存命中，推理已计入输出。金额按标准 API 单价估算（USD），含未知模型时显示“未定价”，不代表订阅实际扣费。请求按有用量的 Token 记录去重计数；回收站中的会话不计入。</p>
        <span class="usg-scan">扫了 {{ num(totals.fileCount) }} 个文件 · {{ scanSeconds }} s</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-note { font-size: var(--text-xs); }
.usg-view { --usage-fresh: #376cb3; --usage-cached: #32856f; --usage-output: #b96b25; display: flex; flex-direction: column; gap: var(--space-3); }
[data-base='dark'] .usg-view { --usage-fresh: #8aadf4; --usage-cached: #6bc5b4; --usage-output: #e8ac68; }
.usg-sum { padding: 16px 18px 12px; }
.usg-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 14px; }
.usg-heading h3 { margin: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.usg-period { font-size: var(--text-xs); color: var(--text-muted); }
.usg-overview { display: flex; align-items: center; gap: 32px; padding: 18px 0; }
.usg-sum-main { display: flex; flex-direction: column; flex: 0 0 25%; gap: 4px; }
.usg-num { font-size: var(--text-2xl); font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.2; letter-spacing: normal; color: var(--text); }
.usg-sum-label { font-size: var(--text-xs); color: var(--text-muted); }
.usg-cost { margin-top: 4px; font-size: var(--text-xs); color: var(--text-muted); }
.usg-cost b { font-family: var(--font-mono); font-weight: 500; color: var(--text); }
.usg-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); flex: 1; gap: 12px; margin: 0; }
.usg-metric dt { font-size: var(--text-xs); color: var(--text-muted); }
.usg-metric dt::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 2px; background: var(--usage-fresh); }
.usg-metric[data-metric='cached'] dt::before { background: var(--usage-cached); }
.usg-metric[data-metric='output'] dt::before { background: var(--usage-output); }
.usg-metric dd { margin: 6px 0 0; font-size: var(--text-md); font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; color: var(--text-secondary); }
.usg-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; padding-top: 10px; border-top: 1px solid var(--border); font-size: var(--text-xs); color: var(--text-muted); }
.usg-facts b { font-weight: 500; color: var(--text-secondary); }
.usg-updated { margin-left: auto; }
.usg-wait { display: flex; align-items: center; gap: var(--space-2); min-height: 64px; padding: 0 18px; font-size: var(--text-xs); color: var(--text-muted); }
.usg-daily, .usg-models { padding: 14px 18px 8px; }
.usg-table-scroll { overflow: auto; max-height: 236px; margin-top: 10px; scrollbar-gutter: stable; }
.usg-daily table { width: 100%; border-collapse: collapse; font-size: var(--text-xs); white-space: nowrap; }
.usg-daily th, .usg-daily td { padding: 9px 8px; text-align: right; border-top: 1px solid var(--border); }
.usg-daily thead th { border-top: 0; font-weight: 500; color: var(--text-muted); }
.usg-daily th:first-child { text-align: left; padding-left: 0; }
.usg-daily tbody th { font-weight: 400; color: var(--text-secondary); }
.usg-daily td { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; color: var(--text-secondary); }
.usg-daily td.usg-day-total { color: var(--text); font-weight: 600; }
.usg-today-mark { margin-left: 6px; font-size: var(--text-xs); color: var(--accent); }
.usg-models .usg-heading { padding-bottom: 8px; }
.usg-model-row { display: flex; align-items: center; gap: var(--space-3); min-height: 34px; border-top: 1px solid var(--border); font-size: var(--text-xs); }
.usg-model-name { flex: 0 0 26%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.usg-track { flex: 1 1 auto; height: 6px; border-radius: 3px; background: var(--hover-chrome); overflow: hidden; }
.usg-fill { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.usg-model-num { flex-shrink: 0; min-width: 76px; text-align: right; color: var(--text-secondary); }
.usg-model-pct { flex-shrink: 0; min-width: 46px; text-align: right; color: var(--text-muted); }
.usg-model-requests, .usg-model-cost { flex-shrink: 0; min-width: 76px; text-align: right; color: var(--text-secondary); }
.usg-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 14px; }
.usg-foot .page-note { margin: 0; }
.usg-scan { font-size: var(--text-xs); color: var(--text-faint); }
.mono-ish { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
@media (max-width: 850px) {
  .usg-overview { flex-wrap: wrap; gap: 18px; }
  .usg-sum-main { flex-basis: 100%; }
  .usg-metrics { flex-basis: 100%; }
  .usg-model-row { flex-wrap: wrap; gap: 6px 12px; padding: 8px 0; }
  .usg-model-name { flex-basis: 32%; }
  .usg-model-requests { margin-left: auto; }
}
</style>
