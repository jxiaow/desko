<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { codexApi, type StoragePaths } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
useEscapeClose(() => close())

type Mode = 'oauth' | 'device' | 'apikey' | 'import'
const mode = ref<Mode>('oauth')

const loginId = ref('')
const authUrl = ref('')
const userCode = ref('')
const verifyUrl = ref('')
const waiting = ref(false)
const portBusy = ref(false)
const callbackUrl = ref('')
const apiKey = ref('')
const apiBaseUrl = ref('')
const busy = ref(false)
const paths = ref<StoragePaths | null>(null)
const importing = ref(false)

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toastStore.showToast(`${label}已复制`)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function openInBrowser(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    toastStore.showToast('无法打开浏览器', 'error')
  }
}

let unlisten: UnlistenFn[] = []

async function watchOAuth() {
  // 重新发起（OAuth→设备码、或失败重试）会再走一遍这里：先退掉上一轮监听，
  // 否则旧监听器成孤儿挂到组件卸载为止
  unlisten.forEach((f) => f())
  unlisten = (
    await Promise.all([
      listen<{ loginId: string }>('codex-oauth-login-completed', async (e) => {
        if (e.payload.loginId !== loginId.value) return
        await finishLogin()
      }),
      listen<{ loginId: string }>('codex-oauth-login-timeout', (e) => {
        if (e.payload.loginId !== loginId.value) return
        waiting.value = false
        toastStore.showToast('授权超时，重新发起一次即可', 'error')
      }),
    ])
  ).filter(Boolean)
}

/** 回调只证明拿到了码，落库要显式收口：这一步把凭据写进 desko 的账号库 */
async function finishLogin() {
  if (!loginId.value) return
  busy.value = true
  try {
    const a = await codexApi.oauthCompleted(loginId.value)
    toastStore.showToast(`已登录 ${a.email}`)
    await refreshAccounts()
    emit('close')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
    waiting.value = false
  }
}

