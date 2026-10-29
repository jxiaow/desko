<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePageActive } from '../../composables/usePageActive'
import NoteEditor from './NoteEditor.vue'
import NoteToolbar from './NoteToolbar.vue'
import NoteAttachments from './NoteAttachments.vue'
import NoteMoreMenu from './NoteMoreMenu.vue'
import AppIcon from '../shared/AppIcon.vue'
import { formatAbsTime, formatRelativeTime, stripTagsFromHtml } from '../../utils/format'
import { noteDisplay } from '../../utils/noteDisplay'
import { sanitizeNoteHtml } from '../../utils/sanitizeNoteHtml'
import { resolveAssetHtml, unreferencedAttachments, type SaveImage } from '../../services/attachmentSrc'
import type { Note, Attachment } from '../../types'
import { noteMeta, type NoteSaveState } from '../../stores/notes'
import { isWebRuntime } from '../../services/runtime'
import { openLinkFromClick } from '../../utils/openExternal'
import type { NoteExportFormat } from '../../utils/noteExport'

const pageActive = usePageActive()
const props = withDefaults(defineProps<{
  note: Note
  editing?: boolean
  isBatchMode?: boolean
  isSelected?: boolean
  attachments?: Attachment[]
  saveState?: NoteSaveState
  /** 加密小记在本会话是否已解锁（明文在手） */
  unlocked?: boolean
  /** 当前生效的标签筛选，用于把命中的胶囊点亮 */
  activeTags?: Set<string>
  /** 本卡渲染在归档视图里：动作排换成「取消归档」，书写类动作照旧 */
  archivedView?: boolean
  exportDisabled?: boolean
  /** 就地编辑时把剪贴板里的图片落盘到这张小记 */
  saveImage?: SaveImage
}>(), {
  editing: false,
  isBatchMode: false,
  isSelected: false,
  attachments: () => [],
  saveState: '',
  unlocked: false,
  activeTags: () => new Set<string>(),
  archivedView: false,
  exportDisabled: false,
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
  toggleArchive: []
  copy: []
  delete: []
  select: []
  tagClick: [tag: string]
  removeAttachment: [attachmentId: string]
  export: [format: NoteExportFormat]
}>()

const draft = ref(props.note.content_html)
const editorRef = ref<InstanceType<typeof NoteEditor> | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const clipped = ref(false)
const expanded = ref(false)

/** 截断容差：只藏掉这么多像素就不算截断，别为一行空隙冒出「展开全文」 */
const CLAMP_TOL = 8

/**
 * 整行截断：--memo-max-h 只是预算，真正的上限取最后一个完整子块的下边界，
 * 砍在 max-height 上的半行没法靠渐隐遮罩藏掉。
 */
const applyClamp = async () => {
  await nextTick()
  const el = bodyEl.value
  if (!el || !pageActive.value) return
  // 内联上限一清就回到 CSS 预算，展开态也正是要全露，两种情况都只留这一句
  el.style.maxHeight = ''
  // 展开态量不出截断（内容全露），保留上一次结果，收起时再重算
  if (expanded.value) return

  const style = getComputedStyle(el)
  const budget = parseFloat(style.maxHeight) || Number.MAX_SAFE_INTEGER
  const lineH = parseFloat(style.lineHeight) || 23
  const kids = Array.from(el.children) as HTMLElement[]
  let cut = 0
  let cutIndex = -1
  for (let i = 0; i < kids.length; i++) {
    const bottom = kids[i].offsetTop + kids[i].offsetHeight
    if (bottom > budget + 1) break
    cut = bottom
    cutIndex = i
  }
  // 孤行标题：最后一块正好是标题、后面还有正文，收起来就剩个头悬在「展开全文」上
  const last = kids[cutIndex]
  if (cutIndex >= 0 && cutIndex < kids.length - 1 && /^H[1-4]$/.test(last?.tagName ?? '')) {
    const prev = kids[cutIndex - 1]
    cut = prev ? prev.offsetTop + prev.offsetHeight : 0
  }
  // 首块就超预算时按整行切，至少露得出开头
  if (cut === 0) cut = Math.max(1, Math.floor(budget / lineH)) * lineH

  clipped.value = el.scrollHeight > cut + CLAMP_TOL
  if (clipped.value) el.style.maxHeight = `${Math.round(cut)}px`
}

const onResize = () => applyClamp()

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

// 只读正文在编辑态会整个卸掉，回来时是一个新元素，组件本身不会重新挂载
watch(bodyEl, applyClamp)
watch(expanded, applyClamp)
watch(pageActive, visible => { if (visible) void applyClamp() })

// 就地编辑开始的那一刻才取快照：全屏层可能已把这行正文改过并落库
watch(() => props.editing, (on) => {
  if (on) draft.value = props.note.content_html
})

// 库里存的是 attachments/<名>，只显示层临时换成本机 asset URL
const bodyHtml = computed(() => resolveAssetHtml(stripTagsFromHtml(sanitizeNoteHtml(props.note.content_html))))

/** 正文已引用的图片不再进附件条；编辑中按草稿过滤，保存前就不该闪出第二个 */
const visibleAtts = computed(() =>
  unreferencedAttachments(props.editing ? draft.value : props.note.content_html, props.attachments))

watch(() => props.note.content_html, applyClamp)

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

/**
 * 只有明确设置标题格式的首块才显示为标题行；普通段落、引用和自动摘要都不充当标题。
 * 列表 / 任务 / 图片等结构始终保留在正文。
 * 藏用 display:none 而非删节点：toggleTask 靠「渲染序 == 库序」对位，删了会错位。
 */
const display = computed(() => noteDisplay(locked.value ? '' : bodyHtml.value))
const promote = computed(() => display.value.hideFirstBlock)
const titleText = computed(() => display.value.title || props.note.title || '未命名')
const edited = computed(() => props.note.updated_at - props.note.created_at > 60_000)

/** 列表标签只在底部展示，与筛选、分类共用 noteMeta 的派生结果。 */
const noteTags = computed(() => (locked.value ? [] : noteMeta(props.note.content_html).tags))

/* 头部条不吃正文点击（时间/附件/操作按钮区），但批量态下整卡都是选择热区。 */
const onHeadClick = (e: MouseEvent) => {
  e.stopPropagation()
  if (props.isBatchMode) emit('select')
}

const onBodyClick = (e: MouseEvent) => {
  if (props.isBatchMode) {
    e.preventDefault()
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
  // 正文里的链接是内容不是入口：点开交给本机浏览器，别顺路把卡片切到编辑态
  if (openLinkFromClick(e)) return
  // 展开收起交给正文下的显式按钮：正文单击曾是唯一的展开入口，但它和框选文字冲突
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
  e.preventDefault()
  if (props.isBatchMode) emit('select')
  else if (locked.value) emit('unlock')
  else emit('open')
}

const onUpdate = (value: string) => {
  draft.value = value
  emit('update', value)
}

const insertTag = () => editorRef.value?.insertText(' #')
const insertImage = (src: string) => editorRef.value?.insertImage(src)
/** 就地编辑写的就是这张卡，落盘时替编辑器把目标报上 */
const saveImageToNote = async (source: File | string) => (await props.saveImage?.(source, props.note.id)) ?? null
const canUndo = computed(() => !!editorRef.value?.canUndo)
const canRedo = computed(() => !!editorRef.value?.canRedo)

// 暴露出去的实例只剩这两个键：props 不在代理上，外面要认哪张卡只能靠 noteId
defineExpose({ insertImage, noteId: computed(() => props.note.id) })
</script>

<template>
  <article
    v-if="!props.editing"
    class="memo"
    :class="{ pinned: props.note.pinned, batchable: props.isBatchMode, 'is-sel': props.isSelected, locked, 'without-title': !display.title }"
    tabindex="0"
    role="button"
    :aria-pressed="props.isBatchMode ? props.isSelected : undefined"
    :aria-label="props.isBatchMode ? `选择小记：${titleText}` : locked ? `已加密小记${props.note.title ? '：' + props.note.title : ''}（${formatRelativeTime(props.note.created_at)}，点击解锁）` : `小记：${titleText}（Enter 或悬停按钮编辑）`"
    @click="onBodyClick"
    @keydown="onKeydown"
  >
    <span class="memo-check" :class="{ checked: props.isSelected }" aria-hidden="true" @click.stop="emit('select')">
      <AppIcon v-if="props.isSelected" name="check" :size="12" />
    </span>

    <div class="memo-head" @click="onHeadClick">
      <span v-if="display.title" class="memo-title">{{ display.title }}</span>
      <span class="memo-state">
        <span v-if="props.note.starred" class="state-star" title="已收藏"><AppIcon name="star" :size="12" filled /></span>
      </span>
      <span class="memo-time" :title="edited ? `更新于 ${formatAbsTime(props.note.updated_at)}` : undefined">{{ formatRelativeTime(props.note.created_at) }}<template v-if="edited"> · 已编辑</template></span>

      <!-- hover 显形的动作排：常用五颗，其余进 ⋯（时间在排后让位，实底不吃正文） -->
      <span v-if="!props.isBatchMode" class="memo-acts">
        <template v-if="locked">
          <button class="ib" type="button" title="解锁" aria-label="解锁" @click.stop="emit('unlock')">
            <AppIcon name="unlock" :size="14" />
          </button>
          <NoteMoreMenu v-if="!isWebRuntime()" sealed :note="props.note" :export-disabled="props.exportDisabled" @export="emit('export', $event)" />
        </template>
        <template v-else>
          <button class="ib memo-desktop-action" type="button" title="全屏查看" aria-label="全屏查看" @click.stop="emit('view')">
            <AppIcon name="eye" :size="14" />
          </button>
          <button class="ib memo-edit memo-desktop-action" type="button" title="编辑" aria-label="编辑" @click.stop="openEditor">
            <AppIcon name="edit" :size="14" />
          </button>
          <button
            v-if="!props.archivedView"
            class="ib memo-desktop-action"
            type="button"
            :class="{ on: props.note.pinned }"
            :title="props.note.pinned ? '取消置顶' : '置顶'"
            :aria-label="props.note.pinned ? '取消置顶' : '置顶'"
            @click.stop="emit('togglePin')"
          >
            <AppIcon name="pin" :size="14" />
          </button>
          <button
            v-else
            class="ib memo-desktop-action"
            type="button"
            title="取消归档，放回「全部」"
            aria-label="取消归档"
            @click.stop="emit('toggleArchive')"
          >
            <AppIcon name="unarchive" :size="14" />
          </button>
          <button class="ib" type="button" title="复制正文" aria-label="复制正文" @click.stop="emit('copy')">
            <AppIcon name="copy" :size="15" />
          </button>
          <NoteMoreMenu
            :note="props.note"
            :mobile-actions="isWebRuntime()"
            :archived-view="props.archivedView"
            :export-disabled="props.exportDisabled"
            @toggle-pin="emit('togglePin')"
            @view="emit('view')"
            @edit="openEditor"
            @toggle-star="emit('toggleStar')"
            @toggle-archive="emit('toggleArchive')"
            @export="emit('export', $event)"
            @encrypt="emit('encrypt')"
            @relock="emit('relock')"
            @remove-lock="emit('removeLock')"
            @delete="emit('delete')"
          />
        </template>
      </span>
    </div>

    <div v-if="locked" class="memo-locked">
      <span class="lock-disc"><AppIcon name="lock" :size="16" /></span>
      <span class="lock-meta">
        <span v-if="props.note.title" class="locked-title">{{ props.note.title }}</span>
        <span class="locked-hint">{{ props.note.title ? '· 点击解锁' : '已加密 · 点击解锁' }}</span>
      </span>
    </div>
    <template v-else>
      <div
        ref="bodyEl"
        class="memo-body"
        :class="{ expanded, promoted: promote }"
        v-html="bodyHtml"
        @load.capture="applyClamp"
      />
      <button
        v-if="clipped && !props.isBatchMode"
        class="memo-unfold"
        type="button"
        :aria-expanded="expanded"
        @click.stop="expanded = !expanded"
      >
        <AppIcon name="chevDown" :size="12" :class="{ up: expanded }" />
        {{ expanded ? '收起' : '展开全文' }}
      </button>
    </template>

    <div v-if="!locked && (visibleAtts.length || noteTags.length)" class="memo-foot" @click="onHeadClick">
      <span v-if="visibleAtts.length" class="memo-att" :title="`${visibleAtts.length} 个附件`">
        <AppIcon name="clip" :size="12" />
        {{ visibleAtts.length }}
      </span>
      <span v-if="noteTags.length" class="memo-tags">
        <button
          v-for="t in noteTags"
          :key="t"
          class="tag-pill"
          :class="{ on: props.activeTags.has(t) }"
          type="button"
          :disabled="props.isBatchMode"
          :title="props.activeTags.has(t) ? `取消按 #${t} 筛选` : `按 #${t} 筛选`"
          :aria-pressed="props.activeTags.has(t)"
          @click.stop="emit('tagClick', t)"
        >#{{ t }}</button>
      </span>
    </div>
  </article>

  <article v-else class="memo editing">
    <div class="edit-bar">
      <span class="memo-time" :title="edited ? `更新于 ${formatAbsTime(props.note.updated_at)}` : undefined">{{ formatRelativeTime(props.note.created_at) }}<template v-if="edited"> · 已编辑</template></span>
      <NoteToolbar
        dense
        :show-state-actions="false"
        :note="props.note"
        :save-state="props.saveState"
        primary-label="退出编辑"
        show-history
        :can-undo="canUndo"
        :can-redo="canRedo"
        @add-image="emit('addImage')"
        @insert-tag="insertTag"
        @fullscreen="emit('fullscreen')"
        @toggle-pin="emit('togglePin')"
        @toggle-star="emit('toggleStar')"
        @delete="emit('delete')"
        @undo="editorRef?.undo()"
        @redo="editorRef?.redo()"
        @primary="emit('close')"
      />
    </div>
    <NoteEditor
      ref="editorRef"
      variant="card"
      :initial-content="draft"
      :save-image="saveImageToNote"
      placeholder="此刻的想法…"
      @update="onUpdate"
      @submit="emit('close')"
    />
    <div v-if="visibleAtts.length" class="edit-atts">
      <NoteAttachments :attachments="visibleAtts" @remove="emit('removeAttachment', $event)" />
    </div>
  </article>
</template>

<style scoped>
.memo {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-card);
  border-radius: var(--radius-card);
  /* 左侧留勾选位：批量态显形时文字不位移（勾选即进，无布局跳动）。
     原型对拍轮从 32 收到 24——那颗钮九成时间是隐形的，不该让正文为它缩进一大截 */
  padding: 14px var(--space-4) 14px var(--space-6);
  box-shadow: var(--shadow-card-rest);
  transition: box-shadow var(--transition), border-color var(--transition), background-color var(--transition), transform var(--transition);
}
/* hover 与收藏/文件行卡同一配方：描边显色 + 背景微沉（轻量化轮，抬影退役） */
.memo:hover {
  border-color: var(--border-card-hover);
  background-color: var(--bg-surface-hover);
}
.memo.pinned { border-color: var(--accent-light); }
.memo.editing { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring), var(--shadow-sm); }
.memo:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }

