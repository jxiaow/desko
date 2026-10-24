<script setup lang="ts">
import { computed } from 'vue'
import type { ApplyOutcome, ApplyPlan, BypassTarget, RouteOverride } from '../../services/api/bypass'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{
  plan: ApplyPlan | null
  planOpen: boolean
  busyPlan: boolean
  busy: boolean
  applyResult: ApplyOutcome | null
  rollbackBatch: string
  targets: BypassTarget[]
  allowCdn: string[]
  routeOverrides: RouteOverride[]
}>()
const emit = defineEmits<{ closePlan: []; closeResult: []; apply: []; cdn: [id: string]; route: [id: string, value: string]; revert: [] }>()
useEscapeClose(() => emit('closePlan'), () => props.planOpen)
useEscapeClose(() => emit('closeResult'), () => !!props.applyResult)
const isCdnRow = (id: string) => props.targets.some((t) => t.id === id && t.cdnLike)
const cdnPinned = (id: string) => props.allowCdn.includes(id)
const cdnAddress = (id: string) => props.targets.find((t) => t.id === id)?.address || '尚未确定'
const needsRouteHelp = computed(() => props.plan?.rows.some((r) => r.blockedReason === 'noDirectRoute' && !r.routeOptions?.length))
function routeValue(id: string) {
  const choice = props.routeOverrides.find((r) => r.id === id)
  return choice ? `${choice.interfaceIndex}|${choice.gateway}` : ''
}

const resultSummary = computed(() => {
  const items = props.applyResult?.items ?? []
  return {
    ok: items.filter((i) => i.ok && i.changed).length,
    skip: items.filter((i) => i.ok && !i.changed).length,
    bad: items.filter((i) => !i.ok).length,
  }
})

const opLabel = (op: string) => (op === 'pin' ? 'hosts 固定' : '系统路由')

/** 回滚自己没成时写进去的东西还在原地，批次留着让人再撤；回滚成了这些行就不算写过 */
const rolledBackClean = computed(
  () => !!props.applyResult?.rolledBack && !props.applyResult.error,
)

function rowLabelOf(id: string) {
  const t = props.targets.find((x) => x.id === id)
  return t ? t.host : id
}

</script>

