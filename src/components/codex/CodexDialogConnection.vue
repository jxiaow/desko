<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { open } from '@tauri-apps/plugin-dialog'
import type { DialogDirectory, DialogEnvironment, DialogEnvironments } from '../../services/api/codexDialog'
import { isWebRuntime } from '../../services/runtime'
import AppIcon from '../shared/AppIcon.vue'
import OptionSelect from '../shared/OptionSelect.vue'

const props = defineProps<{ environment: DialogEnvironment; cwd: string; environments: DialogEnvironments; directories: DialogDirectory[]; disabled: boolean; refreshing: boolean; compact?: boolean }>()
const emit = defineEmits<{ connect: [path: string, environment: DialogEnvironment]; refresh: []; error: [message: string] }>()
const web = isWebRuntime()
const selected = ref('native')
const path = ref('')
watch(() => [props.environment, props.cwd] as const, ([environment, cwd]) => {
  selected.value = environment.kind === 'wsl' ? `wsl:${environment.distro}` : 'native'
  path.value = cwd
}, { immediate: true })
const isWsl = computed(() => selected.value === 'wsl' || selected.value.startsWith('wsl:'))
const distros = computed(() => [...new Set([...props.environments.distros, ...(props.environment.kind === 'wsl' ? [props.environment.distro] : [])])])
const environmentOptions = computed(() => [{ value: 'native', label: props.environments.nativeLabel }, ...(distros.value.length ? [{ value: 'wsl', label: 'WSL · 自动识别' }] : []), ...distros.value.map(distro => ({ value: `wsl:${distro}`, label: `WSL · ${distro}` }))])
function target(): DialogEnvironment {
  if (!isWsl.value) return { kind: 'native' }
  const distro = selected.value === 'wsl' ? '' : selected.value.slice(4)
  return { kind: 'wsl', distro, user: props.environment.kind === 'wsl' && props.environment.distro === distro ? props.environment.user : '' }
}
function label(environment: DialogEnvironment) {
  return environment.kind === 'native' ? props.environments.nativeLabel : `WSL · ${environment.distro}${environment.user ? ` / ${environment.user}` : ''}`
}
async function browse() {
  try {
    const distro = target()
    const value = await open({ directory: true, multiple: false, title: '选择 Codex 工作目录', defaultPath: distro.kind === 'wsl' ? distro.distro ? `\\\\wsl.localhost\\${distro.distro}\\` : '\\\\wsl.localhost\\' : undefined })
    if (typeof value !== 'string') return
    path.value = value
    emit('connect', value, target())
  } catch (error) { emit('error', error instanceof Error ? error.message : String(error)) }
}
</script>

<template>
  <div class="dialog-connection-form" :class="{ compact }">
    <div class="environment-row">
      <label for="codex-dialog-environment">运行环境</label>
      <OptionSelect id="codex-dialog-environment" v-model="selected" aria-label="运行环境" :options="environmentOptions" :disabled="disabled" match-width />
      <button class="action-btn connection-refresh" :disabled="disabled || refreshing" aria-label="刷新运行环境" @click="emit('refresh')"><AppIcon name="refresh" :size="15" /></button>
    </div>
    <p v-if="environments.wslError" class="connection-note">{{ environments.wslError }}</p>
    <form v-if="isWsl || web || compact" class="wsl-fields" @submit.prevent="emit('connect', path.trim(), target())">
      <label>{{ web ? '服务器工作目录' : '工作目录' }}<input v-model="path" class="text-input" :disabled="disabled" required :placeholder="isWsl ? '例如 ~/项目、/mnt/c/Code/项目 或 Windows 路径' : '例如 C:\\Code\\项目 或 /home/用户/项目'" autocomplete="off" /></label>
      <div class="connection-actions"><button v-if="!web" class="action-btn" type="button" :disabled="disabled" @click="browse"><AppIcon name="folderOpen" :size="14" />浏览目录</button><button class="action-btn primary" type="submit" :disabled="disabled || !path.trim()">{{ isWsl ? '连接 WSL' : '连接工作目录' }}</button></div>
      <p v-if="isWsl" class="connection-note">自动识别 WSL 默认用户；Windows 路径会自动转换。</p>
    </form>
    <p v-if="web" class="connection-note">填写运行 Desko 的电脑上的路径，任务在该电脑执行。</p>
    <button v-if="!isWsl && !web && !compact" class="action-btn primary" :disabled="disabled" @click="browse"><AppIcon name="folderOpen" :size="14" />选择工作目录</button>
    <details v-if="directories.length" class="recent-directories" :open="!compact"><summary>最近的工作目录 <span>{{ directories.length }}</span></summary><button v-for="directory in directories" :key="`${label(directory.environment)}:${directory.cwd}`" class="recent-directory" :disabled="disabled" @click="emit('connect', directory.cwd, directory.environment)"><small>{{ label(directory.environment) }}</small><span>{{ directory.cwd }}</span></button></details>
  </div>
