<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isWebRuntime } from '../../services/runtime'
import { openLinkFromClick } from '../../utils/openExternal'
import { getCurrentWindow } from '@tauri-apps/api/window'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import NoteMoreMenu from './NoteMoreMenu.vue'
import NoteScrollTop from './NoteScrollTop.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatAbsTime, stripTagsFromHtml, htmlToText, wordCount } from '../../utils/format'
import { noteDisplay } from '../../utils/noteDisplay'
import { sanitizeNoteHtml } from '../../utils/sanitizeNoteHtml'
import { collectAttachmentNames, resolveAssetHtml, unreferencedAttachments, type SaveImage } from '../../services/attachmentSrc'
import type { NoteExportFormat } from '../../utils/noteExport'
import type { Note, Attachment } from '../../types'
import { noteMeta, type NoteSaveState } from '../../stores/notes'
import { useEscapeClose } from '../../composables/useEscapeClose'
import { usePageActive } from '../../composables/usePageActive'
import { useWorkspaceLayout, workspaceToolbarTarget } from '../layout/workspaceLayout'

const props = withDefaults(defineProps<{
  /** null 表示这是一条还没发布的小记（从胶囊输入进入全屏） */
  note: Note | null
  initialHtml: string
  attachments?: Attachment[]
  saveState?: NoteSaveState
  /** view = 只读浏览已存的小记；edit = 书写面 */
  mode?: 'edit' | 'view'
  /** 全屏书写面把剪贴板图片落盘的回调 */
  saveImage?: SaveImage
}>(), {
  attachments: () => [],
  saveState: '',
  mode: 'edit',
})

const emit = defineEmits<{
  update: [html: string]
  close: []
  discard: []
  publish: []
  edit: []
  addImage: []
  togglePin: []
  toggleStar: []
  toggleArchive: []
  copy: []
  delete: []
  export: [format: NoteExportFormat]
  encrypt: []
  relock: []
  removeLock: []
  removeAttachment: [attachmentId: string]
  tagClick: [tag: string]
}>()

const html = ref(props.initialHtml)
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const pageActive = usePageActive()
const workspaceLayout = useWorkspaceLayout()
const headerInTitlebar = computed(() => workspaceLayout && pageActive.value)
const headerRef = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

const viewMode = computed(() => props.mode === 'view')
/** 查看态直接跟库里的正文走，不走编辑草稿的本地快照 */
const contentHtml = computed(() =>
  viewMode.value ? props.note?.content_html ?? '' : html.value)
const displayHtml = computed(() => resolveAssetHtml(stripTagsFromHtml(sanitizeNoteHtml(contentHtml.value))))
const display = computed(() => noteDisplay(displayHtml.value))
const noteTags = computed(() => noteMeta(contentHtml.value).tags)
const edited = computed(() => !!props.note && props.note.updated_at - props.note.created_at > 60_000)

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
/** 全屏面既写已存的小记也写草稿，note 为空就是草稿 */
const saveImageToSurface = async (source: File | string) =>
  (await props.saveImage?.(source, props.note?.id ?? null)) ?? null

/** 编辑器把 canUndo/canRedo 挂在暴露的 ref 上，这里包一层只读给底栏那两颗钮 */
const canUndo = computed(() => !!editorRef.value?.canUndo)
const canRedo = computed(() => !!editorRef.value?.canRedo)

defineExpose({ insertImage })

const onPrimary = () => {
  if (props.note) emit('close')
  else emit('publish')
}

const startDrag = (e: MouseEvent) => {
  if (isWebRuntime()) return
  if ((e.target as HTMLElement).closest('button, input, a')) return
  getCurrentWindow().startDragging().catch(() => {})
}

// 和目录、确认框共用关闭栈：Escape 只关闭最上层。
useEscapeClose(() => emit('close'), undefined, { afterTarget: true })

