<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '../../services/transport'
import { useAuthStore } from '../../stores/auth'
import { useNotesStore } from '../../stores/notes'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from './AppIcon.vue'

const auth = useAuthStore()
const notes = useNotesStore()
const show = ref(false)
const busy = ref(false)
const error = ref('')
const cancelButton = ref<HTMLButtonElement | null>(null)
let previousFocus: HTMLElement | null = null
let active = true
let unlisten: (() => void) | null = null

onMounted(async () => {
  unlisten = await listen('tray-quit', async () => {
    if (!active || show.value) return
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    error.value = ''
    show.value = true
    await nextTick()
    if (active && show.value) cancelButton.value?.focus()
  })
  if (!active) unlisten()
})
onUnmounted(() => { active = false; unlisten?.() })

function cancel() {
  if (busy.value) return
  show.value = false
  previousFocus?.focus()
}
useEscapeClose(cancel, () => show.value)

async function confirm() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (auth.appState === 'unlocked') await notes.flushNoteSave()
    await invoke('quit_app')
    show.value = false
  } catch (e) {
    error.value = '退出失败：' + (e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

function trapFocus(event: KeyboardEvent) {
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (!buttons.length) { event.preventDefault(); return }
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="show" class="dialog-overlay quit-overlay">
      <section class="dialog dialog-sm quit-dialog" role="dialog" aria-modal="true" aria-labelledby="quit-title" aria-describedby="quit-description" :aria-busy="busy" @keydown.tab="trapFocus">
        <header class="dialog-header">
          <h3 id="quit-title">退出 Desko？</h3>
          <button class="dialog-close" type="button" aria-label="关闭" :disabled="busy" @click="cancel"><AppIcon name="x" :size="16" /></button>
        </header>
        <div class="dialog-body">
          <p id="quit-description" class="quit-description">退出后，以下服务将停止：<br>Web 访问、局域网文件传输和内网穿透。</p>
          <p class="quit-hint">仅关闭窗口可继续在托盘运行。</p>
          <p v-if="error" class="dialog-err" role="alert">{{ error }}</p>
        </div>
        <footer class="dialog-footer">
          <button ref="cancelButton" class="btn-secondary" type="button" :disabled="busy" @click="cancel">取消</button>
          <button class="btn-danger" type="button" :disabled="busy" @click="confirm">{{ busy ? '正在退出…' : '确认退出' }}</button>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.quit-overlay { z-index: 1100; }
.quit-dialog { max-width: calc(100vw - 32px); }
.quit-description { margin: 0; color: var(--text-secondary); font-size: var(--text-base); line-height: 1.8; }
.quit-hint { margin: var(--space-3) 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.6; }
</style>