.memo-body {
  position: relative;
  max-height: var(--memo-max-h);
  overflow: hidden;
  font-size: var(--text-base);
  line-height: 24px;
  color: var(--text);
  word-break: break-word;
}
.memo-body.expanded { max-height: none; }
/* 首块已提升为标题行：正文里藏掉它避免重复。用 display:none 而非删节点，
   保住 toggleTask「渲染序 == 库序」的 checkbox 对位 */
.memo-body.promoted :deep(> :first-child) { display: none; }

/* 截断由 JS 收在整行边界，入口就是这一颗，不再靠渐隐暗示。
   28px = 卡上带文字按钮的档位（与 .action-btn 同轴），不另开 26 */
.memo-unfold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  margin-top: 3px;
  padding: 0 var(--space-1);
  margin-left: calc(0px - var(--space-1));
  border: none;
  border-radius: var(--radius-ib);
  background: transparent;
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}
.memo-unfold:hover { background: var(--accent-soft); }
.memo-unfold :deep(svg) { transition: transform var(--transition); }
.memo-unfold :deep(svg.up) { transform: rotate(180deg); }

/* 加密锁标识：占掉正文位置，一眼知道这条要看密码。
   底纹走极淡斜纹——不读字也能扫出"这块是锁着的"，浓到贴纸感就过头 */
