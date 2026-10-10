<script setup lang="ts">
import { computed, ref } from 'vue'
import { tunnelApi } from '../../services/api/tunnel'
import type { TunnelServiceRow } from '../../services/api/tunnel'
import { errText } from '../../services/api/backup'
import { useConfirmStore } from '../../stores/confirm'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
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
const menuFor = ref<TunnelServiceRow | null>(null)
const menuAnchor = ref<HTMLElement | null>(null)

const unrouted = computed(() => props.services.filter((s) => !s.routed))
const dead = computed(() => props.services.filter((s) => !s.listening))

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
  try {
    const value = await fn()
    toastStore.showToast(done(value))
  } catch (e) {
    toastStore.showToast(errText(e), 'error')
  } finally {
    acting.value = false
    emit('refresh')
  }
}

function apply() {
  void run(() => tunnelApi.apply(), (p) => p.message)
}

function copyHost(row: TunnelServiceRow) {
  void navigator.clipboard
    .writeText(`https://${row.hostname}`)
    .then(() => toastStore.showToast(`已复制 https://${row.hostname}`))
    .catch(() => toastStore.showToast('复制失败', 'error'))
}

function remove(row: TunnelServiceRow) {
  menuFor.value = null
  // 删本地这条不会收回公网记录：这句话必须说，否则用户以为地址一起没了
  confirmStore.showConfirm(
    '移除这条服务',
    `移除后 desko 不再把 ${row.hostname} 指向本机，但那条 DNS 记录还在 Cloudflare 上，地址仍会解析到这里。`,
    () => void run(() => tunnelApi.removeService(row.id), () => '已移除这条服务'),
  )
}
</script>

<template>
  <section class="tn-card services">
    <div class="tn-head">
      <span>公网服务</span>
      <span class="head-cnt">{{ services.length }} 条 · 随隧道一起起停</span>
      <button class="btn-secondary head-btn" type="button" :disabled="busy || acting" @click="emit('add')">
        <AppIcon name="plus" :size="12" />
        添加
      </button>
    </div>

    <div v-if="!services.length" class="tn-add" :class="{ dim: !hasTunnel }" @click="emit('add')">
      <AppIcon name="plus" :size="13" />
      添加一项本地服务
    </div>

    <div v-for="s in services" :key="s.id" class="tn-row svc-row">
      <div class="svc">
        <div class="svc-l1">
          <span class="svc-name ellipsis">{{ s.label }}</span>
          <span class="svc-host mono ellipsis" :title="`https://${s.hostname}`">{{ s.hostname }}</span>
        </div>
        <div class="svc-l2">
          <code class="mono">127.0.0.1:{{ s.port }}</code>
          <span v-if="!s.routed" class="badge warn">子域没指过来</span>
          <span v-if="!s.listening" class="badge warn">目标端口没在听</span>
          <span v-else class="badge">本机正在监听</span>
          <span v-if="s.preset === 'fileshare'" class="badge own">desko 的服务</span>
          <!-- 有口令且只读是安全默认态，不占徽标；只把要留意的那两件事说出口 -->
          <span v-if="s.preset === 'fileshare' && !s.hasPublicPassword" class="badge warn">公网没设口令</span>
          <span v-else-if="s.preset === 'fileshare' && !s.publicReadOnly" class="badge warn">公网可上传</span>
        </div>
      </div>
      <div class="acts">
        <button class="action-btn ghost" type="button" title="复制公网地址" @click="copyHost(s)">
          <AppIcon name="copy" :size="12" />
        </button>
        <button class="action-btn ghost" type="button" title="这条服务的动作" @click="openMenu(s, $event)">
          <AppIcon name="dots" :size="13" />
        </button>
      </div>
    </div>

    <div v-if="services.length" class="tn-row foot-row">
      <span class="tn-value">
        <template v-if="unrouted.length">{{ unrouted.length }} 条子域还没指过来</template>
        <template v-else-if="dead.length">{{ dead.length }} 条的目标端口此刻没在听，公网访问会失败</template>
        <template v-else>每条子域都已指到这条隧道</template>
      </span>
      <button
        v-if="unrouted.length"
        class="btn-primary row-btn"
        type="button"
        :disabled="busy || acting || !hasTunnel"
        :title="hasTunnel ? '' : '先建一条隧道'"
        @click="apply"
      >
        应用
      </button>
    </div>

    <PopoverMenu v-if="menuFor" :anchor="menuAnchor" :width="148" @close="menuFor = null">
      <button class="pop-item" type="button" @click="openEditor(menuFor!)">
        <AppIcon name="edit" :size="14" />
        改公网设置
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
        移除这条
      </button>
    </PopoverMenu>
  </section>
</template>

<style scoped>
/* --font-mono 由页面在 .content-inner 上覆盖，变量能穿过组件边界 */
.mono { font-family: var(--font-mono); }
.head-cnt { margin-left: 8px; font-size: var(--text-xs); color: var(--text-muted) }
.head-btn { margin-left: auto }
.row-btn { margin-left: auto; flex-shrink: 0 }

.tn-add {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 16px;
  font-size: var(--text-sm);
  color: var(--accent);
  cursor: pointer;
}
.tn-add:hover { background: var(--hover) }
.tn-add.dim { color: var(--text-muted) }

/* 56px 两行：上行名字 + 子域，下行本机端口 + 事实徽标 */
.svc-row { height: 56px }
.svc { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px }
.svc-l1 { display: flex; align-items: baseline; gap: 10px; min-width: 0 }
.svc-name { font-size: var(--text-base); font-weight: 600; color: var(--text) }
.svc-host { font-size: var(--text-xs); color: var(--text-muted) }
.svc-l2 { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: var(--text-xs); color: var(--text-muted) }
.svc-l2 code { font-size: var(--text-xs); color: var(--text-muted) }
.badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
}
.badge.warn { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 32%, transparent); color: var(--warning) }
.badge.own { background: var(--accent-soft); border-color: transparent; color: var(--accent) }

.acts { display: flex; gap: 2px; flex-shrink: 0; margin-left: auto }
.foot-row { border-top: 1px solid var(--border) }
</style>
