<script setup lang="ts">
import { computed, ref } from 'vue'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelServiceRow } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import { writeClipboardText } from '../../utils/clipboard'
import PopoverMenu from '../shared/PopoverMenu.vue'

const props = defineProps<{
  services: TunnelServiceRow[]
  /** 本机有隧道才谈得上挂服务：没有就只读着空表，不给「应用」出口 */
  hasTunnel: boolean
  busy: boolean
}>()
const emit = defineEmits<{
  refresh: []
  add: []
  edit: [TunnelServiceRow]
}>()

const toastStore = useToastStore()
const confirmStore = useConfirmStore()

const acting = ref(false)
const actionError = ref('')
const menuFor = ref<TunnelServiceRow | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)

const unrouted = computed(() => props.services.filter((s) => !s.routed))
const dead = computed(() => props.services.filter((s) => !s.listening))
const needsPassword = computed(() => props.services.filter((s) => s.preset === 'fileshare' && !s.hasPublicPassword))

function serviceState(row: TunnelServiceRow) {
  if (!row.routed) return '待应用'
  if (!row.listening) return '端口未监听'
  if (row.preset === 'fileshare' && !row.hasPublicPassword) return '待设置口令'
  return '已就绪'
}

function serviceHint(row: TunnelServiceRow) {
  if (!row.routed) return '域名待应用'
  if (!row.listening) return '目标端口未监听'
  if (row.preset === 'fileshare' && !row.hasPublicPassword) return '公网未设口令'
  if (row.preset === 'fileshare') return row.publicReadOnly ? '口令保护 · 只读' : '口令保护 · 公网可上传'
  return '访问权限由原服务管理'
}

function openMenu(row: TunnelServiceRow, ev: Event) {
  menuFor.value = row
  menuAnchor.value = ev.currentTarget as HTMLElement
}

/** 弹窗压在菜单上面留着一张开着的菜单，关掉才算这一格做完 */
function openEditor(row: TunnelServiceRow) {
  menuFor.value = null
  emit('edit', row)
}

async function run<T>(fn: () => Promise<T>, done: (value: T) => string) {
  if (acting.value || props.busy) return
  acting.value = true
  actionError.value = ''
  try {
    const value = await fn()
    toastStore.showToast(done(value))
  } catch (e) {
    actionError.value = errText(e)
    toastStore.showToast(actionError.value, 'error')
  } finally {
    acting.value = false
    emit('refresh')
  }
}

function apply() {
  void run(() => tunnelApi.apply(), (p) => p.message)
}

function copyHost(row: TunnelServiceRow) {
  void writeClipboardText(`https://${row.hostname}`)
    .then(() => toastStore.showToast(`已复制 https://${row.hostname}`))
    .catch(() => toastStore.showToast('复制失败', 'error'))
}

function remove(row: TunnelServiceRow) {
  menuFor.value = null
  // 删本地这条不会收回公网记录：这句话必须说，否则用户以为地址一起没了
  confirmStore.showConfirm(
    '移除服务',
    `停止转发 ${row.hostname} 到本机？Cloudflare 的 DNS 记录会保留，仍指向此隧道。`,
    () => void run(() => tunnelApi.removeService(row.id), () => '服务已移除'),
  )
}
</script>

