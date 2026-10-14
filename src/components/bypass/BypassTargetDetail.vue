<script setup lang="ts">
import { ref, watch } from 'vue'
import type { BypassTarget } from '../../services/api/bypass'
import { fmtTime, clockOf } from './bypassView'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  target: BypassTarget
  /** 库里那句结论的全文，由父级按 rowNote 规则给出 */
  note: string
  busy: boolean
}>()
const emit = defineEmits<{ edit: [value: string] }>()

const original = () => props.target.input || props.target.host
const draft = ref(original())
watch(() => props.target.input, () => { draft.value = original() })

const addrOf = (t: BypassTarget) => (t.kind === 'cidr' ? '按网段路由' : t.address || '尚未确认实际地址')
const egressOf = (t: BypassTarget) => t.interfaceName || '未查询到出口接口'
</script>

<template>
  <div class="detail-body">
    <p v-if="note" class="row-note">{{ note }}</p>
    <dl class="detail-facts">
      <div><dt>实际地址</dt><dd class="mono">{{ addrOf(target) }}</dd></div>
      <div><dt>出口接口</dt><dd>{{ egressOf(target) }}</dd></div>
      <div v-if="target.nextHop"><dt>指定网关</dt><dd class="mono">{{ target.nextHop }}</dd></div>
      <div><dt>上次探测</dt><dd :title="fmtTime(target.checkedAt)">{{ clockOf(target.checkedAt) }}</dd></div>
    </dl>
    <div class="row-edit">
      <span class="row-edit-label">原始输入</span>
      <input
        v-model="draft"
        class="mono"
        type="text"
        spellcheck="false"
        aria-label="该条目的原始输入"
        :disabled="busy"
        @keyup.enter="emit('edit', draft.trim())"
      />
      <button
        class="action-btn primary"
        type="button"
        :disabled="busy || !draft.trim() || draft.trim() === original()"
        @click="emit('edit', draft.trim())"
      >
        <AppIcon name="refresh" :size="13" />
        探测并保存修改
      </button>
    </div>
    <p v-if="target.applyBatch" class="row-note">修改目标或移出清单会保留原系统配置；需要清理时，请先撤销相关配置。</p>
  </div>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
.row-note {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-secondary);
}
.detail-body { display: flex; flex-direction: column; gap: var(--space-3); }
.detail-facts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: var(--space-3) 0 0;
  border-top: 1px solid var(--border);
}
.detail-facts > div { display: flex; align-items: baseline; gap: var(--space-3); }
.detail-facts dt { flex: 0 0 64px; font-size: var(--text-xs); color: var(--text-muted); }
.detail-facts dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
/* 改原文：输入框走 28px 档，与按钮同高同排 */
.row-edit { display: flex; align-items: center; gap: var(--space-2); }
.row-edit-label { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted); }
.row-edit input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 var(--space-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: var(--text-sm);
  line-height: 1.5;
}
.row-edit input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
</style>
