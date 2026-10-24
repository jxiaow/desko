<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { codexApi, type CodexAccount, type CodexSwitchOutcome, type CodexSwitchPreview } from '../../services/api/codex'
import { loadSwitchRestart, switchRestartWindows, switchTo, switchStep } from '../../services/codexState'
import { errText } from '../../services/api/backup'
import { isWebRuntime } from '../../services/runtime'
import CodexAccountConfirm from './CodexAccountConfirm.vue'
import AppIcon from '../shared/AppIcon.vue'
const props = defineProps<{ account: CodexAccount }>()
const emit = defineEmits<{ close: [] }>()
const preview = ref<CodexSwitchPreview | null>(null)
const loading = ref(true), busy = ref(false), error = ref(''), applyToWsl = ref(false)
const result = ref<CodexSwitchOutcome | null>(null)
const expired = ref(false)
let active = true, generation = 0
const restart = ref(false)
const windowsCount = computed(() => (preview.value?.windows.appCount || 0) + (preview.value?.windows.cliCount || 0))
const reopens = computed(() => restart.value && windowsCount.value > 0)
const title = computed(() => reopens.value ? '切换账号并重启 Codex' : '切换账号')
const action = computed(() => expired.value ? '请手动打开 Codex' : result.value?.windows.reopenFailures ? '重新打开 Codex' : reopens.value ? '切换并重启' : '切换')
const wsl = computed(() => preview.value?.wsl)
const writeWsl = computed(() => applyToWsl.value && !!wsl.value?.canApply && !wsl.value.alreadyAssigned)
const wslDescription = computed(() => {
  if (wsl.value?.alreadyAssigned) return 'WSL 已使用此账号，无需切换。'
  if (!wsl.value?.canApply) return 'API Key 账号不支持用于 WSL。'
  if (writeWsl.value) return 'WSL 下次启动将使用此账号。'
  return wsl.value?.current ? `未勾选时 WSL 继续使用 ${wsl.value.current.email}。` : '未勾选时保留 WSL 当前账号。'
})
const windowsText = computed(() => [preview.value?.windows.appCount ? `${preview.value.windows.appCount} 个应用` : '', preview.value?.windows.cliCount ? `${preview.value.windows.cliCount} 个 CLI` : ''].filter(Boolean).join('、'))
const wslText = computed(() => [wsl.value?.daemonCount ? `${wsl.value.daemonCount} 个后台` : '', wsl.value?.cliCount ? `${wsl.value.cliCount} 个 CLI` : ''].filter(Boolean).join('、'))
async function load() {
  const epoch = ++generation
  loading.value = true; error.value = ''; preview.value = null
  try {
    const [, next] = await Promise.all([loadSwitchRestart(), codexApi.previewCodexSwitch(props.account.id)])
    if (!active || epoch !== generation) return
    restart.value = !isWebRuntime() && switchRestartWindows.value
    preview.value = next
    applyToWsl.value = next.wsl?.alreadyAssigned === true
    if (restart.value && next.windowsError) error.value = next.windowsError
  } catch (e) { if (active && epoch === generation) error.value = errText(e) }
  finally { if (active && epoch === generation) loading.value = false }
}
async function confirm() {
  if (busy.value || loading.value || expired.value) return
  busy.value = true; error.value = ''
  try {
    if (result.value) {
      const id = result.value.windows.reopenPlanId
      if (!id) { expired.value = true; error.value = '重开计划已过期，请手动打开 Codex'; return }
      const next = await codexApi.relaunchCodexClients(id)
      if (!active) return
      result.value.windows = next
      if (!next.reopenFailures) emit('close')
      else error.value = `还有 ${next.reopenFailures} 个 Codex 未能重新打开，可重试或手动打开。`
    } else {
      const outcome = await switchTo(props.account.id, { restartWindows: restart.value, applyToWsl: writeWsl.value })
      if (!active) return
      if (!outcome || !outcome.windows.reopenFailures) emit('close')
      else { result.value = outcome; error.value = `账号已切换；${outcome.windows.reopenFailures} 个 Windows Codex 未能重新打开。` }
    }
  } catch (e) { if (active) { error.value = errText(e); if (result.value && error.value.includes('过期')) expired.value = true } }
  finally { if (active) busy.value = false }
}
onMounted(load)
onUnmounted(() => { active = false; generation++ })
</script>
<template>
  <CodexAccountConfirm :title="title" :action="action" :done="!!result" :busy="busy" :stage="switchStep || (result ? '正在重新打开…' : '正在切换…')" :disabled="loading || !preview || (restart && !!preview.windowsError) || expired" :error="error" :retry="!loading && !result && !!error" @retry="load" @confirm="confirm" @close="emit('close')">
    <p class="confirm-copy">{{ result ? 'Windows 账号已切换为' : 'Windows 账号将切换为' }} <b>{{ account.email }}</b>。</p>
    <p v-if="loading" class="switch-stage" role="status">正在检查 Codex 状态…</p>
    <template v-else-if="preview && !result">
      <label v-if="wsl" class="wsl-switch-option">
        <input v-model="applyToWsl" type="checkbox" :disabled="busy || !wsl.canApply || wsl.alreadyAssigned" />
        <span><strong>同时用于 WSL</strong><small>{{ wslDescription }}</small></span>
      </label>
      <div v-if="reopens || (writeWsl && wslText)" class="switch-scopes">
        <div v-if="reopens" class="switch-scope"><span>Windows</span><span>重启 {{ windowsText }}，<span class="scope-nowrap">CLI 回原目录</span></span></div>
        <div v-if="writeWsl && wslText" class="switch-scope"><span>WSL</span><span>关闭 {{ wslText }}，不重开</span></div>
      </div>
      <p v-if="reopens" class="switch-note warn"><AppIcon name="alert" :size="12" /><span>正在运行的 {{ writeWsl && wslText ? 'Windows 与 WSL' : 'Windows' }} Codex 任务会中断。</span></p>
      <p v-else-if="!restart" class="switch-note warn"><AppIcon name="alert" :size="12" /><span>正在运行的 Windows Codex 可能继续使用旧账号。</span></p>
      <p v-if="writeWsl && !reopens && wslText" class="switch-note warn"><AppIcon name="alert" :size="12" /><span>正在运行的 WSL Codex 任务会中断。</span></p>
    </template>
  </CodexAccountConfirm>
</template>
<style scoped>
.wsl-switch-option { display: flex; align-items: flex-start; gap: 9px; margin-top: 12px; cursor: pointer; }
.wsl-switch-option input { flex: none; width: 16px; height: 16px; margin: 1px 0 0; accent-color: var(--accent); }
.wsl-switch-option strong { font-size: var(--text-sm); font-weight: 600; }
.wsl-switch-option small { display: block; margin-top: 2px; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.55; overflow-wrap: anywhere; }
.wsl-switch-option:has(input:disabled) { cursor: default; }
.wsl-switch-option:has(input:disabled) strong { color: var(--text-muted); }
</style>
