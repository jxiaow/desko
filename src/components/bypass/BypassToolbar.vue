<script setup lang="ts">
import AppIcon from '../shared/AppIcon.vue'
import type { ProbeJob } from './useBypassProbe'

defineProps<{
  input: string
  busy: boolean
  saving: boolean
  activeProbe: ProbeJob | null
  seconds: number
}>()
const emit = defineEmits<{
  'update:input': [value: string]
  probe: []; cancel: []
}>()
const probeLabel = (kind: ProbeJob['kind']) => ({ probe: '正在探测', row: '正在重新探测', edit: '正在探测修改后的目标', revalidate: '正在检查' })[kind]
</script>

<template>
  <section class="bp-probe" aria-label="目标探测">
    <div class="probe-heading">目标探测<span>确认网络状态后，再加入直连清单</span></div>
    <form class="page-bar" @submit.prevent="emit('probe')">
      <label class="probe-box">
        <AppIcon name="link" :size="16" />
        <input
          :value="input"
          type="text"
          spellcheck="false"
          placeholder="输入域名、URL、IPv4 地址或网段"
          aria-label="待探测目标"
          :disabled="busy"
          @input="emit('update:input', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <button class="btn-primary" type="submit" :disabled="busy || !input.trim()" @click.prevent="emit('probe')">
        <AppIcon name="globe" :size="14" />
        {{ activeProbe?.kind === 'probe' ? '正在探测' : saving ? '正在保存' : '开始探测' }}
      </button>
    </form>
    <div v-if="activeProbe" class="bp-probe-progress">
      <AppIcon name="refresh" :size="14" class="probe-working" />
      <span class="probe-progress-text" role="status">
        {{ activeProbe.cancelling ? '正在取消探测' : probeLabel(activeProbe.kind) }}
        <span class="mono probe-progress-target" :title="activeProbe.target">{{ activeProbe.target }}</span>
      </span>
      <span class="probe-elapsed">{{ seconds }} 秒</span>
      <button class="action-btn" type="button" :disabled="activeProbe.cancelling" @click="emit('cancel')">
        <AppIcon name="x" :size="13" />{{ activeProbe.cancelling ? '正在取消' : '取消探测' }}
      </button>
    </div>
    <p v-else class="probe-help">探测只读取网络状态，不会修改系统配置。</p>
  </section>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
.bp-probe { padding: var(--space-4) 0 var(--space-5); border-bottom: 1px solid var(--border); }
.probe-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-3); font-size: var(--text-base); font-weight: 600; color: var(--text); }
.probe-heading span { font-size: var(--text-xs); font-weight: 400; color: var(--text-muted); }
.bp-probe .page-bar { height: auto; min-height: 0; margin: 0; padding: 0; gap: var(--space-2); }
.probe-box { flex: 1; min-width: 0; height: 36px; display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-3); background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-ib); color: var(--text-muted); transition: box-shadow var(--transition), border-color var(--transition); }
.probe-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.probe-box input {
  flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  color: var(--text); font-family: inherit; font-size: var(--text-sm); line-height: 1.5;
}
.bp-probe .btn-primary { height: 36px; flex-shrink: 0; }
.probe-help { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--text-muted); }
.bp-probe-progress { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); min-height: 28px; color: var(--text-brand); }
.probe-progress-text { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--text-xs); }
.probe-progress-target { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.probe-elapsed { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); font-variant-numeric: tabular-nums; }
.bp-probe-progress .action-btn { flex-shrink: 0; }
.probe-working { flex-shrink: 0; animation: probe-turn 1.5s linear infinite; }
@keyframes probe-turn { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .probe-working { animation: none; } }
@media (max-width: 620px) {
  .probe-heading span { flex-basis: 100%; }
  .probe-progress-text { flex-wrap: wrap; gap: 2px; }
  .probe-progress-target { flex-basis: 100%; }
}
</style>