.memo-locked {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 44px;
  font-size: var(--text-base);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  border-radius: var(--radius);
  background: repeating-linear-gradient(-45deg, /* taste-skill-ignore: 保留现有加密态纹理，区别普通小记。 */
    color-mix(in srgb, var(--warning) 2.5%, transparent) 0 4px,
    transparent 4px 18px);
}
.lock-disc {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: var(--radius);
  background: var(--warning-soft);
  color: var(--warning);
  display: flex;
  align-items: center;
  justify-content: center;
}
.lock-meta { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0; }
/* 锁着也认得出是哪条：只有真标题（h1–h3）会留明文，其余只剩提示语 */
.locked-title { color: var(--text); font-size: var(--text-md); font-weight: 600; letter-spacing: normal; }
/* 只给正文顶层块加间距，理由同 NoteEditor：* + * 会把任务项的正文压到勾选框下面 */
.memo-body :deep(> * + *) { margin-top: var(--space-2); }
.memo-body :deep(* + h1), .memo-body :deep(* + h2), .memo-body :deep(* + h3) { margin-top: var(--space-4); }
.memo-body :deep(h1) { font-size: var(--text-xl); font-weight: 600; letter-spacing: normal; line-height: 28px; }
.memo-body :deep(h2) { font-size: var(--text-lg); font-weight: 600; letter-spacing: normal; line-height: 26px; }
.memo-body :deep(h3) { font-size: var(--text-md); font-weight: 600; line-height: 24px; }
.memo-body :deep(strong) { font-weight: 600; color: var(--text); }
.memo-body :deep(ul), .memo-body :deep(ol) { padding-left: var(--space-5); }
.memo-body :deep(li) { margin: 2px 0; }
.memo-body :deep(li::marker) { color: var(--text-faint); }
.memo-body :deep(blockquote) { border-left: 2px solid var(--accent-light); padding-left: var(--space-3); }
.memo-body :deep(code) { font-family: var(--font-mono); font-size: var(--text-xs); background: var(--code-bg); border-radius: 4px; padding: 1px 5px; color: var(--accent-active); }
.memo-body :deep(pre) { font-family: var(--font-mono); font-size: var(--text-sm); line-height: 21px; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-2) var(--space-3); overflow-x: auto; }
.memo-body :deep(pre code) { background: none; border: none; padding: 0; color: inherit; }
.memo-body :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.memo-body :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
.memo-body :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
/* 正文分隔线不吃 --border（chrome 发丝档，纸底实测 1.15:1 等于没画），从字色反推 */
.memo-body :deep(hr) { border: none; border-top: 1px solid color-mix(in srgb, var(--text) 26%, transparent); margin: var(--space-3) 0; }
.memo-body :deep(img[data-note-image]) { display: block; max-width: 100%; max-height: 34vh; object-fit: contain; border-radius: var(--radius); }

