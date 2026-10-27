<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fileshareApi } from '../../services/api/fileshare'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelDomain, TunnelServiceRow } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import { useEscapeClose } from '../../composables/useEscapeClose'

const props = defineProps<{
  /** null = 新增一条 */
  row: TunnelServiceRow | null
  busy: boolean
  domain: TunnelDomain | null
  domainLoading: boolean
  domainError: string
}>()
const emit = defineEmits<{ close: []; saved: []; retryDomain: [] }>()

const toastStore = useToastStore()

const label = ref('')
const hostInput = ref('')
const manualHost = ref(false)
const port = ref('')
/** 只有新增时能选种类：改一条已登记的服务不能偷换它指向的是谁 */
const preset = ref('')
/** 公网侧口令：留空 = 不动现在这把（摘要不回前端，界面上没有"当前口令"） */
const publicPassword = ref('')
const publicReadOnly = ref(true)
const acting = ref(false)
const saveError = ref('')
const dialog = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocus(dialog)
function close() {
  if (!acting.value) emit('close')
}
useEscapeClose(close)

// v-if 重挂时首帧就得是终值，否则每次打开都从空白播一遍填充
watch(
  () => props.row,
  (row) => {
    label.value = row?.label ?? ''
    hostInput.value = row?.hostname ?? ''
    manualHost.value = Boolean(row)
    port.value = row ? String(row.port) : ''
    preset.value = row?.preset ?? ''
    publicPassword.value = ''
    publicReadOnly.value = row?.publicReadOnly ?? true
  },
  { immediate: true },
)

function useAuthorizedDomain() {
  const suffix = props.domain ? `.${props.domain.name}` : ''
  if (suffix && hostInput.value.toLowerCase().endsWith(suffix)) {
    hostInput.value = hostInput.value.slice(0, -suffix.length)
  } else if (manualHost.value) {
    hostInput.value = ''
  }
  manualHost.value = false
}

watch(() => props.domain?.name, (name) => {
  if (name && hostInput.value.toLowerCase().endsWith(`.${name}`)) useAuthorizedDomain()
}, { immediate: true })

const prefixOk = computed(() => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostInput.value.trim()))
const hostname = computed(() => manualHost.value ? hostInput.value.trim().toLowerCase()
  : props.domain && prefixOk.value ? `${hostInput.value.trim().toLowerCase()}.${props.domain.name}` : '')
const fullHostOk = computed(() =>
  hostname.value.length <= 253 && hostname.value.includes('.') &&
  hostname.value.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)),
)
const hostOk = computed(() => manualHost.value ? fullHostOk.value
  : props.domain?.status === 'active' && prefixOk.value)

function useManualHost() {
  hostInput.value = hostname.value || hostInput.value
  manualHost.value = true
}

const isFileshare = computed(() => preset.value === 'fileshare')
/** 只有改一条已登记的 fileshare 才谈得上公网策略：新建那条门还没上公网 */
const showsPolicy = computed(() => Boolean(props.row) && isFileshare.value)
const portNumber = computed(() => Number(port.value))
const portOk = computed(() => /^\d+$/.test(port.value) && Number.isInteger(portNumber.value) && portNumber.value >= 1 && portNumber.value <= 65535)
const canSave = computed(
  () => hostOk.value && portOk.value && !acting.value && !props.busy,
)
const passwordWritten = computed(() => publicPassword.value.trim().length > 0)
const readOnlyWritten = computed(() => props.row ? publicReadOnly.value !== props.row.publicReadOnly : false)
const policyWritten = computed(() => passwordWritten.value || readOnlyWritten.value)

async function readPort() {
  try {
    const s = await fileshareApi.status()
    if (s.boundPort == null) {
      toastStore.showToast('未检测到监听端口，请先启动局域网传输。', 'error')
      return
    }
    port.value = String(s.boundPort)
    if (!label.value.trim()) label.value = '局域网传输'
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  }
}

