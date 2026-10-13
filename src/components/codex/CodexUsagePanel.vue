<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { CodexUsageBucket } from '../../services/api/codex'
import { loadUsage, usageBusy, usageError, usageReport } from '../../services/codexState'
import AppIcon from '../shared/AppIcon.vue'

/** 进这一档才扫：首扫要读完官方目录那几百 MB，留在别的页不该替它买单 */
onMounted(() => {
  if (!usageReport.value && !usageBusy.value) void loadUsage()
})

/** 千分位自己插：toLocaleString 会随运行时 locale 换分隔符，断言与真机就不一个样了 */
const num = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** 柱子只画窗口内最近 30 天；总量行仍报整窗口 */
const days = computed<CodexUsageBucket[]>(() => usageReport.value?.byDay.slice(-30) ?? [])
/** 柱子画的是输入的两段（净输入 + 缓存命中），所以标定高度也按输入，不然最满的一天只到七八成 */
const maxInput = computed(() => days.value.reduce((m, d) => Math.max(m, d.inputTokens), 0))
const models = computed(() => usageReport.value?.byModel ?? [])

/** 净输入：官方把每轮重发的上下文全记进 input，减掉缓存命中才是真正新烧的钱 */
function freshInput(bucket: CodexUsageBucket): number {
  return Math.max(0, bucket.inputTokens - bucket.cachedInputTokens)
}

/** 收成一位小数：条的宽度与旁边的百分比必须同一个数，不然看着就对不上账 */
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

/** 一段至少留 2%，不然「净输入只有几千」的日子看起来像零用量；小数收一位，悬停与断言读同一个数 */
function barHeight(tokens: number): string {
  if (maxInput.value <= 0 || tokens <= 0) return '0px'
  const scaled = Math.round((tokens / maxInput.value) * 1000) / 10
  return `${Math.max(scaled, 2)}%`
}

function dayTitle(d: CodexUsageBucket): string {
  return [
    d.key,
    `输入 ${num(d.inputTokens)}（净 ${num(freshInput(d))} + 缓存 ${num(d.cachedInputTokens)}，柱子画的就是这两段）`,
    `输出 ${num(d.outputTokens)}`,
    `合计 ${num(d.totalTokens)}`,
    `${num(d.requestCount)} 轮`,
  ].join(' · ')
}

/** 只给首末和整周标日期，密了就读不出数 */
function showLabel(index: number, length: number): boolean {
  if (length <= 8) return true
  if (index === 0 || index === length - 1) return true
  return (length - 1 - index) % 7 === 0
}

function labelOf(d: CodexUsageBucket): string {
  return d.key.slice(5)
}

const totals = computed(() => usageReport.value?.totals ?? null)
const scanSeconds = computed(() => ((usageReport.value?.scanMillis ?? 0) / 1000).toFixed(1))
const hasChart = computed(() => days.value.length > 0)
</script>

