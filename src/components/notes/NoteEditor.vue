<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { usePageActive } from '../../composables/usePageActive'
import { normalizeAssetHtml, resolveAssetHtml } from '../../services/attachmentSrc'
import { sanitizeNoteHtml, safeLink, safeImage } from '../../utils/sanitizeNoteHtml'
import { useEditor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
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

const pageActive = usePageActive()
const lowlight = createLowlight({
  typescript: ts, javascript: js, python, rust, css, html: xml, xml, json, bash, shell: bash, sql, java, go, cpp, c: cpp,
})

const props = withDefaults(defineProps<{
  initialContent?: string
  variant?: 'composer' | 'card' | 'full'
  placeholder?: string
  /** 剪贴板里的图片交外层落盘，换回正文用的 src。目标小记由包着它的那张面绑好，编辑器不问 */
  saveImage?: (source: File | string) => Promise<string | null>
}>(), {
  initialContent: '',
  variant: 'card',
  placeholder: '输入 / 打开命令...',
  saveImage: undefined,
})

const emit = defineEmits<{
  update: [html: string]
  submit: []
  escape: []
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
      Escape: ({ editor }) => {
        if (editor.view.composing) return false
        if (showSlashMenu.value) {
          showSlashMenu.value = false
          return true
        }
        if (props.variant === 'full') {
          // StarterKit 会消费 Escape 来选择父节点；全屏书写面交给外层退出。
          emit('escape')
          return true
        }
        return false
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
    // 剪贴板里的富文本最爱带 base64 内嵌图：地址进不了库，可读面清洗器也判它死。
    // 这里用同一个谓词当场不解析，否则就是「粘进来看得见、重开一次全没了」。
    return [{
      tag: 'img[src]',
      getAttrs: (node) => (safeImage((node as Element).getAttribute('src') ?? '') ? {} : false),
    }]
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

/** 撤销/重做的可用性：每笔事务后重算，供底栏那两颗钮决定灰不灰 */
const canUndo = ref(false)
const canRedo = ref(false)

// 跟踪整次输入法合成的范围。标点可能先写入正文，再以相同文字确认一次；
// 第二次只改变选区，不会经过 handleTextInput，不能仅靠正文变化修光标。
type CompositionRange = { from: number; to: number; committed: string | null }
let compositionRange: CompositionRange | null = null
let punctuationTimer: ReturnType<typeof setTimeout> | undefined
const punctuationAtEnd = /[，。！？；：、…—·“”‘’（）【】《》〈〉「」『』〔〕［］｛｝]$/
const punctuationPairs: Record<string, string> = { '（': '）', '【': '】', '《': '》', '〈': '〉', '「': '」', '『': '』', '〔': '〕', '［': '］', '｛': '｝', '“': '”', '‘': '’' }
function finishPunctuation(view: EditorView, range: CompositionRange): boolean {
  if (compositionRange !== range || range.committed === null) return false
  compositionRange = null
  if (view.isDestroyed || view.composing || !view.hasFocus() || !punctuationAtEnd.test(range.committed)) return false
  const { doc, selection } = view.state
  if (!selection.empty || selection.head < range.from || selection.head > range.to) return false
  if (doc.textBetween(range.from, range.to) !== range.committed) return false
  const domSelection = view.dom.ownerDocument.getSelection()
  if (!domSelection?.isCollapsed || !domSelection.focusNode || !view.dom.contains(domSelection.focusNode)) return false
  const domHead = view.posAtDOM(domSelection.focusNode, domSelection.focusOffset)
  if (domHead < range.from || domHead > range.to) return false
  if (selection.head === range.to && domHead === range.to) return false
  const offset = domHead - range.from
  if (offset > 0 && punctuationPairs[range.committed[offset - 1]] === range.committed[offset]) return false
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, range.to)).scrollIntoView())
  // 状态选区可能已经正确、原生选区尚未同步；相同选区事务不保证重写 DOM。
  view.focus()
  return true
}
onBeforeUnmount(() => clearTimeout(punctuationTimer))

