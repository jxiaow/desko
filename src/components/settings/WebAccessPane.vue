<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { webAccessApi, type WebAccessStatus } from '../../services/api/webAccess'
import { useToastStore } from '../../stores/toast'
import { useConfirmStore } from '../../stores/confirm'
import { writeClipboardText } from '../../utils/clipboard'

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
  confirm.showConfirm('停止 Web 服务？', '所有浏览器会话将退出，未保存的编辑可能丢失。确定停止服务？', () => void stop())
}
function requestStart() {
  if (!active || busy.value) return
  const input = { port: port.value, lan: lan.value }
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) { failure.value = '端口应为 1024～65535'; return }
  if (input.lan) {
    confirm.showConfirm('开启局域网访问？', '同一网络中的设备可使用桌面主密码访问当前档案，并管理 Codex、局域网传输和内网穿透。请仅在可信网络使用。', () => void start(input))
  } else void start(input)
}
async function copy(url: string) { try { await writeClipboardText(url); toast.showToast('地址已复制') } catch { toast.showToast('复制失败', 'error') } }
onMounted(() => { void refresh(); poll = setInterval(() => { if (!busy.value) void refresh() }, 3000) })
onUnmounted(() => { active = false; clearInterval(poll) })
</script>
<template>
  <div class="web-access-pane">
    <p class="pane-hint">用浏览器访问当前档案，并管理已启用的 Codex、局域网传输和内网穿透模块。默认仅本机访问，每次手动开启。启动后可在桌面锁定时继续使用，退出 Desko 后停止。</p>
    <div class="web-status"><span :class="{ running: status.running }">{{ status.running ? '服务运行中' : '服务未启动' }}</span><span v-if="status.running">{{ status.lan ? '本机与局域网' : '仅本机' }}</span></div>
    <template v-if="status.running">
      <div class="web-address" v-for="url in status.urls" :key="url"><code>{{ url }}</code><button class="btn btn-secondary btn-sm" @click="copy(url)">复制地址</button></div>
      <p class="pane-hint" v-if="status.lan && status.urls.length < 2">未找到可展示的局域网地址，可用本机网卡的 IPv4 地址与端口 {{ status.port }} 访问。</p>
      <button class="btn btn-secondary" :disabled="busy" @click="requestStop">{{ busy ? '正在停止…' : '停止服务' }}</button>
    </template>
    <form v-else @submit.prevent="requestStart">
      <label class="web-field">端口<input v-model.number="port" type="number" min="1024" max="65535" :disabled="busy" /></label>
      <p class="pane-hint">浏览器使用当前档案的桌面主密码登录，无需另设密码。</p>
      <label class="web-lan"><input type="checkbox" v-model="lan" :disabled="busy" />允许局域网设备访问</label>
      <p class="pane-hint" v-if="lan">局域网访问使用 HTTP，请在可信网络中使用；其他设备可能需要在 Windows 防火墙中允许 Desko 访问专用网络。</p>
      <button class="btn btn-primary" :disabled="busy">{{ busy ? '正在启动…' : '启动 Web 服务' }}</button>
    </form>
    <p v-if="failure" class="web-error" role="alert">{{ failure }}</p>
    <p class="pane-hint web-boundary">Web 与桌面共用主密码和小记口令，加密、解锁、修改与找回方式相同。每个浏览器分别解锁小记，退出会清除该浏览器的解锁状态。</p>
    <p class="pane-hint">解锁桌面端后可启动服务，随后桌面锁定不影响 Web 访问。停止服务、更换主密码或恢复备份会结束 Web 会话。文件端支持浏览与下载已收藏的文件和目录。</p>
  </div>
</template>
<style scoped>
.web-access-pane { display:flex; flex-direction:column; gap:var(--space-4); }
.web-access-pane p { margin:0; line-height:1.7; }
.web-status { display:flex; gap:var(--space-3); align-items:center; color:var(--text-muted); font-size:var(--text-sm); }
.web-status > span:first-child { font-weight:600; color:var(--text-secondary); }
.web-status > .running { color:var(--accent); }
.web-address { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--space-2); padding:var(--space-3); background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-md); }
.web-address code { overflow-wrap:anywhere; font-size:var(--text-sm); }
.web-field { display:flex; flex-direction:column; gap:var(--space-2); font-size:var(--text-sm); color:var(--text-secondary); }
form { display:flex; flex-direction:column; gap:var(--space-4); }
.web-field input { width:100%; padding:9px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input, var(--bg-surface)); color:var(--text); font:inherit; }
.web-lan { display:flex; gap:var(--space-2); align-items:center; font-size:var(--text-sm); }
button { align-self:flex-start; }
.web-error { color:var(--danger); font-size:var(--text-sm); }
.web-boundary { border-top:1px solid var(--border); padding-top:var(--space-4); }
</style>
