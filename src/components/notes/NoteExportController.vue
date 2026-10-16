<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNotesStore } from '../../stores/notes'
import { useToastStore } from '../../stores/toast'
import { notesApi } from '../../services/api/notes'
import { collectAttachmentNames } from '../../services/attachmentSrc'
import { sanitizeNoteHtml } from '../../utils/sanitizeNoteHtml'
import { buildNoteExport, NOTE_EXPORT_FORMATS, noteExportExtension, type NoteExportFormat } from '../../utils/noteExport'
import { useEscapeClose } from '../../composables/useEscapeClose'
import NoteLockDialog from './NoteLockDialog.vue'
import AppIcon from '../shared/AppIcon.vue'
import type { Note } from '../../types'

const props = defineProps<{ ids: string[]; format?: NoteExportFormat; scopeLabel: string }>()
const emit = defineEmits<{ close: [] }>()
const store = useNotesStore()
const toast = useToastStore()
const format = ref<NoteExportFormat>(props.format ?? 'markdown')
const busy = ref(false)
const showUnlock = ref(false)
let active = true
let resolveUnlock: ((value: boolean) => void) | null = null
const extension = computed(() => noteExportExtension(format.value, props.ids.length))
const filename = computed(() => `小记导出 ${new Date().toISOString().slice(0, 10)}.${extension.value}`)

function finishUnlock(value: boolean) {
  showUnlock.value = false
  resolveUnlock?.(value)
  resolveUnlock = null
}
useEscapeClose(() => emit('close'), () => !busy.value && !showUnlock.value)
onBeforeUnmount(() => { active = false; finishUnlock(false) })

async function exportNotes() {
  if (busy.value) return
  busy.value = true
  try {
    await store.flushNoteSave()
    if (!active) return
    const locked = props.ids.filter(id => {
      const note = store.findNote(id)
      return note?.encrypted && store.notePlains[id] == null
    })
    if (locked.length && !store.noteKey.is_open) {
      showUnlock.value = true
      await new Promise<boolean>(resolve => { resolveUnlock = resolve })
      if (!active) return
    }
    if (store.noteKey.is_open) for (const id of locked) {
      if (!active) return
      if (store.notePlains[id] == null) await store.unlockNote(id)
    }
    if (!active) return
    const readable: Note[] = []
    for (const id of props.ids) {
      const note = store.findNote(id)
      if (!note || (note.encrypted && store.notePlains[id] == null)) continue
      readable.push({ ...note, content_html: note.encrypted ? store.notePlains[id] : note.content_html })
    }
    const skipped = props.ids.length - readable.length
    if (!readable.length) {
      toast.showToast(`未导出：${skipped} 条小记未解锁或已不存在`, 'info')
      emit('close')
      return
    }
    const names = [...new Set(readable.flatMap(note => collectAttachmentNames(sanitizeNoteHtml(note.content_html))))]
    const images = names.length ? await notesApi.exportImages(names) : {}
    if (!active) return
    const result = buildNoteExport(readable, format.value, images)
    const ext = noteExportExtension(format.value, readable.length)
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: readable.length === 1 ? result.files[0].name : filename.value.replace(/\.[^.]+$/, '.' + ext), filters: [{ name: ext === 'zip' ? '小记压缩包' : NOTE_EXPORT_FORMATS.find(f => f.id === format.value)!.label, extensions: [ext] }] })
    if (!active) return
    if (!path) { if (props.format) emit('close'); return }
    await notesApi.writeExport(path, format.value, result.files, readable.map(note => note.id))
    if (!active) return
    const summary = skipped ? `${props.ids.length} 条中 ${readable.length} 条已导出，${skipped} 条未解锁或已不存在，已跳过` : `已导出 ${readable.length} 条小记`
    toast.showToast(summary + (result.missingImages ? `；${result.missingImages} 张图片未能嵌入，已保留文字说明` : ''), result.missingImages || skipped ? 'info' : 'success')
    emit('close')
  } catch (error) {
    if (active) toast.showToast('导出失败：' + (error instanceof Error ? error.message : String(error)), 'error')
    if (active && props.format) emit('close')
  } finally {
    if (active) busy.value = false
  }
}
onMounted(() => { if (props.format) void exportNotes() })
</script>

<template>
  <div v-if="!props.format" class="dialog-overlay" @click.self="!busy && emit('close')">
    <section class="dialog note-export-dialog" role="dialog" aria-modal="true" aria-label="导出小记">
      <header class="dialog-header">
        <h3>导出 {{ props.ids.length }} 条小记</h3>
        <button class="dialog-close" type="button" :disabled="busy" aria-label="关闭" @click="emit('close')"><AppIcon name="x" :size="16" /></button>
      </header>
      <div class="dialog-body">
        <p class="export-lead">{{ props.scopeLabel }} · 选择格式后保存到电脑。</p>
        <div class="seg" role="group" aria-label="导出格式">
          <button v-for="item in NOTE_EXPORT_FORMATS" :key="item.id" type="button" :class="{ on: format === item.id }" :aria-pressed="format === item.id" :disabled="busy" @click="format = item.id">{{ item.label }}</button>
        </div>
        <p class="export-format-note">{{ format === 'word' ? 'Word 导出为 .doc，可用 Word 或 WPS 打开，不是 .docx。' : format === 'pdf' ? 'A4 纵向 PDF，多条小记合并在一份文档中。' : '保留正文格式与图片附件，多条小记打包为 ZIP。' }}</p>
        <p class="export-filename">默认文件名 <strong>{{ filename }}</strong></p>
        <p class="export-hint">加密小记需先解锁；取消解锁时跳过，并在完成后提示条数。无法嵌入的图片会保留文字说明。</p>
      </div>
      <footer class="dialog-footer">
        <button class="btn-secondary" type="button" :disabled="busy" @click="emit('close')">取消</button>
        <button class="btn-primary" type="button" :disabled="busy || !props.ids.length" @click="exportNotes">{{ busy ? '正在导出…' : '导出…' }}</button>
      </footer>
    </section>
  </div>
  <NoteLockDialog v-if="showUnlock" :mode="store.noteKey.is_set ? 'unlock' : 'setup'" @done="finishUnlock(true)" @close="finishUnlock(false)" />
</template>

<style scoped>
.note-export-dialog { width: min(520px, calc(100vw - 32px)); }
.export-lead { margin: 0 0 16px; color: var(--text-secondary); }
.seg { display: flex; padding: 3px; gap: 4px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--sunken); }
.seg button { flex: 1; }
.note-export-dialog .seg button.on { background: var(--bg-surface); box-shadow: var(--shadow-card); }
.export-format-note { min-height: 42px; margin: 14px 0; color: var(--text-secondary); line-height: 1.7; }
.export-filename { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: var(--radius-sm); background: var(--bg-mono-chip); color: var(--text-secondary); }
.export-filename strong { color: var(--text); font-weight: 500; overflow-wrap: anywhere; }
.export-hint { margin: 14px 0 0; color: var(--text-muted); font-size: var(--text-xs); line-height: 1.7; }
</style>