const editor = useEditor({
  // 库里存的是 attachments/<名>，编辑器里要看到真图；存回去时再洗回相对形态
  content: resolveAssetHtml(sanitizeNoteHtml(props.initialContent || '')),
  parseOptions: { preserveWhitespace: 'full' },
  // 顶部草稿输入不抢焦点，打开列表时保持阅读位置。
  // 卡片就地编辑和全屏面是用户主动进入的书写面，才需要落点即写。
  autofocus: false,
  editorProps: {
    handlePaste: (view, event) => pasteLinkAsUrl(view, event),
    handleDOMEvents: {
      compositionstart: (view) => {
        if (compositionRange) finishPunctuation(view, compositionRange)
        clearTimeout(punctuationTimer)
        compositionRange = { from: view.state.selection.from, to: view.state.selection.to, committed: null }
        return false
      },
      compositionend: (view, event) => {
        const range = compositionRange
        if (range) {
          range.committed = event.data
          clearTimeout(punctuationTimer)
          // ProseMirror 在 20ms 后结束合成清理；等原生选区同步完成再校正。
          punctuationTimer = setTimeout(() => finishPunctuation(view, range), 25)
        }
        return false
      },
      keydown: (view, event) => {
        if (!view.composing && /^(Arrow|Home$|End$|Page|Escape$)/.test(event.key)) compositionRange = null
        else if (!view.composing && compositionRange) finishPunctuation(view, compositionRange)
        return false
      },
      beforeinput: (view, event) => {
        // 下一次输入先到时，先结清上一笔提交，避免新文字落在旧标点之前。
        if (view.composing || !compositionRange || !event.cancelable || event.inputType !== 'insertText' || !event.data) return false
        if (!finishPunctuation(view, compositionRange)) return false
        // 浏览器已为本次原生输入缓存旧选区；修正后由编辑器接手这次输入，
        // 仍经过 handleTextInput 链，保留输入规则与各插件的处理。
        event.preventDefault()
        const { from, to } = view.state.selection
        const text = event.data
        const defaultTransaction = () => view.state.tr.insertText(text, from, to).scrollIntoView()
        if (!view.someProp('handleTextInput', handler => handler(view, from, to, text, defaultTransaction))) {
          view.dispatch(defaultTransaction())
        }
        return true
      },
      pointerdown: () => { compositionRange = null; return false },
      blur: () => { compositionRange = null; return false },
    },
    handleTextInput: (view, from, to, text, defaultTransaction) => {
      // 候选文字和标点可能一次提交，不能只接收单个标点。
      if (view.composing || !punctuationAtEnd.test(text)) return false
      // 合成提交会替换整段拼音，原光标可以在替换范围末尾。
      if (view.state.selection.from < from || view.state.selection.to > to) return false
      const tr = defaultTransaction()
      const end = from + text.length
      // 光标也可能已到候选文字末尾、仍在标点前；只修正本次提交范围内的折叠选区。
      if (!tr.selection.empty || tr.selection.head < from || tr.selection.head >= end) return false
      const offset = tr.selection.head - from
      // 输入法成对补全括号或引号时，光标应留在这一对符号之间。
      if (offset > 0 && punctuationPairs[text[offset - 1]] === text[offset]) return false
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView())
      return true
    },
  },
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      // 正文里存的是地址本身：书写面点击不跳转（阅读面才开链接），地址合法性复用清洗器那一份
      // 口径，否则「什么算链接」会有两套答案。rel 与清洗器回写的顺序保持一致。
      // v3 的 StarterKit 自带 Link，只能在这里配置；再注册一颗会得到重复的 link 名。
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        validate: (href: string) => safeLink(href),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
      },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    Placeholder.configure({ placeholder: props.placeholder }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TagHighlightExtension,
    SlashCommandExtension,
    NoteImage,
  ],
  onCreate: ({ editor }) => {
    // 初次聚焦同步完成，避免延迟一帧后覆盖用户刚设置的选区。
    if (props.variant !== 'composer' && pageActive.value && !editor.view.hasFocus()) {
      const selection = isBlankContent(props.initialContent)
        ? TextSelection.atStart(editor.state.doc)
        : TextSelection.atEnd(editor.state.doc)
      editor.view.dispatch(editor.state.tr.setSelection(selection))
      editor.view.focus()
      editor.commands.scrollIntoView()
    }
  },
  onUpdate: ({ editor }) => {
    emit('update', normalizeAssetHtml(editor.getHTML()))
    checkSlashMenu(editor)
  },
  onTransaction: ({ editor, transaction }) => {
    if (compositionRange && transaction.docChanged) {
      for (const map of transaction.mapping.maps) {
        const { from, to } = compositionRange
        let mappedFrom = map.map(from, -1)
        let mappedTo = map.map(to, 1)
        // 确认候选词时也可能替换光标之前的拼音，纳入实际替换范围。
        map.forEach((oldFrom, oldTo, newFrom, newTo) => {
          if (oldFrom <= to && oldTo >= from && newTo > newFrom) {
            mappedFrom = Math.min(mappedFrom, newFrom)
            mappedTo = Math.max(mappedTo, newTo)
          }
        })
        compositionRange.from = mappedFrom
        compositionRange.to = mappedTo
      }
    }
    canUndo.value = editor.can().undo()
    canRedo.value = editor.can().redo()
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
    // 父层同步只更新这张书写面，不能再回写；后台 composer 也会订阅全屏正文。
    editor.value.commands.setContent(resolveAssetHtml(sanitizeNoteHtml(val || '')), { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })
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

/**
 * 选中浮动条：标记平时只藏在 markdown 输入规则里，选中文字时在指针上方浮出来。
 * 浮层沿用斜杠菜单那一套（Teleport + fixed + 按钮 mousedown.prevent）：
 * 不引第二个浮层库，也免得焦点先跳到按钮上把选区吞掉。
 */
const BAR_H = 30
/** 只用于右缘夹取，条的真实宽度交给内容 */
const BAR_W_MAX = 268

const showFormatBar = ref(false)
const formatBarEl = ref<HTMLElement | null>(null)
const formatBarPos = ref({ top: 0, left: 0 })
const linkEditing = ref(false)
const linkHrefText = ref('')
const linkOnExisting = ref(false)
const linkBad = ref(false)
const linkRange = ref<{ from: number; to: number } | null>(null)
const linkInputEl = ref<HTMLInputElement | null>(null)
const pastedLink = ref<{ from: number; to: number; url: string; title: string } | null>(null)
const pastedLinkPos = ref({ top: 0, left: 0 })

/** 浏览器复制链接常同时给出 URL 和「网页标题」HTML；先保留 URL，标题由用户决定是否采用。 */
const pasteLinkAsUrl = (view: import('@tiptap/pm/view').EditorView, event: ClipboardEvent) => {
  const url = event.clipboardData?.getData('text/plain').trim() ?? ''
  if (!/^https?:\/\/\S+$/i.test(url) || !safeLink(url)) return false

  const html = event.clipboardData?.getData('text/html') ?? ''
  const body = new DOMParser().parseFromString(html, 'text/html').body
  const links = body.querySelectorAll('a[href]')
  const title = links.length === 1 && links[0].getAttribute('href') === url
    ? links[0].textContent?.trim() ?? ''
    : ''
  const offeredTitle = title !== url && body.textContent?.trim() === title ? title : ''

  const linkType = view.state.schema.marks.link
  const marks = linkType && view.state.selection.$from.parent.type.allowsMarkType(linkType)
    ? [linkType.create({ href: url })]
    : []
  view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(url, marks), false).scrollIntoView())
  showSlashMenu.value = false
  pastedLink.value = null
  if (offeredTitle && marks.length) {
    const to = view.state.selection.from
    pastedLink.value = { from: to - url.length, to, url, title: offeredTitle }
    positionPastedLink(view)
  }
  return true
}

