<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { LocalPath } from '../../types'
import { normalizeSubPath, joinEntryUrl } from '../../utils/urlPath'
import { useToastStore } from '../../stores/toast'
import { useClipboard } from '../../composables/useClipboard'
import { useEscapeClose } from '../../composables/useEscapeClose'
import AppIcon from '../shared/AppIcon.vue'

/** 增删直接写进父表单的草稿数组，落库统一等「保存条目」 */
const props = defineProps<{ paths: LocalPath[]; entryName: string; baseUrl: string }>()

const emit = defineEmits<{ close: []; openUrl: [url: string] }>()

const toastStore = useToastStore()
const clipboard = useClipboard()

const draft = ref({ label: '', path: '' })
const labelRef = ref<HTMLInputElement | null>(null)
const pathRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
let tempSeq = 0

const activePaths = computed(() => props.paths.filter(p => !p.isDeleted))
/** 新增态名称还没填，标题不留「· 」这个孤尾分隔 */
const headCount = computed(() => `${activePaths.value.length} 个${props.entryName ? ` · ${props.entryName}` : ''}`)

const fullPath = (p: LocalPath) => joinEntryUrl(props.baseUrl, p.path)

const addPath = () => {
  const raw = draft.value.path.trim()
  if (!raw) {
    pathRef.value?.focus()
    return
  }
  const path = normalizeSubPath(raw)
  if (!path) {
    toastStore.showToast('只需填主机名之后的路径，例如 /builds/linux', 'error')
    pathRef.value?.focus()
    return
  }
  props.paths.push({
    id: `temp-${++tempSeq}`,
    path,
    label: draft.value.label.trim(),
    notes: '',
    isNew: true,
    isDeleted: false,
    dirty: false,
  })
  draft.value = { label: '', path: '' }
  nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
    pathRef.value?.focus()
  })
}

const removePath = (index: number) => {
  const path = activePaths.value[index]
  const at = props.paths.indexOf(path)
  if (at < 0) return
  if (path.isNew) props.paths.splice(at, 1)
  else path.isDeleted = true
}

useEscapeClose(() => emit('close'))
onMounted(() => pathRef.value?.focus())
</script>

<template>
  <Transition name="dialog">
    <div class="dialog-overlay paths-overlay">
      <div class="dialog paths-dialog" role="dialog" aria-modal="true" :aria-label="`子路径管理：${entryName}`">
        <div class="dialog-header">
          <h3>子路径</h3>
          <span class="sub">{{ headCount }}</span>
          <button class="dialog-close" type="button" title="关闭 (Esc)" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </button>
        </div>

        <div ref="listRef" class="dialog-body paths-body">
          <div v-for="(path, index) in activePaths" :key="path.id" class="path-row">
            <span class="path-tag" :title="path.label || undefined">{{ path.label || '未命名' }}</span>
            <span class="path-sep">/</span>
            <span class="path-value" :title="path.path">{{ path.path.replace(/^\//, '') }}</span>
            <span class="path-acts">
              <button v-if="baseUrl" class="ib" type="button" title="在浏览器打开" @click="emit('openUrl', fullPath(path))">
                <AppIcon name="external" :size="14" />
              </button>
              <button class="ib" type="button" title="复制路径" @click="clipboard.copyToClipboard(path.path, '路径')">
                <AppIcon name="copy" :size="14" />
              </button>
              <button class="ib danger" type="button" title="删除路径" @click="removePath(index)">
                <AppIcon name="trash" :size="14" />
              </button>
            </span>
          </div>

          <div class="path-row path-add">
            <input ref="labelRef" v-model="draft.label" class="add-label" placeholder="标签" maxlength="20" @keydown.enter.prevent="addPath" />
            <span class="path-sep">/</span>
            <input ref="pathRef" v-model="draft.path" class="add-path url-mono" placeholder="dashboard" @keydown.enter.prevent="addPath" />
            <button class="btn-primary" type="button" @click="addPath">添加</button>
          </div>
        </div>

        <div class="dialog-footer">
          <div class="footer-hints">
            <span class="kbd">Enter</span><span>添加</span>
            <span class="hints-dot">·</span>
            <span class="kbd">Esc</span><span>关闭</span>
          </div>
          <button class="btn-primary" type="button" @click="emit('close')">完成</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.paths-overlay {
  background: var(--overlay);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

/* 壳（宽高/描边/投影/头 44/底栏）全在 global.css，这里只留本页独有的列表行 */
.paths-dialog {
  width: 520px;
  max-height: 91vh;
}

.paths-body { max-height: 46vh }

.path-row {
  display: flex; align-items: center; gap: 8px;
  min-height: 38px; padding: 0 2px;
  border-bottom: 1px solid var(--border);
}
.path-row:hover { background: var(--hover) }
.path-tag {
  flex: 0 0 auto; max-width: 110px; height: 20px; line-height: 20px; padding: 0 8px;
  border-radius: var(--radius); font-size: var(--text-2xs); font-weight: 500;
  color: var(--accent); background: var(--accent-soft);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.path-sep { flex-shrink: 0; font-size: var(--text-xs); color: var(--text-muted) }
.path-value {
  flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-sm); color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.path-acts { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px }
/* 行本身已 --hover 上底，图标再 hover 同色就看不出反馈，抬到 --fill 一档 */
.path-acts .ib { color: var(--text-faint) }
.path-row:hover .ib:hover { background: var(--fill) }

.path-add { min-height: 44px; padding: 4px 2px; border-bottom: none }
.path-add input {
  height: 32px; padding: 0 11px; font-size: var(--text-content);
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius-sm); outline: none;
  transition: all var(--transition); font-family: inherit;
}
.path-add .add-label { flex: 0 0 96px; min-width: 96px }
.path-add .add-path { flex: 1; min-width: 0 }
.path-add input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); background: var(--bg-surface) }
.url-mono { font-family: var(--font-mono) }
</style>
