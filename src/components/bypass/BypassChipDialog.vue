<script setup lang="ts">
import type { BypassTarget } from '../../services/api/bypass'
import { flagsOf, hostOf, verdictClass, verdictLabel } from './bypassView'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'
import BypassTargetDetail from './BypassTargetDetail.vue'

defineProps<{
  target: BypassTarget
  note: string
  busy: boolean
}>()
const emit = defineEmits<{ close: []; edit: [value: string]; recheck: []; remove: [] }>()
useEscapeClose(() => emit('close'))
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog detail-dialog" role="dialog" aria-modal="true" aria-label="直连详情">
      <div class="dialog-header">
        <h3>直连详情</h3>
        <button class="dialog-close" type="button" title="关闭" :disabled="busy" @click="emit('close')">
          <AppIcon name="x" :size="16" />
        </button>
      </div>
      <div class="dialog-body">
        <div class="detail-head">
          <span class="badge" :class="verdictClass(target.verdict)">{{ verdictLabel(target.verdict) }}</span>
          <span v-for="f in flagsOf(target)" :key="f.label" class="badge" :class="f.cls" :title="f.tip">{{ f.label }}</span>
        </div>
        <p class="detail-target mono" :title="target.host">{{ hostOf(target) }}</p>
        <BypassTargetDetail :target="target" :note="note" :busy="busy" @edit="emit('edit', $event)" />
      </div>
      <div class="dialog-footer">
        <div class="footer-hints">
          <span class="kbd">Esc</span><span>关闭</span>
        </div>
        <button class="btn-secondary danger" type="button" :disabled="busy" @click="emit('remove')">
          <AppIcon name="trash" :size="13" />
          移出清单
        </button>
        <button class="btn-primary" type="button" :disabled="busy" @click="emit('recheck')">
          <AppIcon name="refresh" :size="13" />
          重新探测
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
.detail-dialog { width: 520px; }
.detail-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.detail-target {
  margin: var(--space-2) 0 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text);
  overflow-wrap: anywhere;
}
.detail-dialog .detail-body { margin-top: var(--space-4); }
.detail-dialog .detail-facts { padding-top: 0; border-top: none; }
/* 移出清单是这一页少数的破坏性动作，底栏只给它描边＋红字，不给红底 */
.detail-dialog .btn-secondary.danger { color: var(--danger); }
.detail-dialog .btn-secondary.danger:hover:not(:disabled) { border-color: var(--danger); }
</style>