<template>
  <section class="tn-card services">
    <div class="tn-head">
      <div class="section-heading">
        <h2>公网服务 <span class="head-cnt">{{ services.length }}</span></h2>
        <p>将本机 HTTP 服务连接到公网，随隧道统一起停。</p>
      </div>
      <button class="btn-secondary head-btn" type="button" :disabled="busy || acting" @click="emit('add')">
        <AppIcon name="plus" :size="12" />
        添加服务
      </button>
    </div>

    <div v-if="!services.length" class="services-empty">
      <h3>添加第一个公网服务</h3>
      <p>为本机端口分配一个域名，即可通过 HTTPS 访问。</p>
      <button class="tn-add btn-secondary" type="button" :disabled="busy || acting" @click="emit('add')">
        <AppIcon name="plus" :size="15" />
        添加服务
      </button>
      <span v-if="!hasTunnel" class="empty-hint">可以先保存服务，完成接入准备后再应用。</span>
    </div>

    <div v-if="services.length" class="service-columns" aria-hidden="true">
      <span>服务</span><span>公网地址 / 本机目标</span><span>配置状态</span><span></span>
    </div>
    <div v-for="s in services" :key="s.id" class="tn-row svc-row">
      <div class="svc-identity">
        <span class="svc-name" :title="s.label">{{ s.label }}</span>
        <span class="svc-kind">{{ s.preset === 'fileshare' ? 'Desko 服务' : '本机 HTTP 服务' }}</span>
      </div>
      <div class="svc-route">
        <span class="svc-host" :title="`https://${s.hostname}`">{{ s.hostname }}</span>
        <span class="svc-target"><AppIcon name="arrowRight" :size="13" /><span>127.0.0.1:{{ s.port }}</span></span>
      </div>
      <div class="svc-status">
        <span class="service-state" :class="{ attention: !s.routed || !s.listening || (s.preset === 'fileshare' && !s.hasPublicPassword) }">
          <span class="state-dot" aria-hidden="true"></span>{{ serviceState(s) }}
        </span>
        <span v-if="serviceHint(s) !== '公网未设口令'" class="svc-hint">{{ serviceHint(s) }}</span>
        <button v-if="s.preset === 'fileshare' && !s.hasPublicPassword" class="policy-action" type="button" :disabled="busy || acting" @click="openEditor(s)">公网未设口令 · 设置</button>
        <span v-if="!s.routed && !s.listening" class="svc-hint">目标端口未监听</span>
      </div>
      <div class="acts">
        <button class="ib" type="button" title="复制公网地址" :aria-label="`复制 ${s.label} 的公网地址`" @click="copyHost(s)">
          <AppIcon name="copy" :size="15" />
        </button>
        <button class="ib" type="button" title="更多操作" :aria-label="`${s.label} 的更多操作`" aria-haspopup="menu" :aria-expanded="menuFor?.id === s.id" :disabled="busy || acting" @click="openMenu(s, $event)">
          <AppIcon name="dots" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="services.length" class="tn-row foot-row">
      <span class="tn-value" aria-live="polite">
        <template v-if="unrouted.length">{{ unrouted.length }} 个域名待应用</template>
        <template v-else-if="dead.length">{{ dead.length }} 个服务端口未监听，暂无法访问</template>
        <template v-else-if="needsPassword.length">{{ needsPassword.length }} 条服务尚未设置公网口令</template>
        <template v-else>所有域名已应用</template>
      </span>
      <button
        v-if="unrouted.length"
        class="btn-primary row-btn"
        type="button"
        :disabled="busy || acting || !hasTunnel"
        :title="hasTunnel ? '' : '请先创建隧道'"
        @click="apply"
      >
        {{ acting ? '应用中…' : '应用' }}
      </button>
    </div>
    <div v-if="actionError" class="service-error" role="alert">
      <AppIcon name="alert" :size="15" /><span>{{ actionError }}</span>
    </div>

    <PopoverMenu v-if="menuFor" :anchor="menuAnchor" :width="148" @close="menuFor = null">
      <button class="pop-item" type="button" @click="openEditor(menuFor!)">
        <AppIcon name="edit" :size="14" />
        公网设置
      </button>
      <button
        class="pop-item"
        type="button"
        :disabled="busy || acting || !hasTunnel"
        @click="menuFor = null; apply()"
      >
        <AppIcon name="external" :size="14" />
        重新登记子域
      </button>
      <span class="pop-sep"></span>
      <button class="pop-item danger" type="button" @click="remove(menuFor!)">
        <AppIcon name="trash" :size="14" />
        移除服务
      </button>
    </PopoverMenu>
  </section>
</template>

