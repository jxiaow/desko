<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelBinary, TunnelDomain, TunnelLogin, TunnelProvision } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'
import { openExternal } from '../../utils/openExternal'

const props = defineProps<{
  provision: TunnelProvision | null
  login: TunnelLogin
  binary: TunnelBinary | null
  busy: boolean
  domain: TunnelDomain | null
  domainLoading: boolean
  domainError: string
}>()
const emit = defineEmits<{ refresh: []; retryDomain: [] }>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const tunnelName = ref('desko')
const acting = ref(false)
/** 同名但本机没记录：按名查那一刻才成立，之后的轮询不再替它作证 */
const nameTakenText = ref('')
/** 三步做完整卡收成一行；「调整」把它再摊开，改名字或重新授权用得着 */
const expanded = ref(false)

/** 本机已记的值要在首帧就落在输入框里：空框会让人以为那一格还没做，然后写重复值 */
const nameTouched = ref(false)
watch(
  () => props.provision?.tunnelName,
  (name) => {
    if (!nameTouched.value && name) tunnelName.value = name
  },
  { immediate: true },
)

const step = computed(() => props.provision?.step ?? 'no-binary')
/** 步骤序：卡在哪一步，前面几步就算做完。凭据缺失是第三步的缺口，不是第四步 */
const reached = computed(() => {
  const i = ['no-binary', 'not-authorized', 'no-tunnel', 'missing-credentials'].indexOf(step.value)
  if (i < 0) return 3
  return i === 3 ? 2 : i
})
const binDone = computed(() => reached.value >= 1)
const authDone = computed(() => reached.value >= 2)
const tunnelDone = computed(() => reached.value >= 3)
const collapsed = computed(() => tunnelDone.value && !expanded.value)

const waiting = computed(() => props.login.state === 'waiting')
const hasTunnel = computed(() => Boolean(props.provision?.tunnelId))
/** 倒计时只报还剩多久：授权卡在浏览器里，猜它走到哪一步没有意义 */
const loginLeft = computed(() => {
  const s = Math.max(0, props.login.secondsLeft)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})
const shortId = computed(() => (props.provision?.tunnelId ?? '').slice(0, 8))
const stepHint = computed(() => (nameTakenText.value ? '' : props.provision?.message ?? ''))
const disabled = computed(() => acting.value || props.busy)
/** 上一轮授权退了、凭据却没落位：把它最后那句原话摊开，别只把按钮退回「去授权」 */
const loginNote = computed(() =>
  !authDone.value && !waiting.value && props.login.state === 'timeout' ? props.login.note : null,
)

async function run<T>(fn: () => Promise<T>, done?: (value: T) => string) {
  if (acting.value || props.busy) return
  acting.value = true
  try {
    const value = await fn()
    if (done) toastStore.showToast(done(value))
    emit('refresh')
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    emit('refresh')
  } finally {
    acting.value = false
  }
}

function startLogin() {
  void run(() => tunnelApi.loginStart(), () => '请在浏览器完成授权，页面将自动更新')
}

function cancelLogin() {
  void tunnelApi.loginCancel().then(() => emit('refresh'))
}

function openAuthUrl() {
  const url = props.login.url
  if (!url) return
  void openExternal(url)
    .catch(() => toastStore.showToast('无法打开浏览器，请手动复制授权地址', 'error'))
}

function createTunnel(adopt: boolean) {
  if (adopt) nameTakenText.value = ''
  void run(
    () =>
      tunnelApi.ensureTunnel(tunnelName.value, adopt).then((p) => {
        // 这格只在刚问过远端的那一刻成立：轮询回读的是本机特征，不会替它保留，所以留在这里
        nameTakenText.value = p.nameTaken ? p.message : ''
        return p
      }),
    (p) => (p.tunnelId ? '隧道已就位' : '隧道未创建，请查看下方原因'),
  )
}

function fetchBinary() {
  void run(() => tunnelApi.fetchBinary(), (b) => `穿透程序已就位：${b.expectedVersion}`)
}

function revokeAuth() {
  if (acting.value || props.busy) return
  confirmStore.showConfirm(
    '撤销本机授权？',
    '将停止隧道并删除本机凭据，服务与隧道记录会保留，重新授权后可恢复。彻底吊销授权需前往 Cloudflare 控制台。',
    () => {
      void run(() => tunnelApi.revoke(), () => '本机授权已撤销')
    },
  )
}
</script>

