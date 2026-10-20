<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { listen } from '../../services/events'
import { isWebRuntime } from '../../services/runtime'
import { writeClipboardText } from '../../utils/clipboard'
import { openExternal } from '../../utils/openExternal'
import { codexApi, type StoragePaths } from '../../services/api/codex'
import { errText } from '../../services/api/backup'
import { refreshAccounts } from '../../services/codexState'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

/** 传入则本次登录覆盖该已有账号（重新授权），留空则新增一条。 */
const props = defineProps<{ reauthAccountId?: string | null }>()
const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
useEscapeClose(() => close())

type Mode = 'oauth' | 'device' | 'apikey' | 'import'
const mode = ref<Mode>(isWebRuntime() ? 'device' : 'oauth')
const importInput = ref<HTMLInputElement | null>(null)

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
const pasteJson = ref('')
const tokenMode = ref<'access' | 'tokens'>('access')
const tokenName = ref('')
const accessToken = ref('')
const idToken = ref('')
const refreshToken = ref('')
let active = true

async function importFromToken() {
  if (importing.value) return
  const access = accessToken.value.trim()
  if (!access || (tokenMode.value === 'access' ? !tokenName.value.trim() : !idToken.value.trim())) return
  importing.value = true
  try {
    const account = tokenMode.value === 'access'
      ? await codexApi.importAccessToken(tokenName.value.trim(), access)
      : await codexApi.addTokens(idToken.value.trim(), access, refreshToken.value)
    if (!active) return
    await refreshAccounts()
    if (!active) return
    toastStore.showToast(`已导入 ${account.email}`)
    emit('close')
  } catch (e) {
    if (active) toastStore.showToast(errText(e), 'error')
  } finally {
    importing.value = false
  }
}

async function copy(text: string, label: string) {
  try {
    await writeClipboardText(text)
    toastStore.showToast(`${label}已复制`)
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

async function openInBrowser(url: string) {
  try {
    await openExternal(url)
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
      // 设备码轮询遇到明确失败（非 403/404 待授权）后端会终止并广播原因；
      // 不接这条事件，弹窗只会干等到超时后误报「授权超时」。
      listen<{ loginId: string; error: string }>('codex-device-auth-error', (e) => {
        if (e.payload.loginId !== loginId.value) return
        waiting.value = false
        toastStore.showToast(`设备授权失败：${e.payload.error}`, 'error')
      }),
    ])
  ).filter(Boolean)
}

/** 回调只证明拿到了码，落库要显式收口：这一步把凭据写进 desko 的账号库 */
async function finishLogin() {
  if (!loginId.value) return
  busy.value = true
  try {
    const a = await codexApi.oauthCompleted(loginId.value, props.reauthAccountId ?? undefined)
    toastStore.showToast(props.reauthAccountId ? `已重新登录 ${a.email}` : `已登录 ${a.email}`)
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
    const r = await codexApi.oauthStart(props.reauthAccountId ?? undefined)
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
  if (isWebRuntime()) { importInput.value?.click(); return }
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

async function importBrowserFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length || importing.value) return
  importing.value = true
  let imported = 0
  const failures: string[] = []
  try {
    for (const file of files) {
      if (!active) break
      try {
        if (file.size > 16 * 1024 * 1024) throw new Error('文件超过 16 MiB')
        imported += (await codexApi.importJson(await file.text())).length
      } catch (e) { failures.push(`${file.name}：${errText(e)}`) }
    }
    if (!active) return
    await refreshAccounts()
    if (active) toastStore.showToast(`已导入 ${imported} 条账号${failures.length ? `，${failures.length} 个文件失败：${failures[0]}` : ''}`, failures.length ? 'error' : 'success')
  } finally { importing.value = false }
}

