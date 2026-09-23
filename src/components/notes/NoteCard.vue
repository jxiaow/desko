<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatRelativeTime, highlightTagsInHtml } from '../../utils/format'
import { resolveAssetHtml, unreferencedAttachments } from '../../services/attachmentSrc'
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
  /** 加密小记在本会话是否已解锁（明文在手） */
  unlocked?: boolean
}>(), {
  editing: false,
  isBatchMode: false,
  isSelected: false,
  justPublished: false,
  attachments: () => [],
  saveState: '',
  unlocked: false,
})

const emit = defineEmits<{
  open: []
  update: [html: string]
  close: []
  fullscreen: []
  view: []
  encrypt: []
  unlock: []
  relock: []
  removeLock: []
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
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const clipped = ref(false)
const expanded = ref(false)

/** 上限是视口比例，窗口变化会改变是否溢出，所以量完还要跟着 resize 重算 */
const measureClipped = async () => {
  await nextTick()
  const el = bodyEl.value
  // 展开态量不出裁切（clientHeight 就等于 scrollHeight），保留上一次结果，收起时再量
  if (el && !expanded.value) clipped.value = el.scrollHeight - el.clientHeight > 1
}

onMounted(() => window.addEventListener('resize', measureClipped))
onBeforeUnmount(() => window.removeEventListener('resize', measureClipped))

// 只读正文在编辑态会整个卸掉，回来时是一个新元素，组件本身不会重新挂载
watch(bodyEl, measureClipped)
watch(expanded, measureClipped)

// 就地编辑开始的那一刻才取快照：全屏层可能已把这行正文改过并落库
watch(() => props.editing, (on) => {
  if (on) draft.value = props.note.content_html
})

// 库里存的是 attachments/<名>，只显示层临时换成本机 asset URL
const bodyHtml = computed(() => resolveAssetHtml(highlightTagsInHtml(props.note.content_html)))

/** 正文已引用的图片不再进附件条；编辑中按草稿过滤，保存前就不该闪出第二个 */
const visibleAtts = computed(() =>
  unreferencedAttachments(props.editing ? draft.value : props.note.content_html, props.attachments))

watch(() => props.note.content_html, measureClipped)

const openEditor = () => emit('open')

/**
 * 只读卡片上的勾选框是真控件，点下去必须落库。
 * 改的是模型 HTML（不是页面上那个 input）：浏览器的默认勾选先 preventDefault 掉，
 * 状态一律由 content_html 重新渲染出来，否则存不上却已经亮给用户看了。
 */
const toggleTask = (e: MouseEvent, box: HTMLInputElement) => {
  e.preventDefault()
  const rendered = Array.from(
    bodyEl.value?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [],
  )
  const index = rendered.indexOf(box)
  if (index < 0) return

  const doc = new DOMParser().parseFromString(props.note.content_html, 'text/html')
  const items = doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
  const target = items[index]
  if (!target) return

  const checked = !target.hasAttribute('checked')
  if (checked) target.setAttribute('checked', 'checked')
  else target.removeAttribute('checked')
  // Tiptap 的 TaskItem 认 li 上的 data-checked，少记一个进编辑态就弹回
  target.closest('li')?.setAttribute('data-checked', String(checked))
  emit('update', doc.body.innerHTML)
}

/** 加密且明文不在手：整张卡退化成一个锁标识 */
const locked = computed(() => props.note.encrypted && !props.unlocked)

const onBodyClick = (e: MouseEvent) => {
  if (props.isBatchMode) {
    emit('select')
    return
  }
  if (locked.value) {
    emit('unlock')
    return
  }
  const box = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]')
  if (box) {
    toggleTask(e, box)
    return
  }
  const tag = (e.target as HTMLElement).closest<HTMLElement>('.tag-inline')?.dataset.tag
  if (tag) {
    emit('tagClick', tag)
    return
  }
  // 单击只展开/收起被裁掉的正文；编辑走悬停按钮或 Enter，不再有双击
  if (expanded.value) expanded.value = false
  else if (clipped.value) expanded.value = true
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter' || props.isBatchMode) return
  e.preventDefault()
  if (locked.value) emit('unlock')
  else emit('open')
}

const onUpdate = (value: string) => {
  draft.value = value
  emit('update', value)
}

const insertTag = () => editorRef.value?.insertText(' #')
const insertImage = (src: string) => editorRef.value?.insertImage(src)

// 暴露出去的实例只剩这两个键：props 不在代理上，外面要认哪张卡只能靠 noteId
defineExpose({ insertImage, noteId: computed(() => props.note.id) })
</script>