/* 标题行：标题(粗) + 收藏标 + 时间(右)，对齐 mock .t */
.memo-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 3px;
  min-height: 20px;
  cursor: pointer;
}
.memo-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-semibold);
  letter-spacing: normal;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.memo-time { font-size: var(--text-xs); color: var(--text-muted); flex-shrink: 0; transition: opacity var(--transition); }
.memo.batchable .memo-tags { pointer-events: none; }
/* 底部 meta 行：附件数 + 标签胶囊（对齐 mock .tags，从顶部 meta 行下移） */
.memo-foot { display: flex; align-items: center; gap: 10px; margin-top: 2px; min-height: 20px; }
.memo-att { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); color: var(--text-muted); flex-shrink: 0; }
/* 标签胶囊：20px 档与卡片里的其余胶囊同高。
   命中的那颗转主色，点下去看得见自己生效了；悬停不跟着动作排一起淡掉——它是筛选入口不是状态标 */
.memo-tags { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
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
.tag-pill.on { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
/* 状态标与时间一起让位：悬停后动作排压住卡头右端，留着就是叠字 */
.memo-state { display: inline-flex; align-items: center; gap: var(--space-1); transition: opacity var(--transition); }
.memo:not(.batchable):hover .memo-state, .memo:not(.batchable):focus-within .memo-state { opacity: 0; }
.state-star { color: var(--warning); display: inline-flex; }
/* 动作排就地顶替时间：底取悬停后的卡面档，看不出另贴了一块；正文永不被压 */
.memo-acts {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 15;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 9px;
  background: var(--bg-surface-hover);
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition);
}
/* 悬停/聚焦才显形，且不吞正文点击（透明态 pointer-events 关） */
.memo:hover .memo-acts, .memo:focus-within .memo-acts { opacity: 1; pointer-events: auto; }
/* 时间让位给动作排：实底只有排这么宽，长标题会被右缘裁掉，留着时间就是叠字 */
.memo:not(.editing):not(.batchable):hover .memo-time, .memo:not(.editing):not(.batchable):focus-within .memo-time { opacity: 0; }
.memo-acts .ib { width: 26px; height: 26px; border-radius: 6px; }
.memo-acts .ib :deep(svg) { width: 16px; height: 16px; }

.memo-check {
  position: absolute;
  left: var(--space-1);
  top: 16px;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--accent-on);
  transition: background-color var(--transition), border-color var(--transition);
  /* 勾选即进：位置常留不位移。钮只在光标压到它时瞬时显形（与收藏页同款），
     逛卡时不见钮，不会隐形吞点击，也不会悬停就一片勾选框像批量态 */
  opacity: 0;
}
.memo-check:hover,
.memo:focus-visible .memo-check,
.memo.batchable .memo-check { opacity: 1; }
.memo-check:hover { border-color: var(--accent); }
.memo-check.checked { background: var(--accent); border-color: var(--accent); }
.memo.is-sel {
  /* 浸润底 + 1px 实环把整张卡包一圈，和 .entry-card.selected 同一套选中语言 */
  border-color: var(--accent);
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent), var(--shadow-sm);
  transform: translateY(-1px);
}
/* 小记标题在独立标题行，选中时跟着上主色 */
.memo.is-sel .memo-title { color: var(--text-brand); }

