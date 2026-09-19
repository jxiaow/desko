<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import NoteActionMenu from './NoteActionMenu.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatRelativeTime, highlightTagsInHtml } from '../../utils/format'
import type { Note, Attachment } from '../../types'
import type { NoteSaveState } from '../../stores/notes'

const props = withDefaults(defineProps<{
  note: Note
  editing?: boolean
  isBatchMode?: boolean
  isSelected?: boolean
  justPublished?: boolean
  attachments?: Attachment[]
  saveState?: NoteSaveState
}>(), {
  editing: false,
  isBatchMode: false,
  isSelected: false,
  justPublished: false,
  attachments: () => [],
  saveState: '',
})

const emit = defineEmits<{
  open: []
  update: [html: string]
  close: []
  fullscreen: []
  addImage: []
  togglePin: []
  toggleStar: []
  copy: []
  delete: []
  select: []
  tagClick: [tag: string]
  removeAttachment: [attachmentId: string]
}>()

const draft = ref(props.note.content_html)
const menuAnchor = ref<HTMLElement | null>(null)
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const clipped = ref(false)
const expanded = ref(false)

/** 浏览器判定双击的间隔上限；单击要等过这么久才生效，否则双击会先被当成展开 */
const DBLCLICK_MS = 230
let clickTimer: number | null = null
let expandedBeforeClick = false

const cancelClick = () => {
  if (clickTimer !== null) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
}

/** 上限是视口比例，窗口变化会改变是否溢出，所以量完还要跟着 resize 重算 */
const measureClipped = async () => {
  await nextTick()
  const el = bodyEl.value
  // 展开态量不出裁切（clientHeight 就等于 scrollHeight），保留上一次结果，收起时再量
  if (el && !expanded.value) clipped.value = el.scrollHeight - el.clientHeight > 1
}

onMounted(() => window.addEventListener('resize', measureClipped))
onBeforeUnmount(() => {
  window.removeEventListener('resize', measureClipped)
  cancelClick()
})

// 只读正文在编辑态会整个卸掉，回来时是一个新元素，组件本身不会重新挂载
watch(bodyEl, measureClipped)
watch(expanded, measureClipped)

// 就地编辑开始的那一刻才取快照：全屏层可能已把这行正文改过并落库
watch(() => props.editing, (on) => {
  if (on) draft.value = props.note.content_html
})

const bodyHtml = computed(() => highlightTagsInHtml(props.note.content_html))

watch(() => props.note.content_html, measureClipped)

const openEditor = () => {
  cancelClick()
  emit('open')
}

const onBodyClick = (e: MouseEvent) => {
  if (props.isBatchMode) {
    emit('select')
    return
  }
  const tag = (e.target as HTMLElement).closest<HTMLElement>('.tag-inline')?.dataset.tag
  if (tag) {
    cancelClick()
    emit('tagClick', tag)
    return
  }
  // 单击不再直接进编辑：手一抖就改了内容。等过双击窗口，只用来展开/收起被裁掉的正文
  cancelClick()
  expandedBeforeClick = expanded.value
  clickTimer = window.setTimeout(() => {
    clickTimer = null
    if (expanded.value) expanded.value = false
    else if (clipped.value) expanded.value = true
  }, DBLCLICK_MS)
}

const onBodyDblClick = () => {
  if (props.isBatchMode) return
  // 慢速双击：第一次单击可能已经把正文展开了，回到单击前的样子再进编辑
  cancelClick()
  expanded.value = expandedBeforeClick
  emit('open')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !props.isBatchMode) {
    e.preventDefault()
    emit('open')
  }
}

const onUpdate = (value: string) => {
  draft.value = value
  emit('update', value)
}

const insertTag = () => editorRef.value?.insertText(' #')
</script>

<template>
  <article
    v-if="!props.editing"
    class="memo"
    :class="{ pinned: props.note.pinned, batchable: props.isBatchMode, 'is-sel': props.isSelected, newborn: props.justPublished }"
    tabindex="0"
    role="button"
    :aria-label="`小记：${props.note.title}（单击展开全文，双击编辑）`"
    @click="onBodyClick"
    @dblclick="onBodyDblClick"
    @keydown="onKeydown"
  >
    <span v-if="props.isBatchMode" class="memo-check" :class="{ checked: props.isSelected }" aria-hidden="true">
      <AppIcon v-if="props.isSelected" name="check" :size="11" />
    </span>

    <div ref="bodyEl" class="memo-body" :class="{ clipping: clipped && !expanded, expanded }" v-html="bodyHtml" />

    <div class="memo-foot">
      <span class="memo-time">{{ formatRelativeTime(props.note.created_at) }}</span>
      <span v-if="props.attachments.length"  class="memo-att" :title="`${props.attachments.length} 个附件`">
        <AppIcon name="clip" :size="11" />
        {{ props.attachments.length }}
      </span>
      <span class="spacer"></span>
      <span class="memo-state">
        <span v-if="props.note.pinned"  class="state-pin" title="已置顶"><AppIcon name="pin" :size="12" /></span>
        <span v-if="props.note.starred"  class="state-star" title="已收藏"><AppIcon name="star" :size="12" filled /></span>
      </span>
      <span class="memo-acts">
        <button  class="ib memo-edit" type="button" title="编辑" aria-label="编辑" @click.stop="openEditor">
          <AppIcon name="edit" :size="13" />
        </button>
        <button
          class="ib"
          type="button"
          :class="{ on: props.note.pinned }"
          :title="props.note.pinned ? '取消置顶' : '置顶'"
          :aria-label="props.note.pinned ? '取消置顶' : '置顶'"
          @click.stop="emit('togglePin')"
        >
          <AppIcon name="pin" :size="13" />
        </button>
        <button
          class="ib"
          type="button"
          :class="{ on: props.note.starred, warn: props.note.starred }"
          :title="props.note.starred ? '取消收藏' : '收藏'"
          :aria-label="props.note.starred ? '取消收藏' : '收藏'"
          @click.stop="emit('toggleStar')"
        >
          <AppIcon name="star" :size="13" :filled="props.note.starred" />
        </button>
        <button  class="ib" type="button" title="更多" aria-label="更多操作" @click.stop="menuAnchor = $event.currentTarget as HTMLElement">
          <AppIcon name="dots" :size="13" />
        </button>
      </span>
    </div>

    <NoteActionMenu
      v-if="menuAnchor"
      :anchor="menuAnchor"
      @fullscreen="menuAnchor = null; emit('fullscreen')"
      @copy="emit('copy'); menuAnchor = null"
      @delete="emit('delete'); menuAnchor = null"
      @close="menuAnchor = null"
    />
  </article>

  <article v-else class="memo editing">
    <NoteEditor
      ref="editorRef"
      variant="card"
      :initial-content="draft"
      placeholder="此刻的想法…"
      @update="onUpdate"
      @submit="emit('close')"
    />
    <div v-if="props.attachments.length" class="edit-atts">
      <NoteAttachments :attachments="props.attachments" @remove="emit('removeAttachment', $event)" />
    </div>
    <div class="edit-bar">
      <NoteToolbar
        dense
        :note="props.note"
        :save-state="props.saveState"
        primary-label="完成"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @fullscreen="emit('fullscreen')"
        @toggle-pin="emit('togglePin')"
        @toggle-star="emit('toggleStar')"
        @delete="emit('delete')"
        @primary="emit('close')"
      />
    </div>
  </article>
