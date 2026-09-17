<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, onMounted } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Extension } from '@tiptap/core'
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

const lowlight = createLowlight({
  typescript: ts, javascript: js, python, rust, css, html: xml, xml, json, bash, shell: bash, sql, java, go, cpp, c: cpp,
})

const props = defineProps<{
  initialContent?: string
}>()

const emit = defineEmits<{
  update: [html: string]
}>()

// Wrapper ref for position calculation
const editorWrapper = ref<HTMLElement | null>(null)
const slashMenuEl = ref<HTMLElement | null>(null)

// Slash command state
const showSlashMenu = ref(false)
const slashMenuIndex = ref(0)
const slashMenuPos = ref({ top: 0, left: 0 })

const slashCommands = [
  { label: '标题 1', action: (e: any) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: '标题 2', action: (e: any) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: '标题 3', action: (e: any) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '无序列表', action: (e: any) => e.chain().focus().toggleBulletList().run() },
  { label: '有序列表', action: (e: any) => e.chain().focus().toggleOrderedList().run() },
  { label: '任务列表', action: (e: any) => e.chain().focus().toggleTaskList().run() },
  { label: '引用', action: (e: any) => e.chain().focus().toggleBlockquote().run() },
  { label: '代码块', action: (e: any) => e.chain().focus().toggleCodeBlock().run() },
  { label: '分割线', action: (e: any) => e.chain().focus().setHorizontalRule().run() },
]

const slashQuery = ref('')
const filteredCommands = computed(() => {
  if (!slashQuery.value) return slashCommands
  const query = slashQuery.value.toLowerCase()
  return slashCommands.filter(cmd => cmd.label.toLowerCase().includes(query))
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
    }
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
  content: props.initialContent || '',
  autofocus: isBlankContent(props.initialContent) ? 'start' : 'end',
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: '输入 / 打开命令...' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    SlashCommandExtension,
  ],
  onUpdate: ({ editor }) => {
    emit('update', editor.getHTML())
    checkSlashMenu(editor)
  },
})

watch(() => props.initialContent, (val) => {
  if (editor.value && val !== editor.value.getHTML()) {
    editor.value.commands.setContent(val || '')
  }
})

// Auto-scroll slash menu when index changes
watch(slashMenuIndex, (newIndex) => {
  if (!showSlashMenu.value || filteredCommands.value.length === 0) return
  const menu = document.querySelector('.slash-menu')
  const activeItem = menu?.querySelector(`.slash-item:nth-child(${newIndex + 1})`)
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

  showSlashMenu.value = true
  slashQuery.value = afterSlash
  slashMenuIndex.value = 0

  // Position the menu
  setTimeout(() => {
    const coords = editor.view.coordsAtPos(from)
    slashMenuPos.value = {
      top: coords.bottom + 4,
      left: coords.left,
    }
  }, 0)
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

  // If there was other content on the line, insert a newline first
  if (hasOtherContent) {
    editor.value.chain().focus().insertContentAt(editor.value.state.selection.from, '\n').run()
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
  if (showSlashMenu.value && slashMenuEl.value && !slashMenuEl.value.contains(e.target as Node)) {
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
</script>

<template>
  <div ref="editorWrapper" class="note-editor">
    <EditorContent :editor="editor" />
    <div v-if="showSlashMenu && filteredCommands.length > 0" ref="slashMenuEl" class="slash-menu" :style="{ top: slashMenuPos.top + 'px', left: slashMenuPos.left + 'px' }">
      <div v-for="(cmd, i) in filteredCommands" :key="cmd.label"
           class="slash-item" :class="{ active: i === slashMenuIndex }"
           @mousedown.prevent="executeCommand(cmd)">
        {{ cmd.label }}
      </div>
    </div>
    <div v-if="showLangSelector" class="lang-selector" :style="{ top: langSelectorPos.top + 'px', right: langSelectorPos.right + 'px' }">
      <div class="lang-dropdown">
        <button class="lang-btn" @click="showLangDropdown = !showLangDropdown">
          <span>{{ codeLanguages.find(l => l.value === currentLang)?.label }}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.note-editor :deep(.ProseMirror) {
  outline: none;
  padding: 8px 24px 24px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
  flex: 1;
  overflow-y: auto;
  background: transparent;
}

.note-editor :deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: var(--text-muted);
  pointer-events: none;
  height: 0;
}

.note-editor :deep(h1) { font-size: 22px; font-weight: 700; margin: 16px 0 8px; }
.note-editor :deep(h2) { font-size: 18px; font-weight: 600; margin: 14px 0 6px; }
.note-editor :deep(h3) { font-size: 15px; font-weight: 600; margin: 12px 0 4px; }
.note-editor :deep(p) { margin: 4px 0; }
.note-editor :deep(ul) { padding-left: 24px; margin: 4px 0; }
.note-editor :deep(ol) { padding-left: 24px; margin: 4px 0; }
.note-editor :deep(li) { margin: 2px 0; }
.note-editor :deep(blockquote) { border-left: 3px solid var(--accent); padding: 8px 12px; margin: 8px 0; color: var(--text-secondary); background: var(--bg); border-radius: 0 6px 6px 0; }
.note-editor :deep(pre) { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; overflow-x: auto; font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 13px; line-height: 1.6; margin: 8px 0; }
.note-editor :deep(code) { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 13px; }
.note-editor :deep(pre code) { background: none; padding: 0; color: inherit; }

/* Syntax highlighting - Catppuccin Latte (light theme) */
.note-editor :deep(.hljs-keyword), .note-editor :deep(.hljs-selector-tag), .note-editor :deep(.hljs-deletion) { color: #d20f39; }
.note-editor :deep(.hljs-string), .note-editor :deep(.hljs-meta .hljs-meta-string), .note-editor :deep(.hljs-regexp) { color: #40a02b; }
.note-editor :deep(.hljs-number), .note-editor :deep(.hljs-literal) { color: #fe640b; }
.note-editor :deep(.hljs-built_in), .note-editor :deep(.hljs-builtin-name), .note-editor :deep(.hljs-type) { color: #df8e1d; }
.note-editor :deep(.hljs-function), .note-editor :deep(.hljs-title), .note-editor :deep(.hljs-section) { color: #1e66f5; }
.note-editor :deep(.hljs-attr), .note-editor :deep(.hljs-attribute), .note-editor :deep(.hljs-variable) { color: #e64553; }
.note-editor :deep(.hljs-comment), .note-editor :deep(.hljs-quote) { color: #9ca0b0; font-style: italic; }
.note-editor :deep(.hljs-tag), .note-editor :deep(.hljs-name), .note-editor :deep(.hljs-selector-class), .note-editor :deep(.hljs-selector-id) { color: #8839ef; }
.note-editor :deep(.hljs-punctuation), .note-editor :deep(.hljs-symbol) { color: #6c6f85; }
.note-editor :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }

.slash-menu {
  position: fixed;
  background: var(--panel-bg);
  border: 1px solid var(--border-strong, #d1d5db);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04);
  max-height: 260px;
  overflow-y: auto;
  z-index: 100;
  padding: 4px;
  min-width: 160px;
}

.slash-menu::-webkit-scrollbar { width: 4px; }
.slash-menu::-webkit-scrollbar-track { background: transparent; }
.slash-menu::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.slash-menu::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }

.slash-item {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text);
  transition: background 0.1s;
}

.slash-item:hover, .slash-item.active {
  background: var(--hover);
}

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
  border-radius: var(--radius-sm);
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