const positionPastedLink = (view: import('@tiptap/pm/view').EditorView) => {
  const link = pastedLink.value
  if (!link) return
  const caret = view.coordsAtPos(link.to)
  pastedLinkPos.value = {
    top: caret.bottom + GAP + 38 < window.innerHeight ? caret.bottom + GAP : caret.top - GAP - 38,
    left: Math.max(MARGIN, Math.min(caret.left, window.innerWidth - 360 - MARGIN)),
  }
}

const convertPastedLink = () => {
  const link = pastedLink.value
  const ed = editor.value
  pastedLink.value = null
  if (!ed || !link || ed.state.doc.textBetween(link.from, link.to) !== link.url) return
  const mark = ed.state.schema.marks.link.create({ href: link.url })
  const tr = ed.state.tr.replaceWith(link.from, link.to, ed.state.schema.text(link.title, [mark]))
  ed.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, link.from + link.title.length)).scrollIntoView())
  showSlashMenu.value = false
  ed.commands.focus()
}

const formatBarStyle = computed(() => ({
  top: `${formatBarPos.value.top}px`,
  left: `${formatBarPos.value.left}px`,
}))

const closeFormatBar = () => {
  showFormatBar.value = false
  linkEditing.value = false
  linkRange.value = null
  linkBad.value = false
}