</template>

<style scoped>
.memo {
  position: relative;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-3) var(--space-4);
  box-shadow: var(--shadow-xs);
  transition: box-shadow var(--transition), border-color var(--transition), transform var(--transition);
}
.memo:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.memo.pinned { border-color: var(--accent-light); }
.memo.editing { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-sm); }
.memo:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.memo.newborn { animation: born var(--transition-slow) cubic-bezier(0.34, 1.56, 0.64, 1) both; }
@keyframes born { from { opacity: 0; transform: translateY(-6px) scale(0.99); } }

.memo-body {
  position: relative;
  max-height: var(--memo-max-h);
  overflow: hidden;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  word-break: break-word;
  cursor: pointer;
}
.memo-body.expanded { max-height: none; }
.memo-body :deep(* + *) { margin-top: var(--space-2); }
.memo-body :deep(* + h1), .memo-body :deep(* + h2), .memo-body :deep(* + h3) { margin-top: var(--space-4); }
.memo-body :deep(h1) { font-size: 18px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.45; }
.memo-body :deep(h2) { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.5; }
.memo-body :deep(h3) { font-size: 14.5px; font-weight: 600; line-height: 1.5; }
.memo-body :deep(strong) { font-weight: 600; color: var(--text); }
.memo-body :deep(ul), .memo-body :deep(ol) { padding-left: var(--space-5); }
.memo-body :deep(li) { margin: 2px 0; }
.memo-body :deep(li::marker) { color: var(--text-faint); }
.memo-body :deep(blockquote) { border-left: 2px solid var(--accent-light); padding-left: var(--space-3); }
.memo-body :deep(code) { font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 12.5px; background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: 4px; padding: 1px 5px; color: var(--text-secondary); }
.memo-body :deep(pre) { font-family: 'SF Mono', 'Cascadia Code', Consolas, monospace; font-size: 12.5px; line-height: 1.65; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-2) var(--space-3); overflow-x: auto; }
.memo-body :deep(pre code) { background: none; border: none; padding: 0; color: inherit; }
.memo-body :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 3px; }
.memo-body :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
.memo-body :deep(ul[data-type='taskList'] input) { accent-color: var(--accent); margin-top: 5px; }
.memo-body :deep(hr) { border: none; border-top: 1px solid var(--border); }

/* 被裁掉时才铺这层渐隐，提示下面还有内容：单击正文就地展开。
   裁切边界可能正好落在段落之间的空隙上，固定 32px 会糊在空白上看不见，
   所以按行高给到三行，再被封顶高度的一半收住 */
.memo-body.clipping::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: min(5.1em, calc(var(--memo-max-h) / 2));
  background: linear-gradient(to bottom, transparent, var(--panel-bg) 72%);
  pointer-events: none;
}

.memo-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  min-height: 22px;
}
.memo-time { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.memo-att { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted); }
.memo-state { display: inline-flex; align-items: center; gap: var(--space-1); }
.state-pin { color: var(--accent); display: inline-flex; }
.state-star { color: var(--warning); display: inline-flex; }
.memo-acts { display: flex; gap: 1px; opacity: 0; transition: opacity var(--transition); }
.memo:hover .memo-acts, .memo:focus-within .memo-acts { opacity: 1; }

.memo.batchable { padding-left: var(--space-8); }
.memo-check {
  position: absolute;
  left: var(--space-3);
  top: var(--space-3);
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  background: var(--panel-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--accent-on);
  transition: all var(--transition);
}
.memo-check:hover { border-color: var(--accent); }
.memo-check.checked { background: var(--accent); border-color: var(--accent); }
.memo.is-sel { border-color: var(--accent); background: var(--accent-soft); }

.edit-atts { margin-top: var(--space-3); }
.edit-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px dashed var(--border);
}
</style>
