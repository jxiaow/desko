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
  void writeClipboardText(`https://${row.hostname}`)
    .then(() => toastStore.showToast(`已复制 https://${row.hostname}`))
    .catch(() => toastStore.showToast('复制失败', 'error'))
}

function remove(row: TunnelServiceRow) {
  menuFor.value = null
  // 删本地这条不会收回公网记录：这句话必须说，否则用户以为地址一起没了
  confirmStore.showConfirm(
    '移除这条服务',
    `移除后 Desko 不再把 ${row.hostname} 指向本机，但那条 DNS 记录还在 Cloudflare 上，地址仍会解析到这里。`,
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
      <span class="svc-name ellipsis">{{ s.label }}</span>
      <span
        class="svc-host mono ellipsis"
        :title="`https://${s.hostname} → 127.0.0.1:${s.port}`"
      >{{ s.hostname }} <i aria-hidden="true">→</i> 127.0.0.1:{{ s.port }}</span>
      <!-- 徽标只报要留意的事：「本机正在监听」是没事，不占位 -->
      <span v-if="!s.routed" class="badge warn">子域没指过来</span>
      <span v-if="!s.listening" class="badge warn">目标端口没在听</span>
      <span v-if="s.preset === 'fileshare' && !s.hasPublicPassword" class="badge warn">公网没设口令</span>
      <span v-else-if="s.preset === 'fileshare' && !s.publicReadOnly" class="badge warn">公网可上传</span>
      <span v-if="s.preset === 'fileshare'" class="badge own">Desko 的服务</span>
      <div class="acts">
        <button class="ib" type="button" title="复制公网地址" @click="copyHost(s)">
          <AppIcon name="copy" :size="13" />
        </button>
        <button class="ib" type="button" title="这条服务的动作" @click="openMenu(s, $event)">
          <AppIcon name="dots" :size="14" />
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
.head-cnt { font-size: var(--text-xs); font-weight: 400; color: var(--text-faint) }
.head-btn { margin-left: auto }
.row-btn { margin-left: auto; flex-shrink: 0 }

.tn-add {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 14px;
  font-size: var(--text-sm);
  color: var(--accent);
  cursor: pointer;
  border-top: 1px solid var(--border);
}
.tn-add:hover { background: var(--hover) }
.tn-add.dim { color: var(--text-muted) }

/* 单行 44：名字 + 等宽「子域 → 本机端口」一条链 + 事实徽标 + 动作 */
.svc-name {
  flex: none;
  max-width: 30%;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text);
}
.svc-host { flex: 1; min-width: 0; font-size: var(--text-xs); font-weight: 400; color: var(--text-url) }
.svc-host i { font-style: normal; color: var(--text-faint); padding: 0 2px }

.acts { display: flex; gap: 2px; flex-shrink: 0; margin-left: auto }
</style>
