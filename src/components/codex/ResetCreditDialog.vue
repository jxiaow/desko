<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  codexApi,
  type CodexAccount,
  type CodexResetCredit,
  type CodexResetCreditsSnapshot,
} from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ account: CodexAccount }>()
const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
useEscapeClose(close)
let active = true
onUnmounted(() => { active = false })

const snapshot = ref<CodexResetCreditsSnapshot | null>(null)
const loading = ref(true)
const loadError = ref('')
const busy = ref(false)

/** 快照里的数是这次拉的，比列表响应新；取不到就回落到列表那一个 */
const left = computed(
  () => snapshot.value?.available_count ?? props.account.quota?.reset_credits_available ?? 0,
)
const credits = computed(() => snapshot.value?.credits ?? [])
const nextExpiry = computed(() => snapshot.value?.next_expires_at ?? null)
const canConsume = computed(() => !loading.value && !busy.value && !loadError.value && (snapshot.value?.available_count ?? 0) > 0)

function close() {
  if (!busy.value) emit('close')
}

async function load() {
  if (!active || busy.value) return
  loading.value = true
  loadError.value = ''
  try {
    const result = await codexApi.resetCredits(props.account.id)
    if (active) snapshot.value = result
  } catch (e) {
    if (active) loadError.value = errText(e)
  } finally {
    if (active) loading.value = false
  }
}
onMounted(load)

const pad = (n: number) => String(n).padStart(2, '0')
const clockOf = (sec?: number | null) => {
  if (!sec) return ''
  const d = new Date(sec * 1000)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const REDEEMED = ['redeemed', 'used', 'consumed']
const AVAILABLE = ['available', 'active', 'granted']

/** 与后端 is_available_reset_credit 同一套判据：认不出就先看它过期没 */
function statusOf(c: CodexResetCredit): { label: string; ok: boolean } {
  const raw = (c.status ?? c.raw_status ?? '').trim().toLowerCase()
  if (REDEEMED.includes(raw)) return { label: '已使用', ok: false }
  if (raw === 'expired') return { label: '已过期', ok: false }
  if (raw && !AVAILABLE.includes(raw)) return { label: '未知', ok: false }
  if (c.expires_at && c.expires_at * 1000 <= Date.now()) return { label: '已过期', ok: false }
  return { label: '可用', ok: true }
}

/** 已用掉的那几张只有"什么时候用掉的"有意义，用它换掉"到期" */
const usedAt = (c: CodexResetCredit) =>
  statusOf(c).label === '已使用' && c.redeemed_at ? clockOf(c.redeemed_at) : ''

async function consume() {
  if (!active || !canConsume.value) return
  busy.value = true
  try {
    await codexApi.consumeResetCredit(props.account.id)
    if (!active) return
    toastStore.showToast('已使用一次额度重置')
    await refreshAccounts()
    if (!active) return
    emit('close')
  } catch (e) {
    if (!active) return
    toastStore.showToast(errText(e), 'error')
    busy.value = false
    // 请求报错也可能已被服务端执行，重新核对余次后才允许用户再次确认。
    snapshot.value = null
    await load()
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="close">
    <div class="dialog reset-credit-dialog" role="dialog" aria-modal="true" aria-label="重置 5 小时额度">
      <div class="dialog-header">
        <h3>重置 5 小时额度</h3>
        <button class="dialog-close" type="button" title="关闭" :disabled="busy" @click="close">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <p class="rc-meta">
          将立即用掉 <b>{{ account.email }}</b> 的一次 5 小时额度重置，用掉后不可撤销（当前还剩
          <span class="num">{{ left }}</span> 次）。
        </p>
        <p v-if="nextExpiry" class="rc-exp">
          <AppIcon name="clock" :size="14" />最近到期：{{ clockOf(nextExpiry) }}
        </p>
        <div class="rc-details">
          <div class="rc-details-title">重置次数明细</div>
          <div v-if="loading" class="rc-empty"><AppIcon name="refresh" :size="13" />加载中…</div>
          <div v-else-if="loadError" class="rc-error">
            加载重置记录失败：{{ loadError }}
            <button class="btn-secondary" type="button" @click="load">重试</button>
          </div>
          <div v-else-if="!credits.length" class="rc-empty">{{ left <= 0 ? '当前没有可用的重置次数' : '暂无重置记录' }}</div>
          <div v-else class="rc-list">
            <div
              v-for="(c, i) in credits"
              :key="c.id || `${c.status || 'credit'}-${i}`"
              class="rc-row"
            >
              <span class="rc-status" :class="{ ok: statusOf(c).ok }">{{ statusOf(c).label }}</span>
              <span v-if="c.granted_at" class="rc-fact">
                发放：<span class="mono">{{ clockOf(c.granted_at) }}</span>
              </span>
              <span v-if="usedAt(c)" class="rc-fact">
                使用：<span class="mono">{{ usedAt(c) }}</span>
              </span>
              <span v-else-if="c.expires_at" class="rc-fact">
                到期：<span class="mono">{{ clockOf(c.expires_at) }}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" type="button" :disabled="busy" @click="close">取消</button>
        <button class="btn-danger" type="button" :disabled="!canConsume" @click="consume">{{ busy ? '重置中…' : '确认重置' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reset-credit-dialog {
  width: 420px;
}
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }

.rc-meta { font-size: var(--text-xs); line-height: 1.7; color: var(--text-secondary) }
.rc-meta b { font-weight: 600; color: var(--text) }
.num { font-family: var(--font-mono); font-weight: 600; color: var(--text) }

.rc-exp {
  margin-top: 10px; display: flex; align-items: center; gap: 6px;
  font-size: var(--text-xs); color: var(--text-secondary);
}

.rc-details { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border) }
.rc-details-title {
  font-size: var(--text-xs); font-weight: 600; letter-spacing: .04em; color: var(--text-muted);
}
.rc-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 168px; overflow: auto; scrollbar-gutter: stable }
.rc-row {
  display: flex; align-items: center; gap: 8px;
  font-size: var(--text-xs); line-height: 18px; color: var(--text-secondary);
}
.rc-status {
  flex-shrink: 0; padding: 1px 8px; border-radius: var(--radius-pill); background: var(--fill);
  font-size: var(--text-2xs); font-weight: 600; line-height: 18px; color: var(--text-secondary);
}
.rc-status.ok { background: var(--success-soft); color: var(--success) }

.rc-empty { margin-top: 8px; display: flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-muted) }
.rc-error { margin-top: 8px; font-size: var(--text-xs); color: var(--danger) }
</style>