<template>
  <section class="tn-card setup">
    <!-- 三步齐了只留一行：这一页的主角是服务列表，不是已经做完的准备 -->
    <div v-if="collapsed" class="tn-row">
      <span class="step-dot done"><AppIcon name="check" :size="11" /></span>
      <span class="lbl auto">接入准备</span>
      <span class="tn-value setup-summary" :title="provision?.tunnelId ?? ''">
        {{ provision?.tunnelName }}<span v-if="shortId" class="tn-dim setup-id"> · {{ shortId }}… 本机持有</span>
        <span v-if="domain" class="tn-dim"> · {{ domain.name }}</span>
      </span>
      <button class="btn-secondary row-btn" type="button" @click="expanded = true">
        <AppIcon name="adjustments" :size="12" />
        调整
      </button>
    </div>

    <template v-else>
      <div class="tn-head">
        <h2>接入准备</h2>
        <span class="head-cnt">{{ reached }} / 3 已完成</span>
      </div>

      <!-- 一：穿透程序。按固定版本拉、校验哈希，不随安装包分发 -->
      <div class="tn-row row-bin" :class="binDone ? 'done' : (reached === 0 ? 'cur' : 'todo')">
        <span class="step-dot" :class="{ done: binDone }">
          <AppIcon v-if="binDone" name="check" :size="11" />
          <template v-else>1</template>
        </span>
        <span class="lbl">穿透程序</span>
        <span class="mid">
          <span v-if="binDone" class="sub">cloudflared {{ binary?.expectedVersion }} · 已校验</span>
          <span v-else class="sub">下载并校验 cloudflared</span>
        </span>
        <button v-if="reached === 0" class="btn-primary row-btn" type="button" :disabled="disabled" @click="fetchBinary">
          {{ binary?.installed ? '重新校验' : '获取程序' }}
        </button>
      </div>

      <!-- 二：授权。凭据只落本机自己那份目录，不进备份 -->
      <div class="tn-row row-auth" :class="authDone ? 'done' : (reached === 1 ? 'cur' : 'todo')">
        <span class="step-dot" :class="{ done: authDone }">
          <AppIcon v-if="authDone" name="check" :size="11" />
          <template v-else>2</template>
        </span>
        <span class="lbl">Cloudflare 授权</span>
        <span class="mid">
          <span v-if="waiting" class="sub">
            等待浏览器里登录 Cloudflare<span class="tn-count">{{ loginLeft }}</span>
          </span>
          <span v-else-if="authDone" class="sub">
            本机已有授权凭据<span v-if="domain" class=""> · {{ domain.name }}</span>
            <span v-else-if="domainLoading"> · 正在读取主域名…</span>
          </span>
          <span v-else class="sub">通过浏览器授权，凭据保存在本机</span>
        </span>
        <template v-if="reached === 1">
          <button v-if="waiting && login.url" class="btn-secondary row-btn" type="button" @click="openAuthUrl">打开授权页</button>
          <button v-if="waiting" class="btn-secondary row-btn" type="button" @click="cancelLogin">取消</button>
          <button v-else class="btn-primary row-btn" type="button" :disabled="disabled" @click="startLogin">去授权</button>
        </template>
        <button
          v-if="authDone"
          class="btn-secondary row-btn"
          type="button"
          :disabled="disabled"
          @click="revokeAuth"
        >
          撤销本机授权
        </button>
      </div>

      <div v-if="loginNote" class="tn-note chip-warn">
        <AppIcon name="alert" :size="12" />
        <span class="note-text">{{ loginNote }}</span>
      </div>

      <!-- 三：隧道。本机记录优先，同名而本机没记录时默认不认 -->
      <div class="tn-row row-tunnel" :class="tunnelDone ? 'done' : (reached === 2 ? 'cur' : 'todo')">
        <span class="step-dot" :class="{ done: tunnelDone }">
          <AppIcon v-if="tunnelDone" name="check" :size="11" />
          <template v-else>3</template>
        </span>
        <span class="lbl">建隧道</span>
        <span class="mid">
          <template v-if="hasTunnel">
            <span class="sub ellipsis" :title="provision?.tunnelId ?? ''">
              {{ provision?.tunnelName }}<span v-if="shortId" class="tn-dim"> · {{ shortId }}… 本机持有</span>
            </span>
          </template>
          <input
            v-else-if="reached === 2"
            v-model="tunnelName"
            class="tn-input"
            type="text"
            maxlength="64"
            spellcheck="false"
            placeholder="desko"
            aria-label="隧道名称"
            :disabled="disabled"
            @input="nameTouched = true; nameTakenText = ''"
            @keyup.enter="createTunnel(false)"
          />
          <span v-else class="sub">请先完成 Cloudflare 授权</span>
        </span>
        <button
          v-if="step === 'missing-credentials'"
          class="btn-primary row-btn"
          type="button"
          :disabled="disabled"
          @click="createTunnel(false)"
        >
          找回凭据
        </button>
        <button
          v-else-if="reached === 2 && !hasTunnel"
          class="btn-primary row-btn"
          type="button"
          :disabled="disabled || waiting || !authDone"
          :title="authDone ? '' : '先在上一行完成授权'"
          @click="createTunnel(false)"
        >
          新建隧道
        </button>
      </div>

      <div v-if="nameTakenText" class="tn-note chip-warn">
        <AppIcon name="alert" :size="12" />
        <span class="note-text">{{ nameTakenText }}</span>
        <button class="btn-secondary row-btn" type="button" :disabled="disabled" @click="createTunnel(true)">接管</button>
      </div>

      <div v-if="stepHint && !collapsed" class="tn-note">{{ stepHint }}</div>

      <button v-if="tunnelDone" class="tn-fold" type="button" @click="expanded = false">收起</button>
    </template>
    <div v-if="domainError || (domain && domain.status !== 'active')" class="tn-note chip-warn">
      <AppIcon name="alert" :size="12" />
      <span class="note-text">{{ domainError ? `无法读取主域名：${domainError}` : `主域名 ${domain?.name} 尚未启用，请在 Cloudflare 完成域名接入后重试。` }}</span>
      <button class="btn-secondary row-btn" type="button" :disabled="domainLoading" @click="emit('retryDomain')">重试读取主域名</button>
    </div>
  </section>
