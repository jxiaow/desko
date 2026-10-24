<script setup lang="ts">
import { computed } from 'vue'
import type { ProbeReport } from '../../services/api/bypass'
import { useToastStore } from '../../stores/toast'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  report: ProbeReport
  recorded: boolean
  canRecord: boolean
  busy: boolean
  existing: boolean
  canConfigure: boolean
  configureCount: number
}>()
const emit = defineEmits<{ close: []; record: []; configure: []; retry: [] }>()
const toastStore = useToastStore()
useEscapeClose(() => emit('close'))
const verdictClass = (v: string) => v === 'directOk' ? 'ok' : v === 'unreachable' ? 'bad' : 'warn'
const needsConfig = computed(() => ['needRoute', 'hostsOnly'].includes(props.report.verdict))
const needsRetry = computed(() => ['unreachable', 'egressUnknown'].includes(props.report.verdict))
const title = computed(() => props.report.verdict === 'needRoute' ? '当前连接仍经过代理' : props.report.headline)
const summary = computed(() => {
  const r = props.report
  if (r.verdict === 'needRoute') {
    const egress = r.egress?.interface || '代理接口'
    const connection = r.target.kind === 'cidr' ? `该网段的出口由 ${egress} 接管。`
      : r.probeMs != null ? `目标可连接，出口仍由 ${egress} 接管。`
      : `出口由 ${egress} 接管，端口连通性未确认。`
    return `${connection}需配置系统路由以实现直连。`
  }
  if (r.verdict === 'hostsOnly') return `需要将域名解析到实际地址 ${r.chosen || r.realIps[0] || '（未确定）'}，才能使用直连出口。`
  if (r.verdict === 'unreachable') return '未连接到目标服务。请核对地址、端口和服务状态后重新探测。'
  if (r.verdict === 'egressUnknown') return '无法确定出口接口，暂不能生成直连方案。请检查网络或代理状态后重新探测。'
  if (r.target.kind === 'cidr') return '该网段的出口可直连，未逐一检查网段内的服务。'
  if (r.probeMs == null) return '出口可直连，但服务端口连接失败。请检查服务状态或端口。'
  return '当前出口可直连，无需新增 hosts 或路由配置。'
})
const nextSteps = computed(() => {
  if (!needsConfig.value) return []
  const steps = props.recorded ? [] : [`先${props.existing ? '更新清单' : '加入清单'}。`]
  steps.push('确认「配置直连」方案并允许管理员授权，完成后自动复验。')
  steps.push('使用代理时，将目标设为直连（DIRECT），再重新探测。')
  return steps
})
const extraPending = computed(() => props.report.pending.filter(text =>
  text !== '配置后，如使用代理客户端，还需将该目标加入其直连规则。'))

