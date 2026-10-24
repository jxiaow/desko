<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DialogRequest } from '../../services/api/codexDialog'
const props = defineProps<{ request: DialogRequest; respond: (payload: Record<string, unknown>) => Promise<void>; disabled?: boolean }>()
const answers = ref<Record<string, string>>({})
const sending = ref(false)
const error = ref('')
const input = computed(() => props.request.method === 'item/tool/requestUserInput')
const permissions = computed(() => props.request.method === 'item/permissions/requestApproval')
const decisions = computed(() => {
  const values = permissions.value ? ['accept', 'decline'] : props.request.params.availableDecisions || ['accept', 'decline', 'cancel']
  return [{ value: 'accept', label: permissions.value ? '授权本轮' : '允许一次' }, { value: 'decline', label: '拒绝' }, { value: 'cancel', label: '取消任务' }].filter(d => values.includes(d.value))
})
async function submit(decision?: string) {
  sending.value = true; error.value = ''
  try {
    await props.respond({ requestId: props.request.id, threadId: props.request.params.threadId, decision,
      answers: Object.fromEntries(Object.entries(answers.value).map(([id, value]) => [id, [value]])) })
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); sending.value = false }
}
</script>
<template>
  <section class="dialog-approval" aria-label="待处理的 Codex 请求">
    <strong>{{ input ? '需要你的补充' : permissions ? '请求临时权限' : '等待你的审批' }}</strong>
    <p v-if="request.params.reason">{{ request.params.reason }}</p>
    <p v-if="request.params.cwd" class="request-path">{{ request.params.cwd }}</p>
    <p v-if="request.params.grantRoot" class="request-path">请求写入目录：{{ request.params.grantRoot }}</p>
    <pre v-if="request.params.command">{{ request.params.command }}</pre>
    <pre v-if="permissions">{{ JSON.stringify(request.params.permissions, null, 2) }}</pre>
    <form v-if="input" @submit.prevent="submit()">
      <fieldset v-for="question in request.params.questions" :key="question.id" :disabled="sending || disabled">
        <legend>{{ question.question }}</legend>
        <div v-if="question.options" class="question-options">
          <button v-for="option in question.options" :key="option.label" class="action-btn" type="button" :aria-pressed="answers[question.id] === option.label" :title="option.description" @click="answers[question.id] = option.label">{{ option.label }}</button>
        </div>
        <input v-model="answers[question.id]" class="text-input" :type="question.isSecret ? 'password' : 'text'" :aria-label="question.question" maxlength="4000" required placeholder="输入回答" />
      </fieldset>
      <button class="action-btn primary" :disabled="sending || disabled" type="submit">提交回答</button>
    </form>
    <div v-else class="approval-actions">
      <button v-for="decision in decisions" :key="decision.value" class="action-btn" :class="{ primary: decision.value === 'accept' }" :disabled="sending || disabled" @click="submit(decision.value)">{{ decision.label }}</button>
      <span v-if="!decisions.length">此审批类型暂不支持，请停止任务。</span>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.dialog-approval { border: 1px solid var(--border-strong); padding: 16px; border-radius: 8px; margin: 0; background: var(--hover); font-size: var(--text-sm); }
.dialog-approval + .dialog-approval { margin-top: 12px; }
.dialog-approval > strong { font-size: var(--text-base); font-weight: 600; }
.action-btn { height: 36px; font-size: var(--text-sm); }
p { margin: 7px 0; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; font: 12px/1.6 var(--font-mono); }
.request-path { color: var(--text-secondary); }
.approval-actions, .question-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
fieldset { min-width: 0; border: 0; padding: 10px 0; margin: 0; }
legend { padding: 0; }
.text-input { width: 100%; height: 36px; margin-top: 10px; font-size: var(--text-sm); background: var(--bg-input); }
.text-input::placeholder { color: var(--text-muted); }
.text-input:focus { background: var(--bg-input-focus); }
.text-input:disabled { background: var(--fill); color: var(--text-secondary); cursor: not-allowed; }
.question-options .action-btn[aria-pressed='true']:not(:disabled) { color: var(--text-brand); border-color: var(--accent); background: var(--accent-soft); }
@media (max-width: 600px) { .dialog-approval { padding: 12px; } .action-btn, .text-input { min-height: 44px; } .text-input { font-size: var(--text-lg); } }
</style>
