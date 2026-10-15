<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CodexUsageBucket } from '../../services/api/codex'
import { usageDays, type UsageRange } from '../../utils/codexUsage'

const props = defineProps<{ buckets: CodexUsageBucket[]; range: UsageRange; updatedAt: number }>()
const days = computed(() => usageDays(props.buckets, props.range, new Date(props.updatedAt)))
const activeKey = ref('')
const selected = computed(() => days.value.find(day => day.key === activeKey.value) ?? [...days.value].reverse().find(day => day.recorded))
const peak = computed(() => days.value.reduce((max, day) => Math.max(max, day.totalTokens), 0))
const maximum = computed(() => {
  if (!peak.value) return 1
  const step = Math.max(1, 10 ** Math.floor(Math.log10(peak.value)) / 5)
  return Math.ceil(peak.value * 1.1 / step) * step
})
const num = (value: number) => new Intl.NumberFormat('zh-CN').format(value)
const compact = (value: number) => value >= 1e6 ? `${Number((value / 1e6).toFixed(1))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : num(value)
const fresh = (day: CodexUsageBucket) => Math.max(0, day.inputTokens - day.cachedInputTokens)
const height = (value: number) => `${value / maximum.value * 100}%`
const label = (index: number) => days.value.length <= 8 || index === 0 || index === days.value.length - 1 || index % 5 === 0
const title = (day: CodexUsageBucket & { recorded: boolean }) => day.recorded
  ? `${day.key} · 合计 ${num(day.totalTokens)} Token · 净输入 ${num(fresh(day))} · 缓存 ${num(day.cachedInputTokens)} · 输出 ${num(day.outputTokens)} · ${num(day.requestCount)} 轮`
  : `${day.key} · 无本地用量记录`
function move(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const current = event.target as HTMLElement
  const buttons = [...current.parentElement!.querySelectorAll<HTMLButtonElement>('.usg-col')]
  const index = buttons.indexOf(current as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))
  buttons[next]?.focus()
}
</script>
<template>
  <section class="rcard daily-chart" aria-label="每日用量趋势">
    <header class="daily-heading"><h3>每日用量</h3><span v-if="days.length">{{ days[0].key }} — {{ days[days.length - 1].key }}</span></header>
    <div class="daily-plot" :data-days="days.length" :data-max="maximum">
      <div class="usg-scale" aria-hidden="true"><span>{{ compact(maximum) }}</span><span>{{ compact(maximum / 2) }}</span><span>0</span></div>
      <div class="daily-grid">
        <i class="grid-line top" /><i class="grid-line middle" /><i class="grid-line base" />
        <div class="daily-columns" :style="{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }" @keydown="move">
          <button v-for="(day, index) in days" :key="day.key" class="usg-col" type="button" :class="{ selected: selected?.key === day.key }" :data-day="day.key" :data-recorded="day.recorded" :aria-label="title(day)" :aria-pressed="selected?.key === day.key" :tabindex="selected?.key === day.key ? 0 : -1" @mouseenter="activeKey = day.key" @focus="activeKey = day.key" @click="activeKey = day.key">
            <span class="usg-stack" aria-hidden="true">
              <span class="usg-output" :style="{ height: height(day.outputTokens) }" />
              <span class="usg-cached" :style="{ height: height(day.cachedInputTokens) }" />
              <span class="usg-fresh" :style="{ height: height(fresh(day)) }" />
            </span>
            <span v-if="label(index)" class="usg-x">{{ day.key.slice(5) }}</span>
          </button>
        </div>
      </div>
    </div>
    <div class="daily-readout" aria-live="polite">
      <span v-if="selected"><b>{{ selected.key }}</b><strong>{{ num(selected.totalTokens) }}</strong> Token<span v-if="!selected.recorded" class="no-record">无本地记录</span></span>
      <div class="daily-legend" v-if="selected">
        <span><i class="sw-fresh" />净输入 {{ num(fresh(selected)) }}</span>
        <span><i class="sw-cached" />缓存 {{ num(selected.cachedInputTokens) }}</span>
        <span><i class="sw-output" />输出 {{ num(selected.outputTokens) }}</span>
      </div>
    </div>
  </section>
</template>
<style scoped>
.daily-chart { padding: 16px 18px 0; }
.daily-heading { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:6px 14px; }
.daily-heading h3 { margin:0; font-size:var(--text-sm); font-weight:600; color:var(--text); }
.daily-heading > span { font-size:var(--text-xs); color:var(--text-muted); font-variant-numeric:tabular-nums; }
.daily-plot { display:grid; grid-template-columns:42px minmax(0,1fr); gap:10px; margin:24px 0 32px; }
.usg-scale { position:relative; height:148px; text-align:right; font-size:var(--text-xs); font-variant-numeric:tabular-nums; color:var(--text-muted); }
.usg-scale span { position:absolute; right:0; transform:translateY(-50%); }
.usg-scale span:nth-child(1) { top:0; }.usg-scale span:nth-child(2) { top:50%; }.usg-scale span:nth-child(3) { top:100%; }
.daily-grid { position:relative; height:148px; }
.grid-line { position:absolute; left:0; right:0; border-top:1px solid var(--border); pointer-events:none; }
.grid-line.top { top:0; }.grid-line.middle { top:50%; border-top-style:dashed; }.grid-line.base { bottom:0; }
.daily-columns { position:relative; height:100%; display:grid; }
.usg-col { position:relative; display:block; width:100%; height:100%; margin:0; padding:0; border:0; border-radius:3px 3px 0 0; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.usg-col:hover, .usg-col.selected { background:color-mix(in srgb,var(--text) 4%,transparent); }
.usg-col:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.usg-stack { position:absolute; inset:0; width:62%; max-width:28px; margin:auto; display:flex; flex-direction:column; justify-content:flex-end; pointer-events:none; }
.usg-stack > span { flex-shrink:0; width:100%; }
.usg-output { background:var(--text-muted); }.usg-cached { background:var(--accent-light); }.usg-fresh { background:var(--accent); }
.usg-x { position:absolute; top:100%; left:50%; transform:translateX(-50%); padding-top:8px; white-space:nowrap; font-size:var(--text-xs); color:var(--text-muted); font-variant-numeric:tabular-nums; }
.daily-readout { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px 16px; min-height:46px; padding:10px 0; border-top:1px solid var(--border); font-size:var(--text-xs); color:var(--text-muted); }
.daily-readout b { margin-right:12px; font-weight:500; color:var(--text-secondary); }.daily-readout strong { margin-right:3px; font-weight:600; color:var(--text); font-variant-numeric:tabular-nums; }
.no-record { margin-left:8px; }.daily-legend { display:flex; flex-wrap:wrap; gap:8px 14px; }.daily-legend span { display:flex; align-items:center; gap:5px; font-variant-numeric:tabular-nums; }.daily-legend i { width:7px; height:7px; border-radius:1px; }.sw-fresh { background:var(--accent); }.sw-cached { background:var(--accent-light); }.sw-output { background:var(--text-muted); }
</style>