const updateFormatBar = (ed: any) => {
  if (!ed) return
  const { from, to } = ed.state.selection
  // 代码块里标记无效；斜杠菜单开着时两个浮层会打架
  if (to <= from || ed.isActive('codeBlock') || showSlashMenu.value) {
    if (linkEditing.value) closeFormatBar()
    else showFormatBar.value = false
    return
  }
  // 地址输入框在浮层里，焦点已离开编辑器——这时不能因为失焦就把条收掉
  if (!ed.isFocused && !linkEditing.value) {
    showFormatBar.value = false
    return
  }
  // 先定位再显示：反过来首帧画在旧坐标上
  const a = ed.view.coordsAtPos(from)
  const b = ed.view.coordsAtPos(to)
  const above = Math.min(a.top, b.top) - GAP - BAR_H
  formatBarPos.value = {
    top: above >= MARGIN ? above : Math.min(Math.max(a.bottom, b.bottom) + GAP, window.innerHeight - BAR_H - MARGIN),
    left: Math.max(MARGIN, Math.min(Math.min(a.left, b.left), window.innerWidth - BAR_W_MAX - MARGIN)),
  }
  showFormatBar.value = true
}

const toggleInlineCode = () => {
  editor.value?.chain().focus().toggleCode().run()
}

const startLinkEdit = () => {
  const ed = editor.value
  if (!ed) return
  const { from, to } = ed.state.selection
  linkRange.value = { from, to }
  linkOnExisting.value = ed.isActive('link')
  linkHrefText.value = linkOnExisting.value ? String(ed.getAttributes('link').href ?? '') : ''
  linkBad.value = false
  linkEditing.value = true
  nextTick(() => {
    const el = linkInputEl.value
    if (!el) return
    el.focus()
    el.select()
  })
}

