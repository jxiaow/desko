<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FileShortcut } from '../../types'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { useToastStore } from '../../stores/toast'
import AppIcon from '../shared/AppIcon.vue'
import { downloadWebFile, readWebDirectory, type WebDirectory, type WebFileEntry } from './webFiles'

const props = defineProps<{ shortcut: FileShortcut }>()
const emit = defineEmits<{ close: [] }>()
const toastStore = useToastStore()
const directory = ref<WebDirectory | null>(null)
const requestedPath = ref('')
const loading = ref(false)
const error = ref('')
const downloading = ref<string | null>(null)
let loadSeq = 0

const crumbs = computed(() => {
  let path = ''
  return (directory.value?.path || '').split('/').filter(Boolean).map(name => {
    path = path ? `${path}/${name}` : name
    return { name, path }
  })
})

const load = async (path: string) => {
  const seq = ++loadSeq
  requestedPath.value = path
  loading.value = true
  error.value = ''
  try {
    const next = await readWebDirectory(props.shortcut.id, path)
    if (seq === loadSeq) directory.value = next
  } catch (cause) {
    if (seq === loadSeq) error.value = cause instanceof Error ? cause.message : '目录无法读取'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

const openEntry = async (entry: WebFileEntry) => {
  if (entry.directory) {
    await load(entry.path)
    return
  }
  if (downloading.value) return
  downloading.value = entry.path
  try {
    await downloadWebFile(props.shortcut.id, entry.path, entry.name)
  } catch (cause) {
    toastStore.showToast(cause instanceof Error ? cause.message : '下载失败', 'error')
  } finally {
    downloading.value = null
  }
}

const sizeText = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

useEscapeClose(() => emit('close'))
onMounted(() => { void load('') })
onBeforeUnmount(() => { loadSeq++ })
</script>

<template>
  <Transition name="dialog">
    <div class="dialog-overlay">
      <div class="dialog web-files-dialog" role="dialog" aria-modal="true" :aria-label="`浏览文件：${shortcut.name}`">
        <div class="dialog-header">
          <h3>浏览文件</h3>
          <button class="dialog-close" type="button" title="关闭 (Esc)" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>
        <div class="web-files-crumbs" aria-label="当前位置">
          <button type="button" :class="{ current: !directory?.path }" @click="load('')">{{ shortcut.name }}</button>
          <template v-for="crumb in crumbs" :key="crumb.path">
            <span aria-hidden="true">/</span>
            <button type="button" :class="{ current: directory?.path === crumb.path }" @click="load(crumb.path)">{{ crumb.name }}</button>
          </template>
        </div>
        <div class="dialog-body web-files-body">
          <div v-if="loading" class="web-files-state">正在读取目录…</div>
          <div v-else-if="error" class="web-files-state">
            <span>{{ error }}</span>
            <button class="btn-secondary" type="button" @click="load(requestedPath)">重试</button>
          </div>
          <div v-else-if="!directory?.entries.length" class="web-files-state">目录为空</div>
          <div v-else class="web-files-list">
            <button v-for="entry in directory?.entries || []" :key="entry.path" class="web-file-row" type="button" :disabled="downloading === entry.path" @click="openEntry(entry)">
              <AppIcon :name="entry.directory ? 'folder' : 'file'" :size="16" />
              <span class="web-file-name" :title="entry.name">{{ entry.name }}</span>
              <span class="web-file-size">{{ entry.directory ? '目录' : sizeText(entry.size) }}</span>
              <AppIcon :name="entry.directory ? 'chevRight' : 'download'" :size="14" />
            </button>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="btn-secondary" type="button" @click="emit('close')">关闭</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.web-files-dialog { width: 560px; max-width: calc(100vw - 32px); }
.web-files-crumbs { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 6px var(--space-4) 10px; overflow-x: auto; white-space: nowrap; font-size: var(--text-xs); color: var(--text-muted); }
.web-files-crumbs button { flex: none; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; padding: 3px 0; background: none; color: var(--accent); cursor: pointer; font: inherit; }
.web-files-crumbs button.current { color: var(--text); font-weight: 600; }
.web-files-body { min-height: 120px; max-height: 55vh; padding: 0 var(--space-4) var(--space-3); }
.web-files-list { border-top: 1px solid var(--border); }
.web-file-row { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 42px; padding: 7px 2px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text-secondary); cursor: pointer; text-align: left; font: inherit; }
.web-file-row:hover:not(:disabled), .web-file-row:focus-visible { background: var(--hover); }
.web-file-row:disabled { cursor: wait; opacity: 0.7; }
.web-file-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: var(--text-sm); color: var(--text); }
.web-file-size { flex: none; font-size: var(--text-xs); color: var(--text-muted); }
.web-files-state { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; min-height: 110px; font-size: var(--text-sm); color: var(--text-muted); text-align: center; }
</style>
