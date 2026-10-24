<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isWebRuntime } from '../../services/runtime'
import { invoke } from '../../services/transport'
import { webAccessApi, type WebAccessStatus } from '../../services/api/webAccess'
import { openExternal } from '../../utils/openExternal'
import AppIcon from '../shared/AppIcon.vue'

defineProps<{ compact?: boolean }>()
const web = isWebRuntime()
const status = ref<WebAccessStatus | null>(null)
const error = ref('')
const busy = ref(false)
const address = computed(() => {
  if (!status.value?.running) return ''
  if (!web) return `${status.value.urls[0] || `http://127.0.0.1:${status.value.port}`}/codex`
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
  const publicUrl = status.value.urls.find(url => url.startsWith('https://'))
  if (!local && publicUrl) return `${publicUrl}/codex`
  // A tunnel hostname cannot be reused for a different local service port.
  if (!local && location.protocol === 'https:') return ''
  if (!local && !status.value.urls.some(url => new URL(url).hostname === location.hostname)) return ''
  if (!status.value.lan && !local) return ''
  const url = new URL(location.href)
  url.protocol = 'http:'
  url.port = String(status.value.port)
  url.pathname = '/codex'
  url.search = ''; url.hash = ''
  return url.href
})
async function refresh() {
  busy.value = true
  try {
    status.value = await (web ? invoke<WebAccessStatus>('web_codex_service_status') : webAccessApi.status('codex'))
    error.value = ''
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
function openSettings() { window.dispatchEvent(new CustomEvent('desko:open-settings-tab', { detail: 'web' })) }
onMounted(refresh)
</script>

<template>
  <section class="codex-web-entry" :class="{ compact }" aria-label="Codex Web UI 入口">
    <div>
      <h3>Codex Web UI</h3>
      <p v-if="!compact">通过浏览器操作 Codex，任务在运行 Desko 的电脑上执行。</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-else-if="status && !status.running">请在桌面端的「设置 → Web 访问」启动 Codex Web UI。</p>
      <p v-else-if="status?.running && web && !address">请在桌面端配置局域网访问或公网入口。</p>
    </div>
    <div class="entry-actions">
      <a v-if="address" class="action-btn" :href="address" target="_blank" rel="noopener noreferrer" @click.prevent="openExternal(address)"><AppIcon name="external" :size="14" />打开 Codex Web UI</a>
      <button v-else-if="!web" class="action-btn" type="button" @click="openSettings">设置 Web 访问</button>
      <button class="action-btn" type="button" :disabled="busy" aria-label="刷新 Codex Web 服务状态" @click="refresh"><AppIcon name="refresh" :size="14" /></button>
    </div>
  </section>
</template>

<style scoped>
.codex-web-entry { padding: 24px; border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 12px; }
h3 { margin: 0 0 8px; font-size: var(--text-lg); font-weight: 600; }
p { margin: 4px 0; color: var(--text-secondary); font-size: var(--text-xs); line-height: 1.7; }
.entry-actions { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
.entry-actions a { text-decoration: none; }
.compact { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; }
.compact h3 { font-size: var(--text-xs); margin: 0; }
.compact .entry-actions { margin: 0; }
@media (max-width: 760px) { .codex-web-entry { padding: 16px; } .entry-actions .action-btn { min-height: 44px; } }
</style>