async function save() {
  if (!canSave.value) return
  acting.value = true
  saveError.value = ''
  try {
    if (props.row) {
      await tunnelApi.updateService({
        id: props.row.id,
        hostname: hostname.value.trim(),
        port: portNumber.value,
        label: label.value.trim(),
      })
      if (showsPolicy.value && policyWritten.value) {
        await tunnelApi.setServicePolicy({
          id: props.row.id,
          password: publicPassword.value.trim(),
          readOnly: publicReadOnly.value,
        })
      }
    } else {
      await tunnelApi.addService({
        hostname: hostname.value.trim(),
        port: portNumber.value,
        label: label.value.trim(),
        preset: preset.value,
      })
    }
    toastStore.showToast('服务已保存')
    emit('saved')
    emit('close')
  } catch (e) {
    saveError.value = errText(e)
    toastStore.showToast(saveError.value, 'error')
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="dialog-overlay form-overlay tunnel-dialog-overlay">
    <form ref="dialog" class="dialog tunnel-service-dialog" role="dialog" aria-modal="true" :aria-label="row ? '公网设置' : '添加本地服务'" tabindex="-1" @submit.prevent="save" @keydown.tab="trapFocus">
      <div class="dialog-header">
        <h3>{{ row ? `${row.label} · 公网设置` : '添加本地服务' }}</h3>
        <button class="dialog-close" type="button" title="关闭" aria-label="关闭" :disabled="acting" @click="close">
          <AppIcon name="x" :size="16" />
        </button>
      </div>

      <div class="dialog-body">
        <div v-if="!row" class="form-group">
          <label>服务类型</label>
          <div class="seg" role="group" aria-label="服务类型">
            <button type="button" :class="{ on: preset === 'fileshare' }" :aria-pressed="preset === 'fileshare'" @click="preset = 'fileshare'">局域网传输</button>
            <button type="button" :class="{ on: preset === '' }" :aria-pressed="preset === ''" @click="preset = ''">其他服务</button>
          </div>
        </div>

        <div class="target-fields">
          <div class="form-group">
            <label for="tn-svc-name">服务名称</label>
            <input id="tn-svc-name" v-model="label" type="text" maxlength="40" :placeholder="isFileshare ? '局域网传输' : '例如：Web 服务'" />
          </div>
          <div class="form-group">
            <label for="tn-svc-port">本机端口</label>
            <div class="port-line">
              <input
                id="tn-svc-port"
                v-model="port"
                type="text"
                inputmode="numeric"
                maxlength="5"
                placeholder="8421"
                :aria-invalid="Boolean(port) && !portOk"
              />
              <button class="btn-secondary port-btn" :class="{ 'port-btn-hidden': !isFileshare }"
                :aria-hidden="!isFileshare" type="button" @click="readPort">获取端口</button>
            </div>
            <p class="lead">连接本机 127.0.0.1</p>
            <p v-if="port && !portOk" class="dialog-err">端口须为 1–65535 之间的整数。</p>
          </div>
        </div>

        <div class="form-group domain-context">
          <span class="field-label">已授权主域名</span>
          <p v-if="domain" class="domain-name">{{ domain.name }}</p>
          <p v-else-if="domainLoading" class="lead">正在读取主域名…</p>
          <p v-else class="lead">{{ domainError || '完成 Cloudflare 授权后自动获取。' }}</p>
          <button v-if="domainError || (domain && domain.status !== 'active')" class="btn-secondary" type="button" :disabled="domainLoading" @click="emit('retryDomain')">重试读取主域名</button>
          <p v-if="domain && domain.status !== 'active'" class="lead">域名尚未启用，请检查 Cloudflare 配置。</p>
        </div>

        <div class="form-group">
          <label for="tn-svc-host">{{ manualHost ? '完整域名' : '子域名前缀' }}</label>
          <div class="host-line">
            <input id="tn-svc-host" v-model="hostInput" type="text"
              :maxlength="manualHost ? 253 : 63" spellcheck="false"
              :aria-invalid="Boolean(hostInput.trim()) && !hostOk"
              :placeholder="manualHost ? (domain ? `files.${domain.name}` : '填写完整域名') : 'files'" />
            <span v-if="!manualHost && domain" class="host-suffix">.{{ domain.name }}</span>
          </div>
          <p v-if="hostname" class="host-preview">公网地址：https://{{ hostname }}</p>
          <div class="host-help">
            <p v-if="manualHost" class="lead">不含协议、端口或路径</p>
            <button v-if="manualHost && domain" class="host-mode" type="button" @click="useAuthorizedDomain">使用主域名</button>
            <button v-else-if="!manualHost" class="host-mode" type="button" @click="useManualHost">手动填写完整域名</button>
          </div>
          <p v-if="!manualHost && hostInput.trim() && !prefixOk" class="dialog-err">前缀须为 1–63 位字母、数字或连字符，且首尾不能为连字符。</p>
          <p v-if="manualHost && hostInput.trim() && !fullHostOk" class="dialog-err">请填写有效的完整域名，不含协议、端口或路径。</p>
        </div>

        <template v-if="showsPolicy">
          <div class="policy-head">访问控制</div>

          <div class="form-group">
            <label for="tn-svc-pw">访问口令</label>
            <input
              id="tn-svc-pw"
              v-model="publicPassword"
              type="password"
              maxlength="64"
              autocomplete="new-password"
              :placeholder="row?.hasPublicPassword ? '留空保留原口令' : '8–64 位字符'"
            />
            <p v-if="!row?.hasPublicPassword" class="lead">设置口令后才能公网访问。</p>
          </div>

          <div class="form-group">
            <label>访问权限</label>
            <div class="seg" role="group" aria-label="访问权限">
              <button type="button" :class="{ on: publicReadOnly }" :aria-pressed="publicReadOnly" @click="publicReadOnly = true">只读</button>
              <button type="button" :class="{ on: !publicReadOnly }" :aria-pressed="!publicReadOnly" @click="publicReadOnly = false">允许上传</button>
            </div>
            <p class="lead">
              仅影响公网；只读模式可浏览和下载。
            </p>
          </div>
        </template>

        <p v-if="!showsPolicy" class="service-note">
          {{ isFileshare ? '保存后需在「公网设置」中设置口令。' : '访问权限由原服务管理。' }}
        </p>
        <p v-if="saveError" class="dialog-err save-error" role="alert">{{ saveError }}</p>
      </div>

      <div class="dialog-footer">
        <span class="foot-note">{{ row ? '地址或端口变更需重新应用' : '保存后点击「应用」发布服务' }}</span>
        <button class="btn-secondary" type="button" :disabled="acting" @click="close">取消</button>
        <button class="btn-primary" type="submit" :disabled="!canSave" :aria-busy="acting">{{ acting ? '保存中…' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.tunnel-dialog-overlay { backdrop-filter: none; -webkit-backdrop-filter: none; }
.tunnel-service-dialog { width: 520px; background: var(--bg-surface); border-radius: 8px; }
.tunnel-service-dialog .dialog-header { height: auto; min-height: 64px; padding: 16px 24px; }
.tunnel-service-dialog .dialog-header h3 { font-size: var(--text-xl); line-height: 26px; }
.tunnel-service-dialog .dialog-body { padding: 4px 24px 12px; overflow-anchor: none; }
.tunnel-service-dialog .form-group { margin-bottom: 16px; }
.tunnel-service-dialog .domain-context { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; }
.tunnel-service-dialog .domain-context .field-label { margin-bottom: 0; }
.tunnel-service-dialog .form-group :is(label, .field-label) { display: block; margin-bottom: 8px; font-size: var(--text-sm); font-weight: 500; color: var(--text); }
.tunnel-service-dialog .form-group input { height: 36px; font-size: var(--text-content); border-radius: 6px; }
.tunnel-service-dialog .lead { margin: 8px 0 0; color: var(--text-secondary); line-height: 20px; }
.tunnel-service-dialog .seg { padding: 3px; border: 0; background: var(--fill); }
.tunnel-service-dialog .seg button { height: 30px; font-size: var(--text-sm); }
.tunnel-service-dialog .seg button.on { background: var(--bg-surface); color: var(--text); box-shadow: none; }
.tunnel-service-dialog .dialog-footer { padding: 14px 24px; gap: 8px; flex-wrap: wrap; }
.tunnel-service-dialog button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.tunnel-service-dialog .save-error { white-space: pre-line; overflow-wrap: anywhere; }

.target-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.port-line { display: flex; gap: 8px; align-items: center }
.port-line input { flex: 1; min-width: 0 }
.port-btn { width: 80px; flex-shrink: 0; align-self: flex-start }
.port-btn-hidden { visibility: hidden; pointer-events: none }

.domain-name { margin: 0; color: var(--text); font-size: var(--text-sm) }
.host-line { display: flex; align-items: center; gap: 8px }
.host-line input { flex: 1; min-width: 0 }
.host-suffix { max-width: 60%; overflow-wrap: anywhere; color: var(--text-muted); font-size: var(--text-xs) }
.host-preview { margin: 6px 0 0; overflow-wrap: anywhere; color: var(--text-url); font-size: var(--text-xs) }
.host-help { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; margin-top: 6px }
.form-group .host-help .lead { margin: 0 }
.host-mode { padding: 0; border: 0; background: none; color: var(--accent); cursor: pointer; font-size: var(--text-xs) }

/* 公网策略与基础字段之间只靠小标题+间距分层，不做卡中卡 */
.policy-head {
  margin: 14px 0 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
}

.service-note {
  margin: 2px 0 10px;
  min-height: 1.6em;
  font-size: var(--text-description);
  line-height: 1.6;
  color: var(--text-muted);
}

.foot-note { margin-right: auto; font-size: var(--text-xs); color: var(--text-muted) }
@media (max-width: 480px) {
  .target-fields { grid-template-columns: minmax(0, 1fr); gap: 0; }
}
@media (max-width: 600px) {
  .tunnel-service-dialog { width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
  .tunnel-service-dialog .dialog-header { padding: 16px; }
  .tunnel-service-dialog .dialog-body { padding: 4px 16px 12px; }
  .tunnel-service-dialog .dialog-footer { padding: 12px 16px; }
  .foot-note { flex-basis: 100%; margin-bottom: 4px; }
  .tunnel-service-dialog .dialog-footer .btn-secondary { margin-left: auto; }
  .tunnel-service-dialog .dialog-footer button { min-height: 40px; }
  .port-btn { width: 72px; height: 36px; padding-inline: 6px; }
}
</style>
