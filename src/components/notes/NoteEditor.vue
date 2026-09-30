<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import { normalizeAssetHtml, resolveAssetHtml } from '../../services/attachmentSrc'
import { useEditor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import ts from 'highlight.js/lib/languages/typescript'
import js from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import go from 'highlight.js/lib/languages/go'
import cpp from 'highlight.js/lib/languages/cpp'
import AppIcon from '../shared/AppIcon.vue'
import ImageNodeView from './ImageNodeView.vue'
import type { IconName } from '../../utils/icons'

const lowlight = createLowlight({
  typescript: ts, javascript: js, python, rust, css, html: xml, xml, json, bash, shell: bash, sql, java, go, cpp, c: cpp,
})

const props = withDefaults(defineProps<{
  initialContent?: string
  variant?: 'composer' | 'card' | 'full'
  placeholder?: string
}>(), {
  initialContent: '',
  variant: 'card',
  placeholder: '输入 / 打开命令...',
})

const emit = defineEmits<{
  update: [html: string]
  submit: []
}>()

// Wrapper ref for position calculation
const editorWrapper = ref<HTMLElement | null>(null)
const slashMenuEl = ref<HTMLElement | null>(null)

// Slash command state
const showSlashMenu = ref(false)
const slashMenuIndex = ref(0)
type SlashMenuPos = { top?: number; left: number; bottom?: number }
const slashMenuPos = ref<SlashMenuPos>({ left: 0 })
const slashMenuMaxH = ref(0)

const slashMenuStyle = computed(() => ({
  top: slashMenuPos.value.top !== undefined ? slashMenuPos.value.top + 'px' : 'auto',
  left: slashMenuPos.value.left + 'px',
  bottom: slashMenuPos.value.bottom !== undefined ? slashMenuPos.value.bottom + 'px' : 'auto',
  maxHeight: slashMenuMaxH.value + 'px',
}))

const MARGIN = 12
/** 与 .slash-menu 的宽度保持一致，用于右缘收拢 */
const MENU_W = 208
const MENU_MIN_H = 168
/** 菜单与光标之间的间距 */
const GAP = 6

/** 命令菜单的条目：图标位用线性图标，标题类保留 H1/H2/H3 字形；右侧提示 markdown 触发符 */
type SlashCmd = {
  label: string
  icon?: IconName
  badge?: string
  hint: string
  keys: string
  action: (e: any) => void
}

const slashCommands: SlashCmd[] = [
  { label: '标题 1', badge: 'H1', hint: '#', keys: 'h1 heading title biaoti', action: (e: any) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: '标题 2', badge: 'H2', hint: '##', keys: 'h2 heading title biaoti', action: (e: any) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '标题 3', badge: 'H3', hint: '###', keys: 'h3 heading title biaoti', action: (e: any) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '无序列表', icon: 'bulletlist', hint: '-', keys: 'bullet ul list liebiao wuxu', action: (e: any) => e.chain().focus().toggleBulletList().run() },
  { label: '有序列表', icon: 'orderedlist', hint: '1.', keys: 'ordered ol number list liebiao youxu', action: (e: any) => e.chain().focus().toggleOrderedList().run() },
  { label: '任务列表', icon: 'checkall', hint: '[]', keys: 'task todo checkbox list renwu', action: (e: any) => e.chain().focus().toggleTaskList().run() },
  { label: '引用', icon: 'quote', hint: '>', keys: 'quote blockquote yinyong', action: (e: any) => e.chain().focus().toggleBlockquote().run() },
  { label: '代码块', icon: 'code', hint: '```', keys: 'code pre daimaku', action: (e: any) => e.chain().focus().toggleCodeBlock().run() },
  { label: '分割线', icon: 'divider', hint: '---', keys: 'hr divider line fengexian', action: (e: any) => e.chain().focus().setHorizontalRule().run() },
]

const slashQuery = ref('')
const filteredCommands = computed(() => {
  const query = slashQuery.value.trim().toLowerCase()
  if (!query) return slashCommands
  return slashCommands.filter(cmd => cmd.label.toLowerCase().includes(query) || cmd.keys.includes(query))
})

// Custom extension for slash command keyboard handling
const SlashCommandExtension = Extension.create({
  name: 'slashCommand',
  addKeyboardShortcuts() {
    return {
      ArrowDown: ({ editor: _editor }) => {
        if (!showSlashMenu.value) return false
        const len = filteredCommands.value.length
        if (len === 0) return true
        slashMenuIndex.value = (slashMenuIndex.value + 1) % len
        return true
      },
      ArrowUp: ({ editor: _editor }) => {
        if (!showSlashMenu.value) return false
        const len = filteredCommands.value.length
        if (len === 0) return true
        slashMenuIndex.value = (slashMenuIndex.value - 1 + len) % len
        return true
      },
      Enter: ({ editor: _editor }) => {
        if (!showSlashMenu.value) return false
        if (filteredCommands.value.length === 0) return true
        executeCommand(filteredCommands.value[slashMenuIndex.value])
        return true
      },
      Escape: ({ editor: _editor }) => {
        if (!showSlashMenu.value) return false
        showSlashMenu.value = false
        return true
      },
      'Ctrl-Enter': () => {
        if (showSlashMenu.value) return false
        emit('submit')
        return true
      },
      'Mod-Enter': () => {
        if (showSlashMenu.value) return false
        emit('submit')
        return true
      },
    }
  },
})

const TAG_PATTERN = /#([\w一-龥]+)/g

/** 图片是正文里的一个块，src 只存附件的 asset 地址，字节留在附件目录里；
 *  width 存书写面百分比，默认半宽，拖右下角手柄调整 */
const NoteImage = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      width: {
        default: '50%',
        parseHTML: (el) =>
          el.getAttribute('style')?.match(/width:\s*([^;]+)/)?.[1]?.trim() || '50%',
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}` } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { 'data-note-image': '' })]
  },
  addNodeView() {
    return VueNodeViewRenderer(ImageNodeView)
  },
})

// 正文里的 #标签 内联着色（flomo 式），三种书写形态共用同一个编辑器所以只看这一处实现
const TagHighlightExtension = Extension.create({
  name: 'tagHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              TAG_PATTERN.lastIndex = 0
              let match
              while ((match = TAG_PATTERN.exec(node.text!)) !== null) {
                decorations.push(
                  Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
                    class: 'tag-inline',
                  }),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

// 检测内容是否为纯空白（只包含换行、空格或空的 HTML 标签）
const isBlankContent = (html: string | undefined): boolean => {
  if (!html) return true
  // 移除所有 HTML 标签后检查是否只有空白字符
  const text = html.replace(/<[^>]*>/g, '').trim()
  return text.length === 0
}

const editor = useEditor({
  // 库里存的是 attachments/<名>，编辑器里要看到真图；存回去时再洗回相对形态
  content: resolveAssetHtml(props.initialContent || ''),
  // 胶囊输入不抢焦点：它默认收成一行，抢了焦点就等于永远是展开的，折叠态白做。
  // 卡片就地编辑和全屏面是用户主动进入的书写面，才需要落点即写。
  autofocus: props.variant === 'composer' ? false : (isBlankContent(props.initialContent) ? 'start' : 'end'),
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: props.placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TagHighlightExtension,
    SlashCommandExtension,
    NoteImage,
  ],
  onUpdate: ({ editor }) => {
    emit('update', normalizeAssetHtml(editor.getHTML()))
    checkSlashMenu(editor)
  },
})

/**
 * 勾完任务项把光标放回这一条。
 * Tiptap 的节点视图在 checkbox 上 preventDefault 掉了 mousedown，又只 focus(undefined)
 * 还原上一次的选区，所以勾完打字会掉到列表后面的段落里去。
 */
const relocateCaret = (e: Event) => {
  const ed = editor.value
  const box = e.target as HTMLInputElement | null
  if (!ed || !box || box.type !== 'checkbox') return
  const line = box.closest('li')?.querySelector('p')
  if (!line) return
  // posAtDOM 的 offset 在元素上数的是子节点序号、在文本节点上才是字符偏移，所以要喂文本节点
  const text = line.firstChild
  const pos = text
    ? ed.view.posAtDOM(text, text.textContent?.length ?? 0)
    : ed.view.posAtDOM(line, 0)
  if (pos < 0) return
  ed.chain().focus().setTextSelection(pos).run()
}

watch(() => props.initialContent, (val) => {
  // 两边要在同一个空间里比：库里是相对形态，编辑器里是 asset URL
  const shown = resolveAssetHtml(val || '')
  if (editor.value && shown !== editor.value.getHTML()) {
    editor.value.commands.setContent(shown)
  }
})

// Auto-scroll slash menu when index changes
watch(slashMenuIndex, (newIndex) => {
  if (!showSlashMenu.value || filteredCommands.value.length === 0) return
  const menu = document.querySelector('.slash-menu')
  const activeItem = menu?.querySelector(`.slash-item[data-index="${newIndex}"]`)
  if (menu && activeItem) {
    const menuRect = menu.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    if (itemRect.bottom > menuRect.bottom) {
      menu.scrollTop += itemRect.bottom - menuRect.bottom
    } else if (itemRect.top < menuRect.top) {
      menu.scrollTop -= menuRect.top - itemRect.top
    }
  }
})

const checkSlashMenu = (editor: any) => {
  // 几种书写形态共用同一份草稿：内容同步会在后台那个编辑器上也触发 onUpdate，
  // 只有正在输入的编辑器该跟 slash，否则全屏里会同时浮出两个菜单
  if (!editor.isFocused) return

  const { from } = editor.state.selection
  // Look back up to 50 chars to find / and any query text
  const lineStart = Math.max(0, from - 50)
  const text = editor.state.doc.textBetween(lineStart, from, '\n')

  // Find the last / in the current line
  const slashIndex = text.lastIndexOf('/')

  if (slashIndex === -1) {
    showSlashMenu.value = false
    slashQuery.value = ''
    return
  }

  // Get text after /
  const afterSlash = text.slice(slashIndex + 1)

  // If there's a newline or space, close the menu
  if (afterSlash.includes('\n') || afterSlash.includes(' ')) {
    showSlashMenu.value = false
    slashQuery.value = ''
    return
  }

  // 先定位再显示：反过来会让菜单首帧画在旧坐标（首次进入时是 0,0），然后才跳到光标处
  const coords = editor.view.coordsAtPos(from)
  const left = Math.max(MARGIN, Math.min(coords.left, window.innerWidth - MENU_W - MARGIN))

  // 高度交给内容，只被那一侧的剩余空间截断；下方不够就贴着光标向上翻，
  // 而不是钉在视口顶部——那样菜单会离光标很远，还盖住页面标题栏
  const below = window.innerHeight - coords.bottom - GAP - MARGIN
  const above = coords.top - GAP - MARGIN
  if (below >= MENU_MIN_H || below >= above) {
    slashMenuPos.value = { top: coords.bottom + GAP, left }
    slashMenuMaxH.value = below
  } else {
    slashMenuPos.value = { bottom: window.innerHeight - coords.top + GAP, left }
    slashMenuMaxH.value = above
  }

  showSlashMenu.value = true
  slashQuery.value = afterSlash
  slashMenuIndex.value = 0
}

const executeCommand = (cmd: typeof slashCommands[0]) => {
  if (!editor.value) return
  const { from } = editor.value.state.selection
  const queryLength = slashQuery.value.length

  // Check if current line has content besides the / command
  const lineStart = editor.value.state.doc.resolve(from).start()
  const beforeSlash = from - 1 - queryLength
  const hasOtherContent = beforeSlash > lineStart

  // Delete / plus the query text
  editor.value.chain().focus().deleteRange({ from: beforeSlash, to: from }).run()

  // 行上还有别的内容：先拆成新块，再让命令作用在这个空块上。
  // 早先用 insertContentAt('\n') 只是插了个段内硬换行，正文会掉到勾选框下面一行
  if (hasOtherContent) {
    editor.value.chain().focus().splitBlock().run()
  }

  cmd.action(editor.value)
  showSlashMenu.value = false
  slashQuery.value = ''
}

const codeLanguages = [
  { value: 'plaintext', label: '纯文本' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'rust', label: 'Rust' },
  { value: 'go', label: 'Go' },
  { value: 'cpp', label: 'C++' },
  { value: 'c', label: 'C' },
  { value: 'java', label: 'Java' },
  { value: 'sql', label: 'SQL' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
  { value: 'bash', label: 'Bash' },
]

const showLangSelector = ref(false)
const showLangDropdown = ref(false)
const langSelectorPos = ref({ top: 0, right: 0 })
const currentLang = ref('plaintext')

const updateCodeBlockState = (ed: any) => {
  if (!ed) return
  const inCodeBlock = ed.isActive('codeBlock')
  showLangSelector.value = inCodeBlock
  if (inCodeBlock) {
    const node = ed.state.selection.$head.parent
    currentLang.value = node.attrs?.language || 'plaintext'
    const dom = ed.view.nodeDOM(ed.state.selection.$head.before()) as HTMLElement | null
    if (dom) {
      const editorRect = ed.view.dom.getBoundingClientRect()
      const preRect = dom.getBoundingClientRect()
      langSelectorPos.value = {
        top: preRect.top - editorRect.top + 6,
        right: editorRect.right - preRect.right + 8,
      }
    }
  }
}

const onLangChange = (lang: string) => {
  if (!editor.value) return
  currentLang.value = lang
  editor.value.chain().focus().setCodeBlock({ language: lang }).run()
  showLangSelector.value = false
  showLangDropdown.value = false
}

watch(() => editor.value, (ed) => {
  if (!ed) return
  ed.on('selectionUpdate', ({ editor: e }) => updateCodeBlockState(e))
  ed.on('transaction', ({ editor: e }) => updateCodeBlockState(e))
})

// Click outside to close slash menu
const handleClickOutside = (e: MouseEvent) => {
  if (showSlashMenu.value && slashMenuEl.value && !slashMenuEl.value.contains(e.target as HTMLElement)) {
    showSlashMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  editor.value?.destroy()
})

const focusEnd = () => {
  editor.value?.chain().focus('end').run()
}

const insertText = (text: string) => {
  editor.value?.chain().focus().insertContent(text).run()
}

/** 图片块追加到光标处；默认宽度按书写面区分：列表窄栏小图够用，全屏才给大图 */
const insertImage = (src: string) => {
  const ed = editor.value
  if (!ed) return
  const width = props.variant === 'full' ? '55%' : '30%'
  ed.chain().focus().insertContent({ type: 'image', attrs: { src, width } }).run()
}

defineExpose({ focusEnd, insertText, insertImage })
</script>

<template>
  <div ref="editorWrapper" class="note-editor" :class="`v-${variant}`" @change="relocateCaret">
    <EditorContent :editor="editor" />
    <Teleport to="body">
      <div
        v-if="showSlashMenu"
        ref="slashMenuEl"
        class="slash-menu"
        :style="slashMenuStyle"
      >
        <div
          v-for="(cmd, i) in filteredCommands"
          :key="cmd.label"
          class="slash-item"
          :class="{ active: i === slashMenuIndex }"
          :data-index="i"
          @mouseenter="slashMenuIndex = i"
          @mousedown.prevent="executeCommand(cmd)"
        >
          <AppIcon v-if="cmd.icon" :name="cmd.icon" :size="15" class="sm-icon" />
          <span v-else class="sm-badge">{{ cmd.badge }}</span>
          <span class="sm-label">{{ cmd.label }}</span>
          <span class="sm-hint">{{ cmd.hint }}</span>
        </div>
        <div v-if="!filteredCommands.length" class="sm-empty">没有匹配的块</div>
      </div>
    </Teleport>
    <div v-if="showLangSelector" class="lang-selector" :style="{ top: langSelectorPos.top + 'px', right: langSelectorPos.right + 'px' }">
      <div class="lang-dropdown">
        <button class="lang-btn" @click="showLangDropdown = !showLangDropdown">
          <span>{{ codeLanguages.find(l => l.value === currentLang)?.label }}</span>
          <AppIcon name="chevDown" :size="12" />
        </button>
        <div v-if="showLangDropdown" class="lang-options">
          <div v-for="lang in codeLanguages" :key="lang.value"
               class="lang-option" :class="{ active: lang.value === currentLang }"
               @click="onLangChange(lang.value)">
            {{ lang.label }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-editor {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.note-editor :deep(.ProseMirror) {
  outline: none;
  color: var(--text);
  flex: 1;
  background: transparent;
  word-break: break-word;
}

/* 胶囊输入：平时收成一行的占位高度，聚焦后长到约五行；有内容时按内容撑开 */
.note-editor.v-composer :deep(.ProseMirror) {
  padding: var(--space-3) var(--space-4) var(--space-2);
  font-size: 14.5px;
  line-height: 1.7;
  min-height: 22px;
  max-height: 46vh;
  scrollbar-gutter: stable;
  overflow-y: auto;
  transition: min-height var(--transition-slow);
}
.note-editor.v-composer:focus-within :deep(.ProseMirror) { min-height: 148px; }
/* 竖长图只封顶宽会撑出半屏高；书写面里按视口高度收着放，全屏给更大的额度 */
.note-editor :deep(.img-node img) { max-height: 34vh; object-fit: contain; }
.note-editor.v-full :deep(.img-node img) { max-height: 60vh; }

/* 卡片就地展开：与只读态同一套字号，避免展开时文字跳动；留出三行书写余量 */
.note-editor.v-card :deep(.ProseMirror) {
  padding: 0;
  font-size: 14px;
  line-height: 1.6;
  min-height: 72px;
  max-height: 46vh;
  scrollbar-gutter: stable;
  overflow-y: auto;
}

/* 全屏书写：一张纸的排版尺度 */
.note-editor.v-full :deep(.ProseMirror) {
  padding: 0;
  font-size: 15.5px;
  line-height: 1.68;
  letter-spacing: -0.012em;
  min-height: 40vh;
  caret-color: var(--accent);
}

.note-editor.v-full :deep(.ProseMirror > * + *) { margin-top: 10px; }
.note-editor.v-full :deep(h1) { font-size: 23px; font-weight: 650; line-height: 1.35; letter-spacing: -0.026em; margin-top: var(--space-4); }
.note-editor.v-full :deep(h2) { font-size: 18px; font-weight: 620; line-height: 1.45; letter-spacing: -0.02em; margin-top: 12px; }
.note-editor.v-full :deep(h3) { font-size: 18px; font-weight: 600; }
.note-editor.v-full :deep(blockquote) { border-left-width: 3px; padding-left: var(--space-4); }
.note-editor.v-full :deep(pre) { font-size: 13.5px; line-height: 1.75; padding: var(--space-4); background: var(--panel-bg); border: none; box-shadow: var(--shadow-xs); }
.note-editor.v-full :deep(hr) { border: none; height: 1px; background: linear-gradient(90deg, transparent, var(--border-strong), transparent); margin: var(--space-6) 0; }

.note-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-muted);
  pointer-events: none;
  height: 0;
}

/* 只给文档顶层块加间距：写成 * + * 会连任务项里 label 后面的正文 div 一起压下去 8px */
.note-editor :deep(.ProseMirror > * + *) { margin-top: var(--space-2); }
.note-editor :deep(* + h1), .note-editor :deep(* + h2), .note-editor :deep(* + h3) { margin-top: var(--space-4); }
.note-editor :deep(h1) { font-size: 18px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.45; }
.note-editor :deep(h2) { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.5; }
.note-editor :deep(h3) { font-size: 14.5px; font-weight: 600; line-height: 1.5; }
.note-editor :deep(p) { margin: 0; }
.note-editor :deep(ul), .note-editor :deep(ol) { padding-left: var(--space-5); margin: 0; }
.note-editor :deep(li) { margin: 2px 0; }
.note-editor :deep(li::marker) { color: var(--text-faint); }
.note-editor :deep(strong) { font-weight: 600; color: var(--text); }
.note-editor :deep(blockquote) { border-left: 2px solid var(--accent-light); padding-left: var(--space-3); }
.note-editor :deep(code) { font-family: var(--font-mono); font-size: 12.5px; background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: 4px; padding: 1px 5px; color: var(--text-secondary); }
.note-editor :deep(pre) { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.65; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-2) var(--space-3); overflow-x: auto; }
.note-editor :deep(pre code) { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
.note-editor :deep(hr) { border: none; border-top: 1px solid var(--border); margin: var(--space-3) 0; }
.note-editor :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: 3px; }
.note-editor :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
/* 正文必须撑满剩余宽度：弹性项默认按内容收缩，空条目会缩成 0 宽，光标没有行盒可落 = 看不见光标 */
.note-editor :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
.note-editor :deep(ul[data-type='taskList'] input) { accent-color: var(--accent); margin-top: 5px; }

/* 语法高亮的配色规则在 global.css：那里写一次，编辑器与只读渲染共用 */

.slash-menu {
  position: fixed;
  width: 208px;
  z-index: 300;
  padding: 4px;
  overflow-y: auto;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-pop);
  animation: sm-in var(--transition-fast) ease both;
}

@keyframes sm-in {
  from { opacity: 0; transform: translateY(-3px) scale(0.98); }
}

.slash-menu::-webkit-scrollbar { width: 4px; }
.slash-menu::-webkit-scrollbar-track { background: transparent; }
.slash-menu::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.slash-menu::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

.slash-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 5px 7px;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text);
  transition: background var(--transition-fast);
}

.sm-icon { flex-shrink: 0; color: var(--text-secondary); }

.sm-badge {
  width: 15px;
  flex-shrink: 0;
  text-align: center;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-secondary);
}

.sm-label { flex: 1; min-width: 0; font-size: 13px; }

.sm-hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
}

.sm-empty { padding: 9px 7px; font-size: 12.5px; color: var(--text-muted); }

.slash-item.active { background: var(--accent-soft); }
.slash-item.active .sm-label { color: var(--accent-active); font-weight: 500; }
.slash-item.active .sm-icon, .slash-item.active .sm-badge { color: var(--accent-active); }
.slash-item.active .sm-hint { color: var(--accent-active); opacity: 0.6; }

.lang-selector {
  position: absolute;
  z-index: 50;
}

.lang-dropdown {
  position: relative;
}

.lang-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  outline: none;
}

.lang-btn:hover {
  border-color: var(--border-strong);
  color: var(--text);
  background: var(--hover);
}

.lang-btn svg {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.lang-btn:hover svg {
  opacity: 1;
}

.lang-options {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-pop);
  max-height: 200px;
  overflow-y: auto;
  min-width: 120px;
  z-index: 100;
}

.lang-option {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
  transition: background 0.1s;
}

.lang-option:hover {
  background: var(--hover);
}

.lang-option.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
</style>
