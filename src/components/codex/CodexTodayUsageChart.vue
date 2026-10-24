<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { CodexSessionUsageReport } from '../../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, usageHours, usageWindowFrom, type CodexUsageHour } from '../../utils/codexUsage'

const props = defineProps<{ report: CodexSessionUsageReport; updatedAt: number }>()
const chart = ref<SVGSVGElement | null>(null)
const chartWidth = ref(800)
const chartHeight = 180
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0) chartWidth.value = Math.round(entry.contentRect.width)
  })
  if (chart.value) observer.observe(chart.value)
})
onUnmounted(() => observer?.disconnect())
const activeKey = ref('')
const asOf = computed(() => Math.floor(props.updatedAt / 1000))
const start = computed(() => props.report.fromTimestamp ?? usageWindowFrom('today', new Date(props.updatedAt))!)
const hours = computed(() => usageHours(props.report.byHour, start.value, asOf.value))
const observed = computed(() => hours.value.filter(hour => !hour.future))
const end = computed(() => hours.value.slice(-1)[0]?.endTimestamp ?? start.value + 86400)
const peak = computed(() => observed.value.reduce<CodexUsageHour | null>((best, hour) => !best || hour.totalTokens > best.totalTokens ? hour : best, null))
const selected = computed(() => observed.value.find(hour => hour.key === activeKey.value) ?? peak.value)
const num = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const clock = (timestamp: number) => new Date(timestamp * 1000).toTimeString().slice(0, 5)
const maximum = computed(() => {
  const value = peak.value?.totalTokens ?? 0
  if (value <= 0) return 1
  const step = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / step) * step
})
const plot = { left: 50, top: 12, bottom: chartHeight - 28 }
const right = computed(() => Math.max(plot.left + 1, chartWidth.value - 10))
const x = (timestamp: number) => plot.left + (timestamp - start.value) / (end.value - start.value) * (right.value - plot.left)
const y = (value: number) => plot.bottom - value / maximum.value * (plot.bottom - plot.top)
const points = computed(() => observed.value.map(hour => `${x(hour.timestamp).toFixed(1)},${y(hour.totalTokens).toFixed(1)}`).join(' '))
const area = computed(() => {
  const last = observed.value.slice(-1)[0]
  return last ? `M ${plot.left},${plot.bottom} L ${points.value.replaceAll(' ', ' L ')} L ${x(last.timestamp)},${plot.bottom} Z` : ''
})
const yTicks = computed(() => maximum.value === 1 ? [0] : [0, maximum.value / 2, maximum.value])
const xTicks = computed(() => [
  ...hours.value.filter((_, index) => index % (chartWidth.value < 480 ? 8 : 4) === 0).map(hour => ({ key: hour.key, label: hour.label.slice(0, 5), timestamp: hour.timestamp })),
  { key: 'end', label: '24:00', timestamp: end.value },
])
const futureStart = computed(() => observed.value.slice(-1)[0]?.endTimestamp ?? start.value)

/** 每个调用点自己说清要哪种数：悬停句子里用换算单位，可访问名称和核对 title 留完整计数 */
function hourTitle(hour: CodexUsageHour, format: (value: number) => string): string {
  const until = hour.endTimestamp === end.value ? '24:00' : hours.value.find(next => next.timestamp === hour.endTimestamp)?.label ?? clock(hour.endTimestamp)
  return `${hour.label}–${until} · ${format(hour.totalTokens)} Token · ${num(hour.requestCount)} 次请求 · 估算 ${formatUsageCost(hour.estimatedCostUsd)}${hour.endTimestamp > asOf.value ? ' · 本小时累计' : ''}`
}
</script>

