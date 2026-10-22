<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { webAccessApi, type WebAccessStatus } from '../../services/api/webAccess'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { writeClipboardText } from '../../utils/clipboard'
import AppIcon from '../shared/AppIcon.vue'

const status = ref<WebAccessStatus>({ running: false, lan: false, port: 8420, urls: [] })
const port = ref(8420)
const lan = ref(false)
const busy = ref(false)
const failure = ref('')
const toast = useToastStore()
const confirm = useConfirmStore()
let active = true
let statusGeneration = 0
let poll: ReturnType<typeof setInterval> | undefined
async function refresh() {
  const epoch = ++statusGeneration
  try {
    const next = await webAccessApi.status()
    if (active && epoch === statusGeneration) { status.value = next; failure.value = '' }
  } catch (e) { if (active && epoch === statusGeneration) failure.value = String(e) }
}
async function start(input: { port: number; lan: boolean }) {
  if (!active || busy.value) return
  statusGeneration++
  busy.value = true
  failure.value = ''
  try {
    const next = await webAccessApi.start(input)
    if (active) { status.value = next; toast.showToast('Web 服务已启动') }
  } catch (e) { if (active) failure.value = String(e) }
  finally { if (active) busy.value = false }
}
async function stop() {
  if (!active || busy.value) return
  statusGeneration++
  busy.value = true
  failure.value = ''
  try { await webAccessApi.stop(); if (active) { await refresh(); if (active) toast.showToast('Web 服务已停止，浏览器会话已退出') } }
  catch (e) { if (active) failure.value = String(e) }
  finally { if (active) busy.value = false }
}
function requestStop() {
  if (!active || busy.value) return
  confirm.showConfirm('停止 Web 服务？', '所有浏览器会话将退出，未保存的编辑可能丢失。', () => void stop())
}
function requestStart() {
  if (!active || busy.value) return
  const input = { port: port.value, lan: lan.value }
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) { failure.value = '端口应为 1024～65535'; return }
  if (input.lan) {
    confirm.showConfirm('开启局域网访问？', '同一网络中的设备可访问 Desko，请仅在可信网络开启。', () => void start(input))
  } else void start(input)
}
async function copy(url: string) { try { await writeClipboardText(url); toast.showToast('地址已复制') } catch { toast.showToast('复制失败', 'error') } }
onMounted(() => { void refresh(); poll = setInterval(() => { if (!busy.value) void refresh() }, 3000) })
onUnmounted(() => { active = false; clearInterval(poll) })
</script>
<template>
  <div class="group-content web-access-pane">
    <div class="web-head">
      <div class="setting-status">
        <span class="live-dot" :class="{ idle: !status.running }" :aria-label="status.running ? '服务运行中' : '服务未启动'" />
        <span>{{ status.running ? '服务运行中' : '服务未启动' }}</span>
        <span v-if="status.running" class="web-scope">{{ status.lan ? '· 本机与局域网' : '· 仅本机' }}</span>
      </div>
      <button v-if="status.running" class="action-btn" type="button" :disabled="busy" @click="requestStop">{{ busy ? '正在停止…' : '停止服务' }}</button>
      <button v-else class="action-btn primary" type="submit" form="web-access-form" :disabled="busy">{{ busy ? '正在启动…' : '启动 Web 服务' }}</button>
    </div>

    <template v-if="status.running">
      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-name">当前端口</span>
          <span class="setting-desc">停止服务后可修改端口与访问范围。</span>
        </div>
        <div class="setting-control"><span class="setting-mono"><code>{{ status.port }}</code></span></div>
      </div>
      <div class="web-addresses" aria-label="访问地址">
        <div class="web-address" v-for="url in status.urls" :key="url">
          <span class="web-address-url">{{ url }}</span>
          <button class="action-btn" type="button" @click="copy(url)"><AppIcon name="copy" :size="14" />复制地址</button>
        </div>
      </div>
      <p class="pane-hint" v-if="status.lan && status.urls.length < 2">未获取局域网地址，请使用本机 IPv4 地址与端口 {{ status.port }}。</p>
    </template>
    <form v-else id="web-access-form" @submit.prevent="requestStart">
      <div class="setting-item">
        <div class="setting-info">
          <label class="setting-name" for="web-access-port">端口</label>
          <span class="setting-desc">可使用 1024～65535，启动前请确认端口空闲。</span>
        </div>
        <input id="web-access-port" v-model.number="port" class="number-input web-port" type="number" min="1024" max="65535" :disabled="busy" />
      </div>
      <div class="setting-item">
        <div class="setting-info">
          <label class="setting-name" for="web-access-lan">允许局域网设备访问</label>
          <span class="setting-desc">关闭时仅本机可访问。</span>
        </div>
        <label class="switch">
          <input id="web-access-lan" v-model="lan" type="checkbox" role="switch" :disabled="busy" />
          <span class="switch-slider"></span>
        </label>
      </div>
    </form>
    <p v-if="failure" class="web-error" role="alert">{{ failure }}</p>
  </div>
</template>
<style scoped>
.web-access-pane { display: flex; flex-direction: column; }
.web-access-pane p { margin: 0; line-height: 1.7; }
/* 行与行之间交给 .setting-item 的 8px 内距呼吸，其余块自己补 6px 才和组题那一档对齐 */
.web-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: 6px; }
.web-scope { color: var(--text-muted); }
.web-addresses { min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); margin-top: 6px; padding: var(--space-2) var(--space-3); background: var(--sunken); border-radius: var(--radius); }
.web-address { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.web-address-url { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--text-secondary); font-family: var(--font-ui); font-size: var(--text-sm); line-height: 1.6; user-select: text; }
.web-address .action-btn { flex-shrink: 0; }
.web-port { width: 84px; }
.web-access-pane code { font-family: inherit; }
.web-access-pane .pane-hint { margin-top: 6px; }
.switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; z-index: 1; cursor: pointer; }
.switch input:focus-visible + .switch-slider { outline: 2px solid var(--accent); outline-offset: 2px; }
form { display: flex; flex-direction: column; }
.web-error { margin-top: 6px; color: var(--danger); font-size: var(--text-sm); }
</style>
