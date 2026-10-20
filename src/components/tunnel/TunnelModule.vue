<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isWebRuntime } from '../../services/runtime'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelServiceRow, TunnelSplitReport } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import {
  tnLoaded as loaded,
  tnStatus as status,
  tnBinary as binary,
  tnProvision as provision,
  tnLogin as login,
  tnPollError as pollError,
  tnServices as services,
  tnRefresh as refresh,
  tnDomain as domain,
  tnDomainLoading as domainLoading,
  tnDomainError as domainError,
  tnLoadDomain as loadDomain,
  tnClearDomain as clearDomain,
} from '../../services/tunnelState'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import TunnelSetupCard from './TunnelSetupCard.vue'
import TunnelServicesCard from './TunnelServicesCard.vue'
import TunnelServiceDialog from './TunnelServiceDialog.vue'
import { usePageHeadStore } from '../../stores/pageHead'

const toastStore = useToastStore()

const busy = ref(false)

const showDetail = ref(false)
const report = ref<TunnelSplitReport | null>(null)
const probing = ref(false)
const dialogRow = ref<TunnelServiceRow | null | undefined>(undefined)

watch(() => provision.value?.authorized, (authorized) => {
  if (authorized) void loadDomain()
  else if (authorized === false) clearDomain()
}, { immediate: true })

/** 三态分开说：进程起来了 ≠ 连上了边缘，把中间那格洗成"运行中"是骗人 */
const state = computed(() => {
  const s = status.value
  if (!s || !s.alive) return '已停止'
  return s.registered ? '已连上边缘' : '启动中'
})
const running = computed(() => status.value?.running ?? false)
const bound = computed(() => (status.value?.bound ?? false) && services.value.length > 0)
const unrouted = computed(() => services.value.filter((s) => !s.routed).length)
const binaryState = computed(() => {
  const b = binary.value
  if (!b || !b.installed) return '未获取'
  return b.verified ? '已校验' : '未校验'
})
const summary = computed(() => {
  const version = binary.value?.expectedVersion ?? '—'
  const proc = status.value?.pid ? `PID ${status.value.pid}` : '无进程'
  return `cloudflared ${version} · ${binaryState.value} · ${proc}`
})

async function toggle() {
  if (busy.value) return
  busy.value = true
  try {
    if (running.value || (status.value?.alive ?? false)) {
      await tunnelApi.stop()
      toastStore.showToast('隧道已停止')
    } else {
      const s = await tunnelApi.start()
      toastStore.showToast(s.registered ? '隧道已连上 Cloudflare 边缘' : '进程已起，仍在连边缘')
    }
    await refresh()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
    await refresh()
  } finally {
    busy.value = false
  }
}

/** 劈流只能主动查：同一条隧道两处并存不报错，只按地理就近分流量 */
async function probe() {
  if (probing.value) return
  probing.value = true
  try {
    report.value = await tunnelApi.probeConnectors()
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    probing.value = false
  }
}

// 注册要几秒，进程状态与服务列表又只在本地变化：只在页面活着时低频轮询，不常驻
let timer: number | undefined
let unlistenFocus: (() => void) | null = null
let disposed = false

async function refreshNow() {
  try {
    await refresh()
  } catch {
    /* 回读失败由下一次轮询补上，不打断刚做完的动作 */
  }
}

function refreshOnFocus() {
  if (!busy.value) void refreshNow()
}

function refreshOnVisible() {
  if (document.visibilityState === 'visible') refreshOnFocus()
}

onMounted(() => {
  void refreshNow()
  timer = window.setInterval(() => {
    if (!busy.value) void refresh().catch(() => undefined)
  }, 3000)
  window.addEventListener('focus', refreshOnFocus)
  document.addEventListener('visibilitychange', refreshOnVisible)
  // 浏览器里点完授权回 desko 的那一刻必须当场补一次：窗口被盖住期间 WebView2 把
  // 3 秒计时器节流到分钟级，只靠轮询就成了「授权完了界面一动不动」
  try {
    if (isWebRuntime()) return
    void getCurrentWindow().onFocusChanged(({ payload: hasFocus }) => {
      if (hasFocus) refreshOnFocus()
    }).then((unlisten) => {
      if (disposed) unlisten()
      else unlistenFocus = unlisten
    }).catch(() => undefined)
  } catch {
    /* 拿不到原生窗口句柄时仍由 DOM 聚焦、可见性变化与轮询补刷 */
  }
})

onUnmounted(() => {
  disposed = true
  if (timer) window.clearInterval(timer)
  window.removeEventListener('focus', refreshOnFocus)
  document.removeEventListener('visibilitychange', refreshOnVisible)
  unlistenFocus?.()
})

usePageHeadStore().setHead('内网穿透')
</script>

