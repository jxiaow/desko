<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useBackupBadgeStore } from '../../stores/backupBadge'

const store = useBackupBadgeStore()
const { status, syncing, note, visible, pending } = storeToRefs(store)

onMounted(() => { void store.start() })
onUnmounted(() => store.stop())

const fmtTime = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const tip = computed(() => {
  if (syncing.value) return `云端同步中 · ${syncing.value.text}`
  if (note.value) return `上次同步失败：${note.value} · 稍后自动重试`
  if (pending.value) return `${pending.value} 份还没传上云 · 稍后自动补传`
  return status.value?.lastRoundAt
    ? `云端备份已开启 · 最近一轮 ${fmtTime(status.value.lastRoundAt)}`
    : '云端备份已开启，等待第一轮'
})
</script>

<template>
  <span
    v-if="visible"
    class="backup-badge"
    :class="syncing ? 'bb-sync' : note ? 'bb-error' : pending ? 'bb-wait' : 'bb-idle'"
    :title="tip"
  >
    <svg class="bb-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
    <span v-if="syncing" class="bb-text">{{ syncing.pct }}%</span>
    <span v-else-if="pending" class="bb-text">{{ pending }}</span>
  </span>
</template>

<style scoped>
.backup-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-muted);
  user-select: none;
  -webkit-user-select: none;
}

.bb-icon { flex-shrink: 0; display: block; }

.bb-text { font-variant-numeric: tabular-nums; }

.bb-sync { color: var(--accent); }
.bb-sync .bb-icon { animation: bb-pulse 1.1s ease-in-out infinite; }

.bb-wait { color: var(--warning); }

.bb-error { color: var(--danger); }

@keyframes bb-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
</style>