<style scoped>
.services .tn-head { height: auto; min-height: 88px; padding: 20px; gap: 16px; border-bottom: 0; }
.section-heading { min-width: 0; }
.section-heading h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: var(--text-base); line-height: 20px; font-weight: 600; }
.head-cnt { font-size: var(--text-xs); font-weight: 500; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.section-heading p { margin: 5px 0 0; font-size: var(--text-sm); font-weight: 400; line-height: 20px; color: var(--text-secondary); }
.head-btn { margin-left: auto; flex-shrink: 0; height: 32px; font-size: var(--text-sm); }
/* 4 tracks + 3 × 20px gaps + 2 × 20px padding = the full panel width. */
.service-columns, .services .svc-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(180px, 1.6fr) minmax(144px, 1.1fr) 64px; gap: 20px; padding-inline: 20px; }
.service-columns { padding-block: 8px 12px; font-size: var(--text-xs); line-height: 18px; color: var(--text-secondary); }
.services .svc-row { height: auto; min-height: 82px; padding-block: 16px; border-top: 1px solid var(--border); }
.svc-identity, .svc-route, .svc-status { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 6px; }
.svc-name { max-width: 100%; font-size: var(--text-base); line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
.svc-kind, .svc-target, .svc-hint { font-size: var(--text-xs); line-height: 18px; color: var(--text-secondary); }
.svc-host { max-width: 100%; font-size: var(--text-base); line-height: 20px; color: var(--text); overflow-wrap: anywhere; }
.svc-target { display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
.service-state { display: inline-flex; align-items: center; gap: 7px; font-size: var(--text-sm); line-height: 20px; white-space: nowrap; }
.state-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--success); }
.attention .state-dot { background: var(--warning); }
.policy-action { padding: 0; border: 0; background: none; color: var(--text); font-size: var(--text-xs); line-height: 18px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; text-align: left; }
.policy-action:hover { color: var(--text-brand); }
.acts { display: flex; gap: 4px; justify-content: flex-end; }
.acts .ib { width: 30px; height: 32px; flex: none; color: var(--text-secondary); }
.services .foot-row { height: auto; min-height: 56px; padding: 12px 20px; gap: 16px; }
.foot-row .tn-value { font-size: var(--text-sm); line-height: 20px; color: var(--text-secondary); }
.row-btn { margin-left: auto; flex-shrink: 0; height: 32px; }
.services-empty { display: flex; flex-direction: column; align-items: flex-start; padding: 28px 20px 36px; border-top: 1px solid var(--border); }
.services-empty h3 { margin: 0; font-size: var(--text-lg); line-height: 24px; font-weight: 500; }
.services-empty p { margin: 8px 0 20px; font-size: var(--text-sm); line-height: 22px; color: var(--text-secondary); }
.services-empty .tn-add { min-height: 36px; padding-inline: 12px; background: var(--fill); border: 1px solid var(--border-strong); color: var(--text); font-size: var(--text-sm); }
.empty-hint { margin-top: 12px; font-size: var(--text-xs); line-height: 20px; color: var(--text-secondary); }
.service-error { display: flex; align-items: flex-start; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); font-size: var(--text-sm); line-height: 20px; color: var(--text); overflow-wrap: anywhere; }
.service-error > svg { flex: none; margin-top: 2px; color: var(--danger); }
@media (max-width: 1000px) {
  .service-columns, .services .svc-row { grid-template-columns: minmax(90px, 0.85fr) minmax(144px, 1.3fr) minmax(116px, 1fr) 64px; gap: 12px; }
}
@media (max-width: 700px) {
  .services .tn-head { display: grid; grid-template-columns: 1fr auto; padding: 16px; min-height: 88px; gap: 8px 12px; }
  .section-heading { display: contents; }
  .section-heading h2 { grid-column: 1; grid-row: 1; }
  .section-heading p { grid-column: 1 / -1; grid-row: 2; max-width: 26em; margin: 0; font-size: var(--text-sm); }
  .head-btn { grid-column: 2; grid-row: 1; }
  .service-columns { display: none; }
  .services .svc-row { grid-template-columns: minmax(0, 1fr) auto; gap: 10px 12px; padding: 18px 16px; }
  .svc-identity { grid-column: 1; grid-row: 1; }
  .svc-route { grid-column: 1 / -1; grid-row: 2; }
  .svc-status { grid-column: 1 / -1; grid-row: 3; flex-direction: row; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
  .acts { grid-column: 2; grid-row: 1; align-self: start; }
  .acts .ib { width: 36px; height: 40px; }
  .services .foot-row { padding: 12px 16px; }
  .services-empty { padding: 24px 16px; }
  .policy-action { min-height: 32px; }
}
@media (max-width: 480px) {
  .services .tn-head { flex-wrap: wrap; gap: 12px; }
  .section-heading { flex: 1 1 170px; }
  .head-btn { min-height: 40px; }
  .services .foot-row .row-btn, .services-empty .tn-add { min-height: 44px; }
}
</style>
