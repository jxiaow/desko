<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CodexSessionUsageReport } from '../../services/api/codex'
import { formatTokenCount as compact, formatUsageCost, usageHours, usageWindowFrom, type CodexUsageHour } from '../../utils/codexUsage'

const props = defineProps<{ report: CodexSessionUsageReport; updatedAt: number }>()
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
const plot = { left: 54, right: 778, top: 20, bottom: 176 }
const x = (timestamp: number) => plot.left + (timestamp - start.value) / (end.value - start.value) * (plot.right - plot.left)
const y = (value: number) => plot.bottom - value / maximum.value * (plot.bottom - plot.top)
const points = computed(() => observed.value.map(hour => `${x(hour.timestamp).toFixed(1)},${y(hour.totalTokens).toFixed(1)}`).join(' '))
const area = computed(() => {
  const last = observed.value.slice(-1)[0]
  return last ? `M ${plot.left},${plot.bottom} L ${points.value.replaceAll(' ', ' L ')} L ${x(last.timestamp)},${plot.bottom} Z` : ''
})
const yTicks = computed(() => maximum.value === 1 ? [0] : [0, maximum.value / 2, maximum.value])
const xTicks = computed(() => [
  ...hours.value.filter((_, index) => index % 4 === 0).map(hour => ({ key: hour.key, label: hour.label.slice(0, 5), timestamp: hour.timestamp })),
  { key: 'end', label: '24:00', timestamp: end.value },
])
const futureStart = computed(() => observed.value.slice(-1)[0]?.endTimestamp ?? start.value)
const parts = computed(() => {
  const totals = props.report.totals
  return [
    { key: 'fresh', label: '净输入', value: Math.max(0, totals.inputTokens - totals.cachedInputTokens) },
    { key: 'cached', label: '缓存命中', value: totals.cachedInputTokens },
    { key: 'output', label: '输出', value: totals.outputTokens },
  ]
})
const partsTotal = computed(() => parts.value.reduce((sum, part) => sum + part.value, 0))
const share = (value: number) => partsTotal.value > 0 ? value / partsTotal.value * 100 : 0

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
      <span>截至 {{ clock(asOf) }}</span>
    </div>
    <div class="today-peak">
      <template v-if="peak && peak.totalTokens > 0">高峰 <b>{{ peak.label }}</b> · <b :title="`${num(peak.totalTokens)} Token`">{{ compact(peak.totalTokens) }}</b> Token</template>
      <template v-else>今天还没有用量记录</template>
    </div>
    <svg class="hourly-svg" viewBox="0 0 800 216" role="group" aria-label="每小时总 Token，未来时段留空" :data-hours="hours.length" :data-observed="observed.length">
      <g v-for="tick in yTicks" :key="tick" class="hour-grid">
        <line :x1="plot.left" :x2="plot.right" :y1="y(tick)" :y2="y(tick)" />
        <text :x="plot.left - 12" :y="y(tick) + 4" text-anchor="end">{{ compact(tick) }}</text>
      </g>
      <template v-if="futureStart < end">
        <rect class="hour-future" :x="x(futureStart)" :y="plot.top" :width="plot.right - x(futureStart)" :height="plot.bottom - plot.top" />
        <text v-if="plot.right - x(futureStart) > 110" class="hour-future-label" :x="(x(futureStart) + plot.right) / 2" :y="plot.top + 20" text-anchor="middle">未到时段</text>
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
      <text v-for="tick in xTicks" :key="tick.key" class="hour-x" :x="x(tick.timestamp)" y="204" text-anchor="middle">{{ tick.label }}</text>
    </svg>
    <div v-if="selected" class="hour-detail" aria-live="polite">
      <b :title="hourTitle(selected, num)">{{ hourTitle(selected, compact) }}</b>
      <span :title="`净输入 ${num(Math.max(0, selected.inputTokens - selected.cachedInputTokens))} · 缓存 ${num(selected.cachedInputTokens)} · 输出 ${num(selected.outputTokens)}`">净输入 {{ compact(Math.max(0, selected.inputTokens - selected.cachedInputTokens)) }} · 缓存 {{ compact(selected.cachedInputTokens) }} · 输出 {{ compact(selected.outputTokens) }}</span>
    </div>
    <div class="composition">
      <div class="today-heading"><h3>今日用量构成</h3></div>
      <div class="composition-track" role="img" :aria-label="parts.map(part => `${part.label} ${num(part.value)}，${share(part.value).toFixed(1)}%`).join('；')">
        <span v-for="part in parts" :key="part.key" :class="`part-${part.key}`" :data-part="part.key" :style="{ width: `${share(part.value)}%` }" :title="`${part.label} ${compact(part.value)} · ${share(part.value).toFixed(1)}%`"></span>
      </div>
      <div class="composition-legend">
        <div v-for="part in parts" :key="part.key" class="composition-item">
          <span><i :class="`part-${part.key}`"></i>{{ part.label }}</span>
          <b :title="`${num(part.value)} Token`">{{ compact(part.value) }} <small>{{ share(part.value).toFixed(1) }}%</small></b>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.today-chart { padding: 14px 18px; }
.today-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 14px; }
.today-heading h3 { margin: 0; font-size: var(--text-sm); font-weight: 600; color: var(--text); }
.today-heading > span { font-size: var(--text-xs); color: var(--text-muted); }
.today-peak { margin-top: 10px; font-size: var(--text-xs); color: var(--text-muted); }
.today-peak b { font-weight: 500; color: var(--text-secondary); }
.hourly-svg { display: block; width: 100%; height: auto; overflow: visible; margin-top: 8px; }
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
.hour-detail { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 14px; padding: 8px 0 12px; font-size: var(--text-xs); color: var(--text-muted); }
.hour-detail b { font-weight: 500; color: var(--text-secondary); }
.composition { border-top: 1px solid var(--border); padding-top: 12px; }
.composition-track { display: flex; width: 100%; height: 14px; overflow: hidden; border-radius: 3px; background: var(--fill); margin-top: 12px; }
.composition-track > span + span { box-shadow: inset 1px 0 0 var(--bg-surface); }
.part-fresh { background: var(--usage-fresh); }
.part-cached { background: var(--usage-cached); background-image: repeating-linear-gradient(135deg, transparent 0 3px, #ffffff40 3px 4px); }
.part-output { background: var(--usage-output); }
.composition-legend { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.composition-item { display: flex; flex-direction: column; gap: 5px; font-size: var(--text-xs); color: var(--text-muted); }
.composition-item > span { display: flex; align-items: center; gap: 5px; }
.composition-item i { width: 8px; height: 8px; border-radius: 2px; }
.composition-item b { font-weight: 500; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
.composition-item small { margin-left: 6px; font-size: inherit; font-weight: 400; color: var(--text-muted); }
@media (max-width: 850px) {
  .hour-grid text, .hour-x, .hour-future-label { font-size: var(--text-lg); }
}
</style>
