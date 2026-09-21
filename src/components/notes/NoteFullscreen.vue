<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatAbsTime, htmlToText, wordCount } from '../../utils/format'
import { collectAttachmentPaths, unreferencedAttachments } from '../../services/attachmentSrc'
import type { Note, Attachment } from '../../types'
import type { NoteSaveState } from '../../stores/notes'

const props = withDefaults(defineProps<{
  /** null 表示这是一条还没发布的小记（从胶囊输入进入全屏） */
  note: Note | null
  initialHtml: string
  attachments?: Attachment[]
  saveState?: NoteSaveState
}>(), {
  attachments: () => [],
  saveState: '',
})

const emit = defineEmits<{
  update: [html: string]
  close: []
  publish: []
  addImage: []
  togglePin: []
  toggleStar: []
  delete: []
  removeAttachment: [attachmentId: string]
}>()

const html = ref(props.initialHtml)
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

const text = computed(() => htmlToText(html.value))
// 只有图的小记也算有内容：正文引用了附件就不空
const empty = computed(() => !text.value.trim() && !collectAttachmentPaths(html.value).length)
const visibleAtts = computed(() => unreferencedAttachments(html.value, props.attachments))
const saveText = { '': '', saving: '保存中…', saved: '已保存' } as const

const onUpdate = (value: string) => {
  html.value = value
  emit('update', value)
}

const insertTag = () => editorRef.value?.insertText(' #')
const insertImage = (src: string) => editorRef.value?.insertImage(src)

defineExpose({ insertImage })

const onPrimary = () => {
  if (props.note) emit('close')
  else emit('publish')
}

const startDrag = (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, input, a')) return
  getCurrentWindow().startDragging().catch(() => {})
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <section class="fs" role="dialog" aria-modal="true" :aria-label="props.note ? '全屏编辑小记' : '写一条小记'">
    <header class="fs-head" @mousedown="startDrag">
      <button class="fs-exit" type="button" @click="emit('close')">
        <AppIcon name="min" :size="13" />
        退出全屏
        <span class="kbd">Esc</span>
      </button>
      <span class="spacer"></span>
      <span class="save-hint" :class="props.saveState">
        {{ saveText[props.saveState] || (props.note ? '自动保存' : '草稿不会丢') }}
      </span>
    </header>

    <div class="fs-scroll">
      <div class="fs-inner fs-col">
        <div class="fs-meta">
          <span>{{ props.note ? formatAbsTime(props.note.created_at) : '新小记' }}</span>
          <span class="dotsep"></span>
          <span>{{ wordCount(text) }} 字</span>
        </div>

        <NoteEditor
          ref="editorRef"
          variant="full"
          :initial-content="html"
          :placeholder="props.note ? '' : '此刻的想法…'"
          @update="onUpdate"
          @submit="onPrimary"
        />

        <div v-if="visibleAtts.length" class="fs-atts">
          <NoteAttachments :attachments="visibleAtts" @remove="emit('removeAttachment', $event)" />
        </div>
      </div>
    </div>

    <footer class="fs-foot">
      <NoteToolbar
        :note="props.note"
        :save-state="props.saveState"
        :primary-label="props.note ? '完成' : '发布'"
        :primary-disabled="empty"
        :show-fullscreen="false"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @toggle-pin="emit('togglePin')"
        @toggle-star="emit('toggleStar')"
        @delete="emit('delete')"
        @primary="onPrimary"
      >
        <template #hint>
          <span
            class="fs-hint"
            :title="`完整快捷语法：# / ## / ### 空格 标题\n- 或 + 空格 无序列表 · 1. 空格 有序列表\n&gt; 空格 引用 · \`\`\` 空格 代码块\n[] 或 [x] 空格 任务 · --- 分割线\n**粗** *斜* ~~删~~ \`码\``"
          ><span class="kbd">/</span> 命令 · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> {{ props.note ? '完成' : '发布' }}</span>
        </template>
      </NoteToolbar>
    </footer>
  </section>
</template>

<style scoped>
.fs {
  position: absolute;
  inset: 0;
  z-index: 150;
  display: flex;
  flex-direction: column;
  background: radial-gradient(920px 420px at 50% -6%, var(--accent-soft), transparent 72%), var(--bg);
  animation: fs-in var(--transition-slow) ease both;
}
/* 入场只做透明度和位移，位移放在不含 fixed 子元素的层上，避免破坏 slash 菜单的视口定位 */
@keyframes fs-in { from { opacity: 0; } }

.fs-col {
  width: 100%;
  max-width: var(--fs-max);
  margin: 0 auto;
  padding-inline: var(--space-6);
}
/* 首尾栏铺满区域：按钮贴左右边缘，只有书写列收在 --fs-max 内 */
.fs-head {
  height: 52px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-inline: var(--space-5);
}
.fs-exit {
  height: 30px;
  padding: 0 var(--space-3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--panel-bg);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 12.5px;
  cursor: pointer;
  box-shadow: var(--shadow-xs);
  transition: all var(--transition);
  font-family: inherit;
}
.fs-exit:hover { color: var(--accent); border-color: var(--accent-light); background: var(--accent-soft); }
.fs-exit .kbd { background: transparent; border-bottom-width: 1px; }

.fs-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-bottom: var(--space-5);
}
.fs-meta .dotsep { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: 0.5; }

.fs-scroll { flex: 1; overflow-y: auto; min-height: 0; }
.fs-inner { animation: fs-rise 0.26s cubic-bezier(0.22, 1, 0.36, 1) both; padding-block: var(--space-6) var(--space-8); }
@keyframes fs-rise { from { opacity: 0; } }

.fs-atts { margin-top: var(--space-5); }

.fs-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border-top: 1px solid var(--border);
  background: var(--frost-bg);
  backdrop-filter: blur(10px);
}

.fs-hint {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 var(--space-1);
}
</style>