const surfaceRef = ref<HTMLElement | null>(null)
onMounted(() => {
  if (!surfaceRef.value?.contains(document.activeElement)) surfaceRef.value?.focus()
})

function trapFocus(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  // 标题栏中的操作与正文同属这个阅读面，Tab 顺序也要一起收拢。
  const roots = headerInTitlebar.value ? [headerRef.value!, surfaceRef.value!] : [surfaceRef.value!]
  const controls = roots.flatMap(root => Array.from(root.querySelectorAll<HTMLElement>(
    'button, a[href], input, textarea, select, [tabindex], [contenteditable="true"]',
  ))).filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  const at = controls.indexOf(document.activeElement as HTMLElement)
  event.preventDefault()
  if (!controls.length) surfaceRef.value?.focus()
  else {
    const next = at < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
    controls[next].focus()
  }
}
</script>

<template>
  <section ref="surfaceRef" class="fs" role="dialog" aria-modal="true" tabindex="-1" :aria-owns="headerInTitlebar ? 'note-fullscreen-toolbar' : undefined" :aria-label="viewMode ? '全屏查看小记' : props.note ? '全屏编辑小记' : '写一条小记'" @keydown.tab="trapFocus">
    <Teleport :to="workspaceToolbarTarget" :disabled="!headerInTitlebar" defer>
    <header id="note-fullscreen-toolbar" ref="headerRef" class="fs-head" data-workspace-heading="replace" data-workspace-toolbar="exclusive" :class="{ 'workspace-fs-head': headerInTitlebar, 'fs-reading-head': viewMode }" @mousedown="startDrag" @keydown.tab.stop="trapFocus">
      <button class="fs-exit" type="button" @click="emit('close')">
        <AppIcon name="min" :size="13" />
        退出全屏
        <span class="kbd">Esc</span>
      </button>
      <span class="save-hint" :class="props.saveState">
        {{ viewMode ? '只读浏览' : saveText[props.saveState] || (props.note ? '自动保存' : '未保存') }}<template v-if="props.note && !viewMode"> · {{ wordCount(text) }} 字</template>
      </span>

      <!-- 小记级动作只有首栏这一个住址：读写两态同一组按钮，主按钮只换字 -->
      <template v-if="props.note">
        <button
          class="bar-btn"
          type="button"
          :class="{ on: props.note.pinned }"
          :title="props.note.pinned ? '取消置顶' : '置顶'"
          :aria-label="props.note.pinned ? '取消置顶' : '置顶'"
          @click="emit('togglePin')"
        >
          <AppIcon :name="props.note.pinned ? 'unpin' : 'pin'" :size="13" />{{ props.note.pinned ? '取消置顶' : '置顶' }}
        </button>
        <button v-if="viewMode" class="bar-btn primary" type="button" title="进入全屏编辑" aria-label="编辑" @click="emit('edit')">
          <AppIcon name="edit" :size="13" />编辑
        </button>
        <button v-else class="bar-btn primary" type="button" title="完成编辑（自动保存）" aria-label="完成" @click="onPrimary">
          <AppIcon name="check" :size="13" />完成
        </button>
        <button class="bar-btn" type="button" title="复制正文" aria-label="复制正文" @click="emit('copy')">
          <AppIcon name="copy" :size="13" />复制
        </button>
        <NoteMoreMenu
          variant="bar"
          :note="props.note"
          @toggle-star="emit('toggleStar')"
          @toggle-archive="emit('toggleArchive')"
          @export="emit('export', $event)"
          @encrypt="emit('encrypt')"
          @relock="emit('relock')"
          @remove-lock="emit('removeLock')"
          @delete="emit('delete')"
        />
      </template>
      <!-- 新小记还没有可操作的小记对象：首栏只放提交，底栏只放写作工具 -->
      <template v-else-if="!viewMode">
        <button v-if="!empty" class="bar-btn" type="button" title="放弃这条小记" aria-label="放弃" @click="emit('discard')">
          <AppIcon name="x" :size="13" />放弃
        </button>
        <button class="bar-btn primary" type="button" title="保存这条小记" aria-label="保存" :disabled="empty" @click="onPrimary">
          <AppIcon name="check" :size="13" />保存
        </button>
      </template>
    </header>
    </Teleport>

    <div ref="scrollRef" class="fs-scroll">
      <div class="fs-inner" :class="viewMode ? 'fs-doc' : 'fs-col'">
        <h1 v-if="viewMode && display.title" class="fs-title">{{ display.title }}</h1>
        <!-- 元信息只在阅读态占一行；书写面第一行直接是正文，元信息并进底栏 -->
        <div v-if="viewMode" class="fs-meta">
          <span>{{ props.note ? `创建于 ${formatAbsTime(props.note.created_at)}` : '新小记' }}</span>
          <template v-if="edited && props.note">
            <span class="dotsep"></span>
            <span :title="`更新于 ${formatAbsTime(props.note.updated_at)}`">已编辑</span>
          </template>
          <span class="dotsep"></span>
          <span>{{ wordCount(text) }} 字</span>
        </div>

        <div v-if="viewMode" class="fs-view note-doc" :class="{ promoted: display.hideFirstBlock }" v-html="displayHtml" @click="openLinkFromClick" />
        <NoteEditor
          v-else
          ref="editorRef"
          variant="full"
          :initial-content="html"
          :save-image="saveImageToSurface"
          :placeholder="props.note ? '' : '此刻的想法…'"
          @update="onUpdate"
          @submit="onPrimary"
          @escape="emit('close')"
        />

        <div v-if="viewMode && noteTags.length" class="fs-tags">
          <button v-for="tag in noteTags" :key="tag" class="tag-pill" type="button" :title="`按 #${tag} 筛选`" @click="emit('tagClick', tag)">#{{ tag }}</button>
        </div>
        <div v-if="visibleAtts.length" class="fs-atts">
          <NoteAttachments :attachments="visibleAtts" @remove="emit('removeAttachment', $event)" />
        </div>
      </div>
    </div>

    <div v-if="!viewMode" class="fs-scroll-actions">
      <NoteScrollTop :target="scrollRef" />
    </div>
    <footer v-if="!viewMode" class="fs-foot">
      <NoteToolbar
        :note="props.note"
        :save-state="props.saveState"
        :show-fullscreen="false"
        :show-state-actions="false"
        :show-primary="false"
        show-history
        :can-undo="canUndo"
        :can-redo="canRedo"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @undo="editorRef?.undo()"
        @redo="editorRef?.redo()"
      >
        <template #hint>
          <span
            class="fs-hint"
            :title="`完整快捷语法：# / ## / ### 空格 标题\n- 或 + 空格 无序列表 · 1. 空格 有序列表\n&gt; 空格 引用 · \`\`\` 空格 代码块\n[] 或 [x] 空格 任务 · --- 分割线\n**粗** *斜* ~~删~~ \`码\``"
          ><span class="kbd">/</span> 命令 · <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span></span>
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
  /* 阅读与书写都落在浮片上：实底、不吃窗框的柔光。 */
  background: var(--bg-sheet, var(--bg-editor));
}
.fs-col {
  width: 100%;
  /* 与阅读列同一个公式：书写看到多少字一行，提交后就是多少字一行 */
  max-width: clamp(800px, 80%, var(--fs-max));
  margin: 0 auto;
  padding-inline: 0;
}
/* 桌面操作并入 48px 通栏顶栏；浏览器内保留同档的页内操作行。 */
.fs-head {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-5);
}
.workspace-fs-head { flex: 1; min-width: 0; padding: 0; }
.workspace-fs-head :deep(button), .workspace-fs-head .save-hint { pointer-events: auto; }
/* 退出与阅读动作使用当前顶栏的 32px 控件档。 */
.fs-exit {
  height: 32px;
  padding: 0 var(--space-2);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--radius-ib);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition);
  font-family: inherit;
  flex-shrink: 0;
}
.fs-exit:hover { color: var(--text); background: var(--hover-chrome); }
.fs-exit .kbd { background: transparent; border-bottom-width: 1px; }
/* 状态字跟着退出钮走左组，原先孤悬右端像另一条栏 */
.fs-head .save-hint { margin-right: auto; padding-left: var(--space-1); }