</template>

<style scoped>
.setup .tn-head { height: auto; min-height: 56px; padding: 12px 20px; border-bottom: 0; }
.setup h2 { margin: 0; font-size: var(--text-base); font-weight: 600; }
.head-cnt { margin-left: auto; font-size: var(--text-xs); font-weight: 400; color: var(--text-secondary); }
.setup .tn-row { min-height: 56px; height: auto; padding: 14px 20px; gap: 12px; }
.setup .tn-row.cur { min-height: 80px; background: var(--fill); }
.row-btn { margin-left: auto; flex-shrink: 0; height: 32px; font-size: var(--text-xs); }
.row-btn + .row-btn { margin-left: 8px; }
.note-text { flex: 1; min-width: 0; }
.tn-dim, .tn-count { color: var(--text-secondary); }
.tn-count { margin-left: 6px; font-variant-numeric: tabular-nums; }
.lbl { flex-shrink: 0; width: 108px; font-size: var(--text-sm); color: var(--text); }
.lbl.auto { width: auto; font-weight: 600; }
.mid { flex: 1; min-width: 0; }
.sub { display: block; font-size: var(--text-sm); line-height: 20px; color: var(--text-secondary); }
.setup-summary { font-size: var(--text-sm); line-height: 22px; overflow-wrap: anywhere; }
.tn-note.chip-warn { align-items: flex-start; }
.tn-note.chip-warn .note-text { white-space: pre-line; line-height: 1.5; }
.step-dot { flex-shrink: 0; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-strong); border-radius: 50%; font-size: var(--text-xs); color: var(--text-secondary); }
.step-dot.done { background: var(--fill); border-color: var(--border); color: var(--text); }
.cur .step-dot { border-color: var(--text); color: var(--text); }
.tn-input { width: min(100%, 260px); min-width: 0; height: 32px; padding: 0 10px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); font-size: var(--text-sm); font-family: var(--font-ui); transition: border-color var(--transition); }
.tn-input:focus { outline: 2px solid var(--accent); outline-offset: 2px; }
.tn-input:disabled { color: var(--text-muted); background: var(--bg); }
.tn-fold { align-self: flex-start; padding: 10px 20px 14px; background: none; border: none; color: var(--text-secondary); font-size: var(--text-xs); cursor: pointer; }
.tn-fold:hover { color: var(--accent); }
@media (max-width: 700px) {
  .setup .tn-head { padding-inline: 16px; }
  .setup .tn-row { padding: 14px 16px; flex-wrap: wrap; gap: 10px; }
  .setup .lbl { width: calc(100% - 32px); }
  .setup .lbl.auto { width: auto; flex: 1; }
  .setup .mid { flex-basis: calc(100% - 32px); margin-left: 32px; }
  .setup .row-btn { min-height: 40px; }
  .setup-summary { order: 4; flex-basis: 100%; padding-left: 32px; }
  .setup-id { display: none; }
  .setup .tn-row.cur .row-btn { margin-left: 32px; }
  .setup .tn-row.cur .row-btn + .row-btn { margin-left: 0; }
  .setup .tn-note { flex-wrap: wrap; padding-inline: 16px; }
  .setup .tn-note .note-text { flex-basis: calc(100% - 24px); }
}
</style>