/** 光秃秃的 example.com 也当地址：补上协议再走同一份合法性判断 */
const normalizeHref = (raw: string) => {
  const href = raw.trim()
  if (!href || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return href
  return `https://${href}`
}

const applyLink = () => {
  const ed = editor.value
  const range = linkRange.value
  if (!ed || !range) return closeFormatBar()
  const href = normalizeHref(linkHrefText.value)
  if (!href || !safeLink(href)) {
    linkBad.value = true
    return
  }
  // 收尾把光标落到选区末尾：留着选中态，focus 补发的那拍事务会把条重新浮出来
  ed.chain().focus().setTextSelection(range).setLink({ href }).setTextSelection(range.to).run()
  closeFormatBar()
}

const removeLink = () => {
  const ed = editor.value
  const range = linkRange.value
  if (!ed || !range) return closeFormatBar()
  ed.chain().focus().setTextSelection(range).unsetLink().setTextSelection(range.to).run()
  closeFormatBar()
}

watch(() => editor.value, (ed) => {
  if (!ed) return
  ed.on('selectionUpdate', ({ editor: e }) => {
    updateCodeBlockState(e)
    updateFormatBar(e)
  })
  ed.on('transaction', ({ editor: e, transaction }) => {
    if (pastedLink.value && (transaction.docChanged || e.state.selection.from !== pastedLink.value.to
      || e.state.selection.to !== pastedLink.value.to)) {
      pastedLink.value = null
    }
    updateCodeBlockState(e)
    updateFormatBar(e)
  })
  ed.on('blur', () => {
    if (!linkEditing.value) showFormatBar.value = false
  })
})

// Click outside to close slash menu
const handleClickOutside = (e: MouseEvent) => {
  if (showSlashMenu.value && slashMenuEl.value && !slashMenuEl.value.contains(e.target as HTMLElement)) {
    showSlashMenu.value = false
  }
  // 浮条只认自身之内：地址输入框开着时点了别处，就等于放弃这次改链
  if (showFormatBar.value && formatBarEl.value && !formatBarEl.value.contains(e.target as HTMLElement)) {
    closeFormatBar()
  }
  if (pastedLink.value && !(e.target as HTMLElement).closest('.paste-link-prompt')) pastedLink.value = null
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('scroll', repositionFormatBar, { capture: true, passive: true })
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('scroll', repositionFormatBar, { capture: true })
  editor.value?.destroy()
})

/** 选区随滚动挪走而浮条是视口坐标：只在它可见时重算，别给全局滚动加活 */
function repositionFormatBar() {
  if (showFormatBar.value) updateFormatBar(editor.value)
  if (pastedLink.value && editor.value) positionPastedLink(editor.value.view)
}

const focusEnd = () => {
  editor.value?.chain().focus('end').run()
}

const insertText = (text: string) => {
  editor.value?.chain().focus().insertContent(text).run()
}

/** 底栏那两颗钮先 focus 再走 history：不抢回来的话点完钮光标还在按钮上 */
const undo = () => { editor.value?.chain().focus().undo().run() }
const redo = () => { editor.value?.chain().focus().redo().run() }

/** 图片块追加到光标处；默认宽度按书写面区分：列表窄栏小图够用，全屏才给大图 */
const insertImage = (src: string) => {
  const ed = editor.value
  if (!ed) return
  const width = props.variant === 'full' ? '55%' : '30%'
  ed.chain().focus().insertContent({ type: 'image', attrs: { src, width } }).run()
}