.fs-title {
  margin-bottom: 8px;
  font-size: var(--text-xl);
  line-height: 26px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--text);
  overflow-wrap: anywhere;
}
.fs-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-canvas-meta);
  margin-bottom: 8px;
}
.fs-meta .dotsep { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: 0.5; }

/* 水平留白两态一致：阅读与书写之间只换内容，不换列位，否则切一次眼就得重找行首。 */
.fs-scroll { flex: 1; overflow-y: auto; scrollbar-gutter: stable; min-height: 0; padding-inline: var(--workspace-gutter, var(--space-5)); }
.fs-scroll-actions { position: relative; flex-shrink: 0; }
.fs-inner { padding-block: 12px 20px; }

/* 阅读列直接落在工作区画布上，用行长和留白组织内容。 */
.fs-doc {
  width: 100%;
  max-width: clamp(800px, 80%, var(--fs-max));
  margin: var(--space-8) auto var(--space-8);
  padding: 0;
}

.fs-atts { margin-top: var(--space-5); }
.fs-tags { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-4); }
.tag-pill {
  height: 20px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--fill);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.tag-pill:hover { background: var(--accent-soft); color: var(--accent); }

/* 只读正文与书写面共用 global.css 的 .note-doc：预览和编辑只有一套排版，
   这里只剩两处只读专属：首屏把已提升为标题的首块藏掉、勾选框不接操作 */
