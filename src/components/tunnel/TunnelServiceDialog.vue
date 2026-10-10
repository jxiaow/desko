<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fileshareApi } from '../../services/api/fileshare'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelServiceRow } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  /** null = 新增一条 */
  row: TunnelServiceRow | null
  busy: boolean
}>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toastStore = useToastStore()

const label = ref('')
const hostname = ref('')
const port = ref('')
/** 只有新增时能选种类：改一条已登记的服务不能偷换它指向的是谁 */
const preset = ref('')
/** 公网侧口令：留空 = 不动现在这把（摘要不回前端，界面上没有"当前口令"） */
const publicPassword = ref('')
const publicReadOnly = ref(true)
const acting = ref(false)

// v-if 重挂时首帧就得是终值，否则每次打开都从空白播一遍填充
watch(
  () => props.row,
  (row) => {
    label.value = row?.label ?? ''
    hostname.value = row?.hostname ?? ''
    port.value = row ? String(row.port) : ''
    preset.value = row?.preset ?? ''
    publicPassword.value = ''
    publicReadOnly.value = row?.publicReadOnly ?? true
  },
  { immediate: true },
)

const isFileshare = computed(() => preset.value === 'fileshare')
/** 只有改一条已登记的 fileshare 才谈得上公网策略：新建那条门还没上公网 */
const showsPolicy = computed(() => Boolean(props.row) && isFileshare.value)
const portNumber = computed(() => Number.parseInt(port.value, 10))
const portOk = computed(() => Number.isInteger(portNumber.value) && portNumber.value >= 1 && portNumber.value <= 65535)
const canSave = computed(
  () => hostname.value.trim().length > 0 && portOk.value && !acting.value && !props.busy,
)
const passwordWritten = computed(() => publicPassword.value.trim().length > 0)
const readOnlyWritten = computed(() => props.row ? publicReadOnly.value !== props.row.publicReadOnly : false)
const policyWritten = computed(() => passwordWritten.value || readOnlyWritten.value)

async function readPort() {
  try {
    const s = await fileshareApi.status()
    if (s.boundPort == null) {
      toastStore.showToast('局域网传输此刻没在本机监听，读不到实际端口：先启动它，或照实手填', 'error')
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
    toastStore.showToast('已记下：点「应用」把子域指过来')
    emit('saved')
    emit('close')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div class="dialog-overlay form-overlay">
    <div class="dialog tunnel-service-dialog" role="dialog" aria-modal="true" :aria-label="row ? '公网设置' : '添加本地服务'">
      <div class="dialog-header">
        <h3>{{ row ? `${row.label} · 公网设置` : '添加一项本地服务' }}</h3>
        <button class="dialog-close" type="button" title="关闭" @click="emit('close')">
          <AppIcon name="x" :size="15" />
        </button>
      </div>

      <div class="dialog-body">
        <div v-if="!row" class="form-group">
          <label>挂哪一类</label>
          <div class="seg">
            <button type="button" :class="{ on: preset === 'fileshare' }" @click="preset = 'fileshare'">局域网传输</button>
            <button type="button" :class="{ on: preset === '' }" @click="preset = ''">其它本机服务</button>
          </div>
          <p class="field-hint">
            {{ isFileshare
              ? 'desko 自己起的那个服务，公网侧能强制口令与只读。'
              : '本机在听的任何 HTTP 服务。desko 不在它的请求链路上，鉴权由那台服务自己负责。' }}
          </p>
        </div>

        <div class="form-group">
          <label for="tn-svc-name">名字</label>
          <input id="tn-svc-name" v-model="label" type="text" maxlength="40" placeholder="局域网传输" />
        </div>

        <div class="form-group">
          <label for="tn-svc-host">公网子域</label>
          <input
            id="tn-svc-host"
            v-model="hostname"
            class="mono"
            type="text"
            maxlength="253"
            spellcheck="false"
            placeholder="files.example.com"
          />
          <p class="field-hint">写完整主机名，不带协议和路径；一个子域只能指一个本机端口。</p>
        </div>

        <div class="form-group">
          <label for="tn-svc-port">本机端口</label>
          <div class="port-line">
            <input
              id="tn-svc-port"
              v-model="port"
              class="mono"
              type="text"
              inputmode="numeric"
              maxlength="5"
              placeholder="8421"
            />
            <button v-if="isFileshare" class="btn-secondary port-btn" type="button" @click="readPort">读实际端口</button>
          </div>
          <p class="field-hint">
            {{ isFileshare
              ? '取本机正在监听的那个值：配置端口被占用会向上漂，照配置填必错。'
              : '只许指向本机 127.0.0.1，不接受别台机器的地址。' }}
          </p>
        </div>

        <template v-if="showsPolicy">
          <div class="policy-head">谁能进、能做什么</div>

          <div class="form-group">
            <label for="tn-svc-pw">公网口令</label>
            <input
              id="tn-svc-pw"
              v-model="publicPassword"
              type="password"
              maxlength="64"
              autocomplete="new-password"
              :placeholder="row?.hasPublicPassword ? '留空 = 不动现在这把' : '还没设过：不设就过不了门'"
            />
            <p class="field-hint">
              {{ row?.hasPublicPassword
                ? '改口令就填新的；只动开关不必填。'
                : '这条门直接对着公网，没口令时 desko 不放它通：8–64 个字符，别用常见弱口令。' }}
            </p>
          </div>

          <div class="form-group">
            <label>公网动作</label>
            <div class="seg">
              <button type="button" :class="{ on: publicReadOnly }" @click="publicReadOnly = true">只读</button>
              <button type="button" :class="{ on: !publicReadOnly }" @click="publicReadOnly = false">放开上传</button>
            </div>
            <p class="field-hint">
              只读＝公网侧只能浏览和下载，上传、存文本会被拒。局域网那扇门不受这里影响。
            </p>
          </div>
        </template>

        <p v-if="!isFileshare" class="plain-note">
          desko 只负责把这条子域转到你填的本机端口。谁能进、能做什么，由那台服务自己判断；
          要 desko 来挡，得引 Cloudflare Access（本页不提供）。
        </p>
      </div>

      <div class="dialog-footer">
        <span class="foot-note">{{ row ? '改动即刻生效，无需重启隧道' : '记下后点「应用」才会上公网' }}</span>
        <button class="btn-secondary" type="button" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="!canSave" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* --font-mono 由页面在 .content-inner 上覆盖，变量能穿过组件边界 */
.mono { font-family: var(--font-mono); }

.tunnel-service-dialog { width: 520px }
.tunnel-service-dialog .dialog-body { padding: 14px 20px 4px }

/* 全局字段档就是本页要的档，这里只补等宽那一处 */
.form-group input.mono { font-family: var(--font-mono); }
.field-hint { margin: 5px 0 0; font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted) }

.seg { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden }
.seg button {
  height: 28px;
  padding: 0 12px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
}
.seg button + button { border-left: 1px solid var(--border) }
.seg button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600 }

.port-line { display: flex; gap: 8px; align-items: center }
.port-line input { flex: 1; min-width: 0 }
.port-btn { height: 32px; flex-shrink: 0 }

/* 公网策略与基础字段之间只靠小标题+间距分层，不做卡中卡 */
.policy-head {
  margin: 14px 0 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
}

.plain-note {
  margin: 2px 0 10px;
  padding: 8px 10px;
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 32%, transparent);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text);
}

.foot-note { margin-right: auto; font-size: var(--text-xs); color: var(--text-muted) }
</style>