/** 截图 Ctrl+V 与复制图片文件粘贴：剪贴板里的图片交外层落盘，回来的地址按当前落点插。 */
const clipboardImages = (e: ClipboardEvent): File[] => {
  const items = e.clipboardData?.items
  if (!items) return []
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

const onPaste = async (e: ClipboardEvent) => {
  const save = props.saveImage
  if (!save) return
  const files = clipboardImages(e)
  if (!files.length) return
  e.preventDefault()
  for (const file of files) {
    const src = await save(file)
    if (src) insertImage(src)
  }
}

defineExpose({ focusEnd, insertText, insertImage, undo, redo, canUndo, canRedo })
</script>

<template>
  <div ref="editorWrapper" class="note-editor" :class="`v-${variant}`" @change="relocateCaret" @paste="onPaste">
    <EditorContent :editor="editor" />
    <Teleport to="body" :disabled="!pageActive">
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
    <Teleport to="body" :disabled="!pageActive">
      <div v-if="showFormatBar" ref="formatBarEl" class="fmt-bar" :style="formatBarStyle">
        <template v-if="!linkEditing">
          <button
            class="fmt-btn"
            :class="{ on: editor?.isActive('code') }"
            type="button"
            title="行内代码 (Ctrl+E)"
            aria-label="行内代码"
            @mousedown.prevent
            @click="toggleInlineCode"
          >
            <AppIcon name="code" :size="14" />
          </button>
          <button
            class="fmt-btn"
            :class="{ on: editor?.isActive('link') }"
            type="button"
            title="添加链接"
            aria-label="添加链接"
            @mousedown.prevent
            @click="startLinkEdit"
          >
            <AppIcon name="link" :size="14" />
          </button>
        </template>
        <template v-else>
          <input
            ref="linkInputEl"
            v-model="linkHrefText"
            class="fmt-input"
            :class="{ bad: linkBad }"
            type="text"
            inputmode="url"
            placeholder="粘贴或输入地址"
            aria-label="链接地址"
            @keydown.enter.prevent="applyLink"
            @keydown.esc.stop.prevent="closeFormatBar"
          />
          <button v-if="linkOnExisting" class="fmt-text" type="button" @mousedown.prevent @click="removeLink">移除</button>
          <button class="fmt-btn" type="button" title="确定" aria-label="确定链接" @mousedown.prevent @click="applyLink">
            <AppIcon name="check" :size="14" />
          </button>
          <button class="fmt-btn" type="button" title="取消" aria-label="取消" @mousedown.prevent @click="closeFormatBar">
            <AppIcon name="x" :size="14" />
          </button>
        </template>
      </div>
    </Teleport>
    <Teleport to="body" :disabled="!pageActive">
      <div v-if="pastedLink" class="paste-link-prompt" :style="{ top: pastedLinkPos.top + 'px', left: pastedLinkPos.left + 'px' }" role="group" aria-label="链接粘贴选项">
        <span class="paste-link-title" :title="pastedLink.title">网页标题：{{ pastedLink.title }}</span>
        <button type="button" @mousedown.prevent @click="convertPastedLink">转换为标题</button>
        <button type="button" aria-label="保留网址" title="保留网址" @mousedown.prevent @click="pastedLink = null"><AppIcon name="x" :size="14" /></button>
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

/* 草稿输入：默认三行（3×24.65 行高 + 20 内衬），内容自然撑高，46vh 是滚动上限。
   min-height 不加过渡——伸缩要的是跟手，缓动会让高度慢半拍 */
.note-editor.v-composer :deep(.ProseMirror) {
  padding: var(--space-3) var(--space-4) var(--space-2);
  font-size: 14.5px;
  line-height: 1.7;
  min-height: 94px;
  max-height: 46vh;
  scrollbar-gutter: stable;
  overflow-y: auto;
}
/* 竖长图只封顶宽会撑出半屏高；书写面里按视口高度收着放，全屏给更大的额度 */
.note-editor :deep(.img-node img) { max-height: 34vh; object-fit: contain; }
.note-editor.v-full :deep(.img-node img) { max-height: 60vh; }

/* 就地书写比只读大半档，标题格式沿用编辑器样式；普通首段保持正文。 */
.note-editor.v-card :deep(.ProseMirror) {
  padding: 0;
  font-size: var(--text-base);
  line-height: 1.6;
  min-height: 72px;
  max-height: 46vh;
  scrollbar-gutter: stable;
  overflow-y: auto;
}

/* 全屏书写：一张纸的排版尺度（密一档，一屏多放几行） */
.note-editor.v-full :deep(.ProseMirror) {
  padding: 0;
  font-size: 14.5px;
  line-height: 1.6;
  letter-spacing: -0.012em;
  min-height: 40vh;
  caret-color: var(--accent);
}

.note-editor.v-full :deep(.ProseMirror > * + *) { margin-top: 8px; }
.note-editor.v-full :deep(h1) { font-size: 21px; font-weight: 650; line-height: 1.32; letter-spacing: -0.026em; margin-top: var(--space-4); }
.note-editor.v-full :deep(h2) { font-size: var(--text-lg); font-weight: 620; line-height: 1.42; letter-spacing: -0.02em; margin-top: 12px; }
.note-editor.v-full :deep(h3) { font-size: 16px; font-weight: 600; }
.note-editor.v-full :deep(blockquote) { border-left-width: 3px; padding-left: var(--space-4); }
.note-editor.v-full :deep(pre) { font-size: 13.5px; line-height: 1.75; padding: var(--space-4); background: var(--bg-surface); border: none; box-shadow: var(--shadow-xs); }
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
.note-editor :deep(code) { font-family: var(--font-mono); font-size: var(--text-xs); background: var(--code-bg); border-radius: 4px; padding: 1px 5px; color: var(--accent-active); }
.note-editor :deep(pre) { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.65; color: var(--code-fg); background: var(--code-bg); border: 1px solid var(--code-bd); border-radius: var(--radius); padding: var(--space-2) var(--space-3); overflow-x: auto; }
.note-editor :deep(pre code) { background: none; border: none; padding: 0; color: inherit; font-size: inherit; }
.note-editor :deep(hr) { border: none; border-top: 1px solid color-mix(in srgb, var(--text) 26%, transparent); margin: var(--space-3) 0; }
.note-editor :deep(ul[data-type='taskList']) { list-style: none; padding-left: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.note-editor :deep(ul[data-type='taskList'] li) { display: flex; align-items: flex-start; gap: var(--space-2); }
/* 正文必须撑满剩余宽度：弹性项默认按内容收缩，空条目会缩成 0 宽，光标没有行盒可落 = 看不见光标 */
.note-editor :deep(ul[data-type='taskList'] li > div) { flex: 1 1 auto; min-width: 0; }
/* 勾选框的自绘配方在 global.css，这里只按本层行高把它挪到第一行居中 */
.note-editor :deep(ul[data-type='taskList'] input) { margin-top: 4px; }

/* 语法高亮的配色规则在 global.css：那里写一次，编辑器与只读渲染共用 */

.slash-menu {
  position: fixed;
  width: 208px;
  z-index: 300;
  padding: 4px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-pop);
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
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--text-secondary);
}