/** 粘贴导出的 JSON（单条对象或数组）走的是和选文件同一条落库路径，免去先存盘 */
async function importFromPaste() {
  const text = pasteJson.value.trim()
  if (!text) {
    toastStore.showToast('先把导出的 JSON 粘进来', 'error')
    return
  }
  importing.value = true
  try {
    const list = await codexApi.importJson(text)
    toastStore.showToast(`已导入 ${list.length} 条账号`)
    await refreshAccounts()
    emit('close')
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

onUnmounted(() => {
  active = false
  unlisten.forEach((f) => f())
})

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
    <input ref="importInput" type="file" accept=".json,application/json" multiple hidden @change="importBrowserFiles" />
    <div class="dialog auth-dialog" role="dialog" aria-modal="true" :aria-label="reauthAccountId ? '重新登录 Codex 账号' : '添加 Codex 账号'">
      <div class="dialog-header">
        <h3>{{ reauthAccountId ? '重新登录 Codex 账号' : '添加 Codex 账号' }}</h3>
        <button class="dialog-close" type="button" title="关闭" @click="close">
          <AppIcon name="x" :size="16" />
        </button>
      </div>

      <div class="auth-tabs">
        <div class="seg" role="tablist" aria-label="账号添加方式">
          <button id="codex-auth-oauth" class="seg-btn" :class="{ on: mode === 'oauth' }" type="button" role="tab" :aria-selected="mode === 'oauth'" aria-controls="codex-auth-content" @click="mode = 'oauth'">浏览器登录</button>
          <button id="codex-auth-device" class="seg-btn" :class="{ on: mode === 'device' }" type="button" role="tab" :aria-selected="mode === 'device'" aria-controls="codex-auth-content" @click="mode = 'device'">设备码</button>
          <button id="codex-auth-apikey" class="seg-btn" :class="{ on: mode === 'apikey' }" type="button" role="tab" :aria-selected="mode === 'apikey'" aria-controls="codex-auth-content" @click="mode = 'apikey'">API Key</button>
          <button id="codex-auth-import" class="seg-btn" :class="{ on: mode === 'import' }" type="button" role="tab" :aria-selected="mode === 'import'" aria-controls="codex-auth-content" @click="mode = 'import'">导入</button>
        </div>
      </div>

      <div id="codex-auth-content" class="dialog-body auth-content" role="tabpanel" :aria-labelledby="`codex-auth-${mode}`">

        <!-- 浏览器登录：官方 OAuth 授权码流程，desko 只在本机收回调 -->
        <template v-if="mode === 'oauth'">
          <p class="lead">
            点「开始登录」会打开 OpenAI 官方授权页。授权完成后 desko 自动收口；
            浏览器回跳失败时，把地址栏里的整条回调地址贴回下面这行。
          </p>
          <p v-if="portBusy && !loginId" class="note warn">
            回调端口已被占用，先退出其他正在登录的 Codex 客户端，或再点一次重试。
          </p>
          <template v-if="loginId">
            <div class="line">
              <span class="chip"><span class="dot" aria-hidden="true"></span>{{ waiting ? '等待授权…' : '已发起' }}</span>
              <code class="mono url" :title="authUrl">{{ authUrl }}</code>
            </div>
            <div class="cb-row">
              <div class="form-group cb-field">
                <input
                  v-model="callbackUrl"
                  type="text"
                  spellcheck="false"
                  placeholder="粘贴回跳地址，形如 http://localhost:1455/callback?code=…"
                  @keyup.enter="submitCallback"
                />
              </div>
              <button class="btn-primary" type="button" :disabled="busy" @click="submitCallback">提交</button>
            </div>
          </template>
        </template>

        <!-- 设备码：不占回调端口，适合本机端口被占或远程桌面里没有浏览器的情况 -->
        <template v-else-if="mode === 'device'">
          <p class="lead">
            设备码流程不开本地端口：输一串 8 位码到 OpenAI 的验证页即可，本机没有浏览器也能完成。
          </p>
          <template v-if="loginId">
            <div class="code-box">
              <span class="code-label mono">{{ userCode }}</span>
            </div>
            <div class="line">
              <span class="chip"><span class="dot" aria-hidden="true"></span>{{ waiting ? '等待授权…' : '已发起' }}</span>
              <code class="mono url" :title="verifyUrl">{{ verifyUrl }}</code>
            </div>
          </template>
        </template>

        <template v-else-if="mode === 'apikey'">
          <p class="lead">API Key 账号不进官方登录链路，只在 Desko 里保存，切号时写进 config.toml 的供应商段。</p>
          <div class="form-group">
            <label for="cx-key">API Key</label>
            <input id="cx-key" v-model="apiKey" class="mono" type="password" spellcheck="false" placeholder="sk-…" @keyup.enter="addApiKey" />
          </div>
          <div class="form-group">
            <label for="cx-base">自定义接口地址（可留空）</label>
            <input id="cx-base" v-model="apiBaseUrl" class="mono" type="text" spellcheck="false" placeholder="https://…/v1" @keyup.enter="addApiKey" />
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
          <div class="form-group">
            <label for="cx-paste">或直接粘贴导出的 JSON</label>
            <textarea
              id="cx-paste"
              v-model="pasteJson"
              class="paste-box mono"
              rows="4"
              spellcheck="false"
              placeholder='形如 [{"email":"…","openai_api_key":"sk-…"}]，也可只粘一条对象'
            />
            <div class="paste-act">
              <button class="action-btn" type="button" :disabled="importing || !pasteJson.trim()" @click="importFromPaste">
                导入这段 JSON
              </button>
            </div>
          </div>
          <details class="token-import">
            <summary>从 Token 导入账号</summary>
            <div class="token-modes" role="group" aria-label="Token 类型">
              <button class="action-btn" type="button" :aria-pressed="tokenMode === 'access'" @click="tokenMode = 'access'">Access Token</button>
              <button class="action-btn" type="button" :aria-pressed="tokenMode === 'tokens'" @click="tokenMode = 'tokens'">Token 组合</button>
            </div>
            <div v-if="tokenMode === 'access'" class="form-group">
              <label for="cx-token-name">账号名称</label>
              <input id="cx-token-name" v-model="tokenName" type="text" placeholder="用于识别这条 Token 账号" />
            </div>
            <div v-else class="form-group">
              <label for="cx-id-token">ID Token</label>
              <input id="cx-id-token" v-model="idToken" type="password" autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-group">
              <label for="cx-access-token">Access Token</label>
              <input id="cx-access-token" v-model="accessToken" type="password" autocomplete="off" spellcheck="false" />
            </div>
            <div v-if="tokenMode === 'tokens'" class="form-group">
              <label for="cx-refresh-token">Refresh Token（可选）</label>
              <input id="cx-refresh-token" v-model="refreshToken" type="password" autocomplete="off" spellcheck="false" />
            </div>
            <button class="action-btn" type="button" :disabled="importing || !accessToken.trim() || (tokenMode === 'access' ? !tokenName.trim() : !idToken.trim())" @click="importFromToken">导入 Token</button>
          </details>
        </template>
      </div>

      <!-- 每个页签的收口动作都在底栏，正文只留字段与状态；等待授权时底栏换成那条地址上的动作。 -->
      <div class="dialog-footer">
        <template v-if="mode === 'import'">
          <button class="btn-secondary" type="button" :disabled="importing" @click="importFromFile">
            <AppIcon name="folder" :size="13" />从 auth.json 导入…
          </button>
          <button class="btn-primary" type="button" :disabled="importing" @click="importLocal">
            <AppIcon name="download" :size="13" />导入本机账号
          </button>
        </template>
        <template v-else-if="mode === 'apikey'">
          <button class="btn-primary" type="button" :disabled="busy || !apiKey.trim()" @click="addApiKey">添加</button>
        </template>
        <template v-else-if="loginId && mode === 'device'">
          <button class="btn-secondary" type="button" @click="copy(userCode, '设备码')">复制码</button>
          <button class="btn-primary" type="button" @click="openInBrowser(verifyUrl)">
            <AppIcon name="external" :size="13" />打开验证页
          </button>
        </template>
        <template v-else-if="loginId">
          <button class="btn-secondary" type="button" @click="copy(authUrl, '授权地址')">复制地址</button>
          <button class="btn-secondary" type="button" @click="openInBrowser(authUrl)">
            <AppIcon name="external" :size="13" />打开授权页
          </button>
        </template>
        <button v-else-if="mode === 'oauth'" class="btn-primary" type="button" :disabled="busy" @click="startOAuth">开始登录</button>
        <button v-else-if="mode === 'device'" class="btn-primary" type="button" :disabled="busy" @click="startDevice">取设备码</button>
        <button class="btn-secondary" type="button" @click="close">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.token-import { margin-top: var(--space-4); border-top: 1px solid var(--border); padding-top: var(--space-3); }
.token-import summary { color: var(--text-secondary); font-size: var(--text-sm); cursor: pointer; }
.token-modes { display: flex; gap: var(--space-2); margin-block: var(--space-3); }
.token-modes button[aria-pressed='true'] { color: var(--accent); background: var(--accent-soft); }
.auth-dialog { width: 520px; height: min(560px, calc(100dvh - 40px)); max-height: calc(100dvh - 40px); }
.auth-tabs { padding: 0 var(--space-4); flex-shrink: 0; }
.auth-tabs .seg { margin-bottom: 0; }
.auth-content { min-height: 0; }
.auth-dialog .dialog-footer { min-height: 54px; flex-wrap: wrap; padding-block: 8px; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }

/* 页签分段控件与说明句（.lead）走 global.css 的弹窗档 */
.note { margin: 10px 0 0; font-size: var(--text-xs); color: var(--warning) }
.note.warn { background: var(--warning-soft); border-radius: var(--radius-sm); padding: 8px 10px }

/* 回跳地址那一行：字段吃全局 .form-group 档，按钮贴在同一行右端 */
.cb-row { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px }
.cb-row .cb-field { flex: 1; min-width: 0; margin-bottom: 0 }

.line { display: flex; align-items: center; gap: 8px; margin-top: 12px; min-width: 0 }
.line .chip { flex-shrink: 0 }
/* 整条地址要读得完：动作已收进底栏，这一行只剩状态与地址，不必再截断 */
.url {
  flex: 1; min-width: 0;
  font-size: var(--text-xs); line-height: 18px; color: var(--text-secondary);
  word-break: break-all;
}

.code-box {
  margin-top: 14px; text-align: center;
}
.code-label { font-size: var(--text-xl); font-weight: 600; letter-spacing: 0.12em; color: var(--text) }

.pathline {
  display: flex; align-items: center; gap: 8px; margin-top: 12px; height: 34px;
}
.pathline .k { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-faint) }
.pathline .v {
  flex: 1; min-width: 0; font-size: var(--text-xs); color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* 粘贴导入：底栏已有两个收口动作，再塞第三颗会溢出 520px，动作贴着字段走右端 */
.paste-box { line-height: 1.6; font-size: var(--text-xs); resize: vertical }
.paste-act { display: flex; justify-content: flex-end; margin-top: 8px }
</style>
