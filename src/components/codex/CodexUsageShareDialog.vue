<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useDialogFocus } from '../../composables/useDialogFocus'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useClipboard } from '../../composables/useClipboard'
import { isWebRuntime } from '../../services/runtime'
import { useToastStore } from '../../stores/toast'
import { formatTokenCount } from '../../utils/codexUsage'
import { renderUsagePoster, USAGE_POSTER_SIZE, type UsagePosterData, type UsagePosterTheme } from '../../utils/codexUsagePoster'
import AppIcon from '../shared/AppIcon.vue'

const props = defineProps<{ data: UsagePosterData }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocus(dialog)
const { clearClipboardTimer } = useClipboard()
const toast = useToastStore()
const theme = ref<UsagePosterTheme>(document.documentElement.dataset.base === 'dark' ? 'dark' : 'light')
const showCost = ref(true)
const image = shallowRef<Blob | null>(null)
const preview = ref('')
const rendering = ref(false)
const action = ref<'save' | 'copy' | ''>('')
const error = ref('')
const busy = computed(() => rendering.value || !!action.value)
const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
const summary = computed(() => `${props.data.title} · ${props.data.period} · 总量 ${formatTokenCount(props.data.totals.totalTokens)} Token`)
let generation = 0
let active = true
useEscapeClose(() => emit('close'), () => !action.value)

