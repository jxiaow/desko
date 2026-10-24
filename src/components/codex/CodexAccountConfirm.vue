<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'
const props = defineProps<{ title: string; action: string; busy: boolean; done?: boolean; disabled?: boolean; stage?: string; error?: string; retry?: boolean }>()
const emit = defineEmits<{ close: []; confirm: []; retry: [] }>()
const panel = ref<HTMLElement>()
const previousFocus = document.activeElement as HTMLElement | null
function close() { if (!props.busy) emit('close') }
useEscapeClose(close)
function trap(event: KeyboardEvent) {
  const controls = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')].filter(el => el.getClientRects().length)
  if (!controls.length) { event.preventDefault(); return }
  const first = controls[0]!, last = controls[controls.length - 1]!
  if (!controls.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
  else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
watch(() => props.busy, busy => { if (busy) panel.value?.focus() }, { flush: 'post' })
onMounted(() => panel.value?.focus())
onUnmounted(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }) })
</script>
<template>
  <Teleport to="body">
    <div class="dialog-overlay" @click.self="close">
      <section ref="panel" class="dialog codex-account-confirm" role="dialog" aria-modal="true" :aria-label="title" :aria-busy="busy" tabindex="-1" @keydown.tab="trap">
        <header class="dialog-header"><h3>{{ title }}</h3><button class="dialog-close" type="button" aria-label="关闭" :disabled="busy" @click="close"><AppIcon name="x" :size="15" /></button></header>
        <div class="dialog-body">
          <slot />
          <p v-if="busy" class="switch-stage" role="status">{{ stage || '正在处理…' }}</p>
          <p v-if="error" class="switch-error" role="alert">{{ error }}</p>
          <button v-if="retry && !busy" class="action-btn" type="button" @click="emit('retry')">重试</button>
        </div>
        <footer class="dialog-footer"><span class="confirm-escape"><kbd>Esc</kbd>关闭</span><button class="btn-secondary" type="button" :disabled="busy" @click="close">{{ done ? '完成' : '取消' }}</button><button class="btn-danger" type="button" :disabled="busy || disabled" @click="emit('confirm')">{{ busy ? '处理中…' : action }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
<style>
.codex-account-confirm { width: 360px; max-width: calc(100vw - 32px); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; outline: none; }
.codex-account-confirm .dialog-header { min-height: 44px; height: 44px; padding: 0 16px; flex-shrink: 0; }
.codex-account-confirm .dialog-header h3 { font-size: var(--text-dialog-title); font-weight: 600; }
.codex-account-confirm .dialog-body { padding: 16px; min-height: 0; overflow: auto; }
.codex-account-confirm .dialog-body > p:first-child { margin-top: 0; }
.codex-account-confirm .dialog-footer { min-height: 46px; padding: 8px 16px; gap: 8px; flex-shrink: 0; }
.codex-account-confirm .dialog-footer button { height: 28px; min-height: 28px; font-size: var(--text-sm); padding: 0 12px; white-space: nowrap; }
.codex-account-confirm[aria-busy="true"] .confirm-escape { display: none; }
.codex-account-confirm .dialog-footer .btn-danger { max-width: calc(100% - 64px); overflow: hidden; text-overflow: ellipsis; }
.codex-account-confirm .confirm-escape { display: flex; align-items: center; gap: 4px; margin-right: auto; color: var(--text-muted); font-size: var(--text-xs); white-space: nowrap; }
.codex-account-confirm .confirm-escape kbd { padding: 1px 4px; border: 1px solid var(--border); border-radius: 4px; background: var(--panel-bg); font: var(--text-caption)/1.3 var(--font-ui); }
.codex-account-confirm .scope-nowrap { white-space: nowrap; }
.codex-account-confirm .confirm-copy { font-size: var(--text-content); line-height: var(--leading-copy); color: var(--text-secondary); overflow-wrap: anywhere; }
.codex-account-confirm .confirm-copy b { color: var(--text); font-weight: 600; }
.codex-account-confirm .switch-scopes { margin-top: 12px; border-block: 1px solid var(--border); }
.codex-account-confirm .switch-scope { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 10px; padding: 8px 0; color: var(--text-secondary); font-size: var(--text-xs); line-height: 1.55; }
.codex-account-confirm .switch-scope + .switch-scope { border-top: 1px solid var(--border-subtle); }
.codex-account-confirm .switch-scope > :first-child { padding-top: 1px; color: var(--text-faint); font-size: var(--text-xs); font-weight: 600; letter-spacing: .03em; }
.codex-account-confirm .switch-note { display: flex; align-items: flex-start; gap: 6px; margin: 10px 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
.codex-account-confirm .switch-note svg { flex: none; margin-top: 3px; }
.codex-account-confirm .switch-note.warn { color: var(--warning); }
.codex-account-confirm .switch-stage { font-size: var(--text-xs); color: var(--text-secondary); }
.codex-account-confirm .switch-error { color: var(--danger); font-size: var(--text-xs); line-height: 1.6; overflow-wrap: anywhere; }
@media (max-width: 760px), (hover: none) and (max-width: 1024px) {
  .codex-account-confirm .dialog-footer button, .codex-account-confirm .dialog-close { min-height: 44px; }
  .codex-account-confirm[aria-busy="true"] .confirm-escape { display: none; }
.codex-account-confirm .dialog-footer .btn-danger { max-width: calc(100% - 64px); overflow: hidden; text-overflow: ellipsis; }
.codex-account-confirm .confirm-escape { display: none; }
}
</style>