async function copyDirectTarget() {
  try {
    const r = props.report
    await navigator.clipboard.writeText(r.target.kind === 'cidr' ? r.input : r.target.host)
    toastStore.showToast('直连目标已复制，请添加到代理客户端的直连规则')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

const addrOf = (r: ProbeReport) => {
  if (r.target.kind === 'cidr') return r.input
  const suffix = r.target.path && r.target.path !== '/' ? r.target.path : ''
  return `${r.target.host}:${r.target.port}${suffix}`
}

const answersOf = (r: ProbeReport) => {
  if (r.target.kind !== 'domain') return 'IP 和网段无需 DNS 解析'
  return r.localAnswers.length
    ? r.localAnswers.join('  ') + (r.hijacked ? '（代理返回的虚拟地址）' : '')
    : '未解析到地址'
}

const realOf = (r: ProbeReport) => {
  if (r.target.kind === 'cidr') return r.target.host
  return r.realIps.length
    ? r.realIps.join('  ') + (r.cdnLike ? '（地址可能变化）' : '')
    : '未解析到实际地址'
}

const pinnedOf = (r: ProbeReport) => {
  if (r.target.kind !== 'domain') return 'IP 和网段无需 hosts 记录'
  return r.pinned ? r.pinned + (r.stale ? '（当前无法连接）' : '') : '无记录'
}

const egressOf = (r: ProbeReport) => {
  const e = r.egress
  if (!e) return '未查询到出口路由'
  return `${e.interface}${e.isTaker ? '（代理接口）' : ''} · 源地址 ${e.source} · 网关 ${e.nextHop}`
}

const probeOf = (r: ProbeReport) => {
  if (r.target.kind === 'cidr') return '按出口路由判断，未检查网段内的具体服务'
  if (r.target.kind === 'ip' && r.probeMs == null) return 'TCP 连接失败，路由判定不依赖端口连通性'
  if (r.probeMs == null) return '连接失败'
  return r.httpStatus ? `HTTP ${r.httpStatus} · ${r.probeMs}ms` : `TCP 连接成功 · ${r.probeMs}ms`
}

async function copyConclusion() {
  const r = props.report
  if (!r) return
  const text = [
    `${addrOf(r)}　${r.headline}`,
    summary.value,
    ...nextSteps.value.map((step, index) => `${index + 1}. ${step}`),
    r.detail,
    `系统解析：${answersOf(r)}`,
    `实际地址：${realOf(r)}`,
    `hosts 记录：${pinnedOf(r)}`,
    `出口路由：${egressOf(r)}`,
    `连通性：${probeOf(r)}`,
    ...r.pending.map((p) => `注意：${p}`),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toastStore.showToast('结论已复制到剪贴板')
  } catch {
    toastStore.showToast('复制失败', 'error')
  }
}

</script>

<template>
    <!-- 探测结论：新开一只弹窗，页面上不留常驻结论位 -->
    <div class="dialog-overlay" @click.self="emit('close')">
      <div class="dialog concl-dialog" role="dialog" aria-modal="true" aria-label="探测结论">
        <div class="dialog-header">
          <h3>探测结论</h3>
          <button class="dialog-close" type="button" :disabled="busy" title="关闭" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <div class="concl-head">
            <AppIcon :name="report.verdict === 'directOk' ? 'check' : 'alert'" :size="18" :class="verdictClass(report.verdict)" />
            <span class="concl-title">{{ title }}</span>
          </div>
          <p class="concl-target mono">{{ addrOf(report) }}</p>
          <p class="concl-summary">{{ summary }}</p>
          <div v-if="nextSteps.length" class="concl-next">
            <h4>下一步</h4>
            <ol><li v-for="step in nextSteps" :key="step">{{ step }}</li></ol>
            <p v-if="recorded" class="concl-saved">结果已保存</p>
            <p v-if="canConfigure && configureCount > 1" class="concl-scope">方案包含清单中 {{ configureCount }} 个待配置目标，请核对。</p>
          </div>
          <ul v-if="extraPending.length" class="concl-pending">
            <li v-for="(p, i) in extraPending" :key="i">
              <AppIcon name="alert" :size="13" /><span>{{ p }}</span>
            </li>
          </ul>
          <details class="concl-technical">
            <summary>技术详情</summary>
            <p class="concl-detail">{{ report.detail }}</p>
          <dl class="concl-facts">
            <div v-if="report.target.kind === 'domain'"><dt>系统解析</dt><dd class="mono">{{ answersOf(report) }}</dd></div>
            <div><dt>实际地址</dt><dd class="mono">{{ realOf(report) }}</dd></div>
            <div v-if="report.target.kind === 'domain'"><dt>hosts 记录</dt><dd class="mono">{{ pinnedOf(report) }}</dd></div>
            <div><dt>出口路由</dt><dd>{{ egressOf(report) }}</dd></div>
            <div><dt>连通性</dt><dd class="mono">{{ probeOf(report) }}</dd></div>
          </dl>
            <button class="btn-secondary concl-copy" type="button" @click="copyConclusion"><AppIcon name="copy" :size="13" />复制结论</button>
          </details>
        </div>
        <div class="dialog-footer">
          <button v-if="needsConfig" class="btn-secondary" type="button" @click="copyDirectTarget">复制直连目标</button>
          <button class="btn-secondary" type="button" :disabled="busy" @click="emit('close')">关闭</button>
          <button v-if="needsRetry" class="btn-secondary" type="button" :disabled="busy" @click="emit('retry')">重新探测</button>
          <button
            v-if="!recorded"
            class="btn-primary"
            type="button"
            :disabled="!canRecord || busy"
            @click="emit('record')"
          >
            {{ existing ? '更新清单' : '加入清单' }}
          </button>
          <button v-else-if="canConfigure" class="btn-primary" type="button" :disabled="busy" @click="emit('configure')">
            配置直连{{ configureCount > 1 ? ` ${configureCount}` : '' }}
          </button>
        </div>
      </div>
    </div>

</template>

<style scoped>
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
/* 结论走全站统一弹窗壳：弹窗本身就是那张卡，里面不再套一层 */
.concl-dialog { width: 520px; }
.concl-head { display: flex; align-items: center; gap: var(--space-3); }
.concl-head .ok { color: var(--success); }
.concl-head .warn { color: var(--warning); }
.concl-head .bad { color: var(--danger); }
.concl-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text);
}
.concl-target {
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.concl-summary, .concl-detail {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  line-height: 1.65;
  color: var(--text-secondary);
}
.concl-next { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border); }
.concl-next h4 { margin: 0; font-size: var(--text-sm); color: var(--text); }
.concl-next ol { margin: var(--space-2) 0 0; padding-left: 20px; font-size: var(--text-sm); line-height: 1.65; color: var(--text-secondary); }
.concl-next li + li { margin-top: 6px; }
.concl-saved, .concl-scope { margin: var(--space-2) 0 0; font-size: var(--text-xs); line-height: 1.6; color: var(--text-muted); }
.concl-technical { margin-top: var(--space-4); padding-top: var(--space-3); border-top: 1px solid var(--border); }
.concl-technical summary { cursor: pointer; font-size: var(--text-xs); color: var(--text-muted); }
.concl-copy { margin-top: var(--space-3); }

.concl-facts {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: var(--space-4) 0 0;
  padding: var(--space-3) 0 0;
  border-top: 1px solid var(--border);
}
.concl-facts > div { display: flex; align-items: baseline; gap: var(--space-3); }
.concl-facts dt { flex: 0 0 64px; font-size: var(--text-xs); color: var(--text-muted); }
.concl-facts dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.concl-pending {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: var(--space-3) 0 0;
  padding: var(--space-3) 0 0;
  border-top: 1px dashed var(--border-subtle);
  list-style: none;
}
.concl-pending li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  font-size: var(--text-xs);
  line-height: 1.55;
  color: var(--warning);
}
.concl-pending li svg { flex-shrink: 0; margin-top: 2px; }

</style>