<template>
  <article
    v-if="!props.editing"
    class="memo"
    :class="{ pinned: props.note.pinned, batchable: props.isBatchMode, 'is-sel': props.isSelected, newborn: props.justPublished }"
    tabindex="0"
    role="button"
    :aria-label="locked ? `已加密小记${props.note.title ? '：' + props.note.title : ''}（${formatRelativeTime(props.note.created_at)}，单击解锁）` : `小记：${props.note.title}（单击展开全文，悬停或 Enter 编辑）`"
    @click="onBodyClick"
    @keydown="onKeydown"
  >
    <span v-if="props.isBatchMode" class="memo-check" :class="{ checked: props.isSelected }" aria-hidden="true">
      <AppIcon v-if="props.isSelected" name="check" :size="11" />
    </span>

    <div class="memo-head" @click.stop>
      <span class="memo-time">{{ formatRelativeTime(props.note.created_at) }}</span>
      <span v-if="!locked && visibleAtts.length" class="memo-att" :title="`${visibleAtts.length} 个附件`">
        <AppIcon name="clip" :size="11" />
        {{ visibleAtts.length }}
      </span>
      <span class="memo-state">
        <span v-if="props.note.starred" class="state-star" title="已收藏"><AppIcon name="star" :size="12" filled /></span>
      </span>
      <span class="memo-acts">
        <button v-if="locked" class="ib" type="button" title="解锁" aria-label="解锁" @click.stop="emit('unlock')">
          <AppIcon name="unlock" :size="13" />
        </button>
        <template v-if="!locked">
          <button class="ib" type="button" title="全屏查看" aria-label="全屏查看" @click.stop="emit('view')">
            <AppIcon name="eye" :size="13" />
          </button>
          <button class="ib memo-edit" type="button" title="编辑" aria-label="编辑" @click.stop="openEditor">
            <AppIcon name="edit" :size="13" />
          </button>
        </template>
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
        <button v-if="!locked" class="ib" type="button" title="复制正文" aria-label="复制正文" @click.stop="emit('copy')">
          <AppIcon name="copy" :size="13" />
        </button>
        <button v-if="!locked && !props.note.encrypted" class="ib" type="button" title="加密" aria-label="加密" @click.stop="emit('encrypt')">
          <AppIcon name="lock" :size="13" />
        </button>
        <button v-if="!locked && props.note.encrypted" class="ib" type="button" title="重新锁定" aria-label="重新锁定" @click.stop="emit('relock')">
          <AppIcon name="lock" :size="13" />
        </button>
        <button v-if="!locked && props.note.encrypted" class="ib" type="button" title="解除加密" aria-label="解除加密" @click.stop="emit('removeLock')">
          <AppIcon name="lockOff" :size="13" />
        </button>
        <button class="ib danger" type="button" title="删除" aria-label="删除" @click.stop="emit('delete')">
          <AppIcon name="trash" :size="13" />
        </button>
      </span>
    </div>

    <div v-if="locked" class="memo-locked">
      <AppIcon name="lock" :size="13" />
      <span v-if="props.note.title" class="locked-title">{{ props.note.title }}</span>
      <span class="locked-hint">{{ props.note.title ? '· 单击解锁' : '已加密 · 单击解锁' }}</span>
    </div>
    <div v-else ref="bodyEl" class="memo-body" :class="{ clipping: clipped && !expanded, expanded }" v-html="bodyHtml" />
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
    <div v-if="visibleAtts.length" class="edit-atts">
      <NoteAttachments :attachments="visibleAtts" @remove="emit('removeAttachment', $event)" />
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
  padding: var(--space-2) var(--space-4);
  box-shadow: var(--shadow-xs);
  transition: box-shadow var(--transition), border-color var(--transition), background-color var(--transition), transform var(--transition);
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
  line-height: 1.6;
  color: var(--text);
  word-break: break-word;
  cursor: pointer;
}
.memo-body.expanded { max-height: none; }

/* 加密锁标识：占掉正文位置，一眼知道这条要看密码 */
.memo-locked {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  font-size: 13px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.memo-locked svg { color: var(--warning); flex-shrink: 0; }
/* 锁着也认得出是哪条：只有真标题（h1–h3）会留明文，其余只剩提示语 */
.locked-title { color: var(--text); font-weight: 500; }
/* 只给正文顶层块加间距，理由同 NoteEditor：* + * 会把任务项的正文压到勾选框下面 */
.memo-body :deep(> * + *) { margin-top: var(--space-2); }
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
.memo-body :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
.memo-body :deep(ul[data-type='taskList'] input) { accent-color: var(--accent); margin-top: 5px; cursor: pointer; }
.memo-body :deep(hr) { border: none; border-top: 1px solid var(--border); }
.memo-body :deep(img[data-note-image]) { display: block; max-width: 100%; max-height: 34vh; object-fit: contain; border-radius: var(--radius); }

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

/* 顶部一行：时间 / 附件 / 收藏标 + 操作按钮，正文区零遮挡 */
.memo-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 3px;
  min-height: 20px;
}
.memo-time { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.memo-att { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-muted); }
/* 状态标只在不悬停时出现：悬停后动作排上的同一个图标已带状态，两个并排就是重复 */
.memo-state { display: inline-flex; align-items: center; gap: var(--space-1); transition: opacity var(--transition); }
.memo:hover .memo-state, .memo:focus-within .memo-state { opacity: 0; }
.state-star { color: var(--warning); display: inline-flex; }
.memo-acts { display: flex; gap: 1px; margin-left: auto; opacity: 0; transition: opacity var(--transition); }
.memo:hover .memo-acts, .memo:focus-within .memo-acts { opacity: 1; }
.memo-acts .ib { width: 28px; height: 28px; }
.memo-acts .ib :deep(svg) { width: 15px; height: 15px; }
/* 删除和其余动作拉开一格，别让人顺手滑过去 */
.memo-acts .ib.danger { margin-left: var(--space-1); }

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
.memo.is-sel {
  /* 浸润底 + 1px 实环把整张卡包一圈，和 .entry-card.selected 同一套选中语言 */
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm);
  transform: translateY(-1px);
}
/* 小记没有独立的标题节点，正文首块就是标题行，选中时跟着上主色 */
.memo.is-sel .memo-body :deep(> :first-child) { color: var(--text-brand); }

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