/* 无标题时正文直接起笔，时间和操作仍在右上角；只让正文开头避让控件。 */
.memo.without-title { --memo-controls-width: 160px; }
.memo.without-title .memo-head {
  position: absolute;
  top: 14px;
  right: var(--space-4);
  width: var(--memo-controls-width);
  margin: 0;
}
.memo.without-title .memo-body::before {
  content: '';
  float: right;
  width: var(--memo-controls-width);
  height: 28px;
}
.memo.without-title .memo-locked { padding-right: var(--memo-controls-width); }
/* 锁着的卡没有正文可避让：时间行回到常规流，斜纹从时间下方起笔，别穿过后者的字 */
.memo.without-title.locked .memo-head {
  position: static;
  width: auto;
  margin: 0 0 3px;
}
.memo.without-title.locked .memo-locked { padding-right: 0; }
.memo.without-title .memo-body :deep(> img:first-child),
.memo.without-title .memo-body :deep(> :first-child img) {
  max-width: calc(100% - var(--memo-controls-width));
}

.edit-atts { margin-top: var(--space-3); }
/* 动作条挪到卡顶：与只读态右上动作排同一位置语言，分隔线跟着翻成下沿虚线。
   编辑条只管写作：左=时间+撤销/重做+插入工具，右=保存状态+全屏+退出编辑（CSS order 只在卡顶生效） */
.edit-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px dashed var(--border);
}
.edit-bar :deep(.toolbar-flex) { order: 3; }
.edit-bar :deep(.tb-fs) { order: 5; }
.edit-bar :deep(.note-toolbar .primary) { order: 6; }
</style>