</template>

<style scoped>
.dialog-connection-form { width: min(100%, 440px); display: flex; flex-direction: column; gap: 12px; text-align: left; }
.environment-row, .connection-actions { display: flex; align-items: center; gap: 8px; }
.environment-row > label { font-size: var(--text-sm); flex-shrink: 0; }
.environment-row :deep(.opt-trigger) { flex: 1; min-width: 0; height: 36px; font-size: var(--text-sm); }
.text-input { width: 100%; height: 36px; font-size: var(--text-sm); background: var(--bg-input); }
.text-input::placeholder { color: var(--text-muted); }
.text-input:focus { background: var(--bg-input-focus); }
.text-input:disabled { background: var(--fill); color: var(--text-secondary); cursor: not-allowed; }
.action-btn { height: 36px; gap: 6px; font-size: var(--text-sm); }
.connection-refresh { flex: none; width: 36px; padding: 0; }
.wsl-fields { display: flex; flex-direction: column; gap: 12px; }
.wsl-fields label { display: flex; flex-direction: column; gap: 6px; font-size: var(--text-sm); }
.connection-actions { justify-content: flex-end; }
.connection-note { margin: 0; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.6; }
.recent-directories { display: flex; flex-direction: column; gap: 5px; font-size: var(--text-xs); color: var(--text-muted); max-height: 150px; overflow: auto; }
.recent-directories summary { cursor: pointer; padding-block: 4px; }
.recent-directories summary span { margin-left: 5px; font-variant-numeric: tabular-nums; }
.recent-directory { background: transparent; border: 0; border-radius: var(--radius-sm); padding: 8px; color: var(--text-secondary); text-align: left; font-family: inherit; cursor: pointer; }
.recent-directory:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.recent-directory:disabled { color: var(--text-muted); cursor: not-allowed; }
.recent-directory small { display: block; font-size: var(--text-xs); margin-bottom: 3px; }
.recent-directory span { font: 12px var(--font-mono); overflow-wrap: anywhere; }
.recent-directory { display: block; width: 100%; }
.compact { width: 100%; display: grid; grid-template-columns: minmax(160px, .75fr) minmax(0, 2fr); gap: 10px 16px; align-items: start; }
.compact .environment-row { display: grid; grid-template-columns: minmax(0, 1fr) 36px; gap: 6px 8px; }
.compact .environment-row > label { grid-column: 1 / -1; }
.compact .wsl-fields { gap: 8px; }
.compact > .connection-note, .compact .recent-directories { grid-column: 1 / -1; }
.compact .recent-directories { max-height: 100px; }
@container codex-conversation (min-width: 850px) {
  .compact .wsl-fields { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; }
  .compact .wsl-fields .connection-note { grid-column: 1 / -1; }
}
@container codex-conversation (max-width: 520px) { .compact { grid-template-columns: minmax(0, 1fr); gap: 10px; } }
@media (max-width: 600px) { .environment-row :deep(.opt-trigger), .action-btn, .text-input, .recent-directory { min-height: 44px; } .connection-refresh { width: 44px; } .text-input { font-size: var(--text-lg); } }
</style>
