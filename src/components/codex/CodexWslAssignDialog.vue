<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { codexApi, type CodexAccount, type CodexWslAssignmentPreview } from '../../services/api/codex'
import { assignToWsl, switchStep } from '../../services/codexState'
import { errText } from '../../services/api/backup'
import CodexAccountConfirm from './CodexAccountConfirm.vue'
import AppIcon from '../shared/AppIcon.vue'
const props = defineProps<{ account: CodexAccount }>()
const emit = defineEmits<{ close: [] }>()
const preview = ref<CodexWslAssignmentPreview | null>(null)
const loading = ref(true), busy = ref(false), error = ref('')
let active = true, generation = 0
const targets = computed(() => (preview.value?.targets || []).slice(0, 3).map(t => `${t.distro}（${t.user}）`).join('、'))
const clients = computed(() => [preview.value?.daemonCount ? `${preview.value.daemonCount} 个后台` : '', preview.value?.cliCount ? `${preview.value.cliCount} 个 CLI` : ''].filter(Boolean).join('、'))
async function load() {
  const epoch = ++generation
  loading.value = true; error.value = ''; preview.value = null
  try {
    const next = await codexApi.previewCodexWslAssignment(props.account.id)
    if (!active || epoch !== generation) return
    preview.value = next
    if (!next.targets.length) error.value = '未检测到运行中的 WSL 目标'
    else if (next.alreadyAssigned) error.value = 'WSL 已使用此账号'
    else if (!next.canApply) error.value = '此账号不支持用于 WSL'
  } catch (e) { if (active && epoch === generation) error.value = errText(e) }
  finally { if (active && epoch === generation) loading.value = false }
}
async function confirm() {
  if (busy.value || loading.value || error.value) return
  busy.value = true
  try {
    const result = await assignToWsl(props.account)
    if (!active) return
    if (result?.status === 'aborted') error.value = result.failures[0]?.message || 'WSL 未切换，请手动退出 Codex 后重试'
    else emit('close')
  } catch (e) { if (active) error.value = errText(e) }
  finally { if (active) busy.value = false }
}
onMounted(load)
onUnmounted(() => { active = false; generation++ })
</script>
<template>
  <CodexAccountConfirm title="在 WSL 中使用账号" action="用于 WSL" :busy="busy" :stage="switchStep" :disabled="loading || !preview || !!error" :error="error" :retry="!loading && !!error" @retry="load" @confirm="confirm" @close="emit('close')">
    <p class="confirm-copy">以下 WSL 环境将使用 <b>{{ account.email }}</b>。</p>
    <p v-if="loading" class="switch-stage" role="status">正在检查 Codex 状态…</p>
    <div v-else-if="preview?.targets.length" class="switch-scopes">
      <div class="switch-scope"><span>目标</span><span>{{ targets }}{{ preview.targets.length > 3 ? ` 等 ${preview.targets.length} 个` : '' }}</span></div>
      <div class="switch-scope"><span>Codex</span><span>{{ clients ? `关闭${clients}，不重开` : '未检测到运行中的 WSL Codex' }}</span></div>
    </div>
    <p v-if="clients" class="switch-note warn"><AppIcon name="alert" :size="12" /><span>正在运行的 WSL Codex 会中断。</span></p>
    <p class="switch-note"><AppIcon name="info" :size="12" /><span>Windows 账号与运行中的 Codex 不受影响。</span></p>
  </CodexAccountConfirm>
</template>