async function generate() {
  const current = ++generation
  rendering.value = true
  error.value = ''
  try {
    const blob = await renderUsagePoster(props.data, theme.value, showCost.value)
    if (!active || current !== generation) return
    if (preview.value) URL.revokeObjectURL(preview.value)
    image.value = blob
    preview.value = URL.createObjectURL(blob)
  } catch (cause) {
    if (active && current === generation) {
      image.value = null
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    if (active && current === generation) rendering.value = false
  }
}
watch([theme, showCost], generate, { immediate: true })
onBeforeUnmount(() => {
  active = false
  generation++
  if (preview.value) URL.revokeObjectURL(preview.value)
})

async function saveImage() {
  if (busy.value || !image.value) return
  const blob = image.value
  action.value = 'save'
  try {
    if (isWebRuntime()) {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = props.data.filename
      document.body.append(link)
      link.click()
      link.remove()
      // 下载与预览独立，关闭预览或切换配色不会提前释放正在下载的图片。
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } else {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const path = await save({ defaultPath: props.data.filename, filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
      if (!active || !path) return
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      const bytes = new Uint8Array(await blob.arrayBuffer())
      if (!active) return
      await writeFile(path, bytes)
    }
    if (active) toast.showToast(isWebRuntime() ? '图片已开始下载' : '图片已保存')
  } catch (cause) {
    if (active) toast.showToast('保存失败：' + (cause instanceof Error ? cause.message : String(cause)), 'error')
  } finally {
    if (active) action.value = ''
  }
}

async function copyImage() {
  if (busy.value || !image.value || !canCopy) return
  action.value = 'copy'
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.value })])
    if (!active) return
    clearClipboardTimer()
    toast.showToast('图片已复制，可直接粘贴分享')
  } catch {
    if (active) toast.showToast('复制失败，可先保存图片再分享', 'error')
  } finally {
    if (active) action.value = ''
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="!action && emit('close')">
    <section ref="dialog" class="dialog usage-share-dialog" role="dialog" aria-modal="true" aria-label="分享" aria-describedby="usage-share-summary" tabindex="-1" @keydown.tab="trapFocus">
      <header class="dialog-header">
        <h3>分享</h3>
        <button class="dialog-close" type="button" aria-label="关闭" :disabled="!!action" @click="emit('close')"><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="dialog-body usage-share-body">
        <div class="poster-preview" :aria-busy="rendering">
          <img v-if="preview && !error" :src="preview" :alt="summary" :width="USAGE_POSTER_SIZE.width" :height="USAGE_POSTER_SIZE.height">
          <div v-if="error" class="poster-message" role="alert"><p>{{ error }}</p><button class="btn-secondary" type="button" @click="generate">重试</button></div>
          <span v-else-if="rendering" class="poster-generating" role="status">正在生成图片…</span>
        </div>
        <div class="poster-options">
          <p id="usage-share-summary" class="poster-summary">{{ summary }}</p>
          <div class="poster-control">
            <span>图片配色</span>
            <div class="seg" role="group" aria-label="图片配色">
              <button v-for="option in [{ key: 'light', label: '浅色' }, { key: 'dark', label: '深色' }] as const" :key="option.key" type="button" :class="{ on: theme === option.key }" :aria-pressed="theme === option.key" :disabled="!!action" @click="theme = option.key">{{ option.label }}</button>
            </div>
          </div>
          <label class="poster-cost-toggle"><input v-model="showCost" type="checkbox" :disabled="!!action">展示估算金额</label>
          <p class="poster-image-info">PNG · {{ USAGE_POSTER_SIZE.width }} × {{ USAGE_POSTER_SIZE.height }}</p>
          <p class="poster-snapshot">截至 {{ data.asOf }}。预览期间保留这份统计。</p>
        </div>
      </div>
      <footer class="dialog-footer">
        <button v-if="canCopy" class="btn-secondary" type="button" :disabled="busy || !image" @click="copyImage"><AppIcon name="copy" :size="14" />{{ action === 'copy' ? '正在复制…' : '复制图片' }}</button>
        <button class="btn-primary" type="button" :disabled="busy || !image" @click="saveImage"><AppIcon name="download" :size="14" />{{ action === 'save' ? '正在保存…' : '保存图片' }}</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.usage-share-dialog { width:min(740px,calc(100vw - 32px)); max-height:calc(100dvh - 32px); }
.usage-share-body { display:grid; grid-template-columns:minmax(0,1fr) 190px; gap:24px; min-height:0; overflow:auto; }
.poster-preview { position:relative; display:flex; align-items:center; justify-content:center; min-width:0; aspect-ratio:3 / 4; background:var(--sunken); border-radius:var(--radius-sm); overflow:hidden; }
.poster-preview img { display:block; width:100%; height:auto; }
.poster-generating { position:absolute; inset:0; display:grid; place-items:center; background:color-mix(in srgb,var(--bg-surface) 75%,transparent); color:var(--text-secondary); font-size:var(--text-sm); }
.poster-message { padding:20px; text-align:center; font-size:var(--text-sm); color:var(--text-secondary); }
.poster-options { display:flex; flex-direction:column; align-items:stretch; gap:20px; min-width:0; padding-top:4px; font-size:var(--text-sm); }
.poster-summary { margin:0; font-weight:500; line-height:1.7; color:var(--text-secondary); }
.poster-control { display:flex; flex-direction:column; gap:8px; }
.poster-control > span { color:var(--text-muted); font-size:var(--text-xs); }
.poster-control .seg { display:flex; padding:3px; border-radius:var(--radius-sm); background:var(--sunken); }
.poster-control .seg button { flex:1; }
.poster-cost-toggle { display:flex; align-items:center; gap:7px; cursor:pointer; color:var(--text-secondary); }
.poster-cost-toggle input { accent-color:var(--accent); }
.poster-image-info, .poster-snapshot { margin:0; color:var(--text-muted); font-size:var(--text-xs); line-height:1.7; }
.poster-image-info { margin-top:auto; font-variant-numeric:tabular-nums; }
.dialog-footer button { display:inline-flex; align-items:center; gap:6px; }
@media(max-width:560px) {
  .usage-share-dialog { width:calc(100vw - 24px); }
  .usage-share-body { grid-template-columns:1fr; gap:16px; }
  .poster-preview { width:min(100%,320px); justify-self:center; }
  .poster-options { display:grid; grid-template-columns:1fr 1fr; gap:14px; padding:0; }
  .poster-summary, .poster-snapshot { grid-column:1 / -1; }
  .poster-cost-toggle { align-self:end; min-height:32px; }
  .poster-image-info { margin:0; grid-column:1 / -1; }
}
</style>