<template>
    <!-- 写入确认：逐条念「要往系统里动什么」，账对得上才提权，一批共用一次 UAC -->
    <div v-if="planOpen && plan" class="dialog-overlay" @click.self="emit('closePlan')">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="配置确认">
        <div class="dialog-header">
          <h3>确认直连配置</h3>
          <span v-if="plan.blocked" class="plan-blocked">{{ plan.blocked }} 项暂不配置</span>
          <button class="dialog-close" type="button" title="关闭" @click="emit('closePlan')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <p v-if="plan.ready" class="lead">将为 {{ plan.ready }} 个目标更新 hosts 或持久路由，其余目标保持不变。</p>
          <p v-else class="lead">暂无可配置的目标，请处理以下问题后重试。</p>
          <p v-if="busyPlan" role="status">正在更新配置方案…</p>
          <ul class="plan-list plan-preview">
            <li v-for="(r, i) in plan.rows" :key="`${r.id}-${i}`" :class="{ blocked: !!r.blocked }">
              <span class="plan-host mono">{{ r.label }}</span>
              <div class="plan-content">
                <span class="plan-action">{{ r.blocked || r.action }}</span>
                <label v-if="r.routeOptions?.length" class="plan-route">
                  <span>直连出口</span>
                  <select :value="routeValue(r.id)" :disabled="busyPlan" @change="emit('route', r.id, ($event.target as HTMLSelectElement).value)">
                    <option value="">自动选择</option>
                    <option v-for="option in r.routeOptions" :key="`${option.interfaceIndex}|${option.gateway}`" :value="`${option.interfaceIndex}|${option.gateway}`">
                      {{ option.interfaceAlias }} · {{ option.gatewayIsOnLink ? '同网段直连（无网关）' : option.gateway }}
                    </option>
                  </select>
                </label>
                <p v-if="r.blocked && r.routeOptions?.length" class="plan-route-hint">选择可访问此地址的局域网或 VPN。</p>
                <div v-if="isCdnRow(r.id) && (i === 0 || plan.rows[i - 1].id !== r.id)" class="plan-cdn-choice">
                  <label class="plan-cdn">
                    <input type="checkbox" :checked="cdnPinned(r.id)" :disabled="busyPlan" @change="emit('cdn', r.id)" />
                    <span>同意固定当前 IP（<span class="mono">{{ cdnAddress(r.id) }}</span>）</span>
                  </label>
              <p class="plan-cdn-hint">仍需通过直连出口检查；IP 变化后需重新探测并配置。</p>
                </div>
              </div>
            </li>
          </ul>
          <section v-if="needsRouteHelp" class="plan-help" aria-label="直连出口处理指引">
            <h4>如何处理直连出口</h4>
            <p>未找到可用出口，请检查网络或代理规则。</p>
            <ol>
              <li>按 <kbd>Win + R</kbd>，输入 <code>ncpa.cpl</code>，检查以太网、Wi-Fi 或所需内网 VPN 是否连接。</li>
              <li>在代理客户端将目标设为直连（DIRECT）；访问内网仍需连接对应网络或 VPN。</li>
              <li>调整后点击「检查全部」，再打开「配置直连」。仍失败时请检查该网段的路由。</li>
            </ol>
          </section>
        </div>
        <div class="dialog-footer">
          <div v-if="plan.ready" class="footer-hints">
            <AppIcon name="lock" :size="12" />
            <span>配置需要 Windows 管理员授权</span>
          </div>
          <button class="btn-secondary" type="button" @click="emit('closePlan')">取消</button>
          <button class="btn-primary" type="button" :disabled="busyPlan || plan.ready === 0" @click="emit('apply')">
            确认并配置
          </button>
        </div>
      </div>
    </div>

    <!-- 结果弹窗只在有账要交的时候出：全成功走 toast，不拦人 -->
    <div v-if="applyResult" class="dialog-overlay" @click.self="emit('closeResult')">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="配置结果">
        <div class="dialog-header">
          <h3>配置结果</h3>
          <button class="dialog-close" type="button" title="关闭" @click="emit('closeResult')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="dialog-body">
          <p class="lead">
            成功 {{ resultSummary.ok }} · 无需更改 {{ resultSummary.skip }} · 失败 {{ resultSummary.bad }}（按操作计）
          </p>
          <p v-if="applyResult.rolledBack" class="dialog-err">
            <template v-if="rolledBackClean">校验失败，本次更改已撤销。</template>
            <template v-else
              >自动撤销未完成，系统可能保留部分更改。请重试「撤销本次配置」。原因：{{
                applyResult.error
              }}</template
            >
          </p>
          <p v-else-if="applyResult.error" class="dialog-err">{{ applyResult.error }}</p>
          <ul class="plan-list">
            <li v-for="i in applyResult.items" :key="`${i.op}-${i.id}`" :class="{ blocked: !i.ok }">
              <span class="plan-host mono">{{ rowLabelOf(i.id) }}</span>
              <span class="plan-action">
                {{ opLabel(i.op) }}{{ i.ok ? (i.changed ? (rolledBackClean ? ' · 已撤销' : ' · 已配置') : ' · 已存在，无需更改') : ` · ${i.error}` }}
              </span>
            </li>
          </ul>
        </div>
        <div class="dialog-footer">
          <div class="footer-hints">
            <span class="kbd">Esc</span><span>关闭</span>
          </div>
          <button
            v-if="rollbackBatch && rollbackBatch === applyResult.batchId"
            class="btn-secondary"
            type="button"
            :disabled="busy"
            @click="emit('revert')"
          >
            撤销本次配置
          </button>
          <button class="btn-primary" type="button" @click="emit('closeResult')">完成</button>
        </div>
      </div>
    </div>

</template>

<style scoped>
/* 写入确认与结果共用同一份两行列法：目标在左、要写的动作或原因在右 */
.plan-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}
.plan-list li {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.55;
}
.plan-host {
  flex: 0 1 42%;
  min-width: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}
.plan-action {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.plan-list li.blocked .plan-action {
  color: var(--warning);
}
.plan-preview li { padding: 7px 0; }
.plan-preview .plan-host { flex-basis: 32%; }
.plan-content { flex: 1; min-width: 0; }
.plan-content > .plan-action { display: block; }
.plan-route { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; color: var(--text-muted); }
.plan-route select { width: 100%; min-width: 0; height: 30px; padding: 0 7px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-surface); color: var(--text); font: inherit; }
.plan-route-hint { margin: 5px 0 0; color: var(--text-muted); }
.plan-cdn-choice { margin-top: 7px; }
.plan-cdn {
  display: inline-flex;
  align-self: center;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  font-size: var(--text-xs);
  color: var(--text);
  cursor: pointer;
}
.plan-cdn-hint {
  margin: 5px 0 0;
  color: var(--text-muted);
}
.plan-help {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--border);
  font-size: var(--text-xs);
  line-height: 1.7;
  color: var(--text-muted);
}
.plan-help h4 { margin: 0 0 6px; font-size: inherit; font-weight: 600; color: var(--text); }
.plan-help p { margin: 0; }
.plan-help ol { margin: 8px 0 0; padding-left: 20px; }
.plan-help li + li { margin-top: 6px; }
.plan-help :is(kbd, code) { font-family: var(--font-mono); color: var(--text); }
/* 头栏右侧那一格计数：说清有几条这轮不写 */
.plan-blocked {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  color: var(--warning);
}

.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: normal; }
</style>