<template>
  <div class="content-inner">
    <div v-if="!loaded" class="tn-card" aria-hidden="true">
      <div class="skeleton-row" v-for="n in 2" :key="n">
        <span class="skeleton-block"></span>
        <span class="skeleton-line w40"></span>
      </div>
    </div>

    <template v-else>
      <div class="page-bar">
        <span class="chip" :class="{ live: running }">
          <span class="dot" aria-hidden="true"></span>
          {{ state }}
        </span>
        <span class="chip">
          <span class="dot" aria-hidden="true"></span>
          {{ services.length }} 项服务<span v-if="unrouted" class="chip-warn-text"> · {{ unrouted }} 条未应用</span>
        </span>
        <div class="page-actions">
          <button
            class="btn-primary toggle-btn"
            :class="{ 'ghost-danger': status?.alive }"
            :disabled="busy || !bound"
            :title="bound ? '' : (services.length ? '本机还没有可启动的隧道' : '还没有登记要挂出去的本地服务')"
            @click="toggle"
          >
            <AppIcon :name="status?.alive ? 'x' : 'external'" :size="13" />
            {{ status?.alive ? '停止隧道' : '启动隧道' }}
          </button>
        </div>
      </div>

      <!-- 准备流：缺东西时才摊开，齐了收成一行摘要 -->
      <TunnelSetupCard
        :provision="provision"
        :login="login"
        :binary="binary"
        :busy="busy"
        :domain="domain"
        :domain-loading="domainLoading"
        :domain-error="domainError"
        @refresh="refreshNow"
        @retry-domain="loadDomain(true)"
      />

      <div v-if="pollError" class="poll-err">
        <AppIcon name="alert" :size="12" />
        状态没读到：{{ pollError }}
      </div>

      <!-- 主角：一条隧道挂着的 N 条服务 -->
      <TunnelServicesCard
        :services="services"
        :has-tunnel="Boolean(provision?.tunnelId)"
        :busy="busy"
        @refresh="refreshNow"
        @add="dialogRow = null"
        @edit="(s) => (dialogRow = s)"
      />

      <!-- 程序与进程：默认只给一行摘要，点开再看完整事实 -->
      <section class="tn-card tn-foot" :class="{ expanded: showDetail }">
        <div class="tn-head">
          <span>程序与进程</span>
          <span class="diag-summary mono">{{ summary }}</span>
          <button class="foot-btn" type="button" @click="showDetail = !showDetail">
            <AppIcon :name="showDetail ? 'chevDown' : 'chevRight'" :size="12" />
            {{ showDetail ? '收起' : '详情' }}
          </button>
        </div>
        <div v-if="showDetail" class="tn-detail">
          <div class="tn-row">
            <span class="tn-label">程序版本</span>
            <span class="tn-value mono">{{ binary?.expectedVersion ?? '—' }} · {{ binaryState }}</span>
          </div>
          <div class="tn-row">
            <span class="tn-label">进 程</span>
            <span class="tn-value mono">{{ status?.pid ? `PID ${status.pid}` : '无进程' }}</span>
          </div>
          <div class="tn-row">
            <span class="tn-label">SHA-256</span>
            <span class="tn-value mono ellipsis" :title="binary?.path ?? ''">{{ binary?.actualSha256 ?? (binary?.installed ? '未校验' : '—') }}</span>
          </div>
          <div class="tn-row">
            <span class="tn-label">出口检查</span>
            <span class="tn-value" :class="{ 'txt-warn': report?.conflict }">
              {{ report?.message ?? '查一下这条隧道是不是只有本机这一处在跑' }}
            </span>
            <button
              class="btn-secondary d-btn"
              type="button"
              :disabled="probing || !provision?.tunnelId"
              @click="probe"
            >
              查一次
            </button>
          </div>
          <div v-if="status?.note" class="tn-note chip-warn">
            <AppIcon name="alert" :size="12" />
            {{ status.note }}
          </div>
          <div class="tn-note">退出程序，公网地址立刻不可用。需要长期在线请保持本程序运行。</div>
        </div>
      </section>

      <TunnelServiceDialog
        v-if="dialogRow !== undefined"
        :row="dialogRow"
        :busy="busy"
        :domain="domain"
        :domain-loading="domainLoading"
        :domain-error="domainError"
        @retry-domain="loadDomain(true)"
        @close="dialogRow = undefined"
        @saved="refreshNow"
      />
    </template>
  </div>
</template>

<style scoped>
/* 本页等宽小字与局域网传输页同档：Consolas 优先。
   栈里必须留中文回退：mono 段里夹了中文（如「已校验的 cloudflared」），
   只写 monospace 结尾会让中文落到宋体 */
.content-inner { --font-mono: Consolas, 'Cascadia Mono', 'HarmonyOS Sans SC', 'Microsoft YaHei UI', monospace; }
.mono { font-family: var(--font-mono); }

.toggle-btn.ghost-danger:not(:disabled) {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  box-shadow: none;
}
.toggle-btn.ghost-danger:hover:not(:disabled) {
  background: var(--danger-soft);
  border-color: var(--danger);
  color: var(--danger-hover);
}
.chip-warn-text { color: var(--warning) }
/* 回读失败只说明"这一格这次没读到"，坏消息吃 warn 档，不抢主色的注意 */
.poll-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -6px 0 10px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--warning);
}

/* 诊断卡：标题 + 一行摘要 + 展开钮（行高/内衬走全局 .tn-card 骨架） */
.tn-foot .tn-head { border-bottom: none }
.tn-foot.expanded .tn-head { border-bottom: 1px solid var(--border) }
.diag-summary {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  letter-spacing: 0;
  font-weight: 400;
}
.foot-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  margin-left: 10px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: var(--text-xs);
  cursor: pointer;
}
.foot-btn:hover { color: var(--accent); background: var(--hover) }
.d-btn { margin-left: auto; flex-shrink: 0 }
.txt-warn { color: var(--warning) }
</style>
