<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DialogModel } from '../../services/api/codexDialog'
import { reasoningLabel } from '../../utils/codexReasoning'
import AppIcon from '../shared/AppIcon.vue'
import OptionSelect from '../shared/OptionSelect.vue'

const draft = defineModel<string>({ required: true })
const model = defineModel<string>('modelId', { required: true })
const effort = defineModel<string>('effort', { required: true })
const props = defineProps<{ models: DialogModel[]; currentModel?: DialogModel; status: string; ready: boolean; loading: boolean; sending: boolean; busy: boolean; stopping: boolean; approval: boolean }>()
const emit = defineEmits<{ send: []; stop: [] }>()
const textarea = ref<HTMLTextAreaElement>()
const modelOptions = computed(() => props.models.map(item => ({ value: item.model || item.id, label: item.displayName || item.model || item.id })))
const effortOptions = computed(() => (props.currentModel?.supportedReasoningEfforts || []).map(item => ({ value: item.reasoningEffort, label: reasoningLabel(item.reasoningEffort) })))
const disabled = computed(() => !props.ready || props.loading)
const hint = computed(() => !props.ready ? '连接已断开，草稿已保留' : props.busy ? `下一条：${props.currentModel?.displayName || model.value}${effort.value ? ` · ${reasoningLabel(effort.value)}` : ''}` : '模型与思考度对下一条消息生效')
function focus() { void nextTick(() => textarea.value?.focus({ preventScroll: true })) }
function resize() {
  const input = textarea.value
  if (!input) return
  input.style.height = 'auto'
  input.style.height = `${Math.min(innerHeight <= 650 ? 100 : 150, Math.max(parseFloat(getComputedStyle(input).minHeight), input.scrollHeight))}px`
}
function onKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!props.busy && !props.approval && !disabled.value && draft.value.trim()) emit('send') }
}
watch(draft, async () => { await nextTick(); resize() })
onMounted(() => { resize(); window.addEventListener('resize', resize) })
onUnmounted(() => window.removeEventListener('resize', resize))
defineExpose({ focus })
</script>

<template>
  <div class="composer-wrap">
    <form class="composer dialog-composer" @submit.prevent="!busy && !approval && !disabled && draft.trim() && emit('send')">
      <textarea ref="textarea" v-model="draft" aria-label="发给 Codex 的消息" :disabled="disabled" maxlength="32000" rows="1" placeholder="发消息，或描述要在项目里完成的任务…" @keydown="onKey" />
      <div class="composer-controls">
        <div class="composer-settings">
          <OptionSelect v-model="model" class="model-choice" aria-label="对话模型" :options="modelOptions" :disabled="disabled || !models.length" match-width />
          <OptionSelect v-model="effort" class="effort-choice" aria-label="思考度" :title="effortOptions.length ? '思考度' : '此模型未提供可选思考度'" :options="effortOptions.length ? effortOptions : [{ value: '', label: '默认思考度' }]" :disabled="disabled || !effortOptions.length" match-width />
        </div>
        <button v-if="busy" class="btn-secondary bar-btn composer-send stop" type="button" aria-label="停止任务" :disabled="stopping || sending || !ready" @click="emit('stop')"><span class="stop-mark" /><span>{{ stopping ? '停止中' : '停止' }}</span></button>
        <button v-else class="btn-primary bar-btn composer-send" type="submit" aria-label="发送" :disabled="!draft.trim() || disabled || approval"><AppIcon name="arrowRight" :size="14" /><span>发送</span></button>
      </div>
    </form>
    <div class="composer-caption"><span class="composer-feedback"><span v-if="status" class="task-status" role="status">{{ status }}</span><span class="next-message-hint">{{ hint }}</span></span><span v-if="!busy && !approval && ready" class="keyboard-hint">Enter 发送 · Shift+Enter 换行</span></div>
  </div>
</template>

<style scoped>
.composer-wrap { position: relative; width: 100%; }
.dialog-composer { margin: 0; padding: 16px 16px 12px; border: 1px solid transparent; border-radius: 12px; background: var(--bg-surface); }
textarea { display: block; width: 100%; min-height: 56px; max-height: 150px; resize: none; padding: 0 2px 8px; border: 0; border-radius: 0; outline: none; background: transparent; color: var(--text); font: var(--text-base)/25px var(--font-ui); }
textarea:focus-visible { box-shadow: none; }
textarea::placeholder { color: var(--text-muted); }
.composer-controls { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.composer-settings { display: flex; min-width: 0; align-items: center; gap: 8px; }
.composer-settings :deep(.opt-trigger) { height: 32px; min-height: 32px; padding: 0 10px; border: 0; background: var(--bg-canvas-input); font-size: var(--text-xs); }
.composer-settings :deep(.model-choice) { width: 164px; }
.composer-settings :deep(.effort-choice) { width: 116px; }
.composer-settings :deep(.opt-value) { min-width: 0; white-space: nowrap; }
.composer-send { display: inline-flex; flex: none; align-items: center; justify-content: center; gap: 6px; height: 32px; min-height: 32px; padding: 0 14px; border: 0; border-radius: var(--radius-ib); font-size: var(--text-sm); }
.composer-send:not(.stop):not(:disabled) { background: var(--accent-soft); color: var(--text-brand); }
.composer-send:disabled, .composer-send.stop { background: var(--fill); color: var(--text-muted); }
.stop-mark { width: 9px; height: 9px; border-radius: 1px; background: currentColor; }
.composer-caption { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; font-size: var(--text-xs); line-height: 18px; color: var(--text-muted); }
.composer-feedback { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; min-width: 0; }
.keyboard-hint { flex: none; }
@media (max-width: 600px) {
  .dialog-composer { padding: 12px 12px 10px; }
  .composer-settings { gap: 6px; }
  .composer-settings :deep(.opt-trigger) { min-width: 0; min-height: 44px; padding-inline: 8px; }
  .composer-settings :deep(.model-choice) { width: auto; max-width: 146px; }
  .composer-settings :deep(.effort-choice) { width: auto; max-width: 116px; }
  .composer-send { min-height: 44px; padding-inline: 12px; }
  .composer-send > svg, .keyboard-hint { display: none; }
}
@media (max-height: 650px) {
  .dialog-composer { padding-top: 10px; padding-bottom: 10px; }
  textarea { min-height: 40px; max-height: 100px; }
  .composer-caption { margin-top: 6px; }
}
</style>
