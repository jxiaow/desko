<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { codexApi, type StoragePaths } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { isWebRuntime } from '../../services/runtime'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useDialogFocus } from '../../composables/useDialogFocus'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ close: []; imported: [] }>()
const dialog = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocus(dialog)
useEscapeClose(() => emit('close'))
const toast = useToastStore()
type Source = 'local' | 'file' | 'json' | 'token'
const source = ref<Source>('local')
const sources: { value: Source; label: string }[] = [
  { value: 'local', label: '本机凭据' }, { value: 'file', label: 'auth.json 文件' },
  { value: 'json', label: '粘贴 JSON' }, { value: 'token', label: 'Token' },
]
const paths = ref<StoragePaths | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const filePaths = ref<string[]>([])
const browserFiles = ref<File[]>([])
const pasteJson = ref('')
const tokenMode = ref<'access' | 'tokens'>('access')
const tokenName = ref('')
const accessToken = ref('')
const idToken = ref('')
const refreshToken = ref('')
const busy = ref(false)
const choosing = ref(false)
const error = ref('')
let active = true
watch(source, () => { error.value = '' })

const fileNames = computed(() => isWebRuntime() ? browserFiles.value.map(file => file.name) : filePaths.value)
const actionLabel = computed(() => ({ local: '导入本机凭据', file: '导入文件', json: '导入 JSON', token: '导入 Token' })[source.value])
const canImport = computed(() => {
  if (busy.value || choosing.value) return false
  if (source.value === 'file') return fileNames.value.length > 0
  if (source.value === 'json') return !!pasteJson.value.trim()
  if (source.value === 'token') return !!accessToken.value.trim() && !!(tokenMode.value === 'access' ? tokenName.value.trim() : idToken.value.trim())
  return true
})

async function chooseFiles() {
  if (choosing.value || busy.value) return
  if (isWebRuntime()) { fileInput.value?.click(); return }
  choosing.value = true
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    if (!active) return
    const picked = await open({ multiple: true, filters: [{ name: 'auth.json', extensions: ['json'] }] })
    if (active && picked) filePaths.value = Array.isArray(picked) ? picked : [picked]
  } catch (e) { if (active) error.value = errText(e) }
  finally { if (active) choosing.value = false }
}

function selectBrowserFiles(event: Event) {
  const input = event.target as HTMLInputElement
  browserFiles.value = Array.from(input.files ?? [])
  input.value = ''
}

async function importAccounts() {
  if (!canImport.value) return
  busy.value = true
  error.value = ''
  let imported = 0
  let successText = ''
  const failures: string[] = []
  try {
    if (source.value === 'local') {
      const account = await codexApi.importLocal()
      imported = 1
      successText = `已导入 ${account.email}`
    } else if (source.value === 'json') {
      imported = (await codexApi.importJson(pasteJson.value.trim())).length
    } else if (source.value === 'token') {
      const account = tokenMode.value === 'access'
        ? await codexApi.importAccessToken(tokenName.value.trim(), accessToken.value.trim())
        : await codexApi.addTokens(idToken.value.trim(), accessToken.value.trim(), refreshToken.value)
      imported = 1
      successText = `已导入 ${account.email}`
    } else if (!isWebRuntime()) {
      const result = await codexApi.importFiles([...filePaths.value])
      imported = result.imported.length
      failures.push(...result.failed.map(item => `${item.email}：${item.error}`))
    } else {
      for (const file of [...browserFiles.value]) {
        if (!active) return
        try {
          if (file.size > 16 * 1024 * 1024) throw new Error('文件超过 16 MiB')
          const content = await file.text()
          if (!active) return
          imported += (await codexApi.importJson(content)).length
        } catch (e) { failures.push(`${file.name}：${errText(e)}`) }
      }
    }
    if (!active) return
    if (imported) await refreshAccounts()
    if (!active) return
    if (failures.length) {
      error.value = `已导入 ${imported} 条，${failures.length} 个失败：${failures.join('；')}`
    } else if (!imported) {
      error.value = '没有找到可导入的账号，请检查凭据内容。'
    } else {
      toast.showToast(successText || `已导入 ${imported} 条账号`)
      emit('imported')
    }
  } catch (e) { if (active) error.value = errText(e) }
  finally { if (active) busy.value = false }
}

