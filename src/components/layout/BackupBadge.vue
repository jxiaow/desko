<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useBackupBadgeStore } from '../../stores/backupBadge'
import AppIcon from '../shared/AppIcon.vue'

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
  const s = syncing.value
  if (s) return `云端同步中 · ${s.text}${s.pct ? ` ${s.pct}%` : ''}`
  if (note.value) return `上次同步失败：${note.value} · 点击可重试`
  if (pending.value) return `${pending.value} 份还没传上云 · 点击立刻补传`
  if (status.value?.lastRoundAt) return `云端备份已开启 · 最近一轮 ${fmtTime(status.value.lastRoundAt)} · 点击立刻同步`
  return '云端备份已开启，等待第一轮 · 点击立刻同步'
})
</script>

<template>
  <button
    v-if="visible"
    class="titlebar-btn tb-util backup-badge"
    :class="syncing ? 'bb-sync' : note ? 'bb-error' : pending ? 'bb-wait' : 'bb-idle'"
    :title="tip"
    aria-label="云端同步"
    @click="store.syncNow()"
  >
    <AppIcon class="bb-icon" name="refresh" :size="16" />
    <span v-if="pending && !syncing" class="bb-text">{{ pending }}</span>
  </button>
</template>

<style scoped>
/* 尺寸与 hover 住在标题栏的 .titlebar-btn.tb-util 档（32×28、--radius-ib）：
   这颗只是那一排里的一员，状态色画在字形上，免得和 hover 的换色抢同一层。 */
.backup-badge { position: relative; }

.bb-text {
  position: absolute;
  right: 0;
  top: 1px;
  font-size: var(--text-2xs);
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--warning);
}

.backup-badge.bb-sync .bb-icon {
  color: var(--accent);
  animation: bb-spin 1.15s linear infinite;
}

.backup-badge.bb-wait .bb-icon { color: var(--warning); }

.backup-badge.bb-error .bb-icon { color: var(--danger); }

@keyframes bb-spin {
  to { transform: rotate(360deg); }
}
</style>