async function startOAuth() {
  busy.value = true
  try {
    portBusy.value = await codexApi.oauthPortInUse()
    const r = await codexApi.oauthStart()
    loginId.value = r.loginId
    authUrl.value = r.authUrl
    waiting.value = true
    await watchOAuth()
    openInBrowser(r.authUrl)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function startDevice() {
  busy.value = true
  try {
    const r = await codexApi.deviceAuthStart()
    loginId.value = r.loginId
    userCode.value = r.userCode
    verifyUrl.value = r.verificationUrl
    waiting.value = true
    await watchOAuth()
    openInBrowser(r.verificationUrl)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function submitCallback() {
  const url = callbackUrl.value.trim()
  if (!url) {
    toastStore.showToast('把浏览器地址栏里的整条回调地址贴进来', 'error')
    return
  }
  busy.value = true
  try {
    // 后端在这一步内部换码、落库并发 codex-oauth-login-completed，收口交给事件监听，别再手动 finish 一次
    await codexApi.oauthSubmitCallbackUrl(loginId.value, url)
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function addApiKey() {
  const key = apiKey.value.trim()
  if (!key) {
    toastStore.showToast('先填 API Key', 'error')
    return
  }
  busy.value = true
  try {
    const a = await codexApi.addApiKey(key, apiBaseUrl.value)
    toastStore.showToast(`已添加 ${a.email || a.id}`)
    await refreshAccounts()
    emit('close')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    busy.value = false
  }
}

async function importLocal() {
  importing.value = true
  try {
    const a = await codexApi.importLocal()
    toastStore.showToast(`已导入 ${a.email}`)
    await refreshAccounts()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    importing.value = false
  }
}

async function importFromFile() {
  importing.value = true
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const pickedFile = await open({ multiple: true, filters: [{ name: 'auth.json', extensions: ['json'] }] })
    if (!pickedFile) return
    const list = Array.isArray(pickedFile) ? pickedFile : [pickedFile]
    const r = await codexApi.importFiles(list)
    const fail = r.failed.length ? `，${r.failed.length} 个失败：${r.failed[0].error}` : ''
    toastStore.showToast(`已导入 ${r.imported.length} 条账号${fail}`, r.imported.length ? 'success' : 'error')
    await refreshAccounts()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    importing.value = false
  }
}

async function close() {
  if (loginId.value) {
    try {
      await codexApi.oauthCancel(loginId.value)
    } catch {
      /* 会话已经自己收口了，取消失败不该拦住关闭 */
    }
  }
  unlisten.forEach((f) => f())
  emit('close')
}

onUnmounted(() => unlisten.forEach((f) => f()))

// 端口占用要在点「开始登录」之前就说出来，不是等发起失败之后
onMounted(() => {
  codexApi
    .oauthPortInUse()
    .then((v) => (portBusy.value = v))
    .catch(() => {})
  codexApi
    .storagePaths()
    .then((p) => (paths.value = p))
    .catch(() => {})
})
</script>

<template>
  <div class="dialog-overlay" @click.self="close">
    <div class="dialog auth-dialog" role="dialog" aria-modal="true" aria-label="添加 Codex 账号">
      <div class="dialog-header">
        <h3>添加 Codex 账号</h3>
        <button class="dialog-close" type="button" title="关闭" @click="close">
          <AppIcon name="x" :size="16" />
        </button>
      </div>

      <div class="dialog-body">
        <div class="seg" role="tablist">
          <button class="seg-btn" :class="{ on: mode === 'oauth' }" type="button" role="tab" @click="mode = 'oauth'">浏览器登录</button>
          <button class="seg-btn" :class="{ on: mode === 'device' }" type="button" role="tab" @click="mode = 'device'">设备码</button>
          <button class="seg-btn" :class="{ on: mode === 'apikey' }" type="button" role="tab" @click="mode = 'apikey'">API Key</button>
          <button class="seg-btn" :class="{ on: mode === 'import' }" type="button" role="tab" @click="mode = 'import'">导入</button>
        </div>

        <!-- 浏览器登录：官方 OAuth 授权码流程，desko 只在本机收回调 -->
        <template v-if="mode === 'oauth'">
          <p v-if="!loginId" class="lead">
            点「开始登录」会打开 OpenAI 官方授权页。授权完成后 desko 自动收口；
            浏览器回跳失败时，把地址栏里的整条回调地址贴回下面这行。
          </p>
          <p v-if="portBusy && !loginId" class="note warn">
            回调端口已被占用，先退出其他正在登录的 Codex 客户端，或再点一次重试。
          </p>
          <div v-if="!loginId" class="row">
            <button class="btn-primary" type="button" :disabled="busy" @click="startOAuth">开始登录</button>
          </div>
          <template v-else>
            <div class="line">
              <span class="chip"><span class="dot" aria-hidden="true"></span>{{ waiting ? '等待授权…' : '已发起' }}</span>
              <code class="mono url" :title="authUrl">{{ authUrl }}</code>
              <button class="action-btn" type="button" @click="openInBrowser(authUrl)">
                <AppIcon name="external" :size="13" />重新打开
              </button>
              <button class="action-btn" type="button" @click="copy(authUrl, '授权地址')">
                <AppIcon name="copy" :size="13" />复制
              </button>
            </div>
            <div class="row cb-row">
              <input
                v-model="callbackUrl"
                class="input"
                type="text"
                spellcheck="false"
                placeholder="粘贴回跳地址，形如 http://localhost:1455/callback?code=…"
                @keyup.enter="submitCallback"
              />
              <button class="action-btn primary" type="button" :disabled="busy" @click="submitCallback">提交</button>
            </div>
          </template>
        </template>

        <!-- 设备码：不占回调端口，适合本机端口被占或远程桌面里没有浏览器的情况 -->
        <template v-else-if="mode === 'device'">
          <p v-if="!loginId" class="lead">
            设备码流程不开本地端口：输一串 8 位码到 OpenAI 的验证页即可，本机没有浏览器也能完成。
          </p>
          <div v-if="!loginId" class="row">
            <button class="btn-primary" type="button" :disabled="busy" @click="startDevice">取设备码</button>
          </div>
          <template v-else>
            <div class="code-box">
              <span class="code-label mono">{{ userCode }}</span>
              <span class="code-hint">在浏览器里输入这串码完成授权</span>
            </div>
            <div class="line">
              <span class="chip"><span class="dot" aria-hidden="true"></span>{{ waiting ? '等待授权…' : '已发起' }}</span>
              <code class="mono url" :title="verifyUrl">{{ verifyUrl }}</code>
              <button class="action-btn" type="button" @click="openInBrowser(verifyUrl)">
                <AppIcon name="external" :size="13" />打开验证页
              </button>
              <button class="action-btn" type="button" @click="copy(userCode, '设备码')">
                <AppIcon name="copy" :size="13" />复制码
              </button>
            </div>
          </template>
        </template>

        <template v-else-if="mode === 'apikey'">
          <p class="lead">API Key 账号不进官方登录链路，只在 desko 里保存，切号时写进 config.toml 的供应商段。</p>
          <label class="field">
            <span class="field-label">API Key</span>
            <input v-model="apiKey" class="input mono" type="password" spellcheck="false" placeholder="sk-…" @keyup.enter="addApiKey" />
          </label>
          <label class="field">
            <span class="field-label">自定义接口地址（可留空）</span>
            <input v-model="apiBaseUrl" class="input mono" type="text" spellcheck="false" placeholder="https://…/v1" @keyup.enter="addApiKey" />
          </label>
          <div class="row">
            <button class="btn-primary" type="button" :disabled="busy || !apiKey.trim()" @click="addApiKey">添加</button>
          </div>
        </template>

        <!-- 导入：从本机已登录的 Codex 或 auth.json 文件读凭据，只读原文件，不改也不动官方凭据 -->
        <template v-else>
          <p class="lead">
            从本机已登录的 Codex 或一个 auth.json 文件里读凭据，落成一条 desko 账号记录。
            只读那份文件，不改它，也不动官方凭据。
          </p>
          <div class="pathline">
            <span class="k">本机凭据</span>
            <span class="v mono" :title="paths?.authPath">{{ paths?.authPath || '读取中…' }}</span>
          </div>
          <div class="row">
            <button class="action-btn" type="button" :disabled="importing" @click="importLocal">
              <AppIcon name="download" :size="13" />导入本机账号
            </button>
            <button class="action-btn" type="button" :disabled="importing" @click="importFromFile">
              <AppIcon name="folder" :size="13" />从 auth.json 导入…
            </button>
          </div>
        </template>
      </div>

      <div class="dialog-footer">
        <button class="btn-secondary" type="button" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-dialog { width: 520px; --font-mono: Consolas, 'Cascadia Mono', monospace; }
.mono { font-family: var(--font-mono); }

.seg {
  display: inline-flex; gap: 2px; padding: 2px;
  background: var(--fill); border-radius: var(--radius-pill);
}
.seg-btn {
  height: 28px; padding: 0 12px; border: none; border-radius: var(--radius-pill);
  background: transparent; color: var(--text-secondary);
  font: inherit; font-size: var(--text-xs); font-weight: 600; cursor: pointer;
}
.seg-btn.on { background: var(--panel-bg); color: var(--text); box-shadow: var(--shadow-card) }

.lead { margin: 12px 0 0; font-size: var(--text-xs); line-height: 1.7; color: var(--text-muted) }
.note { margin: 10px 0 0; font-size: var(--text-xs); color: var(--warning) }
.note.warn { background: var(--warning-soft); border-radius: var(--radius-sm); padding: 8px 10px }

.row { display: flex; align-items: center; gap: 10px; margin-top: 14px }
.cb-row { margin-top: 10px }
.cb-row .input { flex: 1; min-width: 0; height: 28px }

.line { display: flex; align-items: center; gap: 8px; margin-top: 12px; min-width: 0 }
.line .chip { flex-shrink: 0 }
.url {
  flex: 1; min-width: 0;
  font-size: var(--text-xs); color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.line .action-btn { height: 28px; flex-shrink: 0 }

.code-box {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  margin-top: 14px; padding: 16px;
  background: var(--fill); border-radius: var(--radius-card);
}
.code-label { font-size: 26px; font-weight: 700; letter-spacing: 0.18em; color: var(--text) }
.code-hint { font-size: var(--text-xs); color: var(--text-muted) }

.pathline {
  display: flex; align-items: center; gap: 8px; margin-top: 12px; height: 34px; padding: 0 10px;
  background: var(--sunken); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.pathline .k { flex-shrink: 0; font-size: var(--text-2xs); color: var(--text-faint) }
.pathline .v {
  flex: 1; min-width: 0; font-size: var(--text-xs); color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.field { display: flex; flex-direction: column; gap: 6px; margin-top: 14px }
.field-label { font-size: var(--text-xs); color: var(--text-secondary) }
.field .input { height: 28px }
</style>
