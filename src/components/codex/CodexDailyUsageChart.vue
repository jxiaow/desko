<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CodexUsageBucket } from '../../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, usageDays, type UsageRange } from '../../utils/codexUsage'

const props = defineProps<{ buckets: CodexUsageBucket[]; range: UsageRange; updatedAt: number }>()
const days = computed(() => usageDays(props.buckets, props.range, new Date(props.updatedAt)))
const activeKey = ref('')
const selected = computed(() => days.value.find(day => day.key === activeKey.value) ?? [...days.value].reverse().find(day => day.recorded))
const numberFormat = new Intl.NumberFormat('zh-CN')
const num = (value: number) => numberFormat.format(value)
const fresh = (day: CodexUsageBucket) => Math.max(0, day.inputTokens - day.cachedInputTokens)
const metrics = [
  { key: 'fresh', label: '净输入' },
  { key: 'cached', label: '缓存' },
  { key: 'output', label: '输出' },
] as const
type Metric = typeof metrics[number]['key'] | 'total'
function value(day: CodexUsageBucket, metric: Metric): number {
  switch (metric) {
    case 'fresh': return fresh(day)
    case 'cached': return day.cachedInputTokens
    case 'output': return day.outputTokens
    case 'total': return day.totalTokens
  }
}
const plots = computed(() => ([
  { key: 'total', label: '每日总量' },
  { key: 'fresh', label: '净输入' },
  { key: 'output', label: '输出' },
] as const).map(plot => {
  const peak = Math.max(0, ...days.value.map(day => value(day, plot.key)))
  const step = peak ? Math.max(1, 10 ** Math.floor(Math.log10(peak)) / 5) : 1
  return { ...plot, maximum: peak ? Math.ceil(peak * 1.1 / step) * step : 1 }
}))
const height = (amount: number, maximum: number) => `${maximum ? amount / maximum * 100 : 0}%`
const label = (index: number) => days.value.length <= 8 || index === 0 || index === days.value.length - 1 || index % 5 === 0
/** 悬停那句读中文单位，可访问名称留完整计数用于核对——与 .usg-num 的 title 同一分工 */
const title = (day: CodexUsageBucket & { recorded: boolean }, format: (value: number) => string) => day.recorded
  ? `${day.key} · 合计 ${format(day.totalTokens)} Token · 净输入 ${format(fresh(day))} · 缓存 ${format(day.cachedInputTokens)} · 输出 ${format(day.outputTokens)} · ${num(day.requestCount)} 次请求 · 估算 ${formatUsageCost(day.estimatedCostUsd)}`
  : `${day.key} · 无本地用量记录`
function move(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = event.target as HTMLButtonElement
  const buttons = [...current.parentElement!.querySelectorAll<HTMLButtonElement>('button')]
  const index = buttons.indexOf(current)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))
  buttons[next]?.focus()
}
</script>

