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
  cancel: []
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
  <section class="fs" :class="{ 'fs-read': viewMode }" role="dialog" aria-modal="true" :aria-label="viewMode ? '全屏查看小记' : props.note ? '全屏编辑小记' : '写一条小记'">
    <header class="fs-head" @mousedown="startDrag">
      <button class="fs-exit" type="button" @click="emit('close')">
        <AppIcon name="min" :size="13" />
        退出全屏
        <span class="kbd">Esc</span>
      </button>
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
        :cancel-label="props.note ? '取消' : '放弃'"
        :show-fullscreen="false"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @toggle-pin="emit('togglePin')"
        @toggle-star="emit('toggleStar')"
        @delete="emit('delete')"
        @cancel="emit('cancel')"
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
  /* 阅读面与 .app-root 同一条画布配方（global.css --canvas-bg）：这张纸要比桌亮才读得出
     是「拿起写好的一页」，桌面压到 --sunken 那档才有 1.069 的纸/桌差 */
  background: var(--canvas-bg);
  background-attachment: fixed;
}
/* 书写面分档回浅场：对着空桌子写字不需要那层桌布，--bg 亮一档 + 顶部那团主色晕更透气。
   侧栏轨本来就吃 --sidebar-bg（与画布已有 1.045 的界），所以这里换底不新增一种接缝 */
.fs:not(.fs-read) {
  background: radial-gradient(920px 420px at 50% -6%, var(--accent-soft), transparent 72%), var(--bg);
}

.fs-col {
  width: 100%;
  max-width: var(--fs-max);
  margin: 0 auto;
  padding-inline: var(--space-6);
}
/* 首尾栏铺满区域：按钮贴左右边缘，只有书写列收在 --fs-max 内 */
.fs-head {
  height: 54px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-5);
}
/* 退出钮吃页栏控件方言：30px / --radius-ib / 平时无底，hover 才上 --hover-chrome 那层洗 */
.fs-exit {
  height: 30px;
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
/* 状态字跟着退出钮走左组，与五页 .bar-count 同位；原先孤悬右端像另一条栏 */
.fs-head .save-hint { margin-right: auto; padding-left: var(--space-1); }

.fs-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  margin-bottom: 8px;
}
.fs-meta .dotsep { width: 2px; height: 2px; border-radius: 50%; background: currentColor; opacity: 0.5; }

.fs-scroll { flex: 1; overflow-y: auto; min-height: 0; }
/* 铺了纸就得给纸外留出桌沿，否则 800px 以下的窗口里纸边贴住滚动条 */
.fs-scroll:has(.fs-doc) { padding-inline: var(--space-5); scrollbar-gutter: stable; }
.fs-inner { padding-block: 12px 20px; }

/* 只读浏览铺一张纸：书写态是「对着空桌子写」，阅读态是「拿起写好的一页」，
   底色和投影把这层区分开，阅读宽度也收到 800px（比书写列窄一档）。
   投影与 .grid-card / .memo 同档（--shadow-card）：这张纸与列表里的卡是同一层东西 */
.fs-doc {
  width: 100%;
  max-width: 800px;
  margin: var(--space-5) auto var(--space-8);
  padding: 20px 28px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.fs-atts { margin-top: var(--space-5); }

/* 只读正文：排版语言与列表卡片同源，字号行距按全屏阅读放大 */
.fs-view {
  font-size: 13.5px;
  line-height: 23px;
  color: var(--text);
  word-break: break-word;
}
.fs-view :deep(> * + *) { margin-top: 10px; }
.fs-view :deep(* + h1), .fs-view :deep(* + h2), .fs-view :deep(* + h3) { margin-top: 14px; }
.fs-view :deep(h1) { font-size: var(--text-xl); font-weight: 600; letter-spacing: -0.022em; line-height: 26px; }
.fs-view :deep(h2) { font-size: var(--text-lg); font-weight: 600; letter-spacing: -0.01em; line-height: 24px; margin-top: 12px; }
.fs-view :deep(h3) { font-size: 15.5px; font-weight: 600; line-height: 22px; margin-top: 10px; }
.fs-view :deep(strong) { font-weight: 600; color: var(--text); }
.fs-view :deep(ul), .fs-view :deep(ol) { padding-left: var(--space-5); }
.fs-view :deep(li) { margin: 4px 0; }
.fs-view :deep(li::marker) { color: var(--text-faint); }
.fs-view :deep(blockquote) { border-left: 2px solid var(--accent-light); padding-left: var(--space-4); color: var(--text-secondary); }
.fs-view :deep(code) { font-family: var(--font-mono); font-size: var(--text-xs); background: var(--code-bg); border-radius: 4px; padding: 1px 5px; color: var(--accent-active); }
.fs-view :deep(pre) { font-family: var(--font-mono); font-size: var(--text-sm); line-height: 22px; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-3) var(--space-4); overflow-x: auto; }
.fs-view :deep(pre code) { background: none; border: none; padding: 0; color: inherit; }
.fs-view :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 5px; }
.fs-view :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
.fs-view :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
/* 勾选框的自绘配方在 global.css，B 档行高 23 下要往下挪一格 */
.fs-view :deep(ul[data-type='taskList'] input) { margin-top: 5px; }
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

/* ---------- 阅读态：底栏收成居中胶囊 ----------
   通高底板 + border-top + 磨砂那套在拆面轮已经从顶栏撤掉，阅读面不该留一份。
   但它必须占住一条真实行高，不能浮在 .fs-scroll 上方：浮岛盖的是通高正文，
   滚到中段时胶囊正好压在一条正文行上（09-30 那版 fixed 的实测遮挡）。
   现在胶囊自己占 50 + 20 下衬，正文滚到它就停，画布底从四周透出来，看着仍是浮着的一粒。 */
.fs-read .fs-foot {
  position: static;
  align-self: center;
  margin: 0 0 var(--space-5);
  height: 50px;
  gap: 2px;
  padding: 0 var(--space-2) 0 var(--space-3);
  max-width: calc(100% - 40px);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--panel-bg);
  box-shadow: var(--shadow-dock);
  backdrop-filter: none;
}
.fs-read .fs-foot > .spacer { flex: 0 0 auto; width: 0; margin: 0 var(--space-1); }
/* 胶囊里的动作 = .dock-btn 方言：34px 无底胶囊，常态不描边 */
.fs-read .fs-foot .eb {
  height: 34px;
  padding: 0 9px;
  gap: 6px;
  border: none;
  background: transparent;
  border-radius: var(--radius-pill);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
}
.fs-read .fs-foot .eb:hover:not(:disabled) { background: var(--hover-chrome); color: var(--text); border: none; }
.fs-read .fs-foot .eb.on { color: var(--accent); background: var(--accent-soft); border-color: transparent; }
.fs-read .fs-foot .eb.on.warn { color: var(--warning); background: var(--warning-soft); }
.fs-read .fs-foot .eb.danger { color: var(--danger); }
.fs-read .fs-foot .eb.danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); border: none; }
.fs-read .fs-foot .eb.primary { background: var(--accent); color: var(--accent-on); font-weight: 600; border: none; }
.fs-read .fs-foot .eb.primary:hover:not(:disabled) { background: var(--accent-hover); color: var(--accent-on); }

.fs-hint {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 var(--space-1);
}
</style>
