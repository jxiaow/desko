<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatAbsTime, highlightTagsInHtml, htmlToText, wordCount } from '../../utils/format'
import { collectAttachmentNames, resolveAssetHtml, unreferencedAttachments } from '../../services/attachmentSrc'
import type { Note, Attachment } from '../../types'
import type { NoteSaveState } from '../../stores/notes'

const props = withDefaults(defineProps<{
  /** null 表示这是一条还没发布的小记（从胶囊输入进入全屏） */
  note: Note | null
  initialHtml: string
  attachments?: Attachment[]
  saveState?: NoteSaveState
  /** view = 只读浏览已存的小记；edit = 书写面 */
  mode?: 'edit' | 'view'
}>(), {
  attachments: () => [],
  saveState: '',
  mode: 'edit',
})

const emit = defineEmits<{
  update: [html: string]
  close: []
  publish: []
  edit: []
  addImage: []
  togglePin: []
  toggleStar: []
  delete: []
  removeAttachment: [attachmentId: string]
}>()

const html = ref(props.initialHtml)
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)

const viewMode = computed(() => props.mode === 'view')
/** 查看态直接跟库里的正文走，不走编辑草稿的本地快照 */
const contentHtml = computed(() =>
  viewMode.value ? props.note?.content_html ?? '' : html.value)
const displayHtml = computed(() => resolveAssetHtml(highlightTagsInHtml(contentHtml.value)))

const text = computed(() => htmlToText(contentHtml.value))
// 只有图的小记也算有内容：正文引用了附件就不空
const empty = computed(() => !text.value.trim() && !collectAttachmentNames(contentHtml.value).length)
const visibleAtts = computed(() => unreferencedAttachments(contentHtml.value, props.attachments))
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
  <section class="fs" role="dialog" aria-modal="true" :aria-label="viewMode ? '全屏查看小记' : props.note ? '全屏编辑小记' : '写一条小记'">
    <header class="fs-head" @mousedown="startDrag">
      <button class="fs-exit" type="button" @click="emit('close')">
        <AppIcon name="min" :size="13" />
        退出全屏
        <span class="kbd">Esc</span>
      </button>
      <span class="spacer"></span>
      <span class="save-hint" :class="props.saveState">
        {{ viewMode ? '只读浏览' : saveText[props.saveState] || (props.note ? '自动保存' : '草稿不会丢') }}
      </span>
    </header>

    <div class="fs-scroll">
      <div class="fs-inner" :class="viewMode ? 'fs-doc' : 'fs-col'">
        <div class="fs-meta">
          <span>{{ props.note ? formatAbsTime(props.note.created_at) : '新小记' }}</span>
          <span class="dotsep"></span>
          <span>{{ wordCount(text) }} 字</span>
        </div>

        <div v-if="viewMode" class="fs-view" v-html="displayHtml" />
        <NoteEditor
          v-else
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
      <template v-if="viewMode && props.note">
        <button
          class="eb"
          type="button"
          :class="{ on: props.note.pinned }"
          :title="props.note.pinned ? '取消置顶' : '置顶'"
          @click="emit('togglePin')"
        >
          <AppIcon name="pin" :size="12" />{{ props.note.pinned ? '已置顶' : '置顶' }}
        </button>
        <button
          class="eb"
          type="button"
          :class="{ on: props.note.starred, warn: props.note.starred }"
          :title="props.note.starred ? '取消收藏' : '收藏'"
          @click="emit('toggleStar')"
        >
          <AppIcon name="star" :size="12" :filled="props.note.starred" />{{ props.note.starred ? '已收藏' : '收藏' }}
        </button>
        <span class="spacer"></span>
        <button class="eb danger" type="button" title="删除这条小记" @click="emit('delete')">
          <AppIcon name="trash" :size="12" />删除
        </button>
        <button class="eb primary" type="button" title="进入全屏编辑" @click="emit('edit')">
          <AppIcon name="edit" :size="12" />编辑
        </button>
      </template>
      <NoteToolbar v-else
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
  border-radius: var(--radius-pill);
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
/* 铺了纸就得给纸外留出桌沿，否则 800px 以下的窗口里纸边贴住滚动条 */
.fs-scroll:has(.fs-doc) { padding-inline: var(--space-5); scrollbar-gutter: stable; }
.fs-inner { animation: fs-rise 0.26s cubic-bezier(0.22, 1, 0.36, 1) both; padding-block: var(--space-6) var(--space-8); }
@keyframes fs-rise { from { opacity: 0; } }

/* 只读浏览铺一张纸：书写态是「对着空桌子写」，阅读态是「拿起写好的一页」，
   底色和投影把这层区分开，阅读宽度也收到 800px（比书写列窄一档） */
.fs-doc {
  width: 100%;
  max-width: 800px;
  margin: var(--space-5) auto var(--space-8);
  padding: var(--space-10) var(--space-12) var(--space-10);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}

.fs-atts { margin-top: var(--space-5); }

/* 只读正文：排版语言与列表卡片同源，字号行距按全屏阅读放大 */
.fs-view {
  font-size: 14.5px;
  line-height: 27px;
  color: var(--text);
  word-break: break-word;
}
.fs-view :deep(> * + *) { margin-top: var(--space-4); }
.fs-view :deep(* + h1), .fs-view :deep(* + h2), .fs-view :deep(* + h3) { margin-top: var(--space-6); }
.fs-view :deep(h1) { font-size: 24px; font-weight: 600; letter-spacing: -0.022em; line-height: 32px; }
.fs-view :deep(h2) { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; line-height: 26px; }
.fs-view :deep(h3) { font-size: 16px; font-weight: 600; line-height: 24px; }
.fs-view :deep(strong) { font-weight: 600; color: var(--text); }
.fs-view :deep(ul), .fs-view :deep(ol) { padding-left: var(--space-5); }
.fs-view :deep(li) { margin: 4px 0; }
.fs-view :deep(li::marker) { color: var(--text-faint); }
.fs-view :deep(blockquote) { border-left: 2px solid var(--accent-light); padding-left: var(--space-4); color: var(--text-secondary); }
.fs-view :deep(code) { font-family: var(--font-mono); font-size: 13px; background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: 4px; padding: 1px 5px; color: var(--text-secondary); }
.fs-view :deep(pre) { font-family: var(--font-mono); font-size: 13px; line-height: 22px; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-3) var(--space-4); overflow-x: auto; }
.fs-view :deep(pre code) { background: none; border: none; padding: 0; color: inherit; }
.fs-view :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 5px; }
.fs-view :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
.fs-view :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
.fs-view :deep(ul[data-type='taskList'] input) { accent-color: var(--accent); margin-top: 7px; }
/* 只读层里的勾选框不接操作，别让人点了以为改了状态 */
.fs-view :deep(input[type='checkbox']) { pointer-events: none; }
.fs-view :deep(hr) { border: none; border-top: 1px solid var(--border); }
.fs-view :deep(img[data-note-image]) { display: block; max-width: 100%; max-height: 56vh; object-fit: contain; border-radius: var(--radius); }

.fs-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
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
