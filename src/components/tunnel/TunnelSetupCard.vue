<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelBinary, TunnelLogin, TunnelProvision } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  provision: TunnelProvision | null
  login: TunnelLogin
  binary: TunnelBinary | null
  busy: boolean
}>()
const emit = defineEmits<{ refresh: [] }>()

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
  void run(() => tunnelApi.loginStart(), () => '已在浏览器里发起授权，完成后本页自己会更新')
}

function cancelLogin() {
  void tunnelApi.loginCancel().then(() => emit('refresh'))
}

function openAuthUrl() {
  const url = props.login.url
  if (!url) return
  void import('@tauri-apps/plugin-shell')
    .then(({ open }) => open(url))
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
    (p) => (p.tunnelId ? '隧道已就位' : '这条还没建：下面那句说清了原因'),
  )
}

function fetchBinary() {
  void run(() => tunnelApi.fetchBinary(), (b) => `穿透程序已就位：${b.expectedVersion}`)
}

function revokeAuth() {
  if (acting.value || props.busy) return
  confirmStore.showConfirm(
    '撤销本机授权？',
    '撤销后隧道会停止，本机的授权凭据和隧道运行凭据会被删除；已登记的服务和隧道记录保留，重新授权后可恢复。Cloudflare 账号侧的登录授权不会被本操作回收，如需彻底吊销请去 Cloudflare 控制台。',
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
      <span class="tn-value mono ellipsis" :title="provision?.tunnelId ?? ''">
        {{ provision?.tunnelName }}<span v-if="shortId" class="tn-dim"> · {{ shortId }}… 本机持有</span>
      </span>
      <button class="btn-secondary row-btn" type="button" @click="expanded = true">
        <AppIcon name="adjustments" :size="12" />
        调整
      </button>
    </div>

    <template v-else>
      <div class="tn-head">
        <span>接入准备</span>
        <span class="head-cnt">第 {{ Math.min(reached + 1, 3) }} 步 / 共 3 步</span>
      </div>

      <!-- 一：穿透程序。按固定版本拉、校验哈希，不随安装包分发 -->
      <div class="tn-row row-bin" :class="binDone ? 'done' : (reached === 0 ? 'cur' : 'todo')">
        <span class="step-dot" :class="{ done: binDone }">
          <AppIcon v-if="binDone" name="check" :size="11" />
          <template v-else>1</template>
        </span>
        <span v-if="!binDone" class="lbl">穿透程序</span>
        <span class="mid">
          <span v-if="binDone" class="sub mono">已校验的 cloudflared {{ binary?.expectedVersion }}</span>
          <span v-else class="sub">按固定版本下载并校验哈希，产物只落本机目录</span>
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
        <span v-if="!authDone" class="lbl">授权</span>
        <span class="mid">
          <span v-if="waiting" class="sub">
            等待浏览器里登录 Cloudflare<span class="tn-count mono">{{ loginLeft }}</span>
          </span>
          <span v-else-if="authDone" class="sub">本机已有授权凭据</span>
          <span v-else class="sub">在浏览器里登录 Cloudflare，凭据只留本机自己那份目录</span>
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

      <!-- 三：隧道。本机记录优先，同名而本机没记录时默认不认 -->
      <div class="tn-row row-tunnel" :class="tunnelDone ? 'done' : (reached === 2 ? 'cur' : 'todo')">
        <span class="step-dot" :class="{ done: tunnelDone }">
          <AppIcon v-if="tunnelDone" name="check" :size="11" />
          <template v-else>3</template>
        </span>
        <span v-if="!tunnelDone" class="lbl">建隧道</span>
        <span class="mid">
          <template v-if="hasTunnel">
            <span class="sub mono ellipsis" :title="provision?.tunnelId ?? ''">
              {{ provision?.tunnelName }}<span v-if="shortId" class="tn-dim"> · {{ shortId }}… 本机持有</span>
            </span>
          </template>
          <input
            v-else-if="reached === 2"
            v-model="tunnelName"
            class="tn-input mono"
            type="text"
            maxlength="64"
            spellcheck="false"
            placeholder="desko"
            :disabled="disabled"
            @input="nameTouched = true; nameTakenText = ''"
            @keyup.enter="createTunnel(false)"
          />
          <span v-else class="sub">授权完成后才能建，本机只建自己这一条</span>
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

      <button v-if="tunnelDone" class="tn-fold" type="button" @click="expanded = false">收起来</button>
    </template>
  </section>
</template>

<style scoped>
/* --font-mono 由页面在 .content-inner 上覆盖，变量能穿过组件边界 */
.mono { font-family: var(--font-mono); }
.head-cnt { margin-left: 8px; font-size: var(--text-xs); color: var(--text-muted) }
.row-btn { margin-left: auto; flex-shrink: 0 }
.row-btn + .row-btn { margin-left: 8px }
.note-text { flex: 1; min-width: 0 }
.tn-dim { color: var(--text-muted) }
.tn-count { margin-left: 6px; color: var(--text-muted) }
.lbl { flex-shrink: 0; width: 76px; font-size: var(--text-sm); color: var(--text) }
.lbl.auto { width: auto; font-weight: 600 }
.mid { flex: 1; min-width: 0 }
.sub { font-size: var(--text-xs); color: var(--text-muted) }

/* 步骤圆点：实心勾 = 做完，数字 = 排到哪一步 */
.step-dot {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  font-size: 11px;
  color: var(--text-muted);
}
.step-dot.done { background: var(--accent); border-color: var(--accent); color: var(--accent-on) }
.cur .step-dot { border-color: var(--accent); color: var(--accent) }

/* 做完的收成 44px，当前那步 64px 并持有唯一一颗主行动钮 */
.tn-row.done { height: 44px }
.tn-row.cur { height: 64px }
.tn-row.todo { height: 44px }
.tn-row.cur .sub { color: var(--text) }

.tn-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-mono);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.tn-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring) }
.tn-input:disabled { color: var(--text-muted); background: var(--bg) }

.tn-fold {
  align-self: flex-start;
  padding: 6px 16px 8px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
}
.tn-fold:hover { color: var(--accent) }
</style>