<template>
  <section class="rcard daily-chart" aria-label="每日用量趋势">
    <header class="daily-heading">
      <h3>每日用量</h3>
      <span v-if="days.length">{{ days[0].key }} — {{ days[days.length - 1].key }}</span>
    </header>
    <div class="daily-plots">
      <div v-for="plot in plots" :key="plot.key" class="usage-series" :class="{ 'total-series': plot.key === 'total' }" role="group" :aria-label="plot.label">
        <div class="series-heading"><h4><i v-if="plot.key !== 'total'" :class="`sw-${plot.key}`" />{{ plot.label }}</h4><span v-if="plot.key !== 'total'">独立刻度</span><span v-else>Token</span></div>
        <div class="usage-plot" :class="{ 'daily-plot': plot.key === 'total' }" :data-days="days.length">
          <div class="usg-scale" aria-hidden="true" :data-metric="plot.key" :data-max="plot.maximum">
            <span>{{ compact(plot.maximum) }}</span><span>{{ compact(plot.maximum / 2) }}</span><span>0</span>
          </div>
          <div class="daily-grid">
            <div class="metric-grid" aria-hidden="true"><i class="grid-line top" /><i class="grid-line middle" /><i class="grid-line base" /></div>
            <div class="daily-columns" :style="{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }" @keydown="move">
              <button v-for="(day, index) in days" :key="day.key" class="daily-column" type="button" :class="[{ selected: selected?.key === day.key }, plot.key === 'total' ? 'usg-col' : 'usg-mini-col']" :data-day="day.key" :data-recorded="day.recorded" :aria-label="title(day, num)" :title="title(day, compact)" :aria-pressed="selected?.key === day.key" :tabindex="selected?.key === day.key ? 0 : -1" @mouseenter="activeKey = day.key" @focus="activeKey = day.key" @click="activeKey = day.key">
                <span v-if="plot.key === 'total'" class="usg-stack" :class="{ 'has-value': day.totalTokens > 0 }" :data-value="day.totalTokens" :style="{ height: height(day.totalTokens, plot.maximum) }" aria-hidden="true">
                  <span v-for="metric in metrics" :key="metric.key" class="usg-bar usg-segment" :class="`usg-${metric.key}`" :data-metric="metric.key" :data-value="value(day, metric.key)" :style="{ height: height(value(day, metric.key), day.totalTokens) }" />
                </span>
                <span v-else class="usg-bar" :class="[`usg-${plot.key}`, { 'has-value': value(day, plot.key) > 0 }]" :data-metric="plot.key" :data-value="value(day, plot.key)" :style="{ height: height(value(day, plot.key), plot.maximum) }" aria-hidden="true" />
                <span v-if="label(index)" class="usg-x">{{ day.key.slice(5) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="daily-readout" aria-live="polite">
      <span v-if="selected"><b>{{ selected.key }}</b><strong :title="`${num(selected.totalTokens)} Token`">{{ compact(selected.totalTokens) }}</strong> Token<span v-if="!selected.recorded" class="no-record">无本地记录</span></span>
      <div v-if="selected" class="daily-legend">
        <span v-for="metric in metrics" :key="metric.key" :title="`${num(value(selected, metric.key))} Token`"><i :class="`sw-${metric.key}`" />{{ metric.label }} {{ compact(value(selected, metric.key)) }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.daily-chart { padding:16px 18px 0; container:daily-chart / inline-size; }
.daily-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px 14px; }
.daily-heading h3 { margin:0; font-size:var(--text-sm); font-weight:600; color:var(--text); }
.daily-heading > span { font-size:var(--text-xs); color:var(--text-muted); font-variant-numeric:tabular-nums; }
.daily-plots { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px 24px; margin-top:14px; }
.usage-series { --plot-height:76px; min-width:0; padding-top:12px; border-top:1px solid var(--border); container:usage-series / inline-size; }
.total-series { --plot-height:128px; grid-column:1 / -1; padding-top:0; border-top:0; }
.series-heading { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.series-heading h4 { display:flex; align-items:center; gap:6px; margin:0; font-size:var(--text-xs); font-weight:500; color:var(--text-secondary); }
.series-heading h4 i { width:8px; height:8px; border-radius:2px; }
.series-heading > span { font-size:var(--text-xs); color:var(--text-muted); }
.usage-plot { display:grid; grid-template-columns:46px minmax(0,1fr); gap:8px; height:var(--plot-height); margin:14px 0 30px; }
.usg-scale { position:relative; text-align:right; font-size:var(--text-xs); font-variant-numeric:tabular-nums; color:var(--text-muted); }
.usg-scale > span { position:absolute; right:0; transform:translateY(-50%); }
.usg-scale > span:nth-of-type(1) { top:0; }.usg-scale > span:nth-of-type(2) { top:50%; }.usg-scale > span:nth-of-type(3) { top:100%; }
.daily-grid { position:relative; min-width:0; }
.metric-grid { position:absolute; inset:0; pointer-events:none; }
.grid-line { position:absolute; left:0; right:0; border-top:1px solid var(--border); }
.grid-line.top { top:0; }.grid-line.middle { top:50%; border-top-style:dashed; }.grid-line.base { bottom:0; }
.daily-columns { position:relative; height:100%; display:grid; }
.daily-column { position:relative; display:flex; align-items:flex-end; justify-content:center; width:100%; min-width:0; margin:0; padding:0; border:0; border-radius:3px; background:transparent; color:inherit; font:inherit; cursor:pointer; transition:background-color 120ms ease-out; }
.daily-column:hover, .daily-column.selected { background:color-mix(in srgb,var(--text) 4%,transparent); }
.daily-column:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.usg-stack { display:flex; flex-direction:column-reverse; width:62%; max-width:28px; overflow:hidden; border-radius:2px 2px 0 0; transition:height 180ms ease-out; }
.usg-bar { display:block; width:62%; max-width:28px; border-radius:2px 2px 0 0; transition:height 180ms ease-out; }
.usg-bar, .usg-stack { pointer-events:none; }
.usg-bar.has-value, .usg-stack.has-value { min-height:2px; }
.usg-segment { flex-shrink:0; width:100%; max-width:none; border-radius:0; }
.usg-output, .sw-output { background:var(--usage-output); }.usg-cached, .sw-cached { background:var(--usage-cached); background-image:repeating-linear-gradient(135deg,transparent 0 3px,#ffffff40 3px 4px); }.usg-fresh, .sw-fresh { background:var(--usage-fresh); }
.usg-x { position:absolute; top:100%; left:50%; transform:translateX(-50%); padding-top:8px; white-space:nowrap; font-size:var(--text-xs); color:var(--text-muted); font-variant-numeric:tabular-nums; }
.daily-readout { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; min-height:46px; padding:10px 0; border-top:1px solid var(--border); font-size:var(--text-xs); color:var(--text-muted); }
.daily-readout b { margin-right:12px; font-weight:500; color:var(--text-secondary); }.daily-readout strong { margin-right:3px; font-weight:600; color:var(--text); font-variant-numeric:tabular-nums; }
.no-record { margin-left:8px; }.daily-legend { display:flex; flex-wrap:wrap; gap:8px 14px; }.daily-legend span { display:flex; align-items:center; gap:5px; font-variant-numeric:tabular-nums; }.daily-legend i { width:10px; height:10px; border-radius:2px; }
@container daily-chart (max-width:520px) { .usage-series { grid-column:1 / -1; } }
@container usage-series (max-width:280px) { .daily-column:not(:nth-child(3n + 1)):not(:last-child) .usg-x { display:none; } }
@media (prefers-reduced-motion: reduce) { .daily-column, .usg-bar, .usg-stack { transition:none; } }
</style>