.fs-view.promoted :deep(> :first-child) { display: none; }
.fs-view.promoted :deep(> :first-child + *) { margin-top: 0; }
/* 只读层里的勾选框不接操作，别让人点了以为改了状态 */
.fs-view :deep(input[type='checkbox']) { pointer-events: none; }

/* 底栏不铺色、不画顶线：书写面上只允许纸这一种底色，按钮自身的面与描边负责读出边界 */
.fs-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
}

/* 编辑沿用标题栏主操作的淡染，次级操作保持无底。 */
.fs-head .bar-btn { height: 32px; }
/* 置顶是状态不是主操作：只染字色，页头那一颗实心留给「编辑」；
   字色走 --text-brand，与目录选中态、主操作同一档可读色 */
.fs-head .bar-btn.on { background: transparent; color: var(--text-brand); font-weight: 500; }
.fs-head .bar-btn.on:hover:not(:disabled) { background: var(--hover-chrome); color: var(--text-brand); }
.fs-head .bar-btn.primary { background: var(--accent-soft); color: var(--text-brand); font-weight: 600; padding: 0 12px; }
.fs-head .bar-btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--text-brand); }
/* 窄栏（800px 窗再带 Web/云徽标时首栏只剩 ~416px）放不下状态字：
   读写两态都让状态让位给动作，退出钮吃掉省下的 auto 外边距 */
@container workspace-toolbar (max-width: 520px) {
  .workspace-fs-head .save-hint, .workspace-fs-head .fs-exit .kbd { display: none; }
  .workspace-fs-head .fs-exit { margin-right: auto; }
}
/* 页内首栏没有 workspace-toolbar 容器，同样在窄屏收掉状态字 */
@media (max-width: 640px) {
  .fs-head { gap: var(--space-1); }
  .fs-head .save-hint, .fs-head .fs-exit .kbd { display: none; }
  .fs-head .fs-exit { margin-right: auto; }
}

.fs-hint {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 var(--space-1);
}
</style>