onMounted(() => {
  void codexApi.storagePaths().then(value => { if (active) paths.value = value }).catch(() => {})
})
onUnmounted(() => { active = false })
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <section ref="dialog" class="dialog codex-import-dialog" role="dialog" aria-modal="true" aria-label="导入 Codex 账号" :aria-busy="busy" tabindex="-1" @keydown.tab="trapFocus">
      <header class="dialog-header">
        <h3>导入 Codex 账号</h3>
        <button class="dialog-close" type="button" aria-label="关闭" @click="emit('close')"><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="import-sources seg" role="tablist" aria-label="凭据来源">
        <button v-for="item in sources" :id="`codex-import-${item.value}`" :key="item.value" class="seg-btn" :class="{ on: source === item.value }" type="button" role="tab" :aria-selected="source === item.value" aria-controls="codex-import-content" :disabled="busy || choosing" @click="source = item.value">{{ item.label }}</button>
      </div>
      <form id="codex-import-content" class="dialog-body import-content" role="tabpanel" :aria-labelledby="`codex-import-${source}`" @submit.prevent="importAccounts">
        <template v-if="source === 'local'">
          <p class="lead">导入本机 Codex 登录凭据，保留原文件。</p>
          <div class="pathline"><span class="k">本机凭据</span><code>{{ paths?.authPath || '读取中…' }}</code></div>
        </template>
        <template v-else-if="source === 'file'">
          <p class="lead">支持批量导入 auth.json，保留原文件。</p>
          <input ref="fileInput" type="file" accept=".json,application/json" multiple hidden @change="selectBrowserFiles" />
          <button class="action-btn" type="button" :disabled="choosing || busy" @click="chooseFiles"><AppIcon name="folder" :size="13" />{{ choosing ? '正在选择…' : '选择 auth.json 文件…' }}</button>
          <ul v-if="fileNames.length" class="import-file-list"><li v-for="file in fileNames" :key="file">{{ file }}</li></ul>
        </template>
        <div v-else-if="source === 'json'" class="form-group">
          <label for="cx-paste">账号 JSON <span class="req" aria-hidden="true">*</span></label>
          <textarea id="cx-paste" v-model="pasteJson" class="mono paste-box" rows="6" spellcheck="false" :disabled="busy" placeholder="粘贴 auth.json 或 Desko 导出的账号 JSON，一条或数组均可" />
        </div>
        <template v-else>
          <div class="token-modes seg" role="group" aria-label="Token 类型">
            <button class="seg-btn" :class="{ on: tokenMode === 'access' }" type="button" :aria-pressed="tokenMode === 'access'" :disabled="busy" @click="tokenMode = 'access'">Access Token</button>
            <button class="seg-btn" :class="{ on: tokenMode === 'tokens' }" type="button" :aria-pressed="tokenMode === 'tokens'" :disabled="busy" @click="tokenMode = 'tokens'">Token 组合</button>
          </div>
          <div v-if="tokenMode === 'access'" class="form-group">
            <label for="cx-token-name">账号名称 <span class="req" aria-hidden="true">*</span></label>
            <input id="cx-token-name" v-model="tokenName" type="text" :disabled="busy" placeholder="便于识别的名称" />
          </div>
          <div v-else class="form-group">
            <label for="cx-id-token">ID Token <span class="req" aria-hidden="true">*</span></label>
            <input id="cx-id-token" v-model="idToken" type="password" :disabled="busy" autocomplete="off" spellcheck="false" />
          </div>
          <div class="form-group">
            <label for="cx-access-token">Access Token <span class="req" aria-hidden="true">*</span></label>
            <input id="cx-access-token" v-model="accessToken" type="password" :disabled="busy" autocomplete="off" spellcheck="false" />
          </div>
          <div v-if="tokenMode === 'tokens'" class="form-group">
            <label for="cx-refresh-token">Refresh Token（可选）</label>
            <input id="cx-refresh-token" v-model="refreshToken" type="password" :disabled="busy" autocomplete="off" spellcheck="false" />
          </div>
        </template>
        <p v-if="error" class="dialog-err" role="alert">{{ error }}</p>
      </form>
      <footer class="dialog-footer">
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canImport" @click="importAccounts">{{ busy ? '正在导入…' : actionLabel }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.codex-import-dialog { width: 520px; height: min(480px, calc(100dvh - 40px)); max-height: calc(100dvh - 40px); }
.import-sources { margin: 0 var(--space-4); flex-shrink: 0; }
.import-content { min-height: 0; }
.mono, .pathline code { font-family: var(--font-mono); }
.paste-box { line-height: 1.6; font-size: var(--text-sm); resize: vertical; }
.pathline { display: flex; flex-direction: column; gap: var(--space-2); padding-block: var(--space-3); }
.pathline .k { color: var(--text-muted); font-size: var(--text-xs); }
.pathline code { color: var(--text-secondary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.import-file-list { padding-left: var(--space-4); color: var(--text-secondary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.token-modes { margin-bottom: var(--space-3); }
</style>
