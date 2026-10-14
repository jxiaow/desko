<script setup lang="ts">
import { computed } from 'vue'
import type { CodexAccount } from '../../services/api/codex'
import { codexAdditionalQuotaWindows, codexCredits, codexQuotaWindows } from '../../utils/codexQuota'
import CodexQuotaResetTime from './CodexQuotaResetTime.vue'

const props = defineProps<{ account: CodexAccount }>()
const windows = computed(() => [...codexQuotaWindows(props.account), ...codexAdditionalQuotaWindows(props.account)])
const credits = computed(() => codexCredits(props.account))
const pending = computed(() => props.account.authorization_status?.trim().toLowerCase() === 'pending')
const error = computed(() => props.account.quota_error?.message?.trim())
const resetCredits = computed(() => props.account.quota?.reset_credits_available ?? 0)
const formatNumber = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
</script>

<template>
  <div class="acc-quota">
    <template v-if="!pending && (windows.length || credits)">
      <div class="quota-heading"><span>剩余额度</span><span v-if="error" class="bad" :title="error">刷新失败 · 保留上次数据</span></div>
      <div class="quota-windows">
        <div v-for="window in windows" :key="window.id" class="q" :data-window="window.id" :class="{ low: window.percentage <= 20, mid: window.percentage > 20 && window.percentage <= 40, blocked: window.blockedBy, additional: window.id.startsWith('additional:') }">
          <div class="q-top"><span class="q-tag" :title="window.label">{{ window.label }}</span><span class="q-num">{{ window.percentage }}<small>%</small></span></div>
          <span class="q-bar" role="meter" :aria-label="`${window.label}剩余`" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="window.percentage"><i :style="{ width: `${window.percentage}%` }"></i></span>
          <div class="q-meta">
            <span v-if="window.id === windows[0]?.id && resetCredits > 0" class="reset-credits">可重置 {{ resetCredits }} 次</span>
            <CodexQuotaResetTime :timestamp="window.resetTime" :now="Date.now()" />
          </div>
          <span v-if="window.blockedBy" class="bad">{{ window.blockedBy }}用尽，暂不可用</span>
        </div>
        <div v-if="credits" class="q credits" :class="{ 'no-progress': credits.percentage === null }" data-window="credits">
          <div class="q-top"><span class="q-tag">{{ credits.monthly ? '本月 Credits' : 'Credits 余额' }}</span><span v-if="credits.percentage !== null" class="q-num">{{ credits.percentage }}<small>%</small></span></div>
          <span v-if="credits.percentage !== null" class="q-bar" role="meter" aria-label="Credits 剩余" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="credits.percentage"><i :style="{ width: `${credits.percentage}%` }"></i></span>
          <div class="credit-details"><span class="credit-number">{{ credits.unlimited ? '不限额' : credits.remaining !== null ? formatNumber(credits.remaining) : '—' }}</span><span v-if="credits.total !== null" class="credit-total"> / 总额度 {{ formatNumber(credits.total) }}</span></div>
          <div v-if="credits.monthly || (!windows.length && resetCredits > 0)" class="q-meta">
            <span v-if="!windows.length && resetCredits > 0" class="reset-credits">可重置 {{ resetCredits }} 次</span>
            <CodexQuotaResetTime v-if="credits.monthly" :timestamp="credits.resetTime" :now="Date.now()" />
          </div>
        </div>
      </div>
    </template>
    <div v-else class="quota-empty">
      <span class="quota-heading">额度状态</span>
      <span class="q-when" :class="{ bad: error }" :title="error || undefined">{{ error ? '配额拉取失败' : pending ? '授权后获取额度' : account.auth_mode === 'apikey' ? '按供应商计费' : '暂无配额' }}</span>
      <span v-if="!error && account.auth_mode === 'apikey'" class="quota-explanation">此服务未提供额度数据</span>
    </div>
  </div>
</template>

<style scoped>
.acc-quota { min-width: 0; align-self: stretch; border-left: 1px solid var(--border); padding-left: 18px; }
.quota-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 28px; padding-right: 90px; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.5; margin-bottom: 7px; }
.quota-windows { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.q { display: grid; grid-template-columns: 88px minmax(0, 1fr) 40px; align-items: center; gap: 4px 8px; min-width: 0; color: var(--text-secondary); font-size: var(--text-xs); }
.q-top { display: contents; }
.q-tag { grid-column: 1; grid-row: 1; min-width: 0; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.q-num { grid-column: 3; grid-row: 1; text-align: right; color: var(--text); font-size: 16px; font-weight: 500; line-height: 1.2; font-variant-numeric: tabular-nums; }
.q-num small { margin-left: 2px; color: var(--text-muted); font-size: var(--text-xs); font-weight: 400; }
.q-bar { grid-column: 2; grid-row: 1; display: block; height: 5px; border-radius: 3px; background: var(--fill); overflow: hidden; }
.q-bar i { display: block; height: 100%; background: var(--success); border-radius: inherit; }
.q.mid .q-bar i { background: var(--warning); }
.q.low .q-bar i { background: var(--danger); }
.q-when, .credit-total { color: var(--text-muted); font-size: var(--text-xs); line-height: 1.5; }
.q-when { overflow-wrap: anywhere; }
.q-meta { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; min-width: 0; }
.reset-credits { color: var(--text-secondary); white-space: nowrap; }
.q > .bad { grid-column: 2 / -1; }
.q.additional { grid-template-columns: minmax(0, 1fr) 40px; }
.q.additional .q-tag { grid-column: 1 / -1; grid-row: 1; }
.q.additional .q-bar { grid-column: 1; grid-row: 2; }
.q.additional .q-num { grid-column: 2; grid-row: 2; }
.q.additional .q-meta { grid-column: 1 / -1; }
.bad { color: var(--warning); }
.quota-empty { display: flex; flex-direction: column; gap: 5px; }
.quota-empty .quota-heading { margin-bottom: 0; }
.quota-explanation { color: var(--text-muted); font-size: var(--text-xs); line-height: 1.5; }
.credit-details { grid-column: 2 / -1; min-width: 0; }
.credit-number { color: var(--text); font-size: var(--text-sm); font-weight: 500; font-variant-numeric: tabular-nums; }
.no-progress .credit-details { grid-row: 1; }
@media (max-width: 850px) {
  .acc-quota { padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--border); }
  .quota-heading { min-height: 0; padding-right: 0; }
}
</style>