<template>
  <section class="rcard today-chart" aria-label="今日小时用量趋势">
    <div class="today-heading">
      <h3>每小时用量</h3>
      <div class="today-heading-meta">
        <span class="today-peak">
          <template v-if="peak && peak.totalTokens > 0">高峰 <b>{{ peak.label }}</b> · <b :title="`${num(peak.totalTokens)} Token`">{{ compact(peak.totalTokens) }}</b> Token</template>
          <template v-else>今天还没有用量记录</template>
        </span>
        <span>截至 {{ clock(asOf) }}</span>
      </div>
    </div>
    <svg ref="chart" class="hourly-svg" :viewBox="`0 0 ${chartWidth} ${chartHeight}`" role="group" aria-label="每小时总 Token，未来时段留空" :data-hours="hours.length" :data-observed="observed.length">
      <g v-for="tick in yTicks" :key="tick" class="hour-grid">
        <line :x1="plot.left" :x2="right" :y1="y(tick)" :y2="y(tick)" />
        <text :x="plot.left - 12" :y="y(tick) + 4" text-anchor="end">{{ compact(tick) }}</text>
      </g>
      <template v-if="futureStart < end">
        <rect class="hour-future" :x="x(futureStart)" :y="plot.top" :width="right - x(futureStart)" :height="plot.bottom - plot.top" />
        <text v-if="right - x(futureStart) > 72" class="hour-future-label" :x="(x(futureStart) + right) / 2" :y="plot.top + 20" text-anchor="middle">未到时段</text>
      </template>
      <path class="hour-area" :d="area" />
      <polyline class="hour-line" :points="points" fill="none" />
      <line v-if="selected" class="hour-guide" :x1="x(selected.timestamp)" :x2="x(selected.timestamp)" :y1="plot.top" :y2="plot.bottom" />
      <g v-for="hour in observed" :key="hour.key" :data-hour="hour.label" :data-tokens="hour.totalTokens">
        <circle class="hour-dot" :cx="x(hour.timestamp)" :cy="y(hour.totalTokens)" :r="hour.key === selected?.key ? 4 : 2" />
        <circle class="hour-target" :cx="x(hour.timestamp)" :cy="y(hour.totalTokens)" r="10" role="button" tabindex="0" :aria-label="hourTitle(hour, num)" @mouseenter="activeKey = hour.key" @focus="activeKey = hour.key" @click="activeKey = hour.key" @keydown.enter="activeKey = hour.key" @keydown.space.prevent="activeKey = hour.key">
          <title>{{ hourTitle(hour, compact) }}</title>
        </circle>
      </g>
      <text v-for="(tick, index) in xTicks" :key="tick.key" class="hour-x" :x="x(tick.timestamp)" :y="chartHeight - 6" :text-anchor="index === 0 ? 'start' : tick.key === 'end' ? 'end' : 'middle'">{{ tick.label }}</text>
    </svg>
    <div v-if="selected" class="hour-detail" aria-live="polite">
      <b :title="hourTitle(selected, num)">{{ hourTitle(selected, compact) }}</b>
      <span :title="`净输入 ${num(Math.max(0, selected.inputTokens - selected.cachedInputTokens))} · 缓存 ${num(selected.cachedInputTokens)} · 输出 ${num(selected.outputTokens)}`">净输入 {{ compact(Math.max(0, selected.inputTokens - selected.cachedInputTokens)) }} · 缓存 {{ compact(selected.cachedInputTokens) }} · 输出 {{ compact(selected.outputTokens) }}</span>
    </div>
  </section>
</template>

<style scoped>
.today-chart { padding: 14px 18px; }
.today-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; }
.today-heading h3 { margin: 0; font-size: var(--text-base); font-weight: 600; color: var(--text); }
.today-heading-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; font-size: var(--text-xs); color: var(--text-muted); }
.today-peak b { font-weight: 500; color: var(--text-secondary); }
.hourly-svg { display: block; width: 100%; height: 180px; overflow: visible; margin-top: 8px; }
.hour-grid line { stroke: var(--border); stroke-dasharray: 3 4; }
.hour-grid text, .hour-x, .hour-future-label { fill: var(--text-muted); font-size: var(--text-xs); font-family: var(--font-ui); font-variant-numeric: tabular-nums; }
.hour-future { fill: var(--fill); opacity: .5; }
.hour-future-label { fill: var(--text-faint); }
.hour-area { fill: var(--accent); opacity: .08; }
.hour-line { stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.hour-guide { stroke: var(--accent); stroke-dasharray: 3 4; opacity: .35; }
.hour-dot { fill: var(--accent); }
.hour-target { fill: transparent; cursor: pointer; }
.hour-target:focus-visible { outline: none; stroke: var(--accent); stroke-width: 2; }
.hour-detail { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 14px; padding-top: 8px; font-size: var(--text-sm); color: var(--text-muted); }
.hour-detail b { font-weight: 500; color: var(--text-secondary); }
@media (max-width: 600px) { .today-heading-meta { flex-basis: 100%; justify-content: space-between; } }
</style>
