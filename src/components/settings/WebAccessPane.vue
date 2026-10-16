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
  <div class="web-access-pane">
    <div class="web-status"><span :class="{ running: status.running }">{{ status.running ? '服务运行中' : '服务未启动' }}</span><span v-if="status.running">{{ status.lan ? '本机与局域网' : '仅本机' }}</span></div>
    <template v-if="status.running">
      <div class="web-addresses" aria-label="访问地址">
        <div class="web-address" v-for="url in status.urls" :key="url">
          <span class="web-address-url">{{ url }}</span>
          <button class="web-address-copy" @click="copy(url)"><AppIcon name="copy" :size="14" />复制地址</button>
        </div>
      </div>
      <p class="pane-hint" v-if="status.lan && status.urls.length < 2">未获取局域网地址，请使用本机 IPv4 地址与端口 {{ status.port }}。</p>
      <button class="btn btn-secondary" :disabled="busy" @click="requestStop">{{ busy ? '正在停止…' : '停止服务' }}</button>
    </template>
    <form v-else @submit.prevent="requestStart">
      <label class="web-field">端口<input v-model.number="port" type="number" min="1024" max="65535" :disabled="busy" /></label>
      <label class="web-lan"><input type="checkbox" v-model="lan" :disabled="busy" />允许局域网设备访问</label>
      <button class="btn btn-primary" :disabled="busy">{{ busy ? '正在启动…' : '启动 Web 服务' }}</button>
    </form>
    <p v-if="failure" class="web-error" role="alert">{{ failure }}</p>
  </div>
</template>
<style scoped>
.web-access-pane { display:flex; flex-direction:column; gap:var(--space-4); }
.web-access-pane p { margin:0; line-height:1.7; }
.web-status { display:flex; gap:var(--space-3); align-items:center; color:var(--text-muted); font-size:var(--text-sm); }
.web-status > span:first-child { font-weight:600; color:var(--text-secondary); }
.web-status > .running { color:var(--accent); }
.web-addresses { min-width:0; padding:0 var(--space-3); background:var(--sunken); border-radius:var(--radius); }
.web-address { display:flex; align-items:center; gap:var(--space-3); min-width:0; padding:var(--space-3) 0; }
.web-address + .web-address { border-top:1px solid var(--border-subtle); }
.web-address-url { flex:1; min-width:0; overflow-wrap:anywhere; color:var(--text-secondary); font-family:var(--font-ui); font-size:var(--text-sm); font-variant-numeric:tabular-nums; line-height:1.6; user-select:text; }
.web-address-copy { display:inline-flex; align-items:center; justify-content:center; gap:6px; flex-shrink:0; align-self:center; min-height:32px; padding:6px 8px; border:0; border-radius:var(--radius-sm); background:transparent; color:var(--text-secondary); font:inherit; font-size:var(--text-xs); white-space:nowrap; cursor:pointer; transition:background var(--transition), color var(--transition); }
.web-address-copy:hover { background:var(--fill); color:var(--text); }
.web-field { display:flex; flex-direction:column; gap:var(--space-2); font-size:var(--text-sm); color:var(--text-secondary); }
form { display:flex; flex-direction:column; gap:var(--space-4); }
.web-field input { width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input, var(--bg-surface)); color:var(--text); font:inherit; }
.web-lan { display:flex; gap:var(--space-2); align-items:center; font-size:var(--text-sm); }
button { align-self:flex-start; }
.web-error { color:var(--danger); font-size:var(--text-sm); }
</style>