.sm-label { flex: 1; min-width: 0; font-size: var(--text-sm); }

.sm-hint {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  color: var(--text-muted);
  white-space: nowrap;
}

.sm-empty { padding: 9px 7px; font-size: var(--text-sm); color: var(--text-muted); }

.slash-item.active { background: var(--accent-soft); }
.slash-item.active .sm-label { color: var(--accent-active); font-weight: 500; }
.slash-item.active .sm-icon, .slash-item.active .sm-badge { color: var(--accent-active); }
.slash-item.active .sm-hint { color: var(--accent-active); opacity: 0.6; }

/* 选中浮动条：与 .slash-menu 同一档浮层语言，26px 控件跟着卡面动作排那条轴 */
.fmt-bar {
  position: fixed;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 2px;
  width: max-content;
  padding: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  box-shadow: var(--shadow-pop);
}

.fmt-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.fmt-btn:hover { background: var(--hover-chrome); color: var(--text); }
.fmt-btn.on { background: var(--accent-soft); color: var(--accent-active); }

.fmt-text {
  height: 22px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
}

.fmt-text:hover { background: var(--hover-chrome); color: var(--text); }

.fmt-input {
  width: 168px;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.fmt-input:focus { outline: none; border-color: var(--accent); }
.fmt-input.bad { border-color: var(--danger); }

.paste-link-prompt {
  position: fixed;
  z-index: 300;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: min(360px, calc(100vw - 24px));
  padding: 4px 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  box-shadow: var(--shadow-pop);
  font-size: var(--text-xs);
}

.paste-link-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.paste-link-prompt button { flex-shrink: 0; border: 0; border-radius: 6px; padding: 4px 6px; background: transparent; color: var(--accent-active); cursor: pointer; }
.paste-link-prompt button:hover { background: var(--hover-chrome); }

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
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-ib);
  font-size: var(--text-xs);
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
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-pop);
  max-height: 200px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  min-width: 120px;
  z-index: 100;
}

.lang-option {
  padding: 6px 12px;
  font-size: var(--text-xs);
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
