<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { listen } from '../../services/events'
import { isWebRuntime } from '../../services/runtime'
import { writeClipboardText } from '../../utils/clipboard'
import { openExternal } from '../../utils/openExternal'
import { codexApi } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { accounts, refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useDialogFocus } from '../../composables/useDialogFocus'
import AppIcon from '../shared/AppIcon.vue'
import CodexImportDialog from './CodexImportDialog.vue'

const props = defineProps<{ reauthAccountId?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const toast = useToastStore()
const dialog = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocus(dialog)
const showImport = ref(false)
useEscapeClose(close, () => !showImport.value)

type Mode = 'oauth' | 'device' | 'apikey'
type Attempt =
  | { mode: 'oauth'; loginId: string; authUrl: string }
  | { mode: 'device'; loginId: string; userCode: string; verificationUrl: string }
const mode = ref<Mode>(isWebRuntime() ? 'device' : 'oauth')
const session = ref<Attempt | null>(null)
const phase = ref<'idle' | 'starting' | 'waiting' | 'finishing' | 'failed'>('idle')
const loginError = ref('')
const working = ref(false)
const busy = computed(() => working.value || phase.value === 'finishing')
const portBusy = ref(false)
const callbackUrl = ref('')
const apiKey = ref('')
const apiBaseUrl = ref('')
const reauthAccount = computed(() => accounts.value.find(account => account.id === props.reauthAccountId))
let active = true
let generation = 0
let unlisten: UnlistenFn[] = []

function stopListeners() {
  unlisten.forEach(stop => stop())
  unlisten = []
}
function current(epoch: number) { return active && epoch === generation }

/** 先作废本轮回包和监听，再取消后端会话；取消失败保留重试入口。 */
async function releaseLogin() {
  generation++
  stopListeners()
  const previous = session.value
  session.value = null
  callbackUrl.value = ''
  if (previous) {
    try { await codexApi.oauthCancel(previous.loginId) }
    catch (e) {
      if (active) session.value = previous
      throw e
    }
  }
}

async function changeMode(next: Mode) {
  if (busy.value || next === mode.value || (props.reauthAccountId && next === 'apikey')) return
  working.value = true
  try {
    await releaseLogin()
    if (!active) return
    mode.value = next
    phase.value = 'idle'
    loginError.value = ''
  } catch (e) {
    if (active) { phase.value = 'failed'; loginError.value = `取消上次授权失败：${errText(e)}` }
  } finally { if (active) working.value = false }
}

async function openImport() {
  if (busy.value || props.reauthAccountId) return
  working.value = true
  try {
    await releaseLogin()
    if (!active) return
    phase.value = 'idle'
    loginError.value = ''
    showImport.value = true
  } catch (e) {
    if (active) { phase.value = 'failed'; loginError.value = `取消上次授权失败：${errText(e)}` }
  } finally { if (active) working.value = false }
}

function failLogin(epoch: number, loginId: string, message: string) {
  if (!current(epoch) || session.value?.loginId !== loginId || phase.value !== 'waiting') return
  phase.value = 'failed'
  loginError.value = message
  toast.showToast(message, 'error')
}

async function watchOAuth(epoch: number) {
  const handlers = await Promise.allSettled([
    listen<{ loginId: string }>('codex-oauth-login-completed', event => {
      if (current(epoch) && event.payload.loginId === session.value?.loginId) void finishLogin(epoch)
    }),
    listen<{ loginId: string }>('codex-oauth-login-timeout', event => {
      failLogin(epoch, event.payload.loginId, '授权超时，请重新发起登录。')
    }),
    listen<{ loginId: string; error: string }>('codex-device-auth-error', event => {
      failLogin(epoch, event.payload.loginId, `设备授权失败：${event.payload.error}`)
    }),
  ])
  const stops = handlers.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
  const failure = handlers.find(result => result.status === 'rejected')
  if (!current(epoch) || failure) {
    stops.forEach(stop => stop())
    if (failure?.status === 'rejected') throw failure.reason
    return
  }
  unlisten = stops
}

async function startLogin() {
  if (busy.value || mode.value === 'apikey') return
  const next = mode.value
  working.value = true
  loginError.value = ''
  try {
    await releaseLogin()
    if (!active) return
    const epoch = generation
    phase.value = 'starting'
    let attempt: Attempt
    if (next === 'oauth') {
      portBusy.value = await codexApi.oauthPortInUse()
      if (!current(epoch)) return
      attempt = { mode: 'oauth', ...await codexApi.oauthStart(props.reauthAccountId ?? undefined) }
    } else {
      attempt = { mode: 'device', ...await codexApi.deviceAuthStart() }
    }
    if (!current(epoch)) { void codexApi.oauthCancel(attempt.loginId).catch(() => {}); return }
    session.value = attempt
    phase.value = 'waiting'
    await watchOAuth(epoch)
    if (current(epoch)) void openInBrowser(attempt.mode === 'oauth' ? attempt.authUrl : attempt.verificationUrl)
  } catch (e) {
    if (active) { phase.value = 'failed'; loginError.value = errText(e); toast.showToast(loginError.value, 'error') }
  } finally { if (active) working.value = false }
}

async function finishLogin(epoch: number) {
  const attempt = session.value
  if (!current(epoch) || !attempt || phase.value !== 'waiting') return
  phase.value = 'finishing'
  try {
    const account = await codexApi.oauthCompleted(attempt.loginId, props.reauthAccountId ?? undefined)
    if (!current(epoch)) return
    await refreshAccounts()
    if (!current(epoch)) return
    session.value = null
    stopListeners()
    toast.showToast(props.reauthAccountId ? `已重新登录 ${account.email}` : `已登录 ${account.email}`)
    emit('close')
  } catch (e) {
    if (current(epoch)) { phase.value = 'failed'; loginError.value = errText(e) }
  }
}

async function submitCallback() {
  const attempt = session.value
  if (busy.value || attempt?.mode !== 'oauth' || phase.value !== 'waiting') return
  const url = callbackUrl.value.trim()
  if (!url) return
  const epoch = generation
  working.value = true
  loginError.value = ''
  try {
    // 后端完成换码并发 completed；只由事件收口，不能再手动完成一次。
    await codexApi.oauthSubmitCallbackUrl(attempt.loginId, url)
  } catch (e) {
    if (current(epoch)) { loginError.value = errText(e); toast.showToast(loginError.value, 'error') }
  } finally { if (current(epoch)) working.value = false }
}

async function addApiKey() {
  if (busy.value || props.reauthAccountId || !apiKey.value.trim()) return
  working.value = true
  loginError.value = ''
  try {
    const account = await codexApi.addApiKey(apiKey.value.trim(), apiBaseUrl.value)
    if (!active) return
    await refreshAccounts()
    if (!active) return
    toast.showToast(`已添加 ${account.email || account.id}`)
    emit('close')
  } catch (e) { if (active) { loginError.value = errText(e); toast.showToast(loginError.value, 'error') } }
  finally { if (active) working.value = false }
}

async function copy(text: string, label: string) {
  if (!text || phase.value !== 'waiting') return
  try { await writeClipboardText(text); if (active) toast.showToast(`${label}已复制`) }
  catch { if (active) toast.showToast('复制失败', 'error') }
}
async function openInBrowser(url: string) {
  if (!url || !active || phase.value !== 'waiting') return
  try { await openExternal(url) }
  catch { if (active) toast.showToast('无法打开浏览器', 'error') }
}

function discard() {
  active = false
  generation++
  stopListeners()
  const attempt = session.value
  session.value = null
  if (attempt) void codexApi.oauthCancel(attempt.loginId).catch(() => {})
}
function close() { discard(); emit('close') }
onUnmounted(discard)
onMounted(() => {
  void codexApi.oauthPortInUse().then(value => { if (active) portBusy.value = value }).catch(() => {})
})
</script>

<template>
  <CodexImportDialog v-if="showImport" @close="showImport = false" @imported="emit('close')" />
  <div v-else class="dialog-overlay" @click.self="close">
    <section ref="dialog" class="dialog auth-dialog" role="dialog" aria-modal="true" :aria-label="reauthAccountId ? '重新登录 Codex 账号' : '添加 Codex 账号'" :aria-busy="busy" tabindex="-1" @keydown.tab="trapFocus">
      <header class="dialog-header">
        <h3>{{ reauthAccountId ? '重新登录 Codex 账号' : '添加 Codex 账号' }}</h3>
        <button class="dialog-close" type="button" aria-label="关闭" @click="close"><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="auth-tabs">
        <div class="seg" role="tablist" :aria-label="reauthAccountId ? '重新登录方式' : '账号添加方式'">
          <button id="codex-auth-oauth" class="seg-btn" :class="{ on: mode === 'oauth' }" type="button" role="tab" :aria-selected="mode === 'oauth'" aria-controls="codex-auth-content" :disabled="busy" @click="changeMode('oauth')">浏览器登录</button>
          <button id="codex-auth-device" class="seg-btn" :class="{ on: mode === 'device' }" type="button" role="tab" :aria-selected="mode === 'device'" aria-controls="codex-auth-content" :disabled="busy" @click="changeMode('device')">设备码</button>
          <button v-if="!reauthAccountId" id="codex-auth-apikey" class="seg-btn" :class="{ on: mode === 'apikey' }" type="button" role="tab" :aria-selected="mode === 'apikey'" aria-controls="codex-auth-content" :disabled="busy" @click="changeMode('apikey')">API Key</button>
        </div>
        <button v-if="!reauthAccountId" class="auth-import-link" type="button" :disabled="busy" @click="openImport">导入已有凭据 <AppIcon name="arrowRight" :size="12" /></button>
      </div>
      <div id="codex-auth-content" class="dialog-body auth-content" role="tabpanel" :aria-labelledby="`codex-auth-${mode}`">
        <p v-if="reauthAccountId" class="reauth-identity">正在重新登录：<strong>{{ reauthAccount?.account_name || reauthAccount?.email || '当前账号' }}</strong><template v-if="reauthAccount?.account_name"> · {{ reauthAccount.email }}</template></p>
        <template v-if="mode === 'oauth'">
          <p class="lead">通过 OpenAI 官方页面登录。授权后会自动返回；浏览器回跳失败时，可手动粘贴回调地址。</p>
          <p v-if="portBusy && !session" class="note warn">回调端口已被占用，先退出其他正在登录的 Codex 客户端，或改用设备码。</p>
          <template v-if="session?.mode === 'oauth'">
            <div class="login-state"><span class="chip">{{ phase === 'failed' ? '授权失败' : phase === 'finishing' ? '正在完成登录…' : '等待授权…' }}</span></div>
            <div class="auth-address"><code class="mono url">{{ session.authUrl }}</code><div class="address-actions">
              <button class="action-btn" type="button" :disabled="phase !== 'waiting'" @click="copy(session.authUrl, '授权地址')">复制地址</button>
              <button class="action-btn" type="button" :disabled="phase !== 'waiting'" @click="openInBrowser(session.authUrl)">打开授权页</button>
            </div></div>
            <div v-if="phase === 'waiting'" class="form-group cb-row">
              <label for="codex-callback">回调地址（浏览器未自动返回时填写）</label>
              <input id="codex-callback" v-model="callbackUrl" aria-label="回调地址" type="text" spellcheck="false" :disabled="busy" placeholder="http://localhost:1455/callback?code=…" @keyup.enter="submitCallback" />
            </div>
          </template>
          <ol v-else class="login-steps"><li>点「开始登录」，打开官方授权页。</li><li>选择账号并完成授权。</li><li>返回此窗口，登录结果会自动保存。</li></ol>
        </template>
        <template v-else-if="mode === 'device'">
          <p class="lead">不占用本地回调端口。在 OpenAI 验证页输入设备码，即可完成登录。</p>
          <template v-if="session?.mode === 'device'">
            <div class="login-state"><span class="chip">{{ phase === 'failed' ? '授权失败' : phase === 'finishing' ? '正在完成登录…' : '等待授权…' }}</span></div>
            <div class="code-box"><span class="code-label mono">{{ session.userCode }}</span><button class="action-btn" type="button" :disabled="phase !== 'waiting'" @click="copy(session.userCode, '设备码')"><AppIcon name="copy" :size="13" />复制码</button></div>
            <div class="auth-address"><code class="mono url">{{ session.verificationUrl }}</code><button class="action-btn" type="button" :disabled="phase !== 'waiting'" @click="openInBrowser(session.verificationUrl)">打开验证页</button></div>
          </template>
          <ol v-else class="login-steps"><li>点「取设备码」，获取本次登录的授权码。</li><li>在验证页输入设备码并登录。</li><li>返回此窗口等待授权完成。</li></ol>
        </template>
        <template v-else>
          <p class="lead">密钥保存在 Desko 账号库；切到该账号时才写入 Codex 的供应商配置。</p>
          <div class="form-group"><label for="cx-key">API Key <span class="req" aria-hidden="true">*</span></label><input id="cx-key" v-model="apiKey" class="mono" type="password" autocomplete="off" spellcheck="false" :disabled="busy" placeholder="sk-…" @keyup.enter="addApiKey" /></div>
          <div class="form-group"><label for="cx-base">自定义接口地址（可留空）</label><input id="cx-base" v-model="apiBaseUrl" class="mono" type="text" spellcheck="false" :disabled="busy" placeholder="https://…/v1" @keyup.enter="addApiKey" /></div>
        </template>
        <p v-if="loginError" class="dialog-err" role="alert">{{ loginError }}</p>
      </div>
      <footer class="dialog-footer">
        <button class="btn-secondary" type="button" @click="close">取消</button>
        <button v-if="mode === 'apikey'" class="btn-primary" type="button" :disabled="busy || !apiKey.trim()" @click="addApiKey">{{ busy ? '正在添加…' : '添加' }}</button>
        <button v-else-if="phase === 'failed'" class="btn-primary" type="button" :disabled="busy" @click="startLogin">{{ busy ? '正在发起…' : mode === 'device' ? '重新取码' : '重新发起' }}</button>
        <button v-else-if="phase === 'waiting' && session?.mode === 'oauth' && callbackUrl.trim()" class="btn-primary" type="button" :disabled="busy" @click="submitCallback">{{ busy ? '正在提交…' : '提交回调' }}</button>
        <button v-else-if="phase === 'waiting' || phase === 'finishing'" class="btn-primary" type="button" disabled>{{ phase === 'finishing' ? '正在完成登录…' : '等待授权…' }}</button>
        <button v-else class="btn-primary" type="button" :disabled="busy" @click="startLogin">{{ busy ? '正在发起…' : mode === 'device' ? '取设备码' : '开始登录' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.auth-dialog { width: 520px; height: min(480px, calc(100dvh - 40px)); max-height: calc(100dvh - 40px); }
.auth-tabs { padding: 0 var(--space-4); flex-shrink: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.auth-tabs .seg { margin-bottom: 0; }
.auth-import-link { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 4px 0; background: none; border: 0; color: var(--text-muted); font: inherit; font-size: var(--text-xs); cursor: pointer; }
.auth-import-link:hover:not(:disabled) { color: var(--text-brand); }
.auth-content { min-height: 0; }
.reauth-identity { margin: 0 0 var(--space-3); color: var(--text-secondary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.note { font-size: var(--text-xs); color: var(--warning); line-height: 1.6; }
.note.warn { background: var(--warning-soft); border-radius: var(--radius-sm); padding: 8px 10px; }
.login-steps { margin: var(--space-5) 0 0; padding-left: var(--space-4); color: var(--text-secondary); font-size: var(--text-sm); line-height: 1.8; }
.login-steps li + li { margin-top: var(--space-3); }
.login-state { margin-block: var(--space-4) var(--space-3); }
.auth-address { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.url { font-size: var(--text-xs); line-height: 1.6; color: var(--text-secondary); overflow-wrap: anywhere; }
.address-actions { display: flex; gap: var(--space-2); }
.cb-row { margin-top: var(--space-4); }
.code-box { display: flex; align-items: center; gap: var(--space-3); margin-block: var(--space-3); }
.code-label { font-size: var(--text-xl); font-weight: 600; letter-spacing: 0.12em; color: var(--text); }
</style>