<template>
  <div class="usg-view">
    <div v-if="usageError" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="alert" :size="24" /></div>
      <div class="empty-title">读不到用量</div>
      <div class="empty-desc" :title="usageError">{{ usageError }}</div>
      <button class="action-btn primary" type="button" @click="loadUsage()">重试</button>
    </div>

    <div v-else-if="usageBusy && !totals" class="rcard usg-wait">
      <AppIcon name="refresh" :size="13" />
      正在读官方会话目录…
    </div>

    <div v-else-if="!hasChart" class="rcard empty-state">
      <div class="empty-icon"><AppIcon name="clock" :size="24" /></div>
      <div class="empty-title">这个窗口里没有 token 记录</div>
      <div class="empty-desc">换一档统计窗口，或者先在 Codex 里跑几轮会话</div>
    </div>

    <template v-else-if="totals">
      <div class="rcard usg-sum">
        <span class="usg-sum-main">
          <span class="usg-num mono-ish">{{ num(totals.totalTokens) }}</span>
          <span class="usg-sum-label">总 token</span>
        </span>
        <span class="usg-chips">
          <span class="usg-chip">净输入 <b class="mono-ish">{{ num(totals.inputTokens - totals.cachedInputTokens) }}</b></span>
          <span class="usg-chip">缓存命中 <b class="mono-ish">{{ num(totals.cachedInputTokens) }}</b></span>
          <span class="usg-chip">输出 <b class="mono-ish">{{ num(totals.outputTokens) }}</b></span>
          <span class="usg-chip">其中推理 <b class="mono-ish">{{ num(totals.reasoningOutputTokens) }}</b></span>
          <span class="usg-chip">{{ num(totals.requestCount) }} 轮 · {{ num(totals.sessionCount) }} 条会话</span>
        </span>
      </div>

      <div class="rcard usg-chart">
        <div class="usg-bars" :data-days="days.length" :data-max="maxInput">
          <div v-for="(d, i) in days" :key="d.key" class="usg-col" :title="dayTitle(d)">
            <div class="usg-stack">
              <div class="usg-cached" :style="{ height: barHeight(d.cachedInputTokens) }"></div>
              <div class="usg-fresh" :style="{ height: barHeight(freshInput(d)) }"></div>
            </div>
            <span class="usg-x" :class="{ shown: showLabel(i, days.length) }">{{ labelOf(d) }}</span>
          </div>
        </div>
        <div class="usg-legend">
          <span class="usg-key"><i class="usg-swatch sw-fresh"></i>净输入</span>
          <span class="usg-key"><i class="usg-swatch sw-cached"></i>缓存命中</span>
          <span class="usg-hint">柱高按当天输入，输出看悬停与上面的总量行</span>
          <span class="usg-scan mono-ish">
            扫了 {{ num(totals.fileCount) }} 个文件 · {{ scanSeconds }} s
          </span>
        </div>
      </div>

      <div v-if="models.length" class="rcard usg-models">
        <div class="usg-model-title">按模型</div>
        <div
          v-for="m in models"
          :key="m.key"
          class="usg-model-row"
          :data-model="m.key"
          :title="`${m.label}：合计 ${num(m.totalTokens)} · 净输入 ${num(freshInput(m))} · 缓存 ${num(m.cachedInputTokens)} · 输出 ${num(m.outputTokens)}`"
        >
          <span class="usg-model-name">{{ m.label }}</span>
          <span class="usg-track"><span class="usg-fill" :style="{ width: `${pct(m.totalTokens, totals.totalTokens)}%` }"></span></span>
          <span class="usg-model-num mono-ish">{{ num(m.totalTokens) }}</span>
          <span class="usg-model-pct mono-ish">{{ pct(m.totalTokens, totals.totalTokens).toFixed(1) }}%</span>
        </div>
      </div>
    </template>

    <p class="page-note">
      <AppIcon name="info" :size="13" />
      按天的数字来自官方会话文件里逐轮累计快照的差值，与「会话」档每条会话的合计同源；
      会话一经移出官方目录，图上那一天也随之减少。
    </p>
  </div>
</template>

<style scoped>
.usg-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.usg-sum {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 64px;
  padding: 0 14px;
}
.usg-sum-main {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 2px;
}
.usg-num {
  font-size: var(--text-lg);
  color: var(--text);
}
.usg-sum-label {
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.usg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.usg-chip b {
  color: var(--text-secondary);
  font-weight: 500;
}
.usg-wait {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 14px;
  font-size: var(--text-xs);
  color: var(--text-muted);
}
.usg-chart {
  padding: 14px;
}
.usg-bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 132px;
}
.usg-col {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  align-items: center;
  height: 100%;
  min-width: 0;
}
.usg-stack {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: flex-end;
  width: 100%;
  /* 窗口里只有三四天时别把柱子拉成两块板；30 天密档本来就够不到这个宽 */
  max-width: 44px;
  gap: 1px;
}
/* 缓存在上方、净输入压在柱底：柱子一眼读的是「真实用量占这根柱的多少」 */
.usg-cached {
  width: 100%;
  min-height: 0;
  border-radius: 2px 2px 0 0;
  background: var(--accent-light);
}
.usg-fresh {
  width: 100%;
  min-height: 0;
  border-radius: 0 0 2px 2px;
  background: var(--accent);
}
.usg-col:hover .usg-fresh {
  background: var(--accent-hover);
}
.usg-x {
  height: 14px;
  margin-top: 4px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
  visibility: hidden;
}
.usg-x.shown {
  visibility: visible;
}
.usg-legend {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: 6px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.usg-key {
  display: flex;
  align-items: center;
  gap: 5px;
}
.usg-hint {
  color: var(--text-faint);
}
.usg-swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.sw-fresh {
  background: var(--accent);
}
.sw-cached {
  background: var(--accent-light);
}
.usg-scan {
  margin-left: auto;
}
.usg-models {
  padding: 6px 14px 10px;
}
.usg-model-title {
  padding: 6px 0 4px;
  font-size: var(--text-2xs);
  color: var(--text-muted);
}
.usg-model-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 34px;
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
}
.usg-model-name {
  flex: 0 0 26%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.usg-track {
  flex: 1 1 auto;
  height: 6px;
  border-radius: 3px;
  background: var(--hover-chrome);
  overflow: hidden;
}
.usg-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
}
.usg-model-num {
  flex-shrink: 0;
  min-width: 76px;
  text-align: right;
  color: var(--text-secondary);
}
.usg-model-pct {
  flex-shrink: 0;
  min-width: 46px;
  text-align: right;
  color: var(--text-muted);
}
.mono-ish {
  font-family: var(--font-mono);
}
</style>
